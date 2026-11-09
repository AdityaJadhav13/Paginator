"""The Desk's bridge to the page generator (layout/: the Desk's copy of the frozen experiments/phase0/gen1).

- Calibration: the house's body styles, span frequencies, lead side and word space, counted on the CALIBRATION
  editions exactly as gen1 counts them.
- Templates: a printed page of the paper with its own stories taken out (gen1's fixed_parts): the running head,
  masthead, folio, imprint and ad spaces stay; the news hole is filled with the Desk's articles.
- Measuring: every way to set a story at every width (gen1's module options), computed once per story and rank
  class, so the planner can check that a page's stories fill it exactly before the (slow) layout search runs.
- Layout: gen1's search and render on a template page with the Desk's stories, the retries gen1 makes (overset after
  render, ink touches), then the running head rewritten for the edition (date, page number) and a PDF/X-1a page.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import math
import os
import sys
from contextlib import contextmanager
from datetime import date
from pathlib import Path

from deskcommon import ENGINE_VERSION, EXPERIMENTS

# the Desk's copy of the page generator (layout/); the frozen gen1 only for the parity test (PGN_DESK_FROZEN_GEN1=1)
LAYOUT = EXPERIMENTS / "gen1" if os.environ.get("PGN_DESK_FROZEN_GEN1") == "1" else Path(__file__).resolve().parent / "layout"
sys.path.insert(0, str(LAYOUT))
import generate as G  # noqa: E402

import deskfolio as DF  # noqa: E402

CP, X, MP, MM = G.CP, G.CP.X, G.CP.MP, G.CP.MM
RANK_CLASSES = (0, 1, 3)         # gen1 options differ for the lead (0), the next two (1–2) and the rest (3+)
BRIEF_WIDTHS = (1, 2)            # an "in brief" column is one or two grid columns wide (house practice)


def rank_class(rank: int) -> int:
    return 0 if rank == 0 else 1 if rank <= 2 else 3


# ------------------------------------------------------------------------------------------- grids
GRID_KEYS = ("NCOL", "COL_W", "GUT", "ORIGIN")


def grid_now() -> tuple:
    """gen1's grid in force: (columns, column width mm, gutter mm, origin mm)."""
    return tuple(getattr(G, k) for k in GRID_KEYS)


MAIN_GRID = grid_now()           # the paper's own grid (deskprofile.use_dataset sets it with the dataset's)


def _set_grid(grid: tuple) -> None:
    for k, v in zip(GRID_KEYS, grid, strict=True):
        setattr(G, k, v)
    G.PITCH = G.COL_W + G.GUT


def grid_record() -> dict:
    """A refined paper's page manifest records the grid it was laid out on; the pilot's manifest stays as it was."""
    if not getattr(G, "ST", {}).get("refined"):
        return {}
    return {"grid": dict(zip(("columns", "column_width_mm", "gutter_mm", "origin_mm"), grid_now(), strict=True))}


@contextmanager
def on_grid(grid):
    """gen1's grid (its module globals; PITCH follows) set to grid for the block, then put back. gen1 reads them at every
    call, so a page of a paper's other grid (layout.grid_alternates, deskprofile.page_grid) is measured, planned, laid out
    and edited on it. None, or the grid in force: nothing changes (the pilot's one grid)."""
    old = grid_now()
    if grid is None or tuple(grid) == old:
        yield
        return
    _set_grid(tuple(grid))
    try:
        yield
    finally:
        _set_grid(old)


# ------------------------------------------------------------------------------------------- calibration
class Calibration:
    """The paper's design language, counted on the calibration editions (as gen1.main does)."""

    def __init__(self, ds: Path):
        pages_dir = ds / "report" / "page1" / "pages"
        cal = []
        for f in sorted(pages_dir.glob("*.json")):
            m = json.loads(f.read_text(encoding="utf-8"))
            if m.get("split") == "cal":
                cal.append(m)
        if not cal:
            raise SystemExit(f"no calibration page models in {pages_dir}")
        prior, _ = G.span_prior_from(cal)
        self.span_tab = {b: {w: prior(r, w) for w in range(1, G.NCOL + 1)} for b, r in ((0, 0), (1, 1), (2, 3))}
        self.lead_side = G.lead_side_from(cal)
        self.styles = G.styles_from(cal)
        self.styles_ext = G.styles_from(cal, G.RARE_STYLE_MIN)
        self.space_em = G.space_em_from(cal)

    def span_prior(self, r: int, w: int) -> float:
        return self.span_tab[0 if r == 0 else 1 if r <= 2 else 2][w]


