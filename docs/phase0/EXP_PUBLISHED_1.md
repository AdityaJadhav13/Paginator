# EXP-PUBLISHED-1: Real Published Marathi Newspaper Typography Measurement

**Status: FIRST PILOT DATASET MEASURED (2026-10-11).** Aggregate results are in **§12**; the files themselves stay private.
- The tooling is built and validated against ground truth (**204/204 checks**, re-run after each revision in §6).
- One owner-supplied dataset (16 edition PDFs, 2 months, **evidence level A**: the owner confirmed these exact files went to press) was taken in under §3 and is stored in `$PAGEINATOR_PRIVATE_CORPUS`, never in git.
- The owner permitted internal testing and aggregate numbers (not content) in design docs (2026-10-11). Page images, text and font files stay private.

Tooling lives in `experiments/phase0/published1/` (README there). Validation evidence is in `experiments/phase0/results/published1/`.

## 1. Question
How do real Marathi newspapers compose body text at production column widths? Specifically:
- justification style;
- word-space distribution;
- words per line;
- word breaking;
- fonts, sizes, leading and column widths;
- handling of long tokens and mixed script.

The answer will be **observed**, not assumed.

## 2. Evidence classes and quality (never mixed)

| Class | Use | May enter the pilot dataset? |
|---|---|---|
| `PILOT_EVIDENCE` | Real pilot newspaper files with recorded permission | Yes, and only these |
| `TOOL_VALIDATION_SAMPLE` | A legally usable public sample, used **only** to test the tooling | No |
| `GROUND_TRUTH_TOOL_VALIDATION_FIXTURE` | Synthetic files with known geometry | No |

The pipeline refuses to mix classes inside a dataset. The report marks non-pilot data **"NOT NEWSPAPER EVIDENCE"** and withholds the comparison with EXP-COMPOSE-1.

**Evidence levels**, recorded per sample:

| Level | Source | Status in Phase 0 |
|---|---|---|
| **A** | Production PDF sent to press | **Supported** |
| **B** | Published or e-paper PDF with vector text | **Supported** |
| **C** | Layout export plus final PDF | **Supported** (PDF part) |
| **D** | Scan of printed page | **Not yet supported.** Raster analysis is deferred until we know what the pilot can provide (prompt §28) |
| **E** | Photograph with scale | **Not yet supported.** Same reason |

Level D and E samples may be logged in the intake, but are measured manually or not at all for now. They must never be reported as equivalent to A or B.

## 3. Intake workflow (pilot files can be dropped in immediately)

**1. Store privately.** Use `$PAGEINATOR_PRIVATE_CORPUS/<dataset_id>/`, by default `~/PageinatorPrivate/published1/`.
- **Never** store pilot data inside the git repo. `run.py` refuses a `PILOT_EVIDENCE` dataset inside the repo unless its path is git-ignored.
- Pilot font files also stay private. Fixtures reference fonts by hash only.

**2. Lay out the dataset:**
```
<dataset>/DATASET.json                         (intake/DATASET.template.json)
<dataset>/samples/<sample_id>/source.pdf       (as received, never modified)
<dataset>/samples/<sample_id>/manifest.json    (intake/manifest.template.json — provenance)
<dataset>/samples/<sample_id>/corrections.json (optional, after visual review)
```

**3. Fill in the manifest (provenance, prompt §37).** Fields:

| Group | Fields |
|---|---|
| Source | publication, edition, edition date, page, section |
| File | source type, evidence level, went to press?, final?, **SHA-256**, date received, received from, producing software |
| Fonts | fonts declared by the pilot: family, version, licence, file hash, private location |
| Permissions | confidentiality, **permission to retain**, **internal use**, **regression tests** |

`run.py` verifies the file hash and the required fields.

**4. Run:** `experiments/phase0/published1/.venv/bin/python experiments/phase0/published1/run.py <dataset>`

**5. Review every overlay** (`work/<sample>/overlay/page-NN.overlay.svg`) before reading any statistic.

