# EXP-PAGE-1: rebuild the pilot's printed pages with Pageinator (EXPERIMENTAL / EVIDENCE ONLY)

**Removable without affecting Pageinator.** This is not the production layout engine and not an engine-language decision.

- The frozen oracle is used only for shaping (through `compose3/composer3.py` and `head1/headliner.py`, imported read-only).
- The PDF writer is EXP-PDF-1's (`pdfx1/pdfx.py`), the page builder extends `pdfx1/make_press_test.PageBuilder`.
- Free OFL stand-in fonts (Noto Serif / Sans Devanagari) replace the house fonts until the owner supplies them.

| File | Role | Environment |
|---|---|---|
| `page_model.py <dataset>` | Turns every printed page into a **page model**: stories (kicker, headline, decks, byline, body columns in reading order with exact text, paragraphs and crossheads, captions, images, jump lines), rules, boxes, images, ads and furniture. Private output | `published1/.venv` |
| `house_profile.py <dataset>` | Learns the paper's **design language** from all editions: page geometry, grid (and its N→N−1 column sets), type per role, headline size by span, vertical spacing, rules and boxes, images, furniture, page types, headline shape practice, composer defaults. Aggregates in the repo, a plain-language summary private | `published1/.venv` |
| `photos.py <dataset> --profile <newsprint .icc> [names]` | The printed **photos** (native pixels with mask, cropped to the visible box, at most 200 ppi) and **ads** (a 200 dpi raster of the printed page) converted to newsprint CMYK with littleCMS (perceptual, black-point compensation). Cut-outs are flattened onto the colour printed behind them; total ink is reported per raster. Private output (`report/page1/photos/`) | `pdfx1/.venv` |
| `textfix.py` | Shared text fix: Wingdings bullets that the PDF text layer decodes as letters are set as "•" | (imported) |
| `brand.py <dataset> --profile <newsprint .icc> --masthead <image>` | The paper's masthead artwork (supplied by the owner) converted to newsprint CMYK like the photos; `compose_page` draws it in place of the masthead lettering. Private output (`report/page1/brand/`) | `pdfx1/.venv` |
| `compose_page.py <dataset> [names \| model.json] [--out DIR] [--size story\|paper] [--photos]` | With `--photos`, draws the converted photos and ads (graphics stay placeholders, drawn beneath photos). **Rebuilds** each page from its model into PDF/X-1a: body flows through the printed columns (EXP-COMPOSE-3 policy, per-story calibrated stand-in), headlines and decks with the head1 composer at the printed line count (shape "fill" + house pairs), crossheads first-fit, short text at printed positions, rules and boxes as printed, images/graphics/ads as labelled placeholders. Private output + manifest | oracle `.venv` |
| `compare_page.py <dataset>` | Compares each rebuild with print: renders (side by side, overlay), the independent PDF/X checker, story depth (G1 A7), words-in-order integrity, identical-break rates; picks the page to print by a rule fixed in advance; aggregates to the repo, a walkthrough to the private folder | `pdfx1/.venv` |

**Outputs:**
- **Repo (aggregates only, no text, ids, dates or names):** `experiments/phase0/results/page1/` (`page_model_coverage.json`, `house_profile.json`, `summary.json`).
- **Private:** `<dataset>/report/page1/` (`pages/`, `rebuilt/`, `compare/` with `walkthrough.html`, `house_profile.md`, figures, overlays).

**Report:** `docs/phase0/EXP_PAGE_1_REPORT.md`.
