"""EXP-COMPOSE-3 runner: house-calibrated word spacing on the pilot's OWN published paragraphs (EXPERIMENTAL).

Stage A  baseline: oracle file hashes; a 1-in-50 sample of compose2 signatures reproduced by composer3 in LEGACY mode
         (proves the copy is faithful). STOPS on any mismatch.
Stage B  same text, same measure: every verified complete paragraph from published1/paragraphs.py is re-set with an
         OFL stand-in (Noto Serif Devanagari, wdth 87.5) whose size is calibrated PER PARAGRAPH so the same words
         take the same total width as in print; same measure, same first-line indent (NBSPs), no word breaks.
         All spacing parameters are stated in HOUSE units (the published font's normal space, EXACT from the PDF)
         and converted per paragraph; all metrics are reported in house units.
Stage C  candidates: asym model × floor {0.80, 0.75, 0.70, 0.66} × stretch scale {0.33, 0.50, 1.00} (shrink scale 0.20),
         plus the compose2 "same rules" illustration policy as reference.
Stage D  SELECTION RULE (fixed before any result was seen; applied to the CALIBRATION editions only):
           eligible = squeezes no more often than print (share of non-final justified lines < 0.8× and < 0.7×, each
                      ≤ print's share on the same paragraphs) AND paragraph depth within ±max(1, n/20) lines of print
                      for ≥ 90% of paragraphs;
           choose   = eligible candidate with the fewest loose lines (widest gap > 2×), then > 3×, then the higher floor.
         The chosen candidate is then reported on the held-out TEST editions. Every candidate is reported.
Outputs: aggregates (no text, no ids) → experiments/phase0/results/compose3/;
         per-paragraph rows + signatures → <dataset>/report/compose3/ (private).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose3/run_compose3.py <dataset_dir>
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import math
import statistics as st
import sys
import time
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
for sub in ("compose2", "typeset_harness", "compose1"):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(HERE))
import fontreg  # noqa: E402  (compose2 font registry: oracle OFL + compose2/fonts)

fontreg.install()
import common as C  # noqa: E402
import composer3 as K3  # noqa: E402

FAM, AXES, WT, LABEL = "Noto Serif Devanagari", {"wdth": 87.5}, 400, "NotoSerifDeva-w87.5"
MM = 72 / 25.4
NBSP = " "
SPLIT_DATE = "2025-11-10"          # calibration: editions before this date; test: this date and after
OUT = C.REPO / "experiments" / "phase0" / "results" / "compose3"
FLOORS = (0.80, 0.75, 0.70, 0.66)
STRETCH = (0.33, 0.50, 1.00)
SHRINK = 0.20


def candidates():
    """name → (kind, params). Parameters in HOUSE units except the compose2 reference (its own units, as illustrated)."""
    c = {"REF_C2_same_rules": ("legacy", {})}
    for f in FLOORS:
        for s in STRETCH:
            c[f"C3_floor{f:.2f}_stretch{s:.2f}"] = ("asym", {"floor": f, "stretch": s, "shrink": SHRINK})
    return c


def policy_for(name: str, kind: str, prm: dict, k: float, inword: str = "none") -> K3.Policy:
    common = dict(token_breaks=True, max_consecutive_inword=2, fallback_max_slack=None)
    if kind == "legacy":
        return K3.Policy(name, "HYBRID", ws_max_hard=50.0, inword=inword,
                         weights=K3.Weights(soft_space=100.0 * (50 - 1.33) ** 2, hybrid_fallback=1e6), **common)
    return K3.Policy(name, "HYBRID", ws_min_hard=prm["floor"] * k, ws_max_hard=50.0 * k, inword=inword,
                     inword_min=(2, 2) if inword == "rules" else None, space_model="asym", ws_desired=1.0 * k,
                     shrink_scale=prm["shrink"] * k, stretch_scale=prm["stretch"] * k,
                     weights=K3.Weights(soft_space=100.0, hybrid_fallback=1e6), **common)


# ------------------------------------------------------------------------------------------- Stage A
def stage_a() -> dict:
    import hashlib as _h
    m = json.loads((C.ORACLE / "ORACLE_MANIFEST.json").read_text())
    bad = [f["path"] for f in m["files"] if _h.sha256((C.ORACLE / f["path"]).read_bytes()).hexdigest() != f["sha256"]]
    import run_compose2 as R2  # noqa: PLC0415
    sigs = json.loads((C.REPO / "experiments/phase0/results/compose2/signatures.json").read_text())
    texts = {t["id"]: t for t in C.load_corpus()}
    fonts = {f[0]: (f[1], f[2], f[3]) for f in R2.FONTS}
    pols = {}
    for p2 in R2.policies():
        d = asdict(p2); w = d.pop("weights")
        pols[p2.name] = K3.Policy(**d, weights=K3.Weights(**w))
    keys = [k for k in sorted(sigs) if k.split("|")[4] in pols][::50]
    cache, mism = {}, 0
    for key in keys:
        tid, lab, size, w, pn = key.split("|"); fam, axes, wt = fonts[lab]
        if (tid, lab, size) not in cache:
            cache[(tid, lab, size)] = K3.prepare(texts[tid]["text"], "mr", "Deva", fam, float(size), axes, wt)
        mism += K3.signature(K3.compose(cache[(tid, lab, size)], pols[pn], float(w))) != sigs[key]
    return {"oracle_files": len(m["files"]), "oracle_hash_mismatches": len(bad), "compose2_signatures_checked": len(keys),
            "compose2_mismatches_in_legacy_mode": mism, "matches": not bad and mism == 0}


# ------------------------------------------------------------------------------------------- metrics
def print_lines(par: dict) -> list[dict]:
    out = []
    for ln in par["lines"]:
        g = [x / par["nominal_space_pt"] for x, u in zip(ln["gaps_pt"], ln["gap_punct_adjacent"]) if not u]
        out.append({"final": ln["class"] == "FINAL_PARAGRAPH_LINE", "justified": ln["class"] in ("FULLY_ALIGNED", "NEAR_ALIGNED"),
                    "widest": max(g) if g else None, "space": st.median(g) if g else None})
    return out


def our_lines(p, c, house_space_mm: float) -> list[dict]:
    out = []
    for ln in c.lines:
        sf = ln.applied_sf if ln.kind in ("justified", "semi") else min(1.0, ln.applied_sf)
        g = [p.spaces[c.pieces[i].word] * sf / house_space_mm for i in range(ln.a, ln.b - 1) if c.btype[i] == "space"]
        out.append({"final": ln.kind == "final", "justified": ln.kind == "justified",
                    "widest": max(g) if g else None, "space": g[0] if g else None, "inword": ln.end_break == "inword"})
    return out


def agg(rows: list[dict], key: str) -> dict:
    """rows: per-paragraph dicts holding '<key>_lines' (line dicts) and n_print / n_ours."""
    L = [l for r in rows for l in r[key] if not l["final"]]
    w = [l["widest"] for l in L if l["widest"] is not None]
    sp = [l["space"] for l in L if l["justified"] and l["space"] is not None]
    n = len(L)
    res = {"paragraphs": len(rows), "nonfinal_lines": n,
           "loose_gt2_pct": round(100 * sum(x > 2 for x in w) / max(1, len(w)), 2),
           "loose_gt3_pct": round(100 * sum(x > 3 for x in w) / max(1, len(w)), 2),
           "widest_p95": round(sorted(w)[int(0.95 * (len(w) - 1))], 3) if w else None,
           "widest_max": round(max(w), 3) if w else None,
           "tight_lt08_pct": round(100 * sum(x < 0.8 for x in sp) / max(1, len(sp)), 2),
           "tight_lt07_pct": round(100 * sum(x < 0.7 for x in sp) / max(1, len(sp)), 2),
           "space_min": round(min(sp), 3) if sp else None,
           "not_justified_pct": round(100 * sum(not l["justified"] for l in L) / max(1, n), 2)}
    if key == "ours":
        res["inword_breaks_per_100_lines"] = round(100 * sum(l.get("inword", False) for r in rows for l in r[key]) / max(1, sum(len(r[key]) for r in rows)), 2)
        res["lines_total_ours"] = sum(len(r["ours"]) for r in rows)
        res["lines_total_print"] = sum(len(r["print"]) for r in rows)
        res["depth_ok_pct"] = round(100 * sum(abs(len(r["ours"]) - len(r["print"])) <= max(1, len(r["print"]) // 20) for r in rows) / max(1, len(rows)), 2)
        res["depth_exact_pct"] = round(100 * sum(len(r["ours"]) == len(r["print"]) for r in rows) / max(1, len(rows)), 2)
    return res


def select(cal: dict, cal_print: dict) -> tuple[str | None, list]:
    log = []
    for name, a in cal.items():
        if name.startswith("REF_"):
            continue
        ok = (a["tight_lt08_pct"] <= cal_print["tight_lt08_pct"] and a["tight_lt07_pct"] <= cal_print["tight_lt07_pct"]
              and a["depth_ok_pct"] >= 90.0)
        log.append({"candidate": name, "eligible": ok, "loose_gt2_pct": a["loose_gt2_pct"], "loose_gt3_pct": a["loose_gt3_pct"],
                    "tight_lt08_pct": a["tight_lt08_pct"], "tight_lt07_pct": a["tight_lt07_pct"], "depth_ok_pct": a["depth_ok_pct"]})
    el = [x for x in log if x["eligible"]]
    if not el:
        return None, log
    floor = lambda n: float(n.split("floor")[1].split("_")[0])  # noqa: E731
    best = min(el, key=lambda x: (x["loose_gt2_pct"], x["loose_gt3_pct"], -floor(x["candidate"])))
    return best["candidate"], log


# ------------------------------------------------------------------------------------------- main
def prepare_paragraph(par: dict):
    probe = K3.prepare(par["text"], "mr", "Deva", FAM, 10.0, AXES, WT)
    per_pt = sum(c.width for c in probe.clusters if not c.is_space) * MM / 10.0
    size = sum(l["word_width_pt"] for l in par["lines"]) / per_pt
    nb = C.shape_paragraph(NBSP, "mr", FAM, size, axes=AXES).runs[0].x_advances_mm[0]
    n_nb = max(0, round(par["indent_mm"] / nb)) if par["indent_mm"] > 0 else 0
    p = K3.prepare(NBSP * n_nb + par["text"], "mr", "Deva", FAM, size, AXES, WT)
    our_space_mm = st.median(s for s in p.spaces if s)
    house_space_mm = par["nominal_space_pt"] / MM
    return p, size, n_nb, our_space_mm, house_space_mm


def main():
    ds = Path(sys.argv[1]).expanduser()
    priv = ds / "report" / "compose3"; priv.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    a = stage_a()
    (OUT / "stage_a_baseline.json").write_text(json.dumps(a, indent=1) + "\n")
    if not a["matches"]:
        print("STOP: baseline mismatch", a); sys.exit(2)
    pars = [json.loads(l) for l in open(ds / "report" / "paragraphs.jsonl", encoding="utf-8")]
    pars = [p for p in pars if p["width_confidence"] == "DERIVED"]
    cands = candidates()
    rows = {n: [] for n in cands}; sigs = {}; ctime = {n: [] for n in cands}; per_par = []
    for par in pars:
        p, size, n_nb, our_sp, house_sp = prepare_paragraph(par)
        k = house_sp / our_sp
        pl = print_lines(par)
        for name, (kind, prm) in cands.items():
            pol = policy_for(name, kind, prm, k)
            tc = time.perf_counter(); c = K3.compose(p, pol, par["width_mm"]); dt = (time.perf_counter() - tc) * 1000
            ol = our_lines(p, c, house_sp)
            rows[name].append({"split": "cal" if par["edition_date"] < SPLIT_DATE else "test", "print": pl, "ours": ol})
            sigs[f'{par["id"]}|{name}'] = K3.signature(c); ctime[name].append(dt)
            per_par.append({"id": par["id"], "candidate": name, "split": rows[name][-1]["split"], "width_mm": par["width_mm"],
                            "size_ours_pt": round(size, 3), "k_house_per_ours": round(k, 4), "nbsp_indent": n_nb, "status": c.status,
                            "lines_print": len(pl), "lines_ours": len(ol), "compose_ms": round(dt, 3)})
    summary = {"schema": "pageinator.compose3.summary/1", "composer": K3.COMPOSER_VERSION, "font": LABEL,
               "paragraphs": len(pars), "split_date": SPLIT_DATE, "candidates": {n: {"kind": v[0], **v[1]} for n, v in cands.items()},
               "units": "word gaps in HOUSE units = the published font's normal space (EXACT, PDF width table)"}
    for split in ("cal", "test", "all"):
        sel = lambda r: split == "all" or r["split"] == split  # noqa: E731
        any_rows = [r for r in rows["REF_C2_same_rules"] if sel(r)]
        summary[split] = {"print": agg(any_rows, "print"), "candidates": {n: agg([r for r in rows[n] if sel(r)], "ours") for n in cands}}
    chosen, log = select(summary["cal"]["candidates"], summary["cal"]["print"])
    summary["selection"] = {"rule": "see module docstring (Stage D)", "chosen": chosen, "log": log}
    # with-breaks reference for the chosen candidate (information only; not house practice)
    if chosen:
        kind, prm = cands[chosen]; wb_rows = []
        for par in pars:
            p, size, n_nb, our_sp, house_sp = prepare_paragraph(par)
            c = K3.compose(p, policy_for(chosen + "_with_breaks", kind, prm, house_sp / our_sp, inword="rules"), par["width_mm"])
            wb_rows.append({"split": "cal" if par["edition_date"] < SPLIT_DATE else "test", "print": print_lines(par), "ours": our_lines(p, c, house_sp)})
        summary["chosen_with_breaks"] = {s: agg([r for r in wb_rows if s == "all" or r["split"] == s], "ours") for s in ("cal", "test", "all")}
    summary["compose_ms"] = {n: {"median": round(st.median(v), 3), "p95": round(sorted(v)[int(0.95 * (len(v) - 1))], 3)} for n, v in ctime.items()}
    summary["signatures_sha256"] = hashlib.sha256(json.dumps(sigs, sort_keys=True).encode()).hexdigest()
    summary["runtime_s"] = round(time.time() - t0, 1)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    (OUT / "env.json").write_text(json.dumps(C.environment({"composer": K3.COMPOSER_VERSION}), indent=1) + "\n")
    (priv / "signatures.json").write_text(json.dumps(sigs, sort_keys=True) + "\n")
    with gzip.open(priv / "per_paragraph.csv.gz", "wt", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(per_par[0])); w.writeheader(); w.writerows(per_par)
    for f in (priv / "signatures.json", priv / "per_paragraph.csv.gz"):
        f.chmod(0o600)
    print("Stage A", a)
    print("paragraphs", len(pars), "| chosen:", chosen, "| runtime", summary["runtime_s"], "s")
    for split in ("cal", "test"):
        P = summary[split]["print"]
        print(f"\n[{split}] PRINT  loose>2 {P['loose_gt2_pct']}%  >3 {P['loose_gt3_pct']}%  p95 {P['widest_p95']}  tight<0.8 {P['tight_lt08_pct']}%  <0.7 {P['tight_lt07_pct']}%  min {P['space_min']}  lines {P['nonfinal_lines']}")
        for n, v in summary[split]["candidates"].items():
            print(f"  {n:30s} loose>2 {v['loose_gt2_pct']:6}% >3 {v['loose_gt3_pct']:6}% p95 {v['widest_p95']} tight<0.8 {v['tight_lt08_pct']:5}% <0.7 {v['tight_lt07_pct']:5}% min {v['space_min']} depth±ok {v['depth_ok_pct']}% exact {v['depth_exact_pct']}% lines {v['lines_total_ours']}/{v['lines_total_print']}")
    if chosen:
        print("\nchosen + breaks:", summary["chosen_with_breaks"]["test"])


if __name__ == "__main__":
    main()