**6. Correct** in `corrections.json`. Available operations:
- exclude a sample, frame or line;
- set a line's class;
- confirm or reject a break, with the verified word and break offset (this computes hyph-mr consistency);
- set a font;
- set column edges;
- annotate.

The raw extraction and automated measurement are never overwritten. Corrected items are marked `MANUALLY_VERIFIED`.

**7. Re-run, then read the report** (`report/report.md`, sections A–L).

**8. STOP.** Compare with EXP-COMPOSE-1 (§9) and recommend EXP-COMPOSE-2 only if justified. **Do not modify the composer.**

## 4. What to request from the pilot

These requests are also listed in `G0_EXTERNAL_EVIDENCE_PACKAGE.md` §4.

**Pages: at least 6, ideally 10–15**, across at least 2 edition dates. Cover:
- front page;
- local;
- politics/news;
- editorial/opinion;
- sports;
- business;
- a dense body-copy page;
- a page with ads;
- a page mixing English and Marathi.

**Preferred form:** the original production PDFs sent to press (level A), plus the printed pages for visual comparison. Also ask for:
- font names and licences, and font files only where the licence permits sharing;
- page dimensions;
- layout source information if available.

**Sample-size design** (minimums for a credible first read):

| Minimum | Why |
|---|---|
| ≥ 600 body lines in total (hundreds per section type, if possible) | Gives about ±4 percentage points (95% CI) on line-level shares around 50%, and about ±1.8 points on a 5% break rate |
| ≥ 30 body frames from ≥ 20 articles | Lines within one article are correlated, so frame-level variability must also be reported |
| ≥ 2 edition dates | — |

**One attractive paragraph is never a result.**

## 5. Measurement definitions

| Quantity | Definition | Confidence |
|---|---|---|
| Page size and boxes | MediaBox, TrimBox, BleedBox in mm | EXACT |
| Columns / frames | Gutters = x-intervals ≥ 1 mm with zero glyph coverage across ±6 neighbouring baselines. Frames = vertically continuous lines in one column with consistent size. Column edges: left = flush-left lines (lower quartile of line starts); right = the x1 value most lines agree on (±0.5 pt cluster), else max (ESTIMATED) | DERIVED / ESTIMATED |
| Body frames | Size within ±0.3 pt of the page's dominant text size, with ≥ 3 lines. Headlines, captions and ads are recorded but excluded from body metrics | ESTIMATED; correctable |
| Font | Embedded BaseFont name, subtype, embedded/subset, ToUnicode presence. The family is never guessed from appearance | EXACT (name) / UNKNOWN (identity) |
| Size | Rendered size from the text matrix | EXACT |
| Leading | **Mean** of regular baseline deltas, with the distribution reported (renderers may snap baselines) | DERIVED |
| Token / word | Geometry only (see the tokenization policy in `schema.py`): gaps ≥ 0.12 em split tokens. Space glyphs are not trusted. Punctuation-only tokens are excluded from word counts | DERIVED |
| Words per line | Tokens on non-final lines: mean, median, p10, p90, min, max, plus histogram | DERIVED |
| Word gap | Next token's first glyph origin minus the previous token's last advance end | DERIVED |
| Space ratio | Gap ÷ nominal space. Nominal space comes from, in order: the PDF width table via ToUnicode U+0020 (EXACT); the embedded font program (DERIVED); the median gap on ragged/final lines (ESTIMATED); otherwise UNKNOWN. **Word–word gaps are reported separately from punctuation-adjacent gaps**, because fonts kern punctuation against spaces (validated: 0.82×) | as source |
| Line class | FULLY_ALIGNED: right slack ≤ 0.25 pt. NEAR_ALIGNED: slack ≤ 1 nominal space. RAGGED: otherwise. FINAL_PARAGRAPH_LINE: last line, or next line indented ≥ 0.5 em, or paragraph gap > 1.4 × leading, or (in a mostly aligned frame) natural spacing plus sentence punctuation. SPECIAL_CASE: single-token, off-size, left offset > 3 em, overhang | DERIVED / ESTIMATED |
| Paragraph policy (observed) | Per frame: FULL_JUSTIFICATION (≥ 90% of non-final lines fully aligned) / RAGGED (≤ 10% aligned, unaligned lines at ~1.0×) / HYBRID_LIKE (unaligned lines at natural spacing) / CONSTRAINED_LIKE (unaligned lines at expanded spacing) / OTHER. **Observed geometry, not the application's setting** | ESTIMATED |
| Line-end break | The last glyph is a hyphen-class glyph and a next line exists. This is a **candidate**: it may be a real compound hyphen. Fragment text order is unreliable for Devanagari, and hyph-mr consistency requires manual verification. **Breaks without a hyphen are not detected automatically** and must be annotated by hand | ESTIMATED → MANUALLY_VERIFIED |
| Break frequency | Per 100 lines; per 100 words; consecutive pairs; estimated one-akshara fragments | DERIVED / ESTIMATED |
| Long tokens | Token width ≥ 50% of the frame width, listed with the line's class and flags | DERIVED |
| Mixed script | Token class from Unicode blocks (block membership survives Devanagari reordering). Spacing and class compared for lines with and without Latin | DERIVED |
| Tracking | Median gap between consecutive advancing glyphs inside tokens | DERIVED |
| Glyph scaling | Text-matrix a/d | EXACT |
| Font width (no font file needed) | Mean advance of advancing glyphs in em, normalised by h-scale. **Compare with EXP-COMPOSE-1 fonts** in `font_width_reference.json`: Noto Serif Devanagari w100 0.472 · w87.5 0.436 · w75 0.402 · Noto Sans w100 0.502 · w75 0.418 · Mukta 0.501 · Tiro 0.535. If the pilot's real font file is supplied legally, its metrics can also be computed directly | DERIVED |

