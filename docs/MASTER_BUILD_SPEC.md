# Pageinator — Master Build Specification

Phase 21. Proposed engineering blueprint, 2026-09-16. This synthesizes the original product intent, persisted Phases 1–17, adversarial findings AR01–20, decision register and owner questions. It is not implementation approval or a claim that feasibility experiments passed. The original context remains protected raw input; its prototype/reuse instructions are superseded by the fresh-codebase instruction.

## 1. Authority and decision status

The [decision register](architecture/DECISION_REGISTER.md) is the single status authority. [Normalized requirements](architecture/PHASE_1_ANALYSIS.md) supply R01–48 traceability; the [review](reviews/ASTRA_ARCHITECTURE_REVIEW.md) records challenges and final consistency results. A master recommendation cannot silently promote a research candidate into an approved dependency.

| Status | Meaning here |
|---|---|
| LOCKED PRODUCT REQUIREMENTS | Newspaper production workflow, browser-first, eventual multilingual support, professional editing, press acceptance, exact archives; D01/D08/D11 |
| LOCKED ARCHITECTURAL INVARIANTS | D02–07/D09/D10/D12/D13: authority, geometry, revision/tenant/rights boundaries and development constraints |
| APPROVED/RECOMMENDED TECHNOLOGY DIRECTIONS | No external production technology is approved. OP11–14 and registry ADOPT/WRAP/BUY labels are conditional recommendations. |
| RESEARCH-DEPENDENT DECISIONS | RD01–12; four critical workstreams remain unproved |
| PRODUCT-OWNER-DEPENDENT DECISIONS | OP01–10 / PO01–10; five owner questions block particular production commitments, not this documentation or mock UI |
| DEFERRED DECISIONS | DF01–06, including offline/desktop, default CRDT, enterprise topology and expanded distribution/search |
| REJECTED APPROACHES | RJ01–07: AI physical authority, mutable export, unrestricted reuse, partial checker mislabeling, unlicensed SDK assumptions, custom commodity infrastructure and unsafe state mutation |

Current open totals: **4 critical unresolved decisions**, **12 research workstreams**, **5 blocking owner questions**. None is closed by this specification. Narrower pilot scope must be explicit, not a disguised deletion of eventual requirements.

## 2. Product and acceptance contract

Pageinator serves professional newspaper/media organizations through a connected production workflow: discover/import → select and prepare content → generate an editable edition → professionally edit in the browser → deterministically validate → inspect final PDF → approve/release → hand off to press → retain and retrieve the exact publication. The value hypothesis is reduced repetitive work and coordination without loss of editorial or physical correctness; customer economics and time savings remain unvalidated.

The initial customer segment, cadence, regions, language/font matrix and press partner are owner decisions. Daily roles include reporter, editor, designer, photo/ad/prepress staff; organization and billing administration are separate powers. Publication settings capture identity, timezone/cadence, geography, languages, brand, editorial policy and sources. A press-approved PrintProfile is separately versioned. A draft workspace may exist with incomplete print setup; it cannot be called production ready.

Ultimate acceptance is repeated real editions: newsroom prepares and edits them, required checks pass, the receiving press accepts the exact released PDF, a physical newspaper is inspected, and an earlier edition can be retrieved/reprinted under current rights. “The UI looks correct,” “PDF opens,” and “the checker passed” are each insufficient alone. Number of pilot cycles and measurable acceptance are agreed with the customer/press before the pilot.

Non-goals are a generic dashboard, unrestricted web republication, truth oracle, full InDesign clone, ad-sales CRM or automatic printing-press control. Manual press handoff is a valid pilot proposal. Real-time shared editing and permanent archive retention are not assumed.

## 3. System shape and domain ownership

Recommend one modular application/API with a relational transaction boundary, private object storage and isolated durable workers. Browser clients use scoped service contracts. Ingestion/media and publishing/preflight workloads can have separate process pools/runtime dependencies without premature microservices. Split deployments further only for measured scale, security or ownership needs.

| Domain owner | Canonical responsibility | Boundary |
|---|---|---|
| Access/organization | Identity link, Organization, Membership, publication grants | Mature identity provider authenticates; Pageinator authorizes business actions |
| Publication configuration | Publication, PublicationProfile, Brand, Sections, Template/Master versions | Editorial/brand settings are not validated press configuration |
| Content/assets/rights | Story/StoryRevision, originals/derivatives, captions/credits, RightsGrant | Asset technical metadata does not confer reuse permission |
| Discovery/intelligence | Connector ContentSource, SourceItem, public source identity, NewsEvent, evidence/ranking | Observation/event is not approved publishable story |
| Edition/document | Edition selection, ad reservations, EditableDocument, commands/revisions | Document revision is the initial consistency boundary |
| Publishing | Layout/composition/typography, ResolvedDocument, source checks | No autonomous editorial or release authority |
| Production/archive | ExportJob, PreflightResult, release approval, immutable package, restoration | Exact bytes and manifests are truth; search is rebuildable |
| Commercial/platform | Subscription/entitlements, Usage/StorageUsage, jobs, audit, observability | Payment status cannot grant content or release permission |

