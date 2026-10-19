# EXP-HEAD-1: Headline Line Breaks on the Pilot's Own Headlines (report)

**Status:** COMPLETE (experiment). The headline blind-review sheets are ready; **no human rating has happened yet**. **G1: NOT MET.**

**What this is:** experimental engineering, not the production typesetter and not an engine-language decision (ADR-017).
- The composer lives in `experiments/phase0/head1/`.
- compose1 and compose2 stay frozen with their results; the frozen oracle was **not modified**.
- No AI was used for breaking, sizing, rewriting or scoring.

**Data:** the pilot newspaper's own published pages (owner-supplied, evidence level A). Only **aggregate** numbers appear here. The headlines, the per-headline results, the data-derived word lists, the review sheets and the key stay in `$PAGEINATOR_PRIVATE_CORPUS`.

**Date:** 2026-10-12. **Composer:** `head1/1.3.1`. **Stand-in font:** Noto Sans Devanagari (OFL), wght 700 or 800, sized per headline (the review sheets also use its width axis).

**Reproduce from the repo root, prefixing each command with `PYTHONDONTWRITEBYTECODE=1`. `$DS` is the private dataset directory:**
```bash
experiments/phase0/published1/.venv/bin/python experiments/phase0/published1/headlines.py "$DS"   # display text, exact (ActualText)
tools/oracle/v0/.venv/bin/python experiments/phase0/head1/run_head1.py "$DS"                       # ~9 s; deterministic
tools/oracle/v0/.venv/bin/python experiments/phase0/head1/proofs_head1.py "$DS"                    # private review sheets
python3 experiments/phase0/compose3/analyze_round1.py "$DS/report/round1_headlines"                # after the sheets come back
```

---

## 0. In plain words
- **We read every headline, deck and crosshead in the paper's 15 editions** and re-set 603 Marathi ones (424 headlines) in the same column widths.
- **Pageinator never breaks a keep-together rule** (a title from its name, a number from its unit, a date, punctuation or a dash at a line start). The paper's own pages break these rules 11 times.
- **Pageinator picks the paper's number of lines 99% of the time**, wherever our stand-in font can redraw the printed headline.
- **Most headlines leave no choice.** The paper sets headlines tight (98% of the width), so 82% of them have only one possible layout at the printed size. "Matches print 90% of the time" is therefore mostly automatic, and we do not claim it as a success.
- **Where there is a real choice (66 headlines), no simple rule predicts the paper.**
  - In the earlier editions the paper mostly filled the first line: first-fit and "fill" matched 70–73%, balanced lines only 37%.
  - In the later editions all three styles match about half (53–56%, against 42% by chance). The house style is not consistent.
- **Pageinator's breaks are cleaner by the research rules:** 0.14 flagged breaks per headline (balanced) against 0.52 in print, on those 66 headlines.
- **So the editors choose the style.** The headline review shows every later-edition headline where Pageinator differs from print (24 items from 22 headlines, in both styles, plus 4 repeats).
- **Crossheads** (bold lines between paragraphs) are set first-fit by the paper; Pageinator should do the same (first-fit matches 81% of multi-line crossheads on the later editions, balanced 25%).
- **Size:** given the printed number of lines, the largest size that fits is a median 3% larger than the printed size; the paper leaves a little slack.

## 1. Question
Can a deterministic composer choose headline line breaks the paper's editors would accept? Concretely:
- does it keep Marathi keep-together conventions (names, numbers, dates, punctuation)?
- does it choose the paper's number of lines?
- where several layouts fit, does it choose as well as the paper, and what shape does the house use?

## 2. Data (`published1/headlines.py`)
**Extraction.** From the 15 owner-supplied edition PDFs (68 pages), using the validated `/ActualText` reader (`EXP_COMPOSE_3_REPORT.md` §2) for exact text. 1,422 display frames are classified: headline 478 (430 Devanagari), deck 200 (51 under a headline, 149 crossheads), kicker 50, byline 58, caption 9, other 627. Hand check of the classification: 10/10. No same-style frames were merged across a gutter (split check 0); no printed line is more than 2.6 mm wider than its frame.

