# Pageinator Desk — internal contract (server ⇄ engine ⇄ UI)

Pageinator Desk is an **internal tool for the owner's own newspaper**, run on one Mac. It is not the
Pageinator product (`apps/`), it is never deployed, and it makes no public claims. It lays out pages with
the Phase-0 engines (`experiments/phase0/gen1`, `page1`, `head1`, `compose3`, `pdfx1`), which it imports
read-only and never changes.

Three parts:

| Part | Runs in | Files |
|---|---|---|
| **UI** | the browser, served by the server | `tools/desk/static/` (`index.html`, `app.js`, `app.css`, `strings.js`, the main screen's words in English and Marathi, and `paste.js`, "Paste several" read as the server reads it; the page editor `editor.html`, `editor.js`, `editor.css`, and `editor-view.js`, its view's arithmetic: rulers and zoom): plain HTML, CSS and JavaScript. No build step, no framework, no network access beyond the local server |
| **Server** | `experiments/phase0/pdfx1/.venv/bin/python` (has Pillow with littleCMS, pypdfium2, pikepdf) | `tools/desk/server.py` (+ `tools/desk/deskserver/`): Python standard library `http.server`; storage, uploads, photo conversion, job runner, previews, merging |
| **Engine** | `tools/oracle/v0/.venv/bin/python` (the frozen oracle environment: HarfBuzz, fontTools) | `tools/desk/engine/`: turns articles into pages with gen1; command-line only |

Nothing is installed into either environment.

## 1. The desk home (private data)

Everything the Desk stores lives in `PAGEINATOR_DESK_HOME`, default `~/PageinatorPrivate/desk`. It is
never inside the repository. Directories are created with mode `0700` and files with `0600`.

```
<home>/
  config.json                      written by `engine setup` (dataset path, templates, needs per page role)
  editions/<edition_id>/
    edition.json
    articles.json
    photos/<photo_id>.orig.<ext>   the uploaded file, unchanged
    photos/<photo_id>.jpg          RGB preview for the UI, at most 1600 px on the long side
    photos/<photo_id>.cmyk.gz      what the engine places: raw 8-bit CMYK (C,M,Y,K per pixel), gzip
    photos/index.json              {"elements": {"<photo_id>": {"width_px": int, "height_px": int, "ppi": null}}}
    ads/<slot_id>.orig.<ext>, ads/<slot_id>.jpg, ads/<slot_id>.cmyk.gz, ads/index.json  (same layout as photos)
    runs/<run_id>/
      request.json                 written by the server when a run starts (a frozen copy of edition + articles + ads)
      plan.json                    the run's stories, their articles, order and pins (engine; the page editor keeps them)
      printed.json                 what each laid-out page prints (deskprinted: its articles' text line by line and
                                   photos, its folio's volume/issue/price, its ads: an index entry and its raster), so the
                                   Desk can tell when the edition no longer matches
      photos/, ads/                the run's own pictures: hard links (copies across disks) of the edition's rasters the
                                   run used, with index.json; a photo or ad changed or removed later never reaches the run
      engine-status.json           written ONLY by the engine (progress)
      status.json                  written ONLY by the server (what the UI reads)
      page-01.pdf …                PDF/X-1a, one per page (engine)
      page-01.manifest.json …      engine report per page
      page-01.started …            the moment a worker took the page (engine; progress only)
      page-01.pdfx-check.txt …     the independent PDF/X-1a checker's full report on the page (server)
      engine.pid                   the engine's process group, so a later server can stop it after a crash (server)
      work/                        photo folders as the generator reads them (links), temporary files (engine)
      page-01.png, page-01.thumb.png   previews (server, pypdfium2)
      page-01.edit.json …          the page's stories as edited, with its revision (engine edit-service; see §2.1)
      page-01.auto.pdf …           the automatic layout's page file, kept when an edited page is first saved
      edit-articles.json           article text set on this run's pages by "Update text" or the story panel; null for an
                                   article deleted since the layout (engine edit-service; every page of the run uses it)
      edition.pdf                  all pages in one file, for reading and proofs (server, pikepdf)
      press-files.zip              the page PDFs (server)
      engine.log                   engine stdout/stderr
  cache/                           engine caches (safe to delete)
    options/                       story measurements (content-keyed)
    instances/<32 hex>.ttf         font instances, made once by fontTools' instancer and read back by every later engine
                                   process (keyed by the font file's hash, the pinned axes and the fontTools version)
    fonts/<24 hex>.ttf             the font instances the editor draws with (content-keyed)
    rasters/<24 hex>.cmyk|.json|.jpg   placed pictures as the editor shows them (content-keyed)
  edit-service.log                 the editor engine's stderr
  .desk.lock                       held by the running server (one server per home)
```

