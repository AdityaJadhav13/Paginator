"""Tests for the edit gateway (pgn_worker/gateway.py, L2.4): signed calls, the API's state written first (Postgres
wins), every change reported, saves stored under the run's keys, the independent check, glyphs and rasters. The engine
is the fake one (test/fake_desk_engine.py's edit-service, on fictional data); the store is a folder.
    <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import contextlib
import gzip
import hashlib
import io
import json
import re
import secrets
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from pgn_worker import engine, gateway, keys, launcher  # noqa: E402
from pgn_worker.desk import DESK, REPO  # noqa: E402
from pgn_worker.storage import FolderStorage  # noqa: E402

from test_media import ORG, OTHER_ORG, PUB  # noqa: E402

RUN_ID = "01890a5d-ac96-774b-bcce-b302099a8063"
OTHER_RUN = "01890a5d-ac96-774b-bcce-b302099a8064"
EID, RKEY = "2026-11-04", "r-20261104-101500"
SECRET = bytes(range(32))
FAKE = (WORKER / "test" / "fake_desk_engine.py").read_text(encoding="utf-8")
FONT = REPO / "tools" / "oracle" / "v0" / "assets" / "fonts" / "latin" / "SourceSans3[wght].ttf"
S1, S2, S3, GONE = "d0000000001", "d0000000002", "d0000000003", "dffffffffff"


def vector() -> dict:
    """The contract's GATEWAY_TEST_VECTOR, read from packages/contracts/src/editor.ts (one vector, both sides)."""
    ts = (REPO / "packages" / "contracts" / "src" / "editor.ts").read_text(encoding="utf-8")
    block = ts[ts.index("GATEWAY_TEST_VECTOR"):]
    block = block[:block.index("} as const")]
    return {k: json.loads(v) if v.startswith('"') else v.strip("'")
            for k, v in re.findall(r"(\w+): ('[^']*'|\"[^\"]*\")", block)}


def article(n: int, headline: str | None = None) -> dict:
    return {"id": f"a-{n:010x}", "headline": headline or f"Fictional headline {n}", "kicker": "", "deck": "",
            "byline": "", "body": "Fictional text.", "priority": 3, "page": None, "photo": None, "source": "",
            "created": "", "updated": ""}


