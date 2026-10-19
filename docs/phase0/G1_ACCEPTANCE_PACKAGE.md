# Parts 7 and 14: G1 Human Review Protocol and Acceptance Package

**Status:** PROTOCOL READY. **Not run.**

**Why not:**
- representative output does not exist yet, because no acceptable composition policy exists;
- no qualified reviewers are engaged.

G1 is an **acceptance event**. It cannot be passed by automated tests alone.

## 7.1 Reviewers

| Role | Number | Qualification |
|---|---|---|
| Marathi sub-editor or desk editor | 2 | At least 5 years at a Marathi daily; responsible for final page copy |
| Page designer or compositor | 1 | Makes up Marathi news pages in current production |
| Proofreader | 1 (optional) | Marathi newspaper proofreading experience |

**Independence rules:**
- At least one reviewer must come from the pilot newspaper.
- Pageinator staff do not rate.
- Reviewers are paid for their time.

## 7.2 Material

**Blind pairs.**
- Each item is a paragraph, story column or headline, shown twice:
  - **A:** the pilot's published original, re-set only if needed to match the page;
  - **B:** Pageinator's output for the same text, font, size and measure.
- A/B order is randomised per item. The key is sealed and held by a non-rater.

**Sample.**
- 200 body paragraphs and 30 headlines, from **real pilot copy** (P0-03).
- Spread across sections, lengths and widths.
- Includes at least 30 items containing mixed script or numerals.

**Formats.**
- **Print:** 100% scale on a laser printer, *and* on the press proof or newsprint if available (L6).
- **Screen:** the same material at 100% and 200%.

**Unseen control set.** 10 items repeated, to measure rater consistency.

## 7.3 Score sheet (per item, per version)

| Criterion | Scale | Definition |
|---|---|---|
| R1 Readability | 1–5 | Comfortable to read at newspaper distance |
| R2 Word spacing | 1–5 | No distracting gaps or crowding |
| R3 Line breaks | 1–5 | No awkward breaks (danda at line start, split names, number and unit separated) |
| R4 Conjuncts and characters | Pass / Fail + note | Any wrongly formed akshara, matra, reph, half form or eyelash ra = **Fail** |
| R5 Hyphenation / in-word breaks | 1–5 or N/A | Acceptable if present |
| R6 Rivers and gaps | 1–5 | Vertical white channels; holes |
| R7 Paragraph colour | 1–5 | Even greyness across the column |
| R8 Column density | 1–5 | Neither too loose nor too tight relative to house style |
| R9 Headline quality (headlines only) | 1–5 | Line balance, breaks, fit |
| R10 Overall | **Acceptable for print / Acceptable with fixes / Not acceptable** | "Would you send this page to press?" |

Plus free-text notes and **defect tags**:
`conjunct`, `matra`, `spacing-loose`, `spacing-tight`, `bad-break`, `river`, `digits`, `punctuation`, `latin-mix`, `other`.

## 7.4 Procedure
1. **Calibration (15 minutes).** Show 5 sample items that are not scored, with house examples of acceptable and unacceptable copy, chosen *by the pilot*, not by us.
2. **Independent rating.** Each reviewer rates all items, with no discussion between reviewers.
3. **Unblinding.**
4. **Analysis.**
   - Per-criterion means for A and B.
   - Paired difference B − A.
   - Share of B rated "Acceptable for print".
   - Inter-rater agreement on R10: percentage agreement and Cohen's κ.
   - Consistency on the control set.
5. **Debrief interview (30 minutes).** What would they change? What house rules did B violate? Record it.
6. **Archive.** Store score sheets (scanned or exported), the item key and the rendered materials with hashes in `fixtures/typeset/v1/human/` (private if confidential).

## 7.5 Interpretation rules
- **Paired comparison is the point.** If the published original itself scores low on spacing (R2), house practice tolerates that level. We do **not** hold Pageinator to a stricter standard than the paper's own pages.
- **Low agreement voids the session.** If κ on R10 is below 0.4, the reviewers disagree on what acceptable means. Repeat calibration; the result is not valid.
- **Shaping defects are never averaged away.** Any R4 Fail on version B is a G1 blocker, regardless of other scores.

---

## 14. G1 acceptance package: exact evidence required

G1 passes only when **every** item below exists and meets its threshold. Thresholds come from `../architecture/v2/16` §3.2 and are refined here.

### A. Automated correctness (necessary, not sufficient)

| # | Evidence | Threshold | Tool |
|---|---|---|---|
| A1 | Missing glyphs (`.notdef`) on the corpus plus the G1 page | 0 | Harness invariants |
| A2 | Malformed-cluster detection (orphan marks) | 0 unflagged | Harness invariant. The kernel rule TXT010 is not yet built |
| A3 | Shaping cross-check against an independent HarfBuzz build, with matching flags | 100%, or each difference explained and accepted | `generate_goldens.py` |
| A4 | Illegal breaks: inside a cluster, danda at line start, NBSP break | 0 | Kernel check (to build) plus a UAX#14/#29 test at a pinned Unicode version |
| A5 | Overset / unexpected overflow on the G1 page | 0 | Kernel |
| A6 | Lines outside the agreed spacing policy | ≤ 2%; never 3 consecutive. The policy is calibrated to the pilot's **published** pages (§7.5) | Harness space-factor metrics |
| A7 | Story depth against the published original | Within ±1 line per 20 lines for ≥ 90% of stories | L4 comparison |
| A8 | Determinism | Byte-identical resolved output across 10 runs and across 2 machines (x86_64 and arm64 Linux) | Hash comparison |
| A9 | Performance | Within the budgets in `RENDERER_BAKEOFF_AND_BUDGETS.md` §11 for the measured operations | Harness |

### B. Human acceptance

| # | Evidence | Threshold |
|---|---|---|
| B1 | R10 "Acceptable for print" (or "with fixes" whose fixes are only editorial, not typographic) | ≥ 95% of paragraphs and ≥ 90% of headlines, **from both sub-editors** |
| B2 | R4 conjunct/character failures | **0** |
| B3 | Paired comparison B − A on R1, R2, R6 and R7 | Not worse than −0.5 on the 1–5 scale |
| B4 | Inter-rater κ on R10 | ≥ 0.4 |
| B5 | Print review (L6): the chief sub-editor's sign-off on the printed proof | Signed |

### C. Artefacts in the G1 evidence folder
- The corpus manifest (real items via hashes), plus fonts and licence basis.
- The kernel version, the composition policy parameters and the oracle reference.
- The automated report (A1–A9) with `env.json`.
- The rendered review sheets with hashes; the sealed key; the signed score sheets; the analysis notebook output.
- The debrief notes and the known-limitations list at the time of the review.

### D. What does NOT count as G1
- Any number of passing unit tests.
- Fixture parity with the oracle. That is behaviour, not quality.
- Internal staff opinions.
- Output that reached 0% policy violations only by loosening the policy beyond what the pilot's own pages show.
