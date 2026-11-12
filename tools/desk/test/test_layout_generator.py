"""The Desk's page generator (tools/desk/engine/layout/generate.py) under house settings. Fictional text only. Run from
the repository root:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python -m unittest tools/desk/test/test_layout_generator.py -v

At the defaults the copy must behave exactly as the frozen experiments/phase0/gen1/generate.py (checked against the
frozen module itself, in a subprocess: the two cannot share a process). The weekly settings switch on B2-B6.
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LAYOUT = ROOT / "tools" / "desk" / "engine" / "layout"
FROZEN = ROOT / "experiments" / "phase0" / "gen1"

# shared by this process and the frozen one: a fictional story, a fake composer context, a photo directory
FIXTURE = r'''
import gzip, hashlib, json, tempfile, types
from dataclasses import replace
from pathlib import Path
CP = G.CP
cx = types.SimpleNamespace(head_pol=replace(CP.H.HeadPolicy(), name="test", shape="fill"), xh_above=1.0, xh_below=1.0,
                           indent_mm=5.0, r_cal=0.9, size_mode="paper", body_choice="C3_floor0.66_stretch1.00",
                           en_vocab=set(), masthead=None, frames=lambda *a: {}, display={})
PARA = ("गावात नवीन वाचनालय सुरू झाले असून तेथे मुलांसाठी गोष्टींची पुस्तके आणि वर्तमानपत्रे ठेवली आहेत. "
        "सकाळी आणि संध्याकाळी वाचनालय उघडे राहील, असे ग्रामपंचायतीने सांगितले.")
HEAD = "गावात नवीन वाचनालय सुरू, मुलांसाठी गोष्टींची पुस्तके"
PHOTO_DIR = Path(tempfile.mkdtemp())


def el(i, kind, text, size, **kw):
    return {"id": i, "kind": kind, "text": text, "size_pt": size, "font": "", "bbox_mm": [0, 0, 0, 0], "lines": [], **kw}


def photo(name, w, h):
    idx = PHOTO_DIR / "index.json"
    d = json.loads(idx.read_text()) if idx.exists() else {"elements": {}}
    d["elements"][name] = {"width_px": w, "height_px": h, "ppi": 300}
    idx.write_text(json.dumps(d))
    (PHOTO_DIR / f"{name}.cmyk.gz").write_bytes(gzip.compress(bytes([10, 20, 30, 40]) * (w * h)))


def story(paras=4, image=None, treatment=None, kicker=True, byline=True, head=HEAD, caption=False, credit=False):
    els = [el("h1", "headline", head, 30.0)]
    st = {"id": "s1", "synthetic": True, "headline": "h1", "headline_parts": [], "kicker": None, "decks": [], "byline": None,
          "captions": [], "images": [image] if image else [], "jump_lines": [], "other_elements": [], "parent_story": None,
          "columns": [], "flow": [{"type": "para", "text": PARA, "indent_mm": 5.0, "lines": [{"line_ref": "gen:0", "col": 0, "text": PARA}]}
                                  for _ in range(paras)]}
    if kicker:
        els.append(el("k1", "kicker", "ग्रामविकास", 18.0)); st["kicker"] = "k1"
    if byline:
        els.append(el("b1", "byline", "आमचा प्रतिनिधी", 12.0)); st["byline"] = "b1"
    if treatment:
        st["treatment"] = treatment
    if caption:
        els.append(el("c1", "caption", "नवे वाचनालय (छाया: प्रतिनिधी)", 10.0)); st["captions"] = ["c1"]
    if credit:
        els.append(el("cr1", "caption", "A. Writer / Example Commons / CC BY-SA 4.0", 6.0)); st["credit"] = "cr1"
    return G.Generator(cx, {"page": 0, "elements": els, "stories": [st]}, PHOTO_DIR, {(10.0, 13.0): 10, (9.5, 12.5): 5}, {"s1"}, 0.25)


def head_summary(fh):
    lines, lead, asc, desc, size = fh
    return {"lead": lead, "asc": asc, "desc": desc, "size": size,
            "lines": [[sorted(ax.items()), gap, off, hs, len(p.words)] for p, ax, gap, off, hs in lines]}


def summary():
    photo("p1", 1500, 1000)
    out = {}
    for img in (None, "p1"):
        g = story(image=img)
        s = g.stories[0]
        out[str(img)] = {"head": head_summary(g.fill_headline(s.head, G.span_mm(3), 40.0, cx.head_pol, True)),
                         "minor": head_summary(g.fill_headline(s.head, G.span_mm(2), 24.0, cx.head_pol, False)),
                         "options": {w: g._options(s, w) for w in (2, 3)}}
        # the page: both options of 3 columns side by side, rendered and written as gen1 writes a page
        o2, o3 = (min(out[str(img)]["options"][w], key=lambda o: o["static"]) for w in (2, 3))
        g2 = story(image=img)
        model = {"page": 0, "page_w_mm": 347.0, "page_h_mm": 540.0, "elements": [], "stories": [], "unassigned": [], "sample": ""}
        placed = [(0, G.ORIGIN, 60.0, 3, o3["lo"] * G.UNIT, o3), (0, G.ORIGIN + 3 * G.PITCH, 60.0, 2, o2["lo"] * G.UNIT, o2),
                  (0, G.ORIGIN, 60.0 + o3["lo"] * G.UNIT, 3, o3["lo"] * G.UNIT, o3)]
        B, rep, _ = G.render(g2, model, placed, 60.0, 500.0, PHOTO_DIR, [], [], ({}, {}))
        out[str(img)]["pdf_sha256"] = hashlib.sha256(G.pdf_bytes(model, B, B.items)).hexdigest()
        out[str(img)]["overset"] = [r["overset_lines"] for r in rep["stories"]]
    return json.loads(json.dumps(out))
'''

FROZEN_RUN = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
import generate as G
exec(sys.stdin.read())
print(json.dumps(summary()))
'''

sys.path.insert(0, str(LAYOUT))
import generate as G  # noqa: E402
import settings  # noqa: E402

exec(FIXTURE)  # noqa: S102 — this file's own fixture text

WEEKLY = {"head_weight": 700, "head_max_lines": 2, "head_max_lines_1col": 2, "head_leading_em": 1.0, "head_tz_min": 0.51,
          "head_tz_max": 1.17, "head_align": "centre", "byline_mode": "none", "kicker_mode": "lead", "caption_mode": "small",
          "rule_mode": "tiers", "white_max": 3, "photo_positions": ("head", "inset", "centre"), "photo_shapes": ("rect", "ellipse"),
          "wrap_gap_mm": 2.75, "body_size_pt": 9.6, "body_leadings_pt": (12.0, 12.5, 13.0), "body_fits": (1.0,),
          "panels": {"strap": {"cmyk": (0, 0, 1, 0), "height_mm": 7.0}, "tint": {"cmyk": (0, 0, 0, 0.1), "pad_mm": 2.0},
                     "reverse": {"cmyk": (0, 0, 0, 1), "text_cmyk": (0, 0, 0, 0), "pad_mm": 1.5},
                     "box": {"stroke_pt": 0.5, "stroke_cmyk": (0, 0, 0, 1), "pad_mm": 2.0}}}
MODEL = {"page": 0, "page_w_mm": 347.0, "page_h_mm": 540.0, "elements": [], "stories": [], "unassigned": [], "sample": ""}
TOP = 50.0


def render_one(g, w, o, x=None):
    """The story's option o rendered alone at the newshole top, at column 0 (or x). → its report entry."""
    x = G.ORIGIN if x is None else x
    g.regions = [(0, G.NCOL, TOP, TOP + o["lo"] * G.UNIT)]
    _, rep, _ = G.render(g, MODEL, [(0, x, TOP, w, o["lo"] * G.UNIT, o)], TOP, 500.0, PHOTO_DIR, [], [], ({}, {}))
    return rep["stories"][0]


