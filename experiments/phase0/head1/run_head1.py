"""EXP-HEAD-1 runner: Pageinator headline breaks vs the pilot's printed headlines (EXPERIMENTAL; private inputs).

Input: <dataset>/report/headlines.jsonl (published1/headlines.py: exact text + geometry of headline/deck frames).
Rows (eligible()): every Devanagari headline/deck/crosshead frame with ≥ 2 words whose text and geometry agree; a
test-edition row whose text also occurs in a calibration edition is dropped (it would not be held out).
  stand-in   Noto Sans Devanagari (wght 800 for the house extra-bold display face, 700 for the bold text face),
             size calibrated PER HEADLINE so its words take the printed total width
  measure    the column span (span_width_mm), or the printed longest line if that is wider
Policies (headliner rules fixed before the first evaluation):
  V1       HEAD_research_v1: hard keep-together rules + soft penalties from the sourced brief, shape "balance"
  FILL     the same rules, shape "fill" (the last line's slack is free); added after the first audit (report §5)
  V1_C7, FILL_C7  + data-derived rules counted ONLY on calibration headlines (editions before SPLIT_DATE; each distinct
           text once): word pairs seen ≥ 2 times and never split in print → STRONG glue; words seen ≥ 3 times before a
           space and never line-final → end penalty 0.12. Reported on the held-out test editions only.
Modes:  FIXED (same size, fewest lines — what Pageinator would do), FIXED_N (same size, printed line count — isolates the
        choice of breaks), GREEDY (first-fit, same keep-together rules), COPYFIT (largest size on a 0.25 pt grid anchored at
        the calibrated size, 0.6–1.4 ×, that fits in ≤ the printed line count).
Subsets: all (non-fits count as misses) | comparable (the printed layout fits in the stand-in and breaks none of our
        keep-together rules) | choice (comparable, multi-line in print, ≥ 2 feasible layouts at the printed line count:
        only here can a rule make a choice; chance = mean 1/#layouts).
Metrics: exact layout, line count, micro-averaged break precision/recall/F1 (multi-line print; a non-fit predicts no
breaks), RANK of the printed layout under the cost C (top-1/top-3/MRR, with the chance rate), balance (min/max line), fill
(max/measure), soft-rule hits, printed breaks that violate our HARD / STRONG keep-together rules, size ratio.
Shape comparison (choice subset): BALANCE vs FILL vs GREEDY, exact McNemar tests. Selection rule (stated before it was
run, after the first audit): the shape with the highest FIXED exact match on CALIBRATION choice headlines (V1 rules),
ties → fewer soft-rule hits; the test editions are reported whatever they show.
Outputs: aggregates → experiments/phase0/results/head1/summary.json; per-headline rows and the c7 word lists →
<dataset>/report/head1/ (private).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/head1/run_head1.py <dataset_dir>
"""
from __future__ import annotations

import dataclasses
import gzip
import hashlib
import json
import math
import statistics as st
import sys
from collections import Counter
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import headliner as H  # noqa: E402

K3 = H.K3
C = K3.C
MM = 72 / 25.4
OUT = C.REPO / "experiments" / "phase0" / "results" / "head1"
SPLIT_DATE = "2025-11-10"
FAMILY = "Noto Sans Devanagari"
SCHEMA = "pageinator.head1.summary/3"
MODES = ("FIXED", "FIXED_N", "GREEDY", "COPYFIT")


def standin(font: str) -> tuple[dict, int]:
    return ({"wght": 800.0}, 800) if ("Laxman" in font or "ExtraBold" in font or "Black" in font) else ({"wght": 700.0}, 700)


def per_pt_width(text: str, axes: dict, wt: int) -> float:
    p = K3.prepare(text, "mr", "Deva", FAMILY, 10.0, axes, wt)
    return sum(c.width for c in p.clusters if not c.is_space) * MM / 10.0


def norm_text(h: dict) -> str:
    """Single U+0020 between words (the printed word counts use any whitespace; the composer splits at U+0020 only)."""
    return " ".join(h["text"].split())


def is_deva(text: str) -> bool:
    """Marathi headlines only: at least half the letters are Devanagari (English-page headlines need another rule set)."""
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum("\u0900" <= c <= "\u097f" for c in letters) >= 0.5 * len(letters)


def kind(h: dict) -> str:
    """headline | deck (under a headline) | crosshead (bold line between paragraphs, reported by headlines.py as deck)."""
    if h["role"] == "headline":
        return "headline"
    return "crosshead" if "crosshead" in (h.get("role_reason") or "").lower() else "deck"


