# Pageinator — Implementation roadmap

Phase 22, 2026-09-16. Derived from the [Master Build Specification](MASTER_BUILD_SPEC.md), read from disk. This is a dependency/gate sequence, not a calendar estimate or authorization to implement now. RD/PO statuses remain in their registers. The immediate backlog covers only RM01–02 UI work; production research and services require later explicit work authorization.

## Gates

| Gate | Evidence required | What it does NOT prove |
|---|---|---|
| G0 — Decision-ready documentation | Complete artifacts, explicit open decisions, protected inputs unchanged, traceable UI scope | No production dependency or feasibility approval |
| G1 — Honest UI workflow | Coherent fictional journey plus denied/error/stale/cancel states, accessibility and simulation labels; UI E2E evidence | No real tenancy, shaping, press preflight or archive durability |
| G2 — Safe real-data platform | Real identity/authorization, tenant-negative tests across storage/jobs/search, approved source/processing rights, scoped secrets, backup restore and parser/egress controls | No qualified publishing engine |
| G3 — Publishing integration qualification | Licensed corpus, supported font/script results, explicit glyph-to-preview/PDF fidelity, measured primitives, final-file profile checks and professional prepress review | No completed physical press/customer pilot or blanket font/press support |
| G4 — Safe release and archive | Hash/revision-bound approvals, revocation/crash/idempotency tests, archive-before-download, lost-infrastructure restore and policy-approved retention | No right to reprint after rights lapse; no byte-identical recomposition promise |
| G5 — Operational/security readiness | Pilot capacity/deadline budgets met, noisy-neighbor/failure recovery, security review, dependency compliance and support runbooks | No permanent uptime or untested scale promise |
| G6 — Repeated real-press acceptance | Press specification/RIP acceptance, physically inspected editions over agreed cycles, recorded hashes/receipts and historical retrieval/reprint | No claim that every other printer/profile is supported |
| G7 — Customer pilot acceptance | Newsroom completes daily workflow, accepts quality/usability and measured value; paid pilot also has qualified billing/terms/economics | No unrestricted general availability |

## Execution sequence and bounded workstreams

Numbers identify workstreams, not a requirement that every task in one finishes before any task in another. Explicit dependency column governs. Qualification gates constrain production use; approved research prototypes can use a licensed isolated corpus without handling real tenant production data.

