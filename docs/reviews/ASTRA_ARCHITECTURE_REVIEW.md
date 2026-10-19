# Adversarial architecture review — Phase 18

Review date: 2026-09-16. Scope: all 17 persisted Phase 1–17 architecture/research artifacts, cross-checked from disk against original product intent. The empty ASTRA_PHASE_1_CRITIQUE.md is excluded. This is a deliberately adversarial second-pass review, not a claim of an independent person/model, executed experiments, legal clearance or press certification.

## Verdict

The proposal is suitable for a decision-gated UI-first specification, NOT an approved production publishing architecture. It correctly separates editorial assistance from physical authority and avoids premature microservices. Those strengths do not prove that its renderer, text input, font subsetter, PDF writer and press workflow can work together. Four critical decision workstreams remain open. No production readiness can be inferred from documentation completion.

## Findings

Each finding identifies evidence, consequence, required correction and remaining research. “Addressed in specification” means an ambiguity can be removed on paper, not that a runtime control has been verified.

| ID / severity | Issue and evidence | Why it matters | Correction | Research required / disposition |
|---|---|---|---|---|
| AR01 CRITICAL | Phases 3/5/6 propose a shared glyph scene, but no writer/renderer combination has demonstrated glyph subset mapping, clipping, colour and logical text fidelity together. | A technically attractive editor can still be incapable of producing the product's only meaningful output. | Make a thin complete composition→preview→PDF→preflight proof a gate before broad engine/schema commitment. Do not select CanvasKit or a PDF writer by association. | RD01; OPEN. Compare actual writer paths on identical licensed input and independent rendering. |
| AR02 CRITICAL | Phase 5 lists complex-script needs without an approved font/language corpus or native-reader results. | HarfBuzz support alone does not establish Urdu Nastaliq line spacing, justification, caret behavior or Marathi editorial quality. | Preserve all eventual languages, qualify supported font/language pairs, test line-end reshaping and real input methods. No silent fallback to English-only architecture. | RD02; OPEN. Pilot selection PO02 and multilingual experiment required. |
| AR03 CRITICAL | Phases 6/7 have no press-approved profile, professional-engine evaluation or SaaS/OEM quote. | “Press ready” and fail-closed final validation cannot be delivered if conformance scope, platform or licensing is unavailable. | Keep PDF/X variant and preflight procurement open; distinguish source checks, final-byte validation, RIP acceptance and physical print. Acquire a press partner/profile before production output freeze. | RD03; OPEN. PO03/PO04 prerequisites; no self-certification substitute. |
| AR04 CRITICAL | Phase 11's complete package requires licensed recoverable dependencies; font/wire retention rights and recovery promises remain unknown. | Exact PDF retention can succeed while the advertised editable edition cannot be restored, or reprinting is no longer permitted. | Separate exact-byte retrieval, current reprint entitlement and editable-copy restoration in product contracts and UI. Gate retention/WORM and dependency preservation on explicit terms and recovery evidence. | RD04; OPEN. PO05; technical restore drill and rights review required. |
| AR05 HIGH | Phase 3 recommends integer micro-points before numeric range analysis; Phase 17 acknowledges unsafe intermediate arithmetic. | Products of individually safe coordinates/transforms can lose precision, corrupt clipping or overflow. Overprecision also increases schema burden. | Downgrade micro-points to one candidate. Require an explicit physical error budget, bounds on intermediates and round-trip tests before choosing scale/representation. | RD05; targeted Phase 24 correction to Phase 3. |
| AR06 HIGH | Phase 3 permits “placement-specific overrides” without separating text edits from style/geometry overrides. | Two hidden story bodies undermine revision lineage, AI acceptance, correction propagation and exact export identity. | Text-changing edition edits create an immutable edition-local StoryRevision with parent/source lineage. Placement overrides are nontext formatting/geometry unless explicitly referencing that new revision. | No research needed for ownership clarification; RD05 covers schema validation. Correct Phases 3/11 and master. |
| AR07 HIGH | Phases 11/12 require current release authorization but do not define the race between final rights checks, revocation and DB commit. | A revoked approval/grant can authorize a release if a check occurs only before object staging. | Pin candidate hashes; serialize final release with policy/grant version checks or equivalent transaction protection. Recheck expiry at commit. Later revocation restricts delivery/reprint without mutating historical bytes; already delivered bytes cannot be recalled. | RD09 integration/security proof. Add precise protocol to master and Phase 11. |
| AR08 HIGH | Phase 5's opening BUILD recommendation is broader than its later call to compare existing paragraph compositors; text input frameworks are missing from Phase 4/10 comparisons. | The team may unnecessarily build paragraph layout, selection/history or IME infrastructure. | Own newspaper policies, not automatically the underlying paragraph algorithm. Add Pango/SkParagraph and ProseMirror/Lexical comparisons with integration and license gates. | RD01/RD06. New primary evidence below; qualified additions in Phase 24, not automatic adoption. |
| AR09 HIGH | Konva interaction plus CanvasKit rendering can create duplicate scene graphs, hit testing and font stacks (Phases 4/10). | Two libraries are not automatically simpler than one; geometry drift, WASM disposal and accessibility can become hidden costs. | Treat interaction and rendering as contracts, not a requirement to deploy both libraries. Benchmark a minimal hybrid and alternatives; one canonical scene only. | RD06; OPEN. DOM story-panel fallback allowed, not independent print reflow. |
| AR10 HIGH | Registry records repeatedly say “public project” while performance, advisory/SBOM and exact dependency maintenance are unqualified. | ADOPT/BUY labels can be misread as completed approval; permissive top-level licensing does not clear fonts/codecs/models or distribution. | Preserve conditional labels; no significant package procurement/install approval without exact artifact, notices, advisories, support, runtime and representative test evidence. Add new candidates to both registry matrices. | RD10; OPEN. This review does not assert any uninspected dependency is safe. |
| AR11 HIGH | Phase 15 is broad enough to occupy a team before the riskiest publishing integration is tested. | A persuasive UI can accumulate expensive assumptions while the press path remains infeasible. | Roadmap must allow a separately authorized thin publishing research track after foundation, before broad production editor/layout work; immediate backlog still contains only UI simulations. | Address in roadmap; no implementation or experimental code in this program. |
| AR12 HIGH | Per-document lease proposal (Phases 2/11) has no customer agreement for simultaneous section/page editing. | Forced single-editor workflow may not fit a deadline newsroom; CRDT adoption without evidence would also overengineer. | Product owner chooses pilot coordination needs. Lease + optimistic concurrency is a recommendation only; show conflicts and linked-flow scope, never silent last-write-wins. | PO06; RD05 if concurrent model needed. |
| AR13 HIGH | Real deadline/concurrency/recovery requirements are missing, despite the illustrative 16-page fixture (Phases 1/14). | “Scalable” or “interactive” claims would be unfalsifiable; queue and commercial costs may fail during synchronized daily deadlines. | Keep measured experiment targets distinct from promises; agree peak edition workload and recovery objectives, then test noisy-neighbor and license/vendor outages. | PO08/RD12; OPEN. No invented SLA/calendar. |
| AR14 HIGH | Source identity, source items and event clusters could be conflated across organizations (Phases 2/9/11). | Shared URL/canonical text or event dedup can leak licensed wire content, existence, snippets or inferred embargoes. | Public publisher identity may be global; fetched content, grants, embeddings, clusters and results remain tenant-scoped unless an explicit sharing contract permits otherwise. | RD09 negative tests; clarify master. |
| AR15 HIGH | Phase 12 leaves confidential-story access open while publication-wide access is the working default. | First pilot may need embargo/source protection narrower than publication membership. | Ask about sensitivity before real data; default deny unsupported confidentiality cases. Keep audit/billing/support powers separate from editorial access. | PO07; never call the UI permission simulation a security implementation. |
| AR16 MEDIUM | news-please package/master version discrepancy and sparse issue/release observations do not establish vulnerability, abandonment or fitness. | Overstating weakness is as misleading as blindly adopting it; library and CLI have different fetch/storage behavior. | Keep RESEARCH FURTHER. Inspect the exact wheel/source provenance, dependency graph, robots/retry behavior and approved multilingual corpus against alternatives. Do not inherit its storage stack. | RD07; OPEN. Existing conclusion retained, no unsupported rejection. |
| AR17 MEDIUM | Archive-before-release protocol appears earlier than the conceptual press→archive product diagram. | Readers could delay retention until after handoff or mutate the archived package to add press receipts. | Archive immutable candidate/release package before exposing print master; append independently identified press acceptance/physical-print receipts linked to the release. The end-user lifecycle still ends in archived publication. | Specification clarification only; no immutable package mutation. |
| AR18 MEDIUM | AI evaluation approach lists metrics but no thresholds/corpus size; source “verification signals” risk sounding like a truth score. | Rankers can reward copied misinformation; structural output checks cannot establish factuality. | Treat scores as explainable editorial aids with independent-source lineage. Establish per-task/language thresholds before deployment; manual workflow remains available. | RD08; OPEN, not a reason to choose a provider now. |
| AR19 MEDIUM | Billing, archive tiers and permanent retention are business assumptions, not proved unit economics. | Professional-engine worker licensing, storage/egress and support can dominate subscription revenue; nonpayment cannot silently delete releases. | Model per-edition costs, eligibility and termination/retention terms; avoid charging gates that bypass mandatory correctness. | PO05/PO09/RD11; OPEN. UI pricing is illustrative. |
| AR20 LOW | Research observations come from September 15–16 documentation, not pinned production dependencies. Some upstream URLs move or block access. | Future readers may mistake a dated observation for current package provenance. | Preserve observation dates and links; exact-version evidence must be refreshed at adoption, including moved repositories. | RD10. No rewrite of correct historical observations needed. |

