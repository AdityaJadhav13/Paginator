# Dependency candidate registry — Phase 10

Research date: 2026-09-15. Inputs: all six preceding research artifacts and Phases 1–3, read from disk. This is a candidate registry, not a lockfile or approved procurement list. ADOPT/WRAP/BUY describe intended reuse conditional on the adoption gate. RESEARCH is unresolved, REFERENCE permits study rather than source incorporation, BUILD identifies Pageinator-owned policy, REJECT rejects the stated use rather than every use of a project.

## Evaluation rules and evidence limits

All external candidates below have a primary project/vendor/license source or a linked research artifact containing those sources. Exact package versions, transitive dependency resolution, security advisory scans, commercial quotes and local performance benchmarks were not produced: no dependencies were installed. Do not mistake accessible documentation, stars, a repository badge or a vendor feature claim for production qualification.

Commercial status codes: **P** = permissive candidate with notices and exact dependency review pending; **C** = conditional copyleft/commercial route requiring compliance design; **V** = vendor contract/eligibility required; **U** = unverified exact terms. Transitive risk L/M/H is provisional and names the principal reason. Runtime columns record browser/server/WASM separately. “Possible” is feasibility to investigate, not an existing supported build. Operational assessments are engineering judgments; maintenance observations identify the evidence level.

The two matrices form one record per ID. No record is complete without both rows. Repeated source links are intentionally avoided by referring to detailed research for engine candidates.

## Capability, purpose, licensing and recommendation

