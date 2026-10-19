# 03 — Target Architecture

> **Second-pass review, 2026-10-07.** Superseded where it conflicts with `20_ARCHITECTURE_BASELINE.md`:
- The `packages/compose|render|pdf|preflight` TypeScript layout is **conditional** on EXP-ENGINE.
- The browser renders display lists from a single kernel (ADR-017). The browser compose worker in the diagram exists only if client composition is proven necessary.
- AWS, ECS, OpenTofu and Fastify are hypotheses or details. Status vocabulary: ADR-021. Baseline: `20`.


Status: DECIDED unless marked otherwise. The detailed reasoning for each decision is in `ADR/`.

## 1. If we were starting from scratch today

An experienced team building Pageinator new would pick an architecture with these properties:

1. **One deterministic composition engine.** It runs in the browser (for interactive work) and on the server (as the authority), from the same code and the same WASM binaries. This is how Figma, Google Docs and Canva-class editors avoid "preview ≠ output".
2. **A strict intent → resolution → output pipeline.** The EditableDocument is composed into a ResolvedDocument. Preview, PDF, e-paper and preflight all read the ResolvedDocument.
3. **Commodity infrastructure, owned semantics.** Mature libraries handle shaping, segmentation, colour conversion, image processing, queues, auth and storage. Pageinator owns only newspaper semantics: columns, packages, copyfit, jumps, flatplans, ads, preflight policy and generation.
4. **A modular monolith with a separate worker tier.** One deployable API and one worker image. The modules have hard boundaries so they can be split into services later.
5. **Postgres as the system of record**, with row-level security. Object storage holds binaries. Queue, search and vectors live inside Postgres until there is a measured reason to move them.
6. **AI as a typed, auditable suggestion service.** It never has authority over geometry, rights or release.

Comparison with what exists (see `02`):
- The current repo already holds decisions 2, 5 and 6 in its register (D02, D03, D04, D07).
- The old Python stack holds the best implementation of the core of decision 1.
- Nothing contradicts this ideal architecture, so we adopt it and port into it, rather than building around legacy code.

## 2. System diagram

```
                         ┌──────────────────────── Browser (apps/web) ──────────────────────────┐
                         │ React shell (routes, panels, forms)        ProseMirror story editor  │
                         │      │ commands                                   │ text ops         │
                         │      ▼                                            ▼                  │
                         │ Editor core: command bus · selection · tools · undo · local revision │
                         │      │                                   ▲                           │
                         │      ▼ (postMessage)                     │ resolved pages            │
                         │ Compose worker  [packages/compose + document; harfbuzz.wasm, icu4x]  │
                         │      │                                                               │
                         │      ▼                                                               │
                         │ Render worker (OffscreenCanvas) [packages/render] ─► tiles ─► canvas │
                         └──────┬─────────────────────────────────────────────────────────────┬─┘
                                │ HTTPS (REST + JSON, Zod contracts)        SSE (job progress, │
                                ▼                                             presence)        │
┌──────────────────────────── apps/api (Fastify, modular monolith) ─────────────────────────────┐
│ identity · orgs · publications · editions · content · assets · ads · documents · production  │
│ newsroom · ai · archive · billing · audit · notifications                                     │
│      │ Kysely (SET LOCAL app.org_id; RLS)          │ outbox → Graphile Worker jobs            │
└──────┼──────────────────────────────────────────────┼──────────────────────────────────────────┘
       ▼                                              ▼
┌─────────────┐   ┌──────────────────────────── apps/worker (CPU tier) ──────────────────────────┐
│ PostgreSQL  │◄──│ resolve (compose, authoritative) · generate (layout-gen) · images (sharp/lcms)│
│ RLS, queue, │   │ pdf (packages/pdf) · preflight (rules + qpdf + pdfium + gs) · ingest · ai     │
│ pg_trgm,    │   │ archive packaging · e-paper · press delivery (SFTP)                           │
│ pgvector    │   └──────────────────────────────────────┬───────────────────────────────────────┘
└─────────────┘                                          ▼
                                   ┌──── S3 (ap-south-1) ────┐      ┌── External ──────────────┐
                                   │ originals · renditions  │      │ AI providers (adapter)   │
                                   │ fonts (content-addressed)│     │ Wire/RSS/PIB connectors  │
                                   │ resolved blobs · PDFs   │      │ Press SFTP hot folders   │
                                   │ archive (Object Lock)   │      │ OAuth (Google/Microsoft) │
                                   └──── CloudFront signed ──┘      └──────────────────────────┘
```

