"""G-FONT: font identity and metrics exactly as the frozen oracle resolves them (EVIDENCE TOOLING).

Every font request the public goldens and the Phase-0 experiments make, each recorded with what uses it:
  fixtures/typeset/v1        the five fixture fonts, as the fixtures were generated
  compose2:<label>           experiments/phase0/compose2/run_compose2.py FONTS (the 32,076-signature grid)
  press:<key>                experiments/phase0/pdfx1/make_press_test.py FONTS (F1–F3)
  headline:<wght>/<wdth>     Noto Sans Devanagari display instances on page1's width-axis grid (2.5 steps), for G-HEAD
For each, the oracle's FontRegistry.resolve() result: font_id, family, delivered weight/style/axes, source file SHA-256,
INSTANCE bytes SHA-256 (the bytes that feed shaping, metrics and PDF embedding alike), units per em, metric source,
per-pt ascent/descent/gap and ink extents, line box and minimum baseline gap at 10 pt, advances / ink extents of the
glyphs of a sample text; and, read from the instance bytes with fontTools, every glyph's advance in font units and the
best cmap (fontTools getBestCmap, which the PDF writer uses for ToUnicode) as runs [first code point, first glyph, n].

An instance whose bytes equal its source file (a static font) points at that tracked file. Other instances (variable
fonts pinned by the oracle with the fontTools instancer) are written to fixtures/fonts/v1/instances/<sha256>.ttf with
their family's OFL licence text, so the TypeScript engine loads the same bytes without running the instancer (ADR-023:
fontprep stays in Python). None of the shipped families declares a Reserved Font Name (checked 2026-10-20).
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys

from fontTools.ttLib import TTFont

from golden import EXPERIMENTS, FONTS, GOLDENS, ORACLE, REPO, Out, cli, ensure_public, environment, fhex

from paginator.typeset.fonts import FontRegistry

FONT_DIRS = [ORACLE / "assets" / "fonts", EXPERIMENTS / "compose2" / "fonts"]   # the order compose2/fontreg.py uses
SAMPLE = "क्षत्रिय पत्रकार ज्ञानेश्वर श्री द्ध ह्न ॐ । ॥ ०१२ Newspaper 2026, “quote” — ₹ €"
FIXTURE_REQUESTS = [  # (family, weight, style, axes), exactly as fixtures/typeset/v1 was generated
    ("Noto Serif Devanagari", 400, "normal", {"wght": 400}),
    ("Mukta", 400, "normal", {}),
    ("Source Serif 4", 400, "normal", {"wght": 400}),
    ("Noto Sans Devanagari", 700, "normal", {"wght": 700}),
    ("Archivo Narrow", 700, "normal", {"wght": 700}),
]
HEADLINE_REQUESTS = [(700, 75.0), (700, 87.5), (800, 75.0), (800, 87.5), (800, 100.0)]   # (wght, wdth)
LISTS = r"""
import json, sys
from pathlib import Path
E = Path(sys.argv[1])
sys.path.insert(0, str(E / "compose2"))
import run_compose2 as R2
sys.path.insert(0, str(E / "pdfx1"))
import make_press_test as MP
print(json.dumps({"compose2": [[lab, fam, axes, wt] for lab, fam, axes, wt, _ in R2.FONTS],
                  "press": [[k, fam, axes, wt] for k, (fam, axes, wt, _) in MP.FONTS.items()]}))
"""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def experiment_lists() -> dict:
    """The experiments' own font lists, read in a fresh interpreter (their modules share names such as `common`)."""
    env = {k: v for k, v in os.environ.items() if k != "PAGEINATOR_PRIVATE_FONTS"}
    r = subprocess.run([sys.executable, "-c", LISTS, str(EXPERIMENTS)], cwd=REPO, env=env, capture_output=True,
                       text=True, check=True)
    return json.loads(r.stdout.strip().splitlines()[-1])