Ids: `edition_id` = `YYYY-MM-DD` or `YYYY-MM-DD-<n>`; `photo_id` = `p-` + 10 lowercase hex;
article ids `a-` + 10 hex; `run_id` = `r-YYYYMMDD-HHMMSS`; `slot_id` = `[a-z0-9-]{1,40}`.
Every id from a request is checked against its pattern before it touches the file system.

### edition.json
```json
{"schema": "pageinator.desk.edition/1", "id": "2026-10-21", "date": "2026-10-21", "pages": 8,
 "back_page_ads": true, "volume": "", "issue": "", "price": "",
 "created": "2026-10-20T15:30:12+05:30", "updated": "…"}
```
- `pages`: 4, 8 or 16.
- `back_page_ads`: when false, the last page is all news (no ad slots).
- `volume` (वर्ष), `issue` (अंक), `price` (किंमत): text, printed in the front-page folio where the
  template has them; empty = keep the template's own value out (the engine leaves that word as it is).

### articles.json
```json
{"schema": "pageinator.desk.articles/1", "articles": [{
  "id": "a-0123456789", "headline": "…", "kicker": "", "deck": "", "byline": "",
  "body": "First paragraph.\n\nSecond paragraph.\n\n## A subheading\n\nThird paragraph.",
  "priority": 3, "page": null,
  "photo": {"id": "p-0123456789", "caption": "", "credit": "", "width_px": 2000, "height_px": 1333} ,
  "source": "typed", "created": "…", "updated": "…"}]}
```
- `headline` and `body` are required. Text is stored as typed (NFC-normalised, `\r\n` → `\n`, trailing spaces trimmed).
- `body`: paragraphs are separated by one or more empty lines; a line that starts with `##` is a subheading
  (crosshead). Text with no empty line at all whose lines mostly end a sentence (pasted from WhatsApp or a word
  processor) has one paragraph per line. The engine's `deskarticles.blocks` is the one parser: the server and the
  UI count words with it (subheadings are not body words).
- `priority`: 1 Lead · 2 Top · 3 Normal (default) · 4 Minor. A **short item** (brief) is any article with at most
  60 words of body text and no photo; short items are set together in a "news in brief" column.
- `page`: `null` (the Desk chooses) or a page number to pin the article to.
- `photo`: `null` or the photo record. `source`: `"typed"`, `"pasted"`, `"word"` (from a .docx file) or
  `"sample:<name>"`.

## 2. Engine commands

`<oracle python> tools/desk/engine/desk_engine.py <command> --home <home> [options]`. Every command prints
exactly one JSON object on stdout (the result) and exits 0, or prints `{"error": "…"}` and exits 1. Progress
and debugging go to stderr.

| Command | Options | Result |
|---|---|---|
| `setup` | `[--dataset DIR]` | Chooses the page templates from the dataset and writes `config.json`. `{"config": {...}}` |
| `plan` | `--pages N --back-ads 0|1` | `{"pages": [{"page": 1, "role": "front"|"inside"|"back", "news_mm2": float, "ad_slots": [{"slot": "back-1", "w_mm": float, "h_mm": float}]}], "needs": {...}}` |
| `samples` | — | `{"samples": [{"name": "…", "date": "YYYY-MM-DD", "pages": 4, "stories": 27, "photos": 19, "words": 6100}]}` (past editions in the private dataset, for testing) |
| `import-sample` | `--edition ID --sample NAME [--sample NAME …]` | Appends that edition's stories to `articles.json` as articles (photos copied as `.cmyk.gz`, `source: "sample:<name>"`). `{"imported": n, "photos": k}` |
| `measure` | `--edition ID` | Measures the edition's stories ahead of a layout (content-keyed cache in `<home>/cache/options/`); writes `editions/<id>/measure-status.json` `{"state": "measuring"|"done", "measured", "total", "updated"}`. `{"measured", "total", "failed"}` |
| `generate` | `--edition ID --run RUN_ID` | Lays out the edition from `runs/<run>/request.json`. Writes `engine-status.json` as it goes and the page PDFs and manifests. `{"pages": n, "failed": k}` |