# ------------------------------------------------------------------------------------------- templates
def in_regions_fn(rboxes):
    def in_regions(bb):
        a = max(1e-9, (bb[2] - bb[0]) * (bb[3] - bb[1]))
        return sum(max(0.0, min(bb[2], x1) - max(bb[0], x0)) * max(0.0, min(bb[3], b) - max(bb[1], t)) for x0, t, x1, b in rboxes) >= 0.5 * a
    return in_regions


STORY_KINDS = ("headline", "deck", "kicker", "byline", "caption", "crosshead", "jump_line", "body_frame")
FURNITURE_KINDS = ("folio", "furniture", "other_text")


def standing_key(text: str) -> str:
    """Furniture text with its date and numbers taken out: equal on every day the paper prints it."""
    t = DF.re.sub(DF._WEEKDAY, "W", " ".join(text.split()))
    t = DF.re.sub(DF._MONTH, "M", t)
    return DF.re.sub(DF._NUM, "#", t)


def standing_texts(ds: Path, page: int, exclude_sample: str) -> set:
    """Furniture texts (date-free) the paper prints on this page number in its other editions."""
    out = set()
    for f in sorted((ds / "report" / "page1" / "pages").glob(f"*__p{page}.json")):
        m = json.loads(f.read_text(encoding="utf-8"))
        if m.get("sample") == exclude_sample:
            continue
        out |= {standing_key(e.get("text", "")) for e in m["elements"] if e["kind"] in FURNITURE_KINDS and (e.get("text") or "").strip()}
    return out


