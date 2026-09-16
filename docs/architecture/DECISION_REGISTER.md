# Decision register — Phase 19

Prepared 2026-09-16 from persisted Phases 1–17 and the [adversarial review](../reviews/ASTRA_ARCHITECTURE_REVIEW.md). This register owns status; research documents own detailed evidence. DECIDED means an explicit product instruction or a necessary invariant supported by that instruction, not a technology purchase. OPEN includes recommendations awaiting approval/input. No package/version/vendor is approved for production by this document.

## DECIDED — locked requirements and architectural invariants

| ID | Decision | Reason / evidence | Impact / required from |
|---|---|---|---|
| D01 | Browser-first newspaper production OS, not generic SaaS or general DTP clone | User program; Phase 1 R01/R03/R19 | End-to-end workflow and desktop composition; all product work |
| D02 | Human editorial acceptance; deterministic physical publishing authority | Explicit AI boundary; R15–17; Phase 13 | AI proposals cannot bypass constraints/preflight; every feature |
| D03 | Editable intentions and immutable resolved geometry are distinct; preview/PDF consume same geometry | Explicit invariant; Phase 3; AR01 | No independent browser/export reflow; engine contract |
| D04 | Organization tenant with publication-scoped authorization across every data path | R06/R07/R34; Phase 12 | IDs alone grant no access; before any real customer data |
| D05 | Export exact immutable edited revision; bind final bytes, report, profile and approval | R28/R36; Phases 6/11; AR07 | New edit/fixup requires new candidate; production release |
| D06 | Preserve originals and immutable released package; exact reprint retrieves archived bytes | R23/R27/R28; Phase 11 | Editable restoration is a new copy, not promised byte-identical rerun; storage design |
| D07 | Scraping/access is not republication permission; record provenance and purpose-specific rights | R30/R31; news research | Unknown permission means discovery-only, subject also to display/storage rights; ingestion onward |
| D08 | English, Hindi, Marathi/Devanagari, Urdu and mixed-script support remain eventual requirements | R18; explicit program | Pilot sequence open, tested font/language matrix required; model design onward |
| D09 | Own newspaper semantics/policies; evaluate mature commodity reuse | R05; dependency registry | No custom identity/queue/shaper/ICC engine by default; all technology selection |
| D10 | Immediate build is a labeled UI simulation with coherent fixtures and service boundaries | R38/R39/R46; Phase 15 | No live publishing/backend/AI/payment capability in initial backlog |
| D11 | Passing UI tests does not certify publishing; real press/physical print and restore required | R43; Phase 14 | Separate UI and production gates; customer pilot |
| D12 | Fresh codebase; protected context/README; documentation-only program | Latest user instructions supersede old prototype claims | No migration, implementation, installs, commits or agent-guidance files now |
| D13 | One coherent feature, spec, branch and fresh agent session with targeted context | Explicit program; Phase 16 | Future implementation/review workflow; no default repository-wide scan |

## OPEN — owner choices and current recommendations

