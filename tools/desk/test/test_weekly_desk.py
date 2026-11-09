"""The Desk's side of a refined (weekly) paper: the learned layout block mapped to the house settings, a legacy-font
paper's template and running head, per-page templates and story treatments. Fictional data only. Run from the root:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python -m unittest tools/desk/test/test_weekly_desk.py -v
"""
from __future__ import annotations

import sys
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))

import desk_engine as DE  # noqa: E402
import deskarticles as DA  # noqa: E402
import deskgen as DG  # noqa: E402
import deskplan as DP  # noqa: E402
import deskprofile as DPR  # noqa: E402
import deskworker as DW  # noqa: E402
import settings as LS  # noqa: E402  (layout/settings.py, on the path through deskgen)

PAPER = {"format": "pageinator.paper/1", "script": "deva", "refined_layout": True, "legacy_text": True}
GARBAGE = "a{ddma, {X. 8 Zmo"            # what a legacy font's extracted text looks like (fictional)
LAYOUT = {
    "schema": "pageinator.layout/1",
    "headline": {"lines_hist": {"1": 10, "2": 9, "3": 0}, "tz_range": [0.51, 1.17], "tz_median": 0.89, "leading_em": 0.97,
                 "align": "centred-fill", "size_by_span": {"1": 26.0, "3": 40.0}, "lead_ratio": {"lead": [3.7, 5.3]}},
    "body": {"size_pt": 12.0, "leadings_pt": [13.0, 12.0, 12.5, 13.0], "hscale_range": [0.96, 1.01], "indent_mm": 5.0,
             "visual_ratio": 0.8},
    "dateline": {"run_in_bold_share": 0.7}, "byline": {"mode": "end"}, "kicker": {"share": 0.05},
    "rules": {"separator": {"weight_pt": 0.3, "cmyk": [0, 0, 0, 0.5], "mode": "tiers"}, "column_rules": None},
    "photos": {"treatments": {"rect": 0.7, "ellipse": 0.2, "cutout": 0.1}, "positions": {"head": 0.3, "inset": 0.7, "centre": 0},
               "wrap_offset_mm": 2.75, "caption_share": 0.1},
    "panels": {"strap": {"cmyk": [0, 0, 1, 0], "text_cmyk": [0, 0, 0, 1], "height_mm": 7.0, "n": 3, "extra": "dropped"},
               "box": {"stroke_pt": 0.5, "pad_mm": 2.0, "fill": None}},
    "density": {"stories_per_page": [3, 4, 6]}, "margins_mm": 7.5, "grid_alternates": [],
}


def profile(layout=None) -> dict:
    return {"grid": {"columns": 5, "column_width_mm": 47.6, "gutter_mm": 4.23, "origin_mm": 7.5}, "spacing": {},
            "headline_size": {"by_span": {}}, **({"layout": layout} if layout is not None else {})}


