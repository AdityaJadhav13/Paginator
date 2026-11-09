"""Story treatments (layout/panels.py), the weekly story parts (deskarticles) and the page editor's treatment choice
(deskedit). Fictional text only. Run from the repository root:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python -m unittest tools/desk/test/test_panels.py -v
"""
from __future__ import annotations

import hashlib
import json
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_engine import DA, DE, DEd, TOP, LockCase, mod  # noqa: E402  (the engine on the path, and its page-session case)

import panels  # noqa: E402
import settings as LS  # noqa: E402

WHITE, K100, K10, RED, Y100 = (0, 0, 0, 0), (0, 0, 0, 1), (0, 0, 0, 0.1), (0.15, 1, 1, 0), (0, 0, 1, 0)
PANELS = {"strap": {"cmyk": Y100, "height_mm": 7.0}, "tint": {"cmyk": K10, "height_mm": 14.5},
          "reverse": {"cmyk": K100, "text_cmyk": WHITE}, "reverse_red": {"cmyk": RED, "text_cmyk": WHITE, "height_mm": 6.3},
          "box": {"stroke_pt": 0.5, "stroke_cmyk": K100, "pad_mm": 2.0, "extra": 1}}


class Weekly(unittest.TestCase):
    def tearDown(self):
        LS.use(None)                                    # the defaults: the pilot's output

    def weekly(self, **over):
        LS.use({"panels": PANELS, **over})


def story(key, page, rank, words=400, photo=True, kicker=False, brief=False, **kw):
    return {"key": key, "page": page, "priority": 2, "rank": rank, "words": words, "has_photo": photo,
            "has_kicker": kicker, "brief": brief, **kw}


PAGE = [story("s1", 3, 0, kicker=True), story("s2", 3, 1), story("s3", 3, 2, words=120), story("s4", 3, 3, photo=False),
        story("s5", 3, 4, photo=False), story("s6", None, 0, kicker=True), story("s7", 3, 5, words=30, brief=True)]


class ContrastTest(unittest.TestCase):
    def test_white_on_black_and_red_pass_white_on_grey_fails(self):
        self.assertTrue(panels.contrast_ok(WHITE, K100))
        self.assertTrue(panels.contrast_ok(WHITE, RED))
        self.assertFalse(panels.contrast_ok(WHITE, K10))
        self.assertTrue(panels.contrast_ok(K100, Y100))
        self.assertTrue(panels.contrast_ok(K100, K10))
        self.assertFalse(panels.contrast_ok(K100, K100))


class SpecTest(Weekly):
    def test_nothing_at_the_defaults(self):
        self.assertTrue(all(panels.spec(t) is None for t in panels.TREATMENTS))
        self.assertEqual(panels.available(), [])

    def test_specs_keep_their_keys_and_unreadable_text_has_none(self):
        self.weekly()
        self.assertEqual(panels.spec("box"), {"stroke_pt": 0.5, "stroke_cmyk": K100, "pad_mm": 2.0})
        self.assertIsNone(panels.spec("none"))
        self.assertEqual(panels.available(), ["none", "strap", "tint", "reverse", "reverse_red", "box"])
        self.weekly(panels={**PANELS, "tint": {"cmyk": K10, "text_cmyk": WHITE}})     # white on 10 % grey: refused
        self.assertIsNone(panels.spec("tint"))
        self.assertNotIn("tint", panels.available())


class AssignTest(Weekly):
    def test_nothing_at_the_defaults_even_for_a_choice(self):
        self.assertEqual(set(panels.assign(PAGE, {"s2": "box"}).values()), {"none"})

    def test_the_rule(self):
        self.weekly()
        self.assertEqual(panels.assign(PAGE), {"s1": "strap", "s2": "tint", "s3": "box", "s4": "reverse", "s5": "none",
                                               "s6": "none", "s7": "none"})

    def test_deterministic_whatever_the_input_order(self):
        self.weekly()
        self.assertEqual(panels.assign(PAGE), panels.assign(list(reversed(PAGE))))

    def test_strap_only_for_a_page_lead_with_a_kicker(self):
        self.weekly()
        no_kicker = [{**s, "has_kicker": False} if s["key"] == "s1" else s for s in PAGE]
        self.assertEqual(panels.assign(no_kicker)["s1"], "none")
        kicker_second = [{**s, "has_kicker": True} if s["key"] == "s2" else s for s in no_kicker]
        self.assertNotIn("strap", panels.assign(kicker_second).values())

    def test_a_short_second_story_is_boxed_and_at_most_one_box_and_one_reverse_per_page(self):
        self.weekly()
        many = [story(f"t{i}", 5, i, words=100, photo=False, kicker=True) for i in range(8)]
        out = panels.assign(many)
        self.assertEqual(out["t0"], "strap")
        self.assertEqual(out["t1"], "box")
        self.assertEqual(sum(t == "box" for t in out.values()), 1)
        self.assertEqual(sum(t.startswith("reverse") for t in out.values()), 1)
        self.assertNotIn("tint", out.values())                # only the second story gets the tint

    def test_a_choice_wins_and_counts_toward_the_limits(self):
        self.weekly()
        out = panels.assign(PAGE, {"s5": "reverse_red", "s1": "none"})
        self.assertEqual((out["s1"], out["s5"], out["s4"]), ("none", "reverse_red", "none"))   # no second reverse head
        out = panels.assign([{**s, "treatment": "box"} if s["key"] == "s2" else s for s in PAGE])   # the story's own
        self.assertEqual((out["s2"], out["s3"]), ("box", "none"))
        self.assertEqual(panels.assign(PAGE, {"s2": "nonsense"})["s2"], "tint")     # not a treatment: the rule's

    def test_only_treatments_the_paper_has(self):
        self.weekly(panels={"reverse_red": PANELS["reverse_red"]})
        self.assertEqual(set(panels.assign(PAGE).values()), {"none", "reverse_red"})


