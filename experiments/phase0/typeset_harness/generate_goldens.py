"""Generate BEHAVIOR goldens from oracle-v0 for the Phase 0 corpus.

EXPERIMENTAL / EVIDENCE TOOLING. Output: fixtures/typeset/v1/behavior/<kind>.jsonl

BEHAVIOR golden = "what oracle-v0 produces". NOT correctness (see fixtures/typeset/README.md).

Also runs an independent-build shaping cross-check: every shaped item is re-shaped with the
system `hb-shape` CLI (a different HarfBuzz version) and glyph IDs + clusters are compared.
This is cross-VERSION agreement, not proof of correctness.

Usage: tools/oracle/v0/.venv/bin/python experiments/phase0/typeset_harness/generate_goldens.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import unicodedata
from pathlib import Path

import common as C

OUT = C.REPO / "fixtures" / "typeset" / "v1" / "behavior"
NOT_IN_V0 = ["justified_glyph_positions", "frame_flow", "overset", "continuation", "emergency_stretch",
             "tracking_in_breaking", "hyphenation_dictionary", "rtl"]


def hexs(xs):
    return [float(x).hex() for x in xs]


def invariants(text: str, runs) -> dict:
    notdef = any(g == 0 for r in runs for g in r.glyph_ids)
    mono = all(all(a <= b for a, b in zip(r.cluster_map, r.cluster_map[1:])) for r in runs)
    cluster_starts = sorted({c for r in runs for c in r.cluster_map})
    orphan = []
    for c in cluster_starts:
        if unicodedata.category(text[c]) in ("Mn", "Mc") and (c == 0 or not unicodedata.category(text[c - 1])[0] in "LM"):
            orphan.append(c)
    return {"no_notdef": not notdef, "clusters_monotonic_ltr": mono,
            "orphan_combining_mark_offsets": orphan,
            "note": "orphan marks are NOT rejected by oracle-v0 (dotted circle disabled) — see KNOWN_LIMITATIONS OL-12"}


def hb_shape_check(text: str, items, runs, font_rec: dict, size_pt: float, lang: str, axes: dict,
                   extra: tuple[str, ...] = ()) -> dict:
    exe = shutil.which("hb-shape")
    if not exe or not font_rec.get("file"):
        return {"status": "SKIPPED", "reason": "hb-shape or font file unavailable"}
    font_path = C.ORACLE / font_rec["file"]
    ver = subprocess.run([exe, "--version"], capture_output=True, text=True).stdout.split("\n")[0]
    mism = []
    for it, run in zip(items, runs):
        seg = text[it.start:it.end]
        args = [exe, f"--font-file={font_path}", f"--language={lang}", f"--script={it.script.lower()}",
                "--direction=ltr", "--output-format=json", "--no-glyph-names", *extra]
        var = ",".join(f"{k}={v}" for k, v in axes.items())
        if var:
            args.append(f"--variations={var}")
        out = subprocess.run(args + [seg], capture_output=True, text=True)
        try:
            glyphs = json.loads(out.stdout)
        except json.JSONDecodeError:
            return {"status": "ERROR", "stderr": out.stderr[:200], "hb_shape": ver}
        g_ids = [g["g"] for g in glyphs]
        g_cl = [g["cl"] + it.start for g in glyphs]
        if g_ids != list(run.glyph_ids) or g_cl != list(run.cluster_map):
            mism.append({"item": [it.start, it.end], "oracle_gids": list(run.glyph_ids), "hb_shape_gids": g_ids,
                         "oracle_clusters": list(run.cluster_map), "hb_shape_clusters": g_cl})
    return {"status": "AGREE" if not mism else "DISAGREE", "hb_shape": ver, "mismatches": mism,
            "meaning": "cross-version agreement of HarfBuzz builds; not independent proof of correctness"}


_ENV = None


def env():
    global _ENV
    if _ENV is None:
        _ENV = C.environment()
    return _ENV


def fixture(t: dict, kind_cfg: dict, family: str, weight: int, width: float, conds: dict) -> dict:
    size = kind_cfg["size_pt"]
    leading = round(size * conds["leading_factor"], 3)
    pol_name = kind_cfg["policy"]
    pol = conds["spacing_policies"][pol_name]
    axes = {"wght": weight} if family in ("Noto Serif Devanagari", "Noto Sans Devanagari", "Archivo Narrow",
                                           "Source Serif 4") else {}
    sh = C.shape_paragraph(t["text"], t["lang"], family, size, weight=weight)
    st = C.style(family, size, leading, pol, algorithm=kind_cfg["algorithm"])
    nodes = C.build_nodes(sh.runs, t["text"], st)
    res = C.break_lines(nodes, [width], st)
    diag = C.line_diagnostics(nodes, res.breakpoints, width, size)
    font_rec = C.font_file_for(family)
    return {
        "schema": "pageinator.fixture.typeset/1",
        "id": f"{t['id']}__{family.replace(' ', '')}-{weight}__{size}pt__{width}mm__{pol_name}__{kind_cfg['algorithm']}",
        "golden_class": "BEHAVIOR",
        "text_id": t["id"], "kind": t["kind"], "tags": t.get("tags", []),
        "input": {
            "text": t["text"], "text_sha256": C.sha256_bytes(t["text"].encode()), "language": t["lang"],
            "script": t["script"], "direction": "ltr",
            "font": {**font_rec, "weight": weight, "axes_requested": axes, "font_stack": [family]},
            "size_pt": size, "leading_pt": leading, "measures_mm": [width],
            "policy": {"name": pol_name, **{k: v for k, v in pol.items() if k != "basis"}},
            "algorithm": kind_cfg["algorithm"], "hyphenation": None, "tracking_milli_em": 0.0,
        },
        "observed": {
            "generator": {"oracle": "oracle-v0", "source_commit": env()["oracle"]["source_commit"],
                          "harfbuzz": env()["harfbuzz"]},
            "itemization": [{"start": i.start, "end": i.end, "script": i.script} for i in sh.items],
            "shaping": [{"glyph_ids": list(r.glyph_ids), "clusters": list(r.cluster_map),
                         "x_advances_mm_hex": hexs(r.x_advances_mm), "x_offsets_mm_hex": hexs(r.x_offsets_mm),
                         "y_offsets_mm_hex": hexs(r.y_offsets_mm), "font_id": r.font_id} for r in sh.runs],
            "breaks": {"algorithm_requested": kind_cfg["algorithm"], "algorithm_used": res.algorithm,
                       "used_fallback": res.used_fallback,
                       "node_indices": [b.node_index for b in res.breakpoints],
                       "ratios_hex": hexs(b.adjustment_ratio for b in res.breakpoints),
                       "natural_widths_mm_hex": hexs(b.natural_width_mm for b in res.breakpoints),
                       "hyphenated": [b.is_hyphenated for b in res.breakpoints]},
            "derived": {"line_count": res.line_count,
                        "paragraph_depth_mm_estimate": round(res.line_count * leading * C.MM_PER_PT, 4),
                        "space_factors": [None if d["last"] else round(d["space_factor"], 6) for d in diag],
                        "line_classes": [C.classify_line(d, pol) for d in diag]},
            "invariants": invariants(t["text"], sh.runs),
            "shaping_crosscheck": hb_shape_check(t["text"], sh.items, sh.runs, font_rec, size, t["lang"], axes,
                                                 ("--remove-default-ignorables",)),
            "shaping_crosscheck_hb_default_flags": hb_shape_check(t["text"], sh.items, sh.runs, font_rec, size,
                                                                  t["lang"], axes),
            "shaping_crosscheck_note": ("primary check uses --remove-default-ignorables to match oracle buffer flags; "
                                        "hb-shape CLI has no DO_NOT_INSERT_DOTTED_CIRCLE option, so orphan-mark "
                                        "inputs are expected to differ (dotted circle inserted by hb-shape only)"),
            "not_available_in_oracle_v0": NOT_IN_V0,
        },
        "limitations": ["OL-01", "OL-05"] + (["OL-08"] if t["lang"] == "mr" else []),
    }


def main() -> None:
    conds = C.load_conditions()
    gm = conds["golden_matrix"]
    OUT.mkdir(parents=True, exist_ok=True)
    counts = {}
    for kind, cfg in gm.items():
        rows = []
        for t in C.load_corpus():
            if t["kind"] != kind:
                continue
            for fspec in cfg["fonts"][t["script"]]:
                family, weight = (fspec if isinstance(fspec, list) else (fspec, 400))
                for w in cfg["widths_mm"]:
                    try:
                        rows.append(fixture(t, cfg, family, weight, w, conds))
                    except Exception as e:  # noqa: BLE001 — record, never hide
                        rows.append({"schema": "pageinator.fixture.typeset/1", "id": f"{t['id']}__{family}__ERROR",
                                     "golden_class": "BEHAVIOR", "text_id": t["id"],
                                     "error": f"{type(e).__name__}: {e}"})
        with (OUT / f"{kind}.jsonl").open("w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        counts[kind] = len(rows)
    env = C.environment({"fixture_counts": counts})
    (OUT / "GENERATION_ENV.json").write_text(json.dumps(env, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
