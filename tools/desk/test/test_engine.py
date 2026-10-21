"""Desk engine tests that need no private data (fictional text only). Run from the repository root:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python -m unittest tools/desk/test/test_engine.py -v
"""
from __future__ import annotations

import itertools
import json
import math
import os
import stat
import sys
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))

import desk_engine as DE  # noqa: E402
import deskarticles as DA  # noqa: E402
import deskedit as DEd  # noqa: E402
import deskfolio as DF  # noqa: E402
import deskfonts  # noqa: E402
import deskgen as DG  # noqa: E402
import deskplan as DP  # noqa: E402
import deskprinted as DP_  # noqa: E402

DAY = date(2026, 10, 21)          # a Wednesday


class FolioTest(unittest.TestCase):
    def test_weekday_date_month_year(self):
        self.assertEqual(DF.rewrite("शुक्रवार, दि. १४ नोव्हेंबर २०२५", DAY, 1, 8), "बुधवार, दि. २१ ऑक्टोबर २०२६")

    def test_latin_digits_stay_latin(self):
        self.assertEqual(DF.rewrite("शनिवार 15 नोव्हेंबर, 2025", DAY, 1, 8), "बुधवार 21 ऑक्टोबर, 2026")

    def test_pages_issue_volume_price(self):
        t = "पाने ४ अंक क्र. १२३ वर्ष ५ किंमत ३ रुपये"
        self.assertEqual(DF.rewrite(t, DAY, 1, 8, volume="6", issue="240", price="5"), "पाने ८ अंक क्र. २४० वर्ष ६ किंमत ५ रुपये")
        self.assertEqual(DF.rewrite(t, DAY, 1, 8), "पाने ८ अंक क्र. १२३ वर्ष ५ किंमत ३ रुपये")   # not given: kept

    def test_page_number(self):
        self.assertEqual(DF.rewrite("पान ३", DAY, 5, 8), "पान ५")

    def test_month_inside_a_word_is_left_alone(self):
        # "मे" (May) must not match inside "मेळावा" (a gathering), nor a weekday inside a longer word
        self.assertEqual(DF.rewrite("१२ मेळावा", DAY, 1, 4), "१२ मेळावा")
        self.assertEqual(DF.rewrite("रविवारी सभा", DAY, 1, 4), "रविवारी सभा")

    def test_number_helpers(self):
        self.assertTrue(DF.is_number_only(" १२ "))
        self.assertFalse(DF.is_number_only("पान १२"))
        self.assertEqual(DF.digits_like("४", 16), "१६")
        self.assertEqual(DF.digits_like("4", 16), "16")

    def test_standing_key_ignores_the_date(self):
        a = DG.standing_key("बुधवार, दि. २१ ऑक्टोबर २०२६")
        b = DG.standing_key("शनिवार, दि. १५ नोव्हेंबर २०२५")
        self.assertEqual(a, b)


class ArticleTest(unittest.TestCase):
    ART = {"id": "a-0123456789", "headline": "शहरात  नव्या उड्डाणपुलाचे काम सुरू", "kicker": "", "deck": "नागरिकांना दिलासा",
           "byline": "प्रतिनिधी", "priority": 2, "page": None,
           "body": "पहिला परिच्छेद येथे आहे.\nतो पुढे चालू राहतो.\n\n## उपशीर्षक\n\nदुसरा परिच्छेद.",
           "photo": {"id": "p-0123456789", "caption": "पुलाचे काम", "credit": "छायाचित्रकार", "width_px": 2000, "height_px": 1333}}

    def test_blocks(self):
        self.assertEqual(DA.blocks(self.ART["body"]),
                         [("para", "पहिला परिच्छेद येथे आहे. तो पुढे चालू राहतो."), ("crosshead", "उपशीर्षक"), ("para", "दुसरा परिच्छेद.")])
        self.assertEqual(DA.body_words(self.ART["body"]), 10)

    def test_pasted_paragraphs_one_per_line(self):
        pasted = "पहिला परिच्छेद संपला.\nदुसरा परिच्छेद संपला।\n## उपशीर्षक\nतिसरा परिच्छेद!"
        self.assertEqual([k for k, _ in DA.blocks(pasted)], ["para", "para", "crosshead", "para"])
        wrapped = "ही ओळ समासाशी\nतुटलेली आहे आणि\nवाक्य इथे संपते."      # lines broken at the margin: one paragraph
        self.assertEqual(DA.blocks(wrapped), [("para", "ही ओळ समासाशी तुटलेली आहे आणि वाक्य इथे संपते.")])

    def test_brief(self):
        self.assertFalse(DA.is_brief(self.ART))                       # has a photo
        self.assertTrue(DA.is_brief({**self.ART, "photo": None}))
        self.assertFalse(DA.is_brief({**self.ART, "photo": None, "body": "शब्द " * 61}))

    def test_story(self):
        st, els = DA.to_story(self.ART, 990.0, {"p-0123456789"})
        ids = {e["id"]: e for e in els}
        self.assertEqual(st["id"], "d0123456789")
        self.assertEqual(ids[st["headline"]]["text"], "शहरात नव्या उड्डाणपुलाचे काम सुरू")
        self.assertEqual(ids[st["headline"]]["size_pt"], 990.0)
        self.assertEqual(st["images"], ["p-0123456789"])
        self.assertEqual(ids[st["captions"][0]]["text"], "पुलाचे काम (छाया: छायाचित्रकार)")
        self.assertEqual([b["type"] for b in st["flow"]], ["para", "crosshead", "para"])
        self.assertTrue(all(b["indent_mm"] > 0.5 for b in st["flow"] if b["type"] == "para"))
        self.assertEqual(DG.CP.role_font(ids[st["byline"]]["font"], "byline")[0], DG.CP.SERIF)   # the house's bold body face
        # a photo the edition does not have is not placed
        st2, _ = DA.to_story(self.ART, 990.0, set())
        self.assertEqual(st2["images"], [])
        self.assertEqual(st2["captions"], [])

    def test_briefs_story(self):
        a = {**self.ART, "photo": None}
        st, els = DA.briefs_story([a, {**a, "id": "a-00000000ff", "headline": "दुसरी बातमी"}], "1")
        self.assertIsNone(st["headline"])
        self.assertEqual([b["type"] for b in st["flow"]][:1], ["crosshead"])
        self.assertEqual(sum(b["type"] == "crosshead" for b in st["flow"]), 2)
        self.assertEqual(st["desk_briefs"], ["a-0123456789", "a-00000000ff"])


def opt(lo, hi):
    return {"lo": lo, "hi": hi}


