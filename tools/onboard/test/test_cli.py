"""The onboard CLI as the worker calls it (fictional papers only).

Fast: a set that is too small is rejected (a finished job, exit 0); --min-editions lowers that gate; legacy-encoded
fonts without --script are refused (never a script vote on garbage); SIGTERM stops a build promptly; O6 rules.
SLOW (PGN_ONBOARD_SLOW=1, a few minutes, needs the oracle's Python): build + pack of the English paper end to end, the
outputs in the contract's shapes, and a deterministic ZIP; the legacy-encoded Marathi paper built by geometry with
--script deva --refined-layout (script confirmed, not voted; legacy text marked; the learned "layout" block).
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import unittest.mock
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ONB = HERE.parent
sys.path.insert(0, str(ONB))
sys.path.insert(0, str(ONB / "chain"))
sys.path.insert(0, str(ONB / "fixtures"))
import autocorrect as AC  # noqa: E402
import make_paper as MP  # noqa: E402

CLI = ONB / "onboard.py"
ENGINE_PY = os.environ.get("PGN_ENGINE_PYTHON") or str(ONB.parents[1] / "tools" / "oracle" / "v0" / ".venv" / "bin" / "python")
REPORT_KEYS = {"editions", "pages", "calibration_editions", "page_w_mm", "page_h_mm", "grid", "grids_seen", "script",
               "excluded_share", "roles"}


def cli(*args, **kw):
    return subprocess.run([sys.executable, "-B", str(CLI), *map(str, args)], capture_output=True, text=True, **kw)


class Cli(unittest.TestCase):
    def test_too_few_editions_is_a_rejection(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            files = [{"n": 1, "name": "a 2026-03-02.pdf", "path": str(MP.tiny_pdf(t / "a.pdf"))},
                     {"n": 2, "name": "b 2026-03-03.pdf", "path": str(MP.tiny_pdf(t / "b.pdf", when="2026-03-03"))},
                     {"n": 3, "name": "scan 2026-03-04.pdf", "path": str(MP.tiny_pdf(t / "c.pdf", "scanned"))}]
            (t / "files.json").write_text(json.dumps({"files": files}))
            r = cli("build", "--files", t / "files.json", "--out", t / "out", "--status", t / "status.json")
            self.assertEqual(r.returncode, 0, r.stderr)
            lines = r.stdout.strip().splitlines()
            self.assertEqual(len(lines), 1)
            res = json.loads(lines[0])
            self.assertEqual((res["outcome"], res["code"]), ("rejected", "onboard.too_few_editions"))
            self.assertEqual([f["status"] for f in res["files"]], ["ok", "ok", "refused"])
            self.assertEqual(json.loads((t / "status.json").read_text())["step"], "checking")

    def test_legacy_fonts_need_the_owner_s_script(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            files = [{"n": k, "name": f"sv 2026-03-0{k}.pdf", "path": str(MP.tiny_pdf(t / f"{k}.pdf", "legacy", key="mr", when=f"2026-03-0{k}"))}
                     for k in (2, 3, 4)]
            (t / "files.json").write_text(json.dumps({"files": files}))
            res = json.loads(cli("build", "--files", t / "files.json", "--out", t / "out").stdout)
            self.assertEqual((res["outcome"], res["code"]), ("rejected", "onboard.script_unconfirmed"))
            self.assertEqual([f["status"] for f in res["files"]], ["warning"] * 3)

    def test_min_editions_lowers_the_gate(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            (t / "files.json").write_text(json.dumps({"files": [{"n": 1, "name": "a 2026-03-02.pdf", "path": str(MP.tiny_pdf(t / "a.pdf"))}]}))
            base = ("build", "--files", t / "files.json", "--engine-python", sys.executable)
            self.assertEqual(json.loads(cli(*base, "--out", t / "o1").stdout)["code"], "onboard.too_few_editions")
            res = json.loads(cli(*base, "--out", t / "o2", "--min-editions", "1").stdout)
            self.assertEqual(res["code"], "onboard.no_grid")      # past the edition gate (one tiny page has no grid)

    def test_sigterm_stops_promptly(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            out = t / "papers"
            MP.make_paper("en", out)
            st = t / "status.json"
            p = subprocess.Popen([sys.executable, "-B", str(CLI), "build", "--files", str(out / "files.json"), "--out", str(t / "ds"),
                                  "--status", str(st), "--engine-python", sys.executable], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline and not (st.exists() and json.loads(st.read_text())["step"] == "reading"):
                time.sleep(0.2)
            p.send_signal(signal.SIGTERM)
            t0 = time.monotonic()
            rc = p.wait(timeout=20)
            self.assertNotEqual(rc, 0)
            self.assertLess(time.monotonic() - t0, 10)

    def test_o6_rules(self):
        f = {"width_mm": 10.0, "size_pt": 10.0, "lines": []}
        self.assertTrue(AC.frame_flags(f, [], 45.0, 315.0)[0].startswith("narrow"))
        self.assertTrue(AC.frame_flags(dict(f, width_mm=300.0), [], 45.0, 315.0)[0].startswith("wide"))
        self.assertEqual(AC.frame_flags(dict(f, width_mm=94.2), [], 45.0, 315.0), [])     # a 2-column measure is a column
        line = {"gaps_pt": [2.0, 12.0], "baseline_pt": 100.0, "x0_mm": 10.0, "x1_mm": 100.0, "tokens": []}
        self.assertTrue(AC.frame_flags(dict(f, width_mm=94.2, lines=[line]), [], 45.0, 315.0)[0].startswith("merged"))

    def test_a_long_step_keeps_rewriting_its_status(self):
        import onboard as OB
        with tempfile.TemporaryDirectory() as t, unittest.mock.patch.object(OB, "BEAT_S", 0.1):
            st = OB.Status(Path(t) / "status.json")
            st("learning", 3, 5)
            OB.run(Path(t), "learning", [sys.executable, "-c", "import time; time.sleep(0.5)"])
            doc = json.loads((Path(t) / "status.json").read_text())
            self.assertEqual((doc["step"], doc["done"], doc["total"]), ("learning", 3, 5))
            self.assertGreaterEqual(doc["beat"], 2)                # rewritten while the child ran: not a stall
            OB.STATUS.remove(st)


@unittest.skipUnless(os.environ.get("PGN_ONBOARD_SLOW") == "1" and Path(ENGINE_PY).exists(),
                     "SLOW: set PGN_ONBOARD_SLOW=1 (and PGN_ENGINE_PYTHON) for the end-to-end build")
class EndToEnd(unittest.TestCase):
    def test_build_and_pack_english(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            papers = t / "papers"
            MP.make_paper("en", papers)
            r = cli("build", "--files", papers / "files.json", "--out", t / "ds", "--status", t / "st.json",
                    "--masthead", papers / "masthead.png", "--engine-python", ENGINE_PY)
            self.assertEqual(r.returncode, 0, r.stderr)
            res = json.loads(r.stdout)
            self.assertEqual(res["outcome"], "ready", res)
            rep = res["report"]
            self.assertEqual(set(rep), REPORT_KEYS)
            self.assertEqual((rep["editions"], rep["pages"], rep["calibration_editions"], rep["script"]), (6, 32, 4, "latn"))
            self.assertEqual(rep["grid"]["columns"], 6)
            self.assertAlmostEqual(rep["grid"]["column_width_mm"], 45.0, delta=0.3)
            self.assertTrue(all(rep["roles"][k] > 0 for k in ("front", "inside_imprint", "inside", "back")))
            paper = json.loads((t / "ds" / "paper.json").read_text())
            self.assertEqual(paper["edition_sizes"], [4, 8])
            self.assertEqual(paper["split_date"], "2026-03-06")
            self.assertTrue(any(x.startswith("Printed and published by") for x in paper["imprint_text"]))
            z1 = json.loads(cli("pack", "--dataset", t / "ds", "--zip", t / "a.zip").stdout)
            z2 = json.loads(cli("pack", "--dataset", t / "ds", "--zip", t / "b.zip").stdout)
            self.assertEqual(z1, z2)
            names = zipfile.ZipFile(t / "a.zip").namelist()
            self.assertIn("house_profile.json", names)
            self.assertIn("report/headlines.jsonl", names)
            self.assertTrue(any(n.startswith("report/page1/brand/") for n in names))
            self.assertFalse(any(n.endswith("raw.json") or n.endswith("measure.json") for n in names))

    def test_build_legacy_marathi_by_geometry(self):
        import onboard as OB  # noqa: PLC0415
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            papers, ds = t / "papers", t / "ds"
            MP.make_paper("mr", papers, "legacy")
            r = cli("build", "--files", papers / "files.json", "--out", ds, "--engine-python", ENGINE_PY, "--script", "deva",
                    "--refined-layout")
            self.assertEqual(r.returncode, 0, r.stderr)
            res = json.loads(r.stdout)
            self.assertEqual(res["outcome"], "ready", res)
            self.assertEqual(res["report"]["script"], "deva")
            self.assertTrue(all({"code": "onboard.legacy_font", "count": None} in f["notes"] for f in res["files"]))
            docs = {p.parent.name: json.loads(p.read_text()) for p in (ds / "work").glob("*/corrected.json")}
            self.assertEqual(OB.body_script(docs), "latn")         # what a vote on the garbage text would have said
            paper = json.loads((ds / "paper.json").read_text())
            self.assertEqual((paper["script"], paper["legacy_text"], paper["refined_layout"]), ("deva", True, True))
            self.assertNotIn("provisional", paper)
            self.assertEqual(paper["imprint_text"], [])
            legacy = set(json.loads((ds / "legacy.json").read_text())["fonts"])
            texts = [e for p in (ds / "report/page1/pages").glob("*.json") for e in json.loads(p.read_text())["elements"] if e.get("font")]
            self.assertTrue(texts and all(e.get("legacy_text") is True for e in texts if e["font"] in legacy))
            prof = json.loads((ds / "house_profile.json").read_text())
            lay = prof["layout"]
            self.assertEqual(lay["schema"], "pageinator.layout/1")
            self.assertTrue({"headline", "body", "rules", "density", "margins_mm"} <= set(lay))
            self.assertTrue(all(k.startswith(("5col:", "6col:", "off_grid")) for k in prof["headline_size"]["by_span"]))


if __name__ == "__main__":
    unittest.main()
