# 13 — Roadmap (Real-World Gates) and Risk Register

**Status:** ACCEPTED (ADR-018). This is revision 2, from the 2026-10-07 second-pass review.

**What changed from revision 1:** revision 1 was a plan of phases P0–P5. It is summarised in the appendix as history.

**North Star:** a real newspaper prints a real edition from Pageinator and comes back the next day.
- Progress counts only when a gate passes, with external evidence.
- Gates may overlap in time, but development that serves a later gate does not start in earnest until the gates it depends on have passed.

## Gate overview

```
G0 Press & pilot contract ─┐
                           ├─► G2 Press acceptance ─► G3 4-page printed ─► G4 Production night (4a shadow → 4b live)
G1 Real typography ────────┘                                                       │
                                                                                   ▼
                                     G7 Commercial validation ◄─ G6 Repeated usage ◄─ G5 Productivity proof
```

**Changes from the proposed gate list:**
- G0 now also requires a **signed pilot newsroom commitment**. A press specification without a newspaper that will use the output proves nothing.
- G4 is split into a **shadow night** and a **live night**, so the newspaper is never put at risk on the first attempt.
- Each gate states what development must **stop** if it fails.

## G0 — Real press and pilot contract

**Entry:** a candidate pilot newspaper has been identified (Marathi daily preferred) and has agreed to talk.

**Success criteria:**
1. A pilot memorandum of understanding is signed. It names a production contact, allows Pageinator to use 3–5 published editions as private fixtures, and commits the paper to 2 shadow nights and 1 test print run.
2. The press questionnaire (`17`) is completed with the pilot's press. It includes the written specification, the press's preflight profile where one exists, and sample accepted files.
3. **No unknowns remain** in sections B, C, D or F of the questionnaire, or each unknown has a named person who will resolve it.

**Evidence:** signed MoU; completed questionnaire with attachments.

**Artefacts:**
- `docs/knowledge/press/<press>/`
- a draft `PrintProfile` with a citation for every value.

**Responsible:** founder, with the prepress advisor.

**What failure means:** there is no customer pathway, or the press will not engage.

**If it fails, stop:** all product UI work and all SaaS platform work. Continue only G1 typography research, using public Marathi text, while another pilot is sought.

## G1 — Real typography

**Entry:**
- oracle-v0 is frozen and its fixtures v1 exist (`16` §2);
- the pilot corpus has been received (P0-03);
- the font rights for the test fonts are clear (P0-11).

**Success criteria:** one **representative real Marathi page** is reconstructed from a published pilot edition and typeset by the Pageinator kernel. The page must include:
- real fonts, either the pilot's licensed fonts or approved OFL substitutes;
- real body text, headlines, columns, a deck, bylines and captions;
- the pilot's column grid.

It must meet all the TYPO acceptance thresholds (`16` §3.2):

| Check | Threshold |
|---|---|
| L1 shaping errors | 0 |
| L2 illegal breaks | 0 |
| L3 lines outside spacing policy | ≤ 2% |
| L4 story depth vs published original | within ±1 line per 20 lines, for ≥ 90% of stories |
| L5 native-reviewer acceptance | paragraphs ≥ 95%, headlines ≥ 90% |

Layout may be placed by hand. Generation is not part of this gate.

**Evidence:**
- the TYPO report with metrics;
- signed reviewer rating sheets;
- a side-by-side overlay of Pageinator against the published page.

**Artefacts:**
- `fixtures/compose/v1` page fixture;
- the kernel version tag;
- the composition policy parameters.

**Responsible:** the kernel, typography in particular (engine lead).

**What failure means:** Pageinator cannot yet set acceptable Marathi text. The core product hypothesis is unproven.

**If it fails, stop:** the editor UI beyond the bake-off harness, generation, and PDF work beyond structural spikes. Iterate on the composition policy, fonts and the hyphenation question.

## G2 — Press acceptance

**Entry:**
- G0 and G1 have passed;
- the PDF writer prototype exists in the kernel;
- an independent validator matched to the press profile is available (ADR-022).

**Success criteria:**
1. The G1 page, plus one page that includes a real ad and two photos, is exported by Pageinator in the press's specified PDF/X variant.
2. The validator reports zero errors against the **press's profile**, or against the standard PDF/X profile if the press has none.
3. The press runs the files through its normal intake and RIP and **confirms acceptance in writing**, naming the file SHA-256.
4. Preferably, a plate or proof is produced and reviewed (layer L6 of `16` §3).
5. At least one deliberate negative test (`16` §6, step 7) has been run, so we understand how the press rejects files.

