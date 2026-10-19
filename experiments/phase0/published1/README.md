# EXP-PUBLISHED-1 measurement tooling (EXPERIMENTAL / EVIDENCE ONLY)

These tools measure the body typography of **real published newspaper PDFs**: geometry, words per line, word spacing, alignment and line-end breaks.

They are **not production code**, and nothing here is an architecture decision. The protocol is in `docs/phase0/EXP_PUBLISHED_1.md`.

**Data classes are never mixed**:
- `PILOT_EVIDENCE`
- `TOOL_VALIDATION_SAMPLE`
- `GROUND_TRUTH_TOOL_VALIDATION_FIXTURE`

## Environment
The tooling has its own isolated venv. The frozen oracle venv is not touched.

```bash
cd experiments/phase0/published1
uv venv --python 3.11.14 .venv && uv pip install --python .venv/bin/python --require-hashes -r requirements.lock
```

Dependencies, all permissive:

| Package | Licence | Purpose |
|---|---|---|
| pdfminer.six | MIT | Glyph geometry |
| pypdfium2 / PDFium | BSD-3 / Apache-2.0 | Overlay rendering |
| fontTools | MIT | Font program inspection |

Ghostscript and MuPDF are **not used**: both are AGPL.

## Files

| File | Role |
|---|---|
| `schema.py` | Dataset classes, confidence levels, **tolerances fixed before pilot data** (with a revision log), tokenization policy |
| `extract.py` | PDF → raw glyph geometry JSON (raw evidence, never overwritten) |
| `measure.py` | Raw → measurement: gutters/columns, frames, lines, tokens, gaps, space ratios, alignment classes, breaks, tracking, h-scale, font-width metric |
| `corrections.py` | Human corrections → `corrected.json` (raw and measure files stay untouched) |
| `overlay.py` | PDFium page render + SVG overlay (columns, lines, classes, gaps, breaks) |
| `report.py` | Report sections A–L. Section K (comparison with EXP-COMPOSE-1) runs **only** for `PILOT_EVIDENCE` |
| `run.py` | Dataset → full pipeline. **Refuses** `PILOT_EVIDENCE` inside the git repo unless the path is git-ignored |
| `intake/` | DATASET / manifest / corrections templates |
| `validation/make_fixtures.py` | Ground-truth fixtures (Chrome print-to-PDF plus DOM truth). Output in `validation/build/`, which is gitignored |
| `validation/validate.py` | Tool vs ground truth → `../results/published1/validation/validation_report.json` |
| `actualtext.py` | Exact text of measured lines from the PDF's `/ActualText` spans + ToUnicode, in content order. Validated 26/26 lines against a hand check |
| `paragraphs.py` | Complete, verified published paragraphs (text ↔ geometry word counts must agree; single font; no breaks) → private `paragraphs.jsonl` |
| `extract_frames.py` | Selected body frames: high-resolution crop, per-line classes, gaps, and both libraries' text-layer readings (diagnostic only). Writes into the private dataset |
| `walkthrough.py` | Self-contained private HTML walkthrough (overlays, charts, side-by-side, capability table). Standard library only. Writes into the private dataset |
| `font_width_reference.py` | EXP-COMPOSE-1 fonts' width metric (runs in the oracle venv) → `../results/published1/font_width_reference.json` |

## Run on a dataset
```bash
.venv/bin/python run.py "$PAGEINATOR_PRIVATE_CORPUS/<dataset>"       # pilot data: private location only
```
