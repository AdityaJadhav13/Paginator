# EXP-COMPOSE-2: Real-World Font, Grid and Break-Rule Composition Experiment (report)

**Status:** COMPLETE as an experiment, run on **provisional geometry and freely licensed fonts**. **G1: NOT MET.** Printable blind proofs are ready. No human review has happened.

**What this is:** experimental engineering, not the production typesetter, and not an engine-language decision (ADR-017).
- The composer lives in `experiments/phase0/compose2/`.
- The frozen oracle was **not modified**.
- No AI was used for breaking, rewriting or scoring.

**Date:** 2026-10-11. **Composer:** `compose2/1.0.0`. **Regression reference:** `compose1/1.0.0`.

**Raw results** are in `experiments/phase0/results/compose2/`:
- `paragraphs.csv.gz` (35,640 compositions);
- `signatures.json`;
- `meta.json` and `env.json`;
- `stage_a_baseline.json`;
- `determinism.json`;
- `analysis/{summary.json, policy_by_width.csv, fonts_by_width.csv}`;
- `proofs/`.

**Reproduce from the repo root, prefixing each command with `PYTHONDONTWRITEBYTECODE=1`:**
```bash
tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/run_compose2.py         # ~35 s (Stage A first; stops on mismatch)
tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/check_determinism.py 10
tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/analyze2.py
tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/proofs.py                # 16 pages; needs Google Chrome for PDF
```

---

## 0. In plain words

We tested how Marathi body text looks when it is set into newspaper columns. The test used:
- **11 free fonts**: all SIL OFL;
- **4 plausible broadsheet grids**: 5 to 8 columns;
- **3 body sizes**.

We also taught the composer four newsroom rules:
1. Break web addresses and emails at `/` or `.`, with no hyphen.
2. Never end more than 2 lines in a row with a broken word.
3. Never leave a single akshara on its own after a break.
4. Never let a non-justified line fall more than 35% short of the column.

**What we found:**
- **Nothing justifies the way a Marathi newspaper does, yet.** The best style justifies about 64% of lines at a 45 mm column. Our internal bar is 98%.
- **Narrower (more condensed) fonts help.** Each 0.01 em/char narrower adds about 1.4 percentage points of justified lines.
- **The web-address rule fixed a real bug.** The test paragraph with a URL went from 82 emergency (forced, mid-character) breaks to **0**.
- **Proofs are ready.** There are 16 coded proof pages that your printing unit can print, either full size or A3. Editors can then rate them without knowing which style is which.

The numbers will not mean much for your paper until we have:
- **your** production PDFs, which tell us your real column widths, sizes and spacing;
- **your** fonts.

## 1. Question
1. With fonts a Marathi page designer can actually use, on broadsheet grids, at real body sizes, which composition styles can set every paragraph?
2. How evenly do they set it?
3. Do four concrete newsroom break rules fix EXP-COMPOSE-1's ugliest failures without new ones?

Specifically:
- emergency breaks inside URLs;
- runs of 3–4 consecutive broken lines;
- 50% short lines.

## 2. Baseline (Stage A: reproduced before anything else)

| Check | Result |
|---|---|
| Oracle file hashes (`ORACLE_MANIFEST.json`) | **41 / 41 match** |
| EXP-COMPOSE-1 signatures reproduced (1-in-50 sample, compose1 composer, oracle-only registry) | **2,470 / 2,470 match** |
| EXP-COMPOSE-2 fresh-process determinism (1-in-10 sample) | **3,564 / 3,564 match** (`determinism.json`) |

## 3. What changed from compose1 (all in `composer2.py`; compose1 is untouched)

| Change | Why (EXP-COMPOSE-1 evidence) | Hard or soft |
|---|---|---|
| **Token breaks**: inside URL/email tokens, break after `/ . @ - _ ? & =`, no hyphen drawn (cost 15) | URL paragraph `mr-body-13` produced 82 emergency (mid-cluster) breaks | Soft (cost) |
| **Per-word hyphenation language**: Devanagari words use hyph-mr, Latin words use hyph-en-us | Mixed-script paragraphs used one pattern set for all words | — |
| **`max_consecutive_inword = 2`**: the DP rejects a third broken line in a row | Up to 4 consecutive in-word breaks at narrow widths | **Hard** |
| **`fallback_max_slack = 0.35`**: no ragged, semi or fallback line may be more than 35% short | Fallback lines up to 52% short | **Hard** (a paragraph that cannot meet it is reported overset, never dropped silently) |
| **Minimum in-word fragment = 2 clusters** on each side | Inherited from compose1 rules setting; re-verified | Hard |

