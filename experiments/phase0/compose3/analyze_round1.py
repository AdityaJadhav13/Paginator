"""Analyse a blind review round (EXPERIMENTAL). Standard library only.

Reads <round_dir>/score_template.csv (filled: one row per rater per item) and KEY_SEALED.json, maps LEFT/RIGHT (body
round) or TOP/BOTTOM (headline round; key "layout": "TB") to A (the paper's published line breaks) and B (Pageinator), and reports — following G1_ACCEPTANCE_PACKAGE.md §7.4–7.5:
  preference (B / A / same), score means (body: spacing; headlines: headline quality) and the paired difference B − A,
  "OK to print" rates for A and B, inter-rater agreement on "OK to print" for B (percent agreement and Cohen's κ per
  rater pair), and consistency on the repeated items (does the rater prefer the same underlying version when sides are
  swapped?). When the key gives each item a Pageinator "variant" (e.g. BAL / FILL / "BAL=FILL"), results are also
  reported per variant ("BAL=FILL" items count for both).
Repeated items are used only for consistency. Every answer is validated: an unreadable value or a duplicate
(rater, item) row stops the analysis with the row number. Writes <round_dir>/analysis.json (private).
When the key has a run_id, every answer row must carry exactly that run (other runs and blank runs are rejected; older keys
without a run_id are not checked).
Usage: python3 experiments/phase0/compose3/analyze_round1.py <round_dir>
"""
from __future__ import annotations

import csv
import itertools
import json
import statistics as st
import sys
from collections import Counter, defaultdict
from pathlib import Path


def norm(v: str) -> str:
    return (v or "").strip().lower()


def kappa(a: list[str], b: list[str]) -> float | None:
    n = len(a)
    if n == 0:
        return None
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(a) | set(b)) / (n * n)
    return round((po - pe) / (1 - pe), 3) if pe < 1 else None