class PlanTest(unittest.TestCase):
    def test_reach_stacks_and_sets_side_by_side(self):
        W = DG.G.NCOL
        a = {w: [opt(100, 110)] for w in range(1, W + 1)}
        b = {w: [opt(104, 120)] for w in range(1, W + 1)}
        R = DP.reach([a, b], W, 400)
        self.assertTrue(DG.G.contains(R[(3, 8)], 210))               # stacked: heights add up (204–230)
        self.assertTrue(DG.G.contains(R[(3, 8)], 105))               # side by side: both 104–110 high
        self.assertFalse(DG.G.contains(R[(3, 8)], 150))              # neither

    def test_plan_reports_pinned_stories_it_cannot_place(self):
        W, top = DG.G.NCOL, 30.0
        good = {c: {w: [opt(10, 400)] for w in range(1, W + 1)} for c in (0, 1, 3)}
        none = {c: {w: [] for w in range(1, W + 1)} for c in (0, 1, 3)}
        page = {"page": 1, "regions": [(0, 8, top, top + 200 * DG.G.UNIT + 0.01)], "target": 6}
        items = [{"key": "a", "order": 0, "pin": 1, "brief": False}, {"key": "b", "order": 1, "pin": 1, "brief": False}]
        pages, left, dropped = DP.Planner(items, {"a": good, "b": none}, [page]).plan()
        self.assertEqual(pages[0]["keys"], ["a"])
        self.assertEqual(left, [])
        self.assertIn("headline", dropped["b"])
        # more stories pinned to a page than the search takes: the least important ones are reported, not lost
        many = [{"key": f"s{i}", "order": i, "pin": 1, "brief": False} for i in range(DP.MAX_MODULES + 2)]
        pages, left, dropped = DP.Planner(many, {it["key"]: good for it in many}, [page]).plan()
        self.assertEqual(len(pages[0]["keys"]), DP.MAX_MODULES)
        self.assertEqual(sorted(dropped), [f"s{DP.MAX_MODULES}", f"s{DP.MAX_MODULES + 1}"])

    def test_fits_one_region(self):
        W = DG.G.NCOL
        a = {w: [opt(100, 110)] for w in range(1, W + 1)}
        b = {w: [opt(50, 55)] for w in range(1, W + 1)}
        R = DP.reach([a, b], W, 400)
        top = 30.0
        self.assertTrue(DP.fits(R, 2, [(0, 8, top, top + 160 * DG.G.UNIT + 0.01)]))
        self.assertFalse(DP.fits(R, 2, [(0, 8, top, top + 300 * DG.G.UNIT + 0.01)]))



# ------------------------------------------------------------------------------------------- a run's frozen plan
def article(n: int, words: int, priority: int = 3, photo=None) -> dict:
    return {"id": f"a-{n:010x}", "headline": f"काल्पनिक बातमी क्रमांक {n}", "kicker": "", "deck": "", "byline": "",
            "body": " ".join(["काल्पनिक"] * (words - 1)) + " शब्द.", "priority": priority, "page": None, "photo": photo}


class FrozenPlanTest(unittest.TestCase):
    """Within a run, new text never moves an article to another story or page (the review's B1 case, fictional)."""

    EDITION = {"pages": 4, "date": "2026-10-21"}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.arts = [article(1, 300, 1), article(2, 200, 2), article(3, 250)] + [article(10 + k, 30) for k in range(8)]

    def tearDown(self):
        self.tmp.cleanup()

    def built(self, arts, frozen=None):
        return DE.Built(self.EDITION, arts, self.dir, frozen)

    def test_the_layout_groups_short_items_six_to_a_column(self):
        b = self.built(self.arts)
        self.assertEqual(b.article_of["dbriefs1"], [f"a-{10 + k:010x}" for k in range(6)])
        self.assertEqual(b.article_of["dbriefs2"], [f"a-{16:010x}", f"a-{17:010x}"])

    def test_a_short_item_that_grows_stays_in_its_column(self):
        plan = self.built(self.arts).plan()
        grown = [dict(a, body=" ".join(["काल्पनिक"] * 79) + " शब्द.") if a["id"] == f"a-{12:010x}" else a for a in self.arts]
        regrouped = self.built(grown)                                   # a new layout would regroup …
        self.assertNotIn(f"a-{12:010x}", regrouped.article_of["dbriefs1"])
        kept = self.built(grown, plan)                                   # … the run keeps its plan
        self.assertEqual(kept.article_of["dbriefs1"], [f"a-{10 + k:010x}" for k in range(6)])
        self.assertEqual(kept.article_of["dbriefs2"], [f"a-{16:010x}", f"a-{17:010x}"])
        self.assertEqual(kept.kind_changes(regrouped, [f"a-{12:010x}"]),
                         [{"article": f"a-{12:010x}", "now": "story", "headline": "काल्पनिक बातमी क्रमांक 12"}])

    def test_a_story_cut_short_stays_a_story_and_deleted_articles_leave(self):
        plan = self.built(self.arts).plan()
        cut = [dict(a, body="एक छोटे काल्पनिक वाक्य.") if a["id"] == f"a-{3:010x}" else a for a in self.arts
               if a["id"] != f"a-{13:010x}"]
        kept = self.built(cut, plan)
        self.assertIn("d" + f"{3:010x}", kept.story_of)                 # still a story of its own
        self.assertEqual(kept.article_of["dbriefs1"], [f"a-{k:010x}" for k in (10, 11, 12, 14, 15)])
        self.assertEqual(kept.kind_changes(self.built(cut), [f"a-{3:010x}"]),
                         [{"article": f"a-{3:010x}", "now": "short item", "headline": "काल्पनिक बातमी क्रमांक 3"}])

    def same_stories(self, a, b, keys):
        for k in keys:
            self.assertEqual((a.story_of[k], a.els_of[k], a.article_of[k], a.photo_of[k]),
                             (b.story_of[k], b.els_of[k], b.article_of[k], b.photo_of[k]), k)

    def test_the_plan_rebuilds_the_layouts_stories_exactly(self):
        arts = self.arts + [article(30 + k, 30) for k in range(14)]          # more short items than the pages take
        laid = self.built(arts)
        self.assertTrue(any(it["order"] >= DE.OWN_STORY_ORDER for it in laid.items))
        kept = self.built(arts, laid.plan())
        self.assertEqual([it["key"] for it in kept.items], [it["key"] for it in laid.items])
        self.same_stories(kept, laid, laid.story_of)

    def test_a_deleted_story_leaves_and_the_others_stay_as_they_were(self):
        laid = self.built(self.arts)
        kept = self.built([a for a in self.arts if a["id"] != f"a-{1:010x}"], laid.plan())
        self.assertNotIn("d" + f"{1:010x}", kept.story_of)
        self.same_stories(kept, laid, [k for k in laid.story_of if k != "d" + f"{1:010x}"])

    def test_a_priority_change_keeps_the_run_order(self):
        plan = self.built(self.arts).plan()
        swapped = [dict(a, priority=1 if a["id"] == f"a-{2:010x}" else 2 if a["id"] == f"a-{1:010x}" else a["priority"])
                   for a in self.arts]
        kept = self.built(swapped, plan)
        order = [it["key"] for it in sorted(kept.items, key=lambda it: it["order"])]
        self.assertEqual(order[:2], ["d" + f"{1:010x}", "d" + f"{2:010x}"])
        self.assertEqual(self.built(swapped).items[0]["key"], "d" + f"{2:010x}")   # a new layout follows the priority


