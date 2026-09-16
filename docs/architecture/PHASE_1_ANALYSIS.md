# Phase 1 — Product and requirements normalization

Status: proposed architecture program; product requirements distinguished from implementation choices. Prepared 2026-09-15. Source: [original context](../context/ORIGINAL_PRODUCT_CONTEXT.md), read completely, and the current architecture-program instructions. The current instructions supersede the context's claims of existing C++/web implementation, prototype audit, baseline freeze/tag and immediate implementation. This is a fresh codebase; there is nothing to migrate. The abandoned critique is not evidence.

## Product definition and value

Pageinator is a browser-first newspaper production operating system for professional media organizations. It joins discovery and licensed import, editorial selection, automated pagination, professional manual editing, deterministic publishing validation, press output and recoverable archives. Its value is reduced repetitive pagination and coordination work without sacrificing editorial authority, multilingual quality or press acceptance. Time savings, adoption and willingness to pay remain business hypotheses requiring customer evidence.

It is a production workflow product with a distinctive document/composition model. It is not a generic SaaS dashboard, unrestricted scraping/republication service, truth oracle, general-purpose InDesign replacement, desktop-first DTP fork or an LLM entrusted with physical correctness. The clickable UI is a learning milestone, not a sellable press engine.

Customers are newspaper companies, regional/local dailies and weeklies, and publication groups. The initial segment, languages, circulation/edition complexity and first press partner are not selected. Buyers likely include owners and production leadership; this is an assumption. Daily users include editors, subeditors, reporters, page designers, photo editors, advertising and prepress staff. Organization administrators and billing operators have separate authority.

## Workflow and acceptance

One identity joins organizations through membership; organizations own publications and publications produce dated regional editions. Onboarding progressively captures identity, geography, languages, brand, editorial rules, sources and production requirements. Missing press specifications can permit a draft workspace but must block a production-ready claim.

The daily path is login → edition selection/creation → discovery/import → Content Desk selection and rights checks → generation → manual editing → source-model checks → candidate PDF → final-file preflight → authorized release → press handoff → immutable archive. Human acceptance of suggestions and approval to release are explicit. Editing after approval invalidates the approval and creates a new candidate. A failed job cannot erase the last saved edition.

Ultimate acceptance requires a real organization to repeatedly assemble and edit an edition, release a press-accepted PDF, physically print it, retain the exact released bytes and later retrieve/reprint them. Reopening creates a new editable revision; it does not modify the published package. The example 16 pages/79 stories/47 photos/12 ads is a useful fixture, not an established capacity ceiling or service-level promise.

## Classification vocabulary

Each row records a significant requirement family; categories can coexist when a strong requirement contains an undecided implementation. A = NON-NEGOTIABLE PRODUCT REQUIREMENT; B = CONFIRMED ARCHITECTURAL INVARIANT; C = CURRENT PRODUCT PRIORITY; D = PROPOSED TECHNOLOGY / CANDIDATE; E = LONG-TERM FEATURE; F = BUSINESS ASSUMPTION; G = REQUIRES RESEARCH; H = REQUIRES PRODUCT DECISION; I = REQUIRES TECHNICAL DECISION. Context section numbers provide source coverage.

