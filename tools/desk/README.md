# Pageinator Desk (internal, own use)

The Desk is a small local app for the owner's own newspaper. You type or paste the day's news, choose 4, 8 or
16 pages, and the Desk lays out the whole paper. It gives you one PDF/X-1a file per page plus one PDF of the
whole edition.

**Owner decision, 2026-10-20.** The owner wants to use Pageinator for their own paper now, while the product is
built. The Desk exists for that.
- **It is not the Pageinator product** (`apps/`), and it does not change the product plan or its gates
  (`docs/architecture/v2/13_ROADMAP_AND_RISKS.md`).
- **It runs only on the owner's Mac** and binds to `127.0.0.1`. It is never deployed and makes no public claims.
- **It uses the Phase-0 engines, imported read-only** and never changed:
  - `experiments/phase0/gen1`: the layout search;
  - `experiments/phase0/page1`: rebuilding the fixed parts of the page;
  - `head1` and `compose3`: type;
  - `pdfx1`: the PDF/X-1a writer.
- **No AI** chooses any layout, line break or fit.

## Start it

```sh
tools/desk/start-desk.sh          # starts the server and opens http://127.0.0.1:8765 in the browser
```

The first time, the Desk sets itself up from the private dataset (it chooses the paper's page designs and measures
what a page usually holds). Everything it stores lives in `~/PageinatorPrivate/desk` (`PAGEINATOR_DESK_HOME`),
never in this repository.

## What it does

1. **Edition:** date, 4/8/16 pages, whether the back page carries ads, volume/issue/price for the front-page folio.
2. **Articles:** headline, kicker, deck, byline, body (empty line between paragraphs, `## ` for a subheading),
   priority (Lead, Top, Normal, Minor), an optional page pin, an optional photo with caption and credit. Short items
   (at most 60 words, no photo) are stacked in a "news in brief" column. You can also import a past edition's
   stories from the private dataset, to try the Desk with real news.
3. **Needs:** how many stories, short items, photos and words the chosen number of pages usually holds. These are
   medians measured on the paper's own printed pages.
4. **Ads:** an image for each ad space of the back page. An empty space prints as a grey box marked AD.
5. **Lay out:**
   - **Measure:** every story is measured at every width with the real typesetter.
   - **Plan:** the planner gives each page a set of stories that fills it exactly. It checks this with the
     generator's own first pass, before the slow search.
   - **Lay out:** all pages are laid out in parallel. The running head gets the edition's date and page numbers.
   - **Previews and files:** you get page previews, one PDF per page, the whole edition as one PDF, and a ZIP of
     the press files.
6. **Word files:** "Word files…" adds the stories of one or more `.docx` files. A file can hold one story or several
   (each starting with a Title or Heading 1 paragraph). Only the text is taken, not its formatting.
7. **Edit a page** (the page editor, "Edit page" under each page once the layout is done):
   - The page is drawn with the same glyph outlines the print file embeds, so the screen shows the same letters at
     the same places as the print file (its colours on screen are approximate).
   - Select a story, move it, resize it from its edges or corner, change its width in columns, swap two stories,
     take a story off the page or bring one in (also from another page). Every change is set again by the same
     engine and kept as you go; undo and redo work for every move, resize and other layout of the page.
   - **Type a story's text** (double-click it, or press Enter): the story panel shows its article's headline, deck,
     byline and text in ordinary text boxes, so every Marathi input method works. The text is saved to the article as
     you pause, and the engine sets the page again with it, usually within two seconds; the panel shows whether the
     text still fits its box. The page itself is never set with browser text.
   - **Checks** list overlaps, text that does not fit, stories outside the news area or over an ad, and empty space.
   - **Try another layout** lays out the same stories another way; **Update text** sets the articles' current text.
   - **Lock a story in place:** Shift+L, the **Lock in place** button in the story panel, or the story's menu (a
     right-click on it, Ctrl+click on a Mac, or Shift+F10) locks the selected story for this layout, or unlocks it. A locked story keeps its
     place, width and height and stays on the page; it shows a padlock and a dashed outline:
     - moving, resizing, swapping or removing it is refused with a message that says to unlock it first;
     - **Try another layout** lays the other stories out around it, or says that nothing fills that space exactly;
     - its text can still change, and a story whose articles are deleted still leaves the page (a deleted article never
       prints);
     - a story locked on another page cannot be brought onto this page, and this page cannot be saved while it holds a
       story that is locked on another page (unlock it there, or take it off this page).

     The menu of the page's empty space has **Unlock all on page**. A lock lasts for this layout only (a new layout
     starts unlocked) and does not print. Locking or unlocking counts as a change of the page, so a saved page needs
     saving again (its new file prints the same).
   - **Rulers and zoom:** rulers along the top and left give millimetres from the page's top-left corner, number the
     grid's columns and mark where the pointer is; Shift+R shows or hides them, and the browser remembers it. Shift+2
     zooms to the selected story, Shift+1 (or 0, or **Fit**) shows the whole page, Shift+3 its width, and − and + zoom
     out and in. Fit width, zoom to the story and the rulers also have buttons after the zoom percentage; each
     button's tooltip names its key. These keys do nothing while you type in a text box. The view never changes what
     the page prints.
   - **Save page** writes the page's PDF/X-1a file, checks it with the independent checker (and for two lines touching
     in ink, as the layout runs do) and remakes the edition PDF and the press ZIP. A story brought from another page leaves that page then, and that page is marked
     "needs saving". The Desk does not offer the press files as current while any page is changed and not saved,
     fails the check, or prints an article that is also on another page. Each page records what its PDF prints; when
     an article is corrected or deleted (also while a layout is running), or the issue number, price or an ad changes,
     the pages that print it need saving until they are saved with the new content. **Save page** first sets the
     edition's current text, folio and ads on the page; if that changes the page, you check it and save again.
   - **A layout is kept as it was made**: its own copies of the photos and ads it used, and its grouping of the
     stories. Changing a photo or ad in the edition later does not change it until Update text (or Save page) brings
     it. Layouts made by older versions of the Desk cannot be edited: lay the edition out again.

