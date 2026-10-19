# Parts 5–6: The "0/240" Justification Investigation and Marathi Typography Risks

**Status:** INVESTIGATION COMPLETE for the questions we can answer without the pilot. **No fix has been implemented.** The oracle is unmodified.

**Raw data:** `experiments/phase0/results/justification/`:
- `summary.json`;
- `paragraphs.csv` (1,800 cases);
- `lines.csv`;
- `env.json`.

**Reproduce:** `PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/typeset_harness/investigate_justification.py` (about 20 s).

## 5.1 Reproduction
- **J0:** the original method (random 90-word paragraphs from a fixed vocabulary, seeds 0–39, 10 pt, P0, at 30.25, 45 and 60 mm, English and Marathi) gives **0 of 240 feasible**. The result reproduces exactly.
- **On real-looking prose:** the authored prose corpus gives the same picture. Knuth–Plass is feasible under P0 for **79 of 1,800 cases (4.4%)**.
  - Configurations: 30 paragraphs × 1–4 fonts × 4 sizes × 5 widths.
  - Most feasible cases are short paragraphs, or wide measures in Hindi.
- **The test assumption was not the cause.** Random vocabulary did not create the problem.

## 5.2 Engine-bug check (J8)

An independent dynamic programme decided feasibility over the oracle's own node stream. It was written separately from the oracle's `_consider_break`. **It agreed in 1,800 of 1,800 cases** without in-word breaks, and agreed on the hyphenated streams that were spot-checked.

**Conclusion:** there is no evidence of a Knuth–Plass engine bug. The engine is right that these paragraphs **cannot** be justified within the policy.

## 5.3 Mechanism (traced and quantified)

A justified line works only if a legal break falls inside the line's **acceptable-width window**:

`window = Σ(space shrink) + Σ(space stretch) = n_spaces × space_width × (word_space_max − word_space_min)`

**Traced example:** `en-body-01`, Source Serif 4, 9.5 pt, 60 mm, P0, with breaks allowed at every letter.
- The window is [58.44, 60.96] mm, which is **2.5 mm** wide.
- The candidate breaks fall at 57.06 mm (needs 188% of the allowed stretch) and then 61.64 mm (needs 171% of the allowed shrink).
- **Neither is inside the window.**

**Without in-word breaks**, candidate breaks are a whole word plus a space apart: about 9–12 mm at these sizes. So a single line has roughly a 20–25% chance of having a break in its window. A paragraph is only feasible if **every** line can fit. Feasibility is therefore all-or-nothing, and the paragraph-level rate collapses towards 0.

**Policy-independent measurement** (`space_factor` = the word space a line would need, as a multiple of natural space), from the best-effort Knuth–Plass solution, non-final lines:

| Script | Width (mm) | Median space factor | p90 | Lines > 1.5× | Lines > 2.0× |
|---|---|---|---|---|---|
| Devanagari | 30.25 | 3.71 | 10.31 | 85% | 77% |
| Devanagari | 38 | 2.83 | 5.99 | 82% | 71% |
| Devanagari | 45 | 2.47 | 5.07 | 77% | 62% |
| Devanagari | 52 | 2.05 | 3.98 | 70% | 52% |
| Devanagari | 60 | 1.85 | 3.52 | 66% | 44% |
| English | 45 | 2.92 | 9.33 | 83% | 70% |
| English | 60 | 2.22 | 4.53 | 76% | 57% |

Greedy breaking is consistently worse than best-effort Knuth–Plass. That gap is the **"poor break choice"** component. It is real but small (about 5–10 points of violating lines).

## 5.4 What changes the outcome (sensitivity)

**The dominant variable is words per line.** The best-effort share of lines violating P0, binned by average words per line:

| Words per line | Devanagari (Marathi + Hindi) | English |
|---|---|---|
| ≤ 3 | 89% | 90% |
| 3–4 | 81% | 87% |
| 4–5 | 74% | 75% |
| 5–6 | 70% | 70% |
| 6–7 | 58% | 79%* |
| > 7 | **36%** (feasible P0 25%, P2 73%) | 58%* |

*Fewer than 15 English cases in these bins.

The test fonts at 9.5 pt give **only 3–6 words per line** at 30–60 mm. For example, Source Serif 4 sets about 28 characters in 45 mm.

