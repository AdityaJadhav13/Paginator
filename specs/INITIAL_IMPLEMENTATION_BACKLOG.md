# Initial implementation backlog — Phase 23

Prepared 2026-09-16 from the persisted Master Build Specification, roadmap RM01–02, and Phase 15. Scope: **UI-only**, fictional data, no production engines/services. These are implementation-sized work units to turn into one feature spec/branch/fresh targeted session each, not instructions to implement now. The framework/version adoption review and explicit implementation authorization precede UI001. No directory below exists merely because it is proposed here.

## Shared acceptance contract

All units inherit D04/D07/D10/D13: scoped fixture identities, rights-aware presentation, truthful simulation labels and bounded feature workflow. Each extends mock service DTOs only as needed; views do not import mutable fixtures directly. Use accessible controls, loading/empty/error/denied states, stable IDs, route-based context and the appropriate unit/component tests. A new dependency requires the registry/adoption gate. Tests run in future implementation; none have run in this documentation program.

No live authentication, passwords, email/invitations, payments, crawling, AI, customer content uploads, cloud persistence, backend scaffolding, font shaping, ICC, real PDF/preflight or production archive. Unknown/unsupported interactions are labeled/disabled, never false success. Sample text rendering is not press geometry. Sample export does not generate a press-ready file. Production claims, actual security enforcement and benchmark qualification are out of scope for every unit.

## Foundation

### UI001 — Accessible UI primitives and status vocabulary

Purpose: establish the shared presentation layer before screens (R38/R40).
Dependencies: authorized feature spec and exact-version review of recommended UI/test toolchain; no other backlog item.
Expected file/domain area: future `frontend/` minimal authorized UI setup, `frontend/ui/`, UI component tests.
Acceptance criteria: tokens for spacing/type/colour; usable button, field, dialog and status primitives; visible focus/error association; “simulated”, pending/saved, failed and blocked states have distinct readable labels. Only UI/test tooling is initialized under later authority.
Test expectations: component keyboard/focus/error tests and contrast review; build/type check; no unrelated source areas.
Out of scope: app business screens, production services, native publishing toolchain.

### UI002 — Public, application and editor route shells

Purpose: stable navigation and workspace context (R11/R38/R40).
Dependencies: UI001.
Expected file/domain area: `frontend/app/`, route/layout components and navigation tests.
Acceptance criteria: implement Phase 15's route families with placeholders explicitly labeled; public/workspace/editor shells; deep link, back/forward, refresh, not-found and invalid-context states; phone review layout versus desktop editor layout.
Test expectations: route resolution and keyboard navigation; viewport checks; no record leakage in invalid-ID messages.
Out of scope: feature behavior and real authorization.

### UI003 — Scoped mock service and scenario foundation

Purpose: one coherent fictional domain behind replaceable adapters (R06/R34/R37/R38).
Dependencies: UI001.
Expected file/domain area: `frontend/services/`, `frontend/mocks/`, contract/fixture tests.
Acceptance criteria: define minimal user/org/publication/edition DTOs and promise-based interfaces; seed two organizations and multiple publications; scoped lookup errors; scenario controls for latency/failure/denial; stable reset seed. Each later feature adds its own DTOs, not an entire production schema now.
Test expectations: deterministic fixture generation, scoped lookup, error/result shape and scenario reset tests.
Out of scope: generated production clients, real API, full EditableDocument/ResolvedDocument schemas.

## Entry and edition planning

### UI004 — Simulated session and access context

Purpose: enter the correct publication as a demonstrable role (R07/R08).
Dependencies: UI002/UI003.
Expected file/domain area: `frontend/features/auth/`, mock session/permission adapter.
Acceptance criteria: login/signup/verify/recovery use fictional identities and no real credentials; role/org/publication switch updates visible navigation and scoped mock access; denied route state; logout clears current selections and protected fixture views.
Test expectations: direct-link denial, role change, organization switch and session reset; zero auth/email network actions.
Out of scope: password handling, OAuth/OIDC, production RBAC/session protection.

### UI005 — Truthful public product journey

Purpose: explain the newspaper workflow and lead into the demo (R01/R39).
Dependencies: UI002/UI004.
Expected file/domain area: `frontend/features/public/`.
Acceptance criteria: landing/features/pricing/security/contact surfaces with coherent CTAs; pricing marked illustrative; no invented customers, certifications or press-ready claims; contact is non-sending demo behavior.
Test expectations: CTA destinations, keyboard and small-screen reading order, absence of live form submission.
Out of scope: marketing analytics, payment signup, real contact delivery.

### UI006 — Progressive publication onboarding

