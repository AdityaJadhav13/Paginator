"""The Desk's own messages (tools/desk/engine/deskmsg.py, messages.json): every code's English is the text the server or
the engine said before codes existed (byte for byte), its wire form {code, params} is what the screens translate, and
the "msgs" map of a status or an answer keeps each text's form. Fictional values only.

    experiments/phase0/pdfx1/.venv/bin/python -B -m unittest tools/desk/test/test_messages.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT.parent.parent))

import deskmsg as DM  # noqa: E402
import deskprinted  # noqa: E402

from tools.desk.deskserver import editing, press  # noqa: E402

H = "“काल्पनिक मथळा”"           # a story's name in a message: its headline in quotes (fictional)

# code → (values, the English the Desk said before: written out as the old code wrote it)
OLD = {
    "m.name.shortColumn": ({}, "the column of short items"),
    "m.name.aStory": ({}, "a story"),
    "m.edit.stale": ({}, "this page was changed in another window or tab; it is shown again as it is now"),
    "m.edit.notNumber": ({}, "a position or size is not a number"),
    "m.edit.cropBad": ({}, "a photo crop must give the photo's id, a focus point (two numbers) and a zoom (a number)"),
    "m.edit.cropFloor": ({}, "a photo crop would print below the photo's resolution floor"),
    "m.edit.cropLost": ({"name": H}, f"the photo of {H} could not be found on the page to crop it: nothing was changed"),
    "m.edit.photoDamaged": ({"name": H}, f"the photo of {H} is damaged (its raster has the wrong size)"),
    "m.edit.lockBool": ({}, "a story's lock must be true or false"),
    "m.edit.treatmentBad": ({}, "this paper's house style has no such story treatment"),
    "m.edit.lockedMove": ({"name": H}, f"{H} is locked: unlock it (Shift+L) to move it"),
    "m.edit.lockedTake": ({"name": H}, f"{H} is locked: unlock it (Shift+L) to take it off the page"),
    "m.edit.lockedThere": ({"name": H, "page": 3}, f"{H} is locked on page 3: unlock it there to bring it here"),
    "m.edit.saveHeld": ({"name": H, "page": 2}, f"this page cannot be saved yet: {H} is also on page 2, locked there. "
                                                "Unlock it on page 2, or take it off this page, then save"),
    "m.edit.allLocked": ({}, "every story on this page is locked: unlock one to try another layout"),
    "m.edit.noFillAround": ({}, "no other layout fills the space around the locked stories exactly: unlock one, or move it"),
    "m.edit.noFill": ({}, "no other layout fills this page exactly with these stories"),
    "m.edit.noStories": ({}, "this page has no stories to lay out"),
    "m.edit.tooMany": ({"n": 13, "max": 11}, "this page has 13 stories; another layout needs 11 or fewer"),
    "m.edit.tooManyFree": ({"n": 12, "max": 11}, "this page has 12 stories not locked; another layout needs 11 or fewer"),
    "m.edit.notAllPlaced": ({}, "another layout did not place every story of this page; the page is kept as it was"),
    "m.edit.moveNotHere": ({"name": H}, f"{H} is not on this page"),
    "m.edit.moveNoPage": ({"page": 9}, "this layout has no page 9"),
    "m.edit.moveSamePage": ({"name": H}, f"{H} is on this page already: choose another page"),
    "m.edit.moveNotLaidOut": ({"page": 4}, "page 4 was not laid out in this layout: a story cannot move there"),
    "m.edit.moveLockedThere": ({"name": H, "page": 2}, f"{H} is also on page 2, locked there: unlock it there to move it"),
    "m.edit.moveCannotSet": ({"name": H, "w": 1, "cols": "column", "page": 3},
                             f"{H} cannot be set 1 column wide on page 3: change its width here, then move it"),
    "m.edit.moveNoRoom": ({"page": 4, "name": H, "w": 2, "cols": "columns", "h": 123.5},
                          f"there is no free place on page 4 for {H} (2 columns × 123.5 mm): make room there, or narrow "
                          "it here, then move it"),
    "m.edit.notOpen": ({}, "this page is not open: open it again"),
    "m.edit.unknownCommand": ({"cmd": "fly"}, "unknown command 'fly'"),
    "m.edit.missing": ({"fields": "session, page"}, "missing session, page"),
    "m.edit.invalid": ({}, "the request is not valid"),
    # MSG-21: no error's English inside the sentence any more (it is logged where it is caught)
    "m.edit.engineFailed": ({}, "something went wrong in the engine"),
    "m.move.whichStory": ({}, "Say which story to move."),
    "m.move.whichPage": ({}, "Say which page to move the story to, as a page number."),
    "m.move.samePage": ({}, "The story is on this page already: choose another page."),
    "m.move.noPage": ({"page": 3}, "This layout has no page 3."),
    "m.move.notLaidOut": ({"page": 4}, "Page 4 was not laid out in this layout: a story cannot move there."),
    'm.store.pasteText': ({}, 'Paste the articles as text.'),
    'm.store.dateFormat': ({}, "Give the edition's date as YYYY-MM-DD, for example 2026-10-21."),
    'm.store.notADate': ({'value': '2026-02-30'}, '2026-02-30 is not a real date.'),
    'm.store.pages': ({}, 'An edition has 4, 8 or 16 pages.'),
    'm.store.priority': ({}, 'Priority is 1 (Lead), 2 (Top), 3 (Normal) or 4 (Minor).'),
    'm.store.pageRange': ({'pages': 8}, 'The page must be empty (the Desk chooses) or a page number from 1 to 8.'),
    'm.store.needHeadline': ({}, 'Every article needs a headline.'),
    'm.store.needText': ({}, 'Every article needs some text.'),
    'm.store.tooManyEditions': ({}, 'There are too many editions for this date.'),
    'm.store.dateFixed': ({}, 'The date of an edition cannot be changed. Make a new edition for the other date.'),
    'm.store.deleteRunning': ({}, 'Pages for this edition are being made. Cancel that first, then delete it.'),
    'm.store.deleteSaving': ({}, 'A page of this edition is being changed or saved. Wait a moment, then delete it.'),
    'm.store.adBusy': ({}, 'Ads cannot be changed while the pages are being made. Wait until that finishes, or cancel it.'),
    'm.store.wordNone': ({'reasons': 'Every article needs some text.'}, 'No story in this Word file could be added: Every article needs some text.'),
    'm.store.wordNoneBare': ({}, 'No story in this Word file could be added.'),
    'm.store.pasteNone': ({}, "No articles were found. Put each article's headline on its first line, its text below it, and a line with only --- between articles."),
    'm.store.pasteParts': ({'n': 2}, '2 part(s) had a headline but no text.'),
    'm.img.tooManyPixels': ({}, 'This picture has too many pixels for the Desk. Save it smaller and try again.'),
    'm.img.notAPicture': ({}, 'This file is not a picture the Desk can read. Use a JPEG, PNG or WebP file.'),
    'm.img.format': ({'fmt': 'GIF'}, 'This picture is a GIF file. Use a JPEG, PNG or WebP file.'),
    'm.img.damaged': ({}, 'The picture file is damaged or incomplete. Try saving it again.'),
    'm.img.tooLarge': ({}, 'This picture file is larger than 40 MB. Save it smaller and try again.'),
    'm.img.none': ({}, 'No picture was sent.'),
    'm.img.noProfile': ({}, 'Photos cannot be converted for print: the newsprint colour profile is missing. Put it at ~/PageinatorPrivate/icc/ or set PAGEINATOR_ICC to its file.'),
    'm.img.badProfile': ({'error': 'cannot open profile'}, 'The newsprint colour profile could not be used: it must be a CMYK printer profile (cannot open profile).'),
    "m.save.notChanged": ({"reason": "this page has no stories to lay out"},
                          "The page could not be changed: this page has no stories to lay out."),
    "m.save.engineNotStarted": ({"why": "no fonts"}, "The page editor's engine did not start: no fonts"),
    "m.save.engineNotStartedLog": ({}, "The page editor's engine did not start. See edit-service.log in the desk home."),
    "m.save.engineStopped": ({}, "The page editor's engine stopped. Try again."),
    "m.save.engineSlow": ({}, "The page editor's engine stopped or took too long. Try again."),
    "m.save.unfinished": ({}, "The last save of this page did not finish: save it again."),
    "m.save.movedHere": ({"page": 2}, "A story was moved here from page 2: check its place and save the page."),
    "m.save.taking": ({"page": 3}, "Page 3 is taking a story from this page: when page 3 has been saved, open this page, "
                                   "fill the space and save it."),
    "m.save.movedFrom": ({"page": 1}, "A story moved from this page to page 1: open it, fill the space and save it."),
    "m.save.filesNotFinished": ({}, "The page was saved, but its files could not be finished."),       # MSG-21
    "m.save.heldUnreadable": ({}, "This page cannot be saved yet: the engine's list of its stories locked on other pages "
                                  "cannot be read."),
    "m.save.held": ({"name": H, "page": 2}, f"This page cannot be saved yet: {H} is also on page 2, locked there. Unlock "
                                            "it on page 2, or take it off this page, then save."),
    "m.save.heldMore1": ({}, "1 more story on this page is locked on another page too."),
    "m.save.heldMoreN": ({"n": 2}, "2 more stories on this page are locked on another page too."),
    "m.save.notPlacedEdited": ({}, "Taken off the pages in the editor, or moved to a page not saved yet: bring it back "
                                   "onto a page, or save the page it moved to."),
    "m.save.deletedAfter": ({}, "Deleted from the edition after the layout."),
    "m.press.olderDesk": ({}, "This page was made by an older version of the Desk, which did not record what its PDF "
                              "prints: lay the edition out again."),
    "m.press.olderRecord": ({}, "This page was made by an older version of the Desk, which recorded what its PDF prints "
                                "in another way: open it in the page editor and save it (or lay out again)."),
    "m.press.damaged": ({}, "This page could not be checked against the edition (a file of the layout or the edition "
                            "cannot be read): put the file back from a backup, or lay the edition out again."),
    "m.press.pagesChanged": ({"now": 8, "then": 4}, "The edition now has 8 pages; this layout has 4: lay the edition out again."),
    "m.press.backAdsOn": ({}, "Back-page ads were switched on after this layout: lay the edition out again."),
    "m.press.backAdsOff": ({}, "Back-page ads were switched off after this layout: lay the edition out again."),
    "m.press.changed1": ({}, "An article on this page was changed since the page's PDF was made: open the page and save "
                             "it (Save page sets the current text first)."),
    "m.press.changedN": ({"n": 3}, "3 articles on this page were changed since the page's PDF was made: open the page "
                                   "and save it (Save page sets the current text first)."),
    "m.press.gone1": ({}, "An article on this page was deleted from the edition: open the page and save it (Save page "
                          "takes it off first)."),
    "m.press.goneN": ({"n": 2}, "2 articles on this page were deleted from the edition: open the page and save it (Save "
                                "page takes them off first)."),
    "m.press.folio": ({}, "The volume, issue or price changed: open the page and save it."),
    "m.press.ad": ({}, "An advertisement on this page changed: open the page and save it (Save page sets the new one first)."),
    "m.warn.issueNotSet": ({}, "Issue number (अंक) not set in step 1: the front page keeps the old number"),
    "m.warn.overlap": ({}, "stories overlap on the page"),
    "m.warn.outside": ({}, "a story is outside the news area or over an advertisement"),
    "m.warn.overset": ({"n": 3}, "3 lines of text did not fit"),
    "m.warn.unsetN": ({"n": 2}, "2 paragraphs could not be set (a character the stand-in fonts lack)"),
    "m.warn.unset": ({}, "paragraphs could not be set (a character the stand-in fonts lack)"),
    "m.warn.touch": ({}, "two lines of a story touch in ink somewhere: check the page"),
    "m.warn.emptyArea": ({"n": 37}, "About 37 cm² of the news area is left empty: add a short item or a photo"),
    "m.warn.notFill": ({}, "These stories do not fill the page exactly; the layout may fail"),
    "m.warn.emptyFoot": ({"mm": 42}, "About 42 mm of the page is left empty at the foot — add a short item or a photo"),
    "m.warn.charRemoved": ({"what": "काल्पनिक (body)", "code": 0x0915},
                           "काल्पनिक (body): removed a character the fonts do not have (U+0915)"),
    "m.warn.sameHeadline": ({"article": "a-0123456789"},
                            "Same headline as another article (a-0123456789) — is it the same story twice?"),
    "m.warn.photoSmall": ({"px": 180}, "Photo too small to print even one column wide (180 pixels across) — the story "
                                       "runs without it"),
    "m.run.reading": ({}, "Reading the articles"),
    "m.run.noArticles": ({}, "No articles with a headline and body text"),
    "m.run.stopped": ({}, "Stopped before it finished"),
    "m.run.measured": ({"done": 12, "total": 40}, "Measured 12 of 40 stories"),
    "m.run.choosing": ({}, "Choosing the stories for each page"),
    "m.run.layingOut": ({}, "Laying out the pages"),
    "m.run.noStoriesLeft": ({}, "No stories left for this page"),
    "m.run.allLaidOut": ({}, "All pages laid out"),
    "m.run.someFailed": ({"failed": 1, "total": 8}, "1 of 8 pages could not be laid out"),
    "m.run.pageFailed": ({}, "layout failed"),
    "m.run.tooManyModules": ({"n": 14, "max": 11}, "14 modules: more than the layout search takes (11)"),
    "m.run.noStoriesPage": ({}, "no stories for this page"),
    "m.run.outOfTime": ({}, "the layout search ran out of time"),
    "m.run.notFillExactly": ({}, "these stories do not fill the page exactly"),
    "m.run.restarted": ({}, "The server was restarted while this run was in progress. Start it again."),
    "m.run.waiting": ({}, "Waiting for another edition's pages to finish."),
    "m.run.starting": ({}, "Starting…"),
    "m.run.cancelledBefore": ({}, "Cancelled before it started."),
    "m.run.cancelled": ({}, "Cancelled."),
    "m.run.editionChanged": ({}, "Set aside: the edition's date or pages changed after this layout. Lay it out again."),
    "m.run.engineStarted": ({}, "The layout engine has started."),
    "m.run.engineNotStarted": ({"error": "No such file or directory"},
                               "The layout engine could not be started: No such file or directory."),
    "m.run.putting": ({}, "Putting the edition PDF and the press files together…"),
    "m.run.noPages": ({}, "The layout engine finished but made no pages."),
    "m.run.notMerged": ({}, "The pages were made, but they could not be put into one file."),           # MSG-21
    "m.run.checking": ({}, "Checking every page with the independent PDF/X-1a checker…"),
    "m.run.made1": ({}, "1 page made."),
    "m.run.madeN": ({"n": 4}, "4 pages made."),
    "m.run.madeFailed": ({"n": 1}, "1 could not be made: see the notes on those pages."),
    "m.run.checkProblems": ({"files": "page-02.pdf, page-03.pdf"},
                            "The PDF/X-1a check found problems in page-02.pdf, page-03.pdf: do not send those to the press."),
    "m.run.noArticlesYet": ({}, "There are no articles in this edition yet."),
    "m.run.alreadyRunning": ({}, "Pages for this edition are already being made. Wait for them, or cancel that run first."),
    "m.run.finished": ({}, "This run has already finished."),
    "m.plan.needsText": ({}, "It needs a headline and some body text"),
    "m.plan.notMeasured": ({"why": "a font is missing"}, "could not be measured (a font is missing)"),
    "m.plan.headlineTooLong": ({}, "Its headline is too long to set (at most four lines) — shorten the headline"),
    "m.plan.tooLong": ({}, "Too long for a whole page — shorten it"),
    "m.plan.noRoom": ({}, "No room left — add pages, lower another story's priority, or pin it to a page"),
    "m.plan.pinnedFull": ({"max": 10, "page": 2}, "More than 10 stories are pinned to page 2 — pin it to another page"),
    "m.plan.noRoomOnPage": ({"page": 5}, "No room on page 5 — it waits: pin it to another page, or shorten the page's stories"),
    "m.plan.pageFailed": ({"n": 3, "message": "the layout search ran out of time"},
                          "Page 3 could not be laid out: the layout search ran out of time"),
    # Pageinator story bundles (PR 24): new messages, the English as first written (there was no older text)
    "m.bundle.notZip": ({}, "This is not a Pageinator stories file (a .zip made by Pageinator). Download it again from "
                            "Pageinator and try again."),
    "m.bundle.damaged": ({}, "This Pageinator stories file is damaged. Download it again and try again."),
    "m.bundle.tooLarge": ({}, "This Pageinator stories file is larger than 200 MB."),
    "m.bundle.unpacksTooLarge": ({}, "This Pageinator stories file unpacks to more than 300 MB."),
    "m.bundle.tooManyFiles": ({"max": 202}, "This Pageinator stories file holds more than 202 files."),
    "m.bundle.memberTooLarge": ({"name": "photos/x.png"},
                                "photos/x.png in this Pageinator stories file is larger than the Desk takes."),
    "m.bundle.packed": ({"name": "bundle.json"}, "bundle.json in this Pageinator stories file unpacks to far more than "
                                                 "its packed size: the file was refused."),
    "m.bundle.badMember": ({"name": "../x"}, "This Pageinator stories file holds ../x, which such a file never holds: "
                                             "the file was refused."),
    "m.bundle.noJson": ({}, "This file has no bundle.json: it is not a Pageinator stories file."),
    "m.bundle.badJson": ({}, "The bundle.json in this file cannot be read."),
    "m.bundle.version": ({"format": "pageinator.story-bundle/2"}, "This Pageinator stories file is in a format this "
                         "Desk does not read (pageinator.story-bundle/2): update the Desk, or make the file again."),
    "m.bundle.unknownField": ({"field": "stories[0].colour"}, "This Pageinator stories file has a field this Desk does "
                              "not know (stories[0].colour): update the Desk, or make the file again."),
    "m.bundle.badField": ({"field": "stories[2].priority"},
                          "This Pageinator stories file has a field that is missing or not valid (stories[2].priority)."),
    "m.bundle.tooManyStories": ({"max": 200}, "This Pageinator stories file holds more than 200 stories."),
    "m.bundle.storyTwice": ({"story": "st-1"}, "This Pageinator stories file lists the story st-1 twice."),
    "m.bundle.photoMissing": ({"name": "photos/x.png"},
                              "A photo the stories name is not in this Pageinator stories file (photos/x.png)."),
    "m.bundle.badSha": ({"name": "photos/x.png"}, "A photo in this Pageinator stories file does not match its SHA-256 "
                        "checksum (photos/x.png): the file was changed or damaged. Download it again."),
    "m.bundle.otherDate": ({"date": "2026-08-01", "edition": "2026-08-02"}, "These stories are for the edition of "
                           "2026-08-01; this edition is of 2026-08-02. Open that edition, or make the file again."),
    "m.bundle.otherPages": ({"sent": 8, "pages": 4}, "The stories were sent for an edition of 8 pages; this one has 4: "
                            "a story pinned to a page it does not have was refused."),
    "m.bundle.keptEdited": ({}, "Changed in the Desk since it was imported: kept as it is."),
    "m.bundle.keptNewer": ({"revision": 3}, "The Desk has a newer revision of it (revision 3): kept as it is."),
    "m.bundle.retry": ({}, "It changed in the Desk while the file was being read: import the file again."),
    "m.bundle.zip64": ({}, "This Pageinator stories file is in the ZIP64 form, which the Desk does not take: make the "
                           "file again."),
    "m.bundle.deletedInDesk": ({}, "Deleted in the Desk after it was imported: not added again."),
    # a Word file's refusals and notes (deskserver/docx.py, MSG-5): the English as docx.py wrote it
    "m.docx.overSize": ({}, "This Word file is larger than 20 MB."),
    "m.docx.protected": ({}, "This Word file is protected with a password, or is an old .doc file: save it as .docx "
                             "without a password and try again."),
    "m.docx.tooLarge": ({}, "This Word file is too large to read."),
    "m.docx.damaged": ({}, "This Word file is damaged. Save it again and try again."),
    "m.docx.notWord": ({}, "This is not a Word (.docx) file. Save it as .docx and try again."),
    "m.docx.noStory": ({}, "No story was found in this Word file: it needs a headline and some text."),
    "m.docx.tooManyStories": ({"max": 200}, "This file holds more than 200 stories; only the first 200 were imported."),
    "m.docx.emptyHeading1": ({}, "1 heading had no text under it and was not imported."),
    "m.docx.emptyHeadingsN": ({"n": 3}, "3 headings had no text under them and were not imported."),
    "m.docx.table1": ({}, "1 table was not imported: copy its text into the article if it is needed."),
    "m.docx.tablesN": ({"n": 2}, "2 tables were not imported: copy their text into the article if it is needed."),
    "m.docx.textBox1": ({}, "1 text box was not imported."),
    "m.docx.textBoxesN": ({"n": 4}, "4 text boxes were not imported."),
    "m.docx.picture1": ({}, "1 picture was not imported: add photos in the Desk."),
    "m.docx.picturesN": ({"n": 5}, "5 pictures were not imported: add photos in the Desk."),
    "m.docx.formatting": ({}, "Formatting (bold, italic, sizes) is not kept: the Desk sets the type."),
    "m.bundle.adMissing": ({"name": "ads/x.png"}, "An ad the file names is not in this Pageinator stories file "
                                                  "(ads/x.png)."),
    "m.bundle.adNoSlot": ({"slot": "back-9"}, "The pages of this edition have no ad space called back-9."),
    "m.bundle.adKept": ({"slot": "back-1"}, "The ad space back-1 has other artwork in the Desk: kept as it is. Remove it "
                                            "in the Desk and import the file again to take the file's."),
    "m.bundle.adRefused": ({"slot": "back-1", "reason": "Not a picture."}, "The ad for back-1 was not added. Not a "
                                                                            "picture."),
    "m.bundle.keptVolume": ({"sent": "12", "desk": "11"}, "The file's volume is “12”; this edition's is “11”: the "
                            "Desk's is kept. If the file's is right, change it in this edition's settings."),
    "m.bundle.keptIssue": ({"sent": "302", "desk": "301"}, "The file's issue number is “302”; this edition's is “301”: "
                           "the Desk's is kept. If the file's is right, change it in this edition's settings."),
    "m.bundle.keptPrice": ({"sent": "₹ 5", "desk": "₹ 4"}, "The file's price is “₹ 5”; this edition's is “₹ 4”: the "
                           "Desk's is kept. If the file's is right, change it in this edition's settings."),
    "m.bundle.backAdsOn": ({}, "The stories were sent for an edition with back-page ads; this one has none: to take the "
                               "file's ads, tick “Back page has ads” in this edition's settings and import the file "
                               "again."),
    "m.bundle.backAdsOff": ({}, "The stories were sent for an edition without back-page ads; this one has them: untick "
                                "“Back page has ads” in this edition's settings if its last page is all news."),
    "m.bundle.adNotInFile": ({"slot": "back-1"}, "The ad in back-1 is in the Desk but not in this file (the hosted "
                                                 "edition no longer has it): remove it in the Desk if it should not "
                                                 "print."),
}


class EveryCodeTests(unittest.TestCase):
    def test_every_code_is_tested_and_says_its_old_english(self):
        self.assertEqual(sorted(OLD), sorted(DM.MESSAGES), "a code without its old text here, or a text without a code")
        for code, (params, old) in OLD.items():
            with self.subTest(code=code):
                said = DM.msg(code, **params)
                self.assertEqual(str(said), old)
                self.assertIsInstance(said, str)
                self.assertEqual(said.wire["code"], code)
                self.assertEqual(set(said.wire["params"]), set(params))


class WireTests(unittest.TestCase):
    def test_values_numbers_data_and_formats(self):
        said = DM.msg("m.edit.moveNoRoom", page=4, name=DM.data(H), w=2, cols="columns", h=123.5)
        self.assertEqual(said.wire["params"], {"page": 4, "name": {"data": H}, "w": 2, "cols": {"data": "columns"},
                                               "h": "123.5"})         # {h:g}: sent as the English shows it
        self.assertEqual(DM.msg("m.edit.moveNoPage", page=9).wire["params"], {"page": "9"})          # {page!r}
        self.assertEqual(DM.msg("m.warn.charRemoved", what="x", code=0x915).wire["params"]["code"], "0915")

    def test_a_message_in_a_message_and_sentences(self):
        inner = DM.msg("m.edit.lockedMove", name=DM.msg("m.name.shortColumn"))
        outer = DM.msg("m.save.notChanged", reason=inner)
        self.assertEqual(outer, "The page could not be changed: the column of short items is locked: unlock it (Shift+L) "
                                "to move it.")
        self.assertEqual(outer.wire["params"]["reason"]["params"]["name"], {"code": "m.name.shortColumn", "params": {}})
        both = DM.join(DM.msg("m.run.madeN", n=4), "", DM.msg("m.run.madeFailed", n=1))
        self.assertEqual(both, "4 pages made. 1 could not be made: see the notes on those pages.")
        self.assertEqual([p["code"] for p in both.wire["parts"]], ["m.run.madeN", "m.run.madeFailed"])

    def test_a_refusal_keeps_its_form_as_an_exception(self):
        try:
            raise ValueError(DM.msg("m.edit.noStories"))
        except ValueError as e:
            self.assertEqual(str(e), "this page has no stories to lay out")
            self.assertEqual(e.args[0].wire["code"], "m.edit.noStories")

    def test_annotate_maps_texts_and_keeps_what_was_read_back(self):
        moved = DM.msg("m.save.movedHere", page=2)
        status = {"pages": [{"page": 1, "needs_save_reason": moved, "warnings": [DM.msg("m.warn.touch"), "plain"]}]}
        DM.annotate(status)
        self.assertEqual(status["msgs"][moved]["params"], {"page": 2})
        self.assertNotIn("plain", status["msgs"])
        back = json.loads(json.dumps(status, ensure_ascii=False))       # written and read again: plain texts
        back["pages"][0]["warnings"] = []                                # a warning gone: its entry goes
        DM.annotate(back)
        self.assertIn(str(moved), back["msgs"])
        self.assertNotIn("two lines of a story touch in ink somewhere: check the page", back["msgs"])
        self.assertNotIn("msgs", DM.annotate({"error": "plain words"}))
        self.assertEqual(DM.from_wire(str(moved), back["msgs"]).wire["code"], "m.save.movedHere")


class ServerAndEngineTests(unittest.TestCase):
    """The places that say these messages: the same English as before, now with codes."""

    def test_stale_reasons(self):
        article = {"id": "a-0123456789", "headline": "काल्पनिक", "body": "मजकूर."}
        printed = {"v": deskprinted.VERSION, "articles": {"a-0123456789": "old", "a-9999999999": "gone"},
                   "folio": "x", "ads": {}}
        said = deskprinted.stale(printed, {"a-0123456789": article}, set(), {}, {})
        self.assertEqual([s.wire["code"] for s in said], ["m.press.changed1", "m.press.gone1", "m.press.folio"])
        self.assertEqual(said[1], OLD["m.press.gone1"][1])
        self.assertEqual(deskprinted.stale({"v": 0}, {}, set(), {}, {}), [OLD["m.press.olderRecord"][1]])

    def test_save_warnings_and_held(self):
        out = editing._warnings([{"kind": "overset", "lines": 3}, {"kind": "touch"}, {"kind": "empty", "mm2": 3700}])
        self.assertEqual(out, ["3 lines of text did not fit", "two lines of a story touch in ink somewhere: check the page",
                               "About 37 cm² of the news area is left empty: add a short item or a photo"])
        self.assertEqual([w.wire["code"] for w in out], ["m.warn.overset", "m.warn.touch", "m.warn.emptyArea"])
        held = editing.locked_elsewhere({"locked_on_pages": {"s1": 2, "s2": 3}, "notes": [{"story": "s1", "headline": "क"}]})
        self.assertEqual(held, "This page cannot be saved yet: “क” is also on page 2, locked there. Unlock it on page 2, "
                               "or take it off this page, then save. 1 more story on this page is locked on another page too.")
        self.assertEqual([p.get("code") for p in held.wire["parts"]], ["m.save.held", "m.save.heldMore1"])

    def test_moved_here_mark_is_written_with_its_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp)
            (run / "status.json").write_text(json.dumps({"state": "done", "pages": [{"page": 1}, {"page": 2}]}), "utf-8")
            mark = editing.before_move(run, 2, 1)
            status = json.loads((run / "status.json").read_text("utf-8"))
            reason = status["pages"][0]["needs_save_reason"]
            self.assertEqual(reason, OLD["m.save.movedHere"][1])
            self.assertEqual(status["msgs"][reason], {"code": "m.save.movedHere", "params": {"page": 2}})
            editing.unmark_move(run, mark)                                   # the move refused: the mark goes, and its code
            status = json.loads((run / "status.json").read_text("utf-8"))
            self.assertNotIn("msgs", status)

    def test_refused_move_gives_back_the_earlier_reason_with_its_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp)
            earlier = OLD["m.save.unfinished"][1]
            (run / "status.json").write_text(json.dumps({
                "state": "done", "pages": [{"page": 1, "needs_save": True, "needs_save_reason": earlier}, {"page": 2}],
                "msgs": {earlier: {"code": "m.save.unfinished", "params": {}}}}), "utf-8")
            mark = editing.before_move(run, 2, 1)
            status = json.loads((run / "status.json").read_text("utf-8"))
            self.assertNotIn(earlier, status["msgs"])                        # replaced by the move's mark for now
            editing.unmark_move(run, mark)                                   # refused: the earlier reason, and its code
            status = json.loads((run / "status.json").read_text("utf-8"))
            self.assertEqual(status["pages"][0]["needs_save_reason"], earlier)
            self.assertEqual(status["msgs"], {earlier: {"code": "m.save.unfinished", "params": {}}})

    def test_layout_changed_reasons(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp)
            (run / "request.json").write_text(json.dumps({"edition": {"pages": 4, "back_page_ads": True}}), "utf-8")
            out = press._layout_changed(run, {"pages": 8, "back_page_ads": False}, [{"page": 1}, {"page": 4}])
            self.assertEqual(out[1], [OLD["m.press.pagesChanged"][1]])
            self.assertEqual([w.wire["code"] for w in out[4]], ["m.press.pagesChanged", "m.press.backAdsOff"])


if __name__ == "__main__":
    unittest.main()