def module(story: str, x: float = 10.0, y: float = 20.0, locked: bool = False) -> dict:
    return {"story": story, "x": x, "y": y, "w": 2, "h": 50.0, "locked": locked, "crop": None}


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="worker-gateway-"))
        self.store = FolderStorage(self.tmp / "bucket")
        self.guard = keys.KeyGuard(ORG, PUB)
        fake = self.tmp / "engine" / "desk_engine.py"
        fake.parent.mkdir()
        fake.write_text(f"ENGINE_DIR = {str(DESK / 'engine')!r}\n" + FAKE, encoding="utf-8")
        self.homes = self.tmp / "homes"
        self.settings = engine.Settings.from_env({"PGN_ENGINE_PYTHON": sys.executable, "PAGEINATOR_DESK_ENGINE": str(fake),
                                                  "PGN_WORKER_HOMES": str(self.homes)})
        self.now = 1_800_000_000.0
        self.gw = self.gateway()
        self.make_run()

    def tearDown(self):
        for gw in self.gateways:
            gw.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def gateway(self) -> gateway.Gateway:
        gw = gateway.Gateway(SECRET, self.settings, lambda guard: self.store, clock=lambda: self.now)
        self.gateways = [*getattr(self, "gateways", []), gw]
        return gw

    @property
    def home(self) -> Path:
        return self.homes / ORG / PUB

    @property
    def rundir(self) -> Path:
        return self.home / "editions" / EID / "runs" / RKEY

    def write(self, path: Path, doc: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc), encoding="utf-8")

    def make_run(self, volume: str = "") -> None:
        """A laid-out fictional run, as the layout job leaves it in the home: page 1 holds S1, page 2 S2 and S3."""
        edition = {"id": EID, "date": EID, "pages": 2, "volume": volume, "issue": "1", "back_page_ads": True}
        arts = [article(n) for n in (1, 2, 3)]
        self.write(self.home / "config.json", {"templates": {"front": "x"}, "dataset": str(self.tmp)})
        self.write(self.home / "editions" / EID / "edition.json", edition)
        self.write(self.home / "editions" / EID / "articles.json", {"articles": arts})
        self.write(self.rundir / "request.json", {"edition": edition, "articles": arts, "ads": {}})
        self.write(self.rundir / "plan.json", {"stories": {}})
        self.write(self.rundir / "printed.json", {})
        placed = lambda s, n, x=10.0: {"story": s, "x_mm": x, "y_mm": 20.0, "w_cols": 2, "h_mm": 50.0,  # noqa: E731
                                       "articles": [f"a-{n:010x}"]}
        self.write(self.rundir / "page-01.manifest.json", {"placed": [placed(S1, 1)]})
        self.write(self.rundir / "page-02.manifest.json", {"placed": [placed(S2, 2), placed(S3, 3, 60.0)]})

    # ------------------------------------------------------------------------------- signed requests

    def request(self, method: str, path: str, body: bytes = b"", stamp: int | None = None,
                sig: str | None = None, gw: gateway.Gateway | None = None, ctype: str = "application/json",
                nonce: str | None = None):
        stamp = str(int(self.now) if stamp is None else stamp)
        nonce = nonce or secrets.token_hex(16)
        headers = {"x-pgn-time": stamp, "x-pgn-nonce": nonce, "content-type": ctype,
                   "x-pgn-signature": sig or gateway.signature(SECRET, method, path, stamp, nonce, body)}
        return (gw or self.gw).handle(method, path, headers, body)

    def call(self, cmd: str, page: int = 1, pages: list | None = None, text: dict | None = None,
             gw: gateway.Gateway | None = None, **extra) -> tuple[int, dict]:
        c = {"format": gateway.FORMAT, "org_id": ORG, "pub_id": PUB, "run_id": RUN_ID, "edition_key": EID,
             "run_key": RKEY, "page": page, "cmd": cmd, "base_rev": extra.pop("base_rev", None),
             "state": {"pages": pages or [], "text": text}, **extra}
        status, ctype, body = self.request("POST", "/v1/call", json.dumps(c).encode(), gw=gw)
        self.assertEqual(ctype, "application/json")
        return status, json.loads(body)

    def ok(self, cmd: str, **kw) -> dict:
        status, answer = self.call(cmd, **kw)
        self.assertEqual((status, answer.get("ok")), (200, True), answer)
        return answer

    def live(self, ads: dict | None = None, **headlines) -> dict:
        arts = [article(n, headlines.get(f"a{n}")) for n in (1, 2, 3)]
        return {"edition": json.loads((self.home / "editions" / EID / "edition.json").read_text()), "articles": arts,
                "ads": ads or {}}

    def ad(self, w: int = 4, h: int = 2, fill: int = 7) -> tuple[dict, bytes]:
        """An ad's entry in `live` (its CMYK raster stored as a rendition), and the raster's bytes."""
        data = gzip.compress(bytes([fill]) * (w * h * 4), mtime=0)
        key = self.guard.key("assets", "01890a5d-ac96-7001-b000-000000000000", "r", "cmyk-" + "0" * 32 + ".cmyk.gz")
        raster = {"key": key, "version_id": self.store.put(key, data, "application/gzip"),
                  "sha256": hashlib.sha256(data).hexdigest(), "width_px": w, "height_px": h}
        return {"width_px": w, "height_px": h, "ppi": 200, "raster": raster}, data

    def edit_file(self, page: int) -> dict | None:
        path = self.rundir / f"page-{page:02d}.edit.json"
        return json.loads(path.read_text()) if path.exists() else None

    def calls(self) -> list[str]:
        return (self.home / "fake-engine-calls.txt").read_text().splitlines()