## 6. Tolerances

**Fixed before any pilot data.** Defined in `schema.TOL`, with a revision log.

| Tolerance | Value | Justification |
|---|---|---|
| Geometry (edges, widths) | ±0.10 mm | PDF numbers ≤ 0.0005 pt; browser layout 1/64 px. More than 10× headroom, far below one word space (~0.8 mm) |
| Word gap (vs DOM truth) | ±0.05 mm | Same reasoning |
| Font size | ±0.05 pt | — |
| Leading | ±0.05 pt | Production PDFs. Fixture checks allow 0.75/(n − 1) pt for Chrome's pixel snapping |
| Space ratio | median ±0.02; per gap ±0.05 | — |
| Horizontal scale | ±0.005 | — |
| Tracking | ±0.05 pt | — |
| FULLY_ALIGNED | ≤ 0.25 pt (0.09 mm) | DTP justifies exactly; covers coordinate rounding |
| NEAR_ALIGNED | ≤ 1 nominal space | A line short by less than one space looks justified-ish; beyond that it reads as ragged |
| Word-gap threshold | 0.12 em | Natural spaces 0.22–0.30 em; compressed spaces ≥ about 0.18 em; in-word kerning/tracking typically < 0.05 em |

**Revisions made during TOOL VALIDATION (2026-10-08, before any pilot file existed)**, each prompted by a ground-truth failure:

| Changed | From | To | Reason |
|---|---|---|---|
| Baseline grouping | 0.20 pt absolute | 0.15 em | Real lines had runs offset by 0.28 pt |
| Column detection | Left-edge clustering | Gutter detection | Clustering found spurious columns inside justified text |
| Space glyphs | Trusted as word boundaries | Not trusted | Chrome maps an unbroken soft hyphen to a zero-advance glyph with ToUnicode U+0020 |
| Punctuation-adjacent gaps | Pooled with other gaps | Reported separately | Kerning |
| Leading | Mode | Mean | Pixel snapping |

**Revisions made AFTER the first pilot data (2026-10-11).** Each was prompted by the protocol's overlay review (§3 step 5) and re-validated at 204/204. **No tolerance value changed.**