class MapLayoutTest(unittest.TestCase):
    def test_a_learned_block_maps_to_the_settings(self):
        got = DPR._map_layout(LAYOUT, legacy=True)
        self.assertEqual(got, {
            "head_weight": 700, "head_max_lines": 2, "head_max_lines_1col": 2, "head_tz_min": 0.51, "head_tz_max": 1.17,
            "head_leading_em": 0.97, "head_align": "centre", "head_sizes": {1: 20.8, 3: 32.0}, "lead_ratio_max": 5.3,
            "body_family": "sans", "body_size_pt": 9.6, "body_fits": (1.0, 0.98, 0.96), "body_leadings_pt": (12.0, 12.5, 13.0),
            "dateline_bold": True, "byline_mode": "end", "kicker_mode": "lead", "caption_mode": "small",
            "rule_mode": "tiers", "rule_weight_pt": 0.3, "rule_cmyk": (0.0, 0.0, 0.0, 0.5),
            "photo_shapes": ("rect", "ellipse"), "photo_positions": ("head", "inset"), "wrap_gap_mm": 2.75,
            "panels": {"box": {"stroke_pt": 0.5, "pad_mm": 2.0},
                       "strap": {"cmyk": (0.0, 0.0, 1.0, 0.0), "text_cmyk": (0.0, 0.0, 0.0, 1.0), "height_mm": 7.0, "n": 3}},
            "stories_per_page": (3, 6)})
        LS.use(got)                                       # every key is a setting
        LS.use(None)

    def test_photos_density_captions_and_head_band_map(self):
        got = DPR._map_layout({"density": {"lead_area_share": 0.42},
                               "photos": {"width_cols": {"1": 3, "2": 1, "0": 0}, "area_share": 0.2, "per_page": [1, 2, 3],
                                          "lead_width_cols": 2.0},
                               "captions": {"caption_share": 0.0, "credit_share": 0.1},   # both rare: a credit line
                               "furniture": {"head_band": {"stops": [[0, 0, 0, 0.1], [0, 0, 0, 0.3]], "axis": "x",
                                                           "box_mm": [7.5, 6.7, 262.5, 19.2], "n": 7}}})
        self.assertEqual(got, {"head_weight": 700, "lead_area_share": 0.42, "photo_area_share": 0.2, "photo_cols": {1: 0.75, 2: 0.25},
                               "caption_mode": "small", "credit_mode": "line",
                               "head_band_fill": {"stops": ((0.0, 0.0, 0.0, 0.1), (0.0, 0.0, 0.0, 0.3)), "axis": "x"}})
        LS.use(got)
        LS.use(None)
        self.assertNotIn("credit_mode", DPR._map_layout({"captions": {"caption_share": 0.6, "credit_share": 0.1}}))
        for path, bad in ((("photos", "width_cols"), {"x": 1}), (("photos", "width_cols"), {"1": -1}),
                          (("photos", "area_share"), 2), (("density", "lead_area_share"), "half"),
                          (("captions", "caption_share"), 1.5), (("furniture", "head_band"), {"stops": [[1, 0, 0]]}),
                          (("furniture", "head_band"), {"stops": [[0, 0, 0, 1]], "axis": "z"}),
                          (("furniture", "head_band"), {"stops": [], "axis": "x"}),
                          (("furniture", "head_band"), {"stops": [[0, 0, 0, 1]], "box_mm": [1, 2]})):
            with self.subTest(path=path, bad=bad), self.assertRaises(DPR.DamagedFile):
                DPR._map_layout({path[0]: {path[1]: bad}})

    def test_missing_keys_keep_their_defaults(self):
        self.assertEqual(DPR._map_layout({}), {"head_weight": 700})

    def test_photo_widths_under_a_column_are_not_widths(self):
        self.assertEqual(DPR._map_layout({"photos": {"width_cols": {"0": 3, "1": 2}}})["photo_cols"], {1: 1.0})
        self.assertNotIn("photo_cols", DPR._map_layout({"photos": {"width_cols": {"0": 3}}}))

    def test_what_a_real_paper_learns_never_damages_it(self):
        # an ad page (0 headlines), a gray rule (no CMYK), a hairline, nothing on the grid, a Unicode paper's ratio
        got = DPR._map_layout({"density": {"stories_per_page": [0, 3, 6]}, "rules": {"separator": {"cmyk": None, "weight_pt": 0.0}},
                               "headline": {"size_by_span": {}}, "body": {"leadings_pt": [], "visual_ratio": 1.03, "size_pt": 10.0},
                               "panels": {"box": {"cmyk": [], "stroke_pt": 0.5}}})
        self.assertEqual((got["stories_per_page"], got["rule_weight_pt"], got["body_size_pt"]), ((1, 6), 0.1, 10.0))
        self.assertNotIn("body_family", got)          # sans and the size scaling are for a legacy face only
        self.assertNotIn("head_sizes", got)
        self.assertEqual(got["panels"], {"box": {"stroke_pt": 0.5}})
        self.assertNotIn("photo_shapes", DPR._map_layout({"photos": {"treatments": {"cutout": 1.0}}}))   # never cut-outs

    def test_damaged_values_are_refused(self):
        for path, bad in ((("headline", "tz_range"), [1.2, 0.6]), (("headline", "tz_range"), "wide"),
                          (("headline", "max_lines"), True), (("headline", "lines_hist"), {"x": 3}),
                          (("headline", "size_by_span"), {"1": -4}), (("headline", "size_by_span"), {"²": 20}),
                          (("headline", "align"), "diagonal"), (("body", "visual_ratio"), 9),
                          (("byline", "mode"), "loud"), (("rules", "separator"), {"cmyk": [1, 0, 0]}),
                          (("photos", "positions"), {"floating": 1}), (("panels",), {"glow": {}}),
                          (("panels",), {"box": {"stroke_pt": "thin"}}), (("density", "stories_per_page"), [6, 4, 3]),
                          (("headline",), "x")):
            lay = {k: dict(v) if isinstance(v, dict) else v for k, v in LAYOUT.items()}
            node = lay
            for k in path[:-1]:
                node = node[k]
            node[path[-1]] = bad
            with self.subTest(path=path, bad=bad), self.assertRaises(DPR.DamagedFile):
                DPR._map_layout(lay, legacy=True)