# ------------------------------------------------------------------------------------------- what a page prints
class PrintedTest(unittest.TestCase):
    """deskprinted: a change counts when it prints differently; a short item prints only its headline and text."""

    A = {"id": "a-0000000001", "headline": "काल्पनिक मथळा", "kicker": "", "deck": "", "byline": "प्रतिनिधी",
         "body": "पहिला परिच्छेद.\n\nदुसरा परिच्छेद.", "photo": {"id": "p-0000000001", "caption": "x", "credit": "y"}}

    def test_what_prints_counts(self):
        same = dict(self.A, body="पहिला   परिच्छेद.\n\n\nदुसरा परिच्छेद.  ")             # spacing that prints the same
        self.assertEqual(DP_.article_sig(same, False), DP_.article_sig(self.A, False))
        for change in ({"headline": "दुसरा मथळा"}, {"byline": "वार्ताहर"}, {"body": "नवा परिच्छेद."},
                       {"photo": {**self.A["photo"], "caption": "z"}}, {"photo": None}):
            with self.subTest(change=change):
                self.assertNotEqual(DP_.article_sig({**self.A, **change}, False), DP_.article_sig(self.A, False))

    def test_a_short_item_prints_its_headline_and_text_only(self):
        brief = DP_.article_sig(self.A, True)
        self.assertEqual(DP_.article_sig({**self.A, "byline": "वार्ताहर", "kicker": "क", "photo": None}, True), brief)
        self.assertNotEqual(DP_.article_sig({**self.A, "headline": "दुसरा"}, True), brief)
        sub = {**self.A, "body": "पहिला परिच्छेद.\n## एक उपशीर्षक\nदुसरा परिच्छेद."}
        self.assertEqual(DP_.article_sig({**sub, "body": sub["body"].replace("एक", "दुसरे")}, True),   # never printed
                         DP_.article_sig(sub, True))
        self.assertNotEqual(DP_.article_sig(sub, True), DP_.article_sig({**sub, "body": "पहिला परिच्छेद.\nदुसरा परिच्छेद."}, True))

    def test_lines_count_as_the_engine_reads_them(self):
        # how lines join into paragraphs can change once the engine removes a character the fonts lack at a line's end,
        # so lines joined or split are a change; spaces inside a line and extra empty lines are not
        three = {**self.A, "body": "एक वाक्य.\nदुसरे वाक्य.\nतिसरे"}
        self.assertNotEqual(DP_.article_sig({**three, "body": "एक वाक्य. दुसरे वाक्य. तिसरे"}, False),
                            DP_.article_sig(three, False))
        self.assertEqual(DP_.article_sig({**three, "body": "एक  वाक्य.\nदुसरे   वाक्य.\nतिसरे  "}, False),
                         DP_.article_sig(three, False))
        self.assertEqual(DP_.article_sig({**self.A, "body": "पहिला परिच्छेद.\n\n\n\nदुसरा परिच्छेद."}, False),
                         DP_.article_sig(self.A, False))

    def test_an_ads_index_that_cannot_be_read_is_never_no_ads(self):
        with tempfile.TemporaryDirectory() as d:
            ads = Path(d)
            self.assertEqual(DP_.ad_sigs(ads), {})                                  # no index at all: no ads
            for damaged in ("{damaged", '{"elements": []}', "[]"):
                (ads / "index.json").write_text(damaged)
                with self.assertRaises(DP_.AdIndexDamaged):
                    DP_.ad_sigs(ads)

    def test_an_ad_is_its_index_entry_and_its_raster(self):
        with tempfile.TemporaryDirectory() as d:
            ads = Path(d)
            (ads / "back-1.cmyk.gz").write_bytes(b"ad one")
            self.assertEqual(DP_.ad_sigs(ads), {})                                  # a raster with no entry: no ad
            DE.write_json(ads / "index.json", {"elements": {"back-1": {"width_px": 10}, "back-2": {"width_px": 10}}})
            self.assertEqual(list(DP_.ad_sigs(ads)), ["back-1"])                    # an entry with no raster: no ad

    def test_stale_reasons(self):
        with tempfile.TemporaryDirectory() as d:
            ads = Path(d)
            (ads / "back-1.cmyk.gz").write_bytes(b"ad one")
            DE.write_json(ads / "index.json", {"elements": {"back-1": {"width_px": 10}}})
            printed = {"v": DP_.VERSION, "articles": {"a-0000000001": DP_.article_sig(self.A, False), "a-0000000002": "gone"},
                       "folio": DP_.folio_sig({"issue": "240"}), "ads": {"back-1": DP_.ad_sigs(ads)["back-1"]}}
            live = {"a-0000000001": self.A}
            self.assertEqual(len(DP_.stale(printed, live, set(), {"issue": "240"}, DP_.ad_sigs(ads))), 1)   # one deleted
            (ads / "back-1.cmyk.gz").write_bytes(b"ad two")
            why = DP_.stale(printed, {**live, "a-0000000002": self.A}, set(), {"issue": "241"}, DP_.ad_sigs(ads))
            self.assertEqual([w.split(" ")[0] for w in why], ["An", "The", "An"])                # changed, folio, ad
            self.assertEqual(len(DP_.stale(printed, live, set(), {"issue": "240"}, {})), 2)   # the ad gone too
            self.assertEqual(DP_.stale({**printed, "v": 1}, live, set(), {"issue": "240"}, {}), [DP_.OLDER])   # never compared
            self.assertEqual(DP_.stale({**printed, "v": 2}, live, set(), {"issue": "240"}, {}), [DP_.OLDER])
            # the Desk page tells "save the pages" from "lay out again" by these words: an older record is saved
            self.assertNotIn("lay the edition out again", DP_.OLDER)
            self.assertIn("save it", DP_.OLDER)


class FolioSigTest(unittest.TestCase):
    def test_the_folio_counts_as_it_prints_spaces_included(self):
        self.assertNotEqual(DP_.folio_sig({"issue": "12  3"}), DP_.folio_sig({"issue": "12 3"}))
        self.assertEqual(DP_.folio_sig({"issue": "12 3", "volume": None}), DP_.folio_sig({"issue": "12 3", "volume": ""}))
        self.assertEqual(DP_.folio_sig({"issue": "क\u093c"}), DP_.folio_sig({"issue": "\u0958"}))   # NFC: one way to write it


