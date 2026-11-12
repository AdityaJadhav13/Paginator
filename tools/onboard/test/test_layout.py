"""The learned layout block's photo, caption, density and head-band keys (house_profile.py), on fictional pages.

Synthetic page models (headlines, body runs, photos, glyphs as house_profile builds them, mm from the trim top-left)
and small generated PDFs with a shaded band (pikepdf): photo widths in columns of the page's own grid, photos per
news page, photo and lead-story shares of the news area, the lead story's photo, captions and credit lines, and the
running head's shading stops (CMYK, gray, DeviceN of process inks; a stitching function; reversed axes; a band in a
form XObject; a band too narrow or too low to be a head band).
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import pikepdf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "chain"))
import house_profile as H  # noqa: E402

PT = H.MM          # pt per mm
W, HT = 270.0, 340.0


def head(x0, x1, y, size, lines=1):
    return {"kind": "headline", "size": size, "span": (x0, x1), "x0": x0, "x1": x1, "y_top": y,
            "y_bot": y + (lines - 1) * size / PT, "lines": [{"y": y, "x0": x0, "x1": x1}]}


def run(x0, x1, y0, y1):
    return {"x0": x0, "x1": x1, "y_top": y0, "y_bot": y1, "fragment": False}


def photo(x0, x1, y0, y1):
    return {"x0": x0, "x1": x1, "y_top": y0, "y_bot": y1, "shape": "rect"}


def page(disp=(), runs=(), glyphs=(), strokes=(), bottom=330.0, ads=()):
    return {"disp": list(disp), "runs": list(runs), "glyphs": list(glyphs), "strokes": list(strokes), "content_bottom": bottom,
            "topblock": {"y1": 20.0}, "ads": list(ads), "body_size": 12.0}


def glyph_row(x0, x1, y, size=7.0):
    return [{"x0": x0 + k, "x1": x0 + k + 1, "y": y, "size": size} for k in range(int(x1 - x0))]


COLW, GUT = 47.6, 4.23
TX = (7.5, 262.5)


class PhotoWidths(unittest.TestCase):
    def test_columns_of_the_page_grid(self):
        self.assertEqual(H.photo_cols(47.6, COLW, GUT), 1)
        self.assertEqual(H.photo_cols(99.4, COLW, GUT), 2)
        self.assertEqual(H.photo_cols(30.0, COLW, GUT), 1)            # never 0
        self.assertEqual(H.photo_cols(118.0, COLW, GUT), 2)           # 2.36 columns across a gutter: rounded
        self.assertEqual(H.photo_cols(130.0, COLW, GUT), 3)           # 2.59 columns
        self.assertEqual(H.photo_cols(125.4, 60.5, 4.22), 2)          # on a 4-column alternate grid


class NewsPages(unittest.TestCase):
    def setUp(self):
        # page A: a 3-column lead (36 pt) with a 2-column photo, a rule, then a 2-column story with a 1-column photo
        self.lead_ph = photo(7.5, 107.0, 40.0, 100.0)
        self.small_ph = photo(7.5, 55.1, 200.0, 240.0)
        self.A = page(disp=[head(7.5, 158.7, 30.0, 36), head(7.5, 107.0, 180.0, 20)],
                      runs=[run(7.5, 55.1, 105.0, 160.0), run(59.3, 107.0, 105.0, 165.0), run(111.1, 158.7, 35.0, 150.0),
                            run(7.5, 55.1, 245.0, 300.0)],
                      strokes=[{"x0": 7.5, "x1": 262.5, "y0": 172.0, "y1": 172.0}])
        # page B: one story, no photo; page C: a full-page ad, no headline (not a news page)
        self.B = page(disp=[head(7.5, 262.5, 30.0, 48)], runs=[run(7.5, 262.5, 40.0, 120.0)])
        self.C = page(ads=[{"x0": 7.5, "x1": 262.5, "y_top": 20.0, "y_bot": 330.0}])
        self.ph_of = {id(self.A): [self.lead_ph, self.small_ph], id(self.B): [], id(self.C): [photo(7.5, 262.5, 20, 300)]}

    def test_lead_story_box_and_photo(self):
        box, ph = H.lead_story(self.A, self.ph_of[id(self.A)])
        self.assertIs(ph, self.lead_ph)
        self.assertEqual((box[0], box[2], box[3]), (7.5, 158.7, 165.0))   # stops at the rule, not the second story
        self.assertAlmostEqual(box[1], 30.0 - 0.75 * 36 / PT)
        self.assertIsNone(H.lead_story(self.C, []))

    def test_news_area(self):
        self.assertAlmostEqual(H.news_area(self.B, *TX), 255.0 * 310.0)
        self.assertEqual(H.news_area(self.C, *TX), 0.0)

    def test_keys_over_news_pages_only(self):
        out = H.news_keys([self.A, self.B, self.C], self.ph_of, lambda P: (COLW, GUT), TX)
        ph = out["photos"]
        self.assertEqual(ph["width_cols"], {"1": 1, "2": 1})      # page C's photo is not counted
        self.assertEqual(ph["per_page"], [0, 1.0, 2])
        na = 255.0 * 310.0
        a_share = (99.5 * 60 + 47.6 * 40) / na
        self.assertAlmostEqual(ph["area_share"], round((a_share + 0.0) / 2, 4))
        self.assertEqual(ph["lead_width_cols"], 2)
        lead_a = (151.2 * (165.0 - 30.0 + 0.75 * 36 / PT)) / na
        lead_b = (255.0 * (120.0 - 30.0 + 0.75 * 48 / PT)) / na
        self.assertAlmostEqual(out["lead_area_share"], round((lead_a + lead_b) / 2, 4))
        self.assertEqual(out["captions"], {"caption_share": 0.0, "credit_share": 0.0})

    def test_no_news_page_no_keys(self):
        self.assertEqual(H.news_keys([self.C], self.ph_of, lambda P: (COLW, GUT), TX), {})


class Captions(unittest.TestCase):
    def test_caption_under_and_credit_flush_right(self):
        im = photo(7.5, 107.0, 40.0, 100.0)
        cap = {"kind": "caption", "x0": 7.5, "x1": 100.0, "y_top": 104.0, "y_bot": 107.0,
               "lines": [{"y": 104.0, "x0": 7.5, "x1": 100.0}, {"y": 107.0, "x0": 7.5, "x1": 60.0}]}
        P = page(disp=[cap], glyphs=glyph_row(80.0, 106.0, 98.5))                   # a credit inside the photo's foot
        self.assertEqual(H.caption_credit(P, im), (True, True))
        self.assertEqual(H.caption_credit(page(disp=[cap]), im), (True, False))
        self.assertEqual(H.caption_credit(page(glyphs=glyph_row(80.0, 106.0, 102.0)), im), (False, True))
        self.assertEqual(H.caption_credit(page(glyphs=glyph_row(7.5, 40.0, 102.0, size=12.0)), im), (False, False))  # body type
        beside = {"kind": "caption", "x0": 110.0, "x1": 150.0, "y_top": 60.0, "y_bot": 70.0, "lines": [{"y": 60.0, "x0": 110.0, "x1": 150.0}]}
        self.assertEqual(H.caption_credit(page(disp=[beside]), im), (True, False))
        far = dict(beside, y_top=150.0, y_bot=160.0, lines=[{"y": 150.0, "x0": 7.5, "x1": 100.0}])
        self.assertEqual(H.caption_credit(page(disp=[far]), im), (False, False))


def band_pdf(path: Path, cs, fn, coords=(0, 0, 1, 0), box=(7.5, 7.5, 262.5, 20.0), cm=None, in_form=False) -> Path:
    """One 270 x 340 mm page whose band box (mm from the top-left) is clipped and filled with an axial shading."""
    pdf = pikepdf.new()
    x0, y0, x1, y1 = box
    sh = pdf.make_indirect(pikepdf.Dictionary(ShadingType=2, ColorSpace=cs, Coords=list(coords), Function=fn,
                                              Extend=[True, True]))
    m = cm or ((x1 - x0) * PT, 0, 0, (y1 - y0) * PT, x0 * PT, (HT - y1) * PT)
    body = (f"q {x0 * PT:.3f} {(HT - y1) * PT:.3f} {(x1 - x0) * PT:.3f} {(y1 - y0) * PT:.3f} re W n "
            f"{' '.join(f'{v:.4f}' for v in m)} cm /Sh0 sh Q").encode()
    res = pikepdf.Dictionary(Shading=pikepdf.Dictionary(Sh0=sh))
    if in_form:
        form = pdf.make_stream(body, Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Form, BBox=[0, 0, W * PT, HT * PT], Resources=res)
        res, body = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Fm0=form)), b"q /Fm0 Do Q"
    pdf.pages.append(pikepdf.Page(pikepdf.Dictionary(Type=pikepdf.Name.Page, MediaBox=[0, 0, W * PT, HT * PT], Resources=res,
                                                     Contents=pdf.make_stream(body))))
    pdf.save(path)
    return path


def exp(c0, c1, n=1):
    return pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=list(c0), C1=list(c1), N=n)


class HeadBand(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="onboard-band-"))

    def band(self, name, *a, **kw):
        P = {"pdf": band_pdf(self.tmp / f"{name}.pdf", *a, **kw), "page": 1, "trim_mm": [0, 0, W, HT], "W": W, "H": HT}
        return H.head_band(P)

    def test_cmyk_stitched_and_reversed_encode(self):
        # as InDesign writes a two-stop gradient: a Type 3 function whose Encode runs 1 → 0
        fn = pikepdf.Dictionary(FunctionType=3, Domain=[0, 1], Bounds=[], Encode=[1, 0], Functions=[exp((0, .38, 1, 0), (.03, 0, .78, 0))])
        b = self.band("cmyk", pikepdf.Name.DeviceCMYK, fn)
        self.assertEqual(b["stops"], [[0.03, 0.0, 0.78, 0.0], [0.0, 0.38, 1.0, 0.0]])    # yellow → orange, left to right
        self.assertEqual(b["axis"], "x")
        self.assertEqual([round(v, 2) for v in b["box"]], [7.5, 7.5, 262.5, 20.0])

    def test_three_stops_and_a_right_to_left_axis(self):
        fn = pikepdf.Dictionary(FunctionType=3, Domain=[0, 1], Bounds=[0.5], Encode=[0, 1, 0, 1],
                                Functions=[exp((0, 0, 1, 0), (0, .5, 1, 0)), exp((0, .5, 1, 0), (0, 1, 1, 0))])
        b = self.band("three", pikepdf.Name.DeviceCMYK, fn, coords=(1, 0, 0, 0))
        self.assertEqual(b["stops"], [[0.0, 1.0, 1.0, 0.0], [0.0, 0.5, 1.0, 0.0], [0.0, 0.0, 1.0, 0.0]])

    def test_gray_is_k(self):
        b = self.band("gray", pikepdf.Name.DeviceGray, exp((1,), (0.25,)), coords=(0, 0, 0, 1))
        self.assertEqual(b["axis"], "y")
        self.assertEqual(b["stops"], [[0.0, 0.0, 0.0, 0.75], [0.0, 0.0, 0.0, 0.0]])       # top (y up in PDF) first

    def test_devicen_process_inks_in_a_form(self):
        cs = pikepdf.Array([pikepdf.Name.DeviceN, [pikepdf.Name.Cyan, pikepdf.Name.Yellow], pikepdf.Name.DeviceCMYK,
                            pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[1, 1, 1, 1], N=1)])
        b = self.band("devn", cs, exp((0, 1), (0.5, 0.2)), in_form=True)
        self.assertEqual(b["stops"], [[0.0, 0.0, 1.0, 0.0], [0.5, 0.0, 0.2, 0.0]])

    def test_not_a_head_band(self):
        fn = exp((0, 0, 1, 0), (0, 1, 1, 0))
        self.assertIsNone(self.band("narrow", pikepdf.Name.DeviceCMYK, fn, box=(7.5, 7.5, 200.0, 20.0)))
        self.assertIsNone(self.band("low", pikepdf.Name.DeviceCMYK, fn, box=(7.5, 100.0, 262.5, 112.0)))
        self.assertIsNone(self.band("rgb", pikepdf.Name.DeviceRGB, exp((1, 1, 0), (1, .5, 0))))   # not CMYK: left out


if __name__ == "__main__":
    unittest.main()
