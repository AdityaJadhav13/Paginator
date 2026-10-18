# EXP-COMPOSE-3: House-Calibrated Word Spacing on the Pilot's Own Paragraphs (report)

**Status:** COMPLETE (experiment). Blind-review round 1 sheets are ready; **no human rating has happened yet**. **G1: NOT MET.**

**What this is:** experimental engineering, not the production typesetter and not an engine-language decision (ADR-017).
- The composer lives in `experiments/phase0/compose3/`.
- compose1 and compose2 stay frozen with their results.
- The frozen oracle was **not modified**.
- No AI was used for breaking, spacing, rewriting or scoring.

**Data:** the pilot newspaper's own published pages (owner-supplied, evidence level A). Only **aggregate** numbers appear here. The pilot's text, the per-paragraph results, the proof sheets and the key stay in `$PAGEINATOR_PRIVATE_CORPUS`.

**Date:** 2026-10-11. **Composer:** `compose3/1.0.0`. **Stand-in font:** NotoSerifDeva-w87.5 (OFL).

**Reproduce from the repo root, prefixing each command with `PYTHONDONTWRITEBYTECODE=1`. `$DS` is the private dataset directory:**
```bash
experiments/phase0/published1/.venv/bin/python experiments/phase0/published1/paragraphs.py "$DS"           # exact text (ActualText)
tools/oracle/v0/.venv/bin/python experiments/phase0/compose3/run_compose3.py "$DS"                          # ~11 s, Stage A first
tools/oracle/v0/.venv/bin/python experiments/phase0/compose3/check_determinism.py "$DS" 10
tools/oracle/v0/.venv/bin/python experiments/phase0/compose3/proofs_round1.py "$DS"                         # private review sheets
python3 experiments/phase0/compose3/analyze_round1.py "$DS/report/round1"                                    # after the sheets come back
```

---

## 0. In plain words
- **We can now read the exact text inside the newspaper's PDFs.** InDesign hides it in "ActualText" tags.
- **We re-set 692 of the paper's own paragraphs** with the same words in the same column widths, and compared them line by line with what was printed.
- **We fixed the spacing model** found lacking in EXP-COMPOSE-2: word spaces can now squeeze and stretch independently, as InDesign's do. The settings were chosen on the earlier editions only.
- **Result on the later editions,** which were never used for tuning: **without breaking words, Pageinator ties the paper's InDesign.**
  - very loose lines: 22.58% against 23.94%;
  - total lines: 3,476 against 3,481;
  - one catch: it squeezes spaces slightly more often (4.17% against 3.6% of lines).
- **With Marathi word breaks it is far tighter**, but the paper practically never breaks words.
- **Next:** the paper's editors judge blind printed pairs (round 1 is ready).

## 1. Question
Can our composer, with a spacing model that may squeeze as well as stretch, set the pilot's own paragraphs at their own widths **without word breaks** at least as well as the pilot's InDesign did? We judge this by:
- word gaps;
- squeezing;
- paragraph length.

## 2. Exact text from the PDFs (`published1/actualtext.py`, `published1/paragraphs.py`)

**What the PDFs contain.** The pilot's PDFs (InDesign CS6 + Adobe PDF Library 10.0.1) draw Devanagari glyphs in visual order. Each reordered or ligated cluster is wrapped in a marked-content span carrying the exact Unicode: `/Span <</ActualText <FEFF…>>> BDC … EMC`. A sample page has 1,387 such spans. PDFium's and pdfminer's default text ignore these spans, which is why EXP-PUBLISHED-1 found the text layer unusable.

**The reader.** `actualtext.py` re-interprets the content stream with a device that tracks the marked-content stack. A glyph inside a span contributes the span's text once; any other glyph contributes its ToUnicode text. Order is content-stream order, which InDesign writes in reading order.

