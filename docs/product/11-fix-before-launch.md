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
| L2-7 | `app.*` tables, future services | Global primary keys plus `ON CONFLICT DO NOTHING` let an insert tell whether another organisation's known id exists: generate ids on the server only, never take a client's id for a new row | Ids are random UUIDs, and no endpoint creates rows yet. The content tables (migrations `2026_11_20_*`) enforce it with `app.server_id`; `publication` and `audit_event` do not yet |
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
| L2-23 | `pnpm-workspace.yaml` `minimumReleaseAgeExclude` | Remove the seven entries after 2026-10-25T21:08Z (each comment gives its own date): they let in versions that were already in the lockfile when the 7-day rule arrived | Each is an exact version; the rule applies to everything else |
| L2-24 | `src/modules/identity/auth.ts` hooks | The per-email lock's 429 is printed by Better Auth's own console logger ("ERROR [Better Auth]: Too many tries"), outside our log: route it through `onAPIError.onError` | It prints no email or address |
| L2-25 | `src/modules/identity/sign-in-guard.ts` | Anyone who knows an address can keep its account locked (5 guesses every 15 minutes) | The person can still reset the password; the lock is the plan's §4.6 rule; needs a product decision (for example a lock that a reset link lifts) |
| L2-26 | `auth.ts` `rateLimit.customRules` | 5 sign-ins per 5 minutes per address will refuse an office behind one NAT at shift start | Pilot offices are small; revisit with real traffic before more papers |
| L2-27 | `auth.ts` `advanced` | Use a `__Host-` cookie prefix instead of `__Secure-` (no Domain, Path=/) | The cookie has no Domain and Path=/ already; `__Host-` makes a browser enforce it |
| L2-28 | Better Auth `/list-sessions` (PR 14) | Its 24-hour `freshAge` decides when the session list needs a recent sign-in; set it for Account → Security; the list also returns every session's token to its owner | Account → Security is PR 14; the tokens are the caller's own |
| L2-29 | `auth.api.signUpEmail` from the server (PRs 9–10) | A sign-up of an address that already exists answers 200 with a made-up user id: callers (bootstrap, invitations) must not trust `user.id` from it, and look the user up | Only the tests call it today |
| L2-30 | `docs/architecture/v2/ADR/ADR-025-l2-backend-decisions.md` | Add: the verification GET is a login-CSRF vector (it signs in whoever opens it); GETs that slide the session also write; Better Auth's own Origin check covers only requests with cookies | Notes for the ADR's review; the behaviour is tested |
| L2-31 | `src/modules/identity/events.ts` | The new-sign-in email is keyed on the exact User-Agent string, so a browser update counts as a new browser | It errs towards sending the email |
| L2-32 | `src/config.ts` `PGN_AUTH_SECRET` | The check accepts one character and 31 spaces, and the public placeholder from `.env.dev.example`: require real entropy and refuse the placeholder outside development | Development only; deployment secrets come from the secret store (§8) |
| L2-33 | `auth.ts`, `sign-in-guard.ts` | The same secret keys Better Auth's HMACs and our email HMAC: derive a separate key with HKDF | Neither HMAC's output is shown to anyone |
| L2-34 | `identity.sign_in_failure`, `identity.auth_event` | Rows of unknown emails and anonymous events are never pruned | Small rows; a retention job comes with the audit retention work |
| L2-35 | `test/db/identity.test.ts` "the identity schema" | Drift detection (`getMigrations`) covers missing tables and columns only: a dropped index, unique constraint or not-null goes unnoticed (shown by the review's probe) | Our migrations are the only writers of the schema; a catalog snapshot test would close it |
| L2-36 | `src/db/identity/better-auth-1.7.8.sql` | Pin the file's SHA-256 in a test, so an edit to the "never edited" file fails CI | The review probe shows it identical to what Better Auth prints today |
| L2-37 | migration 0003 grants | `pgn_auth` holds DELETE on `identity."user"` and `identity.account`, which nothing needs yet | Only Better Auth uses `pgn_auth`, and its delete routes are disabled |
| L2-38 | `test/db/identity.test.ts` | Some tests check less than their names say (the sign-up email's origin, the new-browser email, the endpoint list); nothing enumerates Better Auth's mounted routes against `DISABLED_PATHS` | The review probed every route by hand |
| L2-39 | `test/db/identity.test.ts` | No test makes a password reset fail half-way, so `transaction: true` (#11626) is configured but not proven | Configured as Better Auth documents it |
| L2-40 | `src/db/identity.ts` `recordEvent` | A failed `auth_event` insert fails the sign-in after the session row is committed (the client gets a 500 but holds a valid session) | The insert has no foreign keys and only checked columns |
| L2-41 | `auth.ts` `logger` | Every failed attempt logs a warn-level line ("Invalid password", "User not found") | Bare messages, no email or address |
| L2-42 | `src/modules/identity/emails.ts` `clean()` | Cuts names by UTF-16 units, so a cut can split a surrogate pair | Names come from invitations the newsroom writes |
| L2-43 | `src/config.ts` `PGN_MAIL_FROM` | nodemailer 10.1.1's address parser mis-reads a display name with `( ) ; ,`: refuse them in `isSender` | The sender is set by the operator |
| L2-44 | web client (PR 13) | Better Auth's 429 sends `X-Retry-After`, our own 429s `retry-after`: the client must read both | No client yet |
| L2-45 | Better Auth answers (verification M1) | Its own 429 bodies have no `slow_down` code | The web client reads the status |
| L2-46 | sign-in timing (verification M2) | A 0.5 ms median difference between known and unknown emails, detectable at about n = 100 with no lock in the way | The per-email lock and the per-address limit stop the sampling |
| L2-47 | `/api/auth/*` disabled routes (verification M3) | Their 404 is Better Auth's bare "Not Found" text, not our envelope | Nothing is behind them |
| L2-48 | Better Auth `/update-session`, `/ok`, `/error` | Reachable but inert (no fields to update; static answers): disable them too | They change nothing |
| L2-49 | `src/modules/identity/rate-limit.ts` | Any route-like path under `/api/auth/` (lowercase words) makes its own rate-limit row, so a client can add rows until the next prune | Rows are pruned every 500 requests after 2 hours; every other path shares one `:param` row |
| L2-50 | migration `2026_11_20_0001_content` | `story_status_change.comment_id` can cite a comment on another story of the same publication | No endpoint writes status changes until PR 17, whose service checks it |
| L2-51 | migrations `2026_11_20_*` | `story_status_change`, `desk_bundle` and `desk_bundle_revision` have no append-only trigger (only `pgn_app`'s rights keep them from changing) | `pgn_app` has INSERT and SELECT only on them |
| L2-52 | Postgres, the owner role | The owner can `ALTER TABLE … DISABLE TRIGGER` on `story_revision` and `audit_event`: plan an audited erasure path for legally required removal, and restrict who may act as the owner | Only the migration step acts as the owner |
| L2-53 | `apps/api/test/db/content.test.ts` | The test "a story cannot name another organisation's edition, section or person" also tests another publication's section (mislabelled), and `EXPRESS ?? VARTA` should throw when the fixture lacks a second publication | The fixtures have two publications; the assertions are right |
| L2-54 | `app.idempotency_key` | Untested: another user's UPDATE or DELETE. Expired keys need a system reader to clean up (plan §3.2's named flags). A replay can return content for up to 24 h after the user lost access: check the route's permission before replaying (PR 17) | Nothing writes idempotency keys until PR 17 |
| L2-55 | migration `2026_11_20_0001_content` | Not bounded in the database: `comment.mentions` to the organisation's people, `story.page_pin` by the edition's pages, `story.language` by the publication's languages, `story.current_rev` and `story_revision.words` against the revisions and the body | PR 17's service sets and validates them |
| L2-56 | `app.story` | A story with no revisions yet can be moved to another publication (no child key holds it) | The API creates a story and its first revision in one transaction (PR 17) |
| L2-57 | `checks.ts` (b) | The cross-tenant harness never tries `update … set publication_id` to move a row to another publication | The restrictive WITH CHECK covers it, and (a) checks every content table has it |
| L2-58 | `packages/desk-text/test/vectors` | Add realistic fictional fixtures: a WhatsApp export, a Word paste, nukta and ZWJ in a byline | The vectors already cover each rule on its own |
| L2-59 | small items | Import order in `packages/desk-text/src/paste.ts`; an index on `desk_bundle (org_id, publication_id, edition_id)`; `updated_at` is never set by the database; no size limit on `idempotency_key.response` | Style and performance only; nothing writes these yet |
| L2-60 | `tools/desk/engine/desk_engine.py:80`, `desksamples.py:122` (a Desk item, outside L2) | The engine counts briefs with `<= BRIEF_WORDS` and no `0 <`, unlike `deskarticles.is_brief` | Both read the private dataset's printed stories (setup's statistics, and sample articles), not the newsroom's own; neither decides how an article is laid out |
| L2-61 | invitation contract (PR 10, `apps/web/src/api/account-service.ts`) | Agree the header name `X-Pageinator-Invitation`, the invitation answer's shape and the sign-up refusal text with the API, and put the header name in `@pageinator/contracts` | Both sides use the same name today; the API reads it from `INVITATION_HEADER` |
| L2-62 | `apps/web` API client | A 409 `request_in_progress` is shown as "cannot be used" | No endpoint answers it before PR 17 |
| L2-63 | `apps/web` public page | `today-item-sign-in` claims Marathi, which is unreviewed | The catalogue's Marathi is a first draft for the desk's review |
| L2-64 | `apps/web` demo | The demo "Access unavailable" text is reachable in the real app | It says nothing untrue |
| L2-65 | `apps/web` styles | Dead CSS: `.pg-auth-actions`, `.pg-auth-profiles` | Unused rules only |
| L2-66 | `apps/web/src/api/client.ts` | Headers given in different letter cases are not merged into one | The client's callers use one spelling each |
| L2-67 | `apps/web` session | "Session expired" is not a live region, so a screen reader does not announce it | The page also moves focus to the sign-in form |
| L2-68 | `apps/web` `/verify?confirmed=1` | The confirmation message can be shown by a crafted link | It changes nothing; the session decides what the person sees |
| L2-69 | `apps/web` verification | A cookie is set but an error shown when get-session fails right after | A reload signs the person in |
| L2-70 | `apps/web` tests | The 320 px layout evidence lives only in scratch scripts: make it a test | Checked by hand for L2-E |
| L2-71 | `apps/web` forms | A synthetic triple-click sends three POSTs | Real clicks are guarded; the per-address limits cap the rest |
| L2-72 | `apps/web` and the API limit | `get-session` counts against the 60 per minute per-address limit | The web asks once per screen |
| L2-73 | `src/modules/identity/routes.ts` | `get-session` returns `session.token` in its JSON (readable by page scripts, though not usable alone without the signed cookie): strip it in the forwarder | The cookie is HttpOnly and signed; the bare token is not a session |
| L2-74 | `src/config.ts`, `auth.ts` (two-step, PR 11) | Rotating `PGN_AUTH_SECRET` makes every TOTP secret and backup code unreadable (everyone re-enrols two-step) and ends every session and trusted device. Wire Better Auth's versioned `secrets` option (a `PGN_AUTH_SECRETS` list, newest first, the old secret kept to decrypt), with a test that a TOTP enrolled under the old secret still verifies; write the rotation runbook (PR 25) | No secret has been rotated; until then the runbook says: do not change `PGN_AUTH_SECRET` without planning everyone's re-enrolment |
| L2-75 | `src/modules/people/bootstrap.ts` | If its last step (settings, directory row, publication) fails after Better Auth made the organisation, a second run refuses the slug: make it resume an organisation of that owner that has no settings | Run once per organisation, by an operator who can read the error |
| L2-76 | `src/modules/people/members.ts` | GET members lists current members only: removed people (`person.status = 'removed'`) are not shown, so `status` is always "active" | The audit log records each removal |
| L2-77 | `src/modules/people/invitations.ts` | Accepting does not notify the inviter yet | Notifications are PR 19 |
| L2-78 | `app.org_settings.mfa_required_roles` | No endpoint changes it (Owner and Admin by default): the owner's choice of Prepress or Chief Editor needs organisation settings | Organisation settings come later; the default is the strict one |
| L2-79 | `src/modules/access/access.ts` | Every `/api/v1` organisation request reads the membership (auth pool) and the grants (a transaction on the app pool) before the handler's own: cache per request or join the reads | Correct as is; pilot traffic is small |
| L2-80 | `src/modules/people/invitations.ts` | Better Auth lowercases an invited address and compares addresses without case, and our sign-up gate compares without case too; no test signs up a mixed-case invitee | Both sides lowercase |
| L2-81 | `src/modules/people/invitations.ts` create | A process that dies between Better Auth's `createInvitation` and our grant insert leaves a pending invitation with no grants (its accept gives membership only) | The admin sees it pending with no publications and can cancel it |
| L2-82 | Better Auth organization plugin | Its limits of 100 members and 100 pending invitations per organisation; accept maps the 403 to `not_found` | The pilot has fewer than 100 people |
| L2-83 | Better Auth `/two-factor/enable`, `disable`, `generate-backup-codes`, `get-totp-uri` | Each checks the password under the per-address limit only, with no per-email lock | Each needs a signed-in session first |
| L2-84 | twoFactor trusted devices | Trusted-device rows survive turning two-step off, re-enrolling and a password reset | A trusted device still needs the person's password |
| L2-85 | `src/modules/access/access.ts` | `two_step_required` refusals are not audited | They refuse; the person can only set two-step up |
| L2-86 | `test/db/people.test.ts` | The lock test does not check `ACCOUNT_TEMPORARILY_LOCKED`; no forged trust-device cookie test; no HTTP test of a publication role in `mfa_required_roles` (the unit test covers `needsTwoStep`); `beforeCreateInvitation` cannot be reached by a test (our schema refuses first) | Each defence is covered by another test or by Better Auth's own |
| L2-87 | `src/modules/identity/emails.ts` invitation email | The inviter's and organisation's names go into the text, where mail clients may turn a URL-like name into a link | Names come from the organisation's own people |
| L2-88 | GET `/api/v1/invitations/:id` | Shows the organisation's and inviter's names for accepted and cancelled invitations too | Only to whoever holds the link's random id |
| L2-89 | `src/modules/people/bootstrap.ts` | With an existing account, bootstrap makes it the Owner without asking: document it in the runbook | Run by the operator, who names the account |
| L2-90 | `/api/v1` routes (verification) | The body is validated before the session and permission check, so a 400 can come before a 401 or 404 and shows the public schema | The schemas are public in `@pageinator/contracts` |
| L2-91 | plan §4.4 wording (verification) | Accept and the public lookup work before two-step (they are not organisation routes): say so in the plan | Neither gives access to an organisation's data |
| L2-92 | `/orgs/:o/pubs/:p` routes (verification) | The 404 for an unreachable publication was checked only on probe routes: re-check when the content routes land (PR 17) | `decide()` checks it for every route with `:p` |
| L2-93 | GET `/api/v1/invitations/:id` | Its 20-an-hour limit is per process (memory) | One API process in the pilot |