def split_of(h: dict) -> str:
    return "cal" if h["edition_date"] < SPLIT_DATE else "test"


def eligible(rows_in: list) -> list:
    """The evaluated rows (shared with proofs_head1.py so both use the same population and the same c7 rules)."""
    hs = [h for h in rows_in if h["role"] in ("headline", "deck") and h["checks"]["word_counts_match"] and not h["checks"]["mixed_fonts"]
          and not h["checks"]["unmapped"] and len(h["text"].split()) >= 2 and h.get("span_width_mm") and is_deva(h["text"])
          and sum(l["n_words"] for l in h["lines"]) == len(h["text"].split())]
    cal_texts = {norm_text(h) for h in hs if split_of(h) == "cal"}
    return [h for h in hs if split_of(h) == "cal" or norm_text(h) not in cal_texts]


def print_cuts(h: dict) -> tuple:
    out, acc = [], 0
    for ln in h["lines"]:
        acc += ln["n_words"]
        out.append(acc)
    return tuple(out)


def glued_index(text_glued: str) -> list:
    """For each glued token: the unglued word index where it ENDS (exclusive)."""
    ends, acc = [], 0
    for tok in text_glued.split(" "):
        acc += len(tok.split(H.NBSP))
        ends.append(acc)
    return ends


def to_unglued(text_glued: str, lines) -> tuple:
    ends = glued_index(text_glued)
    return tuple(ends[j - 1] for _, j in lines)


def to_glued(text_glued: str, cuts) -> list | None:
    """Printed cuts (unglued word indices) → glued-token layout; None if a printed break falls inside a glued token."""
    ends = glued_index(text_glued)
    pos = {e: k + 1 for k, e in enumerate(ends)}
    lay, start = [], 0
    for c in cuts:
        if c not in pos:
            return None
        lay.append((start, pos[c])); start = pos[c]
    return lay


def c7_rules(rows: list) -> tuple:
    """Deterministic counting on CALIBRATION headlines only (kind "headline"), each distinct text once."""
    pair_n, pair_split, word_n, word_end = Counter(), Counter(), Counter(), Counter()
    seen = set()
    for h in rows:
        text = norm_text(h)
        if split_of(h) != "cal" or kind(h) != "headline" or text in seen:
            continue
        seen.add(text)
        words = text.split(" ")
        cuts = set(print_cuts(h)[:-1])
        for k in range(len(words) - 1):
            pair = (words[k], words[k + 1])
            pair_n[pair] += 1
            word_n[words[k]] += 1
            if k + 1 in cuts:
                pair_split[pair] += 1
                word_end[words[k]] += 1
    glue_pairs = frozenset(p for p, n in pair_n.items() if n >= 2 and pair_split[p] == 0)
    end_pen = tuple(sorted((w, 0.12) for w, n in word_n.items() if n >= 3 and word_end[w] == 0))
    return glue_pairs, end_pen


def policies(rows: list) -> dict:
    gp, ep = c7_rules(rows)
    v1 = H.HeadPolicy()
    return {"V1": v1,
            "FILL": replace(v1, name="HEAD_research_v1_fill", shape="fill"),
            "V1_C7": replace(v1, name="HEAD_research_v1_c7", extra_glue_pairs=gp, word_end_pen=ep),
            "FILL_C7": replace(v1, name="HEAD_research_v1_fill_c7", shape="fill", extra_glue_pairs=gp, word_end_pen=ep)}