class Template:
    """A printed page without its stories (gen1.main's newshole preparation, then gen1.fixed_parts), and without the
    printed day's own content: what stays is what the paper prints every day there (running head, masthead, folio,
    imprint, rules and panels) and the ad spaces, emptied."""

    def __init__(self, ds: Path, name: str, role: str):
        self.name, self.role, self.grid = name, role, grid_now()
        f = ds / "report" / "page1" / "pages" / f"{name}.json"
        m_orig = json.loads(f.read_text(encoding="utf-8"))
        hole, why = G.newshole(m_orig)
        if hole is None:
            raise ValueError(f"template {role}: {why}")
        news_top, news_bottom, ad_block = hole
        x_hi = G.ORIGIN + G.span_mm(G.NCOL)
        self.photo_dir = ds / "report" / "page1" / "photos" / name
        idx = self.photo_dir / "index.json"
        self.photo_index = json.loads(idx.read_text())["elements"] if idx.exists() else {}
        photo_ids = set(self.photo_index)
        for _ in range(4):                                # as gen1.main: move the news hole's edges clear of small items
            hole_box = (G.ORIGIN, news_top, x_hi, news_bottom)
            m0 = G.fold_pull_quotes(G.merge_boxed(m_orig, hole_box))
            m = G.attach_loose(m0, G.loose_stories(m0, hole_box, photo_ids, ad_block), hole_box)
            regions = G.regions_for(news_top, news_bottom, ad_block)
            rboxes = [G.region_box(r) for r in regions]
            in_regions = in_regions_fn(rboxes)
            ids = {s["id"] for s in m["stories"] if s.get("bbox_mm") and in_regions(s["bbox_mm"])}
            kept_stories, keep, intruders, decor = G.fixed_parts(m, ids, rboxes)
            boxes = {e["id"]: e["bbox_mm"] for e in m["elements"]} | {s_["id"]: s_["bbox_mm"] for s_ in m["stories"] if s_.get("bbox_mm")}
            top_i = [boxes[i] for i in intruders if (boxes[i][1] <= news_top + 2 or boxes[i][3] <= news_top + G.EDGE_TOP_MM)
                     and boxes[i][3] - boxes[i][1] < G.EDGE_MM]
            bot_i = [boxes[i] for i in intruders if boxes[i][3] >= news_bottom - 2 and boxes[i][3] - boxes[i][1] < G.EDGE_MM]
            if not intruders or not (top_i or bot_i):
                break
            if top_i:
                news_top = max(b[3] for b in top_i) + 2.0
            if bot_i:
                news_bottom = min(b[1] for b in bot_i) - 3.0
        # the printed day's own content never stays: stories outside the news hole (an ear, a box) and anything still
        # reaching into it are dropped with everything they own
        drop = set(intruders)
        for s in kept_stories:
            drop |= G.owned_ids(s) | {s["id"]}
        ads = [e["bbox_mm"] for e in keep if e["kind"] == "ad"]

        def inside(bb, o, m=1.0):
            return o[0] - m <= bb[0] and bb[2] <= o[2] + m and o[1] - m <= bb[1] and bb[3] <= o[3] + m
        mh = CP.masthead_box({**m, "elements": keep})
        mh_ids = set(mh[1]) if mh else set()
        standing = standing_texts(ds, m["page"], m.get("sample", ""))
        for e in keep:
            bb, kind = e["bbox_mm"], e["kind"]
            if kind != "ad" and any(inside(bb, a) for a in ads):
                drop.add(e["id"])                         # the printed ad's own artwork, text and frames
            elif kind in STORY_KINDS:
                drop.add(e["id"])                         # a story part outside every story (a label, a teaser): that day's
            elif kind in FURNITURE_KINDS and e["id"] not in mh_ids and (e.get("text") or "").strip():
                t = e.get("text", "")
                dated = DF.re.search(DF._WEEKDAY, t) is not None or DF.has_month(t) or DF.is_number_only(t)
                if not dated and standing_key(t) not in standing and (e.get("size_pt") or 0) < CP.MASTHEAD_PT:
                    drop.add(e["id"])                     # text the paper does not print every day there
        dropped_text = [k["bbox_mm"] for k in keep if k["id"] in drop and k["kind"] in STORY_KINDS + FURNITURE_KINDS]

        def centre_in(d, bb):
            return bb[0] <= (d[0] + d[2]) / 2 <= bb[2] and bb[1] <= (d[1] + d[3]) / 2 <= bb[3]
        for e in keep:                                    # a label tab's panel goes with its label
            bb = e["bbox_mm"]
            if e["kind"] == "box" and (bb[2] - bb[0]) < 80 and (bb[3] - bb[1]) < 20 and any(centre_in(d, bb) for d in dropped_text):
                drop.add(e["id"])
        self.keep = [e for e in keep if e["id"] not in drop]
        self.dropped = sorted(drop & {e["id"] for e in keep})
        self.kept_stories_dropped = len(kept_stories)
        self.intruders = len(intruders)
        self.model = {k: v for k, v in m.items() if k not in ("elements", "stories")}
        self.page_w, self.page_h = m["page_w_mm"], m["page_h_mm"]
        if ad_block is None:                              # the day's strip above the imprint is gone: the news goes down to it
            below = [e["bbox_mm"][1] for e in self.keep if e["kind"] != "rule" and e["bbox_mm"][1] >= news_bottom - 1
                     and min(e["bbox_mm"][2], x_hi) - max(e["bbox_mm"][0], G.ORIGIN) > 0.5 * (x_hi - G.ORIGIN)]
            floor = min(below, default=self.page_h - 12.0) - 3.0
            if floor > news_bottom + 4.0:
                news_bottom = floor
        self.news_top, self.news_bottom, self.ad_block = news_top, news_bottom, ad_block
        self.regions = G.regions_for(news_top, news_bottom, ad_block)
        ads = sorted((e for e in self.keep if e["kind"] == "ad"), key=lambda e: (round(e["bbox_mm"][0]), round(e["bbox_mm"][1])))
        self.ad_slots = [{"slot": f"{role.split('_')[0]}-{k + 1}", "element": e["id"], "bbox_mm": list(e["bbox_mm"]),
                          "w_mm": round(e["bbox_mm"][2] - e["bbox_mm"][0], 1), "h_mm": round(e["bbox_mm"][3] - e["bbox_mm"][1], 1)}
                         for k, e in enumerate(ads)]

    def news_mm2(self) -> float:
        with on_grid(self.grid):
            return sum(G.span_mm(w) * (b - t) for _, w, t, b in self.regions)

    def summary(self) -> dict:
        return {"role": self.role, "news_top_mm": round(self.news_top, 1), "news_bottom_mm": round(self.news_bottom, 1),
                "regions": len(self.regions), "ad_slots": len(self.ad_slots), "kept_elements": len(self.keep),
                "dropped": len(self.dropped), "intruders": self.intruders, "kept_stories_dropped": self.kept_stories_dropped}


