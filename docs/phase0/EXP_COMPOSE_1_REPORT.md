# EXP-COMPOSE-1: Newspaper Body-Text Composition Policy Experiment (report)

**Status:** COMPLETE (experiment). **G1: NOT MET.**

**What this is:** experimental engineering, not the production typesetter. The composer lives in `experiments/phase0/compose1/`. The frozen oracle was **not modified**. No AI was used anywhere.

**Date:** 2026-10-08. **Composer:** `compose1/1.0.0`.

**Raw results:** `experiments/phase0/results/compose1/`:
- `paragraphs.csv.gz`: 123,480 compositions.
- `lines_subset.csv.gz`.
- `signatures.json`.
- `meta.json` and `env.json`.
- `stage_a_baseline.json`.
- `determinism.json`.
- `analysis/*`.
- `review/*`.

**Reproduce from the repo root, prefixing each command with `PYTHONDONTWRITEBYTECODE=1`:**
```bash
tools/oracle/v0/.venv/bin/python experiments/phase0/compose1/run_matrix.py        # ~2 min (incl. Stage A, oracle tests)
tools/oracle/v0/.venv/bin/python experiments/phase0/compose1/check_determinism.py 10
tools/oracle/v0/.venv/bin/python experiments/phase0/compose1/analyze.py           # ~20 s
tools/oracle/v0/.venv/bin/python experiments/phase0/compose1/render_sheets.py
```

---

## 1. Question

Which composition policies can produce mechanically plausible newspaper **body text** at realistic Marathi column widths? Plausible means without unacceptable word spacing, without broken Devanagari, and without distorting glyphs.

The experiment also answers which variables dominate. **Headlines are out of scope.**

## 2. Baseline (Stage A: reproduced before anything else)

| Check | Result |
|---|---|
| Frozen oracle tests | Pass (return code 0) |
| The 203 BEHAVIOR fixtures regenerated | **Byte-identical** (all four files) |
| Phase 0 justification CSVs regenerated | **Byte-identical** |
| J0 original method | **0/240** feasible |
| Authored corpus | **79/1800** feasible |
| Engine-bug disagreements | **0** |

**Verdict:** the Phase 0 evidence is reproduced. No corruption and no contradiction.

**Malformed input:** none in the corpus used. Only `kind=body` texts were composed (30). Difficult, mixed and headline fixtures were excluded, including the malformed `mr-diff-17`, and are listed in `meta.json`.

## 3. Experiment matrix

| Dimension | Values |
|---|---|
| Texts | 18 Marathi, 2 Hindi, 10 English body paragraphs. Internally authored and fictional; **not native-reviewed** |
| Devanagari fonts (7) | Noto Serif Devanagari at wdth 100 / 87.5 / 75; Noto Sans Devanagari at wdth 100 / 75; Mukta; Tiro Devanagari Hindi. **wdth instances are widths the type designer created**, not distortion |
| Latin fonts (3) | Source Serif 4; Archivo (wdth 100); Archivo Narrow |
| Sizes | 8.5, 9, 9.5, 10 pt |
| Widths | 30.25, 34, 38, 41.5, 45, 48.5, 52, 56, 60 mm |
| Policies | 17 candidates + 3 measurement policies (§4); Devanagari 20, Latin 21 |
| Total | **123,480 compositions**, all deterministic (§12) |

## 4. Algorithms (what each policy does)

**Model.**
1. Shape with oracle-v0 (HarfBuzz 14.3.0).
2. Group glyphs into clusters.
3. Split into words at U+0020 only. NBSP never breaks.
4. Split words into pieces at permitted in-word breaks.
5. Line candidates run between piece boundaries.
6. Each candidate gets an explicit line cost (§5).

**Algorithms.**
- **GREEDY:** first-fit at natural spacing, then the family rule applies to that line.
- **DP:** global least-cost over the whole paragraph (Knuth–Plass-inspired). This is least-bad, never all-or-nothing, unless a HARD limit forbids every arrangement, in which case the result is OVERSET.

**Families.**