**Validation:**
- **Hand check:** against an independently hand-typed column (26 lines, 92 words), **26/26 lines agree**. The only differences are three zero-width joiners in `श्‍व`, which the hand copy could not see; the reader is right.
- **Self-consistency:** for every kept paragraph, each line's word count equals the measurement tool's **geometric** token count.
- **Text quality** over 34,735 words:
  - 0 words begin with a vowel sign;
  - 0 dotted circles;
  - 0 replacement characters.

**Paragraphs kept** (complete, single font, every check passed): **701** (7,500 lines) from all 15 editions, of which 692 have an exactly measured column width. Exclusions:

| Reason | Count |
|---|---|
| Runs past the frame end | 564 |
| Fewer than 3 lines | 326 |
| Line-end hyphen in print | 137 |
| Mixed fonts (e.g. bold dateline) | 132 |
| Excluded or special line | 75 |
| Text/geometry word-count mismatch | 39 |
| Indented line inside | 20 |

## 3. Baseline (Stage A)

| Check | Result |
|---|---|
| Oracle file hashes | **41 / 41 match** |
| compose2 signatures reproduced by composer3 in **legacy** mode (1-in-50) | **642 / 642 match** |
| compose3 fresh-process determinism (1-in-10) | **900 / 900 match** |

## 4. What changed from compose2 (`composer3.py`)

There is one addition: `Policy.space_model = "asym"`. A line's word-space factor `sf` costs

- `w · ((sf − desired) / shrink_scale)²` below the desired space, and
- `w · ((sf − desired) / stretch_scale)²` above it.

The hard floor and ceiling keep their meaning.

In the legacy model both sides were scaled by the hard limits. Once the ceiling was lifted (justify every line, as the pilot does), with that reference's weights, squeezing a line to 0.85× cost as much as stretching one to about 25×. The composer therefore never squeezed, while the pilot's InDesign squeezes to about 0.66×. **The legacy model stays the default.**

