"""The Desk's composer refinements (tools/desk/engine/layout/compose_page.py, settings.ST), fictional text only. Run
from the repository root:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python -m unittest tools/desk/test/test_layout_composer.py -v

Each set_story run happens in a subprocess (the frozen experiments/phase0/page1/compose_page.py and the Desk's copy
share module names and the shaping caches), and reports its lines, its report and the sha256 of a PDF of its items.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESK = ROOT / "tools" / "desk" / "engine" / "layout"
FROZEN = ROOT / "experiments" / "phase0" / "page1"
sys.path.insert(0, str(DESK))

TEXT = ("आज सकाळी गावातील शाळेत नवीन वाचनालयाचे उद्घाटन झाले. विद्यार्थ्यांनी नवी पुस्तके पाहून आनंद व्यक्त केला. "
        "शिक्षकांनी सांगितले की दर आठवड्याला नवी पुस्तके येतील आणि मुलांना घरी नेता येतील. गावकऱ्यांनी या उपक्रमाचे स्वागत केले. ")
DATELINE = "पुणे, ता. ५ :"

RUN = r"""
import json, os, sys, hashlib
from types import SimpleNamespace
a = json.loads(sys.argv[1])
sys.path.insert(0, a["dir"])
import compose_page as CP
if a.get("settings") is not None:
    import settings
    settings.use(a["settings"])
summ = CP.R3.OUT / "summary.json"
chosen = json.loads(summ.read_text())["selection"]["chosen"] if summ.exists() else None
cx = SimpleNamespace(size_mode="story", r_cal=None, body_choice=chosen or "C3_floor0.66_stretch1.00", xh_above=1.0,
                     xh_below=1.0, indent_mm=5.0, en_vocab=set())
B = CP.Builder(300.0)
obst = [tuple(o) if isinstance(o, list) else o for o in a["obstacles"]]
out = CP.set_story(B, cx, a["story"], lambda l: 0.0, {}, obst, {"page": 1}, {"colour": {}}, fit=a["fit"])
intent, fl = CP.MP.OUTPUT_INTENTS["IFRA26"], CP.MP.PDFX["X-1a:2003"]
data, _ = CP.X.build_pdf([CP.X.Page(200 * CP.MM, 300 * CP.MM, B.items)], B.fonts, title="t", output_intent=intent,
                         actualtext=True, pdf_version=fl["pdf_version"], pdfx_info=fl["info"], creator="t")
fonts = {k: [CP.MP.FONTS[k][0], CP.MP.FONTS[k][1], CP.MP.FONTS[k][2]] for k in B.fonts}
print(json.dumps({"out": out, "lines": B.lines, "sha": hashlib.sha256(data).hexdigest(), "fonts": fonts}, ensure_ascii=False))
"""


def python() -> str:
    for p in (ROOT / "tools/oracle/v0/.venv/bin/python", Path.home() / "Desktop/Paginator/tools/oracle/v0/.venv/bin/python"):
        if p.exists():
            return str(p)
    return sys.executable


def story(paras: list, width: float = 50.0, size: float = 10.0, leading: float = 13.0) -> dict:
    flow = [{"type": "para", "text": t, "indent_mm": 5.0 if k else 0.0, "lines": [{"col": 0, "line_ref": "gen:0", "text": t}],
             **({"run_in_bold": rb} if rb else {})} for k, (t, rb) in enumerate(paras)]
    col = {"frame_ids": [], "x0_mm": 10.0, "x1_mm": 10.0 + width, "top_mm": 5.0, "bottom_mm": 290.0, "first_baseline_mm": 10.0,
           "n_lines": 200, "leading_mm": leading / 2.834645669}
    return {"id": "t1", "columns": [col], "flow": flow, "body_size_pt": size, "body_leading_pt": leading, "body_hscale": 1.0, "space_em": 0.25}


def run(where: Path, st: dict | None, obstacles=(), fit: float = 1.0, s: dict | None = None) -> dict:
    arg = {"dir": str(where), "settings": st, "story": s or story([(TEXT * 2, 0), (TEXT, 0)]), "obstacles": list(obstacles), "fit": fit}
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    r = subprocess.run([python(), "-c", RUN, json.dumps(arg, ensure_ascii=False)], capture_output=True, text=True, env=env, cwd=str(ROOT))
    if r.returncode:
        raise AssertionError(r.stderr[-3000:])
    return json.loads(r.stdout.strip().splitlines()[-1])


def body(res) -> list:
    return [l for l in res["lines"] if l.get("role") == "body"]


class FrozenPath(unittest.TestCase):
    """At the default settings the Desk's composer is the frozen one: same lines, same report, same PDF bytes."""

    def test_defaults_match_the_frozen_composer(self):
        for obst in ((), ([35.0, 40.0, 70.0, 70.0],)):                       # plain, and the frozen rectangle wrap
            with self.subTest(obstacles=obst):
                a, b = run(FROZEN, None, obst), run(DESK, {}, obst)
                self.assertEqual(a["sha"], b["sha"])
                self.assertEqual(a["lines"], b["lines"])
                self.assertEqual(a["out"], b["out"])

    def test_defaults_match_with_copyfit(self):
        a, b = run(FROZEN, None, fit=0.97), run(DESK, {}, fit=0.97)
        self.assertEqual((a["sha"], a["out"]), (b["sha"], b["out"]))


