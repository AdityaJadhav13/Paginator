# Developing Pageinator

## Layout
| Path | What |
|---|---|
| `apps/web` | The React application (`@pageinator/web`) |
| `apps/api` | The API (`@pageinator/api`, Fastify; its layout: docs/product/10-l2-newsroom-plan.md §2.1) |
| `packages/*` | Engine packages (`@pageinator/pyshim`, and from M1 `harfbuzz`, `fonts`, `shape`, `hyphenate`, `compose`, `headline`, `document`, `pdf`, `kernel`) |
| `packages/contracts` | Zod schemas shared by the API and the web app (not a kernel package): the error envelope and its codes |
| `tools/testkit` | Test-only helpers: repository paths, Python-flavoured JSONL |
| `tools/ts` | Repository guards: privacy, frozen evidence, dependency graph, oracle manifest |
| `infra/docker` | Local development services (`compose.dev.yml`) and the database's first-start SQL (roles only) |
| `apps/api/src/db` | The API's database: pools, `withTenant`, the migration runner, the migrations, and `schema.gen.ts` (generated) |
| `tools/oracle/v0` | **Frozen** Python reference oracle (never edited) |
| `tools/desk` | **Pageinator Desk**: the owner's internal, local layout desk on the Phase-0 engines (not the product; see its README) |
| `experiments/phase0`, `fixtures/typeset/v1` | **Frozen** Phase-0 evidence and golden vectors (changes need the `evidence-change` approval) |
| `docs/product` | The product specification and build plan |
| `docs/architecture/v2` | Architecture, gates G0–G7 and ADRs (ADR-023: TS kernel with a Python oracle; ADR-024: units; ADR-025: the L2 backend, proposed) |

## Setup
1. Node 24 LTS (`.nvmrc`):
   ```sh
   nvm install && nvm use
   ```
2. pnpm 11.20.0 (`packageManager` in `package.json`):
   ```sh
   npm i -g pnpm@11.20.0
   ```
   You can use corepack instead.
3. Install:
   ```sh
   pnpm install
   ```
   This also points git at the tracked hooks (`git config core.hooksPath .githooks`), so the privacy guard runs
   before every push. It leaves an existing `core.hooksPath` alone, with a warning.

## Everyday commands
| Command | Does |
|---|---|
| `pnpm run ci` | Everything CI runs: guards, dependency graph, lint, format check, typecheck, tests, web build |
| `pnpm test` | All tests but the database's: web (jsdom), kernel (node), api with the shared contracts (node) |
| `pnpm run test:db` | The API's database and tenancy tests (`apps/api/test/db`, `apps/api/test/tenancy`) on the local Postgres, and one email through Mailpit (`pnpm dev:up` first). Each file works in a clone of a freshly migrated template database; the run drops them all. It reads `.env.dev`, and fails, never skips, without them |
| `pnpm run typecheck` | `tsc -b` (TypeScript 7) for packages, plus the web app's own typecheck |
| `pnpm run lint` / `pnpm run format` | ESLint (with the kernel determinism rules) and Prettier |
| `pnpm --filter @pageinator/web dev` | Run the web app on `http://127.0.0.1:5180`, with `/api` passed on to the API (`http://127.0.0.1:8780`, or the address in `PGN_DEV_API`), so the browser sees one origin as in production. It signs in against the real API; component tests use the test double in `apps/web/src/mocks` |
| `pnpm --filter @pageinator/api dev` | Run the API on `http://127.0.0.1:8780` (`/healthz`, `/readyz`), restarting on changes, with the settings of `.env.dev`. Its settings (`PGN_*`) are read and checked by `apps/api/src/config.ts`: the database's place (`PGN_DB_HOST`, `PGN_DB_PORT`, `PGN_DB_NAME`, by default the local Postgres) and the passwords of `pgn_app`, `pgn_auth` and `pgn_listen`, which have no default; the sign-in secret `PGN_AUTH_SECRET` (no default) and the public origin `PGN_PUBLIC_ORIGIN` (by default the first of `PGN_ALLOWED_ORIGINS`); email through `PGN_SMTP_HOST`, `PGN_SMTP_PORT`, `PGN_SMTP_TLS` and `PGN_MAIL_FROM` (by default Mailpit on 127.0.0.1:51025). Behind any proxy, `PGN_TRUST_PROXY` must name it |
| `pnpm --filter @pageinator/api db:migrate` | Applies the pending migrations (`apps/api/src/db/migrations`, forward only) as `pgn_migrator` acting as `pgn_owner`; needs `PGN_MIGRATOR_PASSWORD` (from `.env.dev` when it exists; the environment wins) |
| `pnpm --filter @pageinator/api db:identity-schema` | Prints the SQL Better Auth needs to bring schema `identity` up to date for our configuration (`src/modules/identity/auth.ts`): after a Better Auth upgrade or a new plugin, keep it in `apps/api/src/db/identity/` and run it from a new migration. `pnpm run test:db` fails while Better Auth expects something no migration made |
| `pnpm --filter @pageinator/api db:codegen` | Rewrites `apps/api/src/db/schema.gen.ts` from the migrated database; with `--check` it only fails when the file differs. `pnpm run test:db` makes the same comparison |
| `pnpm run guard` | Privacy guard, frozen-evidence guard and oracle check. Locally, on a branch stacked on another, set `GUARD_BASE=origin/<base>` |
| `pnpm run check:oracle` | The frozen oracle: its manifest's SHA-256s, and every tracked file against `tools/ts/oracle-files.json` |
| `pnpm run test:private` | Private parity tests against pilot goldens (needs `PAGEINATOR_PRIVATE_GOLDENS`; fails, never skips, when missing) |