**Evidence:**
- the validator report;
- the press's written acceptance;
- photos or scans of the proof.

**Artefacts:** the **press-accepted fixture set** (`12` §Press fixtures), which is permanent regression material.

**Responsible:** the kernel's PDF writer, with the prepress advisor.

**What failure means:** Pageinator's output is not production-grade for this press.

**If it fails, stop:** editor UI after the shell, preflight UI, and every later gate's work. Fix the writer, colour or fonts, then resubmit.

## G3 — Four-page printed edition

**Entry:**
- G2 has passed;
- the editor minimum is ready: display-list canvas; select, move and resize; text frames and threads; story editor; image placement and crop; autosave with revisions; export; model-level preflight;
- single-tenant hosting in the chosen region, with tenancy controls on from day one;
- the security baseline for real customer data: authentication, the tenancy test suite passing, upload sandboxing.

**Success criteria:**
- The pilot's own staff build a **4-page edition** from real content (stories, photos, at least one ad) in Pageinator, with Pageinator engineers assisting but not operating.
- Preflight shows zero errors.
- The press accepts the edition, and it is **physically printed**. A dummy run during a quiet press window is acceptable.
- The staff record usability issues.

**Evidence:**
- printed copies;
- the delivery receipt with hashes;
- a session recording or observation notes;
- the issue list.

**Artefacts:**
- an edition fixture (editable and resolved documents, PDFs, preflight report);
- the first production telemetry baselines.

**Responsible:** the editor plus the kernel.

**What failure means:** the system works only in engineers' hands, or not end-to-end.

**If it fails, stop:** generation, archive tiers, multi-tenant onboarding and newsroom features. Fix the workflow gaps first.

## G4 — Production night (G4a shadow → G4b live)

**Entry:**
- G3 has passed;
- the ads intake (P0-13 requirements), zoned or variant pages if the pilot uses them, and the pilot's press-delivery mechanism;
- deadline degraded modes, last-known-good PDFs and the emergency package (ADR-020);
- load testing at 3× expected deadline concurrency;
- an on-call rota.

**G4a, shadow night:** Pageinator produces a real 12–16 page edition with real content, images and ads, **in parallel** with the paper's existing workflow, which remains authoritative.

Success criteria:
- the edition is complete before the real deadline;
- preflight shows zero errors;
- the files pass the press's validator;
- there is no data loss;
- incidents are logged with root cause.

**G4b, live night:** the same, but Pageinator's output is the one printed.

Success criteria:
- delivered on time;
- printed without press-side fixes caused by Pageinator;
- no severity-1 incident.

**Evidence:** timeline logs, incident reports, printed edition, press confirmation.

**Artefacts:** the production-night runbook, refined after use.

**Responsible:** the whole system, especially reliability (ADR-020).

**What failure means:** Pageinator is not safe for a deadline.

**If it fails, stop:** productivity and generation work. Fix reliability and workflow, then repeat G4a.

## G5 — Productivity proof

**Entry:**
- G4b has passed;
- the baseline from P0-02 newsroom observation exists: person-hours per page and per edition, error counts, deadline slippage;
- template-slot generation for inside pages and the copyfit ladder are available.

**Success criteria:** over at least **5 production nights**, total person-hours of production work per edition (layout, copyfit, corrections, export) is **lower than baseline by an agreed target**, set with the pilot at G4 (for example ≥ 25%), with no increase in press-side corrections or deadline misses.

**Evidence:** a time study using the same method as the baseline, and the pilot's sign-off.

**Artefacts:** the productivity report, which also serves as sales evidence.

**Responsible:** the product as a whole (generation, templates, editor efficiency).

**What failure means:** Pageinator works but does not save time, so there is no business case.

**If it fails, stop:** newsroom feed, AI features and commercial expansion. Study where the time goes and fix that.

## G6 — Repeated newsroom usage

**Entry:** G5 has passed.

**Success criteria:**
- the pilot uses Pageinator for **≥ 4 consecutive weeks** for the agreed editions;
- no vendor engineer operates the system on production nights;
- the pilot voluntarily expands usage (more pages or editions);
- the trend in severity-1 and severity-2 issues is decreasing.

**Evidence:** usage telemetry, support log, the pilot's statement.

**Artefacts:** operations metrics; the support playbook.

**Responsible:** operations and product.

**What failure means:** adoption depends on hand-holding.

**If it fails, stop:** a second customer, self-serve onboarding and billing.

## G7 — Commercial validation