class SettingsForTest(unittest.TestCase):
    def tearDown(self):
        DPR.use_dataset(Path(tempfile.gettempdir()) / "no-such-dataset")

    def test_the_pilot_keeps_the_defaults_exactly(self):
        with tempfile.TemporaryDirectory() as d:
            LS.use({"head_weight": 600})
            DPR.use_dataset(Path(d))                      # no paper.json, no house profile: the pilot's path
            self.assertEqual(LS.ST, LS.DEFAULTS)
            self.assertEqual(DPR.settings_for(Path(d)), {})

    def test_only_a_refined_paper_maps_its_layout(self):
        with tempfile.TemporaryDirectory() as d:
            ds = Path(d)
            DE.write_json(ds / "house_profile.json", profile(LAYOUT))
            DE.write_json(ds / "paper.json", {**PAPER, "refined_layout": False})
            self.assertEqual(DPR.settings_for(ds), {})
            DE.write_json(ds / "paper.json", PAPER)
            self.assertEqual(DPR.settings_for(ds), {"refined": True, "wrap_min_mm": max(40.0, DG.G.COL_W)}
                             | DPR._map_layout(LAYOUT, DPR.is_legacy(ds)))
            DPR.use_dataset(ds)
            self.assertEqual(LS.ST["head_sizes"], {1: 20.8, 3: 32.0})


def legacy_model() -> dict:
    """A fictional weekly inner page: a folio band (box), its date and page number, an imprint line, all in a legacy font."""
    def txt(i, kind, bb, size, cmyk=None):
        return {"id": i, "kind": kind, "text": GARBAGE, "legacy_text": True, "size_pt": size, "bbox_mm": bb, "colour_cmyk": cmyk,
                "lines": [{"text": GARBAGE, "x0_mm": bb[0], "x1_mm": bb[2], "baseline_mm": bb[3] - 1.0}]}
    return {"page": 3, "page_w_mm": 270.0, "page_h_mm": 340.0, "stories": [], "elements": [
        {"id": "band", "kind": "box", "bbox_mm": [7.5, 6.7, 262.5, 19.2]},
        {"id": "tab", "kind": "box", "bbox_mm": [252.0, 6.8, 262.0, 19.1]},
        txt("date", "folio", [115.0, 9.0, 160.0, 16.0], 14.0),
        txt("num", "folio", [254.0, 8.0, 260.0, 18.0], 30.0, [0, 0, 0, 0]),
        txt("imp", "furniture", [20.0, 334.0, 200.0, 337.5], 8.0),
        {"id": "rule", "kind": "rule", "bbox_mm": [7.4, 332.4, 262.55, 332.6]}]}