def requests() -> list:
    lists = experiment_lists()
    out = [((fam, wt, st, ax), "fixtures/typeset/v1") for fam, wt, st, ax in FIXTURE_REQUESTS]
    out += [((fam, wt, "normal", ax), f"compose2:{lab}") for lab, fam, ax, wt in lists["compose2"]]
    out += [((fam, wt, "normal", ax), f"press:{k}") for k, fam, ax, wt in lists["press"]]
    out += [(("Noto Sans Devanagari", wt, "normal", {"wght": float(wt), "wdth": wd}), f"headline:{wt}/{wd:g}")
            for wt, wd in HEADLINE_REQUESTS]
    return out


def licence_texts() -> dict:
    """OFL texts by normalised family: "<dir>/<family>-OFL.txt" (oracle assets) or "<family>/OFL.txt" (compose2)."""
    out = {}
    for path in sorted({p for d in FONT_DIRS for p in d.rglob("*OFL*.txt")}):
        key = path.parent.name if path.name == "OFL.txt" else path.name.removesuffix("-OFL.txt")
        if key in out:
            raise SystemExit(f"two licence texts for {key}: {out[key]} and {path}")
        out[key] = path
    return out


def cmap_runs(cmap: dict) -> list:
    """{code point: glyph id} as runs [first code point, first glyph id, count] of consecutive pairs."""
    runs = []
    for cp, gid in sorted(cmap.items()):
        if runs and cp == runs[-1][0] + runs[-1][2] and gid == runs[-1][1] + runs[-1][2]:
            runs[-1][2] += 1
        else:
            runs.append([cp, gid, 1])
    return runs


def font_tables(data: bytes) -> dict:
    tt = TTFont(io.BytesIO(data), lazy=False)
    order = tt.getGlyphOrder()
    hmtx = tt["hmtx"].metrics
    best = {cp: tt.getGlyphID(name) for cp, name in tt.getBestCmap().items()}
    return {"glyph_count": len(order), "advances_units": [hmtx[n][0] for n in order], "best_cmap": cmap_runs(best),
            "head_units_per_em": tt["head"].unitsPerEm, "outlines": "glyf" if "glyf" in tt else "CFF"}


def readme(records: list) -> str:
    """fixtures/fonts/v1/README.md (generated): what each binary is, where it came from, its licence."""
    rows = {}
    for r in records:
        e = r["expected"]
        if e["licence_file"] is None:
            continue
        row = rows.setdefault(e["instance_file"], {"family": e["family"], "axes": e["axes"], "source": e["source_file"],
                                                   "licence": e["licence_file"], "uses": []})
        row["uses"] += r["uses"]
    lines = ["# Font instances for the golden vectors (generated by tools/goldens/v1/gen_fonts.py)", "",
             "Static instances of variable OFL fonts, pinned by the frozen oracle with the fontTools instancer: the exact",
             "bytes the oracle shapes, measures and embeds, so the TypeScript engine loads them without an instancer.",
             "Each is a Modified Version under the SIL Open Font License 1.1 and ships with its family's licence text",
             "(condition 2); no shipped family declares a Reserved Font Name. Static fonts are used from their tracked",
             "source files and are not copied here. Do not edit; regenerate with `gen_all.py`.", "",
             "| File | Family | Axes | Source | Licence | Used by |", "|---|---|---|---|---|---|"]
    for f, row in sorted(rows.items()):
        axes = ", ".join(f"{k} {v:g}" for k, v in sorted(row["axes"].items()))
        lines.append(f"| `{f.rsplit('/', 1)[-1][:16]}…` | {row['family']} | {axes} | `{row['source']}` | "
                     f"`{row['licence'].rsplit('/', 1)[-1]}` | {', '.join(sorted(set(row['uses'])))} |")
    return "\n".join(lines) + "\n"


