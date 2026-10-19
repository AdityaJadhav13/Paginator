# Phase 16 — Repository and development architecture

Prepared 2026-09-16. Inputs: Phases 2, 14 and 15 read from disk. This is a proposed future organization, not permission to create source directories or initialize tools during this program. Existing Phase 1–11 drafts are preserved except evidence-based corrections during final review.

## Eventual repository shape

| Proposed area | Responsibility / boundary |
|---|---|
| `frontend/` | Browser product; app/router/providers, accessible UI/layout components, feature folders, service adapters, fixture scenarios and local editor state |
| `backend/` | Modular application: access, publications, content/rights, editions/documents, production/archive, commercial operations; API contracts and transactional commands |
| `workers/` | Job entrypoints for ingestion, media, resolve/export/preflight; reuse backend policies/contracts, isolate hostile parsers |
| `publishing/` | Chosen engine runtime, document/geometry/composition adapters, typography and writer boundaries; no dependency on web framework |
| `schemas/` | Canonical versioned document/job/API interchange definitions; one owner per schema; generated artifacts identified |
| `tests/` | Cross-module integration/E2E, licensed fixtures, typography/layout/PDF goldens, recovery/security/performance cases; small unit tests may live with modules |
| `specs/` | Master-linked feature specs, acceptance criteria, bounded implementation context and initial backlog |
| `docs/architecture/`, `docs/research/`, `docs/reviews/` | Decisions/evidence/reviews and product rationale |
| `docs/adr/` | Future architecture decision records for actual selections and supersession; not created here |
| `infra/` | Future environment/deployment/IaC, secrets references and monitoring configuration; no plaintext credentials |

A monorepo is RECOMMENDED for coherent contracts and tests, not a mandate for a shared package manager or language. Only create directories when their work starts. UI-first initially needs frontend plus specs/docs/tests appropriate to that slice, not empty backend/worker/engine scaffolding. Native publishing may use a language-specific build invoked through a documented adapter; do not make every frontend developer build the entire native toolchain.

## Contracts and dependency policy

Version physical-document schemas independently of UI DTOs. Keep durable IDs, explicit units and unknown-version handling. When backend runtime is selected, choose a single API contract authority (for example backend-generated OpenAPI or schema-first); generated clients are reproducible outputs, not manually edited copies. Package boundaries follow domain ownership and actual reuse. Prevent workers from bypassing tenant/rights checks through direct unscoped table writes.

Dependencies require registry review, pinned versions, license/notice compliance, provenance and appropriate security tests. Keep external projects upstream; prefer packages/bindings/adapters over source vendoring. A justified future fork requires a separately reviewed maintenance/license plan. Do not create a custom queue, identity system, ICC engine or Unicode shaper. Do build newspaper constraints, document commands and provenance/approval semantics.

## Feature workflow

Product intent → master spec and decision status → one feature spec → one feature branch → targeted context → implementation → automated verification → independent AI review → human review → authorized commit → merge.

Preserve **ONE COHERENT FEATURE / ONE FEATURE SPEC / ONE FEATURE BRANCH / ONE FRESH AGENT SESSION**. A feature is a reviewable behavior with acceptance criteria, not an entire product module. Split a feature before implementation when its scope no longer fits one coherent change. Research experiments have their own bounded specs and do not quietly become production code.

Each feature spec supplies objective, relevant requirement/decision IDs, scope/non-goals, dependency prerequisites, explicit initial files/directories, mock/real boundary, contracts, error/security behavior, acceptance tests and unresolved decisions. Agents read those files first and expand only along necessary imports/contracts. No default whole-repository scan. Preserve user changes; do not make unrelated formatting/framework or dependency upgrades.

The independent reviewer receives the feature spec, targeted diff, relevant contracts and test evidence, checks boundary violations and reports findings without editing the implementation. “Independent AI review” is a future development requirement, not a claim that this architecture program used another model. Human review remains responsible for product behavior and risk. Commits/merges follow explicit session/repository authority; none are performed in this program.

## Verification and delivery

Use existing source-control/CI providers; GitHub Actions is a candidate, not custom infrastructure. UI work requires type/build checks plus behavioral and accessibility tests appropriate to changed flows. Backend work adds contracts/authorization/integration checks; engine changes add approved typography/layout/PDF corpus checks. Lockfile changes trigger dependency/license review. Golden changes require explanation and independent approval.

Maintain separate local/staging/production environments, seeded licensed fixtures, reversible deploys and migration/recovery plans. Feature flags cannot bypass mandatory print validation. Deployments record engine/schema/profile compatibility; old releases retain original artifacts. Heavy tests can run in dedicated CI jobs, but required production gates cannot be replaced by an unchecked label. Developer setup must document which gates were not run and why.

Do not create CLAUDE.md or AGENTS.md at this stage. Future agent guidance, if later authorized, should reference the master/feature specs and protected invariants without copying every document into every session.
