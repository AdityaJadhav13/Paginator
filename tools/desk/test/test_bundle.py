"""Tests for Pageinator story bundles (tools/desk/deskserver/bundle.py; CONTRACT.md §6): a fictional bundle built here,
imported through the Desk server with the fake engine of test_server.py. Fictional text only.

    experiments/phase0/pdfx1/.venv/bin/python -B -m unittest tools/desk/test/test_bundle.py
"""
from __future__ import annotations

import hashlib
import io
import json
import stat
import struct
import sys
import time
import unittest
import zipfile
from unittest import mock
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))      # the repository: tools.desk.test.test_server

from tools.desk.test.test_server import DeskCase, jpeg_bytes, png_bytes, word_file, words  # noqa: E402

from deskserver import bundle, docx  # noqa: E402
from deskserver.app import Desk  # noqa: E402
from deskserver.store import Store  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import deskarticles  # noqa: E402

FORMAT = "pageinator.story-bundle/1"
FORMAT2 = "pageinator.story-bundle/2"
URL = "/api/editions/{}/articles/import-bundle"


def story(n: int = 1, **fields) -> dict:
    """A fictional story as the hosted newsroom sends it."""
    s = {"id": f"st-{n:04d}", "revision": 1, "headline": f"काल्पनिक बातमी {n}", "kicker": "", "deck": "",
         "byline": "प्रतिनिधी, नवनगर", "body": f"पहिला काल्पनिक परिच्छेद {n}.\n\nदुसरा परिच्छेद.", "body_format": "desk-text/1",
         "section": "शहर", "priority": 3, "page": None, "language": "mr", "photo": None}
    s.update(fields)
    return s


def photo(data: bytes, ext: str = "png", **fields) -> dict:
    sha = hashlib.sha256(data).hexdigest()
    return {"file": f"photos/{sha}.{ext}", "sha256": sha, "filename": f"fictional-photo.{ext}",
            "caption": "काल्पनिक छायाचित्र", "credit": "छाया: काल्पनिक", **fields}


def bundle_zip(stories: list[dict], files: dict[str, bytes] | None = None, *, day: str = "2026-08-01", pages: int = 8,
               doc: dict | None = None, extra: list[tuple[zipfile.ZipInfo | str, bytes]] = (),
               raw_json: bytes | None = None) -> bytes:
    """A pageinator.story-bundle/1 ZIP: bundle.json (or raw_json as it is), the photo files given (by name) and any
    extra members."""
    doc = doc or {"format": FORMAT, "bundle": {"id": "b-fictional-1", "created": "2026-08-01T06:00:00+05:30"},
                  "source": {"organisation_id": "org-fictional", "publication_id": "pub-fictional"},
                  "edition": {"date": day, "pages": pages}, "stories": stories}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("bundle.json", raw_json if raw_json is not None else json.dumps(doc, ensure_ascii=False))
        for name, data in (files or {}).items():
            z.writestr(name, data)
        for name, data in extra:
            z.writestr(name, data)
    return buf.getvalue()


def ad(data: bytes, slot: str = "back-1", page: int = 8, ext: str = "png") -> dict:
    """A fictional ad as the hosted newsroom sends it (its original artwork for a back-page slot)."""
    sha = hashlib.sha256(data).hexdigest()
    return {"slot": slot, "page": page, "file": f"ads/{sha}.{ext}", "sha256": sha, "filename": f"p-0123456789.{ext}"}


def bundle2(stories: list[dict], ads: list[dict] = (), files: dict[str, bytes] | None = None, *, day: str,
            pages: int = 8, back: bool = True, extra: list = (), **settings) -> bytes:
    """A pageinator.story-bundle/2 ZIP: /1 plus the edition's settings (volume, issue, price: empty unless given) and
    its ads."""
    edition = {"date": day, "pages": pages, "back_page_ads": back, "volume": "", "issue": "", "price": "", **settings}
    return bundle_zip(stories, files, extra=extra, doc={
        "format": FORMAT2, "bundle": {"id": "b-fictional-2", "created": "2026-09-01T06:00:00+05:30"},
        "source": {"organisation_id": "org-fictional", "publication_id": "pub-fictional"}, "edition": edition,
        "stories": stories, "ads": list(ads)})


def as_zip64(data: bytes, entries: int | None = None) -> bytes:
    """The same ZIP with the ZIP64 end records (zipfile reads its counts from them); entries: the count it then lists."""
    at = len(data) - 22
    _, _, _, n_this, n_total, size, offset, _ = struct.unpack("<4s4H2LH", data[at:])
    n = n_total if entries is None else entries
    record = struct.pack("<4sQ2H2L4Q", b"PK\x06\x06", 44, 45, 45, 0, 0, n, n, size, offset)
    locator = struct.pack("<4sLQL", b"PK\x06\x07", 0, at, 1)
    end = struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0)
    return data[:at] + record + locator + end


def directory_bomb(entries: int) -> bytes:
    """A ZIP whose central directory lists one small file `entries` times (the review's probe, smaller): zipfile reads
    every entry into memory before anything else."""
    name = b"a"
    local = struct.pack("<4s5H3L2H", b"PK\x03\x04", 20, 0, 0, 0, 0, 0, 0, 0, len(name), 0) + name
    central = struct.pack("<4s6H3L5H2L", b"PK\x01\x02", 20, 20, 0, 0, 0, 0, 0, 0, 0, len(name), 0, 0, 0, 0, 0, 0) + name
    cd = central * entries
    return as_zip64(local + cd + struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 0, 0, len(cd), len(local), 0), entries)