| Family | Behaviour | Overset possible? |
|---|---|---|
| **FULL** | Every non-final line justified within HARD limits | Yes: reported as OVERSET when no arrangement exists |
| **CONSTRAINED** (semi-justified) | Justify only up to the cap; otherwise set spaces at the cap and leave the line short | No |
| **RAGGED** | Natural spacing, flush left; DP minimises squared raggedness | No |
| **HYBRID** | A justified line when within HARD limits; otherwise a ragged line at natural spacing, with a fallback cost | No |

**In-word breaking** (kept as distinct classes):

| Class | What it is | Status |
|---|---|---|
| `none` | No in-word breaks | — |
| `rules` | Pattern-derived breaks: hyph-mr for Marathi, minimum 2 clusters each side; hyph-en-us for English | **Rule-based, not dictionary or linguistically validated** |
| `rules_publishedmin` | hyph-mr's own minimum of 1 akshara each side | Rule-based |
| `ortho` | Every cluster boundary | **EXPLORATORY / arbitrary.** Never a recommendation |
| Emergency | Cluster break only when a single word is wider than the measure; flagged and heavily penalised | — |

**Marathi letter-spacing:** disabled in every policy. **Latin tracking** (+10 and +20/1000 em per line) appears only in two English policies marked EXPLORATORY.

**Measurement policies** (`MEAS_*`, not candidates): justification with an effectively unlimited cap, used to read the spacing **required** to justify each line.

## 5. Hard and soft constraints and the penalty model (explicit)

**Spacing limits:**

| Limit | Value | Type |
|---|---|---|
| Word-space minimum | 0.80× natural | **HARD** |
| Preferred minimum | 0.90× | SOFT |
| Preferred / soft maximum | 1.33× (1.20× in `CONSTRAINED_c1.33`) | SOFT |
| Maximum (FULL / HYBRID), cap (CONSTRAINED) | 1.50 / 1.75 / 2.00 / 2.25× | **HARD** |
| Ragged zone (slack beyond this fraction of the measure is penalised) | 20% of the measure | — |

**Penalty units.** These are tuning choices, not truths, and are recorded in `meta.json`:

| Penalty | Formula |
|---|---|
| Spacing | `100 · ((sf − soft_max) / (hard_max − soft_max))²` above soft max; same shape below the soft min |
| Ragged line | `400 · (slack/M)²`, plus `100 · ((slack/M − 0.2)/0.2)²` beyond the zone |
| HYBRID fallback | +50 |
| CONSTRAINED shortfall | `400 · (short/M)²` |
| In-word break | +30 each; +60 if the previous line also ended with one |
| Emergency break | +10,000 |
| Very short final line (< 15% of M) | +10 |
| Latin tracking | `20 · (t/t_max)²` |

**Known approximation:** the consecutive-break penalty is path-dependent, which the DP approximates.

**Overset is a valid result.** No text was shortened, rewritten or scaled.

## 6. Results (summary; the full matrix is in `analysis/policy_matrix.csv`)

Marathi, all fonts and sizes, columns **≥ 45 mm**:

| Policy | Composable | Lines within policy* | Aligned (justified) lines | In-word breaks / 100 lines | p95 applied space |
|---|---|---|---|---|---|
| FULL_DP h1.50 | 6.5% | 0.9% | 0.9% | 0 | 1.49× |
| FULL_DP h1.75 | 9.3% | 2.6% | 2.6% | 0 | 1.65× |
| FULL_DP h2.00 | 12.9% | 5.1% | 5.1% | 0 | 1.95× |
| FULL_DP h2.25 | 17.4% | 8.5% | 8.5% | 0 | 2.14× |
| FULL_DP h2.00 + rules (hyph-mr, min 2) | 40.4% | 30.6% | 30.6% | 27.4 | 1.90× |
| FULL_DP h2.00 + rules (hyph-mr published min 1) | 87.7% | 86.5% | 86.5% | **38.4** | 1.84× |
| FULL_DP h2.00 + ortho (EXPLORATORY) | 45.8% | 35.9% | 35.9% | 28.8 | 1.90× |
| CONSTRAINED c1.50 | 100% | 47.7% aligned | 47.7% | 0 | 1.43× |
| CONSTRAINED c2.00 | 100% | 62.2% aligned | 62.2% | 0 | 1.83× |
| HYBRID_DP h1.50 | 100% | 38.8% | 38.8% | 0 | 1.42× |
| HYBRID_DP h2.00 | 100% | 52.9% | 52.9% | 0 | 1.82× |
| HYBRID_DP h2.00 + rules | 100% | 71.9% | 71.9% | 15.3 | 1.75× |
| RAGGED_DP | 100% | 93.5% inside the 20% zone | 0% | 0 | 1.0× (natural) |