Organization is the tenant; publications are nested authorization scopes. Tenant-qualified references prevent attaching another organization's story, font, ad, asset or archive member. Sharing across publications is explicit. Public publisher identity may be global metadata; customer source items, licenses, clusters, embeddings, snippets and analyses remain scoped unless an independently approved sharing policy permits otherwise. Cross-tenant dedup must not disclose existence.

Recommend PostgreSQL transactions/constraints and carefully configured RLS, private S3-like object storage, and a single durable queue chosen with backend runtime. Python/FastAPI versus TypeScript remains open. Jobs use transactional outbox, stable operation IDs, immutable input references, at-least-once-safe handlers, bounded retries, leases/heartbeats, cancellation and visible terminal failures. Workers cannot overwrite newer results or inherit permanent user authority. No custom durable queue, identity platform or search cluster is needed initially.

## 4. Canonical document, editing and resolution

EditableDocument records intentions: stable page/frame IDs; page order/sections; content revision and asset references; styles/masters/templates; linked text frames; image placement; ad reservations; layers/guides; locks and explicit overrides. Physical dimensions are unit-tagged, never implicit CSS pixels. Numeric representation/scale remains RD05: micro-points are only one candidate; prove bounds, intermediate transform arithmetic and rounding against a physical error budget before schema freeze.

Stories remain separate editorial objects. Editing text for one edition creates an immutable edition-local StoryRevision with parent/source lineage and the edition placement references it. Geometry/style overrides cannot conceal an unversioned alternate story body. A newer source story revision offers a diff and explicit update, not a live mutation of placed content. AI acceptance follows the same revision path.

Resolution is an iterative constrained process: validate inputs → propose layout → analyze Unicode/font runs → shape and choose lines → compose columns/flows → evaluate constraints → bounded correction → immutable ResolvedDocument. Width/line-height interactions prevent assuming a one-pass pipeline. Hard ad/press constraints precede locks, explicit local overrides, template defaults and generated suggestions. Infeasibility is reported; no hidden text deletion or lock relaxation.

ResolvedDocument contains actual page/frame/line geometry, font instances/hashes, glyph IDs/positions and source mappings, clips/transforms/stacking, image derivative identities, colour/overprint/transparency intent, diagnostics and a dependency manifest. It is not a screenshot and cannot be reconstructed reliably from the browser DOM. Every browser proof and PDF writer consumes the same resolved physical scene without independent reflow. Screen antialiasing and display colour may differ; positions, text coverage and flow may not.

Shaping must respect script/language/direction, font features and variation axes. Unicode graphemes, shaping clusters, glyphs and caret positions differ. Candidate line breaking and final line shaping must account for inserted hyphens/joining context. Newspaper policy owns column balancing, keep/widow/orphan rules, continuation, headline fitting and allowed copyfit variables; it should reuse qualified paragraph primitives rather than assume all line algorithms must be built. Urdu/Nastaliq justification and vertical extents require native review. No arbitrary letter spacing, silent font substitution or outline-only workaround as a default.

Regeneration identifies scope and computes dependency closure through linked stories, masters and continuation/page references. Show expanded affected pages before acceptance. Proposals include base revision; stale results cannot silently apply. Full-edition generation remains a destination, initially constrained to explicitly supported templates/formats rather than unrestricted DTP.

Commands carry operation ID, base revision and scoped document context. Server establishes actor authority, validates references/constraints and commits atomically; retries return the existing operation result. Stale writes conflict. One completed drag is one semantic command; text transactions respect IME composition. Autosave shows pending versus durable acknowledgment. Undo creates a new command; restoration makes a new revision/copy. Lease-based coordination is recommended only if PO06 accepts it; revisions still prevent overwrite after lease expiry.

## 5. Browser editor and immediate UI boundary

Professional editor destination includes selection; text/image/frame/rectangle/line creation; move/resize/rotate/crop; align/distribute, duplicate/delete; guides/snapping; grouping/layers/locks; style properties; linked frames; overset/continuation; page virtualization; pan/zoom; undo/redo; clipboard and keyboard/accessibility equivalents. Destructive document commands preserve revision history and respect locks/authorization. Use a DOM shell/input layer and replaceable scene renderer. Vendor scene serialization and history are not the durable document authority.