def snapshot(folder: Path) -> dict[str, tuple[int, str] | None]:
    """Every file and folder under folder: its path, and a file's size and SHA-256."""
    return {str(p.relative_to(folder)): (p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest()) if p.is_file()
            else None for p in sorted(folder.rglob("*"))}


class BundleCase(DeskCase):
    def send(self, eid: str, data: bytes, expect: int = 200):
        return self.call("POST", URL.format(eid), raw=data, headers={"Content-Type": "application/zip"}, expect=expect)

    def ads_dir(self, eid: str) -> Path:
        return self.edition_dir(eid) / "ads"

    def articles(self, eid: str) -> list[dict]:
        return self.call("GET", f"/api/editions/{eid}").json()["articles"]

    def refused(self, eid: str, data: bytes, code: str, status: int = 400) -> dict:
        """A bundle refused as a whole: its code, and nothing written (every file of the edition the same: path, size
        and SHA-256; no folder added or removed)."""
        before = snapshot(self.edition_dir(eid))
        r = self.send(eid, data, expect=status).json()
        self.assertEqual(r["msgs"][r["error"]]["code"], code, r)
        self.assertEqual(snapshot(self.edition_dir(eid)), before)
        return r


class ImportTests(BundleCase):
    def test_a_bundle_becomes_articles_cleaned_as_typed_ones(self):
        eid = self.edition("2026-08-01")
        pic = png_bytes((300, 200))
        # trailing spaces and a decomposed letter (न + nukta, NFD) are cleaned as typed text is (desk-text/1 has no "\r")
        one = story(1, headline="  काल्पनिक मथळा  ", body="पहिली ओळ.  \n\nदुसरी ओळ \u0928\u093c.  ", kicker="नवनगर",
                    priority=1, page=2, photo=photo(pic))
        two = story(2, language="en", section=None, headline="A fictional story", byline="", body=words(80))
        res = self.send(eid, bundle_zip([one, two], {one["photo"]["file"]: pic})).json()
        self.assertEqual([len(res[k]) for k in ("added", "replaced", "unchanged", "kept", "refused")], [2, 0, 0, 0, 0])
        self.assertEqual(res["bundle"], {"id": "b-fictional-1", "edition": "2026-08-01", "stories": 2})
        arts = {a["bundle"]["story"]: a for a in self.articles(eid)}
        a = arts["st-0001"]
        typed = self.article(eid, headline=one["headline"], body=one["body"])      # the same text, typed
        self.assertEqual((a["headline"], a["body"]), (typed["headline"], typed["body"]))
        self.assertEqual((a["headline"], a["body"]), ("काल्पनिक मथळा", "पहिली ओळ.\n\nदुसरी ओळ \u0929."))
        self.assertEqual((a["kicker"], a["priority"], a["page"], a["source"]), ("नवनगर", 1, 2, "bundle"))
        rec = a["bundle"]
        self.assertEqual((rec["organisation_id"], rec["publication_id"], rec["revision"], rec["section"],
                          rec["language"], rec["photo_sha256"], rec["photo_filename"]),
                         ("org-fictional", "pub-fictional", 1, "शहर", "mr", one["photo"]["sha256"], "fictional-photo.png"))
        self.assertEqual((a["photo"]["caption"], a["photo"]["credit"], a["photo"]["width_px"]),
                         ("काल्पनिक छायाचित्र", "छाया: काल्पनिक", 300))
        pdir = self.edition_dir(eid) / "photos"
        pid = a["photo"]["id"]
        self.assertEqual((pdir / f"{pid}.orig.png").read_bytes(), pic)                 # the original, unchanged
        self.assertTrue((pdir / f"{pid}.cmyk.gz").is_file() and (pdir / f"{pid}.jpg").is_file())
        self.assertIn(pid, json.loads((pdir / "index.json").read_text())["elements"])
        self.assertEqual(arts["st-0002"]["bundle"]["section"], None)
        self.assertFalse(any(p.name.startswith(".bundle-") for p in self.edition_dir(eid).iterdir()))
        self.call("GET", f"/files/{eid}/photos/{pid}.jpg")

    def test_reimport_replaces_only_what_the_desk_did_not_change(self):
        eid = self.edition("2026-08-02")
        pic, pic2 = png_bytes((200, 100)), png_bytes((120, 90), color=(0, 0, 200, 255))
        stories = [story(1, photo=photo(pic)), story(2), story(3), story(4)]
        self.send(eid, bundle_zip(stories, {stories[0]["photo"]["file"]: pic}, day="2026-08-02"))
        ids = {a["bundle"]["story"]: a["id"] for a in self.articles(eid)}
        first_photo = next(a for a in self.articles(eid) if a["id"] == ids["st-0001"])["photo"]["id"]
        # the Desk changes story 2's text and story 3's priority; story 4 is left alone
        self.call("PUT", f"/api/editions/{eid}/articles/{ids['st-0002']}", {"body": "डेस्कवर बदललेला मजकूर."})
        self.call("PUT", f"/api/editions/{eid}/articles/{ids['st-0003']}", {"priority": 1})
        again = [story(1, revision=2, body="नवी आवृत्ती.", photo=photo(pic, caption="नवा मथळा")),
                 story(2, revision=2, body="वृत्तकक्षातील नवी आवृत्ती."), story(3, revision=2), story(4), story(5)]
        res = self.send(eid, bundle_zip(again, {again[0]["photo"]["file"]: pic}, day="2026-08-02")).json()
        self.assertEqual([s["story"] for s in res["replaced"]], ["st-0001"])
        self.assertEqual([s["story"] for s in res["unchanged"]], ["st-0004"])
        self.assertEqual([s["story"] for s in res["added"]], ["st-0005"])
        self.assertEqual([(s["story"], s["article"]) for s in res["kept"]], [("st-0002", ids["st-0002"]),
                                                                            ("st-0003", ids["st-0003"])])
        self.assertEqual({res["msgs"][s["reason"]]["code"] for s in res["kept"]}, {"m.bundle.keptEdited"})
        arts = {a["id"]: a for a in self.articles(eid)}
        one = arts[ids["st-0001"]]                                                      # same article, new text
        self.assertEqual((one["body"], one["bundle"]["revision"], one["photo"]["caption"]), ("नवी आवृत्ती.", 2, "नवा मथळा"))
        self.assertEqual(one["photo"]["id"], first_photo)                              # the same photo: not converted again
        self.assertEqual(arts[ids["st-0002"]]["body"], "डेस्कवर बदललेला मजकूर.")
        self.assertEqual(arts[ids["st-0003"]]["priority"], 1)
        self.assertEqual(len(arts), 5)
        # a new photo for story 1 (revision 3): a new photo id, the old one's files go
        third = [story(1, revision=3, body="नवी आवृत्ती.", photo=photo(pic2, ext="png"))]
        res = self.send(eid, bundle_zip(third, {third[0]["photo"]["file"]: pic2}, day="2026-08-02")).json()
        self.assertEqual(len(res["replaced"]), 1)
        now = next(a for a in self.articles(eid) if a["id"] == ids["st-0001"])["photo"]
        self.assertNotEqual(now["id"], first_photo)
        self.assertEqual(now["width_px"], 120)
        self.assertFalse(list((self.edition_dir(eid) / "photos").glob(f"{first_photo}.*")))
        # an older revision than the Desk's: kept
        res = self.send(eid, bundle_zip([story(1, revision=2)], day="2026-08-02")).json()
        self.assertEqual(res["msgs"][res["kept"][0]["reason"]], {"code": "m.bundle.keptNewer", "params": {"revision": 3}})
        # a photo's caption changed in the Desk counts as a change
        self.call("PUT", f"/api/editions/{eid}/articles/{ids['st-0001']}/photo-text", {"caption": "डेस्कचा मथळा"})
        res = self.send(eid, bundle_zip([story(1, revision=4)], day="2026-08-02")).json()
        self.assertEqual([s["story"] for s in res["kept"]], ["st-0001"])

    def test_a_story_the_desk_would_refuse_is_refused_and_the_others_added(self):
        eid = self.edition("2026-08-03", pages=4)
        junk = b"not a picture, only fictional bytes"
        stories = [story(1, photo=photo(junk)), story(2, headline="   "), story(3, page=8), story(4),
                   story(5, priority=2, body="x" * 200_001)]
        res = self.send(eid, bundle_zip(stories, {stories[0]["photo"]["file"]: junk}, day="2026-08-03")).json()
        self.assertEqual([s["story"] for s in res["added"]], ["st-0004"])
        codes = {s["story"]: res["msgs"].get(s["reason"], {}).get("code") for s in res["refused"]}
        self.assertEqual(codes, {"st-0001": "m.img.notAPicture", "st-0002": "m.store.needHeadline",
                                 "st-0003": "m.store.pageRange", "st-0005": None})   # "too long": util's English
        self.assertIn("too long", next(s["reason"] for s in res["refused"] if s["story"] == "st-0005"))
        self.assertEqual(res["msgs"][res["notes"][0]]["code"], "m.bundle.otherPages")
        self.assertEqual(len(self.articles(eid)), 1)
        self.assertEqual([p.name for p in (self.edition_dir(eid) / "photos").iterdir()], [])


