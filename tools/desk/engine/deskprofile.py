"""A paper's own house profile and script, put in place of the pilot's at run time.

gen1 (experiments/phase0/gen1) reads ONE house profile, the pilot's in the repository, when it is imported, and
compose_page.Context reads it too; both are frozen evidence. A dataset with its own house_profile.json (a paper
onboarded from its PDFs, tools/onboard) has its profile put in their place in every engine process, the main one
(desk_engine.config / setup) and each layout worker (deskfonts.worker_init), as deskfonts wraps the oracle. Without
one, the repository's values are put back exactly as gen1 imported them, so the pilot's pages never change.

This file is not part of the measurement cache's DESK_CODE (so the pilot's cache keys stay as they are): for a dataset
with its own profile or paper.json, the Context's inputs (in every cache key) carry those files' and this file's hashes.
"""
from __future__ import annotations

import hashlib
import json
import statistics
from pathlib import Path

import deskfolio as DF
import deskgen as DG
from deskcommon import SCRIPT_RANGE, DamagedFile, paper

G, CP = DG.G, DG.CP
CODE_HASH = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]


REPO_GLOBALS = {k: getattr(G, k) for k in ("PROFILE", "G", "COL_W", "GUT", "ORIGIN", "NCOL", "PITCH", "SP", "DEVA",
                                           "BODY_INK_TEST")}
# gen1's spacing keys and defaults (its SP, copied: the test checks the copy gives gen1's SP from the repo's profile)
SP_DEFAULTS = (("rule_to_headline", 11.0), ("headline_to_body", 6.9), ("headline_to_deck", 10.2), ("deck_to_body", 6.8),
               ("body_to_rule", 2.5), ("photo_to_body", 5.5), ("headline_to_photo", 4.0), ("deck_to_photo", 3.5),
               ("headline_to_byline", 6.3), ("byline_to_body", 4.6), ("kicker_to_headline", 11.1), ("rule_to_photo", 1.4),
               ("rule_to_body", 5.6))
LATN_INK_TEST = "ÅÉÎ Ôbdfhkl"   # a Latin body's tallest ink (accented capitals): higher than the Devanagari test's


def house_profile_file(ds: Path) -> Path | None:
    f = ds / "house_profile.json"
    return f if f.is_file() else None


def _checked(hp: Path) -> dict:
    """The house profile, its grid checked as paper() checks paper.json (DamagedFile otherwise)."""
    try:
        prof = json.loads(hp.read_text(encoding="utf-8"))
        g = prof["grid"]
        ok = (type(g["columns"]) is int and 1 <= g["columns"] <= 20
              and all(isinstance(g[k], (int, float)) and not isinstance(g[k], bool) and 0 <= g[k] <= 1000
                      for k in ("column_width_mm", "gutter_mm", "origin_mm"))
              and g["column_width_mm"] > 0 and isinstance(prof["spacing"], dict))
    except (UnicodeDecodeError, ValueError, TypeError, KeyError):
        ok = False
    if not ok:
        raise DamagedFile("the file house_profile.json of this dataset is not a house profile the engine reads")
    return prof


def use_dataset(ds: Path) -> None:
    """gen1's grid, spacing and profile from the dataset's own house_profile.json (the repository's when it has none),
    and its script test (deva(): styles counted on stories of the paper's script) from its paper.json."""
    for k, v in REPO_GLOBALS.items():
        setattr(G, k, v)
    hp = house_profile_file(ds)
    if hp is not None:
        prof = _checked(hp)
        g = prof["grid"]
        G.PROFILE, G.G = prof, g
        G.COL_W, G.GUT, G.ORIGIN, G.NCOL = g["column_width_mm"], g["gutter_mm"], g["origin_mm"], g["columns"]
        G.PITCH = G.COL_W + G.GUT
        G.SP = {k: G._sp(k, d) for k, d in SP_DEFAULTS}
    DF.ENGLISH = (paper(ds) or {}).get("script") == "latn"   # its running head's dates and numbers in English
    if DF.ENGLISH:
        G.DEVA, G.BODY_INK_TEST = SCRIPT_RANGE["latn"], LATN_INK_TEST


def _context_init(real):
    def init(self, ds, size_mode="story"):
        real(self, ds, size_mode)
        hp = house_profile_file(Path(ds))
        if hp is not None:                                # as Context reads the repository's profile, from the paper's
            cd = json.loads(hp.read_text(encoding="utf-8")).get("composer_defaults", {})
            sp = cd.get("spacing", {})
            self.xh_above = (sp.get("crosshead_space_above") or {}).get("body_leadings", 1.0)
            self.xh_below = (sp.get("crosshead_space_below") or {}).get("body_leadings", 1.0)
            self.indent_mm = cd.get("roles", {}).get("body", {}).get("first_line_indent_mm", 5.0)
            self.inputs["house_profile.json"] = CP._sha(hp)   # in the measurement cache's key: papers never share options
        if hp is not None or paper(Path(ds)) is not None:
            self.inputs["desk_profile"] = CODE_HASH
            self.inputs["paper.json"] = CP._sha(Path(ds) / "paper.json")
    init.desk_profile = True
    return init


