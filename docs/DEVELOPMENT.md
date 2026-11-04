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
4. For the Desk and `pnpm run test:desk` only: its two Python 3.11.14 environments, built with uv as CI builds them.
   `tools/desk/requirements.lock` holds the exact versions of `experiments/phase0/pdfx1/requirements.txt`, with hashes.
   ```sh
   uv venv --python 3.11.14 experiments/phase0/pdfx1/.venv
   uv pip install --python experiments/phase0/pdfx1/.venv --require-hashes -r tools/desk/requirements.lock
   uv venv --python 3.11.14 tools/oracle/v0/.venv
   uv pip install --python tools/oracle/v0/.venv --require-hashes -r tools/oracle/v0/requirements.lock
   ```

## Everyday commands
| Command | Does |
|---|---|
| `pnpm run ci` | Everything CI runs except the oracle's tests and the Desk's (`pnpm run test:desk`): guards, dependency graph, lint, format check, typecheck, tests, web build |
| `pnpm test` | All tests but the database's and the Desk's: web (jsdom), kernel (node), api with the shared contracts (node) |
| `pnpm run test:db` | The API's database and tenancy tests (`apps/api/test/db`, `apps/api/test/tenancy`) on the local Postgres, one email through Mailpit, and photo uploads on SeaweedFS in a bucket of the run's own (`pnpm dev:up` first). Each file works in a clone of a freshly migrated template database; the run drops them all. It reads `.env.dev`, and fails, never skips, without them. The story bundle's round trip imports into a throwaway Desk home with the Desk's Python: `experiments/phase0/pdfx1/.venv/bin/python`, or the one `PAGEINATOR_DESK_PY` names (a worktree without that venv points it at the main tree's) |
| `pnpm run typecheck` | `tsc -b` (TypeScript 7) for packages, plus the web app's own typecheck |
| `pnpm run lint` / `pnpm run format` | ESLint (with the kernel determinism rules) and Prettier |
| `pnpm --filter @pageinator/web dev` | Run the web app on `http://127.0.0.1:5180`, with `/api` passed on to the API (`http://127.0.0.1:8780`, or the address in `PGN_DEV_API`), so the browser sees one origin as in production. It signs in against the real API; component tests use the test double in `apps/web/src/mocks` |
| `pnpm --filter @pageinator/api dev` | Run the API on `http://127.0.0.1:8780` (`/healthz`, `/readyz`), restarting on changes, with the settings of `.env.dev`. Its settings (`PGN_*`) are read and checked by `apps/api/src/config.ts`: the database's place (`PGN_DB_HOST`, `PGN_DB_PORT`, `PGN_DB_NAME`, by default the local Postgres) and the passwords of `pgn_app`, `pgn_auth` and `pgn_listen`, which have no default; the sign-in secret `PGN_AUTH_SECRET` (no default) and the public origin `PGN_PUBLIC_ORIGIN` (by default the first of `PGN_ALLOWED_ORIGINS`); email through `PGN_SMTP_HOST`, `PGN_SMTP_PORT`, `PGN_SMTP_TLS` and `PGN_MAIL_FROM` (by default Mailpit on 127.0.0.1:51025). The public website's contact form emails to `PGN_CONTACT_TO` (one plain address; optional: unset, the form answers 503 `contact_unavailable`; in production the owner's choice at deploy, never committed). Behind any proxy, `PGN_TRUST_PROXY` must name it. Request limits: `PGN_RATE_LIMIT_PER_MINUTE` (signed out, per address, 60), `PGN_RATE_LIMIT_PER_PERSON_PER_MINUTE` (signed in, 300) and `PGN_RATE_LIMIT_SIGNED_IN_PER_ADDRESS_PER_MINUTE` (6,000). The page editor calls the edit gateway at `PGN_GATEWAY_URL` (e.g. `http://127.0.0.1:8790`), signing each call with `PGN_GATEWAY_SECRET` (64 or more lower-case hex characters, the gateway's own); both optional and set together: unset, the editor's routes answer 503 `editor_unavailable`. A release copies its page PDFs to the archive bucket `PGN_S3_ARCHIVE_BUCKET` (by default `pgn-dev-archive`) under Object Lock, governance mode, for `PGN_ARCHIVE_RETAIN_DAYS` days (by default 3653, ten years: owner decision D-20) |
| `pnpm --filter @pageinator/api db:migrate` | Applies the pending migrations (`apps/api/src/db/migrations`, forward only) as `pgn_migrator` acting as `pgn_owner`; needs `PGN_MIGRATOR_PASSWORD` (from `.env.dev` when it exists; the environment wins) |
| `pnpm --filter @pageinator/api db:identity-schema` | Prints the SQL Better Auth needs to bring schema `identity` up to date for our configuration (`src/modules/identity/auth.ts`): after a Better Auth upgrade or a new plugin, keep it in `apps/api/src/db/identity/` and run it from a new migration. `pnpm run test:db` fails while Better Auth expects something no migration made |
| `pnpm --filter @pageinator/api bootstrap-org --owner-name … --owner-email … --org-name … --org-slug … --pub-name … --pub-slug … --languages mr,en --primary mr --digits devanagari` | Makes an organisation, its first publication and its Owner (`src/modules/people/bootstrap.ts`). The Owner gets two emails (in development, Mailpit): confirm the address, and choose a password. Two-step sign-in is required of Owners and Admins before any organisation route answers (`app.org_settings.mfa_required_roles`) |
| `pnpm --filter @pageinator/api db:codegen` | Rewrites `apps/api/src/db/schema.gen.ts` from the migrated database; with `--check` it only fails when the file differs. `pnpm run test:db` makes the same comparison |
| `pnpm --filter @pageinator/api dev-buckets` | Makes the development buckets on SeaweedFS (`pgn-dev-work`, versioned, with lifecycle rules for `uploads/`: a file left there expires after a day and its old versions a day later, which SeaweedFS accepts but was not seen to carry out; `pgn-dev-archive`, with Object Lock). It makes a bucket only when it is missing, and sets the work bucket's versioning and rules each time. Photo uploads need it once after `pnpm dev:up` (`apps/api/scripts/dev-buckets.ts`) |
| `pnpm run guard` | Privacy guard, frozen-evidence guard and oracle check. Locally, on a branch stacked on another, set `GUARD_BASE=origin/<base>` |
| `pnpm run check:oracle` | The frozen oracle: its manifest's SHA-256s, and every tracked file against `tools/ts/oracle-files.json` |
| `pnpm run test:private` | Private parity tests against pilot goldens (needs `PAGEINATOR_PRIVATE_GOLDENS`; fails, never skips, when missing) |
| `pnpm --filter @pageinator/web demo` | **The local demo**, in one command (`apps/web/e2e/demo.ts`): the phone smoke's stack below (Postgres, SeaweedFS, Mailpit, the API, the engine's queue, the page editor's edit gateway and Vite, with one fictional organisation), left running until Ctrl-C, which removes it with its volumes. Same settings as the smoke (`PGN_E2E_WORKER_PY`, `PGN_E2E_PORT_BASE`; for real layouts and the page editor also `PGN_ENGINE_PYTHON`, the engine environment's Python from `tools/oracle/v0/requirements.lock`) |
| `pnpm --filter @pageinator/web e2e` | **The phone smoke** (L2.1, `apps/web/e2e/smoke.e2e.ts`; Playwright, Chromium): the Owner at 390 × 844 confirms the address and chooses a password from the emails, turns on two-step sign-in and signs in again with a code; invites a Reporter (360 × 800), who makes an account from the email and files a story with a photo; the engine's queue converts the photo with the real Python runner; the Owner's list hears it live, the Owner comments and sends it back, which the Reporter sees live; it is sent again; the Owner makes the edition on the Editions screen, puts the story in it from the editor, marks it ready, and "Send to the Desk" downloads a ZIP the Desk's own code (`apps/api/test/support/desk_roundtrip.py`) opens and imports. It starts and removes a stack of its own (`apps/web/e2e/stack.ts`: compose project `pgn-e2e-62000` on ports 62025–62780 with random secrets, never `.env.dev` or the `pageinator` project; the API, the queue and Vite as processes). Needs Docker, the Chromium headless shell once (`pnpm --filter @pageinator/web exec playwright install --only-shell chromium`), `PGN_E2E_WORKER_PY` (the engine worker's venv Python, from `apps/engine-worker/requirements.lock`), the Desk's Python (`PAGEINATOR_DESK_PY`, as for `test:db`) and a CMYK profile (`PGN_E2E_ICC`; macOS's Generic CMYK by default, never the newsprint one). It runs on a developer's machine only: CI does not install browsers until the owner decides on the Playwright browser licences |
| `pnpm run test:desk` | The Desk's tests (fictional data only): server and Word import in `experiments/phase0/pdfx1/.venv`, engine in `tools/oracle/v0/.venv`, the page editor's view arithmetic in Node. CI's `desk` job runs the same three commands |

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