| ID | Question / recommendation | Reason / evidence | Impact / when required |
|---|---|---|---|
| OP01 | Initial customer segment and bounded pilot daily workflow (PO01) | Phase 1; K22 | Sets production scope before pilot requirements freeze |
| OP02 | Pilot language order, approved fonts and reviewers (PO02) | Phase 5; AR02 | Determines first supported corpus before engine qualification |
| OP03 | First press/profile, handoff and imposition responsibility (PO03) | Phase 6; AR03 | Determines output contract before writer qualification |
| OP04 | Willingness/budget for commercial writer/preflight licenses (PO04) | Phase 7; AR03/K08 | Changes feasible delivery strategy before procurement |
| OP05 | Retention, editable recovery, termination and reprint promise (PO05) | Phase 11; AR04 | Drives rights/storage economics before archive contracts |
| OP06 | Multi-user coordination needed at pilot (PO06) | AR12; Phase 11 | Lease vs finer concurrent editing before production editor design |
| OP07 | Confidentiality, customer jurisdictions/residency constraints (PO07) | Phase 12; AR15 | Narrow grants and provider/deployment constraints before real data |
| OP08 | Deadline, peak workload, supported hardware/network, recovery needs (PO08) | Phase 14; AR13 | Sets measurable SLOs/capacity before production sizing |
| OP09 | Paying buyer, packaging and account closure/access policy (PO09) | R02/R29/R47; AR19 | Unit economics and entitlements before paid pilot |
| OP10 | Authorized initial source/feed/CMS/wire contracts (PO10) | News research; D07 | Connector and storage/AI rights before live ingestion |
| OP11 | RECOMMENDED modular monolith, relational transactions plus isolated durable workers | Phase 2; low initial operational complexity | Strong default, formal ADR before backend foundation; split only measured boundaries |
| OP12 | RECOMMENDED React/TypeScript/Vite UI, PostgreSQL plus private object storage | Phase 2; DEP05/06/52–54 | Exact versions/providers and adoption checks required before respective implementation |
| OP13 | TENTATIVE backend/runtime/queue: Python/FastAPI or TypeScript; choose one job stack | Phase 2; DEP07–10/55 | Team fit, measured workload and operations determine backend foundation |
| OP14 | RECOMMENDED server-authoritative resolution, hybrid browser editing | Phases 3–5; AR09 | Conditional on RD01/02/06 latency/parity; no engine language locked |

## RESEARCH REQUIRED — 12 unresolved workstreams

These are consolidated decision workstreams, not claims that there are only 12 unanswered implementation details. Critical unresolved decisions = the four rows marked CRITICAL. Each includes an exit deliverable; documentation alone cannot close one.

| ID | Severity | Decision / question and evidence | Required evidence / impact | When / accountable role |
|---|---|---|---|---|
| RD01 | CRITICAL | Which composition/renderer/PDF writer combination preserves shared resolved geometry? Phases 3/5/6; AR01/08 | Compare reusable paragraph layers and at least an open-source and commercial writer route on same corpus; explicit glyph/subset/Unicode, clipping, image/colour and independent rendering proof. Choose adapter/engine only from results. | Before broad publishing engine/schema freeze / publishing lead |
| RD02 | CRITICAL | Which fonts/rules/input paths qualify multilingual output? Phase 5; AR02 | Licensed font/language corpus, native-reader approval, line-end/bidi/Nastaliq/IME goldens and required embedding/browser/archive permissions. | Before language support claim / typography lead with product/legal |
| RD03 | CRITICAL | Which press target, colour policy and final preflight engine are viable? Phases 6–8; AR03 | Press-approved exact standard/profile, image/ICC/black/spot/transparency tests, callas/Enfocus trial/quote/platform/OEM terms, fail-closed automation and physical output. | Before production output freeze / prepress lead |
| RD04 | CRITICAL | Can contracted archive/recovery guarantees actually be met? Phase 11; AR04 | Rights-aware dependency inventory, retention/hold/deletion and key-recovery design, exact-byte retrieval and editable-copy disaster recovery drill; PO05 prerequisite. | Before archive promise/production release / operations and legal |
| RD05 | HIGH | Numeric precision, text/revision schema, linked-flow and layout policy viability | Phase 3; AR05/06/12 | Physical error/range analysis including intermediates; schema property tests, story lineage, infeasible/lock/regeneration corpus; compare bounded heuristics before solver. | Before durable document schema/editor integration / engine lead |
| RD06 | HIGH | Browser input/interaction/renderer selection and supported platforms | Phase 4; AR08/09 | Compare minimal hybrid options plus mature text input adapters; IME/RTL/keyboard/accessibility, hit-test fidelity, page virtualization/resource benchmarks on pilot devices. | Before professional editor technology commitment / frontend lead |
| RD07 | HIGH | Ingestion, news-please and multilingual news indexing quality | Phase 9; DEP38–45; AR16 | Exact news-please artifact/deps; approved-source extraction comparison with Trafilatura/newspaper4k; robots/retry/JS/SSRF tests; dedup lineage, multilingual retrieval and source entitlement evaluation. Keep news-please RESEARCH FURTHER until then. | Before live source rollout / ingestion lead |
| RD08 | HIGH | AI provider/task/language quality and data-processing fit | Phase 13; AR18 | Qualified provider terms, licensed eval corpus and prespecified fidelity/latency/cost thresholds; injection/stale-proposal/failure tests. | Before live AI / AI lead |
| RD09 | HIGH | Tenancy, release races and external-input isolation mechanisms | Phase 12; AR07/14/15 | OIDC/provider selection, capability matrix, RLS/pool/queue/blob/index negative tests, transactional revocation checks, SSRF and hostile parser controls. | Before real data and rechecked before release / security lead |
| RD10 | HIGH | Exact dependency licensing, maintenance/security and replacement fit | Registry; AR10/20 | Versioned SBOM/notices, transitive/runtime/browser distribution review, advisories, support provenance, tests and exit strategy for every selected dependency. | Before adoption and each material upgrade / engineering/legal |
| RD11 | HIGH | Payment eligibility, usage accounting and per-edition economics | DEP48–51; AR19 | Provider eligibility/terms, idempotent billing/reconciliation tests, cost model including workers/preflight/AI/storage/egress/support; PO09 prerequisite. | Before paid operations / commercial lead |
| RD12 | HIGH | Capacity, fairness, recovery and deadline operating model | Phase 14; AR13; K21/K24 | Agreed SLOs then end-to-end concurrency/resource/cost measurements, failure drills and recovery evidence on representative hardware. | Before press/customer pilot / operations lead |