# ------------------------------------------------------------------------------------------- signatures


class SignatureTests(Case):
    def test_the_contracts_vector(self):
        v = vector()
        self.assertEqual(hashlib.sha256(v["body"].encode()).hexdigest(), v["bodySha256"])
        self.assertEqual(gateway.signature(bytes.fromhex(v["secret"]), v["method"], v["path"], v["time"], v["nonce"],
                                           v["body"].encode()), v["signature"])

    def test_only_a_fresh_signed_unchanged_request_is_taken(self):
        self.ok("state")
        body = json.dumps({"x": 1}).encode()
        stamp, nonce = int(self.now), "ab" * 16
        good = gateway.signature(SECRET, "POST", "/v1/call", str(stamp), nonce, body)
        req = lambda b, sig=good, path="/v1/call", n=nonce: self.request("POST", path, b, stamp, sig, nonce=n)[0]  # noqa: E731
        self.assertEqual(req(b'{"x":2}'), 401)                                                      # body changed
        self.assertEqual(req(body, path="/v1/call?a=1"), 401)                                      # path changed
        self.assertEqual(req(body, n="cd" * 16), 401)                                              # nonce changed
        self.assertEqual(req(body, sig="0" * 64), 401)                                             # wrong signature
        old = int(self.now) - 61
        self.assertEqual(self.request("POST", "/v1/call", body, old)[0], 401)                      # too old
        self.assertEqual(self.request("POST", "/v1/call", body, int(self.now) + 61)[0], 401)      # from the future
        self.assertEqual(req(body), 400)                                                            # taken (not a call)
        self.assertEqual(req(body), 401)                                                            # a replay
        self.assertEqual(self.request("POST", "/v1/call", body, stamp, nonce="x" * 32)[0], 401)   # not a nonce
        # the same call twice in one second (two viewers polling): two nonces, both taken
        self.assertEqual([self.request("POST", "/v1/call", body, stamp)[0] for _ in range(2)], [400, 400])
        status, _, out = self.gw.handle("POST", "/v1/call", {}, body)                               # no headers
        self.assertEqual((status, json.loads(out)), (401, {"error": "unauthorised"}))
        self.assertEqual(self.request("POST", "/v1/call", b"{}", ctype="text/plain")[0], 415)

    def test_calls_that_are_not_edit_calls_are_refused(self):
        for bad in ({"cmd": "state"}, {"modules": [{"story": "x"}]}, {"page": 17}, {"cmd": "set"},
                    {"cmd": "move", "story": S1}, {"run_key": "../x"}, {"org_id": "nope"}, {"extra": 1},
                    {"variant": True, "cmd": "alternative"}, {"state": {"pages": [{"page": 1, "rev": -1, "modules": []}],
                                                                       "text": None}},
                    {"live": {"edition": {}, "ads": {}}}, {"live": {"edition": {}, "articles": [], "ads": {}, "more": 1}},
                    {"live": {"edition": {}, "articles": [], "ads": []}}):
            c = {"format": gateway.FORMAT, "org_id": ORG, "pub_id": PUB, "run_id": RUN_ID, "edition_key": EID,
                 "run_key": RKEY, "page": 1, "cmd": "state", "base_rev": None, "state": {"pages": [], "text": None}}
            c.update(bad)
            if bad == {"cmd": "state"}:
                c.pop("format")
            status, _, out = self.request("POST", "/v1/call", json.dumps(c).encode())
            answer = json.loads(out)
            self.assertEqual((status, answer["code"], answer["error"]["code"]), (400, "refused", None), bad)
        status, _, out = self.request("POST", "/v1/call", b"not json")
        self.assertEqual((status, json.loads(out)["error"]["text"]), (400, "The call is not one JSON object."))

    def test_the_http_server(self):
        server = gateway.serve(self.gw, "127.0.0.1", 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_address[1]}"
        body = json.dumps({"format": gateway.FORMAT, "org_id": ORG, "pub_id": PUB, "run_id": RUN_ID, "edition_key": EID,
                           "run_key": RKEY, "page": 1, "cmd": "state", "base_rev": None,
                           "state": {"pages": [], "text": None}}).encode()
        stamp, nonce = str(int(self.now)), secrets.token_hex(16)
        req = urllib.request.Request(url + "/v1/call", body, method="POST", headers={
            "Content-Type": "application/json", "X-Pgn-Time": stamp, "X-Pgn-Nonce": nonce,
            "X-Pgn-Signature": gateway.signature(SECRET, "POST", "/v1/call", stamp, nonce, body)})
        with urllib.request.urlopen(req, timeout=30) as r:
            self.assertEqual((r.status, json.loads(r.read())["ok"]), (200, True))
        big = urllib.request.Request(url + "/v1/call", method="POST", headers={"Content-Length": str(9 * 2 ** 20)})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(big, timeout=30)
        self.assertEqual(e.exception.code, 413)


