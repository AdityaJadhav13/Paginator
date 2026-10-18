"""Compute the font-file-free width metric (mean advance of advancing glyphs, em) for the seven EXP-COMPOSE-1
Devanagari fonts on the Phase 0 Marathi corpus — a REFERENCE for comparing pilot PDFs (EXPERIMENTAL).
Runs in the frozen-oracle venv (shaping only; oracle not modified).
Usage: tools/oracle/v0/.venv/bin/python experiments/phase0/published1/font_width_reference.py
"""
import json, statistics as st, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "compose1")); sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402
import run_matrix as R  # noqa: E402
texts = [t for t in C.load_corpus() if t["kind"] == "body" and t["lang"] == "mr"]
out = {}
for lab, fam, axes, wt in R.FONTS["Deva"]:
    adv = []
    for t in texts:
        sh = C.shape_paragraph(t["text"], "mr", fam, 9.5, weight=wt, axes=axes)
        em = 9.5 * C.MM_PER_PT
        for r in sh.runs:
            for gi, a in enumerate(r.x_advances_mm):
                if a > 0.01 * C.MM_PER_PT and t["text"][r.cluster_map[gi]] != " ":
                    adv.append(a / em)
    out[lab] = {"mean_advancing_glyph_em": round(st.mean(adv), 4), "n_glyphs": len(adv)}
res = HERE.parent / "results" / "published1"; res.mkdir(parents=True, exist_ok=True)
(res / "font_width_reference.json").write_text(json.dumps({"metric": "mean advance of advancing non-space glyphs, em (shaped by HarfBuzz via oracle-v0)",
    "corpus": "Phase 0 Marathi body corpus (synthetic)", "fonts": out, "env": C.environment()}, indent=1) + "\n")
print(json.dumps(out, indent=1))
