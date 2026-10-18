# Pageinator Architecture v2: Reviewed Baseline Package

Revision 2, 2026-10-07, after a second-pass critical review.
Audience: founders and engineers.

**Status vocabulary (ADR-021).**
- ADR status: PROPOSED, ACCEPTED, EXPERIMENTAL, SUPERSEDED, REJECTED.
- Certainty class: PRINCIPLE, ARCHITECTURE DECISION, WORKING HYPOTHESIS, IMPLEMENTATION DETAIL.
- The revision-1 word "DECIDED" is retired.

This package **amends** `docs/architecture/DECISION_REGISTER.md` (see ADR-011). When documents conflict, the order of authority is:
1. `20_ARCHITECTURE_BASELINE.md`;
2. the post-review status blocks in `ADR/`;
3. the review banners at the top of docs 01–14;
4. the body text of docs 01–14.

## Start here

1. **`20_ARCHITECTURE_BASELINE.md`**: what is frozen, what is accepted, and what is deliberately open.
2. **`15_SECOND_PASS_REVIEW.md`**: what the review changed and why.
3. **`16_PHASE0_EVIDENCE_PLAN.md`**: the next work, which is evidence rather than features.
4. **`13_ROADMAP_AND_RISKS.md`**: gates G0–G7 and the ranked risks.

## Executive summary (revision 2)

**Where we are**

| Codebase | What it is | Status |
|---|---|---|
| A | C++ engine | Archived. Only its ideas are kept. |
| B | Python engine | The only working typesetting engine. Its 182 tests pass today. Frozen as an executable oracle. |
| C | This repo | UI foundation and decision records. |

No codebase has ever produced a page a press accepted. The old engine shapes text and breaks lines correctly, but **justified composition at newspaper column widths is unproven**: under its default policy, 0 of 240 synthetic paragraphs could be justified.

**What changed in review**
1. **Single authoritative kernel (ADR-017).** One kernel sits behind a language-neutral contract. The browser renders display lists, so preview and PDF match by construction. The kernel language is decided by a pre-registered experiment. The front-runner is to extend the existing Python engine; it is not a TypeScript port.
2. **Gate-driven roadmap (ADR-018).** Eight gates:

   | Gate | Milestone |
   |---|---|
   | G0 | Pilot and press contract |
   | G1 | Real Marathi typography |
   | G2 | Press acceptance |
   | G3 | 4-page printed edition |
   | G4 | Production night, shadow then live |
   | G5 | Productivity proof |
   | G6 | Repeated use |
   | G7 | Three paying publications |

   SaaS breadth waits for press acceptance.
3. **Corrections.**
   - The newsprint ink limit is 220% (26v5), not ~240%, and is taken from the press.
   - TrueType acceptance must be proven with the press.
   - Better Auth CVEs require hardening.
   - The DPDP Act has no journalism exemption; this is a legal unknown.
   - Skia PDF has no CMYK.
   - No open-source PDF/X validator exists.
4. **New pieces.**
   - A font-rights model with licence-aware preview modes.
   - A legacy Marathi conversion pipeline.
   - AI-independent production and deadline degraded modes.
   - A commercial-preflight strategy matched to the press's own profile.
   - A ready-to-use press questionnaire.
5. **Phase 0 is an evidence phase.** Sixteen tasks; done when G0, G1 and G2 have evidence and the engine and renderer decisions are written.

## Index

