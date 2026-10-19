# ADR-007: Modular monolith on Fastify, Kysely, Postgres RLS, Graphile Worker

**Post-review status (2026-10-07):** **ACCEPTED:** modular monolith, PostgreSQL, a Postgres-backed queue until the thresholds in `15` §8, RLS as defence-in-depth with the tenancy proof tests. **IMPLEMENTATION DETAIL, pending baseline O3:** Fastify, Kysely, Graphile Worker (Procrastinate if the backend is Python).

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED. Concretises OP11 and OP12.

## Decision
- **API.** Fastify with Zod contracts, generating an OpenAPI spec and a typed client.
- **Database access.** Kysely (explicit SQL) with codegen types.
- **Modules.** Each module owns its tables. Other modules reach it only through its public service interface or through outbox events.
- **Tenant isolation.**
  - The app connects as a non-owner role. Every tenant table has `FORCE ROW LEVEL SECURITY`.
  - Every transaction runs `SET LOCAL app.org_id` inside a `withTenant` wrapper. The wrapper is the only database entry point, and lint enforces this.
  - Publication-level authorization is checked in the service layer.
- **Jobs.** Graphile Worker runs on Postgres. A transactional outbox and `job_key` idempotency prevent lost or duplicated jobs. There are separate worker pools for interactive, batch and ingest work. **No Redis** until a measured need appears.
- **Postgres extensions.** pg_trgm and pgvector are added when search arrives. OpenSearch is deferred (DF04).