The families (FULL / CONSTRAINED / RAGGED / HYBRID), penalty model and DP are unchanged from `EXP_COMPOSE_1_REPORT.md` §4–§5.

## 4. Fonts and licences

All 11 variants are **SIL OFL 1.1**, with `fsType 0` (installable embedding).

**Sources:**
- 5 come from the frozen oracle assets (Noto Serif/Sans Devanagari at `wdth` 100 and 87.5, and Mukta).
- 6 were downloaded **unmodified** from `github.com/google/fonts` (HEAD `bd8f81d`, 2026-10-11). Each sits with its `OFL.txt` in `experiments/phase0/compose2/fonts/`.

Hashes, versions and axes are in `compose2/FONTS.json`.

> **These are not a claim about which fonts Marathi newspapers use.** Many papers use commercial or legacy-encoded faces. They were chosen as freely licensed, widely available Devanagari text faces, spanning narrow to wide. The newsroom's own fonts go in `$PAGEINATOR_PRIVATE_FONTS` and are never committed (§13).

| Font (variant) | Category | Version | em/char | Space (em) |
|---|---|---|---|---|
| Noto Serif Devanagari, wdth 100 | serif | 2.006 | 0.375 | 0.260 |
| Noto Serif Devanagari, wdth 87.5 | serif | 2.006 | 0.346 | 0.241 |
| Noto Sans Devanagari, wdth 100 | sans | 2.006 | 0.402 | 0.260 |
| Noto Sans Devanagari, wdth 87.5 | sans | 2.006 | 0.366 | 0.231 |
| Mukta | sans | 2.538 | 0.380 | 0.222 |
| Tiro Devanagari Marathi | serif | 1.52 | 0.406 | 0.260 |
| Hind | sans | 2.001 | 0.395 | 0.244 |
| Martel | serif | 1.001 | 0.438 | 0.231 |
| Yantramanav | sans | 1.001 | 0.398 | 0.254 |
| Baloo 2 | rounded (display) | 1.700 | 0.397 | 0.200 |
| Khand | condensed display (atypical for body) | 1.102 | 0.330 | 0.189 |

`em/char` is the mean advance per non-space character at 9.5 pt over the corpus. It uses the same width metric as EXP-PUBLISHED-1, so pilot fonts will be directly comparable.

## 5. Geometry: PROVISIONAL

`house_profile.provisional.json` uses a 318 × 510 mm page, 24 mm margins and 4 mm gutters, with 8, 7, 6 or 5 columns. That gives column widths of **30.25 / 35.14 / 41.67 / 50.8 mm**. To these the matrix adds 45 and 60 mm.

Body sizes are 8.5, 9 and 9.5 pt; leading is 1.15.

**This is not the newsroom's geometry.** When EXP-PUBLISHED-1 measures the pilot's production PDFs, writing `house_profile.measured.json` (same schema) makes every script use it automatically.

## 6. Matrix

The matrix covers:
- 18 Marathi body paragraphs (the synthetic Phase 0 corpus; **not news, not native-reviewed**);
- 11 font variants;
- 3 sizes;
- 6 widths;
- 10 policies.

That is **35,640 compositions** in 35 s.

**Policies:**
- `C2_FULL_rules_h2.00` and `C2_FULL_rules_h1.75`;
- `C2_HYBRID_rules_h2.00` and `C2_HYBRID_h2.00`;
- `C2_CONSTRAINED_c2.00`;
- `C2_RAGGED` and `C2_RAGGED_rules`;
- two measurement-only uncapped policies (`C2_MEAS_uncapped[_rules]`), which answer "what spacing would it *need*?";
- `REF_C1_HYBRID_DP_h2.00_rules`, which runs the compose1 composer for regression.

`_rules` means hyph-mr/hyph-en-us pattern breaks are allowed (a 2+2 cluster minimum). `h2.00` means word spaces stretch to at most 2× natural.

## 7. Results by policy and width (all fonts and sizes pooled)

**Composable %** is the share of paragraphs fully set with no overset. **Justified %** is the share of non-final lines justified, with overset paragraphs counted against the policy using the ragged line count (the EXP-COMPOSE-1 denominator lesson).