def main(root=REPO) -> dict:
    ensure_public()
    out = Out(root)
    reg = FontRegistry()
    for d in FONT_DIRS:
        reg.register_dir(d)
    licences, shipped, records, written, tables, by_input = licence_texts(), {}, [], {}, {}, {}
    for (family, weight, style, axes), use in requests():
        key_in = json.dumps([family, weight, style, axes], sort_keys=True)
        if key_in in by_input:                                  # the same request from two users: one record
            by_input[key_in]["uses"].append(use)
            continue
        face = reg.resolve(family, weight, style, axes)
        inst = face._instance_bytes  # noqa: SLF001  (the bytes the oracle shapes, measures and embeds)
        inst_sha, src_bytes = sha(inst), face.path.read_bytes()
        source_file = face.path.relative_to(REPO).as_posix()
        if inst_sha == sha(src_bytes):
            instance_file, licence_file = source_file, None     # unmodified static font: use the tracked file
        else:
            fam_key = face.family.lower().replace(" ", "")
            if fam_key not in licences:
                raise SystemExit(f"no OFL licence text for {face.family} ({face.path}); an instance must ship with it")
            licence_file = (FONTS / f"{licences[fam_key].parent.name}-{licences[fam_key].name}").as_posix()
            shipped[licence_file] = licences[fam_key]
            instance_file = (FONTS / "instances" / f"{inst_sha}.ttf").as_posix()
            if inst_sha not in written:
                out.bytes(instance_file, inst)
                written[inst_sha] = instance_file
        if inst_sha not in tables:
            tables[inst_sha] = font_tables(inst)
        glyphs = []
        for ch in dict.fromkeys(SAMPLE):
            cp = ord(ch)
            if face.has_glyph(cp):
                gid = face.glyph_id(cp)
                top, bottom = face.glyph_ink_mm(gid, 10.0)
                glyphs.append({"cp": cp, "gid": gid, "advance_mm_at_10pt_hex": fhex(face.advance_mm(gid, 10.0)),
                               "ink_top_mm_at_10pt_hex": fhex(top), "ink_bottom_mm_at_10pt_hex": fhex(bottom)})
        rec = {
            "schema": "pageinator.golden.font/2",
            "input": {"family": family, "weight": weight, "style": style, "axes": axes},
            "uses": [use],
            "expected": {
                "font_id": face.font_id, "family": face.family, "weight": face.weight, "style": face.style,
                "axes": {k: float(v) for k, v in face.axes.items()},
                "source_file": source_file, "source_sha256": sha(src_bytes),
                "instance_sha256": inst_sha, "instance_file": instance_file, "licence_file": licence_file,
                "units_per_em": face.units_per_em, "metric_source": face.metric_source,
                "ascent_mm_at_1pt_hex": fhex(face.ascent_mm_at_1pt), "descent_mm_at_1pt_hex": fhex(face.descent_mm_at_1pt),
                "line_gap_mm_at_1pt_hex": fhex(face.line_gap_mm_at_1pt),
                "ink_ascent_mm_at_1pt_hex": fhex(face.ink_ascent_mm_at_1pt),
                "ink_descent_mm_at_1pt_hex": fhex(face.ink_descent_mm_at_1pt),
                "line_box_mm_at_10pt_hex": fhex(face.line_box_mm(10.0)),
                "min_baseline_gap_mm_at_10pt_hex": fhex(face.min_baseline_gap_mm(10.0)),
                "glyphs": glyphs,
            },
        }
        by_input[key_in] = rec
        records.append(rec)
    for rel, src in sorted(shipped.items()):      # each copied instance travels with its licence (SIL OFL 1.1, cond. 2)
        out.bytes(rel, src.read_bytes())
    out.bytes(FONTS / "README.md", readme(records).encode("utf-8"))
    out.jsonl_gz(GOLDENS / "fonts" / "registry.jsonl.gz", records)
    out.json_gz(GOLDENS / "fonts" / "tables.json.gz", dict(sorted(tables.items())))
    counts = {"requests": sum(len(r["uses"]) for r in records), "records": len(records), "instances": len(tables),
              "instance_files": len(written), "licence_texts": len(shipped),
              "sample_glyphs": sum(len(r["expected"]["glyphs"]) for r in records),
              "glyph_advances": sum(t["glyph_count"] for t in tables.values())}
    out.json(GOLDENS / "fonts" / "info.json", {"schema": "pageinator.golden.fonts/2", "counts": counts,
                                               "instance_files": sorted(written.values()), "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
