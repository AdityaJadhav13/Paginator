"""Tests for the home materialiser (pgn_worker/home.py): a Desk edition made by the Desk's own Store, sent as a hosted
request, comes out as exactly the files the Desk wrote; requests and homes that are not sound are refused before
anything is written. Fictional data; Pillow's plain CMYK stands in for the profile.
    experiments/phase0/pdfx1/.venv/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import copy
import gzip
import hashlib
import json
import os
import shutil
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pgn_worker import home, keys  # noqa: E402
from pgn_worker.desk import images  # noqa: E402
from pgn_worker.storage import FolderStorage  # noqa: E402

from deskserver import store as desk_store  # noqa: E402  (the Desk's own storage, for the parity check)

from test_media import ORG, OTHER_ORG, PUB, REAL_RGB_TO_CMYK, picture  # noqa: E402

RUN = "r-20261102-061500"
EID = "2026-11-02"


def uuid7(n: int) -> str:
    return f"01890a5d-ac96-7{n:03x}-b000-000000000000"


class MaterialiseTests(unittest.TestCase):
    def setUp(self):
        images.rgb_to_cmyk = lambda img: img.convert("CMYK")
        self.tmp = Path(tempfile.mkdtemp(prefix="worker-home-"))
        self.bucket = FolderStorage(self.tmp / "bucket")
        self.guard = keys.KeyGuard(ORG, PUB)
        self.assets = 0
        # a Desk edition, made as the Desk makes it: three articles (two share one photo id) and a back-page ad
        self.desk = desk_store.Store(self.tmp / "desk")
        assert self.desk.create_edition({"date": EID, "pages": 4, "volume": "काल्पनिक"})["id"] == EID
        a = self.desk.create_article(EID, {"headline": "काल्पनिक बातमी", "body": "पहिला परिच्छेद.\n\nदुसरा."})
        self.desk.create_article(EID, {"headline": "दुसरी बातमी", "body": "एकच परिच्छेद.", "priority": 2})
        self.desk.attach_photo(EID, a["id"], images.convert_photo(picture(size=(900, 600))), "काल्पनिक", "छाया")
        self.desk.put_ad(EID, "back-1", images.convert_ad(picture(size=(400, 200)), 100.0, 50.0))
        self.snapshot = self.desk.snapshot(EID)
        self.ed = self.tmp / "desk" / "editions" / EID
        self.homes = self.tmp / "homes"
        self.outside = self.tmp / "outside"                         # where a planted link would lead
        self.outside.mkdir()
        (self.outside / "keep.txt").write_text("not the worker's")

    def tearDown(self):
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        shutil.rmtree(self.tmp, ignore_errors=True)

    def hosted(self) -> dict:
        """The snapshot as the API would send it: each raster stored as a CMYK rendition, and named with its size."""
        req = copy.deepcopy(self.snapshot)
        for a in req["articles"]:
            if a.get("photo"):
                p = a["photo"]
                p["raster"] = self.store_raster(self.ed / "photos" / f"{p['id']}.cmyk.gz", p["width_px"], p["height_px"])
        for slot, entry in req["ads"].items():
            entry["raster"] = self.store_raster(self.ed / "ads" / f"{slot}.cmyk.gz", entry["width_px"],
                                                entry["height_px"])
        return req

    def store_raster(self, path: Path, w: int, h: int) -> dict:
        data = path.read_bytes()
        self.assets += 1
        key = self.guard.key("assets", uuid7(self.assets), "r", "cmyk-" + "0" * 32 + ".cmyk.gz")
        return {"key": key, "version_id": self.bucket.put(key, data, "application/gzip"),
                "sha256": hashlib.sha256(data).hexdigest(), "width_px": w, "height_px": h}

    def run_it(self, req: dict, sha: str | None = None, edition: str = EID) -> Path:
        body = json.dumps(req, ensure_ascii=False).encode("utf-8")
        return home.materialise(self.bucket, self.homes, ORG, PUB, edition, RUN, body,
                                sha or hashlib.sha256(body).hexdigest(), config={"templates": "fictional"})

    def test_the_home_holds_exactly_what_the_desk_wrote(self):
        run = self.run_it(self.hosted())
        ed = self.homes / ORG / PUB / "editions" / EID
        self.assertEqual(run, ed / "runs" / RUN)
        read = lambda p: json.loads(p.read_text("utf-8"))  # noqa: E731
        for name in ("edition.json", "articles.json", "photos/index.json", "ads/index.json"):
            self.assertEqual(read(ed / name), read(self.ed / name), name)
        for kind in ("photos", "ads"):
            desk = sorted(p.name for p in (self.ed / kind).glob("*.cmyk.gz"))
            self.assertEqual(sorted(p.name for p in (ed / kind).glob("*.cmyk.gz")), desk)
            for name in desk:
                self.assertEqual((ed / kind / name).read_bytes(), (self.ed / kind / name).read_bytes())
        self.assertEqual(read(run / "request.json"), self.snapshot)            # the Desk's own request.json
        self.assertEqual(read(self.homes / ORG / PUB / "config.json"), {"templates": "fictional"})
        self.assertEqual(home.ARTICLES_SCHEMA, desk_store.ARTICLES_SCHEMA)
        for p in [self.homes / ORG, *(self.homes / ORG).rglob("*")]:
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700 if p.is_dir() else 0o600, p)

    def test_a_later_request_removes_what_it_no_longer_names_and_every_attempt_starts_empty(self):
        run = self.run_it(self.hosted())
        (run / "page-01.pdf").write_bytes(b"%PDF an earlier attempt's page")             # left by a stopped attempt
        (run / "work").mkdir()
        (run / "work" / "x").write_text("fictional")
        req = self.hosted()
        for a in req["articles"]:
            a["photo"] = None
        req["ads"] = {}
        self.run_it(req)
        ed = self.homes / ORG / PUB / "editions" / EID
        self.assertEqual(sorted(p.name for p in (ed / "photos").iterdir()), ["index.json"])
        self.assertEqual(sorted(p.name for p in (ed / "ads").iterdir()), ["index.json"])
        self.assertEqual(sorted(p.name for p in run.iterdir()), ["request.json"])

    def refused(self, req: dict, error=home.BadRequest, **kw) -> None:
        with self.assertRaises(error):
            self.run_it(req, **kw)
        self.assertFalse((self.homes / ORG / PUB / "editions").exists(), "something was written")

    def test_requests_that_are_not_sound_are_refused_before_anything_is_written(self):
        good = self.hosted()
        photo = lambda r: next(a for a in r["articles"] if a.get("photo"))["photo"]  # noqa: E731
        other = keys.KeyGuard(OTHER_ORG, PUB)
        for name, change, error in (
                ("raster sha", lambda r: photo(r)["raster"].update(sha256="0" * 64), home.BadRequest),
                ("another org's raster", lambda r: photo(r)["raster"].update(
                    key=other.key("assets", uuid7(1), "r", "cmyk-" + "0" * 32 + ".cmyk.gz")), keys.KeyRefused),
                ("an original", lambda r: photo(r)["raster"].update(key=self.guard.asset_original(uuid7(1))),
                 keys.KeyRefused),
                ("a preview", lambda r: photo(r)["raster"].update(
                    key=self.guard.key("assets", uuid7(1), "r", "preview-" + "0" * 32 + ".jpg")), keys.KeyRefused),
                ("an upload", lambda r: photo(r)["raster"].update(key=f"uploads/orgs/{ORG}/pubs/{PUB}/x"),
                 keys.KeyRefused),
                ("a turned phone photo's sizes", lambda r: photo(r).update(width_px=photo(r)["height_px"],
                                                                           height_px=photo(r)["width_px"]),
                 home.BadRequest),
                ("sizes said in the raster swapped", lambda r: photo(r)["raster"].update(
                    width_px=photo(r)["raster"]["height_px"], height_px=photo(r)["raster"]["width_px"]),
                 home.BadRequest),
                ("a zero width", lambda r: photo(r).update(width_px=0), home.BadRequest),
                ("a width that is text", lambda r: photo(r).update(width_px="900"), home.BadRequest),
                ("a reference without its size", lambda r: photo(r)["raster"].pop("width_px"), home.BadRequest),
                ("an ad's raster of another size", lambda r: r["ads"]["back-1"].update(width_px=1), home.BadRequest),
                ("the edition's id", lambda r: r["edition"].update(id="../../x"), home.BadRequest),
                ("another edition", lambda r: r["edition"].update(id="2026-11-03"), home.BadRequest),
                ("an article id", lambda r: r["articles"][0].update(id="a-../../../x"), home.BadRequest),
                ("an ad slot", lambda r: r.update(ads={"../x": r["ads"]["back-1"]}), home.BadRequest),
                ("an extra key", lambda r: r.update(extra=1), home.BadRequest)):
            with self.subTest(name):
                req = copy.deepcopy(good)
                change(req)
                self.refused(req, error)
        self.refused(good, sha="0" * 64)                                          # not the run's request
        for edition in ("२०२६-११-०२", "２０２６-１１-０２", "2026-11-02/../x"):           # ASCII digits only
            with self.subTest(edition=edition):
                req = copy.deepcopy(good)
                req["edition"]["id"] = edition
                self.refused(req, edition=edition)
        with self.assertRaises(home.BadRequest):
            home.materialise(self.bucket, self.homes, ORG, PUB, EID, "r-२०२६११०२-०६१५००", b"{}",
                             hashlib.sha256(b"{}").hexdigest())

    def test_every_reference_to_a_shared_photo_is_checked(self):
        req = self.hosted()
        first = next(a for a in req["articles"] if a.get("photo"))
        second = next(a for a in req["articles"] if not a.get("photo"))
        second["photo"] = copy.deepcopy(first["photo"])                            # the same photo id, the same raster
        self.run_it(req)
        shutil.rmtree(self.homes)
        second["photo"]["raster"]["key"] = f"uploads/orgs/{ORG}/pubs/{PUB}/x"       # the same id, another key
        self.refused(req)
        second["photo"]["raster"] = copy.deepcopy(first["photo"]["raster"])
        second["photo"]["width_px"] += 1
        self.refused(req)

    def test_a_raster_must_hold_exactly_its_pixels(self):
        req = self.hosted()
        p = next(a for a in req["articles"] if a.get("photo"))["photo"]
        for data in (gzip.compress(b"\0" * 10), gzip.compress(b"\0" * (p["width_px"] * p["height_px"] * 4 + 1)),
                     b"not gzip at all"):
            with self.subTest(size=len(data)):
                key = self.guard.key("assets", uuid7(99), "r", "cmyk-" + "1" * 32 + ".cmyk.gz")
                p["raster"].update(key=key, version_id=self.bucket.put(key, data, "application/gzip"),
                                   sha256=hashlib.sha256(data).hexdigest())
                self.refused(req)

    def test_a_link_anywhere_in_the_home_is_refused_and_never_written_through(self):
        good = self.hosted()
        levels = [(ORG,), (ORG, PUB), (ORG, PUB, "editions"), (ORG, PUB, "editions", EID),
                  (ORG, PUB, "editions", EID, "photos"), (ORG, PUB, "editions", EID, "ads"),
                  (ORG, PUB, "editions", EID, "runs"), (ORG, PUB, "editions", EID, "runs", RUN)]
        for parts in levels:
            with self.subTest(link="/".join(parts[-2:])):
                shutil.rmtree(self.homes, ignore_errors=True)
                if len(parts) > 1:
                    self.run_it(good)                                                 # a real home first
                    shutil.rmtree(self.homes.joinpath(*parts))
                self.homes.joinpath(*parts[:-1]).mkdir(parents=True, exist_ok=True)
                os.symlink(self.outside, self.homes.joinpath(*parts))
                with self.assertRaises(home.BadRequest):
                    self.run_it(good)
                self.assertEqual(sorted(p.name for p in self.outside.iterdir()), ["keep.txt"])
        shutil.rmtree(self.homes)
        self.run_it(good)                                                             # a planted file link in photos/
        pdir = self.homes / ORG / PUB / "editions" / EID / "photos"
        target = self.outside / "p-0123456789.cmyk.gz"
        target.write_bytes(b"not the worker's")
        os.symlink(target, pdir / "p-0123456789.cmyk.gz")
        self.run_it(good)
        self.assertEqual(target.read_bytes(), b"not the worker's")                    # the sweep left it alone,
        self.assertTrue((pdir / "p-0123456789.cmyk.gz").is_symlink())                 # the link itself too

    def test_write_live_waits_for_the_editions_lock(self):
        run = self.run_it(self.hosted())
        edition, articles = self.snapshot["edition"], self.hosted()["articles"]
        done = threading.Event()
        with home._locked(run.parent.parent):                                         # a layout job writing
            t = threading.Thread(target=lambda: (home.write_live(self.bucket, self.homes, ORG, PUB, EID, edition,
                                                                 articles, {}), done.set()))
            t.start()
            self.assertFalse(done.wait(0.3))
        t.join(10)
        self.assertTrue(done.is_set())

    def test_write_live_writes_the_editions_ads_as_materialise_does_and_never_a_run_folder(self):
        run = self.run_it(self.hosted())
        ed = run.parent.parent
        (ed / "ads" / "back-1.cmyk.gz").unlink()                                       # what write_live must bring
        (run / "page-01.pdf").write_bytes(b"%PDF the layout's page")
        files = lambda folder: {p.name: p.read_bytes() for p in folder.iterdir()}  # noqa: E731
        before = files(run)
        live = lambda ads: home.write_live(self.bucket, self.homes, ORG, PUB, EID, self.snapshot["edition"],  # noqa: E731
                                           self.hosted()["articles"], ads)
        self.assertEqual(live(self.hosted()["ads"]), ed)
        self.assertEqual((ed / "ads" / "back-1.cmyk.gz").read_bytes(), (self.ed / "ads" / "back-1.cmyk.gz").read_bytes())
        self.assertEqual(json.loads((ed / "ads" / "index.json").read_text("utf-8")),
                         json.loads((self.ed / "ads" / "index.json").read_text("utf-8")))
        self.assertEqual(files(run), before)                                            # the run folder untouched
        # an ad whose raster is not the one named, or ads that are no object: refused, nothing written
        bad = self.hosted()["ads"]
        bad["back-1"]["raster"]["sha256"] = "0" * 64
        for ads in (bad, [], {"../x": self.hosted()["ads"]["back-1"]}):
            with self.subTest(ads=str(ads)[:40]), self.assertRaises(home.BadRequest):
                live(ads)
            self.assertTrue((ed / "ads" / "back-1.cmyk.gz").is_file())
        live(None)                                            # an older API's call without ads: the ads stay
        self.assertTrue((ed / "ads" / "back-1.cmyk.gz").is_file())
        live({})                                                                        # the ad taken out: swept
        self.assertEqual(sorted(p.name for p in (ed / "ads").iterdir()), ["index.json"])
        self.assertEqual(json.loads((ed / "ads" / "index.json").read_text("utf-8")), {"elements": {}})
        self.assertEqual(files(run), before)


if __name__ == "__main__":
    unittest.main()