## Additional primary evidence for missed reuse opportunities

Pango documents paragraph layout, glyph-based rendering, HarfBuzz integration and LGPL-2.1-or-later licensing. This makes it a serious paragraph-layer comparator, not proof of newspaper composition or browser parity. [Pango API](https://docs.gtk.org/Pango/).

Lexical offers a framework-independent editor core, history and React integration under MIT. Its claimed accessibility does not establish Pageinator's canvas/input accessibility or complex-script acceptance. [Lexical upstream](https://github.com/facebook/lexical).

ProseMirror provides semantic document schemas and contentEditable editing under MIT. Its GitHub meta-repository was archived on 2026-04-07 and explicitly points to a new upstream; this is a migration observation, not evidence that the project was abandoned. Verify individual module provenance before selection. [Upstream migration notice](https://github.com/ProseMirror/prosemirror).

Skia's paragraph module deserves comparison if the Skia rendering stack is selected; access/API coverage must be checked before promising exportable resolved glyph data. Core BSD-style licensing does not replace its third-party notices. [Skia source/license](https://github.com/google/skia/blob/main/LICENSE). The attempted paragraph documentation URL was not sufficient evidence of a usable API.

Phase 24 obtained stronger source evidence: the native Paragraph interface exposes a glyph/position/font/source-offset visitor. This supports investigating a bridge; it does not prove the equivalent CanvasKit API, font subset export, newspaper policy or script quality. [Native interface](https://raw.githubusercontent.com/google/skia/main/modules/skparagraph/include/Paragraph.h). RD01 remains open.

## Review disposition and synthesis instructions

AR01–04 are genuine production blockers, not blockers to completing preimplementation documentation or the explicitly simulated UI. AR05–08/14/17 require targeted textual corrections and explicit master contracts. AR09–13/15–16/18–20 remain decision/research/owner gates. Do not close these by writing “use mature library.” Retain the modular-monolith recommendation and Pageinator-owned newspaper semantics; no evidence justifies microservices, full event sourcing, a generic DTP fork, bespoke Unicode shaping or LLM-controlled preflight.

Phase 19 must enumerate unresolved workstreams and responsible gates. Phase 21 must resolve specification ambiguities and preserve feasibility uncertainty. Phase 24 will record the actual correction/check results here; this initial review does not claim that later artifacts already exist.

## Phase 24 — Final consistency review and completion audit

Completed 2026-09-16 after Phases 19–23 were persisted and read from disk. Revisited the complete original context, all architecture/research drafts, this review, decision and owner registers, master, roadmap and backlog. Earlier completed drafts were not regenerated. Only the targeted corrections below were made. This section is the Phase 24 artifact: the program designated no separate Phase 24 filename.

### Corrections actually applied

| Finding | Persisted correction | Residual gate |
|---|---|---|
| AR05 | Phase 3 removes premature micro-point recommendation; master and roadmap preserve numeric/range qualification before production freeze. | RD05 experiment still required |
| AR06 | Phases 3/11 and master specify edition-local immutable StoryRevision lineage; no hidden alternate text in placement overrides. UI017 models it. | Runtime schema/revision tests remain future work |
| AR07 | Phase 11/master require final transactional grant/approval/time checks against revocation races, not pre-staging permission only. | RD09 security/recovery evidence |
| AR08 | Typography opening narrows BUILD to newspaper policy; Pango/SkParagraph and ProseMirror/Lexical evaluated in research addenda and both DEP61–64 registry matrices. | RD01/02/06/10; no candidates promoted to approved |
| AR09 | Browser research/master clarify that interaction/renderer contracts do not mandate a combined Konva/CanvasKit stack. | RD06 benchmark |
| AR11 | Roadmap adds early separately authorized RM04 feasibility work; UI backlog remains solely RM01–02. | Actual research authorization/execution later |
| AR14 | Phase 11/master make source items, clusters, embeddings and results tenant-private despite potentially global public source identity. | RD09 negative tests |
| AR17 | Phase 11/master distinguish archive-before-download from later append-only press/physical-print receipts. | Release/archive implementation and G4/G6 |
| Requirement coverage | Master explicitly retains frame/text/image/rectangle/line creation, align/distribute, duplicate/delete and pan/zoom from original context; UI demonstration remains bounded. | Professional editor qualification later |
| Gate consistency | Roadmap clarifies RM06 provisional contracts versus G3 production schema/engine commitment; a one-page proof is not a 16-page acceptance result. | Phase 3 feasibility criteria retained |

No correction weakens deterministic physical authority, same-scene preview/PDF, rights, tenant isolation or immutable exact-release requirements. AR01–04 remain CRITICAL, explicitly recorded as RD01–04. Other unresolved research, licensing, capacity and owner decisions remain in the registers. Specification ambiguity being addressed does not close a production risk.

### Cross-artifact review results

| Check | Result / evidence |
|---|---|
| Original intent and scope | Phase 1 R01–48 and master §12 map all requirement families; fresh-codebase instruction supersedes only obsolete prototype/audit/freeze work, not product requirements. No generic-dashboard or DTP-clone substitution. |
| Decision consistency | D01–13 are requirements/invariants, OP11–14 recommendations; no vendor/package declared approved. Master/roadmap use the same RD01–12 and PO01–11 identities. |
| Publishing boundary | EditableDocument intentions → iterative deterministic resolution → shared physical scene; browser/native parity still a research gate. AI has no final physical authority. |
| Revisions/reproducibility | Export pins exact edited revision and final hash; fixup/edit invalidates current approval; archive preserves exact bytes, not an unproved identical rerun. |
| Archive/security | Archive-before-release, immutable package plus append-only receipts, rights-aware reprint/copy, tenant-private references and final authorization race protection align across master/Phases 11–14. |
| Multilingual | English/Hindi/Marathi/Devanagari/Urdu/mixed remain eventual requirements; pilot order is open. No generic “Unicode works” claim replaces font/native-reader evidence. |
| Rights/licenses | Access/robots/RSS/extraction never equates to printing/AI/archive rights. Font/model/dictionary/codec and SaaS/OEM terms remain explicit adoption gates. No legal clearance asserted. |
| Dependency classifications | 64 candidate IDs each have both capability/licensing and runtime/health/risk records; primary evidence or linked research provided. news-please remains RESEARCH FURTHER, not silently adopted. |
| Reuse/IP | Mature commodity systems evaluated; newspaper models, commands, policies, rights/release semantics remain Pageinator-controlled. No external code copied or vendored. |
| Roadmap/backlog | 18 gated workstreams include all requested lanes; 26 UI units cover only RM01–02 with field-complete acceptance/test/non-goals. No production code task concealed in UI simulation. |
| Test claims | Only documentation integrity/read-only repository checks performed here. No application, typography, PDF, security, load or physical press tests claimed executed. |

### Required-artifact manifest

All entries below exist and are non-empty. Phase 24 is persisted within this review rather than an extra unrequested file.

| Phase | Artifact |
|---|---|
| 1 | `docs/architecture/PHASE_1_ANALYSIS.md` |
| 2 | `docs/architecture/PHASE_2_SYSTEM_ARCHITECTURE.md` |
| 3 | `docs/architecture/PHASE_3_PUBLISHING_ENGINE.md` |
| 4 | `docs/research/BROWSER_EDITOR_RESEARCH.md` |
| 5 | `docs/research/TYPOGRAPHY_RESEARCH.md` |
| 6 | `docs/research/PDF_PREPRESS_RESEARCH.md` |
| 7 | `docs/research/PREFLIGHT_RESEARCH.md` |
| 8 | `docs/research/IMAGE_COLOR_RESEARCH.md` |
| 9 | `docs/research/NEWS_INTELLIGENCE_RESEARCH.md` |
| 10 | `docs/research/DEPENDENCY_CANDIDATES.md` |
| 11 | `docs/architecture/PHASE_11_DATA_REVISION_ARCHIVE.md` |
| 12 | `docs/architecture/PHASE_12_SECURITY_TENANCY.md` |
| 13 | `docs/architecture/PHASE_13_AI_ARCHITECTURE.md` |
| 14 | `docs/architecture/PHASE_14_TESTING_VALIDATION.md` |
| 15 | `docs/architecture/PHASE_15_UI_FIRST.md` |
| 16 | `docs/architecture/PHASE_16_REPOSITORY_DEVELOPMENT.md` |
| 17 | `docs/architecture/PHASE_17_RISK_REGISTER.md` |
| 18 | `docs/reviews/ASTRA_ARCHITECTURE_REVIEW.md` |
| 19 | `docs/architecture/DECISION_REGISTER.md` |
| 20 | `docs/architecture/PRODUCT_OWNER_QUESTIONS.md` |
| 21 | `docs/MASTER_BUILD_SPEC.md` |
| 22 | `docs/IMPLEMENTATION_ROADMAP.md` |
| 23 | `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` |
| 24 | This review's final consistency/audit section |

Count convention: **23 generated program artifacts cumulatively across interrupted/resumed runs**: 12 architecture, 7 research, 1 review, 2 root-level specification/roadmap documents and 1 backlog. The obsolete empty ASTRA_PHASE_1_CRITIQUE.md is untouched and excluded. Original context and README are inputs, not generated artifacts. Completing 24 phases therefore does not require 24 new files.

### Verification evidence and limits

Read-only checks confirmed required files/nonempty content, final newlines/balanced fenced blocks, local Markdown link targets, paired registry rows, all six body fields plus heading ID/title in each backlog unit, and mechanical counts from the registers. Manual reading checked coherent endings and required sections; no generated artifact appears truncated. An initial metadata-check script encountered an older system Ruby without Array#tally; it was rerun successfully using a compatible in-memory counter. No package was installed to perform the checks.

Protected SHA-256 digests match the pre-resumption baseline and the files have no Git diff against HEAD:

- `docs/context/ORIGINAL_PRODUCT_CONTEXT.md`: `b287bfec10d9cac84b17e979c6557e6bf54539b00f31001e300e24e9222bc9f9`
- `README.md`: `a64c36478d1999cc7c296b78155e18412954972a98eb9817c0232d9c71768805`

Repository inventory outside docs/specs contains only the existing README and .gitignore (excluding Git internals). Git tracked-file diff is empty; generated documents remain uncommitted. No production/source files, framework scaffold, package/lockfiles, installed dependencies, cloned/vendored repositories, CLAUDE.md or AGENTS.md were created. No commit, push or Git configuration change was performed. Checks apply to this workspace and observed program actions, not a claim to audit unrelated global machine activity.

Final counters: **24/24 documentation phases complete; 23 populated program artifacts; 4 critical unresolved decisions; 5 blocking product-owner questions; 12 unresolved research workstreams.** G0 is complete. G1–G7 have not been executed or passed. Recommended next action: review PO01–05 and authorize the first bounded UI-foundation feature specification; do not infer implementation permission from this audit.

End of Phase 24 consistency review. NO IMPLEMENTATION PERFORMED.