# ------------------------------------------------------------------------------------------- running head
def folio_plan(tpl: Template, page: int, pages: int, day: date, edition: dict) -> tuple[list, list]:
    """→ (elements kept as printed, [(element, new line texts)] to set again). Only folio and furniture text whose
    words change (date, page number, number of pages, volume, issue, price) is set again."""
    keep, redo = [], []
    texts = [e for e in tpl.keep if e["kind"] in FURNITURE_KINDS and e.get("lines")]
    month_boxes = [e["bbox_mm"] for e in texts if DF.has_month(e.get("text", ""))]
    for e in tpl.keep:
        if e not in texts:
            keep.append(e)
            continue
        new = []
        for ln in e["lines"]:
            t = " ".join(ln.get("text", "").split())
            nt = DF.rewrite(t, day, page, pages, edition.get("volume", ""), edition.get("issue", ""), edition.get("price", ""))
            if DF.is_number_only(t) and (e.get("size_pt") or 0) >= 20 and e["bbox_mm"][1] < 0.12 * tpl.page_h:
                bb = e["bbox_mm"]
                near_month = any(abs(mb[1] - bb[3]) < 15 and min(mb[2], bb[2]) - max(mb[0], bb[0]) > -5 for mb in month_boxes)
                if tpl.role == "front" and near_month:
                    nt = DF.digits_like(t, day.day)              # the date box's day number
                elif tpl.role != "front":
                    nt = DF.digits_like(t, page)                 # the running head's page number
            new.append(nt)
        if new != [" ".join(ln.get("text", "").split()) for ln in e["lines"]]:
            redo.append((e, new))
        else:
            keep.append(e)
    return keep, redo


def draw_folios(B, tpl: Template, cx, redo, rep) -> list:
    """The changed running-head lines, at the printed baseline and size (the size print's glyph widths give the
    printed text, as compose_page.set_lines sizes it), aligned to the side of the page they stand on."""
    if not redo:
        return []
    frames = cx.frames(tpl.model["sample"], tpl.model["page"])
    words_width = CP.make_words_width({**tpl.model, "elements": tpl.keep}, frames)
    done = []
    for e, new in redo:
        family, axes, wt = CP.role_font(e.get("font") or "", e["kind"])
        cmyk = CP._colour(e, rep)
        fkey = B.font(family, axes, wt)
        for ln, nt in zip(e["lines"], new, strict=True):
            old = CP.fix_bullet(" ".join(ln.get("text", "").split()))
            if not nt.strip():
                continue
            w_tok = words_width(ln)
            if w_tok > 0 and old:
                size = w_tok / CP.per_pt(old, family, axes, wt)
            else:
                w1 = CP.per_pt(old or nt, family, axes, wt, spaces=True) / MM
                size = (ln["x1_mm"] - ln["x0_mm"]) / w1 if w1 > 0 else e["size_pt"]
            size = max(0.6 * e["size_pt"], min(1.3 * e["size_pt"], size))
            # room on the line: up to the next kept item beside it (a page number, a logo), else the page margins
            band = (ln["baseline_mm"] - 0.8 * size / MM, ln["baseline_mm"] + 0.3 * size / MM)
            beside = [o["bbox_mm"] for o in tpl.keep if o is not e and o["kind"] not in ("rule", "box")
                      and min(o["bbox_mm"][3], band[1]) - max(o["bbox_mm"][1], band[0]) > 0.5]
            right = min([b[0] - 2.0 for b in beside if b[0] >= ln["x0_mm"] + 1.0] + [tpl.page_w - 12.0])
            left = max([b[2] + 2.0 for b in beside if b[2] <= ln["x1_mm"] - 1.0] + [12.0])
            width = CP.per_pt(nt, family, axes, wt, spaces=True) / MM * size
            if width > right - left:                      # never into a neighbour: a little smaller instead
                size = max(0.6 * e["size_pt"], size * (right - left) / width)
                width = CP.per_pt(nt, family, axes, wt, spaces=True) / MM * size
            mid = (ln["x0_mm"] + ln["x1_mm"]) / 2
            if mid > 0.6 * tpl.page_w and ln["x1_mm"] <= right + 0.5:
                x, align = min(ln["x1_mm"], right), "right"      # on the right edge, nothing beside it: keeps that edge
            elif mid > 0.4 * tpl.page_w and mid < 0.6 * tpl.page_w:
                x, align = mid, "center"
            else:
                x, align = max(left, min(ln["x0_mm"], right - width)), "left"
            B.text_line(nt, fkey, round(size, 3), x, ln["baseline_mm"], cmyk, align,
                        meta={"page": tpl.model["page"], "role": e["kind"], "element": e["id"], "desk": "folio"})
        done.append(e["id"])
    return done