class RefusalTests(BundleCase):
    def test_bundles_that_are_not_sound_are_refused_whole(self):
        eid = self.edition("2026-08-04")
        pic = png_bytes((50, 50))
        good = story(1, photo=photo(pic))
        files = {good["photo"]["file"]: pic}
        day = "2026-08-04"
        self.refused(eid, b"plain fictional text", "m.bundle.notZip")
        self.refused(eid, bundle_zip([good], files, day=day)[:200], "m.bundle.damaged")
        self.refused(eid, bundle_zip([good], files, day=day, doc={"format": "pageinator.story-bundle/3"}),
                     "m.bundle.version")
        r = self.refused(eid, bundle_zip([{**good, "colour": "red"}], files, day=day), "m.bundle.unknownField")
        self.assertEqual(r["msgs"][r["error"]]["params"]["field"], {"data": "stories[0].colour"})
        for bad in ({"revision": 0}, {"priority": 5}, {"body_format": "html"}, {"language": "Marathi"},
                    {"id": "../x"}, {"headline": None}, {"page": 0}):
            self.refused(eid, bundle_zip([{**good, **bad}], files, day=day), "m.bundle.badField")
        no_page = dict(good)
        del no_page["page"]
        self.refused(eid, bundle_zip([no_page], files, day=day), "m.bundle.badField")
        self.refused(eid, bundle_zip([good, story(1)], files, day=day), "m.bundle.storyTwice")
        self.refused(eid, bundle_zip([good], {}, day=day), "m.bundle.photoMissing")
        self.refused(eid, bundle_zip([good], files, day="2026-08-05"), "m.bundle.otherDate")
        # a photo whose bytes are not the ones its SHA-256 names: the whole bundle, though the other story is fine
        other = png_bytes((60, 60))
        two = [story(2), {**good, "photo": photo(pic)}]
        self.refused(eid, bundle_zip(two, {good["photo"]["file"]: other}, day=day), "m.bundle.badSha")
        no_json = io.BytesIO()
        with zipfile.ZipFile(no_json, "w") as z:
            z.writestr(good["photo"]["file"], pic)
        self.refused(eid, no_json.getvalue(), "m.bundle.noJson")
        self.assertEqual(self.articles(eid), [])

    def test_paths_links_and_zip_bombs(self):
        eid = self.edition("2026-08-06")
        day = "2026-08-06"
        for name in ("../escape.txt", "/etc/fictional", "photos/../../x.png", "notes.txt", "photos\\x.png",
                     "photos/sub/"):
            r = self.refused(eid, bundle_zip([story(1)], day=day, extra=[(name, b"x")]), "m.bundle.badMember")
            self.assertEqual(r["msgs"][r["error"]]["params"]["name"], {"data": name})
        link = zipfile.ZipInfo("photos/" + "a" * 64 + ".png")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        named = story(1, photo={**photo(b"x"), "file": link.filename, "sha256": "a" * 64})   # a story names it
        self.refused(eid, bundle_zip([named], day=day, extra=[(link, b"/etc/passwd")]), "m.bundle.badMember")
        unused = "photos/" + "b" * 64 + ".png"
        self.refused(eid, bundle_zip([story(1)], day=day, extra=[(unused, png_bytes((5, 5)))]), "m.bundle.badMember")
        bomb = b"\0" * (8 * 1024 * 1024)                                     # 8 MB of zeros pack to a few KB
        sha = hashlib.sha256(bomb).hexdigest()
        s = story(1, photo={**photo(bomb), "file": f"photos/{sha}.png"})
        self.refused(eid, bundle_zip([s], {s["photo"]["file"]: bomb}, day=day), "m.bundle.packed", 413)
        padded = bundle_zip([story(1, body="x" * 1000)], day=day, doc={
            "format": FORMAT, "bundle": {"id": "b-1", "created": "x"},
            "source": {"organisation_id": "o", "publication_id": "p"}, "edition": {"date": day, "pages": 8},
            "stories": [story(1)], "padding": " " * (4 * 1024 * 1024)})
        self.refused(eid, padded, "m.bundle.packed", 413)
        many = bundle_zip([story(1)], day=day, extra=[(f"photos/{n:064x}.png", b"x") for n in range(bundle.MAX_FILES)])
        self.refused(eid, many, "m.bundle.tooManyFiles")
        self.assertEqual(self.articles(eid), [])

    def test_size_limits(self):
        eid = self.edition("2026-08-07")
        saved = bundle.MAX_BYTES, bundle.MAX_UNPACKED
        try:
            bundle.MAX_BYTES = 300
            data = bundle_zip([story(1, body=words(400))], day="2026-08-07")
            self.assertGreater(len(data), 300)
            self.refused(eid, data, "m.bundle.tooLarge", 413)                # before it is read
            bundle.MAX_BYTES = saved[0]
            bundle.MAX_UNPACKED = 100
            self.refused(eid, data, "m.bundle.unpacksTooLarge", 413)
        finally:
            bundle.MAX_BYTES, bundle.MAX_UNPACKED = saved
        self.call("POST", URL.format(eid), raw=b"PK", headers={"X-Desk": ""}, expect=403)
        self.call("POST", URL.format("2099-01-01"), raw=b"PK", expect=404)

    def test_a_write_that_fails_part_way_leaves_nothing(self):
        eid = self.edition("2026-08-09")
        pic = png_bytes((40, 40))
        s = story(1, photo=photo(pic))
        store = self.desk.store

        def broken(d, doc):
            raise OSError("the disk is full (fictional)")
        store._save, saved = broken, store._save
        store.is_active, active = (lambda e: True), store.is_active          # as while a layout runs: gc_photos waits
        try:
            self.send(eid, bundle_zip([s], {s["photo"]["file"]: pic}, day="2026-08-09"), expect=500)
        finally:
            store._save, store.is_active = saved, active
        self.assertEqual(self.articles(eid), [])
        pdir = self.edition_dir(eid) / "photos"
        self.assertEqual([p.name for p in pdir.iterdir() if p.name != "index.json"], [])
        self.assertEqual(json.loads((pdir / "index.json").read_text())["elements"], {})
        self.assertFalse(any(p.name.startswith(".bundle-") for p in self.edition_dir(eid).iterdir()))