class Settings(unittest.TestCase):
    over: dict = {}

    def setUp(self):
        settings.use(self.over)
        self.addCleanup(settings.use, None)


class FrozenPathTest(Settings):
    def test_defaults_match_the_frozen_gen1(self):
        """Headline fill (lead and minor), every module option at 2 and 3 columns, and a rendered page of three modules
        (stacked and side by side, so rules too), with and without a photo: the copy and the frozen
        experiments/phase0/gen1/generate.py give the same numbers to the last bit and the same PDF bytes."""
        r = subprocess.run([sys.executable, "-c", FROZEN_RUN, str(FROZEN)], input=FIXTURE, capture_output=True, text=True,
                           cwd=ROOT, env={"PYTHONDONTWRITEBYTECODE": "1", "PATH": "/usr/bin:/bin"})
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertEqual(summary(), json.loads(r.stdout))

    def test_no_refinement_is_reached_at_the_defaults(self):
        self.assertFalse(G.refined(*G.HEAD_KEYS, "body_family", "body_wdth"))
        g = story(image="p1", treatment="box")                # a treatment without house panels is ignored
        s = g.stories[0]
        self.assertEqual(g.treatment(s), (None, {}, None))
        self.assertNotIn("treat", g.display(s, 3))
        self.assertEqual(g.photo_pos(s, 2, 60.0), "head")


