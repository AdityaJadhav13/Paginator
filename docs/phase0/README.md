# Evidence Phase 0: Status and Index

Date: 2026-10-07. Source of truth for tasks: `docs/architecture/v2/16_PHASE0_EVIDENCE_PLAN.md` §7. This folder holds the **evidence**. It is not a second roadmap.

Everything under `experiments/`, `tools/oracle/` and `fixtures/` is **EXPERIMENTAL / EVIDENCE** material. None of it is production code. No architecture decision was taken by running it.

## Part 1: Phase 0 task status

**Status values:**
- **COMPLETE:** the task's evidence exists.
- **IN PROGRESS:** partial evidence exists.
- **BLOCKED:** needs an external participant.
- **NOT STARTED:** no work done yet.

**Executability:** READY, PARTIAL or BLOCKED.

| ID | Task | Depends on | Status | Can execute now? | External blocker | Evidence expected | Artefact produced / expected | Architecture question answered |
|---|---|---|---|---|---|---|---|---|
| P0-00 | Pilot MoU | — | **BLOCKED / NOT STARTED** | No | Pilot newspaper | Signed MoU | `G0_EXTERNAL_EVIDENCE_PACKAGE.md` §1 (ready to send) | Is there a customer pathway? (G0) |
| P0-01 | Press questionnaire | P0-00 | **BLOCKED** (inputs ready) | No | Printing press | Completed questionnaire + press profile + samples | `../architecture/v2/17` (reviewed, §5 below) | PDF variant, TAC, fonts, delivery (O6) |
| P0-02 | Newsroom observation + hardware | P0-00 | **BLOCKED** (protocol ready) | No | Pilot newsroom | Baseline time study, hardware and network inventory | `G0_EXTERNAL_EVIDENCE_PACKAGE.md` §3 | G5 baseline; reference machines |
| P0-03 | Real corpus | P0-00 | **IN PROGRESS.** First owner-supplied dataset (16 edition PDFs, evidence level A) measured 2026-10-11 with EXP-PUBLISHED-1 `1.1.0` (204/204 ground-truth checks). Aggregate results are in `EXP_PUBLISHED_1.md` §12; the files stay private | Partial | Pilot | 3–5 editions, ~200 paragraphs | `fixtures/typeset/v1/real/README.md` | Real words-per-line; published spacing (decisive for G1) |
| P0-04 | Oracle freeze + fixtures v1 | — | **COMPLETE** (BEHAVIOR class only) | Done | — | Manifest, 182/182 tests, 203 fixtures | `tools/oracle/v0/`, `fixtures/typeset/v1/` | Is the Python engine a viable reference? **Yes, for shaping and breaking** |
| P0-05 | Kernel contract v0 | — | **NOT STARTED** (deliberately) | Ready, deferred | — | JSON Schemas | — | Deferred: the fixture schema covers Phase 0 needs; the contract waits for the composition policy (§Next) |
| P0-06 | `kernel-py v0` composition prototype | P0-04 | **IN PROGRESS.** EXP-COMPOSE-1, -2 and -3 complete. EXP-COMPOSE-3 re-set 692 of the pilot's own paragraphs: without word breaks it **ties the pilot's InDesign** on held-out editions (see `EXP_COMPOSE_3_REPORT.md`). EXP-HEAD-1 (2026-10-12) re-set 424 of the pilot's headlines: keep-together rules never broken, line count right 99%; the house headline shape is not consistent, so editors choose it in the headline review (`EXP_HEAD_1_REPORT.md`) | Partial: needs pilot geometry | — | Composition policy that meets L3 | `JUSTIFICATION_INVESTIGATION.md` | Why justification fails; what composition must add |
| P0-07 | Typography harness (L1–L4) + native review (L5) | P0-03, P0-06 | **IN PROGRESS** (harness L1–L3 automated; L4 and L5 BLOCKED) | Partial | Reviewers; real pages | Metrics + rating sheets | `experiments/phase0/typeset_harness/`, `G1_ACCEPTANCE_PACKAGE.md` | G1 evidence definition |
| P0-08 | EXP-ENGINE | P0-05, P0-06, P0-14 | **IN PROGRESS** (spec + server compute measured) | Partial | Network measurement from the pilot | Latency decomposition; decision memo | `ENGINE_AND_LATENCY_EXPERIMENTS.md` | Is a server-authoritative kernel fast enough? Compute: **yes** (≤ 3 ms per story op). Network: unmeasured |
| P0-09 | EXP-RENDER | P0-02, P0-06 | **IN PROGRESS** (workload generator + spec; candidates not built) | Partial | Reference hardware (P0-02) | Bake-off results | `RENDERER_BAKEOFF_AND_BUDGETS.md`, `experiments/phase0/render_workload/` | Renderer choice (O4) |
| P0-10 | PDF prototype + validation + press test | P0-01, P0-06 | **PRESS TEST PASSED (owner report, 2026-10-13)**: EXP-PDF-1's verified PDF/X-1a:2003 CMYK test page with Pageinator-composed Marathi text (40/40 checks; independent PDF/X checker 0 FAIL; 6/6 mutations caught) was accepted and printed by the pilot's printing unit; the owner reports the print looks good. Record sheet not yet filed | Partial | Press spec; validator licence | Validator report; press acceptance | `PDF_PRESS_EVIDENCE_PLAN.md`, `experiments/phase0/pdf_probe/` | G2 |
| P0-11 | Font rights investigation | P0-00 | **IN PROGRESS** (2026-10-11: the pilot's body face `FourCMR*` is identified from the embedded name tables as 4CPlus, vendor ID `4CPL`, `fsType` 8. Licence terms unknown. **Owner decision 2026-10-13:** continue with OFL stand-ins; the owner will supply the house fonts for the final software) | Partial | Pilot font inventory; counsel | Font rights memo | `ORACLE_MANIFEST.json` fonts; `G0_EXTERNAL_EVIDENCE_PACKAGE.md` §5 | Font modes (O11) |
| P0-12 | Legacy text investigation | P0-03 | **BLOCKED** (framework ready). The pilot's text is Unicode. Default PDF text extraction is wrong, but **the exact text is recoverable from `/ActualText`** (`published1/actualtext.py`; `EXP_COMPOSE_3_REPORT.md` §2) | Partial | Pilot samples | Detection + conversion accuracy | `fixtures/legacy/v1/README.md` | Build, buy or license converters (O10) |
| P0-13 | Ad input investigation | P0-00 | **BLOCKED** (checklist ready) | No | Pilot ad department | Ad intake requirements | `G0_EXTERNAL_EVIDENCE_PACKAGE.md` §4 | Ad intake design |
| P0-14 | Measurements (network, hardware) | P0-02 | **IN PROGRESS** (engine compute only, on a dev machine) | Partial | Pilot network and hardware | Budgets v1 | `experiments/phase0/results/performance/` | O16 |
| P0-15 | Dependency licence review | — | **IN PROGRESS** (engineering classification; counsel BLOCKED) | Partial | Counsel | Licence register | `PDF_PRESS_EVIDENCE_PLAN.md` §6, `../architecture/v2/18` | L1–L8 |

**Gates:**
- **G0:** NOT MET; blocked on people.
- **G1:** NOT MET. EXP-COMPOSE-1 (2026-10-08): no justified-family policy reaches the internal 98% plausibility criterion at ≥ 45 mm with the test fonts. Families and trade-offs are mapped. No human review has happened.
  EXP-COMPOSE-2 (2026-10-11): still FAIL with 11 OFL fonts on provisional grids. The best style (HYBRID with pattern breaks) justifies 64% of lines at 45 mm. Printable blind proofs are ready; they need real geometry and fonts before they count.
  Pilot pages (2026-10-11): the paper justifies 90% of lines with gap p95 about 4×, so the 2× bar was stricter than house practice. Same-words illustration: with the same rules our columns are looser (no space compression yet); with Marathi word breaks they are tighter, but break about 1 line in 4 (`EXP_COMPOSE_2_REPORT.md` §18).
  EXP-COMPOSE-3 (2026-10-11): on 313 held-out pilot paragraphs, the new spacing model ties the paper's InDesign without word breaks. Blind-review round 1 sheets (24 pairs) are ready; no rating yet. G1 still NOT MET.
  EXP-HEAD-1 (2026-10-12): on 424 pilot headlines, Pageinator never breaks a keep-together rule (print breaks them 11 times) and picks the printed line count 99% of the time where comparable. Where the paper had a real choice (66 headlines) no single shape predicts it on held-out editions (53–56%, chance 42%). Headline review sheets (24 items + 4 repeats) are ready; no rating yet. G1 still NOT MET.
  EXP-PAGE-1 (2026-10-14): all 60 Marathi pilot pages rebuilt from their own stories, with their real photos in newsprint CMYK; story depth within G1 A7 for 97.8% of stories (92.1% on held-out editions with one paper-level size ratio in the earlier build, bar 90%); 29 of 60 pages pass every check; no lost text; every page PDF/X-1a. Automated evidence only; G1 still NOT MET.
  EXP-GEN-1 (2026-10-15): Pageinator laid out 17 of 28 held-out Marathi pages by itself (no printed plan); all 17 pass every check: nothing on any page is lost, no display text collides, and every page is PDF/X-1a. Four independent verifications caught lost text, collisions and wrong story matches in earlier versions, and each was fixed. No editor judgement yet, so G1 is still NOT MET.
- **G2:** PASSED on the owner's report (2026-10-13): the printing unit accepted and printed the Pageinator test page and the print looks good (`EXP_PDF_1_REPORT.md`). The filled record sheet would complete the evidence file.
- **G3–G7:** not started.

## Index (Parts 2–18 of the Phase 0 report)

| Part | Document |
|---|---|
| 2 Reference engine freeze; 3 Corpus; 4 Harness | `TYPOGRAPHY_CORPUS_AND_HARNESS.md` |
| 5 The 0/240 investigation; 6 Marathi typography risks | `JUSTIFICATION_INVESTIGATION.md` |
| 7 Human review protocol; 14 G1 acceptance package | `G1_ACCEPTANCE_PACKAGE.md` |
| 8 Engine bake-off spec; 9 Server-authoritative latency | `ENGINE_AND_LATENCY_EXPERIMENTS.md` |
| 10 Renderer bake-off; 11 Performance budgets | `RENDERER_BAKEOFF_AND_BUDGETS.md` |
| 12 PDF / press evidence plan (+ PrintProfile fields, tool capability, licences) | `PDF_PRESS_EVIDENCE_PLAN.md` |
| 13 G0 external evidence checklist | `G0_EXTERNAL_EVIDENCE_PACKAGE.md` |
| 15 New risks; 16 Architecture impact; 18 Exact next experiment | `RISKS_AND_ARCHITECTURE_IMPACT.md` |
| EXP-COMPOSE-1 (composition policy experiment; report §1–§20) | `EXP_COMPOSE_1_REPORT.md` |
| EXP-PUBLISHED-1 (published-typography measurement: protocol, intake, tolerances, tool validation, decision tree; READY FOR PILOT DATA) | `EXP_PUBLISHED_1.md` |
| EXP-COMPOSE-2 (11 OFL fonts × provisional broadsheet grids × newsroom break rules; 16 blind proof pages; plausibility FAIL; report §0–§17) | `EXP_COMPOSE_2_REPORT.md` |
| EXP-COMPOSE-3 (exact text from the pilot's PDFs via `/ActualText`; asymmetric spacing model; 692 real paragraphs, held-out test; blind-review round 1 sheets) | `EXP_COMPOSE_3_REPORT.md` |
| EXP-PDF-1 (press-test PDF: own PDF/X-1a writer, pilot page format, control strip, 40-check verifier, independent checker, mutation self-test, one-command run) | `EXP_PDF_1_REPORT.md` |
| EXP-HEAD-1 (headline line breaks on 424 of the pilot's headlines: keep-together rules with sources, balanced vs fill vs first-fit, comparable and choice subsets with chance rates, held-out test, headline blind-review sheets) | `EXP_HEAD_1_REPORT.md` |
| EXP-PAGE-1 (all 68 pilot pages modelled and rebuilt as PDF/X-1a; house design language learned; text wrap; geometry, accounting and depth checks; held-out sizing; real photos in newsprint CMYK; a page chosen for the press) | `EXP_PAGE_1_REPORT.md` |
| EXP-GEN-1 (Pageinator lays out pages itself from stories + the learned design language: guillotine search over real typeset module heights; 17 of 28 held-out pages laid out, all passing every check; editor review pending) | `EXP_GEN_1_REPORT.md` |
| 17 File changes | Final report in the session, plus `git status` |