| ID / lane | Deliverable and scope | Dependencies | Exit / decision gate |
|---|---|---|---|
| RM01 FOUNDATION | Authorize first feature spec; review UI dependency versions, establish design tokens/accessibility/status language, routes/shells, mock contracts/scenarios and targeted test setup. Only UI-relevant repository areas. | G0; separate implementation authorization | UI foundation acceptance; no backend/engine scaffolding |
| RM02 UI-FIRST PRODUCT | Landing/auth/onboarding → dashboard/edition → newsroom/desk → simulated generation → sample editor → simulated preflight/export → immutable sample archive; team/settings/billing. Resettable multi-tenant fixtures and failure paths. | RM01; incremental UI backlog dependencies | G1; recorded workflow feedback, no production claims |
| RM03 BACKEND FOUNDATION | Choose one runtime/identity/queue/storage path; modular API, organizations/publications, grants, content revisions/rights, asset quarantine, jobs/outbox, audit and backup. Replace mocks feature-by-feature behind contracts. | G0; relevant OP11–13/RD09/10 decisions, PO07/10 constraints; RM01 contracts as input, not permanent engine schema | G2 before any real customer content; contract and isolation/recovery evidence |
| RM04 EARLY PUBLISHING FEASIBILITY | Thin complete page: licensed multilingual paragraph + image + vector ad → provisional resolved scene → browser proof and PDF → professional preflight. Compare reusable paragraph/input/renderer/writer routes; test font licensing and numeric candidates. | RM01 foundation; PO02–04 evidence/budget; RD10 trial/dependency checks; no need to wait for full RM02 or RM03 | Recorded RD01/02/03/05/06 findings before broad engine investment; not yet G3/G6. Failure revises architecture, not bypasses invariant. |
| RM05 NEWS INTELLIGENCE | Owned/manual content first, then selected contracted feed/CMS/RSS; extraction comparison, provenance/rights, dedup/source lineage, reversible events and authorized search. Add contextual AI only after per-task/language evaluation/terms. | G2; PO10 and RD07/08/10; source-by-source permission | Connector corpus and failure accounting, explainable signals, no cross-tenant leakage; no mandatory news-please adoption |
| RM06 DOCUMENT MODEL | Versioned editable/resolved schemas, stable IDs, story placement lineage, physical units/range rules, semantic commands, optimistic concurrency, migrations and dependency manifests. | RM04 findings; RD05; PO06 editing model; RM03 for durable multi-user persistence | Schema/property/golden contracts; exact revision and unsupported-version behavior |
| RM07 TYPOGRAPHY | Integrate selected shaper/Unicode/font/paragraph primitives; qualified fonts, bidi/cluster/caret mappings, line breaking/justification, English/Hindi/Marathi/Urdu corpus and approved pilot subset. | RM04/06; RD02/10; licensed dictionaries/fonts and native reviewers | Language/font matrix and goldens; unsupported pairs blocked; contributes to G3 |
| RM08 LAYOUT | Templates/masters/styles, fixed ad constraints, newspaper columns/linked flows, overset/continuation, headline/copyfit policy and bounded regeneration preserving locks. Start supported deterministic layouts before broader optimization. | RM06/07; RD05; approved pilot formats | Layout/infeasibility/reflow goldens; no hidden dropped text; contributes to G3 |
| RM09 IMAGE / COLOUR | Original/derivative pipeline, crop/orientation/credit, effective PPI, ICC policy, hostile-media isolation and supported vector-ad import. | G2, RM04; approved press profile for print transforms; RD03/10 | Original preservation and crop/colour/PPI tests; screen vs print artifacts separated |
| RM10 PDF | Replace experimental writer with tested adapter for resolved primitives, font subset/Unicode mapping, boxes/colour/overprint/transparency and profile-specific PDF target. | RM06–09; RD01/03/10 writer decision | Independent rendering/structural corpus; no second text composer; contributes to G3 |
| RM11 PREFLIGHT | Domain validation + chosen professional final-byte adapter, normalized diagnostics/fix navigation, failure-closed behavior, fixup/new-hash flow and profile governance. Vendor evaluation starts in RM04, not at the end. | RM10 plus RM06/08/09 checks; RD03 commercial/technical qualification | Seeded defects found; correct profile/revision/digest binding; with typography/PDF evidence satisfies G3 |
| RM12 EDITOR | Integrate professional browser interaction/input with canonical commands and resolved scene; shape-aware selection/carets, crop/layers/guides/locks, accessible equivalents, page virtualization and resource handling. UI sample remains distinct until each capability qualified. | RM02 UX; RM04/06 input/renderer choice; RM07/08 for text/reflow; RD06; G2 for real users | Browser/IME/RTL/performance and lost-connection/conflict tests; G3 before press-fidelity claims |
| RM13 ARCHIVE | Immutable candidate/release manifests, exact files/dependency retention, authorization/revocation, release outbox/reconciliation, restoration copies and search projections. Design package/storage early alongside RM06. | G2; PO05/RD04; RM06/10/11 for real releases | G4; interrupted release and complete disaster-recovery proof, not just storage upload |
| RM14 MULTI-USER | Production team assignments/capabilities, agreed lease/concurrency model, conflict UX, review/release grants and support separation. Tenancy is already RM03, not postponed here. | RM03/06; PO06/07; RM12 integration | Two-editor lease expiry/stale commands, linked-flow conflicts and revoked-role tests; no blanket CRDT requirement |
| RM15 COMMERCIAL SAAS | Provider-eligible subscriptions/entitlements, idempotent billing webhooks, reconciled usage/storage, lawful archive offboarding and unit economics. | RM03; PO05/09; RD11/10; measured costs from engine work | Billing/reconciliation/eligibility and terms gate before charging; no destructive quota surprises |
| RM16 HARDENING | Versioned dependency/security review, malicious corpus, load/fairness/deadline tests, backups/key recovery, migration/deploy rollback, incident/support procedures and independent reviews. | All pilot-scoped real capabilities, G2/G3/G4; PO08/RD09/10/12 | G5; observed budgets and drill reports; routine tests run earlier too |
| RM17 REAL PRESS PILOT | Representative editions under agreed press profile; prepress/RIP approval, manual or approved handoff, physical inspection, repeated cycles and archive reprint. Record press feedback as linked immutable evidence. | G3/G4/G5; PO01–05; RM12/14 workflow as required | G6; closes applicable RD03 acceptance only with actual physical evidence |
| RM18 CUSTOMER PILOT | Newsroom operates repeated daily workflow and accepts quality, time saved, usability, reliability and archive retrieval. Collect value/economics evidence and bounded rollout criteria. | G1/G2/G4/G5/G6; RM05 and RM14 as agreed pilot scope; RM15 if paid | G7; explicit limits and remaining unsupported capabilities before wider rollout |

## Critical paths and sequencing constraints

UI learning path: RM01 → RM02 → G1. It can use provisional owner assumptions because every artifact is a simulation. It does not require a PDF library or account with a payment provider.

Publishing risk-reduction path: owner corpus/press/budget inputs → RM04 → RM06/07/08/09 → RM10/11 → G3 → RM13/G4 → RM16/G5 → RM17/G6. Editor integration progresses alongside the tested model/typography, not against an invented browser-only geometry model. Early RM04 may use narrow disposable interfaces; do not freeze them as production schemas just because a demo works.

RM06 can develop versioned provisional contracts from RM04 evidence; final production schema/engine commitment still requires Phase 3's wider linked-flow, serialization, multilingual and representative-edition criteria at G3. This prevents a one-page feasibility result from being misread as full newspaper qualification.

Real-data path: relevant owner constraints → RM03/G2 → contracted news/AI and real multi-user features. Never wait for the multi-user lane to implement tenant isolation. Release/archive design starts before writer integration so outputs can retain correct identities from the beginning.

Professional procurement and font rights begin early; a vendor denial may change implementation effort but cannot justify replacing mandatory validation with a partial checker. If thin end-to-end proof fails, retain the useful UI learning and reopen the engine decision before broad editor commitments. If the owner cannot provide a press partner or rights evidence, continue safe simulations/research but do not claim G6 or ingest restricted material.

The full future product includes all eventual languages; a pilot may qualify a smaller explicitly documented matrix. G3 requires evidence for supported pilot claims plus architecture experiments covering the eventual complex-script needs. No unsupported-language production output is silently permitted.

## Feature delivery and evidence

For each approved unit: write one bounded feature spec linked to R/D/RD and gate IDs; use one branch and fresh agent session; list initial relevant paths; expand context only as dependencies demand. Verify, obtain independent AI review and human review, then commit/merge only with appropriate authority. Do not implement an entire roadmap lane in one feature branch.

Use Phase 14's layered tests and record tested versions/hardware/corpus, outcomes, known limitations and outstanding decisions. Estimates may be added only after evidence about chosen engines, team capacity and actual work. This roadmap contains no arbitrary dates or durations.

The next action is owner review of PO01–05 and explicit authorization of the first UI-foundation feature spec. No production or experimental code is part of the current program.
