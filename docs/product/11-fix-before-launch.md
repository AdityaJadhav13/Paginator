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

## Page editor view: rulers and zoom (L1-1, `tools/desk/static/editor.js`)

These come from the feature's code review and its independent verification, 2026-10-21. "Pre-existing" means the behaviour was already in the editor before this feature.

| # | What | Why it can wait |
|---|---|---|
| VIEW-1 | Zoom to selection remembers the story's box from the moment of Shift+2. If the story is then moved, resized or undone, a later window resize centres on where it was. Fix: keep the story's key and recompute its box on resize | Shift+2 again fixes it; view only |
| VIEW-2 | Ruler ticks are drawn 0–1 px past their true position (`Math.round` plus a 1 px line), and look soft at a device pixel ratio of 1.5 | Under a pixel; view only |
| VIEW-3 | Numbers whose tick lies under the ruler corner are drawn and clipped, leaving stubs (a lone "0" from "120", "−3" from "−300") | Cosmetic |
| VIEW-4 | + , − and 0 still change the zoom during a drag (pre-existing). The move sent on release is then computed at the new scale. Ctrl+wheel behaves the same | Rare; the engine sets every move and undo restores it |
| VIEW-5 | + and − zoom about the page's top centre, so after Shift+2 the story leaves the view (pre-existing). Fix: zoom about the view's centre | Shift+2 again brings it back |
| VIEW-6 | Any resize of the view (the story panel opening, the window) puts a scrolled page back at its top (pre-existing). Fix: keep the millimetre point at the view's centre on resize | The header no longer changes height, so ordinary edits do not trigger it |
| VIEW-7 | Fit page and fit width centre the page in the whole view, not in the area beside the left ruler (the page sits about 10 px off-centre) | Cosmetic |
| VIEW-8 | Shift+2 with nothing selected tells only screen readers; a sighted user sees nothing happen (the Story button is greyed) | Minor |
| VIEW-9 | At 1280 px the edition name in the header is cut short (its tooltip has the full text) | Cosmetic |
| VIEW-10 | Tests: the view maths is tested (`tools/desk/test/test_editor_view.mjs`), but the editor's wiring (keys, guards, saved choice, resize) is not. No CI job runs any Desk test, Python or JS | Checked by hand and in a browser for this feature; PR 3 of the L2 plan adds the Desk's CI job |
| VIEW-11 | Small items:<br>• the comment at `fit()` describes the top placement wrongly;<br>• `aria-keyshortcuts` is missing on Fit, Width, Story and Rulers | Cosmetic |
| VIEW-12 | Spec items not built yet (05 §8.5, §8.12):<br>• moving or resetting the ruler origin;<br>• guides pulled from the rulers;<br>• a units menu;<br>• the absolute 10–800 % zoom range;<br>• Shift+0 = actual size (today "100 %" and Shift+0 mean the whole page) | Not claimed by the Desk; needed for the product's editor |

## Page editor: lock a story in place (L1-2)

From the feature's code review and its independent verification, 2026-10-21. Print safety held in both: the engine
refuses every change to a locked story before anything is written.

| # | Where | What | Why it can wait |
|---|---|---|---|
| LOCK-1 | `deskserver/api.py` `_save`, `editing.py` | The race case: when a story is locked on the other page between the save's check and the engine's export, both pages stay "needs saving" with reasons that are not true ("Page 1 is taking a story…", "did not finish"), and the page's last check result is cleared. A refused save should restore what `before_save` changed | Fails closed (nothing prints wrongly); rare |
| LOCK-2 | `static/editor.js` undo/redo | After an undo or redo unlocks a story, the "is locked" notice stays on screen | Cosmetic |
| LOCK-3 | `static/editor.js` `another()` | With every story locked, "Try another layout" sends a request and shows a red error, instead of saying so at once like the other refusals | The answer is right; only the presentation differs |
| LOCK-4 | `static/editor.html` help text | "on the page's empty space it unlocks every story" reads as if a right-click unlocks everything; it opens a menu with **Unlock all on page** | Wording |
| LOCK-5 | `CONTRACT.md` §2.1, `engine/deskedit.py` `_attrs` | The contract says a `locked` value that is not true, false or missing is refused, but `null` is taken as false (unlock in place). Make the code or the contract match | The behaviour is safe (unlocking in place is allowed) |
| LOCK-6 | `engine/deskedit.py` `free_regions` | Strips between 10 mm and the shortest free story's height are kept as regions; gen1 must fill every region, so one such strip makes every try fail with "no fill". Drop strips shorter than the free stories' smallest option | The refusal is honest and changes nothing |
| LOCK-7 | `engine/deskedit.py` `alternative()` | With the lead locked, variants 1–3 run the same search, so further presses give nothing new; and a layout that comes out unchanged still makes a revision and an undo step, and marks a saved page "Changed · not saved" | The notice says the page came out as it was |
| LOCK-8 | `engine/deskedit.py` `alternative()` | Up to 4 searches instead of 2, each rebuilding gen1's tables and re-measuring widths it measured on the last press; not measured against the 180 s limit on a full 11-story page (the verifier's searches took 0–9 s) | Performance only |
| LOCK-9 | `test/test_server.py`, `test/test_engine.py` | Test gaps: the fake engine does not check the type of `locked` or snap places, and its alternative never answers "no fill"; "a deleted article leaves even when locked" is tested through `sync()` only, not `refresh_text()`; no test runs the lock-aware alternative through gen1's real search (a probe did: correct, no overlaps) | Checked by hand and by both checks |
| LOCK-10 | `engine/deskedit.py` and `static/editor.js` messages | The engine says "Shift+L" while the editor's own notices say "⇧L" on a Mac; with several stories held on one page the server and the editor may name different ones | Wording |
| LOCK-11 | `static/editor.js` menu | Reasons for disabled items are only in their `title`; the canvas has no `aria-haspopup`; during a save or another layout, menu items and Shift+L silently do nothing; after a right-click that produced no menu event, a keyboard-opened menu may jump to the pointer for 10 s | Accessibility and polish |
| LOCK-12 | `static/editor.js` drawing | The padlock mark covers the end of the headline at the story's top-right corner (screen only) | Does not print |
| LOCK-13 | `static/editor.js` "Other stories" list | If another tab locks a story after this page loaded, the list still shows it unlocked; a bring-in is then refused by the engine (400) and the page is shown again, leaving an undo entry for the refused change | The engine refuses; nothing is written |
| LOCK-14 | `engine/deskedit.py` `is_locked` | Its docstring says anything but false counts as locked, but 0, "" and null count as unlocked | Nit |

## Page editor: photo crop and focal point (L1-3)

From the feature's code review and its independent verification, 2026-10-22. Print safety held in both: a page without
a crop prints byte for byte as before, and a crop prints exactly the window the editor shows.

| # | Where | What | Why it can wait |
|---|---|---|---|
| CROP-1 | `engine/deskedit.py` `_full_raster` | Every photo drawn puts its whole raster in `cache/rasters` at once, uncompressed (up to 16 MB for an upload), and nothing ever cleans the cache | Disk only; the cache already keeps each gen1 crop the same way |
| CROP-2 | `engine/deskedit.py` `__init__` | A stored crop that cannot print is dropped when a page opens, but neither written to its edit file nor counted as a new revision | The dropped crop never printed anyway (render applies a crop only to its own photo); the next change writes the file |
| CROP-3 | `static/editor.js` photo mode | After **Crop photo** in the panel the focus stays on that button, so the arrows do not move the photo until the page is clicked; Esc and V do nothing while the zoom slider has the focus | Dragging and the canvas keys work; accessibility polish |
| CROP-4 | `README.md` | The floor values named there (150 ppi, 142.5 for uploads) leave out photos imported from a printed page, whose floor is 0.95 × the resolution they were printed at when lower | Wording; the engine uses gen1's own floor |
| CROP-5 | `engine/deskedit.py` | A crop is matched to its photo by id only: two stories sharing one photo id would each pass the other's crop test | The Desk gives every upload its own id; no two articles share one |
| CROP-6 | `static/editor.js` `send` | The "its crop is reset" notice also shows when the engine dropped a crop for another reason (the story's set option has no photo) | The page shown is the engine's; only the words |
| CROP-7 | `engine/deskedit.py` `crop_window` | A zoom stored above what the frame allows stays stored (the frame prints at the largest allowed); a later larger frame enlarges it again | Intended (the focal point keeps its zoom at every size); the panel shows the zoom that prints |
| CROP-8 | `static/editor.js` `ppiBadge` | The badge warns "below 150 ppi" at the largest zoom an upload allows (142.5 ppi), which the slider offers | Honest (spec §8.11: below 150 warns); a softer word could follow |
| CROP-9 | `engine/deskedit.py` `_apply_crops` | A cropped photo's raster is decompressed twice per render (gen1 and the crop) | Performance only (a few tens of ms) |
| CROP-10 | the server's save API | A save made through the API (not the editor) after a photo is replaced, without Update text, prints the old photo with its crop | The page stays stale, so not "press ready"; `refresh` drops the crop; the editor always runs Update text before a save |
| CROP-11 | `test/test_engine.py` | No unit test runs gen1's real render end to end with a crop (the tests run gen1's own crop lines and a gen1-shaped page) | Checked on the real engine: byte-identical PDFs without a crop, the exact window with one |

