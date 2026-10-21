# Fix before launch: the minor findings

> Written for: the owner and the engineers or agents who build Pageinator.
> Status: open list, started 2026-10-21. Every item is fixed before the product launches.

## How this list is used

The owner decided on 2026-10-21:
- each feature gets **one code review and one independent verification**;
- a blocking finding is fixed before the feature is committed:
  - print safety;
  - lost or wrong work;
  - security or privacy;
  - a claim that is not true;
- every other finding is written here and fixed at the end, before launch;
- **an item leaves this list only when it is fixed and a test shows the fix** (or it is shown not to be a problem).

## Desk (`tools/desk`)

| # | Where | What | Why it can wait |
|---|---|---|---|
| DESK-1 | `deskserver/store.py`, `editing.py`, `api.py`; `engine/deskcommon.py`, `deskprinted.py`, `desk_engine.py` | The last fixes of the Desk's review have no test of their own yet, so a later change could undo them unnoticed:<br>• an unparseable ads index gives the recovery message;<br>• a save while `edition.json` cannot be read marks the page "could not be checked" (not a 500);<br>• the not-placed count is left as it was when the articles cannot be read;<br>• a request body nested beyond reason is a 400;<br>• the engine names a damaged file in plain words, in a layout, in the editor's Update text and in Import sample;<br>• `read_json` and `ad_elements` treat a deeply nested file as damaged, and `run_pictures` refuses a damaged ads index | Each was checked by hand; print safety does not depend on them (a page is never offered as current while a file cannot be read) |
| DESK-2 | `GET /api/editions` | An edition whose `articles.json` is damaged is listed with "0 articles" instead of "cannot be read" | Opening the edition says it is damaged, and nothing is laid out from it |
| DESK-3 | `static/editor.js` `resync()` | After a refused request on an unchanged page, the save-state label goes blank | Cosmetic |
| DESK-4 | `engine/desk_engine.py` edit service | Error messages have quotes stripped from both ends (`strip("'")`), which can eat a quote that belongs to the message | Cosmetic |
| DESK-5 | `engine/deskcommon.py` `error_text` | Unexpected errors are still shown with their Python class name (for example `KeyError: …`). Damaged files are now said in plain words | Rare; the message is still true |
| DESK-6 | `deskserver/press.py` `DAMAGED` | When a file cannot be read, the advice is "put the file back from a backup, or lay the edition out again". A new layout fails until the file is back, so the advice could name the file | The page is never offered as current meanwhile |

## Licence check (`tools/ts/check-licences.ts`)

