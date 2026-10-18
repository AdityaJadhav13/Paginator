"""EXP-COMPOSE-1 analysis — turns raw results into the report tables (programmatic; no cherry-picking).

Usage: PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose1/analyze.py
Reads results/compose1/{paragraphs.csv.gz, lines_subset.csv.gz}; writes results/compose1/analysis/*.
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import statistics as st
import sys
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402
import composer as K  # noqa: E402
import run_matrix as R  # noqa: E402

A = R.OUT / "analysis"
NUM = {"size_pt", "width_mm", "ws_max_hard", "lines", "nonfinal_lines", "justified_lines", "within_policy_lines",
       "semi_lines", "ragged_lines", "violation_lines", "inword_breaks", "emergency_breaks", "overfull_lines",
       "tracked_lines", "req_sf_median", "req_sf_p90", "req_sf_p95", "req_sf_max", "req_sf_inf_lines",
       "app_sf_median", "app_sf_p95", "app_sf_max", "req_gt_1_5", "req_gt_2_0", "req_gt_3_0",
       "mean_slack_frac_unjustified", "wpl_mean", "chars_per_line", "adv_em_total", "chars", "ref_ragged_lines",
       "compose_ms"}
CANDIDATES = ["FULL_DP_h1.50", "FULL_DP_h1.75", "FULL_DP_h2.00", "FULL_DP_h2.25", "FULL_GREEDY_h2.00",
              "FULL_DP_h2.00_rules", "FULL_DP_h2.00_rules_publishedmin", "FULL_DP_h2.00_ortho_EXPLORATORY",
              "CONSTRAINED_DP_c1.33", "CONSTRAINED_DP_c1.50", "CONSTRAINED_DP_c2.00",
              "HYBRID_DP_h1.50", "HYBRID_DP_h2.00", "HYBRID_GREEDY_h2.00", "HYBRID_DP_h2.00_rules",
              "RAGGED_DP", "RAGGED_GREEDY"]


def load(name):
    with gzip.open(R.OUT / name, "rt", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        for k in list(r):
            if k in NUM or k in ("a", "b", "n_words", "n_spaces", "required_sf", "applied_sf", "slack_mm",
                                 "tracking_mm_per_gap", "cost"):
                try:
                    r[k] = float(r[k])
                except (ValueError, TypeError):
                    r[k] = float("nan")
        if "within_policy" in r:
            r["within_policy"] = r["within_policy"] == "True"
    return rows


def eff_nonfinal(r):  # FULL overset with no lines: count the ragged-reference lines as out-of-policy
    if r["lines"] == 0:
        assert r["ref_ragged_lines"] == r["ref_ragged_lines"], "missing ragged reference"
        return max(0.0, r["ref_ragged_lines"] - 1)
    return r["nonfinal_lines"]


def agg(rows):
    if not rows:
        return {}
    nf = sum(eff_nonfinal(r) for r in rows)
    return {
        "cases": len(rows),
        "composable_pct": round(100 * sum(r["status"] == "OK" for r in rows) / len(rows), 2),
        "lines_within_policy_pct": round(100 * sum(r["within_policy_lines"] for r in rows) / max(1, nf), 2),
        "justified_lines_pct": round(100 * sum(r["justified_lines"] for r in rows) / max(1, nf), 2),
        "unjustified_lines_pct (semi+ragged)": round(100 * sum(r["semi_lines"] + r["ragged_lines"] for r in rows) / max(1, nf), 2),
        "inword_breaks_per_100_lines": round(100 * sum(r["inword_breaks"] for r in rows) / max(1, sum(r["lines"] for r in rows)), 2),
        "inword_breaks_per_paragraph": round(st.mean(r["inword_breaks"] for r in rows), 3),
        "emergency_breaks": int(sum(r["emergency_breaks"] for r in rows)),
        "overfull_lines": int(sum(r["overfull_lines"] for r in rows)),
        "mean_lines_composed": round(st.mean(r["lines"] for r in rows if r["lines"] > 0), 3) if any(r["lines"] > 0 for r in rows) else None,
        "mean_line_delta_vs_ragged_dp": round(st.mean(r["lines"] - r["ref_ragged_lines"] for r in rows if r["lines"] > 0), 3) if any(r["lines"] > 0 for r in rows) else None,
        "mean_slack_frac_unjustified_lines": round(st.mean(r["mean_slack_frac_unjustified"] for r in rows), 4),
        "compose_ms_median": round(st.median(r["compose_ms"] for r in rows), 4),
        "compose_ms_p95": round(C.percentile([r["compose_ms"] for r in rows], .95), 4),
    }


def bucket(v):
    if v != v:
        return "nan"
    for lo, hi, lab in ((0, 3, "<3"), (3, 4, "3-4"), (4, 5, "4-5"), (5, 6, "5-6"), (6, 7, "6-7"), (7, 8, "7-8")):
        if lo <= v < hi:
            return lab
    return ">=8"


def write_csv(name, rows):
    if not rows:
        return
    keys = list(dict.fromkeys(k for r in rows for k in r))
    with open(A / name, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=keys); w.writeheader(); w.writerows(rows)


def main():
    A.mkdir(parents=True, exist_ok=True)
    P = load("paragraphs.csv.gz")
    L = load("lines_subset.csv.gz")
    S = {}
    geo = defaultdict(dict)  # (text, font, size, width) -> policy -> row
    for r in P:
        geo[(r["text_id"], r["font"], r["size_pt"], r["width_mm"])][r["policy"]] = r
    # FIX (2026-10-08): run_matrix filled ref_ragged_lines only for policies evaluated AFTER RAGGED_DP,
    # so overset FULL rows had no reference and dropped out of the denominator (a false 100 %).
    # Take the reference from the RAGGED_DP row of the same paragraph-geometry for EVERY row.
    for k, pols in geo.items():
        ref = pols["RAGGED_DP"]["lines"]
        for r in pols.values():
            r["ref_ragged_lines"] = ref

    # ---------------- policy matrix (full granularity) -------------------------------------
    groups = defaultdict(list)
    for r in P:
        groups[(r["lang"], r["policy"], r["font"], r["size_pt"], r["width_mm"])].append(r)
    write_csv("policy_matrix.csv", [{"lang": k[0], "policy": k[1], "font": k[2], "size_pt": k[3], "width_mm": k[4], **agg(v)}
                                     for k, v in sorted(groups.items())])

    # ---------------- B: geometry chain (Marathi), per font/size/width ----------------------
    chain = []
    for (lang, pol, font, size, width), rows in sorted(groups.items()):
        if lang != "mr" or pol != "MEAS_DP_uncapped":
            continue
        nf = sum(r["nonfinal_lines"] for r in rows)
        rag = [geo[(r["text_id"], font, size, width)]["RAGGED_DP"] for r in rows]
        chain.append({"font": font, "size_pt": size, "width_mm": width,
                      "words_per_line_natural": round(st.mean(x["wpl_mean"] for x in rag if x["wpl_mean"] == x["wpl_mean"]), 3),
                      "spaces_per_line": round(st.mean(x["wpl_mean"] for x in rag if x["wpl_mean"] == x["wpl_mean"]) - 1, 3),
                      "chars_per_line": round(st.mean(x["chars_per_line"] for x in rag), 2),
                      "lines_req_le_1_5_pct": round(100 * (1 - sum(r["req_gt_1_5"] for r in rows) / nf), 2),
                      "lines_req_le_2_0_pct": round(100 * (1 - sum(r["req_gt_2_0"] for r in rows) / nf), 2),
                      "lines_req_le_3_0_pct": round(100 * (1 - sum(r["req_gt_3_0"] for r in rows) / nf), 2),
                      "req_sf_median_of_paragraph_medians": round(st.median(r["req_sf_median"] for r in rows), 3)})
    write_csv("geometry_chain_mr.csv", chain)
    by_w = defaultdict(list)
    for c in chain:
        by_w[c["width_mm"]].append(c)
    S["B_width_curve_mr_pooled_fonts_sizes"] = {w: {k: round(st.mean(c[k] for c in v), 2) for k in
                                                   ("words_per_line_natural", "chars_per_line", "lines_req_le_1_5_pct",
                                                    "lines_req_le_2_0_pct", "lines_req_le_3_0_pct")}
                                               for w, v in sorted(by_w.items())}

    # break-opportunity geometry (explicit chain): word width, space width, window vs gap
    bo = []
    for lab, fam, axes, wt in R.FONTS["Deva"]:
        for size in (9.0, 9.5):
            ws, sp, pcs = [], [], []
            for t in [x for x in C.load_corpus() if x["kind"] == "body" and x["lang"] == "mr"]:
                p = K.prepare(t["text"], "mr", "Deva", fam, size, axes, wt)
                for wi, cl in enumerate(p.words):
                    ws.append(sum(p.clusters[i].width for i in cl))
                sp += [s for s in p.spaces if s]
                pol = K.Policy("x", "FULL", inword="rules", inword_min=(2, 2))
                pieces, _, _ = K.build_pieces(p, pol, 1e9)
                pcs += [x.width for x in pieces]
            mw, ms, mp = st.mean(ws), st.mean(sp), st.mean(pcs)
            for width in R.WIDTHS:
                wpl = width / (mw + ms)
                window = max(0.0, wpl - 1) * ms * (2.0 - 0.8)
                bo.append({"font": lab, "size_pt": size, "width_mm": width, "mean_word_mm": round(mw, 3),
                           "mean_space_mm": round(ms, 3), "mean_piece_mm_with_rules": round(mp, 3),
                           "est_words_per_line": round(wpl, 2), "window_mm_at_0.8_to_2.0": round(window, 3),
                           "gap_between_space_breaks_mm": round(mw + ms, 3),
                           "window_over_gap": round(window / (mw + ms), 3),
                           "window_over_gap_with_rules": round(window / mp, 3)})
    write_csv("break_opportunity_geometry_mr.csv", bo)

    # ---------------- words-per-line bins ----------------------------------------------------
    bins = defaultdict(lambda: defaultdict(list))
    for k, pols in geo.items():
        if "RAGGED_DP" not in pols or pols["RAGGED_DP"]["lang"] != "mr":
            continue
        b = bucket(pols["RAGGED_DP"]["wpl_mean"])
        for name in CANDIDATES + ["MEAS_DP_uncapped"]:
            if name in pols:
                bins[b][name].append(pols[name])
    wpl_tab = {}
    for b in ("<3", "3-4", "4-5", "5-6", "6-7", "7-8", ">=8"):
        if b not in bins:
            continue
        m = bins[b]["MEAS_DP_uncapped"]; nf = sum(r["nonfinal_lines"] for r in m)
        wpl_tab[b] = {"cases": len(m),
                      "lines_req_le_2_0_pct": round(100 * (1 - sum(r["req_gt_2_0"] for r in m) / max(1, nf)), 2),
                      **{f"{n}:composable/within": f'{agg(bins[b][n])["composable_pct"]}/{agg(bins[b][n])["lines_within_policy_pct"]}'
                         for n in ("FULL_DP_h2.00", "FULL_DP_h2.00_rules", "HYBRID_DP_h2.00", "CONSTRAINED_DP_c1.50")}}
    S["words_per_line_bins_mr"] = wpl_tab

    # ---------------- spacing distributions (lines subset; 9/9.5 pt; 38/45/52 mm) ------------
    sp_tab = {}
    for name in CANDIDATES + ["MEAS_DP_uncapped", "MEAS_GREEDY_uncapped"]:
        for lang_group, pred in (("mr", lambda r: r["text_id"].startswith("mr")), ("en", lambda r: r["text_id"].startswith("en"))):
            app = [r["applied_sf"] for r in L if r["policy"] == name and pred(r) and r["kind"] == "justified"]
            req = [r["required_sf"] for r in L if r["policy"] == name and pred(r) and r["kind"] not in ("final",)
                   and not math.isinf(r["required_sf"])]
            if not req:
                continue
            def d(xs):
                return {"n": len(xs), "median": round(C.percentile(xs, .5), 3), "p90": round(C.percentile(xs, .9), 3),
                        "p95": round(C.percentile(xs, .95), 3), "max": round(max(xs), 3),
                        "pct_gt_1_5": round(100 * sum(x > 1.5 for x in xs) / len(xs), 2),
                        "pct_gt_2_0": round(100 * sum(x > 2.0 for x in xs) / len(xs), 2),
                        "pct_gt_3_0": round(100 * sum(x > 3.0 for x in xs) / len(xs), 2)} if xs else {}
            sp_tab[f"{name}|{lang_group}"] = {"applied_on_justified_lines": d(app), "required_to_justify_every_nonfinal_line": d(req)}
    S["spacing_distributions_9-9.5pt_38-45-52mm"] = sp_tab

    # ---------------- condensed policy tables ------------------------------------------------
    cond = defaultdict(list)
    for r in P:
        cond[(r["lang"], r["policy"], "ge45" if r["width_mm"] >= 45 else "lt45")].append(r)
    S["policy_summary_by_lang_width_band"] = {"|".join(k): agg(v) for k, v in sorted(cond.items()) if k[1] in CANDIDATES}
    cw = defaultdict(list)
    for r in P:
        if r["lang"] == "mr":
            cw[(r["policy"], r["width_mm"])].append(r)
    write_csv("policy_by_width_mr.csv", [{"policy": k[0], "width_mm": k[1], **agg(v)} for k, v in sorted(cw.items()) if k[0] in CANDIDATES])

    # ---------------- font analysis ----------------------------------------------------------
    fonts = {}
    for lab, *_ in R.FONTS["Deva"] + R.FONTS["Latn"]:
        rows = [r for r in P if r["font"] == lab and r["policy"] == "RAGGED_DP"]
        if not rows:
            continue
        em_per_char = st.mean(r["adv_em_total"] / r["chars"] for r in rows if r["size_pt"] == 9.5 and r["width_mm"] == 45.0)
        meas = [r for r in P if r["font"] == lab and r["policy"] == "MEAS_DP_uncapped" and r["width_mm"] >= 45 and r["lang"] in ("mr", "en")]
        nf = sum(r["nonfinal_lines"] for r in meas)
        fonts[lab] = {"em_per_char": round(em_per_char, 4),
                      "chars_per_line_9.5pt_45mm": round(st.mean(r["chars_per_line"] for r in rows if r["size_pt"] == 9.5 and r["width_mm"] == 45.0), 2),
                      "words_per_line_9.5pt_45mm": round(st.mean(r["wpl_mean"] for r in rows if r["size_pt"] == 9.5 and r["width_mm"] == 45.0 and r["wpl_mean"] == r["wpl_mean"]), 2),
                      "lines_req_le_2_0_pct_ge45": round(100 * (1 - sum(r["req_gt_2_0"] for r in meas) / max(1, nf)), 2),
                      **{f"{n}_ge45": agg([r for r in P if r["font"] == lab and r["policy"] == n and r["width_mm"] >= 45])["lines_within_policy_pct"]
                         for n in ("FULL_DP_h2.00", "FULL_DP_h2.00_rules", "HYBRID_DP_h2.00", "HYBRID_DP_h2.00_rules")}}
    S["font_analysis"] = fonts

    # ---------------- size analysis (Marathi, ≥45 mm) ---------------------------------------
    S["size_analysis_mr_ge45"] = {}
    for size in R.SIZES:
        meas = [r for r in P if r["lang"] == "mr" and r["size_pt"] == size and r["width_mm"] >= 45 and r["policy"] == "MEAS_DP_uncapped"]
        rag = [r for r in P if r["lang"] == "mr" and r["size_pt"] == size and r["width_mm"] >= 45 and r["policy"] == "RAGGED_DP"]
        nf = sum(r["nonfinal_lines"] for r in meas)
        S["size_analysis_mr_ge45"][size] = {"words_per_line": round(st.mean(r["wpl_mean"] for r in rag if r["wpl_mean"] == r["wpl_mean"]), 2),
                                           "lines_req_le_2_0_pct": round(100 * (1 - sum(r["req_gt_2_0"] for r in meas) / nf), 2),
                                           "FULL_DP_h2.00_composable_pct": agg([r for r in P if r["lang"] == "mr" and r["size_pt"] == size and r["width_mm"] >= 45 and r["policy"] == "FULL_DP_h2.00"])["composable_pct"]}

    # ---------------- breaking strategies & algorithm ---------------------------------------
    def band(name, lang="mr", ge=True):
        return agg([r for r in P if r["policy"] == name and r["lang"] == lang and ((r["width_mm"] >= 45) == ge)])
    S["breaking_mr_ge45"] = {n: band(n) for n in ("FULL_DP_h2.00", "FULL_DP_h2.00_rules", "FULL_DP_h2.00_rules_publishedmin",
                                                  "FULL_DP_h2.00_ortho_EXPLORATORY", "HYBRID_DP_h2.00", "HYBRID_DP_h2.00_rules")}
    S["breaking_en_ge45"] = {n: band(n, "en") for n in ("FULL_DP_h2.00", "FULL_DP_h2.00_rules", "FULL_DP_h2.00_rules_track10_EXPLORATORY",
                                                        "FULL_DP_h2.00_rules_track20_EXPLORATORY", "HYBRID_DP_h2.00", "HYBRID_DP_h2.00_rules")}
    alg = {}
    for lang in ("mr", "en"):
        for dp, gr in (("FULL_DP_h2.00", "FULL_GREEDY_h2.00"), ("HYBRID_DP_h2.00", "HYBRID_GREEDY_h2.00"), ("RAGGED_DP", "RAGGED_GREEDY")):
            alg[f"{lang}|{dp} vs {gr}"] = {"DP": band(dp, lang), "GREEDY": band(gr, lang)}
        m_dp = [r for r in P if r["policy"] == "MEAS_DP_uncapped" and r["lang"] == lang and r["width_mm"] >= 45]
        m_gr = [r for r in P if r["policy"] == "MEAS_GREEDY_uncapped" and r["lang"] == lang and r["width_mm"] >= 45]
        alg[f"{lang}|required spacing DP vs GREEDY (≥45mm)"] = {
            "DP_lines_req_le_2_0_pct": round(100 * (1 - sum(r["req_gt_2_0"] for r in m_dp) / sum(r["nonfinal_lines"] for r in m_dp)), 2),
            "GREEDY_lines_req_le_2_0_pct": round(100 * (1 - sum(r["req_gt_2_0"] for r in m_gr) / sum(r["nonfinal_lines"] for r in m_gr)), 2)}
    S["algorithm_dp_vs_greedy"] = alg

    # ---------------- factor attribution (Y = % nonfinal lines needing ≤2.0× in least-bad justified DP)
    meas = [r for r in P if r["policy"] == "MEAS_DP_uncapped"]
    def Y(rows):
        nf = sum(r["nonfinal_lines"] for r in rows)
        return 100 * (1 - sum(r["req_gt_2_0"] for r in rows) / nf) if nf else float("nan")
    fa = {}
    deva_meas = [r for r in meas if r["script"] == "Deva"]
    for factor, keyf in (("width_mm", lambda r: r["width_mm"]), ("size_pt", lambda r: r["size_pt"]),
                         ("font (Deva variants)", lambda r: r["font"]), ("language mr vs hi", lambda r: r["lang"])):
        lv = defaultdict(list)
        for r in deva_meas:
            lv[keyf(r)].append(r)
        vals = {str(k): round(Y(v), 2) for k, v in sorted(lv.items())}
        fa[factor] = {"levels": vals, "range_pp": round(max(vals.values()) - min(vals.values()), 2)}
    for factor, a_, b_ in (("algorithm (DP vs greedy)", "MEAS_DP_uncapped", "MEAS_GREEDY_uncapped"),
                           ("in-word rules (hyph-mr 2,2) vs none", "MEAS_DP_uncapped_rules", "MEAS_DP_uncapped")):
        ya = Y([r for r in P if r["policy"] == a_ and r["script"] == "Deva"]); yb = Y([r for r in P if r["policy"] == b_ and r["script"] == "Deva"])
        fa[factor] = {"levels": {a_: round(ya, 2), b_: round(yb, 2)}, "range_pp": round(abs(ya - yb), 2)}
    for name, hard in (("policy cap (FULL DP, % lines justified within cap, Deva)", None),):
        lv = {}
        for n in ("FULL_DP_h1.50", "FULL_DP_h1.75", "FULL_DP_h2.00", "FULL_DP_h2.25"):
            lv[n] = agg([r for r in P if r["policy"] == n and r["script"] == "Deva"])["lines_within_policy_pct"]
        fa[name] = {"levels": lv, "range_pp": round(max(lv.values()) - min(lv.values()), 2)}
    # words-per-line linear fit of Y per paragraph-geometry
    pts = []
    for k, pols in geo.items():
        if "MEAS_DP_uncapped" in pols and "RAGGED_DP" in pols and pols["RAGGED_DP"]["script"] == "Deva":
            m_ = pols["MEAS_DP_uncapped"]; w_ = pols["RAGGED_DP"]["wpl_mean"]
            if m_["nonfinal_lines"] > 0 and w_ == w_:
                pts.append((w_, 100 * (1 - m_["req_gt_2_0"] / m_["nonfinal_lines"])))
    mx, my = st.mean(p[0] for p in pts), st.mean(p[1] for p in pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts); sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    fa["words_per_line linear fit (per paragraph-geometry, Deva)"] = {"slope_pp_per_word": round(sxy / sxx, 2),
                                                                     "r2": round(sxy * sxy / (sxx * syy), 3), "n": len(pts)}
    S["factor_attribution_Y=pct_lines_needing_le_2.0x"] = fa

    # ---------------- internal plausibility criterion -------------------------------------
    plaus = {}
    for n in ("FULL_DP_h1.50", "FULL_DP_h1.75", "FULL_DP_h2.00", "FULL_DP_h2.25", "FULL_DP_h2.00_rules",
              "FULL_DP_h2.00_rules_publishedmin", "CONSTRAINED_DP_c1.50", "CONSTRAINED_DP_c2.00", "HYBRID_DP_h1.50",
              "HYBRID_DP_h2.00", "HYBRID_DP_h2.00_rules", "RAGGED_DP"):
        per_font = {}
        for lab, *_ in R.FONTS["Deva"]:
            rows = [r for r in P if r["policy"] == n and r["lang"] == "mr" and r["width_mm"] >= 45 and r["font"] == lab]
            per_font[lab] = agg(rows)["lines_within_policy_pct"]
        rows = [r for r in P if r["policy"] == n and r["lang"] == "mr" and r["width_mm"] >= 45]
        ag = agg(rows)
        plaus[n] = {"pooled_lines_within_policy_pct": ag["lines_within_policy_pct"], "composable_pct": ag["composable_pct"],
                    "fonts_reaching_98": [f for f, v in per_font.items() if v >= 98.0], "per_font": per_font}
    S["internal_plausibility_mr_ge45mm"] = plaus

    # ---------------- Pareto frontier (Marathi, ≥45 mm, 9–9.5 pt) ---------------------------
    pareto_rows = []
    for n in CANDIDATES:
        rows = [r for r in P if r["policy"] == n and r["lang"] == "mr" and r["width_mm"] >= 45 and r["size_pt"] in (9.0, 9.5)]
        ag = agg(rows)
        app = [l["applied_sf"] for l in L if l["policy"] == n and l["text_id"].startswith("mr") and l["width_mm"] >= 45 and l["kind"] == "justified"]
        unj = [l["slack_mm"] / l["width_mm"] for l in L if l["policy"] == n and l["text_id"].startswith("mr") and l["width_mm"] >= 45 and l["kind"] in ("semi", "ragged")]
        nl = [l for l in L if l["policy"] == n and l["text_id"].startswith("mr") and l["width_mm"] >= 45 and l["kind"] != "final"]
        pareto_rows.append({"policy": n, "composable_pct": ag["composable_pct"], "aligned_lines_pct": ag["justified_lines_pct"],
                            "p95_applied_space": round(C.percentile(app, .95), 3) if app else None,
                            "inword_per_100_lines": ag["inword_breaks_per_100_lines"],
                            "mean_rag_frac_all_lines": round(sum(unj) / max(1, len(nl)), 4),
                            "p95_rag_frac_unjustified": round(C.percentile(unj, .95), 4) if unj else 0.0})
    def dominates(x, y):
        ge = (x["composable_pct"] >= y["composable_pct"] and x["aligned_lines_pct"] >= y["aligned_lines_pct"]
              and (x["p95_applied_space"] or 0) <= (y["p95_applied_space"] or 0) and x["inword_per_100_lines"] <= y["inword_per_100_lines"]
              and x["mean_rag_frac_all_lines"] <= y["mean_rag_frac_all_lines"])
        gt = (x["composable_pct"] > y["composable_pct"] or x["aligned_lines_pct"] > y["aligned_lines_pct"]
              or (x["p95_applied_space"] or 0) < (y["p95_applied_space"] or 0) or x["inword_per_100_lines"] < y["inword_per_100_lines"]
              or x["mean_rag_frac_all_lines"] < y["mean_rag_frac_all_lines"])
        return ge and gt
    for x in pareto_rows:
        x["pareto_optimal"] = not any(dominates(y, x) for y in pareto_rows if y is not x and y["composable_pct"] > 0)
        if x["composable_pct"] == 0:
            x["pareto_optimal"] = False
    write_csv("pareto_mr_ge45_9-9.5pt.csv", pareto_rows)
    # Practical frontier: only policies that compose EVERY paragraph (≥99 %), excluding FULL family
    practical = [x for x in pareto_rows if x["composable_pct"] >= 99.0]
    for x in practical:
        x["pareto_optimal_practical"] = not any(dominates(y, x) for y in practical if y is not x)
    S["pareto_practical_composable_ge99"] = [{k: x[k] for k in ("policy", "aligned_lines_pct", "p95_applied_space",
                                                              "inword_per_100_lines", "mean_rag_frac_all_lines",
                                                              "p95_rag_frac_unjustified", "pareto_optimal_practical")}
                                            for x in practical]
    S["pareto_mr_ge45_9-9.5pt"] = pareto_rows

    # ---------------- failure cases (programmatic) -------------------------------------------
    fails = {}
    ref = [r for r in P if r["lang"] == "mr" and r["font"] == "NotoSerifDeva-w100" and r["size_pt"] == 9.5 and r["width_mm"] == 45.0]
    fails["FULL_DP_h2.00 overset paragraphs (NotoSerif w100, 9.5pt, 45mm)"] = sorted(r["text_id"] for r in ref if r["policy"] == "FULL_DP_h2.00" and r["status"] != "OK")
    worst = sorted((l for l in L if l["policy"] == "MEAS_DP_uncapped" and l["text_id"].startswith("mr") and l["kind"] == "justified"),
                   key=lambda l: -l["applied_sf"])[:5]
    fails["largest required spacing lines (MEAS, mr)"] = [{k: l[k] for k in ("text_id", "font", "size_pt", "width_mm", "a", "b", "n_words", "applied_sf")} for l in worst]
    hyb = sorted((l for l in L if l["policy"] == "HYBRID_DP_h2.00" and l["text_id"].startswith("mr") and l["kind"] == "ragged"),
                 key=lambda l: -l["slack_mm"] / l["width_mm"])[:5]
    fails["most ragged HYBRID fallback lines (mr)"] = [{k: l[k] for k in ("text_id", "font", "size_pt", "width_mm", "a", "b", "slack_mm")} for l in hyb]
    pm = [r for r in P if r["policy"] == "FULL_DP_h2.00_rules_publishedmin" and r["lang"] == "mr" and r["width_mm"] >= 45]
    tok = [r for r in P if r["policy"] == "MEAS_DP_uncapped" and r["lang"] == "mr" and r["width_mm"] >= 45]
    by_text = defaultdict(list)
    for r in tok:
        by_text[r["text_id"]].append(r["req_sf_max"])
    fails["max required spacing by text (MEAS, mr, ≥45mm) — top 5"] = sorted(
        ((k, round(max(v), 2)) for k, v in by_text.items()), key=lambda kv: -kv[1])[:5]
    fails["hyph-mr published minima: in-word breaks per paragraph (mr, ≥45mm)"] = round(st.mean(r["inword_breaks"] for r in pm), 2)
    S["failure_cases"] = fails

    # ---------------- performance: story & page (DP vs greedy) --------------------------------
    perf = {}
    paras = [t for t in C.load_corpus() if t["kind"] == "body" and t["lang"] == "mr"]
    prepared = [K.prepare(t["text"], "mr", "Deva", "Noto Serif Devanagari", 9.5, {"wdth": 100.0}) for t in paras]
    story, page = prepared[:6], (prepared * 5)[:90]
    for name in ("HYBRID_DP_h2.00", "HYBRID_DP_h2.00_rules", "FULL_DP_h2.00_rules_publishedmin", "HYBRID_GREEDY_h2.00", "RAGGED_DP"):
        pol = next(p for p in R.policies("Deva") if p.name == name)
        for label, set_ in (("story_6_paragraphs", story), ("page_90_paragraphs", page)):
            xs = []
            for _ in range(3):
                [K.compose(p, pol, 38.0) for p in set_]
            for _ in range(30):
                t0 = time.perf_counter(); [K.compose(p, pol, 38.0) for p in set_]; xs.append(time.perf_counter() - t0)
            perf[f"{name}|{label}"] = {"p50_ms": round(C.percentile(xs, .5) * 1000, 3), "p95_ms": round(C.percentile(xs, .95) * 1000, 3)}
    S["performance_compose_only_38mm"] = perf
    S["note"] = "Compose times exclude shaping and font load (reported separately in meta.json)."

    (A / "summary.json").write_text(json.dumps(S, indent=2, ensure_ascii=False, default=str) + "\n")
    print("ok", len(P), "rows")


if __name__ == "__main__":
    main()
