# 20 — Pageinator Architecture v2 Baseline (Candidate)

Status: **CANDIDATE BASELINE**, 2026-10-07, after the second-pass review (`15`).

This document freezes only what the evidence supports. Where it conflicts with docs 01–14 or with any ADR, **this document and the post-review ADR status blocks take precedence.**

**How to change it:**
- **Section A (frozen principles):** requires an ADR and the founders' agreement.
- **Section B (accepted architecture):** requires an ADR with new evidence.
- **Section C (open):** closes only when the named experiment or gate produces its evidence.

## A. FROZEN PRINCIPLES

| # | Principle | Origin |
|---|---|---|
| P1 | **Browser preview and press PDF derive from the same resolved layout.** No component other than the kernel measures text or computes geometry. | D03, ADR-003 |
| P2 | Resolution is **deterministic**: the same inputs and kernel version produce byte-identical resolved output. | ADR-017 |
| P3 | Every export references an **exact document revision**. It is never regenerated from original inputs after manual edits. | D05, RJ02 |
| P4 | Originals are never modified. Derived assets are reproducible renditions. | D06 |
| P5 | Published editions are **immutable**. A correction is a new linked release. | D05/D06 |
| P6 | **AI suggests, humans accept, deterministic code decides** geometry, fit, preflight, colour, PDF and rights. AI never supplies coordinates and never runs inside the generation search loop. | D02, RJ01, ADR-005/009 |
| P7 | **Core editing and print production never depend on AI availability.** | ADR-020 |
| P8 | **Discovering content does not grant the right to republish it.** Rights class is a domain invariant, and AI cannot launder it. | D07, ADR-010 |
| P9 | **Strong tenant isolation through defence-in-depth**: application authorisation, database policies, storage scoping and audit. | D04, ADR-007 |
| P10 | Use **mature libraries for commodity problems**: shaping, segmentation, ICC, PDF serialisation, auth, queues, image decoding. Pageinator owns newspaper semantics. | D09, RJ06 |
| P11 | **Progress is measured by external gates** (press, editors, printed pages), not by internal output. | ADR-018 |
| P12 | **Decisions carry evidence-backed status**. A hypothesis is never presented as settled. | ADR-021 |
| P13 | **Font licences are respected.** No font is used in a way its licence evidence does not permit. | ADR-019 |
| P14 | **Print output is designed for newsprint**: press-supplied profile, total ink limit, black text and overprint policy. | ADR-014 |

## B. ACCEPTED ARCHITECTURE (current baseline; changes need an ADR)

| # | Decision | ADR |
|---|---|---|
| B1 | **A single authoritative publishing kernel** behind a language-neutral, versioned contract (`ResolveRequest` → `ResolvedPage`; `ExportRequest` → `ExportResult`). The browser renders display lists and never lays out text. | ADR-017 |
| B2 | EditableDocument (intent, commands, revisions) → ResolvedDocument (display list: glyph IDs, positions, transforms). The *package* is the layout unit. | ADR-003 |
| B3 | A modular monolith with explicit module boundaries, plus a separate CPU worker tier. | ADR-007 |
| B4 | PostgreSQL is the system of record. A Postgres-backed job queue is used until the thresholds in `15` §8. Object storage holds binaries under content-addressed keys. | ADR-007 |
| B5 | RLS with FORCE and a non-owner app role on every tenant table, plus the tenancy proof tests in `15` §8. | ADR-007 |
| B6 | Frontend: React + TypeScript (existing). The editor core sits outside React state. ProseMirror is used for text input. There is a single command bus with one undo stack. | ADR-004 |
| B7 | Generation runs in stages: flatplan with ads first, then allocation with jump decisions, then page layout (templates first), then continuations. Depth curves are computed once from the real kernel; only finalists get full composition. | ADR-005 |
| B8 | The PDF writer lives in the kernel. Pageinator owns content streams and PDF/X semantics; libraries own serialisation, subsetting and colour conversion. Validation is matched to the press's profile. | ADR-006, ADR-022 |
| B9 | Rights-class invariant; evidence-based verification signals (built later). | ADR-010 |
| B10 | AI task contracts behind a provider adapter with evals, cost metering and suggestion-only outputs. | ADR-009 |
| B11 | Font rights model with four preview modes. | ADR-019 |
| B12 | Hosting region in India. | ADR-008 |
| B13 | A gate-driven roadmap, G0–G7. | ADR-018 |
| B14 | Deadline degraded modes, last-known-good exports and an emergency package. | ADR-020 |
| B15 | Zoned editions as a data-model hook only (`base_edition_id`, shared or variant pages). | ADR-012 |

## C. OPEN QUESTIONS / PHASE 0 EXPERIMENTS (deliberately unresolved)

| # | Question | Closed by | Front-runner (not a decision) |
|---|---|---|---|
| O1 | Kernel implementation language | EXP-ENGINE (`16` §1) | Option E: Python, extended from the oracle |
| O2 | Whether client-side composition is needed at all | EXP-ENGINE B1/B2; later field telemetry | Not needed |
| O3 | Backend/API language | Follows O1; the rule is to minimise languages on the production path | Same as the kernel language |
| O4 | Renderer implementation | EXP-RENDER (`16` §4) | R1: Canvas2D worker |
| O5 | Marathi composition policy and parameters | TYPO (`16` §3), G1 | Knuth–Plass → emergency stretch → tracking; no Marathi hyphenation |
| O6 | PDF/X variant, total ink limit, ICC profile, bleed, naming, TrueType acceptance | Press questionnaire (`17`), G2 | None until the press answers |
| O7 | Commercial preflight in production | ADR-022 review before G4 | Use the press's own profile, plus a server licence if the cost is justified |
| O8 | Auth provider | 2-day spike after O3 | Better Auth with hardening, or WorkOS |
| O9 | Cloud provider and compute shape | Before G3 | AWS ap-south-1 with minimal services |
| O10 | Converting legacy text: build, buy or license | P0-12 | Depends on the pilot's encodings |
| O11 | Font licensing interpretations (server use, outlines, tiles, archive) | Counsel (L2) | Server-only shaping with outline or tile preview |
| O12 | DPDP: journalism, archive and bylines | Counsel (L5) | Account data kept separate; governance-mode retention lock |
| O13 | Use of Ghostscript (AGPL) | Counsel (L1) | Avoid; use PDFium and our own checks |
| O14 | Number and diversity of generation alternatives; search parameters | Pilot telemetry after G5 | Up to 3 structurally distinct |
| O15 | RBAC role set | Newsroom observation (P0-02) | Org isolation plus publication grants |
| O16 | Performance budgets (targets vs ceilings) | P0-14 measurements | `16` §5 |
| O17 | Hyphenation (English; Marathi practice) | TYPO, plus pilot practice | English yes; Marathi no |
| O18 | Delivery-to-press mechanism | `17` §H | Manual download first |

## D. Explicitly deferred (with trigger)

| Item | Trigger to start |
|---|---|
| Multi-tenant self-serve onboarding, billing | After G5 |
| Full archive package, tiers, search | Package: G5. Tiers and search: G7 |
| E-paper | After G4, or earlier if the pilot makes it a purchase condition |
| Newsroom feed (ingestion, clustering, ranking) | After G6 |
| Whole-edition generation, including front pages | Inside pages after G3; the front page after G6 |
| Urdu track | A customer commitment, with its own gate |
| Enterprise SSO, custom roles | First enterprise deal |
| CRDT co-editing | Pilot evidence that two people edit the same story at the same time |