# ------------------------------------------------------------------------------------------- Update text and the ads
class AdRefreshTest(unittest.TestCase):
    """Update text brings the edition's ads into the run's own pictures; if the page cannot be set then, the run's ads
    and the page's picture folder are as they were (white box: a page session without the engine)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def session(self, name, run_ad, ed_ad):
        ed = Path(self.tmp.name) / name
        run = ed / "runs" / "r-1"
        for d, data in ((ed / "ads", ed_ad), (run / "ads", run_ad)):
            d.mkdir(parents=True)
            if data is not None:
                (d / "back-1.cmyk.gz").write_bytes(data)
            DE.write_json(d / "index.json", {"elements": {"back-1": {"width_px": 10, "height_px": 5}} if data else {}})
        (run / "photos").mkdir()
        DE.write_json(run / "photos" / "index.json", {"elements": {}})
        s = DEd.PageSession.__new__(DEd.PageSession)
        s.run_dir, s.edition_dir = run, ed
        s.tpl = type("T", (), {"ad_slots": [{"slot": "back-1", "element": "e-ad-1"}]})()
        s.engine = type("E", (), {"keep_copy": staticmethod(DE.keep_copy)})()
        s.photo_dir = run / "work" / "page-02" / "photos"
        s.built = type("B", (), {"photo_ids": set(), "photos_idx": {}, "photo_dir": run / "photos"})()
        DG.link_photo_dir(s.photo_dir, [], {"e-ad-1": (run / "ads", "back-1", {"width_px": 10, "height_px": 5})}
                          if run_ad is not None else {})
        return s

    @staticmethod
    def page_ad(s):
        """What the page prints in its ad space (None: nothing)."""
        f = s.photo_dir / "e-ad-1.cmyk.gz"
        return f.read_bytes() if f.exists() else None

    @staticmethod
    def run_ads(s):
        return DP_.ad_sigs(s.run_dir / "ads"), sorted(p.name for p in (s.run_dir / "ads").iterdir())

    def test_a_new_changed_or_removed_ad_is_set_and_can_be_undone(self):
        for name, run_ad, ed_ad in (("changed", b"old ad", b"new ad"), ("removed", b"old ad", None), ("new", None, b"new ad")):
            with self.subTest(name):
                s = self.session(name, run_ad, ed_ad)
                before = (self.run_ads(s), self.page_ad(s))
                undo = []
                self.assertEqual(s._refresh_ads(undo), ["back-1"])
                self.assertEqual((self.page_ad(s), DP_.ad_sigs(s.run_dir / "ads")), (ed_ad, DP_.ad_sigs(s.edition_dir / "ads")))
                for step in reversed(undo):
                    step()
                s._link_ads()
                for kept in (s.run_dir / "ads").glob(".*.before"):
                    kept.unlink()
                self.assertEqual((self.run_ads(s), self.page_ad(s)), before)

    def test_update_text_that_cannot_set_the_page_leaves_the_run_ads_as_they_were(self):
        for name, run_ad, ed_ad in (("changed", b"old ad", b"new ad"), ("removed", b"old ad", None), ("new", None, b"new ad")):
            with self.subTest(name):
                self.cannot_set(f"failing-{name}", run_ad, ed_ad)

    def cannot_set(self, name, run_ad, ed_ad):
        s = self.session(name, run_ad, ed_ad)
        DE.write_json(s.edition_dir / "articles.json", {"articles": []})
        DE.write_json(s.edition_dir / "edition.json", {})
        s.edition, s.assets, s.modules, s.rev, s.prints_folio = {}, s.run_dir, [], 7, False
        s.folio_fields = s._live_fields()
        s.text_path, s.edit_path = s.run_dir / "edit-articles.json", s.run_dir / "page-02.edit.json"
        s.req_articles, s.articles = [], []
        s.built = type("B", (), {"photo_ids": set(), "photos_idx": {}, "photo_dir": s.run_dir / "photos", "article_of": {},
                                 "story_of": {}})()
        s.options, s._g, s._g_keys, s.partial, s._measurers = {}, None, None, set(), {}
        s.keep, s.redo, s.fixed_boxes = [], [], []

        def cannot(*_a, **_k):
            raise RuntimeError("a fictional failure while setting the page")
        s.draw = cannot
        before = (self.run_ads(s), self.page_ad(s))
        with self.assertRaises(RuntimeError):
            s.refresh_text()
        self.assertEqual((self.run_ads(s), self.page_ad(s), s.rev), (*before, 7))
        self.assertFalse(s.text_path.exists())


# ------------------------------------------------------------------------------------------- locks (white box)
G = DEd.G
TOP, FOOT = 30.0, 500.0                    # a fictional news area: 8 columns, 30 to 500 mm from the page's top


def col_x(col: int) -> float:
    return round(G.ORIGIN + col * G.PITCH, 3)


def mod(story: str, col: int, y: float, w: int, h: float, locked: bool = False) -> dict:
    return {"story": story, "x": col_x(col), "y": y, "w": w, "h": h, "locked": locked, "crop": None}


class LockCase(unittest.TestCase):
    """Page 1 of a fictional four-page run, as a page session without the engine (white box, as AdRefreshTest): the
    edition's stories dA … dD and a column of short items; other pages' stories are their edit files."""

    KEYS = ("dA", "dB", "dC", "dD", "dbriefs1")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.run = Path(self.tmp.name) / "ed" / "runs" / "r-20261021-120000"
        self.run.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def built(self, keys=None):
        keys = self.KEYS if keys is None else keys
        brief = {k: k.startswith("dbriefs") for k in keys}
        return types.SimpleNamespace(
            story_of={k: {"id": k, "headline": None if brief[k] else f"h-{k}"} for k in keys},
            els_of={k: [] if brief[k] else [{"id": f"h-{k}", "kind": "headline", "text": f"Fictional headline {k[1:]}"}]
                    for k in keys},
            article_of={k: [f"a-{i + 1:010x}"] for i, k in enumerate(keys)},
            items=[{"key": k, "brief": brief[k], "order": i} for i, k in enumerate(keys)])

    def session(self, modules, keys=None):
        s = DEd.PageSession.__new__(DEd.PageSession)
        s.page, s.pages, s.run_dir, s.rev = 1, 4, self.run, 3
        s.edit_path = self.run / "page-01.edit.json"
        s.modules, s.origin, s.built = [dict(m) for m in modules], {}, self.built(keys)
        s.tpl = types.SimpleNamespace(news_top=TOP, news_bottom=FOOT, regions=[(0, G.NCOL, TOP, FOOT)], model={})
        s.engine = types.SimpleNamespace(sessions={}, cached_options=lambda b, k: {})
        s.options, s.partial, s.extra_rows, s.keep = {}, set(), {}, []
        s.draw = lambda: {"rev": s.rev, "modules": s.modules}     # setting the page itself is not under test here
        s._write_edit()
        return s

    def other_page(self, n: int, modules: list) -> None:
        DE.write_json(self.run / f"page-{n:02d}.edit.json",
                      {"schema": "pageinator.desk.page-edit/1", "page": n, "modules": modules, "rev": 1})

    def files(self) -> dict:
        """Every file of the run, with its bytes and modification time."""
        return {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in sorted(self.run.iterdir()) if p.is_file()}

    def refused(self, s, modules, says: str) -> None:
        """The change is refused with these words, and nothing is set or written."""
        before = ([dict(m) for m in s.modules], s.rev, self.files())
        with self.assertRaises(ValueError) as e:
            s.apply(modules)
        self.assertEqual(str(e.exception), says)
        self.assertEqual((s.modules, s.rev, self.files()), before)


class ModuleAttrsTest(LockCase):
    """A module's attributes (the lock, the crop) are kept apart from its place: changing one never moves it."""

    A = mod("dA", 2, 137.23, 3, 100.0)                           # off the editor's grid, as below an advertisement

    def test_a_lock_change_keeps_an_off_grid_place(self):
        s = self.session([self.A])
        s.apply([{**self.A, "locked": True}])
        self.assertEqual(s.modules, [{**self.A, "locked": True}])     # not snapped to 137.0 or 137.5
        s.apply([{**self.A, "locked": False}])
        self.assertEqual((s.modules, s.rev), ([self.A], 5))
        self.assertEqual(DE.read_json(s.edit_path)["modules"], [self.A])

    def test_a_crop_never_moves_a_story_and_is_none_for_now(self):
        s = self.session([self.A])
        s.apply([{**self.A, "crop": {"photo": "p-0000000001", "focus": [0.2, 0.8], "zoom": 2.0}}])
        self.assertEqual(s.modules, [self.A])

    def test_a_moved_story_is_snapped_and_keeps_its_attributes(self):
        s = self.session([self.A])
        s.apply([{**self.A, "y": 150.2, "locked": True}])          # moved and locked at once (it was not locked)
        self.assertEqual(s.modules, [{**self.A, "y": 150.0, "locked": True}])
        self.assertEqual(s.snap({**self.A, "y": 150.2, "locked": True}),
                         {"story": "dA", "x": col_x(2), "y": 150.0, "w": 3, "h": 100.0})   # snap is the place only

    def test_a_lock_that_is_not_true_or_false_is_refused(self):
        s = self.session([self.A])
        for bad in ("yes", "false", 1, [], {}):
            with self.subTest(bad=bad):
                self.refused(s, [{**self.A, "locked": bad}], "a story's lock must be true or false")
        s.apply([{k: v for k, v in self.A.items() if k != "locked"}])   # missing: not locked
        self.assertFalse(s.modules[0]["locked"])