| ID | Capability; candidate; project/vendor | Classification / purpose and recommendation | License; commercial status; transitive risk | Evidence |
|---|---|---|---|---|
| DEP01 | Authentication; Keycloak; Keycloak project | WRAP OIDC provider if self-hosting justified; do not build passwords/MFA | Apache-2.0; P; M Java/extensions | [Project](https://github.com/keycloak/keycloak) |
| DEP02 | Authentication; Auth0; Okta | BUY alternative to DEP01, compare B2B plan/cost/region/export | Proprietary service; V; M SDK/contract | [Organizations](https://auth0.com/docs/manage-users/organizations) |
| DEP03 | Authorization; Casbin/pycasbin; Apache Casbin | WRAP permission evaluation if policy matrix outgrows simple explicit checks | Apache-2.0; P; M adapters | [Project](https://github.com/apache/casbin-pycasbin) |
| DEP04 | Authorization; OpenFGA; OpenFGA project | RESEARCH, defer relationship-graph service until sharing complexity demands it | Apache-2.0; P; M datastore/SDK | [Project](https://github.com/openfga/openfga) |
| DEP05 | Database; PostgreSQL; PGDG | ADOPT recommended transactional store, migrations and RLS | PostgreSQL license; P; L core, extensions separate | [License](https://www.postgresql.org/about/licence/), [RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) |
| DEP06 | Object storage/archive; S3; AWS | BUY reference managed implementation; validate alternate S3-compatible providers separately | Service terms; V; M SDK/retention terms | [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) |
| DEP07 | Jobs; Celery; Celery project | WRAP if Python backend; persist domain job status independently | BSD-3-Clause; P; M broker/transports | [Project](https://github.com/celery/celery) |
| DEP08 | Jobs; BullMQ; Taskforce.sh | WRAP alternative for compatible selected runtime; avoid adopting both queues | MIT core, commercial extras separate; P; M backend/SDK | [Project](https://github.com/taskforcesh/bullmq) |
| DEP09 | Broker; RabbitMQ; RabbitMQ project | ADOPT conditional Celery transport if durable routing merits operations | MPL-2.0 core; C; M plugins/runtime | [Project](https://github.com/rabbitmq/rabbitmq-server) |
| DEP10 | Cache/queue backend; Valkey; Valkey project | RESEARCH exact queue-client compatibility and persistence; no “Redis-compatible” assumption alone | BSD-3-Clause; P; M clients/modules | [Project](https://github.com/valkey-io/valkey) |
| DEP11 | Browser interaction; Konva; Konva project | WRAP selection/transforms, not production text composition | MIT; P; L browser core, M optional server canvas | [Browser research](BROWSER_EDITOR_RESEARCH.md) |
| DEP12 | Browser interaction; Fabric.js; Fabric project | RESEARCH alternative to Konva, compare input/scene adapter | MIT; P; M optional Node/DOM/render deps | [Browser research](BROWSER_EDITOR_RESEARCH.md) |
| DEP13 | Graphics; Skia/CanvasKit; Skia project | WRAP pending positioned-glyph and resource benchmark | BSD-style core; P; H large third-party build | [Browser research](BROWSER_EDITOR_RESEARCH.md) |
| DEP14 | Graphics; PixiJS; Pixi project | RESEARCH alternative renderer only if demonstrated need | MIT; P; M graphics packages | [Browser research](BROWSER_EDITOR_RESEARCH.md) |
| DEP15 | Editor reference; Excalidraw; project | REFERENCE interaction patterns; do not reuse whiteboard canonical model | MIT; P; M app dependencies/fonts | [Browser research](BROWSER_EDITOR_RESEARCH.md) |
| DEP16 | Editor reference; Penpot; Penpot project | REFERENCE professional browser UX; wholesale embedding not recommended | MPL-2.0 core; C; H full app/dependencies | [Browser research](BROWSER_EDITOR_RESEARCH.md) |
| DEP17 | Editor SDK; tldraw; tldraw | RESEARCH commercial value; no permissive production assumption | tldraw proprietary license; V; M SDK/contract | [License](https://tldraw.dev/community/license) |
| DEP18 | Shaping/subsetting; HarfBuzz; project | WRAP explicit glyph shaping; validate subset integration | Old MIT core; P; M optional backends | [Typography research](TYPOGRAPHY_RESEARCH.md) |
| DEP19 | Font access/raster; FreeType; project | WRAP where needed; avoid duplicating renderer font stack | FTL or GPLv2; C (FTL route recommended); M codecs/notices | [Typography research](TYPOGRAPHY_RESEARCH.md) |
| DEP20 | Unicode/bidi/segmentation; ICU; Unicode | WRAP pinned code/data | Unicode license; P; M data/third-party notices | [Typography research](TYPOGRAPHY_RESEARCH.md) |
| DEP21 | Hyphenation; libhyphen; Hunspell project | RESEARCH approved language dictionaries, then WRAP | GPL/LGPL/MPL alternatives; C; H pattern-specific rights | [Typography research](TYPOGRAPHY_RESEARCH.md) |
| DEP22 | Spellcheck; Hunspell; project | WRAP optional editorial suggestions | GPL/LGPL/MPL alternatives; C; H dictionary licenses | [Typography research](TYPOGRAPHY_RESEARCH.md) |
| DEP23 | Browser shaping binding; harfbuzzjs; HarfBuzz project | RESEARCH before writing custom WASM glue | MIT wrapper plus HarfBuzz; P; M version coupling | [Typography research](TYPOGRAPHY_RESEARCH.md) |
| DEP24 | Image processing; libvips; project | WRAP authoritative derivative pipeline | LGPL-2.1-or-later; C; H enabled codecs/delegates | [Image research](IMAGE_COLOR_RESEARCH.md) |
| DEP25 | ICC transforms; LittleCMS; LittleCMS project | WRAP colour transforms, own profile policy | MIT core; P; M optional plugins/profiles | [Image research](IMAGE_COLOR_RESEARCH.md) |
| DEP26 | Node image binding; sharp; sharp project | RESEARCH binding if Node workers selected | Apache-2.0 wrapper; P; H libvips/codecs | [Project](https://github.com/lovell/sharp) |
| DEP27 | PDF structure; qpdf; project | WRAP structural helper, REJECT as complete preflight | Apache-2.0 current releases; P; M crypto/compression | [PDF research](PDF_PREPRESS_RESEARCH.md) |
| DEP28 | PDF writing; PoDoFo; project | RESEARCH explicit glyph/subset/PDF-X bridge | LGPL library, exact version scope pending; C; H native dependency graph | [PDF research](PDF_PREPRESS_RESEARCH.md) |
| DEP29 | PDF writing; PDFlib; PDFlib GmbH | BUY conditional writer candidate, benchmark against DEP28 | Proprietary; V; M bundled/runtime terms | [PDF research](PDF_PREPRESS_RESEARCH.md) |
| DEP30 | PDF/prepress tooling; iText; Apryse | BUY/RESEARCH if needed APIs and economics fit | AGPL/commercial; C/V; H extras/contract | [PDF research](PDF_PREPRESS_RESEARCH.md) |
| DEP31 | PDF rendering/conversion; Ghostscript; Artifex | BUY/REFERENCE; not automatic PDF/X certification | AGPL/commercial; C/V; H bundled fonts/codecs | [PDF research](PDF_PREPRESS_RESEARCH.md) |
| DEP32 | Paged composition; Antenna House Formatter; vendor | BUY/REFERENCE alternative to commodity paragraph work; resolved-geometry compatibility gate | Proprietary; V; M runtime/font terms | [PDF research](PDF_PREPRESS_RESEARCH.md) |
| DEP33 | DTP comparison; Scribus; project | REFERENCE; REJECT proprietary source fork as proposed default | GPL family, exact release pending; C; H full desktop dependencies | [Original context §9](../context/ORIGINAL_PRODUCT_CONTEXT.md); project site blocked by challenge, code license must be verified before any reuse |
| DEP34 | Professional preflight; pdfToolbox; callas | BUY/WRAP leading evaluation candidate, no procurement yet | Proprietary; V; M OEM/concurrency/DR | [Preflight research](PREFLIGHT_RESEARCH.md) |
| DEP35 | Professional preflight; PitStop Server; Enfocus | BUY/WRAP competing candidate, particularly press-aligned profiles | Proprietary; V; M platform/automation terms | [Preflight research](PREFLIGHT_RESEARCH.md) |
| DEP36 | Validation; veraPDF; veraPDF consortium | REFERENCE; REJECT for PDF/X certification (PDF/A/UA scope) | GPL/MPL alternatives, exact components pending; C; M Java deps | [Scope](https://verapdf.org/) |
| DEP37 | Constraint solving; OR-Tools CP-SAT; Google | WRAP only if heuristics need solver; BUILD newspaper objective/constraints | Apache-2.0 core; P; H optional solver dependencies | [Project](https://github.com/google/or-tools) |
| DEP38 | Crawling/extraction; news-please; fhamborg | RESEARCH FURTHER, potential extraction-only WRAP | Apache-2.0 core; P; H broad deps/source-wheel discrepancy | [News research](NEWS_INTELLIGENCE_RESEARCH.md) |
| DEP39 | Extraction; Trafilatura; adbar/project | WRAP candidate against news-please | Apache-2.0; P; M lxml/data dependencies | [News research](NEWS_INTELLIGENCE_RESEARCH.md) |
| DEP40 | Extraction; newspaper4k; AndyTheFactory/project | WRAP candidate; direct dependency alternative | MIT plus Apache notices; P; M/H NLP/native deps | [News research](NEWS_INTELLIGENCE_RESEARCH.md) |
| DEP41 | Crawl framework; Scrapy; project | WRAP approved-source crawling | BSD-3-Clause; P; M Twisted/TLS/parsers | [Project](https://github.com/scrapy/scrapy) |
| DEP42 | RSS/Atom; feedparser; project | ADOPT parser behind controlled fetch policy | BSD-2-Clause; P; L/M parser deps | [Project](https://github.com/kurtmckee/feedparser) |
| DEP43 | Deduplication; datasketch; ekzhu/project | WRAP similarity primitives; own thresholds and lineage | MIT; P; M NumPy/SciPy/storage extras | [Project](https://github.com/ekzhu/datasketch) |
| DEP44 | Entity extraction; spaCy; Explosion/project | RESEARCH language coverage and weight rights | MIT framework; P; H model/data licenses separate | [Models](https://spacy.io/models) |
| DEP45 | Search; OpenSearch; project | RESEARCH later; begin PostgreSQL metadata/text projection | Apache-2.0 core; P; M plugins/analyzers | [Project](https://github.com/opensearch-project/OpenSearch) |
| DEP46 | Observability; OpenTelemetry; project | ADOPT telemetry interfaces; buy/choose backend separately | Apache-2.0 SDKs/collector; P; M exporters | [Docs](https://opentelemetry.io/docs/) |
| DEP47 | Error monitoring; Sentry; vendor | BUY hosted candidate; scrub content and disable sensitive replay | Service terms; self-host source terms version-dependent; V/U; H stack | [Project](https://github.com/getsentry/sentry) |
| DEP48 | Billing; Stripe; Stripe | RESEARCH eligibility before BUY; do not assume Indian account availability | Service/SDK terms; V; M payment/data obligations | [India availability](https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india?locale=en-GB) |
| DEP49 | Billing; Razorpay Subscriptions; Razorpay | BUY conditional regional alternative | Service/SDK terms; V; M eligibility/mandates/webhooks | [API](https://razorpay.com/docs/api/payments/subscriptions/) |
| DEP50 | Product analytics; PostHog; PostHog | BUY/RESEARCH minimal workflow events; no unpublished-content capture | MIT core with enterprise exclusions; P/V; H full stack/EE | [License](https://raw.githubusercontent.com/PostHog/posthog/master/LICENSE) |
| DEP51 | Public-site analytics; Plausible; Plausible | BUY/RESEARCH if simple public analytics needed | AGPL self-host / hosted contract; C/V; M | [Project](https://github.com/plausible/analytics) |
| DEP52 | UI; React; React project | ADOPT recommended UI component framework | MIT; P; M ecosystem choices | [Project](https://github.com/react/react) |
| DEP53 | UI tooling; TypeScript; Microsoft | ADOPT recommended type system | Apache-2.0; P; L compiler | [Project](https://github.com/microsoft/TypeScript) |
| DEP54 | UI tooling; Vite; Vite project | ADOPT recommended build/dev tooling | MIT; P; M build plugins | [Project](https://github.com/vitejs/vite) |
| DEP55 | API; FastAPI; FastAPI project | RESEARCH runtime choice; recommended if Python selected | MIT; P; M ASGI/Pydantic/server deps | [Project](https://github.com/fastapi/fastapi) |
| DEP56 | Browser tests/authorized dynamic fetch; Playwright; Microsoft | ADOPT tests later; WRAP crawl only when justified | Apache-2.0 wrapper; P; H browser binaries/licenses | [Project](https://github.com/microsoft/playwright) |
| DEP57 | Local database; SQLite; SQLite project | RESEARCH deferred offline use, not second production DB | Public domain core; P; M extensions/jurisdictions | [Copyright](https://www.sqlite.org/copyright.html) |
| DEP58 | Native networking; libcurl; curl project | ADOPT only if native HTTP required; avoid redundant networking | curl license; P; M TLS/compression backends | [License](https://curl.se/docs/copyright.html) |
| DEP59 | Native tests; GoogleTest; Google | ADOPT if C++ engine selected | BSD-3-Clause; P; L test dependency | [Project](https://github.com/google/googletest) |
| DEP60 | Newspaper domain/commands/composition/rights UX; Pageinator | BUILD strategic policies and adapter contracts, not generic primitives | Pageinator-controlled original work; internal; dependency obligations propagate | [Phases 1–3](../architecture/PHASE_3_PUBLISHING_ENGINE.md) |
| DEP61 | Semantic text input; ProseMirror; project | RESEARCH then WRAP if selected; map transactions into story revisions | MIT; P; M plugins/module provenance | [Browser research correction](BROWSER_EDITOR_RESEARCH.md); [upstream relocation](https://github.com/ProseMirror/prosemirror) |
| DEP62 | Semantic text input; Lexical; Meta/project | RESEARCH alternative to DEP61; no print-composer authority | MIT; P; M plugins/React packages | [Upstream](https://github.com/facebook/lexical); [browser research correction](BROWSER_EDITOR_RESEARCH.md) |
| DEP63 | Paragraph layout; Pango; GNOME | RESEARCH then WRAP if corpus/geometry fit; avoid unnecessary generic compositor | LGPL-2.1-or-later; C; H GObject/font backends | [Pango API](https://docs.gtk.org/Pango/); [typography correction](TYPOGRAPHY_RESEARCH.md) |
| DEP64 | Paragraph layout; SkParagraph; Skia | RESEARCH then WRAP if explicit glyph bridge qualifies; not second preview reflow | BSD-style core; P; H Skia/Unicode/font dependencies | [Paragraph interface](https://raw.githubusercontent.com/google/skia/main/modules/skparagraph/include/Paragraph.h); [typography correction](TYPOGRAPHY_RESEARCH.md) |

## Runtime, health, security, performance and replacement

Maintenance: “public project” = upstream source/docs/history available, cadence and support not qualified; “vendor” = current offering, SLA/support quote unverified. “Established” describes scope/history, not a measured reliability score. Every row requires version-specific advisory checks before use. Integration/replacement L/M/H expresses relative cost for the scoped use.

| ID | Maturity / maintenance observation | Security / performance assessment | Runtime; browser; server; WASM | Integration / replacement |
|---|---|---|---|---|
| DEP01 | Established IdP, public project/security policy | Auth patching/MFA/session expertise; JVM sizing | Java service; OIDC client; yes; no need | H / M with OIDC, H identity migration |
| DEP02 | Established hosted IdP, vendor | Contract/region/outage dependency; rate/cost limits | Hosted; SDK/redirect; API; N/A | M / H user migration |
| DEP03 | Established policy library, public project | Test deny-by-default/cache invalidation; small policy benchmark | Python; no direct; yes; no need | M / M policy conversion |
| DEP04 | Established authorization service, public project | Consistency/availability become critical; network latency | Go/API; API only; yes; no need | H / H tuples/model |
| DEP05 | Established RDBMS, official maintained docs | RLS role bypass, backups, tuning; measured load required | Native; API only; yes; irrelevant | M / H data gravity |
| DEP06 | Established service, vendor | IAM/retention misconfiguration and egress; multipart throughput | Hosted; signed access; SDK; N/A | M / H data/retention |
| DEP07 | Established queue, public project | Safe serializer, duplicate delivery, broker security; workload test | Python workers; API only; yes; no | M / M durable job IDs |
| DEP08 | Established queue, public project | Backend/client compatibility, duplicate jobs; burst benchmark | Selected SDK/backend; API only; yes; no | M / M |
| DEP09 | Established broker, public project | Patch/admin access/cluster recovery; persistence test | Erlang service; no; yes; no | H / M |
| DEP10 | Established lineage, public project | Persistence/eviction/auth; test queue commands and recovery | Native service; no; yes; no need | M / M |
| DEP11 | Established graphics lib, public docs | Untrusted scene/media inputs; dense-page benchmark | JS; yes; optional backend; not needed | M / M if adapter |
| DEP12 | Established canvas lib, public project | SVG/input sanitization; object/text scale unknown | JS; yes; optional Node; not needed | M / M |
| DEP13 | Established engine, official WASM | Native/GPU parser surface; startup and manual memory lifecycle | C++/WASM; yes; native; existing | H / H scene primitives |
| DEP14 | Established renderer, public project | Texture exhaustion/context loss; benchmark batching | JS/GPU; yes; limited headless; not needed | H / M |
| DEP15 | Established whiteboard, public project | Reference only; production fit not benchmarked | TS/browser; yes; app backend; no need | L study / H fork |
| DEP16 | Established design app, public project | Full app deployment/licensing burden; no newspaper benchmark | Browser plus service stack; yes; yes; inspect current render build | L study / H reuse |
| DEP17 | Commercial SDK, active vendor docs | License-key continuity; no newspaper benchmark | TS/browser; yes; ancillary; no need | M / H schema/license |
| DEP18 | Established shaping, public source/perf/tests | Font parser risk, pin optional backends; corpus benchmark | C/C++; binding; yes; feasible/existing bindings | M / H geometry golden changes |
| DEP19 | Established font library, official licenses | Hostile fonts/hinting variability; CPU cost | C; via renderer/WASM; yes; possible | M / M |
| DEP20 | Established Unicode stack, official docs | Data/version drift; WASM size and segmentation time | C/C++ or Java; WASM route; yes; possible | M / H boundary semantics |
| DEP21 | Established narrow lib, cadence unqualified | Malformed dictionaries and bad break data; low-cost primitive | C; WASM route; yes; possible | M / M dictionary quality |
| DEP22 | Established spellchecker, public project | Dictionary parsers/data rights; suggestion latency | C++; binding; yes; possible | M / M |
| DEP23 | Narrow binding, public project | Version/API lag, WASM memory; same corpus | JS/WASM; yes; Node possible; existing | M / M |
| DEP24 | Established native pipeline, 8.18 news visible | Codec attack surface and decompression; demand-driven design, benchmark pending | C; optional WASM; yes; existing route not selected | M / M |
| DEP25 | Established CMM, public project | ICC parser and transform policy; benchmark per profile | C; custom binding; yes; possible | M / H colour regressions |
| DEP26 | Established binding, public project | Codec defaults/binary supply chain; benchmark derivative workload | Node/native; no direct; yes; not main route | L/M / M |
| DEP27 | Established PDF tool, docs 12.4.1 | Malformed PDF/resource exhaustion; structural work only | C++/CLI; no direct; yes; possible not selected | L / L |
| DEP28 | Established PDF library, API evolving | Untrusted PDF/native deps; conformance and glyph tests absent | C++17; no direct; yes; unverified | H / H writer bridge |
| DEP29 | Established vendor writer | Proprietary patch/SLA; glyph/output throughput untested | Native/bindings; no direct; yes per license; no assumption | H / H output behavior |
| DEP30 | Established PDF stack/vendor | AGPL/commercial gate, parser surface; tests required | JVM/.NET; service access; yes; not proposed | H / H |
| DEP31 | Established interpreter/vendor | High untrusted-format exposure; isolate and patch | Native CLI; no direct; yes; not proposed | M / M |
| DEP32 | Established formatter/vendor | Must avoid second composition authority; throughput untested | Native vendor engine; service access; yes; no assumption | H / H |
| DEP33 | Established desktop reference; website access challenged | No code adoption/security claims; reference comparisons only | Native desktop; no; automation unverified; no assumption | L study / H fork |
| DEP34 | Established preflight vendor, current product docs | License outage/parser isolation; concurrency benchmark | CLI/SDK/service options; API only; platform quote; no need | M/H / H profiles |
| DEP35 | Established preflight vendor, current docs | Platform/automation fit and patch SLA; same corpus | Vendor server; API/workflow only; verify OS; no | H / H profiles |
| DEP36 | Established format validator, current scope docs | Wrong-standard risk; not production preflight benchmark | Java; no direct; yes; no need | L / L scoped reference |
| DEP37 | Established optimization suite, public project | Bound complexity; wall-time solutions may vary; no solved geometry guarantee | C++/Python/etc; no default; yes; possible not selected | H / H objective tuning |
| DEP38 | PyPI 1.6.16 Sep 2025, master Apr 2026 docs change | Broad deps/hidden fetch/SSRF; no measured throughput | Python; no; yes; unsuitable | M/H / L with stateless adapter |
| DEP39 | Established extraction, docs 2.2.0 visible | XML/HTML resource bounds; corpus accuracy pending | Python; no; yes; unsuitable | M / L |
| DEP40 | Maintained fork, upstream 0.9.5 Feb 2026 visible | Dependencies/network behavior; language benchmark pending | Python; no; yes; unsuitable | M / L |
| DEP41 | Established crawler, current settings docs | Robots/SSRF/rate policy must be set; measured concurrency | Python/Twisted; no; yes; no | M / M |
| DEP42 | Established parser, docs 6.0.14 visible | Malformed XML/HTML, bounded inputs; parser throughput | Python; no; yes; unnecessary | L / L |
| DEP43 | Established sketch lib, version 2 hash change documented | Similarity false positives; persist algorithm version; index memory | Python/scientific deps; no; yes; not proposed | M / M rebuild indexes |
| DEP44 | Established NLP framework/catalogue | Model supply chain/content leakage; per-language accuracy unknown | Python/native; no; yes; not proposed | H / M model replacement |
| DEP45 | Established search, public project | Tenant filters/snippets/ACL invalidation; index/heap operations | JVM cluster; API only; yes; no | H / M reindex |
| DEP46 | Established telemetry standard/project | Scrub payloads/credentials, cardinality budgets | Multi-runtime; SDK; SDK/collector; optional not required | M / L OTLP boundary |
| DEP47 | Established vendor/project | PII/replay/log access, costs; no SLA quote | Hosted/SDK; yes; yes; N/A | M / M |
| DEP48 | Established provider; India invite-only observed | Signed webhooks/idempotency; account eligibility unknown | Hosted/SDK; checkout; API; N/A | M / H payment data |
| DEP49 | Established regional provider, current API docs | Eligibility/mandates/webhooks/refunds; no quote | Hosted/SDK; checkout; API; N/A | M / H |
| DEP50 | Established analytics project/vendor | Disable replay/unpublished text; high self-host complexity | Hosted/multi-service; SDK; API; no | M / M |
| DEP51 | Established public analytics project/vendor | Privacy/data-region review; limited workflow depth | Hosted/Elixir stack; script; API; no | L / L |
| DEP52 | Established UI ecosystem/public project | XSS/dependency hygiene; avoid giant synchronous scene updates | JS; yes; optional SSR; no need | M / H UI investment |
| DEP53 | Established compiler/public project | Build-chain pinning; types do not validate runtime data | Build tool; output JS; build; no need | L / M |
| DEP54 | Established tooling/public project | Dev-server exposure/plugins; benchmark build only | Build/dev runtime; output; tool; no need | L / M |
| DEP55 | Established framework/public project | Auth/schema/ASGI boundaries; CPU jobs separate | Python; API only; yes; no | M / M with contracts |
| DEP56 | Established automation/public project | Browser sandbox/patches; headless resource cost | JS/Python/etc + browsers; controls browsers; yes; no | M / M |
| DEP57 | Established embedded DB/official docs | Local key/data protection; concurrent-write fit limited | C; WASM possible; yes; exists ecosystem, unselected | L / M offline data |
| DEP58 | Established network library/official license | TLS/redirect/SSRF policy, backend patches; transfer limits | C; browser fetch preferable; yes; possible unnecessary | L / L |
| DEP59 | Established testing framework/public project | Test-only supply chain; no production perf implication | C++; no direct; CI; possible later | L / L |
| DEP60 | New design, no implementation | Highest correctness burden; bounded domain scope and independent tests | Language undecided; shared contracts; yes; research | H / strategic ownership |
| DEP61 | Established module family; GitHub meta-repo moved, new upstream fetch blocked; exact package health pending | Paste/XSS/plugin risk; IME/large-story benchmark required | JS; yes; model utilities possible, not browser input; unnecessary | M / M with Pageinator adapter |
| DEP62 | Established editor project; upstream docs/history available, release/support not qualified | Sanitization/plugin inputs; IME/accessibility/performance need independent tests | JS/TS; yes; headless tooling possible, not authoritative print; unnecessary | M / M with semantic adapter |
| DEP63 | Established native layout; official 1.58.2 docs observed, exact build/advisories unqualified | Font/native parser isolation; deterministic font map and paragraph benchmark needed | C/GObject; binding required; yes; unqualified port/build burden | H / H geometry/line-policy coupling |
| DEP64 | Skia module with inspectable glyph visitor API; binding/version qualification pending | Native/WASM lifecycle and font risk; layout/bundle benchmark needed | C++; CanvasKit exposure must be verified; yes; stack supports WASM, exact API unproved | H / H resolved-data/renderer coupling |

## Adoption gate and rationalized shortlist

Before installation in a later authorized implementation: choose exact version/commit and upstream provenance, inspect the complete license/notice tree and resolved dependencies, distinguish server operation from browser/WASM distribution, examine advisories and update support, run representative correctness/performance/security tests, capture contract/data-locality costs, define rollback and replaceability, and record the decision. Copyleft is not a blanket ban on commercial use; compatibility depends on use, modifications, distribution and the selected license route. Vendor engines require written service/OEM permission; wrapper isolation is not legal clearance.

Prefer one identity provider, one database, one durable-job stack, one interaction library and one canonical publishing model. No self-hosted analytics/search cluster is necessary for UI-first. News-please does not pull its storage ecosystem into the system architecture. Preserve model/template/layout/rights/workflow/IP ownership through Pageinator schemas and adapters. Registry gaps intentionally remain visible: exact font/dictionary/model rights, renderer/PDF feasibility, preflight procurement, runtime/provider selection, SBOM/security and all measured performance. These are consolidated research workstreams in the decision register, not 64 independent production approvals.

Phase 24 adds DEP61–64 in response to AR08, giving 64 paired candidate records. These additions correct missed reuse opportunities, not approve dependencies or rewrite earlier findings. DEP60's BUILD scope means newspaper-specific policy; compare DEP63/64 and existing commercial composition before custom paragraph optimization. Select at most one semantic input layer and the minimum graphics stack that passes RD06. All four added candidates remain RESEARCH pending exact-version maintenance/security/license/performance evidence.