class LegacyTemplateTest(unittest.TestCase):
    def template(self, ds: Path, pj: dict, role="inside", extra=()):
        m = legacy_model()
        m["elements"] += list(extra)

        def real(self, ds, name, role):
            self.seen_grid = DG.grid_now()
            self.role, self.page_w, self.page_h, self.model = role, 270.0, 340.0, {"page": 3}
            self.news_top, self.news_bottom, self.ad_block, self.regions = 22.0, 330.0, {"an": "ad block"}, []
            self.keep, self.dropped = [dict(e) for e in m["elements"]], []
        DE.write_json(ds / "report" / "page1" / "pages" / "w__p3.json", m)
        DE.write_json(ds / "paper.json", pj)
        tpl = types.SimpleNamespace()
        DPR._template_init(real)(tpl, ds, "w__p3", role)
        return tpl

    def test_legacy_text_leaves_the_template_and_rules_and_boxes_stay(self):
        with tempfile.TemporaryDirectory() as d:
            tpl = self.template(Path(d), PAPER)
        self.assertEqual([e["id"] for e in tpl.keep], ["band", "tab", "rule"])
        self.assertEqual(tpl.dropped, ["date", "imp", "num"])

    def test_the_running_head_is_drawn_fresh_and_never_from_the_legacy_text(self):
        with tempfile.TemporaryDirectory() as d:
            tpl = self.template(Path(d), PAPER)
        fresh = DPR.fresh_folios(tpl, 3, date(2026, 11, 9))
        self.assertEqual([(e["id"], t) for e, t in fresh], [("fresh-date", ["सोमवार, ९ नोव्हेंबर २०२६"]), ("fresh-page", ["३"])])
        date_slot, page_slot = fresh[0][0]["fresh"], fresh[1][0]["fresh"]
        self.assertEqual((date_slot["x_mm"], date_slot["align"], date_slot["baseline_mm"]), (135.0, "center", 15.0))   # band centre
        self.assertEqual((page_slot["x_mm"], page_slot["colour_cmyk"], page_slot["size_pt"]), (257.0, [0, 0, 0, 0], 30.0))
        self.assertEqual(DPR.fresh_folios(types.SimpleNamespace(), 3, date(2026, 11, 9)), [])   # any other paper: nothing

    def test_the_front_page_draws_no_number_and_the_imprint_comes_only_from_paper_json(self):
        with tempfile.TemporaryDirectory() as d:
            front = self.template(Path(d), PAPER, "front")
        self.assertEqual([e["id"] for e, _ in DPR.fresh_folios(front, 1, date(2026, 11, 9))], ["fresh-date"])
        with tempfile.TemporaryDirectory() as d:
            tpl = self.template(Path(d), {**PAPER, "imprint_text": ["काल्पनिक मुद्रक, काल्पनिक प्रकाशन"]})
        imp = [(e, t) for e, t in DPR.fresh_folios(tpl, 3, date(2026, 11, 9)) if e["id"].startswith("fresh-imprint")]
        self.assertEqual([(e["fresh"]["x_mm"], e["fresh"]["baseline_mm"], t) for e, t in imp],
                         [(20.0, 336.5, ["काल्पनिक मुद्रक, काल्पनिक प्रकाशन"])])

    def test_folio_plan_and_draw_set_only_the_fresh_lines(self):
        with tempfile.TemporaryDirectory() as d:
            tpl = self.template(Path(d), PAPER)
        _, redo = DPR._folio_plan(lambda *a: ([], []))(tpl, 3, 8, date(2026, 11, 9), {})
        drawn = []
        B = types.SimpleNamespace(font=lambda *a: "f", text_line=lambda t, f, size, x, y, c, align, meta: drawn.append((t, size, x, c, align)))
        cx = types.SimpleNamespace(r_cal=0.8)
        done = DPR._draw_folios(lambda *a: [])(B, tpl, cx, redo, {"colour": {}})
        self.assertEqual(done, ["fresh-date", "fresh-page"])
        self.assertEqual(drawn, [("सोमवार, ९ नोव्हेंबर २०२६", 11.2, 135.0, (0, 0, 0, 1), "center"),     # house pt × r_cal
                                 ("३", 24.0, 257.0, (0, 0, 0, 0), "center")])                              # white, as printed
        self.assertNotIn(GARBAGE, " ".join(t for t, *_ in drawn))


    def test_the_head_band_is_recorded_and_its_fill_drawn_under_the_tab(self):
        with tempfile.TemporaryDirectory() as d:
            tpl = self.template(Path(d), PAPER)
        self.assertEqual(tpl.head_band, (7.5, 6.7, 262.5, 19.2))
        B = types.SimpleNamespace(items=["band frame", "black page tab"])     # what the render drew of the band
        fill = {"stops": ((0.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 0.4)), "axis": "x"}
        DPR._draw_folios(lambda *a: [])(B, tpl, types.SimpleNamespace(r_cal=0.8), [], {"colour": {}})
        self.assertEqual(B.items, ["band frame", "black page tab"])         # no learned fill: nothing (the pilot too)
        with mock.patch.dict(DG.G.ST, {"head_band_fill": fill}):
            DPR._draw_folios(lambda *a: [])(B, tpl, types.SimpleNamespace(r_cal=0.8), [], {"colour": {}})
        img = B.items[0]
        self.assertEqual(B.items[1:], ["band frame", "black page tab"])     # drawn first: the tab stays on top
        self.assertIsInstance(img, DG.X.Image)
        self.assertEqual((img.width_px, img.height_px), (DPR.BAND_PX, 4))
        mm = DG.MM
        self.assertEqual([round(v / mm, 3) for v in (img.x_pt, img.y_pt, img.w_pt, img.h_pt)], [7.5, 320.8, 255.0, 12.5])
        front = types.SimpleNamespace(items=[], page_h=340.0)
        with mock.patch.dict(DG.G.ST, {"head_band_fill": fill}):
            DPR.draw_head_band(front, types.SimpleNamespace(page_h=340.0))   # a page without the band (a front page)
        self.assertEqual(front.items, [])

    def test_the_band_raster_blends_its_stops_along_its_axis(self):
        w, h, raw = DPR.band_raster(((0, 0, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)), "x")
        self.assertEqual((w, h, len(raw)), (512, 4, 512 * 4 * 4))
        self.assertEqual((raw[:4], raw[4 * 511:4 * 512]), (bytes(4), bytes((0, 0, 0, 255))))
        mid = 4 * 255
        self.assertEqual(raw[mid:mid + 4], bytes((255, 0, 0, 0)))          # at the middle stop
        self.assertEqual(raw[:4 * 512], raw[4 * 512:8 * 512])              # every row the same
        w, h, raw = DPR.band_raster(((0, 0, 0, 0), (0, 0, 0, 1)), "y")
        self.assertEqual((w, h), (4, 512))
        self.assertEqual((raw[:16], raw[-16:]), (bytes(16), bytes((0, 0, 0, 255)) * 4))   # top row, bottom row

    def test_the_masthead_strip_is_set_only_from_paper_json(self):
        strip = {"id": "strip", "kind": "caption", "text": GARBAGE, "legacy_text": True, "size_pt": 13.0,
                 "bbox_mm": [12.0, 19.5, 258.0, 21.5], "lines": [{"text": GARBAGE, "x0_mm": 12.0, "x1_mm": 258.0, "baseline_mm": 20.5}]}
        with tempfile.TemporaryDirectory() as d:
            front = self.template(Path(d), PAPER, "front", [strip])
        self.assertEqual([e["id"] for e, _ in DPR.fresh_folios(front, 1, date(2026, 11, 9))], ["fresh-date"])   # empty: nothing
        with tempfile.TemporaryDirectory() as d:
            front = self.template(Path(d), {**PAPER, "masthead_strip_text": ["काल्पनिक नोंदणी क्र. ०००"]}, "front", [strip])
        got = [(e["id"], e["fresh"], t) for e, t in DPR.fresh_folios(front, 1, date(2026, 11, 9))][1:]
        self.assertEqual(len(got), 1)
        i, slot, text = got[0]
        self.assertEqual((i, text), ("fresh-strip-1", ["काल्पनिक नोंदणी क्र. ०००"]))
        self.assertEqual((slot["x_mm"], slot["baseline_mm"], slot["align"], slot["bold"], slot["max_w_mm"]), (135.0, 20.5, "center", True, 246.0))
        self.assertNotIn("strip", [e["id"] for e in front.keep])

    def test_masthead_strip_text_is_checked(self):
        with tempfile.TemporaryDirectory() as d:
            ds = Path(d)
            for bad in ("one line", [1], {"a": "b"}):
                DE.write_json(ds / "paper.json", {**PAPER, "masthead_strip_text": bad})
                with self.subTest(bad=bad), self.assertRaises(DE.DamagedFile):
                    DPR.paper(ds)
            DE.write_json(ds / "paper.json", {**PAPER, "masthead_strip_text": ["a", ""]})
            self.assertEqual(DPR.paper(ds)["masthead_strip_text"], ["a", ""])

    def test_a_page_on_the_other_grid_is_made_on_it(self):
        alt = {"columns": 4, "column_width_mm": 60.5, "gutter_mm": 4.22, "pages": [3]}
        main = DG.grid_now()
        with tempfile.TemporaryDirectory() as d:
            ds = Path(d)
            DE.write_json(ds / "house_profile.json", profile({**LAYOUT, "grid_alternates": [alt]}))
            tpl = self.template(ds, PAPER)
            self.assertEqual(DPR.page_grid(ds, 3), (4, 60.5, 4.22, DG.MAIN_GRID[3]))
            self.assertIsNone(DPR.page_grid(ds, 2))
        self.assertEqual(tpl.seen_grid, (4, 60.5, 4.22, DG.MAIN_GRID[3]))
        self.assertEqual(tpl.grid, tpl.seen_grid)
        self.assertEqual(DG.grid_now(), main)                               # put back
        with tempfile.TemporaryDirectory() as d:
            tpl = self.template(Path(d), PAPER)                              # no alternates: the paper's grid
        self.assertEqual(tpl.grid, DG.MAIN_GRID)