class LockTest(LockCase):
    """A locked story keeps its place, width and height and stays on the page; a story locked on another page is not
    brought here, and a page is not saved while one of its stories is locked on another page."""

    P = mod("dA", 0, TOP, 3, 120.5, locked=True)
    B = mod("dB", 3, TOP, 5, 120.5)
    MOVE = "“Fictional headline A” is locked: unlock it (Shift+L) to move it"

    def test_a_locked_story_cannot_be_moved_resized_or_taken_off(self):
        s = self.session([self.P, self.B])
        for change in ({"x": col_x(1)}, {"y": 40.0}, {"w": 2}, {"h": 100.0}, {"x": col_x(1), "locked": False}):
            with self.subTest(change=change):
                self.refused(s, [{**self.P, **change}, self.B], self.MOVE)
        off = "“Fictional headline A” is locked: unlock it (Shift+L) to take it off the page"
        self.refused(s, [self.B], off)
        self.refused(s, [{**self.P, "story": "d-not-in-the-edition"}, self.B], off)
        self.refused(s, [{**self.P, "x": col_x(4)}, {**self.P, "story": "dA"}, self.B], self.MOVE)   # first one counts
        s.apply([self.P, {**self.B, "x": col_x(4), "w": 4}])            # the others still move
        self.assertEqual((s.modules[0], s.modules[1]["x"]), (self.P, col_x(4)))

    def test_unlocking_in_place_and_undo_and_redo_pass(self):
        s = self.session([self.P])
        p, q = dict(self.P), {**self.P, "x": col_x(4), "y": 60.0}
        steps = [{**p, "locked": False}, {**q, "locked": False}, q]          # unlock, move, lock
        undone = [{**q, "locked": False}, {**p, "locked": False}, p]         # each step undone, last first
        for m in steps + undone + steps:                                     # … and redone
            s.apply([m])
            self.assertEqual(s.modules, [m])
        self.assertEqual(s.rev, 3 + 9)

    def test_a_swap_with_a_locked_story_is_refused(self):
        for a, b, who in ((self.P, self.B, "A"), ({**self.P, "locked": False}, {**self.B, "locked": True}, "B")):
            with self.subTest(locked=who):
                s = self.session([a, b])
                swapped = [{**a, "story": b["story"]}, {**b, "story": a["story"]}]     # as the editor swaps two
                self.refused(s, swapped, f"“Fictional headline {who}” is locked: unlock it (Shift+L) to move it")

    def test_a_story_locked_on_another_page_cannot_be_brought_here(self):
        self.other_page(2, [mod("dB", 0, TOP, 4, 200.0, locked=True)])
        s = self.session([self.P])
        self.refused(s, [self.P, self.B], "“Fictional headline B” is locked on page 2: unlock it there to bring it here")
        self.assertEqual(s.where()["dB"], {"page": 2, "locked": True})
        self.assertEqual([(p["on_page"], p["locked"]) for p in s.pool() if p["story"] == "dB"], [(2, True)])
        self.other_page(2, [mod("dB", 0, TOP, 4, 200.0)])                   # unlocked there: it may come here
        s.apply([self.P, self.B])
        self.assertEqual([m["story"] for m in s.modules], ["dA", "dB"])
        self.assertEqual([(p["on_page"], p["locked"]) for p in s.pool() if p["story"] == "dC"], [(None, False)])

    def test_a_story_on_two_other_pages_counts_as_locked_when_either_has_it_locked(self):
        for locked_on in (2, 3):
            with self.subTest(locked_on=locked_on):
                for n in (2, 3):
                    self.other_page(n, [mod("dB", 0, TOP, 4, 200.0, locked=n == locked_on)])
                self.assertEqual(self.session([self.P]).where()["dB"], {"page": locked_on, "locked": True})

    def test_a_page_holding_a_story_locked_on_another_page_is_not_saved(self):
        self.other_page(2, [mod("dB", 0, TOP, 4, 200.0, locked=True), mod("dC", 4, TOP, 4, 200.0)])
        s = self.session([self.P, self.B])
        (self.run / "page-01.pdf").write_bytes(b"the page as it was last saved (fictional)")
        s.render = lambda: self.fail("the page was set before the locks were checked")
        before = self.files()
        says = ("this page cannot be saved yet: “Fictional headline B” is also on page 2, locked there. Unlock it on "
                "page 2, or take it off this page, then save")
        for call in (s.export, s.take_from_other_pages):
            with self.subTest(call=call.__name__):
                with self.assertRaises(ValueError) as e:
                    call()
                self.assertEqual(str(e.exception), says)
                self.assertEqual(self.files(), before)            # the PDF and both pages' edits: untouched

    def test_a_save_takes_a_story_off_the_page_it_is_unlocked_on(self):
        c = mod("dC", 4, TOP, 4, 200.0, locked=True)
        self.other_page(2, [mod("dB", 0, TOP, 4, 200.0), c])
        s = self.session([self.P, self.B])
        self.assertEqual(s.take_from_other_pages(), {2: ["a-0000000003"]})
        saved = DE.read_json(self.run / "page-02.edit.json")
        self.assertEqual((saved["modules"], saved["rev"], saved["changed_by_page"]), ([c], 2, 1))

    def test_a_story_whose_articles_are_deleted_leaves_even_when_locked(self):
        s = self.session([self.P, {**self.B, "locked": True}])
        arts = [{"id": "a-0000000001"}, {"id": "a-0000000002"}]
        s.req_articles, s.articles, s._text_sig, s.text_path = arts, arts, "", self.run / "edit-articles.json"
        s.edition, s.assets, s.frozen, s._measurers, s._g = {}, self.run, {}, {}, None
        s._link_photos = lambda: None
        story = {"a-0000000001": "dA", "a-0000000002": "dB"}
        s.engine.built = lambda edition, articles, ed_dir, frozen=None: self.built([story[a["id"]] for a in articles])
        DE.write_json(s.text_path, {"articles": {"a-0000000001": None}})          # deleted from the edition
        s.sync()                                                                  # a deleted article never prints
        self.assertEqual(([m["story"] for m in s.modules], s.rev), (["dB"], 4))
        self.assertEqual([m["story"] for m in DE.read_json(s.edit_path)["modules"]], ["dB"])