## Page editor: move a story to another page (L1-4)

From the feature's code review and its independent verification, 2026-10-22. The blocking items were fixed before the
merge:
- a move holds the run's save lock;
- a page with no free place refuses the move;
- a page whose stories overlap, or stand outside the news area, is never press-ready.

| # | Where | What | Why it can wait |
|---|---|---|---|
| MOVE-1 | `deskserver/api.py` `_move` | An unexpected engine error that comes back as a 400 also takes the target's "needs saving" mark back, as a refusal does | The engine answers an error only after taking the story back off the target |
| MOVE-2 | `engine/deskedit.py` `give_back` | It puts the target back in memory before writing its edit file; a failed write leaves the file with the story | The story is then in both pages' edits, which any save settles; the PDFs stay consistent |
| MOVE-3 | `CONTRACT.md` `move` row | "Refused before anything is written" overstates it: the target's `sync()` can write text another page set | That write is a change of its own, covered by the stale rule |
| MOVE-4 | `deskserver/editing.py` `before_move` | The target's earlier `needs_save_reason` is replaced by the move's | The page stays "needs saving" either way; only the words are lost |
| MOVE-5 | `deskserver/api.py` `_move` | A story already on the target ("already") still marks the target "needs saving" | It holds unsaved changes anyway (the story was brought in); one extra save at most |
| MOVE-6 | `static/editor.js` `moveToPage` | After a 500 when both pages were written, the editor has no undo entry for the move | The page is shown again as it is; the move can be undone by hand |
| MOVE-7 | `deskserver/editing.py` `note_revs` | It reads `status.json` even when no revision in the answer is a whole number | Performance only |
| MOVE-8 | `test/test_engine.py`, the fake engine | No end-to-end test of `receive` → `_depth` → `apply`, and the fake engine never answers "cannot be set at its width" | Each part has its own test; checked on the real engine |
| MOVE-9 | `deskserver/editing.py`, `press.py`, `static/editor.js` | Found by the verification:<br>• `pages_with_repeats` under-reports after a take (an older path);<br>• the "moved here" reason is lost when a save ends mid-move;<br>• the wording misleads after an undo and a source save;<br>• the source is not marked after a kill until it is reopened;<br>• the page picker defaults to page 1 | Each page that needs saving stays "to save", so the press files are never offered as current |
| MOVE-10 | `package.json` `ci` | The local `pnpm run ci` does not run `test:desk` (the CI workflow's `desk` job does) | CI runs them; run `pnpm run test:desk` by hand meanwhile |

## Desk: noticed while checking L1-2 (not caused by it)

| # | Where | What | Why it can wait |
|---|---|---|---|
| DESK-7 | `engine/deskedit.py` Update text | The first Update text in a layout writes `edit-articles.json` even when nothing changed (the edition's articles have `is_brief`/`words` keys the run lacks), so a save refused for a lock is not entirely write-free | PDFs, page edit files and status stay unchanged |
| DESK-8 | `edit-service.log` in the Desk home | Every engine refusal writes a traceback that includes the headline | The log is in the private Desk home, never in the repository; trim it before the hosted engine (L2.3) |

## Desk tests in CI (`.github/workflows/ci.yml` job `desk`)

From the feature's code review and its independent verification, 2026-10-22.

| # | What | Why it can wait |
|---|---|---|
| CI-1 | `setup-uv` has no pinned `version` in the `desk` and `oracle` jobs; uv is the tool that checks the hashes | The hashes are still checked |
| CI-2 | No `timeout-minutes` on the job: a hang would run for 6 hours | Rare; costs runner time only |
| CI-3 | `actions/checkout` keeps the (read-only) token in `.git/config`; set `persist-credentials: false` in every job | The token is read-only |
| CI-4 | The setup-uv cache key may be shared between `desk` and `oracle` (the default glob does not match the lock files); set `cache-suffix` or `cache-dependency-glob` | Correctness is unaffected |
| CI-5 | `docs/DEVELOPMENT.md` step 4 runs `uv venv` on a venv most developers already have; say "if it does not exist yet" or use `--clear` | Wording |
| CI-6 | The pin check (`grep -oE '^[a-z0-9._-]+=='…`) misses an extra package whose name has capitals; add `-i`, or compare `uv pip freeze` with `requirements.txt` after the install | Needs a hand edit of the lock, and the package must still match its hash |
| CI-7 | Add "pageinator desk tests" to the required checks in branch protection (a repository setting) | Settings, not code |
| CI-8 | Say in the README that pypdfium2 4.30.1 is yanked but deliberately pinned (frozen evidence), so the uv warning in the log is expected | Wording |
| CI-9 | The 3 ColorSync tests run only on macOS; the fake engine is still not a shared fixture (the rest of PR 3) | Covered on macOS |
| CI-10 | Python licences for the L2.2 review: the macOS pikepdf wheel bundles GnuTLS, GMP, Nettle and other LGPL libraries without their licence texts; pypdfium2 carries `LicenseRef-PdfiumThirdParty`; the engine environment has MPL-2.0 packages (certifi, hypothesis, pathspec) | The Desk runs locally; reviewed before the hosted engine (L2.2) |

## Desk: Marathi labels (L1-5a, `tools/desk/static/strings.js`, `app.js`, `index.html`)

| # | Where | What | Why it can wait |
|---|---|---|---|
| MR-1 | `index.html` noscript, `strings.js` `api.unreadable` | "पान" is used for the web page, while everywhere else it means a newspaper page; use another word (for example "स्क्रीन") | Wording; the native editor reviews every entry |
| MR-2 | `strings.js` `arts.placement`, `arts.placementAt` | "…मांडणीतील पाने दाखवली आहेत" says pages are shown, not where each article went | Wording; on the REVIEW list |
| MR-3 | `strings.js` `paste.byline` | Marked GLOSSARY, but the glossary's term for byline is "वार्ताहर नाव"; "वार्ताहर:" is the marker the server reads, so it belongs on the REVIEW list | Bookkeeping only; the marker itself is right |
| MR-4 | `strings.js` `count.article`, `count.story` | Both are "बातमी": the needs panel's stories (not short items) and all articles read the same in Marathi | The panel labels them separately (बातम्या / छोट्या बातम्या) |
| MR-5 | `app.js` `changeLang` | A switch made in another tab re-renders this tab, but a dialog open here keeps its old language until it is opened again | Rare; nothing typed is lost |
| MR-6 | `app.js` search box | Its pending search is flushed only by `changeLang`; any other full redraw within its 150 ms pause still works from the old query | The next keystroke or redraw catches up |
| MR-7 | `strings.js` `run.engineSetup` | Wraps the server's English reason in a Marathi sentence without marking the reason `lang="en"` | Screen-reader voice only |
| MR-8 | `app.js` `langFor` | A message with any Devanagari is marked `mr` as a whole, also when most of it is English (a server reason quoting a headline) | Screen-reader voice only |
| MR-9 | `strings.js` English entries | Small English changes came with the catalogue: "A paper of 8 pages", "it/its" in one-item forms, "Ad spaces filled: 2 of 3", "1 ad space of 3 has no image" | Better English; nothing else depends on it |
| MR-10 | `app.js` Word import note | Repeated problem lines are no longer merged when they are the Desk's own (each is a function now) | Only when the same file is chosen twice |
| MR-11 | `index.html` | Static labels are empty until `app.js` runs (a moment on the local server) | No flash of a wrong language; the noscript text is bilingual |
| MR-12 | `test/` | No test redraws the real DOM (switch, typed input kept); that is checked only by the browser runs of the builder and the verifier | The catalogue and paste parsing have `node:test` tests |
| MR-13 | `app.js` toasts, live announcer | A toast or an announcement made just before a switch stays in the old language | They vanish within seconds |
| MR-14 | `app.js` ad upload | An upload error shown on an ad card disappears when the language changes (the step is drawn again) | Upload again to see it |
| MR-15 | server and engine messages | Done in L1-5c for the messages staff meet: they carry codes, and the Marathi screens say them in Marathi. What is still English is listed under "Desk: the server's and the engine's messages (L1-5c)" | See that list |
| MR-16 | `strings.js` `arts.deleteMessage` | "with its photo" also when the article has none | Wording |
| MR-17 | paste dialog | An error from an earlier paste stays until the next submit or reopening | Wording of state, nothing lost |
| MR-18 | `strings.js` `res.pagePdf` | Gives "पान 1 · पहिले ची PDF": the postposition after the role reads badly | Wording; on the REVIEW list |
| MR-19 | `static/editor.js` | After a switch made in another tab, the editor draws again in the new language its notice, busy note, save state, story panel lines, panels, menu, title and labels. What stays in the old language: a refusal said by a menu item (worked out when the menu opened) and the live-region announcements already read | They are gone within seconds |
| MR-20 | `static/editor.js` rulers | The rulers' unit is drawn as "mm" (9 px, on the canvas) in both languages | A unit symbol on a measuring scale; Devanagari would not fit at that size |
| MR-21 | `static/editor.html` | No language switch in the editor's header: at 1280 px the Marathi header has no room; the editor follows the main screen's choice | The main screen is one click away (← डेस्क) |
| MR-22 | `static/editor.js` refusals | Done in L1-5c: the engine's refusals ("there is no free place on page 4 …", the locks) show in Marathi | — |
| MR-23 | `static/editor.js` `notice()` | On the English screen a notice that names a Marathi headline is marked `lang="mr"` as a whole | Screen-reader voice only |
| MR-24 | `strings.js` `pe.alsoOn` | The plural follows the number of stories, not of pages ("…on page 2, 3 too") | Wording |
| MR-25 | `strings.js` `pe.fitHeight` | "Fit height to text" now reads "मजकुराइतकी उंची करा"; the English stays | Wording; on the REVIEW list |
| MR-26 | `static/editor.js` | Code for a `#lang-switch` in the editor is wired although the editor has no switch (MR-21) | Harmless; ready for a switch if one fits later |
| MR-27 | `static/editor.js` drag label | `getComputedStyle(document.body)` is read on every drag frame for the label's font | A drag is short; cache it if profiling shows it |
| MR-28 | `strings.js` `pe.articlesLeft` | "article" is translated "बातमी", as everywhere else, though here it means an article inside a story | Wording; on the REVIEW list |
| MR-29 | `strings.js` `pe.*` | "{Name} ला" leaves a space before the postposition; sentences use the feminine ती/तिला also for "छोट्या बातम्यांचा स्तंभ" (masculine) | Grammar; on the REVIEW list |
| MR-30 | `strings.js` `pe.refresh` | "मजकूर अद्ययावत" is a noun phrase where the other buttons are verbs (shortened to fit the header) | Wording; on the REVIEW list |
| MR-31 | `strings.js` `date.time` | Times are always 24-hour ("14:05") | A clear, fixed format for both languages |
| MR-32 | `strings.js` `t()` | Numbers use Indian grouping (1,23,456) in both languages | The paper's own convention |
| MR-33 | `static/editor.js` `problemMsg` | A problem kind the editor does not know is shown by its engine name (English) | The engine has no other kinds today |
| MR-34 | `strings.js` `pe.pTouchMany` | The list of headlines (Marathi) and its "आणि"/"and" are one span, marked by its first script | Screen-reader voice only |
| MR-35 | `static/editor.css`, `static/app.css` | system-ui comes before the Devanagari faces, so Latin letters and digits keep the system face; on a system whose UI face has Devanagari, that face is used | As the design system orders them (§3.3) |
| MR-36 | `static/editor.js` rulers | The corner of the rulers says "mm" in both languages (see MR-20) | A unit symbol at 9 px |
| MR-37 | `static/editor.html` header | At 1280 px the edition and layout in the header are cut short (their tooltip has them); pre-existing, as VIEW-9 | Cosmetic |
| MR-38 | server, engine | Done in L1-5c: `MOVED_HERE` and the move refusals have codes and show in Marathi | — |

## Desk: the server's and the engine's messages (L1-5c, `engine/messages.json`)

142 messages have codes and show in Marathi: the engine's refusals (moves, locks, crops, another layout), the save and
press reasons, `MOVED_HERE`, the layout warnings and not-placed reasons, the run's progress and end, and the server's
article, edition, paste, Word, picture and move checks. A refused move gives the page its earlier reason back with its
code (fixed after the verification's MINOR-1). These are still English on the Marathi screen, or small gaps left:

| # | Where | What | Why it can wait |
|---|---|---|---|
| MSG-1 | `deskserver/api.py` | About 30 checks of a request's form ("rev must be a whole number.", "Say which page …" outside a move, upload content types, a body that is not JSON) | The screens never send such requests |
| MSG-2 | `deskserver/util.py` | "There is no such {what}.", "The {field} must be text.", "The {field} is too long (…)", "The file … is damaged" (`{what}`/`{field}` are English words: they need their own codes) | Rare: the screens limit the text boxes |
| MSG-3 | `deskserver/store.py`, `images.py`, `editing.py` | Internal and damaged-file errors (no such edition, run, picture or font; a damaged articles file or index; a conversion that did not give CMYK) | They need the owner's help, not a translation |
| MSG-4 | `deskserver/api.py` `/api/status`, `engine_client.py` | The engine status panel's message (engine, setup, colour profile) and "The layout engine is missing (…)" | Seen once, at setup |
| MSG-5 | `deskserver/docx.py` | The Word import's notes (more than 200 stories, empty headings, formatting not kept) and a damaged-file refusal | Word import shows them in a list the owner reads once |
| MSG-6 | `deskserver/jobs.py`, `engine/desk_engine.py` | A crash of the engine ("The layout engine was stopped (signal …)", "stopped with an error …", its last output), `error_text()` of an unexpected error, `setup`/`samples` errors | Faults, not news work; their English helps the owner report them |
| MSG-7 | `engine/deskworker.py`, `deskgen.py` | The worker's texts other than the seven it recognises (`desk_engine.WORKER_TEXTS`), shown as they come | Part of the measurement cache's key: they stay as they are |
| MSG-8 | `deskserver/measure.py` | Background measuring's errors | Logged, rarely shown |
| MSG-9 | `test/test_server.py` (`test_messages_carry_their_codes_for_the_screens`) | The locked-story refusal accepts `"data"` as well as `m.edit.lockedMove`, so the engine → server path (`m.save.notChanged` wrapping an `m.edit.*` code) is not tested end to end: make the fake engine send `msgs`, or unit-test `EditService._call` | `test_engine.py` tests the engine's side and `test_messages.py` the wrapping; only the join is untested |
| MSG-10 | `static/strings.js` `tmn()` | Never used: a headline or file name inside a translated message is not given its own `lang` (the whole text takes the screen's) | The Devanagari and Latin text still render with the right fonts; only a screen reader's language is affected |
| MSG-11 | `engine/desk_engine.py` (error answer, `str(e).strip("'")`) | A KeyError's quotes are stripped before comparing, so `m.edit.unknownCommand` (its `{cmd!r}` quotes) and `m.edit.moveNoPage` with a page that is not a whole number fall back to `m.edit.invalid`'s code: the English stays right, the Marathi says "not valid" | The screens never send an unknown command or a non-number page |
| MSG-12 | `deskserver/api.py:442` | A move that failed part-way ("… Page {to} stays marked “needs saving” until it is saved …") is an f-string, English on the Marathi screen | Only when the engine stops in the middle of a move |
| MSG-13 | `status.json` of runs made before L1-5c | No `msgs` map: their reasons and warnings show in English on the Marathi screen until the edition is laid out again or the page saved | Older scratch runs only; document in CONTRACT.md when the format is next touched |
| MSG-14 | `engine/deskmsg.py` `annotate()` | Changes the document it is given (adds or drops `"msgs"`) as well as returning it | Every caller writes or sends the document right after; no caller reuses it |
| MSG-15 | `deskedit.py`, `deskserver/*` | English words inside a message's params are sent as data: the field names of `m.edit.missing`, "column"/"columns" of `m.edit.moveCannotSet`/`moveNoRoom`, `{what}` of `m.warn.charRemoved`, the reasons of `m.store.wordNone` | Each needs its own code; the sentence around them is Marathi |
| MSG-16 | `static/strings.js` (Marathi of `m.save.notPlacedEdited`, `m.warn.notFill`/`m.run.notFillExactly`, `m.name.shortColumn`) | Wording to settle in the native review: `notPlacedEdited` is long, the two "do not fill" texts should match, and the short-items column takes a feminine ती in some sentences | First draft for native review (D-5) anyway |
| MSG-17 | `static/strings.js` (numbers in messages) | Numbers are shown as the server formats them (e.g. 3700), not with Indian digit grouping (3,700 / 37,00,000) | The numbers in messages are small (pages, lines, cm², mm) |
| MSG-18 | `engine/deskedit.py` | A local named `data` in some functions shadows the imported `data()` helper (the server modules call it as `M.data` for this reason) | No function both shadows and calls it today; rename when next edited |
| MSG-19 | `engine/desk_engine.py` (CLI output), `Built.skipped` | The engine's command-line output and `Built.skipped` are not annotated with `msgs` | The server builds its answers from them with `annotate`; the CLI is for the developer |
| MSG-20 | `static/app.js` `said()`, `static/editor.js` `fromServer()` | No unit test that the screens pass the answer's `msgs` (the browser checks of phase G cover them) | Covered end to end by the browser check |
| MSG-21 | screens, Marathi | Still English inside Marathi sentences: a Python float error inside `m.edit.engineFailed`, a file error's own text inside `m.save.filesNotFinished` and `m.run.notMerged`, the Word import's refusals (MSG-5) | Faults or rare refusals |
| MSG-22 | `static/strings.js` `tm()` | A wire with `"params": null` leaves its placeholder in the Marathi text (the server always sends an object) | The server never sends `null` |
| MSG-23 | `static/app.js` (run screen) | The run's end message ("4 pages made." with failures and check problems) is in `status.message` with its code, but the run screen shows the server's message only while the run is going (`patchRun`: none once it has ended) | The page cards and the check results say the same, in Marathi |

## Desk: Pageinator story bundles (PR 24, the Desk side; `deskserver/bundle.py`, CONTRACT.md §6)

The review's minor findings, left for later. Each says where, and why it can wait.

| # | Where | What | Why it can wait |
|---|---|---|---|
| BUNDLE-1 | `bundle.py` `open_bundle` | JSON amplification: a 32 MB `bundle.json` of `{},` parses to about 926 MB of Python objects | The file comes from the paper's own hosted product, downloaded by the owner; lower `MAX_JSON` or count values while parsing when the API side's real sizes are known |
| BUNDLE-2 | CONTRACT.md §6 | Spec details to state: the exact language-tag pattern; the 64-character `created` limit; a UTF-8 BOM (refused today as unreadable JSON); duplicate JSON keys (the last wins today); "characters" meaning code points after NFC; the per-field length limits (§1's) and the photo rules (§4's) written out in §6 | The API side is built to §6 next: settle these with it |
| BUNDLE-3 | `bundle.py` `_commit` | `section` and `photo_filename` are stored as sent, not cleaned (`clean_text`) | Never printed or shown yet |
| BUNDLE-4 | `bundle.py` `_commit` (failure path) | The rollback writes `photos/index.json` (empty) when there was none before | Harmless: an empty index reads as no photos |
| BUNDLE-5 | `bundle.py` `_is_date` | Uses `\d`, which also matches non-ASCII digits (then `date.fromisoformat` refuses them) | Refused either way |
| BUNDLE-6 | `bundle.py` `parse` | `revision` has no upper bound (a JSON number beyond 2^53 − 1 loses precision in JavaScript) | The hosted product counts from 1 |
| BUNDLE-7 | `test/test_bundle.py` | Paths not tested: a page-pin edit, a photo removed or replaced in the Desk leading to "kept"; two stories naming one photo; the 409 "import again" retry; a failure part-way through linking photos; a replaced photo on a laid-out page; the real engine laying out articles that carry the `bundle` key | The rules are shared with tested paths; add as the API side's fixtures arrive |
| BUNDLE-8 | `store.py` `update_article` | An article PUT carries no revision check, so two windows can overwrite each other's edit (an existing pattern, not the bundle's) | As today for typed articles |
| BUNDLE-9 | `bundle.py` `parse` | The same SHA-256 named as both `.jpg` and `.jpeg` is two files in the ZIP for one photo | Both are checked and refer to the same bytes |
| BUNDLE-10 | `bundle.py` `parse` | Story ids that differ only in case (`St-1`, `st-1`) are two stories | The hosted product's ids are UUIDs |
| BUNDLE-11 | `package.json` `test:desk` | Needs the two Python environments set up first (environment only) | CI sets them up; `docs/DEVELOPMENT.md` says how |

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
| L2-54 | `app.idempotency_key` | Expired keys need a system reader to clean them up (plan §3.2's named flags); another user's UPDATE or DELETE of a row is refused by the user wall but untested at the SQL level (a replay's access is re-checked since PR 17, tested) | Each request deletes its own expired key; rows are small |
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
| L2-91 | plan §4.4 wording (verification) | Accept and the public lookup work before two-step (they are not organisation routes): say so in the plan | Neither gives access to an organisation's data |
| L2-92 | `/orgs/:o/pubs/:p` routes (verification) | The 404 for an unreachable publication was checked only on probe routes: re-check when the content routes land (PR 17) | `decide()` checks it for every route with `:p` |
| L2-93 | GET `/api/v1/invitations/:id` | Its 20-an-hour limit is per process (memory) | One API process in the pilot |
| L2-94 | `src/modules/stories` | Each save of a story's text is a revision of its own, so autosave makes many: fold a person's saves into the open revision behind a save counter (a lost-update check finer than `baseRevision`) | Correct and safe as is; rows are small |
| L2-95 | `src/db/stories.ts` list `q` | Search is `ilike` over the current revision's headline, byline and body, with no index (`search_text` with pg_trgm, plan §3.3) | Pilot publications have few thousand stories |
| L2-96 | `src/modules/stories/rules.ts` | The ◐ cells' readings (Photo Editor sees all stories read-only; Advertising none; Page Designer reads only; an assignee counts as the author) are the build's choice: confirm with the owner | Each is the narrower reading where §12 is unclear, or plain from the plan |
| L2-97 | `src/modules/stories/routes.ts` transitions | Filed and send-back notify nobody yet; comments other than a send-back's cannot be written yet | Notifications and comments are PR 19 |
| L2-98 | `src/modules/stories/routes.ts` assignee | A due time in the past is accepted. (Assigning is audited since the L2.1 audit API: `story.assign`, `story.unassign`, `story.due_change`, test `test/db/audit-writes.test.ts` "assign, a due time, and unassign") | No rule says due times are future |
| L2-99 | `src/db/idempotency.ts` | A request holds its key's row lock for as long as it runs, and a second request with the key waits up to 3 seconds before 409 `request_in_progress`: requests are bounded by the API's 120-second limit and paste's 200 stories, but a slow database could make the second wait the whole 3 seconds often | The work and its stored answer commit together, so a request never runs twice (since the L2-F review) |
| L2-100 | `src/modules/stories/routes.ts` transitions | Some moves the role never makes answer 409 `invalid_transition` instead of 403: the desk filing someone's Draft (§5.4 gives Filed to the author only) | Nothing moves; the answer says it cannot be done |
| L2-101 | `src/modules/requests/idempotency.ts` | A key row that vanished between the claim and its read (a race with expiry) answers 422 instead of 409 | Expiry is 24 hours |
| L2-102 | `src/db/stories.ts` `restoreTarget` | Restore can return a story to Placed, a state only hosted layout should set | Placed exists from L2.3 only |
| L2-103 | `src/modules/stories/store.ts` | A page pin is accepted on a story with no edition (it is checked only against an edition's pages) | It means "this page" once an edition is chosen |
| L2-104 | `test/db/stories.test.ts` tenancy (c) | Covers the ids in paths only, not ids in bodies (sectionId, editionId, assignee): those are checked by their own tests | Each body id is checked against the publication by the service |
| L2-105 | `test/db/stories.test.ts` | The delete and list tests assert less than their names say (the list's filters are each tried once; the delete test does not try every role) | The role matrix covers delete for every role |
| L2-106 | `src/modules/stories/rules.ts` | §5.4's "the author" is the reporter or the assignee, but `canDelete` lets only the reporter delete a Draft | Deleting is rarer than editing; the desk can delete |
| L2-107 | `src/modules/stories/routes.ts` | Restoring a spiked story when the role cannot gives the generic "not allowed" text, not one about spiking | The code is right (403); only the wording |
| L2-108 | `src/modules/stories/routes.ts` assignee | A story can be given to an Advertising member or a Viewer of the publication, who cannot edit it | The assignee only sees it; the desk chooses |
| L2-109 | **HIGH** · photo originals (`app.asset`, plan §6.2) | Originals keep EXIF/GPS (a reporter's location); decide with the owner whether to strip GPS at upload, and strip it from every rendition/preview (L2.2) | Originals stay unchanged for the press; downloads are limited to `media.view` and the role scopes; the owner is deciding |
| L2-110 | `apps/api/scripts/dev-buckets.ts`, the work bucket | The `uploads/` lifecycle rules (expire after a day, old versions a day later, lone delete markers removed) are accepted by SeaweedFS 4.48, but no test could show they delete: add a clean-up job for uploads never completed (a system reader, L2.2), and check the rules on real S3 at staging | The API deletes every version of a completed or refused upload by its VersionId; quarantine holds only abandoned ones |
| L2-111 | `src/modules/media/picture.ts` | HEIC and AVIF are refused (422) until the worker can convert them (L2.2); whether iOS converts HEIC in the `<input>` is to verify on the newsroom's phones | Phones offer JPEG; the refusal says to save as JPEG |
| L2-113 | `src/modules/media/uploads.ts` complete | The whole object is read by the API (at most 40 MB): with many uploads at once this is memory- and time-bound in one process | Streamed, never held whole; the pilot uploads a few hundred photos a day |
| L2-114 | `src/modules/media/uploads.ts` presign, `app.upload_quota` | The quota's day is UTC (`current_date`), not the organisation's timezone: it resets at 05:30 IST. Abandoned or refused uploads are not given back | 2 GB a day is far above the pilot's use; a day's late reset costs nothing |
| L2-115 | `src/modules/media/uploads.ts` complete | CopyObject runs inside the transaction that holds the upload's row lock (a slow store holds a database connection) | One copy of at most 40 MB, on the same store; few uploads at once |
| L2-116 | `src/modules/media/uploads.ts` complete, deduplication | A Reporter learns that the same bytes were uploaded before (they get the existing asset) | Accepted: per publication only, and they had the bytes |
| L2-117 | the S3 staging check (plan §6.5) | SeaweedFS accepts form fields the policy does not list, and `success_action_redirect`, which S3 refuses: check the POST policy on real S3 at staging | The fields the API relies on are pinned and enforced |
| L2-118 | `src/modules/media/uploads.ts` presign | An idempotent replay of a presign hands out the policy again after the upload is completed | The upload is completed: complete answers its asset, and a later file only waits in quarantine for the lifecycle rules |
| L2-119 | `src/modules/media/uploads.ts` `readAll` | `file_too_large` at complete neither rejects the upload nor removes the object | The policy pins the exact size: such an object cannot come through the POST |
| L2-120 | `src/modules/media` downloads | No `X-Content-Type-Options: nosniff` on the store's responses, and no check for trailing data or polyglot files; the L2.2 worker must limit animated frames and progressive scans. As built in W1: junk before the picture is refused; trailing data (a JPEG with a ZIP, a PNG with HTML) is accepted as the Desk accepts it and reaches only the original, never a rendition | The type is set from the sniffed bytes and the file is an attachment |
| L2-121 | `test/db/media.test.ts` downloads | The download test does not assert that the link's `versionId` is the asset's `version_id` | The redirect is built from `version_id`, and the bytes are checked |
| L2-122 | `src/modules/media/picture.ts` | The HEIC brands `heif` and `hevx` are not named: such a file is refused as "not a JPEG, PNG or WebP" rather than as HEIC | It is refused all the same; only the advice differs |
| L2-123 | `src/modules/media/picture.ts` | EXIF Orientation is ignored for width and height, while the Desk applies `exif_transpose`: a portrait photo is stored as landscape (matters for L2.2 renditions and layout) | Nothing lays out photos from these sizes before L2.2 |
| L2-124 | `apps/web` `TwoStepScreen` | When `/me` fails after the code is accepted, the screen has no handling for it | Found in the L2-G review; the server has accepted the code either way |
| L2-125 | `apps/web` invitations | The text for "too many pending invitations" is wrong | The API's refusal is right; only the wording |
| L2-126 | `apps/web` Join screen | The advice is the same for 403 and 409 | Only the advice; the API's answers differ |
| L2-127 | `apps/api` people routes | The people routes do not honour `Idempotency-Key` yet | Found in the L2-G review; to do with the next people-route change |
| L2-128 | `apps/api` Better Auth `list-sessions` | It sends every session's token to the browser: strip the tokens on the server and revoke sessions by id | Only the person's own sessions, to the person signed in |
| L2-129 | `apps/web` two-step enrolment | `ACCOUNT_TEMPORARILY_LOCKED` during enrolment shows a generic message | The lock holds; only the wording |
| L2-130 | `apps/web` device list | A malformed date crashes the device list | Found in the L2-G review; the API sends ISO dates |
| L2-131 | `apps/web` tests | The tests of the built page and of the QR code are weak | Found in the L2-G review |
| L2-132 | `apps/web` tests | No test shows that secrets (the TOTP secret, backup codes, tokens) never reach browser storage or the URL | The web writes only the workspace choice and the language to `localStorage` (as of L2-G) |
| L2-133 | `apps/web` `QrCode` | The QR colours come from theme tokens: draw it dark on light whatever the theme, so every scanner reads it | The page shows the same secret as text beside it |
| L2-134 | `apps/web` Marathi | AM/PM in times is not given in Marathi | Only the marker |
| L2-135 | `apps/web` language | Texts made at the time of an action keep the old language after a switch | Only texts already on the screen |
| L2-136 | `apps/api` sign-in rate limit | The sign-in limit is per IP: a newsroom behind one shared NAT shares it | The per-address limits still apply |
| L2-137 | `src/modules/notifications/notify.ts` emails | A notification's email is sent from the request once its change commits: a crash in between loses it (no outbox, no retry), and `emailed_at` records that it was handed to the mailer, not delivered | The in-app notification is written with the change; the mailer logs a failure |
| L2-138 | `app.story` trigger `notify_story` | Every change of a story, each autosave included, sends a live `story` event to everyone who sees it: chatty while someone types; coalesce per story (or skip text-only autosaves) when the desk grows | Ids only; the web debounces its re-fetch |
| L2-139 | `src/modules/notifications/routes.ts` streams | Each open stream re-checks its person every 25 s with three queries; with many streams this is steady load | At most 5 streams a person; the pilot's desk is small |
| L2-140 | `src/http/rate-limit.ts`, `events.ts` | The budgets and the stream hub are in one process's memory: a second API instance needs a shared store for the limits (LISTEN already reaches every instance) | One API instance in the pilot (plan §4.6) |
| L2-141 | comments | A comment cannot be deleted yet (`deleted_at` exists, no route), and mentions come with L2.2 | Its author can change its text; edits are audited |
| L2-142 | `src/modules/notifications/emails.ts` | The send-back email links to the publication's stories list, not to the story: the web has no story route yet | The list shows the story as Draft at its top |
| L2-143 | `GET /orgs/{o}/events`, notifications | A member with no role on any publication gets 403 (permission `publication.view`) for notifications and live updates | Every invitation names publications; Owner and Admin reach all |
| L2-144 | `src/modules/notifications/routes.ts` | A stream re-checks its person every 25 s: a removed member or a signed-out session still hears for up to that long; re-check on member-change and sign-out events | Ids only; every fetch they make is checked |
| L2-145 | notifications | No cap on notification spam: many comments on one story make one notice each; coalesce per story and recipient | The pilot's desk is small |
| L2-146 | `notify.ts` invitationAccepted | The notice goes to the inviter even when they are no longer Owner or Admin (only an active member) | It names who joined, which the team list shows them anyway |
| L2-147 | `@fastify/rate-limit` memory store | Its LRU keeps 5,000 keys: a flood from rotating IPv6 addresses in one /56 can evict the counters of others | One instance, behind the pilot's proxy |
| L2-148 | `/api/auth/*` | Better Auth's routes, `get-session` included, count against the per-address signed-out budget (60 a minute): a newsroom behind one NAT shares it | The web calls them rarely; sign-in has its own limits |
| L2-149 | web autosave | `notify_story` fires on every autosave, and each autosave counts against the person's 300 a minute: the web must debounce (every 1.5 s at most) | 40 a minute leaves room |
| L2-150 | `emails.ts` sentBackEmail | The send-back comment is flattened to one line in the email | The full comment is in the story's comments |
| L2-151 | notification list | Notifications are filtered by the publications the person reaches, not by whether they still see each story: a notice of a story they no longer see is still listed | Since the L2.1 audit API its story (headline and state) is null then; the kind, ids and the actor's name remain, and opening it is checked |
| L2-152 | tests | Untested so far: a freed stream slot after a 429; `bad_origin` carrying no-store over real HTTP; the English-first order of an email; an insert of a notification refused by the walls | The code paths are shared with tested ones |
| L2-153 | comments | Done in the L2.1 audit API: creating a comment is audited (`comment.create`), test `test/db/audit-writes.test.ts` "comments: written, edited, resolved and reopened" | — |
| L2-154 | `routes.ts` heartbeats | Each heartbeat checks every stream on its own: O(n) queries every 25 s | At most 5 streams a person |
| L2-155 | LISTEN hints | Anyone who can send NOTIFY on app_events (pgn_app, any connection to the database) can send well-formed hints: they carry only ids, and each is checked against the reader's access, but they can ping or flood streams | Only the API's roles reach the database |
| L2-156 | `routes.ts` backpressure | A burst of more than 256 KiB of events in one tick (a huge forged flood) ends even streams that read, because they cannot drain within the tick | The browser reconnects and gets `resync` |
| L2-157 | `events.ts` confirm | For a Reporter, a story given away from them is no longer confirmed as theirs, so they hear nothing of it leaving; their list catches up on its next fetch | Ids only; the list is refetched on resync and navigation |
| L2-158 | `apps/web` story editor | Clearing an existing headline shows "Save failed" (the API refuses an empty headline) rather than saying a headline is needed | Found in the L2-H review |
| L2-159 | `apps/web` story editor drafts | Drafts kept from an expired session never expire: they need an age limit | Found in the L2-H review |
| L2-160 | `apps/web` story editor | Assigning a story while an autosave is in flight can conflict with the person's own save (409 story_changed) | Found in the L2-H review |
| L2-161 | `apps/web` story editor | `lang` is missing on a new story's text boxes and on the desk note | Found in the L2-H review |
| L2-162 | `apps/web` story editor | The save status is announced to screen readers every 1.5 s | Found in the L2-H review |
| L2-163 | `apps/web` send-back dialog | The send-back textarea's CSS | Found in the L2-H review |
| L2-164 | `apps/web` Stories list | The chips for Held and Spiked lack contrast | Found in the L2-H review |
| L2-165 | `apps/web` breadcrumbs | The breadcrumb for an Advertising member | Found in the L2-H review |
| L2-166 | `apps/web` story editor drafts | `readDraft` does not validate what it reads back from storage | Found in the L2-H review |
| L2-167 | `apps/web` word counts | The web's word count and the API's differ | The API's count (the Desk's own, @pageinator/desk-text) is the one stored |
| L2-168 | `apps/web` story editor drafts | Killing the whole browser within about 8 s of typing loses the latest draft | Found in the L2-H review |
| L2-169 | `apps/web` Stories list | An edited story can disappear between "Show more" clicks (the cursor moves with updated_at) | Found in the L2-H review |
| L2-170 | `apps/web` paste dialog | The paste dialog scrolls sideways at 320 px | Found in the L2-H review |
| L2-171 | `apps/web` story editor | The page pin offers 1–16 whatever pages the edition has | The API refuses a pin past the edition's last page |
| L2-172 | `src/modules/stories/desk-bundle.ts` | A photo's `filename` in the bundle is its Desk id (`p-….png`), not the name it was uploaded with, which the API does not keep | Deliberate: uploaders' file names can carry personal details; the Desk shows the caption |
| L2-173 | `app.desk_bundle` | A streamed bundle is recorded without its ZIP's SHA-256 (it is known only once sent) and without an object key | Its revisions are recorded exactly, and bundle.json carries every photo's SHA-256 |
| L2-174 | `POST …/desk-bundle` | No Idempotency-Key: a retry records another bundle of the same revisions | Importing either changes nothing more (the Desk replaces only for a higher revision) |
| L2-175 | `POST …/desk-bundle` | A bundle cut off mid-stream (a photo whose bytes do not match, the store failing) reaches the browser as a broken download, with no message | The Desk refuses it as damaged; the API logs it |
| L2-176 | **Rule** · any future path that rejects or deletes an asset (moderation, takedown, the L2.2 worker) | It **must bump `story.version` on every story whose `story_photo` names that asset**, in the same transaction, so the story's next bundle carries a higher revision and the Desk replaces it (CONTRACT.md §6). Without it, a re-export at the same revision leaves the Desk printing the old photo | Until then the bundle refuses such a story (409 bundle_refused, naming it): the PR 24 review's B1 |
| L2-177 | `POST …/desk-bundle` statuses | Spiked stories are never sent (400); Held and Draft are sent when asked for explicitly: an **owner decision to confirm** | Ready only by default |
| L2-178 | story editor (web and API) | A subheading that starts with `#` (`## #MeToo …`) cannot go into a bundle: the export refuses it (409, naming the story); warn at save time instead | The refusal names the story and says what to change |
| L2-179 | `POST …/desk-bundle` (review minor 6) | The bundle and its audit row are committed before any byte is sent: a download cut off by a SHA-256 mismatch, a store error or a disconnect is still recorded as a bundle (add a completed time on finish) | The record names exactly what would have been sent |
| L2-180 | bundle revisions (review minor 8; verification 3b) | `story.version` also moves on changes the bundle does not carry (state, assignee, desk note, due time): the Desk then reports such a story "replaced" and a laid-out page "needs saving" for nothing | The contract allows it; nothing printed changes |
| L2-181 | bundle `section` (review minor 9) | `section` is the section's current name: a rename (no route yet) would change it without a higher revision | No rename route; the Desk keeps the section only in its bundle record |
| L2-182 | `writeZip` (review minor 12) | A 32 MiB `bundle.json` is pushed into the ZIP in one synchronous call (its CRC), blocking the event loop for a moment | Bundles of a day's stories are far smaller |
| L2-183 | `deskText` (review minor 13) | Writing `##X` as `## X` can push a body near 200,000 characters over the Desk's limit, so the Desk refuses that story | One character per subheading |
| L2-184 | `POST …/desk-bundle` (review minor 14) | No cap on concurrent bundle streams per person: each may hold up to 32 MiB of JSON and read 200 MB from the store | `desk.export` is the Chief Editor's and the Editor's only |
| L2-185 | web download (review minor 17) | The route is a POST with `X-Pageinator`, so the web must use fetch and a blob: the browser holds the whole ZIP (up to 200 MB); the streaming helps only the server | A day's bundle is a few MB |
| L2-186 | `POST …/desk-bundle` (review minor 18) | The route needs a JSON body: a POST with none gets 400, so the web must send `{}` | Documented for PR 23 and the web builder |
| L2-190 | `apps/api` `storage/s3.ts` `presignGet` | The presigned download sets no `ResponseCacheControl: no-store`, so the picture may stay in the browser's cache, and the presigned link shows in the download list on a shared computer: set `no-store` on the link's response | The link lasts five minutes, the API's own 302 is `no-store`, and the web fetches the original with `cache: "no-store"` and keeps it in memory only (L2-J) |
| L2-191 | deploy (Caddy), the web's Content Security Policy | The CSP being added must allow the bucket's origin in `connect-src` (the presigned POST and the original's link) and `blob:` in `img-src` (the original shown from memory); the bucket needs a CORS rule for the app's origin (POST and GET) | No CSP is set yet; SeaweedFS in development allows every origin |
| L2-200 | `apps/engine-worker/requirements.lock` | pypdfium2 4.30.1 is yanked on PyPI (a PDFium text-extraction regression): inherited from the frozen `experiments/phase0/pdfx1` pins, so changing it needs an evidence-change decision | The worker does not extract text; the pin is what the press-tested Desk runs |
| L2-201 | SeaweedFS (development store) | A PUT to a missing bucket creates the bucket (S3 refuses it) | Development only; the worker never names a bucket other than its setting |
| L2-202 | `pgn_worker/storage_s3.py` `delete` | A DELETE of a version that does not exist succeeds silently (as S3 answers) | The worker deletes only versions it wrote |
| L2-203 | `infra/docker/check_image_files.py` | The file check reads the image's final filesystem (`docker export`): files in deleted layers and in VOLUME paths are not scanned (`docker save` would show the layers) | Every layer comes from this Dockerfile and the pinned base; the homes volume is empty in the image |
| L2-204 | `infra/docker/engine-worker.Dockerfile` | The base image has no vulnerability scan and no schedule to refresh its pinned digest | The digest is pinned, and the image runs as a non-root user with a read-only root |
| L2-205 | `pgn_worker/storage_s3.py` settings | `https://169.254.169.254` and private https endpoints are accepted as `PGN_S3_ENDPOINT` (an operator's setting, the same as the API's rule) | Only the operator sets it |
| L2-206 | `pgn_worker/storage_s3.py`, `apps/api/src/config.ts` | The bucket pattern allows names AWS forbids (two hyphens next to each other, an IP-like name) | The store refuses them; the setting is the operator's |
| L2-207 | `infra/docker/engine-worker.Dockerfile` | Docker warns `FromPlatformFlagConstDisallowed` (the `FROM --platform=linux/amd64` constant) | Intended: the image is amd64 only, matching the licence inventory |
| L2-210 | audit log, writers | Done in the L2.1 audit API: every change of the story and photo desk is written to `audit_event` in its change's transaction (docs/product/10-l2-newsroom-plan.md §5.2, "What is recorded"), with ids and numbers only. Tests: `test/db/audit-writes.test.ts` (one per action family; "holds no text a person typed"; "a refused change, a stale one, and a move the story cannot make write no success event"; "a replayed request … writes its events once") and `test/unit/audit-actions.test.ts` | — |
| L2-211 | audit log, writers | Done in the L2.1 audit API: every audited write of a request records its address and browser (`Tenant.client`, the same source as refusals). Tests: `test/db/audit-writes.test.ts` "the people's events record the address and browser" and the story, comment and upload tests there | — |
| L2-212 | `GET /orgs/{o}/audit` | No total count and no CSV export (L2.2). An `action` filter must name an action of `AUDIT_ACTIONS` (or a prefix of one): a retired action's old rows are then found only without that filter | The catalogue keeps every action written so far |
| L2-213 | audit log, people | Narrowed in the audit fix pass: `member.update`, `member.remove`, `invitation.create` and `invitation.accept` are written in the transaction of their grants and directory row, and the membership or role (Better Auth's, on the auth pool) changes last, just before it commits; a failure before leaves nothing changed (test `test/db/audit-writes.test.ts` "an event that cannot be written leaves …"). What remains: the auth pool's change commits on its own, so a failed commit right after it leaves the membership change without its event; `invitation.cancel`, `invitation.resend` and `invitation.membership_repaired` change only identity and write their event in a transaction of their own after it; and a grants-only PATCH racing a removal in that same moment can leave grants for the removed person (they reach nothing without a membership) | The windows are one commit wide |
| L2-214 | audit log, people | A person's own name change (PATCH `/me`, copied into every organisation's directory) is not audited | The directory shows the name; the event would hold no text anyway |
| L2-215 | `POST /invitations/{id}/accept` | A refused accept is audited (`access.denied`, target the invitation) in the invitation's organisation; one naming an id no invitation has is not audited anywhere, as no organisation's log can hold it | It answers 404 and changes nothing; the per-person and per-address limits bound it |
| L2-216 | `app.audit_event` read wall | The database's read wall (`pub_read_wall`) lets a transaction read the organisation's own events (no publication) whatever the reader's role; only the API's view (`src/db/audit.ts`) keeps them from a Chief Editor | The session carries the publications, not the organisation role; the API's view is tested (`test/db/audit.test.ts`, `test/tenancy/audit.test.ts`) |
| L2-249 | `apps/engine-worker` `home.py` | `photos/index.json` lists photos in article order, not in the order the Desk attached them (the same data) | The engine reads the index by id |
| L2-250 | `apps/engine-worker` `home.py` | The materialised home holds no previews or originals (by design: the engine reads only rasters) | Nothing in the engine reads them |
| L2-251 | `.github/workflows/ci.yml` `worker` | `python_inventory.py --check` (the only check that catches a hand-edited licence, a forged inventory entry or a bundled library left out) runs only in the GitHub `worker` job: make it a required check | The offline check runs everywhere and fails closed on everything else |
| L2-252 | `tools/licences/python_inventory.py` | A multi-line `License` field is cut to its first line; classifiers are ignored when an SPDX expression is present | A field that is not an SPDX expression needs a recorded reading anyway |
| L2-253 | `tools/licences/python_inventory.py` | Statically linked code is invisible: lxml's libxml2/libxslt, cryptography's OpenSSL, uharfbuzz's HarfBuzz (all permissive today) | Reviewed by hand with each upgrade until a source-level inventory exists |
| L2-254 | `tools/licences/python_inventory.py` | Only Linux x86_64 wheels are inventoried: pin the worker image's platform to it (**done in W4**: the image is linux/amd64 only; an arm64 host needs its own inventory first) | The pilot host is x86_64 (plan R1) |
| L2-255 | `.github/workflows/ci.yml` | `astral-sh/setup-uv` installs uv without a pinned version | The action itself is pinned by commit |
| L2-256 | `apps/engine-worker` `home.py` | `config=None` leaves an earlier `config.json` in the home | The engine profile is always given once L2.3 runs layouts |
| L2-257 | `apps/engine-worker` `media.py` | A `put` that fails part-way leaves some renditions; the retry writes the same keys again | Keys are fixed by the asset and the params hash, so a retry never adds a second set |
| L2-258 | `apps/engine-worker` `media.py` | `oriented_size` reads the EXIF orientation itself rather than through `exif_transpose` (they agree on every tested input) | The verification compared all eight orientations |
| L2-259 | `apps/engine-worker` `home.py` | Article fields are copied as the request gives them, without the Desk's validators | The API builds the request from cleaned story revisions |
| L2-260 | `tools/desk/deskserver/images.py` | The colour transform is cached by the profile's path, mtime and size, not its bytes | The worker checks the profile's SHA-256 before and after each conversion |
| L2-261 | plan §2.2 | The plan's wording on upload keys and `KeyGuard.check()` should say the same thing (uploads are outside the guard by design) | The code refuses them |
| L2-262 | `apps/engine-worker` `test_media.py` | `ParamsTests`' test title names fewer facts than it checks | Wording only |
| L2-263 | `apps/engine-worker` `media.py` | Animated frames and progressive scans are not limited (with L2-120) | The 100-megapixel limit and the 40 MB upload limit hold |
| L2-280 | `infra/aws` backups bucket | Dumps are encrypted with SSE-S3 (AES256); a customer-managed KMS key (SSE-KMS) would let the owner revoke or audit their decryption separately | Found in the PR 25 review |
| L2-281 | `infra/aws` backups bucket | Object Lock is GOVERNANCE in the same account: an admin with `s3:BypassGovernanceRetention` can still delete a dump. COMPLIANCE mode, or the bucket in a second account (doc 04 §7), is the owner's choice | Found in the PR 25 review |
| L2-282 | CI, `apps/api/src/db/migrations` | Nothing checks that a migration is expand/contract (no drop or rename of what the running release reads); rollbacks rely on it (`docs/runbooks/rollback.md`) | Found in the PR 25 review |
| L2-283 | RDS, `infra/docker/backup-role.sql` | That the RDS master user may give BYPASSRLS and `pg_read_all_data` is still to verify on the instance, before the first live night | `docs/runbooks/aws-setup.md` step 4 says so |
| L2-284 | `apps/api/src/config.ts`, `infra/aws` | The API and the backup use IAM-user access keys (rotated by hand every 90 days); the instance role would need no static key | A small API change: an optional key pair |
| L2-285 | `infra/caddy/Caddyfile`, pilot-local | pilot-local's HTTP-to-HTTPS redirect drops the port (`http://app.localhost:<http port>` redirects to `https://app.localhost/`) | Local only; the pilot uses 80 and 443 |
| L2-286 | `infra/backup/backup-loop.sh` | The loop sleeps once until the next night: if the host sleeps or its clock jumps, the dump runs late (the 26-hour alarm catches a missed night) | Sleep in short steps and check the clock |
| L2-287 | `infra/docker/compose.pilot.yml`, rate limits | An IPv6 client reaches Caddy through Docker's userland proxy, so the API sees the bridge gateway: every IPv6 client shares one rate-limit budget. No AAAA record until fixed (`docs/runbooks/aws-setup.md` step 12) | Found in the PR 25 verification |
| L2-288 | file store CORS | SeaweedFS 4.48 answers some preflights S3 would refuse (a requested header with no AllowedHeaders); the real-S3 check in `docs/runbooks/aws-setup.md` step 6 must be done before staff upload photos | Found in the PR 25 verification |

## Public website (`apps/web/src/features/public`, `POST /api/v1/contact`)

| # | Where | What | Why it can wait |
|---|---|---|---|
| L2-230 | footer, `/legal/*` | No privacy notice (D-6), terms or grievance officer page exists, as India's data protection law (DPDP) requires before real people's details are taken. The footer links to none of them rather than to fake text; the contact form's privacy line is the only notice | The owner and a lawyer write them; the contact form stays unconnected (`PGN_CONTACT_TO` unset) until they exist |
| L2-231 | deploy | The contact address (`PGN_CONTACT_TO`) and the sender (`PGN_MAIL_FROM`, D-2) are the owner's choice at deploy, never committed; the sender's domain needs SPF and DKIM so the team's mailbox accepts the email | Unset, the form answers 503 and says it is not connected |
| L2-232 | `/how-it-works`, `/marathi`, `/about` | Doc 03 §4.2's ★ pages are not built, so the header lists Features, Pricing, Security and Contact, not "How it works" and "Marathi"; the Marathi typography section lives on the home page | Each needs screenshots or text that only later milestones make true |
| L2-233 | the site's Marathi | Every public record and the header and footer strings are a first draft, on the `REVIEW` list (`public:<id>` and `public.*`) for the native editor (D-5) | The English is the reviewed text; the Marathi says the same claims |
| L2-234 | `src/modules/contact/routes.ts` limits | The contact limits (5 an hour and 20 a day per address, 200 a day in all) are in one process's memory: a restart forgets them. Each is read before a send and counted after it, so a burst of messages sent at the same moment can pass a limit by a few | One API instance; the per-minute budget and the trap still apply |
| L2-235 | contact spam checks | The minimum fill time is counted by the browser (`filledInMs`), so a program can claim any time; the trap field catches only programs that fill every field. A server-issued form token would make both stronger | No storage, plain text only, and the caps bound the damage to the team's inbox |
| L2-236 | contact sending | The API waits for the mail server before it answers (up to about 40 s when the server is down), and a message the mail server refused is gone: nothing is kept to retry | The person is told it was not sent, and what they typed stays on the page |
| L2-237 | home page | Doc 03 §4.2's editor screenshot (after M12) and the footer's Status link are not there; neither is "Data stored in India", which waits for hosting (the footer says hosting in India is planned) | They wait for the milestones that make them true |
| L2-238 | footer | The copyright line says "© <year> Pageinator": the owner confirms the legal name to show | Wording only |
| L2-239 | `docs/phase0/EXP_GEN_1_REPORT.md` status block | Its third line ("11 pages are outside this version's scope or have no exact fit") is left from the 17-of-28 version and contradicts the 28-of-28 line above it; the header date and version (2026-10-21, gen1/2.9.6) differ from the status (2026-10-19, gen1/2.10.0) | The site quotes the status line, which §9 confirms; fix the report's wording |
| L2-240 | `proof-press-*`, `workflow-print-today` | G2 stands on the owner's report: the record sheet is not filed, and the photo-and-ad press test (doc 09 L1, owner) is still to do. When it is done, the press-test wording and its evidence change together | The site says the page was text-only and that photos and ads are not press-tested |
| L2-241 | `specs/active/UI005_PUBLIC_PRODUCT_JOURNEY.md` | The UI005 spec still describes the demonstration site (no sending, "Reserved in the current build"); the tests now follow doc 03 §4 instead | Doc 03 §4 is the source of truth for the website |
| L2-242 | `apps/web/index.html` | Every public page has the title "Pageinator" and one URL for both languages (no per-page title, no `/mr/` address or `hreflang`), so a search engine sees the English page only | The language switch works and is remembered; a server-rendered or per-language URL comes with hosting |
| L2-243 | `apps/web/src/i18n/review.ts` | The Marathi review list imports the public feature's records (`features/public/content.ts`): the i18n layer depends on a feature. Move the public records' review entries next to the content, or the content into the i18n layer, when either grows | `content.ts` imports nothing, so there is no cycle |
| L2-244 | `src/modules/notifications/mailer.ts` `PLAIN_ADDRESS` | The address check is loose in places (dots at the start or end of the local part, two dots in a row, a domain label starting or ending with a hyphen, no length check on the domain as a whole): it never lets a second recipient, a name or a header through, but accepts some addresses no mail server would | Every recipient is our own setting; a sender's address only becomes Reply-To |
| L2-245 | contact daily cap | The 200-a-day total for every address together can be used up by one sender with many addresses (an IPv6 /48 gives billions), keeping real people out until the window ends; key the per-address limits by /64 and add a per-prefix limit | Only messages that are sent count against the total, so the inbox is protected; the form says to try again later |
| L2-246 | `pnpm run guard` with `GUARD_BASE=origin/main` | The guard fails against `origin/main` because of commits this branch inherits from the unmerged L2 branches; it passes against `origin/chore/m0-monorepo` | Expected until the branches merge |
| L2-247 | `docs/phase0/EXP_GEN_1_REPORT.md` (frozen evidence) | The stale "11 pages" status line (L2-239) can be corrected only with the owner's evidence-change approval | The site quotes the 28-of-28 lines, which §9 confirms |
| L2-248 | `pnpm-workspace.yaml` nodemailer 10.1.1 (L2-22) | Must be upgraded before `PGN_CONTACT_TO` is set anywhere real: the fixed versions (10.1.4–10.1.7, released 2026-10-18) are not yet 7 days old on 2026-10-24; upgrade with an exact pin from 2026-10-25 and run the mail tests | Development sends only to Mailpit; every recipient and Reply-To passes the strict address check first |