class WeeklyHeadlineTest(Settings):
    over = WEEKLY

    def check(self, fh, measure):
        lines, lead, _, _, size = fh
        self.assertLessEqual(len(lines), 2)
        for p, ax, gap, off, hs in lines:
            w = sum(p.clusters[c].width for cl in p.words for c in cl) + sum(x or 0.0 for x in p.spaces[:len(p.words) - 1])
            self.assertEqual(ax["wght"], 700.0)
            self.assertTrue(G.HEAD_WDTH_MIN <= ax["wdth"] <= 87.5)
            self.assertTrue(0.51 <= hs <= 1.17, hs)
            self.assertEqual(gap, 0.0)                          # filled by scale, not by word gaps
            self.assertAlmostEqual(off, max(0.0, measure - w * hs) / 2, places=9)    # centred
            self.assertLessEqual(w * hs, measure + 1e-6)
        self.assertGreaterEqual(lead, size / G.MM - 1e-9)       # solid (1.0 em) or more where ink would touch

    def test_one_and_three_columns(self):
        g = story()
        long = HEAD + " आणि वर्तमानपत्रे, सकाळी व संध्याकाळी उघडे"
        for w, size, text in ((1, 26.0, "वाचनालय सुरू"), (1, 26.0, HEAD), (3, 40.0, HEAD), (3, 40.0, long)):
            with self.subTest(w=w, text=len(text)):
                self.check(g.fill_headline(text, G.span_mm(w), size, cx.head_pol, False), G.span_mm(w))
        self.assertIsNone(g.fill_headline(long, G.span_mm(1), 26.0, cx.head_pol, False))   # never a third line: no layout

    def test_lead_ratio_cap(self):
        settings.use({**WEEKLY, "lead_ratio_max": 4.0})
        g = story()
        fh = g.fill_headline("वाचनालय सुरू", G.span_mm(6), 60.0, cx.head_pol, True)
        self.assertLessEqual(fh[4], 4.0 * 9.6 + 1e-9)

    def test_drawn_at_the_house_weight(self):
        g = story()
        B = CP.Builder(540.0)
        fh = g.fill_headline(HEAD, G.span_mm(3), 40.0, cx.head_pol, False)
        G.draw_block(B, ("headline", "h", fh[0], [10.0] * len(fh[0]), None, "fill"), 10.0, 10.0, G.span_mm(3), {"page": 0})
        self.assertEqual({ln["font"] for ln in B.lines}, {B.font(CP.SANS, ax, 700) for _, ax, _, _, _ in fh[0]})


class StoryPartsTest(Settings):
    over = WEEKLY

    def test_no_byline_no_kicker_without_a_strap(self):
        g = story()
        dsp = g.display(g.stories[0], 3)
        self.assertEqual([b[0] for b in dsp["blocks"]], ["headline"])
        self.assertEqual(dsp["tail"], [])

    def test_end_signature(self):
        settings.use({**WEEKLY, "byline_mode": "end"})
        g = story()
        dsp = g.display(g.stories[0], 3)
        self.assertEqual([(b[0], b[1], b[5]) for b in dsp["tail"]], [("byline", "b1", "right")])
        self.assertGreater(dsp["tail_h"], 0.0)

    def test_one_body_size_by_leading(self):
        g = story()
        self.assertEqual(g.styles, [(9.6, 12.0), (9.6, 12.5), (9.6, 13.0)])
        self.assertEqual({o["fit"] for o in g._options(g.stories[0], 3)}, {1.0})