class FreeRegionsTest(unittest.TestCase):
    """The space around locked stories, as whole-column rectangles for gen1's search."""

    AREA = [(0, G.NCOL, TOP, FOOT)]

    @staticmethod
    def box(col: int, w: int, y0: float, y1: float) -> tuple:
        return (G.ORIGIN + col * G.PITCH, y0, G.ORIGIN + col * G.PITCH + G.span_mm(w), y1)

    def test_a_box_in_the_middle_leaves_four_rectangles(self):
        b = [self.box(3, 2, 100.0, 200.0)]
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP),
                         [(0, 3, 30.0, 500.0), (5, 3, 30.0, 500.0), (3, 2, 30.0, 100.0), (3, 2, 200.0, 500.0)])
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP, rows_first=True),
                         [(0, 8, 30.0, 100.0), (0, 8, 200.0, 500.0), (0, 3, 100.0, 200.0), (5, 3, 100.0, 200.0)])

    def test_a_box_at_the_top_left(self):
        b = [self.box(0, 3, TOP, 130.0)]
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP), [(3, 5, 30.0, 500.0), (0, 3, 130.0, 500.0)])
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP, True), [(0, 8, 130.0, 500.0), (3, 5, 30.0, 130.0)])

    def test_strips_lower_than_a_module_are_dropped(self):
        self.assertEqual(DEd.free_regions(self.AREA, [self.box(0, 8, 39.5, 490.5)], TOP), [])
        self.assertEqual(DEd.free_regions(self.AREA, [self.box(0, 8, 40.0, 490.0)], TOP),
                         [(0, 8, 30.0, 40.0), (0, 8, 490.0, 500.0)])               # 10 mm is a module's least height

    def test_edges_off_the_grid_are_rounded_inwards(self):
        b = [self.box(3, 2, 100.2, 200.3)]
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP),
                         [(0, 3, 30.0, 500.0), (5, 3, 30.0, 500.0), (3, 2, 30.0, 100.0), (3, 2, 200.5, 500.0)])
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP, True),
                         [(0, 8, 30.0, 100.0), (0, 8, 200.5, 500.0), (0, 3, 100.0, 200.5), (5, 3, 100.0, 200.5)])
        self.assertEqual(DEd.free_regions([(2, 4, 260.3, 499.8)], [], TOP), [(2, 4, 260.5, 499.5)])   # below an ad

    def test_two_boxes(self):
        b = [self.box(4, 4, TOP, 230.0), self.box(0, 4, TOP, 130.0)]
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP), [(4, 4, 230.0, 500.0), (0, 4, 130.0, 500.0)])
        self.assertEqual(DEd.free_regions(self.AREA, b, TOP, True), [(0, 8, 230.0, 500.0), (0, 4, 130.0, 230.0)])

    def test_a_box_across_two_regions_and_one_outside_them(self):
        area = [(0, 4, TOP, FOOT), (4, 4, TOP, FOOT)]                              # as beside an ad block
        self.assertEqual(DEd.free_regions(area, [self.box(3, 2, 100.0, 200.0)], TOP),
                         [(0, 3, 30.0, 500.0), (3, 1, 30.0, 100.0), (3, 1, 200.0, 500.0),
                          (5, 3, 30.0, 500.0), (4, 1, 30.0, 100.0), (4, 1, 200.0, 500.0)])
        self.assertEqual(DEd.free_regions(self.AREA, [self.box(0, 8, 505.0, 530.0)], TOP), [(0, 8, 30.0, 500.0)])

    def test_what_is_left_is_on_the_grid_inside_the_area_and_clear_of_every_box(self):
        def over(a, b):
            return min(a[2], b[2]) - max(a[0], b[0]) > 1e-6 and min(a[3], b[3]) - max(a[1], b[1]) > 1e-6

        for rows_first, col, w, y0, h in itertools.product((False, True), (0, 2, 5), (1, 3), (30.0, 77.3, 211.75), (40.0, 133.3)):
            boxes = [self.box(col, w, y0, y0 + h), self.box((col + 4) % 8, 2, y0 + 60.2, y0 + 140.0)]
            free = DEd.free_regions(self.AREA, boxes, TOP, rows_first)
            with self.subTest(rows_first=rows_first, col=col, w=w, y0=y0, h=h):
                self.assertTrue(free)
                for r in free:
                    c0, cols, t, b = r
                    self.assertTrue(0 <= c0 and c0 + cols <= G.NCOL and TOP <= t and b <= FOOT and b - t >= DEd.MIN_H_MM)
                    for edge in (t, b):
                        self.assertAlmostEqual((edge - TOP) / DEd.SNAP_MM, round((edge - TOP) / DEd.SNAP_MM), places=6)
                    self.assertFalse(any(over(G.region_box(r), bx) for bx in boxes))
                for a, b in itertools.combinations(free, 2):
                    self.assertFalse(over(G.region_box(a), G.region_box(b)))