## DEFERRED

| ID | Decision / capability | Reason / evidence | Impact / revisit trigger |
|---|---|---|---|
| DF01 | Offline/desktop/native wrapper and SQLite | R48; DEP57 | Browser-first pilot; revisit confirmed disconnected workflow (PO11) |
| DF02 | CRDT/live simultaneous editing as a default | Phase 11; AR12 | Do not assume need or rule it out; revisit PO06 before production editor |
| DF03 | Dedicated tenant deployments, service mesh, multi-region active-active, microservices | Phase 2 | Operational complexity without measured need; revisit contractual isolation or load evidence |
| DF04 | Vector/semantic archive search and standalone search cluster | R48; DEP45 | Start authorized metadata/text retrieval; revisit measured multilingual query gaps |
| DF05 | E-paper, external publishing API, automatic press control, ad-sales CRM | Phase 1 scope limits | No silent expansion; revisit separately approved product demand |
| DF06 | Sophisticated analytics/replay, multiple AI providers, custom model training | Phase 13; DEP47/50/51 | Privacy/cost/complexity; revisit a measured use case with rights |

## REJECTED

| ID | Approach | Reason / evidence | Impact / when |
|---|---|---|---|
| RJ01 | AI, screenshots or browser print as final physical authority | D02/03/11; Phases 3/6 | Cannot bypass deterministic release gates; always |
| RJ02 | Export by rerunning original generation or using mutable “latest” pointers | D05; Phase 11 | Loses manual edits/approval identity; export design |
| RJ03 | Scrape-anything/reuse-anything; blanket government/public-web permission | D07; news research | Rights are independent and purpose-specific; ingestion |
| RJ04 | qpdf or veraPDF alone as comprehensive PDF/X press preflight | Phases 6/7; DEP27/36 | Structural/PDF-A-UA capabilities do not establish required PDF/X coverage; output selection |
| RJ05 | tldraw as an assumed permissive SDK; proprietary fork of desktop DTP as default | DEP17/33; Phase 4 | Exact commercial/copyleft fit unproved; editor selection |
| RJ06 | Custom identity, durable queue, Unicode shaper or ICC engine without demonstrated gap | D09; registry | Reuse mature commodity capability; architecture |
| RJ07 | Silent last-write-wins, waived mandatory preflight, archive overwrite, cross-tenant reuse by hash | D04–07; Phases 11–13 | Violates safety and edition identity; always |

## Status maintenance

For each future closure record evidence artifact, tested versions/corpus, responsible approver, date and any limits. Owner answers update OP/PO records; research outcomes update RD records; avoid copying divergent statuses into each feature spec. A selected technology gets an ADR, not a retroactive claim that the original context approved it. Current totals: 4 critical unresolved decisions; 12 unresolved research workstreams. Blocking owner questions are counted only in PRODUCT_OWNER_QUESTIONS.md.