| ID | Requirement / input | Category | Interpretation / decision boundary | Context §§ |
|---|---|---|---|---|
| R01 | Newspaper/media B2B production OS | A | Preserve connected newsroom-to-press workflow | 1–2,59–60 |
| R02 | Subscription business, paid organizational access | F,H | Commercial direction; packaging, buyer and price unvalidated | 3,30 |
| R03 | Browser-first application | A,B | Desktop editor primary; desktop/offline product deferred | 4,50 |
| R04 | Existing prototype/C++ reuse and freeze | D | Superseded by explicit fresh-codebase instruction; no audit/migration work | 5,56,62 |
| R05 | Reuse commodity infrastructure; own newspaper policies | B | Evaluate and wrap candidates; no blanket adoption | 6–9 |
| R06 | User → membership → organization → publication → edition | A,B | One identity, scoped access; organizational sharing policy open | 10–12,39 |
| R07 | Role-based access, distinct editorial/ad/billing authority | A,B,H | Named roles are examples; permission matrix needs workflow agreement | 11,61 |
| R08 | Signup, verification, onboarding | A,C | Simulated initially; real identity later | 12–13,45 |
| R09 | Google/Microsoft authentication | D,H | Optional providers, not mandatory launch integrations | 12 |
| R10 | Publication Profile: identity, cadence, regions, languages, brand, editorial, production, sources | A,B | Version configuration; separate printer-validated production profile | 13 |
| R11 | Overview, production, newsroom, archive, publication/admin navigation | A,C | Task-oriented navigation; availability depends on role | 14,47 |
| R12 | Edition date/region/pages/template/language/print profile | A,C | Date belongs to publication timezone; multi-centre variants need decisions | 15 |
| R13 | Stories, media, ads, reservations and content readiness | A,C,H | Readiness must explain missing constraints; no unsupported percentage | 16,48 |
| R14 | Editable automatic whole-edition generation | A,G,I | Core destination; constrained supported formats before unrestricted generation | 17 |
| R15 | AI semantic suggestions; deterministic physical authority | A,B | Human semantic approval does not override blocking physical defects | 18,22,38 |
| R16 | EditableDocument and ResolvedDocument; shared output geometry | B,G | Locked contract; exact engine/runtime and preview implementation unproved | 19,41 |
| R17 | Real typography, glyph positioning and line breaking | A,B,G | No word-count approximation for production | 20 |
| R18 | English, Hindi, Marathi/Devanagari, Urdu and mixed scripts | A,G,H | Eventual support required; pilot order and font families open | 20,61 |
| R19 | Professional editor tools and geometric operations | A,C,G | UI demonstrates selected interactions; production capability needs benchmark | 21 |
| R20 | Styles, masters, linked frames, overset, continuation, layers | A,G,I | Newspaper-specific semantics, not arbitrary DTP feature parity | 21 |
| R21 | Edition/page/region/headline/story regeneration with locks | A,B,G | Preserve overrides; linked-flow dependencies may expand recomposition | 21–22 |
| R22 | Contextual AI rather than chatbot-only workflow | A,C | Suggestion diffs, approval and clear failure states | 22 |
| R23 | Original image preservation, derivatives, crop, credit, effective DPI | A,B | Non-destructive pipeline and immutable originals | 23 |
| R24 | Publication-specific colour/print profiles | A,B,G | ICC, black, spot/transparency and resolution policy require press inputs | 24–25 |
| R25 | Press-ready PDF, embedding, page boxes and output intent | A,B,G | PDF/X-4 candidate default; target negotiated with each press | 25,55 |
| R26 | Blocking preflight before production release | A,B,G | Source checks plus final-file checks; professional engine evaluation | 26,49 |
| R27 | Cloud archive, search, preview, download, copy/reopen/reprint | A,C | Search begins with dates/metadata, richer search later | 27–31 |
| R28 | Complete edition package and immutable published revisions | A,B | Exact files and dependencies retained; WORM choice separate | 28–29,40–41 |
| R29 | Archive tiers, permanent retention, legal hold, quotas | E,F,H,G | Economics and contracts precede promises; deletion conflict explicit | 30 |
| R30 | Unified feed: wires, APIs, CMS, official sources, RSS, approved websites | A,G,H | Connector scope and contracts per customer; no blanket source entitlement | 32–34 |
| R31 | Independent rights/provenance/attribution model | A,B | Unknown rights default discovery-only; permission varies by use | 33,61 |
| R32 | Deduplication, events, evidence signals, relevance/ranking | A,G,I | Avoid treating copied reports as independent corroboration | 34–38 |
| R33 | AI multilingual enrichment and photo recommendations | A,G,H | Human editorial authority, measurable language-specific quality | 38 |
| R34 | Tenant-owned domain data and scoped assets | A,B | Tenant isolation before real persistence/integrations | 39,61 |
| R35 | Autosave, undo/redo, revisions and restoration | A,B,I | Transactional edits, saved acknowledgements and conflict handling | 40 |
| R36 | Export immutable exact edited revision | B | Never rerun original generation to export | 41 |
| R37 | Generated API contracts | I,D | Prefer single contract source when backend chosen; mocks use explicit DTOs | 42 |
| R38 | Feature boundaries, reusable design system, routing and realistic mocks | C,I | Directory names and React architecture are recommendations | 43–45,57–58,62 |
| R39 | Public pages, auth, full clickable workflow | C | Pricing/security claims must be truthful and provisional | 46–49,62 |
| R40 | Responsive management; desktop composition; mobile review | A,C | Supported browser/device matrix research still needed | 50 |
| R41 | Modular monolith plus heavy-job workers | I | Strong recommendation; no premature microservices | 51 |
| R42 | Isolated local/staging/production and automated CI | B,D | GitHub Actions is candidate; no setup in this program | 52–53 |
| R43 | Golden/fuzz/security/recovery/real-press verification | A,B | UI tests cannot certify print readiness | 54,60 |
| R44 | Editable format, print PDF, proof PDF/page images | A | Web/e-paper, export packages, printer-specific extras deferred | 55 |
| R45 | React/TS/Vite/FastAPI/PostgreSQL/C++/WASM/Konva and named engine libraries | D,G,I | Evaluate independently; no inherited technology approval | 5,8,39,42,51 |
| R46 | Workflow visibility before production backend | C | Immediate backlog contains simulations, not production engines | 44–45,57,62 |
| R47 | Time reduction, broad adoption, paid archive/AI/export upsells | F,H | Measure value and unit economics before committing packaging | 2–3,30 |
| R48 | Desktop/offline/native wrappers; semantic archive and enterprise/API extras | E,H | Preserve extension points without implementing speculative systems | 3–4,30–31,55 |

All 62 context sections are mapped above; §§58–61 also constrain every workflow and acceptance decision. Technology candidates are normalized in the later dependency registry, not approved here.

## Product modules and scope pressure

The durable capabilities are organization/publication administration, editorial content and rights, discovery/intelligence, edition planning, document composition, professional editing, production/preflight, archival and commercial operations. These are capabilities, not a mandate for separate services.

Do not equate a Publication Profile with an opaque AI memory: explicit, versioned rules must remain inspectable. Do not equate a high news score with truth. Do not infer an entire ad-sales CRM from advertisement placement. Do not infer direct printing-press automation from sending a press file; manual handoff is a valid pilot path. Real-time simultaneous editing, offline support and cross-customer content sharing are unconfirmed.

## Browser-first and commercial implications

Browsers enable shared workspaces and deployment simplicity but bring IME, memory, font licensing, input latency, colour-display and network constraints. Server-authoritative resolution with browser interaction is a credible starting hypothesis. Local/WASM resolution may improve responsiveness after parity is demonstrated.

Billing candidates include seats, publications, usage and storage, but charging for essential correctness must not permit bypassing validation. Expired subscriptions and storage limits need an agreed archive access/retention policy. Initial customer, pilot languages/fonts/press, rights-bearing inputs, acceptable collaboration model and professional-engine budget materially affect the architecture; these remain visible through the decision and owner-question registers.
