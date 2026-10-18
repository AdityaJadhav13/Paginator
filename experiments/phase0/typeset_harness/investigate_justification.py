"""Investigate WHY oracle-v0 cannot justify newspaper paragraphs (the "0/240" finding).

EXPERIMENTAL / EVIDENCE TOOLING. Does NOT modify the oracle and does NOT implement a fix.
It reconfigures inputs (policy, measure, size, font, tracking, hypothetical break points) and
measures the effect; plus an INDEPENDENT feasibility check (own dynamic programme over the
oracle's node stream) to detect Knuth–Plass engine bugs.

Usage: tools/oracle/v0/.venv/bin/python experiments/phase0/typeset_harness/investigate_justification.py
Writes: experiments/phase0/results/justification/{env.json, paragraphs.csv, lines.csv, summary.json}
"""
from __future__ import annotations

import csv
import json
import random
import statistics as stats
from collections import Counter, defaultdict

import common as C
from common import Glue, Penalty

OUT = C.REPO / "experiments" / "phase0" / "results" / "justification"
INF_STRETCH = C.FINAL_GLUE_STRETCH

# The exact random-vocabulary method behind the original "0/240" (scratchpad bench, 2026-10-07).
EN_VOCAB = ("council approves sweeping budget after decade of debate the minister said committee members "
            "voted unanimously despite objections from residents who argued that infrastructure spending "
            "should prioritise").split()
MR_VOCAB = ("पुणे महानगरपालिकेच्या स्थायी समितीने शहरातील रस्ते दुरुस्ती आणि पाणीपुरवठा प्रकल्पांसाठी "
            "अतिरिक्त निधीला मंजुरी दिली असून मुख्यमंत्र्यांनी या निर्णयाचे स्वागत केले आहे नागरिकांनी "
            "मात्र प्रकल्पांच्या दर्जाबाबत प्रश्न उपस्थित केले स्थानिक नगरसेवकांनी पावसाळ्यापूर्वी काम "
            "पूर्ण करण्याची मागणी केली").split()


# ---------------------------------------------------------------------------- independent check
def independent_feasible(nodes, measure: float, tol: float) -> bool:
    """Own DP: can the node stream be cut into lines with -1 <= r <= tol on every non-final line?

    Uses the same line model as the oracle (glue at the break is discarded; penalty width is added
    at a penalty break; final line uses the terminal infinite glue). Written independently of
    oracle `_consider_break` so that disagreement indicates an engine bug.
    """
    n = len(nodes)
    legal = [i for i, nd in enumerate(nodes)
             if (isinstance(nd, Glue) and i > 0 and type(nodes[i - 1]).__name__ == "Box")
             or (isinstance(nd, Penalty) and not nd.is_forbidden)]
    W = [0.0] * (n + 1); S = [0.0] * (n + 1); K = [0.0] * (n + 1)
    for i, nd in enumerate(nodes):
        w = getattr(nd, "width_mm", 0.0)
        W[i + 1] = W[i] + w
        S[i + 1] = S[i] + (nd.stretch_mm if isinstance(nd, Glue) else 0.0)
        K[i + 1] = K[i] + (nd.shrink_mm if isinstance(nd, Glue) else 0.0)
    order = [-1] + legal
    feasible = {-1: True}
    for b in legal:
        ok = False
        for a in order:
            if a >= b or not feasible.get(a):
                continue
            s = a + 1
            width = W[b] - W[s] + (nodes[b].width_mm if isinstance(nodes[b], Penalty) else 0.0)
            st, sk = S[b] - S[s], K[b] - K[s]
            forced = isinstance(nodes[b], Penalty) and nodes[b].is_forced
            if forced:  # final line (terminal infinite glue lies inside [s, b))
                r_ok = width <= measure + sk + 1e-9
            elif width < measure:
                r_ok = st > 0 and (measure - width) / st <= tol + 1e-12
            else:
                r_ok = (width - measure) <= sk + 1e-9
            if r_ok:
                ok = True
                break
        feasible[b] = ok
    final = [i for i in legal if isinstance(nodes[i], Penalty) and nodes[i].is_forced]
    return bool(final) and feasible[final[-1]]


