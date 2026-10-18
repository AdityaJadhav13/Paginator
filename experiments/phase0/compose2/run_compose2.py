"""EXP-COMPOSE-2 runner (EXPERIMENTAL / EVIDENCE ONLY).

Stage A  baseline: oracle file hashes + EXP-COMPOSE-1 signatures reproduce (1-in-50 sample, compose1 composer)
Stage B  font characterisation: width metrics per font (same metric as EXP-PUBLISHED-1) and words per line
Stage C  policy matrix: finalist styles × fonts × sizes × grid widths (house profile: measured if present,
         else PROVISIONAL), Marathi body corpus (synthetic — see corpus provenance)
Stage D  regression vs EXP-COMPOSE-1 reference policy (HYBRID_DP_h2.00_rules)
Stage F  performance (composition only)
Proof pages are produced by proofs.py.

Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/run_compose2.py
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
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import fontreg  # noqa: E402

fontreg.install()
import common as C  # noqa: E402
import composer2 as K2  # noqa: E402

sys.path.insert(0, str(HERE.parent / "compose1"))
import composer as K1  # noqa: E402  (frozen compose1 composer, regression reference only)

OUT = C.REPO / "experiments" / "phase0" / "results" / "compose2"
FONTS = [  # (label, family, axes, weight, category) — category only for reporting, never a recommendation
    ("NotoSerifDeva-w100", "Noto Serif Devanagari", {"wdth": 100.0}, 400, "serif"),
    ("NotoSerifDeva-w87.5", "Noto Serif Devanagari", {"wdth": 87.5}, 400, "serif"),
    ("NotoSansDeva-w100", "Noto Sans Devanagari", {"wdth": 100.0}, 400, "sans"),
    ("NotoSansDeva-w87.5", "Noto Sans Devanagari", {"wdth": 87.5}, 400, "sans"),
    ("Mukta", "Mukta", None, 400, "sans"),
    ("TiroDevaMarathi", "Tiro Devanagari Marathi", None, 400, "serif"),
    ("Hind", "Hind", None, 400, "sans"),
    ("Martel", "Martel", None, 400, "serif"),
    ("Yantramanav", "Yantramanav", None, 400, "sans"),
    ("Baloo2", "Baloo 2", {"wght": 400.0}, 400, "rounded"),
    ("Khand", "Khand", None, 400, "condensed (display face; body use atypical)"),
]
# Newsroom fonts: $PAGEINATOR_PRIVATE_FONTS/compose2_fonts.json = [{"label", "family", "axes", "weight", "category"}]
if fontreg.PRIVATE_FONTS and (fontreg.PRIVATE_FONTS / "compose2_fonts.json").is_file():
    FONTS += [(f["label"], f["family"], f.get("axes"), f.get("weight", 400), "PRIVATE " + f.get("category", "body"))
              for f in json.loads((fontreg.PRIVATE_FONTS / "compose2_fonts.json").read_text())]
SIZES = [8.5, 9.0, 9.5]
MEAS_W = K2.Weights(soft_space=100.0 * (50 - 1.33) ** 2)


def profile():
    measured = HERE / "house_profile.measured.json"
    src = measured if measured.exists() else HERE / "house_profile.provisional.json"
    prof = json.loads(src.read_text())
    widths = []
    for g in prof["profiles"]:
        w = (g["page_mm"][0] - 2 * g["margin_mm"] - (g["columns"] - 1) * g["gutter_mm"]) / g["columns"]
        widths.append((g["id"], round(w, 2)))
    return src.name, prof, widths


def policies():
    common = dict(inword_min=(2, 2), token_breaks=True, max_consecutive_inword=2, fallback_max_slack=0.35)
    return [
        K2.Policy("C2_FULL_rules_h2.00", "FULL", ws_max_hard=2.00, inword="rules", **common),
        K2.Policy("C2_FULL_rules_h1.75", "FULL", ws_max_hard=1.75, inword="rules", **common),
        K2.Policy("C2_HYBRID_rules_h2.00", "HYBRID", ws_max_hard=2.00, inword="rules", **common),
        K2.Policy("C2_HYBRID_h2.00", "HYBRID", ws_max_hard=2.00, inword="none", **common),
        K2.Policy("C2_CONSTRAINED_c2.00", "CONSTRAINED", ws_max_hard=2.00, inword="none", **common),
        K2.Policy("C2_RAGGED", "RAGGED", inword="none", **common),
        K2.Policy("C2_RAGGED_rules", "RAGGED", inword="rules", **common),
        K2.Policy("C2_MEAS_uncapped", "FULL", ws_max_hard=50.0, weights=MEAS_W, inword="none",
                  token_breaks=True, max_consecutive_inword=None, fallback_max_slack=None),
        K2.Policy("C2_MEAS_uncapped_rules", "FULL", ws_max_hard=50.0, weights=MEAS_W, inword="rules", inword_min=(2, 2),
                  token_breaks=True, max_consecutive_inword=None, fallback_max_slack=None),
    ]


REF_C1 = K1.Policy("REF_C1_HYBRID_DP_h2.00_rules", "HYBRID", ws_max_hard=2.00, inword="rules", inword_min=(2, 2))


def q(xs, p):
    xs = [x for x in xs if not math.isinf(x)]
    return C.percentile(xs, p) if xs else float("nan")


def stage_a() -> dict:
    m = json.loads((C.ORACLE / "ORACLE_MANIFEST.json").read_text())
    bad = [f["path"] for f in m["files"] if hashlib.sha256((C.ORACLE / f["path"]).read_bytes()).hexdigest() != f["sha256"]]
    sigs = json.loads((C.REPO / "experiments/phase0/results/compose1/signatures.json").read_text())
    sys.path.insert(0, str(HERE.parent / "compose1"))
    import run_matrix as R1  # noqa: PLC0415
    C._REGISTRY = None  # compose1 used the oracle-only registry  # noqa: SLF001
    texts = {t["id"]: t for t in C.load_corpus()}
    fonts = {lab: (fam, axes, wt) for fl in R1.FONTS.values() for lab, fam, axes, wt in fl}
    keys = sorted(sigs)[::50]; cache, mism = {}, 0
    for k in keys:
        tid, lab, size, w, pn = k.split("|"); t = texts[tid]; fam, axes, wt = fonts[lab]
        if (tid, lab, size) not in cache:
            cache[(tid, lab, size)] = K1.prepare(t["text"], t["lang"], t["script"], fam, float(size), axes, wt)
        pol = next(p for p in R1.policies(t["script"]) if p.name == pn)
        mism += K1.signature(K1.compose(cache[(tid, lab, size)], pol, float(w))) != sigs[k]
    fontreg.install()
    return {"oracle_files": len(m["files"]), "oracle_hash_mismatches": len(bad),
            "compose1_signatures_checked": len(keys), "compose1_mismatches": mism,
            "matches": not bad and mism == 0}


def frag_min(c: K2.Composed, p: K2.Prepared) -> int | None:
    """Smallest akshara/cluster fragment produced by any in-word (rule) break — 1 = one-akshara fragment."""
    mins = []
    for ln in c.lines:
        if ln.end_break == "inword":
            pc = c.pieces[ln.b - 1]
            n = len(p.words[pc.word])
            mins.append(min(pc.cl_to, n - pc.cl_to))
    return min(mins) if mins else None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    a = stage_a()
    (OUT / "stage_a_baseline.json").write_text(json.dumps(a, indent=1) + "\n")
    if not a["matches"]:
        print("STOP: baseline mismatch", a); sys.exit(2)
    prof_src, prof, grid_widths = profile()
    widths = sorted({w for _, w in grid_widths} | {45.0, 60.0})
    texts = [t for t in C.load_corpus() if t["kind"] == "body" and t["lang"] == "mr"]

    # Stage B — font characterisation
    fonts_b = {}
    cold = {}
    for lab, fam, axes, wt, cat in FONTS:
        C._REGISTRY = None; fontreg.install()  # noqa: SLF001
        t1 = time.perf_counter(); C.face(fam, wt, axes); cold[lab] = round((time.perf_counter() - t1) * 1000, 1)
    fontreg.install()
    for lab, fam, axes, wt, cat in FONTS:
        adv, chars_em, spaces = [], [], []
        for t in texts:
            p = K2.prepare(t["text"], "mr", "Deva", fam, 9.5, axes, wt)
            for r in p.runs:
                for gi, x in enumerate(r.x_advances_mm):
                    if x > 0.01 * C.MM_PER_PT and t["text"][r.cluster_map[gi]] != " ":
                        adv.append(x / p.em_mm)
            chars_em.append(sum(c.width for c in p.clusters if not c.is_space) / p.em_mm / max(1, sum(1 for ch in t["text"] if ch != " ")))
            spaces += [s / p.em_mm for s in p.spaces if s]
        fonts_b[lab] = {"family": fam, "category": cat, "mean_advancing_glyph_em": round(st.mean(adv), 4),
                        "em_per_char": round(st.mean(chars_em), 4), "space_em": round(st.median(spaces), 4),
                        "cold_load_ms": cold[lab]}

    # Stage C/D — matrix
    rows, sigs, ctimes = [], {}, defaultdict(list)
    pols = policies()
    for t in texts:
        for lab, fam, axes, wt, cat in FONTS:
            for size in SIZES:
                p2 = K2.prepare(t["text"], "mr", "Deva", fam, size, axes, wt)
                p1 = None
                for w in widths:
                    ref_lines = None
                    for pol in pols + [REF_C1]:
                        if pol is REF_C1:
                            C._REGISTRY  # noqa: B018
                            if p1 is None:
                                p1 = K1.prepare(t["text"], "mr", "Deva", fam, size, axes, wt)
                            tc = time.perf_counter(); c = K1.compose(p1, pol, w); dt = time.perf_counter() - tc
                            pp = p1; sig = K1.signature(c)
                        else:
                            tc = time.perf_counter(); c = K2.compose(p2, pol, w); dt = time.perf_counter() - tc
                            pp = p2; sig = K2.signature(c)
                        ctimes[pol.name].append(dt)
                        nf = [l for l in c.lines if l.kind != "final"]
                        if pol.name == "C2_RAGGED":
                            ref_lines = len(c.lines)
                        req = [l.required_sf for l in nf]
                        app = [l.applied_sf for l in nf if l.kind == "justified"]
                        unj = [l.slack_mm / w for l in nf if l.kind in ("ragged", "semi")]
                        run, mx = 0, 0
                        for l in c.lines:
                            run = run + 1 if l.end_break == "inword" else 0; mx = max(mx, run)
                        sigs[f"{t['id']}|{lab}|{size}|{w}|{pol.name}"] = sig
                        rows.append({"text_id": t["id"], "font": lab, "category": cat, "size_pt": size, "width_mm": w,
                                     "policy": pol.name, "family": pol.family, "status": c.status, "lines": len(c.lines),
                                     "nonfinal": len(nf), "justified": sum(l.kind == "justified" for l in nf),
                                     "unjustified": len(unj), "inword_breaks": sum(l.end_break == "inword" for l in c.lines),
                                     "token_breaks": sum(l.end_break == "token" for l in c.lines),
                                     "emergency_breaks": sum(l.end_break == "emergency" for l in c.lines),
                                     "max_consecutive_inword": mx, "min_fragment_clusters": frag_min(c, pp),
                                     "app_sf_median": q(app, .5), "app_sf_p95": q(app, .95), "app_sf_max": max(app, default=float("nan")),
                                     "req_gt_1_5": sum(x > 1.5 for x in req), "req_gt_2_0": sum(x > 2.0 for x in req),
                                     "req_gt_3_0": sum(x > 3.0 for x in req),
                                     "max_unjustified_slack_frac": max(unj, default=0.0), "mean_unjustified_slack_frac": st.mean(unj) if unj else 0.0,
                                     "wpl_mean": st.mean(l.n_words for l in nf) if nf else float("nan"),
                                     "ref_ragged_lines": ref_lines, "compose_ms": dt * 1000, "signature": sig})
    with gzip.open(OUT / "paragraphs.csv.gz", "wt", newline="", encoding="utf-8") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); wr.writeheader(); wr.writerows(rows)
    (OUT / "signatures.json").write_text(json.dumps(sigs, sort_keys=True) + "\n")
    meta = {"composer": K2.COMPOSER_VERSION, "house_profile_source": prof_src, "house_profile_status": prof.get("status"),
            "grid_widths_mm": grid_widths, "widths_mm": widths, "sizes_pt": SIZES,
            "fonts": [{"label": f[0], "family": f[1], "axes": f[2], "weight": f[3], "category": f[4]} for f in FONTS],
            "policies": [asdict(p) | {"weights": asdict(p.weights)} for p in pols] + [{"name": REF_C1.name, "composer": "compose1/1.0.0"}],
            "font_characterisation": fonts_b,
            "compose_ms": {k: {"n": len(v), "median": round(st.median(v) * 1000, 4), "p95": round(q(v, .95) * 1000, 4),
                               "max": round(max(v) * 1000, 4)} for k, v in ctimes.items()},
            "corpus": "Phase 0 Marathi body corpus — 18 internally authored paragraphs (NOT newsroom text, NOT native-reviewed)",
            "runtime_s": round(time.time() - t0, 1)}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False, default=str) + "\n")
    (OUT / "env.json").write_text(json.dumps(C.environment({"experiment": "EXP-COMPOSE-2", "fonts_manifest_sha256":
                                                            hashlib.sha256((HERE / "FONTS.json").read_bytes()).hexdigest()}), indent=1) + "\n")
    print(json.dumps({"rows": len(rows), "runtime_s": meta["runtime_s"], "stage_a": a}, indent=1))


if __name__ == "__main__":
    main()