# ------------------------------------------------------------------------------------------- generator
class DeskGenerator(G.Generator):
    """gen1's generator, with module options measured beforehand (once per story and rank class) when they are still
    valid; a story with extra rows or banned options after a render is measured again, as gen1 would."""

    def __init__(self, cx, model, photo_dir, styles, ids, space_em, precomputed=None):
        super().__init__(cx, model, photo_dir, styles, ids, space_em)
        self.precomputed = precomputed or {}

    def _options(self, s, w):
        if s.src.get("desk_briefs") and w not in BRIEF_WIDTHS:
            return []
        dirty = any(k[0] == s.id for k in self.banned) or any(k[0] == s.id for k in self.extra_rows)
        key = f"{s.id}|{w}|{rank_class(s.rank)}"
        if not dirty and not self.ext_styles and key in self.precomputed:
            return self.precomputed[key]
        return super()._options(s, w)


def measure_model(stories: list, elements: list) -> dict:
    return {"page": 0, "page_w_mm": 347.0, "page_h_mm": 540.0, "sample": "", "elements": elements, "stories": stories, "unassigned": []}


def measure(cx, cal: Calibration, stories: list, elements: list, photo_dir: Path) -> dict:
    """Every module option of every story at every width, for each rank class. → {"<story>|<w>|<class>": [option]}.
    A story whose display text cannot be set at a width simply has no options there."""
    ids = {s["id"] for s in stories}
    g = G.Generator(cx, measure_model(stories, elements), photo_dir, cal.styles, ids, cal.space_em)
    out = {}
    for s in g.stories:
        for cls in RANK_CLASSES:
            if cls == 1:
                g._disp = {k: v for k, v in g._disp.items() if k[0] != s.id}   # the lead's headline grows; the others' do not
            s.rank = cls
            for w in range(1, G.NCOL + 1):
                out[f"{s.id}|{w}|{cls}"] = g._options(s, w)
    return out


# ------------------------------------------------------------------------------------------- page layout
def pdf_bytes(tpl: Template, B, items, title: str) -> bytes:
    data, _ = X.build_pdf([X.Page(tpl.page_w * MM, tpl.page_h * MM, items)], B.fonts, title=title,
                          output_intent=MP.OUTPUT_INTENTS["IFRA26"], actualtext=True, pdf_version="1.4",
                          pdfx_info=MP.PDFX["X-1a:2003"]["info"], creator=f"Pageinator Desk ({ENGINE_VERSION}, gen1 {G.GEN})")
    return data