*For FULL policies, overset paragraphs count all their lines as outside policy. The denominator is the paragraph's RAGGED_DP line count.

**Self-correction:** a first analysis pass showed FULL policies at "100% within policy". That was a denominator bug: overset paragraphs had no reference line count. It was **fixed before any conclusion was drawn** (see `analyze.py`, "FIX (2026-10-08)"). The raw results were unaffected.

## 7. Words-per-line analysis

Marathi, per paragraph-geometry, binned by natural words per line:

| Words / line | Cases | Lines needing ≤ 2.0× to justify | FULL h2.00: composable / within | FULL + rules (min 2) | HYBRID h2.00 within | CONSTRAINED c1.50 aligned |
|---|---|---|---|---|---|---|
| < 3 | 295 | 14.8% | 0 / 0 | 0 / 0 | 19.2% | 21.3% |
| 3–4 | 891 | 24.3% | 0.7 / 0.1 | 1.9 / 1.0 | 31.2% | 29.8% |
| 4–5 | 1,247 | 32.5% | 1.5 / 0.2 | 16.4 / 10.6 | 40.2% | 38.1% |
| 5–6 | 1,036 | 44.3% | 4.5 / 1.8 | 27.0 / 22.6 | 53.3% | 47.6% |
| 6–7 | 597 | 51.9% | 10.7 / 8.6 | 49.9 / 46.7 | 63.4% | 56.1% |
| 7–8 | 250 | 64.4% | 24.4 / 18.2 | **79.2 / 79.5** | 71.9% | 62.0% |
| ≥ 8 | 91 | **80.2%** | 61.5 / 56.3 | **91.2 / 90.6** | 80.6% | 68.3% |

**Findings:**
- Quality rises steadily, about **+11 percentage points per extra word per line** (linear fit over 4,834 Devanagari paragraph-geometries, R² = 0.44).
- There is no single cliff. FULL justification becomes mostly feasible only at **≥ 7–8 words per line, and only with rule-based akshara breaks**.
- Our test fonts give only **3–6.6 words per line at 30–60 mm**.

## 8. Word-spacing analysis

Marathi lines at 9–9.5 pt and 38, 45 and 52 mm (`analysis/summary.json` → `spacing_distributions…`).

**Required spacing to justify every non-final line** (least-bad justified DP, uncapped):

| Statistic | Value |
|---|---|
| Median | **2.48×** |
| p90 | 5.13× |
| p95 | 6.28× |
| Max | 32.1× |
| Lines above 1.5× | 80% |
| Lines above 2.0× | 64% |
| Lines above 3.0× | 37% |

English is worse (median 2.84×), because the Latin test fonts are wider per character.

**Applied spacing** on justified lines stays within each cap by construction (for example HYBRID h2.00: median 1.29×, p95 1.83×). The price is paid elsewhere: in **aligned-line share**, in raggedness, or in in-word breaks.

**Threshold sensitivity** (FULL DP, pooled Marathi lines within policy at ≥ 45 mm):

| Cap | Lines within policy |
|---|---|
| 1.50× | 0.9% |
| 1.75× | 2.6% |
| 2.00× | 5.1% |
| 2.25× | 8.5% |

For HYBRID, raising the cap from 1.5× to 2.0× moves the share from 38.8% to 52.9%. **No cap in the tested range changes the conclusion.**

## 9. Width analysis (the geometry chain, made explicit)

Marathi, pooled over fonts and sizes:

