# News intelligence and ingestion — Phase 9

Research date: 2026-09-15. Recommendation: begin with customer-owned content and contracted feeds; build a rights-aware newsroom feed on replaceable ingestion/extraction adapters. news-please is **RESEARCH FURTHER**, with a possible constrained WRAP outcome after comparison. It is neither adopted wholesale nor dismissed without evaluation.

## Pipeline and ownership

Sources → policy-aware fetch/import → normalization → rights/provenance → exact/near deduplication → event grouping → source lineage/evidence signals → AI enrichment → publication relevance → explainable ranking → newsroom selection.

Apply permitted-access and retention checks before fetching/storing full content; rights is not merely a post-download annotation. Normalize again after extraction while preserving permitted original evidence. SourceItem is an observation; NewsEvent is a reversible grouping; StoryRevision is editorial content approved for an intended use. Never merge these identities. A cluster can contain conflicting accounts and versions of the same article.

| Input type | Proposed integration | Required evidence / limitations |
|---|---|---|
| Reporter/manual content | Authorized upload/editorial forms | Contributor ownership/permission, caption/photo rights, timestamps |
| PTI/IANS/licensed wires | Contract-specific API/feed adapter | Customer entitlement, permitted publications/regions, embargo, correction/kill notices, archive and AI-processing rights; no assumed public API |
| CMS | Customer-authorized API/webhook | Stable external IDs, revision updates, permission scope, idempotency |
| RSS/Atom | Feed parser + controlled scheduler | Feed presence grants no republication rights; retain permitted metadata/link when rights unknown |
| Government/official source, including PIB | Source-specific approved feed/API/web route | Official origin is an evidence signal, not universal reuse permission |
| Approved websites | Controlled HTTP fetch + extractor | Robots/terms/access policy, domain quotas, permitted storage/use; no paywall/CAPTCHA bypass |
| JS-heavy sites | Prefer available licensed API; isolated browser only if authorized | Browser resource/SSRF/sandbox cost; no blanket dynamic-crawl requirement |