class LockedAlternativeTest(LockCase):
    """Another layout with locked stories, with a stub search: the locked stories stay exactly as they are, the search
    gets the stories that are not locked at their ranks on the page and the free space around the locked ones."""

    class Search:
        """Stands in for gen1's generator (DG.DeskGenerator): records what it is given; fills each region it is asked
        for with one story (fictional), or nothing."""
        made: list = []
        fill = True

        def __init__(self, cx, model, photo_dir, styles, ids, space_em, pre=None):
            self.ids, self.ban_lead, self.extra_rows, self.runs = set(ids), set(), {}, []
            self.stories = [types.SimpleNamespace(id=st["id"], rank=r) for r, st in enumerate(model["stories"])]
            type(self).made.append(self)

        def run(self, regions, span_prior, side):
            self.runs.append((list(regions), side, set(self.ban_lead)))
            if not type(self).fill:
                return None, {}
            trees = [(k, (i, regions[k])) for k, i in zip(range(len(regions)), range(len(self.stories)), strict=False)]
            return (0.0, trees), {}

        def place(self, tree, x, y):
            i, (c0, w, t, b) = tree
            return [(i, x, y, w, math.floor((b - t) / G.UNIT) * G.UNIT, None)]

    def setUp(self):
        super().setUp()
        self.real = DEd.DG.DeskGenerator
        DEd.DG.DeskGenerator = self.Search
        self.Search.made, self.Search.fill = [], True

    def tearDown(self):
        DEd.DG.DeskGenerator = self.real
        super().tearDown()

    def page(self, modules, keys):
        s = self.session(modules, keys)
        s.order = lambda: list(keys)
        s.generator = lambda: self.fail("the whole page was searched although stories are locked")
        s.engine.cal = types.SimpleNamespace(lead_side="right", span_prior=lambda r, w: 0.0, styles={}, space_em=0.25)
        s.engine.cx, s.tpl.model, s.photo_dir = None, {"unassigned": []}, self.run
        s.options = {k: {} for k in keys}
        return s

    def test_the_locked_stories_stay_and_the_others_fill_the_space_around_them(self):
        a = mod("dA", 0, TOP, 3, 100.0, locked=True)              # the page's lead, locked at the top left
        s = self.page([a, mod("dB", 5, TOP, 3, 470.0), mod("dC", 3, 230.0, 2, 100.0)], ["dA", "dB", "dC"])
        stored = json.dumps(a, sort_keys=True)
        s.alternative(3)
        g = self.Search.made[0]
        self.assertEqual([(st.id, st.rank) for st in g.stories], [("dB", 1), ("dC", 2)])   # their ranks on the page
        self.assertIs(g.extra_rows, s.extra_rows)
        self.assertEqual(g.runs, [([(3, 5, 30.0, 500.01), (0, 3, 130.0, 500.01)], "right", set())])  # lead locked
        self.assertEqual(json.dumps(s.modules[0], sort_keys=True), stored)                # exactly as it was
        self.assertEqual(s.modules[1:], [mod("dB", 3, TOP, 5, 470.0), mod("dC", 0, 130.0, 3, 370.0)])
        self.assertEqual(s.rev, 4)

    def test_no_fill_changes_nothing_after_every_try_in_order(self):
        a = mod("dA", 0, TOP, 3, 100.0, locked=True)
        s = self.page([a, mod("dB", 3, TOP, 5, 270.0), mod("dC", 0, 130.0, 3, 170.0)], ["dA", "dB", "dC"])
        self.Search.fill = False
        before = ([dict(m) for m in s.modules], s.rev, self.files())
        with self.assertRaises(ValueError) as e:
            s.alternative(1)
        self.assertEqual(str(e.exception), DEd.NO_FILL_AROUND)
        self.assertEqual((s.modules, s.rev, self.files()), before)
        self.assertEqual([r for r, _, _ in self.Search.made[0].runs], [
            [(3, 5, 30.0, 300.01), (0, 3, 130.0, 300.01)],          # the page's own (short) height, columns first
            [(0, 8, 130.0, 300.01), (3, 5, 30.0, 130.01)],          # … rows first
            [(3, 5, 30.0, 500.01), (0, 3, 130.0, 500.01)],          # the whole news area
            [(0, 8, 130.0, 500.01), (3, 5, 30.0, 130.01)]])

    def test_a_search_that_leaves_a_story_out_changes_nothing(self):
        a = mod("dA", 0, TOP, 3, 100.0, locked=True)                # two free regions, three stories to place
        s = self.page([a, mod("dB", 3, TOP, 5, 470.0), mod("dC", 0, 130.0, 3, 370.0), mod("dD", 3, 300.0, 2, 100.0)],
                      ["dA", "dB", "dC", "dD"])
        before = ([dict(m) for m in s.modules], s.rev, self.files())
        with self.assertRaises(ValueError) as e:
            s.alternative(1)
        self.assertIn("did not place every story", str(e.exception))
        self.assertEqual((s.modules, s.rev, self.files()), before)

    def test_a_lead_that_is_not_locked_changes_side_and_width(self):
        b = mod("dB", 0, TOP, 3, 100.0, locked=True)
        s = self.page([mod("dA", 3, TOP, 5, 470.0), b, mod("dC", 0, 130.0, 3, 370.0)], ["dA", "dB", "dC"])
        s.alternative(3)                                            # the lead was on the right: now left, not 5 wide
        g = self.Search.made[0]
        self.assertEqual((g.runs[0][1], g.runs[0][2]), ("left", {5}))
        self.assertEqual([(st.id, st.rank) for st in g.stories], [("dA", 0), ("dC", 2)])

    def test_a_page_with_every_story_locked_is_refused(self):
        s = self.page([mod("dA", 0, TOP, 3, 100.0, locked=True), mod("dB", 3, TOP, 5, 470.0, locked=True)], ["dA", "dB"])
        before = ([dict(m) for m in s.modules], s.rev, self.files())
        with self.assertRaises(ValueError) as e:
            s.alternative(1)
        self.assertEqual(str(e.exception), DEd.ALL_LOCKED)
        self.assertEqual((s.modules, s.rev, self.files(), self.Search.made), (*before, []))

    def test_only_the_stories_not_locked_count_towards_the_search_limit(self):
        keys = [f"d{i:010x}" for i in range(G.MAX_STORIES + 1)]
        mods = [mod(k, i % 8, TOP + 40.0 * (i // 8), 1, 40.0) for i, k in enumerate(keys)]
        s = self.page(mods, keys)
        with self.assertRaises(ValueError) as e:
            s.alternative(1)
        self.assertEqual(str(e.exception), f"this page has {G.MAX_STORIES + 1} stories; another layout needs "
                                           f"{G.MAX_STORIES} or fewer")
        s = self.page([{**mods[0], "locked": True}] + mods[1:], keys)
        self.Search.fill = False
        with self.assertRaises(ValueError) as e:
            s.alternative(1)
        self.assertEqual(str(e.exception), DEd.NO_FILL_AROUND)                   # searched: 11 not locked

    def test_without_locks_the_whole_page_is_searched_as_before(self):
        s = self.page([mod("dA", 0, TOP, 3, 100.0), mod("dB", 3, TOP, 5, 470.0)], ["dA", "dB"])
        s.tpl.regions = [(0, G.NCOL, TOP, 499.8)]                  # the template's own edges, off the grid or not
        g = self.Search(None, {"stories": [{"id": "dA"}, {"id": "dB"}]}, None, None, {"dA", "dB"}, None)
        s.generator = lambda: g
        self.Search.fill = False
        with self.assertRaises(ValueError) as e:
            s.alternative(2)
        self.assertEqual(str(e.exception), "no other layout fills this page exactly with these stories")
        self.assertEqual(g.runs, [([(0, G.NCOL, TOP, 499.8)], "right", {3})])     # the lead's width banned


# ------------------------------------------------------------------------------------------- a run's own pictures
class RunPicturesTest(unittest.TestCase):
    """A run keeps the photos and ads it used: a later change or removal in the edition never reaches it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ed, self.run = Path(self.tmp.name) / "ed", Path(self.tmp.name) / "ed" / "runs" / "r-1"
        for kind, keys in (("photos", ("p-0000000001", "p-0000000002")), ("ads", ("back-1",))):
            (self.ed / kind).mkdir(parents=True)
            for k in keys:
                (self.ed / kind / f"{k}.cmyk.gz").write_bytes(f"raster {k}".encode())
            DE.write_json(self.ed / kind / "index.json", {"elements": {k: {"width_px": 100, "height_px": 80} for k in keys}})
        self.run.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_run_keeps_what_it_used(self):
        DE.run_pictures(self.ed, self.run, [article(1, 200, photo={"id": "p-0000000001"})])
        self.assertEqual(sorted(DE.read_json(self.run / "photos" / "index.json")["elements"]), ["p-0000000001"])
        self.assertEqual(sorted(DE.read_json(self.run / "ads" / "index.json")["elements"]), ["back-1"])
        (self.ed / "photos" / "p-0000000001.cmyk.gz").unlink()                  # removed from the edition …
        tmp = self.ed / "ads" / "new.tmp"                                       # … and the ad replaced as the store does
        tmp.write_bytes(b"another ad")
        tmp.replace(self.ed / "ads" / "back-1.cmyk.gz")
        self.assertEqual((self.run / "photos" / "p-0000000001.cmyk.gz").read_bytes(), b"raster p-0000000001")
        self.assertEqual((self.run / "ads" / "back-1.cmyk.gz").read_bytes(), b"raster back-1")

    def test_a_new_photo_joins_the_run(self):
        DE.run_pictures(self.ed, self.run, [])
        self.assertTrue(DE.adopt_photo(self.ed, self.run, "p-0000000002"))
        self.assertEqual(sorted(DE.read_json(self.run / "photos" / "index.json")["elements"]), ["p-0000000002"])
        self.assertFalse(DE.adopt_photo(self.ed, self.run, "p-00000000ff"))    # not in the edition
        self.assertFalse(DE.adopt_photo(self.ed, self.run, "../escape"))


# ------------------------------------------------------------------------------------------- font instances on disk
FONTS = Path(__file__).resolve().parents[3] / "tools/oracle/v0/assets/fonts/latin"      # public OFL fonts


class FontInstanceCacheTest(unittest.TestCase):
    """The disk cache gives exactly the instancer's bytes, and a later registry reads them without instancing."""

    def setUp(self):
        self.real = deskfonts.F.FontRegistry._instance_bytes
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "instances"

    def tearDown(self):
        deskfonts.F.FontRegistry._instance_bytes = staticmethod(getattr(self.real, "__wrapped__", self.real))
        self.tmp.cleanup()

    @staticmethod
    def registry():
        r = deskfonts.F.FontRegistry()
        r.register_dir(FONTS)
        return r

    def test_same_bytes_and_read_back(self):
        plain = self.registry().resolve("Archivo", 650, "normal", {"wdth": 87.5})._instance_bytes
        deskfonts.install(self.dir)
        first = self.registry().resolve("Archivo", 650, "normal", {"wdth": 87.5})._instance_bytes
        self.assertEqual(first, plain)
        files = list(self.dir.glob("*.ttf"))
        self.assertEqual(len(files), 1)
        self.assertEqual(stat.S_IMODE(os.stat(files[0]).st_mode), 0o600)
        real_instancer = deskfonts.F.instantiateVariableFont

        def refuse(*_a, **_k):
            raise AssertionError("instanced again instead of read from the cache")
        deskfonts.F.instantiateVariableFont = refuse
        try:
            again = self.registry().resolve("Archivo", 650, "normal", {"wdth": 87.5})._instance_bytes
        finally:
            deskfonts.F.instantiateVariableFont = real_instancer
        self.assertEqual(again, plain)

    def test_other_axes_other_files(self):
        deskfonts.install(self.dir)
        a = self.registry().resolve("Archivo", 400, "normal", {"wdth": 100})._instance_bytes
        b = self.registry().resolve("Archivo", 400, "normal", {"wdth": 75})._instance_bytes
        self.assertNotEqual(a, b)
        self.assertEqual(len(list(self.dir.glob("*.ttf"))), 2)

    def test_installed_once(self):
        deskfonts.install(self.dir)
        wrapped = deskfonts.F.FontRegistry._instance_bytes
        deskfonts.install(Path(self.tmp.name) / "elsewhere")
        self.assertIs(deskfonts.F.FontRegistry._instance_bytes, wrapped)


if __name__ == "__main__":
    unittest.main()