| Width (mm) | Words / line | Chars / line | Lines needing ≤ 1.5× | ≤ 2.0× | ≤ 3.0× |
|---|---|---|---|---|---|
| 30.25 | 3.15 | 22.7 | 12.2% | 22.0% | 40.3% |
| 38 | 4.03 | 28.6 | 15.9% | 29.3% | 53.4% |
| 45 | 4.83 | 34.4 | 21.3% | 38.0% | 64.9% |
| 52 | 5.65 | 40.2 | 24.8% | 45.8% | 76.2% |
| 60 | 6.58 | 46.0 | 29.6% | 52.7% | 83.7% |

**Mechanism** (`analysis/break_opportunity_geometry_mr.csv`; Noto Serif Devanagari w100 at 9.5 pt):
- The mean word is 8.22 mm and the mean space 0.87 mm, so space-break opportunities fall **9.1 mm** apart.
- The acceptable window (0.8–2.0× spacing) is 2.4 mm at 30 mm, 4.1 mm at 45 mm and 5.9 mm at 60 mm. Window ÷ gap = 0.27, 0.45 and 0.64.
- Rule-based akshara breaks shorten the mean piece to 4.6 mm, raising window ÷ gap to 0.53, 0.89 and 1.26.

**Rule of thumb from the data:** a justified line is reliably achievable only when window ÷ break-gap ≥ about 1. With word breaks alone, that requires either very wide measures or many more words per line than our fonts give.

## 10. Font analysis (does typeface width matter?)

Marathi, ≥ 45 mm:

| Font | em per character | Chars / line (9.5 pt, 45 mm) | Words / line | Lines needing ≤ 2.0× | HYBRID h2.00 within | HYBRID + rules within |
|---|---|---|---|---|---|---|
| Noto Serif Deva w100 | 0.324 | 31.9 | 4.75 | 45.9% | 55.5% | 74.4% |
| Noto Serif Deva w87.5 | 0.299 | 35.3 | 5.13 | 49.7% | 59.8% | 77.4% |
| Noto Serif Deva **w75** | **0.276** | **38.3** | **5.62** | **54.0%** | **64.0%** | **80.5%** |
| Noto Sans Deva w100 | 0.348 | 29.1 | 4.43 | 39.1% | 49.5% | 69.7% |
| Noto Sans Deva w75 | 0.289 | 36.9 | 5.40 | 45.8% | 57.7% | 74.8% |
| Mukta | 0.329 | 31.7 | 4.74 | 38.4% | 50.7% | 69.2% |
| Tiro Devanagari Hindi | 0.352 | 28.6 | 4.38 | 38.1% | 48.2% | 67.7% |

A designed-narrow instance (w75 vs w100) adds about **+8 percentage points** to justifiable lines and about +6–9 points to hybrid alignment. That is real but **not sufficient**: no font reaches 98% in any justified family.

**Size** (Marathi, ≥ 45 mm):

| Size | Words / line | Lines needing ≤ 2.0× |
|---|---|---|
| 8.5 pt | 6.2 | 48.2% |
| 10 pt | 5.2 | 39.1% |

That is about a **7-point spread**. Sizes below 8.5 pt were deliberately not tested.

## 11. Breaking and hyphenation analysis (what actually helps)

**hyph-mr facts**
- Source: hyph-utf8, © 2016 Santhosh Thottingal; licence MIT / LGPL-3+ / GPL-3+.
- Version 0.9.0 (2016); 33 generic rules.
- It is **akshara segmentation, not dictionary or morphology-aware hyphenation**.
- Coverage gaps: ऱ, ॅ, ॉ, ॲ, ऑ and nukta consonants have no rules.
- Status: investigation only; **LICENCE REVIEW REQUIRED** before production (`third_party/SOURCES.json`).

**Effect on Marathi at ≥ 45 mm**

