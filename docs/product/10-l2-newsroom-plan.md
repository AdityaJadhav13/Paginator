# Pageinator L2, "the newsroom": implementation plan

Status: a proposal for the owner to approve, dated 2026-10-20. It builds 09-launch-plan.md §4 L2 on the stack in §3.1. PRs 1–8 are now built on `feat/l2-foundation`; where the build differs from this plan, the section says so and why (§3.6, §4.1, §10, Appendix A). Every example name is fictional. Package versions and licences were checked on 2026-10-20 (Appendix A); anything not checked is marked "to verify".

## 0. Summary

1. **Seven milestones, each used on real work:**
   - L2.1 People and the story desk;
   - L2.2 Photo desk and the engine worker;
   - L2.3 Editions and layout, hosted;
   - L2.4 The page editor, hosted;
   - L2.5 Release;
   - L2.6 Ads desk and the edition plan;
   - L2.7 The news finder (owner request 2026-11-04; 13-news-finder.md).
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
6. **Better Auth 1.7.8, pinned, with only two plugins** (organization and twoFactor), and sign-up only by invitation. (1.7.12 was the plan; §4.1 says why 1.7.8 is built.)
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

**As built (L2.3), where it differs from this plan:**
- **ZIP, not `tar.zst`:** `tools/desk/export-home.sh` makes `desk-home.zip` and `engine-dataset.zip`, and the engine profile's dataset bundle is a `.zip` (`profiles/<id>/dataset.zip`): neither the worker's Python 3.11 nor the API reads zstd without a new dependency. Each file still carries its SHA-256.
- **Inbox payload limit:** an engine event is at most 64 KiB, but `run.finished` and `profile.ready` may be up to 1 MiB (a 16-page run's pages, checks and not-placed reasons; a profile's config), checked by `engine_event_payload_check`.
- **Imported runs have `profile_id` null:** the Desk made them before any hosted profile existed (`apps/api/src/db/desk-import.ts`).
- **A queue stopped during a layout** reports `job.failed` with `worker.restarted`: a run cannot be resumed by a later attempt, so the run fails with the Desk's RESTARTED message and the editor starts a new one (`apps/engine-queue/src/tasks.ts`). The deployment's stop grace period must exceed a page's work.
- **Orphan engines are stopped through `/proc`:** the worker's slim image has no `ps`, which the Desk's own orphan check runs, so the launcher reads `/proc` instead (`apps/engine-worker/pgn_worker/launcher.py`).

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