class Refinements(unittest.TestCase):
    def test_sans_body(self):
        r = run(DESK, {"body_family": "sans", "body_wdth": 90.0})
        keys = {l["font"] for l in body(r)}
        self.assertEqual(keys, {"N400_wdth90"})
        self.assertEqual(r["fonts"]["N400_wdth90"][:2], ["Noto Sans Devanagari", {"wdth": 90.0}])
        self.assertEqual(r["out"]["overset_lines"], 0)

    def test_one_fixed_size_and_width_copyfit(self):
        st = {"body_family": "sans", "body_wdth": 90.0, "body_size_pt": 9.6}
        r = run(DESK, st)
        self.assertEqual({l["size_pt"] for l in body(r)}, {9.6})
        self.assertNotIn("size_capped_from", r["out"])
        tight = run(DESK, st, s=story([(TEXT, 0)], leading=11.0))           # below 1.2 em: reported, size kept
        self.assertEqual(tight["out"]["lead_below_ink_min"], round(9.6 * 1.2, 3))
        self.assertEqual({l["size_pt"] for l in body(tight)}, {9.6})
        narrow = run(DESK, st, fit=0.96)                                     # copyfit: width axis, never the size
        self.assertEqual({l["size_pt"] for l in body(narrow)}, {9.6})
        self.assertLess(narrow["out"]["wdth"], 90.0)
        self.assertGreaterEqual(narrow["out"]["wdth"], 80.0)
        self.assertLessEqual(narrow["out"]["our_lines"], r["out"]["our_lines"])

    def test_bold_dateline_runs_in_on_the_first_line(self):
        st = {"body_family": "sans", "body_wdth": 90.0, "body_size_pt": 9.6, "dateline_bold": True}
        s = story([(DATELINE + " " + TEXT, len(DATELINE)), (TEXT, 0)])
        r = run(DESK, st, s=s)
        dl = [l for l in r["lines"] if l.get("role") == "dateline"]
        self.assertEqual(len(dl), 1)
        self.assertEqual(dl[0]["text"].replace(" ", ""), DATELINE.replace(" ", ""))
        self.assertEqual(dl[0]["font"], "N700_wdth90")
        first = body(r)[0]
        self.assertEqual(first["baseline_mm"], dl[0]["baseline_mm"])          # same line, body after it
        self.assertEqual(first["x0_mm"], 10.0)
        self.assertAlmostEqual(first["x1_mm"], 60.0, delta=0.06)              # justified together to the measure
        off = run(DESK, {**st, "dateline_bold": False}, s=s)                  # off: no bold run
        self.assertFalse([l for l in off["lines"] if l.get("role") == "dateline"])

    def test_ellipse_wrap_two_intervals_beside_none_inside(self):
        st = {"body_family": "sans", "body_wdth": 90.0, "body_size_pt": 9.6}
        ell = {"box": [45.0, 30.0, 75.0, 60.0], "shape": "ellipse", "gap_mm": 2.5, "sides": "both"}
        r = run(DESK, st, obstacles=[ell], s=story([(TEXT * 4, 0)], width=100.0, leading=12.0))
        by_base: dict = {}
        for l in body(r):
            by_base.setdefault(l["baseline_mm"], []).append(l)
        import compose_page as CP  # noqa: PLC0415
        sh, em = CP.wrap_shape(ell), 9.6 / CP.MM
        split = [v for v in by_base.values() if len(v) == 2]
        self.assertGreater(len(split), 5)
        for left, right in split:                                             # left interval, then right: reading order
            lft, rgt = CP.wrap_extent(sh, left["baseline_mm"] - CP.ASC * em, left["baseline_mm"] + CP.DESC * em)
            self.assertEqual((left["x0_mm"], right["x0_mm"] >= rgt - 0.001), (10.0, True))
            self.assertLessEqual(left["x1_mm"], lft + 0.06)
            self.assertLessEqual(right["x1_mm"], 110.06)
        for v in by_base.values():                                            # a whole line never crosses the ellipse
            if len(v) == 1 and CP.wrap_extent(sh, v[0]["baseline_mm"] - CP.ASC * em, v[0]["baseline_mm"] + CP.DESC * em):
                self.assertEqual(v[0]["kind"], "final")
        self.assertEqual(r["out"]["overset_lines"], 0)
        texts = "".join(l["text"] for l in body(r)).replace(" ", "")
        self.assertEqual(texts, (TEXT * 4).replace(" ", ""))                 # flow order kept, nothing lost

    def test_line_intervals(self):
        import compose_page as CP  # noqa: PLC0415
        ell = CP.wrap_shape({"box": (40.0, 20.0, 60.0, 40.0), "shape": "ellipse", "gap_mm": 2.0})
        ivs = CP.line_intervals(10.0, 90.0, 28.0, 32.0, [ell])               # band across the centre
        self.assertEqual(ivs, [(10.0, 38.0), (62.0, 90.0)])
        self.assertEqual(CP.line_intervals(30.0, 70.0, 28.0, 32.0, [ell]), [])   # no room either side: blocked
        self.assertEqual(CP.line_intervals(10.0, 90.0, 50.0, 54.0, [ell]), [(10.0, 90.0)])   # below it: whole line
        auto = dict(ell, sides="auto")
        self.assertEqual(CP.line_intervals(10.0, 95.0, 28.0, 32.0, [auto]), [(62.0, 95.0)])
        near = CP.line_intervals(10.0, 90.0, 19.0, 20.5, [ell])               # near the top: a narrow chord
        self.assertEqual(len(near), 2)
        self.assertGreater(near[0][1], 38.0)

    def test_ellipse_raster(self):
        import compose_page as CP  # noqa: PLC0415
        w, h = 40, 30
        raw = bytes([10, 20, 30, 40]) * (w * h)
        out = CP.ellipse_raster(raw, w, h)
        px = lambda i, j: out[(j * w + i) * 4:(j * w + i) * 4 + 4]  # noqa: E731
        for i, j in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            self.assertEqual(px(i, j), bytes(4))
        self.assertEqual(px(w // 2, h // 2), bytes([10, 20, 30, 40]))
        self.assertEqual(px(0, h // 2), bytes([10, 20, 30, 40]))           # the ellipse touches the sides
        for j in range(h):                                                   # exact integer rule, every pixel
            for i in range(w):
                inside = (2 * i + 1 - w) ** 2 * h * h + (2 * j + 1 - h) ** 2 * w * w <= w * w * h * h
                self.assertEqual(px(i, j) != bytes(4), inside)
        with self.assertRaises(ValueError):
            CP.ellipse_raster(raw[:-1], w, h)

    def test_cutout_refused(self):
        import compose_page as CP  # noqa: PLC0415
        with self.assertRaisesRegex(ValueError, "not available until the photo desk makes alpha masks"):
            CP.wrap_shape({"box": (0, 0, 10, 10), "shape": "cutout"})
        with self.assertRaises(ValueError):
            CP.wrap_shape({"box": (0, 0, 10, 10), "shape": "star"})


if __name__ == "__main__":
    unittest.main()
