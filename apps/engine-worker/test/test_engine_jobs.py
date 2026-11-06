"""Tests for the engine's kinds (pgn_worker/engine.py, launcher.py, media.ad; L2.3): engine.setup, engine.measure,
engine.layout and media.ad, through the job runner, with a fake engine (test/fake_desk_engine.py: the real one needs
the paper's private dataset) that writes real one-page PDFs, and the REAL independent PDF/X-1a checker on them.
Fictional data only; the store is a folder.
    <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from pgn_worker import engine, jobs, keys, launcher, run  # noqa: E402
from pgn_worker.desk import DESK, REPO, desk_text, images, messages as M  # noqa: E402
from pgn_worker.storage import FolderStorage  # noqa: E402

from test_media import ICC, ORG, OTHER_ORG, PROFILE, PUB, REAL_RGB_TO_CMYK, picture  # noqa: E402

PROFILE_ID = "01890a5d-ac96-774b-bcce-b302099a8061"
EDITION = "01890a5d-ac96-774b-bcce-b302099a8062"
RUN_ID = "01890a5d-ac96-774b-bcce-b302099a8063"
ARTWORK = "01890a5d-ac96-774b-bcce-b302099a8064"
ASSET = "01890a5d-ac96-774b-bcce-b302099a8065"
NEW_PROFILE = "01890a5d-ac96-774b-bcce-b302099a8066"
EID, RKEY = "2026-11-04", "r-20261104-101500"
FAKE = (WORKER / "test" / "fake_desk_engine.py").read_text(encoding="utf-8")
FIXTURE = WORKER.parents[1] / "packages" / "contracts" / "test" / "fixtures" / "engine-results.json"


def dataset_zip(extra: dict[str, bytes] | None = None, pages: bool = True, links: tuple[str, ...] = ()) -> bytes:
    """A fictional dataset folder as a ZIP: a page model, a template photo, and what `extra` adds."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("report/", b"")
        if pages:
            z.writestr("report/page1/pages/fictional-p1.json", json.dumps({"split": "cal", "page": 1}))
        z.writestr("pages/fictional-p1.png", b"not really a picture")
        for name, data in (extra or {}).items():
            z.writestr(name, data)
        for name in links:
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(info, "/etc/passwd")
    return buf.getvalue()


def article(n: int) -> dict:
    return {"id": f"a-{n:010x}", "headline": f"Fictional headline {n}", "kicker": "", "deck": "", "byline": "",
            "body": "Fictional text.", "priority": 3, "page": None, "photo": None, "source": "", "created": "",
            "updated": ""}