| Policy | Composable | Lines within policy | In-word breaks |
|---|---|---|---|
| FULL h2.00, no in-word breaks | 12.9% | 5.1% | — |
| FULL h2.00, hyph-mr min 2 | 40.4% | 30.6% | 27 per 100 lines |
| FULL h2.00, hyph-mr published min 1 | 87.7% | 86.5% | **38 per 100 lines**, ≈ 2.1 per paragraph |
| HYBRID h2.00, no in-word breaks | — | 52.9% | — |
| HYBRID h2.00, hyph-mr min 2 | — | 71.9% | 15 per 100 lines |

- **At the published minimum**, the review sheets show **single-akshara fragments** at line ends (for example "अ-" / "सून", "जि-" / "ल्ह्यांमध्ये"). This is mechanically "successful" but **typographically questionable**. It is exactly the 98%-style gaming the brief warned against, and it is **not** recommended without editorial validation.
- **Arbitrary cluster breaking** (ortho, EXPLORATORY) helps less than the rule-based published-minimum variant and is excluded from recommendations.
- **English:**
  - Liang patterns (hyph-en-us) raise FULL composability from 10% to 22%.
  - +20/1000 em per-line tracking (EXPLORATORY) raises it to 41%.
  - English with these wide fonts has the same geometry problem.

**Paragraph-global (DP) vs greedy:**
- **HYBRID:** DP raises aligned lines from 45.8% to 53.2% (Marathi; English 40.6% → 46.5%) **and** lowers p95 spacing from 1.94× to 1.82×. This is a material, consistent improvement.
- **FULL:** composability 12.9% vs 10.9%.
- **Raw "required spacing ≤ 2×"** is not improved by DP (43.9% vs 45.1%). DP minimises total badness, not the count of lines below a threshold.
- **Conclusion:** global optimisation helps the *distribution*, not the geometry.

## 12. Performance

Composition only. Shaping and font load are reported separately. Apple M4 Pro, warm.

| Measurement | p50 | p95 | Max |
|---|---|---|---|
| DP per paragraph | 0.06–0.40 ms | ≤ 1.44 ms | 14.7 ms |
| Greedy per paragraph | ≈ 0.04 ms | — | — |
| Shaping (prepare) per paragraph | 0.35 ms | 0.70 ms | — |

| Scenario at 38 mm | p50 | p95 |
|---|---|---|
| Story, 6 paragraphs, HYBRID DP | 1.6 ms | — |
| Story, 6 paragraphs, HYBRID DP + rules | 6.9 ms | 7.2 ms |
| Page, 90 paragraphs, HYBRID DP | 23.9 ms | 36 ms |
| Page, 90 paragraphs, HYBRID DP + rules | 84 ms | 103 ms |

Rules cost about 4× more because there are more break candidates. **Even so, this stays far inside the budgets:** 250 ms ceiling for a story, 1 s for a page.

**Cold font load** (fresh registry):

| Font | Cold load |
|---|---|
| Source Serif 4 | 3.3 s |
| Noto Serif / Sans Devanagari | 0.3–0.6 s |
| Mukta and Tiro (static fonts) | **≈ 7 ms** |

This confirms variable-font instancing is the cold-start cost (Phase 0 risk NR3).

**Determinism:**
- 12,348 compositions (1 in 10) re-run in a fresh process gave **identical signatures, 0 mismatches**.
- All outputs are hashed in `signatures.json`.

## 13. Failure cases (selected programmatically)

**FULL h2.00 at 45 mm, 9.5 pt, Noto Serif w100:** all 18 Marathi paragraphs are **OVERSET**.

**Worst required spacing** comes from unbreakable tokens. `mr-body-13` (a URL and an email) needs **35×** on two-word lines. `mr-body-04` (long compounds such as शेतकऱ्यांच्या कर्जमाफीच्या मुद्द्यावरून) needs 22×.
- This is a new category: **long unbreakable tokens**. URLs, emails and long compounds need their own break rules (URL break points) or editorial handling.

**HYBRID fallback lines** can be very short: up to 22.9 mm of slack in a 45 mm column (≈ 51%). These are the lines a reviewer will notice.

**CONSTRAINED lines** combine widened spaces *and* a short right edge. That is visible on the sheets, and may be worse than either pure option. This needs human judgement.