**Real newspaper body faces are typically much narrower.** This is a *hypothesis*: the pilot's real words-per-line figure is **unknown** and is the single most important number for G1 (P0-03).

**Set width (J9).** Condensing Noto Serif Devanagari through its `wdth` axis (100 → 75) at 9 pt raises words per line from 3.95 to 4.70 at 38 mm, and from 5.54 to 6.49 at 52 mm. The violating share falls only modestly (85% → 74%, and 64% → 64%). Condensing alone does not solve it at these measures.

**Policy loosening.** Required `word_space_max` for feasibility (tolerance 1):

| Case | Median required | Notes |
|---|---|---|
| Marathi at 30.25 mm | 6.2× | 224 of 288 cases unreachable even at 8× |
| Marathi at 45 mm | 4.4× | |
| Marathi at 60 mm | 3.1× | |
| Hindi at 60 mm | 1.66× | |

Policies P1–P3 raise feasibility only at the widest measures. P3 (3× spaces) is **not acceptable typography**. It is a probe, not a fix (prompt §21).

**In-word breaking (upper bound).**
- The test allowed a break at *every* akshara/letter boundary, keeping 2 or more on each side. This is a deliberately unrealistic best case.
- Marathi feasibility at P0 rose only from 2.8% to 4.5% at 45 mm, and from 6.6% to 15.6% at 60 mm.
- **Why so little:** Devanagari words split into few aksharas (HarfBuzz clusters). The spacing window is so narrow that even dense breaks often miss it.
- English at 60 mm rose from 5% to 52%.
- So hyphenation helps English substantially, but **cannot by itself rescue Marathi justification at these words-per-line values**.

**Tracking (uniform, whole paragraph):** −5 or −10/1000 em changes feasibility by ≤ 2 points. Per-line variable letter-spacing, which is what desktop justification engines do, is **not available in oracle-v0** and was not tested. It is next-experiment material.

## 5.5 Failure taxonomy (primary cause per case, policy P0, 1,800 cases)

| Category (from evidence) | Cases | Share | Meaning |
|---|---|---|---|
| MEASURE TOO NARROW FOR JUSTIFICATION | 1,196 | 66% | Infeasible even with in-word breaks at every akshara/letter **and** 2× spaces |
| IN-WORD BREAKS AND LOOSER SPACING NEEDED | 282 | 16% | Feasible only with both |
| IN-WORD BREAKS NEEDED (at P0) | 109 | 6% | "Hyphenation needed" (upper bound) |
| POLICY LIMIT: SPACING BOUNDS TOO STRICT | 102 | 6% | Feasible at 2× maximum word space |
| NO LEGAL BREAK: WORD WIDER THAN MEASURE | 32 | 2% | Mostly 30.25 mm with long compounds or URLs |
| FEASIBLE | 79 | 4% | |
| ENGINE BUG | **0** | 0% | J8 |
| UNSUPPORTED SCRIPT CONDITION / FONT ISSUE | 0 observed as a *cause* | — | Shaping valid. But see OL-12 (silent malformed input) and OL-09 (opsz ignored) |

**Root-cause statement (evidence-based).** The "0/240" result has three parts:
1. **Not a bug.**
2. **Not primarily the test vocabulary.**
3. **Mainly geometry plus policy.**
   - At 3–6 words per line, strict justification within 75–150% word spacing is mathematically unattainable for most lines.
   - Knuth–Plass feasibility is all-or-nothing per paragraph, which turns a 70–85% line-violation rate into roughly 0–5% paragraph feasibility.
   - In-word breaking helps English, but only marginally for Marathi at these measures.

The oracle's composition model has **no lever** that newspapers' desktop tools use:
- per-line letter-spacing;
- glyph scaling;
- hyphenation zones;
- best-effort (soft) feasibility;
- ragged or semi-justified styles.

