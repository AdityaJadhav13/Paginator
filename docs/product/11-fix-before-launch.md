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