| # | What | Why it can wait |
|---|---|---|
| LIC-1 | The last fix has unit tests, but has not been re-run against the reviewer's real pnpm bypass cases. The fix checks installed links against pnpm's own record of the workspace, and refuses `excludeLinksFromLockfile`, `patchedDependencies` and a `.pnpmfile`. The bypass cases were:<br>• forged snapshot links;<br>• a fake importer;<br>• a trailing-space importer key;<br>• `sharedWorkspaceLockfile: false`;<br>• links left out of the lockfile;<br>• a patch | Every one of these needs a hand-edited lockfile or a deliberate setting in our own repository; no dependency can do it by itself |
| LIC-2 | Some rules have no test that would notice their loss (found by the reviewer's mutation run):<br>• the column-0 key rule;<br>• the sibling-folder prefix check;<br>• walking each importer's `node_modules`;<br>• unquoting `''`;<br>• `injected` and `publishDirectory` values;<br>• lines before the first importer | The rules work today; the tests protect later changes |
| LIC-3 | False alarms, all of which fail the build rather than pass it:<br>• folder names with `#` or `:`;<br>• a package installed from a remote tarball, refused as "not installed here" (a misleading message);<br>• `configDependencies`, refused as "more than one YAML document" | None of these is used in the repository |
| LIC-4 | Not covered:<br>• packages bundled inside another package (`bundledDependencies`);<br>• the Python environments: pikepdf (MPL-2.0) and Pillow (MIT-CMU) need review before the hosted engine worker (L2.2) | Documented in the checker and in 09 §1; L2.2 is not built yet |

## L2 (`apps/api`, `infra`)

| # | Where | What | Why it can wait |
|---|---|---|---|
| L2-1 | `apps/api/test/tenancy/checks.ts` (a), ownership | The login-role ownership check reads `pg_shdepend`, which covers every database of the server: scope it to the current database, or document it | It can only report too much, never too little |
| L2-2 | `checks.ts` (a) | No catalog check that the append-only tables keep their triggers (`audit_event`'s `append_only` and `append_only_truncate`) | `test/db/directory.test.ts` tests the triggers' behaviour |
| L2-3 | `checks.ts` (b) | Table names are put into the SQL unquoted (`from ${t}`) | The names come from our own test databases; one that needed quotes would make the check fail, not pass |
| L2-4 | `eslint.config.js`, the `src/db` boundary | The import ban misses `await import()` and `createRequire`, and nothing bans Kysely's `eb.fn("set_config")` or `executeQuery` outside `src/db`: also ban `set_config` and `app.*` names there | No module outside `src/db` uses the database yet (the first ones arrive with PR 9) |
| L2-5 | `src/db/tenant.ts`, `pools.ts` | Session-level state made inside `fn` (`SET`, `set_config(…, false)`, `PREPARE`) outlives the transaction on a pooled connection: reset it when a connection is released, or document it | `withTenant` sets all four context settings at the start of every transaction, so a leftover never reaches the walls; nothing uses session-level state |
| L2-6 | `eslint.config.js`, `apps/api` | No type-aware `no-floating-promises` or `no-misused-promises` | The tests cover the flows; it needs a typed lint setup |
| L2-7 | `app.*` tables, future services | Global primary keys plus `ON CONFLICT DO NOTHING` let an insert tell whether another organisation's known id exists: generate ids on the server only, never take a client's id for a new row | Ids are random UUIDs, and no endpoint creates rows yet |
| L2-8 | migration `2026_11_01_0002_directory` | No CHECK on `org_settings.mfa_required_roles` or `publication.timezone` | Nothing writes them yet; PR 9 validates them in `packages/contracts` |
| L2-9 | Postgres `NOTIFY`/`LISTEN` | Any login role can `NOTIFY` or `LISTEN` on `app_events`: treat payloads as untrusted hints carrying ids only (PR 19) | Nothing listens yet |
| L2-10 | Postgres rights | `pgn_app` can take `LOCK TABLE … ACCESS EXCLUSIVE` on its tables (record it in the threat model) | It affects availability only, and needs SQL run as `pgn_app` |
| L2-11 | `src/db/pools.ts` `ping`, `src/http/health.ts` | `ping` can wait 5 s (the connection timeout) while `/readyz` gives up at 2 s, and the errors it swallows are not logged | `/readyz` still answers within 2 s |
| L2-12 | `apps/api/package.json` `dev` | `dev` loads the whole `.env.dev` (the superuser, migrator and S3 secrets too) into the API process | Development only; the API reads only its own settings |
| L2-13 | `src/db/migrate.ts` | No `lock_timeout` for DDL in migrations (deploy, PR 25) | Development databases have no concurrent load |
| L2-14 | `src/db/codegen.ts` `render()` | Column names are written unquoted | Our columns are snake_case; one that needed quotes would fail the typecheck, not pass silently |
| L2-15 | `test/db/global-setup.ts` | A killed `pnpm test:db` run leaves its `pgn_test_*` databases: drop stale ones at the start | The development server only; `pnpm dev:reset` clears them |
| L2-16 | the database's rights | `lo_create` is open to `pgn_app` through PUBLIC, and large objects have no row-level security: revoke it from PUBLIC | Nothing stores large objects |
| L2-17 | `checks.ts` (b) | (b) cannot see a permissive policy for UPDATE only or DELETE only, because its statements use WHERE, so the SELECT policies apply | (a) reports every permissive policy beside `org_wall` |
| L2-18 | `src/db/tenant.ts` | `withTenant` accepts non-string ids that turn into a UUID as text (`[X]`, sparse arrays, a changing `toString`): check `typeof`, and build the SQL from the checked copy | Callers pass strings from Zod-validated requests; JSON cannot carry such values |
| L2-19 | `src/db/migrate.ts` | A refused migration run on a fresh database can leave an empty `migrations` schema | Cosmetic; the next run uses it |
| L2-20 | Postgres catalog | `pg_class.reltuples` shows `pgn_app` approximate row counts across all organisations | Counts only, never content |
| L2-21 | `src/db/pools.ts` `ping` | `/readyz` does not check `pgn_listen` (as documented) | Nothing listens until PR 19 |
| L2-22 | `pnpm-workspace.yaml` catalog (L2-C) | Upgrade nodemailer to ≥ 10.1.4 (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h) once it is 7 days old, before any real email is sent (PR 25 at the latest) | Development sends only to Mailpit, and a strict check guards every recipient address |