| Policy | 30.25 mm | 41.67 mm | 45 mm | 60 mm | In-word breaks /100 lines @45 | Max run | Max slack |
|---|---|---|---|---|---|---|---|
| FULL_rules h2.00: composable / justified | 3.0 / 0.6 | 14.3 / 8.1 | **17.2 / 10.9** | 48.0 / 39.8 | 31.8 | 2 | — |
| FULL_rules h1.75: composable / justified | 2.4 / 0.3 | 7.7 / 3.2 | 9.3 / 4.4 | 29.1 / 20.6 | 34.4 | 2 | — |
| **HYBRID_rules h2.00**: composable / justified | 99.7 / 44.2 | 100 / 60.5 | **100 / 64.4** | 100 / 76.6 | 16.7 | **2** | **0.35** |
| HYBRID h2.00 (no word breaks) | 81.3 / 24.0 | 98.8 / 38.4 | 99.3 / 44.1 | 100 / 59.6 | 0 | 0 | 0.35 |
| CONSTRAINED c2.00 | 90.4 / 27.8 | 99.7 / 45.3 | 99.7 / 50.5 | 100 / 65.8 | 0 | 0 | 0.35 |
| RAGGED: composable | 79.5 | 98.8 | 99.3 | 100 | 0 | 0 | 0.35 |
| RAGGED_rules: composable | 99.7 | 100 | 100 | 100 | 4.5 | 1 | 0.27 |
| *REF compose1 HYBRID_rules* | 100 / 44.7 | 100 / 60.0 | 100 / 63.9 | 100 / 74.9 | 16.7 | **4** (30 mm) | **0.52** |

**Reading this table:**
- **FULL justification is not viable on these grids.** Even with pattern breaks and 2× spaces, 83% of paragraphs at 45 mm cannot be set without a line exceeding the limit. This confirms EXP-COMPOSE-1 with nine more fonts.
- **HYBRID with pattern breaks is the only style that sets everything and justifies most lines**, at 60–77% of lines for widths of 41.67 mm and over.
- **Word breaks are worth about 20 percentage points** of justified lines at every width (HYBRID_rules vs HYBRID).

## 8. Font effect (at 45 mm, all sizes)

| Font | Words/line | Lines needing ≤ 2× spacing (with rules) | HYBRID_rules justified % | CONSTRAINED justified % |
|---|---|---|---|---|
| Noto Serif Deva wdth 87.5 | 5.23 | 74.5 | **73.2** | 59.6 |
| Noto Serif Deva wdth 100 | 4.80 | 70.8 | 71.0 | 55.1 |
| Khand (display) | 5.61 | 68.5 | 67.3 | 59.5 |
| Yantramanav | 4.56 | 60.3 | 67.1 | 51.1 |
| Noto Sans Deva wdth 87.5 | 4.97 | 64.5 | 66.5 | 54.6 |
| Mukta | 4.79 | 62.8 | 65.9 | 51.8 |
| Noto Sans Deva wdth 100 | 4.50 | 62.8 | 64.6 | 49.3 |
| Hind | 4.59 | 55.7 | 63.7 | 49.5 |
| Tiro Devanagari Marathi | 4.48 | 59.7 | 63.2 | 48.0 |
| Baloo 2 | 4.61 | 50.6 | 56.4 | 44.7 |
| Martel | 4.16 | 49.2 | 53.5 | 37.5 |

**Linear fit across the 11 fonts at 45 mm:** HYBRID_rules justified % falls by **1.44 percentage points per +0.01 em/char**, R² = 0.56.

What drives this is words per line, as in EXP-COMPOSE-1: Martel at about 4.2 words per line is the worst; condensed faces at over 5 are the best.

Font choice is a real typographic lever. **Font is not the whole story**, though: Khand is the narrowest face but not the best. A plausible but untested reason is that its spaces are also narrow (0.189 em), so there is less natural space for justification to stretch.

## 9. Internal plausibility criterion: FAIL (unchanged definition)

**Criterion:** at ≥ 45 mm, word spaces ≤ 2×, no Devanagari letter-spacing, ≥ 98% of lines justified.

