"""Tests for the worker's health check (pgn_worker/health.py). Fictional profile bytes only."""
from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pgn_worker import health  # noqa: E402


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="worker-health-"))
        self.homes = self.tmp / "homes"
        self.homes.mkdir(mode=0o700)
        os.chmod(self.homes, 0o700)
        self.profile = self.tmp / "profile.icc"
        self.profile.write_bytes(b"a fictional colour profile")
        self.env = {"PGN_WORKER_HOMES": str(self.homes), "PAGEINATOR_ICC": str(self.profile),
                    "PGN_ICC_SHA256": hashlib.sha256(b"a fictional colour profile").hexdigest()}

    def tearDown(self):
        if self.homes.exists():
            os.chmod(self.homes, 0o700)                                    # writable again, so it can be removed
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_healthy_only_with_its_own_home_and_the_given_profile(self):
        before = dict(os.environ)
        self.assertEqual(health.problems(self.env), [])
        self.assertEqual(dict(os.environ), before)                                         # nothing changed
        for change, words in (({"PGN_ICC_SHA256": ""}, "PGN_ICC_SHA256 is not set"),         # required in the image
                              ({"PGN_ICC_SHA256": "0" * 64}, "not the one"),
                              ({"PAGEINATOR_ICC": str(self.tmp / "missing.icc")}, "cannot be read"),
                              ({"PGN_WORKER_HOMES": str(self.tmp / "no-homes")}, "missing or cannot be written")):
            with self.subTest(change=change):
                found = health.problems({**self.env, **change})
                self.assertEqual(len(found), 1, found)
                self.assertIn(words, found[0])
                self.assertNotIn(str(self.tmp), found[0])                                 # no setting's value
        found = health.problems({k: v for k, v in self.env.items() if k != "PGN_ICC_SHA256"})
        self.assertIn("PGN_ICC_SHA256 is not set", found[0])
        link = self.tmp / "homes-link"
        link.symlink_to(self.homes)
        self.assertIn("a link", health.problems({**self.env, "PGN_WORKER_HOMES": str(link)})[0])
        os.chmod(self.homes, 0o750)                                                        # not 0700
        self.assertIn("mode 0700", health.problems(self.env)[0])
        os.chmod(self.homes, 0o700)
        if os.geteuid() != 0:                                                              # root writes anywhere
            os.chmod(self.homes, 0o500)
            self.assertIn("mode 0700", health.problems(self.env)[0])


if __name__ == "__main__":
    unittest.main()
