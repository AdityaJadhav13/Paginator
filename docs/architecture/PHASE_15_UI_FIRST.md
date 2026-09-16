# Phase 15 — UI-first product architecture

Prepared 2026-09-16. Inputs read from disk: original context §§41–53 and browser-editor research. Immediate objective: validate the complete newsroom workflow using coherent, realistic fixtures. This is a UI simulation, not production authentication, composition, preflight or archival storage. No implementation is authorized by this document alone.

## Foundation before screens

Recommend React/TypeScript/Vite, subject to the dependency adoption gate; framework choice remains a recommendation. Define routing, design tokens, accessible controls, application/public/editor shells, typography/spacing, status semantics, feature boundaries and mock service contracts first. Keep navigation state in routes, remote/domain state behind service interfaces, and ephemeral selection/tool/zoom state in editor-local state. Avoid a single global store for every page and do not bind views directly to fixture files.

Service interfaces cover identity/session, organizations/publications, editions, newsroom/source items, stories/assets/ads, generation jobs, document commands, preflight/export and archive, team/settings/billing. Each returns explicit data/error/loading behavior with stable scoped IDs and revision fields where meaningful. Use promise-based mock adapters; a scenario controller injects latency, failure, permission denial and stale revisions. Domain DTOs are intentionally limited to the UI; do not freeze the production ResolvedDocument schema through mocks. Later select one authoritative API/schema source and generate clients; avoid parallel hand-maintained backend/frontend definitions.

## Route and shell map

| Surface | Proposed route family | User's next action |
|---|---|---|
| Public site | `/`, `/features`, `/pricing`, `/security`, `/contact` | Understand product and enter demo/signup; no invented certifications or binding pricing |
| Authentication | `/login`, `/signup`, `/forgot-password`, `/verify` | Simulated session/recovery; never collect real credentials |
| Onboarding | `/onboarding` | Set organization/publication, language/region and initial defaults; incomplete press setup remains visible |
| Publication workspace | `/org/:orgId/pub/:pubId/overview` | Open today's edition or create one |
| Production | `.../editions`, `.../stories`, `.../media`, `.../ads`, `.../templates` | Manage fixture content and inspect readiness |
| Edition workspace | `.../editions/:editionId` with content/generate/editor/preflight/export children | Progress through one selected edition with clear status |
| Newsroom | `.../newsroom`, `.../sources`, `.../wires` | Inspect evidence/rights, select permitted content or visit source |
| Archive | `.../archive`, `.../archive/:releaseId` | Filter/preview, inspect release identity, create editable copy |
| Publication settings | `.../brand`, `.../print-profiles`, `.../team` | Review configuration and scoped roles |
| Organization administration | `/org/:orgId/settings`, `/org/:orgId/billing`, `/org/:orgId/storage` | Manage mock account/plan/storage; billing separate from publication role |

Route identifiers are illustrative; implement one consistent family. Direct links, back/forward, refresh, invalid IDs and organization switches must work. Unknown or unauthorized context shows a meaningful state without leaking another tenant's fixture records.

## Workflow behavior

Onboarding is progressive: identity, locale/cadence, brand/editorial defaults, draft production profile and sources. Required inputs for a draft workspace differ from a validated press setup. Dashboard displays publication-local date, recent/today's editions, readiness and next action; handle multiple regions and no edition today.

Create Edition records publication/date/region/pages/template/language/print profile in mock state. Newsroom distinguishes source observations and event groups from editable stories; discovery-only items cannot be imported as licensed full text. Content Desk shows selected stories/media/ads, missing credits/rights and reservations; readiness reports concrete missing inputs, not an uncalibrated percentage.

Generation demonstrates strategy choices and staged progress using a deterministic scenario. Cancellation/failure returns to recoverable content; success opens sample pages associated with the selected edition/revision. Label results as simulated; do not claim an actual layout score or actual shaped fit.

Editor demonstration includes page navigator, selectable frames, basic move/resize with undo, zoom/pan, lock indication, properties and a story-edit panel. Contextual AI displays fixture alternatives and acceptance diffs. Regeneration demonstrates selected scope/affected pages and preserved locks using predefined state transitions. Crop/style/link/overset/layer controls can be bounded demonstrations with explicit supported interactions; unsupported controls must explain their state. No real shaping, ICC conversion, PDF writing or advanced canvas architecture is required for this immediate milestone.

Preflight simulates grouped issues with jump-to-frame actions, blocking/warning/error/not-run statuses and revision binding. A subsequent edit invalidates a mock pass. Export shows the selected revision/profile and a labeled sample-result state; no press-ready production file is generated. Archive shows immutable sample release identity, previews and creation of a new editable copy. Team/settings/billing simulate permissions and entitlements without sending invitations or charging payments.

## Fixtures, persistence and accessibility

Use fictional licensed/owned sample material: two organizations, multiple publications and roles, Pune/Marathi and English examples, Hindi and Urdu/mixed-script examples, a representative 16-page edition, several prior releases, authorized and discovery-only source items, low-resolution/missing-credit assets, reserved ads and an invalid profile. Do not embed copied copyrighted news/photo/font assets. Fixture generation may be deterministic and resettable; counts must agree across screens.

Recommended mock persistence is a versioned local demo store containing fictional data only. Document reload/reset behavior and clear state on account/organization switching as appropriate. A demo banner plus task-level simulation labels prevent confusing local mock save with cloud persistence or mock pass with press validation. The banner need not expose engine/library names.

Management screens adapt to desktop/tablet/mobile; full composition is desktop-first. Tablet offers bounded editing/review and phone prioritizes review/status/archive. Use semantic controls, visible focus, keyboard navigation, accessible names, contrast and error association. Include IME-safe text inputs and RTL content; the production canvas accessibility/IME gate remains separate.

## Exit criteria and scope boundary

A reviewer can traverse landing → simulated signup/onboarding → dashboard → edition → newsroom → Content Desk → generation → editor → preflight → sample export → archive → team/settings/billing with consistent data. They can also exercise denied access, generation failure, stale preflight and immutable archive copy. UI/contract/E2E checks demonstrate these transitions and basic accessibility across target viewports. No live identity, payments, AI, crawling, uploads to cloud, production backend or publishing engines enter the initial backlog.