| `edit-service` | — | A long-lived process for the page editor (§2.1); not a one-shot command |

### 2.1 The edit service (page editor)

One JSON request per line on stdin, one JSON answer per line on stdout:
`{"id", "cmd", …}` → `{"id", "ok": true, "result"}` or `{"id", "ok": false, "error": "plain message"}`. The first
line it writes is `{"id": 0, "ok": true, "result": {"ready": true, "engine": "desk-engine/…"}}`. It keeps at most 12
pages open (the least recently used closes and opens again on its next request).

- **The run's plan is frozen.** A page is set from the run's own articles and pictures (`plan.json`, `photos/`,
  `ads/`), grouped as the layout grouped them: every article keeps the story it was laid out in (its own, or a column
  of short items) and every story its place in the order of importance, whatever its new text, photo or priority. New text never moves an article to another story or page;
  an article that would now be a story rather than a short item (or the other way round) is reported, and changes at
  the next layout. A story whose articles are all deleted leaves; the stories after it keep their place, so they do
  not count as changed.
- **Text reaches every page of the run.** Before any request on a page, the page takes the text other pages of the
  run have set (`edit-articles.json`); an article deleted from the edition leaves the page when "Update text" runs.
  "Update text" also brings the edition's current volume, issue and price (folio) and its current ads into the run.
- **Older layouts.** A run without `plan.json` (made by an older Desk) cannot be edited (409): lay the edition out again.
- **Revisions.** Every page has a revision (`rev`, kept in `page-NN.edit.json`), moved on by every change, including a
  story taken off it by another page's save and changes the engine makes itself (text another page set, a story whose
  articles were all deleted). The server marks a page "changed, not saved" whenever an answer's revision is not the one
  its PDF was made from (`pdf_rev`, 0 for the automatic layout). `set`, `alternative` and `export` take an optional `base_rev`: a change
  made on an older revision is refused ("this page was changed in another window or tab …").
- **Measuring.** A story not measured yet (new or changed text) is measured only at the setting the page needs at
  once; the service measures its other settings while idle (2 s after the last request) and then keeps them in the
  measurement cache. The options are identical to a layout run's.
- **Locks.** A module's `locked` (true or false) is kept in `page-NN.edit.json`, for this layout only: a new layout starts
  with every story unlocked. A locked story keeps its place, width and height and stays on its page. Refused, with
  nothing set or written:
  - a `set` that moves, resizes or removes a locked story (it may come back unlocked at its place, so unlocking and undo
    work);
  - a `set` that brings in a story locked on another page;
  - an `export` while a story of the page is also on another page and locked there (the save would take it off that
    page).

  Its text still changes, and a story whose articles are all deleted leaves its page even when locked: a deleted article
  never prints. A lock change is a change of the page (its revision moves), so a saved page is marked "changed, not
  saved"; a lock does not print, so it is in neither `printed.json` nor `status.json`.
- **Photo crops.** A module's `crop` is null (the photo prints as the layout crops it: gen1's centre crop, the largest
  window of the frame's shape) or `{"photo": "<photo id>", "focus": [x, y], "zoom": z}`. The frame stays gen1's (its
  place and size in the story); the crop chooses which of the photo's pixels fill it. `zoom` (1 to 4) enlarges the photo
  in its frame, never below the resolution gen1 allows that photo (150 ppi, or 0.95 × the resolution the paper printed
  it at when lower: 142.5 ppi for an upload, which records none) and never beyond 400 %: the frame's size limits it, so
  a photo already printed at that floor is never enlarged. `focus` (fractions of the photo's width and height) is the
  point the frame keeps as near its centre as the photo's edges allow, at every size: one point is both the pan and
  the focal point. Kept in `page-NN.edit.json`, for this layout only (a new layout starts with none), a crop is page
  geometry: a change is a change of the page (its revision moves, the page is "changed, not saved" until it is saved),
  the PDF prints exactly the crop's window of the run's own raster, and a page without a crop prints exactly as
  before. A story's crop is the one its own module sends: it moves with its story (another layout, a swap) and never
  applies to another picture. A crop that does not name the story's own photo is dropped (another story's photo; a
  replaced photo, which has a new id; a removed one), and `crop: null` always means no crop. A crop whose photo changes
  by new text is dropped too (`refresh`: `crops_reset`). A crop that is not one is refused (400 at the server). A locked story's crop can change (a lock freezes the place only).