IPTC NewsML-G2 provides a standards vocabulary for syndicated items, metadata and updates; map supported source fields rather than invent wire formats. The IPTC standards feed documents later versions beyond an older 2.34 documentation page, illustrating why connector implementations must pin a negotiated version. [IPTC updates](https://iptc.org/?_standard=newsml-g2).

## news-please — observed evidence

| Dimension | Finding | Consequence |
|---|---|---|
| Architecture and capabilities | Combines crawl and extraction components; headline, lead/body, image, authors, publication date and language are advertised. Library and CLI modes differ; continuous RSS/full-site crawling is described under CLI. | Useful capability baseline; advertised broad coverage is not an Indian-site benchmark. [README](https://github.com/fhamborg/news-please) |
| Runtime/release | PyPI lists 1.6.16, uploaded 2025-09-21, Python classifiers 3.8–3.12, one listed maintainer. | About a year without a newer listed package on the research date; verify intended supported interpreter through actual tests later. Classifiers do not prove 3.13/3.14 compatibility. [PyPI](https://pypi.org/project/news-please/) |
| Source/package mismatch | Inspected master setup.py identifies 1.6.13, unlike PyPI 1.6.16. | Release/source provenance must be reconciled before pinning; do not assert inspected master equals released wheel. [setup.py](https://raw.githubusercontent.com/fhamborg/news-please/master/setup.py) |
| Maintenance | Visible master history includes a 2026-04-14 README cleanup and 2025 fixes involving Redis, sitemap and redirects. GitHub Releases page has no release entries. | Evidence of maintenance, not an abandoned-project finding; package/release discipline and bus factor remain concerns. [Commits](https://github.com/fhamborg/news-please/commits/master/), [releases](https://github.com/fhamborg/news-please/releases) |
| Issue activity | Visible issue list has five longstanding open items, including empty crawl results and proxy configuration; issue creation is restricted. | Low issue count does not prove low defect rate or responsive support. No support SLA established. [Issues](https://github.com/fhamborg/news-please/issues) |
| Crawl model | Config includes sitemap/recursive/RSS modes, fallbacks and bounded process/daemon counts; RSS redownload interval is configurable. | Worker-local crawling is not a tenant-aware distributed scheduler. Pageinator should own scheduling and rate limits. [config](https://raw.githubusercontent.com/fhamborg/news-please/master/newsplease/config/config.cfg) |
| Extraction extension | Extractor layer loads multiple extractors, compares and cleans results. | Adapter can replace or compare extraction methods; do not inherit extraction confidence as truth. [extractor source](https://raw.githubusercontent.com/fhamborg/news-please/master/newsplease/pipeline/extractor/article_extractor.py) |
| Library behavior | from_html bypasses Scrapy; URL batch path uses process execution; image-fetch behavior is configurable. | Fetch HTML under Pageinator policy and disable incidental image downloads; verify no hidden network use. Avoid nested unconstrained process pools in managed workers. [library source](https://raw.githubusercontent.com/fhamborg/news-please/master/newsplease/__init__.py) |

### Robots, retries and failure behavior

No explicit ROBOTSTXT_OBEY or RETRY override was found in the inspected config.cfg; this is not proof of every runtime code path's behavior. Reading a sitemap from robots.txt is different from obeying its exclusion rules. Scrapy settings and middleware govern its requests, while news-please's library extraction/fetch path need not pass through Scrapy. Therefore robots compliance for a particular release remains UNVERIFIED. Configure and test access policy explicitly, including redirects, user agent and robot-fetch failures. [Scrapy settings](https://docs.scrapy.org/en/latest/topics/settings.html), [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html).

Pageinator must record one terminal outcome per source request: succeeded, partial extraction, policy denied, timeout, fetch error, parse error or unsupported. Library return values must not cause failures to disappear from batch accounting. Use bounded retries with backoff/jitter for transient failures, source-specific rate limiting and quarantine for repeated malformed content. No measured throughput or retry-recovery guarantee was established here. Test HTTP 429/5xx, bad encoding, redirects, empty body, truncation and source schema drift.

### Dependencies, licensing and operational coupling

The inspected setup lists broad minimum requirements including Scrapy, newspaper4k, readability-lxml, lxml/lxml-html-clean, langdetect, faust-cchardet, database clients, Redis, boto3 and other utilities. This creates installation/API-drift and transitive-license review work even for extraction-only use. It does not justify installing Elasticsearch, MySQL, Redis or PostgreSQL as news-please-owned storage inside Pageinator. [Dependency declarations](https://raw.githubusercontent.com/fhamborg/news-please/master/setup.py).

Core Apache-2.0 licensing permits a plausible commercial-use path with applicable notices, but does not license source content, fonts/models or every dependency. Review native libxml/encoding bindings, storage clients, package provenance and exact resolved dependency licenses/security advisories. Do not claim a clean SBOM without one. news-please's CLI offers JSON and database/storage pipelines; prefer a stateless extraction result mapped into Pageinator's own records. Keep original HTML only when permitted, under independently enforced retention.

### Language and dynamic-site suitability

Unicode extraction and language detection do not establish Marathi/Hindi/Urdu quality. Boilerplate removal, dates, author detection and script-specific whitespace can fail independently. news-please includes no evaluated Indian-language accuracy corpus in this program. The inspected HTTP/extraction route does not establish browser JavaScript execution; JS-only bodies require another authorized access path. Do not claim dynamic-site support from the crawler label.

Evaluate at least 25 permitted articles per pilot language across several customer-approved sources, including short briefs, mixed-script text, navigation-heavy pages, missing metadata, update timestamps and syndicated copies. Human-label headline/body boundaries, dates/timezones, authors, images and encoding errors. Measure accuracy by field/source/language, extraction failures, latency, memory and cost. Expand the corpus when failures cluster; the proposed minimum is not statistical certification.

## Alternatives and reuse

| Candidate | Classification | Fit / tradeoff |
|---|---|---|
| Trafilatura / Apache-2.0 | WRAP candidate | Focused text/metadata extraction and discovery utilities; compare field accuracy and operational footprint with news-please. [Project](https://github.com/adbar/trafilatura), [docs](https://trafilatura.readthedocs.io/en/latest/) |
| newspaper4k / MIT with additional notices | WRAP candidate | Direct underlying news extractor may avoid news-please storage/orchestration dependencies; version-specific language/robots behavior still needs evaluation. [Project](https://github.com/AndyTheFactory/newspaper4k) |
| Scrapy / BSD-3-Clause | WRAP | Mature crawl scheduling/middleware; Pageinator supplies domain/rights/tenant constraints. A crawler is not an article extractor. [Settings](https://docs.scrapy.org/en/latest/topics/settings.html) |
| feedparser / BSD-2-Clause | ADOPT candidate | RSS/Atom parser behind source adapter, with malformed-feed diagnostics; scheduler/rights independent. [Docs](https://feedparser.readthedocs.io/en/latest/) |
| Mozilla Readability / Apache-2.0 | RESEARCH | Node/browser article-body extraction; DOM parser and metadata additions required. [Project](https://github.com/mozilla/readability) |
| Playwright / Apache-2.0 | WRAP only for justified sources | Browser automation, substantial runtime/security cost; not default fetcher. [Project](https://github.com/microsoft/playwright) |
| datasketch / MIT | WRAP candidate | MinHash/LSH approximate near-duplicate primitives; Pageinator owns text normalization/thresholds. [Project](https://github.com/ekzhu/datasketch) |
| spaCy / MIT framework | RESEARCH | Entity/NLP framework, model licenses and per-language coverage separate; no universal Indian-language model assumed. [Model catalogue](https://spacy.io/models) |

## Deduplication, events and editorial evidence

Canonical URL/source IDs plus content hashes detect exact repeats; use language-aware normalized shingles/MinHash for near copies. Keep source observations and updates even when the feed collapses them visually. Embedding similarity can propose cross-language event grouping after language-specific evaluation; code and model-weight licenses are separate. Event merges/splits are reversible and auditable. A translation or syndicated wire reprint must not count as independent corroboration.

Evidence records contain attributed claims, source/time, primary/secondary relationship, observed corrections and contradictions. Ranking combines publication geography/topics/languages, freshness, editorial relevance and explicit quality signals with versioned weights. Show reasons and uncertainty; do not label a percentage as calibrated truth without evidence. Search initially uses authorized metadata and relational text indexes; evaluate multilingual analyzers before moving to OpenSearch or vector retrieval.

RightsGrant must express source/licensor, evidence of permission, permitted action (discover/store/display/edit/translate/AI-process/print/reprint/archive), publication/territory/audience, attribution, embargo, validity and revocation. Default unknown grants to discovery-only. Recheck when adding to an edition, processing via AI, releasing and reprinting. A revoked grant does not silently rewrite a historical edition; apply legal hold/takedown/access policy and preserve audit evidence. RSS, robots permission, public availability and “official” status do not establish republication rights.

## Outcome and unresolved research

news-please remains RESEARCH FURTHER; probable integration if successful is WRAP of extraction-only functionality on already policy-approved HTML. Compare direct Trafilatura/newspaper4k first. Adoption requires reconciling package/source versions, exact dependency/security review, language corpus results, no incidental network fetches, explicit robots/retry tests and lower total integration cost than alternatives. No crawling of customer/news sites, installation, cloning or vendoring was performed.