class GridTest(unittest.TestCase):
    ALT = (4, 60.5, 4.22, 7.5)

    def test_on_grid_sets_and_puts_back_gen1s_grid(self):
        main, pitch = DG.grid_now(), DG.G.PITCH
        with DG.on_grid(self.ALT):
            self.assertEqual((DG.G.NCOL, DG.G.COL_W, DG.G.GUT, DG.G.ORIGIN), self.ALT)
            self.assertAlmostEqual(DG.G.PITCH, 64.72)
            self.assertEqual(DG.G.span_mm(4), 4 * 60.5 + 3 * 4.22)
            with DG.on_grid(main):
                self.assertEqual(DG.grid_now(), main)
            self.assertEqual(DG.grid_now(), self.ALT)
        self.assertEqual((DG.grid_now(), DG.G.PITCH), (main, pitch))
        with self.assertRaises(RuntimeError), DG.on_grid(self.ALT):
            raise RuntimeError                                               # put back after an error too
        self.assertEqual(DG.grid_now(), main)
        with DG.on_grid(None):
            self.assertEqual(DG.grid_now(), main)

    def test_the_manifest_records_a_refined_pages_grid(self):
        self.assertEqual(DG.grid_record(), {})                               # the pilot's manifest: unchanged
        with mock.patch.dict(DG.G.ST, {"refined": True}), DG.on_grid(self.ALT):
            self.assertEqual(DG.grid_record(), {"grid": {"columns": 4, "column_width_mm": 60.5, "gutter_mm": 4.22, "origin_mm": 7.5}})

    def test_options_are_cached_per_grid(self):
        cal, cx = types.SimpleNamespace(styles={}, space_em=0.3), types.SimpleNamespace(inputs={}, r_cal=0.8)
        key = DE.options_cache_key({"id": "s1"}, [], None, cal, cx)
        with DG.on_grid(self.ALT):
            self.assertNotEqual(DE.options_cache_key({"id": "s1"}, [], None, cal, cx), key)
        self.assertEqual(DE.options_cache_key({"id": "s1"}, [], None, cal, cx), key)

    def test_workers_measure_and_lay_out_on_the_tasks_grid(self):
        seen = []
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(DW._STATE, {"cx": None, "cal": None}), \
                mock.patch.object(DG, "measure", lambda *a: seen.append(DG.G.NCOL) or {}), \
                mock.patch.object(DG, "layout_page", lambda *a, **k: seen.append(DG.G.NCOL) or {"ok": False}), \
                mock.patch.object(DW, "template", lambda name, role: types.SimpleNamespace(grid=self.ALT)):
            self.assertTrue(DW.measure_task([], [], d, self.ALT)["ok"])
            DW.measure_task([], [], d)
            DW.layout_task({"page": 5, "pages": 8, "date": "2026-11-09", "edition": {}, "template": "w__p5", "role": "inside",
                            "grid": self.ALT, "stories": [], "elements": [], "photo_dir": d, "precomputed": {}, "out_dir": d})
        self.assertEqual(seen, [4, DG.G.NCOL, 4])

    def test_damaged_alternates_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            ds = Path(d)
            DE.write_json(ds / "paper.json", PAPER)
            for bad in ({"columns": "4", "column_width_mm": 60.5, "gutter_mm": 4.2, "pages": [5]},
                        {"columns": 4, "column_width_mm": 60.5, "gutter_mm": 4.2, "pages": "5"},
                        {"columns": 4, "column_width_mm": -1, "gutter_mm": 4.2, "pages": [5]},
                        {"columns": 4, "gutter_mm": 4.2, "pages": [9]}, "4 columns",
                        {"columns": DG.MAIN_GRID[0] + 1, "column_width_mm": 10.0, "gutter_mm": 1.0, "pages": [5]},   # more columns
                        {"columns": 2, "column_width_mm": 900.0, "gutter_mm": 1.0, "pages": [5]}):                   # too wide
                DE.write_json(ds / "house_profile.json", profile({"grid_alternates": [bad]}))
                with self.subTest(bad=bad), self.assertRaises(DE.DamagedFile):
                    DPR.page_grid(ds, 5)
        with tempfile.TemporaryDirectory() as d:                             # the pilot: never another grid
            self.assertIsNone(DPR.page_grid(Path(d), 5))