| `cmd` | Fields | Result |
|---|---|---|
| `open` | `edition`, `run`, `page`, `reload`? | `{"session": "<edition>/<run>/<page>", …page}` |
| `set` | `session`, `modules`, `base_rev`? | page. Each module `{"story", "x", "y", "w", "h", "locked", "crop"}` (mm, `w` in columns; `locked` true or false, missing is false, anything else is refused; `crop` null or missing, or a crop as above: its focus is clamped to the photo and its zoom to 1 … 4, both rounded, other keys dropped, anything else refused): one the editor left where it was keeps its exact position, whatever its lock or crop; a moved one is snapped to the grid (whole columns; `y`, `h` in whole 0.5 mm steps from the news area's top, inside the news area). Unknown stories and repeats are dropped; written to `page-NN.edit.json`. Refused as the locks say (above). If the page cannot be set, it stays as it was |
| `alternative` | `session`, `variant` (1 lead on the other side, 2 lead at another width, 3 both), `base_rev`? | page (another complete layout of the same stories, set as an edit). Locked stories stay exactly where they are; the others are laid out in the space around them (the page's short height first, then the whole news area; columns first, then rows first), and the variant moves the lead only when it is not locked. Refused when every story is locked, or when nothing fills the space around them exactly; the page then stays as it was |
| `refresh` | `session`, `base_rev`? | page + `"changed"` (stories set with new text), `"dropped"` (stories that left the page: all their articles deleted or emptied), `"removed"` (articles no longer printed on the page), `"kind_changes"` (`[{"article", "headline", "now": "story"\|"short item"}]`), `"folio_changed"`, `"ads_changed"` (slots), `"crops_reset"` (stories whose crop was dropped: their photo was replaced or removed). Text is kept in `edit-articles.json`; if the page cannot be set with it, nothing changes (the run's ads included). Refused on an older revision, as `set` is |
| `export` | `session`, `base_rev`? | `{"pdf", "sha256", "rev", "problems", "articles", "printed", "pages_changed": {"<n>": [article ids the page keeps]}}` (`articles`: those of the stories that were set; `printed`: what the page now prints, as in `printed.json`, plus `"crops": {"<article id>": sig}` when a photo prints cropped, recorded and never compared with the edition, which has no crops): writes the edited page's PDF/X-1a file over `page-NN.pdf`; stories brought from other pages leave them now. `problems` also holds `touch` (two lines of a story touching in ink, the check the layout runs make). Refused before anything is set or written while a story of the page is also on another page and locked there |
| `state`, `draw`, `close`, `ping` | `session` (not for `ping`) | the page without, or with, its display list; closes the page |

A page: `{"page", "role", "rev", "modules", "notes": [{"story", "fit": "fits"|"over"|"short"|"none", "by_mm",
"articles", "headline", "photo"?}], "problems", "pool": [{"story", "headline", "articles", "brief", "on_page", "locked"}], "grid":
{"page_w_mm", "page_h_mm", "origin_mm", "column_mm", "gutter_mm", "columns", "news_top_mm", "news_bottom_mm",
"snap_mm"}, "also_on_pages": {"<story>": <page>}, "locked_on_pages": {"<story>": <page>}, "items", "fonts"}`.
`also_on_pages`: this page's stories still on another page too (this page's save takes them off it); `locked_on_pages`:
those of them locked there (this page cannot be saved meanwhile); `pool[].locked`: the story is locked on the page
`on_page` (it cannot be brought here). A story on more than one other page counts as locked when it is locked on any of
them. `items` is the display list in mm, y down: `text` (font key, size, horizontal scale, CMYK, glyphs `[gid, x, y]`),
`rect`, `line`, `img` (`src`: raster key; a cropped photo is its whole raster with `sub`: `[x, y, w, h]`, the part that
prints as fractions of the whole, so a pan adds no raster to the cache). `notes[].photo` (in the answers that draw the
page, for a story with a photo): `{"id", "px": [width, height], "box_mm": [x0, y0, x1, y1]` (the frame), `"window":
[x, y, w, h]` (the photo's pixels that print), `"ppi"` (their resolution), `"zoom"`, `"zoom_max"`, `"floor_ppi"`,
`"focus"` (null: no crop), `"full"` (the whole raster's key, null when it cannot be read)}. `fonts` maps a font key to
`{"face": "<24 hex>", "upem"}`. Problems: `overlap`,
`outside` (outside the news area or over an ad or picture), `over`, `short` (more than 9 mm empty), `cannot_set`,
`overset` (lines or subheading words that would not print), `unset` (paragraphs that could not be set), `empty` (more
than 2% of the news area unused).

### needs (in `plan`)
```json
{"stories": 52, "briefs": 4, "photos": 39, "words": 12900,
 "per_role": {"front": {"stories": 7, "briefs": 4, "photos": 6, "words": 1311},
              "inside": {"stories": 7, "briefs": 0, "photos": 5, "words": 1759},
              "back": {"stories": 3, "briefs": 0, "photos": 3, "words": 1052}},
 "spare_share": 0.2}
```
Medians measured on the paper's own printed pages (one front, `pages − 2` inside, one back).

### engine-status.json (written atomically: temp file + rename)
```json
{"schema": "pageinator.desk.engine-status/1", "state": "starting"|"planning"|"layout"|"done"|"failed",
 "started": "…", "updated": "…", "message": "…",
 "pages": [{"page": 1, "role": "front", "state": "waiting"|"working"|"done"|"failed",
            "articles": ["a-…"], "pdf": "page-01.pdf"|null, "seconds": 12.3,
            "message": "", "warnings": ["…"]}],
 "not_placed": [{"article": "a-…", "reason": "…"}],
 "article_warnings": [{"article": "a-…", "warnings": ["…"]}],
 "timings": {"measure_s": 86.2, "plan_s": 0.2, "layout_s": 41.1},
 "plan_log": [[page, "fits"|"fits (swapped)"|…, stories, target]]}
```

## 3. Server API (JSON over HTTP, `127.0.0.1` only)

- Binds `127.0.0.1:<port>` (default 8765). Requests whose `Host` is not `127.0.0.1:<port>` or
  `localhost:<port>` are refused (DNS rebinding). Every `POST`/`PUT`/`DELETE` must carry the header
  `X-Desk: 1` (a cross-site page cannot send it without a CORS preflight, which the server never grants).
- Errors: `{"error": "plain-language message"}` with 400/404/409/413/500.

| Method | Path | Body → Result |
|---|---|---|
| GET | `/` , `/static/<file>` | the UI |
| GET | `/api/status` | `{"version", "engine_ok", "config_ok", "home", "cores", "message"}` |
| GET | `/api/plan?pages=8&back_ads=1` | the engine's `plan` result (cached) |
| GET | `/api/samples` | the engine's `samples` result (cached) |
| GET | `/api/editions` | `{"editions": [{"id", "date", "pages", "articles", "words", "photos", "last_run": {...}|null}]}` |
| POST | `/api/editions` | `{"date", "pages", "back_page_ads", "volume", "issue", "price"}` → edition |
| GET | `/api/editions/<id>` | `{"edition", "articles": [... + "words", "is_brief"], "ads": {...}, "plan", "runs": [{"id", "state", "started"}], "measure": {...}|null}` |
| PUT | `/api/editions/<id>` | partial edition fields → edition |
| DELETE | `/api/editions/<id>` | moves the edition folder to `<home>/trash/` (409 while it is being laid out, or while one of its pages is being saved) |
| POST | `/api/editions/<id>/articles` | article fields → article |
| PUT | `/api/editions/<id>/articles/<aid>` | partial fields → article |
| DELETE | `/api/editions/<id>/articles/<aid>` | → `{"ok": true}` |
| POST | `/api/editions/<id>/articles/bulk` | `{"text": "…"}` (articles separated by a line `---`; first line headline; an optional line `Byline: …`; the rest body) → `{"created": n, "articles": [...], "skipped": [{"headline", "reason"}]}` |
| POST | `/api/editions/<id>/articles/import-docx` | the raw `.docx` file (at most 20 MB, at most 200 stories) → `{"created", "articles", "skipped", "notes"}`: a Title or Heading 1 paragraph starts a story (else the first paragraph is the headline); a short first line under it can be the byline (`Byline: …` / `वार्ताहर: …` with a colon, `By A. Writer`, `प्रतिनिधी, काल्पनिकनगर`, `वार्ताहर, काल्पनिकनगर`); Heading 2–4 become subheadings. Only the body's own paragraphs are read: tables, text boxes, pictures, deleted (tracked) text and formatting are not taken, and `notes` say what was left out. A damaged file is refused with a plain message (400) |
| PUT | `/api/editions/<id>/articles/<aid>/photo` | raw image bytes (`Content-Type: image/jpeg|image/png|image/webp`), query `caption`, `credit` → photo record |
| PUT | `/api/editions/<id>/articles/<aid>/photo-text` | `{"caption", "credit"}` → photo record |
| DELETE | `/api/editions/<id>/articles/<aid>/photo` | → `{"ok": true}` |
| POST | `/api/editions/<id>/import-sample` | `{"samples": ["name", …]}` → engine result |
| PUT | `/api/editions/<id>/ads/<slot>` | raw image bytes → `{"slot", "w_px", "h_px"}` (fitted inside the slot, white around it) |
| DELETE | `/api/editions/<id>/ads/<slot>` | → `{"ok": true}` |
| POST | `/api/setup` | `{"dataset"?}` → the engine's `setup` result |
| POST | `/api/editions/<id>/runs` | — → `{"run": "<run_id>"}` (409 if one is running) |
| GET | `/api/editions/<id>/runs/<rid>` | `status.json` |
| POST | `/api/editions/<id>/runs/<rid>/cancel` | → `{"ok": true}` |
| GET | `/files/<id>/photos/<photo_id>.jpg` , `/files/<id>/ads/<slot>.jpg` | previews |
| GET | `/files/<id>/runs/<rid>/<file>` | run outputs (`page-NN.pdf`, `page-NN.png`, `page-NN.thumb.png`, `edition.pdf`, `press-files.zip`) |
| POST | `/api/editions/<id>/runs/<rid>/pages/<n>/edit` | `{"reload"?}` → the page (edit service `open`). 409 unless the run is done |
| PUT | `/api/editions/<id>/runs/<rid>/pages/<n>/edit` | `{"modules": [...], "rev"?}` (at most 40) → the page; marks the page "changed, not saved" (a lock or crop change too). 409 when `rev` is not the page's revision (changed in another window or tab); 400 when a lock refuses the change (§2.1: "“…” is locked: unlock it (Shift+L) to move it.") or a crop is not one ("… a photo crop must give the photo's id, a focus point (two numbers) and a zoom (a number)."), the page and the run's status staying as they were |
| POST | `/api/editions/<id>/runs/<rid>/pages/<n>/alternative` | `{"variant": 1|2|3, "rev"?}` → the page; marks it changed (409 as above) |
| POST | `/api/editions/<id>/runs/<rid>/pages/<n>/refresh` | `{"rev"?}` → the page + `changed`, `dropped`, `removed`, `kind_changes`, `folio_changed`, `ads_changed`, `crops_reset` (as the edit service's `refresh`); marks it changed if anything changed. 409 as above |
| POST | `/api/editions/<id>/runs/<rid>/pages/<n>/save` | `{"rev"?}` → the export result + `{"page", "pdfx_check", "error", "stale", "press_ready", "pages_to_save", "pages_failing_check", "pages_with_repeats"}`. First marks the page, and every page it takes a story from, "needs saving" (so a save that stops part-way leaves them marked); then exports, makes the page's previews again, runs the independent PDF/X-1a check on it and merges `edition.pdf` and `press-files.zip` again. Pages a story left stay "needs saving". If a step fails, the page stays "needs saving" and `error` says why; `stale` lists what the new PDF still prints older than the edition (text corrected meanwhile). The edition's lock is held only while `status.json` is read and written, so article saves go on meanwhile; saves in one run go one at a time. 409 as above. 400, before any page is marked or any file written, while a story of the page is also on another page and locked there ("This page cannot be saved yet: “…” is also on page 5, locked there. Unlock it on page 5, or take it off this page, then save."); should the lock come between that check and the engine's export, the engine refuses too and the pages marked meanwhile stay "needs saving" |
| GET | `/api/glyphs/<face>?ids=1,2,…` | `{"upem", "glyphs": {"<gid>": "<SVG path, font units, y up>"}}` (at most 4000 per request) |
| GET | `/files/rasters/<key>.jpg` | a placed picture as the editor shows it (RGB JPEG, at most 1600 px) |

Background measuring: after any change to an edition's articles, the server runs the engine's `measure` (debounced,
one at a time, never during a generate run), so a layout usually starts with every story measured.

### status.json (server; what the UI polls: every 1.5 s while a layout runs, every 5 s once it has finished, and at
once after a change made in any Desk window or page editor of that edition, which tell each other through a
`BroadcastChannel`)
The engine status (without `plan_log`), plus per page `"png"`, `"thumb"` (file names, once rendered) and
`"pdfx_check"` (`{"passed", "fails", "warnings"}`, the independent checker's verdict on the page PDF, once the run is
finishing), plus
`"edition_pdf"`, `"zip"` (once built), `"state"` (`queued` → `planning` → `layout` → `finishing` → `done` |
`failed` | `cancelled`), `"elapsed_s"`, `"error"`.

After the page editor: per page `"edited"` (saved from the editor at least once), `"edited_at"`, `"pdf_rev"` (the
revision its PDF was made from), `"edited_unsaved"` (changed since its PDF was made), `"needs_save"` and
`"needs_save_reason"` (a story moved from it to another page, or its last save could not finish), `"rev_seen"` (the
newest revision the editor answered with: a save of an older one leaves the page "changed, not saved"), `"warnings"` (after
a save: the save's checks in words, as a layout run words them, plus an issue number the page prints but the edition
does not set), `"printed"` (what its PDF prints; its `crops`, when a photo prints cropped, are never compared) and `"stale"` (reasons it no longer matches the edition: an article changed or deleted, the volume/issue/price,
an ad; also, fail closed, a page an older Desk made without a record of what it prints, a run laid out for another
page count (every page) or back-page ads setting (its last page), and a page that cannot be checked because a file of
the layout or the edition cannot be read (a missing `request.json` included, and an ads `index.json` that cannot be
read or is not an index: never read as "no ads"): a new layout clears those; a page an
older Desk recorded in another format is current again once it is saved in the page editor, which records it anew). `stale` is
worked out again when a run finishes (under the edition's lock), after every save, whenever the edition changes, and
for every finished run when the server starts; a save clears it only when the new PDF prints what the edition holds. A stale page counts as "to save". For the run: `"press_ready"` (a finished run, every page laid
out, none changed since its PDF, every PDF passed the check, and no article on two pages), `"pages_to_save"`,
`"pages_failing_check"`, `"pages_with_repeats"` (pages whose PDFs print the same article). While `press_ready` is
false, the UI tells the user not to send the press files. Articles on no page after edits are listed in
`"not_placed"` (with the layout's reason, or "Taken off the pages in the editor").

## 4. Photos and ads

- Uploads up to 40 MB; opened with Pillow (`Image.open` + `verify`, then reopened); EXIF orientation applied;
  metadata dropped; converted to sRGB.
- Photos: scaled down (never up) to at most 2000 px on the long side, then converted to CMYK with littleCMS
  using the newsprint profile (`PAGEINATOR_ICC`, default `~/PageinatorPrivate/icc/WAN-IFRAnewspaper26v5_TIC220.icc`),
  perceptual intent, black-point compensation — as `experiments/phase0/page1/photos.py` does.
- Ads: fitted inside the slot's aspect at 200 ppi (white around them), converted the same way.

## 5. Honesty

The UI never says "press-ready". It says: the page PDFs are PDF/X-1a files made by the same writer whose
text-only test page the press accepted; **pages with photos or ads have not yet been press-tested — print one
test page before a real edition.**