Konva/Fabric are interaction candidates; CanvasKit and alternatives need positioned-glyph/resource tests. Do not mandate Konva plus CanvasKit: compare minimal options, avoid duplicate scene graphs and font stacks. Evaluate mature ProseMirror/Lexical input adapters before bespoke rich text/IME/history. Their semantic documents map to Pageinator story commands; they do not become print composers. A story-panel input fallback is acceptable while on-page caret mapping is qualified. Supported browsers/devices and latency budgets depend on RD06/PO08, not generic browser capability claims.

The immediate UI-first product is narrower: public site, simulated authentication/onboarding, publication dashboard, edition setup, newsroom/Content Desk, simulated generation, sample-page editor, simulated preflight/export, archive and team/settings/billing. Recommend React/TypeScript/Vite subject to adoption review. Build accessible tokens/components, route shells, explicit mock service DTOs and resettable scenario adapters before feature screens. Do not freeze production engine schemas through UI mocks.

Fixtures use fictional owned/licensed material, two organizations, multiple publications/roles, multilingual samples, rights-denied items, ads, invalid profiles and prior releases. The 16-page/79-story/47-photo/12-ad example is illustrative, not capacity/SLA. Counts and revision identity remain consistent across screens. Mock save, generation, AI suggestions, preflight and export are visibly labeled. No real credentials, network crawling, cloud uploads, payments, AI calls or press files. Local demo persistence is not an archive guarantee.

Desktop is the composition target; management surfaces are responsive and mobile prioritizes status/review/archive. Keyboard/focus, readable RTL/input and error states belong in UI-first. Production canvas accessibility, complex-script fitting and server parity are separate gates.

## 6. Newsroom, rights and AI

Sources → authorized fetch/import → normalization → rights/provenance → exact/near deduplication → reversible event grouping → source lineage/corrections → AI understanding → publication relevance/explainable news score → editorial selection. Check permitted access/storage before fetching, not only after extraction. SourceItem, NewsEvent and StoryRevision remain distinct. Copied wire reports do not count as independent corroboration; scores are not truth probabilities.

Start with owned content and contracted inputs. RSS parsers, CMS APIs, licensed wires, official/government sources and approved web extraction each need their own connector/entitlement policy. No assumed PTI/IANS API, blanket official-source license or paywall/CAPTCHA bypass. Store permitted provenance and source updates/kill notices. RightsGrant covers action, evidence/licensor, publication/territory, attribution, embargo, validity/revocation, retention and allowed AI processing; discover/store/display/edit/translate/print/archive/reprint are distinct.

news-please is **RESEARCH FURTHER**, potentially extraction-only WRAP on already policy-approved HTML. Its inspected master/package mismatch, broad Python dependencies, library/CLI fetch differences, unverified robots/retry paths and unmeasured Indian-language accuracy require RD07. Compare Trafilatura and direct newspaper4k; do not inherit news-please storage/daemon architecture. Scrapy/feedparser/datasketch are conditional reuse candidates. Isolate any authorized browser fetching and avoid nested uncontrolled process pools. Exact version/licensing/security/performance remain adoption gates.

AI tasks run behind small Pageinator-owned schemas and provider adapters. Route by evaluated task/language/sensitivity; start one qualified provider, not a multi-agent platform. Track source hashes, prompt/model/schema versions, usage, retries, review and accepted bytes. Bound cost/time/concurrency; cache by tenant and all material versions/rights. Validate structure and IDs, then require human editorial acceptance and deterministic command validation. Retrieved text cannot provide executable instructions or tool authority. Approved provider data terms, language evaluations and processing rights precede live use.

Never delegate solely to an LLM shaping, geometry, line/overflow checks, image resolution, colour conversion, fonts/embedding, PDF structure/preflight, permissions, rights, release, billing arithmetic or archive integrity. AI failure leaves manual editing and retrieval available; it never fabricates a preflight pass.

## 7. Assets, colour, PDF and preflight

Preserve original bytes by hash after scoped upload/quarantine. Orientation, crop, focal point and placement are non-destructive transforms. Derivatives are versioned by source/transform/profile/tool identity; thumbnail and print outputs are distinct. Effective PPI derives from usable pixels and physical placement, not EXIF labels; upsampling cannot restore detail. Captions/credits/rights are first-class. Untrusted EXIF/ICC/fonts/PDF/SVG require bounded parsers, sandboxing and stripped unnecessary preview metadata.

