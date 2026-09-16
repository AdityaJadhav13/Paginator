# Phase 13 — AI architecture

Prepared 2026-09-16. Inputs read from disk: news intelligence research and publishing-engine boundary. CONFIRMED: AI assists semantics; humans control editorial acceptance; deterministic systems control physical correctness. Provider/model choice is RESEARCH REQUIRED, not inherited from the tool used to author these documents.

## Capability boundary

| Task | AI output | Authority after output |
|---|---|---|
| Classification, relevance, entities, event grouping | Attributed suggestions/scores | Versioned ranking policy and human correction; no truth claim |
| Headlines, summaries, translation, decks/pull quotes | Alternatives linked to source revision | Editor accepts/rejects with diff; attribution/meaning checked |
| Copyfit | Wording or allowed style proposals | Real shaping measures fit; content edits require approval |
| Layout strategy/photo recommendation | Ranked templates, priorities, asset IDs | Authorized references and deterministic constraints; editor reviews |
| Contradiction/source analysis | Evidence-linked claims and uncertainties | Independent-source lineage and human verification |

NEVER delegate solely to an LLM: glyph placement, line breaking, geometry, overset/overlap, effective image resolution, colour conversion, font embedding, PDF structure/conformance, mandatory preflight, rights grants, access control, billing arithmetic, release approval or archive integrity. Even a valid structured response is untrusted data. “Temperature zero” is not a reproducibility guarantee.

## Adapter and job design

Use a small capability interface: request task type, tenant/publication, permitted source revision IDs, locale, output schema version, policy/model route and budget. Return result ID, provider/model identifier, prompt/template version, source hashes, response content, validation status, usage and timing. Keep task schemas owned by Pageinator; preserve provider-specific metadata without forcing all providers into unsupported features.

A routing table maps task/language/sensitivity to an evaluated model and permitted region/provider. Start with one qualified provider and an adapter, not a multi-agent platform or complex orchestration framework. Fallback models must independently meet the same privacy/rights/quality policy; an outage must not send confidential content to an unapproved vendor. Hosted versus local inference depends on customer constraints and measured economics. No current model-price or quality claims are made here.

Validate schema, allowed IDs/enums, lengths and source references. Reject fabricated URLs/citations, arbitrary executable expressions and unsupported command types. A proposal contains base revision and affected scope; acceptance is a normal authorized command with optimistic concurrency. Stale proposals require re-evaluation, never overwrite newer edits. Layout generation can proceed through deterministic template policies when AI enrichment is unavailable, if required editorial inputs already exist.

## Safety, rights and confidentiality

Retrieved articles, ads and metadata can contain prompt injection. Treat content as data, isolate it from policy instructions, expose no arbitrary tools/secrets and enforce allowlists in application code. Prompt wording alone is not a security boundary. Validate/sanitize rendered output and disable remote-image exfiltration in suggestions. [OWASP prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

Before inference, verify source rights permit the intended processing and provider transfer; printing permission does not necessarily include AI processing or training. Use minimal content, redact unnecessary personal data and apply approved provider retention/training/residency terms. Embeddings, summaries, caches and evaluation examples inherit tenant/rights constraints. No cross-tenant prompt or result cache by text hash alone.

## Reliability and cost

Asynchronous tasks have durable IDs, deadlines, cancellation and bounded transient retries with jitter. Permanent schema/permission errors do not loop indefinitely. One bounded repair attempt can be allowed for malformed output if budget permits; exhausted repair produces a visible failure. Provider retry may incur another charge: usage is per attempt, while the user-facing proposal identity remains stable. Token/time/currency quotas and concurrency limits are enforced before scheduling and reconciled with provider billing. Quota exhaustion preserves existing drafts and manual editing.

Cache only where rights allow, keyed by tenant, task, source revision hashes, language, prompt/schema/model versions and all material settings. Expire or invalidate on rights revocation and policy updates. Reuse accepted result bytes for provenance rather than expecting an identical future model response. Do not include customer text in ordinary telemetry; restricted prompt logs need retention/access controls.

## Human interaction and evaluation

Present contextual actions on selected headline/story/page. Show original and proposed text, provenance, changed names/numbers and uncertainty. Accepting a translation records the reviewer and language; do not replace the source revision. “Expand story” must not manufacture reporting: use supplied evidence or explicitly mark unsupported draft material for review.

Build a licensed, tenant-safe evaluation corpus across English, Hindi, Marathi and Urdu. Score entity/number/quote preservation, translation adequacy, summary factuality, unsupported assertions, source fidelity, ranking usefulness, editor acceptance, cost and latency by language/task. Human native-language review is necessary. Use regression cases for misinformation, duplicated wire reports, injected instructions and stale source updates. Statistical thresholds and minimum sample size are set before a model enters production; no numerical quality guarantee is invented here. Governance/evaluation should follow documented risk ownership rather than informal confidence ([NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)).

Production gate: approved data-processing terms, source-use rights, language/task evidence, failure behavior, spend limits and schema/command isolation. An AI outage must never turn mandatory preflight green or block retrieval of an already released archive. UI-first uses deterministic fixture suggestions and simulated failures, with no live inference.