| Doc | Contents | Revision |
|---|---|---|
| `01_REPOSITORY_AUDIT.md` | Forensic findings for A, B, C | r1 + review banner |
| `02_COMPARISON_MATRIX.md` | KEEP/PORT/REWRITE/ARCHIVE per subsystem | r1 + banner (port rows now conditional) |
| `03_TARGET_ARCHITECTURE.md` | System view, modules, topology, flows | r1 + banner (TS packaging conditional) |
| `04_DOMAIN_AND_DATA_MODEL.md` | Entities, RLS, migrations, DR | r1 + banner |
| `05_DOCUMENT_MODEL_AND_TYPOGRAPHY.md` | Editable/Resolved, composition, scripts | r1 + banner + inline fix |
| `06_EDITOR_RENDERING_PERFORMANCE.md` | Editor core, renderer, autosave, collaboration | r1 + banner |
| `07_GENERATION_ENGINE.md` | Staged generation | r1 + banner + inline fix |
| `08_PRINT_PIPELINE.md` | Images, colour, ads, PDF/X, preflight, delivery | r1 + banner + inline fix |
| `09_NEWSROOM_AND_AI.md` | Newsroom pipeline, AI architecture | r1 + banner |
| `10_ARCHIVE_STORAGE_REVISIONS.md` | Storage, packages, retention, search | r1 + banner |
| `11_PLATFORM_SECURITY_OPS.md` | Auth, RBAC, threats, jobs, SRE, billing | r1 + banner + inline fix |
| `12_QUALITY_STRATEGY.md` | Fixtures, parity, CI | r1 + §6–8 added |
| `13_ROADMAP_AND_RISKS.md` | **Gates G0–G7, ranked risks** | **r2 (rewritten)** |
| `14_AGENT_WORKFLOW.md` | Agent rules and safeguards | r1 + safeguards 12–16 |
| `15_SECOND_PASS_REVIEW.md` | **Review: verdicts, certainty, risks, generation/AI/backend/security/DPDP/tests/UI, STOP/START/CONTINUE, self-challenge** | new |
| `16_PHASE0_EVIDENCE_PLAN.md` | **EXP-ENGINE, oracle plan, TYPO, EXP-RENDER, budgets, PRESS, revised Phase 0** | new |
| `17_PRESS_REQUIREMENTS_QUESTIONNAIRE.md` | **Ready-to-use press interview** | new |
| `18_DEPENDENCY_LICENSE_REVIEW.md` | **Licence classes, PDF capability map, legal questions, MCP/tool review** | new |
| `19_FONT_RIGHTS_AND_LEGACY_TEXT.md` | **Font rights model; legacy Marathi conversion** | new |
| `20_ARCHITECTURE_BASELINE.md` | **Frozen / accepted / open** | new |
| `REVIEW_CHANGELOG.md` | What changed, why, and the evidence | new |
| `ADR/` | ADR-001–016 (with post-review status blocks); ADR-017–022 (new) | |

## Traceability: review brief → package

| Brief § | Topic | Where |
|---|---|---|
| 3 | Revalidate audit | 15 §2, 16 §0 |
| 5 | Gates | 13 |
| 6–7 | Certainty classes; ACCEPT/CHANGE/PROVE/REJECT | 15 §3–4, ADR-021 |
| 8 | Core engine language | 16 §1, ADR-017 |
| 9 | Python oracle | 16 §2 |
| 10 | Marathi quality gate | 16 §3 |
| 11 | Legacy fonts | 19 §2 |
| 12 | Font licensing | 19 §1, ADR-019 |
| 13 | Renderer bake-off | 16 §4 |
| 14 | Performance budgets | 16 §5 |
| 15 | Generation review | 15 §6 |
| 16 | AI boundary | 15 §7 |
| 17–19 | PDF architecture, open-source reality, commercial preflight | 15 §5, 18 §2, ADR-022 |
| 20 | Press questionnaire | 17 |
| 21 | Newsprint colour | 17 §D, ADR-014 status |
| 22 | Ad input | 16 (P0-13), 17 §G, 15 §10 |
| 23 | Press delivery | 17 §H, ADR-016 status |
| 24–26 | Backend, auth, tenancy | 15 §8 |
| 27 | DPDP | 15 §9 |
| 28 | Security | 15 §10 |
| 29 | Deadline reliability | 15 §12, ADR-020 |
| 30–32 | Archive, e-paper, Urdu | 15 §13 |
| 33–35 | Tests, parity, press fixtures | 15 §11, 12 §6–8 |
| 36–37 | Licences, MCP/tools | 18 |
| 38 | Agent workflow | 14 (safeguards 12–16) |
| 39 | Document quality | 15 §16 |
| 40 | Baseline | 20 |
| 41–42 | Phase 0, risk ranking | 16 §7, 13 |
| 43 | UI boundary | 15 §14, 13 ("allowed before each gate") |
| 44–46 | STOP / START / CONTINUE | 15 §15 |
| 50 | Self-challenge | 15 §17 |

## Traceability: product vision → docs (revision 1, still valid)

| Vision § | Topic | Covered in |
|---|---|---|
| 1–9 | Idea, users, accounts, onboarding, profile, daily flow | 03, 04, 11 |
| 10–18 | Inputs, newsroom, verification, rights, AI assistance, content desk | 04, 07, 08, 09 |
| 19–26 | Generation, editor, regeneration, contextual AI | 06, 07, 09, 15 §6 |
| 27–35 | Typography, preview = PDF, images, ads, preflight, print | 05, 08, 16, 17, 19 |
| 36–42 | Published edition, archive, search, paid retention | 10, 15 §13 |
| 43–46 | Collaboration, business model, feel, simplicity | 06, 11 |
| 47–53 | Workflow, success criterion, North Star | 13 (gates mirror the workflow) |

## Open items needing people, not code

**Founder**
- Pilot MoU.
- Press interview (`17`).
- Newsroom observation.

**Counsel**
- L1–L8 (`18` §3), including:
  - font licences;
  - DPDP journalism and archive treatment;
  - AGPL;
  - wire licences.

**Pilot sub-editors**
- L5 typography reviews.

**Vendors**
- Unicode or server licences for legacy font families.
- Callas or PitStop terms.