def opt(lo, hi):
    return {"lo": lo, "hi": hi}


class HoldingTest(unittest.TestCase):
    """A refined paper's page never fails for its pinned stories: what it cannot hold waits (deskplan, hold)."""
    W, TOP = DG.G.NCOL, 30.0

    def page(self, **kw):
        return {"page": 5, "regions": [(0, self.W, self.TOP, self.TOP + 100 * DG.G.UNIT + 0.01)], "target": 4, **kw}

    def items(self, n):
        return [{"key": f"s{i}", "order": i, "pin": 5, "brief": False} for i in range(n)]

    def test_stories_beyond_the_target_wait_least_important_first(self):
        side = {c: {w: [opt(90, 110)] for w in range(1, self.W + 1)} for c in (0, 1, 3)}   # any number fills, side by side
        its = self.items(8)
        pages, left, dropped = DP.Planner(its, {it["key"]: side for it in its}, [self.page(target=6)], hold=True).plan()
        self.assertEqual(pages[0]["keys"], [f"s{i}" for i in range(6)])
        self.assertEqual(sorted(dropped), ["s6", "s7"])
        self.assertEqual(dropped["s7"], "No room on page 5 — it waits: pin it to another page, or shorten the page's stories")

    def test_pinned_stories_that_overfill_the_page_lose_the_least_important(self):
        stack = {c: {w: ([opt(45, 55)] if w == self.W else []) for w in range(1, self.W + 1)} for c in (0, 1, 3)}   # two fill it
        its = self.items(3)
        opts = {it["key"]: stack for it in its}
        pages, _, dropped = DP.Planner(its, opts, [self.page()], hold=True).plan()
        self.assertEqual((pages[0]["keys"], pages[0]["shrink_units"], list(dropped)), (["s0", "s1"], 0, ["s2"]))
        pages, _, dropped = DP.Planner(its, opts, [self.page()]).plan()    # the pilot's rule: as it was
        self.assertEqual((pages[0]["keys"], pages[0]["shrink_units"], dropped), (["s0", "s1", "s2"], None, {}))

    def test_pinned_stories_that_only_fall_short_all_stay(self):
        # a page around an ad (two regions) one short pinned story cannot fill: it stays (not-fill warning), never waits
        short = {c: {w: [opt(10, 12)] for w in range(1, self.W + 1)} for c in (0, 1, 3)}
        page = {**self.page(), "regions": [(0, 4, self.TOP, self.TOP + 100 * DG.G.UNIT), (4, self.W - 4, self.TOP, self.TOP + 60 * DG.G.UNIT)]}
        pages, _, dropped = DP.Planner(self.items(1), {"s0": short}, [page], hold=True).plan()
        self.assertEqual((pages[0]["keys"], dropped), (["s0"], {}))

    def test_the_cap_is_the_most_the_paper_prints(self):
        side = {c: {w: [opt(90, 110)] for w in range(1, self.W + 1)} for c in (0, 1, 3)}
        its = self.items(8)
        pages, _, dropped = DP.Planner(its, {it["key"]: side for it in its}, [self.page(cap=6)], hold=True).plan()
        self.assertEqual((len(pages[0]["keys"]), sorted(dropped)), (6, ["s6", "s7"]))

    def test_a_page_on_another_grid_is_planned_on_it_with_its_options(self):
        alt = (4, 60.5, 4.22, 7.5)
        none = {c: {w: [] for w in range(1, self.W + 1)} for c in (0, 1, 3)}
        four = {c: {w: ([opt(90, 110)] if w == 4 else []) for w in range(1, 5)} for c in (0, 1, 3)}
        its = self.items(1)
        seen = []
        real = DP.reach
        with mock.patch.object(DP, "reach", lambda opts, W, Hn: seen.append(W) or real(opts, W, Hn)):
            page = {**self.page(), "regions": [(0, 4, self.TOP, self.TOP + 100 * DG.G.UNIT + 0.01)], "grid": alt, "options": {"s0": four}}
            pages, _, dropped = DP.Planner(its, {"s0": none}, [page], hold=True).plan()
        self.assertEqual((pages[0]["keys"], pages[0]["shrink_units"], dropped), (["s0"], 0, {}))
        self.assertEqual(set(seen), {4})
        self.assertEqual(DG.grid_now(), DG.MAIN_GRID)