ARTS = [
    {"id": "a-0000000001", "headline": "काल्पनिक मुख्य बातमी", "kicker": "काल्पनिक किकर", "deck": "काल्पनिक उपशीर्षक",
     "byline": "प्रतिनिधी", "priority": 1, "page": 2, "body": "पुणे : पहिला परिच्छेद येथे आहे.\n\n## उपशीर्षक\n\nदुसरा परिच्छेद.",
     "photo": {"id": "p-0000000001", "caption": "काल्पनिक छायाचित्र",
               "credit": "A. Writer / Wikimedia Commons / Creative Commons Attribution-ShareAlike 4.0 International"}},
    {"id": "a-0000000002", "headline": "दुसरी काल्पनिक बातमी", "kicker": "दुसरा किकर", "deck": "", "byline": "वार्ताहर",
     "priority": 2, "page": 2, "body": "सकाळी 10:30 वाजता काही घडले. " * 60},
    {"id": "a-0000000003", "headline": "छोटी बातमी", "kicker": "", "deck": "", "byline": "", "priority": 3, "page": None,
     "body": "नाशिक: छोटा मजकूर."},
]


def records(arts):
    return json.dumps([DA.to_story(a, 999.0 - n, {"p-0000000001"}) for n, a in enumerate(arts)]
                      + [DA.briefs_story(arts[2:], "1")], ensure_ascii=False, sort_keys=True)


# sha-256 of records(ARTS) as deskarticles made them before treatments (computed with that code, 2026-11-09)
DEFAULT_RECORDS_SHA = "d5072650de126cef8d3a81fc19cbeb50d417c99c26d07f11679806b391c4d9f7"


class ArticlesTest(Weekly):
    def test_defaults_are_the_records_as_before(self):
        self.assertEqual(hashlib.sha256(records(ARTS).encode()).hexdigest(), DEFAULT_RECORDS_SHA)
        self.assertEqual(records([{**a, "treatment": "strap"} for a in ARTS]), records(ARTS))   # no treatments here
        self.assertEqual(set(DA.assign_treatments(ARTS).values()), {"none"})

    def test_weekly_records(self):
        self.weekly(byline_mode="none", kicker_mode="lead", caption_mode="small", dateline_bold=True)
        tr = DA.assign_treatments(ARTS)
        self.assertEqual(tr, {"a-0000000001": "strap", "a-0000000002": "tint", "a-0000000003": "none"})
        (s1, e1), (s2, e2) = (DA.to_story({**a, "treatment": tr[a["id"]]}, 999.0, {"p-0000000001"}) for a in ARTS[:2])
        kinds1, kinds2 = {e["kind"]: e for e in e1}, {e["kind"]: e for e in e2}
        self.assertEqual((s1["treatment"], s2["treatment"]), ("strap", "tint"))
        self.assertIn("kicker", kinds1)                                      # the strap holds the lead's kicker
        self.assertNotIn("kicker", kinds2)
        self.assertIsNone(s2["kicker"])
        self.assertNotIn("byline", kinds1)
        self.assertIsNone(s1["byline"])
        self.assertEqual(kinds1["caption"]["text"], "काल्पनिक छायाचित्र (छाया: A. Writer / Wikimedia Commons / CC BY-SA 4.0)")
        self.assertTrue(kinds1["caption"]["small"])
        self.assertEqual(s1["flow"][0]["run_in_bold"], len("पुणे : "))
        self.assertNotIn("run_in_bold", s1["flow"][2])                      # the first paragraph only
        self.assertNotIn("run_in_bold", s2["flow"][0])                      # a time is not a dateline
        briefs, _ = DA.briefs_story(ARTS[2:], "1")
        self.assertEqual(briefs["flow"][1]["run_in_bold"], len("नाशिक: "))

    def test_end_signature(self):
        self.weekly(byline_mode="end")
        _, els = DA.to_story(ARTS[0], 999.0, set())
        self.assertEqual([e.get("end_signature") for e in els if e["kind"] == "byline"], [True])

    def test_short_credit_never_drops_the_attribution(self):
        self.assertEqual(DA.short_credit("Photo: B. Name, CC BY 4.0"), "Photo: B. Name, CC BY 4.0")
        self.assertEqual(DA.short_credit("X / Creative Commons Attribution-NonCommercial-NoDerivs 3.0 Unported License"),
                         "X / CC BY-NC-ND 3.0")
        self.assertEqual(DA.short_credit("Y, Creative Commons Attribution 2.0 Generic"), "Y, CC BY 2.0")

    def test_run_in(self):
        self.assertEqual(DA.run_in("मुंबई, दि. ८ (प्रतिनिधी) : बातमी"), len("मुंबई, दि. ८ (प्रतिनिधी) : "))
        self.assertEqual(DA.run_in("कोणताही विरामचिन्ह नसलेला मोठा परिच्छेद जो चाळीस अक्षरांनंतर : येतो"), 0)