class ReviewFixTests(BundleCase):
    def test_a_central_directory_of_millions_is_refused_before_it_is_read(self):
        bomb = directory_bomb(300_000)                              # 300,000 entries; the probe had 4.4 million
        with mock.patch.object(bundle.zipfile, "ZipFile", side_effect=AssertionError("zipfile was opened")):
            start = time.monotonic()
            with self.assertRaises(bundle.DeskError) as e:
                bundle.open_bundle(bomb)
            self.assertLess(time.monotonic() - start, 1.0)
        self.assertEqual(e.exception.message.wire["code"], "m.bundle.zip64")
        plain = bundle_zip([story(1)])                              # no ZIP64: the 16-bit count and the size, checked
        at = len(plain) - 22
        listed = plain[:at + 10] + struct.pack("<HLL", 60_000, 3_000_000, 0) + plain[at + 20:]
        with mock.patch.object(bundle.zipfile, "ZipFile", side_effect=AssertionError("zipfile was opened")):
            with self.assertRaises(bundle.DeskError) as e:
                bundle.open_bundle(listed)
        self.assertEqual(e.exception.message.wire["code"], "m.bundle.tooManyFiles")
        eid = self.edition("2026-08-10")
        self.refused(eid, as_zip64(bundle_zip([story(1)], day="2026-08-10")), "m.bundle.zip64")
        self.send(eid, bundle_zip([story(1)], day="2026-08-10"))   # the same file, without ZIP64: imported

    def test_word_files_have_the_same_guard(self):
        word = word_file([("", "काल्पनिक मथळा"), ("", "काल्पनिक मजकूर.")])
        self.assertEqual(len(docx.articles_from_docx(as_zip64(word))["articles"]), 1)    # ZIP64 itself is read
        for data in (directory_bomb(300_000), as_zip64(word, entries=docx.MAX_ENTRIES + 1)):
            with mock.patch.object(docx.zipfile, "ZipFile", side_effect=AssertionError("zipfile was opened")):
                with self.assertRaises(docx.DocxError) as e:
                    docx.articles_from_docx(data)
            self.assertEqual(str(e.exception), docx.TOO_LARGE)

    def test_desk_text_is_exact(self):
        eid = self.edition("2026-08-11")
        day = "2026-08-11"
        for body in ("एक ओळ\nदुसरी ओळ", "पहिला\n\n\nदुसरा", "\n\nपहिला", "पहिला\n\n", "पहिला\r\n\r\nदुसरा",
                     "##उपशीर्षक", "  ## उपशीर्षक", "## ", "### उपशीर्षक", "पहिला\n\n   \n\nदुसरा"):
            with self.subTest(body=body):
                r = self.refused(eid, bundle_zip([story(1, body=body)], day=day), "m.bundle.badField")
                self.assertEqual(r["msgs"][r["error"]]["params"]["field"], {"data": "stories[0].body"})
        body = "पहिला परिच्छेद, काल्पनिक.\n\n## एक उपशीर्षक\n\nदुसरा   परिच्छेद."
        res = self.send(eid, bundle_zip([story(1, body=body)], day=day)).json()
        got = self.articles(eid)[0]["body"]
        self.assertEqual((len(res["added"]), got), (1, body))
        blocks = body.split("\n\n")                                # one block, one paragraph or subheading: as printed
        self.assertEqual(deskarticles.blocks(got), [("crosshead", "एक उपशीर्षक") if b.startswith("## ") else
                                                    ("para", " ".join(b.split())) for b in blocks])

    def test_a_story_deleted_in_the_desk_is_not_added_again(self):
        eid = self.edition("2026-08-12")
        day = "2026-08-12"
        self.send(eid, bundle_zip([story(1), story(2)], day=day))
        killed = next(a for a in self.articles(eid) if a["bundle"]["story"] == "st-0001")
        self.call("DELETE", f"/api/editions/{eid}/articles/{killed['id']}")
        doc = json.loads((self.edition_dir(eid) / "articles.json").read_text())
        self.assertEqual([(t["story"], t["article"]) for t in doc["bundle_deleted"]], [("st-0001", killed["id"])])
        for revision in (1, 5):                                     # the same revision or a newer one: never again
            res = self.send(eid, bundle_zip([story(1, revision=revision), story(2)], day=day)).json()
            self.assertEqual([(s["story"], res["msgs"][s["reason"]]["code"]) for s in res["deleted"]],
                             [("st-0001", "m.bundle.deletedInDesk")])
            self.assertEqual(res["added"], [])
        self.assertEqual(sorted(a["bundle"]["story"] for a in self.articles(eid)), ["st-0002"])
        typed = self.article(eid)                                   # a typed article deleted leaves no tombstone
        self.call("DELETE", f"/api/editions/{eid}/articles/{typed['id']}")
        doc = json.loads((self.edition_dir(eid) / "articles.json").read_text())
        self.assertEqual(len(doc["bundle_deleted"]), 1)
        other = bundle_zip([story(1)], day=day, doc={              # the same story id from another publication
            "format": FORMAT, "bundle": {"id": "b-2", "created": "x"},
            "source": {"organisation_id": "org-fictional", "publication_id": "pub-other"},
            "edition": {"date": day, "pages": 8}, "stories": [story(1)]})
        self.assertEqual(len(self.send(eid, other).json()["added"]), 1)

    def test_a_lone_surrogate_is_refused_by_name(self):
        eid = self.edition("2026-08-13")
        day = "2026-08-13"
        doc = {"format": FORMAT, "bundle": {"id": "b-1", "created": "x"},
               "source": {"organisation_id": "o", "publication_id": "p"}, "edition": {"date": day, "pages": 8},
               "stories": [story(1, headline="काल्पनिक \ud800 मथळा")]}
        r = self.refused(eid, bundle_zip([], raw_json=json.dumps(doc).encode()), "m.bundle.badField")
        self.assertEqual(r["msgs"][r["error"]]["params"]["field"], {"data": "stories[0].headline"})
        doc["stories"] = [{**story(1), "\udc00": 1}]                 # a key that is not text: its object is named
        r = self.refused(eid, bundle_zip([], raw_json=json.dumps(doc).encode()), "m.bundle.badField")
        self.assertEqual(r["msgs"][r["error"]]["params"]["field"], {"data": "stories[0]"})

    def test_left_over_staging_folders_and_orphan_photos_go_at_start(self):
        home = self.tmp / "home-after-a-crash"
        store = Store(home)
        eid = store.create_edition({"date": "2026-08-14", "pages": 4})["id"]
        d = home / "editions" / eid
        (d / ".bundle-0123456789").mkdir()
        (d / ".bundle-0123456789" / f"{'a' * 64}.orig.png").write_bytes(png_bytes((5, 5)))
        (d / "photos" / "p-0123456789.orig.png").write_bytes(png_bytes((5, 5)))     # linked, never named by an article
        (d / "photos" / "p-0123456789.cmyk.gz").write_bytes(b"x")
        (d / "photos" / "index.json").write_text(json.dumps({"elements": {"p-0123456789": {"width_px": 5}}}))
        desk = Desk(home, static_dir=self.static, poll_interval=0.1, kill_after=1.0, measure_delay=3600.0)
        desk.close()
        self.assertEqual(sorted(p.name for p in d.iterdir() if p.name.startswith(".bundle-")), [])
        self.assertEqual(sorted(p.name for p in (d / "photos").iterdir()), ["index.json"])
        self.assertEqual(json.loads((d / "photos" / "index.json").read_text())["elements"], {})

    def test_names_are_clipped_and_headlines_are_the_desks(self):
        eid = self.edition("2026-08-15")
        day = "2026-08-15"
        long = "photos/" + "x" * 1000
        r = self.refused(eid, bundle_zip([story(1)], day=day, extra=[(long, b"x")]), "m.bundle.badMember")
        shown = r["msgs"][r["error"]]["params"]["name"]["data"]
        self.assertEqual((len(shown), shown[:8], shown[-1]), (200, "photos/x", "…"))
        r = self.refused(eid, bundle_zip([{**story(1), "y" * 1000: 1}], day=day), "m.bundle.unknownField")
        self.assertEqual(len(r["msgs"][r["error"]]["params"]["field"]["data"]), 200)
        res = self.send(eid, bundle_zip([story(1, headline="  काल्पनिक\u0007 मथळा\r\n")], day=day)).json()
        self.assertEqual(res["added"][0]["headline"], "काल्पनिक मथळा")                       # as it is stored
        aid = res["added"][0]["article"]
        self.call("PUT", f"/api/editions/{eid}/articles/{aid}", {"headline": "डेस्कने बदललेला मथळा"})
        res = self.send(eid, bundle_zip([story(1, revision=2, headline="वृत्तकक्षाचा मथळा")], day=day)).json()
        self.assertEqual(res["kept"][0]["headline"], "डेस्कने बदललेला मथळा")                    # the Desk's own


