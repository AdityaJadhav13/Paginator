# 09 — Newsroom Intelligence and AI Architecture

> **Second-pass review, 2026-10-07.** Accepted in principle. **Scheduled after G5/G6** (`13`).

The capability-by-capability AI classification is in `15` §7.

The AI default model names are an implementation detail. Status vocabulary: ADR-021. Baseline: `20`.


Status:
- AI architecture: DECIDED
- Newsroom pipeline: DECIDED in shape, built in Phase 4
- Source contracts: RESEARCH (OP10)

## Part A — Newsroom / single feed

### A1. Principles
1. **Discovery is not a right to republish** (D07, RJ03). Every item carries a `rights_class`, and the domain enforces it:

   | rights_class | Meaning | Can its text be placed in an edition? |
   |---|---|---|
   | `licensed_republish` | Wire under contract (PTI, IANS, agency feeds) | Yes, within the licence terms (attribution, embargo, territory) |
   | `official_public` | Government or official releases (PIB, state DGIPR, court orders) whose terms permit reuse | Yes, with attribution. Terms are recorded per source |
   | `customer_owned` | Reporter copy, the customer's own CMS | Yes |
   | `discovery_only` | Web articles, RSS from publishers without a licence | **No.** Can be used only as a lead: "assign reporter", "create original story with citation" |
   | `unknown` | Default for anything new | Treated as `discovery_only` |

   Preflight `RGT001` blocks discovery-only text from reaching print. AI rewriting a discovery-only article does **not** change its rights class: the result inherits provenance and stays `discovery_only` (no "AI laundering").
2. **Evidence, not verdicts.** The system shows signals and sources. It never says "true".
3. **Publication-specific relevance.** A Pune Marathi daily and a national English daily get different feeds from the same events.

### A2. Pipeline

```
Connectors (jobs, per ContentSource schedule)
  RSS/Atom · PIB/state-govt sites (sitemaps/RSS) · wire APIs/FTP (PTI/IANS per contract) · customer CMS webhook
  · reporter submissions (app/email-in) · approved web discovery (allowlist, robots-respecting)
→ Fetch (egress proxy, SSRF-guarded, per-domain rate limit, conditional GET)
→ Extract (Trafilatura-class extraction for HTML [RD07]; native for feeds) → SourceItem {canonical_url, title, text?,
   lang, published_at, author, images (as references only, not downloaded unless licensed), rights_class, licence_ref}
→ Normalise (NFC, legacy-font→Unicode, language ID, boilerplate strip, date normalisation to IST)
→ Dedupe: exact (canonical URL hash, content sha) → near-dup (MinHash/LSH over shingles, per language)
→ Cluster into NewsEvent: embedding similarity (multilingual model) + time window (48h) + entity overlap;
   incremental single-link with centroid update; cross-language clustering (Marathi + English reports of same event)
→ Enrich (AI, structured): entities (people/places/orgs), geo (gazetteer: Maharashtra districts/talukas/cities),
   topic/section, event type, summary (for editors only)
→ Signals → Relevance → Feed
```

**Storage:**
- Raw payloads and extracted text are kept in S3 with retention set by rights. For example, discovery-only full text is kept for 30 days for clustering only, or never stored if the source's terms forbid it. Metadata is kept longer.
- Embeddings live in pgvector.

### A3. Verification signals (evidence-oriented)

Each `VerificationSignal {type, direction (+/−), weight, evidence_refs}`:
- `independent_sources(n)`: distinct publishers, excluding syndicated copies (detected by near-duplication).
- `authoritative_source`: a government or official primary source is present in the cluster.
- `primary_document`: a link to an order, release or filing.
- `wire_confirmation`: a licensed wire carries it.
- `contradiction`: claims in the cluster conflict on key facts (numbers, names, outcome). AI extracts the claims; a deterministic comparison flags them.
- `known_fact_check`: a match with fact-check feeds (ClaimReview markup from IFCN signatories).
- `recency/staleness`, `single_source`, `anonymous_only`.

**Display:**
- An evidence level (HIGH / MEDIUM / LOW / UNVERIFIED), computed by a **transparent, versioned rule set**, never by a model's opinion.
- The list of reasons and the sources.
- LOW or UNVERIFIED shows "Review before publishing".
- Every display records the rule-set version, for audit.

### A4. Relevance ranking (per publication)

`score = w1·geo_match + w2·section_interest + w3·importance + w4·freshness_decay + w5·evidence_level + w6·novelty − w7·already_covered`

- Geo match comes from the publication's region and cities, using the gazetteer hierarchy (Pune city > Pune district > Maharashtra > India).
- Section interest is learned from the publication's own past editions, through archive statistics (P5).
- The weights live in the publication profile. Every displayed score can be explained component by component.
- Funnel from the vision (100k → 800 → 150 → 40):
  - hard filters: language, rights, region;
  - then the score;
  - then diversity (MMR) so one event does not flood the feed.

### A5. Feed UX and actions

Tabs: For You · Local · Maharashtra · India · World · Politics · Business · Sports · Technology.

