# EXP-GEN-1: Pageinator lays out a page itself (EXPERIMENTAL / EVIDENCE ONLY)

**Removable without affecting Pageinator.** This is not the production layout engine and not an engine-language decision.

- Typesetting comes from EXP-PAGE-1 (`page1/compose_page.py`), and through it from `head1` and `compose3`. The frozen oracle is used only for shaping.
- No AI is used. The search is deterministic.

| File | Role | Environment |
|---|---|---|
| `generate.py <dataset> [pages]` | For each held-out Marathi page, lays out the page's stories itself: a guillotine search over real typeset module heights, using the learned design profile (`results/page1/house_profile.json`) and frequencies counted on the calibration editions. Renders PDF/X-1a with the fixed parts, writes a manifest, and writes a PDF of the fixed parts alone. Private output; aggregates in `results/gen1/summary.json` (full runs only) | oracle `.venv` |
| `inkcheck.py` | Ink collisions between text lines from the real glyph outlines (pikepdf content stream + embedded TrueType outlines, rasterised); used by `check_gen.py` | `pdfx1/.venv` (imported) |
| `check_gen.py <dataset>` | Checks every generated page: PDF/X checker, text completeness (every paragraph and display part), geometry, glyph collisions against the fixed parts alone, and house-style measures. Writes private side-by-side images with print; aggregates in `results/gen1/check.json` | `pdfx1/.venv` |

Prerequisites: EXP-PAGE-1's `page_model.py`, `house_profile.py` and `photos.py` outputs.

**Report:** `docs/phase0/EXP_GEN_1_REPORT.md`.
