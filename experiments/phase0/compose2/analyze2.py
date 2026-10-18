"""EXP-COMPOSE-2 analysis (programmatic, no cherry-picking). Writes results/compose2/analysis/summary.json + CSVs."""
from __future__ import annotations

import csv
import gzip
import json
import math
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402

OUT = C.REPO / "experiments" / "phase0" / "results" / "compose2"
A = OUT / "analysis"
NUMS = {"size_pt", "width_mm", "lines", "nonfinal", "justified", "unjustified", "inword_breaks", "token_breaks",
        "emergency_breaks", "max_consecutive_inword", "min_fragment_clusters", "app_sf_median", "app_sf_p95", "app_sf_max",
        "req_gt_1_5", "req_gt_2_0", "req_gt_3_0", "max_unjustified_slack_frac", "mean_unjustified_slack_frac",
        "wpl_mean", "ref_ragged_lines", "compose_ms"}
CAND = ["C2_FULL_rules_h2.00", "C2_FULL_rules_h1.75", "C2_HYBRID_rules_h2.00", "C2_HYBRID_h2.00",
        "C2_CONSTRAINED_c2.00", "C2_RAGGED", "C2_RAGGED_rules", "REF_C1_HYBRID_DP_h2.00_rules"]


def load():
    with gzip.open(OUT / "paragraphs.csv.gz", "rt", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        for k in NUMS:
            try:
                r[k] = float(r[k])
            except (ValueError, TypeError):
                r[k] = float("nan")
    ref = {}
    for r in rows:
        if r["policy"] == "C2_RAGGED":
            ref[(r["text_id"], r["font"], r["size_pt"], r["width_mm"])] = r["lines"]
    for r in rows:   # every row gets its geometry's ragged reference (lesson from EXP-COMPOSE-1 denominator bug)
        r["ref_ragged_lines"] = ref[(r["text_id"], r["font"], r["size_pt"], r["width_mm"])]
    return rows


def eff_nf(r):
    return max(0.0, r["ref_ragged_lines"] - 1) if r["lines"] == 0 else r["nonfinal"]


def agg(rows):
    if not rows:
        return {}
    nf = sum(eff_nf(r) for r in rows)
    fr = [r["min_fragment_clusters"] for r in rows if not math.isnan(r["min_fragment_clusters"])]
    return {"cases": len(rows),
            "composable_pct": round(100 * sum(r["status"] == "OK" for r in rows) / len(rows), 2),
            "justified_lines_pct": round(100 * sum(r["justified"] for r in rows) / max(1, nf), 2),
            "unjustified_lines_pct": round(100 * sum(r["unjustified"] for r in rows) / max(1, nf), 2),
            "inword_per_100_lines": round(100 * sum(r["inword_breaks"] for r in rows) / max(1, sum(r["lines"] for r in rows)), 2),
            "token_breaks": int(sum(r["token_breaks"] for r in rows)),
            "emergency_breaks": int(sum(r["emergency_breaks"] for r in rows)),
            "min_fragment_clusters": min(fr) if fr else None,
            "max_consecutive_inword": int(max(r["max_consecutive_inword"] for r in rows)),
            "max_unjustified_slack_frac": round(max(r["max_unjustified_slack_frac"] for r in rows), 3),
            "mean_unjustified_slack_frac": round(st.mean(r["mean_unjustified_slack_frac"] for r in rows if r["unjustified"] > 0), 3) if any(r["unjustified"] > 0 for r in rows) else 0.0,
            "app_sf_p95_median_over_paras": round(st.median(r["app_sf_p95"] for r in rows if not math.isnan(r["app_sf_p95"])), 3) if any(not math.isnan(r["app_sf_p95"]) for r in rows) else None,
            "app_sf_max": round(max((r["app_sf_max"] for r in rows if not math.isnan(r["app_sf_max"])), default=float("nan")), 3),
            "compose_ms_median": round(st.median(r["compose_ms"] for r in rows), 3),
            "compose_ms_p95": round(C.percentile([r["compose_ms"] for r in rows], .95), 3)}


def meas_y(rows):
    nf = sum(r["nonfinal"] for r in rows)
    return round(100 * (1 - sum(r["req_gt_2_0"] for r in rows) / nf), 2) if nf else None


def write_csv(name, rows):
    keys = list(dict.fromkeys(k for r in rows for k in r))
    with open(A / name, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=keys); w.writeheader(); w.writerows(rows)


def main():
    A.mkdir(parents=True, exist_ok=True)
    rows = load()
    meta = json.loads((OUT / "meta.json").read_text())
    S = {"house_profile": meta["house_profile_source"], "house_profile_status": meta["house_profile_status"],
         "grid_widths_mm": meta["grid_widths_mm"], "corpus": meta["corpus"]}
    by = defaultdict(list)
    for r in rows:
        by[(r["policy"], r["width_mm"])].append(r)
    S["policy_by_width"] = {f"{p}|{w}": agg(v) for (p, w), v in sorted(by.items()) if p in CAND}
    write_csv("policy_by_width.csv", [{"policy": p, "width_mm": w, **agg(v)} for (p, w), v in sorted(by.items()) if p in CAND])
    # font table at each grid width
    fw = defaultdict(list)
    for r in rows:
        fw[(r["font"], r["width_mm"], r["policy"])].append(r)
    fonts = [f["label"] for f in meta["fonts"]]
    widths = meta["widths_mm"]
    ftab = []
    for f in fonts:
        ch = meta["font_characterisation"][f]
        for w in widths:
            meas = fw[(f, w, "C2_MEAS_uncapped")]; meas_r = fw[(f, w, "C2_MEAS_uncapped_rules")]
            ftab.append({"font": f, "category": ch["category"], "em_per_char": ch["em_per_char"],
                         "mean_advancing_glyph_em": ch["mean_advancing_glyph_em"], "width_mm": w,
                         "words_per_line": round(st.mean(r["wpl_mean"] for r in fw[(f, w, "C2_RAGGED")] if not math.isnan(r["wpl_mean"])), 2),
                         "lines_need_le_2x_pct": meas_y(meas), "lines_need_le_2x_pct_with_rules": meas_y(meas_r),
                         "FULL_rules_composable_pct": agg(fw[(f, w, "C2_FULL_rules_h2.00")])["composable_pct"],
                         "HYBRID_rules_justified_pct": agg(fw[(f, w, "C2_HYBRID_rules_h2.00")])["justified_lines_pct"],
                         "HYBRID_rules_composable_pct": agg(fw[(f, w, "C2_HYBRID_rules_h2.00")])["composable_pct"],
                         "CONSTRAINED_justified_pct": agg(fw[(f, w, "C2_CONSTRAINED_c2.00")])["justified_lines_pct"],
                         "RAGGED_composable_pct": agg(fw[(f, w, "C2_RAGGED")])["composable_pct"]})
    write_csv("fonts_by_width.csv", ftab)
    S["fonts_by_width"] = ftab
    # correlation: font width metric vs performance at 45 mm
    pts = [(x["em_per_char"], x["HYBRID_rules_justified_pct"]) for x in ftab if x["width_mm"] == 45.0]
    mx, my = st.mean(p[0] for p in pts), st.mean(p[1] for p in pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts); sxy = sum((p[0] - mx) * (p[1] - my) for p in pts); syy = sum((p[1] - my) ** 2 for p in pts)
    S["font_width_vs_hybrid_rules_at_45mm"] = {"slope_pp_per_0.01_em": round(sxy / sxx * 0.01, 2), "r2": round(sxy * sxy / (sxx * syy), 3), "n_fonts": len(pts)}
    # regression vs EXP-COMPOSE-1 reference
    ge45 = lambda p: [r for r in rows if r["policy"] == p and r["width_mm"] >= 45]  # noqa: E731
    S["regression_vs_compose1_ge45"] = {"C2_HYBRID_rules_h2.00": agg(ge45("C2_HYBRID_rules_h2.00")),
                                        "REF_C1_HYBRID_DP_h2.00_rules": agg(ge45("REF_C1_HYBRID_DP_h2.00_rules"))}
    url = [r for r in rows if r["text_id"] == "mr-body-13"]
    S["url_paragraph_mr-body-13"] = {p: agg([r for r in url if r["policy"] == p]) for p in ("C2_HYBRID_rules_h2.00", "REF_C1_HYBRID_DP_h2.00_rules", "C2_RAGGED")}
    # internal plausibility criterion (unchanged definition): ≥45 mm, spaces ≤2×, no Devanagari letter-spacing, ≥98 % lines justified
    pl = {}
    for p in ("C2_FULL_rules_h2.00", "C2_FULL_rules_h1.75", "C2_HYBRID_rules_h2.00", "C2_HYBRID_h2.00", "C2_CONSTRAINED_c2.00"):
        perf = {f: agg([r for r in rows if r["policy"] == p and r["font"] == f and r["width_mm"] >= 45])["justified_lines_pct"] for f in fonts}
        pl[p] = {"pooled_justified_pct": agg(ge45(p))["justified_lines_pct"], "composable_pct": agg(ge45(p))["composable_pct"],
                 "fonts_reaching_98": [f for f, v in perf.items() if v >= 98.0], "best_font": max(perf, key=perf.get), "best_value": max(perf.values()), "per_font": perf}
    S["internal_plausibility_ge45mm"] = pl
    # overset: where do caps make paragraphs unsettable?
    ov = defaultdict(int); tot = defaultdict(int)
    for r in rows:
        if r["policy"] in CAND:
            tot[(r["policy"], r["width_mm"])] += 1; ov[(r["policy"], r["width_mm"])] += r["status"] != "OK"
    S["overset_pct_by_policy_width"] = {f"{p}|{w}": round(100 * ov[(p, w)] / tot[(p, w)], 2) for (p, w) in sorted(tot)}
    S["performance_compose_ms"] = meta["compose_ms"]
    S["font_characterisation"] = meta["font_characterisation"]
    (A / "summary.json").write_text(json.dumps(S, indent=1, ensure_ascii=False, default=str) + "\n")
    print("ok", len(rows))


if __name__ == "__main__":
    main()