| Policy | Pooled justified % (≥ 45 mm) | Best font (value) | Fonts reaching 98% |
|---|---|---|---|
| FULL_rules h2.00 | 21.8 | Noto Serif wdth 87.5 (44.2) | none |
| FULL_rules h1.75 | 10.4 | Noto Serif wdth 87.5 (27.2) | none |
| HYBRID_rules h2.00 | 70.1 | Noto Serif wdth 87.5 (78.4) | none |
| HYBRID h2.00 | 50.6 | Noto Serif wdth 87.5 (59.6) | none |
| CONSTRAINED c2.00 | 57.2 | Noto Serif wdth 87.5 (66.4) | none |

**FAIL for every policy and every font.**

This is **our** criterion, not house practice. Real Marathi papers may run spaces wider than 2× or letter-space, or they may justify everything because the real columns and fonts are different. Only EXP-PUBLISHED-1 measurements on the pilot's pages can tell which (`EXP_PUBLISHED_1.md` §10 decision tree).

## 10. URL and email fix (paragraph `mr-body-13`, all fonts, sizes and widths)

| | compose1 HYBRID_rules | compose2 HYBRID_rules | compose2 RAGGED (no word breaks) |
|---|---|---|---|
| Emergency (mid-cluster) breaks | **82** | **0** | 24 |
| Token breaks (after `/ . @` …) | 0 | 285 | 259 |
| Justified lines % | 39.9 | **46.5** | — |

The remaining 24 RAGGED emergency breaks all occur at 30.25 mm (15) and 35.14 mm (9), where a single unbreakable piece of this paragraph is wider than the column. Allowing pattern breaks (RAGGED_rules) leaves 1, at 30.25 mm.

## 11. Effect of the new hard limits

**`max_consecutive_inword = 2` works:**
- Across all policies and widths, the maximum run is **2** (compose1: 4).
- It costs nothing measurable: at ≥ 45 mm, 70.1% justified vs compose1's 69.1%.

**`fallback_max_slack = 0.35` works for HYBRID with rules:**
- Maximum slack is 0.35 (compose1: 0.52).
- 100% of paragraphs are composable at ≥ 35 mm, and 99.7% at 30.25 mm.

**Finding: a single hard shortness cap is wrong for ragged text at narrow widths.**
- With no word breaks, RAGGED is composable for only **79.5%** of paragraphs at 30.25 mm and 93.3% at 35.14 mm. One long word (or URL fragment) forces a line more than 35% short, and the paragraph is reported overset. CONSTRAINED and HYBRID without breaks behave the same way.
- With pattern breaks, RAGGED reaches 99.7%.

**Implication for the kernel contract (P0-05, not a decision):** the slack limit must be either:
- per family and width dependent; or
- a soft cost, with overset reserved for genuinely unsettable text.

## 12. Performance (composition only, one paragraph, this dev machine; `env.json`)

| Policy | Median ms | p95 ms |
|---|---|---|
| C2_HYBRID_rules h2.00 | 0.79 | 1.73 |
| C2_RAGGED_rules | 0.72 | 1.56 |
| C2_CONSTRAINED c2.00 | 0.21 | 0.50 |
| compose1 HYBRID_rules (reference) | 0.99 | 2.10 |

- The new constraints did not slow composition. compose2 is slightly faster. The likely, unverified reason is that the consecutive-run limit prunes DP candidates.
- **Cold font load:**
  - variable fonts take 330–900 ms the first time (instancing; Baloo 2: 898 ms);
  - static fonts take about 0.1 ms after the first load.

  A kernel must pre-warm the house fonts (`ENGINE_AND_LATENCY_EXPERIMENTS.md`).

## 13. Proof pages for your printing unit

`proofs.py` produced **16 pages**, each with **one style applied to a whole page**, so judges see page texture rather than a single paragraph.

**What the 16 pages cover:**
- 2 grids (PROV-8col 30.25 mm, PROV-6col 41.67 mm);
- 2 fonts, chosen by a fixed rule: the best serif and best sans by HYBRID_rules at the 6-col width, excluding display faces;
- 4 styles:
  - **A:** justify every line at whatever spacing it needs;
  - **B:** hybrid with pattern breaks;
  - **C:** constrained, no word breaks;
  - **D:** ragged with pattern breaks.

**Page setup:**
- body 9 pt / 10.35 pt;
- headlines Noto Sans Devanagari Bold 13 pt;
- seed 20261011 shuffles the jobs into codes **P01–P16**.

Proof styles always set every paragraph: the hard slack cap is off for proofs, so no text is silently dropped. Their exact settings are recorded in the key.