libvips/LittleCMS are recommended wrappers, not selected builds. Missing profiles require an explicit interpretation policy. Assigning a profile differs from conversion. Press-approved policy covers ICC output condition, CMYK/RGB/spot usage, total ink, black/overprint, transparency, page boxes, marks, page order and effective resolution. Screen soft proof is not a contract-colour proof. Imported vector ads need a tested preserve/import path; rasterizing everything is not an automatic safe solution.

Writer consumes resolved glyph positions, transforms, assets and print intent. Compare PoDoFo-supported route with a commercial writer such as PDFlib on the same corpus; iText/Ghostscript/Antenna House remain qualified alternatives/reference routes, not a requirement to install all. Font subset encoding and logical text mapping must survive ligatures and RTL. Exact PDF/X variant/version is press-specific; PDF/X-4 is a candidate, not a universal CMYK-only target. qpdf helps structure; veraPDF's PDF/A/UA scope does not qualify it for PDF/X.

Use HYBRID preflight: Pageinator owns content coverage, overset, geometry/ad/rights/revision rules and fix-to-location UX; evaluate callas pdfToolbox and Enfocus PitStop for final-byte professional checks. Results include rule/version, source, severity, pass/fail/not-run/error, location, measurements, revision/profile/PDF digest and tool identity. Keep raw vendor evidence. Engine timeout/unavailability/expired license/malformed report is a failure, not green. Mandatory defects cannot be waived. Approved fixups make new bytes and require new proof, validation and approval.

## 8. Release, archive and reproducibility protocol

Candidate lifecycle: REQUESTED → SNAPSHOT_PINNED → RESOLVED → PDF_CREATED → VALIDATED → APPROVED → ARCHIVE_COMMITTED → RELEASED. Failures/cancellation are explicit. Edition editing remains independent; revision N+1 cannot silently replace N. Press delivery/RIP acceptance/physical-print confirmation are later separately recorded facts.

Pin editable/resolved identities, all dependencies, profile and tooling. Generate private candidate bytes; hash them; run source and final-file checks; bind approval to exact revision/profile/PDF/report. Stage package objects and verify hashes/required replication; then transactionally commit immutable manifest and release identity. Final transaction rechecks current grant/approval versions and time validity with concurrency protection equivalent to serializing against revocation. A pre-staging authorization check alone is insufficient. No customer print download before archive commitment. Outbox/reconciliation handle retries and incomplete objects; protect staged objects used by live jobs/holds.

Later rights or membership revocation restricts further delivery/reprinting without changing historical bytes; already delivered files cannot be recalled by the system. Press receipts are append-only linked records, not edits to the archived manifest. Retrying handoff does not create another published identity unless explicitly requested.

Edition Package includes editable and resolved snapshots/schema, exact print PDF, labeled proofs/thumbnails, pinned stories/assets/ads, templates/brand/publication/print profiles, licensed font dependencies or recoverable references, engine/dependency manifests, rights/approval/preflight evidence and hash inventory. Content-addressing may save storage only if tenant access and dependency retention remain correct.

Three promises are separate: exact-byte retrieval under access policy; permission to reprint now; editable restoration into a new working copy with recoverable licensed dependencies. New-engine recomposition may differ and does not overwrite the historical output. Byte-identical rerun is not promised. Restore tests include lost DB/index/keys, missing dependencies and corrupted package members. Retention/holds/restrictions/deletion/backup expiry are explicit; immutable does not mean unconditional eternal retention. PO05/RD04 precede WORM selection and contracts.

## 9. Security and operations

Identity, tenant context and capabilities are checked at API, DB, queue, object, cache, search, AI and release boundaries. Recommend non-owner/non-superuser/non-BYPASSRLS app roles with transaction-local tenant context and pooled-connection tests. Private signed URLs are expiring bearer capabilities; use an enforceable authenticated gateway if immediate revocation is required. Package members, snippets and counts are authorized, not merely top-level records.

Separate billing/admin/support/editorial/release powers; platform support is audited/time-limited and never silent impersonation. Approved OIDC/session security handles recovery/MFA; protect sessions, invitations and webhooks. Secrets stay out of bundles/prompts/logs. External URLs require scheme/address/redirect/DNS and egress controls; parsers get CPU/memory/disk/pixel/time limits and no general secrets/network. Rights/authorization are rechecked at externally visible job completion.

Use separate environments, independent backup failure boundaries, recoverable keys and inventory reconciliation. Audit edits, grants/profile changes, AI acceptance, release, archive access/destruction without retaining unnecessary unpublished content in logs. Telemetry correlates jobs and measures queue age, resolve/export latency, failures, resources and cost; no high-cardinality story payload logging. Quotas protect neighbors without destroying drafts or silently deleting releases. Actual workload/RPO/RTO/SLO promises await PO08/RD12.