class LegacyRatioTest(unittest.TestCase):
    def test_a_refined_legacy_paper_is_sized_by_its_visual_ratio(self):
        ratio = DPR._legacy_ratio(lambda self: 0.9)
        with tempfile.TemporaryDirectory() as d:
            ds = Path(d)
            cx = types.SimpleNamespace(ds=ds)
            DE.write_json(ds / "report" / "page1" / "pages" / "w__p3.json", legacy_model())
            self.assertEqual(ratio(cx), 0.9)              # no paper.json: the measured ratio
            DE.write_json(ds / "paper.json", PAPER)
            DE.write_json(ds / "house_profile.json", profile(LAYOUT))
            self.assertEqual(ratio(cx), 0.8)
            DE.write_json(ds / "house_profile.json", profile({"body": {}}))
            with self.assertRaises(DPR.DamagedFile):
                ratio(cx)


class TemplatesByPageTest(unittest.TestCase):
    def test_checked_and_used_per_page(self):
        with tempfile.TemporaryDirectory() as d:
            ds = Path(d)
            DE.write_json(ds / "report" / "page1" / "pages" / "w__p4.json", {"elements": []})
            cfg = {"dataset": d, "templates": {"front": "f", "inside_imprint": "i", "inside": "n", "back": "b"}}
            self.assertEqual(DE.templates_by_page(cfg), {})
            roles = DE.page_roles(8, False)
            self.assertEqual(DE.template_keys(cfg, roles), roles)
            cfg["templates_by_page"] = {"4": "w__p4"}
            self.assertEqual(DE.templates_by_page(cfg), {4: "w__p4"})
            self.assertEqual(DE.template_keys(cfg, roles)[3], "inside_p4")
            with mock.patch.object(DG, "Template", lambda ds, name, role: (name, role)):
                self.assertEqual(DE.template_of(cfg, "inside_p4"), ("w__p4", "inside"))
                self.assertEqual(DE.template_of(cfg, "inside_imprint"), ("i", "inside_imprint"))
            for bad in ({"4": "missing"}, {"4": "../w__p4"}, {"0": "w__p4"}, {"x": "w__p4"}, {"4": 4}, ["w__p4"]):
                with self.subTest(bad=bad), self.assertRaises(DE.DamagedFile):
                    DE.templates_by_page({**cfg, "templates_by_page": bad})

    def test_the_stories_target_comes_from_the_house_setting_when_set(self):
        per = {"inside": {"stories": 9}}
        self.assertEqual(DE.stories_target(per, "inside_imprint"), 9)
        with mock.patch.dict(DG.G.ST, {"stories_per_page": (3, 6)}):
            self.assertEqual(DE.stories_target(per, "inside"), 4)