**House practice (Devanagari headlines, aggregates).**
- Size median 30 pt (p10–p90 14–44 pt), 2.4 × the body size. Lines per headline (all 478 headlines): 1 (33%), 2 (59%), 3 or more (8%).
- 55% centred. 68% are condensed with horizontal scaling (median 90%); only ~2% scale lines of one headline differently.
- The longest line fills 97.9% of the span (median). The first line is the longest in 55% of multi-line headlines.

**Evaluated** (Devanagari, ≥ 2 words, text and geometry consistent): **603** frames.

| Role | Calibration editions | Test editions (held out) | Multi-line in print |
|---|---|---|---|
| Headline | 223 | 201 | 288 |
| Deck under a headline | 19 | 25 | 6 |
| Crosshead | 75 | 60 | 51 |

Calibration and test are split by edition date (the same split as EXP-COMPOSE-3). 4 texts repeat within a split, none across. The shaper's word count equals the text's for all 603.

## 3. Rules (`head1/headliner.py`)

**Keep-together (glue)** turns a space into a no-break space before shaping. HARD rules are never relaxed. STRONG rules give way only when no layout with that number of lines fits (flagged `relaxed`), and then as little as possible. Unit words are matched by stem, with look-alikes excluded (टक्कर, फुटबॉल, तासगाव …).