class PrintSafetyTests(BundleCase):
    def test_an_import_marks_laid_out_pages_as_a_typed_change_does(self):
        eid = self.edition("2026-08-08")
        day = "2026-08-08"
        self.send(eid, bundle_zip([story(1, body=words(80), priority=1), story(2, body=words(60), priority=2)], day=day))
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.assertEqual(self.wait_run(eid, rid)["state"], "done")
        status = lambda: self.call("GET", f"/api/editions/{eid}/runs/{rid}").json()       # noqa: E731
        self.assertTrue(status()["press_ready"])
        self.send(eid, bundle_zip([story(1, body=words(80), priority=1)], day=day))          # same revision: nothing
        self.send(eid, bundle_zip([story(3)], day=day))                                      # a new story: no page prints it
        self.assertTrue(status()["press_ready"])
        self.send(eid, bundle_zip([story(1, revision=2, body=words(90), priority=1)], day=day))
        st = status()
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        page = next(p for p in st["pages"] if p["page"] == 1)
        self.assertEqual(st["msgs"][page["stale"][0]]["code"], "m.press.changed1")

    def test_a_setting_and_an_ad_from_a_file_mark_laid_out_pages_and_wait_for_a_running_layout(self):
        eid = self.edition("2026-08-16", volume="slow")
        day = "2026-08-16"
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        art = png_bytes((120, 60))
        data = bundle2([story(1)], [ad(art)], {ad(art)["file"]: art}, day=day, issue="77")
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid, states=("layout",), finished=False)
        res = self.send(eid, data).json()                       # while the pages are made: no ad, as for an upload
        self.assertEqual([(r["slot"], res["msgs"][r["reason"]]["code"]) for r in res["ads"]["refused"]],
                         [("back-1", "m.store.adBusy")])
        self.assertEqual((len(res["added"]), res["settings"]["set"]), (1, {"issue": "77"}))
        self.assertEqual([p.name for p in self.ads_dir(eid).iterdir() if p.name != "index.json"], [])
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/cancel")
        self.wait_run(eid, rid)
        done = self.edition("2026-08-17")
        self.article(done, headline="Lead story", body=words(80), priority=1)
        rid = self.call("POST", f"/api/editions/{done}/runs").json()["run"]
        self.assertEqual(self.wait_run(done, rid)["state"], "done")
        status = lambda: self.call("GET", f"/api/editions/{done}/runs/{rid}").json()       # noqa: E731
        before = status()
        self.assertTrue(before["press_ready"])
        res = self.send(done, bundle2([], [ad(art)], {ad(art)["file"]: art}, day="2026-08-17", issue="78")).json()
        self.assertEqual((res["ads"]["added"], res["settings"]["set"]), ([{"slot": "back-1"}], {"issue": "78"}))
        st = status()
        self.assertFalse(st["press_ready"])
        stale = {p["page"]: [st["msgs"][r]["code"] for r in p["stale"]] for p in st["pages"] if p["stale"]}
        self.assertEqual(stale, {1: ["m.press.folio"], 2: ["m.press.ad"]})     # as a typed issue and an uploaded ad



