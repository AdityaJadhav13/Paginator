# Parts 15, 16 and 18: New Risks, Architecture Impact, Exact Next Experiment

## Part 15: New risks discovered in Phase 0

| ID | Risk | Evidence | Probability | Impact | Gate | Mitigation | Owner / next action |
|---|---|---|---|---|---|---|---|
| NR1 | **Justified Marathi body text at realistic measures may be unattainable with word-spacing-only composition.** G1 could fail as defined | 66% of 1,800 cases are "measure too narrow" even with akshara breaks at every boundary and 2× spaces. Median required word spacing is 2.5× (45 mm) to 3.7× (30 mm) | **High** | **Critical** | G1 | (1) Measure the pilot's **published** spacing and words per line (P0-03). (2) Composition with soft caps plus a per-line adjustment repertoire (next experiment). (3) Editorial decisions on akshara breaking, letter-spacing and ragged styles. (4) Font set width and size | Engine lead: EXP-COMPOSE-1. Founder: G0 §2.D questions |
| NR2 | **Malformed Devanagari passes silently** (OL-12). A bad legacy conversion or bad paste would print wrong text without warning | `mr-diff-17`: the oracle emits no dotted circle and no error; `hb-shape` inserts one | Medium | High | G1, G3 | A kernel validation rule (proposed preflight `TXT010` malformed cluster), and harness invariant A2 | Engine lead (kernel requirement) |
| NR3 | **Cold font loading of 0.5–3.2 s** (variable-font instancing) on a server kernel. Per-tenant fonts loaded lazily would stall interactions, or a deadline after a restart | `measure_performance.py` A_cold: Noto Serif Devanagari 525 ms; Source Serif 4 3.2 s | High (if unmitigated) | High | G3, G4 | Preload each publication's font instances at kernel start; cache instanced bytes by hash; keep warm pools during the deadline window (ADR-020) | Engine lead (kernel requirement) |
| NR4 | **The Phase 0 corpus is AI-authored and not native-reviewed.** Unnatural Marathi could bias the metrics | Corpus provenance note | Medium | Medium | G1 | Replace or augment with pilot material (P0-03). Ask one native editor to sanity-check the corpus | Founder |
| NR5 | **Glyph-name instability after subsetting** (`post` format 3) could break identity checks that compare names | `pdf_probe`: 29 names changed while outlines and glyph IDs were identical | Medium | Low | G2 | Compare outlines and IDs, never names (recorded in the PDF plan) | Engine lead |
| NR6 | **The paragraph-level "feasible / infeasible" metric misleads.** It hides that most failures are one or two lines | e.g. hi@52 mm: 27/27 infeasible paragraphs had ≤ 2 bad lines | High | Medium | G1 | Report line-level metrics (space-factor distribution, % lines outside policy) as primary | Done in the harness |
| NR7 | **The oracle ignores the `opsz` axis.** Latin optical sizing would be wrong in production | Source Serif 4 widths identical at opsz 9.5 / 20 / 60 | Medium | Low | G1 (English titles) | Kernel requirement: set `opsz` = point size when the axis exists | Engine lead |
| NR8 | **Generated page glyph density** (3–12k) is below v2's assumption (≈ 20k). The bake-off could be tuned to the wrong load | `results/render_workload/stats.json` | Medium | Low | — | Typical page plus a 25k stress page (`RENDERER_BAKEOFF_AND_BUDGETS.md` §10.2) | Frontend engineer |
| NR9 *(2026-10-11)* | **The pilot's body face is commercial** (`FourCMR*`, 4CPlus, vendor ID `4CPL`). Server-side composition, browser preview and archive rights are unknown | Embedded name tables in the pilot PDFs. `fsType` 8 permits PDF embedding only | High | High | G0, G1, G2 | Obtain 4CPlus licence terms (P0-11, counsel L2). Meanwhile use an OFL stand-in calibrated on the same words | Founder |
| NR10 *(2026-10-11)* | **Default PDF text extraction is wrong for Devanagari**; archive import built on it would be wrong | PDFium omits 1,008 of 11,387 glyphs on one page; pdfminer mis-decodes conjuncts. **Mitigated for these PDFs:** the exact text is in `/ActualText` spans, and `actualtext.py` recovers it (26/26 lines against a hand check; 701 paragraphs consistent with geometry; `EXP_COMPOSE_3_REPORT.md` §2) | Medium (other producers may omit ActualText) | Medium | Archive phase | Use an ActualText-aware extractor; prefer source story files where available; test other producers' PDFs before relying on them | Engine lead |
| NR11 *(2026-10-11)* | **House practice compresses word spaces to about 0.66×; our spacing model effectively forbids compression when stretch is unbounded.** With the same rules our columns are looser than InDesign's | `EXP_COMPOSE_2_REPORT.md` §18 (one extra line in a 12-line paragraph; more lines above 3× at all three widths) | High | High | G1 | **Mitigated on average (EXP-COMPOSE-3):** the asymmetric spacing model ties print on held-out editions. Residual: squeezes slightly more often than print (4.2% vs 3.6% of lines below 0.8×) | Engine lead |
| NR12 *(2026-10-11)* | **Per-story horizontal glyph scaling (96–107.5%) is house practice** and absent from our model | 66% of pilot body lines | High | Medium | G1 | Product and typography decision: support it as a copyfit control, or not. Ask the pilot's designer | Founder + pilot designer |
| NR14 *(2026-10-11)* | **Renderers disagreeing on a coordinate convention** (sign of vertical mark offsets) silently misplace Devanagari marks while every self-consistency test passes | EXP-PDF-1 code review: below-base ्र, ु/ू mirrored by up to 0.26 mm; the old SVG helper had the same bug | Medium | High | G1, G2 | **Fixed**. Independent HarfBuzz re-shaping check plus mutation test (`pdfx1/verify_press_test.py`, `mutation_test.py`); a contract test is required for every production renderer | Engine lead |
| NR15 *(2026-10-11)* | **The press's real output condition and ink limit are unknown**; the RIP's tolerance of a hand-written PDF/X is unproven | Owner: "PDF/X, CMYK"; the press's own files are non-X InDesign PDFs with RGB and transparency | Medium | Medium | G2 | Conservative X-1a page; record sheet asks for the profile and ink limit; `--dest-profile` ready | Founder + printing unit |
| NR13 *(2026-10-11)* | **Marathi word breaks tighten spacing, but the pilot practically never breaks words**, and pattern breaks include doubtful ones (before independent vowels) | `EXP_COMPOSE_2_REPORT.md` §18 | Medium | Medium | G1 | Blind review (R5); restrict break classes; cap break frequency | Engine lead + reviewers |
| NR16 *(2026-10-12)* | **The pilot's headline shape is not consistent** (fill the first line vs balanced lines), so agreement with print cannot choose the headline policy | `EXP_HEAD_1_REPORT.md` §5.3: on headlines with a real choice the calibration editions favour "fill" (73% vs 37% balanced); the later editions tie (53–56%, chance 42%) | High | Medium | G1 | Owner (2026-10-13): the house rule differs by page, not by designer; page number alone does not explain it in the data. Shape becomes a per-page setting supplied by the designer; editors confirm in the headline review; crossheads use first-fit | Founder + pilot editors |
| NR17 *(2026-10-12)* | **A stand-in font cannot reproduce about 10% of printed headlines** (its per-line widths differ from the house font's), which limits headline evidence | `EXP_HEAD_1_REPORT.md` §5.2: 44 of 424 printed headlines overflow the stand-in (median 1.1 mm) | High | Low | G1 | Report the comparable set separately; obtain the house font (P0-11) | Founder |
| NR18 *(2026-10-14)* | **Stand-in font widths leave 1–2 overset lines on most rebuilt pages** (justified columns have no give) | `EXP_PAGE_1_REPORT.md` §5: overset on 54 of 60 Marathi pages, 1.2% of lines | High | Medium | G1, G2 | House fonts (owner supplies); a copyfit step within house tolerances | Engine lead |
| NR19 *(2026-10-14)* | **Bilingual flip editions need English hyphenation and typography** | `EXP_PAGE_1_REPORT.md` §5: English pages 26.8% depth vs 95.1% Marathi | Medium | Medium | G1 | Separate English policy with hyphenation | Engine lead |

## Part 16: Architecture impact of each finding

| Finding | Effect | Affected ADR / doc | Recommendation |
|---|---|---|---|
| Oracle runs, 182/182 tests, byte-identical copy, isolated reproducible environment | **SUPPORTS** | `16` §2 (oracle plan), ADR-017 front-runner | None |
| No Knuth–Plass engine bug (1,800/1,800 agreement with an independent check) | **SUPPORTS** | ADR-017 (A as a viable baseline) | None |
| Warm compute 0.3–0.5 ms per paragraph; ≤ 3 ms per story edit; 24–95 ms per page | **SUPPORTS** the server-kernel option on compute. **INSUFFICIENT EVIDENCE** overall (network and rendering unmeasured) | ADR-017 | Run Part 9 S3–S5. Do not migrate languages for performance |
| Justification infeasible under word-spacing-only policies; words per line dominant; in-word breaks insufficient for Marathi | **CHALLENGES** `16` §3.1. Its fallback chain (KP → emergency stretch → tracking ±10/1000 em → greedy) implicitly assumes small adjustments suffice. Evidence shows emergency stretch would mean visibly loose lines. Devanagari letter-spacing has an unresolved editorial status. **Does not challenge any ADR** | `16` §3.1–3.2 (TYPO thresholds) | **Revise `16` §3.1 after EXP-COMPOSE-1 and the pilot's published-page measurements.** The L3 threshold ("≤ 2% lines outside policy") must be calibrated to the pilot's own pages (G1 package §7.5). REQUIRES EXTERNAL VALIDATION |
| Bake-off ordering: performance will not discriminate; run the latency experiment before the B/C slices | Refinement inside `16` §1 (sequence, not decision rule) | ADR-017 unchanged | Recorded in `ENGINE_AND_LATENCY_EXPERIMENTS.md` §8.3 |
| Cold font load 0.5–3.2 s | **SUPPORTS** ADR-020 (adds a requirement) | ADR-020, `08` | Kernel requirement: preload and cache font instances. No ADR change |
| Malformed Devanagari passes silently | No ADR effect; **new requirement** | `08` §5 preflight | Add TXT010 when preflight is specified in detail |
| Glyph-ID-retaining subsetting works for TrueType fonts | **SUPPORTS** ADR-006's font approach | ADR-006 | Press TrueType acceptance is still unknown (`17` F2) |
| Page glyph density lower than assumed | No ADR effect | `16` §4.2 | Add a stress page (done in spec) |
| PDF/X validation is commercial-only; Ghostscript/MuPDF AGPL | **SUPPORTS** ADR-022 and `18` | — | Counsel L1 |
| Auth CVE finding (from the review) | No Phase 0 effect | ADR-008 (PROPOSED) | Deferred: auth is not a Phase 0 risk |
| AI | No effect: no AI used or needed in any Phase 0 path | ADR-020 | Principle holds |
| *(2026-10-11)* Pilot pages: 90% justified, gap p95 about 4×, spaces compressed to 0.66×, per-story scaling, practically no word breaks | **CHALLENGES** the 2× TYPO threshold in `16` §3.1–3.2. **Confirms** the G1 package rule of calibrating to the paper's own pages. **No ADR effect** | `16` §3.1–3.2, `G1_ACCEPTANCE_PACKAGE.md` | Calibrate thresholds to the measured distributions after human review |
| *(2026-10-11)* Commercial house font (4CPlus) | No ADR change; raises the priority of P0-11 | `19`, ADR-006 font approach | Licence questions to the vendor |
| *(2026-10-11)* Default PDF text extraction wrong for Devanagari; exact text recoverable from `/ActualText` | No ADR change; **new requirement** for archive ingest | `10` | An ActualText-aware extractor (`actualtext.py` is the reference); source text preferred where available |
| *(2026-10-11)* Spacing-model asymmetry (shrink effectively forbidden) | No ADR change; kernel-contract input, **now evidenced** (EXP-COMPOSE-3 ties print) | P0-05 | Independent shrink and stretch scales, in house-font space units |
| *(2026-10-12)* Headlines (EXP-HEAD-1): exact enumeration; HARD keep-together rules never broken (print breaks them 11 times); line count right 99%; shape not determined by the data; crossheads first-fit | No ADR change; **kernel-contract input**: headline policy = script-level keep-together rules (HARD) + house pairs learned from the paper (STRONG, relaxable) + shape per role + copyfit grid | P0-05, `16` §3 | Shape decided by the headline blind review; first-fit for crossheads |

**No ADR status was changed in Phase 0.** One planning section (`16` §3.1) is flagged as challenged by evidence. A dated pointer has been added at the end of `16`; §3.1 itself is unchanged pending the next experiment.

## Part 18: Exact next experiment

### NEXT EXPERIMENT: EXP-COMPOSE-1, a soft-constraint composition policy sweep with review sheets

**Question.** Which composition repertoire can reach acceptable justified (or semi-justified) Marathi body text at realistic measures? What does each lever cost typographically? The levers are:
- best-effort Knuth–Plass with hard caps;
- per-line letter-spacing (Latin only);
- akshara-level in-word breaks (hyph-mr patterns versus none);
- ragged / semi-justified styles;
- font set width and size.

**Hypothesis.** A best-effort composer with these properties brings ≥ 98% of non-final lines inside the policy for Marathi at ≥ 45 mm and ≥ 6 words per line:
- hard cap of word spacing ≤ 2.0×;
- soft penalties above 1.33×;
- akshara breaks allowed only at pattern-approved points;
- no letter-spacing.

Narrower measures need a ragged or semi-justified style, or a smaller or narrower font.

**Input.**
- The Phase 0 corpus, with real pilot paragraphs swapped in when P0-03 delivers.
- Fonts: the 4 OFL Devanagari faces, plus `wdth` variants.
- Sizes 8.5–10 pt; widths 30–60 mm.
- hyph-mr patterns, only after a licence check (L10). Without them, run the "no in-word breaks" and "orthographic upper bound" arms.

**Procedure.**
1. Write `experiments/phase0/compose/` as an **EXPERIMENTAL COMPOSITION ENGINE**, separate from the oracle. It reuses oracle shaping and node building through the public API and adds:
   - soft-cap Knuth–Plass (demerits plus hard caps, never all-or-nothing);
   - per-line justification (word space, plus Latin letter-space if enabled);
   - ragged and semi-justified modes;
   - a per-line quality report.
2. Sweep the policy grid (≈ 48 policies × the corpus × widths and sizes). Record line-level metrics: the space-factor distribution, the share outside the policy, rivers (simple vertical-gap detector), in-word break rate, and consecutive loose lines.
3. Render **review sheets as SVG/PDF from glyph outlines** for the top 5 policies and the baseline. Use fontTools pens; no new PDF dependency. Include side-by-side pages at 100% for internal review now and for the G1 review later.
4. Produce the CHANGES-vs-oracle fixture set (`fixtures/compose/v1`, class BEHAVIOR of the *experimental* composer) with a changelog.

**Metrics.**
- % of non-final lines outside each policy.
- Space-factor p50, p95 and max.
- Consecutive loose-line runs.
- River count.
- In-word break rate.
- Paragraph depth change against greedy.
- Compute time per paragraph (should stay ≤ 2 ms p95 on the dev machine).

**Pass condition.**
- At least one non-gamed policy (word space ≤ 2.0×, no Devanagari letter-spacing) achieves **≤ 2% of lines outside policy and no runs of 3 loose lines** for Marathi at ≥ 45 mm in ≥ 2 fonts.
- Its review sheets are judged *plausible for newspaper print* by an internal sanity review, **pending G1 human review**. **This is not G1.**

**Fail condition.**
- No policy within the caps reaches the threshold. Record the best achievable numbers per width, then escalate as **editorial decisions** for the pilot:
  - akshara breaking;
  - ragged columns;
  - wider measures or smaller type;
  - narrower fonts.

  Re-test with the pilot's real fonts and widths when they arrive.

**Expected duration.** 4–6 engineer-days, including review-sheet rendering.

**Architecture decision affected.**
- `16` §3.1 (composition policy) and the G1 thresholds (`16` §3.2).
- Indirectly ADR-017. This is the policy every engine candidate must implement before the bake-off or the latency experiment.

**Authorisation needed.** This experiment begins implementing composition behaviour (the "fix" this assignment barred). **It has not been started.**

**In parallel (people, not code):**
- send the G0 package: the pilot MoU and the questions of §2.D;
- schedule the press interview;
- book counsel for L2, L5 and L10.

The decisive missing number for G1 is the **words per line and word spacing of the pilot's published pages**. It needs only P0-03.
