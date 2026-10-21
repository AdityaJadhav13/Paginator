# Pageinator L2, "the newsroom": implementation plan

Status: a proposal for the owner to approve, dated 2026-10-20. It builds 09-launch-plan.md §4 L2 on the stack in §3.1. Nothing here is built yet. Every example name is fictional. Package versions and licences were checked on 2026-10-20 (Appendix A); anything not checked is marked "to verify".

## 0. Summary

1. **Six milestones, each used on real work:**
   - L2.1 People and the story desk;
   - L2.2 Photo desk and the engine worker;
   - L2.3 Editions and layout, hosted;
   - L2.4 The page editor, hosted;
   - L2.5 Release;
   - L2.6 Ads desk and the edition plan.
2. **One writer.** The Fastify API is the only code that writes application tables. The Python engine worker only computes:
   - it takes Procrastinate jobs;
   - it reads and writes S3;
   - it reports results through one narrow inbox table.
   Validation, the RLS context and the audit log therefore live in one language.
3. **The hosted engine service is the Desk's own code.**
   - The worker runs `tools/desk/engine/desk_engine.py` unchanged, in the frozen oracle venv, exactly as the Desk server does.
   - It reuses `tools/desk/deskserver` as a library: photo and ad conversion, previews, the PDF/X check, merging, and `EditService`.
4. **Hosted editing goes through an internal "edit gateway"** that wraps the Desk's `EditService`.
   - Postgres keeps every page revision; the gateway's files are only a cache.
   - All pages of one layout run must be served by one engine process. The engine moves stories between pages inside that process (`take_from_other_pages` updates in-memory sessions), so splitting a run across processes could print one story on two pages.
5. **Tenancy has four layers:**
   - a hard organisation wall (FORCE RLS);
   - a restrictive publication wall on content tables;
   - foreign keys that include `org_id`;
   - Better Auth's tables in their own schema, reached through their own database role.
   The tenancy proof tests start in PR 6.
6. **Better Auth 1.7.12, pinned, with only two plugins** (organization and twoFactor), and sign-up only by invitation.
7. **The Desk keeps working throughout.**
   - L2.1 sends it story bundles.
   - L2.3 imports its data into the hosted product once.
   - After that it is the offline fallback for a night when the hosting fails.

**Preconditions**
- Merge `chore/m0-monorepo` and `feat/desk` into `main`. Today `tools/desk/`, `tools/ts/check-licences.ts` and `09-launch-plan.md` are untracked on `feat/desk`. All L2 branches start from `main`.
- 09 §5 orders the L1 Desk additions first. L2.1 touches different code, so the owner chooses whether it starts now or after L1.
- `tools/desk/README.md` and `CONTRACT.md` say "never deployed", but 09 §3.1 runs the engine as hosted workers at L2. PR 1 updates both: the Desk itself stays local; its engine and helpers are also the hosted engine service.

---

## 1. Milestones

Each milestone has a **release check**. Gates decide what may be used for a real printed edition, not what may be built.

### L2.1 People and the story desk (about 26 PRs, §10)

**The newsroom uses it for:** reporters file stories, each with one photo, from their phones. The desk edits, assigns, comments, sends a story back or marks it Ready. The owner sends the day's Ready stories to the Desk and lays out the paper there.

**Must have:**
- **Pilot hosting:**
  - TLS;
  - managed Postgres with point-in-time recovery, or the VPS equivalent;
  - S3;
  - email;
  - nightly backups;
  - an uptime alert.
- **Accounts:**
  - email and password, by invitation only;
  - email verification and password reset;
  - two-step sign-in (TOTP) required for Owner and Admin;
  - sessions with a 12 h idle limit and a 30-day absolute limit;
  - a list of signed-in devices that the user can revoke.
- **Team:**
  - invite with an organisation role, publication roles and grants;
  - list members, change their roles, remove them (their work stays).
- **Story desk:**
  - story fields: headline, kicker, deck, byline, and body in the Desk's own text format;
  - story settings: section, priority 1–4, page pin, language;
  - revisions, statuses and assignment;
  - comments;
  - one photo per story, with caption and credit; the original file is kept;
  - minimal editions: date, 4/8/16 pages, back-page ads, volume/issue/price;
  - a phone-first layout.
- **Notifications:**
  - in-app bell over server-sent events: story filed, sent back, assigned, comment;
  - email for send-back, invitation and new sign-in.
- **Audit log:**
  - every change and every refused action is written;
  - Owner and Admin view it; Chief Editor views it read-only.
- **Desk bridge:**
  - "Send to the Desk" makes a story bundle;
  - the Desk gains "Pageinator stories…" to import it.
- **Language:** English and Marathi strings for every L2.1 screen.

**Can slip to L2.2:** @mentions, notification preferences, audit CSV export, saved views, search beyond the headline.

**Done when:**
1. **Real use:** on N production days (suggested 5; the owner picks N), that day's stories were filed and readied in the hosted desk and laid out in the Desk from the bundle. Counts are recorded as aggregates only.
2. **Tenancy suite:** tests (a)–(d) in §4.8 pass in CI against Postgres 18. A planted table without FORCE RLS makes CI fail.
3. **Invitation suite and role matrix:** the invitation suite (including a CVE-2026-53514 regression test) and the role matrix for every L2.1 endpoint pass.
4. **Restore drill:** the database is restored from backup to a new instance, and the output of the check script is recorded.
5. **Language review:** a native Marathi editor, named by the owner, has reviewed the Marathi strings.
6. **Process:**
   - every PR had a code review and an independent verification;
   - `pnpm run ci` is green;
   - axe reports zero serious violations on the new screens.

**Release check:** real staff data goes in only after items 2–4 are true.

### L2.2 Photo desk and the engine worker (about 10 PRs)

**The newsroom uses it for:**
- photographers and reporters upload photos;
- the photo desk sets captions, credits and the photographer;
- conversion from RGB to CMYK runs hosted, with the Desk's own code and colour profile;
- Word (.docx) files are imported hosted.

**Scope:**
- the worker container running Procrastinate tasks: photo intake, previews, the CMYK raster, Word import;
- the media library: a grid; filters for missing caption, missing credit and too small; a detail drawer with technical facts and "prints sharp up to N columns at 150 ppi";
- linking and unlinking photos to stories;
- job progress over server-sent events.

This milestone deliberately puts the queue, the worker, the event inbox and S3 into service on low-stakes jobs before layout depends on them.

**Done when:**
1. **Real use:** a week of real photos has gone through the photo desk.
2. **Colour parity:** the hosted CMYK rasters of real photos are byte-identical to the Desk's conversion with the same profile. This is a private, local check, attested in the PR as a list of SHA-256s with aggregates only.
3. **Job tenancy:** a job for organisation A refuses organisation B's keys (test (e)).
4. **Crash safety:** a worker killed mid-job is retried and leaves no duplicate assets.
5. **Bad files:** each of these is refused with the Desk's plain message:
   - a file that is not an image;
   - a 101-megapixel image bomb;
   - a truncated JPEG.

### L2.3 Editions and layout, hosted (about 15 PRs)

**The newsroom uses it for:** the owner or a designer lays out the day's paper in the hosted product.
- The steps are the Desk's: measure → plan → lay out → previews → independent PDF/X-1a check on every page → edition PDF → press ZIP.
- Ads go into the back-page slots.
- A Pages board shows every page, its check result, and the stories not placed, with the reason.