# ------------------------------------------------------------------------------------------- the calls


class CallTests(Case):
    def test_a_run_without_its_working_files(self):
        (self.rundir / "printed.json").unlink()
        status, answer = self.call("open")
        self.assertEqual((status, answer["code"], answer["status"]), (409, "run_missing", 409))
        self.assertEqual(answer["error"], {"text": gateway.RUN_MISSING, "code": None, "params": None})
        status, answer = self.call("open", page=3)                     # no manifest for page 3
        self.assertEqual(answer["code"], "run_missing")
        shutil.rmtree(self.rundir)
        self.assertEqual(self.call("state")[1]["code"], "run_missing")
        self.assertNotIn(str(self.tmp), json.dumps(answer))

    def test_open_then_set_reports_the_page_file(self):
        opened = self.ok("open")
        self.assertEqual((opened["result"]["rev"], opened["edits"], opened["text"]), (0, [], None))
        mods = [module(S1, x=30.0)]
        answer = self.ok("set", base_rev=0, modules=mods)
        self.assertEqual(answer["edits"], [{"page": 1, "rev": 1, "modules": mods}])
        self.assertEqual(self.edit_file(1)["rev"], 1)
        status, stale = self.call("set", base_rev=0, modules=mods, pages=[{"page": 1, "rev": 1, "modules": mods}])
        self.assertEqual((status, stale["code"], stale["error"]["code"]), (409, "stale", "m.save.notChanged"))
        self.assertIn("another window or tab", stale["error"]["text"])

    def test_postgres_wins_files_are_written_and_open_pages_reloaded(self):
        self.ok("open")
        theirs = [module(S1, x=40.0)]
        answer = self.ok("state", pages=[{"page": 1, "rev": 5, "modules": theirs}])
        self.assertEqual((answer["result"]["rev"], answer["result"]["modules"], answer["edits"]), (5, theirs, []))
        self.assertEqual(self.edit_file(1), {"schema": "pageinator.desk.page-edit/1", "page": 1, "modules": theirs,
                                             "rev": 5})
        self.assertIn(f"open {EID}/{RKEY}/1 reload=True", self.calls())
        ours = [module(S1, x=45.0)]                                     # the same rev, other modules: Postgres wins
        self.ok("state", pages=[{"page": 1, "rev": 5, "modules": ours}])
        self.assertEqual(self.edit_file(1)["modules"], ours)
        self.ok("state", pages=[{"page": 1, "rev": 6, "modules": theirs}])
        # an older state (a viewer's poll read before a change was kept): the file is never moved back; the API is
        # told the newer revision instead, and catches up
        for pages in ([{"page": 1, "rev": 5, "modules": ours}], []):
            answer = self.ok("state", pages=pages)
            self.assertEqual(self.edit_file(1)["rev"], 6)
            self.assertEqual((answer["result"]["rev"], answer["edits"]), (6, [{"page": 1, "rev": 6, "modules": theirs}]))

    def test_the_engines_own_change_and_a_move_are_reported(self):
        self.write(self.rundir / "page-02.manifest.json", {"placed": [
            {"story": S2, "x_mm": 10.0, "y_mm": 20.0, "w_cols": 2, "h_mm": 50.0, "articles": ["a-0000000002"]},
            {"story": GONE, "x_mm": 60.0, "y_mm": 20.0, "w_cols": 2, "h_mm": 50.0, "articles": []}]})
        opened = self.ok("open", page=2)                                # a story whose articles are gone leaves
        self.assertEqual([(e["page"], e["rev"], [m["story"] for m in e["modules"]]) for e in opened["edits"]],
                         [(2, 1, [S2])])
        page2 = opened["edits"][0]
        self.ok("open", pages=[page2])
        moved = self.ok("move", base_rev=0, story=S1, to=2, pages=[page2])
        self.assertEqual([(e["page"], e["rev"]) for e in moved["edits"]], [(1, 1), (2, 2)])
        self.assertEqual([m["story"] for m in moved["edits"][1]["modules"]], [S2, S1])

    def test_text_overrides_go_both_ways(self):
        self.ok("open")
        live = self.live(a1="A corrected fictional headline")
        answer = self.ok("refresh", base_rev=0, live=live)
        self.assertEqual(answer["text"], {"a-0000000001": live["articles"][0]})
        self.assertEqual(json.loads((self.home / "editions" / EID / "articles.json").read_text())["articles"][0]
                         ["headline"], "A corrected fictional headline")
        self.assertTrue(self.rundir.joinpath("plan.json").is_file())     # the run folder kept
        mods = answer["edits"][0]
        again = self.ok("state", pages=[mods], text=answer["text"])  # the API's own text: nothing changes
        self.assertIsNone(again["text"])
        self.ok("state", pages=[mods], text=None)                     # Postgres has no overrides: the file goes
        self.assertFalse((self.rundir / "edit-articles.json").exists())
        self.ok("state", pages=[mods], text={"a-0000000002": None})
        self.assertEqual(json.loads((self.rundir / "edit-articles.json").read_text())["articles"], {"a-0000000002": None})

    def test_a_save_stores_its_files_and_says_what_the_page_prints(self):
        self.ok("open")
        mods = [module(S1), module(S2, x=60.0)]                         # S2 brought in from page 2
        page1 = self.ok("set", base_rev=0, modules=mods)["edits"][0]
        answer = self.ok("save", base_rev=1, pages=[page1], live=self.live())
        saved = answer["saved"]
        run_key = lambda name, page=1: self.guard.run_file(RUN_ID, name, page)  # noqa: E731
        self.assertEqual(saved["pdf"]["key"], run_key("edit-1.pdf"))
        self.assertEqual((saved["png"]["key"], saved["thumb"]["key"]), (run_key("edit-1.png"), run_key("edit-1.thumb.png")))
        self.assertEqual(saved["edition_pdf"]["key"], self.guard.run_file(RUN_ID, "edition.pdf"))
        self.assertEqual(saved["press_zip"]["key"], self.guard.run_file(RUN_ID, "press-files.zip"))
        for f in ("pdf", "png", "thumb", "edition_pdf", "press_zip"):
            data = self.store.get(saved[f]["key"], saved[f]["version_id"])
            self.assertEqual((hashlib.sha256(data).hexdigest(), len(data)), (saved[f]["sha256"], saved[f]["bytes"]))
        self.assertEqual((saved["rev"], saved["articles"], saved["pages_changed"]), (1, ["a-0000000001", "a-0000000002"],
                                                                                      {"2": []}))
        self.assertEqual((saved["stale"], saved["warnings"], saved["layout_problems"], saved["error"]), ([], [], [], None))
        self.assertEqual([(e["page"], e["rev"], [m["story"] for m in e["modules"]]) for e in answer["edits"]],
                         [(2, 1, [S3])])                               # S2 taken off page 2
        # a newer text in the edition than the page prints: stale, in the Desk's words; overlapping stories: a problem
        page2 = answer["edits"][0]
        mods = [module(S1), module(S2)]
        page1 = self.ok("set", base_rev=1, modules=mods, pages=[page1, page2])["edits"][0]
        saved = self.ok("save", base_rev=2, pages=[page1, page2], live=self.live(a2="A newer fictional headline"))["saved"]
        self.assertTrue(saved["stale"])
        self.assertTrue(all(s["code"].startswith("m.press.") for s in saved["stale"]), saved["stale"])
        self.assertEqual(saved["layout_problems"], ["overlap"])
        self.assertIn("m.warn.overlap", [w["code"] for w in saved["warnings"]])

    def test_live_ads_reach_the_edition_and_a_save_reports_the_ads_it_prints(self):
        self.ok("open")
        entry, data = self.ad()
        page1 = self.ok("refresh", base_rev=0, live=self.live(ads={"back-1": entry}))["edits"][0]
        ads = self.home / "editions" / EID / "ads"
        self.assertEqual((ads / "back-1.cmyk.gz").read_bytes(), data)
        self.assertEqual(json.loads((ads / "index.json").read_text()),
                         {"elements": {"back-1": {"width_px": 4, "height_px": 2, "ppi": 200}}})
        self.assertFalse((self.rundir / "ads").exists())                 # the engine's Update text brings them in
        (self.rundir / "ads").mkdir()                                     # as deskedit._refresh_ads leaves them
        shutil.copyfile(ads / "back-1.cmyk.gz", self.rundir / "ads" / "back-1.cmyk.gz")
        shutil.copyfile(ads / "index.json", self.rundir / "ads" / "index.json")
        saved = self.ok("save", base_rev=1, pages=[page1], live=self.live(ads={"back-1": entry}))["saved"]
        self.assertEqual(saved["ads"], {"back-1": hashlib.sha256(data).hexdigest()})
        self.assertEqual(saved["printed"]["ads"], {"back-1": gateway.editing.deskprinted.file_sig(ads / "back-1.cmyk.gz")})
        # the edition's ad taken out: its file is swept; the run's copy is the engine's to change, never write_live's
        self.ok("refresh", base_rev=1, pages=[page1], live=self.live())
        self.assertEqual(sorted(p.name for p in ads.iterdir()), ["index.json"])
        self.assertTrue((self.rundir / "ads" / "back-1.cmyk.gz").is_file())

    def test_printed_ads_name_only_the_file_the_page_printed(self):
        ads = self.rundir / "ads"
        ads.mkdir()
        (ads / "back-1.cmyk.gz").write_bytes(b"fictional ad raster")
        sig = gateway.editing.deskprinted.file_sig(ads / "back-1.cmyk.gz")
        sha = hashlib.sha256(b"fictional ad raster").hexdigest()
        self.assertEqual(gateway.printed_ads(self.rundir, {"ads": {"back-1": sig}}), {"back-1": sha})
        # another file now than the one printed, no ad printed, no file, a slot that is not one: fail closed
        printed = {"ads": {"back-1": "0" * 20, "back-2": None, "back-3": sig, "../x": sig}}
        self.assertEqual(gateway.printed_ads(self.rundir, printed), {"back-1": None, "back-2": None, "back-3": None})
        self.assertEqual([gateway.printed_ads(self.rundir, p) for p in (None, {}, {"ads": None})], [{}, {}, {}])

    def test_a_save_refused(self):
        self.ok("open")
        status, answer = self.call("save", base_rev=3, live=self.live())
        self.assertEqual((status, answer["code"]), (409, "stale"))
        locked = {"page": 2, "rev": 1, "modules": [module(S2, locked=True)]}
        page1 = {"page": 1, "rev": 1, "modules": [module(S1), module(S2, x=60.0)]}
        status, answer = self.call("save", base_rev=1, pages=[page1, locked], live=self.live())
        self.assertEqual((status, answer["code"], answer["error"]["code"]), (400, "refused", "m.save.held"))
        self.assertFalse((self.rundir / "page-01.pdf").exists())

    def test_check_runs_the_independent_checker_on_the_pinned_pdf(self):
        self.ok("open")
        saved = self.ok("save", base_rev=0, live=self.live())["saved"]
        answer = self.ok("check", base_rev=0, pdf=saved["pdf"])
        checked = answer["checked"]
        self.assertEqual(checked["checker_sha256"], launcher.CHECKER_SHA256)
        self.assertFalse(checked["passed"])                             # the fake's PDF is no PDF/X-1a file
        self.assertGreater(checked["fails"], 0)
        self.assertEqual(checked["report"]["key"], self.guard.run_file(RUN_ID, "edit-0.pdfx-check.txt", 1))
        self.assertIn(b"FAIL", self.store.get(checked["report"]["key"], checked["report"]["version_id"]))
        (self.rundir / "page-01.pdf").write_bytes(b"changed since")        # not the saved one: the stored version
        self.assertEqual(self.ok("check", pdf=saved["pdf"])["checked"]["fails"], checked["fails"])
        status, answer = self.call("check", pdf={**saved["pdf"], "key": saved["pdf"]["key"].replace(RUN_ID, OTHER_RUN)})
        self.assertEqual((status, answer["code"]), (400, "refused"))
        status, answer = self.call("check", pdf={**saved["pdf"], "sha256": "0" * 64})
        self.assertEqual((status, answer["code"]), (400, "refused"))

    def test_a_save_merges_the_page_pdfs_postgres_holds(self):
        self.ok("open")
        first = self.ok("save", base_rev=0, live=self.live())["saved"]
        good = self.store.get(first["pdf"]["key"], first["pdf"]["version_id"])
        key = self.guard.run_file(RUN_ID, "page.pdf", 2)
        page2 = {"key": key, "version_id": self.store.put(key, good, "application/pdf"),
                 "sha256": hashlib.sha256(good).hexdigest(), "bytes": len(good)}
        (self.rundir / "page-02.pdf").write_bytes(b"a save whose answer was lost")   # not Postgres's: fetched again
        (self.rundir / "page-03.pdf").write_bytes(b"a page Postgres has no PDF of")  # not named: left out
        pdfs = [{"page": 1, "pdf": first["pdf"]}, {"page": 2, "pdf": page2}]
        state = {"pages": [], "text": None, "pdfs": pdfs}
        c = {"format": gateway.FORMAT, "org_id": ORG, "pub_id": PUB, "run_id": RUN_ID, "edition_key": EID,
             "run_key": RKEY, "page": 1, "cmd": "save", "base_rev": 0, "state": state, "live": self.live()}
        status, _, body = self.request("POST", "/v1/call", json.dumps(c).encode())
        saved = json.loads(body)["saved"]
        self.assertEqual((status, saved["error"]), (200, None))
        self.assertEqual((self.rundir / "page-02.pdf").read_bytes(), good)
        bad = {**page2, "key": self.guard.run_file(OTHER_RUN, "page.pdf", 2)}     # another run's: not merged
        c["state"] = {**state, "pdfs": [{"page": 2, "pdf": bad}]}
        status, _, body = self.request("POST", "/v1/call", json.dumps(c).encode())
        self.assertEqual(json.loads(body)["saved"]["error"]["code"], "m.save.filesNotFinished")

    def test_a_save_whose_pdf_cannot_be_stored_still_reports_its_edits(self):
        self.ok("open")
        page1 = self.ok("set", base_rev=0, modules=[module(S1), module(S2, x=60.0)])["edits"][0]
        with mock.patch.object(gateway, "_stored", side_effect=OSError("the store is away")), \
                contextlib.redirect_stderr(io.StringIO()):
            answer = self.ok("save", base_rev=1, pages=[page1], live=self.live())
        saved = answer["saved"]
        self.assertEqual((saved["pdf"], saved["png"], saved["edition_pdf"]), (None, None, None))
        self.assertEqual(saved["error"]["code"], "m.save.filesNotFinished")
        self.assertEqual([(e["page"], e["rev"]) for e in answer["edits"]], [(2, 1)])     # S2 taken off page 2

    def test_a_fresh_gateway_rebuilds_the_files_from_the_apis_state(self):
        self.ok("open")
        first = self.ok("set", base_rev=0, modules=[module(S1, x=30.0)])["edits"][0]
        self.gw.close()
        persisted = {"page": 1, "rev": 4, "modules": [module(S1, x=50.0)]}     # the API's latest (Postgres wins)
        (self.rundir / "page-02.edit.json").write_text(json.dumps({"page": 2, "rev": 9, "modules": []}))
        (self.rundir / "page-03.edit.json").write_text("not json")
        fresh = self.gateway()
        answer = self.ok("open", pages=[persisted], text=None, gw=fresh)
        self.assertNotEqual(first, persisted)
        # page 2's file is ahead of Postgres (an answer lost in the crash): kept, and reported so the API catches up
        self.assertEqual((answer["result"]["rev"], answer["result"]["modules"], answer["edits"]),
                         (4, persisted["modules"], [{"page": 2, "rev": 9, "modules": []}]))
        self.assertEqual(self.edit_file(2)["rev"], 9)
        self.assertIsNone(self.edit_file(3))

    def test_an_engine_that_does_not_start(self):
        self.make_run(volume="editfail")
        status, answer = self.call("open")
        self.assertEqual((status, answer["code"], answer["error"]["code"]), (503, "engine", "m.save.engineNotStartedLog"))


