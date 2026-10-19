"""EXP-COMPOSE-1 runner — stages A (baseline), B (geometry), C/D/E (policy, breaking, font/width), F (performance).

EXPERIMENTAL / EVIDENCE ONLY.  Usage (repo root):
  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose1/run_matrix.py [--skip-oracle-tests]
Outputs: experiments/phase0/results/compose1/
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import importlib
import json
import math
import statistics as st
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from dataclasses import asdict, replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402
import composer as K  # noqa: E402

OUT = C.REPO / "experiments" / "phase0" / "results" / "compose1"
WIDTHS = [30.25, 34.0, 38.0, 41.5, 45.0, 48.5, 52.0, 56.0, 60.0]
SIZES = [8.5, 9.0, 9.5, 10.0]
FONTS = {  # (label, family, axes, weight) — wdth instances are DESIGNED widths of the variable fonts, not distortion
    "Deva": [("NotoSerifDeva-w100", "Noto Serif Devanagari", {"wdth": 100.0}, 400),
             ("NotoSerifDeva-w87.5", "Noto Serif Devanagari", {"wdth": 87.5}, 400),
             ("NotoSerifDeva-w75", "Noto Serif Devanagari", {"wdth": 75.0}, 400),
             ("NotoSansDeva-w100", "Noto Sans Devanagari", {"wdth": 100.0}, 400),
             ("NotoSansDeva-w75", "Noto Sans Devanagari", {"wdth": 75.0}, 400),
             ("Mukta", "Mukta", None, 400),
             ("TiroDevaHindi", "Tiro Devanagari Hindi", None, 400)],
    "Latn": [("SourceSerif4", "Source Serif 4", None, 400),
             ("Archivo-w100", "Archivo", {"wdth": 100.0}, 400),
             ("ArchivoNarrow", "Archivo Narrow", None, 400)],
}
W = K.Weights()
MEAS_W = K.Weights(soft_space=100.0 * (50 - 1.33) ** 2)  # measurement: penalty = 100·(sf−1.33)², effectively uncapped


def policies(script: str) -> list[K.Policy]:
    mr_min = (2, 2)  # conservative minima in clusters for hyph-mr (published file minima are 1,1 code points)
    ps = [
        K.Policy("FULL_DP_h1.50", "FULL", ws_max_hard=1.50),
        K.Policy("FULL_DP_h1.75", "FULL", ws_max_hard=1.75),
        K.Policy("FULL_DP_h2.00", "FULL", ws_max_hard=2.00),
        K.Policy("FULL_DP_h2.25", "FULL", ws_max_hard=2.25),
        K.Policy("FULL_GREEDY_h2.00", "FULL", algorithm="GREEDY", ws_max_hard=2.00),
        K.Policy("FULL_DP_h2.00_rules", "FULL", ws_max_hard=2.00, inword="rules",
                 inword_min=mr_min if script == "Deva" else None),
        K.Policy("CONSTRAINED_DP_c1.33", "CONSTRAINED", ws_max_hard=1.33, ws_max_soft=1.20),
        K.Policy("CONSTRAINED_DP_c1.50", "CONSTRAINED", ws_max_hard=1.50),
        K.Policy("CONSTRAINED_DP_c2.00", "CONSTRAINED", ws_max_hard=2.00),
        K.Policy("RAGGED_DP", "RAGGED"),
        K.Policy("RAGGED_GREEDY", "RAGGED", algorithm="GREEDY"),
        K.Policy("HYBRID_DP_h1.50", "HYBRID", ws_max_hard=1.50),
        K.Policy("HYBRID_DP_h2.00", "HYBRID", ws_max_hard=2.00),
        K.Policy("HYBRID_GREEDY_h2.00", "HYBRID", algorithm="GREEDY", ws_max_hard=2.00),
        K.Policy("HYBRID_DP_h2.00_rules", "HYBRID", ws_max_hard=2.00, inword="rules",
                 inword_min=mr_min if script == "Deva" else None),
        K.Policy("FULL_DP_h2.00_ortho_EXPLORATORY", "FULL", ws_max_hard=2.00, inword="ortho", inword_min=(2, 2)),
        # measurement policies (not candidates): effectively uncapped spacing to read REQUIRED spacing
        K.Policy("MEAS_DP_uncapped", "FULL", ws_max_hard=50.0, weights=MEAS_W),
        K.Policy("MEAS_DP_uncapped_rules", "FULL", ws_max_hard=50.0, weights=MEAS_W, inword="rules",
                 inword_min=mr_min if script == "Deva" else None),
        K.Policy("MEAS_GREEDY_uncapped", "FULL", algorithm="GREEDY", ws_max_hard=50.0, weights=MEAS_W),
    ]
    if script == "Deva":
        ps.append(K.Policy("FULL_DP_h2.00_rules_publishedmin", "FULL", ws_max_hard=2.00, inword="rules",
                           inword_min=(1, 1)))
    else:  # Latin-only EXPLORATORY per-line tracking
        ps += [K.Policy("FULL_DP_h2.00_rules_track10_EXPLORATORY", "FULL", ws_max_hard=2.00, inword="rules",
                        tracking_max_milli_em=10.0),
               K.Policy("FULL_DP_h2.00_rules_track20_EXPLORATORY", "FULL", ws_max_hard=2.00, inword="rules",
                        tracking_max_milli_em=20.0)]
    return ps


def q(xs, p):
    xs = [x for x in xs if not math.isinf(x)]
    return C.percentile(xs, p) if xs else float("nan")


# ------------------------------------------------------------------------------ Stage A
def stage_a(run_oracle_tests: bool) -> dict:
    res = {}
    if run_oracle_tests:
        out = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/"],
                             cwd=C.ORACLE, capture_output=True, text=True)
        tail = [l for l in out.stdout.splitlines() if "passed" in l or "failed" in l]
        res["oracle_tests"] = {"returncode": out.returncode, "summary": tail[-1] if tail else out.stdout[-200:]}
    gg = importlib.import_module("generate_goldens")
    ij = importlib.import_module("investigate_justification")
    with tempfile.TemporaryDirectory() as td:
        gg.OUT = Path(td) / "behavior"; gg.main()
        same = {}
        for f in sorted((C.REPO / "fixtures/typeset/v1/behavior").glob("*.jsonl")):
            same[f.name] = hashlib.sha256(f.read_bytes()).hexdigest() == hashlib.sha256((gg.OUT / f.name).read_bytes()).hexdigest()
        res["fixtures_regenerated_byte_identical"] = same
        ij.OUT = Path(td) / "just"; ij.main()
        base = C.REPO / "experiments/phase0/results/justification"
        res["justification_csvs_byte_identical"] = {
            n: hashlib.sha256((base / n).read_bytes()).hexdigest() == hashlib.sha256((ij.OUT / n).read_bytes()).hexdigest()
            for n in ("paragraphs.csv", "lines.csv")}
        s = json.loads((ij.OUT / "summary.json").read_text())
        rows = list(csv.DictReader(open(ij.OUT / "paragraphs.csv", encoding="utf-8")))
        res["J0_feasible_of_240"] = s["J0_reproduce_original"]["feasible"]
        res["authored_feasible_P0"] = f'{sum(r["kp_feasible_P0"] == "True" for r in rows)}/{len(rows)}'
        res["engine_bug_disagreements"] = len(s["J8_engine_bug_check"]["disagreements"])
    res["matches_phase0"] = (res["J0_feasible_of_240"] == 0 and res["authored_feasible_P0"] == "79/1800"
                             and res["engine_bug_disagreements"] == 0 and all(same.values())
                             and all(res["justification_csvs_byte_identical"].values()))
    return res


# ------------------------------------------------------------------------------ Stages B–F
def corpus_body():
    body = [t for t in C.load_corpus() if t["kind"] == "body"]
    excluded = [t["id"] for t in C.load_corpus() if t["kind"] != "body"]
    return body, excluded


def malformed_check(texts) -> list:
    import unicodedata as ud
    bad = []
    for t in texts:
        s = t["text"]
        for i, ch in enumerate(s):
            if ud.category(ch) in ("Mn", "Mc") and (i == 0 or ud.category(s[i - 1])[0] not in "LM"):
                bad.append((t["id"], i))
    return bad


def run(args) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"composer_version": K.COMPOSER_VERSION, "weights_default": asdict(W), "measurement_weights": asdict(MEAS_W),
            "widths_mm": WIDTHS, "sizes_pt": SIZES, "fonts": FONTS,
            "hyphenation_sources": json.loads((HERE / "third_party" / "SOURCES.json").read_text())}
    t0 = time.time()
    a = stage_a(not args.skip_oracle_tests)
    (OUT / "stage_a_baseline.json").write_text(json.dumps(a, indent=2) + "\n")
    if not a["matches_phase0"]:
        print("STOP: baseline does not reproduce Phase 0", json.dumps(a, indent=1)); sys.exit(2)

    body, excluded = corpus_body()
    bad = malformed_check(body)
    meta["corpus"] = {"used_kind": "body", "used_ids": [t["id"] for t in body], "excluded_ids": excluded,
                      "malformed_in_used_texts": bad,
                      "note": "difficult/mixed/headline fixtures incl. malformed mr-diff-17 are excluded from quality conclusions"}
    if bad:
        print("STOP: malformed text in composition corpus", bad); sys.exit(3)

    # cold font loading (separate from composition)
    cold = {}
    for script, fl in FONTS.items():
        for label, fam, axes, wt in fl:
            C._REGISTRY = None  # noqa: SLF001
            t1 = time.perf_counter(); C.face(fam, wt, axes); cold[label] = round((time.perf_counter() - t1) * 1000, 1)
    meta["cold_font_load_ms_fresh_registry"] = cold
    C._REGISTRY = None  # noqa: SLF001
    for script, fl in FONTS.items():  # warm all
        for label, fam, axes, wt in fl:
            C.face(fam, wt, axes)

    para_rows, line_rows, sigs = [], [], {}
    prep_times, comp_times = [], defaultdict(list)
    for t in body:
        script = t["script"]
        for label, fam, axes, wt in FONTS[script]:
            for size in SIZES:
                tp = time.perf_counter()
                p = K.prepare(t["text"], t["lang"], script, fam, size, axes, wt)
                prep_times.append(time.perf_counter() - tp)
                chars = len(t["text"])
                adv_em = sum(c.width for c in p.clusters if not c.is_space) / p.em_mm
                for w in WIDTHS:
                    ref_lines = None
                    for pol in policies(script):
                        tc = time.perf_counter(); c = K.compose(p, pol, w); dt = time.perf_counter() - tc
                        comp_times[(pol.algorithm, pol.family if not pol.name.startswith("MEAS") else "MEAS")].append(dt)
                        nonfinal = [l for l in c.lines if l.kind != "final"]
                        if pol.name == "RAGGED_DP":
                            ref_lines = len(c.lines)
                        sigs[(t["id"], label, size, w, pol.name)] = K.signature(c)
                        req = [l.required_sf for l in nonfinal]
                        app = [l.applied_sf for l in nonfinal if l.kind == "justified"]
                        wpl = [l.n_words for l in nonfinal]
                        row = {"text_id": t["id"], "lang": t["lang"], "script": script, "font": label, "size_pt": size,
                               "width_mm": w, "policy": pol.name, "family": pol.family, "algorithm": pol.algorithm,
                               "inword": pol.inword, "ws_max_hard": pol.ws_max_hard,
                               "status": c.status, "lines": len(c.lines), "nonfinal_lines": len(nonfinal),
                               "justified_lines": sum(l.kind == "justified" for l in nonfinal),
                               "within_policy_lines": sum(l.within_policy for l in nonfinal),
                               "semi_lines": sum(l.kind == "semi" for l in nonfinal),
                               "ragged_lines": sum(l.kind == "ragged" for l in nonfinal),
                               "violation_lines": sum(l.kind in ("violation", "overfull") for l in c.lines),
                               "inword_breaks": sum(l.end_break == "inword" for l in c.lines),
                               "emergency_breaks": sum(l.end_break == "emergency" for l in c.lines),
                               "overfull_lines": sum(l.kind == "overfull" for l in c.lines),
                               "tracked_lines": sum(l.tracking_mm_per_gap > 0 for l in nonfinal),
                               "req_sf_median": q(req, .5), "req_sf_p90": q(req, .9), "req_sf_p95": q(req, .95),
                               "req_sf_max": max([x for x in req if not math.isinf(x)], default=float("nan")),
                               "req_sf_inf_lines": sum(math.isinf(x) for x in req),
                               "app_sf_median": q(app, .5), "app_sf_p95": q(app, .95),
                               "app_sf_max": max(app, default=float("nan")),
                               "req_gt_1_5": sum(x > 1.5 for x in req), "req_gt_2_0": sum(x > 2.0 for x in req),
                               "req_gt_3_0": sum(x > 3.0 for x in req),
                               "mean_slack_frac_unjustified": (st.mean([l.slack_mm / w for l in nonfinal if l.kind in ("semi", "ragged")])
                                                               if any(l.kind in ("semi", "ragged") for l in nonfinal) else 0.0),
                               "wpl_mean": st.mean(wpl) if wpl else float("nan"),
                               "chars_per_line": chars / max(1, len(c.lines)), "adv_em_total": adv_em, "chars": chars,
                               "ref_ragged_lines": ref_lines, "compose_ms": dt * 1000, "signature": sigs[(t["id"], label, size, w, pol.name)]}
                        para_rows.append(row)
                        if size in (9.0, 9.5) and w in (38.0, 45.0, 52.0):
                            for l in c.lines:
                                line_rows.append({"text_id": t["id"], "font": label, "size_pt": size, "width_mm": w,
                                                  "policy": pol.name, "a": l.a, "b": l.b, "kind": l.kind,
                                                  "n_words": l.n_words, "n_spaces": l.n_spaces,
                                                  "required_sf": l.required_sf, "applied_sf": l.applied_sf,
                                                  "tracking_mm_per_gap": l.tracking_mm_per_gap, "slack_mm": l.slack_mm,
                                                  "end_break": l.end_break, "within_policy": l.within_policy,
                                                  "flags": "|".join(l.flags), "cost": l.cost})
    meta["runtime_s"] = round(time.time() - t0, 1)
    meta["prepare_ms"] = {"median": round(st.median(prep_times) * 1000, 3), "p95": round(q(prep_times, .95) * 1000, 3)}
    meta["compose_ms"] = {f"{a}|{f}": {"n": len(v), "median": round(st.median(v) * 1000, 4), "p95": round(q(v, .95) * 1000, 4),
                                        "max": round(max(v) * 1000, 4)} for (a, f), v in sorted(comp_times.items())}

    def write_gz(name, rows):
        with gzip.open(OUT / name, "wt", newline="", encoding="utf-8") as fh:
            wr = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); wr.writeheader(); wr.writerows(rows)
    write_gz("paragraphs.csv.gz", para_rows)
    write_gz("lines_subset.csv.gz", line_rows)
    (OUT / "signatures.json").write_text(json.dumps({"|".join(map(str, k)): v for k, v in sorted(sigs.items())}) + "\n")
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str) + "\n")
    (OUT / "env.json").write_text(json.dumps(C.environment({"experiment": "EXP-COMPOSE-1", "composer": K.COMPOSER_VERSION}), indent=2) + "\n")
    print(json.dumps({"rows": len(para_rows), "runtime_s": meta["runtime_s"], "compose_ms": meta["compose_ms"]}, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--skip-oracle-tests", action="store_true")
    run(ap.parse_args())