## 5.6 What a production composition engine must add (requirements, not a design)
1. **Best-effort composition with soft limits.** Never fail the whole paragraph for one line. Choose the least-bad solution under hard caps, and report every line outside policy. Production DTP works this way; the oracle's binary feasibility does not.
2. **Per-line adjustment beyond word space:** letter-spacing for Latin (bounded, per line) and possibly glyph scaling. **For Devanagari, inter-akshara spacing visibly breaks the shirorekha (headline stroke).** Whether any letter-spacing is acceptable is an **editorial question, not an engineering one** (below).
3. **In-word breaking policy per language:** English hyphenation (Liang patterns). Marathi depends on editorial practice (§6.2).
4. **Ragged-right / semi-justified styles** as first-class options. The oracle ignores `align` (OL-07).
5. **Copyfit feedback:** composition must report "this paragraph needs N mm more measure, or X% looser" so the layout and copyfit ladder can react (`07` §6).
6. **Headlines are a different problem.** Balanced ragged breaking, no justification, and a size/line-count search. Headline goldens use greedy in v0. The headline composer should be **separate** from the body composer.

**Body text versus headlines (strategy comparison):**

| Approach | Body text | Headlines |
|---|---|---|
| Greedy | Fallback only (worse line quality, measured) | Acceptable baseline; balance pass needed |
| Knuth–Plass / dynamic programming (hard feasibility) | Insufficient alone (measured) | Overkill |
| Knuth–Plass with soft caps (best-effort) | **Candidate core** | Use for balanced breaking (minimise line-length variance) |
| Bounded word spacing | Required (hard caps plus soft penalties) | Not justified |
| Bounded tracking | Latin: candidate. Devanagari: **editorial validation required** | Size steps preferred |
| Language-aware hyphenation | English: yes. Marathi: open (§6.2) | Avoid |
| Emergency breaks / stretch | Last resort, *reported*, never silent | No |
| Copyfit | Measure feedback to layout | Size/line search |

## 6. Marathi typography risks (what remains unknown)

### 6.1 Engineering facts established
- Shaping is consistent across HarfBuzz 14.3.0 and 14.5.0 on the corpus (202/203; the remaining case is the orphan-matra policy difference).
- Conjuncts, reph, half forms, nukta, candrabindu, eyelash ra (both encodings) and ॲ shape without `.notdef`. **Whether they are visually correct has not been verified by a native reviewer.**
- Malformed sequences are **not** flagged by the oracle (OL-12). The kernel needs a validation rule. This is a new preflight requirement: "TXT010 malformed Devanagari cluster".
- Only HarfBuzz clusters are used as break units. UAX#29 grapheme clusters at a pinned Unicode version (including InCB conjunct rules) are **not yet tested**, because the oracle has no segmenter (L2 gap).

### 6.2 Marathi hyphenation (research findings and open questions)
**Facts found:**
- Pattern-based Marathi hyphenation exists in hyph-utf8 (`hyph-mr`, by Santhosh Thottingal), packaged as `hyphen-mr` in Linux distributions. It works at akshara level, handling virama, anusvara and visarga. **Licence: REQUIRES REVIEW** (pattern-file licence not yet checked against `18`).
- The W3C Devanagari layout notes say:
  - primary breaks are at inter-word spaces;
  - if a word is broken, consonant clusters should stay intact unless separated by a visible halant;
  - a danda must not start a line.
- They contain **no guidance on justification**.

**Unknown (editorial validation required):**
1. Do Marathi newspapers break words at line ends at all, and with or without a visible hyphen?
2. Are akshara-level breaks acceptable to readers in news body text?
3. Is letter-spacing tolerated, or does it count as a defect because it breaks the shirorekha?
4. Do they justify body text, or run ragged in some sections?
5. What word spacing do published pages actually show? This can be measured from the pilot's PDFs (P0-03).

**Measured fact:** even unlimited akshara breaking yields only modest gains at these measures (§5.4). So the answer to question 1 matters less than the answers to questions 4 and 5.

### 6.3 Risks
- **Policy outcome.** Real Marathi newspapers may accept looser spacing than any Latin norm. Then the "policy" answer is to *calibrate to observed practice*, not to impose 150%.
- **Narrow fonts.** Their typical font may be much narrower than Noto Serif Devanagari. Then words per line rises, and the problem may shrink sharply (§5.4 bins).
- **Fonts that cannot be used.** If they use legacy-encoded fonts that we cannot use, font substitution changes set width and therefore everything here (P0-11, P0-12).
- **No clean option.** None of these may produce lines the reviewers accept. Then **G1 fails as currently defined.** The fallback options (ragged columns, wider measures, smaller sizes) are editorial decisions with layout consequences.