## Limits

- **Fonts.** The type uses the free stand-in fonts the experiments use; the paper's own fonts come later.
- **Photos and ads are not press-tested.** Every page PDF is written as PDF/X-1a and then checked by the independent
  PDF/X-1a checker (`experiments/phase0/pdfx1/check_pdfx1a_independent.py`); the result is shown on each page. The
  press has accepted a text-only test page from this writer. Pages with photos or ads have not yet been
  press-tested, so print one test page before you use the Desk for a real edition.
- **Copying text out of the PDFs.** The writer keeps some Marathi text only in ActualText spans, so copying or
  searching text in some PDF viewers (those built on PDFium, such as Chrome's) misses words. Printing is not
  affected. Fixing it is a change to the frozen writer, which needs the evidence-change approval.
- **Speed.** Measured on this Mac (12 cores): an 8-page paper takes about 2 minutes and a 16-page one about 3,
  most of it measuring the stories. The Desk measures stories in the background while you type, and keeps every
  measurement, so laying out again after a change is quicker.
- **Pages that do not fill exactly.** If a page's stories cannot fill it exactly, it comes out with white space at
  the foot, and the Desk says how much.
- **Articles that do not fit.** If an article fits nowhere, it is listed with the reason.
- **Text is typed in the story panel, not on the page itself.** Within a layout, an article stays in the story it
  was laid out in: a short item that grows stays with the short items until the edition is laid out again (the
  editor says so). Another layout needs 11 stories or fewer on the page, not counting locked ones. With locked stories
  it often finds no exact fill of the space left around them (narrow strips), and says so. Moves keep the house grid:
  whole columns, half-millimetre heights.
- **One page in two windows.** A change made in a window that shows an older version of the page is refused, and
  that window shows the page as it is now.

## Parts

| Part | Environment | Files |
|---|---|---|
| UI | browser | `static/` |
| Server | `experiments/phase0/pdfx1/.venv` (Pillow + littleCMS, pypdfium2, pikepdf) | `server.py`, `deskserver/` |
| Engine | `tools/oracle/v0/.venv` (the frozen oracle environment) | `engine/` |

The contract between them is in [`CONTRACT.md`](CONTRACT.md).

## Tests

`pnpm run test:desk` runs the three suites from the repository root, and CI's `desk` job runs the same three commands.
The tests use fictional data only and need nothing from `~/PageinatorPrivate`.
- `experiments/phase0/pdfx1/.venv/bin/python -B -m unittest tools/desk/test/test_server.py tools/desk/test/test_docx.py`
- `tools/oracle/v0/.venv/bin/python -B -m unittest tools/desk/test/test_engine.py`
- `node --test tools/desk/test/test_editor_view.mjs` (the page editor's ruler and zoom arithmetic)

CI builds both environments from hashed locks with Python 3.11.14 (the commands are in `docs/DEVELOPMENT.md`, Setup):
the server's from `tools/desk/requirements.lock` (the exact versions of `experiments/phase0/pdfx1/requirements.txt`),
the engine's from the frozen oracle's `tools/oracle/v0/requirements.lock`. CI runs on Linux, where three server tests
skip: they need the colour profiles that come with macOS (`/System/Library/ColorSync/Profiles`).