## 3. Repository layout (monorepo, pnpm workspaces)

```
/apps
  web/          ← today's frontend/ moves here (React 19, Vite, React Router)
  api/          ← Fastify HTTP; composition root for the modules
  worker/       ← Graphile Worker task runners; Docker image with qpdf, pdfium, gs, libvips
/modules        ← backend domain modules (TS); each one owns its tables and migrations
  identity/ orgs/ publications/ editions/ content/ assets/ ads/ documents/
  production/ (generation, preflight, export, release)  newsroom/  ai/  archive/
  billing/ audit/ notifications/
/packages       ← pure, isomorphic libraries (no I/O). They run in the browser, Node and workers
  contracts/    Zod schemas for the API and events; generated OpenAPI and client
  document/     EditableDocument schema, commands, units, ids, ResolvedDocument types, hashing
  compose/      fonts, itemize, shape (harfbuzzjs), segment (icu4x), bidi, linebreak,
                paragraph, frame flow, overset, metrics cache
  layout-gen/   flatplan, allocate, page-layout candidates, copyfit, score, search
  render/       SceneRenderer interface; canvas2d implementation; glyph path cache; tiles
  pdf/          PDF/X serializer, fonts (hb-subset), images, colour, ad XObjects, marks
  preflight/    rule engine and rules (TXT/FNT/COL/IMG/GEO/ADS/JMP/EDT)
  color/        CMYK, total ink, profile metadata (actual conversion runs in the worker)
  ai/           task definitions, prompt registry, provider adapter interface, evals
/tools
  py-oracle/    frozen copy of old typeset/ + pinned venv; generates golden fixtures (retired after P0)
  fixtures/     golden vectors, sample editions, font corpus manifest, press-accepted PDF corpus
/docs           architecture (this set), knowledge/ (migrated grammar, spec sections, measurements)
/infra          OpenTofu (AWS ap-south-1)
```

**Boundary rules** (enforced by a dependency-cruiser config in CI):
- `packages/*` must not import `modules/*` or `apps/*`. `packages/*` must not do I/O: no fetch, no fs, no DB.
- `modules/X` must not import tables or internals from `modules/Y`. Cross-module work goes through `modules/Y/public.ts` service interfaces or outbox events.
- `apps/web` may import from `packages/*` and `packages/contracts`, but never from `modules/*`.
- `apps/web/src/ui` must not import `apps/web/src/demo` (the existing rule from C).

## 4. Module responsibilities

| Module | Owns | Key operations |
|---|---|---|
| identity | users, auth accounts, sessions, MFA | signup, login, OAuth, verify email, reset password |
| orgs | organizations, memberships, publication grants, invitations, roles | invite, grant, revoke, transfer ownership |
| publications | publication, profile versions (brand, styles, sections, templates, print profile, fonts, zones) | publish a profile version (immutable), font licence check |
| editions | edition, flatplan, zones/variants, page locks, edition status | create from profile, clone for a zone, set page count |
| content | story, story revision, edition story, rights/provenance | import, edit, assign, pin a revision |
| assets | asset, asset revision, renditions, image metadata | upload, scan, derive, DPI/ICC inspection |
| ads | advertiser, booking, artwork, placement constraints | book, upload artwork, normalise and preflight artwork |
| documents | editable document, document revisions, command log, resolved index | apply commands, autosave, revisions, resolve |
| production | generation jobs, preflight runs, export jobs, release state machine | generate, regenerate, preflight, export, release |
| archive | published editions, archive records, retention, legal hold, search index | publish package, retrieve, duplicate, reprint |
| newsroom | content sources, source items, news events, signals, relevance | ingest, cluster, rank, add to edition |
| ai | AI invocations, suggestions, prompt versions, eval runs | run task, accept or reject suggestion |
| billing | plans, subscriptions, entitlements, usage | meter, enforce quota, invoice (Razorpay or Stripe) |
| audit | append-only audit events | record and query |
| notifications | in-app and email notifications | job done, approval requested |