Each card shows the event title, location, age, source count, official-source count and evidence level. Actions:
- **View sources**
- **Add to edition**, allowed only for placeable rights classes. For discovery-only items this becomes **Create story from lead**: it creates a draft Story with citations, to be written by staff.
- **Assign reporter**
- **Mute**

## Part B — AI architecture (`packages/ai` + `modules/ai`)

### B1. Where AI is used, and where it is not

| Used (suggestions; human accepts) | Never used (deterministic authority) |
|---|---|
| Classification: section, topic, priority hint, event type | Geometry, line breaks, glyph positions, fit/overset |
| Headline generation at a target length; alternatives; "fit in 2 lines" (target given by the composition engine) | Collisions, DPI, ICC, page dimensions |
| Summaries and decks; trim to N words (for copyfit); expand | Font embedding, PDF generation, preflight verdicts |
| Translation mr↔hi↔en, with a glossary per publication | Rights decisions, release approval |
| Captions (from image + story), entity extraction, geo tagging | Verification "truth" |
| Clustering assistance, claim extraction for contradiction checks | Final text, without explicit acceptance |
| Archive semantic search (embeddings) and question answering over the publication's own archive | |
| Layout *strategy hints* (for example "photo-led page") as an enum | Coordinates |

**The fit loop for headlines and trims** is the important integration:
1. AI produces N candidates.
2. The composition engine measures each one.
3. Only candidates that fit are shown.
4. If none fit, AI retries with stricter constraints, at most twice.

This is how "fit in two lines" becomes reliable.

### B2. Provider abstraction

```ts
interface AiTask<I, O> { id: 'headline.generate'; version: '3'; input: ZodSchema<I>; output: ZodSchema<O>;
  promptTemplate; route: ModelRoute; evals: EvalSetRef; cachePolicy; dataClass: 'customer_confidential'|'public' }
interface ModelProvider { generateStructured(req): Promise<{output, usage, latency, model}>; embed(texts) }
```

- **Providers:** adapters for Anthropic (default), plus one secondary (OpenAI or Google) for fallback and per-task cost choice. A local or open model is optional later (DF06 revisited when needed).
- **Routing per task:**
  - Claude Sonnet 5.5 (`claude-sonnet-5-5`) for headlines, translation and editorial rewriting;
  - Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for classification, entity extraction and enrichment;
  - Opus 5.5 is reserved for hard reasoning tasks only when an eval shows it is worth the cost.
  - Routes are configuration, not code.
- **Embeddings:** a multilingual embedding model that is good on Marathi and Hindi, chosen by eval in P4 (RD08). Vectors are stored with `model_id` so the index can be rebuilt when the model changes.
- **Structured output:** tool/JSON-schema mode, then Zod validation, then on failure one repair retry, then fail closed.
- **Reliability:** timeouts per task, two retries with jitter, a circuit breaker per provider, and fallback to the secondary route.
- **Caching:** `hash(task, version, input, model)` maps to the stored output, for deterministic replays and lower cost.
- **Cost:** every `AIInvocation` records tokens and cost and is metered against the org's `ai_credits` entitlement. Budgets and alerts apply per org.
- **Privacy:**
  - The provider must have zero-retention / no-training terms, and the data-processing terms are recorded (OP07).
  - Regional processing is used where available.
  - Customer content is never used to train our own models without an explicit contract.
  - Logs keep inputs and outputs only per the retention policy (30 days by default), and are encrypted.

### B3. Prompts, evaluation and hallucination controls

- Prompts are versioned files in the repo (`packages/ai/tasks/<task>/v3.md`). Every invocation records the prompt version.
- **Eval sets per task:** a licensed corpus of Marathi, Hindi and English stories with reference outputs and rubric checks.
  - Automatic checks: length, script correctness, named-entity preservation, number preservation, and no new facts (checked by entailment from the source).
  - Human-rated samples.
  - CI runs the evals on prompt or model changes. A regression beyond its threshold blocks the change.
- **Hallucination controls:**
  - Generation is grounded in the story text only.
  - "Facts not in the source" checks run on summaries, trims and translations: numbers, names and quotes are compared.
  - Output is shown as a diff against the original.
  - Accepted suggestions record the `AIInvocation` ID (preflight `EDT003` blocks unresolved suggestions).
- **Prompt-injection boundary:**
  - Ingested and customer text is always passed as data in delimited fields, never as instructions.
  - Tools exposed to the model are read-only.
  - Model output can only create `Suggestion` rows. It can never mutate documents directly.

### B4. Contextual AI in the editor (P3)

Actions are selection-aware, exposed as a small menu rather than a chatbot:

| Selection | Actions |
|---|---|
| Headline | Shorten, strengthen, fit in N lines (engine-verified), translate, alternatives |
| Story | Summarise to deck, trim to fit (word target from copyfit), expand, translate, pull quote |
| Image | Caption, credit check, focal point |
| Page | Improve layout (regenerate with a strategy hint), more visual, density ±, balance white space |

Every action creates suggestions, which are previewed in place and then accepted (becoming a command) or rejected.