def c7_hash(pol: H.HeadPolicy) -> str:
    blob = json.dumps([sorted(pol.extra_glue_pairs), list(pol.word_end_pen)], ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def evaluate(h: dict, pol: H.HeadPolicy) -> dict:
    axes, wt = standin(h["font"])
    text = norm_text(h)
    size = sum(l["words_width_pt"] for l in h["lines"]) / per_pt_width(text, axes, wt)
    measure = max(h["span_width_mm"], max(l["width_mm"] for l in h["lines"]))
    pr = print_cuts(h)
    pw = [l["width_mm"] for l in h["lines"]]
    out = {"size_standin": round(size, 3), "measure_mm": round(measure, 2), "print_cuts": list(pr),
           "print": {"lines": len(pr), "balance": round(min(pw) / max(pw), 4) if len(pw) > 1 else 1.0, "fill": round(max(pw) / measure, 4)}}
    tg = H.glue(text, pol.extra_glue_pairs) if pol.glue else text
    p = K3.prepare(tg, "mr", "Deva", FAMILY, size, axes, wt)
    widths, spaces, texts = H._words(p)
    out["token_mismatch"] = len(widths) != len(tg.split(" "))      # the shaper merged a space into a cluster
    if out["token_mismatch"]:
        return out
    # the printed layout under OUR rules: keep-together violations, fit in the stand-in, rank among feasible layouts
    out["print_hard_violation"] = to_glued(H.glue(text, pol.extra_glue_pairs, strong=False) if pol.glue else text, pr) is None
    lay = to_glued(tg, pr)
    out["print_strong_violation"] = lay is None and not out["print_hard_violation"]
    out.update({"print_fits_standin": False, "print_overflow_mm": None, "print_soft_hits": None, "n_layouts": None, "print_rank": None})
    if lay is not None:
        ws = [H._line_width(widths, spaces, i, j) for i, j in lay]
        out["print_overflow_mm"] = round(max(ws) - measure, 3)
        out["print_fits_standin"] = max(ws) <= measure + 1e-6
        out["print_soft_hits"] = H.line_penalties(texts, widths, lay, measure, pol)[1]
        ranked = H.ranked_layouts(widths, spaces, texts, measure, pol, len(pr))
        out["n_layouts"] = len(ranked)
        cuts_list = [[j for _, j in x[1]] for x in ranked]
        target = [j for _, j in lay]
        out["print_rank"] = cuts_list.index(target) + 1 if target in cuts_list else None
    for mode in MODES:
        if mode == "COPYFIT":
            r = H.copyfit(text, FAMILY, axes, wt, measure, 0.6 * size, 1.4 * size, len(pr), 0.25, pol, anchor=size)
        else:
            r = H.compose(text, FAMILY, axes, wt, size, measure, replace(pol, balance=(mode != "GREEDY")),
                          n_lines=len(pr) if mode == "FIXED_N" else None)
        if r is None or not r.fits or not r.lines:
            out[mode] = {"fits": False}
            continue
        cu = to_unglued(r.text_glued, r.lines)
        ours, ref = set(cu[:-1]), set(pr[:-1])
        out[mode] = {"fits": True, "lines": len(r.lines), "same_lines": len(r.lines) == len(pr), "same_breaks": cu == pr, "cuts": list(cu),
                     "tp": len(ours & ref), "n_pred": len(ours), "n_ref": len(ref), "relaxed": r.relaxed, "broken_strong": r.broken_strong,
                     "balance": round(min(r.widths_mm) / max(r.widths_mm), 4) if len(r.lines) > 1 else 1.0,
                     "fill": round(max(r.widths_mm) / measure, 4), "soft_hits": r.hits, "size_ratio": round(r.size_pt / size, 3)}
    return out


def subset(R: list, key: str, which: str) -> list:
    R = [r for r in R if not r[key]["token_mismatch"]]
    if which == "all":
        return R
    comp = [r for r in R if r[key]["print_fits_standin"]]
    if which == "comparable":
        return comp
    return [r for r in comp if r[key]["print"]["lines"] > 1 and r[key]["n_layouts"] >= 2]


def _pct(a, n):
    return round(100 * a / n, 1) if n else None


def _mean(xs):
    xs = list(xs)
    return round(st.mean(xs), 3) if xs else None


def _median(xs):
    xs = list(xs)
    return round(st.median(xs), 3) if xs else None


def agg(R: list, key: str) -> dict:
    X = [r[key] for r in R]
    multi = [x for x in X if x["print"]["lines"] > 1]
    ranked = [x for x in X if x["print_rank"]]
    res = {"n": len(X), "multi_line_in_print": len(multi),
           "print": {"hard_rule_violations": sum(x["print_hard_violation"] for x in X),
                     "strong_rule_violations": sum(x["print_strong_violation"] for x in X),
                     "overflow_in_standin": sum(1 for x in X if x["print_overflow_mm"] is not None and not x["print_fits_standin"]),
                     "ranked": len(ranked),
                     "single_layout_pct": _pct(sum(x["n_layouts"] == 1 for x in ranked), len(ranked)),
                     "rank_top1_pct": _pct(sum(x["print_rank"] == 1 for x in ranked), len(ranked)),
                     "chance_top1_pct": _pct(sum(1 / x["n_layouts"] for x in ranked), len(ranked)),
                     "rank_top3_pct": _pct(sum(x["print_rank"] <= 3 for x in ranked), len(ranked)),
                     "mrr": _mean(1 / x["print_rank"] for x in ranked),
                     "soft_hits_per_headline": _mean(x["print_soft_hits"] for x in X if x["print_soft_hits"] is not None),
                     "balance_median_multi": _median(x["print"]["balance"] for x in multi)}}
    for mode in MODES:
        M, Mm = [x[mode] for x in X], [x[mode] for x in multi]
        tp, npred = sum(m.get("tp", 0) for m in Mm), sum(m.get("n_pred", 0) for m in Mm)
        nref = sum(x["print"]["lines"] - 1 for x in multi)                       # a non-fit predicts no breaks
        P = tp / npred if npred else None
        Rc = tp / nref if nref else None
        res[mode] = {"fits_pct": _pct(sum(m["fits"] for m in M), len(M)),
                     "exact_layout_pct": _pct(sum(m.get("same_breaks", False) for m in M), len(M)),
                     "exact_layout_multi_pct": _pct(sum(m.get("same_breaks", False) for m in Mm), len(Mm)),
                     "same_lines_pct": _pct(sum(m.get("same_lines", False) for m in M), len(M)),
                     "break_precision_multi": round(P, 3) if P is not None else None,
                     "break_recall_multi": round(Rc, 3) if Rc is not None else None,
                     "break_f1_multi": (round(2 * P * Rc / (P + Rc), 3) if P + Rc > 0 else 0.0) if P is not None and Rc is not None else None,
                     "no_breaks_predicted_multi": sum(1 for m in Mm if m["fits"] and m["n_pred"] == 0),
                     "relaxed": sum(bool(m.get("relaxed")) for m in M),
                     "broken_strong_weight": sum(m.get("broken_strong", 0) for m in M),
                     "balance_median_multi": _median(m["balance"] for m in M if m["fits"] and m["lines"] > 1),
                     "soft_hits_per_headline": _mean(m["soft_hits"] for m in M if m["fits"])}
        if mode == "COPYFIT":
            res[mode]["size_ratio_median"] = _median(m["size_ratio"] for m in M if m["fits"])
    return res


def mcnemar(a: int, b: int) -> float:
    """Exact two-sided McNemar (binomial) p-value for a / b discordant pairs."""
    n = a + b
    return 1.0 if n == 0 else round(min(1.0, 2 * sum(math.comb(n, i) for i in range(min(a, b) + 1)) / 2 ** n), 4)


def shape_comparison(rows: list, bal: str, fill: str, split: str) -> dict:
    R = [r for r in rows if r["role"] == "headline" and (split == "all" or r["split"] == split)]
    S = subset(R, bal, "choice")
    assert {r["id"] for r in S} == {r["id"] for r in subset(R, fill, "choice")}, "shapes must share the choice subset"
    arms = {"BALANCE": (bal, "FIXED"), "BALANCE_N": (bal, "FIXED_N"), "FILL": (fill, "FIXED"), "FILL_N": (fill, "FIXED_N"),
            "GREEDY": (bal, "GREEDY")}
    hit = {a: [r[k][m].get("same_breaks", False) for r in S] for a, (k, m) in arms.items()}
    out = {"n": len(S), "chance_pct": _pct(sum(1 / r[bal]["n_layouts"] for r in S), len(S)),
           "exact_pct": {a: _pct(sum(v), len(v)) for a, v in hit.items()},
           "soft_hits": {a: _mean(r[k][m]["soft_hits"] for r in S if r[k][m]["fits"]) for a, (k, m) in arms.items()},
           "print_soft_hits": _mean(r[bal]["print_soft_hits"] for r in S), "mcnemar": {}}
    for a, b in (("FILL", "BALANCE"), ("GREEDY", "BALANCE"), ("FILL", "GREEDY")):
        oa = sum(x and not y for x, y in zip(hit[a], hit[b]))
        ob = sum(y and not x for x, y in zip(hit[a], hit[b]))
        out["mcnemar"][f"{a}_vs_{b}"] = {f"only_{a}": oa, f"only_{b}": ob, "p": mcnemar(oa, ob)}
    return out


def main():
    ds = Path(sys.argv[1]).expanduser()
    priv = ds / "report" / "head1"; priv.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    rows_in = [json.loads(l) for l in open(ds / "report" / "headlines.jsonl", encoding="utf-8")]
    hs = eligible(rows_in)
    pols = policies(hs)
    rows = []
    for h in hs:
        rows.append({"id": h["id"], "role": kind(h), "split": split_of(h), "font": h["font"], "span_cols": h.get("span_cols"),
                     "alignment": h.get("alignment"), **{k: evaluate(h, pol) for k, pol in pols.items()}})
    c7 = pols["V1_C7"]
    texts = Counter((split_of(h), norm_text(h)) for h in hs)
    summary = {"schema": SCHEMA, "headliner": H.HEADLINER_VERSION, "standin": FAMILY, "split_date": SPLIT_DATE,
               "headlines_in": len(rows_in), "evaluated": len(rows),
               "evaluated_by_role_split": dict(sorted(Counter(f"{r['role']}|{r['split']}" for r in rows).items())),
               "duplicate_texts_within_split": sum(n - 1 for n in texts.values() if n > 1),
               "token_mismatch": {k: sum(r[k]["token_mismatch"] for r in rows) for k in pols},
               "c7": {"glue_pairs": len(c7.extra_glue_pairs), "end_penalty_words": len(c7.word_end_pen), "hash": c7_hash(c7),
                      "counted_on": "calibration headlines, each distinct text once"},
               "policies": {k: {"name": p.name, "shape": p.shape, "c7": bool(p.extra_glue_pairs)} for k, p in pols.items()},
               "weights": dataclasses.asdict(H.Weights()),
               "subsets": {"all": "every row; non-fits count as misses",
                           "comparable": "the printed layout fits in the stand-in and breaks none of our keep-together rules",
                           "choice": "comparable, multi-line in print, >= 2 feasible layouts at the printed line count"}}
    for key in pols:
        for role in ("headline", "deck", "crosshead"):
            for split in (("cal", "test", "all") if key in ("V1", "FILL") else ("test",)):
                R = [r for r in rows if r["role"] == role and (split == "all" or r["split"] == split)]
                for which in ("all", "comparable", "choice"):
                    S = subset(R, key, which)
                    if S:
                        summary[f"{key}|{role}|{split}|{which}"] = agg(S, key)
    cal = shape_comparison(rows, "V1", "FILL", "cal")
    arms = ("BALANCE", "FILL", "GREEDY")
    chosen = max(arms, key=lambda a: (cal["exact_pct"][a] or 0.0, -(cal["soft_hits"][a] or 0.0)))
    summary["shape_selection"] = {"rule": "highest FIXED exact match on calibration choice headlines (V1 rules); ties -> fewer soft-rule hits",
                                  "calibration": cal, "chosen": chosen,
                                  "test_V1_rules": shape_comparison(rows, "V1", "FILL", "test"),
                                  "test_C7_rules": shape_comparison(rows, "V1_C7", "FILL_C7", "test"),
                                  "all_V1_rules": shape_comparison(rows, "V1", "FILL", "all")}
    al = {}
    for which in ("comparable", "choice"):
        S = subset([r for r in rows if r["role"] == "headline"], "V1", which)
        for a in sorted({r["alignment"] or "unknown" for r in S}):
            A = [r for r in S if (r["alignment"] or "unknown") == a and r["V1"]["print"]["lines"] > 1]
            if A:
                al[f"{which}|{a}"] = {"n_multi": len(A), **{f"{arm}_exact_pct": _pct(sum(r[k][m].get("same_breaks", False) for r in A), len(A))
                                                            for arm, k, m in (("BALANCE", "V1", "FIXED"), ("FILL", "FILL", "FIXED"),
                                                                              ("GREEDY", "V1", "GREEDY"))}}
    summary["alignment_headline_multi_V1_rules"] = al
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")
    with gzip.open(priv / "head1_rows.json.gz", "wt", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)
    (priv / "c7_rules.json").write_text(json.dumps({"hash": c7_hash(c7), "glue_pairs": sorted(c7.extra_glue_pairs),
                                                     "end_penalty_words": list(c7.word_end_pen)}, ensure_ascii=False, indent=1) + "\n")
    for f in ("head1_rows.json.gz", "c7_rules.json"):
        (priv / f).chmod(0o600)
    print("evaluated", len(rows), dict(summary["evaluated_by_role_split"]), "| c7", summary["c7"], "| token mismatch", summary["token_mismatch"])
    for k in ("V1|headline|all|all", "V1|headline|all|comparable", "V1|headline|all|choice", "V1_C7|headline|test|choice",
              "V1|deck|all|all", "V1|crosshead|all|comparable"):
        if k in summary:
            s = summary[k]
            print(k, "n", s["n"], "multi", s["multi_line_in_print"], "| print", {x: s["print"][x] for x in ("hard_rule_violations", "strong_rule_violations", "overflow_in_standin", "rank_top1_pct", "chance_top1_pct", "single_layout_pct", "soft_hits_per_headline")},
                  "|", {m: (s[m]["exact_layout_multi_pct"], s[m]["same_lines_pct"], s[m]["break_f1_multi"], s[m]["soft_hits_per_headline"]) for m in MODES})
    print("shape selection:", json.dumps(summary["shape_selection"], ensure_ascii=False))


if __name__ == "__main__":
    main()