**As built (L2.4), where it differs from this plan:**
- **No Konva.** The editor keeps the Desk's canvas display-list code, ported to TypeScript (`apps/web/src/features/editor/view.ts`), with the handles and snapping of `editor.js`; no new dependency.
- **The gateway** is `apps/engine-worker/pgn_worker/gateway.py` (`python -m pgn_worker.gateway`; `PGN_GATEWAY_SECRET`, `PGN_GATEWAY_HOST`, `PGN_GATEWAY_PORT`, plus the worker's own settings; the API's `PGN_GATEWAY_URL` and `PGN_GATEWAY_SECRET`). The signed text also carries a random nonce (`x-pgn-nonce`), and the replay check is on the nonce: two identical calls in one second are both real (found by the verification). The wire is `packages/contracts/src/editor.ts`. The API refuses a plain-http `PGN_GATEWAY_URL` that is not on its own machine: a gateway on another host needs TLS in front of it. The gateway never moves a page's edit file back to an older revision: a file ahead of Postgres (an answer the API never stored) is reported in `edits` and stored, so Postgres catches up. Moves and saves of one run take turns (a Postgres advisory lock), as the Desk's save lock does; layout jobs and the editor take turns writing an edition's files (a file lock per edition).
- **The run's working files stay on the engine host.** The gateway edits the run folder the layout left in the homes volume (request, plan, manifests, printed record); Postgres rebuilds only the edit files (each page's latest `{rev, modules}`, the run's text overrides). A run whose folder is gone answers `run_missing` ("lay the edition out again"; L2-461).
- **A save runs the check through the cache**: the gateway exports, makes the previews and merges `edition.pdf` and `press-files.zip`; the API then reads `app.pdf_check` for those bytes, and only when they were never checked asks the gateway's `check`. Each save is also kept in `app.page_save` (the history shows it with its check).
- **Scoped `layout.edit` (◐) is refused** for page changes (L2-464); the soft lock expires 75 s after the last heartbeat (the web beats every 30 s), and an unanswered take-over ask wins after 30 s (L2-463).
- **"Unreadable" counts as a placement problem** in the TypeScript `pressFlags`, as `editing.py` says it should (the Desk's `press.py` does not count it).
- **Screen equals print** is checked at L1 in CI on a fictional page made through the engine's own writer (`apps/engine-worker/test/test_screenprint.py`, which writes the fixture), and at L2 by the web's draw log against that fixture (`apps/web/tests/editor/screen-print.test.ts`). On the real engine (the owner's templates, fictional stories, 2026-11-05) two pages compared equal: 7,287 and 9,308 glyphs.

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

**As built (L2.5), where it differs from this plan:**
- **The wire** is `packages/contracts/src/release.ts` (its header lists every route and rule); the API is `apps/api/src/modules/release` and `src/db/release.ts`, the screen the edition's **Release** tab (`apps/web/src/features/release`), with Approve and Unlock also on the Pages board and in the editor.
- **No `preflight_run`, `preflight_issue` or `preflight_override` tables.** The preflight list is computed when it is read, and again inside the release's transaction, from what really runs: the edition laid out, each page's independent PDF/X-1a check on its current bytes (`app.pdf_check` for the page's SHA-256 and the run's checker), pages saved (no unsaved edits, nothing "needs saving", no older text), placement (no story twice, no overlap: `pressFlags`), the issue number set, every back-page ad slot's artwork ready, every page approved, the G2 press test on record (only for an edition with a photo or an ad), and the stories not placed (a warning, the only item that never stops a release). Every other item blocks, so there is nothing to override. The tables built are `page_approval`, `release`, `release_file`, `delivery` and `press_test` (migration `2026_12_04_0001_release.ts`).
- **An approval is bound to the page's revision and its PDF's SHA-256**, and counts only while both are the page's own and the page has no unsaved edit: anything that still changes the page (a new layout run) ends it without a write. An approved page is locked: the editor refuses a change, a save or a move to it, and a save elsewhere that would take a story off it (`page_approved`), until someone with `page.unlock` unlocks it (the approval is kept, marked unlocked, write-once). Approve, unlock and editor changes take the same run and page locks, and a release holds the run's pages `FOR SHARE` until it commits.
- **A release is bound to the exact `{page, SHA-256}` list** the approver saw: the first release holds every page, a later one (a correction, which also needs `release.correct`) only the pages whose bytes changed since their last release. Files are named `<edition>_P01.pdf`, and `_v2`, `_v3` … for a page's later releases (owner decision D-18 may rename them).
- **The archive copy is written by the API**, inside the release's transaction: each page PDF's pinned version is read and hashed, written to the archive bucket at `orgs/<org>/pubs/<pub>/editions/<ed>/releases/<rel>/pages/<name>` with its `ChecksumSHA256` under Object Lock (governance, `PGN_ARCHIVE_RETAIN_DAYS`, 3653 by default until the owner decides D-20), and read back and hashed again; then `manifest.json`. A mismatch or a store error releases nothing (`archive_failed`). A server-side copy was not used: it cannot carry a checksum we give. Each "Mark as sent" and each press confirmation writes a new version of `receipts.json` beside them, so every older receipt is kept. Files left in the locked bucket by a rolled-back release are not cleaned up (L2-480).
- **Object Lock, as tested:** SeaweedFS 4.48 enforces governance retention (a version's delete without the bypass header is refused; with it, allowed; a wrong checksum is refused), and the database tests check the refused delete on a bucket of their own. In the pilot the API's IAM policy may write and read the archive but is explicitly denied every delete, the governance bypass, and changes to the bucket's lock and legal holds (`infra/aws/iam-api-policy.json`, `s3-archive-object-lock.json`, pinned by `deploy-files.test.ts`).
- **Downloads** are the archived versions themselves (5-minute links, `export.press`), so the bytes sent are the bytes released, archived and checked. There is no "download all" ZIP yet (L2-481).
- **What the pages print, not what the edition holds now:** a run records the ad rasters its request held (`layout_run.ad_rasters`), and the ad artwork item fails ("lay out again") when a slot's artwork differs from them (a run imported from the Desk has no record and always asks for a new layout). The edition's volume, issue and price can now be changed (`PATCH …/editions/:e`, `edition.edit`); `edition.folio_changed_at` later than page 1's PDF fails the folio item: the engine keeps the folio of when the page was opened, so the fix is "Update text" on page 1 and save it, or a new layout.
- **The G2 evidence** is one record per publication (`press_test`: the accepted test page's SHA-256, the date, a note), filled in by `settings.edit` holders.
- **The first release sets the edition's status to `released`.**

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

**As built (L2.6), where it differs from this plan:**
- **The wire** is `packages/contracts/src/ads.ts` (its header lists every route and rule); the API is `apps/api/src/modules/ads` (`routes.ts`, `place.ts`, `cutoff.ts`) with `src/db/ads.ts` and `src/db/ad-cutoff.ts`, migrations `2026_12_05_0001_ads.ts` and `2026_12_05_0002_ad_cutoff.ts`; the web is the Ads desk (`apps/web/src/features/ads`) and the edition's **Plan** tab.
- **Sizes are the engine's slots:** a booking books one size of the back-page slots of the profile in use (`GET ads/sizes`), at one named slot or any slot of that size. Inside-page ads, PDF artwork and a colour/mono page map are not offered (hidden until they work). A booking's colour is recorded and shown, never checked.
- **No `ad_artwork` table:** a booking's artwork is a picture of the media library (`ad_booking.artwork_asset_id`), checked by the shared `checkArtwork` when read: its shape fitted inside the slot leaves at most 0.5 mm empty, and it has at least 200 ppi at that size. Every picture also carries the note that it is converted from RGB to the paper's CMYK (the Desk's `convert_ad` decodes every picture to RGB first). Artwork that fails a check is not placed. The sizes checked are the file header's, before EXIF rotation (L2-500).
- **Placement reuses L2.3:** a placed booking whose artwork passed sets the slot's `ad_slot_artwork` (media.ad fits it, as before), so the next layout prints it and the release's ad-artwork item covers it. A booking is placed by its rule when it is made or changed; every booking of a date is placed when its edition is created and by "Place booked ads" (a freed slot waits for that button: L2-501); a placement can be set or taken out by hand. Booking changes and placements lock bookings first, then editions. Editions already released are never changed. The L2.3 route that sets a slot's picture directly refuses a booked slot (`slot_booked`).
- **The cut-off** is per publication (`ad_settings`: a time and a number of days before the edition date, 18:00 the day before until the owner decides), in the publication's timezone. A schedule in the API (every minute) records one `ad_cutoff_alert` per publication and date the first time, after its cut-off and before the date ends, that it finds bookings without good artwork (a booking taken after the cut-off included); only the instance that records it tells Advertising, Chief Editors, Editors, Owners and Admins (a notification and an email each). It fires once per date, and not again when a booking changes later; a pass that finds nothing missing records nothing (found by the verification: an empty record used to use the date up).
- **The flatplan** shows each page's role and template role (from the profile's plan), its planned section and note (`flatplan_page`), the sections the Pages board run placed there, and the back-page slots with their bookings; "Copy plan from…" copies another edition's (same page count) sections, notes and the placements whose bookings also run on the new date, then places the rest by their rules. Advertisers, campaigns and the unplaced bookings are shown only to people with `ads.view`; the plan's pages are shown to everyone with `edition.view`. Slots are listed at the foot of the back page, to scale but not at their place on it (the profile's plan names no positions).

### The five sidebar screens (owner request 2026-11-05: "Built it now")

**As built (sidebar screens)**, migration `2026_12_06_0001_screens.ts`; only what works is shown, the rest is in doc 11 (L2-540 onwards):
- **Templates** (`templates.view`; change: `templates.edit`): the engine profile in use, its template page per role (front, inside with the imprint, inside, back) drawn as an **outline** (page, news area, the furniture the engine keeps, ad slots: "the page's outline as the engine reads it", never a picture of the printed page), the dataset pages the engine's setup found able to serve each role (`candidates`, at most 12 a role plus the chosen one), the grid read-only, and the profile versions (who, when, made from which version, what was chosen). **Use this as the <role> template** (`GET/POST …/pubs/:p/templates`, Idempotency-Key) makes a new `engine_profile` version `based_on` the one in use, copies its pinned dataset server side to the new profile's key, and enqueues `engine.setup` with the base config and the one choice (flat job arguments `base_profile_id`, `base_config_version_id`, `base_config_sha256`, `template_role`, `template_page`); the worker applies it through the Desk engine's own new `retemplate` command, which accepts only one of the role's candidates (`find_candidates`, the setup's unchanged test). The newest ready version is the one in use, so the next layout uses it; a failed one leaves the old one in use; runs keep the profile they pinned (`layout_run.profile_id`). `profile.ready` now carries `candidates` and `icc_sha256` (the worker's colour profile). Styles, swatches, the grid and house rules are not editable in this engine.
- **Newsroom** (`story.view`; a Reporter's board is their own stories): the stories of an edition (today's, else the next, else the newest; or every edition, or none: `StoryQuery.edition = "none"`) in columns by status with counts (spiked on request), section and "given to" filters, flags from the story's photo only (no photo, no caption, picture refused: `StoryListItem` gains `photo` and `can`), each card opening the story editor, and a Move menu of the story's own allowed transitions through the existing transitions route. Live: a story event reloads the board.
- **Archive** (`archive.view`): `GET …/archive?year&month&kind&q` (releases by edition date, at most 200; search over the headline, reporter and section of the stories on the released run's pages, as they are now) and `GET …/archive/releases/:id` (the release with its files, SHA-256, bytes, downloads of the archived versions for `export.press`, receipts, the edition's other releases, "Kept until" from the Object Lock retention, the archive check). Front-page thumbnail only when page 1 has one and the viewer has `pages.view`.
- **Print profiles** (`print_profiles.view`; save: `print_profiles.edit`): `app.print_profile`, numbered per publication, each save a new version (press name, contact, note); a release records the version in use (`release.print_profile_id`, shown on the release). Read-only facts: trim size from the profile's front template outline, PDF/X-1a and the checker's SHA-256 of the newest done run, the colour profile's SHA-256 recorded by the engine, ads 200 ppi (a real check), delivery "Download and send yourself" (the only method).
- **Brand & masthead** (`brand.edit` to change; `GET …/brand` with `publication.view`): the masthead as the newest laid-out front page prints it (its preview, cropped; the masthead is the front template's own furniture, the engine rewrites only date, page, volume, issue and price), the publication's display name, and the edition defaults (`app.edition_defaults`: volume, price, next issue) that pre-fill Create edition; an edition made with an issue at or past the next number moves it to that number + 1 in the same transaction (Latin or Devanagari digits, `issueNumber`).

### L2.7 The news finder (owner request 2026-11-04; the plan is 13-news-finder.md)

**The newsroom uses it for:** the sidebar's Sources screen collects trending news from the paper's own list of feeds every few hours and groups the same event across sources; an editor picks a topic, and Claude drafts a story in the paper's own words and house style (Marathi or English), with print-worthy photos only for big stories, each labelled Safe to print or Needs permission.

**Scope:** sources and house style per publication; collection and grouping on a schedule (engine queue); pick → a Draft story assigned to the picking editor, with its sources and "Made with Claude — check before use"; a deterministic copy check; photo candidates with code-decided licence labels; the rights tick for Needs permission pictures, enforced by the API; AI spend logged per call with a daily cap.

**Done when:**
1. Collection and grouping run on a schedule against recorded fictional feeds in tests, and real feeds in the demo.
2. A pick makes a Draft story with its sources that passes the copy check.
3. For a big story, 3–5 labelled photos are offered, and the chosen one lands in Media with its source, credit and label.
4. A Needs permission photo cannot be attached without the tick, which is recorded and audited.

**Release check:** D-26–D-29 decided; the first real collections and drafts watched (13-news-finder.md §8).

**Hosting** grows alongside the milestones:

| Milestone | Hosting added |
|---|---|
| L2.1 | App host, managed database, S3, email, backups, uptime check, first restore drill |
| L2.2 | Engine host, private colour profile, worker heartbeat alert |
| L2.3 | Dataset upload, sizing benchmark, restore drill including S3 objects |
| L2.4 | The gateway |
| L2.5 | Archive bucket with Object Lock, deadline-night runbook, on-call cover, the light penetration test (O-m) |

### L4 onboarding (owner's order 2026-11-05; built ahead of L4, released only after G3)

**As built:** migrations `2026_12_07_0001_onboarding.ts` and `2026_12_07_0002_paper_signup.ts`; minor findings are in
doc 11 (L4-001 onwards); our part per paper is `docs/runbooks/onboard-a-new-paper.md`.
- **Sign-up for a new paper** (`apps/api/src/modules/signup`, `packages/contracts/src/signup.ts`): `POST
  /api/v1/signup/paper` keeps an application (`identity.paper_application`: no organisation yet, so outside `app.` and
  readable by the API's server connection only) and emails a link (only its SHA-256 kept, 24 h, once); protected like
  the contact form (per-address and global limits, a trap field, a minimum fill time, the same answer whatever the
  address). Once confirmed it waits; an operator runs `review-paper -- list | approve <id> | refuse <id> [reason]`
  (`apps/api/scripts/review-paper.ts`): approve runs the existing bootstrap (organisation, Owner, first publication,
  audited) and is safe to run again after a crash; who decided and when is kept. `/onboarding` is a real screen.
- **The upload** (`apps/web/src/features/onboarding`, on Templates and Engine profile, `settings.edit`): 3–40 PDFs
  (upload purpose `onboard_pdf`, at most 200 MiB each), each with its progress, and the paper's permission ticked;
  `POST …/onboarding` copies them out of quarantine to `onboarding/<id>/pdfs/NN.pdf`, writes `inputs.json` (each PDF
  pinned by version and SHA-256) and enqueues `engine.onboard` with it pinned; one active per publication (a partial
  unique index), cancel (`app.cancel_engine_job`), a heartbeat and the sweep's stall (`worker.stalled`, 10 min).
- **The job** (`apps/engine-worker/pgn_worker/onboard.py`, queue engine-cpu, priority 5, one attempt, 2 h): downloads
  and checks every byte, runs `tools/onboard/onboard.py build` (the worker's own venv; head1 in the engine's) with a
  bare environment, streams `onboard.progress`, packs a deterministic ZIP to `onboarding/<id>/dataset.zip` (the
  worker's IAM may write only that there) and answers `onboard.ready` (each file's check, the report) or
  `onboard.rejected` (a code the web says in English and Marathi).
- **`tools/onboard`:** the Phase-0 chain copied out of the frozen tree (each change marked `# onboard:`: outputs into the
  bundle, the split date from the data — the oldest ⌈2n/3⌉ editions calibrate —, Latin papers, no hand-written
  manifest); the parity test proves the copy byte-identical to the frozen scripts on a fictional paper (CI) and on the
  pilot (90 of 90 files, locally). Intake checks per file (scanned, fonts missing or Type 3, no Unicode, untested
  program, page size mix, duplicate, no date) and automatic exclusion of unreadable frames (on the pilot 42 of the 43
  hand-made exclusions, 3.3 % of frames; above 15 % a person must look).
- **Per paper in the engine** (`tools/desk/engine/deskprofile.py`, `deskcommon.paper`): a dataset's own
  `house_profile.json` and `paper.json` replace the pilot's grid, spacing, script and thresholds at run time (gen1 and
  compose_page stay frozen, imported read-only); without them nothing changes — the pilot's config, cache keys and page
  PDFs are byte-identical.
- **Use this design** (`POST …/onboarding/:id/use`) copies the bundle to a new engine profile and runs the existing
  `engine.setup` unchanged; **Make a test layout** (`POST …/onboarding/test-edition`) makes an edition of 14 fictional
  stories (English or Marathi) for the existing layout button.

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

**As built (W3, W4):** `infra/docker/engine-worker.Dockerfile` builds the io env only for now (the engine env comes with L2.3): linux/amd64 only (the wheels the Python licence inventory covers), `python:3.11.14-slim-bookworm` pinned by its amd64 digest, the worker lock installed with `--require-hashes` and wheels only (the venv then holds only the lock: its own pip and setuptools are removed), the repository's code and its 22 OFL stand-in fonts at their paths, user `pgn` (10001), meant to run with `--read-only`, the homes on a volume, `/tmp` on a tmpfs and the colour profile mounted at `/run/pageinator/newsprint.icc` (checked against `PGN_ICC_SHA256`). Its health command (`pgn_worker.health`) needs a homes folder that is the worker's own (mode 0700, writable, not a link), `PGN_ICC_SHA256`, and that profile. CI builds it (never pushes), runs the worker's tests inside it, and checks its files (`infra/docker/check_image_files.py`: under `/opt/pageinator` only the repository's files, byte for byte against the commit; the 22 stand-in fonts only and no colour profile anywhere, by name or by content; nothing private). The S3 adapter (`pgn_worker/storage_s3.py`, boto3) takes the API's `PGN_S3_*` settings, reads only a named version (refused before reading when the store lists no length or more than 64 MB), sends each write's SHA-256 (`ChecksumSHA256`, which SeaweedFS and S3 check), refuses a store that gives no version on a write, deletes by version, passes every key through the job's key guard, and keeps every credential out of logs and errors. **A second layer for the pilot:** the worker's IAM policy allows `s3:GetObject` and `s3:GetObjectVersion` on `<work bucket>/orgs/*`, `s3:PutObject` only on an asset's renditions (`<work bucket>/orgs/*/pubs/*/assets/*/r/*`) and a Word import's result file (`…/imports/*/result-*`, L2.2) and no delete (never `uploads/`, never another bucket; security fix pass 2026-11-02), so a guard bug or a decoder exploit still cannot overwrite or delete a paper's originals, nor reach the quarantine or the archive (`deploy-files.test.ts` pins it).

**Reused unchanged from `tools/desk/deskserver`:**
- `images.convert_photo` / `convert_ad`;
- `jobs.render_page` / `check_pdfx` / `merge_pdfs` / `zip_pdfs`, and `press.press_state`;
- `editing.EditService` and `after_save` helpers;
- `engine_client.EngineClient`;
- `docx.articles_from_docx`.

`JobManager` and `store.py` stay Desk-only. **A layout needs a new launcher in the worker:** `EngineClient.run` is a one-shot call with a timeout (enough for `setup`, `plan` and `measure`), while a layout runs `generate` in its own process group that an abort or a stalled run can stop, as `JobManager` does for the Desk (correction, W1).

**Job contracts.**
- Every job's arguments include `org_id` and `pub_id`.
- Every S3 key a task touches must start with `orgs/<org_id>/pubs/<pub_id>/`. The key guard raises otherwise (test (e)).

| Task (queue) | Arguments | Lock / queueing lock | Runs | Writes (S3) | Reports (event kind) |
|---|---|---|---|---|---|
| `media.ingest` (media) | asset_id, version_id, sha256: ids only. The worker makes the original's key from the ids, `assets/<id>/original`, as the database makes `app.asset.original_key` (the original as `complete` stored it: the upload's quarantine copy is deleted by then, and `uploads/…` is outside the key guard; correction, W1; the key is no longer an argument, runner fix pass B2) | queueing lock `asset:<id>` | `images.convert_photo` (Pillow + littleCMS, newsprint profile, perceptual, black-point compensation; at most 2000 px long side) | `assets/<id>/original`, preview, thumb, CMYK raster | `media.ready` {sha256, bytes, mime, width_px, height_px (after the EXIF orientation, L2-123), raster {width_px, height_px} (what prints), params_hash, renditions[]} or `media.rejected` {code, message, status} (the Desk's words and code) |
| `docx.import` (media) | upload_key, import_id | — | `docx.articles_from_docx` | `imports/<id>/result.json` | `import.parsed` {result_key, counts} (no story text in the event) |
| `media.ad` (media, L2.3) | asset_id, slot {w_mm, h_mm} | — | `images.convert_ad` (fitted at 200 ppi) | ad raster, preview | `media.ready` |
| `engine.setup` (layout, L2.3) | profile_id, dataset_key | lock `engine-cpu` | `desk_engine.py setup` | `profiles/<id>/config.json` | `profile.ready` |
| `engine.measure` (measure) | edition_id, `editions/<id>/measure/latest.json` | lock `engine-cpu`; queueing lock `measure:<edition>`; starts 8 s after the last change | `desk_engine.py measure` | local cache only | `measure.status` |
| `engine.layout` (layout, priority 10) | edition_id, run_id, request_key, request_sha256, profile_id | lock `engine-cpu` | `generate`, then previews, the check on each page, merge, ZIP (`JobManager._complete`'s steps) | `runs/<run>/…` | `run.progress`, `run.page`, `run.finished` |
| `engine.check_pdf` (check) | key, version_id, sha256 | queueing lock `check:<org>:<sha256>` (with the organisation: two organisations' identical PDFs must not block each other's job; correction, W1) | `check_pdfx1a_independent.py` | the report beside the PDF | `check.done` {passed, fails, warnings, checker_sha256} |
| `engine.export_page` (layout, L2.5) | run_id, page, page_rev | lock `run:<run>` | a one-shot PageSession builds the PDF from the persisted revision (an exact-revision export and a consistency check) | `pages/NN/export-<rev>.pdf` | `export.done` |

**Scheduling and failures:**
- **One CPU lock.** `engine-cpu` copies the Desk's rule: one layout at a time, and never a measure during a layout.
- **Layout takes priority.** When a run starts, the API asks Procrastinate to abort a running measure. The task polls `should_abort` and signals the engine's process group, as `JobManager.cancel` does; finished measurements are kept in the cache.
- **Retries:**
  - media: 10 tries with Graphile Worker's backoff (exp(attempts) seconds, about 3.6 hours in all; the queue below);
  - check: 2 tries;
  - layout: never retried.
- **Stalled layout runs.** The API reconciler marks a run whose worker heartbeat has stopped as failed, with the Desk's `RESTARTED` message.

**The job runner (as built, W6 part 1; queue-agnostic).** `pgn_worker/jobs.py` runs one job, `{format: "pageinator.worker-job/1", id, kind, args}` (ids only; strict: exactly those keys and the kind's arguments), through `S3Storage` and the key guard, and answers one result, `{format: "pageinator.worker-result/1", job, kind, outcome: done | retry | failed, event | error {code, message}}`. A photo the Desk refuses is `done` with `media.rejected`, and so is one wider or taller than 100,000 px (the contract's limit; `m.img.tooManyPixels`). `retry` (nothing decided): `worker.profile` (the profile cannot be read, or the conversion's environment failed), `worker.store`, `worker.memory`; `failed` (running it again cannot help): `worker.job`, `worker.key`, `worker.checksum`, `worker.missing`, `worker.config` (the worker's own settings are missing or not valid, or its profile file is not the one `PGN_ICC_SHA256` names: an operator fixes the worker), `worker.internal` (the exception's type only). Messages are at most 2000 characters and never repeat the job's values, a credential, an endpoint or the profile's path. `python -m pgn_worker.run` is the same as a command (the job on stdin or `--job FILE`, the result as one UTF-8 JSON line on stdout, nothing on stderr: warnings and log records are silenced; exit 0 done, 65 failed, 70 fault, 74 stdout closed (no line), 75 retry, 78 the worker's settings), for a queue outside Python to spawn per job. The TypeScript contract (`packages/contracts/src/engine.ts`) reads a fixture of one result of each kind that the runner's tests write and check (`test_jobs.py` ContractTests).

**The queue (as built, W6 part 2; owner decision 2026-10-24: Graphile Worker 0.18.0 with `pg`, in Node, replacing Procrastinate wherever this plan names it).** `apps/engine-queue`:
- **Tasks.** `media.ingest` takes the ids-only payload (`MediaIngestPayload`: org, publication, asset, version, SHA-256), builds the runner's job (`WorkerJob`, the queue's job id as its id) and spawns `python -B -m pgn_worker.run` in a process group of its own, with the job on stdin and only the runner's own settings in its environment (`runJob` filters them itself: `PGN_S3_*`, `PGN_ICC_SHA256`, `PAGEINATOR_ICC`, `PGN_WORKER_HOMES`, never the database's). The whole group is killed at the time limit, on a cancel, and once the runner exits (nothing it started outlives it); the answer comes at the runner's exit, waiting at most 2 seconds for its output. A payload that is not ids-only but names an organisation, a publication and an asset is reported as `job.failed` `worker.job` for that asset, unrun; one that names no asset is dropped and logged.
- **Results.** The line is checked with the Zod `WorkerResult`, against its exit code and its job id, and a `done` event must name the payload's asset. `done` reports the event (`media.ready` or `media.rejected`); `failed` reports `job.failed` for the asset. No line, a line the contract refuses or that disagrees with the exit code, an unknown exit code (74, 2, 1), a death by a signal (the kernel's out-of-memory killer) and the time limit are retries: the task throws and Graphile Worker runs the job again with its backoff; on the job's last attempt a retry is reported as `job.failed`. Every report goes with the queue's job id and is tried 3 times (0.5 s and 2 s apart); a report that still fails fails the job, which is run again (the runner's writes are keyed by the asset, so a second run writes the same keys).
- **Not the photo's fault.** A cancel (`worker.cancelled`) and a misconfigured worker (`worker.config`) give the attempt back (the task raises the job's `max_attempts` by one while it holds the job's lock) and are never reported as a failure. A `worker.config` also stops the queue: it takes no more jobs and its runner's promise rejects, so the process exits non-zero for an operator. The queue does not start at all unless the worker's health command (`pgn_worker.health`: homes folder, `PGN_ICC_SHA256` and the profile) passes. Only as a last resort, once a job's `max_attempts` has reached 30 (20 attempts given back), are they spent like any attempt, and a `worker.config` on the last one is final.
- **Shutdown.** Stopping waits for running jobs to end by themselves (Graphile Worker's cancel comes only after the runner's time limit plus 5 s), and finishing or failing each job in the database is awaited before the pool closes (Graphile Worker 0.18 does not await an unbatched finish: the queue batches them with no delay, which its shutdown flushes). Tested: a hanging job and a stop leave the row unlocked and run again after its first backoff (e¹ s); on its last attempt it is reported and removed. **The deployment's stop grace period must exceed the runner's time limit** (Docker's default 10 s does not). **A process killed mid-job** (SIGKILL, a host reboot, the out-of-memory killer taking Node) leaves its job locked; Graphile Worker would reset that lock only after 4 hours. Since the runner is killed at its time limit, a lock older than the limit plus 5 minutes (`LOCK_MARGIN_MS`: the answer's 2 s and the report's retries, with room) belongs to a process that is gone: the queue releases such locks (`releaseStaleLocks`, as `pgn_engine`, which may update `_private_jobs` and `_private_job_queues`) when it starts and every minute, so the job runs again within minutes (8 in the pilot, at 180 s), its attempt spent; one out of attempts is then the API's sweep's (step 5 below). Tested on a database (`queue-db.test.ts`): a job locked 10 minutes ago by a dead worker is released and run; a fresh lock is left alone. Every queue process must run with the same time limit (a shorter one would release a longer one's live job).
- **Database.** Graphile Worker lives in schema `queue`. The migrator installs and upgrades it (Graphile Worker installs only when its tables are missing); `pgn_engine` gets `ENGINE_GRANTS`, table by table as Graphile Worker 0.18.0's source uses them: select on `migrations`; select, update, delete on `_private_jobs`; select, update on `_private_job_queues`; select, insert on `_private_tasks`; select on `_private_known_crontabs` (its cron reads it at start even with no cron item); no insert on jobs, no function, no DDL; a row-level-security policy per command for `pgn_engine` alone (Graphile Worker enables RLS with no policy; `pgn_engine` is NOBYPASSRLS). A Graphile Worker upgrade is read again and re-granted. TEMP and CONNECT for PUBLIC (and CONNECT to the `postgres` database) are revoked by the role setup (`infra/docker/postgres-init.sql`; the pilot's server needs the same). Nothing in `app.*` but the inbox's INSERT. Tested end to end on a database, roles and a store of the test's own (`apps/engine-queue/test/queue-db.test.ts`, with `PGN_QUEUE_DB_URL`; CI's `worker` job runs it): what the role may and may not do, that without its policy it sees no job, the real runner, shutdown, a misconfigured worker, the enqueue wrapper and the sweep's query.
- **Image.** The worker image carries Node 24.22.0 (the binary from the official image, pinned by digest) and the queue's production packages from `pnpm-lock.yaml` (`pnpm deploy`, hoisted, in `/opt/pageinator/node_modules`; pnpm itself fetched by corepack and checked against the SHA-512 in `package.json`), without the TypeScript compiler that cosmiconfig names as an optional peer, with its code and `packages/contracts` at the repository's paths. The file check covers the queue's code byte for byte and refuses any other `node_modules`; the packages under `/opt/pageinator/node_modules` are the lockfile's, which the npm licence check reads in the workspace (it does not read the image itself).

**The API part (as built, W6 API part; corrections to the numbered plan below it):**
- **Installing Graphile Worker.** Its `migrate()` runs each migration in a transaction of its own (BEGIN/COMMIT on its client), so it cannot run inside the migrator's. `installQueueSchema` (`apps/engine-queue/src/schema.ts`) applies the same SQL files its package ships (`sql/NNNNNN.sql`, identical to its bundled texts), recorded in `queue.migrations` as `migrate()` records them, inside migration `2026_11_27_0001_engine_queue`; a test installs both ways and compares the catalog (`queue-db.test.ts`). A worker that starts later finds every migration recorded.
- **The sweep runs as `pgn_app`, not as the queue's owner** (the API holds no owner credentials), under its own system reader's flag `engine-sweep` (`withSystem`; plain `pgn_app`, with or without an organisation, sees no job): with it `pgn_app` may select `queue._private_jobs` and `_private_tasks` and delete only a job out of attempts that is unlocked or locked over an hour ago (policies), which `exhaustedJobs` and the sweep need. At start-up and every few minutes (5), for each spent `media.ingest` job it writes `job.failed` `worker.lost` to the inbox under the job's organisation, then removes the job (a sweep stopped in between finds the job again; its write is then a no-op); and for each asset still `received` 30 minutes after its last change with no job (read under the flag) and no waiting event, the same with job id `lost:<asset>`. A job waiting out its backoff is a job: its asset is not swept (tested). Stale lock: 2 hours (the runner's limit is at most an hour). Both thresholds can be set for an operator's check (`PGN_ENGINE_STALE_S`, at least 3600, the policy's hour; `PGN_ENGINE_DEADLINE_S`, at least 60). It counts and logs only the failures it wrote.
- **The inbox.** `app.engine_event` (org wall; `asset_id` beside the payload, so the sweep can ask whether an event waits). `pgn_engine` may only insert unprocessed, untried rows (a permissive policy, and a restrictive one, so that setting `app.org_id` and passing the organisation wall still cannot plant a processed row to drop a real report) and execute `app.current_org()` (the organisation wall's check runs with the inserter's rights); its report uses `ON CONFLICT DO NOTHING` without a target (a target needs SELECT). `pgn_app` may insert only a waiting `job.failed` (the sweep's; a restrictive policy). The consumer finds waiting rows that are due under the system-reader flag `engine-consumer` (`withSystem`, the only place `app.system` is set), then applies each under `withTenant` of its organisation and the publication its payload names, the row locked (`skip locked`) and marked processed in the same transaction. Outcomes: applied; ignored (the asset is settled already, or deleted; or the event is for other bytes, late or forged, which is also audited `engine.event_ignore`); refused (not the contract's, which refuses whatever the database would, such as a code over 120 characters or a count over 2³¹−1; the asset is not that organisation's and publication's; or a rendition key outside the asset's own `…/assets/<id>/r/` folder: audited `engine.event_refuse`, logged at error). **An event that fails to apply** (an error: the database, not the event) is never refused for it: it stays waiting, with its tries and next time kept in its row (`tries`, `retry_at`: 5 s doubling to 10 minutes, the same for every API instance and after a restart), and only after 20 tries (about 2.2 hours) is it refused, audited with the reason `error`. Tested with rendition inserts failing three times: the event is applied, the photo ready.
- **The trust model.** `pgn_engine` is one principal for every organisation: it can report on any asset it can name, and it can name any asset of any job payload it reads (it reads every job). So it can settle any waiting asset of any organisation (ready with its own renditions under that asset's folder, rejected or failed). Isolation between organisations rests on the consumer: each event is applied under the organisation and publication it names, only to an asset they have, only for its exact bytes, and only with renditions in that asset's own folder; and on S3, where the engine's key may write only renditions (`…/assets/*/r/*`) and delete nothing. A per-organisation engine principal is L2-330 (doc 11).
- **Asset states.** `received` is "being prepared"; `failed` is new (with `problem`, the engine's code), and `rejected` keeps the Desk's code in `problem`. A failed asset, like a rejected one, no longer holds its bytes: it is neither attached nor downloaded (404), and the story editor offers neither Show nor Download for it. A status change sends each story it is the photo of a live `story` hint, and the story editor takes the photo's new state without a new version.
- **Organisation ids are Better Auth's (version 4 UUIDs).** The contract (`OrgId`) and the worker's key guard took version 7 only, which every real job would have failed; publication and asset ids stay version 7 only.

The plan as written before the build:
1. A migration (as the migrator) installs Graphile Worker 0.18.0 in `queue` (its own `migrate()`), applies `ENGINE_GRANTS` and `APP_ENQUEUE` (`apps/engine-queue`): `app.enqueue_media_ingest(org, pub, asset, version, sha256)`, owned by the migrator, SECURITY DEFINER with its search_path pinned, executable by `pgn_app` alone, which calls `queue.add_job` with `max_attempts` 10 and `job_key` `asset:<id>`; and `revoke execute on all functions in schema queue from public` (`add_job` is not SECURITY DEFINER, so EXECUTE on it alone could not enqueue, and a new function is PUBLIC's). The migration adds to the wrapper a check that the organisation is `app.current_org()`. It replaces this plan's Procrastinate schema and `defer` function (§5 notes below). The tenancy catalog test learns the new grants.
2. `src/jobs/defer.ts` becomes `select app.enqueue_media_ingest(…)` inside the caller's transaction (`complete`), the payload checked with `MediaIngestPayload` first.
3. The inbox: `app.engine_event` (org-scoped, INSERT only for `pgn_engine`) **with a unique key on the queue's job id** (a job reports one event; a repeat, from a job run again after its report when finishing it was lost, is dropped), and the queue's `report(event, jobId)`, which inserts the event and sends `pg_notify('engine_events', id)` on `pgn_engine`'s pool; the queue's process (`main.ts`: settings, `startQueue`, signals) arrives with it.
4. The API's consumer: LISTEN plus a 5-second poll, Zod `EngineEvent`, applied under `withTenant(event.org_id)` with the target checked, as below.
5. **Required: the sweep**, so every asset settles even when the queue cannot: the process dies on a job's last attempt, or the inbox refuses every report on it. Every few minutes, as the queue's owner, the API reads `exhaustedJobs(client, staleMs)` (`apps/engine-queue`: jobs out of attempts, unlocked or locked longer than `staleMs`, which must exceed the runner's time limit and the report's retries), writes `job.failed` (`worker.lost`) for each job's asset through the inbox (dropped when the job had reported), and removes the job; and marks failed any asset still `processing` past a deadline with no job left.

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

**As built (W1, `apps/engine-worker/pgn_worker/home.py`):** the job carries `edition_id` (the edition's `desk_key`) and the request must be for that edition. Each photo and ad names its raster as `{key, version_id, sha256, width_px, height_px}`, the CMYK rendition's facts from `media.ready`; the key must be a CMYK rendition of the job's organisation and publication (`assets/<uuid7>/r/cmyk-<32 hex>.cmyk.gz`, never an upload or an original), its size the photo's, and the raster must unpack to exactly width × height × 4 bytes. A home folder that is a symbolic link is refused, and every attempt starts from an empty run folder.

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

The remaining placeholder routes in `apps/web` (organisation settings, billing, storage, the publication team page, the old edition workspace tabs) stay dev-only. The deployed app shows only screens that work. **As built (2026-11-05):** the five publication sidebar placeholders (Templates, Newsroom, Archive, Brand & masthead, Print profiles) are now real screens and are listed in the deployed app per permission (see "As built (sidebar screens)" under §1).

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
  using (publication_id = any ((select app.current_pubs())::uuid[]))                -- the cast makes it an array:
  with check (publication_id = any ((select app.current_pubs())::uuid[]));          -- without it, a subquery fails
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
| `edition` | id; org/pub; edition_date (2000–2999); desk_key; pages CHECK (4, 8, 16); back_page_ads; volume; issue; price; status (built with doc 04's planning, in_production, preflight, released, archived: open question); produced_in; UNIQUE (org_id, publication_id, edition_date) (zones later) | org+pub | L2.1 |
| `story` | id; org/pub; edition_id NULL; desk_key UNIQUE per publication; status; current_rev; reporter_id; assignee_id; due_at; section_id; priority 1–4; page_pin; language; origin; desk_note; deleted_at. search_text (pg_trgm) is not built yet: pg_trgm's functions would fail check (a) (owned by the bootstrap superuser, no search_path, executable by PUBLIC), which first needs an allowance for extensions | org+pub | L2.1 |
| `story_revision` | (org_id, publication_id, story_id, rev) PK; org/pub; headline; kicker; deck; byline; body; body_format 'desk-text/1'; words; author_id; opened_at; closed_at. Triggers: a closed revision refuses UPDATE, DELETE and TRUNCATE; a new revision is open and numbered max(rev) + 1; its keys never change | org+pub | L2.1 |
| `story_status_change` | id; org/pub; story_id; from_status; to_status; changed_by (null: the system); changed_at; comment_id (`from` and `to` are reserved words) | org+pub | L2.1 |
| `story_photo` | (org_id, publication_id, story_id) PK (one photo until the engine takes more); org/pub; asset_id (no foreign key until `asset` arrives, PR 18); caption; credit | org+pub | L2.1 |
| `comment` | id; org/pub; target_type ('story'; 'page' from L2.4); target_id; parent_id; author_id; body; mentions uuid[]; resolved_at/by; deleted_at | org+pub | L2.1 |
| `upload` | id; org/pub; user_id; purpose; key; declared_type; declared_bytes; status; expires_at | org+pub | L2.1 |
| `asset` | id; org/pub; kind; desk_key; sha256; bytes; mime (sniffed); original_key; width_px; height_px; status; photographer; caption; credit; UNIQUE (org_id, sha256) where not deleted (dedupe within one organisation only) | org+pub | L2.1 |
| `notification` | id; org_id; user_id; kind; target_type; target_id; data jsonb (ids only); read_at; emailed_at | org+user | L2.1 |
| `audit_event` | id; org_id; publication_id NULL; actor_kind; actor_id; action; target_type; target_id; data jsonb (no story text); ip; user_agent; request_id; at | org | L2.1 |
| `idempotency_key` | (org_id, user_id, key) PK; route; request_sha256; status (running, done); response_status; response jsonb; expires_at (24 h) | org + user (restrictive: a user's own keys only) | L2.1 |
| `desk_bundle` | id; org/pub; edition_id; key (exactly `orgs/<org>/pubs/<pub>/desk-bundles/<uuid>.zip`, UNIQUE (org_id, key)); sha256; created_by; created_at | org+pub | L2.1 |
| `desk_bundle_revision` | (org_id, publication_id, bundle_id, story_id) PK; rev; keys to `desk_bundle` and to `story_revision`, so a bundle names only its own publication's revisions | org+pub | L2.1 |
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
| `page_approval` | id; org/pub; run_id; page_no; rev; pdf_sha256; approved_by/at; unlocked_by/at (only these are updated) | org+pub | L2.5 |
| `release` | id; org/pub; edition_id; run_id; number (per edition); kind (release, correction); approved_by/at; note; manifest {key, version_id, sha256}; retain_until; verified_at | org+pub | L2.5 |
| `release_file` | release_id; page_no; name; rev; sha256; bytes; archive key and version_id; replaces | org+pub | L2.5 |
| `delivery` | id; org/pub; release_id; method 'download'; sent_by/at; note; files (the receipt: names, SHA-256, bytes); press_person; confirmed_at; confirm_note; confirmed_by (confirmed once) | org+pub | L2.5 |
| `press_test` | (org_id, publication_id) PK; page_sha256; accepted_on; note; recorded_by/at (the G2 evidence) | org+pub | L2.5 |
| `advertiser` | id; org/pub; name (unique among those not archived, any case); contact_name; phone; email; note; archived_at | org+pub | L2.6 |
| `ad_booking` | id; org/pub; advertiser_id; campaign; w_mm, h_mm (a slot size of the profile in use); colour (colour, mono: recorded, not checked); slot (NULL: any back-page slot of its size); dates date[] (1–366); status (booked, cancelled); artwork_asset_id, artwork_set_by/at (no `ad_artwork` table: the picture is the media library's asset, and its checks are computed when read by `checkArtwork`) | org+pub | L2.6 |
| `ad_placement` | id; org/pub; edition_id; slot; booking_id; placed_by (NULL: by its rule); UNIQUE per (edition, slot) and per (edition, booking). A placed booking whose artwork passed sets the slot's `ad_slot_artwork` | org+pub | L2.6 |
| `flatplan_page` | (edition_id, page_no) PK; org/pub; section_id NULL; note | org+pub | L2.6 |
| `ad_settings`, `ad_cutoff_alert` | (org_id, publication_id) PK; cutoff_time (HH:MM text); days_before — and (org, pub, edition_date) PK; fired_at; bookings; told (one alert per publication and date) | org+pub | L2.6 |

**Keys and ids (as built in PR 16).**
- Every unique key of a content table includes `org_id` and `publication_id`. A unique key is checked before the walls' foreign keys, so a key without them would tell a writer whether a row it cannot see exists.
- Ids are made by the database (`uuidv7()`): the API never accepts an id from a client. A trigger (`app.server_id`) replaces any id `pgn_app` sends, so the global `id` primary keys cannot be used to probe for another tenant's rows.
- Text limits are the Desk's (lines 2,000 characters, bodies 200,000), counted in characters. `@pageinator/desk-text`'s `cleanText` refuses a number, which the Desk would write as text with Python's `str()`: JavaScript cannot tell `1.0` from `1`.

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
  - every refused action (`permission.denied`; as built, `access.denied`, with the route's publication when it has one).
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
- **Better Auth's schema:** printed by `scripts/identity-schema.ts` (`pnpm --filter @pageinator/api db:identity-schema`), which calls the installed Better Auth's own `getMigrations` with our real `authOptions`, on a database whose `identity` schema is empty. The output is kept as printed in `src/db/identity/better-auth-1.7.8.sql`, never edited, and migration 0003 runs it. Each upgrade prints its change into a new file and a new migration; a database test fails while Better Auth expects a table or column no migration made. (The plan named the `auth` CLI; the script needs no extra package and reads the configuration the API really runs, so the two cannot drift.)
- **Types:** a small generator (`src/db/codegen.ts`) writes `src/db/schema.gen.ts` from the migrated catalog. CI migrates a fresh database, runs the codegen, and fails on any diff. (kysely-codegen 0.20.0 was the plan; one of its dependencies, argparse 2.0.1, has the Python-2.0 licence, outside the licence check's allowlist. Switching to it needs that licence reviewed.)
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

### 4.1 Better Auth configuration (version 1.7.8, pinned exactly)

**As built in PRs 7–8** (`apps/api/src/modules/identity/auth.ts`); the organization and twoFactor plugins arrive in PRs 9 and 11. **Why 1.7.8, not 1.7.12:** the workspace refuses any package younger than 7 days (`minimumReleaseAge`, docs/DEVELOPMENT.md "Supply chain"). 1.7.12 was released on 2026-10-20, so 1.7.8 was the newest release at least 7 days old when it was installed (2026-10-21). Two of its known issues are handled here: #11521 (int8 counts read as strings) by an int8 parser on the auth pool, and #11626 (a reset that half fails) by `transaction: true`. An upgrade is a new PR with the auth and invitation suites.

```ts
betterAuth({
  appName: "Pageinator", baseURL: PUBLIC_ORIGIN, basePath: "/api/auth", secret: AUTH_SECRET,
  database: { dialect: new PostgresDialect({ pool: authPool }), type: "postgres", schemaName: "identity",
              transaction: true },                     // a reset writes the password and ends sessions together
  advanced: { database: { generateId: "uuid" }, useSecureCookies: true, cookiePrefix: "pgn",
              defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" },
              ipAddress: { ipAddressHeaders: ["x-pgn-client-ip"] } },  // set from request.ip, never the client's
  trustedOrigins: ALLOWED_ORIGINS,
  telemetry: { enabled: false },                       // and the API refuses to start with BETTER_AUTH_TELEMETRY*,
                                                       // BETTER_AUTH_SECRETS or BETTER_AUTH_TRUSTED_ORIGINS set
  disabledPaths: [/* social, linked accounts, email change, deletion, update-user, verify-password, … */],
  emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 12,
                      maxPasswordLength: 128, revokeSessionsOnPasswordReset: true, autoSignIn: false,
                      sendResetPassword, onPasswordReset: recordReset,
                      password: { hash: argon2idHash, verify: argon2idVerify } },
  emailVerification: { sendVerificationEmail, sendOnSignUp: true, autoSignInAfterVerification: true,
                       afterEmailVerification: recordVerified },
  verification: { storeIdentifier: "hashed" },         // a database read reveals no usable reset token
  user: { validateUserInfo: inviteOnlySignUp },        // every new account passes here, whatever the way in
  session: { expiresIn: 12 * 3600, updateAge: 3600, cookieCache: { enabled: false } },
                                                       // sliding 12 h idle; 30-day absolute cap in session.ts
  rateLimit: { enabled: true, storage: "database", customStorage: tokenFreeStorage, customRules: { /* §4.6 */ } },
  hooks: { before: reserveSignInAttempt, after: countWrongPasswordAndRecord },
  databaseHooks: { session: { create: { before: capAt12Hours, after: recordSignInAndEmailNewDevice },
                              delete: { after: recordSignOutOrRevocation } } },
  plugins: [                                           // PRs 9 and 11
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
- **Passwords.** argon2id, because doc 11 §1 asks for it; Better Auth's default is scrypt. It runs on Node's own `crypto.argon2` (Node 24, under the crypto module's "Stability: 2 - Stable"), not @node-rs/argon2: no native package to vet or licence-check. The parameters are OWASP's argon2id minimum, m = 19 MiB, t = 2, p = 1, stored as PHC strings; a test checks RFC 9106's vector and that no warning is printed.
- **Invite-only sign-up is `user.validateUserInfo`,** not a `hooks.before` on `/sign-up/email`. Better Auth calls it for every account it creates, whatever the endpoint, and a refused sign-up gets the same answer as any other. Over HTTP it refuses every sign-up until PR 10 opens it to invitations; a call from the server (bootstrap, tests) may create an account.
- **Email.** nodemailer 10.1.7 (MIT-0; 10.1.1 until 2026-11-02, upgraded once the three addressparser fixes of 10.1.4 were 7 days old). A strict check refuses any recipient that is not one plain address.
- **Invitation ids are random UUIDv4.** Better Auth's `generateId: "uuid"` makes them, and the id is the secret in the invitation link. Our own tables use UUIDv7.
- **Not enabled:** magic link, email OTP, social sign-in, Generic OAuth, OAuth proxy, SSO, SCIM, admin, Stripe.
  - Most 2026 advisories need one of these. Examples: GHSA-965c-763c-88jm (critical; magic link plus OAuth, fixed in 1.7.7); GHSA-qq9h-g4jm-xgf3 (magic link or email OTP plus open sign-up).
  - The spec's "Continue with Google/Microsoft" buttons stay hidden.
- **Advisory watch:** GitHub security advisories, plus `pnpm audit --prod` in CI. A high or critical advisory that touches an enabled feature is upgraded within 48 h, after running the auth and invitation suites.
- **Fallback:** an `IdentityPort` (`getSession`, `membership`) isolates Better Auth, so Keycloak (Apache-2.0) can replace it if needed.
- **Checked in PRs 7–8:**
  - the option names, against the installed 1.7.8 source and its types;
  - server-side `auth.api.*` calls run the hooks, but not `disabledPaths` (that list is checked only by the HTTP router), and carry no request, so the hooks record events for HTTP calls only;
  - the cookie is `__Secure-pgn.session_token` (HttpOnly, Secure, SameSite=Lax);
  - Better Auth's own Origin check covers only requests with cookies; ours covers every change (ADR-025, 11-fix-before-launch).

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
- **As built (PR 9):**
  - the map is `packages/contracts/src/permissions.ts`, one permission per §12 row (some rows give a view and an edit permission), each naming its row;
  - a ◐ cell ("own stories", "photos only", …) is recorded as **"scoped"**: `authorize()` lets the person use the endpoint, and the service applies the cell's rule to what they reach (PR 17). Permission names alone cannot say "own stories";
  - an organisation-wide permission (Team, audit) is held through the union of a person's roles on all the organisation's publications;
  - every `/api/v1` route declares `config.permission`, or `config.access` `"public"` or `"signed_in"`; the app refuses to start with a route that declares neither, or both (`src/modules/access/access.ts`);
  - `/me` answers each membership's roles and grants per publication; the web derives `can` from them with the same map.

### 4.3 Invitations

1. An Owner or Admin invites: email, organisation role, publications, roles, grants.
   - Better Auth `createInvitation` runs server-side, and our `invitation_grant` rows are written in the same handler. If writing them fails, the invitation is cancelled, so none is ever accepted without its grants.
   - `beforeCreateInvitation` refuses any role but admin and member. Only Owner and Admin hold `members.manage`, and both reach every publication, so no one can grant beyond their own rights; an Owner is made by bootstrap only.
   - **All of Better Auth's own `/organization/*` HTTP routes are off** (its `disabledPaths`, and our forwarder refuses the whole prefix). Left open, any member could invite, change roles or remove people around our permissions and audit log. Our endpoints call Better Auth from the server with the person's headers.
2. The email says "<Inviter> invited you to <Organisation> as <roles>" and links to `/invite/<id>`. **We send it** from our handler, after the grants are written, so it can name every role (Better Auth's `sendInvitationEmail` is not set).
3. `GET /api/v1/invitations/:id` (public, rate-limited) shows only: organisation name, inviter name, roles, expiry, state.
4. **Create account** calls Better Auth `sign-up/email`, with the invitation id in the header `X-Pageinator-Invitation` (`INVITATION_HEADER` in `@pageinator/contracts`). **Both** the id and the email must match: a pending, unexpired invitation with that id for exactly that email (`user.validateUserInfo`, §4.1). The email alone would let anyone who knows an invitee's address take the account first; the id alone would let whoever saw the link sign up with another address. A refusal gets the same answer as any sign-up. Then the verification email goes out (two emails in all; trusting the invitation link as verification is a possible later improvement, after review).
5. After verification: `POST /api/v1/invitations/:id/accept`.
   - Better Auth `acceptInvitation` checks: same email, verified email, pending status, expiry, and an atomic claim.
   - Our accept handler then upserts the grants idempotently from **our** table (never from the client), creates the `person` row, and audits (`src/modules/people/grants.ts`; it runs right after Better Auth's accept returns, rather than in `afterAcceptInvitation`). **If that write fails, the accept is undone** in one statement (the membership deleted, the invitation pending again), so a member never exists without their directory row, and the invitee can try again. Sign-up refuses a name the directory cannot keep (empty, or over 200 characters). Notifying the inviter comes with notifications (PR 19).
   - **A reconciliation on `/me`** repairs what an accept left half done when the process died in the middle: grants not applied, and an invitation marked accepted with no membership at all. Better Auth claims the invitation before it makes the membership, and undoes the claim if that fails; if the undo fails too, the invitation stays accepted with no membership. The repair makes the membership again only for an invitation still marked accepted, and only when the person has no row at all in the organisation's directory. A unique index allows one membership per person and organisation.
   - **Removing a member** first deletes the membership and marks every invitation they accepted there canceled, in one statement, so from then on they reach nothing and no repair can bring them back. Then their grants go and their directory row says removed (a tombstone, made if the row was never written).
6. **The first Owner:** `scripts/bootstrap-org.ts` (`pnpm --filter @pageinator/api bootstrap-org …`) runs on the server. It signs up the owner from the server with a random password nobody sees, and emails one welcome with a link to choose a password (72 hours; audit fix 2026-11-05, before which a reset link went beside Better Auth's verification link): choosing the password through the emailed link confirms the address too, so the owner can then sign in. Then it creates the organisation through Better Auth as a system action (`createOrganization` with `userId` and no session, which `allowUserToCreateOrganization: false` allows), and its settings, the owner's directory row and the first publication under the new organisation's wall, audited. **No one-time secret** (changed 2026-10-22): running the script needs a shell on the server and the database settings, which already give every power it uses, so a secret would guard nothing.

### 4.4 Two-step sign-in

- TOTP (twoFactor plugin), backup codes, "Trust this device for 30 days", lockout after 5 wrong codes.
- `org_settings.mfa_required_roles` defaults to Owner and Admin; Prepress or Chief Editor are added at the owner's choice.
- A member in such a role without two-step gets 403 `two_step_required` everywhere except `/me`, `/api/auth/*` and the setup screen.
- **As built (PR 11):** `twoFactor({ issuer: "Pageinator", trustDeviceMaxAge: 30 days, accountLockout: 5 wrong codes, 15 minutes })`; codes by email are off (`/two-factor/send-otp` and `/verify-otp` disabled). The rule is checked by `authorize()` on every organisation route, against the organisation role and every publication role, and it asks **the session**, not the person: `session.twoStepAt` is set only on a session made by a code or a backup code, by a trusted device's sign-in, by the code that turns two-step on, or by a password change in a session that had it. A session made with the password only never counts. Turning two-step on ends every other session of the person. A TOTP code is accepted once in its 90-second window (`identity.totp_used`; RFC 6238 §5.2). A sign-in that still needs its code is not recorded as a sign-in; the finished one is.
- **TOTP secrets and backup codes are encrypted with the sign-in secret** (`PGN_AUTH_SECRET`). Better Auth 1.7.8 supports rotating it: its `secrets` option takes versioned secrets, encrypts with the newest and decrypts older envelopes, and falls back to `secret` for values encrypted before versions. We do not wire it yet (the API refuses `BETTER_AUTH_SECRETS`, §4.1), so **changing `PGN_AUTH_SECRET` today makes every TOTP secret and backup code unreadable: everyone re-enrols two-step**, and every session and trusted device ends. Runbook and fix: 11-fix-before-launch.

### 4.5 Sessions and CSRF

**Sessions:**
- Stored in the database, in an HttpOnly, Secure, SameSite=Lax cookie.
- 12 h sliding idle limit; a 30-day absolute limit checked from `session.createdAt`.
- "Keep me signed in" unticked gives a browser-session cookie.
- Changing or resetting the password revokes all other sessions.
- The device list and revoke come from Better Auth's endpoints.
- On 401 the web shows "Session expired" and keeps any unsaved story text in local storage.

**CSRF:**
- The app and the API share one origin, so the API grants no CORS. Only the file store allows the app's origin: the work bucket's CORS rule lets exactly `https://app.<domain>` POST a presigned upload and GET an original, with no other method or header (`infra/aws/s3-cors.json`, PR 25).
- Every POST, PUT, PATCH and DELETE on `/api/v1` must carry `Origin` equal to the app's origin and the header `X-Pageinator: 1`; `Sec-Fetch-Site: cross-site` is refused. This is the Desk's `X-Desk` pattern.
- Bodies are JSON only; uploads go straight to S3.
- This replaces doc 11's double-submit token with equal protection for a same-origin app (to be recorded in ADR-025).

### 4.6 Rate limits

| What | Limit | Where |
|---|---|---|
| Sign-in | 100 per 5 minutes per IP and path (a newsroom of ~50 behind one NAT, audit fix 2026-11-05), plus a per-email failure counter in the `before` hook (5 failures → 15 minutes) | Better Auth (database store) |
| TOTP | Lockout after 5 wrong codes | twoFactor |
| Sign-up / password-reset request | 100 / 3 per hour per IP (sign-up also needs an invitation for exactly its email; 100 lets a newsroom of ~50 behind one NAT sign up on day one, audit fix 2026-11-05); the answer is always generic | Better Auth |
| Confirmation link sent again | 100 per hour per IP | Better Auth |
| Session check (`/api/auth/get-session`) | Never counted by Better Auth; with a signed session cookie, only the per-address ceiling below | Better Auth, src/http/rate-limit.ts |
| Invitation lookup | 300 per hour per IP (a newsroom of ~50 behind one NAT) | @fastify/rate-limit |
| API, signed in | 1,200 per minute per user (a page load asks about 6 things; 100 reloads in a minute fit) | @fastify/rate-limit (memory store; one instance in the pilot) |
| API, signed out | 300 per minute per IP | @fastify/rate-limit |
| Upload presign | 60 per hour per user; 2 GB per day per organisation | database count |
| Engine jobs | One run per edition (partial unique index); measures merged (queueing lock) | Postgres / Procrastinate |

**As built (PR 19), the API's own limits** (`src/http/rate-limit.ts`; settings `PGN_RATE_LIMIT_*`):
- **Signed out:** 300 a minute per client address (60 until the audit fix of 2026-11-05), for every request without a session cookie, before anything else can refuse it.
- **Signed in:** an `/api/v1` request with a session cookie the API signed (its HMAC checked as Better Auth checks it) counts against its person, 1,200 a minute (300 until the audit fix of 2026-11-05), once the session is read. Two people behind one newsroom address do not share a budget (autosave every 1.5 s is 40 a minute). A made-up cookie is a signed-out request, so it never lifts the signed-out limit. A signed cookie that turns out to be no session counts against the address after all.
- **Ceiling:** before the session is read, requests with a signed session cookie count against a per-address ceiling of 6,000 a minute. Only these count there: a request refused before the session is read (a bad origin, bad JSON), which needs a cookie the API once signed.
- The origin guard writes one log line a minute about the requests it refuses, with their count, so a flood of them cannot flood the log.
- Every `/api/v1` and `/api/auth` answer says `Cache-Control: no-store`, so story text never stays in a shared PC's browser cache. This covers answers written without the hooks (Fastify's 503 while closing, its refusals of malformed URLs, Node's raw 400 and 431), every error answer, and the paths spelled without their slash or with doubled slashes.

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

**Error envelope:** `{"error": {"code", "message", "details"?, "requestId"}}`. The web shows the catalogue text for `code` in English or Marathi, falling back to `message`. As built (2026-11-05, A14): a detail `{field, message}` may also carry `reason` (a stable dotted code) and `params` (its values); the web words it from the catalogue's `detail.<reason>` and shows the English `message` only for a reason it does not know (`DetailWords`). Today: the Word import's own refusals (`docx.over_size`, `docx.size_mismatch`, `docx.protected`) and the story bundle's (`bundle.subheading_hash`, `bundle.photo_unusable`); a web test keeps the catalogue's `detail.*` keys equal to the API's reasons.

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
| GET / POST `/orgs/{o}/pubs/{p}/sections`, PATCH `…/sections/{id}` | publication.view / settings.edit | SectionList; POST {name}; PATCH {name?, position?, archived?}: a section is archived, never deleted (`packages/contracts/src/sections.ts`) |
| GET `/orgs/{o}/pubs/{p}/editions?from&to` | edition.view | → {items: [{id, date, pages, status, counts {stories, ready}}]} |
| POST `/orgs/{o}/pubs/{p}/editions` | edition.create | {date, pages: 4\|8\|16, backPageAds, volume?, issue?, price?} → 201 Edition; 409 `edition_exists` |
| GET / PATCH `/orgs/{o}/pubs/{p}/editions/{e}` | view / edition.edit | Edition (as built: PATCH corrects the folio, and before release the date, pages and back-page ads; see "As built" below) |
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
| GET `/orgs/{o}/audit?actor&action&target&from&to` | audit.view | → {items: [{at, actor {id, name}, action, target, publicationId, ip, userAgent, data}]} (as built: see below) |
| POST `/orgs/{o}/pubs/{p}/editions/{e}/desk-bundle` | desk.export | {statuses: ["ready"]} → 201 {bundleId, url (5 minutes), stories, sha256} |

**As built (PR 19), comments, notifications and live updates:**
- **Comments:** `GET`/`POST …/stories/{s}/comments` and `PATCH /orgs/{o}/pubs/{p}/comments/{c}` as above, without mentions (L2.2). Whoever sees the story reads its comments (`comment.read`; a Reporter: their own stories). Whoever may comment writes one or a reply, one level deep (`comment.write`; never a Viewer). A create needs an `Idempotency-Key`. Its author edits its text. The author, the desk, or the story's reporter or assignee resolves or reopens a thread. Edits, resolves and reopens are audited (ids only), and so are refusals.
- **Notifications** (`app.notification`, ids only, a person reads and marks only their own) use 06 §11's defaults:
  - a filed story tells the publication's Editors and Sub-editors;
  - a send-back tells its reporter, in app and by email;
  - giving a story to someone tells that person;
  - a comment tells the story's reporter and assignee and the thread's writers;
  - an accepted invitation tells its sender, in app and by email.
  - Nobody is told of their own act, and only people who would see the story are told. The emails are in the reader's language first, then the other. Each notice is written in the transaction of the change it tells of: a story's move, assignment or comment in its request's transaction, and an accepted invitation in the transaction that writes the person's directory row and grants. A notice that fails therefore undoes the accept, and the invitee can try again. The emails are sent once that transaction commits.
- **Routes:** the notification and event routes are under the organisation, so they get the organisation routes' access check (404 for a non-member, two-step where required). The permission is `publication.view`. The routes are `GET /orgs/{o}/notifications?unread&cursor&limit` → {items, unread, nextCursor} and `POST /orgs/{o}/notifications/read` {ids} | {all: true} → 204. A notification of a publication the person no longer reaches is not shown.
- **Live updates:** `GET /orgs/{o}/events` streams `story`, `comment` (the plan's `story`, split so the web can refresh only the comments), `notification` and `resync`. All carry ids only.
  - Postgres sends a hint after each change commits (triggers, channel `app_events`), and the API's one LISTEN connection hands it on. Each stream decides from its own person's access whether to pass the hint on; anything not exactly a hint of ours is dropped. For a Reporter, who sees only their own stories, the hint's list of people only narrows who is asked: the story is then read under the Reporter's own tenant to confirm it is theirs now, so a forged hint naming them carries nothing to them.
  - A stream re-checks its person's session (two-step status included, as it is now) and membership every 25 s, and ends when either is gone.
  - Limits: at most 5 streams a person. A stream whose browser reads nothing is ended once 256 KiB wait unsent, and its connection is closed, which frees its buffers and its slot. A stream whose browser left while its access was being checked is never counted.
  - A lost LISTEN connection is made again and every stream gets `resync`. The streams end in a `preClose` hook, and each closes its connection, so a stop does not wait the grace period for them.

**As built (PR 24), the story bundle:** `POST /orgs/{o}/pubs/{p}/editions/{e}/desk-bundle` (`desk.export`, {statuses?: [...], Ready by default}) answers the Pageinator stories file itself, `application/zip`, streamed as it is made (fflate 0.8.3; `reply.send(stream)`), rather than {bundleId, url, stories, sha256}. Its id and story count are in the `X-Pageinator-Bundle` and `X-Pageinator-Stories` headers.
- **Format:** exactly `tools/desk/CONTRACT.md` §6: `bundle.json` (every key, none other) and `photos/<sha256>.<ext>` per distinct photo, every file stored (a deflated `bundle.json` of a repetitive story could pass the Desk's 100:1 packing limit); no ZIP64.
  - `revision` is the story's version, which every change of the story makes the next, its photo and the photo's caption and credit included.
  - The body is desk-text/1: the engine's own blocks joined by `\n\n`, `## ` for a subheading.
  - A photo's `filename` is its Desk id and type, since the API does not keep uploaders' file names.
- **Limits:** at most 200 stories, `bundle.json` at most 32 MiB, and 200 MB in all, checked before anything is recorded or sent. Spiked stories are never sent (400); Held and Draft only when asked for (an owner decision to confirm).
- **Refusals (409 `bundle_refused`, naming each story):** a story whose photo was rejected or deleted (sending it without the photo at the same revision would leave the Desk printing the old one; any future reject or delete path must bump the story's version: 11-fix-before-launch), and a subheading that starts with `#`, which desk-text/1 cannot write. Nothing is dropped silently.
- **desk-text/1:** written and checked with Python's whitespace (`@pageinator/desk-text`), and checked against the Desk's own `desk_text` in the tests.
- **Photos:** each is read from the version its asset is pinned to, and its SHA-256 is checked as it streams. A mismatch cuts the ZIP off, and the Desk then refuses it as damaged.
- **Records:** the bundle is recorded with each story's text revision and the revision it was sent at (`desk_bundle`, `desk_bundle_revision`; the bundle has no stored object, so no key and no ZIP SHA-256: migration 2026_11_25_0001) and audited (`desk.export`, through `recordAudit()` in the same transaction).
- **Retries:** no Idempotency-Key. A retry makes another bundle of the same revisions, and the Desk replaces an article only for a higher revision.
- **Tested:** the round trip into a throwaway Desk home with `deskserver/bundle.py` (test/db/desk-bundle.test.ts). Every story and photo arrives, and a re-export after an edit replaces exactly the edited stories.

**As built (PR 21 and PR 24's screens, found missing by the L2.1 phone smoke), editions and "Send to the Desk":**
- **API** (`src/modules/stories/editions.ts`, `src/db/editions.ts`):
  - `GET /orgs/{o}/pubs/{p}/editions?from&to` (`edition.view`, both dates inclusive) → {items: [{id, date, pages, backPageAds, volume, issue, price, status, counts {stories, ready, spiked}}]}, newest first, at most 400, no cursor. Deleted stories are not counted; `spiked` is there so the screen can say what is never sent.
  - `POST /orgs/{o}/pubs/{p}/editions` (`edition.create`, the whole cell only: Owner, Admin, Chief Editor, Editor; Advertising's and Prepress's ◐ cells are ad positions and the colour map, 07 §12, so they are refused, audited) {date, pages: 4|8|16, backPageAds? (on by default), volume?, issue?, price? (cleaned as the Desk cleans a line, at most 200 characters)} → 201 Edition, with an `Idempotency-Key`. Its Desk key is its date. A date that has one already: 409 `edition_exists`, whose `current` is that edition (the plan's `existingId`). Audited `edition.create` ({date, pages}) in the same transaction.
  - `PATCH …/editions/{e}` (`edition.edit`, the whole cell only) {volume?, issue?, price?, date?, pages?, backPageAds?} → Edition (as built 2026-11-05, A12). The folio as before (L2.5). A date, page count or back-page ads change is refused once the edition is released or archived (409 `edition_released`), while a layout run is active (409 `run_active`, its run) and for a date another edition has (409 `edition_exists`, that edition). In one transaction with the edition locked: the Desk key follows the date (its `-N` kept), every `done` run is set aside (`cancelled`, its message `m.run.editionChanged`: lay it out again), the ad placements that no longer fit the new date or plan are taken out and that date's bookings placed, slot artwork without a slot cleared, plan pages past the new count emptied; audited `edition.edit` with the new values, `was` and `setAside`. Stories pinned past the new count stay pinned (the layout's readiness names them). The Editions screen's "Correct date and pages" side sheet sends it. Not built: deleting a draft edition (L2-350).
  - A story goes into an edition, or out of one, by its own `PATCH` `editionId` (the desk's field, as before; `story.edition_change`). A spiked story is not edited, so it cannot be moved.
  - Live: `app.edition`'s trigger (migration `2026_11_28_0001`) sends a hint `edition` {org, pub, edition}; the stream passes it, as `edition` {publicationId, editionId}, to whoever has `edition.view` on that publication.
  - Tested: `test/db/editions.test.ts` (role matrix, defaults, cleaning, one a date, idempotency, audit rows, counts, placing and removing a story, the hint, another tenant's ids), `test/unit/live-events.test.ts`.
- **Web** (`apps/web/src/features/editions`, `api/edition-service.ts`):
  - **Editions** (`/org/:o/pub/:p/editions`) is in the navigation for `edition.view`, in the deployed app. It lists the editions (date, pages, back-page ads, volume, issue, price, the counts) as a list that fits a 360 px phone, each with a link to its stories. It fetches again on a live `edition` or `story` event of the publication, and on `resync`.
  - **Create edition** (date, 4/8/16 pages, back-page ads, volume, issue, price) shows only for a full `edition.create`. It keeps one Idempotency-Key for its retries. `edition_exists` says so, with a link to that edition's stories.
  - **Send to the Desk** shows only for a full `desk.export`. When nothing is Ready it says so instead of offering the button. It says how many spiked stories are never sent, and that a download is in progress. It saves the ZIP the route answers (an object URL and a `download` link) and says how many stories it holds. On an error it shows the message, and for `bundle_refused` each story's reason.
  - **The story editor** has an "Edition" choice among the desk's fields ("No edition", or an edition by its date). It saves `editionId` through the same autosave as priority and page. The Stories list's edition filter, and the paste dialog, offer the publication's editions for whoever has `edition.view`; a Reporter still gets the editions of the stories they see.
  - The development-only "Simulated" status surface with its English developer note (`StatusSurface.tsx`) is removed: there is no real edition status to show yet (L2-340).
  - Strings in English and Marathi; the Marathi ones are on the native-review list. Tested: `tests/editions/editions.test.tsx` (axe included), `tests/api/editions.test.ts`, and the navigation, audit and live tests.

**As built (L2.1 audit API, for PR 23), the audit log and the notifications' display text:**
- **`GET /orgs/{o}/audit?actor&action&target&publication&from&to&cursor&limit`**, permission `audit.view` (`src/modules/audit/routes.ts`, `src/db/audit.ts`) → {items: [{id, at, actor {kind, id, name} | null, action, target {type, id}, publicationId, requestId, data, ip, userAgent}], nextCursor}.
  - **Who sees what:** Owner and Admin see every event of the organisation. A Chief Editor sees only the events of the publications they are Chief Editor of, and never an organisation-level one (people, invitations, the organisation itself): only actions of `AUDIT_ACTIONS` scope `"publication"` are shown to them, so an action missing from the catalogue never is. `ip` and `userAgent` are null for them. Anyone else gets 403, and the refusal is audited.
  - **Filters**, each checked by `AuditQuery` (a bad one is 400, never 500): `actor` (a person's id), `action` (one action of `AUDIT_ACTIONS`, or a prefix of some ending in `.`, compared with `starts_with`, never `LIKE`; any other is 400), `target` (`story`, or `story:<id>`), `publication`, `from` (inclusive) and `to` (exclusive) as ISO times with an offset of at most ±15:59 (Postgres's range), `limit` in plain decimal digits (50 by default, at most 200).
  - **Read wall in the database** (migration `2026_11_26_0001`, restrictive policy `pub_read_wall`, reads only): a transaction reads only the events of the publications it reaches and the organisation's own (no publication). Owner and Admin reach every publication; a Chief Editor's narrower view stays the API's (L2-216).
  - **Cursor:** newest first by `(at, id)`, base64url as on the stories and notifications lists. A cursor must name an event the reader may see, so another organisation's, or one out of a Chief Editor's view, is refused (400). Indexes on `(org_id, actor_id, at desc)` and `(org_id, publication_id, at desc)` serve the actor filter and a Chief Editor's view or the `publication` filter (migration `2026_11_26_0001`).
  - **Names** come from `app.person` when shown (an erased person's is the replaced name); `data` holds ids only. Sign-in events stay in `identity.auth_event`.
- **Refusals name their publication:** `access.denied` rows written by `authorize()` and by the service rules (`auditRefusals`) now carry the route's `:p` as `publication_id`, so that publication's Chief Editor sees them; a refusal on an organisation route has none.
- **`AUDIT_ACTIONS`** in `packages/contracts/src/audit.ts` lists every action the API writes, each with its scope: 107 actions, 94 at publication scope and 13 the organisation's (the unit test pins the counts; onboarding a new paper (L4) added onboarding.start, onboarding.cancel, onboarding.use, onboarding.test_edition, onboarding.ready and onboarding.fail; organization and publication settings added org.rename, org.publication_add and publication.settings_edit; the sidebar screens added engine_profile.retemplate, brand.set and print_profile.create; the publication's sections section.create and section.edit; L2.3–L2.6 added the layout, editor, release and ads desk actions; L2.2 added asset.ready, asset.reject, asset.fail, engine.event_refuse and engine.event_ignore, and the media library asset.edit and asset.delete; the editions screen added edition.create; the Word import import.create, import.done and import.fail; the news finder (L2.7) news.source_create, news.source_edit, news.source_delete, news.settings_edit, news.collect, news.pick, news.draft_done, news.draft_fail, news.photo_choose and asset.rights_confirm). The log has one writer, `recordAudit()` (`src/db/audit.ts`), whose action is typed `AuditAction`; a unit test (`test/unit/audit-actions.test.ts`) reads the source, so an action without an entry, an entry nothing writes, or the table's name anywhere else (any spelling) fails CI.
- **What is recorded** (closing L2-210 and L2-211), each event in the transaction of its change, so a refused or failed change leaves none, and a replayed request (the same Idempotency-Key) writes none again. `data` holds ids, numbers and state names, never text a person typed (headline, body, comment, caption, credit, desk note, file name):
  - stories: `story.create` ({rev, origin, edition, section, priority, pagePin}), `story.revise` (one per saved revision: {rev}), `story.status_change` ({from, to, comment}: every move, the desk's pick-up on its first edit included), `story.assign`, `story.unassign`, `story.due_change`, `story.edition_change`, `story.section_change`, `story.priority_change`, `story.page_pin_change`, `story.language_change` (each {from, to}), `story.desk_note_change` (that it changed), `story.delete`;
  - comments: `comment.create`, `comment.edit`, `comment.resolve`, `comment.reopen` ({story, parent});
  - photos: `upload.presign` (on the upload: {bytes}, never the file name), `upload.complete` (on the asset: {upload, existing, bytes, mime, widthPx, heightPx}), `upload.reject`, `photo.attach`, `photo.replace` ({asset, previous}; with the caption and credit changes of the same PUT), `photo.remove`, `photo.caption_change`, `photo.credit_change` ({asset}). An asset itself is never rejected after it is made yet (no route), so there is no asset-rejected event;
  - people: invitations, members and `org.bootstrap`; `member.update`, `member.remove`, `invitation.create` and `invitation.accept` in the transaction of their change, with the membership or role changed last (L2-213); no `member.update` or `member.remove` when the member was removed meanwhile (404). The people routes' refusals (an Admin changing the Owner) are audited as the stories' are, and a refused invitation accept in the invitation's organisation (L2-215).
  - a reassignment that also moves the due time writes `story.assign` and `story.due_change` (the old time kept).
  - **Every event of a request records its client:** the address Fastify gives (behind `PGN_TRUST_PROXY` only the trusted proxy's client) and the User-Agent, carried on the request's tenant (`Tenant.client`, set by the access check, by the invitation accept and by GET/PATCH `/me`'s repairs). `org.bootstrap`, run by a script, has neither, and no person.
- **Notifications' display text:** each item of `GET /orgs/{o}/notifications` carries `story: {headline, status} | null`, read in the list's one query (a join on the story and its current revision) and shown only while the reader still sees the story under the story rules (null once it is given away from a Reporter, their role there no longer sees it, or it is deleted). A notification of a publication the reader no longer reaches (removed from it, or their last role there taken away) is not null: the list leaves it out, so it disappears from the drawer, and `invitee: {id, name} | null` for `invitation_accepted`.
- **On screen (PR 23, `apps/web`):** the notifications drawer says each story by its headline and its status now (a story the reader no longer sees is named by no headline, said to be gone, and has no link), and the invitee by name. The audit log is `/org/:o/audit` (`features/people/AuditScreen.tsx`), in the navigation, under the organisation and under a publication, only for `audit.view`; plain names for all 42 actions in English and Marathi (L2.2 added the engine's five, the editions screen edition.create) (an unknown one by its code); filters for action, publication and days (India's time, the last day included) kept in the address; older events a page at a time; the address and browser only when the API sends them.

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

**Built in PR 17 as proposed, and still proposed (Q1 is the owner's to settle).** What the build adds:
- "the author" is the story's reporter or the person it is given to (its assignee); "desk roles" are a full `story.edit_any` (Owner, Admin, Chief Editor, Editor, Sub-editor); Spike and restore are Owner, Admin, Chief Editor and Editor.
- "Back to where it was" is `to: "restore"`, which returns a held or spiked story to the state it was in before it entered its current run of Held and Spiked (held → spiked → held is one run), never to a state inside the run. Restoring a spiked story is the spikers' (a Sub-editor gets 403), and a restore never lands on Spiked.
- Every move is recorded in `story_status_change`, with the send-back's comment, and closes the open revision, so the text a story was marked ready with stays as it was.
- A move from a state that does not allow it answers 409 `invalid_transition`; a move the person's role never makes answers 403; Placed cannot be asked for.
- Notifications (the desk on Filed, the reporter on a send-back) come with PR 19.

**The stories API as built (PR 17):**
- **A story has a version** (`revision` in the API): every change of it, its text, its fields, its state or its assignee, makes the next, and every change names the version it was based on as `baseRevision`, or gets 409 `story_changed` with the story as it is now (`error.current`). Two changes on one base never both succeed, moves included. `updatedBy` is whoever made the last change.
- **Each save of the text is also a revision of the text** (`textRevision`; the database numbers it and closes the one before), listed by `…/revisions`. Folding a person's autosaves into one open revision is a later refinement (11-fix-before-launch).
- **What a ◐ cell of §12 reaches** (`src/modules/stories/rules.ts`): a Reporter sees, edits (before Ready) and files the stories they report or are given; a Photo Editor sees every story, read only (the photos are PR 18); Advertising sees none; a Page Designer reads but edits box text in the page editor only (L2.4). Placement (priority, page pin, edition) and the desk note are the desk's.
- **Idempotency-Key** on creates, paste and transitions: the key is claimed, the work done and the answer stored in one transaction, so a request runs at most once and a failed one leaves no key. The same key and request replays the stored answer, after the route's access check and a check that the person still sees the stories it shows; another request under the key answers 422 `idempotency_key_reused` (§5.1); a request still running holds the key, and a second one waits up to 3 seconds, then answers 409 `request_in_progress`.
- **Paste makes at most 200 stories**, and keeps only their ids for a replay.
- **A refusal by the story rules is audited** as `authorize()`'s are (`access.denied`, with the reason).
- **Paste** stores exactly what the Desk's `bulk_create` would, through `@pageinator/desk-text` `pasteArticles`.

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

**As built (PR 18):**
- **Uploads wait under `uploads/orgs/<org>/pubs/<pub>/<upload>`**, not under the organisation's prefix: a lifecycle rule can match a key's start only, so quarantine needs a prefix of its own (`uploads/`). The API deletes every version of a completed or refused upload by its VersionId; the bucket's rules expire what is left a day after it arrives, remove the old version a day later, and remove a delete marker left alone (`UPLOADS_LIFECYCLE` in `src/storage/s3.ts`). Completed uploads are copied out to `orgs/<org>/pubs/<pub>/assets/<asset>/original`. Both keys are computed by the database from ids.
- **One asset per picture and publication** (`(org_id, publication_id, sha256)`), not per organisation: a photo found in another publication would tell a reporter it is there.
- **The daily 2 GB** is counted in `app.upload_quota`, under the organisation wall only, under a row lock. The 60 uploads an hour are counted after taking that lock, so requests at once cannot pass the limit together. The quota is charged the declared size, and the policy takes exactly that size (below).

### 6.2 Presigned uploads

1. **Presign.** `POST /uploads` checks the type (JPEG, PNG, WebP) and size, writes an `upload` row, and returns a presigned **POST** (@aws-sdk/s3-presigned-post 3.1152.0) valid for 15 minutes:
   - exact key;
   - `content-length-range` of exactly the declared size (at most 40 MB; as built, PR 18: the size the quota counts), and complete refuses an object of another size;
   - Content-Type pinned;
   - `x-amz-meta-upload-id`.
   POST is used rather than PUT so that S3 itself enforces the size limit.
2. **Upload.** The browser or phone uploads straight to S3, with a progress bar and retry. On phones: `accept="image/jpeg,image/png,image/webp"` with `capture="environment"`. Whether iOS converts HEIC to JPEG for this input is to verify on the newsroom's phones.
3. **Complete.** `POST /uploads/{u}/complete`:
   - L2.1: the API reads the whole object once (at most 40 MB): its SHA-256 (for deduplication and the object's metadata), its type from its magic bytes, and its width and height from the format's own header (our own small reader, no image library; a JPEG's markers are walked through the whole file, since its EXIF can fill several MB before the frame). A ranged GET of 32 bytes, as first planned, gives neither the hash nor the size. It reads and copies the version HeadObject named, and refuses to complete when the store names none (an unversioned bucket; `/readyz` reports the bucket failing unless its versioning is Enabled). Then it deletes every version of the quarantine key, so a file sent again under the still-valid policy is not kept either. A side over 100000 pixels is refused. HEIC and AVIF are refused (422 `not_a_picture`) for now. The asset is created as `received`.
   - L2.2 onward: the API also defers `media.ingest`, and the worker decides `ready` or `rejected`.
4. **The original is never altered.** EXIF (including GPS) stays only in the original; renditions drop all metadata (EXIF, XMP, colour profile and comment), as the Desk's do. Junk *before* the picture is refused as not a picture; data *after* it (a JPEG with a ZIP appended, a PNG with HTML after its end) is accepted, as the Desk accepts it, and reaches only the original, never a rendition, which is made from the decoded pixels (L2-120 stays open for the originals).

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
- **As built (PR 18):** `GET …/assets/{a}/file` answers 302 (`Cache-Control: no-store`) with a file name from the picture's Desk id, never the uploader's. A full `media.view` downloads every picture of the publication; a Reporter's ◐ only the ones they uploaded or that are the photo of one of their stories (404 otherwise); Advertising has no `media.view` (403). `variant=preview` answers 404 until renditions (L2.2).
- **A story's photo** (`PUT/PATCH/DELETE …/stories/{s}/photo`, permission `media.upload`): whoever edits the story, or a Photo Editor of the publication on any story they see but a spiked one; a picture of the same publication only; each is a change of the story on its version (`baseRevision`), its caption and credit cleaned as the Desk cleans text. `DELETE` takes the base as `?baseRevision=`.
- Page PDFs and previews of unpublished pages are linked only through authorised API redirects (doc 15 §10, item 10).

### 6.5 Local development

- **SeaweedFS 4.48** (Apache-2.0; the same software as the VPS option) runs `weed server -s3` on 127.0.0.1:58333.
- `apps/api/scripts/dev-buckets.ts` creates the buckets: versioning on, and Object Lock enabled at creation on the archive bucket, because SeaweedFS needs it at creation.
- **As built (PR 18): there is no in-memory fake.** `src/storage/s3.ts` is the only object store; the unit tests need none (they test `picture.ts` on bytes), and the database tests use SeaweedFS. Keys are built by the database from ids (`app.upload.key`, `app.asset.original_key`), not by a `keys.ts`.
- **One staging check on real S3** in L2.1 covers POST policy conditions and checksums.
- **SeaweedFS 4.48, as tested (PR 18):** it enforces every POST policy condition (an exact size, one byte more or less refused; exact key; Content-Type; the upload id's metadata, changed or left out; expiry, with a 1-second policy); it versions objects and serves a version by its VersionId through a presigned GET with the response headers set; Object Lock is enabled at bucket creation; it accepts the `uploads/` lifecycle rules and gives them back, but whether it deletes after a day was not observable in a test (11-fix-before-launch); it deletes a version by its VersionId, leaving no delete marker. The database tests use a bucket of their own per run.

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
| End-to-end smoke: sign in → file a story at a phone viewport → desk marks Ready → bundle | Playwright 1.64.1 | `apps/web/e2e` | On a developer's machine (`pnpm --filter @pageinator/web e2e`); CI once the owner decides on the browser licences (11-fix-before-launch L2-341) |
| Private, attested in the PR (O-d): real engine on the real dataset; hosted vs Mac parity; CMYK parity | local scripts | `~/PageinatorPrivate` | Locally |

### 7.4 CI additions (`.github/workflows/ci.yml`)

- **`api` job:**
  - `docker compose -p pgn-ci --env-file <a CI env file with random PGN_* values> -f infra/docker/compose.dev.yml up -d --wait db s3 mail` (compose refuses to start without every PGN_* value);
  - `pnpm install --frozen-lockfile`;
  - migrate;
  - codegen with a diff check;
  - Vitest projects `api`, `api-db`, `tenancy`.
- **`desk` job:** the oracle venv from the frozen lock, plus the Desk server environment from the new hashed `tools/desk/requirements.lock`; runs the Desk tests.
- **`engine-worker` job:** build the image (no push on PRs), run the worker tests inside it, run the Python licence check, and run the queue's tests against a Postgres and a SeaweedFS of the job's own (compose `db s3`), with the worker's runner.
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

**As built (launch readiness, 2026-11-05), where it differs from this plan:** one app host runs everything for the
pilot (`infra/docker/compose.pilot.yml`; the engine host of §8.1 comes later): Caddy with the web app, the API (which
also runs the news finder's schedule, the ads' cut-off alert and the background measuring), the nightly backup, the
engine's queue, and the page editor's edit gateway. The gateway is the worker image's second process (`gateway`): it
shares the engine's homes volume with the queue, has the engine's S3 key and no database password, and publishes no
port: the API reaches it as `http://gateway:8790` on the host's own Docker network (plain http is allowed for that name
only), every call signed with `PGN_GATEWAY_SECRET`. Their memory ceilings add up to 4 GB, so the host is a t3.large
(8 GB). The engine's layout pool follows its container (2026-11-06, A15): one process per CPU but one, no more than
its cgroup's memory holds at 768 MiB each beside 1.4 GiB for the engine's own process, the queue and its other job
(`desk_engine.py` `pool_workers`): one on the pilot's 2 GB, as on pilot-local (2 GB, 2 CPUs). Measured under amd64
emulation: an 8-page edition peaks at 754 MiB of 2 GiB; the pilot's largest photo converts in 99 MB of its job's 1 GB
(a 100 MP PNG with transparency does not: doc 11 L2-325). The page editor's raster cache (`cache/rasters`) is pruned:
entries unused for a day, then the least recently used while over 2 GiB, never one used in the last hour. `deploy.sh` migrates, then `up --wait` fails unless every service with a health check is healthy (Caddy, the
API, the queue, the gateway), then checks `/readyz` and that the API reaches the gateway. The archive bucket carries
Object Lock in governance mode, ten years by default (`s3-archive-object-lock.json`, D-20), as each released file's own
retention. Settings added for L2.3–L2.7: `PGN_GATEWAY_SECRET`, `PGN_CONTACT_TO`, and the optional
`PGN_ANTHROPIC_API_KEY` (the news finder's AI part is off without it). `pilot-local` adds a Mailpit (`mail-local`), so
the whole newsroom day can be rehearsed on one machine (`docs/runbooks/deploy.md`, "On one machine").

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
| **L2.7** (before real use, not before building) | D-26 Anthropic API key and monthly budget · D-27 the starting source list · D-28 the house style guide text (examples kept private) · D-29 any paid agency (PTI, ANI, Reuters pictures) to treat as Safe to print |

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
| 5 | api: database plumbing | kysely 0.29.7, pg 8.23.1 · pools (app, auth, listen) · `withTenant` · migration runner · migrations for schemas, helper functions, grants, `publication`, `person`, `org_settings`, `audit_event` with RLS · our own type generator (`src/db/codegen.ts`) with CI diff, not kysely-codegen 0.20.0, whose dependency argparse 2.0.1 is under Python-2.0 · ESLint: no raw pool outside `src/db` | ~400 | 4 |
| 6 | api: tenancy harness | Catalog meta-test (a) · cross-tenant generator (b) with two fictional organisations · planted-defect test · CI job `api` on compose | ~300 | 5 |
| 7 | identity 1: Better Auth | a request-log serializer that drops the query string (Better Auth's emailed links carry tokens) · better-auth 1.7.8 (§4.1: 1.7.12 was younger than the 7-day rule) · generated `identity` migration (printed by `scripts/identity-schema.ts` through Better Auth's `getMigrations`; generated SQL listed separately) · mount `/api/auth/*` · argon2id on Node's `crypto.argon2` · nodemailer 10.1.1 with Mailpit · verification and reset emails (en/mr) · telemetry off | ~350 + generated | 6 |
| 8 | identity 2: sessions | `request.actor` resolution · 30-day absolute limit · rate-limit rules and the per-email failure counter · `identity.auth_event` · "new sign-in" email · tests: generic wrong-password answer, reset revokes sessions, lockout | ~350 | 7 |
| 9 | orgs and permissions (built in L2-D with 10 and 11; §4.2–4.4 say what changed) | Organization plugin · `publication_grant`, `invitation_grant` · permission map from §12 in contracts · `authorize()` and the route-declaration meta-test · `/me` · `bootstrap-org.ts` | ~400 | 8 |
| 10 | invitations | Endpoints (§5.2) · invite-only sign-up (`validateUserInfo`, §4.1) · `afterAcceptInvitation` grants and reconciliation · invitation suite (CVE-2026-53514 regression, wrong email, expired, race, no injected grants) | ~400 | 9 |
| 11 | two-step | twoFactor plugin · `mfa_required_roles` · `two_step_required` enforcement · tests | ~250 | 10 |
| 12 | web 1: catalogue and client | English/Marathi catalogue with glossary seeds (02 §3.9) and a key-parity meta-test · API client (envelope, Idempotency-Key, `X-Pageinator`, 401) · real session service replacing `SimulatedSessionService`, with the simulated DTO tests rewritten (doc 15 §11) | ~400 | 11 |
| 13 | web 2: sign-in screens | Sign in (with "Keep me signed in") · invitation and sign-up · verify · forgot and reset · two-step verify | ~380 | 12 |
| 14 | web 3: Account → Security | TOTP setup with QR (qrcode 1.5.4) · backup codes · devices and sign-out | ~300 | 13 |
| 15 | desk-text | `packages/desk-text` (port of `blocks`, `body_words`, `is_brief`, `clean_text`, the paste parser) · a Python vector generator run in the oracle venv on fictional text · parity test | ~350 | 4 |
| 16 | content schema | Migrations for `section`, `edition`, `story`, `story_revision` (with the closed-revision trigger), `story_status_change`, `story_photo`, `comment`, `idempotency_key`, `desk_bundle` and `desk_bundle_revision`, with RLS; server-made ids; keys with `org_id` and `publication_id` (§3.3); (b) covers them automatically. Not yet: `search_text`/pg_trgm, the `asset` foreign key (PR 18) | ~350 | 6, 15 |
| 17 | stories API (built in L2-F; §5.4 says what it decided) | Create, read, list, update with revisions and `baseRevision` · transitions (§5.4) · assignment · paste · idempotency middleware · role-matrix tests · the endpoint tenancy generator (c) | ~400 | 16, 9 |
| 18 | photos (originals) | @aws-sdk/client-s3, s3-presigned-post and s3-request-presigner 3.1152.0 (3.1153.0 was younger than the 7-day rule) · presign, complete and sniff · assets · story photo · downloads · storage tests (d) · `dev-buckets.ts` | ~400 | 17 |
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
| better-auth | 1.7.8 (built; 1.7.12 was planned) | MIT | npm; GitHub releases (1.7.12 released 20 Oct, younger than the 7-day rule, so 1.7.8 was installed on 21 Oct; 1.7.7 fixed the critical magic-link advisory). The `auth` CLI is not used: `scripts/identity-schema.ts` calls `getMigrations` (§3.6). `@better-auth/cli` is deprecated |
| zod | 4.6.7 | MIT | npm |
| fastify-type-provider-zod | 7.0.0 | MIT | npm (peers: zod ≥ 4.1.5, fastify ^5.5.0, @fastify/swagger ≥ 9.5.1, openapi-types ^12.1.3) |
| @fastify/swagger · openapi-types | 9.9.2 · 12.1.3 | MIT · MIT | npm |
| @fastify/rate-limit · helmet · cookie · cors · under-pressure | 11.2.1 · 13.2.0 · 11.1.3 · 11.3.1 · 9.2.1 | MIT | npm (cookie, cors and under-pressure probably not needed) |
| @aws-sdk/client-s3 · s3-presigned-post · s3-request-presigner | 3.1152.0 (built; 3.1153.0 was planned) | Apache-2.0 | npm. 3.1153.0 (19 Oct) was younger than the 7-day rule when PR 18 was built; 3.1152.0 (14 Oct) brings 28 packages, 26 Apache-2.0, `bowser` MIT and `tslib` 0BSD, as a registry walk predicted exactly |
| pino | 10.4.0 | MIT | npm |
| nodemailer | 10.1.7 (built with 10.1.1; upgraded 2026-11-02) | MIT-0 | npm (MIT-0 is on the allowlist). 10.1.4 and later fix three addressparser advisories; `test/unit/mail.test.ts` checks the parser |
| @node-rs/argon2 | not used | — | argon2id runs on Node's built-in `crypto.argon2` (§4.1), so no native package is needed |
| kysely-codegen · kysely-ctl | 0.20.0 · 0.22.0 | MIT | npm. **Neither is used:** kysely-codegen pulls in argparse 2.0.1 (Python-2.0) through cosmiconfig and js-yaml, outside the licence allowlist, so `src/db/codegen.ts` generates the types (§3.6); kysely-ctl is not needed |
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