| Changed | From | To | Reason |
|---|---|---|---|
| Space-only lines (`1.0.1`) | Crashed frame measurement | Skipped and counted (`space_only_lines_skipped`) | InDesign PDFs contain baselines made only of space glyphs |
| Gutter detection (`1.1.0`) | Coverage from glyphs near the page's single dominant size | Coverage computed per size group of each line | Stories set at different body sizes were invisible to gutter detection, so adjacent columns merged |
| Body frame rule (`1.1.0`) | Size within ±0.3 pt of the page's dominant size | Page's dominant font (subset tag ignored) within 0.8–1.25 × the dominant size, ≥ 3 lines (`body_size_rel_band`) | The old rule dropped most body copy on multi-size pages; single-size pages behave as before |

## 7. Tool validation result

8 ground-truth fixtures were generated with headless Chrome 154 from controlled HTML, using static OFL Devanagari fonts: Mukta and Tiro Devanagari Hindi.

| Fixture | Purpose |
|---|---|
| GT-A | Left-aligned, natural spacing |
| GT-B | Word spacing 1.5× |
| GT-C | Justified Tiro |
| GT-D | 8-column broadsheet, justified (318 × 510 mm, 30.25 mm columns) |
| GT-E | Manual soft-hyphen breaks, justified |
| GT-F | Mixed script, URL, email, numbers |
| GT-G | Letter-spacing 0.3 pt |
| GT-H | Horizontal scale 0.9 |

Plus fallback checks.

**Result: 204 / 204 checks pass** (`results/published1/validation/validation_report.json`). Validated:

| Check | Result |
|---|---|
| Columns (8/8 detected) | Left edges and widths within ±0.1 mm |
| Font size | Within ±0.05 pt |
| Leading | Within tolerance |
| Line counts | Exact |
| Per-line token counts | ≥ 99% of lines |
| Word–word gaps vs DOM | ±0.05 mm for ≥ 99% |
| Known spacing ratio | 1.0× and 1.5× recovered (median ±0.02; per gap ±0.05 for ≥ 99%) |
| Justified vs left-aligned classification | Correct |
| Hyphen breaks vs DOM split words | Exact |
| Latin-containing lines | Exact |
| Tracking | 0.3 pt recovered |
| Horizontal scale | 0.9 recovered |
| ESTIMATED nominal space (no space info) | Within 0.3% |
| Font-width metric vs HarfBuzz reference | Within 0.5% (Mukta) and 1.1% (Tiro) |

**Fixture limitations** (reported, not hidden):
- **GT-H column-left.** Chrome's print path offsets transformed text by 0.11 mm relative to its own DOM. The check compares against the PDF's text-matrix origin instead, which is a weaker check.
- **Chrome artifacts.** Baseline snapping; requested page sizes quantised (210 mm → 209.89 mm).
- **Validation fixtures are Chrome PDFs.** Newspaper PDFs from InDesign, QuarkXPress or legacy DTP may encode text differently (TJ kerning, Type3/Type1 fonts, missing ToUnicode). The tool tolerates this by design (geometry first; fallback chain), but **its first pilot run must be reviewed against overlays**.

**This validates the TOOL. It says nothing about Marathi newspaper typography.** In particular, Chrome's justification of the synthetic text, with very wide spaces visible in the GT-D overlay, is **not evidence**.