class Case(unittest.TestCase):
    def setUp(self):
        images.rgb_to_cmyk = lambda img: img.convert("CMYK")
        self.tmp = Path(tempfile.mkdtemp(prefix="worker-engine-"))
        self.store = FolderStorage(self.tmp / "bucket")
        self.guard = keys.KeyGuard(ORG, PUB)
        fake = self.tmp / "engine" / "desk_engine.py"                 # the name the Desk's stop_orphan looks for
        fake.parent.mkdir()
        fake.write_text(f"ENGINE_DIR = {str(DESK / 'engine')!r}\n" + FAKE, encoding="utf-8")
        self.homes = self.tmp / "homes"
        self.env = {"PGN_ENGINE_PYTHON": sys.executable, "PAGEINATOR_DESK_ENGINE": str(fake),
                    "PGN_WORKER_HOMES": str(self.homes), "PGN_ENGINE_STALL_S": "600"}
        self.profile = self.tmp / "profile.icc"
        self.profile.write_bytes(PROFILE)
        self.saved_icc = os.environ.get("PAGEINATOR_ICC")
        os.environ["PAGEINATOR_ICC"] = str(self.profile)
        self.lines: list[dict] = []
        patcher = mock.patch.multiple(launcher, POLL_S=0.05, KILL_AFTER_S=1.0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        if self.saved_icc is None:
            os.environ.pop("PAGEINATOR_ICC", None)
        else:
            os.environ["PAGEINATOR_ICC"] = self.saved_icc
        shutil.rmtree(self.tmp, ignore_errors=True)

    @property
    def home(self) -> Path:
        return self.homes / ORG / PUB

    def put(self, key: str, data: bytes) -> dict:
        return {"version_id": self.store.put(key, data, "application/octet-stream"),
                "sha256": hashlib.sha256(data).hexdigest()}

    def run_job(self, kind: str, args: dict, cancel: threading.Event | None = None, env: dict | None = None) -> dict:
        job = {"format": jobs.JOB_FORMAT, "id": "job-7", "kind": kind, "args": args}
        out = jobs.run(job, lambda guard: self.store, ICC, progress=self.lines.append, cancel=cancel,
                       environ={**self.env, **(env or {})})
        return json.loads(json.dumps(out))

    # ------------------------------------------------------------------------------- the jobs' arguments

    def setup_args(self, data: bytes | None = None) -> dict:
        pinned = self.put(self.guard.profile_dataset(PROFILE_ID), dataset_zip() if data is None else data)
        return {"org_id": ORG, "pub_id": PUB, "profile_id": PROFILE_ID, **pinned}

    def profile_facts(self) -> dict:
        """A profile set up (engine.setup through the fake engine): the facts a measure or a layout names."""
        args = self.setup_args()
        ready = self.run_job("engine.setup", args)["event"]
        self.assertEqual(ready["kind"], "profile.ready")
        return {"profile_id": PROFILE_ID, "dataset_version_id": args["version_id"], "dataset_sha256": args["sha256"],
                "config_version_id": ready["config"]["version_id"], "config_sha256": ready["config"]["sha256"]}

    def layout_args(self, mode: str = "", articles: int = 3, request: dict | None = None) -> dict:
        req = request or {"edition": {"id": EID, "date": EID, "pages": 4, "volume": mode, "issue": "",
                                      "back_page_ads": True},
                          "articles": [article(n) for n in range(1, articles + 1)], "ads": {}}
        pinned = self.put(self.guard.run_request(RUN_ID), json.dumps(req).encode("utf-8"))
        return {"org_id": ORG, "pub_id": PUB, "run_id": RUN_ID, "edition_key": EID, "run_key": RKEY, **pinned,
                **self.profile_facts()}

    def measure_args(self, mode: str = "") -> dict:
        req = {"edition": {"id": EID, "date": EID, "pages": 4, "volume": "", "issue": mode},
               "articles": [article(n) for n in range(1, 4)], "ads": {}}
        pinned = self.put(self.guard.edition_measure(EDITION), json.dumps(req).encode("utf-8"))
        return {"org_id": ORG, "pub_id": PUB, "edition_id": EDITION, "edition_key": EID, **pinned,
                **self.profile_facts()}

    def ad_args(self, data: bytes, w: str = "100", h: str = "50") -> dict:
        pinned = self.put(self.guard.asset_original(ASSET), data)
        return {"org_id": ORG, "pub_id": PUB, "artwork_id": ARTWORK, "asset_id": ASSET, **pinned, "w_mm": w,
                "h_mm": h}

    def calls(self) -> list[str]:
        f = self.home / "fake-engine-calls.txt"
        return f.read_text().split("\n")[:-1] if f.exists() else []

    def stored(self, key: str) -> bytes:
        return (self.tmp / "bucket" / key).read_bytes()


# ------------------------------------------------------------------------------------------- engine.setup


class SetupTests(Case):
    def test_a_dataset_becomes_a_profile(self):
        args = self.setup_args()
        out = self.run_job("engine.setup", args)
        self.assertEqual(out["outcome"], "done")
        ev = out["event"]
        self.assertEqual(ev["kind"], "profile.ready")
        self.assertEqual((ev["org_id"], ev["pub_id"], ev["profile_id"], ev["sha256"]), (ORG, PUB, PROFILE_ID,
                                                                                          args["sha256"]))
        ds = self.home / "datasets" / args["sha256"]
        self.assertTrue((ds / "report" / "page1" / "pages" / "fictional-p1.json").is_file())
        self.assertEqual(self.calls()[0], f"setup {ds}")
        self.assertEqual(len([c for c in self.calls() if c.startswith("plan")]), 6)
        stored = json.loads(self.stored(ev["config"]["key"]))
        self.assertEqual(ev["config"]["key"], f"orgs/{ORG}/pubs/{PUB}/profiles/{PROFILE_ID}/config.json")
        self.assertNotIn("dataset", stored)                     # the worker's local path is not the profile's
        self.assertEqual(hashlib.sha256(self.stored(ev["config"]["key"])).hexdigest(), ev["config"]["sha256"])
        self.assertEqual(ev["templates"]["back"], "fictional-p4")
        self.assertEqual(ev["grid"], {"columns": 8, "column_width_mm": 36.5, "gutter_mm": 4.19})
        self.assertEqual([(p["pages"], p["back_page_ads"]) for p in ev["plans"]],
                         [(4, True), (4, False), (8, True), (8, False), (16, True), (16, False)])
        self.assertEqual(ev["plans"][0]["page_plan"][3]["ad_slots"], [{"slot": "back-1", "w_mm": 100.0, "h_mm": 50.0}])
        self.assertEqual(ev["engine_version"], "desk-engine/0.1.0")
        # unpacked once: a second profile of the same bytes downloads and unpacks nothing
        before = (ds / "report").stat().st_ino
        self.assertEqual(self.run_job("engine.setup", args)["event"]["kind"], "profile.ready")
        self.assertEqual((ds / "report").stat().st_ino, before)
        self.assertEqual(sorted(p.name for p in (self.home / "datasets").iterdir()), [args["sha256"]])

    def test_the_desks_own_config_keeps_its_templates(self):
        own = {"schema": "pageinator.desk.config/1", "engine": "desk-engine/0.1.0", "dataset": "/Users/someone/x",
               "templates": {"front": "chosen-by-the-desk", "inside_imprint": "b", "inside": "c", "back": "d"}}
        ev = self.run_job("engine.setup", self.setup_args(dataset_zip({"config.json": json.dumps(own).encode()})))[
            "event"]
        self.assertEqual(ev["kind"], "profile.ready")
        self.assertEqual(ev["templates"]["front"], "chosen-by-the-desk")
        self.assertFalse(any(c.startswith("setup") for c in self.calls()))
        self.assertNotIn("dataset", json.loads(self.stored(ev["config"]["key"])))

    def test_bundles_the_worker_refuses(self):
        cases = {
            "profile.not_zip": b"not a zip, only fictional bytes",
            "profile.unsafe_path": dataset_zip({"../outside.txt": b"x"}),
            "profile.no_pages": dataset_zip(pages=False),
        }
        absolute = dataset_zip({"/etc/fictional": b"x"})
        linked = dataset_zip(links=("report/page1/pages/link.json",))
        for code, data in [*cases.items(), ("profile.unsafe_path", absolute), ("profile.unsafe_path", linked)]:
            with self.subTest(code=code):
                out = self.run_job("engine.setup", self.setup_args(data))
                self.assertEqual(out["outcome"], "done")
                ev = out["event"]
                self.assertEqual((ev["kind"], ev["code"]), ("profile.rejected", code))
                self.assertEqual(set(ev["message"]), {"text", "code", "params"})
                self.assertFalse((self.home / "datasets" / ev["sha256"]).exists())     # nothing half unpacked
                self.assertEqual([p.name for p in (self.home / "datasets").iterdir()], [])
        self.assertFalse((self.tmp / "outside.txt").exists())
        with mock.patch.object(engine, "MAX_FILES", 2):
            ev = self.run_job("engine.setup", self.setup_args(dataset_zip({"x/y": b"z"})))["event"]
            self.assertEqual(ev["code"], "profile.too_large")

    def test_the_engines_refusal_is_said_in_its_words(self):
        ev = self.run_job("engine.setup", self.setup_args(dataset_zip({"fake-mode": b"setupfail"})))["event"]
        self.assertEqual((ev["kind"], ev["code"]), ("profile.rejected", "profile.setup"))
        self.assertEqual(ev["message"], {"text": "no page of the dataset can serve as the back template", "code": None,
                                         "params": None})

    def test_other_bytes_than_the_job_names_are_refused(self):
        args = {**self.setup_args(), "sha256": "0" * 64}
        out = self.run_job("engine.setup", args)
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.checksum"))
        self.assertEqual(list((self.home / "datasets").iterdir()), [])       # the download is not kept

    def base_args(self, **extra) -> dict:
        """A new profile from PROFILE_ID's (set up first): its dataset copied, the base config pinned."""
        facts = self.profile_facts()
        args = self.setup_args()
        return {**args, "profile_id": NEW_PROFILE, **self.put(self.guard.profile_dataset(NEW_PROFILE),
                                                              dataset_zip()),
                "base_profile_id": PROFILE_ID, "base_config_version_id": facts["config_version_id"],
                "base_config_sha256": facts["config_sha256"], **extra}

    def test_a_template_chosen_makes_a_new_profile_from_the_one_in_use(self):
        out = self.run_job("engine.setup", self.base_args(template_role="back", template_page="fictional-back-1"))
        ev = out["event"]
        self.assertEqual((ev["kind"], ev["profile_id"]), ("profile.ready", NEW_PROFILE))
        self.assertEqual(ev["templates"], {"front": "fictional-p1", "inside_imprint": "fictional-p2",
                                           "inside": "fictional-p3", "back": "fictional-back-1"})
        self.assertEqual([c["name"] for c in ev["candidates"]["back"]], ["fictional-back-2", "fictional-back-1"])
        self.assertEqual(ev["icc_sha256"], ICC)
        self.assertEqual(ev["config"]["key"], f"orgs/{ORG}/pubs/{PUB}/profiles/{NEW_PROFILE}/config.json")
        self.assertEqual(json.loads(self.stored(ev["config"]["key"]))["templates"]["back"], "fictional-back-1")
        self.assertIn("retemplate -", self.calls())
        self.assertEqual(len([c for c in self.calls() if c.startswith("setup")]), 1)     # the base's only

    def test_a_page_that_is_not_a_candidate_is_refused_in_the_engines_words(self):
        ev = self.run_job("engine.setup", self.base_args(template_role="back", template_page="fictional-front-1"))[
            "event"]
        self.assertEqual((ev["kind"], ev["code"]), ("profile.rejected", "profile.setup"))
        self.assertEqual(ev["message"]["text"], "the page fictional-front-1 cannot serve as the back template")

    def test_no_choice_finds_the_candidates_again(self):
        ev = self.run_job("engine.setup", self.base_args())["event"]
        self.assertEqual((ev["kind"], ev["templates"]["back"]), ("profile.ready", "fictional-p4"))
        self.assertIn("candidates -", self.calls())

    def test_the_base_config_is_checked_and_its_arguments_go_together(self):
        out = self.run_job("engine.setup", self.base_args(base_config_sha256="0" * 64))
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.checksum"))
        args = self.base_args(template_role="back", template_page="x")
        for drop in ("base_config_sha256", "template_page"):
            with self.subTest(drop=drop):
                out = self.run_job("engine.setup", {k: v for k, v in args.items() if k != drop})
                self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.job"))
        out = self.run_job("engine.setup", {**args, "template_role": "Back!"})
        self.assertEqual(out["error"]["code"], "worker.job")

    def test_a_desk_config_without_candidates_gets_them(self):
        own = {"schema": "pageinator.desk.config/1", "engine": "desk-engine/0.1.0",
               "templates": {"front": "a", "inside_imprint": "b", "inside": "c", "back": "d"}}
        ev = self.run_job("engine.setup", self.setup_args(dataset_zip({"config.json": json.dumps(own).encode()})))[
            "event"]
        self.assertEqual(sorted(ev["candidates"]), ["back", "front", "inside", "inside_imprint"])

    def test_the_engines_settings(self):
        args = self.setup_args()
        for env in ({"PGN_ENGINE_PYTHON": ""}, {"PGN_ENGINE_PYTHON": "python3"}, {"PGN_ENGINE_STALL_S": "0"},
                    {"PAGEINATOR_DESK_ENGINE": str(self.tmp / "missing.py")}):
            with self.subTest(env=env):
                out = self.run_job("engine.setup", args, env=env)
                self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.config"))
        self.assertEqual(run.EXIT["worker.config"], 78)

    def test_a_dataset_with_its_own_house_profile_gives_its_grid(self):
        ds = self.tmp / "own"
        ds.mkdir()
        self.assertEqual(engine.grid(ds)["columns"], 8)                       # the repository's (the pilot's)
        (ds / "house_profile.json").write_text(json.dumps(
            {"grid": {"columns": 6, "column_width_mm": 46.0, "gutter_mm": 4.0, "origin_mm": 12.0}}), encoding="utf-8")
        self.assertEqual(engine.grid(ds), {"columns": 6, "column_width_mm": 46.0, "gutter_mm": 4.0})


# ------------------------------------------------------------------------------------------- engine.layout


class LayoutTests(Case):
    def test_a_run_lays_out_checks_and_stores_every_page(self):
        args = self.layout_args()
        out = self.run_job("engine.layout", args)
        self.assertEqual(out["outcome"], "done")
        ev = out["event"]
        self.assertEqual((ev["kind"], ev["state"], ev["error"]), ("run.finished", "done", None))
        # one coded message, the most important (the fake pages fail the check), so the web can say it in Marathi
        self.assertEqual(ev["message"], {"text": M.msg("m.run.checkProblems", files="page-01.pdf, page-02.pdf"),
                                         "code": "m.run.checkProblems",
                                         "params": {"files": "page-01.pdf, page-02.pdf"}})
        prefix = f"orgs/{ORG}/pubs/{PUB}/runs/{RUN_ID}/"
        self.assertEqual([p["state"] for p in ev["pages"]], ["done", "done"])
        for p in ev["pages"]:
            nn = f"{p['page']:02d}"
            self.assertEqual([p["pdf"]["key"], p["png"]["key"], p["thumb"]["key"], p["check"]["report"]["key"]],
                             [prefix + f"pages/{nn}/{n}" for n in ("page.pdf", "preview.png", "thumb.png",
                                                                    "pdfx-check.txt")])
            for f in ("pdf", "png", "thumb"):
                data = self.stored(p[f]["key"])
                self.assertEqual((hashlib.sha256(data).hexdigest(), len(data)), (p[f]["sha256"], p[f]["bytes"]))
            # the real independent checker's verdict on the fake page (not a PDF/X-1a file: it fails, and says why)
            self.assertFalse(p["check"]["passed"])
            self.assertIsInstance(p["check"]["fails"], int)
            self.assertGreater(p["check"]["fails"], 0)
            self.assertIn(b"FAIL", self.stored(p["check"]["report"]["key"]))
            self.assertEqual(p["warnings"][0]["code"], "m.warn.charRemoved")
            self.assertEqual(p["warnings"][0]["params"], {"what": "the headline", "code": "2018"})   # as the English shows it
        self.assertEqual(ev["pages"][0]["articles"], [article(1)["id"], article(3)["id"]])
        self.assertEqual(ev["edition_pdf"]["key"], prefix + "edition.pdf")
        self.assertEqual(ev["press_zip"]["key"], prefix + "press-files.zip")
        with zipfile.ZipFile(io.BytesIO(self.stored(ev["press_zip"]["key"]))) as z:
            self.assertEqual(z.namelist(), ["page-01.pdf", "page-02.pdf"])
        self.assertEqual(ev["checker_sha256"], hashlib.sha256(
            (REPO / "experiments/phase0/pdfx1/check_pdfx1a_independent.py").read_bytes()).hexdigest())
        self.assertEqual(ev["not_placed"], [{"article": article(1)["id"], "reason": {
            "text": M.msg("m.plan.needsText"), "code": "m.plan.needsText", "params": {}}}])
        self.assertEqual(ev["timings"], {"measure_s": 0.1, "plan_s": 0.2, "layout_s": 0.3})
        run_dir = self.home / "editions" / EID / "runs" / RKEY
        self.assertEqual(ev["ads"], launcher.run_ads(run_dir))              # what the run's pages print
        # the progress lines: run.progress, and run.page for each page once its files are stored
        kinds = [e["kind"] for e in self.lines]
        self.assertEqual(kinds[0], "run.progress")
        self.assertEqual([e["page"] for e in self.lines if e["kind"] == "run.page"], [1, 2])
        self.assertEqual([e["state"] for e in self.lines if e["kind"] == "run.progress"][-2:],
                         ["finishing", "finishing"])
        for e in self.lines:
            if e["kind"] == "run.page":
                self.assertTrue(e["png"] and e["thumb"])
        self.assertFalse((self.home / "editions" / EID / "runs" / RKEY / "engine.pid").exists())

    def test_an_engine_failure_is_a_failed_run_in_its_own_words(self):
        for mode, words in (("fail", "The fake engine failed on purpose."),
                            ("allfail", "2 of 2 pages could not be laid out"),
                            ("crash", "The layout engine stopped with an error (exit code 3).")):
            with self.subTest(mode=mode):
                self.lines.clear()
                out = self.run_job("engine.layout", self.layout_args(mode))
                self.assertEqual(out["outcome"], "done")                      # the job finished: the run failed
                ev = out["event"]
                self.assertEqual((ev["state"], ev["edition_pdf"], ev["press_zip"]), ("failed", None, None))
                self.assertTrue(ev["error"]["text"].startswith(words), ev["error"])
                self.assertTrue(all(p["state"] == "failed" for p in ev["pages"]))

    def test_half_the_pages(self):
        ev = self.run_job("engine.layout", self.layout_args("half"))["event"]
        self.assertEqual(ev["state"], "done")
        self.assertEqual([p["state"] for p in ev["pages"]], ["done", "failed"])
        self.assertEqual(ev["pages"][1]["message"]["text"], "a fictional layout problem")
        self.assertEqual(ev["message"]["code"], "m.run.checkProblems")         # the stored page fails the check
        passed = {"passed": True, "fails": 0, "warnings": 0}
        with mock.patch.object(launcher.runs, "check_pdfx", return_value=passed):
            ev = self.run_job("engine.layout", self.layout_args("half"))["event"]
        self.assertEqual((ev["message"]["code"], ev["message"]["params"]), ("m.run.madeFailed", {"n": 1}))
        with mock.patch.object(launcher.runs, "check_pdfx", return_value=passed):
            ev = self.run_job("engine.layout", self.layout_args())["event"]
        self.assertEqual((ev["message"]["code"], ev["message"]["params"]), ("m.run.madeN", {"n": 2}))

    def test_the_heartbeat_goes_on_after_the_engine_is_done(self):
        merge = launcher.runs.merge_pdfs

        def slow_merge(*a):
            time.sleep(0.5)                                   # the merge of a full edition takes a while
            return merge(*a)
        with mock.patch.object(launcher, "HEARTBEAT_S", 0.1), \
                mock.patch.object(launcher.runs, "merge_pdfs", side_effect=slow_merge):
            out = self.run_job("engine.layout", self.layout_args())
        self.assertEqual(out["event"]["state"], "done")
        putting = [e for e in self.lines if e["kind"] == "run.progress" and e["message"]
                   and e["message"]["code"] == "m.run.putting"]
        self.assertGreaterEqual(len(putting), 3, putting)     # said once, then again while the merge ran

    def cancel_when(self, ready, args: dict, cancel: threading.Event) -> tuple[dict, int]:
        """Runs the layout, sets cancel once ready(lines) holds; → the result and the engine's group id."""
        seen: dict = {}

        def watch():
            while not ready(self.lines):
                time.sleep(0.02)
            pid = self.home / "editions" / EID / "runs" / RKEY / "engine.pid"
            seen["pgid"] = int(pid.read_text())
            cancel.set()
        t = threading.Thread(target=watch, daemon=True)
        t.start()
        out = self.run_job("engine.layout", args, cancel=cancel)
        t.join(5)
        return out, seen["pgid"]

    def assert_gone(self, pgid: int) -> None:
        with self.assertRaises(ProcessLookupError):
            os.killpg(pgid, 0)

    def test_a_cancel_stops_the_engines_group_and_answers_cancelled(self):
        args = self.layout_args("slow")
        out, pgid = self.cancel_when(lambda lines: any(e.get("state") == "layout" for e in lines), args,
                                     threading.Event())
        ev = out["event"]
        self.assertEqual((out["outcome"], ev["state"]), ("done", "cancelled"))
        self.assertEqual(ev["message"]["code"], "m.run.cancelled")
        self.assertTrue(all(p["state"] == "cancelled" for p in ev["pages"]))
        self.assert_gone(pgid)

    def test_a_cancel_after_a_page_keeps_its_files_unchecked(self):
        out, pgid = self.cancel_when(lambda lines: any(e["kind"] == "run.page" for e in lines),
                                     self.layout_args("pagewait"), threading.Event())
        ev = out["event"]
        self.assertEqual(ev["state"], "cancelled")
        self.assertEqual([p["state"] for p in ev["pages"]], ["done", "cancelled"])
        self.assertEqual(ev["pages"][0]["check"], {"passed": False, "fails": None, "warnings": None, "report": None})
        self.assert_gone(pgid)

    def test_an_engine_that_ignores_sigterm_is_killed(self):
        out, pgid = self.cancel_when(lambda lines: any(e.get("state") == "layout" for e in lines),
                                     self.layout_args("stubborn"), threading.Event())
        self.assertEqual(out["event"]["state"], "cancelled")
        self.assert_gone(pgid)

    def test_sigterm_is_the_cancel(self):
        old = signal.getsignal(signal.SIGTERM)
        try:
            cancel = run._cancel_on_sigterm()
            os.kill(os.getpid(), signal.SIGTERM)
            self.assertTrue(cancel.wait(2))
        finally:
            signal.signal(signal.SIGTERM, old)

    def test_a_stalled_engine_is_stopped(self):
        args = self.layout_args("slow")
        out = self.run_job("engine.layout", args, env={"PGN_ENGINE_STALL_S": "1"})
        ev = out["event"]
        self.assertEqual((out["outcome"], ev["state"]), ("done", "failed"))
        self.assertEqual(ev["error"]["text"], "The layout engine was stopped: it did nothing for 1 seconds.")

    def test_an_engine_left_by_a_dead_launcher_is_stopped_first(self):
        self.layout_args()                                           # the profile, so the home exists
        other = self.home / "editions" / "2026-11-01" / "runs" / "r-20261101-090000"
        other.mkdir(parents=True)
        (other / "request.json").write_text(json.dumps({"edition": {"volume": "slow"}, "articles": [], "ads": {}}))
        orphan = subprocess.Popen([sys.executable, self.env["PAGEINATOR_DESK_ENGINE"], "generate", "--home",
                                   str(self.home), "--edition", "2026-11-01", "--run", "r-20261101-090000"],
                                  start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  env={"PATH": os.environ["PATH"]})
        try:
            (other / "engine.pid").write_text(f"{orphan.pid}\n")
            for _ in range(100):                                     # until it runs as the engine
                if (other / "engine-status.json").exists():
                    break
                time.sleep(0.05)
            out = self.run_job("engine.layout", self.layout_args())
            self.assertEqual(out["event"]["state"], "done")
            self.assertIsNotNone(orphan.poll())                      # stopped (and reaped here)
            self.assertFalse((other / "engine.pid").exists())
        finally:
            if orphan.poll() is None:
                os.killpg(orphan.pid, signal.SIGKILL)
                orphan.wait()

    def test_a_request_that_is_not_the_one_named_is_refused(self):
        args = {**self.layout_args(), "sha256": "1" * 64}
        out = self.run_job("engine.layout", args)
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.checksum"))
        args = self.layout_args()
        out = self.run_job("engine.layout", {**args, "config_sha256": "2" * 64})
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.checksum"))

    def test_a_job_for_one_organisation_reaches_no_key_of_another(self):
        args = self.layout_args()
        other = keys.KeyGuard(OTHER_ORG, PUB)
        raster = other.key("assets", ASSET, "r", "cmyk-" + "0" * 32 + ".cmyk.gz")
        req = {"edition": {"id": EID, "volume": ""}, "articles": [], "ads": {"back-1": {
            "width_px": 2, "height_px": 2, "raster": {"key": raster, "version_id": "v", "sha256": "0" * 64,
                                                      "width_px": 2, "height_px": 2}}}}
        out = self.run_job("engine.layout", {**args, **self.put(self.guard.run_request(RUN_ID), json.dumps(req).encode())})
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.key"))
        # the keys are made from the job's own ids: another organisation's ids are another prefix
        self.assertTrue(other.run_request(RUN_ID).startswith(f"orgs/{OTHER_ORG}/"))
        with self.assertRaises(keys.KeyRefused):
            self.guard.check(other.profile_config(PROFILE_ID))
        for bad in (("request.json", 1), ("page.pdf", None), ("edition.pdf", 1), ("page.pdf", 17)):
            with self.assertRaises(keys.KeyRefused):
                self.guard.run_file(RUN_ID, *bad)

    def test_a_closed_stdout_stops_the_engine_and_writes_nothing_more(self):
        args = self.layout_args("slow")
        job = json.dumps({"format": jobs.JOB_FORMAT, "id": "job-9", "kind": "engine.layout", "args": args}).encode()

        class Closing(io.BytesIO):
            def write(self, data):
                if self.getvalue():                                  # the first line goes; then the queue is gone
                    raise BrokenPipeError()
                return super().write(data)
        out = Closing()
        code = run.main([], stdin=io.BytesIO(job), stdout=out, environ=self.env,
                        setup=lambda environ: ((lambda guard: self.store), ICC))
        self.assertEqual(code, 74)
        self.assertEqual(len(out.getvalue().splitlines()), 1)
        pid = self.home / "editions" / EID / "runs" / RKEY / "engine.pid"
        self.assertFalse(pid.exists())                                # stopped, its pid file gone

    def test_the_command_writes_progress_lines_then_the_result(self):
        args = self.layout_args()
        job = json.dumps({"format": jobs.JOB_FORMAT, "id": "job-8", "kind": "engine.layout", "args": args}).encode()
        out = io.BytesIO()
        code = run.main([], stdin=io.BytesIO(job), stdout=out, environ=self.env,
                        setup=lambda environ: ((lambda guard: self.store), ICC))
        self.assertEqual(code, 0)
        lines = [json.loads(x) for x in out.getvalue().decode("utf-8").splitlines()]
        *progress, result = lines
        self.assertEqual(result["format"], jobs.RESULT_FORMAT)
        self.assertEqual(result["event"]["kind"], "run.finished")
        self.assertEqual([p["seq"] for p in progress], list(range(1, len(progress) + 1)))
        for p in progress:
            self.assertEqual((set(p), p["format"], p["job"]), ({"format", "job", "seq", "event"},
                                                               run.PROGRESS_FORMAT, "job-8"))
            self.assertIn(p["event"]["kind"], ("run.progress", "run.page"))


# ------------------------------------------------------------------------------------------- engine.measure


class RunAdsTests(unittest.TestCase):
    def test_a_run_records_the_ad_rasters_its_own_folder_holds_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            ads = run_dir / "ads"
            self.assertEqual(launcher.run_ads(None), {})
            self.assertEqual(launcher.run_ads(run_dir), {})                   # no ads folder: no ads
            ads.mkdir()
            (ads / "back-1.cmyk.gz").write_bytes(b"raster one")
            (ads / "stray.cmyk.gz").write_bytes(b"no index entry")
            (ads / "index.json").write_text(json.dumps({"elements": {"back-1": {}, "back-2": {}}}), encoding="utf-8")
            self.assertEqual(launcher.run_ads(run_dir), {"back-1": hashlib.sha256(b"raster one").hexdigest()})
            (ads / "index.json").write_text("{not json", encoding="utf-8")
            self.assertEqual(launcher.run_ads(run_dir), {})                   # a damaged index: nothing recorded


class MeasureTests(Case):
    def test_a_measure_counts_the_editions_stories(self):
        out = self.run_job("engine.measure", self.measure_args("slowmeasure"))
        ev = out["event"]
        self.assertEqual((ev["kind"], ev["state"], ev["measured"], ev["total"], ev["failed"]),
                         ("measure.status", "done", 3, 3, 0))
        self.assertEqual(ev["edition_id"], EDITION)
        self.assertEqual(self.lines[0], {**ev, "state": "measuring", "measured": 0})
        ed = self.home / "editions" / EID
        self.assertTrue((ed / "articles.json").is_file())
        self.assertFalse((ed / "runs").exists())                 # the edition's files only
        self.assertIn(f"measure {EID}", self.calls())

    def test_a_failed_or_stopped_measure(self):
        self.assertEqual(self.run_job("engine.measure", self.measure_args("failmeasure"))["event"]["state"], "failed")
        cancel = threading.Event()
        args = self.measure_args("hangmeasure")
        self.lines.clear()

        def stop_once_measuring():                    # a slow machine (an emulated image) takes seconds to start it
            while not self.lines:
                time.sleep(0.02)
            cancel.set()
        threading.Thread(target=stop_once_measuring, daemon=True).start()
        ev = self.run_job("engine.measure", args, cancel=cancel)["event"]
        self.assertEqual((ev["state"], ev["measured"], ev["total"]), ("stopped", 0, 3))
        self.assertFalse((self.home / "editions" / EID / "engine.pid").exists())


# ------------------------------------------------------------------------------------------- media.ad


class AdTests(Case):
    def test_an_ad_fitted_into_its_slot(self):
        out = self.run_job("media.ad", self.ad_args(picture(size=(800, 400)), "100", "50.5"))
        ev = out["event"]
        self.assertEqual(ev["kind"], "ad.ready")
        self.assertEqual((ev["artwork_id"], ev["asset_id"]), (ARTWORK, ASSET))
        raster = self.stored(ev["raster"]["key"])
        self.assertEqual(hashlib.sha256(raster).hexdigest(), ev["raster"]["sha256"])
        self.assertTrue(ev["raster"]["key"].endswith(f"/r/ad-cmyk-{ev['params_hash']}-100x50.5mm.cmyk.gz"))
        self.assertTrue(ev["preview"]["key"].endswith(f"/r/ad-preview-{ev['params_hash']}-100x50.5mm.jpg"))
        self.assertEqual(self.guard.cmyk_raster(ev["raster"]["key"]), ev["raster"]["key"])   # a run may place it
        with self.assertRaises(keys.KeyRefused):
            self.guard.cmyk_raster(ev["preview"]["key"])
        conv = images.convert_ad(picture(size=(800, 400)), 100.0, 50.5)                     # the Desk's own
        self.assertEqual((ev["raster"]["width_px"], ev["raster"]["height_px"]), (conv.width, conv.height))

    def test_artwork_the_desk_refuses(self):
        ev = self.run_job("media.ad", self.ad_args(b"not a picture, only fictional bytes"))["event"]
        self.assertEqual((ev["kind"], ev["status"], ev["message"]["code"]), ("ad.rejected", 400, "m.img.notAPicture"))

    def test_sizes_that_are_not_one(self):
        for w in ("0", "-1", "1.234", "10000", "1e3", " 5"):
            with self.subTest(w=w):
                out = self.run_job("media.ad", self.ad_args(picture(), w=w))
                self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.job"))


class DeskTextTests(unittest.TestCase):
    def test_the_desks_words(self):
        self.assertEqual(desk_text(M.msg("m.run.madeN", n=3)), {"text": M.msg("m.run.madeN", n=3), "code": "m.run.madeN",
                                                               "params": {"n": 3}})
        nested = M.msg("m.run.engineNotStarted", error=M.data("No such file"))
        self.assertEqual(desk_text(nested)["params"], {"error": "No such file"})
        self.assertEqual(desk_text("plain words"), {"text": "plain words", "code": None, "params": None})
        joined = M.join(M.msg("m.run.made1"), M.msg("m.run.madeFailed", n=1))
        self.assertEqual(desk_text(joined)["code"], None)
        status = M.annotate({"message": M.msg("m.run.madeN", n=2)})
        self.assertEqual(desk_text(str(status["message"]), status["msgs"])["code"], "m.run.madeN")


# ------------------------------------------------------------------------------------------- the contract


VOLATILE = ("params_hash", "key", "version_id", "sha256", "bytes", "elapsed_s", "seconds", "check", "seq", "width_px",
            "height_px")


def steady(value):
    if isinstance(value, list):
        return [steady(v) for v in value]
    if isinstance(value, dict):
        return {k: None if k in VOLATILE else steady(v) for k, v in value.items()}
    return value


class ContractTests(Case):
    """What the engine's kinds write, one of each event and progress line, is packages/contracts' fixture
    (engine-results.json): vitest reads every result with WorkerResult and every line with WorkerProgress. Rewrite it
    with PGN_WRITE_FIXTURE=1 after a change to what they write."""

    def test_the_contract_fixture_is_what_the_runner_writes(self):
        results, progress = [], []

        def job(kind, args, cancel=None):
            self.lines.clear()
            results.append(self.run_job(kind, args, cancel))
            first = {}
            for e in self.lines:
                first.setdefault(e["kind"], e)
            for e in first.values():
                progress.append({"format": run.PROGRESS_FORMAT, "job": "job-7", "seq": self.lines.index(e) + 1,
                                 "event": e})

        job("engine.setup", self.setup_args())
        job("engine.setup", self.setup_args(dataset_zip({"../x": b"x"})))
        job("engine.layout", self.layout_args())
        job("engine.layout", self.layout_args("fail"))
        job("engine.measure", self.measure_args("slowmeasure"))
        cancel = threading.Event()
        cancel.set()
        job("engine.layout", self.layout_args("slow"), cancel)
        job("media.ad", self.ad_args(picture(size=(400, 200))))
        job("media.ad", self.ad_args(b"not a picture"))
        got = json.loads(json.dumps({"results": results, "progress": progress}))
        self.assertEqual([r["event"]["kind"] for r in results],
                         ["profile.ready", "profile.rejected", "run.finished", "run.finished", "measure.status",
                          "run.finished", "ad.ready", "ad.rejected"])
        self.assertEqual({p["event"]["kind"] for p in progress}, {"run.progress", "run.page", "measure.status"})
        if os.environ.get("PGN_WRITE_FIXTURE") == "1":
            FIXTURE.write_text(json.dumps(got, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        self.assertEqual(steady(json.loads(FIXTURE.read_text(encoding="utf-8"))), steady(got))


if __name__ == "__main__":
    unittest.main()