## 5. Runtime topology and deployment (AWS ap-south-1, Mumbai)

| Component | Service | Notes |
|---|---|---|
| Web SPA | S3 + CloudFront | Immutable hashed assets; WASM served with `application/wasm` and long cache lifetimes |
| API | ECS Fargate (2+ tasks) behind ALB | Stateless; SSE for progress |
| Workers | ECS Fargate, separate service; queue-depth autoscaling | Two pools: `interactive` (resolve, small AI) and `batch` (generation, PDF, preflight, ingest, archive) so deadline exports are never starved |
| Database | RDS PostgreSQL 17, Multi-AZ | PITR 35 days; nightly logical dumps to a separate account |
| Object storage | S3 with versioning; separate archive bucket with Object Lock (governance mode) | Lifecycle policy to IA and then Glacier Instant Retrieval for cold archive tiers |
| Secrets | AWS Secrets Manager | — |
| IaC | OpenTofu | Environments: dev, staging, prod |
| Email | SES | — |
| Observability | OTel Collector → Grafana Cloud (traces, metrics, logs); Sentry (errors, front and back) | — |

Indian data residency comes by default, and AWS ap-south-1 gives AI providers a regional route where available (ADR-009).

## 6. Main data flows

1. **Edit loop (interactive).**
   - A user action becomes a `Command`, which is applied to the local EditableDocument.
   - The compose worker re-resolves the affected stories and pages, and the render worker repaints.
   - Commands are batched and sent to `POST /documents/:id/commands` with `baseRevision`.
   - The server applies them, assigns a revision, re-resolves authoritatively in the interactive worker pool, and compares hashes. On a mismatch it emits telemetry and pushes the authoritative pages to the client.
2. **Generate.**
   - `POST /editions/:id/generate` creates a GenerationJob, which goes through the outbox to the batch worker.
   - The worker runs flatplan → allocate → layout → resolve and writes a new DocumentRevision with author `system:generator` and a link to the job.
   - Progress is streamed over SSE.
3. **Export.**
   - `POST /editions/:id/exports {revision}` starts a resolve, unless a resolved blob already exists for that content address.
   - Then preflight runs. If it reports errors, the export is blocked.
   - Otherwise the PDF is written. The ExportArtifact records the revision, resolved hash and bytes hash.
4. **Release.** The release state machine (from C's `PHASE_11`) is extended as follows:
   - deliver to the press over SFTP and record the receipt;
   - build the archive package;
   - store it under Object Lock;
   - index it for search.
5. **Ingest.** Connector job → SourceItem (with rights class) → normalise → dedupe and cluster → signals → relevance → newsroom feed (`09`).

## 7. Cross-cutting decisions

- **IDs.** UUIDv7 for database rows. Content hashes (SHA-256) for blobs, fonts, resolved documents and exports. Stable string IDs inside documents (frames, packages) that are unique within the document.
- **Time.** Store UTC; display in the edition timezone, which defaults to `Asia/Kolkata`. An edition "date" is a local date, not a timestamp.
- **API style.** REST with JSON, validated by Zod. Clients are generated from `packages/contracts`. Mutations accept an idempotency key header. Long operations always run as jobs and return `202` with a job ID.
- **Errors.** A typed error envelope `{code, message, details, traceId}`. User-facing copy lives in the web app, keyed by `code`. This fixes C's practice of putting user-facing copy in the transport types.
- **Feature flags.** A simple table-backed flag service scoped per organisation, so features can be rolled out to the pilot first.
- **Internationalisation of the UI.** UI strings are externalised from P1 so a Marathi/Hindi UI is possible later. The P1 UI is English only.

## 8. What happens to the current frontend (P0 restructure, one PR)

- Move `frontend/` to `apps/web/`. Create `apps/web/src/main.tsx` with a real `AppRoot`. Move the route tree out of `src/demo/ui004/`. Keep the demos behind a `/__demo` route used only in development.
- Keep `src/ui`, `src/app`, `features/auth` (the UX, rewired to real auth in P1), `features/public`, the session race guards, `services/result.ts` (after removing the copy literals) and the scenario controller for UI tests.
- Collapse the per-file regex-loop tests into a single dependency-cruiser rule, plus one test per policy.
- Leave the uncommitted UI005 work on its branch. Only commit and merge it after the founder has reviewed it.