## 14. Pareto options (trade-offs, not a winner)

Practical frontier: policies composing **every** paragraph. Marathi, ≥ 45 mm, 9–9.5 pt (`analysis/summary.json` → `pareto_practical_composable_ge99`).

| Option | Aligned lines | p95 space | In-word breaks / 100 lines | Mean raggedness | Character |
|---|---|---|---|---|---|
| RAGGED (greedy or DP) | 0% | natural | 0 | 9.7–9.8% | Most natural spacing; no alignment |
| CONSTRAINED c1.33 / c1.50 | 41–48% | 1.28–1.43× | 0 | 8–9% | Tight spacing; many short lines that also have widened spaces |
| CONSTRAINED c2.00 | 62% | 1.83× | 0 | 6.5% | More alignment; looser spaces |
| HYBRID h2.00 | 53% | 1.82× | 0 | 8.3% | Justified where possible, natural ragged otherwise |
| HYBRID h2.00 + rules | **72%** | 1.75× | **15** | 4.5% | Most alignment without letter-spacing, at the cost of akshara breaks |
| FULL + rules (published min, composable 88% only) | 88% | 1.84× | **38** | — | Near-full justification via frequent, sometimes one-akshara, breaks; 12% overset |

RAGGED_DP was dominated by RAGGED_GREEDY only on *mean* raggedness, but has lower p95 raggedness (0.22 vs 0.24). The frontier metric set omits p95 raggedness. This is noted, not hidden.

## 15. Review sheets
- **Engineering:** `experiments/phase0/results/compose1/review/engineering/*.svg`. There are 28 sheets: 7 texts × 4 geometries, 6 chosen by seeded RNG plus the two worst-spacing texts. Each shows 9 policies side by side with per-line spacing, colour-coded flags and metrics.
- **Human (blind):** `review/human/sample-01.svg` … `sample-12.svg`.
  - 12 seeded samples; 4 families labelled **A–D in seeded random order**.
  - No metrics and no algorithm names.
  - The key (`KEY_SEALED.json`) must be held by a non-rater.
  - Representatives were chosen by a documented rule, not by preference.
  - **Not yet reviewed by anyone qualified.**
- Rendering was checked visually by rasterising two sheets: Devanagari conjuncts, matras and hyphens draw correctly at the composed positions.

## 16. Internal plausibility result

**Criterion:** at ≥ 45 mm, a policy with word spaces < 2× and no Marathi letter-spacing places ≥ 98% of lines within policy.

**Result:**
- **FAIL** for every justified-family policy (FULL, CONSTRAINED, HYBRID), in every font, pooled or per font. Best results:
  - FULL with hyph-mr at the published minimum: 86.5%, achieved only via about 38 akshara breaks per 100 lines, including single-akshara fragments.
  - HYBRID + rules: 71.9%.
- RAGGED meets "spaces < 2×" **trivially** (natural spacing; 93.5% of lines inside the 20% ragged zone). The criterion was written for justified composition, so ragged passing it says nothing about alignment.
- **Interpretation:** with these fonts and sizes, 45–60 mm columns give 4.8–6.6 words per line. That is fundamentally too few for full justification within 2× without frequent in-word breaking.
- **What is not known:** whether the pilot's real fonts, sizes and measures, and their tolerance for spacing and akshara breaking, sit somewhere else entirely.

## 17. G1 status

**NOT MET.** No external review has happened. The corpus is internally authored. No pilot typography has been measured.

## 18. Architecture impact