**Files** are in `experiments/phase0/results/compose2/proofs/`:
- `proof-NN_truesize.pdf`: 318 × 510 mm at 100%. Print this on a broadsheet proofer **or on newsprint on your own press**. That is the most valuable test, because it shows real ink spread on real stock.
- `proof-NN_A3.pdf`: scaled to fit A3 (≈ 82%, so 9 pt prints as about 7.4 pt). Use it only to judge texture and spacing evenness, never size or readability.
- `KEY_SEALED.json`: which code is which grid, font and style. **Give it to someone who is not rating.** Raters must not open it until scoring is done.
- The PDFs and SVGs (107 MB) are git-ignored and regenerable. The key and `INDEX.json` are small.

**Visual check by us (P03, A3 render):**
- 6 columns, correct Devanagari shaping, and headlines all render.
- No paragraph is missing.
- Ragged right edges are as expected.

This check is about rendering only. It is **not** a typographic judgement.

**How to rate:**
- Use the score sheet in `G1_ACCEPTANCE_PACKAGE.md` §7.3: R1–R8 and R10; R9 for headlines.
- Have each rater work independently.
- Unblind only after all sheets are in.

**What the ratings count as:**
- They are useful as an **early preference read and a print check** (glyph outlines on your press).
- They **do not count as G1 evidence** (`G1_ACCEPTANCE_PACKAGE.md` §14.D), because:
  - the text is synthetic;
  - the grid is provisional;
  - there is no paired published original.

## 14. G1 status
**NOT MET.** The automated criterion fails (§9), and there is no human review, real corpus, real geometry or pilot font.

## 15. Architecture impact
**No ADR changes. No decision is reopened.** The evidence:
- **Supports ADR-017.** A single authoritative kernel needs policy *data* (family, caps, break classes) as part of the house profile, not hard-coded behaviour.
- **Reinforces the requirement for composition families.** FULL-only justification is not viable on broadsheet grids with these fonts; HYBRID with pattern breaks is the strongest candidate.
- **Adds three inputs to the deferred kernel contract (P0-05):**
  - a token-break class for URLs and emails;
  - per-word hyphenation language;
  - a per-family slack policy (§11).
- **Font width is a measurable lever** (§8). The house profile must carry font choice and width axis, and font pre-warming belongs in the kernel lifecycle (§12).

## 16. Risks (new or changed)

| Risk | Status |
|---|---|
| hyph-mr licence (MIT/LGPL/GPL tri-licence, 2016, generic rules) | Unchanged: **LICENCE REVIEW REQUIRED** (L10). Every "_rules" result depends on it |
| Pattern-break quality is unreviewed by Marathi readers | Open. A break can be "legal" by pattern and still read badly. Needs R5 ratings |
| Results are on synthetic text and provisional grids | Open. Could over- or under-state difficulty |
| Newsroom fonts may be legacy-encoded (non-Unicode) | Open (P0-12). This composer accepts Unicode text only |
| A single hard cap causes ragged overset at narrow widths | **New**, mitigated by a per-family policy (§11) |

## 17. Next step (one exact action)

**Run EXP-PUBLISHED-1 on the pilot's production PDFs**, then re-run EXP-COMPOSE-2 on measured geometry and the pilot's fonts.

**What we need from the printing unit / newsroom:**
1. **6–15 production PDFs that actually went to press**, from at least 5 section types and 2 edition dates, plus the printed pages. Follow `EXP_PUBLISHED_1.md` §3–§4. Files go to `$PAGEINATOR_PRIVATE_CORPUS`, never into git, each with a filled `manifest.template.json`.
2. **Font names, versions, vendor and licence** for body, headline and caption text, and whether they are Unicode or legacy. Supply font files only if the licence allows it; they go in `$PAGEINATOR_PRIVATE_FONTS`, listed in `compose2_fonts.json` (see `compose2/README.md`).
3. **Column width, body size and leading** if a written grid spec exists. Otherwise EXP-PUBLISHED-1 measures them.
4. *(Optional, now)* Print the 16 proofs, on your press if possible, and note any rendering or ink problems.

**Then:**
- EXP-PUBLISHED-1 writes the measured house profile.
- `run_compose2.py` and `proofs.py` pick it up automatically.
- The G1 paired review (published original vs Pageinator) can be scheduled.

**Not started without authorisation:** EXP-COMPOSE-3 and any production work.

## 18. Addendum (2026-10-11): calibration against the pilot's published pages

