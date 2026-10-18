# ADR-009: Task-typed AI behind a provider adapter

**Post-review status (2026-10-07):** **ACCEPTED** for the abstraction and the suggestion-only outputs. Model names are an implementation detail. **Added:** AI never runs inside the generation search loop (ADR-005) and never on the production critical path (ADR-020). The capability classification is in `15` §7.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED. Revises DF06: a second provider becomes a fallback only.

## Decision
- **Task contracts.** Every AI capability is a versioned task with:
  - a Zod schema for input and output;
  - a versioned prompt file;
  - a model route (configuration, not code);
  - an evaluation set;
  - a cache policy;
  - a data class.
- **Providers.** Anthropic is the default:
  - Sonnet 5.5 for editorial work;
  - Haiku 4.5 for classification and enrichment.

  One secondary provider is kept as a fallback.
- **Records.** Every call writes an `AIInvocation` row: tokens, cost, prompt version, model and latency. Calls are metered against each organization's entitlements.
- **Output is always a `Suggestion`.** A suggestion changes the document only after a human accepts it, which turns it into a Command.
- **Prompt injection.** Ingested text is treated as delimited data, and the model gets no write tools.
- **Fit loop.** Headline and trim tasks are checked by the composition engine. A candidate that does not fit is never shown to the user.
