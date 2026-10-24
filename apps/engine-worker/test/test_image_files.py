"""Tests for the worker image's file check (infra/docker/check_image_files.py), on file lists and a tar made here, and
the repository's own files from git's index. They run in the repository only (the check is not in the image)."""
from __future__ import annotations

import importlib.util
import io
import sys
import tarfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "infra/docker/check_image_files.py"
if SCRIPT.is_file():
    spec = importlib.util.spec_from_file_location("check_image_files", SCRIPT)
    check = importlib.util.module_from_spec(spec)
    sys.modules["check_image_files"] = check                    # its dataclass looks its module up there
    spec.loader.exec_module(check)  # type: ignore[union-attr]

ICC_HEAD = b"\x00\x00\x02\x30ADBE\x02\x10\x00\x00prtrCMYKLab " + b"\x07\xd0" + b"\x00" * 10 + b"acsp" + b"\x00" * 24


@unittest.skipUnless(SCRIPT.is_file(), "the image's file check is not in the image")
class ImageFilesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = check.tracked()
        cls.good = [check.Entry("usr/bin/python3", "file", b"\x7fELF"), check.Entry("opt/pageinator", "dir"),
                    check.Entry("opt/pageinator/venv/bin/python", "link"),
                    check.Entry("opt/pageinator/venv/lib/python3.11/site-packages/x.py", "file", b"import os")]
        cls.good += [check.Entry(check.ROOT + rel, "file", (REPO / rel).read_bytes()[:64], sha)
                     for rel, sha in cls.repo.items()]

    def test_the_image_as_built_passes(self):
        self.assertEqual(len([p for p in self.repo if check.FONT.search(p)]), 22)
        self.assertIn("apps/engine-worker/requirements.lock", self.repo)
        self.assertEqual(check.problems(self.good, self.repo), [])

    def test_anything_else_is_refused(self):
        lock = check.ROOT + "apps/engine-worker/requirements.lock"
        for name, extra, words in (
                ("a renamed profile", check.Entry("usr/share/house.bin", "file", ICC_HEAD), "colour profile (by its content)"),
                ("a renamed font", check.Entry("opt/house.bin", "file", b"OTTO" + b"\0" * 60), "a font (by its content)"),
                ("a WOFF2 font", check.Entry("srv/x.dat", "file", b"wOF2" + b"\0" * 60), "a font (by its content)"),
                ("a TrueType font", check.Entry("srv/y", "file", b"\x00\x01\x00\x00" + b"\0" * 60), "by its content"),
                ("a profile by name", check.Entry("run/pageinator/newsprint.icc", "file", b""), "colour profile built"),
                ("a font by name", check.Entry("usr/share/fonts/DejaVuSans.ttf", "file", b""), "not one of the"),
                ("an untracked file", check.Entry(check.ROOT + "tools/desk/deskserver/extra.py", "file", b"x", "0" * 64),
                 "not a file of the repository"),
                ("a test file", check.Entry(check.ROOT + "apps/engine-worker/test/test_media.py", "file", b"x", "0"),
                 "not a file of the repository"),
                ("a lock beside the lock", check.Entry(lock + ".bak", "file", b"x", "0" * 64),
                 "not a file of the repository"),
                ("a .env", check.Entry(check.ROOT + ".env", "file", b"PGN_S3=x", "0" * 64), "private"),
                ("a git folder", check.Entry(".git/config", "file", b"[core]"), "private"),
                ("a link among the files", check.Entry(check.ROOT + "tools/desk/engine/x", "link"), "link"),
                ("a dataset", check.Entry("var/lib/pageinator/homes/o/p/datasets/a/page.json", "file", b"{}"), "private")):
            with self.subTest(name):
                found = check.problems([*self.good, extra], self.repo)
                self.assertTrue(any(words in p for p in found), found)
        changed = [check.Entry(e.name, e.kind, e.head, "0" * 64) if e.name == lock else e for e in self.good]
        self.assertTrue(any("not the repository's bytes" in p for p in check.problems(changed, self.repo)))
        missing = [e for e in self.good if not e.name.endswith("Mukta-Bold.ttf")]
        self.assertTrue(any("is missing" in p for p in check.problems(missing, self.repo)))

    def test_names_are_read_as_docker_writes_them(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tar:
            for name, data in (("./opt/pageinator/.env", b"PGN_S3_SECRET_ACCESS_KEY=fictional"),
                               ("./.git/config", b"[core]"), ("./usr/share/house.bin", ICC_HEAD)):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        buf.seek(0)
        with tarfile.open(fileobj=buf, mode="r|*") as tar:
            found = check.entries(tar)
        self.assertEqual([e.name for e in found], ["opt/pageinator/.env", ".git/config", "usr/share/house.bin"])
        issues = "\n".join(check.problems(found, self.repo))
        for words in ("/opt/pageinator/.env", "/.git/config", "/usr/share/house.bin"):
            self.assertIn(words, issues)


if __name__ == "__main__":
    unittest.main()