Purpose: configure a usable draft publication without claiming press readiness (R08/R10).
Dependencies: UI003/UI004.
Expected file/domain area: `frontend/features/onboarding/`, mock publication profile.
Acceptance criteria: staged identity/region/timezone/cadence/language/brand inputs with validation/back navigation; finish creates a scoped fictional publication; incomplete print/source setup appears as actionable tasks, not fabricated validation.
Test expectations: required fields, preserved steps, duplicate submit, cancellation and onboarding→overview context.
Out of scope: press profile qualification, font licensing validation, real organization creation.

### UI007 — Publication overview and edition list

Purpose: show today's work and the next meaningful action (R11/R12).
Dependencies: UI006.
Expected file/domain area: `frontend/features/overview/`, edition query adapter.
Acceptance criteria: publication-local date, recent/today's editions and descriptive readiness; no-edition/empty/loading/error states; correct publication/region links; seeded 16-page example is not a capacity claim.
Test expectations: timezone boundary fixtures, organization switch, missing edition and matching counts across list/detail.
Out of scope: live metrics, uncalibrated readiness percentages.

### UI008 — Create and open a draft edition

Purpose: establish the selected edition identity for the full journey (R12/R13).
Dependencies: UI007.
Expected file/domain area: `frontend/features/editions/`, mock edition command.
Acceptance criteria: date/region/pages/language/template/profile choices; validate supported demo choices; create once with stable ID; navigate to its Content Desk; show draft profile limitation; duplicate date/region handling explicit.
Test expectations: required fields, invalid page count, double-submit idempotence, cancellation and correct scoped deep link.
Out of scope: actual pagination or production scheduling.

## Newsroom and content preparation

### UI009 — Rights-aware newsroom browsing

Purpose: distinguish source observations/events from editable stories (R30–32).
Dependencies: UI008.
Expected file/domain area: `frontend/features/newsroom/`, source/event mock queries.
Acceptance criteria: fictional feed, filters, event grouping, attributed source details and explainable ranking; discovery-only, licensed, embargoed and corrected examples; source/wire configuration summaries are clearly fixtures. Reading an item does not import it automatically.
Test expectations: filtering/scoping, non-independent syndicated sources, missing metadata and empty/error views; no live fetches.
Out of scope: news-please installation, crawling, actual clustering/search scoring or source credentials.

### UI010 — Story selection and Content Desk readiness

Purpose: turn permitted content into an edition selection (R13/R31).
Dependencies: UI009.
Expected file/domain area: `frontend/features/content-desk/`, mock story library and selection commands.
Acceptance criteria: browse fixture stories, select permitted revision into edition, remove selection and inspect provenance; reject discovery-only/embargoed import; readiness names missing assets/credit/rights and ad reservations; selection counts agree with overview.
Test expectations: duplicate selection, denied import, corrected source revision not silently replacing selected text, scope switching and count consistency.
Out of scope: legal rights determination, real article storage or editing engine.

### UI011 — Media metadata and placement readiness

Purpose: show image/caption/credit problems before generation (R13/R23).
Dependencies: UI010.
Expected file/domain area: `frontend/features/media/`, mock media metadata adapter.
Acceptance criteria: fixture media list/detail and associations; caption/credit form; explicit missing-credit and illustrative low-resolution warnings; preserved-original explanation. Any local sample preview remains demo-only with reset behavior.
Test expectations: metadata edit/cancel, missing-credit readiness updates, authorized associations and accessible preview controls.
Out of scope: real uploads, EXIF parser, pixel/PPI measurement, derivatives/ICC conversion.

### UI012 — Advertisement reservation desk

Purpose: make fixed ad constraints visible (R13/R20).
Dependencies: UI010.
Expected file/domain area: `frontend/features/ads/`, mock ad/reservation model.
Acceptance criteria: creative/reservation dimensions and page preferences displayed; assign a supported fixture reservation; unavailable slot/conflict scenario clearly blocks simulated readiness; ad user lacks story-edit affordance.
Test expectations: reservation conflict, permission scenario and Content Desk synchronization.
Out of scope: ad-sales CRM, financial invoicing, actual geometric feasibility.

### UI013 — Publication production defaults and template catalogue

Purpose: inspect and select explicit configuration versions (R10/R12/R20/R24).
Dependencies: UI006/UI008.
Expected file/domain area: `frontend/features/publication-settings/`, profile/template mock adapters.
Acceptance criteria: template/brand/print-profile fixture summaries, bounded demo defaults editing, visible version and unvalidated press status; changing defaults does not silently mutate an existing edition's pinned version; unsupported configuration displays explanation.
Test expectations: revision pinning, denied setting edit, cancellation and linked template/profile routes.
Out of scope: general template authoring, ICC uploads, printer standard certification.

## Generation and sample editor

### UI014 — Recoverable generation simulation