## 8. Known limitations (to watch on the first pilot run)
- Unhyphenated line-end word breaks cannot be detected without linguistic knowledge. A human must annotate them.
- Devanagari text extracted from PDFs is often mis-ordered (pre-base matras, reph). Text-dependent fields (break fragments, hyph-mr consistency) are ESTIMATED until manually verified.
- Pages that mix column grids across vertical bands are handled through a local window of ±6 lines. Complex layouts may need `set_column` corrections.
- Rotated text, and text in Type3 fonts without widths, are excluded or reduced in confidence.
- Ads containing live text may be detected as frames. They must be excluded by correction if they are not editorial.
- Raster inputs (levels D and E) are not supported yet.
- *(Seen in the first pilot run.)* Some commercial Devanagari fonts have ToUnicode maps that lose conjunct order. Geometry is unaffected, but the glyph-level text in `raw.json` (break fragments, one-akshara estimates) is unreliable. Adobe PDF Library output also carries the exact text in `/ActualText` spans; `actualtext.py` reads it (validated 26/26 lines). Use it for any text-dependent analysis.
- *(Seen in the first pilot run.)* Full-width imprint/footer text, small boxes and residual column merges can pass the body rule. Exclude them with `exclude_frame` corrections after reviewing the overlays.
- *(Seen in the first pilot run.)* Horizontal scaling can vary by story. It is measured per token (`hscale`) and should be reported per line and per frame.
- *(Seen in the first pilot run.)* **The font-width metric (mean advance per advancing glyph) is not comparable across fonts.** Fonts split the same text into different glyph sequences (conjuncts, matras), so a per-glyph figure misstates relative width; on the first pilot column it mis-sized a stand-in font by 3.7%. Compare fonts by **em per character on the same text** instead (`compose2/house_compare.py` calibrates this way).

## 9. Report and comparison (when pilot data exists)

`report.py` produces sections:

| Section | Content |
|---|---|
| A | Dataset |
| B | Evidence quality |
| C | Page geometry and column-width distribution |
| D | Typography: fonts, sizes, leading, glyph scaling, tracking, font-width metric |
| E | Words per line |
| F | Word spacing |
| G | Alignment and observed policy per frame |
| H | Word breaking |
| I | Long tokens |
| J | Mixed script |
| K | Comparison with EXP-COMPOSE-1, **only for PILOT_EVIDENCE**, covering column width, size, words/line median and p90, breaks per 100 lines, space-ratio median and p95, against the synthetic references |
| L | Implications, **written by a human** |

**The comparison table is deliberately not created now.**

## 10. Decision tree (prepared; no outcome is preselected)

| Outcome | Evidence pattern in the report | Likely implication |
|---|---|---|
| A | FULL_JUSTIFICATION frames, moderate spacing (p95 ≤ ~2×), words/line clearly above our 3–6.6 | Our font/size/column assumptions were wrong. Re-run EXP-COMPOSE-1 at the pilot's geometry |
| B | FULL_JUSTIFICATION with frequent verified in-word breaks | Marathi break policy becomes central (hyph-mr licence and linguistic validation) |
| C | Spacing p95 well above 2× in pages editors accept | Our 2× threshold is too strict. Human evaluation decides |
| D | HYBRID_LIKE / CONSTRAINED_LIKE frames | Pageinator needs comparable composition families (already prototyped) |
| E | RAGGED frames | Full justification was a wrong requirement |
| F | A notably narrower font-width metric than our fonts (≤ ~0.40 em), possibly legacy or proprietary | Font metrics and font migration become central (P0-11, P0-12) |
| G | The pilot's own pages show large gaps or imperfect composition | The target is "meet or exceed accepted newsroom quality", not an idealised standard |

Outcomes may combine. **After the report: STOP, compare, recommend EXP-COMPOSE-2 only if justified.**

## 11. Readiness checklist (prompt §45)

| # | Condition | Status |
|---|---|---|
| 1 | Measurement tool exists | ✅ extract / measure / corrections / overlay / report / run |
| 2 | Controlled ground-truth tests prove it accurate enough | ✅ 204/204 within pre-defined tolerances (fixture limitations listed) |
| 3 | Provenance and confidentiality handling defined | ✅ manifest schema, dataset classes, private storage, in-repo pilot data refused (guard tested) |
| 4 | Pilot intake format ready | ✅ `intake/` templates, §3 workflow, §4 request list |
| 5 | Real files can be dropped in without redesign | ✅ end-to-end dry run on a ground-truth dataset (3 samples, corrections path exercised) |
| 6 | No fake real-world conclusions | ✅ none. Non-pilot reports are labelled and comparisons withheld |

**READY FOR PILOT DATA.**

## 12. First pilot run: aggregate results (2026-10-11)