def layout_page(cx, cal: Calibration, tpl: Template, stories: list, elements: list, photo_dir: Path, precomputed: dict,
                page: int, pages: int, day: date, edition: dict, work_dir: Path, regions=None) -> dict:
    """gen1.main's per-page loop on a template with the Desk's stories. → result dict with "pdf" bytes on success."""
    keep, redo = folio_plan(tpl, page, pages, day, edition)
    keep_ids = {e["id"] for e in keep}
    model = {**tpl.model, "elements": keep + elements, "stories": stories,
             "unassigned": [u for u in tpl.model.get("unassigned", []) if u in keep_ids]}
    ids = {s["id"] for s in stories}
    regions = regions or tpl.regions
    news_top = min(t for _, _, t, _ in regions)
    news_bottom = max(b for _, _, _, b in regions)
    g = DeskGenerator(cx, model, photo_dir, cal.styles, ids, cal.space_em, precomputed)
    if len(g.stories) > G.MAX_STORIES:
        return {"ok": False, "status": "too_many", "message": f"{len(g.stories)} modules: more than the layout search takes ({G.MAX_STORIES})"}
    if not g.stories:
        return {"ok": False, "status": "empty", "message": "no stories for this page"}
    retries, ink_retries, good = [], [], None
    res, info, placed, B, rep, n_fixed = None, {}, [], None, None, 0
    for attempt in range(G.RETRIES + 1):
        res, info = g.run(regions, cal.span_prior, cal.lead_side)
        if res is None and good is None and not info.get("budget_hit") and len(cal.styles_ext) > len(cal.styles) and not g.ext_styles:
            ban = g.ban_lead
            g2 = DeskGenerator(cx, model, photo_dir, cal.styles_ext, ids, cal.space_em, precomputed)
            for k in ("_lines", "_disp", "_cap", "_xh", "_fill"):            # same keys, same values: reuse the typesetting
                setattr(g2, k, dict(getattr(g, k)))
            g2.ext_styles, g2.ban_lead = True, ban
            g = g2
            res, info = g.run(regions, cal.span_prior, cal.lead_side)
            info["rare_styles"] = True
        if res is None:
            if good is not None:
                res, info, placed, B, rep, n_fixed = good
                info = {**info, "ink_touch_kept": True}
            break
        placed = [pl for k, tree in res[1] for pl in g.place(tree, G.ORIGIN + regions[k][0] * G.PITCH, regions[k][2])]
        B, rep, n_fixed = G.render(g, model, placed, news_top, news_bottom, photo_dir, [], keep, ({}, {}))
        over = [(st_, o) for st_, (_, _, _, _, _, o) in zip(rep["stories"], placed, strict=True) if st_["overset_lines"] or st_.get("overset_crosshead_words")]
        if not over:
            good = (res, info, placed, B, rep, n_fixed)
            touch = G.body_touches(model, B, work_dir)
            if not touch:
                break
            ink_retries.append(sorted(touch))
            if attempt == G.RETRIES:
                info = {**info, "ink_touch_kept": True}
                break
            for st_, (_, _, _, _, _, o) in zip(rep["stories"], placed, strict=True):
                if st_["story"] in touch:
                    g.banned.add((st_["story"], o["w"], o["m"], o["fit"], o["style"]))
            continue
        if attempt == G.RETRIES:
            if good is not None:
                res, info, placed, B, rep, n_fixed = good
                info = {**info, "ink_touch_kept": True}
            break
        for st_, o in over:
            k = (st_["story"], o["w"], o["m"], o["fit"], o["style"])
            g.extra_rows[k] = g.extra_rows.get(k, 0) + 1
        retries.append([st_["story"] for st_, _ in over])
    if res is None:
        status = "budget" if info.get("budget_hit") else "infeasible"
        return {"ok": False, "status": status, "info": {k: v for k, v in info.items() if k != "regions"},
                "message": "the layout search ran out of time" if status == "budget" else "these stories do not fill the page exactly"}
    folios = draw_folios(B, tpl, cx, redo, rep)
    title = f"Pageinator Desk - {day.isoformat()} - page {page} of {pages}"
    data = pdf_bytes(tpl, B, B.items, title)
    st_ = rep["stories"]
    by_story = {g.stories[i].id: (i, x, y, w, h, o) for i, x, y, w, h, o in placed}
    placed_out = []
    for s in g.stories:
        if s.id not in by_story:
            continue
        i, x, y, w, h, o = by_story[s.id]
        placed_out.append({"story": s.id, "rank": s.rank, "x_mm": round(x, 2), "y_mm": round(y, 2), "w_cols": w, "h_mm": round(h, 2),
                           "text_cols": o["m"], "copyfit": o["fit"], "photo_cols": o["photo"]["k"] if o["photo"] else None,
                           "headline_pt": round(o["size_h"], 2), "body_style_pt": list(o["style"])})
    overset = sum(s["overset_lines"] for s in st_)
    unset = sum(s.get("unset_paragraphs", 0) for s in st_)
    problems = B.problems[rep["fixed_problems"]:] if len(B.problems) >= rep["fixed_problems"] else B.problems
    warnings = []
    if overset:
        warnings.append(f"{overset} lines of text did not fit")
    if unset:
        warnings.append(f"{unset} paragraphs could not be set (a character the stand-in fonts lack)")
    if info.get("ink_touch_kept"):
        warnings.append("two lines of a story touch in ink somewhere: check the page")
    return {"ok": True, "pdf": data, "sha256": hashlib.sha256(data).hexdigest(),
            "manifest": {"schema": "pageinator.desk.page/1", "engine": ENGINE_VERSION, "generator": G.GEN, "template_role": tpl.role,
                         "page": page, "pages": pages, "date": day.isoformat(), "cost": round(res[0], 3),
                         "search_nodes": info.get("nodes"), "rare_styles": bool(info.get("rare_styles")), "retries": len(retries),
                         "ink_retries": ink_retries, "overset_lines": overset, "unset_paragraphs": unset,
                         "placed": placed_out, "folios_rewritten": folios, "fixed_problems": rep["fixed_problems"],
                         "problems": problems, "news_box_mm": [G.ORIGIN, round(news_top, 2), round(G.ORIGIN + G.span_mm(G.NCOL), 2), round(news_bottom, 2)],
                         "photos_drawn": rep.get("photos", 0)} | grid_record(),
            "warnings": warnings}


