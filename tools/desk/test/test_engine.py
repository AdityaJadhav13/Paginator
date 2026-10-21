"""Desk engine tests that need no private data (fictional text only). Run from the repository root:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python -m unittest tools/desk/test/test_engine.py -v
"""
from __future__ import annotations

import os
import stat
import sys
import tempfile
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
