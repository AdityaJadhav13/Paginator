"""Screen equals print, level L1 (pgn_worker/screenprint.py): a FICTIONAL page (one headline, a few body lines, a rule;
the repository's OFL stand-in fonts) drawn by the engine's own display-list code (deskedit.PageSession.draw) and
written by its own PDF writer (deskgen.pdf_bytes), then the PDF's glyphs read back and compared with the display list.
The page is built in the engine's environment (the frozen oracle's: PGN_ENGINE_PYTHON, else tools/oracle/v0/.venv),
in a child process (this file with --build); the comparison runs here (pikepdf). It writes
test/fixtures/screen-print-page.json for the web's L2 draw-log test.
    PGN_ENGINE_PYTHON=tools/oracle/v0/.venv/bin/python \
      experiments/phase0/pdfx1/.venv/bin/python -B -m unittest apps/engine-worker/test/test_screenprint.py
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
REPO = WORKER.parents[1]
FIXTURE = WORKER / "test" / "fixtures" / "screen-print-page.json"
ENGINE_PY = Path(os.environ.get("PGN_ENGINE_PYTHON") or REPO / "tools" / "oracle" / "v0" / ".venv" / "bin" / "python")


def build(out: Path) -> None:
    """(In the engine's environment.) The fictional page: draw.json (PageSession.draw's result) and page.pdf."""
    import types
    sys.path.insert(0, str(REPO / "tools" / "desk" / "engine"))
    import deskedit as DEd
    import deskfonts
    import deskgen as DG
    X = DG.X
    reg = deskfonts.F.FontRegistry()
    reg.register_dir(REPO / "tools" / "oracle" / "v0" / "assets" / "fonts" / "latin")
    faces = {"H": (reg.resolve("Archivo", 700, "normal"), "Archivo-Bold"),
             "B": (reg.resolve("Source Serif 4", 400, "normal"), "SourceSerif4-Regular")}
    fonts = {k: X.EmbeddedFont(k, f._instance_bytes, name) for k, (f, name) in faces.items()}
    W, H = 120.0, 80.0

    def line(key: str, text: str, size: float, x_mm: float, base_mm: float, hscale: float = 1.0) -> X.TextRun:
        face, ef = faces[key][0], fonts[key]
        hmtx, order, x = ef.tt["hmtx"].metrics, ef.order, x_mm * DG.MM
        clusters = []
        for ch in text:
            gid = face.glyph_id(ord(ch))
            clusters.append((ch, [X.Glyph(gid, round(x, 3), round((H - base_mm) * DG.MM, 3))]))
            x += hmtx[order[gid]][0] / ef.upem * size * hscale
        return X.TextRun(key, size, (0, 0, 0, 1), clusters, hscale=hscale)

    items = [line("H", "Fictional council opens a library", 16.0, 8.0, 16.0, hscale=0.94),
             X.Rect(8 * DG.MM, (H - 19.5) * DG.MM, 104 * DG.MM, 0.3 * DG.MM, (0, 0, 0, 1)),
             line("B", "The new reading room, invented for this test,", 9.0, 8.0, 26.0),
             line("B", "opens on a fictional Monday with forty chairs", 9.0, 8.0, 30.2),
             line("B", "and a quiet corner for stand-in fonts.", 9.0, 8.0, 34.4)]
    B = types.SimpleNamespace(items=items, fonts=fonts)
    s = DEd.PageSession.__new__(DEd.PageSession)
    s.render = lambda: (B, {}, 0, [], [], [], {})
    s.state = lambda text=(): {"notes": []}
    s.tpl = types.SimpleNamespace(page_w=W, page_h=H)
    cache = out / "cache"
    s.engine = types.SimpleNamespace(cache_dir=lambda name: (cache / name).mkdir(parents=True, exist_ok=True) or cache / name)
    s._fulls = {}
    drawn = s.draw()
    (out / "draw.json").write_text(json.dumps(drawn), encoding="utf-8")
    (out / "page.pdf").write_bytes(DG.pdf_bytes(s.tpl, B, B.items, "Fictional screen-print page"))


@unittest.skipUnless(ENGINE_PY.is_file(), "the engine's environment (tools/oracle/v0/.venv) is not set up")
class ScreenPrintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(WORKER))
        from pgn_worker import screenprint
        cls.sp = screenprint
        cls.tmp = tempfile.TemporaryDirectory(prefix="screen-print-")
        out = Path(cls.tmp.name)
        subprocess.run([str(ENGINE_PY), "-B", __file__, "--build", str(out)], cwd=REPO, check=True,
                       env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        cls.draw = json.loads((out / "draw.json").read_text(encoding="utf-8"))
        cls.pdf = out / "page.pdf"
        cls.glyphs = screenprint.pdf_glyphs(cls.pdf)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_pdf_shows_exactly_the_glyphs_the_screen_draws(self):
        diff = self.sp.compare(self.draw, self.glyphs)
        self.assertTrue(diff["equal"], diff)
        self.assertEqual(diff["screen_glyphs"], sum(len(it["g"]) for it in self.draw["items"] if it["t"] == "text"))
        self.assertGreater(diff["screen_glyphs"], 100)
        self.assertLessEqual(max(diff["max_dx_mm"], diff["max_dy_mm"]), self.sp.TOL_MM)
        with contextlib.redirect_stdout(io.StringIO()) as said:
            self.assertEqual(self.sp.main([str(Path(self.tmp.name) / "draw.json"), str(self.pdf)]), 0)
        self.assertTrue(json.loads(said.getvalue())["equal"])
        faced = self.sp.faced(self.draw, self.glyphs)
        self.assertEqual({f for f, *_ in faced}, {v["face"] for v in self.draw["fonts"].values()})
        FIXTURE.parent.mkdir(exist_ok=True)
        FIXTURE.write_text(json.dumps({"items": [it for it in self.draw["items"] if it["t"] == "text"],
                                       "fonts": self.draw["fonts"], "pdf_glyphs": faced}, separators=(",", ":"))
                           + "\n", encoding="utf-8")

    def test_a_difference_is_found(self):
        for change, what in ((lambda g: g.__setitem__(0, g[0] + 1), "glyph"),
                             (lambda g: g.__setitem__(1, g[1] + 0.01), "position"),
                             (lambda g: g.__setitem__(2, g[2] - 0.002), "position")):
            draw = copy.deepcopy(self.draw)
            change(draw["items"][2]["g"][3])
            diff = self.sp.compare(draw, self.glyphs)
            self.assertEqual((diff["equal"], diff["differences"][0]["what"]), (False, what))
        draw = copy.deepcopy(self.draw)
        draw["items"][0]["g"].pop()
        self.assertEqual(self.sp.compare(draw, self.glyphs)["differences"][0]["what"], "count")
        draw = copy.deepcopy(self.draw)
        draw["items"][0]["hs"] = 1.0
        self.assertEqual(self.sp.compare(draw, self.glyphs)["differences"][0]["what"], "size")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--build"]:
        build(Path(sys.argv[2]))
    else:
        unittest.main()