Purpose: demonstrate automatic-production intent without pretending to compose (R14/R46).
Dependencies: UI010–UI013.
Expected file/domain area: `frontend/features/generation/`, mock job adapter.
Acceptance criteria: allowed strategy choice, staged status and deterministic sample-page result tied to selected edition/revision; cancellation/failure retains content; rerun/stale-result scenario cannot replace a newer mock revision unnoticed; clear simulated label.
Test expectations: success/failure/cancel/retry, duplicate start and edition switch during a pending result.
Out of scope: AI calls, constraints solver, actual text layout or generation quality scores.

### UI015 — Sample page navigator and selection

Purpose: establish newspaper-focused editing context (R19/R40).
Dependencies: UI014.
Expected file/domain area: `frontend/features/editor/` shell, sample page/frame view adapter.
Acceptance criteria: page thumbnails/navigation, sample frames, select by pointer or accessible list, properties panel, zoom/pan; stable page/frame IDs; unsupported phone editing explained while review remains available.
Test expectations: selection across pages, keyboard focus, zoom not changing model geometry, empty/invalid frame states.
Out of scope: resolved glyph renderer, production canvas library commitment, large-document benchmarks.

### UI016 — Bounded frame commands and undo

Purpose: demonstrate manual control and revision-aware change (R19/R21/R35).
Dependencies: UI015.
Expected file/domain area: editor command/mock document adapter and interaction tests.
Acceptance criteria: sample move/resize, numeric property equivalent, lock checks, one command per gesture and undo/redo; mock revision increments; pending versus demo-saved state; locked ad/frame cannot silently move; unsupported rotate/crop/tools explicitly identified.
Test expectations: drag versus numeric equivalence within demo units, lock rejection, undo/redo, stale base revision and failed save retaining unsaved state.
Out of scope: production numeric precision, collision/fit engine, arbitrary vector operations.

### UI017 — Story panel and contextual suggestion acceptance

Purpose: demonstrate human-controlled editorial changes (R18/R22/R33/R35).
Dependencies: UI016.
Expected file/domain area: editor story panel, mock StoryRevision/proposal commands.
Acceptance criteria: English/Marathi/Hindi/Urdu fixture text, IME-safe input and RTL direction; edition-local revision lineage; fixture headline/translation suggestion diff with accept/reject; stale proposal rejection; accepted text is not advertised as physically fitting.
Test expectations: composition events, Unicode text preservation, cancel/undo, lineage, no source-story mutation and zero provider calls.
Out of scope: rich-text framework commitment without review, production caret/shaping, real translation quality.

### UI018 — Scoped regeneration proposal preview

Purpose: make override/lock preservation and expanded scope understandable (R21).
Dependencies: UI016/UI017.
Expected file/domain area: editor regeneration panel and scenario adapter.
Acceptance criteria: choose supported page/region/story scope; display predefined affected-page closure, locked items and before/after sample proposal; accept/cancel; reject stale revision; preserved manual override shown; no claim of computed layout.
Test expectations: lock conflict, wider linked-flow scope, cancel leaves state unchanged and accepted proposal advances revision once.
Out of scope: actual dependency solver or edition regeneration.

## Production and archive simulations

### UI019 — Revision-bound preflight issue workflow

Purpose: teach blocking checks and fix-to-location behavior (R26/R36).
Dependencies: UI018.
Expected file/domain area: `frontend/features/preflight/`, mock result adapter.
Acceptance criteria: fixture Typography/Images/Colour/Layout/Ads/Print issues; severity and pass/fail/not-run/error states; jump to frame; pass bound to mock revision/profile; any edit invalidates it; mandatory issue/engine-error cannot be waived.
Test expectations: issue navigation, stale pass, missing-result failure, inaccessible frame and profile change scenarios.
Out of scope: PDF inspection, qpdf/callas/PitStop or source geometry checks.

### UI020 — Exact-candidate sample export

Purpose: demonstrate release identity and failure-closed export (R25/R36/R44).
Dependencies: UI019.
Expected file/domain area: `frontend/features/export/`, mock candidate/release adapter.
Acceptance criteria: selected revision/profile and clearly fake/sample digest displayed; export blocked for stale/failing/not-run checks or missing mock grant; simulate candidate/approval/archive commitment before labeled sample result; edit N+1 never relabels N as current; no actual press PDF generated.
Test expectations: revision race, revoked mock permission, simulated archive failure/cancel and repeated request returning same sample release identity.
Out of scope: real hashing/preflight/signing, file-generation engine or press handoff.

### UI021 — Immutable sample archive and editable copy