def main():
    d = Path(sys.argv[1]).expanduser()
    key = json.loads((d / "KEY_SEALED.json").read_text())
    items = {it["item"]: it for it in key["items"]}
    rows = [r for r in csv.DictReader(open(d / "score_template.csv", encoding="utf-8-sig")) if r.get("rater", "").strip()]   # -sig: Excel's BOM
    # column layout: body round = LEFT/RIGHT ("L"/"R"); headline round = TOP/BOTTOM ("T"/"B"), declared in the key
    tb = key.get("layout") == "TB"
    first, second = ("T", "B") if tb else ("L", "R")
    score = "quality" if tb else "spacing"
    cols = ({"better": "better(T/B/same)", "s1": "quality_top(1-5)", "s2": "quality_bottom(1-5)", "ok1": "ok_top(Y/fix/N)", "ok2": "ok_bottom(Y/fix/N)"}
            if tb else
            {"better": "better(L/R/same)", "s1": "spacing_left(1-5)", "s2": "spacing_right(1-5)", "ok1": "ok_left(Y/fix/N)", "ok2": "ok_right(Y/fix/N)"})
    if not rows:
        sys.exit("score_template.csv has no filled rows (fill the 'rater' column)")
    errors = []

    def check(rowno, field, value, allowed):
        if value not in allowed:
            errors.append(f"row {rowno}: {field} = {value!r} (expected one of {sorted(allowed)})")
        return value

    def num(rowno, field, v):
        v = (v or "").strip()
        if v == "":
            return None
        if v not in {"1", "2", "3", "4", "5"}:
            errors.append(f"row {rowno}: {field} = {v!r} (expected 1–5 or blank)")
            return None
        return float(v)

    per = defaultdict(dict)
    f1, f2 = first.lower(), second.lower()
    for rowno, r in enumerate(rows, 2):
        rater = r["rater"].strip()
        if key.get("run_id") and (r.get("run") or "").strip() != key["run_id"]:     # keys with a run id: every row must carry it
            errors.append(f"row {rowno}: run {(r.get('run') or '').strip()!r} is not this key's run {key['run_id']!r} (answers from another set of sheets, or the run column was lost)")
            continue
        try:
            it = items[int(r["item"])]
        except (KeyError, ValueError):
            errors.append(f"row {rowno}: item {r.get('item')!r} is not in the key")
            continue
        if it["item"] in per[rater]:
            errors.append(f"row {rowno}: duplicate answer for rater {rater!r}, item {it['item']}")
            continue
        better = check(rowno, cols["better"], norm(r[cols["better"]]), {f1, f2, "same", "s", ""})
        okL = check(rowno, cols["ok1"], norm(r[cols["ok1"]]), {"y", "fix", "n", ""})
        okR = check(rowno, cols["ok2"], norm(r[cols["ok2"]]), {"y", "fix", "n", ""})
        sL, sR = num(rowno, cols["s1"], r[cols["s1"]]), num(rowno, cols["s2"], r[cols["s2"]])
        bL = it["pageinator_side"] == first
        pref = None if better == "" else "same" if better in ("same", "s") else ("B" if (better == f1) == bL else "A")
        per[rater][it["item"]] = {"pref": pref, "score_B": sL if bL else sR, "score_A": sR if bL else sL,
                                  "ok_B": okL if bL else okR, "ok_A": okR if bL else okL, "repeat_of": it["repeat_of"],
                                  "variant": it.get("variant"), "same_as_print": it.get("same_as_print") or []}
    if errors:
        sys.exit("score_template.csv has problems — fix them and re-run:\n  " + "\n  ".join(errors))
    out = {"round": "headlines" if tb else "body", "raters": sorted(per), "per_rater": {}, "pooled": {}}
    pooled = []
    for rater, res in per.items():
        main_items = {i: v for i, v in res.items() if v["repeat_of"] is None}
        pooled += main_items.values()
        rep = [(v, res.get(v["repeat_of"])) for v in res.values() if v["repeat_of"] is not None and res.get(v["repeat_of"])]
        out["per_rater"][rater] = {"items": len(main_items),
                                   "consistency_on_repeats": f'{sum(a["pref"] == b["pref"] for a, b in rep)}/{len(rep)}'}

    def summ(vals):
        prefs = Counter(v["pref"] for v in vals if v["pref"])
        pairs = [(v["score_B"], v["score_A"]) for v in vals if v["score_B"] is not None and v["score_A"] is not None]
        okB = [v["ok_B"] for v in vals if v["ok_B"]]; okA = [v["ok_A"] for v in vals if v["ok_A"]]
        return {"ratings": len(vals), "prefer_B": prefs.get("B", 0), "prefer_A": prefs.get("A", 0), "same": prefs.get("same", 0),
                f"{score}_mean_B": round(st.mean(b for b, _ in pairs), 2) if pairs else None,
                f"{score}_mean_A": round(st.mean(a for _, a in pairs), 2) if pairs else None,
                f"{score}_diff_B_minus_A": round(st.mean(b - a for b, a in pairs), 2) if pairs else None,
                "ok_to_print_B_pct": round(100 * sum(x == "y" for x in okB) / len(okB), 1) if okB else None,
                "ok_or_fix_B_pct": round(100 * sum(x in ("y", "fix") for x in okB) / len(okB), 1) if okB else None,
                "ok_to_print_A_pct": round(100 * sum(x == "y" for x in okA) / len(okA), 1) if okA else None}
    out["pooled"] = summ(pooled)
    variants = sorted({v["variant"] for v in pooled if v["variant"]})
    if variants:
        base = sorted({x for v in variants for x in v.split("=")})
        out["per_variant"] = {b: summ([v for v in pooled if v["variant"] and b in v["variant"].split("=")]) for b in base}
        # head-to-head between the two shapes: on items where one shape differs from print and the OTHER shape equals
        # print, preferring B means preferring that shape and preferring A (print) means preferring the other shape
        other = {"BAL": "FILL", "FILL": "BAL"}
        h2h = Counter()
        for v in pooled:
            if v["variant"] in other and other[v["variant"]] in v["same_as_print"] and v["pref"]:
                h2h[v["variant"] if v["pref"] == "B" else other[v["variant"]] if v["pref"] == "A" else "same"] += 1
        if h2h:
            out["shape_head_to_head"] = {"ratings": sum(h2h.values()), "prefer_BAL": h2h["BAL"], "prefer_FILL": h2h["FILL"], "same": h2h["same"]}
    for rater, res in per.items():
        out["per_rater"][rater].update(summ([v for v in res.values() if v["repeat_of"] is None]))
    agree = {}
    for r1, r2 in itertools.combinations(sorted(per), 2):
        common = sorted(i for i in per[r1] if i in per[r2] and per[r1][i]["repeat_of"] is None and per[r1][i]["ok_B"] and per[r2][i]["ok_B"])
        a = [per[r1][i]["ok_B"] for i in common]; b = [per[r2][i]["ok_B"] for i in common]
        agree[f"{r1} × {r2}"] = {"items": len(common), "percent_agreement": round(100 * sum(x == y for x, y in zip(a, b)) / max(1, len(common)), 1),
                                 "cohens_kappa": kappa(a, b)}
    out["agreement_ok_to_print_B"] = agree
    out["reading_rules"] = (["G1 §7.5: if κ < 0.4 the round is not valid (recalibrate raters).",
                             "G1 B1 (headlines): ≥ 90% of Pageinator's headlines 'OK to print' (or fixes that are only editorial) from both sub-editors.",
                             "Headline quality B − A is reported for information (G1 B3 covers the body criteria R1, R2, R6, R7).",
                             "This round shows only headlines where Pageinator differs from print; per-variant results choose the shape.",
                             "A round-1 result is calibration evidence only; G1 needs 200 paragraphs + 30 headlines."] if tb else
                            ["G1 §7.5: if κ < 0.4 the round is not valid (recalibrate raters).",
                             "G1 B3: Pageinator is acceptable if the spacing difference B − A is not worse than −0.5.",
                             "A round-1 result is calibration evidence only; G1 needs 200 paragraphs + 30 headlines."])
    (d / "analysis.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    (d / "analysis.json").chmod(0o600)
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
