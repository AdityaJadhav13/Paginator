"""O4 intake checks on generated one-page fictional PDFs (no committed binaries) and the split rule.

Run: experiments/phase0/pdfx1/.venv/bin/python -B -m unittest discover -s tools/onboard/test
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "fixtures"))
import intake as IN  # noqa: E402
import make_paper as MP  # noqa: E402
import onboard as OB  # noqa: E402


class Intake(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="onboard-intake-"))
        cls.files = {}
        for v in ("good", "scanned", "fonts_missing", "type3", "no_unicode", "big_page"):
            cls.files[v] = MP.tiny_pdf(cls.tmp / f"{v} 2026-03-02.pdf", v)
        cls.files["mr"] = MP.tiny_pdf(cls.tmp / "mr 2026-03-03.pdf", "good", key="mr")
        cls.files["mr_no_unicode"] = MP.tiny_pdf(cls.tmp / "mrnu 2026-03-03.pdf", "no_unicode", key="mr")
        (cls.tmp / "broken.pdf").write_bytes(b"%PDF-1.4\nnot really")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def codes(self, name, path=None):
        p = path or self.files[name]
        return IN.check_file(p, p.name)["codes"]

    def test_good_files_pass(self):
        self.assertEqual(self.codes("good"), [])
        self.assertEqual(self.codes("mr"), [])          # Devanagari with ActualText

    def test_each_problem_has_its_code(self):
        self.assertIn("onboard.scanned", self.codes("scanned"))
        self.assertIn("onboard.fonts_missing", self.codes("fonts_missing"))
        self.assertIn("onboard.fonts_missing", self.codes("type3"))
        self.assertIn("onboard.no_unicode", self.codes("mr_no_unicode"))
        self.assertIn("onboard.no_unicode", self.codes("no_unicode"))
        self.assertIn("onboard.not_pdf", self.codes(None, self.tmp / "broken.pdf"))

    def test_a_file_that_opens_but_cannot_be_read_is_refused_alone(self):
        from unittest import mock
        with mock.patch.object(IN, "_text_and_actualtext", side_effect=ValueError("a damaged content stream")):
            self.assertEqual(self.codes("good"), ["onboard.not_pdf"])

    def test_dates(self):
        self.assertEqual(IN.name_date("Edition 2026-01-05.pdf"), "2026-01-05")
        self.assertEqual(IN.name_date("SV_20260113.pdf"), "2026-01-13")
        self.assertIsNone(IN.name_date("final 20261341.pdf"))          # not a date
        self.assertEqual(IN.pdf_date("D:20260305013000+05'30'"), "2026-03-05")
        f = self.tmp / "no date here.pdf"
        shutil.copyfile(self.files["good"], f)
        self.assertEqual(IN.check_file(f, f.name)["date"], "2026-03-02")   # from the CreationDate

    def test_set_level(self):
        t = self.tmp
        shutil.copyfile(self.files["good"], t / "copy.pdf")
        other = MP.tiny_pdf(t / "other 2026-03-02.pdf", "good", when="2026-03-04")   # same name date, later export
        files = [{"n": 1, "name": "a 2026-03-02.pdf", "path": str(self.files["good"])},
                 {"n": 2, "name": "copy.pdf", "path": str(t / "copy.pdf")},                 # same bytes
                 {"n": 3, "name": "b 2026-03-02.pdf", "path": str(other)},                  # same date
                 {"n": 4, "name": "big 2026-03-09.pdf", "path": str(self.files["big_page"])},
                 {"n": 5, "name": "c 2026-03-10.pdf", "path": str(self.files["scanned"])}]
        rows = {r["n"]: r["check"] for r in IN.check_set(files)}
        self.assertEqual(rows[2]["status"], "refused")
        self.assertIn({"code": "onboard.duplicate", "count": None}, rows[2]["notes"])
        self.assertEqual(rows[1]["status"], "refused")       # n=3 has the later CreationDate (generated on 03-04): kept
        self.assertEqual(rows[3]["status"], "ok")
        self.assertIn({"code": "onboard.page_size_mix", "count": None}, rows[4]["notes"])
        self.assertEqual(rows[5]["status"], "refused")
        for c in rows.values():
            self.assertEqual(set(c), {"n", "status", "date", "pages", "notes"})

    def test_untested_program_is_a_warning(self):
        import pikepdf  # noqa: PLC0415
        p = self.tmp / "quark 2026-03-11.pdf"
        with pikepdf.open(self.files["good"]) as pdf:
            pdf.docinfo["/Creator"] = "QuarkXPress"
            pdf.docinfo["/Producer"] = "QuarkXPress PDF"
            pdf.save(p)
        rows = IN.check_set([{"n": 1, "name": p.name, "path": str(p)}])
        self.assertEqual(rows[0]["check"]["status"], "warning")

    def test_split_rule(self):
        d = [f"2026-01-{k:02d}" for k in range(1, 7)]
        self.assertEqual(OB.split_date(d), "2026-01-05")                  # 4 calibration, 2 test
        self.assertEqual(OB.split_date(d[:3]), "2026-01-03")              # 2 + 1
        self.assertEqual(OB.split_date([f"2026-02-{k:02d}" for k in range(1, 16)]), "2026-02-11")   # 10 + 5


class Generator(unittest.TestCase):
    def test_deterministic(self):
        with tempfile.TemporaryDirectory() as t:
            a, b = MP.tiny_pdf(Path(t) / "a.pdf", "good", key="mr"), MP.tiny_pdf(Path(t) / "b.pdf", "good", key="mr")
            self.assertEqual(a.read_bytes(), b.read_bytes())


if __name__ == "__main__":
    unittest.main()