class EditorTreatmentTest(LockCase, Weekly):
    """The page editor's treatment: a module attribute, checked, moved with its story, undone, and set again by the
    engine (the story's article carries the choice)."""

    A, B = mod("dA", 0, TOP, 3, 120.5), mod("dB", 3, TOP, 5, 120.5)

    def tearDown(self):
        LockCase.tearDown(self)
        Weekly.tearDown(self)

    def session(self, modules, keys=None):
        s = super().session(modules, keys)
        keys = self.KEYS if keys is None else keys
        s.frozen = {k: {"articles": s.built.article_of[k], "brief": k.startswith("dbriefs"), "order": i, "pin": None}
                    for i, k in enumerate(keys)}
        s.articles = [{"id": a} for k in keys for a in s.built.article_of[k]]
        s.edition, s.assets, s._link_photos, s._measurers = {}, None, lambda: None, {}
        s.calls = []

        def built(edition, arts, d, frozen=None):
            s.calls.append(arts)
            b = self.built(keys)
            tr = {a["id"]: a["treatment"] for a in arts if "treatment" in a}
            for k in keys:
                t = tr.get(b.article_of[k][0])
                if t:
                    b.story_of[k] = {**b.story_of[k], "treatment": t}
            return b
        s.engine.built = built
        return s

    def test_a_paper_without_treatments_refuses_every_choice(self):
        s = self.session([self.A, self.B])
        for bad in ("none", "box"):
            with self.subTest(bad=bad):
                self.refused(s, [{**self.A, "treatment": bad}, self.B], DEd.TREATMENT_BAD)
        s.apply([{**self.A, "treatment": None}, self.B])                   # null: the house rule's (nothing stored)
        self.assertEqual(s.modules, [self.A, self.B])
        self.assertEqual(s.calls, [])

    def test_a_choice_is_kept_set_again_and_undone(self):
        self.weekly()
        s = self.session([self.A, self.B])
        for bad in ("Box", 3, ["box"], {}):
            with self.subTest(bad=bad):
                self.refused(s, [{**self.A, "treatment": bad}, self.B], DEd.TREATMENT_BAD)
        s.apply([{**self.A, "treatment": "box"}, self.B])
        self.assertEqual(s.modules, [{**self.A, "treatment": "box"}, self.B])
        self.assertEqual(DE.read_json(s.edit_path)["modules"], s.modules)
        self.assertEqual(s.built.story_of["dA"]["treatment"], "box")       # set again with the choice
        self.assertEqual([a for a in s.calls[-1] if "treatment" in a], [{"id": "a-0000000001", "treatment": "box"}])
        s.apply([self.A, self.B])                                          # undo: the house rule's again
        self.assertEqual(s.modules, [self.A, self.B])
        self.assertNotIn("treatment", s.built.story_of["dA"])
        n = len(s.calls)
        s.apply([{**self.A, "y": 200.0}, self.B])                          # a move alone builds nothing again
        self.assertEqual(len(s.calls), n)

    def test_a_choice_moves_with_its_story_and_a_column_of_short_items_has_none(self):
        self.weekly()
        a, b = {**self.A, "treatment": "tint"}, mod("dbriefs1", 3, TOP, 5, 120.5)
        s = self.session([a, b])
        s.apply([{**a, "x": b["x"], "w": 5}, {**b, "x": a["x"], "w": 3, "treatment": "box"}])
        self.assertEqual(s.modules, [{**mod("dA", 3, TOP, 5, 120.5), "treatment": "tint"}, mod("dbriefs1", 0, TOP, 3, 120.5)])

    def test_a_change_that_cannot_be_set_rebuilds_the_page_as_it_was(self):
        self.weekly()
        s = self.session([self.A, self.B])
        s.draw = lambda: (_ for _ in ()).throw(RuntimeError("cannot set"))
        with self.assertRaises(RuntimeError):
            s.apply([{**self.A, "treatment": "reverse"}, self.B])
        self.assertEqual((s.modules, s.rev), ([self.A, self.B], 3))
        self.assertNotIn("treatment", s.built.story_of["dA"])

    def test_state_offers_the_choices_only_on_a_paper_with_treatments(self):
        s = types.SimpleNamespace(placed=lambda: ([], []), where=lambda: {}, page=1, role="r", rev=0, modules=[],
                                  problems=lambda n, t: [], pool=lambda e: [], grid=lambda: {})
        self.assertNotIn("treatments", DEd.PageSession.state(s))
        self.weekly()
        self.assertEqual(DEd.PageSession.state(s)["treatments"], panels.available())