class CacheTests(Case):
    def test_glyphs_and_rasters(self):
        fonts, rasters = self.home / "cache" / "fonts", self.home / "cache" / "rasters"
        fonts.mkdir(parents=True)
        rasters.mkdir(parents=True)
        face, key = "a" * 24, "b" * 24
        shutil.copyfile(FONT, fonts / f"{face}.ttf")
        (rasters / f"{key}.cmyk").write_bytes(bytes([0, 0, 0, 255]) * 4)
        (rasters / f"{key}.json").write_text(json.dumps({"width_px": 2, "height_px": 2}))
        status, ctype, body = self.request("GET", f"/v1/glyphs/{ORG}/{PUB}/{face}?ids=1,2,99999")
        doc = json.loads(body)
        self.assertEqual((status, ctype, sorted(doc["glyphs"]), doc["upem"]), (200, "application/json", ["1", "2"], 1000))
        status, ctype, body = self.request("GET", f"/v1/raster/{ORG}/{PUB}/{key}.jpg")
        self.assertEqual((status, ctype, body[:2]), (200, "image/jpeg", b"\xff\xd8"))
        for path in (f"/v1/glyphs/{ORG}/{PUB}/{'c' * 24}?ids=1", f"/v1/raster/{ORG}/{PUB}/{'c' * 24}.jpg",
                     f"/v1/raster/{OTHER_ORG}/{PUB}/{key}.jpg", f"/v1/raster/{ORG}/{PUB}/../x.jpg", "/v1/other"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        self.assertEqual(self.request("GET", f"/v1/raster/{ORG}/{PUB}/{key}.jpg", sig="1" * 64)[0], 401)


if __name__ == "__main__":
    unittest.main()