class TiersTest(Settings):
    over = WEEKLY

    def test_rules_only_between_tiers(self):
        """Two 4-column modules side by side, a stack of two in the left one's place below, an 8-column module under
        all: a rule over the whole width where the 8-column tier starts, none inside the left stack."""
        L = G.ORIGIN
        R = G.ORIGIN + 4 * G.PITCH
        placed = [(0, L, TOP, 4, 100.0, None), (1, R, TOP, 4, 160.0, None),
                  (2, L, TOP + 100.0, 4, 60.0, None), (3, L, TOP + 160.0, 8, 80.0, None)]
        g = types.SimpleNamespace(regions=[(0, G.NCOL, TOP, TOP + 240.0)])
        self.assertEqual(G.tier_rules(g, placed), [(G.ORIGIN, TOP + 160.0, G.ORIGIN + G.span_mm(G.NCOL))])


class TreatmentTest(Settings):
    over = WEEKLY

    def test_strap(self):
        g = story(treatment="strap")
        dsp = g.display(g.stories[0], 4)
        tr = dsp["treat"]
        t0, t1 = tr["panel"]
        self.assertAlmostEqual(t1 - t0, 7.0)
        kick = dsp["blocks"][0]
        self.assertEqual((kick[0], kick[5]), ("kicker", "center"))
        r = kick[2]
        ink = CP.line_ink(r.p, *r.lines[0])
        self.assertGreaterEqual(kick[3][0] - ink[0], t0 + 0.5 - 1e-6)     # the kicker's ink inside the band
        self.assertLessEqual(kick[3][0] + ink[1], t1 - 0.5 + 1e-6)
        self.assertGreater(dsp["blocks"][1][3][0], t1)                   # the headline below it

    def test_tint_and_reverse(self):
        for name, colour in (("tint", CP.BLACK), ("reverse", (0, 0, 0, 0))):
            with self.subTest(name):
                g = story(treatment=name, kicker=False)
                dsp = g.display(g.stories[0], 3)
                tr, head = dsp["treat"], dsp["blocks"][0]
                asc = CP.line_ink(head[2][0][0], 0, len(head[2][0][0].words))[0]
                desc = CP.line_ink(head[2][-1][0], 0, len(head[2][-1][0].words))[1]
                self.assertEqual(tr["text_cmyk"], colour)
                self.assertAlmostEqual(tr["panel"][0], head[3][0] - asc - tr["ppad"])
                self.assertAlmostEqual(tr["panel"][1], head[3][-1] + desc + tr["ppad"])

    def test_reverse_that_fails_contrast_is_black_on_no_panel(self):
        settings.use({**WEEKLY, "panels": {"reverse": {"cmyk": (0, 0, 0, 0.1), "text_cmyk": (0, 0, 0, 0)}}})
        g = story(treatment="reverse")
        self.assertEqual(g.treatment(g.stories[0]), (None, {}, None))
        self.assertNotIn("treat", g.display(g.stories[0], 3))

    def test_box_insets_the_columns_and_fits(self):
        settings.use({**WEEKLY, "photo_positions": ("head",)})
        plain, boxed = story(kicker=False), story(treatment="box", kicker=False)
        o0 = min(plain._options(plain.stories[0], 3), key=lambda o: (o["m"], o["static"]))
        o1 = min(boxed._options(boxed.stories[0], 3), key=lambda o: (o["m"], o["static"]))
        self.assertAlmostEqual(o1["cw"], o0["cw"] - 4.0 / o1["m"])
        res = render_one(boxed, 3, o1)
        self.assertEqual(res["overset_lines"], 0)
        self.assertTrue(all(c[0] >= G.ORIGIN + 2.0 - 0.01 and c[2] <= G.ORIGIN + G.span_mm(3) - 2.0 + 0.01 for c in res["columns"]))   # (reported to 0.01)