**Entry:** G6 has passed; pricing has been defined (OP09); contracts and data processing agreements (DPAs) are reviewed by counsel.

**Success criteria:**
- **≥ 3 paying publications**, of which at least one is not the first pilot and preferably differs in language or size, operate Pageinator for ≥ 30 consecutive days;
- no deadline is missed because of Pageinator.

**Evidence:** invoices, usage telemetry, customer references.

**Responsible:** the company.

**What failure means:** no product-market fit at current pricing or scope.

**If it fails, stop:** scale investment. Revisit segment, pricing and scope.

## What is allowed before each gate

| Work | Allowed after |
|---|---|
| Fact-finding, corpus, oracle, experiments, bake-offs, legal review | Now (Phase 0) |
| Kernel composition and PDF prototype | Now; it is the G1/G2 path |
| Editor beyond the bake-off harness | G1 + EXP-ENGINE/EXP-RENDER memos |
| Real auth, tenancy, hosting for customer data | G2 |
| Ads intake, delivery-to-press, degraded modes | G3 |
| Template generation (inside pages) | G3 |
| Archive package, e-paper | G4 |
| Whole-edition generation, front pages | G6 |
| Newsroom feed, AI editorial features | G5 (AI suggestions) / G6 (feed) |
| Billing, self-serve, multi-customer scale | G6 |

## Risk register (ranked, revision 2)

| Rank | Risk | Likelihood / Impact | Attacked by |
|---|---|---|---|
| R1 | **Press rejects Pageinator PDFs** (variant, fonts, colour, boxes) | M / Critical | G0 questionnaire, press-profile validation, G2 |
| R2 | **No committed pilot newspaper** | M / Critical | P0-00 MoU; G0 |
| R3 | **Marathi composition quality** (justification infeasible at narrow measures; measured 0/240 under default policy) | H / Critical | TYPO, G1 |
| R4 | **Legacy encodings and font licensing** block migration | H / High | P0-11, P0-12, `19` |
| R5 | Editor interactivity under a server-only kernel, or on weak newsroom hardware | M / High | EXP-ENGINE, EXP-RENDER, P0-14 |
| R6 | Production-night reliability | M / Critical | ADR-020, G4a before G4b |
| R7 | Ad input variability (RGB, transparency, fonts, EPS) | H / High | P0-13, sandboxed intake, G4 |
| R8 | Automatic layout quality too low to save time | H / High | Template-first, G5 measurement |
| R9 | **Team capacity and scope**: a small team building a kernel, editor, SaaS and operations at once | H / High | Gates restrict scope; one pilot, one language, one press |
| R10 | Tenant leakage of unpublished editions | L / Critical | `15` §8 five layers, tests, penetration test before G3 |
| R11 | Legal uncertainty: DPDP and journalism, AGPL, font EULAs, ICC | M / High | Counsel L1–L8 in Phase 0 |
| R12 | Deterministic parity (if client composition is adopted later) | L (single kernel) / High | ADR-017 |
| R13 | Process regression: agents generate unvalidated volume | M / High | `14` safeguards |
| R14 | News rights and wire licensing | M / Medium | After G6; rights invariant |
| R15 | AI economics | M / Medium | AI off the critical path; per-org budgets; after G5 |

## Team shape (unchanged in substance)

| Role | Phase 0 focus |
|---|---|
| Founder | Pilot MoU, press interview, newsroom observation, counsel |
| Engine lead | Oracle freeze, kernel composition policy, PDF writer, TYPO |
| Frontend / full-stack engineer | Renderer bake-off, EXP-ENGINE thin client, P0-14 measurements |
| Prepress advisor (part-time, paid) | Questionnaire, validation, G2 |
| Native Marathi sub-editors (pilot, paid sessions) | L5 reviews |
| AI agents | Scoped tasks under `14` safeguards |

## Appendix: revision 1 phase plan (superseded, kept for history)

Revision 1 ordered the work as:
- **P0:** fact-finding plus a TypeScript port.
- **P1:** the full manual production core, including multi-tenant auth and a profile wizard.
- **P2:** full edition, archive and e-paper.
- **P3:** generation and AI.
- **P4:** newsroom.
- **P5:** scale.

**Why it was superseded:** it bundled SaaS breadth before the first printed page, it assumed the TS port, and its gates were partly internal.

| Revision 1 | Revision 2 |
|---|---|
| G0 | G0 + G2 |
| G1 | G3 |
| G2 | G4 |
| G3 | G5 |
| G4 | After G6 |
| G5 | G7 |