This addendum uses the first pilot dataset (`EXP_PUBLISHED_1.md` §12). **G1 remains NOT MET.** No ADR changes.

**1. The §9 criterion was stricter than house practice.**
- The pilot justifies 90% of body lines.
- Its word gaps reach a p95 of 4.2×, and 33% of gaps exceed 2×.

A "spaces ≤ 2×" bar therefore fails the paper's own printed pages. Under `G1_ACCEPTANCE_PACKAGE.md` §7.5 the bar must be calibrated to these pages. §9's FAIL stands as stated, but it was a failure against our bar, not against the newspaper's.

**2. Same words, same column (illustration, `compose2/house_compare.py`).**
- **Setup:** one published 36.5 mm column of 26 lines, re-set at its own width and 13 pt leading.
- **Text:** transcribed from the printed image, because the PDF text layer is unusable. It contains 92 words; the tool measured 92 tokens.
- **Font:** Noto Serif Devanagari at 87.5% width, at 10.42 pt. That size is calibrated so the same words take the same total width (published face 0.305 em/char; stand-in 0.337).
- **Gaps** are measured in the published font's space units.

| Version | Lines | > 2× | > 3× | Widest | Word breaks |
|---|---|---|---|---|---|
| Printed (InDesign) | 26 | 56.0% | 36.0% | 7.03× | 0 |
| Pageinator, same rules (justify all, never break) | 27 | 72.0% | 40.0% | 7.2× | 0 |
| Pageinator + hyph-mr breaks | 26 | 54.2% | 20.8% | 5.32× | 6 |

- **First paragraph (complete in both):**
  - printed: 12 lines, 18.2% above 3×;
  - same rules: 13 lines, 33.3%;
  - with breaks: 12 lines, 27.3%.
- **Composition time:** 1.5 ms and 5.02 ms for the column.

**3. Many paragraphs** (synthetic corpus at the pilot's widths, against every published line of the same width). Each cell is the share of lines whose widest gap is above 2× / above 3×.

| Width | Published | Pageinator, same rules | Pageinator + breaks |
|---|---|---|---|
| 36.5 mm | 43.9% / 25.3% (7,954 lines) | 67.2% / 46.6% | 35.8% / 13.3% (27.3 breaks / 100 lines) |
| 50 mm | 44.8% / 19.3% (3,155 lines) | 56.8% / 25.8% | 24.4% / 4.7% (23.4 breaks / 100 lines) |
| 75.5 mm | 22.2% / 3.7% (589 lines) | 28.9% / 6.6% | 3.9% / 0.0% (19.1 breaks / 100 lines) |

**Findings:**
- **With the same rules, Pageinator is looser than the pilot's InDesign.** The measured cause: InDesign compresses spaces down to about 0.66×. Our space penalty ties shrink and stretch to the hard limits, so with an unbounded stretch, compression is effectively forbidden. **Kernel-contract input (P0-05):** independent shrink and stretch scales. Re-test after that change.
- **With hyph-mr breaks, Pageinator is tighter than print** at every width, but it breaks about 1 line in 4. It also produces breaks editors may reject, for example just before an independent vowel. This is a blind-review question, not an engineering one.
- **Not modelled:** per-story horizontal scaling (96–107.5%) and the bold dateline run.
- **Lesson:** the per-glyph width metric mis-sized the stand-in font by 3.7%. Calibrate fonts on the same text (now done).

The comparison stays an **illustration**: one transcribed column, plus synthetic paragraphs whose words run slightly longer than news copy. The decisive evidence is still G1, a blind review by the pilot's editors.

> **Superseded for the spacing model** by `EXP_COMPOSE_3_REPORT.md` (2026-10-11): an asymmetric spacing model, tested on 692 of the pilot's own paragraphs, ties the pilot's InDesign without word breaks on held-out editions.

> **Rendering defect found 2026-10-11 (EXP-PDF-1 code review):** the SVG helper `compose1/render_sheets.line_glyphs` drew vertical GPOS mark offsets (below-base ्र, ु/ू, some reph forms) mirrored, by up to about 0.07 em. Composition and metrics are unaffected; only the drawings are. **The 16 EXP-COMPOSE-2 proof pages (§13) carry this defect and should not be printed.** They are superseded by the EXP-COMPOSE-3 round-1 sheets, which were regenerated with the corrected `compose3/render.py`.