Owner-supplied Marathi daily, 16 InDesign CS6 PDFs (Adobe PDF Library 10.0.1), 27–28 Aug and 4–16 Nov 2025, 347 × 540 mm pages. **Evidence level A.** Tool `published1/1.1.0`. One duplicate export is excluded, and 44 non-body frames (193 lines: imprint, boxes, residual merges) are excluded by rule, pending human confirmation. Overlays of all pages were reviewed before reading statistics.

| Measure | Result |
|---|---|
| Measured | 15 editions · 68 pages · 1,261 body frames · **23,921 body lines** (21,824 non-final) · 103,133 words |
| Grid (DERIVED) | **8-column base grid: 36.5 mm columns, ≈ 4.1 mm gutters**, columns every 40.6 mm from ≈ 13 mm; a **6-column variant (50 mm)**. Other widths (44.5, 46.5, 56.5 mm) look like text wraps |
| Body type | `FourCMRBody` (embedded name table: 4CPlus, vendor ID `4CPL`, `fsType` 8 = editable embedding; licence terms not in the font). Median 12 pt on 13 pt (leading ÷ size 1.08). Several body sizes per edition (12, 13, 12.5, 9.8, 14 pt) |
| Font width (same text) | **0.305 em per character** on one fully transcribed column (610 characters), against 0.337–0.396 for the OFL test fonts on the same words. A narrow face (outcome F) |
| Alignment | **90.3% of non-final body lines fully justified**; 5.5% near-aligned; 3.2% ragged |
| Words per line | Median 4, mean 4.4, p10 3, p90 6 (inside the synthetic corpus range: outcome A does not apply) |
| Word spacing (gap ÷ the font's own space, EXACT from PDF widths) | Median **1.61×**, p90 3.3×, **p95 4.2×**; **32.8% of gaps exceed 2×**. Justified-line p95 by width: 20–40 mm 4.9×, 40–48 mm 4.5×, 48–60 mm 3.8×, ≥ 60 mm 2.5× |
| Space compression | 5.7% of justified lines set spaces below 0.8×; the tightest 1% reach **0.66×** |
| Horizontal glyph scaling | **66% of body lines are not at 100%** (p5 96.2%, p95 107.5%). Set per story: only 112 of 1,261 frames vary line to line |
| Letter-spacing | Median 0. Not used to justify: its share does not rise with word-gap size |
| Line-end hyphens | 3.4 candidates per 100 lines, **unverified** (may be compounds or dashes); the three columns examined by hand have none |
| Text layer | **Default library text is wrong for Devanagari** (on one page PDFium omits 1,008 of 11,387 glyphs; pdfminer mis-decodes conjuncts). **The exact text IS recoverable** from the PDFs' `/ActualText` spans with `actualtext.py`: 26/26 lines against a hand check, and 701 complete paragraphs whose word counts match the geometry (`EXP_COMPOSE_3_REPORT.md` §2) |

**Decision tree (§10):**
- **C applies:** p95 spacing about 4× on published pages.
- **F applies:** a narrow, proprietary face.
- **G applies:** the paper's own pages carry large gaps.
- **A, D and E do not apply.**
- **B is not established.**
- **Two new practices sit outside the tree:**
  - space compression down to about 0.66×;
  - per-story horizontal scaling.

**Illustration only, not a result** (`compose2/house_compare.py`; details in `EXP_COMPOSE_2_REPORT.md` §18): the same words re-set in the same 36.5 mm column with an OFL stand-in, calibrated on those words.

| Version | Lines | Lines with a gap > 3× | Widest gap |
|---|---|---|---|
| The paper | 26 | 36.0% | 7.03× |
| Pageinator, same rules | 27 | 40.0% | 7.2× |
| Pageinator with Marathi word breaks | 26 | 20.8% | 5.32× |

With word breaks, Pageinator broke 6 words.

**Section L** (implications) is drafted privately for human review. Its proposals:
- calibrate G1 thresholds to these distributions (`G1_ACCEPTANCE_PACKAGE.md` §7.5);
- add asymmetric shrink/stretch to the spacing model;
- decide on horizontal scaling;
- obtain the 4CPlus licence;
- for archives, read PDFs only through an /ActualText-aware reader (or ingest source text).

