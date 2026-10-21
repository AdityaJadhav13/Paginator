"""Editing a laid-out page by hand: move, resize, swap, remove and add stories. The proven engine sets every change.

A page is its template (the fixed parts) and its modules: [{story, x, y, w, h, locked}], with x and y the module's
top-left corner in mm, w its width in grid columns and h its height in mm.
- **Options.** Each module is set by gen1's typesetter with the module option that fills its box best, by gen1's own
  leaf cost (span preference + option cost + white space), at the story's rank on the page (the planner's order, the
  same lead promotion included).
- **Text that does not fit.** A module whose text does not fit after setting gets one more row and is set again, as
  gen1 does after a render. Text that still does not fit is reported, never hidden.
- **Boxes no option fills.** The module is set at the nearest option and reported: "over" when its text needs more
  room, "short" when white is left at its foot.
- **Nothing moves on its own.** Overlaps, boxes outside the news area and empty news space are reported.
- **Moving a story from another page.** The move is part of this page's edits until this page is saved; saving takes
  the story off the other page, so an undo before saving never loses a story.
- **Edited article text.** Text refreshed from the articles is kept for the run (edit-articles.json), so a restart
  never brings the old text back, and every open page of the run takes it before its next change. An article deleted
  since the layout leaves the page. Each article keeps the story it was laid out in and each story its place in the
  order of importance (the run's plan is frozen): new text never moves an article to another page.
- **Changes the editor did not make.** Stories the editor left where they were keep their exact position; a page
  changed in another window or tab is refused (its revision moved on) and shown again as it is.

Drawing returns a display list: text as glyph ids at positions in mm, with y down from the page's top-left corner, plus
rectangles, rules and pictures. The browser draws it with the same glyph outlines the PDF embeds, so screen and print
agree. Fonts and pictures go to a content-addressed cache in the desk home, which the server serves.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import traceback
from datetime import date
from pathlib import Path

import deskgen as DG
import deskprinted
from deskcommon import log, read_json, write_json

G, CP, X, MM = DG.G, DG.CP, DG.X, DG.MM
SNAP_MM = G.UNIT                                         # positions and heights snap to the search's unit …
MIN_H_MM = 10.0                                          # … no module is shorter than this
OVERSET_TRIES = 3                                        # rows added to a module whose text does not fit, at most
FIXED_KINDS = ("ad", "image", "graphic")
SAME_MM = 0.01
STALE = "this page was changed in another window or tab; it is shown again as it is now"


def _r(v: float) -> float:
    return round(v, 3)


def _finite(v) -> float:
    f = float(v)
    if not math.isfinite(f):
        raise ValueError("a position or size is not a number")
    return f


def _round(v: float) -> int:
    """Half up, as the browser's Math.round, so the editor's preview and the engine snap alike."""
    return int(math.floor(v + 0.5))


def prints_folio(tpl, page: int, pages: int, day: date) -> bool:
    """Does the page's folio print the edition's volume, issue or price (a front page's does)?"""
    probe = DG.folio_plan(tpl, page, pages, day, {k: "999" for k in deskprinted.EDITION_FIELDS})[1]
    plain = DG.folio_plan(tpl, page, pages, day, {k: "" for k in deskprinted.EDITION_FIELDS})[1]
    return [(e["id"], t) for e, t in probe] != [(e["id"], t) for e, t in plain]


class PageSession:
    """One page of a finished run, opened for editing. Built from the run's own request (with the article text
    refreshed since, if any), manifest and photo folder, so it sets exactly what the run set until something is changed."""

    def __init__(self, engine, home: Path, edition_dir: Path, run_dir: Path, page: int):
        self.engine, self.home, self.run_dir, self.page = engine, home, run_dir, page
        req = read_json(run_dir / "request.json")
        man = read_json(run_dir / f"page-{page:02d}.manifest.json")
        self.edition_dir = edition_dir
        self.edition = req["edition"]
        self.pages = int(self.edition["pages"])
        self.day = date.fromisoformat(self.edition["date"])
        self.role = man["template_role"]
        self.tpl = engine.template(self.role)
        self.text_path = run_dir / "edit-articles.json"
        self.req_articles = req.get("articles") or []
        # the run's own pictures and plan (desk_engine.run_pictures, plan.json); a run made before they existed reads
        # the edition's photos and works its plan out again
        self.assets = run_dir if (run_dir / "photos" / "index.json").is_file() else edition_dir
        plan = read_json(run_dir / "plan.json", {})
        self.frozen = plan.get("stories") or engine.built(self.edition, self.req_articles, self.assets).plan()
        self._text_sig, overrides = self._text_file()
        self.articles = self._articles(overrides)
        self.built = engine.built(self.edition, self.articles, self.assets, frozen=self.frozen)
        self.photo_dir = run_dir / "work" / f"page-{page:02d}" / "photos"
        self._link_photos()
        self.prints_folio = prints_folio(self.tpl, page, self.pages, self.day)
        self.folio_fields = self._live_fields()             # the edition's volume, issue and price as they are now
        self.keep, self.redo = DG.folio_plan(self.tpl, page, self.pages, self.day, self.folio_fields)
        self.fixed_boxes = [e["bbox_mm"] for e in self.keep if e["kind"] in FIXED_KINDS or (e["kind"] == "box" and e.get("fill"))]
        self.edit_path = run_dir / f"page-{page:02d}.edit.json"
        saved = read_json(self.edit_path, {})
        self.origin = {m["story"]: m for m in self._manifest_modules(man)}   # the layout's own places (undo returns there)
        if saved.get("modules") is not None and saved.get("page") == page:
            self.modules = saved["modules"]
        else:
            self.modules = self._manifest_modules(man)
        self.rev = int(saved.get("rev") or 0) if saved.get("page") == page else 0
        kept = [m for m in self.modules if m.get("story") in self.built.story_of]
        if len(kept) != len(self.modules):                  # a story whose articles are all gone: the page changed
            self.modules = kept
            self.rev += 1
            self._write_edit()
        self.modules = kept
        self.options: dict = {}
        self.partial: set[str] = set()                   # stories measured only where the page has needed them so far
        self._measurers: dict = {}                       # (story, rank class) → a generator measuring it width by width
        self.extra_rows: dict = {}                       # (story, w, m, fit, style) → rows added after an overset
        for m in self.modules:
            self._ensure_options(m["story"])
        self._g = None
        self._g_keys = None

    # ---- the edition's folio fields and ads, as they are now (Update text brings them, as it brings new text)
    def _live_fields(self) -> dict:
        live = read_json(self.edition_dir / "edition.json", {})
        return {k: str(live.get(k, self.edition.get(k, "")) or "") for k in deskprinted.EDITION_FIELDS}

    def _refresh_ads(self, undo: list) -> list[str]:
        """The edition's current ads for this page's slots, in the run's own pictures. → the slots that changed. undo
        gets what puts the run's ads back as they were (Update text undoes it if the page cannot be set)."""
        changed, run_ads, ed_ads = [], self.run_dir / "ads", self.edition_dir / "ads"
        have, now = deskprinted.ad_sigs(run_ads), deskprinted.ad_sigs(ed_ads)
        idx_path = run_ads / "index.json"
        run_idx = read_json(idx_path, {"elements": {}})
        ed_idx = read_json(ed_ads / "index.json", {"elements": {}}).get("elements", {})
        for slot in self.tpl.ad_slots:
            k = slot["slot"]
            if have.get(k) == now.get(k):
                continue
            if not changed:
                old_index = idx_path.read_bytes() if idx_path.exists() else None
                undo.append(lambda: _atomic(idx_path, old_index) if old_index is not None else idx_path.unlink(missing_ok=True))
            dst = run_ads / f"{k}.cmyk.gz"
            if dst.exists():
                kept = run_ads / f".{k}.cmyk.gz.before"
                kept.unlink(missing_ok=True)
                os.replace(dst, kept)                          # kept until Update text has set the page
                undo.append(lambda dst=dst, kept=kept: os.replace(kept, dst))
            else:
                undo.append(lambda dst=dst: dst.unlink(missing_ok=True))
            if k in now:
                self.engine.keep_copy(ed_ads / f"{k}.cmyk.gz", dst)
                run_idx.setdefault("elements", {})[k] = ed_idx[k]
            else:
                run_idx.setdefault("elements", {}).pop(k, None)
            changed.append(k)
        if changed:
            write_json(idx_path, run_idx)
            self._link_ads()
        return changed

    def _link_ads(self) -> None:
        """The page's photo folder shows the run's current ads under their template elements; a removed ad leaves
        its element without a picture (the page then prints the empty ad space)."""
        run_ads = self.run_dir / "ads"
        idx = read_json(run_ads / "index.json", {"elements": {}}).get("elements", {})
        renames = {s["element"]: (run_ads, s["slot"], idx[s["slot"]]) for s in self.tpl.ad_slots
                   if s["slot"] in idx and (run_ads / f"{s['slot']}.cmyk.gz").exists()}
        DG.link_photo_dir(self.photo_dir, [], renames, keep_existing=True)
        self._link_photos()

    # ---- the run's article text
    def _text_file(self) -> tuple[str, dict]:
        """edit-articles.json: its signature and the overrides {article id: article, or None when it was deleted}."""
        try:
            data = self.text_path.read_bytes()
        except FileNotFoundError:
            return "", {}
        return hashlib.sha256(data).hexdigest(), json.loads(data).get("articles") or {}

    def _articles(self, overrides: dict) -> list[dict]:
        out = []
        for a in self.req_articles:
            a = overrides[a.get("id")] if a.get("id") in overrides else a
            if a is not None:
                out.append(a)
        return out

    def _set_articles(self, articles: list[dict]) -> list[str]:
        """New article text for the page's stories (the run's plan kept). → keys of the stories whose text changed."""
        old = self.built
        self.articles = articles
        self.built = self.engine.built(self.edition, articles, self.assets, frozen=self.frozen)
        self._link_photos()
        changed = [k for k in self.built.story_of
                   if k not in old.story_of or (old.story_of[k], old.els_of[k]) != (self.built.story_of[k], self.built.els_of[k])]
        for k in changed + [k for k in self.options if k not in self.built.story_of]:
            self._forget(k)
        for m in self.modules:
            if m["story"] in self.built.story_of:
                self._ensure_options(m["story"])
        self._g = None
        return changed

    def sync(self) -> None:
        """Before anything is done on this page: text another page of the run has set (Update text) reaches it, so a
        story brought here is set with its new text, and a story whose articles are all deleted leaves the page."""
        sig, overrides = self._text_file()
        if sig == self._text_sig:
            return
        self._text_sig = sig
        articles = self._articles(overrides)
        if articles == self.articles:
            return
        changed = self._set_articles(articles)
        mine = {m["story"] for m in self.modules}
        if mine & set(changed) or any(k not in self.built.story_of for k in mine):   # this page changed: a new revision
            self.modules = [m for m in self.modules if m["story"] in self.built.story_of]
            self.rev += 1
            self._write_edit()

    def _write_edit(self) -> None:
        write_json(self.edit_path, {"schema": "pageinator.desk.page-edit/1", "page": self.page, "modules": self.modules,
                                    "rev": self.rev})

    def check_rev(self, base_rev) -> None:
        """A change made on an older view of the page (another window or tab changed it since) is refused."""
        if base_rev is not None and int(base_rev) != self.rev:
            raise ValueError(STALE)

    @staticmethod
    def _manifest_modules(man: dict) -> list[dict]:
        return [{"story": p["story"], "x": p["x_mm"], "y": p["y_mm"], "w": p["w_cols"], "h": p["h_mm"], "locked": False}
                for p in man.get("placed") or []]

    def _link_photos(self) -> None:
        """The page's photo folder holds every photo the run's stories use now (a refreshed story may bring a new one).
        Entries whose file is gone (a run made before runs kept their own pictures, whose ad or photo was removed from
        the edition since) are left out, so the page can still be set."""
        idx_path = self.photo_dir / "index.json"
        index = read_json(idx_path, {"elements": {}})
        elements = index.get("elements", {})
        gone = [k for k in elements if not (self.photo_dir / f"{k}.cmyk.gz").exists()]
        if gone:
            write_json(idx_path, {**index, "elements": {k: v for k, v in elements.items() if k not in gone}})
            elements = {k: v for k, v in elements.items() if k not in gone}
        missing = {p: self.built.photos_idx[p] for p in self.built.photo_ids if p not in elements}
        if missing:
            DG.link_photo_dir(self.photo_dir, [(self.built.photo_dir, missing)], keep_existing=True)

    # ---- stories and their options
    def _ensure_options(self, key: str) -> None:
        """A story's module options: the measurements a layout run (or this editor) kept, else measured as needed. A
        story not measured yet (new or changed text) is measured only at the widths the page asks for at once, about
        half a second each; the other widths are measured while the editor is idle (complete_one) and then kept."""
        if key in self.options:
            return
        cached = self.engine.cached_options(self.built, key)
        if cached is not None:
            self.options[key] = cached
        else:
            self.options[key] = {}
            self.partial.add(key)

    def _forget(self, key: str) -> None:
        """Drop a story's options (its text changed), with the rows added for its old text."""
        self.options.pop(key, None)
        self.partial.discard(key)
        for cls in DG.RANK_CLASSES:
            self._measurers.pop((key, cls), None)
        for k in [k for k in self.extra_rows if k[0] == key]:
            del self.extra_rows[k]

    def _measure(self, key: str, cls: int, w: int) -> list:
        """One setting of a partly measured story: gen1's options at w columns for rank class cls, computed as the
        layout runs compute them (DG.measure: a generator holding only this story), so they are the same options."""
        byw = self.options[key].setdefault(cls, {})
        if w not in byw:
            g = self._measurers.get((key, cls))
            if g is None:
                g = G.Generator(self.engine.cx, DG.measure_model([self.built.story_of[key]], self.built.els_of[key]),
                                self.engine.story_photos(self.built, key), self.engine.cal.styles, {key}, self.engine.cal.space_em)
                g.stories[0].rank = cls
                self._measurers[(key, cls)] = g
            byw[w] = g._options(g.stories[0], w)
            if self._g is not None and key in (self._g_keys or ()):
                self._g.precomputed[f"{key}|{w}|{cls}"] = byw[w]
        return byw[w]

    def complete_one(self) -> bool:
        """Idle time: measure one more setting of a partly measured story; a story measured at every setting is kept
        in the measurement cache. False when there is nothing left to measure."""
        for key in sorted(self.partial):
            if key not in self.built.story_of:
                self._forget(key)
                return True
            missing = [(cls, w) for cls in DG.RANK_CLASSES for w in range(1, G.NCOL + 1) if w not in self.options[key].get(cls, {})]
            if missing:
                try:
                    self._measure(key, *missing[0])
                except Exception:  # noqa: BLE001 — idle work never stops the editor; the setting is measured on use
                    log(traceback.format_exc())
                    self.partial.discard(key)
                return True
            self.partial.discard(key)
            for cls in DG.RANK_CLASSES:
                self._measurers.pop((key, cls), None)
            try:
                self.engine.store_options(self.built, key, self.options[key])
            except OSError:                              # the cache is a convenience: measured again next time
                log(traceback.format_exc())
            return True
        return False

    def _has_lead_options(self, key: str) -> bool:
        """Can the story be set as the page's lead at some width? A partly measured story is measured as the lead at
        the widths still missing first, so the page's order never changes later, when idle measuring ends."""
        lead = self.options[key].get(0, {})
        if any(lead.get(w) for w in range(1, G.NCOL + 1)):
            return True
        if key in self.partial:
            for w in range(1, G.NCOL + 1):
                if w not in lead and self._measure(key, 0, w):
                    return True
        return False

    def order(self) -> list[str]:
        """The page's stories in order of importance (the edition's order; briefs last), with the planner's rule: a story
        that cannot be set as the page's lead gives the lead to the next story (deskplan.Planner.page_order)."""
        it = {i["key"]: i for i in self.built.items}
        order = sorted({m["story"] for m in self.modules}, key=lambda k: (it[k]["brief"], it[k]["order"]))
        if len(order) > 1 and not self._has_lead_options(order[0]):
            for i in range(1, len(order)):
                if not it[order[i]]["brief"] and self._has_lead_options(order[i]):
                    order.insert(0, order.pop(i))
                    break
        return order

    def generator(self) -> DG.DeskGenerator:
        keys = self.order()
        if self._g is None or self._g_keys != keys:
            rank = {k: 1000.0 - i for i, k in enumerate(keys)}
            els = [{**e, "size_pt": rank[k]} if e["kind"] == "headline" else e for k in keys for e in self.built.els_of[k]]
            self.model = {**self.tpl.model, "elements": self.keep + els, "stories": [self.built.story_of[k] for k in keys],
                          "unassigned": [u for u in self.tpl.model.get("unassigned", []) if u in {e["id"] for e in self.keep}]}
            pre = {f"{k}|{w}|{cls}": o for k in keys for cls, byw in self.options[k].items() for w, o in byw.items()}
            self._g = DG.DeskGenerator(self.engine.cx, self.model, self.photo_dir, self.engine.cal.styles, set(keys),
                                       self.engine.cal.space_em, pre)
            self._g.extra_rows = self.extra_rows             # shared: a retry is remembered for this page
            self._g_keys = keys
        return self._g

    def pick(self, s, w: int, h_mm: float):
        """gen1's leaf cost: the cheapest option at w columns that fills h exactly; else the nearest, with its status."""
        g = self.generator()
        H = round(h_mm / G.UNIT)
        opts = g.options(s, w)
        best = None
        for o in opts:
            if o["lo"] <= H <= o["hi"]:
                ws = (H - o["lo"]) * G.UNIT / (o["style"][1] / MM)
                c = self.engine.cal.span_prior(s.rank, w) + o["static"] + ws + 2.0 * max(0.0, ws - 1.0)
                if best is None or c < best[0]:
                    best = (c, o)
        if best:
            return best[1], "fits", 0.0
        if not opts:
            return None, "none", 0.0
        o = min(opts, key=lambda o: (max(o["lo"] - H, H - o["hi"], 0), o["static"]))
        if H < o["lo"]:
            return o, "over", (o["lo"] - H) * G.UNIT
        return o, "short", (H - o["hi"]) * G.UNIT

    # ---- edits
    def snap(self, m: dict) -> dict:
        """The module on the grid: whole columns; y and h in whole steps from the news area's top (the search's grid),
        inside the news area: a module pushed past the foot stops there with its height (the editor shortens a module
        only when it is resized past the foot, and sends it so)."""
        w = max(1, min(G.NCOL, _round(_finite(m["w"]))))
        col = max(0, min(G.NCOL - w, _round((_finite(m["x"]) - G.ORIGIN) / G.PITCH)))
        top = self.tpl.news_top
        steps = int(math.floor((self.tpl.news_bottom - top) / SNAP_MM + 1e-9))
        least = int(math.ceil(MIN_H_MM / SNAP_MM - 1e-9))
        hk = max(least, min(steps, _round(_finite(m["h"]) / SNAP_MM)))
        yk = max(0, min(steps - hk, _round((_finite(m["y"]) - top) / SNAP_MM)))
        return {"story": m["story"], "x": _r(G.ORIGIN + col * G.PITCH), "y": _r(top + yk * SNAP_MM), "w": w,
                "h": _r(hk * SNAP_MM), "locked": bool(m.get("locked"))}

    @staticmethod
    def _same(a: dict, b: dict) -> bool:
        return (int(a["w"]) == _round(_finite(b["w"])) and abs(a["x"] - _finite(b["x"])) < SAME_MM
                and abs(a["y"] - _finite(b["y"])) < SAME_MM and abs(a["h"] - _finite(b["h"])) < SAME_MM
                and bool(a.get("locked")) == bool(b.get("locked")))

    def set_modules(self, modules: list[dict]) -> None:
        """The page's new modules, as the editor sends them (each story at most once; only stories of the edition). A
        module the editor left where it was, or brought back to the layout's place (undo), keeps that exact position
        (the layout's own may be off the editor's grid, as below an advertisement); a moved one is snapped. A story that
        is on another page stays there too until this page is saved (see export)."""
        known = set(self.built.story_of)
        before = {m["story"]: m for m in self.modules}
        out, seen = [], set()
        for m in modules:
            k = m.get("story")
            if k in known and k not in seen:
                seen.add(k)
                self._ensure_options(k)
                p, o = before.get(k), self.origin.get(k)
                out.append(dict(p) if p is not None and self._same(p, m) else
                           dict(o) if o is not None and self._same(o, m) else self.snap(m))
        self.modules = out

    def apply(self, modules: list[dict], base_rev=None) -> dict:
        """A change from the editor, set and drawn; if it cannot be set, the page stays as it was."""
        self.check_rev(base_rev)
        before = (list(self.modules), self.rev)
        try:
            self.set_modules(modules)
            self.rev += 1
            self._write_edit()
            return self.draw()
        except Exception:
            self.modules, self.rev = before
            self._write_edit()
            raise

    # ---- state and drawing
    def placed(self):
        g = self.generator()
        idx = {s.id: i for i, s in enumerate(g.stories)}
        out, notes = [], []
        for m in self.modules:
            i = idx[m["story"]]
            if m["story"] in self.partial:
                self._measure(m["story"], DG.rank_class(i), m["w"])
            o, st, by = self.pick(g.stories[i], m["w"], m["h"])
            notes.append({"story": m["story"], "fit": st, "by_mm": _r(by),
                          "articles": self.built.article_of[m["story"]], "headline": g.stories[i].head or ""})
            if o is not None:
                out.append((i, m["x"], m["y"], m["w"], m["h"], o))
        return out, notes

    def render(self):
        """gen1's render of the page; a module whose text does not fit gets one more row and the page is set again (as
        gen1.main does), at most OVERSET_TRIES times. → (Builder, report, fixed items, placed, notes, text problems)."""
        for attempt in range(OVERSET_TRIES + 1):
            placed, notes = self.placed()
            g = self.generator()
            B, rep, n_fixed = G.render(g, self.model, placed, self.tpl.news_top, self.tpl.news_bottom, self.photo_dir, [],
                                       self.keep, ({}, {}))
            over = [(st_, o) for st_, (_, _, _, _, _, o) in zip(rep["stories"], placed, strict=True)
                    if st_["overset_lines"] or st_.get("overset_crosshead_words")]
            if not over or attempt == OVERSET_TRIES:
                break
            grew = False
            for st_, o in over:
                k = (st_["story"], o["w"], o["m"], o["fit"], o["style"])
                if self.extra_rows.get(k, 0) < OVERSET_TRIES:  # never more rows than gen1 would add after one render
                    self.extra_rows[k] = self.extra_rows.get(k, 0) + 1
                    grew = True
            if not grew:
                break
        DG.draw_folios(B, self.tpl, self.engine.cx, self.redo, rep)
        text = []
        for st_ in rep["stories"]:
            lines = st_.get("overset_lines", 0)
            words = st_.get("overset_crosshead_words", 0)
            if lines or words:
                text.append({"kind": "overset", "stories": [st_["story"]], "lines": lines, "words": words})
            if st_.get("unset_paragraphs"):
                text.append({"kind": "unset", "stories": [st_["story"]], "paragraphs": st_["unset_paragraphs"]})
        return B, rep, n_fixed, placed, notes, text

    def problems(self, notes, text=()) -> list[dict]:
        out = list(text)
        boxes = [(m, (m["x"], m["y"], m["x"] + G.span_mm(m["w"]), m["y"] + m["h"])) for m in self.modules]
        for a in range(len(boxes)):
            for b in range(a + 1, len(boxes)):
                (ma, ba), (mb, bb) = boxes[a], boxes[b]
                ox, oy = min(ba[2], bb[2]) - max(ba[0], bb[0]), min(ba[3], bb[3]) - max(ba[1], bb[1])
                if ox > 0.5 and oy > 0.5:
                    out.append({"kind": "overlap", "stories": [ma["story"], mb["story"]], "mm": _r(min(ox, oy))})
        regions = [DG.G.region_box(r) for r in self.tpl.regions]
        for m, bb in boxes:
            inside = any(bb[0] >= r[0] - 0.5 and bb[2] <= r[2] + 0.5 and bb[1] >= r[1] - 0.5 and bb[3] <= r[3] + 0.5 for r in regions)
            on_fixed = any(min(bb[2], f[2]) - max(bb[0], f[0]) > 0.5 and min(bb[3], f[3]) - max(bb[1], f[1]) > 0.5 for f in self.fixed_boxes)
            if not inside or on_fixed:
                out.append({"kind": "outside", "stories": [m["story"]], "mm": 0.0})
        for n in notes:
            if n["fit"] == "over":
                out.append({"kind": "over", "stories": [n["story"]], "mm": n["by_mm"]})
            elif n["fit"] == "short" and n["by_mm"] > 9.0:
                out.append({"kind": "short", "stories": [n["story"]], "mm": n["by_mm"]})
            elif n["fit"] == "none":
                out.append({"kind": "cannot_set", "stories": [n["story"]], "mm": 0.0})
        hole = sum(G.span_mm(w) * (b - t) for _, w, t, b in self.tpl.regions)
        used = sum(G.span_mm(m["w"]) * m["h"] for m in self.modules)
        if hole - used > 0.02 * hole:
            out.append({"kind": "empty", "stories": [], "mm2": round(hole - used)})
        return out

    def state(self, text=()) -> dict:
        _, notes = self.placed()
        elsewhere = self.where()
        return {"page": self.page, "role": self.role, "rev": self.rev, "modules": self.modules, "notes": notes,
                "problems": self.problems(notes, text),
                "pool": self.pool(elsewhere), "grid": self.grid(),
                "also_on_pages": {m["story"]: elsewhere[m["story"]] for m in self.modules if m["story"] in elsewhere}}

    def grid(self) -> dict:
        return {"page_w_mm": self.tpl.page_w, "page_h_mm": self.tpl.page_h, "origin_mm": G.ORIGIN, "column_mm": G.COL_W,
                "gutter_mm": G.GUT, "columns": G.NCOL, "news_top_mm": _r(self.tpl.news_top), "news_bottom_mm": _r(self.tpl.news_bottom),
                "snap_mm": SNAP_MM}

    def page_modules(self, n: int) -> list[dict]:
        """Another page's stories as they stand: its saved edits, else its layout."""
        saved = read_json(self.run_dir / f"page-{n:02d}.edit.json", {})
        if saved.get("modules") is not None and saved.get("page") == n:
            return saved["modules"]
        return self._manifest_modules(read_json(self.run_dir / f"page-{n:02d}.manifest.json", {}))

    def where(self) -> dict:
        """story → the other page it is on now."""
        out = {}
        for n in range(1, self.pages + 1):
            if n != self.page:
                for m in self.page_modules(n):
                    out[m["story"]] = n
        return out

    def pool(self, elsewhere=None) -> list[dict]:
        """Stories of the edition not on this page (the editor can bring one in; one on another page moves here)."""
        on = {m["story"] for m in self.modules}
        elsewhere = self.where() if elsewhere is None else elsewhere
        out = []
        for it in self.built.items:
            k = it["key"]
            if k in on:
                continue
            st = self.built.story_of[k]
            els = {e["id"]: e for e in self.built.els_of[k]}
            head = els[st["headline"]]["text"] if st.get("headline") in els else "(short items)"
            out.append({"story": k, "headline": head, "articles": self.built.article_of[k], "brief": it["brief"],
                        "on_page": elsewhere.get(k)})
        return out

    def take_from_other_pages(self) -> dict:
        """At save: the stories of this page leave every other page they are still on (that page's edits change; it
        must be opened, filled and saved again). → {page: [article ids it keeps]}."""
        mine = {m["story"] for m in self.modules}
        changed = {}
        for n in range(1, self.pages + 1):
            if n == self.page:
                continue
            mods = self.page_modules(n)
            keep = [m for m in mods if m["story"] not in mine]
            if len(keep) != len(mods):
                saved = read_json(self.run_dir / f"page-{n:02d}.edit.json", {})
                sess = self.engine.sessions.get(f"{self.run_dir.parent.parent.name}/{self.run_dir.name}/{n}")
                rev = max(int(saved.get("rev") or 0) if saved.get("page") == n else 0, sess.rev if sess is not None else 0) + 1
                write_json(self.run_dir / f"page-{n:02d}.edit.json",       # its editor (another tab) is out of date now
                           {"schema": "pageinator.desk.page-edit/1", "page": n, "modules": keep, "rev": rev,
                            "changed_by_page": self.page})
                if sess is not None:
                    sess.modules, sess.rev = keep, rev
                changed[n] = [a for m in keep for a in self.built.article_of.get(m["story"], [])]
        return changed

    # ---- other layouts and fresh text
    def alternative(self, variant: int, base_rev=None) -> dict:
        """Another complete layout of the same stories (gen1 alternatives): 1 the lead on the other side, 2 the lead at
        another width, 3 both. Set as an edit (the editor can undo it); if it cannot be set, the page stays as it was."""
        self.check_rev(base_rev)
        keys = self.order()
        if not keys:
            raise ValueError("this page has no stories to lay out")
        if len(keys) > G.MAX_STORIES:
            raise ValueError(f"this page has {len(keys)} stories; another layout needs {G.MAX_STORIES} or fewer")
        g = self.generator()
        lead = next((m for m in self.modules if m["story"] == keys[0]), None)
        mid = (G.ORIGIN + G.ORIGIN + G.span_mm(G.NCOL)) / 2
        side = self.engine.cal.lead_side
        if lead is not None and variant in (1, 3):
            side = "right" if lead["x"] + G.span_mm(lead["w"]) / 2 < mid else "left"
        g.ban_lead = {lead["w"]} if lead is not None and variant in (2, 3) else set()
        bottom = max([m["y"] + m["h"] for m in self.modules] + [self.tpl.news_top + 10])
        tries = [self.tpl.regions]
        if len(self.tpl.regions) == 1 and bottom < self.tpl.news_bottom - 1:      # the page came out short: keep its height
            c0, w, top, _ = self.tpl.regions[0]
            tries.insert(0, [(c0, w, top, bottom + 0.01)])
        res = None
        try:
            for regions in tries:
                res, info = g.run(regions, self.engine.cal.span_prior, side)
                if res is not None:
                    break
        finally:
            g.ban_lead = set()
        if res is None:
            raise ValueError("no other layout fills this page exactly with these stories")
        placed = [pl for k, tree in res[1] for pl in g.place(tree, G.ORIGIN + regions[k][0] * G.PITCH, regions[k][2])]
        return self.apply([{"story": g.stories[i].id, "x": x, "y": y, "w": w, "h": h, "locked": False}
                           for i, x, y, w, h, o in placed])

    def refresh_text(self, base_rev=None) -> dict:
        """The articles' current text (edited since the layout) set on the page. Changed stories are measured again;
        the new text is kept for the run (edit-articles.json), so every page of the run uses it. An article deleted
        from the edition since leaves the page. The run's plan is kept (Built, frozen): an article that would now be a
        story rather than a short item, or the other way round, is reported and changes at the next layout. If the page
        cannot be set with the new text, nothing changes (the run's ads included). Refused on an older revision, as a
        change is. → the page, plus "changed" (stories set with new text), "dropped" (stories that left the page),
        "removed" (articles no longer printed on it), "kind_changes", "folio_changed", "ads_changed"."""
        self.check_rev(base_rev)
        live = {a.get("id"): a for a in read_json(self.edition_dir / "articles.json", {"articles": []}).get("articles", [])}
        mine = [a for m in self.modules for a in self.built.article_of.get(m["story"], [])]
        if self.assets == self.run_dir:                      # a new photo in the new text joins the run's own pictures
            for aid in mine:
                photo = (live.get(aid) or {}).get("photo")
                if isinstance(photo, dict) and photo.get("id") not in self.built.photos_idx:
                    self.engine.adopt_photo(self.edition_dir, self.run_dir, str(photo.get("id")))
        fields = self._live_fields()
        folio_changed = self.prints_folio and fields != self.folio_fields
        _, overrides = self._text_file()
        overrides = {**overrides, **{aid: live.get(aid) for aid in mine}}      # None: deleted from the edition
        articles = self._articles(overrides)
        saved = (self.articles, self.built, dict(self.options), list(self.modules), self._g, self._g_keys, set(self.partial),
                 dict(self._measurers), self.rev, self.keep, self.redo, self.fixed_boxes, self.folio_fields)
        undo: list = []
        try:
            ads_changed = self._refresh_ads(undo) if self.assets == self.run_dir else []
            if articles == self.articles and not folio_changed and not ads_changed:
                return {**self.draw(), "changed": [], "dropped": [], "removed": [], "kind_changes": [],
                        "folio_changed": False, "ads_changed": []}
            if fields != self.folio_fields:
                self.folio_fields = fields
                self.keep, self.redo = DG.folio_plan(self.tpl, self.page, self.pages, self.day, fields)
                self.fixed_boxes = [e["bbox_mm"] for e in self.keep if e["kind"] in FIXED_KINDS or (e["kind"] == "box" and e.get("fill"))]
                self._g = None
            changed = self._set_articles(articles) if articles != self.articles else []
            dropped = [m["story"] for m in self.modules if m["story"] not in self.built.story_of]
            self.modules = [m for m in self.modules if m["story"] in self.built.story_of]
            kept = [a for m in self.modules for a in self.built.article_of.get(m["story"], [])]
            removed = [a for a in mine if a not in kept]
            changed = [k for k in changed if any(m["story"] == k for m in self.modules)]
            if changed or dropped or removed or folio_changed or ads_changed:
                self.rev += 1
            drawn = self.draw()
        except Exception:
            (self.articles, self.built, self.options, self.modules, self._g, self._g_keys, self.partial,
             self._measurers, self.rev, self.keep, self.redo, self.fixed_boxes, self.folio_fields) = saved
            for step in reversed(undo):                       # the run's ads as they were
                step()
            if undo:
                self._link_ads()
            self._g = None
            raise
        finally:
            for before in (self.run_dir / "ads").glob(".*.cmyk.gz.before"):
                before.unlink(missing_ok=True)
        write_json(self.text_path, {"schema": "pageinator.desk.edit-articles/1", "articles": overrides})
        self._text_sig, _ = self._text_file()
        self._write_edit()
        kinds = self.built.kind_changes(self.engine.built(self.edition, articles, self.edition_dir), kept)
        return {**drawn, "changed": changed, "dropped": dropped, "removed": removed, "kind_changes": kinds,
                "folio_changed": folio_changed, "ads_changed": ads_changed}

    def draw(self) -> dict:
        """The page as a display list (mm, y down), with the fonts and pictures it needs from the cache."""
        B, rep, n_fixed, placed, notes, text = self.render()
        H = self.tpl.page_h
        fonts = {}
        for fk, ef in B.fonts.items():
            h = hashlib.sha256(ef.face_bytes).hexdigest()[:24]
            f = self.engine.cache_dir("fonts") / f"{h}.ttf"
            if not f.exists():
                _atomic(f, ef.face_bytes)
            fonts[fk] = {"face": h, "upem": ef.upem}
        items = []
        for it in B.items:
            if isinstance(it, X.TextRun):
                gl = [[g.gid, _r(g.x_pt / MM), _r(H - g.y_pt / MM)] for _, gs in it.clusters for g in gs]
                items.append({"t": "text", "f": it.font, "s": it.size_pt, "hs": it.hscale, "c": list(it.cmyk), "g": gl})
            elif isinstance(it, X.Rect):
                items.append({"t": "rect", "x": _r(it.x_pt / MM), "y": _r(H - (it.y_pt + it.h_pt) / MM), "w": _r(it.w_pt / MM),
                              "h": _r(it.h_pt / MM), "c": list(it.cmyk)})
            elif isinstance(it, X.Line):
                items.append({"t": "line", "x1": _r(it.x1 / MM), "y1": _r(H - it.y1 / MM), "x2": _r(it.x2 / MM), "y2": _r(H - it.y2 / MM),
                              "lw": it.width_pt, "c": list(it.cmyk)})
            elif isinstance(it, X.Image):
                h = hashlib.sha1(it.cmyk_bytes).hexdigest()[:24]
                meta = self.engine.cache_dir("rasters") / f"{h}.json"
                if not meta.exists():
                    _atomic(self.engine.cache_dir("rasters") / f"{h}.cmyk", it.cmyk_bytes)
                    write_json(meta, {"width_px": it.width_px, "height_px": it.height_px})
                items.append({"t": "img", "x": _r(it.x_pt / MM), "y": _r(H - (it.y_pt + it.h_pt) / MM), "w": _r(it.w_pt / MM),
                              "h": _r(it.h_pt / MM), "src": h})
        return {**self.state(text), "items": items, "fonts": fonts, "fixed_items": n_fixed}

    def export(self, base_rev=None) -> dict:
        """The edited page as its PDF/X-1a page file (the run's page-NN.pdf; the auto layout kept as page-NN.auto.pdf).
        Stories brought here from other pages leave them now. → file, problems, this page's articles, pages changed."""
        self.check_rev(base_rev)
        B, rep, n_fixed, placed, notes, text = self.render()
        work = self.run_dir / "work" / f"page-{self.page:02d}"
        work.mkdir(parents=True, exist_ok=True, mode=0o700)
        touch = sorted(G.body_touches(self.model, B, work))     # two lines of a story touching in ink (as the runs check)
        title = f"Pageinator Desk - {self.day.isoformat()} - page {self.page} of {self.pages} (edited)"
        data = DG.pdf_bytes(self.tpl, B, B.items, title)
        pdf = self.run_dir / f"page-{self.page:02d}.pdf"
        auto = self.run_dir / f"page-{self.page:02d}.auto.pdf"
        if pdf.exists() and not auto.exists():
            _atomic(auto, pdf.read_bytes())
        _atomic(pdf, data)
        changed = self.take_from_other_pages()
        g = self.generator()
        set_ = {g.stories[i].id for i, *_ in placed}             # a story that could not be set prints nothing
        articles = [a for m in self.modules if m["story"] in set_ for a in self.built.article_of.get(m["story"], [])]
        problems = self.problems(notes, text) + [{"kind": "touch", "stories": touch}] if touch else self.problems(notes, text)
        return {"pdf": pdf.name, "sha256": hashlib.sha256(data).hexdigest(), "rev": self.rev, "problems": problems,
                "articles": articles, "pages_changed": {str(k): v for k, v in changed.items()},
                "printed": self.printed(articles)}

    def printed(self, articles: list) -> dict:
        """What the page prints (deskprinted): its articles' text and photos, its folio fields, its ads."""
        by_id, briefs = {a.get("id"): a for a in self.articles}, deskprinted.briefs_of(self.frozen)
        ads = deskprinted.ad_sigs(self.run_dir / "ads")
        return {"v": deskprinted.VERSION,
                "articles": {a: deskprinted.article_sig(by_id[a], a in briefs) for a in articles if a in by_id},
                "folio": deskprinted.folio_sig(self.folio_fields) if self.prints_folio else None,
                "ads": {s["slot"]: ads.get(s["slot"]) for s in self.tpl.ad_slots}}


def _atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_bytes(data)
    tmp.chmod(0o600)
    tmp.replace(path)


def request_ok(req: dict, keys: tuple) -> None:
    missing = [k for k in keys if k not in req]
    if missing:
        raise ValueError(f"missing {', '.join(missing)}")


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