class PhotoTest(Settings):
    over = WEEKLY

    def test_inset_and_centre_wrap_and_fit_exactly(self):
        photo("p1", 1500, 1000)                 # landscape
        photo("p2", 1000, 1300)                 # portrait
        for img, w, pos in (("p1", 4, "centre"), ("p2", 4, "inset"), ("p2", 3, "inset")):
            with self.subTest(img=img, w=w):
                g = story(paras=16, image=img, kicker=False)
                s = g.stories[0]
                opts = [o for o in g._options(s, w) if o["photo"] and o["photo"].get("pos")]
                self.assertTrue(all(o["photo"]["pos"] == g.photo_pos(s, o["m"], o["cw"]) for o in opts))   # the house rule
                opts = [o for o in opts if o["photo"]["pos"] == pos]
                self.assertTrue(opts)
                o = min(opts, key=lambda o: o["static"])
                for c in range(G.NCOL - w + 1):             # exact wherever the module stands
                    res = render_one(g, w, o, G.ORIGIN + c * G.PITCH)
                    self.assertEqual((res["overset_lines"], res["obstacles"]), (0, 1))
                box = res["photo_box"]
                x = G.ORIGIN + (G.NCOL - w) * G.PITCH
                self.assertTrue(x <= box[0] < box[2] <= x + G.span_mm(w) + 1e-6)
                self.assertTrue(TOP + o["y_b0"] < box[1] < box[3] < TOP + o["lo"] * G.UNIT)

    def test_inset_caption_inside_the_wrap(self):
        photo("p2", 1000, 1300)
        g = story(paras=16, image="p2", kicker=False, caption=True)
        o = min((o for o in g._options(g.stories[0], 4) if o["photo"] and o["photo"].get("pos")), key=lambda o: o["static"])
        self.assertTrue(o["photo"]["cap"] and o["photo"]["ob_h"] > o["photo"]["ph_h"])
        self.assertEqual(o["photo"]["shape"], "rect")                     # a captioned photo is never an ellipse
        g.regions = [(0, G.NCOL, TOP, TOP + o["lo"] * G.UNIT)]
        B, rep, _ = G.render(g, MODEL, [(0, G.ORIGIN, TOP, 4, o["lo"] * G.UNIT, o)], TOP, 500.0, PHOTO_DIR, [], [], ({}, {}))
        self.assertEqual(rep["stories"][0]["overset_lines"], 0)
        box = rep["stories"][0]["photo_box"]
        cap = [ln for ln in B.lines if ln.get("role") == "caption"]
        self.assertTrue(cap and all(box[3] < ln["baseline_mm"] < TOP + o["photo"]["ph_top"] + o["photo"]["ob_h"] for ln in cap))
        self.assertEqual({ln["size_pt"] for ln in cap}, {8.0})            # small: 80 % of 10 pt

    def test_ellipse_inset(self):
        photo("p3", 1100, 1200)                 # near round, upright: an inset (a landscape photo would be centred)
        g = story(paras=16, image="p3", kicker=False)
        o = min((o for o in g._options(g.stories[0], 4) if o["photo"] and o["photo"].get("pos")), key=lambda o: o["static"])
        self.assertEqual((o["photo"]["pos"], o["photo"]["shape"]), ("inset", "ellipse"))
        g.regions = [(0, G.NCOL, TOP, TOP + o["lo"] * G.UNIT)]
        B, rep, _ = G.render(g, MODEL, [(0, G.ORIGIN, TOP, 4, o["lo"] * G.UNIT, o)], TOP, 500.0, PHOTO_DIR, [], [], ({}, {}))
        self.assertEqual(rep["stories"][0]["overset_lines"], 0)
        img = next(i for i in B.items if isinstance(i, CP.X.Image))
        self.assertEqual(img.cmyk_bytes[:4], bytes(4))                     # a corner pixel whitened (outside the ellipse)
        self.assertEqual(img.cmyk_bytes[len(img.cmyk_bytes) // 2:len(img.cmyk_bytes) // 2 + 4], bytes([10, 20, 30, 40]))

    def test_head_stays_without_room(self):
        photo("p1", 1500, 1000)
        g = story(image="p1")
        self.assertEqual(g.photo_pos(g.stories[0], 1, 60.0), "head")        # one column
        self.assertEqual(g.photo_pos(g.stories[0], 2, 24.0), "head")        # the strip beside it too narrow for a line
        self.assertEqual(g.photo_pos(g.stories[0], 3, 47.5), "inset")       # two thirds of a weekly column stay beside it
        self.assertEqual(g.photo_pos(g.stories[0], 4, 47.5), "centre")

class WrapMinTest(Settings):
    over = {**WEEKLY, "wrap_min_mm": 30.0}

    def strips(self, o, res):
        """Every piece of a column line the photo's geometry leaves beside it (CP.line_intervals at each line band of
        the photo's depth) that the photo narrows: [(column measure, piece width)]."""
        ph, box = o["photo"], res["photo_box"]
        sh = CP.wrap_shape({"box": (box[0], box[1], box[2], box[1] + ph["ob_h"]), "shape": ph["shape"], "gap_mm": settings.ST["wrap_gap_mm"]})
        out = []
        for c in res["columns"]:
            for y in range(int(box[1]) - 3, int(box[1] + ph["ob_h"]) + 4):
                for a, b in CP.line_intervals(c[0], c[2], y - 2.0, y + 1.0, [sh]):   # (the composer's own floor: no wrap_min)
                    if b - a < c[2] - c[0] - 0.05:
                        out.append((c[2] - c[0], b - a))
        return out

    def test_no_strip_narrower_than_wrap_min(self):
        photo("p1", 1500, 1000)
        photo("p2", 1000, 1300)
        seen = set()
        for img, w in (("p1", 4), ("p2", 4), ("p2", 3)):
            g = story(paras=16, image=img, kicker=False)
            s = g.stories[0]
            opts = [o for o in g._options(s, w) if o["photo"] and o["photo"].get("pos")]
            self.assertTrue(all(o["photo"]["pos"] == g.photo_pos(s, o["m"], o["cw"]) for o in opts))
            for pos in {o["photo"]["pos"] for o in opts}:
                with self.subTest(img=img, w=w, pos=pos):
                    o = min((o for o in opts if o["photo"]["pos"] == pos), key=lambda o: o["static"])
                    res = render_one(g, w, o)
                    self.assertEqual(res["overset_lines"], 0)
                    self.assertTrue(all(piece >= 30.0 for _, piece in self.strips(o, res)), self.strips(o, res))
                    seen.add(pos)
                    if pos == "inset":                      # (a real strip, so the check above is not empty)
                        self.assertTrue(self.strips(o, res))
                    if pos == "cols":                       # whole columns: no strip at all, the photo on the column edges
                        box, cols = res["photo_box"], res["columns"]
                        self.assertEqual(self.strips(o, res), [])
                        self.assertTrue(any(abs(box[0] - c[0]) < 0.02 for c in cols) and any(abs(box[2] - c[2]) < 0.02 for c in cols))
                        self.assertEqual(o["photo"]["ph_w"], o["photo"]["k"] * o["cw"] + (o["photo"]["k"] - 1) * G.GUT)
                        self.assertLess(o["photo"]["ph_top"], o["y_b0"])   # at the head of its columns: no line above it
                        self.assertLessEqual(o["photo"]["ph_h"], o["photo"]["ph_w"] + 1e-6)   # a portrait cropped towards square
        self.assertIn("cols", seen)

    def test_rule_by_strip_width(self):
        photo("p1", 1500, 1000)
        photo("p2", 1000, 1300)
        g = story(image="p1")
        s = g.stories[0]
        self.assertEqual(g.photo_pos(s, 4, 47.5), "cols")       # half a column (20.8 mm) and two thirds (28.7) < 30 mm
        settings.use({**WEEKLY, "wrap_min_mm": 20.0})
        self.assertEqual(g.photo_pos(s, 4, 47.5), "centre")     # the centre across the gutter re-checked: 20.8 ≥ 20
        settings.use({**WEEKLY, "wrap_min_mm": 30.0})
        self.assertEqual(g.photo_pos(s, 3, 50.0), "inset")      # a wide column: two thirds of it (30.4 mm) stay beside
        settings.use({**WEEKLY, "wrap_min_mm": 30.0, "photo_positions": ("head",)})
        self.assertEqual(g.photo_pos(s, 4, 47.5), "head")       # no inside positions in the house: the head photo


class PhotoColsTest(Settings):
    over = {**WEEKLY, "photo_positions": ("head",), "photo_cols": {"2": 0.7, "3": 0.3}}

    def grid(self, o):
        return round(G.Generator.grid_cols(o["photo"]["ph_w"]))

    def test_a_portrait_head_photo_is_never_taller_than_square(self):
        photo("p2", 1000, 1300)                 # portrait: a crop (≤ CROP) can make it square
        g = story(paras=12, image="p2")
        opts = [o for w in (3, 4) for o in g._options(g.stories[0], w) if o["photo"]]
        self.assertTrue(opts)
        self.assertTrue(all(o["photo"]["ph_h"] <= o["photo"]["ph_w"] + 1e-6 for o in opts))

    def test_a_tall_portrait_keeps_its_head_photo_options(self):
        photo("p3", 1000, 1600)                 # 9:16 cropped by CROP reaches 0.94, never square: allowed as tall as that
        g = story(paras=12, image="p3")
        opts = [o for w in (3, 4) for o in g._options(g.stories[0], w) if o["photo"]]
        self.assertTrue(opts)
        self.assertTrue(all(o["photo"]["ph_w"] / o["photo"]["ph_h"] >= 1000 / 1600 - 1e-6 for o in opts))   # never taller than itself

    def test_only_widths_the_paper_prints(self):
        photo("p1", 1500, 1000)
        g = story(paras=8, image="p1")
        for w in (3, 4):
            opts = [o for o in g._options(g.stories[0], w) if o["photo"]]
            self.assertTrue(opts)
            self.assertEqual({self.grid(o) for o in opts} - {2, 3}, set(), w)
        settings.use({**WEEKLY, "photo_cols": {5: 1.0}})
        self.assertEqual(g.photo_ks(3, 36.5), [3])                # none printed this narrow: the nearest (the widest)
        settings.use({**WEEKLY, "photo_cols": {1: 1.0}})
        self.assertEqual(g.photo_ks(3, 50.0), [1])

    def test_the_lead_takes_the_widest_common_width(self):
        photo("p1", 1500, 1000)
        settings.use({**self.over, "photo_cols": {1: 0.4, 2: 0.4, 3: 0.3}})
        g = story(paras=8, image="p1")
        best = min((o for o in g._options(g.stories[0], 5) if o["photo"]), key=lambda o: o["static"])
        self.assertEqual(self.grid(best), 3)                       # (at 4 columns a 3-column photo would leave one lone column)
        opts = [o for w in (3, 4) for o in g._options(g.stories[0], w) if o["photo"]]
        self.assertTrue(all(o["photo"]["k"] == o["m"] or o["m"] - o["photo"]["k"] >= 2 for o in opts if o["photo"].get("k")))
        self.assertEqual(g.width_cost(g.stories[0], best["photo"]["ph_w"]), 0.0)
        g.stories[0].rank = 3                                      # not the lead: the commonest widths cost nothing
        self.assertEqual(g.width_cost(g.stories[0], 2 * G.COL_W + G.GUT), 0.0)
        self.assertGreater(g.width_cost(g.stories[0], 3 * G.COL_W + 2 * G.GUT), 0.0)
        settings.use({**self.over, "photo_cols": {1: 0.8, 2: 0.2}})     # the weekly: leads 2 columns, the rest 1
        for rank, want in ((0, 2), (3, 1)):
            g = story(paras=8, image="p1")
            g.stories[0].rank = rank
            best = min((o for o in g._options(g.stories[0], 4) if o["photo"]), key=lambda o: o["static"])
            self.assertEqual(self.grid(best), want, rank)


class CreditLineTest(Settings):
    over = {**WEEKLY, "credit_mode": "line"}

    def page(self, caption, pos):
        photo("p2", 1000, 1300)
        g = story(paras=16, image="p2", kicker=False, caption=caption, credit=True)
        o = min((o for o in g._options(g.stories[0], 4) if o["photo"] and bool(o["photo"].get("pos")) == pos), key=lambda o: o["static"])
        g.regions = [(0, G.NCOL, TOP, TOP + o["lo"] * G.UNIT)]
        B, rep, _ = G.render(g, MODEL, [(0, G.ORIGIN, TOP, 4, o["lo"] * G.UNIT, o)], TOP, 500.0, PHOTO_DIR, [], [], ({}, {}))
        return B, rep["stories"][0]

    def test_credit_alone_without_a_caption(self):
        for pos in (False, True):                                 # a head photo and an inset
            with self.subTest(inset=pos):
                B, res = self.page(False, pos)
                box = res["photo_box"]
                cr = [ln for ln in B.lines if ln.get("role") == "credit"]
                self.assertEqual(res["overset_lines"], 0)
                self.assertEqual([ln for ln in B.lines if ln.get("role") == "caption"], [])
                self.assertEqual(" ".join(ln["text"] for ln in cr), "A. Writer / Example Commons / CC BY-SA 4.0")
                self.assertEqual({ln["size_pt"] for ln in cr}, {G.CREDIT_PT})
                self.assertTrue(all(abs(ln["x1_mm"] - box[2]) < 0.01 and ln["baseline_mm"] > box[3] for ln in cr))   # right, under

    def test_caption_under_the_credit(self):
        B, res = self.page(True, True)
        cr = [ln for ln in B.lines if ln.get("role") == "credit"]
        cap = [ln for ln in B.lines if ln.get("role") == "caption"]
        self.assertEqual(res["overset_lines"], 0)
        self.assertTrue(cr and cap and min(c["baseline_mm"] for c in cap) > max(c["baseline_mm"] for c in cr))




class DailyRulesTest(Settings):
    """Round 4 (the daily broadsheet): one scale per headline, balanced columns, gap limits, the sudoku filler."""
    over = {**WEEKLY, "refined": True, "photo_positions": ("head",)}

    def test_every_line_of_a_headline_has_one_size_width_and_scale(self):
        g = story(paras=6)
        fh = g.fill_refined(HEAD + " आणि वर्तमानपत्रे", G.span_mm(2), 28.0, g.cx.head_pol, False)
        self.assertGreater(len(fh[0]), 1)
        self.assertEqual(len({ax["wdth"] for _, ax, _, _, _ in fh[0]}), 1)
        self.assertEqual(len({hs for _, _, _, _, hs in fh[0]}), 1)

    def test_columns_are_balanced_and_white_stays_within_the_limit(self):
        g = story(paras=7, kicker=False, byline=False)
        for o in g._options(g.stories[0], 3):
            if o["photo"] is None and o["rows"]:
                lead = o["style"][1] / G.MM
                self.assertLessEqual((o["hi"] - o["lo"]) * G.UNIT, G.GAP_LINES * lead + G.UNIT)
        for o in [o for w in (2, 3) for o in g._options(g.stories[0], w) if o["m"] >= 2][:6]:
            res = render_one(g, o["w"], o)                  # the short lines spread one to a column: still no overset
            self.assertEqual(res["overset_lines"], 0)

    def test_a_short_story_is_never_a_shallow_strip(self):
        def shallow(g):
            return [(w, o["m"], o["rows"]) for w in range(2, 9) for o in g._options(g.stories[0], w)
                    if o["photo"] is None and o["m"] > 1 and 0 < o["rows"] < G.min_col_lines(o["m"])]
        self.assertEqual([G.min_col_lines(m) for m in (2, 3, 4, 8)], [5, 5, 6, 10])   # the wider, the deeper
        g = story(paras=1, kicker=False, byline=False)
        self.assertEqual(shallow(g), [])                                   # a brief stacks in one or a few columns …
        self.assertEqual(shallow(story(paras=3, kicker=False, byline=False)), [])
        self.assertTrue(any(o["rows"] >= G.MIN_COL_LINES for o in g._options(g.stories[0], 1)))
        photo("p1", 1500, 1000)
        g = story(paras=2, image="p1", kicker=False, byline=False)        # under a photo across every column: deep or none
        under = [(o["rows"] - o["photo"]["j"], o["m"]) for w in range(2, 6) for o in g._options(g.stories[0], w)
                 if o["photo"] and o["photo"].get("k") == o["m"] > 1]
        self.assertTrue(all(n == 0 or n >= G.min_col_lines(m) for n, m in under), under)
        settings.use(None)                                                 # … the pilot keeps its wide strips
        self.assertNotEqual(shallow(story(paras=1, kicker=False, byline=False)), [])

    def test_the_sudoku_filler(self):
        import sudoku as SU
        sd = SU.make("2026-11-11", "easy")
        g = story(paras=0, kicker=False, byline=False, head="सुडोकू")
        g.stories[0].src["sudoku"] = {"puzzle": sd["puzzle"], "solution": sd["solution"], "help": "प्रत्येक ओळीत १ ते ९ अंक एकदाच."}
        self.assertEqual(g._options(g.stories[0], 1), [])                  # never narrower than two grid columns
        o = g._options(g.stories[0], 3)[0]
        res = render_one(g, 3, o)
        self.assertEqual(res["overset_lines"], 0)

if __name__ == "__main__":
    unittest.main()