Purpose: distinguish retrieval, reprint permission and reopening (R27–29/R35).
Dependencies: UI020.
Expected file/domain area: `frontend/features/archive/`, mock package/query/copy adapter.
Acceptance criteria: prior and newly simulated releases filter by publication/date; detail shows immutable revision identity and rights/retention limitations; preview/sample download action labeled; copy creates new edition/revision lineage without modifying release; denied reprint remains distinct from view.
Test expectations: sample byte-identity label remains stable after editing copy, filtering/scoping, duplicate copy handling and unavailable-dependency scenario.
Out of scope: cloud/WORM/backup, legal retention enforcement, promised exact editable recovery.

## Administration and demo coherence

### UI022 — Team capability simulation

Purpose: communicate role and publication boundaries (R07/R34).
Dependencies: UI004/UI013; UI020 for release-role scenario.
Expected file/domain area: `frontend/features/team/`, mock membership/capability adapter.
Acceptance criteria: team list, bounded role/grant change and non-sending invite preview; explicit release permission; billing role does not gain story access; role change updates navigation/action denial consistently.
Test expectations: invite no-network assertion, cross-publication grant scenario, stale permission and no implied owner preflight bypass.
Out of scope: real invitations, provider membership sync, production access control.

### UI023 — Organization preferences and storage status

Purpose: expose organization-level settings separately from publication work (R06/R29).
Dependencies: UI013/UI021/UI022.
Expected file/domain area: `frontend/features/organization-settings/`, mock storage/preferences.
Acceptance criteria: scoped settings and illustrative storage usage with working versus archive distinction; quota warning preserves drafts/releases; account deletion/retention controls are explanatory and non-destructive; no permanent-retention promise.
Test expectations: role denial, storage totals from fixture records, reset and no destruction on plan/quota scenarios.
Out of scope: physical object accounting, real deletion, WORM configuration.

### UI024 — Billing and entitlement demonstration

Purpose: explore commercial workflow without charging (R02/R47).
Dependencies: UI022/UI023.
Expected file/domain area: `frontend/features/billing/`, mock subscription/entitlement adapter.
Acceptance criteria: illustrative plan/usage/invoice views and non-charging plan-change preview; billing-only persona; overdue/quota/grace states clearly provisional; no bypass of mandatory validation or automatic archive deletion.
Test expectations: role separation, fake price labels, deterministic totals, no payment network actions and no destructive entitlement change.
Out of scope: Stripe/Razorpay SDKs/accounts, real taxation/invoicing/economics claims.

### UI025 — Versioned demo persistence and reset

Purpose: preserve the coherent fictional journey across reloads (R35/R46).
Dependencies: UI003; integrate changed DTOs through UI024 before final acceptance.
Expected file/domain area: mock persistence adapter/scenario controls; schema migration/reset tests.
Acceptance criteria: fictional-only local store with explicit schema version; reload restores scoped draft/revision state; unsupported/corrupt state offers safe reset; reset returns deterministic fixtures; signout/switch does not expose stale selected records; visible distinction from cloud save.
Test expectations: reload, partial/corrupt storage, prior schema, reset idempotence and organization isolation; fixture-only content audit.
Out of scope: offline product, encrypted customer persistence, backend migrations or archive durability.

### UI026 — G1 cross-workflow acceptance and accessibility review

Purpose: verify the integrated UI milestone rather than disconnected screens (R39/R40/R43/R46).
Dependencies: UI005–UI025, including inherited dependencies.
Expected file/domain area: future UI E2E/visual/accessibility test suite and feature verification report.
Acceptance criteria: full landing→session/onboarding→edition→newsroom/desk→generation→editor→preflight→sample export→archive-copy journey; team/settings/billing reachable; repeat with denied rights, job cancellation, stale preflight and organization switch. All unsupported/production-sensitive behavior remains truthfully labeled.
Test expectations: deterministic E2E, keyboard and RTL/IME spot checks, desktop/mobile management screenshots, counts/IDs/revisions consistency, no forbidden external requests; report untested browsers honestly. Individual unit tests are already required throughout, not deferred here.
Out of scope: G2–G7 certification, typography/layout/PDF goldens, security penetration testing or press validation.

## Sequencing and handoff

UI001–003 establish foundation; entry/planning and content units follow their prerequisites. UI025's adapter may be developed after UI003 and integrated incrementally, with final compatibility checks after feature DTOs stabilize; its dependency on UI024 is for completion, not a cycle in earlier work. UI026 is the G1 gate. Do not add RM03–18 backend/engine/research tasks to this backlog without a separate approved scope.

Each feature spec should cite the master sections and Phase 15, list only relevant initial paths and tests, and state its mock/real boundary. Implementation agents must not scan the whole repository by default or infer that this backlog authorizes implementation during the current preimplementation program.

End of UI-first backlog. No implementation performed.