def _latin_paper_ratio(real):
    def ratio(self) -> float:
        """Context._paper_ratio, on the stories of a Latin-script paper (the frozen one counts Devanagari stories)."""
        if (paper(Path(self.ds)) or {}).get("script") != "latn":
            return real(self)
        lo, hi = SCRIPT_RANGE["latn"]
        ratios = []
        for f in sorted((self.ds / "report" / "page1" / "pages").glob("*.json")):
            m = json.loads(f.read_text(encoding="utf-8"))
            if m["split"] != "cal":
                continue
            ww = CP.make_words_width(m, self.frames(m["sample"], m["page"]))
            by_frame = {e["frame_id"]: e for e in m["elements"] if e["kind"] == "body_frame"}
            for s in m["stories"]:
                paras = [b for b in s["flow"] if b["type"] == "para" and b["text"].strip()]
                letters = [ch for ch in paras[0]["text"] if ch.isalpha()] if paras else []
                if not letters or not s.get("body_size_pt") or sum(lo <= ch <= hi for ch in letters) < 0.5 * len(letters):
                    continue
                w = pp = 0.0
                for b in paras:
                    try:
                        q = CP.per_pt(b["text"], CP.SERIF, CP.BODY_AXES, 400)
                    except Exception:  # noqa: BLE001 — as the frozen one
                        continue
                    for ln in b["lines"]:
                        fid, k = ln["line_ref"].rsplit(":", 1)
                        e = by_frame.get(fid)
                        if e:
                            w += ww(e["lines"][int(k)])
                    pp += q
                if w > 0 and pp > 0:
                    ratios.append((w / pp) / (s["body_size_pt"] * (s.get("body_hscale") or 1.0)))
        if not ratios:
            raise SystemExit("no calibration story in the paper's script to size the stand-in type by")
        return round(statistics.median(ratios), 5)
    return ratio


def _keep_lettering(tpl, model: dict) -> None:
    """Live text of masthead size at the page's head, outside the news, is the masthead's lettering, though the page
    model may call it a story part (a kicker) and the frozen rule then drops it. Kept, as printed (another paper only:
    the pilot's masthead is artwork)."""
    by_id = {e["id"]: e for e in model["elements"]}
    for i in list(tpl.dropped):
        e = by_id.get(i)
        if (e and e["kind"] in DG.STORY_KINDS and (e.get("size_pt") or 0) >= CP.MASTHEAD_PT
                and e["bbox_mm"][3] < min(0.25 * model["page_h_mm"], tpl.news_top)):
            tpl.keep.append(e)
            tpl.dropped.remove(i)


def _template_init(real):
    def init(self, ds, name, role):
        """Template, and for another paper (paper.json): when the news is taken down to the page's foot (no ad block
        in it), it stops 3 mm above the first thing printed below its lowest story: a foot rule, a narrow imprint line,
        or a band of ads each narrower than half the page (the frozen rule looks only at items wider than that)."""
        real(self, ds, name, role)
        if paper(Path(ds)) is None:
            return
        model = json.loads((Path(ds) / "report" / "page1" / "pages" / f"{name}.json").read_text(encoding="utf-8"))
        _keep_lettering(self, model)
        if self.ad_block is not None:
            return
        hole, _ = G.newshole(model)
        low, x0, x1 = hole[1], G.ORIGIN, G.ORIGIN + G.span_mm(G.NCOL)
        tops = [b[1] for b in (e["bbox_mm"] for e in self.keep) if low - 0.5 < b[1] < self.news_bottom + 3.0 and min(b[2], x1) > max(b[0], x0)]
        bottom = max(low, min(tops, default=self.news_bottom + 3.0) - 3.0)
        if bottom < self.news_bottom:
            self.news_bottom = bottom
            self.regions = G.regions_for(self.news_top, bottom, None)
    init.desk_profile = True
    return init


if not getattr(CP.Context.__init__, "desk_profile", False):
    CP.Context.__init__ = _context_init(CP.Context.__init__)
    CP.Context._paper_ratio = _latin_paper_ratio(CP.Context._paper_ratio)
    DG.Template.__init__ = _template_init(DG.Template.__init__)