class AdsAndSettingsTests(BundleCase):
    """pageinator.story-bundle/2: the edition's back-page ad artwork and its volume, issue and price."""

    def codes(self, res: dict, items: list) -> list:
        return [res["msgs"][item]["code"] for item in items]

    def test_ads_and_empty_settings_are_added_as_an_upload_and_a_typed_change_are(self):
        eid = self.edition("2026-09-01")
        day = "2026-09-01"
        art = png_bytes((400, 400), (255, 0, 0, 255))
        a = ad(art)
        data = bundle2([story(1)], [a], {a["file"]: art}, day=day, volume="वर्ष ५", issue="301", price="₹ 5")
        res = self.send(eid, data).json()
        self.assertEqual(len(res["added"]), 1)
        self.assertEqual(res["ads"], {"added": [{"slot": "back-1"}], "unchanged": [], "kept": [], "refused": []})
        self.assertEqual(res["settings"], {"set": {"volume": "वर्ष ५", "issue": "301", "price": "₹ 5"}, "kept": {}})
        self.assertEqual(res["notes"], [])
        got = self.call("GET", f"/api/editions/{eid}").json()
        self.assertEqual([got["edition"][k] for k in ("volume", "issue", "price")], ["वर्ष ५", "301", "₹ 5"])
        adir = self.ads_dir(eid)
        self.assertEqual((adir / "back-1.orig.png").read_bytes(), art)                  # the original, unchanged
        upload = self.edition("2026-09-02")                                            # the same artwork, uploaded
        self.assertEqual(self.call("PUT", f"/api/editions/{upload}/ads/back-1", raw=art).json(),
                         {"slot": "back-1", "w_px": 787, "h_px": 394})
        self.assertEqual((adir / "back-1.cmyk.gz").read_bytes(), (self.ads_dir(upload) / "back-1.cmyk.gz").read_bytes())
        self.assertEqual(json.loads((adir / "index.json").read_text()),
                         {"elements": {"back-1": {"width_px": 787, "height_px": 394, "ppi": None}}})
        self.assertEqual(got["ads"]["back-1"]["w_px"], 787)
        self.assertFalse(any(p.name.startswith(".bundle-") for p in self.edition_dir(eid).iterdir()))
        again = self.send(eid, data).json()                                             # the same file again: nothing
        self.assertEqual(again["ads"]["unchanged"], [{"slot": "back-1"}])
        self.assertEqual((again["settings"], again["notes"]), ({"set": {}, "kept": {}}, []))
        # a /1 file is still taken, with no ads and no settings; /1 with an "ads" key is not /1
        old = self.send(eid, bundle_zip([story(2)], day=day)).json()
        self.assertEqual((len(old["added"]), old["ads"]["added"], old["settings"]), (1, [], {"set": {}, "kept": {}}))
        self.refused(eid, bundle_zip([story(3)], day=day, doc={
            "format": FORMAT, "bundle": {"id": "b-1", "created": "x"},
            "source": {"organisation_id": "o", "publication_id": "p"}, "edition": {"date": day, "pages": 8},
            "stories": [], "ads": []}), "m.bundle.unknownField")

    def test_other_artwork_is_kept_a_slot_not_in_the_plan_and_a_bad_picture_refused(self):
        eid = self.edition("2026-09-03")
        day = "2026-09-03"
        mine = jpeg_bytes((300, 200))
        self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=mine)
        theirs, junk = png_bytes((200, 100)), b"not a picture, only fictional bytes"
        ads = [ad(theirs), ad(theirs, slot="back-9")]
        res = self.send(eid, bundle2([story(1)], ads, {ads[0]["file"]: theirs}, day=day)).json()
        self.assertEqual(len(res["added"]), 1)                                          # the stories go on
        self.assertEqual([k["slot"] for k in res["ads"]["kept"]], ["back-1"])
        self.assertEqual(self.codes(res, [k["reason"] for k in res["ads"]["kept"]]), ["m.bundle.adKept"])
        self.assertEqual([(r["slot"], res["msgs"][r["reason"]]["code"]) for r in res["ads"]["refused"]],
                         [("back-9", "m.bundle.adNoSlot")])
        self.assertEqual(self.codes(res, res["notes"]), ["m.bundle.adKept", "m.bundle.adRefused"])
        self.assertEqual(sorted(p.name for p in self.ads_dir(eid).iterdir()),
                         ["back-1.cmyk.gz", "back-1.jpg", "back-1.orig.jpg", "index.json"])
        self.assertEqual((self.ads_dir(eid) / "back-1.orig.jpg").read_bytes(), mine)     # the Desk's own, kept
        # the Desk's ad removed: the file's comes in; a picture the Desk cannot read is refused with the reason
        self.call("DELETE", f"/api/editions/{eid}/ads/back-1")
        res = self.send(eid, bundle2([], [ad(junk)], {ad(junk)["file"]: junk}, day=day)).json()
        self.assertEqual([(r["slot"], res["msgs"][r["reason"]]["code"]) for r in res["ads"]["refused"]],
                         [("back-1", "m.img.notAPicture")])
        self.assertEqual([p.name for p in self.ads_dir(eid).iterdir()], ["index.json"])
        res = self.send(eid, bundle2([], [ad(theirs)], {ad(theirs)["file"]: theirs}, day=day)).json()
        self.assertEqual(res["ads"]["added"], [{"slot": "back-1"}])
        self.assertEqual((self.ads_dir(eid) / "back-1.orig.png").read_bytes(), theirs)

    def test_a_desk_setting_is_kept_and_noted_and_back_page_ads_noted(self):
        eid = self.edition("2026-09-04", volume="११", price="₹ 4", back_page_ads=False)
        day = "2026-09-04"
        art = png_bytes((100, 50))
        res = self.send(eid, bundle2([story(1)], [ad(art)], {ad(art)["file"]: art}, day=day, volume="१२",
                                     issue="302", price="₹ 4")).json()
        self.assertEqual(res["settings"], {"set": {"issue": "302"}, "kept": {"volume": {"file": "१२", "desk": "११"}}})
        self.assertEqual(self.codes(res, res["notes"]), ["m.bundle.keptVolume", "m.bundle.backAdsOn",
                                                         "m.bundle.adRefused"])
        self.assertEqual(res["msgs"][res["notes"][0]]["params"], {"sent": {"data": "१२"}, "desk": {"data": "११"}})
        self.assertEqual(res["msgs"][res["ads"]["refused"][0]["reason"]]["code"], "m.bundle.adNoSlot")
        got = self.call("GET", f"/api/editions/{eid}").json()["edition"]
        self.assertEqual((got["volume"], got["issue"], got["price"], got["back_page_ads"]), ("११", "302", "₹ 4", False))
        on = self.edition("2026-09-05")                                                 # the other way round
        res = self.send(on, bundle2([], day="2026-09-05", back=False)).json()
        self.assertEqual(self.codes(res, res["notes"]), ["m.bundle.backAdsOff"])

    def test_files_the_ads_do_not_name_and_ads_not_in_the_file_are_refused_whole(self):
        eid = self.edition("2026-09-06")
        day = "2026-09-06"
        art = png_bytes((60, 30))
        stray = f"ads/{hashlib.sha256(art).hexdigest()}.png"
        r = self.refused(eid, bundle2([story(1)], day=day, extra=[(stray, art)]), "m.bundle.badMember")
        self.assertEqual(r["msgs"][r["error"]]["params"]["name"], {"data": stray})
        self.refused(eid, bundle_zip([story(1)], day=day, extra=[(stray, art)]), "m.bundle.badMember")    # /1
        self.refused(eid, bundle2([story(1)], [ad(art)], day=day), "m.bundle.adMissing")
        self.refused(eid, bundle2([story(1)], [ad(art)], {ad(art)["file"]: png_bytes((61, 30))}, day=day),
                     "m.bundle.badSha")
        for bad in ({"page": 0}, {"slot": "../x"}, {"sha256": "0" * 64}, {"file": "photos/" + "0" * 64 + ".png"}):
            self.refused(eid, bundle2([], [{**ad(art), **bad}], {ad(art)["file"]: art}, day=day), "m.bundle.badField")
        again = png_bytes((62, 30))                                        # one slot twice: refused, naming it
        r = self.refused(eid, bundle2([], [ad(art), ad(again)], {ad(art)["file"]: art, ad(again)["file"]: again},
                                      day=day), "m.bundle.badField")
        self.assertEqual(r["msgs"][r["error"]]["params"]["field"], {"data": "ads[1].slot"})
        self.refused(eid, bundle2([], day=day, volume=None), "m.bundle.badField")
        self.refused(eid, bundle2([], day=day, price="x" * 201), "m.bundle.badField")
        self.refused(eid, bundle2([], [ad(art, slot=f"s-{n}") for n in range(bundle.MAX_ADS + 1)],
                                  {ad(art)["file"]: art}, day=day), "m.bundle.badField")
        self.assertEqual(self.articles(eid), [])

    def test_an_ad_the_desk_has_that_a_later_file_does_not_name_is_kept_and_noted(self):
        eid = self.edition("2026-09-08")
        day = "2026-09-08"
        art = png_bytes((100, 50))
        self.assertEqual(self.send(eid, bundle2([], [ad(art)], {ad(art)["file"]: art}, day=day)).json()["notes"], [])
        res = self.send(eid, bundle2([story(1)], [], day=day)).json()          # the ad cancelled in the hosted edition
        self.assertEqual(self.codes(res, res["notes"]), ["m.bundle.adNotInFile"])
        self.assertEqual(res["msgs"][res["notes"][0]]["params"], {"slot": {"data": "back-1"}})
        self.assertEqual(res["ads"], {"added": [], "unchanged": [], "kept": [], "refused": []})
        self.assertEqual((self.ads_dir(eid) / "back-1.orig.png").read_bytes(), art)      # never removed by an import
        self.assertEqual(self.send(eid, bundle_zip([story(2)], day=day)).json()["notes"], [])   # /1: nothing of ads

    def test_a_write_that_fails_part_way_leaves_no_ad_and_no_setting(self):
        eid = self.edition("2026-09-07")
        art = png_bytes((80, 40))
        store = self.desk.store

        def broken(d, doc):
            raise OSError("the disk is full (fictional)")
        store._save, saved = broken, store._save
        try:
            self.send(eid, bundle2([story(1)], [ad(art)], {ad(art)["file"]: art}, day="2026-09-07", issue="9"),
                      expect=500)
        finally:
            store._save = saved
        self.assertEqual(self.articles(eid), [])
        self.assertEqual([p.name for p in self.ads_dir(eid).iterdir() if p.name != "index.json"], [])
        self.assertEqual(json.loads((self.ads_dir(eid) / "index.json").read_text())["elements"], {})
        self.assertEqual(self.call("GET", f"/api/editions/{eid}").json()["edition"]["issue"], "")
        self.assertFalse(any(p.name.startswith(".bundle-") for p in self.edition_dir(eid).iterdir()))


if __name__ == "__main__":
    unittest.main()