## Local services
The database, the S3 store and the mail catcher run in Docker as the compose project `pageinator`
(`infra/docker/compose.dev.yml`). Before the first start, copy `.env.dev.example` to `.env.dev` (git-ignored) and
replace every placeholder. All three scripts read it, `dev:down` and `dev:reset` included: compose refuses to run while a
setting is missing or empty.

| Command | Does |
|---|---|
| `pnpm dev:up` | Starts the services and waits until each one reports healthy |
| `pnpm dev:down` | Stops them; the data stays in this project's volumes |
| `pnpm dev:reset` | Deletes this project's volumes (all local development data), then starts again. Needed after changing a database password or `infra/docker/postgres-init.sql` |

Every script passes `-p pageinator`, so no command reaches another project's containers or volumes, plus
`--env-file .env.dev` and `-f infra/docker/compose.dev.yml`. Pass all three when you run `docker compose` yourself. All
ports listen on 127.0.0.1 only:

| Service | Address | Notes |
|---|---|---|
| Postgres 18.6 (`db`) | `127.0.0.1:55432`, database `pageinator` | On the first start, `infra/docker/postgres-init.sql` makes the roles: `pgn_owner` and the logins `pgn_migrator`, `pgn_app`, `pgn_auth` and `pgn_engine` (docs/product/10-l2-newsroom-plan.md §3.1), and `pgn_listen` (ADR-025, plan §10 row 5). The schemas come with the migrations (`pnpm --filter @pageinator/api db:migrate`). It reports healthy only once that SQL has finished |
| SeaweedFS 4.48 S3 (`s3`) | `http://127.0.0.1:58333` | Accepts only the key pair in `.env.dev`; it reports unhealthy if it would let an unsigned request in |
| Mailpit 1.31.6 (`mail`) | web `http://127.0.0.1:58025`, SMTP `127.0.0.1:51025` | Catches every email |

The ports keep clear of 5432 (a native Postgres), 5433 (another local project), 8765 (the Desk) and Vite's 5173.

## Supply chain
- **Every dependency is pinned exactly** in the `pnpm-workspace.yaml` catalog (`pnpm run check:graph` refuses ranges),
  and every installed package must have an allowed licence (`pnpm run check:licences`).
- **No version younger than 7 days.** `minimumReleaseAge: 10080` (minutes) in `pnpm-workspace.yaml` makes pnpm refuse
  any version, direct or transitive, published less than 7 days ago. Every install also re-checks the lockfile against
  the rule, `--frozen-lockfile` included, so a fresh version cannot slip in through a lockfile made elsewhere.
  `minimumReleaseAgeIgnoreMissingTime: false` makes a registry answer without publish times fail the install, instead
  of letting the package through unchecked.
- **An exception** (a security fix needed at once, for example) is an entry in `minimumReleaseAgeExclude`:
  - exact versions only, `name@1.2.3` (several: `name@1.2.3 || 1.2.4`). A bare name would switch the rule off for that
    package for good, so it is never used;
  - each entry carries a comment: why it is needed, when the version was published, and the date after which the
    entry can go;
  - it is reviewed like code, and listed in `docs/product/11-fix-before-launch.md` until it is removed.

## Rules that keep the engine trustworthy
- **Kernel packages are deterministic.**
  - Every package under `packages/` is a kernel package unless `tools/ts/workspace.json` lists it as a browser or
    shared package. Kernel packages never depend on browser or shared packages, and no package depends on an app
    (`tools/ts/check-graph.ts` checks the manifests; ESLint checks what kernel code imports).
  - No clock, randomness, I/O, `Math.pow`/`log`/`round`, `**`, default `sort()`, locale or Unicode-table functions
    (`toLowerCase`, `trim`, `normalize`, `localeCompare` …), `\s` or `\p{…}` in regular expressions, or regular
    expressions built at run time.
  - Use `@pageinator/pyshim` for Python semantics (its Unicode 14 tables come from the goldens).
  - ESLint enforces this; `tools/ts/test/eslint-rules.test.ts` pins every rule. A rule may be disabled only with a
    description that cites an ADR.
- **The Python oracle is the reference.**
  - Golden vectors change only through `tools/goldens/v1` generators, with a changelog entry and human approval.
  - The oracle runs in its own environment: `tools/oracle/v0/.venv`. Never upgrade its Python (3.11.14).
- **The repository is public.** Pilot content, fonts, colour profiles, artwork and review answers live in `~/PageinatorPrivate`, never here.
  - The privacy guard (`tools/ts/guard-private.ts`) runs before every push and in CI. It checks the working tree,
    the index, and every blob of every commit being pushed, so a file committed and then deleted is still caught.
  - Fonts, images and PDFs need their SHA-256 in `tools/ts/guard-allowlist.json`. Colour profiles, design files,
    archives and office documents are never allowed, nor is anything in a `logos/` directory.
  - Private terms: locally `~/PageinatorPrivate/denylist.txt`; in CI the `PAGEINATOR_DENYLIST` secret, which must be
    set (an empty secret fails the job). The scan reads UTF-8, UTF-16 and gzip content and compares NFC forms.
  - Ignored files (`Logos/`, `node_modules/`) cannot be committed without `git add -f`; a force-added file is checked.
- **Every substantial change gets two independent checks:** a code review and a verification.