def max_box_width(nodes) -> float:
    return max((nd.width_mm for nd in nodes if type(nd).__name__ == "Box"), default=0.0)


# ---------------------------------------------------------------------------- one paragraph
def run_case(text, lang, family, size, width, policy, *, hyph=False, tracking=0.0, axes=None, tol_override=None):
    sh = C.shape_paragraph(text, lang, family, size, axes=axes, tracking=tracking)
    pol = dict(policy)
    if tol_override is not None:
        pol["tolerance"] = tol_override
    st = C.style(family, size, round(size * 1.18, 3), pol)
    hp = C.orthographic_break_points(text, sh.runs) if hyph else ()
    nodes = C.build_nodes(sh.runs, text, st, hyphen_points=hp)
    kp = C.break_knuth_plass(nodes, [width], st)
    return sh, st, nodes, kp


def required_wsmax(text, lang, family, size, width, wsmin=0.75, lo=1.0, hi=8.0):
    """Smallest word_space_max (tol=1) making the paragraph KP-feasible; inf if > hi."""
    pol = {"word_space_min": wsmin, "word_space_max": hi, "tolerance": 1.0}
    if run_case(text, lang, family, size, width, pol)[3] is None:
        return float("inf")
    for _ in range(18):
        mid = (lo + hi) / 2
        pol["word_space_max"] = mid
        if run_case(text, lang, family, size, width, pol)[3] is None:
            lo = mid
        else:
            hi = mid
    return hi


