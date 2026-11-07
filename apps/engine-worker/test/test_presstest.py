"""Tests for the press test page (G2-1): the edit gateway's signed GET /v1/press-test (pgn_worker/gateway.py) with the
page's maker stood in, and the maker itself end to end (tools/desk/deskserver/presstest.py: the real engine and the real
independent PDF/X-1a checker) on a fictional colour profile (Pillow's plain RGB -> CMYK stands in for littleCMS: the
real profile is private).
    <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pikepdf

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from pgn_worker import engine, gateway  # noqa: E402
from pgn_worker.desk import REPO, images, presstest, util  # noqa: E402

from test_media import PROFILE, REAL_RGB_TO_CMYK  # noqa: E402

SECRET = bytes(range(32))
NOW = 1_800_000_000
ENGINE_PY = Path(os.environ.get("PGN_ENGINE_PYTHON") or REPO / "tools" / "oracle" / "v0" / ".venv" / "bin" / "python")
PDF = b"%PDF-1.4 a fictional page"


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="worker-presstest-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.profile = self.tmp / "profile.icc"
        self.profile.write_bytes(PROFILE)
        env = mock.patch.dict(os.environ, {"PAGEINATOR_ICC": str(self.profile)})
        env.start()
        self.addCleanup(env.stop)


class GatewayTests(Case):
    def setUp(self):
        super().setUp()
        settings = engine.Settings.from_env({"PGN_ENGINE_PYTHON": sys.executable,
                                             "PGN_WORKER_HOMES": str(self.tmp / "homes")})
        self.gw = gateway.Gateway(SECRET, settings, lambda guard: None, clock=lambda: float(NOW))
        self.made: list[tuple] = []

    def make(self, repo: Path, python: Path, work_dir: Path) -> dict:
        self.made.append((repo, python, work_dir))
        return {"pdf": PDF, "sha256": hashlib.sha256(PDF).hexdigest(),
                "icc_sha256": hashlib.sha256(self.profile.read_bytes()).hexdigest(),
                "check": {"passed": True, "fails": 0, "warnings": 8}, "maker": "press-test/1.0.0"}

    def get(self, sig: str | None = None) -> tuple[int, dict]:
        nonce = secrets.token_hex(16)
        headers = {"x-pgn-time": str(NOW), "x-pgn-nonce": nonce,
                   "x-pgn-signature": sig or gateway.signature(SECRET, "GET", "/v1/press-test", str(NOW), nonce, b"")}
        status, ctype, body = self.gw.handle("GET", "/v1/press-test", headers, b"")
        self.assertEqual(ctype, "application/json")
        return status, json.loads(body)

    def test_signed_answered_and_made_once_per_profile(self):
        with mock.patch.object(presstest, "make", self.make):
            self.assertEqual(self.get(sig="0" * 64), (401, {"error": "unauthorised"}))
            self.assertEqual(self.made, [])
            status, answer = self.get()
            self.assertEqual(status, 200)
            self.assertEqual(answer, {"format": "pageinator.press-test/1", "pdf": base64.b64encode(PDF).decode("ascii"),
                                      "sha256": hashlib.sha256(PDF).hexdigest(), "bytes": len(PDF),
                                      "icc_sha256": hashlib.sha256(PROFILE).hexdigest(),
                                      "check": {"passed": True, "fails": 0, "warnings": 8}, "maker": "press-test/1.0.0",
                                      "page_mm": [347, 540]})
            self.assertEqual(self.get(), (200, answer))                  # kept: made once
            [(repo, python, work)] = self.made
            self.assertEqual((repo, python), (REPO, Path(sys.executable)))
            self.assertFalse(work.exists())                               # its work folder is gone
            self.profile.write_bytes(PROFILE + b", another version")      # another profile: made again
            self.assertEqual(self.get()[1]["icc_sha256"], hashlib.sha256(self.profile.read_bytes()).hexdigest())
            self.assertEqual(len(self.made), 2)

    def test_a_page_that_cannot_be_made_is_500_and_not_kept(self):
        def fail(*_args):
            raise util.DeskError(500, presstest.ENGINE_FAILED)
        with mock.patch.object(presstest, "make", fail):
            self.assertEqual(self.get(), (500, {"error": presstest.ENGINE_FAILED}))
        with mock.patch.object(presstest, "make", self.make):
            self.assertEqual(self.get()[0], 200)
            self.profile.unlink()
            self.assertEqual(self.get(), (500, {"error": presstest.NO_PROFILE}))


@unittest.skipUnless(ENGINE_PY.is_file(), "needs the engine's Python (PGN_ENGINE_PYTHON)")
class MakeTests(Case):
    def test_the_page_passes_the_check_with_both_pictures_and_the_same_bytes_every_time(self):
        images.rgb_to_cmyk = lambda img: img.convert("CMYK")
        self.addCleanup(setattr, images, "rgb_to_cmyk", REAL_RGB_TO_CMYK)
        first = presstest.make(REPO, ENGINE_PY, self.tmp / "a")
        second = presstest.make(REPO, ENGINE_PY, self.tmp / "b")
        self.assertEqual(first["sha256"], hashlib.sha256(first["pdf"]).hexdigest())
        self.assertEqual(second["sha256"], first["sha256"])
        self.assertEqual(first["icc_sha256"], hashlib.sha256(PROFILE).hexdigest())
        self.assertEqual((first["check"]["passed"], first["check"]["fails"]), (True, 0), first["check"])
        self.assertTrue(first["maker"].startswith("press-test/"))
        self.assertEqual(sorted(p.name for p in (self.tmp / "a").iterdir()),
                         ["pageinator-press-test.pdf", "pageinator-press-test.pdfx-check.txt"])
        with pikepdf.open(self.tmp / "a" / "pageinator-press-test.pdf") as pdf:
            self.assertEqual(len(pdf.pages), 1)
            page = pdf.pages[0]
            self.assertEqual(sorted((int(im.Width), int(im.Height)) for im in page.images.values()),
                             [(1200, 800), (2525, 394)])                  # the photo and the ad, at their own pixels
            self.assertEqual([round(float(v) / 72 * 25.4) for v in page.MediaBox], [0, 0, 347, 540])


if __name__ == "__main__":
    unittest.main()