## 5. Method
- **Same words, same measure.** Each paragraph is re-set from its exact text at its measured column width, with the same first-line indent (non-breaking spaces), and no word breaks.
- **Font calibration per paragraph.** The stand-in's size is chosen so the paragraph's words take the **same total width** as in print. This includes the story's horizontal scale; it does not distort glyphs.
- **House units.** Every spacing parameter and metric is in the published font's normal space (EXACT, from the PDF width table). Policies are converted per paragraph. This way the floor means the same physical squeeze as the paper's.
- **Candidates:**
  - floor ∈ {0.80, 0.75, 0.70, 0.66} (0.66 is the pilot's 1st percentile);
  - stretch scale ∈ {0.33, 0.50, 1.00};
  - shrink scale 0.20;
  - desired spacing 1.0;
  - plus the compose2 reference (`REF_C2_same_rules`).
- **Pre-registered selection rule** (in `run_compose3.py`, fixed before any result was seen), applied to the **calibration** editions only (before 2025-11-10):
  - **Eligible** = squeezes no more often than print (lines below 0.8× and below 0.7×, each ≤ print's share) **and** paragraph length within ±max(1, n/20) lines for ≥ 90% of paragraphs.
  - **Choose** the eligible candidate with the fewest lines whose widest gap exceeds 2×, then 3×, then the higher floor.
- **Test:** the chosen candidate is reported on the **held-out** editions (2025-11-10 and later).

## 6. Results

### 6.1 Held-out test editions (313 paragraphs, 3,168 non-final lines)
| Version | Lines with a gap > 2× | > 3× | p95 widest gap | Lines < 0.8× | Lines < 0.7× | Narrowest space | Paragraph length within ±1 line* | Exactly the same length | Total lines (ours / print) |
|---|---|---|---|---|---|---|---|---|---|
| **Print (InDesign)** | 47.34% | 23.94% | 5.734× | 3.6% | 1.61% | 0.472× | — | — | — |
| REF_C2_same_rules | 52.24% | 25.05% | 5.495× | 0.91% | 0.0% | 0.764× | 98.72% | 82.43% | 3,507 / 3,481 |
| C3_floor0.80_stretch0.33 | 53.7% | 26.04% | 5.6× | 0.0% | 0.0% | 0.801× | 98.08% | 79.87% | 3,521 / 3,481 |
| C3_floor0.80_stretch0.50 | 53.7% | 26.04% | 5.6× | 0.0% | 0.0% | 0.801× | 98.08% | 79.87% | 3,521 / 3,481 |
| C3_floor0.80_stretch1.00 | 53.63% | 26.04% | 5.6× | 0.0% | 0.0% | 0.801× | 98.08% | 79.87% | 3,521 / 3,481 |
| C3_floor0.75_stretch0.33 | 50.72% | 24.28% | 5.489× | 1.95% | 0.0% | 0.75× | 98.72% | 83.71% | 3,498 / 3,481 |
| C3_floor0.75_stretch0.50 | 50.72% | 24.28% | 5.489× | 1.92% | 0.0% | 0.75× | 98.72% | 83.71% | 3,498 / 3,481 |
| C3_floor0.75_stretch1.00 | 50.61% | 24.33% | 5.489× | 1.79% | 0.0% | 0.75× | 98.72% | 83.39% | 3,499 / 3,481 |
| C3_floor0.70_stretch0.33 | 49.02% | 23.6% | 5.404× | 3.43% | 0.0% | 0.7× | 98.72% | 84.35% | 3,488 / 3,481 |
| C3_floor0.70_stretch0.50 | 48.99% | 23.6% | 5.404× | 3.34% | 0.0% | 0.7× | 98.72% | 84.35% | 3,488 / 3,481 |
| C3_floor0.70_stretch1.00 | 48.98% | 23.65% | 5.404× | 2.96% | 0.0% | 0.7× | 98.72% | 84.03% | 3,489 / 3,481 |
| C3_floor0.66_stretch0.33 | 46.74% | 22.53% | 5.316× | 5.54% | 1.9% | 0.66× | 99.04% | 82.75% | 3,470 / 3,481 |
| C3_floor0.66_stretch0.50 | 46.7% | 22.56% | 5.316× | 5.29% | 1.68% | 0.66× | 99.04% | 82.75% | 3,470 / 3,481 |
| **C3_floor0.66_stretch1.00** (chosen) | 47.19% | 22.58% | 5.302× | 4.17% | 1.14% | 0.66× | 99.04% | 83.39% | 3,476 / 3,481 |

\* Paragraph length tolerance: ±max(1, n/20) lines. Gaps are in house spaces. "Lines < 0.8×" is the share of non-final justified lines whose word space is below 0.8 of a normal space.

### 6.2 Calibration editions (379 paragraphs, 3,546 non-final lines; used for selection)
| Version | Lines with a gap > 2× | > 3× | p95 widest gap | Lines < 0.8× | Lines < 0.7× | Narrowest space | Paragraph length within ±1 line* | Exactly the same length | Total lines (ours / print) |
|---|---|---|---|---|---|---|---|---|---|
| **Print (InDesign)** | 45.58% | 21.68% | 5.352× | 4.03% | 1.65% | 0.499× | — | — | — |
| REF_C2_same_rules | 50.69% | 24.49% | 5.568× | 1.32% | 0.0% | 0.757× | 98.68% | 83.91% | 3,947 / 3,925 |
| C3_floor0.80_stretch0.33 | 52.0% | 25.03% | 5.57× | 0.0% | 0.0% | 0.803× | 98.15% | 82.85% | 3,961 / 3,925 |
| C3_floor0.80_stretch0.50 | 52.0% | 25.03% | 5.57× | 0.0% | 0.0% | 0.803× | 98.15% | 82.85% | 3,961 / 3,925 |
| C3_floor0.80_stretch1.00 | 51.94% | 25.02% | 5.57× | 0.0% | 0.0% | 0.803× | 98.15% | 82.59% | 3,963 / 3,925 |
| C3_floor0.75_stretch0.33 | 49.61% | 23.82% | 5.458× | 2.33% | 0.0% | 0.75× | 98.68% | 84.17% | 3,942 / 3,925 |
| C3_floor0.75_stretch0.50 | 49.61% | 23.82% | 5.458× | 2.28% | 0.0% | 0.75× | 98.68% | 84.17% | 3,942 / 3,925 |
| C3_floor0.75_stretch1.00 | 49.61% | 23.89% | 5.458× | 1.99% | 0.0% | 0.751× | 98.68% | 83.91% | 3,944 / 3,925 |
| C3_floor0.70_stretch0.33 | 47.25% | 22.66% | 5.256× | 3.95% | 0.0% | 0.702× | 98.68% | 84.96% | 3,925 / 3,925 |
| C3_floor0.70_stretch0.50 | 47.3% | 22.66% | 5.256× | 3.81% | 0.0% | 0.702× | 98.68% | 84.96% | 3,925 / 3,925 |
| C3_floor0.70_stretch1.00 | 47.56% | 22.75% | 5.278× | 3.24% | 0.0% | 0.702× | 98.68% | 84.7% | 3,929 / 3,925 |
| C3_floor0.66_stretch0.33 | 45.93% | 21.96% | 5.171× | 5.07% | 1.05% | 0.661× | 99.21% | 84.17% | 3,910 / 3,925 |
| C3_floor0.66_stretch0.50 | 46.02% | 21.93% | 5.171× | 4.85% | 0.99% | 0.661× | 99.21% | 84.17% | 3,910 / 3,925 |
| **C3_floor0.66_stretch1.00** (chosen) | 46.41% | 22.01% | 5.187× | 4.02% | 0.74% | 0.661× | 99.21% | 83.64% | 3,915 / 3,925 |

### 6.3 Reading the results
- **Selected:** `C3_floor0.66_stretch1.00`. Floor 0.66; stretch penalised much more gently than shrink.
- **Old vs new model on the test editions:**
  - very loose lines (> 3×) fell from 25.05% to 22.58%;
  - lines > 2× fell from 52.24% to 47.19%;
  - total length moved from 3,507 to 3,476 lines (print: 3,481).
- **Against print, it is a tie:**
  - lines > 2×: 47.19% against 47.34%;
  - lines > 3×: 22.58% against 23.94%;
  - p95 widest gap: 5.302× against 5.734×.

  Paragraph length is within tolerance for 99.04% of paragraphs and identical for 83.39%.
- **Honest caveats:**
  - The squeeze constraint passed on calibration only by a hair (4.02% against print's 4.03%).
  - On the test editions the chosen policy squeezes **more often than print** (4.17% against 3.6% below 0.8×).
  - Its squeezes never go below 0.66×, while print reaches 0.472×.
  - Floor 0.70 would have stayed under print's squeeze rate on both splits, at the cost of slightly looser lines. That is a choice for the paper's editors, not for us after seeing the test data.
- **Why not better than a tie?** At 3–5 words per line and with no word breaks, line breaks are tightly constrained. The paper's InDesign almost certainly uses a paragraph-level composer too. The remaining levers are word breaks (§6.4) or glyph scaling and letter-spacing, which this experiment does not use.
- **Speed:** 0.351 ms median per paragraph (p95 1.013 ms) for the chosen policy. The whole run took 10.7 s.

### 6.4 With Marathi word breaks (information only; not house practice)
On the test editions, the chosen policy plus hyph-mr breaks (≥ 2 aksharas each side, ≤ 2 consecutive) gives:
- lines with a gap > 2×: **18.98%**;
- lines with a gap > 3×: **3.55%**;
- p95 widest gap: 2.769×.

The cost:
- **24.62 broken words per 100 lines;**
- paragraphs are shorter (3,380 lines against 3,481);
- the same length as print for only 63.26% of paragraphs.

Acceptable only if the editors accept word breaks.

## 7. Single-column illustration (update to `EXP_COMPOSE_2_REPORT.md` §18)
On the one hand-checked 36.5 mm column, the new model makes the same choices as the old one: the first paragraph still takes one line more than print. Single paragraphs vary in both directions; §6 is the evidence, the column is an illustration. With word breaks the new model is markedly tighter on that column than the old one.

## 8. Blind review, round 1 (calibration round; NOT G1)

**Setup:**
- 24 complete paragraphs from the **held-out** editions, chosen where Pageinator's breaks differ from print.
- Stratified by width: 6 at 36.5 mm, 4 at 46.5, 7 at 50, 4 at 57, 3 wide.
- Each is shown as **A** (the published line breaks, re-drawn in the stand-in font) and **B** (Pageinator), same font, size, measure, leading and indent. Using one font for both means raters judge only line breaking and spacing.
- L/R order is randomised (seed 20261012). 4 items are repeated with sides swapped to test consistency.

**Outputs (private):**
- `round1_proofs_A3.pdf` (4 sheets, 100% scale);
- `round1_score_sheet_A4.pdf` (better L/R/same; spacing 1–5 per side; OK to print Y/fix/N);
- `score_template.csv`;
- `KEY_SEALED.json`, held by a non-rater.

**Analysis:** `analyze_round1.py` reports:
- preference;
- spacing means and the paired B − A difference (G1 B3: not worse than −0.5);
- "OK to print" rates;
- Cohen's κ on "OK to print" (round invalid if κ < 0.4);
- consistency on the repeats.

**Raters:** 2 sub-editors and 1 page designer from the pilot (G1 §7.1), working independently.

## 9. G1 status
**NOT MET.** Round 1 is not G1. G1 still needs:
- 200 paragraphs and 30 headlines in the licensed house font;
- the automated checks A1–A9;
- signed human acceptance (B1–B5).

## 10. Architecture impact
**No ADR changes. No decision reopened.**
- **Supports ADR-017.** Spacing policy is house-profile *data*: floor, desired value, independent shrink and stretch scales.
- **Kernel-contract input (P0-05), now evidenced:** an asymmetric word-space penalty with independent shrink and stretch scales, expressed in the house font's space units.
- **New requirement for archive and legacy ingest (`10`):** an /ActualText-aware text extractor for Devanagari production PDFs. Default library text is wrong.

## 11. Risks (updates to `RISKS_AND_ARCHITECTURE_IMPACT.md`)

| Risk | Update |
|---|---|
| NR10 (PDF text unusable) | **Mitigated for these PDFs** by the ActualText reader. Other producers may not write ActualText |
| NR11 (spacing model cannot squeeze) | **Mitigated on average** (tie with print). Residual: slightly more frequent squeezing than print |
| NR13 (word breaks) | Unchanged. Breaks would make Pageinator clearly tighter; editorial decision |
| New | The stand-in font is calibrated per paragraph. Results with the licensed house font may differ slightly; re-run once it is available |

## 12. Next step
1. **Run round 1 with the paper's editors.** Print the sheets at 100% on A3, collect the score sheets, and run `analyze_round1.py`.
2. Depending on the outcome:
   - raise the floor to 0.70 if editors flag tight lines;
   - test word breaks if they accept them;
   - keep the policy if they rate it equal to InDesign.
3. In parallel: obtain the 4CPlus licence terms, so that G1 proper can use the house font.

> **2026-10-11 update:** the round-1 review sheets were regenerated with `compose3/render.py`. That file corrects the vertical mark-offset sign the EXP-PDF-1 code review found in the old SVG helper. The 24 items, the 4 repeats and the sealed key are unchanged (same seed, verified item by item); only mark positions in the drawings changed. **Print the regenerated sheets, not any earlier copy.**