# ------------------------------------------------------------------------------------------- photo folders
def link_photo_dir(dst: Path, sources: list[tuple[Path, dict]], renames: dict | None = None, keep_existing: bool = False) -> Path:
    """A photo folder as gen1 reads it (index.json + <id>.cmyk.gz), made of symbolic links to the rasters.
    sources: [(folder, {id: {width_px, height_px, ppi}})]; renames: {new_id: (folder, old_id, record)}.
    keep_existing: add to the folder's index instead of replacing it (a page being edited gains a photo)."""
    dst.mkdir(parents=True, exist_ok=True, mode=0o700)
    index = {}
    if keep_existing and (dst / "index.json").exists():
        index = dict(json.loads((dst / "index.json").read_text()).get("elements", {}))
    for folder, elements in sources:
        for pid, rec in elements.items():
            src = folder / f"{pid}.cmyk.gz"
            if src.exists():
                _link(src, dst / f"{pid}.cmyk.gz")
                index[pid] = {k: rec.get(k) for k in ("width_px", "height_px", "ppi")}
    for new_id, (folder, old_id, rec) in (renames or {}).items():
        src = folder / f"{old_id}.cmyk.gz"
        if src.exists():
            _link(src, dst / f"{new_id}.cmyk.gz")
            index[new_id] = {k: rec.get(k) for k in ("width_px", "height_px", "ppi")}
    (dst / "index.json").write_text(json.dumps({"elements": index}, sort_keys=True) + "\n")
    return dst


def _link(src: Path, dst: Path) -> None:
    if dst.is_symlink() or dst.exists():
        dst.unlink()
    os.symlink(src.resolve(), dst)


def font_cmap(family: str, axes: dict, weight: int) -> set:
    """Code points the stand-in face (as the composer shapes it) covers."""
    from fontTools.ttLib import TTFont
    p = CP.K3.prepare("क", "mr", "Deva", family, 10.0, axes, weight)
    return set(TTFont(io.BytesIO(p.face_bytes)).getBestCmap())


_CMAPS: dict = {}


def unsupported_chars(text: str) -> set:
    """Characters of a text that neither stand-in face (body serif, display sans) has, joiners and spaces aside."""
    if not _CMAPS:
        _CMAPS["serif"] = font_cmap(CP.SERIF, CP.BODY_AXES, 400)
        _CMAPS["sans"] = font_cmap(CP.SANS, {"wght": 800.0, "wdth": 87.5}, 800)
    ok = _CMAPS["serif"] & _CMAPS["sans"]
    return {ch for ch in text if ord(ch) not in ok and not ch.isspace() and ch not in "‌‍"}


def photo_ppi_ok(rec: dict) -> bool:
    return bool(rec.get("width_px")) and bool(rec.get("height_px"))


def gz_raw(path: Path) -> bytes:
    return gzip.decompress(path.read_bytes())


def digest(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def floor_units(mm: float) -> int:
    return math.floor(mm / G.UNIT)