**Scope:**
- the engine profile (the paper's dataset bundle and config);
- the one-time import of the owner's Desk data (§3.8);
- full editions, with the "needs" panel from the engine's `plan`;
- background measuring;
- layout runs: queue, progress, cancel;
- back-page ad slots;
- downloads by 5-minute links;
- "Placed" status written back to stories;
- an Overview "Today" card.

**Done when:**
1. **Real use:** a real edition is laid out hosted from start to finish, and is used at least for proofreading.
2. **Platform parity:** the same `request.json` laid out on the hosted worker and on the Mac gives byte-identical page PDFs. If it does not, every difference is listed by a structural diff of the content streams, and the owner accepts the list in writing (risk R1).
3. **Timings:** 8-page and 16-page timings are recorded on two worker sizes.
4. **Import check:** the import report shows matching counts and a matching SHA-256 for every imported file.
5. **Crash safety:** a worker restarted mid-run marks the run failed with the Desk's own message, and leaves nothing half-published.

**Release check:** printing a hosted-made edition follows the Desk's rule (G0–G2: pages with photos or ads only after the press test), plus item 2.

### L2.4 The page editor, hosted (about 16 PRs)

**The newsroom uses it for:** designers adjust pages in the browser on production nights, and editors fix text from the story panel. Every change is set by the engine and kept.

**Scope:**
- the edit gateway;
- the editor screen, ported from the Desk's `editor.js`:
  - a canvas display list drawn with the PDF's own glyph outlines;
  - select, move, resize and snap;
  - swap stories; take a story off, or bring one in, including from another page;
  - undo and redo;
  - the story text panel (plain text boxes, so every Marathi input method works);
  - "Try another layout" and "Update text";
  - "Save page": export, check and merge.
- page revisions kept in Postgres, with a history list;
- a soft lock on each page, with presence ("X is editing this page");
- a change made on an old view of the page is refused and the page reloaded (the engine's `base_rev`).

**Done when:**
1. **Real use:** a production night's pages were edited in the hosted editor.
2. **Gateway crash:** if the gateway is killed mid-session, reopening the page shows every acknowledged change.
3. **Same page, two people:** the second person's stale change is refused and their view refreshed.
4. **Speed:** the p95 time for a move, measured end to end on the newsroom's connection, is recorded and the owner accepts it. The engine side took about 0.1 s per change on this Mac (measured 2026-10-20); to verify on the hosted engine.
5. **Screen equals print:** on a fictional page, the editor draws the same glyph ids at the same positions as the page PDF (comparison of the draw log with the PDF content stream, doc 12 §6 levels L1/L2).

**Release check:** the same as L2.3.

### L2.5 Release: preflight, approvals, export, press receipt (about 12 PRs)

**The newsroom uses it for:**
- the night's release;
- a preflight list showing only checks that really run;
- page approval and unlocking;
- release approval, bound to exact SHA-256s;
- press files;
- "Download and send yourself", then "Mark as sent", which records time, person, files and hashes;
- recording the press's confirmation;
- a minimal archive.

**Done when:**
1. **Real use:** a real edition is released through it, with a receipt whose hashes match the files the press received.
2. **Archive:** the archive copy verifies, and the application role cannot delete it (Object Lock governance test).
3. **Stale approvals:** approving a page or a release on a stale revision is refused.
4. **Late correction:** one changed page can be re-exported as `_v2` with a new receipt.

**Release check:**
- Before any edition with photos or ads is released, the G2 evidence must be on record (press acceptance naming the SHA-256 of a photo + ad page).
- The UI never says "press-ready" (CONTRACT §5).

### L2.6 Ads desk and the edition plan (about 12 PRs)

**The newsroom uses it for:** ad staff book ads, upload artwork and see its checks. The plan shows each page's role, its sections, and its ad slots, filled or empty.

**Scope:**
- advertisers and bookings: size, colour, position rule, run dates;
- image artwork checks: slot shape within ±0.5 mm, resolution at 200 ppi, RGB-converted note;
- placement into the engine's slots;
- a missing-artwork alert at cut-off;
- flatplan tiles;
- "Copy plan from…".

**Not in L2 unless the owner asks:**
- ads on inside pages: these need engine work, because the Desk's setup rejects inside templates that have ad slots;
- PDF artwork: this needs sandboxed PDF intake;
- a colour/mono page map: this needs a colour check. Under the "never show a feature before it works" rule these stay hidden.

**Done when:**
1. A real day's ads are booked and placed through the ads desk.
2. A planted wrong-size artwork is flagged.
3. The cut-off alert fires.

**Hosting** grows alongside the milestones:

| Milestone | Hosting added |
|---|---|
| L2.1 | App host, managed database, S3, email, backups, uptime check, first restore drill |
| L2.2 | Engine host, private colour profile, worker heartbeat alert |
| L2.3 | Dataset upload, sizing benchmark, restore drill including S3 objects |
| L2.4 | The gateway |
| L2.5 | Archive bucket with Object Lock, deadline-night runbook, on-call cover, the light penetration test (O-m) |

---

## 2. Architecture

```
Phones / desktops (browser)  — one origin: /  (SPA)   /api/v1/*   /api/auth/*   /api/v1/events (SSE)
        │ HTTPS
        ▼
Caddy (TLS) ─► apps/api  Fastify 5 + Kysely (Node 24)
                 ├─ pool pgn_app ───────────► Postgres 18  schema app      (RLS: org wall + publication wall)
                 ├─ pool pgn_auth (Better Auth)►            schema identity (Better Auth tables)
                 ├─ defer jobs (SQL, same tx) ►            schema queue    (Procrastinate)
                 ├─ LISTEN app_events / engine_events ◄──── app.engine_event (worker → API inbox)
                 ├─ presigned POST/GET ───────► S3 Mumbai: work bucket, archive bucket (Object Lock)
                 └─ internal HTTP + HMAC ─────► edit gateway (L2.4)
apps/engine-worker  (Python 3.11.14, its own venv; container on the engine host)
  ├─ Procrastinate workers, pool pgn_engine: tasks media.*, docx.import, engine.*
  ├─ edit gateway (L2.4): one Desk EditService per publication home
  └─ subprocess: tools/desk/engine/desk_engine.py in the frozen oracle venv (unchanged)
       per-publication "home" on local disk = a cache; S3 + Postgres hold the truth
The Desk (owner's Mac, 127.0.0.1:8765): unchanged except a bundle import; later the offline fallback
```

### 2.1 apps/api layout (one package; modules are folders with enforced boundaries)

```
apps/api/
  src/main.ts            config → pools → buildApp → listen
  src/app.ts             buildApp(deps): plugins, routes (tests use it with inject)
  src/config.ts          environment parsed with Zod (no secrets in the repo)
  src/http/              errors.ts (envelope), context.ts (request id, actor), authorize.ts,
                         idempotency.ts, origin-guard.ts, rate-limit.ts, sse.ts
  src/db/                pools.ts, tenant.ts (withTenant), migrate.ts, migrations/*.ts, schema.gen.ts (codegen)
  src/jobs/defer.ts      Procrastinate deferral by SQL inside the caller's transaction
  src/modules/
    identity/            Better Auth instance and hooks, session resolution, two-step policy
    orgs/                members, invitations, publication grants, permission resolution, person directory
    publications/        settings, sections, engine profile (L2.3)
    editions/            editions; flatplan (L2.6)
    content/             stories, revisions, transitions, assignment, comments, paste import
    assets/              uploads, assets, renditions, downloads
    layout/              runs, pages, engine-event consumer, measure triggers (L2.3); edit sessions, locks (L2.4)
    release/             preflight view, approvals, exports, deliveries, archive (L2.5)
    ads/                 (L2.6)
    notifications/       rows, email (nodemailer), SSE fan-out
    audit/               record(), query
    desk-bridge/         story bundle (L2.1); the one-time Desk import command (L2.3)
  scripts/               seed-dev.ts, bootstrap-org.ts, import-desk.ts, verify-restore.ts
  test/                  unit/, db/ (real Postgres), tenancy/, contract/
```

**Inside each module:**
- `routes.ts`: every route declares `config.permission` (or `public: true`);
- `service.ts`: the rules;
- `repo.ts`: Kysely queries that accept only a `Tx` from `withTenant`;
- `public.ts`: the only file other modules may import.

**Enforced by ESLint `no-restricted-imports`:**
- no cross-module imports of internals;
- no `pg` or `kysely` imports outside `src/db/`.

**Shared packages.** Both are listed as non-kernel in `tools/ts/workspace.json`, because kernel packages ban `trim` and `normalize`:
- **`packages/contracts`**: Zod 4 request/response schemas, error codes, the role and permission enums, and the bundle format. `apps/web` imports it.
- **`packages/desk-text`**: a TypeScript port of `deskarticles.blocks` / `body_words` / `is_brief` (the engine's single body parser), plus `clean_text` and the `---` paste parser. Parity is checked against vectors generated from the Python, so the hosted word counts and short-item flags match what the engine prints.

Why folders and not `/modules/*` packages (as in doc 03 §3): fewer manifests and build references for a one-developer team. `check-graph.ts` already understands `@pageinator/module-*`, so splitting later is a mechanical move.

### 2.2 The engine worker (`apps/engine-worker`, Python)

**Two environments in one image:**

| Environment | Python | Contents | Used for |
|---|---|---|---|
| engine env | 3.11.14 | `tools/oracle/v0/requirements.lock`, installed with `uv pip install --require-hashes` exactly as CI does. Never modified | The engine CLI |
| io env | 3.11.14 | The Desk server's packages (Pillow 12.3.0, pypdfium2 4.30.1, pikepdf 9.11.0, fontTools 4.63.0, from `experiments/phase0/pdfx1/requirements.txt`, re-locked with hashes as `tools/desk/requirements.lock`), plus procrastinate 3.10.0, psycopg[pool] 3.3.6 and boto3 1.43.115 | Tasks, conversions, previews, the checker, the gateway |

**Image contents:**
- `tools/oracle/v0` and `experiments/phase0`, copied byte for byte (frozen; the engine finds them through `deskcommon.REPO`, so the repository layout is kept);
- `tools/desk/engine` and `tools/desk/deskserver`;
- `apps/engine-worker`;
- the 22 allowlisted OFL stand-in fonts.

**No private data in the image.** The dataset, the colour profile and later the house fonts are fetched at run time from the private bucket.

**Reused unchanged from `tools/desk/deskserver`:**
- `images.convert_photo` / `convert_ad`;
- `jobs.render_page` / `check_pdfx` / `merge_pdfs` / `zip_pdfs` / `press_state`;
- `editing.EditService` and `after_save` helpers;
- `engine_client.EngineClient`;
- `docx.articles_from_docx`.

`JobManager` and `store.py` stay Desk-only.

**Job contracts.**
- Every job's arguments include `org_id` and `pub_id`.
- Every S3 key a task touches must start with `orgs/<org_id>/pubs/<pub_id>/`. The key guard raises otherwise (test (e)).

| Task (queue) | Arguments | Lock / queueing lock | Runs | Writes (S3) | Reports (event kind) |
|---|---|---|---|---|---|
| `media.ingest` (media) | asset_id, upload_key | queueing lock `asset:<id>` | `images.convert_photo` (Pillow + littleCMS, newsprint profile, perceptual, black-point compensation; at most 2000 px long side) | `assets/<id>/original`, preview, thumb, CMYK raster | `media.ready` {sha256, bytes, mime, width_px, height_px, renditions[]} or `media.rejected` {code, message} |
| `docx.import` (media) | upload_key, import_id | — | `docx.articles_from_docx` | `imports/<id>/result.json` | `import.parsed` {result_key, counts} (no story text in the event) |
| `media.ad` (media, L2.3) | asset_id, slot {w_mm, h_mm} | — | `images.convert_ad` (fitted at 200 ppi) | ad raster, preview | `media.ready` |
| `engine.setup` (layout, L2.3) | profile_id, dataset_key | lock `engine-cpu` | `desk_engine.py setup` | `profiles/<id>/config.json` | `profile.ready` |
| `engine.measure` (measure) | edition_id, `editions/<id>/measure/latest.json` | lock `engine-cpu`; queueing lock `measure:<edition>`; starts 8 s after the last change | `desk_engine.py measure` | local cache only | `measure.status` |
| `engine.layout` (layout, priority 10) | edition_id, run_id, request_key, request_sha256, profile_id | lock `engine-cpu` | `generate`, then previews, the check on each page, merge, ZIP (`JobManager._complete`'s steps) | `runs/<run>/…` | `run.progress`, `run.page`, `run.finished` |
| `engine.check_pdf` (check) | key, version_id, sha256 | queueing lock `check:<sha256>` | `check_pdfx1a_independent.py` | the report beside the PDF | `check.done` {passed, fails, warnings, checker_sha256} |
| `engine.export_page` (layout, L2.5) | run_id, page, page_rev | lock `run:<run>` | a one-shot PageSession builds the PDF from the persisted revision (an exact-revision export and a consistency check) | `pages/NN/export-<rev>.pdf` | `export.done` |

**Scheduling and failures:**
- **One CPU lock.** `engine-cpu` copies the Desk's rule: one layout at a time, and never a measure during a layout.
- **Layout takes priority.** When a run starts, the API asks Procrastinate to abort a running measure. The task polls `should_abort` and signals the engine's process group, as `JobManager.cancel` does; finished measurements are kept in the cache.
- **Retries:**
  - media: 3 tries with backoff;
  - check: 2 tries;
  - layout: never retried.
- **Stalled layout runs.** The API reconciler marks a run whose worker heartbeat has stopped as failed, with the Desk's `RESTARTED` message.

**The event inbox.**
- The worker inserts into `app.engine_event` (org-scoped) and sends `pg_notify('engine_events', id)`.
- The API consumes events with LISTEN, plus a 5-second poll. It validates each payload with Zod, applies it under `withTenant(event.org_id)`, and checks the target belongs to that organisation. A mismatch is rejected, audited and alerted.
- The Python side never writes domain tables and never sees other tables.

**Homes on the engine host.**
- Path: `/var/lib/pageinator/homes/<org>/<pub>/`, mode 0700.
- Contents:
  - `config.json`, written from the engine profile with the local dataset path;
  - `datasets/<sha>/`, the paper's page models, template photos and masthead art, synced from S3 by manifest;
  - `cache/`;
  - `editions/<desk_key>/`, materialised from the request: `edition.json`, `articles.json`, `photos/<p-key>.cmyk.gz` with `index.json`, `ads/…`;
  - `runs/<r-key>/`.
- Homes are per organisation, so the content-keyed caches (rasters, fonts, options) are never shared across tenants.
- The engine's options cache uses pickle. It stays local to the worker and is never imported or synced from outside.

**Desk ids are kept**, so the engine runs unchanged. These columns are stored in Postgres:
- `edition.desk_key` = `YYYY-MM-DD[-n]`;
- `story.desk_key` = `a-` + 10 hex;
- `asset.desk_key` = `p-` + 10 hex;
- `layout_run.desk_key` = `r-YYYYMMDD-HHMMSS`.

**The frozen request.** At run creation the API builds `request.json` from the database: the edition, the stories' current revisions in the Desk's article shape, and the rendition keys. It writes the file to S3, stores its SHA-256 on the run, and defers the job in the same transaction. The worker re-checks the hash. This is the "exact revision" rule (P3) applied to layout runs.

### 2.3 How the PDF/X check runs

- The checker is `experiments/phase0/pdfx1/check_pdfx1a_independent.py`: frozen, standard-library only, sharing no code with the writer.
- It runs as a subprocess of the io env, with a 300 s timeout, on every page PDF:
  - at the end of a run (4 in parallel, as in the Desk);
  - after every page save (L2.4);
  - on the exact bytes being released (L2.5).
- Its full report is stored beside the PDF.
- `app.pdf_check` keys the verdict by (org_id, PDF SHA-256, checker SHA-256), so the same bytes are never checked twice.
- **Wording:** the UI says "Independent PDF/X-1a check: passed (2 warnings)". It never says "PDF/X-valid" or "press-ready". ADR-022's commercial validation or the press's acceptance is still needed for that.

### 2.4 Hosted page-editing sessions (L2.4)

**The gateway:**
- a Python stdlib `ThreadingHTTPServer` on the engine host's private network (port 8790);
- every request carries an HMAC (method, path, timestamp, body SHA-256) and is refused if more than 60 s old;
- one Desk `EditService` per publication home, which means one engine `edit-service` process, holding at most 12 pages, as in the Desk.

**Invariant:** every page of a layout run goes to the process that holds that run. The engine updates other pages' in-memory sessions when it saves.

**Persistence:**
- **Open.** The API opens a page by sending the run's current state from Postgres: every page's latest `{rev, modules}` and the run's text overrides. The gateway writes those files before calling `open`.
- **Every answer** includes `edits`: the `{rev, modules}` of every page file that changed during the call, including pages a save took a story from.
- **The API** stores these as `app.page_edit` revisions (append-only) and recomputes the page flags with a TypeScript port of `press_state`.
- **Restart safety.** If the API dies after the gateway answers, the next `state` call carries the newer revision and the API catches up. After a gateway restart, Postgres rebuilds the files. Postgres always wins.

**Concurrency:**
- The engine's `base_rev` check is the hard guarantee.
- A soft lock (`app.page_lock`, a 30 s heartbeat) drives the "X is editing this page" banner and "Ask to take over".

**Known contention (risk R2).** One process serialises the requests of one paper's edition. A "Try another layout" can take up to 180 s and blocks other moves on that edition meanwhile. Measure it. If it hurts, move the alternatives search into a one-shot process that returns modules, then `set` them (a small engine change; `tools/desk/engine` is not frozen).

**What the browser fetches:** glyph outlines (`/glyphs/<face>`) and placed rasters, through authorised API routes, from the organisation's own home.

### 2.5 How the Desk and the hosted product live side by side

| | L2.1–L2.2 | L2.3 onward |
|---|---|---|
| Stories and photos | Hosted (made by phones and the desk) | Hosted |
| Layout and editing | The Desk, from a story bundle | Hosted; the Desk optional |
| Desk data | Stays on the Mac | Imported once (§3.8); afterwards hosted is the record |
| Fallback | — | "Edition for the Desk" bundle: stories, photos, ads, settings, so a laptop with the Desk can make the pages offline (ADR-020) |

**Rules:**
- **One producer per edition.** `edition.produced_in` is `hosted` or `desk`. Exporting a bundle marks the edition "being laid out in the Desk" and shows a banner.
- **The Desk never calls the hosted product** unless the owner approves the optional pull (decision D-4). The bundle is a file the owner downloads and imports.
- **No port clashes:** the Desk uses 127.0.0.1:8765; the API in development uses 127.0.0.1:8780.
- **Shared Python modules keep both callers working.** The Desk's tests (fictional, with the fake engine from `tools/desk/test/test_server.py`) start running in CI in PR 3. The fake engine moves into a shared fixture that the worker tests use too.

### 2.6 How apps/web screens replace the Desk's screens

| Desk screen (`tools/desk/static`) | Hosted screen (`apps/web`) | Milestone |
|---|---|---|
| Article list and article form | Stories (content desk) and the story editor (phone-first) | L2.1 |
| Paste several articles (`---`) | Stories → Paste | L2.1 |
| Word files… | Stories → Import Word (a job) | L2.2 |
| Photo on an article | Story photo (L2.1); Media / photo desk (L2.2) | L2.1–L2.2 |
| Edition step 1 (date, pages, back ads, volume/issue/price) | Editions → Create edition, edition settings | L2.1 (minimal), L2.3 |
| Needs panel | Readiness tab (from the engine's `plan`) | L2.3 |
| Back-page ads | Ads tab (slots) in L2.3; Ads desk in L2.6 | L2.3 / L2.6 |
| Lay out, progress, previews, downloads | Lay out (hosted runs) and the Pages board | L2.3 |
| Page editor (`editor.js`) | The editor route. A port that keeps the canvas display-list code; Konva (09 §3) is decided for handles and snapping in L2.4 | L2.4 |
| Save page, PDF/X verdicts, press files | Preflight, Export, Release | L2.5 |

The existing placeholder routes in `apps/web` stay dev-only. The deployed app shows only screens that work.

---

## 3. Data model

### 3.1 Schemas and roles

The schemas are `app`, `identity` and `queue`. `auth` is avoided because Supabase reserves it.

| Role | Login | Owns | Rights |
|---|---|---|---|
| `pgn_owner` | no | Every schema and table | — (migrations act as it) |
| `pgn_migrator` | yes | — | DDL by `SET ROLE pgn_owner`; used only by the migration step |
| `pgn_app` | yes | — | DML on `app.*` per table. Only INSERT and SELECT on `audit_event`. No UPDATE or DELETE on closed revisions or `page_edit`. EXECUTE on the Procrastinate defer function. **Nothing on `identity.*`** |
| `pgn_auth` | yes | — | DML on `identity.*` only (Better Auth) |
| `pgn_engine` | yes | — | `queue.*` (Procrastinate) and INSERT on `app.engine_event`. Nothing else |

- All roles are NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, and not table owners.
- Doc 04's `pg_app` cannot be used as written: Postgres reserves role names that start with `pg_`.

### 3.2 RLS and `withTenant`

```sql
create function app.current_org() returns uuid language sql stable
  as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;          -- unset → NULL → no rows
create function app.current_pubs() returns uuid[] language sql stable
  as $$ select coalesce(nullif(current_setting('app.pub_ids', true), '')::uuid[], '{}') $$;

alter table app.story enable row level security;
alter table app.story force row level security;
create policy org_wall on app.story
  using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
create policy pub_wall on app.story as restrictive                                 -- content tables only
  using (publication_id = any ((select app.current_pubs())))
  with check (publication_id = any ((select app.current_pubs())));
```

**`withTenant({orgId, userId, pubIds, requestId}, fn)`:**
- It opens one transaction. Its first statement is `select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.pub_ids',$3,true), set_config('app.request_id',$4,true)`.
- It is the only way to reach `app.*`. ESLint bans the raw pool elsewhere.

**How `pubIds` is computed:**
1. Better Auth's `identity.member` row is read through the auth pool. No row means 404 for the whole organisation.
2. `app.publication_grant` is read under the organisation wall only.
3. Owner and Admin get every publication; everyone else gets their granted publications.

**Which tables have which walls:**
- `publication_grant` and `publication` carry only the organisation wall: they are needed to compute the publication list in the first place.
- `notification` adds a restrictive policy `user_id = app.current_user()`.
- **System readers.** A few cross-tenant readers exist: the engine-event consumer, the email sender, upload clean-up. Each sets one named flag (for example `app.system = 'engine-consumer'`) that a policy accepts. A test checks that each flag is set in exactly one place.

**Integrity:**
- Parents carry `unique (org_id, id)` and `unique (org_id, publication_id, id)`. Children reference them with composite foreign keys that include `org_id`, so a row can never point at another organisation's row.
- Revision tables are append-only once closed (§3.4).
- IDs are `uuidv7()` (built into Postgres 18).
- Timestamps are `timestamptz`. Edition dates are local `date`s; the publication timezone is Asia/Kolkata.

### 3.3 Tables

| Table | Key columns (essential) | Walls | From |
|---|---|---|---|
| `identity.*` | Generated by Better Auth: user, session, account, verification, organization, member, invitation, twoFactor, rateLimit; plus our `auth_event` (sign-in audit) | identity zone | L2.1 |
| `org_settings` | org_id PK; mfa_required_roles text[] default {owner,admin}; session_absolute_days 30; data_region 'IN' | org | L2.1 |
| `person` | (org_id, user_id) PK; display_name; email; status; joined_at; removed_at. The organisation's own directory, so lists never join across pools; can be erased | org | L2.1 |
| `publication` | id; org_id; name; slug; languages text[]; primary_language; digit_style; timezone | org | L2.1 |
| `publication_grant` | (org_id, publication_id, user_id) PK; roles text[] CHECK ⊆ the 9 publication roles; grants text[] CHECK ⊆ {page_approve, release_approve} | org | L2.1 |
| `invitation_grant` | (org_id, invitation_id, publication_id) PK; roles; grants; applied_at | org | L2.1 |
| `section` | id; org/pub; name; color_tag; position; archived_at | org+pub | L2.1 |
| `edition` | id; org/pub; edition_date; desk_key; pages CHECK (4, 8, 16); back_page_ads; volume; issue; price; status; produced_in; UNIQUE (publication_id, edition_date) (zones later) | org+pub | L2.1 |
| `story` | id; org/pub; edition_id NULL; desk_key UNIQUE per publication; status; current_rev; reporter_id; assignee_id; due_at; section_id; priority 1–4; page_pin; language; origin; desk_note; search_text (pg_trgm); deleted_at | org+pub | L2.1 |
| `story_revision` | (story_id, rev) PK; org/pub; headline; kicker; deck; byline; body; body_format 'desk-text/1'; words; author_id; opened_at; closed_at | org+pub | L2.1 |
| `story_status_change` | id; org/pub; story_id; from; to; by; at; comment_id | org+pub | L2.1 |
| `story_photo` | story_id PK (one photo until the engine takes more); org/pub; asset_id; caption; credit | org+pub | L2.1 |
| `comment` | id; org/pub; target_type ('story'; 'page' from L2.4); target_id; parent_id; author_id; body; mentions uuid[]; resolved_at/by; deleted_at | org+pub | L2.1 |
| `upload` | id; org/pub; user_id; purpose; key; declared_type; declared_bytes; status; expires_at | org+pub | L2.1 |
| `asset` | id; org/pub; kind; desk_key; sha256; bytes; mime (sniffed); original_key; width_px; height_px; status; photographer; caption; credit; UNIQUE (org_id, sha256) where not deleted (dedupe within one organisation only) | org+pub | L2.1 |
| `notification` | id; org_id; user_id; kind; target_type; target_id; data jsonb (ids only); read_at; emailed_at | org+user | L2.1 |
| `audit_event` | id; org_id; publication_id NULL; actor_kind; actor_id; action; target_type; target_id; data jsonb (no story text); ip; user_agent; request_id; at | org | L2.1 |
| `idempotency_key` | (user_id, key) PK; org_id; route; request_sha256; status; response jsonb; expires_at (24 h) | org | L2.1 |
| `desk_bundle` | id; org/pub; edition_id; story_revisions jsonb [{story_id, rev}]; key; sha256; by; at | org+pub | L2.1 |
| `rendition` | asset_id; purpose; params_hash; key; width_px; height_px; UNIQUE (asset_id, purpose, params_hash) | org+pub | L2.2 |
| `import_job` | id; org/pub; kind 'docx'; state; result_key; counts | org+pub | L2.2 |
| `engine_event` | id bigserial; org_id; kind; ref_id; payload jsonb; created_at; processed_at; error | org (+ consumer flag) | L2.2 |
| `engine_profile` | id; org/pub; version; status; config jsonb; dataset_key; dataset_sha256; engine_version | org+pub | L2.3 |
| `layout_run` | id; org/pub; edition_id; desk_key; state; request_key; request_sha256; profile_id; engine_version; worker image digest; timings; not_placed jsonb; error; partial UNIQUE (edition_id) while active | org+pub | L2.3 |
| `run_page` | (run_id, page_no) PK; org/pub; role; state; story_ids; pdf_key; pdf_sha256; preview keys; manifest jsonb; edited; edited_unsaved; needs_save; needs_save_reason | org+pub | L2.3 |
| `pdf_check` | (org_id, sha256, checker_sha256) PK; passed; fails; warnings; report_key | org | L2.3 |
| `ad_slot_artwork` | (edition_id, slot) PK; asset_id | org+pub | L2.3 |
| `page_edit` | (run_id, page_no, rev) PK; modules jsonb; author_id; cause; created_at (append-only) | org+pub | L2.4 |
| `run_text_override` | (run_id, story_desk_key) PK; article jsonb NULL | org+pub | L2.4 |
| `page_lock` | (run_id, page_no) PK; holder_id; heartbeat_at; expires_at | org+pub | L2.4 |
| `page_approval`, `release`, `release_file`, `delivery`, `preflight_run`, `preflight_issue`, `preflight_override` | As doc 04 §3 "Production", bound to PDF SHA-256s and page revisions | org+pub | L2.5 |
| `advertiser`, `ad_booking`, `ad_artwork`, `ad_placement`, `flatplan_page` | As doc 04 §3 "Advertisements", restricted to the engine's slots | org+pub | L2.6 |

**Simplification from doc 04.** In L2 a story belongs to at most one edition at a time (`story.edition_id`), which matches the Desk's per-edition articles. Doc 04's `EditionStory` join table arrives with zoned editions, through expand/contract migrations.

### 3.4 Revisions and the audit log

**Story revisions:**
- A revision is created on every status change, on an explicit save, and on the first edit by a different person.
- Autosaves by the same author within 5 minutes update the *open* revision.
- Once `closed_at` is set, a trigger refuses UPDATE or DELETE.
- This gives revision history without a full copy per keystroke-pause.

**The audit log:**
- Append-only: `pgn_app` has INSERT and SELECT only, and a trigger refuses UPDATE and DELETE.
- Entries hold ids and small diffs (field names, from/to status), never story text.
- Names are resolved through `person` at display time, so a person can be erased.
- **Recorded in L2.1:**
  - members: invited, joined, roles changed, removed;
  - grants changed;
  - publication settings changed;
  - editions created or changed;
  - stories: created, revised, status changed, assigned, deleted;
  - comments;
  - uploads;
  - Desk bundles exported;
  - every refused action (`permission.denied`).
- **Sign-in events** go to `identity.auth_event`, shown in Account → Security and to admins of the person's organisations.
- **Retention:** 1 year by default, to be confirmed with counsel (L5).

### 3.5 Job tables

- **Procrastinate's own tables** (`procrastinate_jobs`, `procrastinate_workers`, `procrastinate_events`) live in schema `queue`.
- They are applied from Procrastinate's vendored `schema.sql` for the pinned version, as one of our migrations. Upgrades apply its pre/post migration scripts as new migrations.
- That workers resolve these tables through `search_path=queue` is to verify; if it fails, the fallback is the `public` schema used for nothing else.
- **Enqueue from the API, inside the domain transaction:**
  ```sql
  select queue.procrastinate_defer_jobs_v1(array[row('layout','engine.layout',10,'engine-cpu',null,
    jsonb_build_object('org_id',$1,'pub_id',$2,'run_id',$3,'request_key',$4,'request_sha256',$5), null)
    ::queue.procrastinate_job_to_defer_v1]);
  ```
  The function and composite type are confirmed on Procrastinate's current `schema.sql`; confirm against the 3.10.0 tag.
- Because the enqueue is in the same transaction, there is no separate outbox (doc 11 §5's purpose is met).
- Job arguments carry ids only.

### 3.6 Migrations with Kysely

- **Runner:** Kysely 0.29.7's built-in `Migrator` with `FileMigrationProvider`, run by `pnpm --filter @pageinator/api db:migrate` as `pgn_migrator`, as a step before each deploy.
- **Files:** `apps/api/src/db/migrations/2026_11_01_0001_*.ts`. They use raw `sql` for DDL, RLS policies, grants and triggers.
- **Forward only, expand/contract** (doc 04 §6). No `down` functions; disaster recovery is a restore.
- **Better Auth's schema:** generated once with the pinned CLI `auth@1.7.12` (`auth generate`, with `schemaName: "identity"`), committed as a reviewed migration. Each Better Auth upgrade regenerates and diffs it.
- **Types:** kysely-codegen 0.20.0 writes `src/db/schema.gen.ts`. CI migrates a fresh database, runs the codegen, and fails on any diff.
- **Large backfills** run as jobs, never inside migrations.

### 3.7 How the Desk's files map to Postgres and S3 (CONTRACT §1)

| Desk file | Hosted |
|---|---|
| `config.json` | `engine_profile.config` (without the dataset path), plus the dataset bundle in S3 |
| `editions/<id>/edition.json` | `edition` (desk_key = id; date, pages, back_page_ads, volume, issue, price, created, updated) |
| `articles.json`, each article | `story` (desk_key = article id; priority; page → page_pin; source → origin), plus `story_revision` 1 |
| `article.photo` | `story_photo`, plus `asset` (desk_key = photo id; width, height) |
| `photos/<pid>.orig.*`, `.jpg`, `.cmyk.gz`, `index.json` | S3 original, plus renditions. The params hash comes from the Desk profile's SHA-256 and `images.py`'s version |
| `ads/<slot>.*` | `asset` (ad_artwork), plus `ad_slot_artwork` and renditions |
| `runs/<rid>/request.json` | S3, plus `layout_run.request_sha256` |
| `status.json`, `engine-status.json` | `layout_run` and `run_page` |
| `page-NN.{pdf,auto.pdf,png,thumb.png,manifest.json,pdfx-check.txt}` | S3 `runs/<run>/pages/NN/…`, plus `run_page` and `pdf_check` |
| `page-NN.edit.json` / `edit-articles.json` | `page_edit` (latest revision) / `run_text_override` |
| `edition.pdf`, `press-files.zip` | S3 `runs/<run>/` |
| `cache/`, `trash/`, logs, `.desk.lock`, `measure-status.json` | Not imported. The cache is rebuilt; pickles are never imported |
| Articles with `source: "sample:<name>"` | Skipped by default (test material from the private dataset) |

### 3.8 The one-time import of the owner's Desk data (start of L2.3)

1. **On the Mac:** a new `tools/desk/export-home.sh` packs `editions/` (no cache, no trash) into a `tar.zst` with a SHA-256 manifest, plus `config.json` and the dataset.
2. **Upload** to the private bucket under `orgs/<org>/imports/`.
3. **On the server:** `pnpm --filter @pageinator/api import-desk --org … --pub … --bundle s3://… --dry-run` prints counts.
   - It uses the API's own services: `withTenant`, validation, and audit with actor "import".
   - It adds no new public endpoints.
   - It is idempotent: editions match by desk_key, stories by (publication, desk_key), files by SHA-256.
   - By default it imports the latest run of each edition, and skips sample articles.
4. **Run it for real.** Then verify: counts and every SHA-256, plus one page laid out again hosted and compared (the L2.3 parity check).
5. **Clean up.** Delete the tarball, or keep it in the locked bucket as "the Desk's archive" (owner decision).

---

## 4. Auth and tenancy

### 4.1 Better Auth configuration (version 1.7.12, pinned exactly; released 2026-10-20)

```ts
betterAuth({
  appName: "Pageinator", baseURL: PUBLIC_ORIGIN, basePath: "/api/auth", secret: AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool: authPool }), type: "postgres", schemaName: "identity" },
  advanced: { database: { generateId: "uuid" }, useSecureCookies: true, cookiePrefix: "pgn",
              defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" } },
  trustedOrigins: [PUBLIC_ORIGIN],
  telemetry: { enabled: false },                       // off by default; set anyway, plus BETTER_AUTH_TELEMETRY=0
  emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 12,
                      maxPasswordLength: 128, revokeSessionsOnPasswordReset: true, autoSignIn: false,
                      sendResetPassword, password: { hash: argon2idHash, verify: argon2idVerify } },
  emailVerification: { sendVerificationEmail, sendOnSignUp: true, autoSignInAfterVerification: true },
  session: { expiresIn: 12 * 3600, updateAge: 3600 },  // sliding 12 h idle; 30-day absolute cap in our middleware
  rateLimit: { enabled: true, storage: "database", customRules: { /* §4.6 */ } },
  hooks: { before: inviteOnlySignUp },                 // /sign-up/email needs a pending invitation for that email
  databaseHooks: { session: { create: { after: auditSignInAndEmailNewDevice } } },
  plugins: [
    organization({ allowUserToCreateOrganization: false, requireEmailVerificationOnInvitation: true,
                   invitationExpiresIn: 7 * 24 * 3600, sendInvitationEmail,
                   organizationHooks: { beforeCreateInvitation: inviterMayGrant,
                                        afterAcceptInvitation: applyPublicationGrants } }),
    twoFactor({ issuer: "Pageinator", trustDeviceMaxAge: 30 * 24 * 3600,
                accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 } }),
  ],
});
```

**Choices behind it:**
- **Passwords.** argon2id through @node-rs/argon2 2.2.2 (MIT), because doc 11 §1 asks for argon2id; Better Auth's default is scrypt. The parameters are at least OWASP's argon2id minimum (exact values to verify).
- **Invitation ids are random UUIDv4.** Better Auth's `generateId: "uuid"` makes them, and the id is the secret in the invitation link. Our own tables use UUIDv7.
- **Not enabled:** magic link, email OTP, social sign-in, Generic OAuth, OAuth proxy, SSO, SCIM, admin, Stripe.
  - Most 2026 advisories need one of these. Examples: GHSA-965c-763c-88jm (critical; magic link plus OAuth, fixed in 1.7.7); GHSA-qq9h-g4jm-xgf3 (magic link or email OTP plus open sign-up).
  - The spec's "Continue with Google/Microsoft" buttons stay hidden.
- **Advisory watch:** GitHub security advisories, plus `pnpm audit --prod` in CI. A high or critical advisory that touches an enabled feature is upgraded within 48 h, after running the auth and invitation suites.
- **Fallback:** an `IdentityPort` (`getSession`, `membership`) isolates Better Auth, so Keycloak (Apache-2.0) can replace it if needed.
- **To verify in PR 7–8:**
  - the exact option names;
  - that server-side `auth.api.*` calls honour the hooks;
  - the cookie prefix (`__Secure-`);
  - Better Auth's own Origin check on `/api/auth/*`.

### 4.2 Roles mapped to the product's roles (01 §2.3, 07 §12)

| Product role | Stored in | Better Auth role |
|---|---|---|
| Owner, Admin | `identity.member.role` | `owner`, `admin` |
| Everyone else | `identity.member.role` = `member` | `member` |
| Chief Editor, Editor, Sub-editor, Reporter, Page Designer, Photo Editor, Advertising, Prepress, Viewer | `app.publication_grant.roles` (per publication; several allowed) | — |
| "Can approve pages", "Can approve release" | `app.publication_grant.grants` | — |
| "Billing delegate" | Later (no billing in L2) | — |
| Press | No account; expiring links (L3) | — |

**Effective permissions** = organisation role permissions ∪ the publication's role permissions ∪ grants.
- The map lives in `packages/contracts/permissions.ts`, taken from the §12 matrix. Where §12 is silent, doc 11 §2 applies.
- Every route declares one permission. `authorize()` runs as a preHandler.
- A refusal is audited.
- A resource in another organisation or publication answers 404. An action the role lacks on a visible resource answers 403.
- Responses include `can: {...}`, so the UI hides only what the server would refuse.

### 4.3 Invitations

1. An Owner or Admin invites: email, organisation role, publications, roles, grants.
   - Better Auth `createInvitation` runs server-side, and our `invitation_grant` rows are written in the same handler.
   - `beforeCreateInvitation` refuses an Admin granting Owner, and anyone granting beyond their own rights.
2. The email says "<Inviter> invited you to <Organisation> as <roles>" and links to `/invite/<id>`.
3. `GET /api/v1/invitations/:id` (public, rate-limited) shows only: organisation name, inviter name, roles, expiry, state.
4. **Create account** calls Better Auth `sign-up/email`, with the invitation id in a header. The `before` hook allows it only if a pending, unexpired invitation exists for exactly that email. Then the verification email goes out (two emails in all; trusting the invitation link as verification is a possible later improvement, after review).
5. After verification: `POST /api/v1/invitations/:id/accept`.
   - Better Auth `acceptInvitation` checks: same email, verified email, pending status, expiry, and an atomic claim.
   - `afterAcceptInvitation` then upserts the grants idempotently from **our** table (never from the client), creates the `person` row, audits, and notifies the inviter.
   - A reconciliation on `/me` re-applies any grants left pending.
6. **The first Owner:** `scripts/bootstrap-org.ts` runs on the server with a one-time secret. It signs up the owner, waits for verification, then creates the organisation, the publication and the owner's grants. The exact server-call semantics are to verify in PR 9.

### 4.4 Two-step sign-in

- TOTP (twoFactor plugin), backup codes, "Trust this device for 30 days", lockout after 5 wrong codes.
- `org_settings.mfa_required_roles` defaults to Owner and Admin; Prepress or Chief Editor are added at the owner's choice.
- A member in such a role without two-step gets 403 `two_step_required` everywhere except `/me`, `/api/auth/*` and the setup screen.

### 4.5 Sessions and CSRF

**Sessions:**
- Stored in the database, in an HttpOnly, Secure, SameSite=Lax cookie.
- 12 h sliding idle limit; a 30-day absolute limit checked from `session.createdAt`.
- "Keep me signed in" unticked gives a browser-session cookie.
- Changing or resetting the password revokes all other sessions.
- The device list and revoke come from Better Auth's endpoints.
- On 401 the web shows "Session expired" and keeps any unsaved story text in local storage.

**CSRF:**
- One origin for everything, and no CORS.
- Every POST, PUT, PATCH and DELETE on `/api/v1` must carry `Origin` equal to the app's origin and the header `X-Pageinator: 1`; `Sec-Fetch-Site: cross-site` is refused. This is the Desk's `X-Desk` pattern.
- Bodies are JSON only; uploads go straight to S3.
- This replaces doc 11's double-submit token with equal protection for a same-origin app (to be recorded in ADR-025).

### 4.6 Rate limits

| What | Limit | Where |
|---|---|---|
| Sign-in | 5 per 5 minutes per IP and path, plus a per-email failure counter in the `before` hook (5 failures → 15 minutes) | Better Auth (database store) |
| TOTP | Lockout after 5 wrong codes | twoFactor |
| Sign-up / password-reset request | 5 / 3 per hour per IP; the answer is always generic | Better Auth |
| Invitation lookup | 20 per hour per IP | @fastify/rate-limit |
| API, signed in | 300 per minute per user | @fastify/rate-limit (memory store; one instance in the pilot) |
| API, signed out | 60 per minute per IP | @fastify/rate-limit |
| Upload presign | 60 per hour per user; 2 GB per day per organisation | database count |
| Engine jobs | One run per edition (partial unique index); measures merged (queueing lock) | Postgres / Procrastinate |

### 4.7 Other security baseline

- **Headers:** Helmet on the API. On the web: a strict CSP (`script-src 'self'`, later `'wasm-unsafe-eval'`), `frame-ancestors 'none'`, and `img-src`/`connect-src` limited to self plus the S3 endpoint.
- **Client IPs:** `trustProxy` set to the proxy's address only.
- **Uploads:** validated by magic bytes and by Pillow in the worker, with a 100 MP limit; SVG refused.

### 4.8 Tenancy proof tests (doc 15 §8)

| Test | What it asserts |
|---|---|
| (a) Catalog meta-test | Every `app` table with `org_id` has ENABLE + FORCE RLS and the organisation policy; every content table has the restrictive publication policy; `pgn_app`, `pgn_auth` and `pgn_engine` own nothing, cannot BYPASSRLS, and cannot use each other's schemas. A planted table without FORCE fails it |
| (b) Per table | With two fictional organisations seeded, every table read under A returns zero B rows, and inserts carrying B's org_id fail WITH CHECK. Generated from the catalog, so new tables are covered automatically |
| (c) Per endpoint | Generated from Fastify's route table: every route called with A's session and B's ids answers 404. A meta-test fails if a route parameter has no fixture factory |
| (d) Storage | A's session cannot get a presigned URL, or a POST policy, for B's key or prefix |
| (e) Jobs | A job for A refuses keys outside A's prefix; an engine event for an object of B, posted under A, is rejected and audited |
| (f) Caches and live updates | Engine homes are per organisation; SSE delivers an event only to users authorised for its organisation and publication; glyph and raster routes are scoped to the organisation's home |
| (g) Exports | A's bundle, edition PDF and press ZIP contain only A's files (manifest SHA-256s) |
| (h) Penetration test | External, light; before other papers (L4), or before L2.5 at the owner's choice (O-m) |

Also:
- **Publication wall:** a reporter granted only P1 cannot read P2's stories, through RLS and through the service.
- **Role matrix:** every role × every endpoint against §12's expected 200/403/404.
- **Invitation suite:** an unverified email cannot accept (CVE-2026-53514 regression); a different email cannot accept; expired or revoked invitations fail; a double accept gives one membership; sign-up without an invitation fails; a guessed id fails; grants cannot be injected at accept.
- **Session suite:** idle limit, absolute limit, revocation on password reset.

---

## 5. API surface (L2.1 and L2.2)

### 5.1 Conventions

- **Paths:** `/api/v1`, where `{o}` = organisation id and `{p}` = publication id (the web routes already use `/org/:orgId/pub/:pubId`).
- **Data:** JSON; ids are UUIDs; timestamps are ISO-8601; edition dates are `YYYY-MM-DD`.
- **Lists:** `?cursor=&limit=` returns `{items, nextCursor}`.
- **Validation:**
  - Zod 4 schemas from `packages/contracts`, through fastify-type-provider-zod 7.0.0;
  - strict objects (unknown keys refused);
  - responses serialised through their schemas, so extra fields never leak.
- **Text** is cleaned as the Desk's `clean_text` does: NFC, CRLF to LF, control characters dropped, trailing spaces trimmed. The Desk's limits apply: lines 2,000 characters, body 200,000.
- **Optimistic concurrency:** `baseRevision` in the body; a mismatch answers 409 with the current version.
- **Idempotency:** creates and transitions require an `Idempotency-Key` header (a UUID).
  - Stored per user and key for 24 h.
  - A replay returns the stored status and body.
  - The same key with a different body answers 422 `idempotency_key_reused`.
  - A request still running answers 409 `request_in_progress`.
  - This lets a phone retry "Send to desk" safely.

**Error envelope:** `{"error": {"code", "message", "details"?, "requestId"}}`. The web shows the catalogue text for `code` in English or Marathi, falling back to `message`.

| HTTP | code | message (English fallback, plain) |
|---|---|---|
| 400 | `invalid_request` | "Some fields are not right." with `details: [{field, message}]` |
| 401 | `signed_out` | "You are signed out. Sign in again; what you typed is kept on this device." |
| 403 | `not_allowed` | "Your role cannot do this. Ask an editor or the owner." |
| 403 | `two_step_required` | "Your role needs two-step sign-in. Set it up in Account → Security." |
| 403 | `bad_origin` | "This request did not come from Pageinator." |
| 404 | `not_found` | "There is nothing here, or you do not have access to it." (a route may say what is missing: "There is no such story, or you do not have access to it.") |
| 409 | `story_changed` | "Someone changed this story after you opened it. Your text is kept; reload to see theirs." |
| 409 | `invalid_transition` | "A spiked story cannot be sent to the desk. Ask an editor to restore it." |
| 409 | `edition_exists` | "There is already an edition for 21 October. Open it instead." (with `existingId`) |
| 413 | `file_too_large` | "This picture is larger than 40 MB. Save it smaller and try again." |
| 408 | `invalid_request` | "This request took too long to arrive. Try again." (answered by the server itself) |
| 413 | `request_too_large` | "This request is too large." (a JSON body over 1 MiB; pictures go straight to storage) |
| 431 | `request_too_large` | "This request is too large." (its headers are; answered by the server itself) |
| 415 | `not_json` | "This request must be sent as JSON." |
| 422 | `not_a_picture` | "This file is not a picture Pageinator can read. Use a JPEG, PNG or WebP file." |
| 429 | `slow_down` | "Too many tries. Wait a minute and try again." |
| 500 | `server_error` | "Something went wrong on our side. Try again. Reference: …" |

### 5.2 L2.1 endpoints

Sign-in, sign-out, verification, password reset, two-step and the device list are Better Auth's own endpoints under `/api/auth/*`, called through Better Auth's client.

| Method and path | Permission | Request → response |
|---|---|---|
| GET `/me` | signed in | → `Me` {user {id, name, email, emailVerified, twoFactorEnabled, locale}, memberships [{org {id, name}, orgRole, twoStep {required, satisfied}, publications [{id, name, roles[], grants[]}]}]} |
| PATCH `/me` | signed in | {name?, locale?: "en"\|"mr", uiDigits?: "latin"\|"devanagari"} → Me |
| GET `/orgs/{o}/members` | members.view | → {items: [{userId, name, email, orgRole, publications[], status, lastActiveAt}]} |
| PATCH / DELETE `/orgs/{o}/members/{userId}` | members.manage | {orgRole?, publications?} → Member / 204 (their work stays) |
| POST `/orgs/{o}/invitations` | members.manage | {email, orgRole: "admin"\|"member", publications: [{publicationId, roles[], grants[]}]} → 201 Invitation {id, email, roles, expiresAt, state} |
| GET `/orgs/{o}/invitations` · POST `…/{id}/resend` · DELETE `…/{id}` | members.manage | list / Invitation / 204 |
| GET `/invitations/{id}` | public, rate-limited | → {organization {name}, inviter {name}, roles[], expiresAt, state} |
| POST `/invitations/{id}/accept` | signed in, verified | → {orgId, publications[]} |
| GET `/orgs/{o}/pubs` · GET/PATCH `/orgs/{o}/pubs/{p}` | publication.view / settings.edit | Publication {id, name, languages[], primaryLanguage, digitStyle, timezone} |
| GET / PUT `/orgs/{o}/pubs/{p}/sections` | view / settings.edit | [{id?, name, colorTag}] (PUT replaces the ordered list) |
| GET `/orgs/{o}/pubs/{p}/editions?from&to` | edition.view | → {items: [{id, date, pages, status, counts {stories, ready}}]} |
| POST `/orgs/{o}/pubs/{p}/editions` | edition.create | {date, pages: 4\|8\|16, backPageAds, volume?, issue?, price?} → 201 Edition; 409 `edition_exists` |
| GET / PATCH `/orgs/{o}/pubs/{p}/editions/{e}` | view / edition.edit | Edition (the date is fixed, as in the Desk) |
| GET `/orgs/{o}/pubs/{p}/stories?edition=&status=&assignee=me&reporter=&q=` | story.view (Reporter: own stories only) | → {items: StoryListItem[], nextCursor} |
| POST `/orgs/{o}/pubs/{p}/stories` | story.create | StoryInput → 201 Story (Draft) |
| POST `/orgs/{o}/pubs/{p}/stories/paste` | story.create | {editionId?, text} → {created: Story[], skipped: [{headline, reason}]} (the Desk's `---` format) |
| GET `/orgs/{o}/pubs/{p}/stories/{s}` | story.view | → Story |
| PATCH `/orgs/{o}/pubs/{p}/stories/{s}` | story.edit_own (until Ready) / story.edit_any | {baseRevision, headline?, kicker?, deck?, byline?, body?, language?, sectionId?, priority?, pagePin?, editionId?, deskNote?} → Story; 409 `story_changed` {current} |
| POST `…/stories/{s}/transitions` | per transition (§5.4) | {to, baseRevision, comment?} → Story; 409 `invalid_transition` |
| POST `…/stories/{s}/assignee` | story.assign | {userId \| null, dueAt?} → Story |
| GET `…/stories/{s}/revisions` · `…/revisions/{rev}` | story.view | [{rev, author, at, words}] / StoryRevision |
| DELETE `…/stories/{s}` | desk roles; the author while Draft | 204 (soft delete, audited) |
| GET / POST `…/stories/{s}/comments` · PATCH `/orgs/{o}/pubs/{p}/comments/{c}` | comment.read / comment.write | {body, parentId?, mentions?[]} → Comment; {body?, resolved?} |
| POST `/orgs/{o}/pubs/{p}/uploads` | media.upload | {purpose: "story_photo", filename, contentType, bytes ≤ 41,943,040} → 201 {uploadId, url, fields, expiresAt} (presigned POST) |
| POST `/orgs/{o}/pubs/{p}/uploads/{u}/complete` | the uploader | → {asset: Asset}; 422 `not_a_picture` |
| PUT / PATCH / DELETE `…/stories/{s}/photo` | story.edit_* | {assetId, caption, credit} → StoryPhoto |
| GET `/orgs/{o}/pubs/{p}/assets/{a}/file?variant=original\|preview` | media.view | 302 to a 5-minute link tied to the object version |
| GET `/notifications?unread=1` · POST `/notifications/read` | signed in | {items, unread} / {ids? \| all?} → 204 |
| GET `/events?org={o}` | member | text/event-stream: `notification`, `story` (ids only; the client re-fetches through authorised routes); heartbeat every 25 s; a `resync` event after a reconnect |
| GET `/orgs/{o}/audit?actor&action&target&from&to` | audit.view | → {items: [{at, actor {id, name}, action, target, publicationId, ip, userAgent, data}]} |
| POST `/orgs/{o}/pubs/{p}/editions/{e}/desk-bundle` | desk.export | {statuses: ["ready"]} → 201 {bundleId, url (5 minutes), stories, sha256} |

**Main shapes:**
- **Story:** {id, publicationId, status, revision, headline, kicker, deck, byline, body, bodyFormat: "desk-text/1", words, isBrief, language, sectionId, priority: 1\|2\|3\|4, pagePin, edition {id, date} \| null, reporter, assignee, dueAt, deskNote, photo: StoryPhoto \| null, commentCount, updatedAt, updatedBy, can {edit, transitions[], comment, assign}}
- **StoryPhoto:** {assetId, caption, credit, status, widthPx, heightPx, previewUrl}

### 5.3 L2.2 additions

| Method and path | Permission | Request → response |
|---|---|---|
| GET `/orgs/{o}/pubs/{p}/media?story=&missing=caption\|credit&tooSmallForCols=` | media.view | → {items: Asset[]} with {sha256, bytes, mime, widthPx, heightPx, sharpUpToCols, status, caption, credit, photographer, usedBy[]} |
| GET / PATCH / DELETE `/orgs/{o}/pubs/{p}/assets/{a}` | media.view / media.edit | {caption?, credit?, photographer?, place?, takenAt?}; 409 `asset_in_use` |
| POST `/orgs/{o}/pubs/{p}/imports/docx` | story.create | {uploadId, editionId?} → 202 {importId}; the result arrives by SSE, then GET `/imports/{id}` → {state, created, skipped, notes} (the Desk's notes) |
| GET `/orgs/{o}/pubs/{p}/jobs/{id}` | the job's owner or the desk | → {kind, state, progress, error} |

### 5.4 The story state machine (proposed; question Q1)

| Change | Who | Notes |
|---|---|---|
| Draft → Filed ("Send to desk") | the author | Notifies Editors and Sub-editors |
| Filed → Editing | desk roles | On the first desk edit, or "Pick up" |
| Filed / Editing → Ready ("Mark ready" = desk approval) | desk roles | The reporter can no longer edit |
| Filed / Editing / Ready → Draft ("Send back") | desk roles | A comment is required; in-app and email notice to the reporter |
| Any (not Spiked) → Held; Held → back to where it was | desk roles | — |
| Any → Spiked; Spiked → restore | Chief Editor, Editor | — |
| Placed | system | From hosted layout (L2.3) |

---

## 6. Files

### 6.1 Buckets and key layout

| Bucket | Keys | Protection |
|---|---|---|
| `pgn-<env>-work` | `orgs/<org>/pubs/<pub>/uploads/<upload>` (quarantine; lifecycle deletes after 24 h) · `assets/<asset>/original` · `assets/<asset>/r/<purpose>-<params_hash>.<ext>` · `engine/datasets/<sha>.tar.zst` · `profiles/<id>/config.json` · `editions/<ed>/measure/latest.json` · `editions/<ed>/runs/<run>/{request.json, edition.pdf, press-files.zip, engine.log}` · `…/runs/<run>/pages/NN/{page.pdf, page.auto.pdf, manifest.json, preview.png, thumb.png, pdfx-check.txt}` · `desk-bundles/<id>.zip` (lifecycle 7 days) · `imports/<id>/…` | Versioning on; public access blocked; TLS-only bucket policy; SHA-256 in object metadata and in Postgres; noncurrent versions kept 30 days |
| `pgn-<env>-archive` (L2.5) | `orgs/<org>/pubs/<pub>/editions/<ed>/releases/<rel>/{manifest.json, pages/P01.pdf …, receipts.json}` | Object Lock in governance mode, with a default retention the owner sets; versioning; optional copy to Hyderabad |
| `pgn-<env>-backups` | Nightly `pg_dump -Fc` | Object Lock; ideally a separate AWS account (doc 04 §7) |

- Keys use ids, never names or dates, so keys carry no personal data and existence cannot be probed by hash.
- Deduplication is by `(org_id, sha256)` in the database, within one organisation only (RJ07).
- Encryption is SSE-S3. SSE-KMS is optional; it costs per request, so it is the owner's choice.

### 6.2 Presigned uploads

1. **Presign.** `POST /uploads` checks the type (JPEG, PNG, WebP) and size, writes an `upload` row, and returns a presigned **POST** (@aws-sdk/s3-presigned-post 3.1153.0) valid for 15 minutes:
   - exact key;
   - `content-length-range` from 1 byte to 40 MB;
   - Content-Type pinned;
   - `x-amz-meta-upload-id`.
   POST is used rather than PUT so that S3 itself enforces the size limit.
2. **Upload.** The browser or phone uploads straight to S3, with a progress bar and retry. On phones: `accept="image/jpeg,image/png,image/webp"` with `capture="environment"`. Whether iOS converts HEIC to JPEG for this input is to verify on the newsroom's phones.
3. **Complete.** `POST /uploads/{u}/complete`:
   - L2.1: the API does HeadObject (size) and a ranged GET of the first 32 bytes to sniff the magic bytes, then creates the asset as `received`.
   - L2.2 onward: the API also defers `media.ingest`, and the worker decides `ready` or `rejected`.
4. **The original is never altered.** EXIF (including GPS) stays only in the original; renditions drop all metadata, as the Desk's do.

### 6.3 CMYK conversion and previews

- **The same code as the Desk** (`deskserver/images.py`):
  - photos are scaled down to at most 2000 px on the long side and converted from sRGB to newsprint CMYK with littleCMS (perceptual intent, black-point compensation);
  - ads are fitted inside their slot at 200 ppi;
  - previews are JPEG at most 1600 px; thumbnails are made too.
- `params_hash` = SHA-256 of the ICC file, the `images.py` version and the size limits. A profile change makes new renditions; a run's `request.json` names the exact ones.
- **The colour profile** is private. It is fetched at worker start from the private bucket by its SHA-256. It is never in the image or the repository. Its licence terms are L3.
- **Previews stay on Pillow** in L2: one image pipeline, same as the Desk. sharp (Apache-2.0, but it bundles libvips under LGPL-3.0-or-later, which needs a reviewed exception) waits for zoom tiles in L3.

### 6.4 Downloads

- 5-minute presigned GET, tied to the object's VersionId, with `response-content-type` set from the sniffed type and `response-content-disposition`.
- Page PDFs and previews of unpublished pages are linked only through authorised API redirects (doc 15 §10, item 10).

### 6.5 Local development

- **SeaweedFS 4.48** (Apache-2.0; the same software as the VPS option) runs `weed server -s3` on 127.0.0.1:58333.
- `apps/api/scripts/dev-buckets.ts` creates the buckets: versioning on, and Object Lock enabled at creation on the archive bucket, because SeaweedFS needs it at creation.
- **Unit tests** use an in-memory object-store fake. **Integration tests** use SeaweedFS.
- **One staging check on real S3** in L2.1 covers POST policy conditions and checksums. SeaweedFS 4.48's notes mention POST-policy uploads and Object Lock; their exact behaviour is to verify by test.

---

## 7. Development environment

### 7.1 Docker Compose (`infra/docker/compose.dev.yml`, project name `pageinator`)

| Service | Image (pin by digest) | Host port | Notes |
|---|---|---|---|
| db | `postgres:18.6-trixie` | 127.0.0.1:**55432** | Avoids 5432 (a native Postgres runs there on this Mac) and 5433 (`mmr-dev-postgres-1`, never touched). Init SQL creates the roles and their database rights (the schemas come from PR 5's migrations), with passwords from `.env.dev` (git-ignored; `.env.dev.example` committed) |
| s3 | `chrislusf/seaweedfs:4.48` | 127.0.0.1:**58333** | `server -s3`, data in a volume |
| mail | `axllent/mailpit:v1.31.6` | 127.0.0.1:**58025** (UI), 127.0.0.1:**51025** (SMTP) | Catches every email in development |
| engine (profile `engine`, from L2.2) | built from `apps/engine-worker/Dockerfile` | gateway 127.0.0.1:**58790** (debug only) | Mounts `~/PageinatorPrivate` read-only for the dataset and colour profile: the owner's machine only |
| API, web | run on the host | API 127.0.0.1:**8780**; web (Vite) 127.0.0.1:**5180** with `strictPort` and a proxy for `/api` | Avoids the Desk's 8765, Vite's 5173 (in use by another process here), and macOS AirPlay on 5000/7000 |

- Scripts: `pnpm dev:up`, `pnpm dev:down`, `pnpm dev:reset`.
- Every script passes `-p pageinator` explicitly, so no command ever reaches another project's containers. There is no `down -v` across projects.

### 7.2 Seed data (fictional only)

`apps/api/scripts/seed-dev.ts`:
- **Organisation A:** "Kalpaniknagar Media (fictional)", with "काल्पनिकनगर वार्ता" (Marathi) and "Kalpaniknagar Express" (English). काल्पनिकनगर ("fictional town") is the fictional place the Desk's tests use.
- **Organisation B:** "Example Press B" (for the tenancy tests).
- **Users:** at `@example.test` (a reserved domain).
- **Stories:** fictional Marathi and English text.
- **Photos:** made at seed time by code, so no image files are committed (the privacy guard requires allowlisted SHA-256s for committed images).
- **Colour conversion in CI** uses a stub transform, as the Desk's tests already do, because the real profile is private.

### 7.3 Tests

| Layer | Tool | Where | Runs |
|---|---|---|---|
| Unit: permissions, state machine, desk-text parity vectors, `press_state` port, error mapping, bundle builder | Vitest | `apps/api/test/unit`, `packages/*/test` | `pnpm test` |
| Database integration, as the real `pgn_app` role (each file gets a fresh clone of a migrated template database) | Vitest + compose Postgres 18 | `apps/api/test/db` | `pnpm test:db`; CI fails, never skips, if the database is missing |
| Tenancy (a)–(g), role matrix, invitation and session suites | Vitest | `apps/api/test/tenancy` | CI |
| Contract: routes vs Zod/OpenAPI (@fastify/swagger 9.9.2, development only) | Vitest | `apps/api/test/contract` | CI |
| Worker: tasks with the Desk's fake engine (moved to a shared fixture); conversion with the stub transform; SeaweedFS and Postgres from compose | unittest (as the Desk) | `apps/engine-worker/test` | CI (in the image) |
| Desk regression (bundle import and existing tests) | unittest | `tools/desk/test` | CI from PR 3 |
| End-to-end smoke: sign in → file a story at a phone viewport → desk marks Ready → bundle | Playwright 1.64.1 | `apps/web/e2e` | CI at the end of L2.1 |
| Private, attested in the PR (O-d): real engine on the real dataset; hosted vs Mac parity; CMYK parity | local scripts | `~/PageinatorPrivate` | Locally |

### 7.4 CI additions (`.github/workflows/ci.yml`)

- **`api` job:**
  - `docker compose -p pgn-ci --env-file <a CI env file with random PGN_* values> -f infra/docker/compose.dev.yml up -d --wait db s3 mail` (compose refuses to start without every PGN_* value);
  - `pnpm install --frozen-lockfile`;
  - migrate;
  - codegen with a diff check;
  - Vitest projects `api`, `api-db`, `tenancy`.
- **`desk` job:** the oracle venv from the frozen lock, plus the Desk server environment from the new hashed `tools/desk/requirements.lock`; runs the Desk tests.
- **`engine-worker` job:** build the image (no push on PRs), run the worker tests inside it, run the Python licence check.
  - The Python licence check: installed distribution metadata against the same allowlist.
  - Expected reviewed exceptions: pikepdf (MPL-2.0); psycopg and psycopg-pool (LGPL-3.0-only), if the owner accepts them; certifi (MPL-2.0), if it is pulled in.
- **Security:**
  - `pnpm audit --prod --audit-level=high`;
  - gitleaks (to verify version and licence);
  - GitHub dependency review on PRs.
- **Unchanged:** the privacy, frozen-evidence and licence guards.
- **New dependencies** go into the `pnpm-workspace.yaml` catalog at exact versions (`check-graph.ts` refuses ranges).
- **ESLint:** a Node-globals block for `apps/api/**`, plus the module-boundary rules.

---

## 8. Hosting for the pilot

### 8.1 Options

The costs are 09 §3.1's estimates: one paper, about 20 staff, before GST.

| Option | Monthly | Parts | Operations work |
|---|---|---|---|
| **A. AWS Mumbai, minimal** (recommended) | about ₹22k; about ₹31k with a standby database | EC2 app host (Caddy v2.11.7 for TLS, the API, static web) · EC2 engine host (no public ingress; the worker, and the gateway from L2.4) · RDS Postgres 18 (PITR; standby = Multi-AZ) · S3 work/archive/backups · SES ap-south-1 · SSM Parameter Store for secrets · CloudWatch logs and alarms | Least: managed database and storage; Docker Compose on EC2 as 09 says |
| **B. An Indian VPS provider** | about ₹12–17k | 2–3 VMs · self-managed Postgres with WAL archiving (pgBackRest or WAL-G, licences to verify) to off-site object storage · SeaweedFS as the S3 store · SMTP from the provider, or SES | Most: backups, upgrades, failover and Object Lock behaviour are ours |
| C. Supabase Mumbai, only as managed Postgres, plus AWS compute and S3 | not in 09; to estimate | As A, with Supabase instead of RDS | Medium. Disable the Data API for our schemas; LISTEN and Procrastinate need direct or session connections (IPv6, or the IPv4 add-on: to verify); PITR is an add-on; the Postgres 18 version there is to verify (or add a SQL `uuidv7`) |

**Why A:**
- It matches ADR-008's region and provider hypothesis.
- RDS gives point-in-time recovery and S3 gives Object Lock without our operations work.
- SES is in the same region.
- RDS has offered Postgres 18 since November 2025; the minor versions available in ap-south-1 are to verify.

### 8.2 Topology and deployment

- **One environment**, "pilot". Staging is a second Compose project on the engine host, using a separate database and buckets.
- **Images:**
  - API: `node:24` slim, pinned by digest;
  - engine worker: x86_64 by default (risk R1).
  Both are built in CI and pushed to a private registry (ECR or GHCR).
- **Deploy:** `docker compose pull`, then the migration step, then `up -d`.
- **Rollback:** redeploy the previous image. Because migrations are expand/contract, the old version still runs against the new schema.
- **The deployed app** serves the signed-in product and its sign-in pages only. The public website is a separate claims decision (03 §4).

### 8.3 Backups

- **Database:**
  - RDS automated backups with point-in-time recovery for 14–35 days (the owner chooses);
  - a nightly `pg_dump -Fc` to the backups bucket, under Object Lock.
  - Targets from doc 04 §7: RPO ≤ 5 minutes, RTO ≤ 1 hour.
- **S3:** versioning on all buckets. Copying the archive and backups to Hyderabad is the owner's choice.
- **Engine homes:** caches only; datasets are restored from S3.
- **Restore drill:** monthly during L2. Restore point-in-time to a new instance, then run `verify-restore.ts`: row counts, the latest audit entry, a story checksum, and that recent S3 objects exist. Record the result.

### 8.4 Monitoring

- **Uptime Kuma 2.5.6** (MIT) on a small separate host, so it is not inside what it watches. It checks:
  - `/healthz`;
  - `/readyz` (database, S3, queue age, worker heartbeat in `procrastinate_workers`);
  - the web app;
  - TLS certificate expiry.
- **Logs:** pino JSON to CloudWatch (or journald with rotation on a VPS). No story text at info level.
- **Not used:** Grafana and Loki (AGPL).
- **Alerts** go to the owner and the on-call person:
  - the API is down;
  - no worker heartbeat for 60 s;
  - the oldest waiting job is older than 2 minutes between 18:00 and 02:00 IST (ADR-016);
  - a layout run failed;
  - a backup failed;
  - disk above 80%.
- **Runbooks:**
  - deploy and rollback;
  - restore;
  - "engine down near deadline": switch to the Desk with the edition bundle, and download the last pages that passed the check;
  - "Better Auth advisory".

### 8.5 Owner decisions for hosting

1. Provider: A, B or C.
2. Monthly budget.
3. A standby database now, or only before the first live night.
4. The copy to Hyderabad.
5. Domain names (`app.<domain>`) and the email sending domain, with SPF/DKIM/DMARC.
6. Who receives alerts, and who is on call on production nights.
7. Whether to upload the private engine dataset, the colour profile and later the house fonts to the cloud (licences L2 and L3).
8. External error tracking (a third-party processor) or none.
9. Retention of backups, and the Object Lock retention for the archive.
10. A privacy notice and grievance contact for staff accounts (DPDP; counsel L5).

---

## 9. Risks, open questions, owner decisions

### 9.1 Risks

| # | Risk | Likelihood / impact | Mitigation | When |
|---|---|---|---|---|
| R1 | **The hosted engine's PDFs differ from the Mac's.** macOS libm vs Linux glibc, or different wheels, could tip a layout search | Medium / High | The L2.3 parity check (bytes, or a structural diff accepted in writing). Use x86_64, which matches the frozen lock CI already installs; arm64 only if the frozen `requirements.lock` already holds linux-aarch64 hashes (changing the lock needs the evidence-change approval). Press-test a hosted page before relying on it | L2.3 |
| R2 | **Edit requests serialised per run**, with "another layout" taking up to 180 s | Medium / Medium | Measure p95 in L2.4; split out the alternatives search if needed | L2.4 |
| R3 | **Better Auth's advisory pace**: at least 10 advisories in June–September 2026 | High / High | Two plugins only, exact pin, advisory watch, 48 h upgrade rule with the suites, Keycloak fallback behind `IdentityPort` | L2.1 onward |
| R4 | **Licences in the Python worker**: psycopg and psycopg-pool are LGPL-3.0-only (required by Procrastinate); pikepdf is MPL-2.0 | Certain / Medium | Owner review (as doc 18 treats libvips: unmodified, server-side, never distributed). If refused: Graphile Worker (MIT) in Node drives the engine CLI, with no Python database driver | Before L2.2 |
| R5 | **Private data in the cloud**: the dataset (the paper's page models, template photos, masthead art), the colour profile, later fonts | — / High | Owner consent; private bucket; never in images or the repo; readable only by the engine role | Before L2.2 / L2.3 |
| R6 | **Two sources of truth** during the transition | Medium / Medium | `produced_in`, one-way bundles, a verified one-time import | L2.1–L2.3 |
| R7 | **Poor phone networks** | High / Medium | Idempotency keys, local drafts, presigned POST with retry | L2.1 |
| R8 | **CPU sizing unknown.** On the Mac's 12 cores, 8 pages take about 2 minutes and 16 about 3 (Desk README); cloud vCPUs differ. The engine sizes its pool by `os.cpu_count()`, which in Python 3.11 ignores container limits | Medium / High | Benchmark two sizes; pin cpusets; possibly a worker-count setting in the engine | L2.3 |
| R9 | **Scope against one developer** | High / High | Each milestone ships to real use; PRs of at most 400 lines; calendar estimated after the first five PRs show the real pace | All |
| R10 | **DPDP duties** for staff accounts | Medium / Medium | Privacy notice, grievance contact, breach runbook, erasable `person` rows; counsel L5 | L2.1 |
| R11 | **Email deliverability** to Gmail and Indian providers | Medium / Medium | SPF/DKIM/DMARC; SES production access; Mailpit in development | L2.1 |
| R12 | **Marathi wording quality** | Medium / Medium | A catalogue from the first screen; review by a native editor | L2.1 |
| R13 | **Ads beyond the back page** need engine work | Certain / Medium | Hidden until the engine supports them; owner decision | L2.6 |
| R14 | **TypeScript 7 (native) with Kysely and Zod-provider types**: compatibility and speed unknown | Low / Medium | Smoke-test in PR 4–5 | L2.1 |
| R15 | **Desk contract changes** (bundle import) | Low / Medium | Desk tests in CI from PR 3; offline-only bundle | L2.1 |
| R16 | **Node 24 type stripping** is "release candidate" (stability 1.2) in 24.x, and stable only in 26 | Low / Low | Run `.ts` directly as `tools/ts` already does, with `tsc -b` in CI; switch to emitted JS if it breaks | L2.1 |

### 9.2 Open questions (proposals in bold)

| # | Question | Proposal |
|---|---|---|
| Q1 | The spec has "Mark ready (primary for reporters)" but desk statuses Draft/Filed/Editing/Ready | **Reporter: "Send to desk" (Filed). Desk: "Mark ready" (Ready = approval)** |
| Q2 | Priority 1–5 (spec) vs 1–4 (Desk and engine) | **1–4 until the engine takes 5** |
| Q3 | Several photos per story (spec) vs one (engine) | **One until the engine takes more** |
| Q4 | A 6-digit email code (spec) vs a link | **Link in L2.1** (no email-OTP plugin) |
| Q5 | A double-submit CSRF token (doc 11) vs Origin + custom header | **Origin + header** (ADR-025) |
| Q6 | Which roles require two-step | **Owner and Admin; Prepress at the owner's choice** |
| Q7 | Do all reporters have email? | **Email only in L2**; phone sign-in later (it needs an SMS/WhatsApp provider) |
| Q8 | Who exports to the Desk, approves pages and approves release in the pilot | Owner names people; grants as in §12 |
| Q9 | Story body format | **Keep the Desk's `desk-text/1`** (paragraphs and `## ` subheadings), because that is exactly what the engine prints. No bold or italic buttons until the engine sets them. ProseMirror later, through a converter |

### 9.3 What the owner must decide before each milestone

| Before | Decisions |
|---|---|
| **L2.1** (PR 25 deploys; earlier PRs need none) | D-1 hosting provider and budget (§8.5) · D-2 domain and email sender · D-3 staff list, roles and two-step policy · D-4 Desk bridge: **bundle file (recommended)** or a pull over HTTPS (changes the Desk's "no network" rule) · D-5 Marathi reviewer · D-6 staff privacy notice · D-7 approve the deviations in Q4–Q5 and ADR-025 |
| **L2.2** | D-8 accept psycopg (LGPL-3.0-only) and pikepdf (MPL-2.0) as reviewed exceptions, or take the Node-queue alternative · D-9 upload the colour profile (licence L3) · D-10 how long photos are kept |
| **L2.3** | D-11 upload the engine dataset · D-12 engine host size and architecture · D-13 which Desk data to import (all editions or recent; samples or not) · D-14 the parity rule (bytes, or a structural diff plus press test) |
| **L2.4** | D-15 a straight port of `editor.js` (recommended) or a Konva rewrite · D-16 house fonts, if they have arrived: server use and browser outlines (L2, ADR-019) · D-17 the take-over policy for page locks |
| **L2.5** | D-18 delivery method (download and send yourself) and file naming · D-19 approval required before export · D-20 archive retention · D-21 G2 press test of a photo + ad page recorded · D-22 light penetration test now or before L4 |
| **L2.6** | D-23 ads only where the engine supports them, or fund the engine work for inside pages · D-24 artwork formats (images only, or PDF with sandboxed intake) · D-25 booking fields and cut-off time |

---

## 10. First PRs for L2.1, in order

Rules for every PR:
- at most 400 net lines where possible (generated files counted separately);
- a code review and an independent verification;
- `pnpm run ci` green;
- `pnpm run guard` before every push;
- `graphify update .` after code changes;
- the commit trailer as in CLAUDE.md.

| # | PR | Contents | Size | After |
|---|---|---|---|---|
| 1 | docs: L2 decisions | ADR-025 (one writer; engine worker by Procrastinate, S3 and the event inbox; identity zone; publication RLS; same origin; Origin + header CSRF) · Desk README/CONTRACT: the engine is also the hosted service · DEVELOPMENT.md ports table · `tools/ts/workspace.json`: `contracts` and `desk-text` as non-kernel | ~250 (docs) | M0 + `feat/desk` merged |
| 2 | infra: development compose | `infra/docker/compose.dev.yml` (Postgres 18.6, SeaweedFS 4.48, Mailpit 1.31.6; ports in §7.1) · role init SQL (database rights only; schemas from PR 5) · `.env.dev.example` · `pnpm dev:*` scripts with `-p pageinator` | ~180 | 1 |
| 3 | ci: the Desk's tests | `tools/desk/requirements.lock` (hashed, from the pdfx1 pins) · CI job `desk` (both venvs, fictional tests) · fake engine moved to a shared fixture | ~150 | 1 |
| 4 | api: skeleton | `apps/api` (fastify 5.12.7, zod 4.6.7, fastify-type-provider-zod 7.0.0, @fastify/helmet 13.2.0, @fastify/rate-limit 11.2.1) · Zod config · `buildApp` · error envelope · request id · `/healthz`, `/readyz` · Origin and header guard · `packages/contracts` seed (error codes) · Vitest project `api` · ESLint Node block | ~380 | 2 |
| 5 | api: database plumbing | kysely 0.29.7, pg 8.23.1 · pools (app, auth, listen) · `withTenant` · migration runner · migrations for schemas, helper functions, grants, `publication`, `person`, `org_settings`, `audit_event` with RLS · kysely-codegen 0.20.0 with CI diff · ESLint: no raw pool outside `src/db` | ~400 | 4 |
| 6 | api: tenancy harness | Catalog meta-test (a) · cross-tenant generator (b) with two fictional organisations · planted-defect test · CI job `api` on compose | ~300 | 5 |
| 7 | identity 1: Better Auth | a request-log serializer that drops the query string (Better Auth's emailed links carry tokens) · better-auth 1.7.12 · generated `identity` migration (`auth` 1.7.12 CLI; generated SQL listed separately) · mount `/api/auth/*` · argon2id (@node-rs/argon2 2.2.2) · nodemailer 10.1.7 with Mailpit · verification and reset emails (en/mr) · telemetry off | ~350 + generated | 6 |
| 8 | identity 2: sessions | `request.actor` resolution · 30-day absolute limit · rate-limit rules and the per-email failure counter · `identity.auth_event` · "new sign-in" email · tests: generic wrong-password answer, reset revokes sessions, lockout | ~350 | 7 |
| 9 | orgs and permissions | Organization plugin · `publication_grant`, `invitation_grant` · permission map from §12 in contracts · `authorize()` and the route-declaration meta-test · `/me` · `bootstrap-org.ts` | ~400 | 8 |
| 10 | invitations | Endpoints (§5.2) · invite-only sign-up hook · `afterAcceptInvitation` grants and reconciliation · invitation suite (CVE-2026-53514 regression, wrong email, expired, race, no injected grants) | ~400 | 9 |
| 11 | two-step | twoFactor plugin · `mfa_required_roles` · `two_step_required` enforcement · tests | ~250 | 10 |
| 12 | web 1: catalogue and client | English/Marathi catalogue with glossary seeds (02 §3.9) and a key-parity meta-test · API client (envelope, Idempotency-Key, `X-Pageinator`, 401) · real session service replacing `SimulatedSessionService`, with the simulated DTO tests rewritten (doc 15 §11) | ~400 | 11 |
| 13 | web 2: sign-in screens | Sign in (with "Keep me signed in") · invitation and sign-up · verify · forgot and reset · two-step verify | ~380 | 12 |
| 14 | web 3: Account → Security | TOTP setup with QR (qrcode 1.5.4) · backup codes · devices and sign-out | ~300 | 13 |
| 15 | desk-text | `packages/desk-text` (port of `blocks`, `body_words`, `is_brief`, `clean_text`, the paste parser) · a Python vector generator run in the oracle venv on fictional text · parity test | ~350 | 4 |
| 16 | content schema | Migrations for `section`, `edition`, `story`, `story_revision` (with the closed-revision trigger), `story_status_change`, `story_photo`, `comment`, `idempotency_key`, `desk_bundle`, with RLS; (b) covers them automatically | ~350 | 6, 15 |
| 17 | stories API | Create, read, list, update with revisions and `baseRevision` · transitions (§5.4) · assignment · paste · idempotency middleware · role-matrix tests · the endpoint tenancy generator (c) | ~400 | 16, 9 |
| 18 | photos (originals) | @aws-sdk/client-s3, s3-presigned-post and s3-request-presigner 3.1153.0 · presign, complete and sniff · assets · story photo · downloads · storage tests (d) · `dev-buckets.ts` | ~400 | 17 |
| 19 | comments, notifications, live updates | Comments · notifications with §11 defaults · SSE over LISTEN/NOTIFY with authorised fan-out (test (f)); the streams end in a `preClose` hook, so a stop does not wait the whole grace period · send-back and invitation-accepted emails | ~400 | 17 |
| 20 | web 4: shell and Team | Navigation from `/me` permissions · Team (members, invite dialog, pending invitations) | ~350 | 14, 10 |
| 21 | web 5: Stories list | Content desk table and phone list · status chips · words · filters · edition picker · minimal "Create edition" | ~400 | 20, 17 |
| 22 | web 6: story editor | Phone-first plain text boxes (so every Marathi input method works) · autosave with `baseRevision` and conflict handling · transitions · local draft · photo from camera or gallery | ~400 | 21, 18 |
| 23 | web 7: comments, alerts, audit | Comments panel · notifications drawer · live updates · Audit log screen | ~400 | 22, 19 |
| 24 | bridge: the story bundle | API: `pageinator.story-bundle/1` ZIP, streamed with `reply.send(stream)` (a buffer handed to Node whole is cut off by a stop) (fflate 0.8.3: `bundle.json` with story revisions plus photo originals and SHA-256s) · Desk: `deskserver/bundle.py`, `POST /api/editions/<id>/articles/import-bundle` (zip limits as in `docx.py`; re-import replaces only articles not changed in the Desk), button "Pageinator stories…", CONTRACT update · tests on both sides with a fictional bundle | ~400 (may split API / Desk) | 18, 3 |
| 25 | deploy: pilot | API Dockerfile (the container runs `node src/main.ts` itself, not through pnpm, so a stop signal reaches it once) · Caddy config (`PGN_TRUST_PROXY` set to Caddy's address; `/healthz` and `/readyz` not routed through Caddy) · pilot compose (`stop_grace_period` above `PGN_SHUTDOWN_GRACE_S` + 5 s; `init: true` or tini, since as PID 1 the API would ignore a second stop signal) · migration step · backup configuration · Uptime Kuma checks · runbooks (deploy, rollback, restore) · TLS and DNS | ~300 + docs | D-1, D-2 |
| 26 | L2.1 verification | Playwright phone-viewport smoke · `verify-restore.ts` and the first drill record · security-headers test · "L2.1 done" evidence note (aggregates only) | ~250 | 25 |

**Parallel work:**
- PRs 12–14 and 20–23 (web) can run beside 15–19 (API) once their endpoints exist.
- PR 3 and PR 15 can start any time after PR 1.

---

## Appendix A. Versions and licences checked on 2026-10-20

| Part | Version | Licence | Source / note |
|---|---|---|---|
| fastify | 5.12.7 | MIT | npm |
| kysely | 0.29.7 (node ≥ 22) | MIT | npm |
| pg | 8.23.1 | MIT | npm |
| better-auth / `auth` (its CLI) | 1.7.12 / 1.7.12 | MIT | npm; GitHub releases (1.7.12 released 20 Oct; 1.7.7 fixed the critical magic-link advisory). `@better-auth/cli` is deprecated |
| zod | 4.6.7 | MIT | npm |
| fastify-type-provider-zod | 7.0.0 | MIT | npm (peers: zod ≥ 4.1.5, fastify ^5.5.0, @fastify/swagger ≥ 9.5.1, openapi-types ^12.1.3) |
| @fastify/swagger · openapi-types | 9.9.2 · 12.1.3 | MIT · MIT | npm |
| @fastify/rate-limit · helmet · cookie · cors · under-pressure | 11.2.1 · 13.2.0 · 11.1.3 · 11.3.1 · 9.2.1 | MIT | npm (cookie, cors and under-pressure probably not needed) |
| @aws-sdk/client-s3 · s3-presigned-post · s3-request-presigner | 3.1153.0 | Apache-2.0 | npm |
| pino | 10.4.0 | MIT | npm |
| nodemailer | 10.1.7 | MIT-0 | npm (MIT-0 is on the allowlist) |
| @node-rs/argon2 | 2.2.2 | MIT | npm (licences of its native binary packages: to verify by `check-licences`) |
| kysely-codegen · kysely-ctl | 0.20.0 · 0.22.0 | MIT | npm (kysely-ctl not needed) |
| testcontainers · @testcontainers/postgresql | 12.2.1 | MIT | npm (optional; compose is the default) |
| fflate · qrcode · @playwright/test | 0.8.3 · 1.5.4 · 1.64.1 | MIT · MIT · Apache-2.0 | npm |
| sharp · @img/sharp-libvips-linux-x64 | 0.35.5 · 1.3.4 | Apache-2.0 · **LGPL-3.0-or-later** | npm (not used in L2) |
| procrastinate | 3.10.0 | MIT (classifier) | PyPI (requires `psycopg[pool]`, croniter 6.2.4 MIT) |
| psycopg · psycopg-pool | 3.3.6 · 3.3.3 | **LGPL-3.0-only** | PyPI |
| boto3 | 1.43.115 | Apache-2.0 | PyPI |
| pikepdf | 9.11.0 | **MPL-2.0** | PyPI (already in the Desk's server environment) |
| Pillow · pypdfium2 | 12.3.0 · 4.30.1 | to verify (MIT-CMU · Apache-2.0 or BSD-3) | pinned in `experiments/phase0/pdfx1/requirements.txt` |
| PostgreSQL | 18.6 current (18 supported until Nov 2030) | PostgreSQL | postgresql.org; Docker tags `18.6-trixie` and `18.6-bookworm` exist; RDS supports 18 (Nov 2025 announcement; ap-south-1 minor versions to verify) |
| SeaweedFS | 4.48 (28 Sep) | Apache-2.0 | GitHub (licence API, releases); Docker tag `4.48` exists |
| Mailpit | v1.31.6 (15 Oct) | MIT | GitHub |
| Uptime Kuma | 2.5.6 (9 Oct) | MIT | GitHub |
| Caddy | v2.11.7 (3 Oct) | Apache-2.0 (to verify) | GitHub releases |
| Node 24 type stripping | stability 1.2 in 24.12+, stable in 26 | — | to verify on the pinned patch version |
| Better Auth CVE-2026-53514 | fixed in 1.6.11, and the `requireEmailVerificationOnInvitation: true` setting is still required | — | third-party trackers; confirm in GHSA-fmh4-wcc4-5jm3 |

**Sources:**
- [npm: fastify](https://registry.npmjs.org/fastify/latest)
- [npm: kysely](https://registry.npmjs.org/kysely/latest)
- [npm: better-auth](https://registry.npmjs.org/better-auth/latest)
- [npm: auth (Better Auth CLI)](https://registry.npmjs.org/auth/latest)
- [npm: zod](https://registry.npmjs.org/zod/latest)
- [npm: pg](https://registry.npmjs.org/pg/latest)
- [npm: fastify-type-provider-zod](https://registry.npmjs.org/fastify-type-provider-zod/latest)
- [npm: @img/sharp-libvips-linux-x64](https://registry.npmjs.org/@img/sharp-libvips-linux-x64/latest)
- [PyPI: procrastinate](https://pypi.org/pypi/procrastinate/json)
- [PyPI: psycopg](https://pypi.org/pypi/psycopg/json)
- [PyPI: psycopg-pool](https://pypi.org/pypi/psycopg-pool/json)
- [PyPI: pikepdf 9.11.0](https://pypi.org/pypi/pikepdf/9.11.0/json)
- [PyPI: boto3](https://pypi.org/pypi/boto3/json)
- [Better Auth security advisories](https://github.com/better-auth/better-auth/security/advisories)
- [GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm)
- [GHSA-qq9h-g4jm-xgf3](https://github.com/better-auth/better-auth/security/advisories/GHSA-qq9h-g4jm-xgf3)
- [Better Auth releases](https://github.com/better-auth/better-auth/releases)
- [CVE-2026-53514 (Vulert)](https://vulert.com/vuln-db/CVE-2026-53514)
- [CVE-2026-53514 (SecureLayer7)](https://securelayer7.net/lab/cve-2026-53514-better-auth-organization-invitation-takeover-unverified-email)
- [Procrastinate schema.sql](https://raw.githubusercontent.com/procrastinate-org/procrastinate/main/procrastinate/sql/schema.sql)
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/)
- [RDS for PostgreSQL 18](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-rds-postgresql-major-version-18)
- [SeaweedFS releases](https://github.com/seaweedfs/seaweedfs/releases)
- [Node.js TypeScript docs](https://beta.docs.nodejs.org/process/features.typescript)

Also consulted through Context7: Better Auth documentation (organization plugin hooks, `schemaName`, twoFactor options, telemetry) and Procrastinate documentation.

### Critical Files for Implementation
- tools/desk/CONTRACT.md
- tools/desk/deskserver/jobs.py
- tools/desk/deskserver/editing.py
- tools/desk/engine/desk_engine.py
- apps/web/src/features/auth/SessionProvider.tsx