class TreatmentTest(unittest.TestCase):
    ART = {"id": "a-0000000001", "headline": "काल्पनिक बातमी", "kicker": "", "deck": "", "byline": "",
           "body": " ".join(["काल्पनिक"] * 200), "priority": 1, "page": None, "photo": None}

    def test_articles_are_stamped_before_their_stories_only_with_panels(self):
        calls = []

        def assign(arts, overrides=None):
            calls.append([a.get("treatment") for a in arts])
            return {arts[0]["id"]: "box"}
        seen = []
        real = DA.to_story

        def to_story(a, *rest):
            seen.append(a.get("treatment"))
            return real(a, *rest)
        with tempfile.TemporaryDirectory() as d, mock.patch.object(DA, "assign_treatments", assign), \
                mock.patch.object(DA, "to_story", to_story):
            DE.Built({"pages": 4, "date": "2026-11-09"}, [self.ART], Path(d))
            self.assertEqual((calls, seen), ([], [None]))                 # the pilot: no panels, no call, no stamp
            with mock.patch.dict(DG.G.ST, {"panels": {"box": {}}}):
                DE.Built({"pages": 4, "date": "2026-11-09"}, [{**self.ART, "treatment": "tint"}], Path(d))
            self.assertEqual((calls, seen[1:]), ([["tint"]], ["box"]))   # the editor's choice reaches assign_treatments
        self.assertNotIn("treatment", self.ART)                          # the caller's article is never changed


if __name__ == "__main__":
    unittest.main()