def primary_cause(text, lang, family, size, width, P0, P2, nodes0, kp0):
    if kp0 is not None:
        return "FEASIBLE"
    if max_box_width(nodes0) > width:
        return "NO_LEGAL_BREAK_WORD_WIDER_THAN_MEASURE"
    if run_case(text, lang, family, size, width, P2)[3] is not None:
        return "POLICY_LIMIT_SPACING_BOUNDS_TOO_STRICT"
    if run_case(text, lang, family, size, width, P0, hyph=True)[3] is not None:
        return "IN_WORD_BREAKS_NEEDED_AT_P0"
    if run_case(text, lang, family, size, width, P2, hyph=True)[3] is not None:
        return "IN_WORD_BREAKS_AND_LOOSER_SPACING_NEEDED"
    return "MEASURE_TOO_NARROW_FOR_JUSTIFICATION"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    conds = C.load_conditions()
    pols = conds["spacing_policies"]
    P0, P1, P2, P3 = (pols[k] for k in ("P0_oracle_default", "P1_desktop_default_like", "P2_loose", "P3_very_loose"))
    summary: dict = {}

    # J0 — reproduce the original synthetic result exactly
    j0 = Counter()
    for label, vocab, fam, lang in (("en", EN_VOCAB, "Source Serif 4", "en"), ("mr", MR_VOCAB, "Noto Serif Devanagari", "mr")):
        for w in (30.25, 45.0, 60.0):
            for i in range(40):
                r = random.Random(i)
                text = " ".join(r.choice(vocab) for _ in range(90))
                kp = run_case(text, lang, fam, 10.0, w, P0)[3]
                j0[(label, w, kp is not None)] += 1
    feas = sum(v for (l, w, ok), v in j0.items() if ok)
    summary["J0_reproduce_original"] = {"paragraphs": sum(j0.values()), "feasible": feas,
                                        "method": "random 90-word paragraphs from fixed vocab, seeds 0-39, 10pt, P0",
                                        "by_case": {f"{l}@{w}": v for (l, w, ok), v in j0.items() if not ok}}

    # Authored prose corpus (body paragraphs only)
    body = [t for t in C.load_corpus() if t["kind"] == "body"]
    fonts = {"Deva": [f["family"] for f in conds["body_fonts"]["Deva"]], "Latn": [f["family"] for f in conds["body_fonts"]["Latn"]]}
    widths, sizes = conds["column_widths_mm"], conds["body_sizes_pt"]

    prow, lrow = [], []
    agg = defaultdict(Counter)
    engine_bug = []
    for t in body:
        for fam in fonts[t["script"]]:
            for size in sizes:
                for w in widths:
                    sh, st, nodes, kp = run_case(t["text"], t["lang"], fam, size, w, P0)
                    indep = independent_feasible(nodes, w, P0["tolerance"])
                    if indep != (kp is not None):
                        engine_bug.append({"text": t["id"], "font": fam, "size": size, "width": w,
                                           "oracle_kp_feasible": kp is not None, "independent_dp_feasible": indep})
                    greedy = C.break_greedy(nodes, [w], st)
                    best = C.break_knuth_plass(nodes, [w], C.style(fam, size, round(size * 1.18, 3), P0 | {"tolerance": 1000.0}))
                    best_used = best if best is not None else greedy
                    gd = C.line_diagnostics(nodes, greedy.breakpoints, w, size)
                    bd = C.line_diagnostics(nodes, best_used.breakpoints, w, size)
                    nonlast_g = [d for d in gd if not d["last"]]
                    nonlast_b = [d for d in bd if not d["last"]]
                    cls_g = Counter(C.classify_line(d, P0) for d in nonlast_g)
                    cls_b = Counter(C.classify_line(d, P0) for d in nonlast_b)
                    cause = primary_cause(t["text"], t["lang"], fam, size, w, P0, P2, nodes, kp)
                    feas = {name: run_case(t["text"], t["lang"], fam, size, w, pol)[3] is not None
                            for name, pol in (("P1", P1), ("P2", P2), ("P3", P3))}
                    feas_h = {name: run_case(t["text"], t["lang"], fam, size, w, pol, hyph=True)[3] is not None
                              for name, pol in (("P0", P0), ("P1", P1))}
                    # tracking sensitivity (uniform per paragraph, Latin only — see doc for Devanagari caveat)
                    tr = {}
                    for trk in (-10.0, -5.0):
                        tr[f"track{int(trk)}"] = run_case(t["text"], t["lang"], fam, size, w, P0, tracking=trk)[3] is not None
                    req = required_wsmax(t["text"], t["lang"], fam, size, w)
                    hyph_lines_p1 = None
                    if feas_h["P1"]:
                        _, _, n_h, kp_h = run_case(t["text"], t["lang"], fam, size, w, P1, hyph=True)
                        hyph_lines_p1 = sum(b.is_hyphenated for b in kp_h.breakpoints) / max(1, len(kp_h.breakpoints) - 1)
                    row = {
                        "text_id": t["id"], "lang": t["lang"], "font": fam, "size_pt": size, "width_mm": w,
                        "words": len(t["text"].split()), "lines_greedy": len(gd),
                        "avg_words_per_line_greedy": round(sum(d["glues"] + 1 for d in nonlast_g) / max(1, len(nonlast_g)), 3) if nonlast_g else None,
                        "avg_chars_per_line_greedy": round(len(t["text"]) / max(1, len(gd)), 2),
                        "kp_feasible_P0": kp is not None, "independent_dp_feasible_P0": indep,
                        "kp_feasible_P1": feas["P1"], "kp_feasible_P2": feas["P2"], "kp_feasible_P3": feas["P3"],
                        "kp_feasible_P0_inword_upper_bound": feas_h["P0"], "kp_feasible_P1_inword_upper_bound": feas_h["P1"],
                        "inword_break_rate_P1": hyph_lines_p1,
                        "kp_feasible_P0_tracking_minus10": tr["track-10"], "kp_feasible_P0_tracking_minus5": tr["track-5"],
                        "required_word_space_max": req, "primary_cause_P0": cause,
                        "greedy_lines_violating_P0": sum(v for k, v in cls_g.items() if k != "OK"),
                        "best_effort_lines_violating_P0": sum(v for k, v in cls_b.items() if k != "OK"),
                        "nonlast_lines": len(nonlast_g),
                        "greedy_max_space_factor": max((d["space_factor"] for d in nonlast_g), default=None),
                        "best_effort_max_space_factor": max((d["space_factor"] for d in nonlast_b), default=None),
                    }
                    prow.append(row)
                    for algo, ds in (("greedy", nonlast_g), ("best_effort_kp", nonlast_b)):
                        for d in ds:
                            lrow.append({"text_id": t["id"], "lang": t["lang"], "font": fam, "size_pt": size, "width_mm": w,
                                         "algo": algo, "line": d["line"], "glues": d["glues"],
                                         "space_factor": round(d["space_factor"], 4) if d["space_factor"] not in (float("inf"), float("-inf")) else d["space_factor"],
                                         "class_P0": C.classify_line(d, P0)})
                    agg[(t["lang"], w)][cause] += 1

    def write_csv(name, rows):
        with (OUT / name).open("w", newline="", encoding="utf-8") as fh:
            wr = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            wr.writeheader(); wr.writerows(rows)
    write_csv("paragraphs.csv", prow)
    write_csv("lines.csv", lrow)

    def rate(key, rows):
        return round(sum(1 for r in rows if r[key]) / len(rows), 4) if rows else None

    by = defaultdict(list)
    for r in prow:
        by[(r["lang"], r["width_mm"])].append(r)
    table = {}
    for (lang, w), rows in sorted(by.items()):
        reqs = [r["required_word_space_max"] for r in rows]
        finite = [x for x in reqs if x != float("inf")]
        table[f"{lang}@{w}"] = {
            "cases": len(rows),
            "feasible_P0": rate("kp_feasible_P0", rows), "feasible_P1": rate("kp_feasible_P1", rows),
            "feasible_P2": rate("kp_feasible_P2", rows), "feasible_P3": rate("kp_feasible_P3", rows),
            "feasible_P0_inword_ub": rate("kp_feasible_P0_inword_upper_bound", rows),
            "feasible_P1_inword_ub": rate("kp_feasible_P1_inword_upper_bound", rows),
            "feasible_P0_track-5": rate("kp_feasible_P0_tracking_minus5", rows),
            "feasible_P0_track-10": rate("kp_feasible_P0_tracking_minus10", rows),
            "required_wsmax_median": round(stats.median(finite), 3) if finite else None,
            "required_wsmax_p90": round(C.percentile(finite, 0.9), 3) if finite else None,
            "required_wsmax_unreachable_le_8": len(reqs) - len(finite),
            "greedy_violating_line_share": round(sum(r["greedy_lines_violating_P0"] for r in rows) / max(1, sum(r["nonlast_lines"] for r in rows)), 4),
            "best_effort_violating_line_share": round(sum(r["best_effort_lines_violating_P0"] for r in rows) / max(1, sum(r["nonlast_lines"] for r in rows)), 4),
            "infeasible_paragraphs_with_le_2_bad_lines_best_effort": sum(1 for r in rows if not r["kp_feasible_P0"] and r["best_effort_lines_violating_P0"] <= 2),
            "infeasible_paragraphs": sum(1 for r in rows if not r["kp_feasible_P0"]),
            "primary_causes": dict(agg[(lang, w)]),
        }
    summary["J1_J7_authored_prose"] = table
    summary["J8_engine_bug_check"] = {"cases": len(prow), "disagreements": engine_bug,
                                      "method": "oracle break_knuth_plass feasibility vs independent DP over the same node stream"}
    # Binned by words per line (the explanatory variable found while debugging en-body-01)
    bins = defaultdict(list)
    for r in prow:
        wpl = r["avg_words_per_line_greedy"]
        if wpl is None:
            continue
        b = "<=3" if wpl <= 3 else ("3-4" if wpl <= 4 else ("4-5" if wpl <= 5 else ("5-6" if wpl <= 6 else ("6-7" if wpl <= 7 else ">7"))))
        bins[(r["lang"] if r["lang"] != "hi" else "mr+hi", b)].append(r)
        if r["lang"] == "mr":
            bins[("mr+hi", b)].append(r)
    summary["words_per_line_bins"] = {
        f"{lang}|{b}": {"cases": len(rows), "feasible_P0": rate("kp_feasible_P0", rows),
                        "feasible_P2": rate("kp_feasible_P2", rows),
                        "feasible_P0_inword_ub": rate("kp_feasible_P0_inword_upper_bound", rows),
                        "best_effort_violating_line_share": round(sum(r["best_effort_lines_violating_P0"] for r in rows) / max(1, sum(r["nonlast_lines"] for r in rows)), 4)}
        for (lang, b), rows in sorted(bins.items()) if lang in ("en", "mr+hi")}

    # J9 — set-width sensitivity (Noto Serif Devanagari wdth axis), Marathi body, 9 pt
    j9 = {}
    for wd in (100.0, 87.5, 75.0):
        for w in (38.0, 45.0, 52.0):
            rows = []
            for t in [x for x in body if x["lang"] == "mr"]:
                axes = {"wdth": wd}
                _, st9, n9, kp9 = run_case(t["text"], "mr", "Noto Serif Devanagari", 9.0, w, P0, axes=axes)
                kp9_p2 = run_case(t["text"], "mr", "Noto Serif Devanagari", 9.0, w, P2, axes=axes)[3]
                g9 = C.break_greedy(n9, [w], st9)
                b9 = C.break_knuth_plass(n9, [w], C.style("Noto Serif Devanagari", 9.0, 10.62, P0 | {"tolerance": 1000.0})) or g9
                d9 = [d for d in C.line_diagnostics(n9, b9.breakpoints, w, 9.0) if not d["last"]]
                gd9 = [d for d in C.line_diagnostics(n9, g9.breakpoints, w, 9.0) if not d["last"]]
                rows.append({"feas_P0": kp9 is not None, "feas_P2": kp9_p2 is not None,
                             "viol": sum(1 for d in d9 if C.classify_line(d, P0) != "OK"), "nl": len(d9),
                             "wpl": (sum(d["glues"] + 1 for d in gd9) / len(gd9)) if gd9 else None})
            j9[f"wdth{wd}@{w}mm"] = {
                "paragraphs": len(rows),
                "feasible_P0": round(sum(r["feas_P0"] for r in rows) / len(rows), 4),
                "feasible_P2": round(sum(r["feas_P2"] for r in rows) / len(rows), 4),
                "best_effort_violating_line_share": round(sum(r["viol"] for r in rows) / max(1, sum(r["nl"] for r in rows)), 4),
                "avg_words_per_line": round(stats.mean([r["wpl"] for r in rows if r["wpl"]]), 2)}
    summary["J9_set_width_sensitivity_mr_9pt_NotoSerifDeva"] = j9
    summary["J9_note"] = "opsz axis on Source Serif 4 had no measurable effect through oracle-v0 (OL-09); Latin set-width not swept."

    lclass = Counter((r["lang"], r["algo"], r["class_P0"]) for r in lrow)
    summary["line_class_counts"] = {f"{l}|{a}|{c}": v for (l, a, c), v in sorted(lclass.items())}
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    (OUT / "env.json").write_text(json.dumps(C.environment({"experiment": "justification-investigation/1",
                                                            "cases": len(prow)}), indent=2) + "\n")
    print(json.dumps({"J0": summary["J0_reproduce_original"]["feasible"], "cases": len(prow),
                      "engine_bug_disagreements": len(engine_bug)}))


if __name__ == "__main__":
    main()
