"""PDF-tooling capability probe: font subsetting with retained glyph IDs (fontTools).

EXPERIMENTAL / EVIDENCE TOOLING. Answers one narrow question for the PDF plan:
can the oracle's own toolchain subset an instanced Devanagari variable font while KEEPING the
HarfBuzz glyph IDs (required for an Identity CIDToGIDMap, ADR-006 / 08 §4), and how big is it?
It does NOT write a PDF and proves nothing about PDF/X or press acceptance.

Usage: tools/oracle/v0/.venv/bin/python experiments/phase0/pdf_probe/subset_probe.py
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "typeset_harness"))
import common as C  # noqa: E402
from fontTools import subset  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402
from fontTools.varLib.instancer import instantiateVariableFont  # noqa: E402

results = {}
for fam, rel, lang, text_id in [("Noto Serif Devanagari", "assets/fonts/devanagari/NotoSerifDevanagari[wdth,wght].ttf", "mr", "mr-body-12"),
                                ("Source Serif 4", "assets/fonts/latin/SourceSerif4[opsz,wght].ttf", "en", "en-body-02")]:
    text = next(t["text"] for t in C.load_corpus() if t["id"] == text_id)
    sh = C.shape_paragraph(text, lang, fam, 9.5)
    gids = sorted({g for r in sh.runs for g in r.glyph_ids})
    src = C.ORACLE / rel
    f = TTFont(src)
    if "fvar" in f:
        f = instantiateVariableFont(f, {a.axisTag: a.defaultValue for a in f["fvar"].axes})
    order = f.getGlyphOrder()
    names = [order[g] for g in gids]
    opts = subset.Options(); opts.retain_gids = True; opts.notdef_outline = True; opts.layout_features = []
    opts.name_IDs = ["*"]; opts.recalc_timestamp = False
    sub = subset.Subsetter(options=opts); sub.populate(glyphs=names); sub.subset(f)
    buf = io.BytesIO(); f.save(buf)
    g2 = TTFont(io.BytesIO(buf.getvalue()))
    order2 = g2.getGlyphOrder()
    # Compare OUTLINES at each used glyph ID (names can be re-synthesised when post is format 3).
    gs1, gs2 = f.getGlyphSet(), g2.getGlyphSet()
    from fontTools.pens.recordingPen import RecordingPen
    def outline(gs, name):
        pen = RecordingPen(); gs[name].draw(pen); return pen.value
    same_outline = all(outline(gs1, order[g]) == outline(gs2, order2[g]) for g in gids if g < len(order2))
    retained = len(order2) > max(gids) and same_outline
    name_changes = sum(1 for g in gids if g < len(order2) and order2[g] != order[g])
    results[fam] = {"source_bytes": src.stat().st_size, "unique_glyphs_used": len(gids),
                    "subset_bytes": len(buf.getvalue()), "glyph_ids_retained": retained, "glyph_names_changed": name_changes, "post_format": float(g2["post"].formatType),
                    "outline_format": "CFF" if "CFF " in g2 else "TrueType(glyf)",
                    "fsType": g2["OS/2"].fsType, "note": "instanced at default axes; layout tables dropped (positions come from the kernel)"}
out = C.REPO / "experiments" / "phase0" / "results" / "pdf_probe"; out.mkdir(parents=True, exist_ok=True)
(out / "subset_probe.json").write_text(json.dumps({"results": results, "env": C.environment()}, indent=2) + "\n")
print(json.dumps(results, indent=1))