## 10. Technology selection and IP

The [candidate registry](research/DEPENDENCY_CANDIDATES.md) evaluates capabilities, licenses, runtime/WASM possibilities, operational/replacement risks and primary evidence. ADOPT means use a mature implementation if its exact-version gate passes; WRAP preserves replaceable domain adapters; BUY requires vendor terms; REFERENCE is not code incorporation; BUILD is restricted to justified Pageinator policy; RESEARCH/REJECT retain stated limitations.

Pageinator controls document/revision schemas, newspaper constraints/objectives, templates and editing commands, provenance/approval semantics, preflight UX and archive protocol. Mature identity, database, storage, queues, shaping, Unicode, image/ICC, PDF and payment implementations supply commodity capabilities. A native subprocess or wrapper is not a legal exemption. Fonts, dictionaries, model weights, codecs and browser-distributed WASM require separate exact rights/notices. Record support/security provenance, measured fitness and replacement plan before adoption.

## 11. Verification, delivery and gates

Future feature workflow: intent → master → one bounded feature spec → one feature branch → fresh targeted agent session → implementation → automated evidence → independent AI review → human review → authorized commit/merge. Proposed repository areas are frontend/backend/workers/publishing/schemas/tests/specs/docs/infra; create only when needed. No scaffolding or agent-guidance files are created by this program.

UI tests validate coherent fixtures, navigation, permissions simulation, accessibility and stale/failure paths only. Production tests add contracts/authorization/tenant isolation; schema/property/fuzz; licensed native-reviewed typography/layout goldens; independent PDF render/structure/preflight; revision/hash/race/crash; migrations/restore; security/performance and physical press. Do not refresh a golden simply to make an engine upgrade pass. Pixel similarity cannot excuse missing source text or changed glyph geometry.

Execution gates are G0 documentation/decision readiness, G1 honest UI simulation, G2 safe real-data platform, G3 qualified thin publishing integration, G4 release/archive recovery, G5 operational/security hardening, G6 repeated real-press acceptance and G7 customer/paid-pilot acceptance. The [roadmap](IMPLEMENTATION_ROADMAP.md) defines dependencies and evidence. G0 is documentation completeness, not closure of RD01–12. Begin a separately authorized thin engine research track early enough to prevent the UI from becoming a substitute for feasibility; keep that track out of the immediate [UI backlog](../specs/INITIAL_IMPLEMENTATION_BACKLOG.md).

## 12. Requirement-to-design traceability

All normalized requirement families are accounted for; classification remains in Phase 1 rather than silently upgrading business assumptions.

| Requirements | Master responsibility / downstream acceptance |
|---|---|
| R01–03 | §§1–2 product/browser/business boundaries; G1/G7, PO01/09 |
| R04–05 | §§1/10/11 fresh codebase and reuse/IP; dependency gate/G0 |
| R06–10 | §§2/3/9 identity/onboarding/publication configuration; G1/G2, PO07 |
| R11–14 | §§2/4/5 navigation, edition/content and editable generation; G1/G3 |
| R15–18 | §§4/6 AI boundary, resolved geometry, typography/languages; G3, RD01/02 |
| R19–22 | §§4/5 editor, flow/styles, scoped regeneration, contextual AI; G1/G3 |
| R23–26 | §7 originals/colour/PDF/preflight; G3/G6, RD03 |
| R27–29 | §8 archive/package/retention; G4, PO05/RD04 |
| R30–33 | §6 source ingestion/rights/events/AI; G2/G3, RD07/08/09 |
| R34–37 | §§3/4/8/9 tenancy/revisions/exact export/contracts; G2/G4 |
| R38–40 | §5 UI foundation/public workflow/responsiveness; G1 |
| R41–43 | §§3/9/11 modular architecture/environments/verification; G2/G5/G6 |
| R44–45 | §§7/8/10 editable/proof/print outputs and conditional technologies; G3/G4 |
| R46–48 | §§1/2/5 UI priority, commercial assumptions and deferred expansion; G1/G7, PO09/11 |

Review corrections incorporated: AR05 numeric scale remains open; AR06 edition-local story lineage explicit; AR07 release/revocation race contract; AR08 commodity text/composition reuse; AR09 no mandatory dual scene stack; AR11 early feasibility track; AR14 tenant-private intelligence; AR17 append-only press receipts. Remaining findings map to RD/PO gates, not implied approvals. Highest-risk area remains the coupled multilingual composition → shared browser/PDF geometry → professional preflight → physical press path.

End of proposed Master Build Specification. No implementation performed.