| Finding | Effect |
|---|---|
| Composition cost (DP ≤ 1.5 ms p95 per paragraph; page with rules ≈ 100 ms) | **SUPPORTS** the server-authoritative kernel (ADR-017). Paragraph-aware optimisation does not change the architecture |
| No small-adjustment policy reaches plausibility for justified Marathi | **REINFORCES the challenge to `16` §3.1** recorded in Phase 0. The policy must offer *families* (full / constrained / hybrid / ragged) plus in-word breaking classes. A single "KP → emergency stretch → tracking" chain is insufficient. Not an ADR change |
| Overset is a common correct answer (FULL ≥ 45 mm: 87% overset) | **New requirement** for the kernel contract (`16` §1.8): every line must carry its alignment kind, applied and required spacing and quality flags; paragraphs must carry OVERSET with a reason. Copyfit/layout must consume these. Not an ADR change |
| URLs and long compounds dominate worst cases | **New requirement:** token-class break rules (URL, email, numbers) |
| hyph-mr is generic akshara rules with coverage gaps | **No production dependency.** LICENCE REVIEW (L10) plus linguistic validation required |
| G1 threshold A6 ("≤ 2% lines outside policy") | Unattainable for justified families under the tested geometry. **Must be defined per family and calibrated to the pilot's published pages** (`G1_ACCEPTANCE_PACKAGE.md` §7.5). Recommend revisiting only after published-page measurement |
| Engine language | No change. These results do not discriminate between languages (the bake-off remains separate) |

## 19. New risks

| ID | Risk | Evidence | Probability / impact | Gate | Mitigation |
|---|---|---|---|---|---|
| CR1 | **The pilot expects full justification, but its geometry or fonts make it infeasible** without visible defects | §6–§10 | Medium / Critical | G1 | Measure published pages; offer families; show trade-offs to editors |
| CR2 | Akshara breaking is unacceptable to Marathi editors, removing the strongest lever | hyph-mr is generic; single-akshara fragments visible | Medium / High | G1 | Editorial question in G0 §2.D; keep `rules` optional |
| CR3 | Unbreakable tokens (URLs, emails, long compounds) produce extreme lines | §13 (35×, 22×) | High / Medium | G1, G3 | Token break rules; editorial handling; flag in preflight |
| CR4 | The corpus may misrepresent real word-length distribution (AI-authored) | Provenance | Medium / High | G1 | Replace with pilot copy (P0-03) |
| CR5 | Thresholds and weights become accidental policy | Penalty model is explicit but untuned | Medium / Medium | — | Keep weights as experiment parameters until human review |

## 20. Recommended next experiment (one exact action)

### NEXT: EXP-PUBLISHED-1, measure the pilot's real published body typography

**Question.** What words-per-line, word-spacing distribution, alignment style and akshara-break practice do the pilot's printed pages actually show?

**Why this is next.** Every decisive conclusion above depends on geometry and editorial tolerance that our synthetic corpus cannot supply.

**Input.** 3–5 of the pilot's print PDFs (P0-03), plus the font names and sizes they used. **BLOCKED on G0.** No public newspaper material is used without counsel's sign-off.

**Procedure.**
1. Build a measurement script that reads **positioned glyph runs** from the PDF content streams. Do not rely on text extraction, which is unreliable for Devanagari.
2. Per body column, detect lines and inter-word gaps, and compute:
   - column width;
   - words per line;
   - the word-gap distribution, normalised by the font's space;
   - the share of lines aligned at the right edge;
   - the frequency of in-word breaks (a line ending in a hyphen or mid-word);
   - letter-spacing (inter-cluster gap variance).
3. Re-run EXP-COMPOSE-1 with the pilot's widths, sizes and (licensed) fonts. Compare each policy family against the published distribution.

**Metrics.**
- Published words per line (median and p10–p90).
- Published word-space p50 / p95 / max.
- Aligned-line share.
- Akshara breaks per 100 lines.
- The **distance between each Pageinator policy and the published distribution** (for example, Kolmogorov–Smirnov distance on spacing).

**Pass condition.** At least one non-distorting policy matches or beats the published spacing distribution at the pilot's geometry. That earns it a place in the G1 human review.

**Fail condition.** No policy can match the published pages.
- Investigate how they achieve it: tracking, glyph scaling, manual edits.
- Escalate as an editorial and technical question.

**Expected duration.**
- The measurement script can be built in advance: 2 days.
- Analysis takes 1–2 days once the PDFs arrive.

**Architecture decision affected.** `16` §3.1 (composition policy) and the G1 threshold A6. Indirectly, which composition families the kernel contract must support.

**Not started.** It needs P0-03, and its measurement tool would read customer PDFs.