| Rule | What | Sources |
|---|---|---|
| H1 | every line fits the measure; fewest lines that fit | copyfit practice |
| H2 | split at spaces only: no hyphenation, no break at - – — / | W3C ilreq §4.2; r12a; newspaper practice |
| H3 | no line starts with । ॥ . , : ; ! ? ) ] } ” ’ % … – — or a spaced dash | UAX #14 (LB13, LB15d, LB21, LB22); ilreq rule 1; r12a |
| H4 | no line ends with “ ‘ ( [ or a word-final hyphen (`भाग-`) | UAX #14 (OP, QU); r12a |
| H5 | a title, honorific or initial stays with the next word (`डॉ.⍽…`, `एस.⍽एम.⍽…`) | CMOS 18 (initials, titles); Netflix Marathi style guide (abbreviations) |
| H6 | a number stays with its first unit, currency, multiplier or % (unit words matched by stem), and ranges stay whole (`१०⍽ते⍽२०`, `२५-३०⍽टक्के`) | CMOS 18 (numeral + unit); UAX #14 LB23–25; ilreq rule 5; r12a (₹) |
| H7 | date and time chains (`दि.⍽१२⍽ऑक्टोबर⍽२०२६`, `स.⍽१०:३०⍽वाजता`) | CMOS; house abbreviations |
| H8 | existing no-break spaces and word joiners are respected | UAX #14 (GL, WJ) |
| STRONG | a unit after a multiplier of a number chain (`५०⍽हजार⍽कोटी⍽रुपयांचा`); data-derived word pairs (c7). When no layout with the line count fits, the layout breaking the fewest STRONG links wins (weights: inside a multiplier run 3, before the unit 2, c7 pair 1) | review finding; calibration print |

**Cost.** C = Σ((M − L)/M)² plus soft penalties, in squared-slack units (a penalty of 0.12 costs as much as a line 35% short).
- **Shape "balance"** sums over every line: minimum width variance, as CSS `text-wrap: balance`, Chromium/WebKit/Firefox balancing and InDesign "Balance Ragged Lines".
- **Shape "fill"** sums over all lines but the last: the Knuth–Plass ragged-right criterion ("printing neatly"). With the fewest lines, this fills the earlier lines.

| Soft rule | Weight | Sources |
|---|---|---|
| S1 line ends with a coordinator/subordinator (व, आणि, की …) | 0.16 | Loyola copy-editing ch. 11; Netflix line treatment; BBC §3.4; UD Marathi CCONJ/SCONJ |
| S2 line starts with an auxiliary/light verb (negation 0.20) | 0.12 | Netflix (verb/auxiliary, negation); BBC; UD Marathi AUX |
| S3 line starts with a detached postposition, particle or postposed title | 0.12 | Netflix; mr.wikipedia (postpositions); UD Marathi ADP/PART |
| S4 line ends with a determiner/quantifier, or a bare count (not a year) | 0.12 | Netflix (noun/article); BBC; UD Marathi DET |
| S5 line ends with a genitive (-चा/-ची/-चे/-च्या) or -तील modifier | 0.05 | Netflix (noun/adjective) |
| S7 a one-word line shorter than half the measure | 0.10 | CSS Text 4 `avoid-short-last-line`; Chromium orphan penalty; Netflix |
| S8 break inside a short quotation (≤ 5 words) | 0.06 | BBC ("natural points") |
| S9 line ends with , ; : – — ” (a good place to break) | −0.04 | BBC; Netflix ("break after punctuation") |
| c7 line ends with a word the calibration print never ends a line with | 0.12 | calibration editions |

**Search:** exact enumeration of every feasible layout. This also gives the **rank** of the printed layout under C. Ties go to fewer soft-rule hits, then the shorter longest line, the longer first line and earlier breaks. Deterministic.

## 4. Method
- **Stand-in and measure.** Each headline is set in the stand-in at a size calibrated so its words take the printed total width. The measure is the column span, or the printed longest line if that is wider.
- **Policies.**
  - `V1` (balance) and `FILL` use the rules alone.
  - `V1_C7` and `FILL_C7` add the data-derived rules (c7), counted **only on calibration headlines, each distinct text once**: 67 word pairs never split in print (STRONG glue), and 44 words never line-final (end penalty). They are reported on the test editions only.
- **Modes.**
  - `FIXED`: same size, fewest lines; this is what Pageinator would do.
  - `FIXED_N`: the printed number of lines.
  - `GREEDY`: first-fit with the same keep-together rules.
  - `COPYFIT`: the largest size on a 0.25 pt grid around the calibrated size that fits in the printed number of lines.
- **Subsets.**
  - *all*: every row; a non-fit counts as a miss.
  - *comparable*: the printed layout fits in the stand-in and breaks none of our keep-together rules.
  - *choice*: comparable, multi-line, and at least 2 feasible layouts at the printed line count. Only here can a rule make a choice. Chance = mean of 1/(number of layouts).
- **Metrics.** Exact layout, line count, micro-averaged break precision/recall/F1, rank of the printed layout (with the chance rate), balance, soft-rule hits, and keep-together violations in print. Exact McNemar tests between shapes.
- **Shape selection rule.** Choose the shape with the highest `FIXED` exact match on **calibration** choice headlines (V1 rules), ties → fewer soft hits; report the test editions whatever they show. This rule was written after the first audit had shown, on all editions pooled, that first-fit agreed with print more often than balance (§7).

## 5. Results

### 5.1 Keep-together rules
- **Pageinator: 0 violations of the HARD rules in every policy and mode.** The independent re-audit confirmed this (§6).
- **Print breaks our HARD rules 11 times** (9 headlines, 2 crossheads):

| Rule broken in print | Count |
|---|---|
| H3 line starts with a spaced dash | 4 |
| H6 number split from its unit or range | 4 |
| H4 line ends with a word-final hyphen | 2 |
| H5 title or initial split from the name | 1 |

- **STRONG rules gave way only when nothing else fit:** in 1 (V1, `FIXED`) to 8 (c7, `COPYFIT`) of 603 layouts, each time breaking as few STRONG links as possible.

### 5.2 Headlines: line count and exact breaks (V1 rules, all editions)

| Subset (n; multi-line) | Pageinator `FIXED` | `FIXED_N` | First-fit | `COPYFIT` |
|---|---|---|---|---|
| all (424; 288): exact multi-line / same line count | 74.7% / 89.6% | 75.0% / 90.3% | 78.1% / 89.4% | 82.3% / 100% |
| comparable (370; 250): exact multi-line / same line count / break F1 | **85.6% / 99.2% / 0.860** | 86.0% / 100% / 0.861 | 90.0% / 99.2% / 0.885 | 86.4% / 100% / 0.854 |
| choice (66; 66): exact | 45.5% | 47.0% | 62.1% | 48.5% |

**How to read this:**
- **All vs comparable.** The 54 headlines outside the comparable set are 44 whose printed lines do not fit our stand-in font (median overflow 1.1 mm), plus 10 whose printed breaks violate a keep-together rule. They cannot match by construction. With the house font (licence pending, P0-11) the 44 would become comparable.
- **Line count.** On comparable headlines, Pageinator's fewest-lines choice equals the printed count **99.2%** of the time. The paper used more lines than needed in 3 headlines.
- **The rank of the printed layout is not evidence by itself.** It is first in 90.5% of comparable headlines, but **82.2% have only one feasible layout**, and chance alone gives 89.4%.

### 5.3 Shape: where the paper had a choice

| Choice headlines | n | Chance | Balanced | Fill | First-fit | Flagged breaks per headline (balanced / fill / first-fit / print) |
|---|---|---|---|---|---|---|
| Calibration editions, V1 rules | 30 | 39.3% | 36.7% | **73.3%** | 70.0% | 0.17 / 0.33 / 0.43 / 0.53 |
| **Test editions, V1 rules** | **36** | **41.9%** | **52.8%** | **52.8%** | **55.6%** | 0.11 / 0.47 / 0.58 / 0.50 |
| Test editions, + c7 rules | 34 | 42.9% | 58.8% | 52.9% | 55.9% | 0.15 / 0.53 / 0.65 / 0.50 |
| All editions, V1 rules | 66 | 40.7% | 45.5% | 62.1% | 62.1% | 0.14 / 0.41 / 0.52 / 0.52 |

- **Selection:** on the calibration editions "fill" beats "balanced" (12 against 1 discordant headlines, exact McNemar p = 0.003). "Fill" is therefore the selected shape.
- **The later editions do not confirm it:** "fill" and "balanced" tie (8 against 8, p = 1.0), as do first-fit and balanced (10 against 9). All three sit about 11–14 points above chance.
- **Reading:** the paper's choices among alternatives are not explained by one shape. The earlier editions look like "fill the first line" (InDesign's default when "Balance Ragged Lines" is off); the later ones are mixed. With 30–36 headlines per split, differences under about 20 points cannot be detected.
- **Bad breaks:** balanced Pageinator makes about a quarter of print's flagged breaks; "fill" about the same as print.

### 5.4 Held-out editions with the data-derived rules (V1_C7, test)
- **Comparable (173; 118 multi-line):** `FIXED` exact multi-line 88.1%, break F1 0.882. First-fit: 87.3%, 0.846.
- **Choice (34):** `FIXED` 58.8%, `FIXED_N` 61.8%, against chance 42.9%.
- The c7 rules help a little and break nothing: 0 HARD violations. STRONG rules were relaxed in 2 of the 201 test headlines (`FIXED`).

### 5.5 Copyfit (size)
Given the printed number of lines as the limit, the largest size that fits is a median **1.030 ×** the calibrated size on comparable headlines, and 1.151 × on choice headlines, which by definition have room to spare. The paper leaves about 2–3% of slack; Pageinator, told to fill, would set headlines slightly larger.

### 5.6 Decks under headlines
44 decks, 6 of them multi-line. On the 40 comparable decks, every mode reproduces print exactly, except first-fit (97.5%).

### 5.7 Crossheads
135 crossheads, 51 multi-line. They are set at body size, and their printed balance is 0.55 (headlines 0.88).

| Crossheads | Balanced exact (multi-line) | First-fit exact (multi-line) |
|---|---|---|
| Comparable, all editions (129; 46) | 41.3% | **63.0%** |
| Comparable, test editions (57; 16) | 25.0% | **81.2%** |

Our cost ranks the printed crosshead first no better than chance (79.8% against 81.4%). **Crossheads are first-fit in this house; they should get a first-fit policy with the HARD rules, not the headline policy.**

### 5.8 Alignment (multi-line headlines, V1 rules, all editions)
| Alignment | Comparable: n / balanced / fill / first-fit | Choice: n / balanced / fill / first-fit |
|---|---|---|
| Centred | 207 / 86.5% / 90.8% / 90.3% | 54 / 48.1% / 64.8% / 63.0% |
| Left | 24 / 83.3% / 87.5% / 91.7% | 8 / 50.0% / 62.5% / 75.0% |
| Justified | 16 / 93.8% / 100% / 100% | 1 / — |
| Unknown | 3 / 0% / 0% / 0% | 3 / 0% / 0% / 0% |

The shape result does not depend on alignment. The 3 headlines of unknown alignment never match; their extraction is suspect.

## 6. Verification
- **Independent audit of the first version.** An agent wrote its own code and recomputed 1,128 summary values: **0 discrepancies**. It also confirmed:
  - the printed cuts and the c7 counts (calibration only);
  - 0 HARD-rule violations;
  - all 603 × 2 rows when recomposed;
  - that its checks bite: a measure 3% narrower produced 236 mismatches.

  Its interpretation findings (forced layouts, chance baseline, first-fit vs balanced, `FIXED_N` scored only where it fits) led to the changes in §7.
- **Independent re-audit of v1.2:**
  - 3,944 values recomputed (2,992 from the cuts, geometry and layout counts; 952 re-aggregated): **0 discrepancies**;
  - subset membership and the shape selection (including exact McNemar p-values) reproduced;
  - Pageinator broke no HARD rule in 9,460 layouts (4 policies × 4 modes); STRONG rules were broken only in rows flagged relaxed, and every relaxation was necessary;
  - the c7 hash, the held-out test (no test text in calibration), the review key (all 28 items recomposed) and the exhaustiveness of the pool (121 candidates) confirmed;
  - it found two defects: a mislabelled alignment block and two adjacent items of the same headline. Both are fixed in v1.3.
- **Final audit of v1.3:**
  - 4,216 values recomputed (3,264 + 952): **0 discrepancies**;
  - HARD rules never broken under any of the 4 policies;
  - STRONG links broken only in the 38 relaxed rows (across 4 policies × 4 modes), each relaxation necessary and each at the minimum possible weight;
  - the 11 printed violations reproduced row by row;
  - the review key correct on every item (28/28 recomposed, `same_as_print`, gaps ≥ 5, repeats 13–22 items after their originals, run ID recomputed).
  - v1.3.1 then changed only the weight of a link inside a multiplier run (3 instead of 2). No layout or metric changed, the key items are identical, and two runs are byte-identical. The repeat audit on v1.3.1 found **0 discrepancies** (4,216 values, including the shape selection and the alignment block). It confirmed minimal relaxation under the new weights in all 38 relaxed rows, and recomputed run ID `773edb6b` consistently across the key and all 28 answer rows.
- **Code review** (agent): 21 findings (4 high, 7 medium, 10 low).
  - The re-check found 17 fixed and 4 partly fixed; two of the partial ones were settled with data (per-line scaling in ~2% of headlines, no merged lines).
  - The fixes introduced 8 new issues (N1–N8, the most serious being that re-running could replace the sealed key). All are addressed in v1.3 (§7).
  - Final check: N1 and N4–N8 fixed, N2 and N3 partly fixed, no regressions. Both leftovers are fixed in v1.3.1: a link inside a multiplier run now weighs more than the link before the unit, so a forced break keeps the number whole; and a repeat whose original has no valid slot is swapped for another original.
- **Determinism:** two runs give byte-identical `summary.json` and per-headline rows (v1.2 and v1.3.1).
- **Rule self-tests** on made-up strings: initials, number chains, ranges, inflected units, hyphen ends, dates, dashes, genitive false matches (मोर्चा, चर्चा) and idempotence all pass.

## 7. What changed after the first evaluation, and why
1. **A wrong first reading was corrected.**
   - The "10% line-count gap" was a stand-in artefact. All 39 headlines where Pageinator used more lines than print were ones whose printed lines do not fit the stand-in.
   - The "90% rank #1" was mostly forced.
   - Both are now reported with the comparable and choice subsets and the chance rate.
2. **Scoring.**
   - A non-fit counts as a miss; `FIXED_N` was previously scored only where it fit.
   - Precision and recall are micro-averaged; a one-line answer no longer scores precision 1.0.
   - Hits count occurrences.
3. **Keep-together gaps closed** (v1.2):
   - Latin-letter initials (एस. एम.), number chains, ranges inside a token (२५-३०), inflected units by stem (हजारांहून, कोटींनी);
   - no line ending in a hyphen, no line starting with a dash;
   - genitive no longer matches nouns like मोर्चा and चर्चा;
   - a complete date or amount no longer counts as a "bare number".
4. **Data-derived rules.**
   - c7 is counted on calibration headlines only, each distinct text once, so a headline reprinted in two editions no longer creates rules.
   - Words are matched exactly, so `सरकार:` ≠ `सरकार`.
   - The evaluation and the review sheets share one definition, and the key records its hash.
5. **The "fill" shape was added after the first audit.** Its selection rule was therefore written knowing the pooled result. It was applied to the calibration editions only, and the later editions did not confirm it (§5.3).
6. **Review-sheet fixes (v1.2):**
   - 10 eligible headlines were silently dropped (unknown column count);
   - a 0.5 mm tolerance let the printed side overflow while Pageinator had to fit, which forced it into extra lines;
   - Pageinator now keeps the printed number of lines;
   - the width axis is found by search;
   - boxes are sized from the ink;
   - repeats sit at least 10 items after their originals;
   - the generator refuses to overwrite a folder that holds answers.
7. **v1.3, after the follow-up review:**
   - STRONG rules now give way minimally (fewest weighted broken links), not all at once;
   - a number chain continues only after a multiplier; unit look-alikes are excluded;
   - a spaced dash may end a line but never start one;
   - chains are found across words already joined by a no-break space;
   - a punctuation-only segment no longer closes a quotation;
   - the sheet generator refuses to replace a sealed key without `--replace` (sheets may be with raters), reads Excel's BOM, and puts one run ID on every sheet, CSV row and key; the analysis rejects answers from another run;
   - repeats keep at least 5 items from every copy of the same headline;
   - the key records which shapes reproduce print, so the analysis can compare balanced and fill head to head.
8. **v1.3.1, after the final review:** a forced break inside a number chain now prefers the unit side (`१२⍽लाख⍽कोटी | रुपयांची`, not `१२⍽लाख | कोटी`); repeats can no longer fall back next to their twin; a run ID is required on every answer row. No result changed.

## 8. Blind review, headline round (calibration round; NOT G1)
- **Pool:** 121 multi-line test-edition headlines (left, centre or right aligned, distinct texts).
  - In 92 both shapes give exactly the printed breaks at the printed line count.
  - 6 do not fit the stand-in; in 1, neither shape has a layout with the printed line count.
  - **22 differ**: 24 items (balanced 8, fill 10, both the same 6) plus 4 repeats, on 3 A3 landscape sheets (run `773edb6b`).
- **Each item** shows the printed breaks and Pageinator's, in the same font instance, size, number of lines, leading, alignment, measure and box.
  - Order and sides are randomised (seeded).
  - The shape of each Pageinator version is recorded only in the sealed key.
- **What it decides:**
  1. whether editors accept Pageinator's choices where it differs (OK to print);
  2. balanced or fill: on 14 items one shape differs from print and the other equals it, so a preference there is a direct balanced-vs-fill vote (`shape_head_to_head` in the analysis);
  3. whether the flagged breaks matter to them.
- **Size of the round.** This set is every differing held-out headline, so it does not reach G1's 30-headline sample, and it was not padded. G1 needs fresh pilot copy (P0-03).
- **Running it:** as round 1 (print at 100% on A3 landscape). `analyze_round1.py` validates every answer and reports per shape.

## 9. G1 status
**NOT MET.** No editor has rated any headline. The automated evidence:
- the keep-together rules hold;
- the line count is right;
- Pageinator makes fewer flagged breaks than print.

The house shape is not determined by the data.

## 10. Architecture impact
- **Headline composition is exact enumeration**, cheap enough to run on every edit. The whole evaluation (603 frames × 4 policies × 4 modes, copyfit included) takes about 9 s.
- **Policy per publication and per role:**
  - shape (balanced or fill) for headlines;
  - first-fit for crossheads;
  - keep-together rules at the script/locale level (HARD);
  - house pairs learned from the paper's own pages (STRONG, relaxable);
  - the line count is decided before STRONG glue;
  - copyfit on a size grid.
- **The house font matters for headline evidence too:** 10% of headlines cannot be compared in a stand-in. The font licence (P0-11) blocks the fidelity of this evidence as well as production.

## 11. Risks (updates to `RISKS_AND_ARCHITECTURE_IMPACT.md`)
- **NR16:** the house headline shape is not consistent across editions, so automatic agreement cannot choose the policy. Mitigation: editors choose in the blind review, and the shape is a per-publication setting.
- **NR17:** a stand-in font cannot reproduce 10% of printed headlines. Mitigation: obtain the house font (P0-11), or evaluate on the comparable set and label it.

## 12. Limitations
- **Stand-in font:**
  - per-line widths differ from the house font's;
  - horizontal scaling is modelled only on the review sheets (width axis), and the sheet size can differ from the printed size where the axis reaches its limit;
  - the stroke weight is approximate.
- **Small choice samples** (31 calibration, 36 test headlines).
- **Extraction:**
  - 12 single-line records come from stacked headline paragraphs, whose deliberate break is not evaluated;
  - 3 multi-line headlines have unknown alignment;
  - ~2% scale lines differently.
- **Word classes are hand lists**, with no morphological analyser. Soft rules cannot see meaning; for example, they cannot tell a compound name from two words.
- **S8 (break inside a short quotation) recognises only `“…”` and `"…"`.** This paper also marks quotations with `'…'` and `’…’`, so S8 rarely fires here (next version: treat `'` and `’` at the start of a word as an opening mark).
- **No editor has seen any output yet.**

## 13. Owner answers (2026-10-13) and next steps
**Answers:**
- **There is a house rule for headline shape. It differs by page, not by designer.**
- **The number of lines is fixed before the headline is written.** Pageinator should take it as an input (`FIXED_N`), as the review sheets already do.
- **Names and phrases:** the general rule against bad breaks (splitting tightly bound units); no specific list.
- **Fonts:** continue with OFL stand-ins; the owner supplies the house fonts for the final software.

**Does the page explain the shape?** Not in this data. On the 66 choice headlines, a per-page rule learned on the calibration editions picks "fill" for every page (13 editions have 4 pages and 2 have 8; the choice headlines fall on pages 1–4: 31/21/9/5), which is the global rule that ties on the test editions. "Fill" matches at least as often as "balanced" in every group checked (front page or not, wide or narrow, large or small, centred or left; exploratory). The page rule therefore has to come from the designer.

**Architecture consequence:** headline shape is a **per-page (page-type) setting** in the publication profile, and the line count comes from the page plan.

**Next:**
1. Run the headline round together with body round 1 (same raters).
2. Ask the designer which pages use which shape (the per-page table is the missing input).
3. After the round: set the headline shape for the pilot, adopt the first-fit crosshead policy, extend S8 to `'…'` and `’…’` quotations, and rerun on fresh copy for G1.
