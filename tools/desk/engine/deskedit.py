"""Editing a laid-out page by hand: move, resize, swap, remove and add stories. The proven engine sets every change.

A page is its template (the fixed parts) and its modules: [{story, x, y, w, h, locked, crop, treatment}], with x and y
the module's top-left corner in mm, w its width in grid columns and h its height in mm. locked, crop and treatment are
the module's attributes, kept apart from its place.
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
- **Moving a story to another page** (move_to). The story leaves this page at once and joins the other page's edits: at
  its width, at the depth its text needs there, at the first free place; a page with no free place for it refuses the
  move (a story is never put over another). The other page is written first, and a failure on this page takes the
  story back off it, so the story is never in no page's edits. Each page prints it only once that page is saved.
- **Edited article text.** Text refreshed from the articles is kept for the run (edit-articles.json), so a restart
  never brings the old text back, and every open page of the run takes it before its next change. An article deleted
  since the layout leaves the page. Each article keeps the story it was laid out in and each story its place in the
  order of importance (the run's plan is frozen): new text never moves an article to another page.
- **Changes the editor did not make.** Stories the editor left where they were keep their exact position; a page
  changed in another window or tab is refused (its revision moved on) and shown again as it is.
- **Locked stories.** A locked story keeps its place, width and height for this layout: a change that moves, resizes or
  removes it is refused, and so is bringing in a story locked on another page, or saving a page while one of its stories
  is locked on another page (the save would take it off that page). Another layout keeps the locked stories where they
  are and lays the others out around them. Its text can still change, and a story whose articles are all deleted still
  leaves the page: a deleted article must never print. A lock does not print, so it is not in what a page prints.
- **Photo crops.** gen1 frames a story's photo and fills the frame with its centre (the largest window of the frame's
  shape). A crop chooses other pixels for the same frame: it enlarges that window (never beyond ZOOM_MAX, nor below the
  resolution gen1 allows the photo) and centres it on a point of the photo, its focus, as far as the photo's edges
  allow, so the point stays in the frame at every size. A crop belongs to its story's photo: it moves with its story
  (another layout, a swap) and never applies to another picture (a replaced photo has another id; its crop is dropped). It is
  page geometry, kept for this layout only and covered by the page's revision; what prints is recorded ("crops").
- **Story treatments.** On a paper whose house style has them (layout/panels.py: strap band, tint panel, reverse head,
  box), a story's treatment is the house rule's unless the editor chooses one (the module's "treatment"; missing or null:
  the rule's; "none": none). The choice is set on the story's article for the engine (Built: the rule lets it win), so
  the story is measured and set again with it, like new text; it moves with its story, is undone like any change and is
  covered by the page's revision. A paper without treatments (the default) refuses every choice; a column of short items
  never has one (its choice is dropped).

Drawing returns a display list: text as glyph ids at positions in mm, with y down from the page's top-left corner, plus
rectangles, rules and pictures. The browser draws it with the same glyph outlines the PDF embeds, so screen and print
agree. Fonts and pictures go to a content-addressed cache in the desk home, which the server serves.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import math
import os
import re
import stat
import time
import zlib
from datetime import date
from pathlib import Path

import deskarticles as DA
import deskgen as DG
import deskprinted
from deskcommon import PHOTO_ID, log_error, read_json, write_json
from deskmsg import MESSAGES, data, msg

G, CP, X, MM = DG.G, DG.CP, DG.X, DG.MM
SNAP_MM = G.UNIT                                         # positions and heights snap to the search's unit …
MIN_H_MM = 10.0                                          # … no module is shorter than this
OVERSET_TRIES = 3                                        # rows added to a module whose text does not fit, at most
FIXED_KINDS = ("ad", "image", "graphic")
SAME_MM = 0.01
# the engine's refusals: messages of messages.json (deskmsg), sent as English text and as {code, params}
STALE = msg("m.edit.stale")
LOCKED_MOVE = MESSAGES["m.edit.lockedMove"]             # templates, as before (the messages are made with msg())
LOCKED_TAKE = MESSAGES["m.edit.lockedTake"]
LOCKED_THERE = MESSAGES["m.edit.lockedThere"]
SAVE_HELD = MESSAGES["m.edit.saveHeld"]
ALL_LOCKED = msg("m.edit.allLocked")
NO_FILL_AROUND = msg("m.edit.noFillAround")
ZOOM_MAX = 4.0                                           # a crop enlarges its photo in the frame at most this much
CROP_BAD = msg("m.edit.cropBad")
CROP_LOST = MESSAGES["m.edit.cropLost"]
TREATMENT_BAD = MESSAGES["m.edit.treatmentBad"]
MOVE_NOT_HERE = MESSAGES["m.edit.moveNotHere"]
MOVE_NO_PAGE = MESSAGES["m.edit.moveNoPage"]
MOVE_SAME_PAGE = MESSAGES["m.edit.moveSamePage"]
MOVE_NOT_LAID_OUT = MESSAGES["m.edit.moveNotLaidOut"]
MOVE_LOCKED_THERE = MESSAGES["m.edit.moveLockedThere"]
MOVE_CANNOT_SET = MESSAGES["m.edit.moveCannotSet"]
MOVE_NO_ROOM = MESSAGES["m.edit.moveNoRoom"]


def _r(v: float) -> float:
    return round(v, 3)


def _finite(v) -> float:
    f = float(v)
    if not math.isfinite(f):
        raise ValueError(msg("m.edit.notNumber"))
    return f


def _round(v: float) -> int:
    """Half up, as the browser's Math.round, so the editor's preview and the engine snap alike."""
    return int(math.floor(v + 0.5))


def is_locked(m: dict) -> bool:
    """A stored module's lock. Anything but false or missing counts as locked: a lock only ever refuses a change."""
    return bool(m.get("locked"))


def _number(v) -> float | None:
    """A finite number as JSON gives it (never true or false), else None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:                                # an integer too large for a float
        return None
    return f if math.isfinite(f) else None


def crop_value(c) -> dict | None:
    """A photo crop as the editor sends it, checked: None (no crop: the photo prints as gen1 crops it), or {"photo": the
    photo's id, "focus": [x, y], the point of the photo (fractions of its width and height) the frame keeps as near its
    centre as the photo's edges allow, "zoom": how much the photo is enlarged in its frame (1: as large as gen1 sets
    it)}. The focus is clamped to the photo, the zoom to 1 … ZOOM_MAX (the frame's resolution may limit it further:
    crop_window), both rounded; other keys are dropped. Anything else is refused."""
    if c is None:
        return None
    if not isinstance(c, dict):
        raise ValueError(CROP_BAD)
    photo, focus, zoom = c.get("photo"), c.get("focus"), _number(c.get("zoom"))
    xy = [_number(v) for v in focus] if isinstance(focus, (list, tuple)) and len(focus) == 2 else [None]
    if not (isinstance(photo, str) and PHOTO_ID.fullmatch(photo)) or None in xy or zoom is None:
        raise ValueError(CROP_BAD)
    return {"photo": photo, "focus": [round(min(1.0, max(0.0, v)), 4) for v in xy],
            "zoom": round(min(ZOOM_MAX, max(1.0, zoom)), 3)}


def treatment_value(t) -> str | None:
    """A story treatment as the editor sends it, checked: None (the house rule's), or one of the treatments this paper
    has (DA.panels.available(): "none" and those with a spec). Anything else is refused; a paper without treatments
    refuses every one."""
    if t is None:
        return None
    if not isinstance(t, str) or t not in DA.panels.available():
        raise ValueError(msg("m.edit.treatmentBad"))
    return t


def crop_window(W0: int, H0: int, fw: float, fh: float, crop: dict | None = None, floor: float = G.MIN_PPI):
    """The pixels of a W0 × H0 photo that fill a frame of fw × fh mm. → ((x, y, w, h) in the photo's pixels, the zoom
    used, the largest zoom allowed). Without a crop: exactly gen1's window (generate.render: the largest window of the
    frame's shape, centred), with gen1's own expressions. A crop's zoom makes that window smaller, never below floor
    (the photo's resolution floor, ppi, gen1's own: Story.photo["min_ppi"]) and never beyond ZOOM_MAX; the window is
    centred on the crop's focus as far as the photo's edges allow. The window is rounded up to whole pixels, so its
    resolution is never below the floor; at zoom 1 it is gen1's window, and at focus (½, ½) also in gen1's place."""
    want = fw / fh
    if W0 / H0 > want:                                   # too wide: gen1 crops the sides
        cw0, ch0 = min(W0, max(1, round(H0 * want))), H0
    else:                                                # too tall: top and bottom
        cw0, ch0 = W0, min(H0, max(1, round(W0 / want)))
    ppi = min(cw0 / (fw / 25.4), ch0 / (fh / 25.4))
    zoom_max = max(1.0, min(ZOOM_MAX, ppi / floor))
    if crop is None:
        return ((W0 - cw0) // 2, (H0 - ch0) // 2, cw0, ch0), 1.0, zoom_max
    z = max(1.0, min(float(crop["zoom"]), zoom_max))
    w, h = min(cw0, max(1, math.ceil(cw0 / z))), min(ch0, max(1, math.ceil(ch0 / z)))
    if z > 1.0 and min(w / (fw / 25.4), h / (fh / 25.4)) < floor * (1 - 1e-9):   # never: ceil keeps it (fail closed)
        raise ValueError(msg("m.edit.cropFloor"))
    fx, fy = crop["focus"]
    x = max(0, min(W0 - w, math.floor(fx * W0 - w / 2)))
    y = max(0, min(H0 - h, math.floor(fy * H0 - h / 2)))
    return (x, y, w, h), z, zoom_max


def _rows(raw, W0: int, x: int, y: int, w: int, h: int) -> bytes:
    """A window of a raw CMYK raster W0 pixels wide, row by row (as gen1 cuts its window)."""
    mv = memoryview(raw)
    return b"".join(mv[((y + r) * W0 + x) * 4:((y + r) * W0 + x + w) * 4] for r in range(h))


def free_regions(regions: list, boxes: list, news_top: float, rows_first: bool = False) -> list[tuple]:
    """The news area's regions [(first column, columns, top mm, bottom mm)] with boxes (x0, y0, x1, y1 mm: the locked
    stories) cut out, as rectangles of whole columns for gen1's search:
    - columns first: beside a box the region's full height, the box's own columns above and below it;
    - rows first: above and below a box the region's full width, beside it only the box's own height.
    Every column a box touches is the box's. Edges are rounded inwards to the half-millimetre grid from the news area's
    top, so nothing laid out there reaches into a box and every module stays on the editor's grid; strips lower than a
    module can be (MIN_H_MM) are dropped. Unlike gen1's regions_for (around an ad block) no clearance is kept: a story
    may stand right under a locked one, as stories stand under each other."""
    def up(y):
        return news_top + math.ceil((y - news_top) / SNAP_MM - 1e-6) * SNAP_MM

    def down(y):
        return news_top + math.floor((y - news_top) / SNAP_MM + 1e-6) * SNAP_MM

    def keep(pieces):
        return [(c0, w, _r(t), _r(b)) for c0, w, t, b in pieces if w >= 1 and b - t >= MIN_H_MM - 1e-6]

    out = keep([(c0, w, up(t), down(b)) for c0, w, t, b in regions])
    for x0, y0, x1, y1 in sorted(boxes, key=lambda b: (b[1], b[0])):
        b0 = max(0, min(G.NCOL, math.floor((x0 - G.ORIGIN + 1.0) / G.PITCH)))
        b1 = max(b0 + 1, min(G.NCOL, math.ceil((x1 - G.ORIGIN - 1.0) / G.PITCH)))
        top, bot = down(y0), up(y1)                      # the box's rows, rounded outwards
        cut = []
        for c0, w, t, b in out:
            c1 = c0 + w
            if b1 <= c0 or b0 >= c1 or bot <= t or top >= b:       # the box is not in this region
                cut.append((c0, w, t, b))
                continue
            lo, hi = max(c0, b0), min(c1, b1)            # the box's columns in the region
            if rows_first:
                cut += [(c0, w, t, min(b, top)), (c0, w, max(t, bot), b),
                        (c0, lo - c0, max(t, top), min(b, bot)), (hi, c1 - hi, max(t, top), min(b, bot))]
            else:
                cut += [(c0, lo - c0, t, b), (hi, c1 - hi, t, b), (lo, hi - lo, t, min(b, top)), (lo, hi - lo, max(t, bot), b)]
        out = keep(cut)
    return out


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
        self.edit_path = run_dir / f"page-{page:02d}.edit.json"
        saved = read_json(self.edit_path, {})
        self.origin = {m["story"]: m for m in self._manifest_modules(man)}   # the layout's own places (undo returns there)
        if saved.get("modules") is not None and saved.get("page") == page:
            self.modules = saved["modules"]
        else:
            self.modules = self._manifest_modules(man)
        self.req_articles = req.get("articles") or []
        # the run's own pictures and plan (desk_engine.run_pictures, plan.json); a run made before they existed reads
        # the edition's photos and works its plan out again
        self.assets = run_dir if (run_dir / "photos" / "index.json").is_file() else edition_dir
        plan = read_json(run_dir / "plan.json", {})
        self.frozen = plan.get("stories") or engine.built(self.edition, self.req_articles, self.assets).plan()
        self._text_sig, overrides = self._text_file()
        self.articles = self._articles(overrides)
        self.built = engine.built(self.edition, self._treated(self.articles), self.assets, frozen=self.frozen)
        self.photo_dir = run_dir / "work" / f"page-{page:02d}" / "photos"
        self._link_photos()
        self.prints_folio = prints_folio(self.tpl, page, self.pages, self.day)
        self.folio_fields = self._live_fields()             # the edition's volume, issue and price as they are now
        self.keep, self.redo = DG.folio_plan(self.tpl, page, self.pages, self.day, self.folio_fields)
        self.fixed_boxes = [e["bbox_mm"] for e in self.keep if e["kind"] in FIXED_KINDS or (e["kind"] == "box" and e.get("fill"))]
        self.rev = int(saved.get("rev") or 0) if saved.get("page") == page else 0
        kept = [m for m in self.modules if m.get("story") in self.built.story_of]
        if len(kept) != len(self.modules):                  # a story whose articles are all gone: the page changed
            self.modules = kept
            self.rev += 1
            self._write_edit()
        self.modules = kept
        self._reset_crops()                              # a crop of a photo its story no longer has never prints
        self._fulls: dict = {}                           # photo id → the cache key of its whole raster (photo mode)
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
        self.built = self.engine.built(self.edition, self._treated(articles), self.assets, frozen=self.frozen)
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

    def _treatments(self) -> dict:
        """story → the treatment the editor chose for it on this page (stories left to the house rule are not in it)."""
        return {m["story"]: m["treatment"] for m in self.modules if m.get("treatment") is not None}

    def _treated(self, articles: list[dict]) -> list[dict]:
        """The articles as the engine sets them: each with the treatment its story's module chose ("treatment"), which
        wins over the house rule (Built, DA.assign_treatments). Remembers what it set (_retreat)."""
        t = self._treatments()
        self._built_treatments = t
        by = {a: t[k] for k, f in self.frozen.items() if k in t and not f["brief"] for a in f["articles"]}
        return [{**a, "treatment": by[a.get("id")]} if a.get("id") in by else a for a in articles]

    def _retreat(self) -> None:
        """A treatment chosen, changed or given back to the house rule: the stories are built again with the choices,
        and a story whose records changed is measured again (as for new text)."""
        if self._treatments() != getattr(self, "_built_treatments", {}):
            self._set_articles(self.articles)

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
        reset = self._reset_crops()                      # a photo replaced or removed: its crop goes
        if reset or mine & set(changed) or any(k not in self.built.story_of for k in mine):   # this page changed
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
        return [{"story": p["story"], "x": p["x_mm"], "y": p["y_mm"], "w": p["w_cols"], "h": p["h_mm"], "locked": False,
                 "crop": None} for p in man.get("placed") or []]

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
                except Exception as e:  # noqa: BLE001 — idle work never stops the editor; the setting is measured on use
                    log_error(e)
                    self.partial.discard(key)
                return True
            self.partial.discard(key)
            for cls in DG.RANK_CLASSES:
                self._measurers.pop((key, cls), None)
            try:
                self.engine.store_options(self.built, key, self.options[key])
            except OSError as e:                         # the cache is a convenience: measured again next time
                log_error(e)
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
        """The module's place on the grid (its attributes are not part of it): whole columns; y and h in whole steps
        from the news area's top (the search's grid), inside the news area: a module pushed past the foot stops there
        with its height (the editor shortens a module only when it is resized past the foot, and sends it so)."""
        w = max(1, min(G.NCOL, _round(_finite(m["w"]))))
        col = max(0, min(G.NCOL - w, _round((_finite(m["x"]) - G.ORIGIN) / G.PITCH)))
        top = self.tpl.news_top
        steps = int(math.floor((self.tpl.news_bottom - top) / SNAP_MM + 1e-9))
        least = int(math.ceil(MIN_H_MM / SNAP_MM - 1e-9))
        hk = max(least, min(steps, _round(_finite(m["h"]) / SNAP_MM)))
        yk = max(0, min(steps - hk, _round((_finite(m["y"]) - top) / SNAP_MM)))
        return {"story": m["story"], "x": _r(G.ORIGIN + col * G.PITCH), "y": _r(top + yk * SNAP_MM), "w": w,
                "h": _r(hk * SNAP_MM)}

    @staticmethod
    def _same_place(a: dict, b: dict) -> bool:
        """b (as the editor sends it) at a's place, width and height."""
        return (int(a["w"]) == _round(_finite(b["w"])) and abs(a["x"] - _finite(b["x"])) < SAME_MM
                and abs(a["y"] - _finite(b["y"])) < SAME_MM and abs(a["h"] - _finite(b["h"])) < SAME_MM)

    @staticmethod
    def _attrs(m: dict) -> dict:
        """A module's attributes, as the editor sends them: locked (true or false; missing is false), the photo crop
        (crop_value: missing or null is none) and the treatment (treatment_value: missing or null is the house rule's).
        Anything else is refused."""
        locked = m.get("locked")
        if locked is not None and not isinstance(locked, bool):
            raise ValueError(msg("m.edit.lockBool"))
        return {"locked": bool(locked), "crop": crop_value(m.get("crop")), "treatment": treatment_value(m.get("treatment"))}

    def set_modules(self, modules: list[dict]) -> None:
        """The page's new modules, as the editor sends them (each story at most once; only stories of the edition). A
        module the editor left where it was, or brought back to the layout's place (undo), keeps that exact position
        (the layout's own may be off the editor's grid, as below an advertisement); a moved one is snapped. Its
        attributes (the lock, the crop) never move it: only its place is compared. A story that is on another page
        stays there too until this page is saved (see export). A story's crop is the one its own module sends, kept only
        when it names the story's own photo: a crop naming another photo (another story's, a replaced or removed one)
        is dropped, so a crop never applies to another picture, and null (no crop) always wins. A story's treatment is
        the one its own module sends (a column of short items has none); a changed one sets its story again (_retreat).
        A module keeps a "treatment" key only while one is chosen, so a page without treatments stores what it did."""
        before = {m["story"]: m for m in self.modules}
        first = self._first(modules)
        sent = {k: self._attrs(m) for k, m in first.items()}
        briefs = {i["key"] for i in self.built.items if i["brief"]}
        out = []
        for k, m in first.items():
            self._ensure_options(k)
            p, o = before.get(k), self.origin.get(k)
            place = (dict(p) if p is not None and self._same_place(p, m) else
                     dict(o) if o is not None and self._same_place(o, m) else self.snap(m))
            crop = sent[k]["crop"]
            place.update(locked=sent[k]["locked"], crop=crop if crop is not None and crop["photo"] == self._photo_of(k) else None)
            place.pop("treatment", None)
            if sent[k]["treatment"] is not None and k not in briefs:
                place["treatment"] = sent[k]["treatment"]
            out.append(place)
        self.modules = out
        self._retreat()

    def _photo_of(self, key: str) -> str | None:
        """The story's photo as gen1 sets it (generate.Story: the largest of its pictures in the photo index), or None
        (no photo, or not a story of the edition now)."""
        st = self.built.story_of.get(key)
        ids = (st or {}).get("images") or []
        if not ids:
            return None
        idx = self.built.photos_idx
        ids = [i for i in ids if i in idx]
        return min(ids, key=lambda i: (-idx[i]["width_px"] * idx[i]["height_px"], i)) if ids else None

    def _reset_crops(self) -> list[str]:
        """Crops that cannot print as stored are dropped: their story's photo was replaced or removed (a crop never
        applies to another picture), or the stored crop is not one the engine writes. New module dicts, so a change
        undone afterwards (Update text that cannot set the page) gets the old ones back. → the stories."""
        gone = []
        for m in self.modules:
            c = m.get("crop")
            if c is not None:
                try:
                    ok = crop_value(c) == c and c["photo"] == self._photo_of(m["story"])
                except ValueError:
                    ok = False
                if not ok:
                    gone.append(m["story"])
        if gone:
            self.modules = [{**m, "crop": None} if m["story"] in gone else m for m in self.modules]
        return gone

    def _first(self, modules: list[dict]) -> dict:
        """story → its module, for each story of the edition at its first occurrence (as set_modules takes them)."""
        known, out = set(self.built.story_of), {}
        for m in modules:
            k = m.get("story")
            if k in known and k not in out:
                out[k] = m
        return out

    def _check_locks(self, modules: list[dict]) -> None:
        """Before a change is set: a locked story comes back at its place, width and height (it may come back unlocked
        there, so undo and unlocking work); it is not taken off the page; a story brought here is not locked on another
        page. A lock that is not true or false is refused. Nothing is set or written when it refuses."""
        first = self._first(modules)
        for m in first.values():
            self._attrs(m)
        for p in self.modules:
            if is_locked(p):
                m = first.get(p["story"])
                if m is None:
                    raise ValueError(msg("m.edit.lockedTake", name=self._name(p["story"])))
                if not self._same_place(p, m):
                    raise ValueError(msg("m.edit.lockedMove", name=self._name(p["story"])))
        mine = {p["story"] for p in self.modules}
        new = [k for k in first if k not in mine]
        if new:
            elsewhere = self.where()
            for k in new:
                there = elsewhere.get(k)
                if there and there["locked"]:
                    raise ValueError(msg("m.edit.lockedThere", name=self._name(k), page=there["page"]))

    def apply(self, modules: list[dict], base_rev=None) -> dict:
        """A change from the editor, set and drawn; if it cannot be set, the page stays as it was. A change the locks
        refuse (_check_locks) sets and writes nothing."""
        self.check_rev(base_rev)
        self._check_locks(modules)
        before = (list(self.modules), self.rev)
        try:
            self.set_modules(modules)
            self.rev += 1
            self._write_edit()
            return self.draw()
        except Exception:
            self.modules, self.rev = before
            self._retreat()
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
        gen1.main does), at most OVERSET_TRIES times; then the photo crops (_apply_crops). → (Builder, report, fixed
        items, placed, notes, text problems, photos)."""
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
        photos = self._apply_crops(B, n_fixed, g, placed)
        DG.draw_folios(B, self.tpl, self.engine.cx, self.redo, rep)
        text = []
        for st_ in rep["stories"]:
            lines = st_.get("overset_lines", 0)
            words = st_.get("overset_crosshead_words", 0)
            if lines or words:
                text.append({"kind": "overset", "stories": [st_["story"]], "lines": lines, "words": words})
            if st_.get("unset_paragraphs"):
                text.append({"kind": "unset", "stories": [st_["story"]], "paragraphs": st_["unset_paragraphs"]})
        return B, rep, n_fixed, placed, notes, text, photos

    def _apply_crops(self, B, n_fixed: int, g, placed: list) -> dict:
        """The page's photos as they print, after gen1's render. → {story: {"id", "px": [W0, H0], "box_mm" (the frame),
        "window": [x, y, w, h] (the photo's pixels in the frame), "ppi", "zoom", "zoom_max", "floor_ppi", "focus" (None:
        no crop), "item" (only when cropped: the picture's place in B.items)}}. A story whose module has a crop for its
        photo gets the crop's window instead of gen1's: gen1's picture of that photo is found by gen1's own rectangle,
        size and pixels (generate.render, its own expressions), each after the one found before, and replaced; if it
        is not there, the page is refused (nothing is set or written). Without a crop, gen1's pictures stay as they are."""
        crops = {m["story"]: m.get("crop") for m in self.modules}
        out, at = {}, n_fixed
        for i, x, y, w, h, o in placed:
            s, ph = g.stories[i], o["photo"]
            if not ph or not s.photo:
                continue
            W0, H0, floor = s.photo["w"], s.photo["h"], s.photo["min_ppi"]
            ph_top, ph_h, ph_w = y + ph["ph_top"], ph["ph_h"], ph["ph_w"]
            crop = crops.get(s.id)
            if crop is not None and crop.get("photo") != s.photo["id"]:
                crop = None                              # never another picture's crop
            win, zoom, zoom_max = crop_window(W0, H0, ph_w, ph_h, crop, floor)
            most = math.floor(zoom_max * 1000 + 1e-6) / 1000                # as shown: never more than allowed
            info = {"id": s.photo["id"], "px": [W0, H0], "box_mm": [_r(x), _r(ph_top), _r(x + ph_w), _r(ph_top + ph_h)],
                    "window": list(win), "ppi": round(min(win[2] / (ph_w / 25.4), win[3] / (ph_h / 25.4)), 1),
                    "zoom": min(round(zoom, 3), most), "zoom_max": most, "floor_ppi": round(floor, 1),
                    "focus": list(crop["focus"]) if crop else None}
            if crop is not None:
                raw = DG.gz_raw(s.photo["path"])
                if len(raw) != W0 * H0 * 4:
                    raise ValueError(msg("m.edit.photoDamaged", name=self._name(s.id)))
                gw = crop_window(W0, H0, ph_w, ph_h)[0]                     # gen1's own window, rectangle and pixels
                rect = (x * MM, (B.page_h - ph_top - ph_h) * MM, ph_w * MM, ph_h * MM)
                pixels = _rows(raw, W0, *gw)
                k = next((j for j in range(at, len(B.items)) if isinstance(B.items[j], X.Image)
                          and (B.items[j].x_pt, B.items[j].y_pt, B.items[j].w_pt, B.items[j].h_pt) == rect
                          and (B.items[j].width_px, B.items[j].height_px) == gw[2:] and B.items[j].cmyk_bytes == pixels),
                         None)
                if k is None:
                    raise ValueError(msg("m.edit.cropLost", name=self._name(s.id)))
                B.items[k] = dataclasses.replace(B.items[k], width_px=win[2], height_px=win[3],
                                                 cmyk_bytes=_rows(raw, W0, *win))
                info["item"], at = k, k + 1
            out[s.id] = info
        return out

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
        """The page: also_on_pages, its stories still on another page too (this page's save takes them off it);
        locked_on_pages, those of them locked there (this page cannot be saved until they are unlocked or taken off)."""
        _, notes = self.placed()
        elsewhere = self.where()
        also = [m["story"] for m in self.modules if m["story"] in elsewhere]
        treatments = DA.panels.available()          # the choices the editor offers; none: the paper has no treatments
        return {**({"treatments": treatments} if treatments else {}), "page": self.page, "role": self.role, "rev": self.rev, "modules": self.modules, "notes": notes,
                "problems": self.problems(notes, text),
                "pool": self.pool(elsewhere), "grid": self.grid(),
                "also_on_pages": {k: elsewhere[k]["page"] for k in also},
                "locked_on_pages": {k: elsewhere[k]["page"] for k in also if elsewhere[k]["locked"]}}

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
        """story → {"page": the other page it is on now, "locked": whether it is locked there}. A story on more than one
        other page (brought to one of them, not saved there yet) counts as locked when it is locked on any of them."""
        out = {}
        for n in range(1, self.pages + 1):
            if n != self.page:
                for m in self.page_modules(n):
                    k = m["story"]
                    if not (k in out and out[k]["locked"]):
                        out[k] = {"page": n, "locked": is_locked(m)}
        return out

    def _headline(self, key: str) -> str | None:
        """The story's headline (None: a column of short items)."""
        st = self.built.story_of[key]
        els = {e["id"]: e for e in self.built.els_of[key]}
        return els[st["headline"]]["text"] if st.get("headline") in els else None

    def _name(self, key: str) -> str:
        """The story in a message: its headline in quotes (shown as it is), or what it is."""
        head = self._headline(key) if key in self.built.story_of else None
        return data(f"“{head}”") if head else msg("m.name.shortColumn") if key in self.built.story_of else msg("m.name.aStory")

    def pool(self, elsewhere=None) -> list[dict]:
        """Stories of the edition not on this page (the editor can bring one in; one on another page moves here, unless
        it is locked there)."""
        on = {m["story"] for m in self.modules}
        elsewhere = self.where() if elsewhere is None else elsewhere
        out = []
        for it in self.built.items:
            k = it["key"]
            if k in on:
                continue
            there = elsewhere.get(k) or {}
            out.append({"story": k, "headline": self._headline(k) or "(short items)", "articles": self.built.article_of[k],
                        "brief": it["brief"], "on_page": there.get("page"), "locked": bool(there.get("locked"))})
        return out

    def _takes(self) -> dict:
        """What a save of this page takes off the other pages: {page: (the modules it keeps, the modules it loses)}."""
        mine = {m["story"] for m in self.modules}
        out = {}
        for n in range(1, self.pages + 1):
            if n != self.page:
                mods = self.page_modules(n)
                gone = [m for m in mods if m["story"] in mine]
                if gone:
                    out[n] = ([m for m in mods if m["story"] not in mine], gone)
        return out

    @staticmethod
    def _held(takes: dict) -> tuple[str, int] | None:
        """The first story a save would take off a page where it is locked: (story, page), else None."""
        for n in sorted(takes):
            for m in takes[n][1]:
                if is_locked(m):
                    return m["story"], n
        return None

    def take_from_other_pages(self) -> dict:
        """At save: the stories of this page leave every other page they are still on (that page's edits change; it
        must be opened, filled and saved again). A story locked on the other page never leaves it: then nothing is
        taken from any page (export refuses that save before it writes anything). → {page: [article ids it keeps]}."""
        takes = self._takes()
        held = self._held(takes)
        if held:
            raise ValueError(msg("m.edit.saveHeld", name=self._name(held[0]), page=held[1]))
        changed = {}
        for n, (keep, _) in sorted(takes.items()):
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

    # ---- moving a story to another page (push)
    def move_to(self, story: str, to, base_rev, open_page) -> dict:
        """The story leaves this page at once and goes into page to's edits (receive). Refused, before anything is
        written: an older view of this page, a story not on it, a page that is not another page of this layout or was
        not laid out, a story locked here, or one also on a third page and locked there. The other page is written
        first; if this page then cannot be set without the story, the story leaves the other page again (give_back), so
        it is never in no page's edits. A page with no free place for it refuses the move (receive), before anything is
        written. open_page(n) → page n's session (opened if need be). → this page drawn, plus "moved": {story, page, rev
        (that page's revision now), module (the story there), placed ("free": at a free place; "already": it was there
        already, brought in and not saved there yet), pinned (the page its article is pinned to, when that is not the
        page it moved to, else None: the next layout puts it back there)}."""
        self.check_rev(base_rev)
        m = next((x for x in self.modules if x["story"] == story), None)
        if m is None:
            raise ValueError(msg("m.edit.moveNotHere", name=self._name(story)))
        if not isinstance(to, int) or isinstance(to, bool) or not 1 <= to <= self.pages:
            raise ValueError(msg("m.edit.moveNoPage", page=to))
        if to == self.page:
            raise ValueError(msg("m.edit.moveSamePage", name=self._name(story)))
        if is_locked(m):
            raise ValueError(msg("m.edit.lockedMove", name=self._name(story)))
        if not (self.run_dir / f"page-{to:02d}.manifest.json").is_file():
            raise ValueError(msg("m.edit.moveNotLaidOut", page=to))
        held = [n for n in range(1, self.pages + 1) if n not in (self.page, to)
                and any(x["story"] == story and is_locked(x) for x in self.page_modules(n))]
        if held:                                 # the other page could not take it, nor be saved with it
            raise ValueError(msg("m.edit.moveLockedThere", name=self._name(story), page=held[0]))
        pinned = self._pinned(story, to)
        target = open_page(to)
        placed, module, before = target.receive(m)
        try:
            drawn = self.apply([x for x in self.modules if x["story"] != story])
        except Exception:
            if before is not None:
                target.give_back(before)
            raise
        return {**drawn, "moved": {"story": story, "page": to, "rev": target.rev, "module": module, "placed": placed,
                                   "pinned": pinned}}

    def receive(self, m: dict) -> tuple[str, dict, tuple | None]:
        """A story moved here from another page (move_to), m its module there: at its width, at the depth its text
        needs here (_depth), at the first free place (free_spot); unlocked, with the other attributes it had
        (set_modules takes them as for any change). With no free place for it the move is refused before anything is
        written: a story is never put over another (the press files would print them over each other). Set and written
        as a change of this page (apply: its locks are checked, and a page that cannot be set with it stays as it was).
        → (placed: "free" | "already", the story's module here, what give_back puts back: this page's stories and
        revision before, None when nothing changed). A story already here (brought in, not saved yet) stays as it is:
        "already"."""
        self.sync()
        key = m["story"]
        here = next((n for n in self.modules if n["story"] == key), None)
        if here is not None:
            return "already", here, None
        self._ensure_options(key)
        w = int(m["w"])
        h = self.snap({**m, "h": self._depth({**m, "h": self.snap(m)["h"]})})["h"]     # on this page's grid
        spot = self.free_spot(w, h)
        if spot is None:
            raise ValueError(msg("m.edit.moveNoRoom", page=self.page, name=self._name(key), w=w,
                                 cols="column" if w == 1 else "columns", h=h))
        x, y = spot
        before = (list(self.modules), self.rev)
        self.apply(self.modules + [{**m, "x": x, "y": y, "w": w, "h": h, "locked": False}])
        return "free", next(n for n in self.modules if n["story"] == key), before

    def give_back(self, before: tuple) -> None:
        """A move whose own page could not be set without the story: this page goes back to its stories and revision
        before receive (no answer has shown that revision), so the story is on its own page only, as before."""
        self.modules, self.rev = before
        self._retreat()
        self._write_edit()

    def _depth(self, m: dict) -> float:
        """The height m's story needs on this page at its width, as Fit height to text: from its height to the nearest
        one an option at that width fills (its height when one fills it already), with the story at its rank here (the
        page's order with it in it, so its options are those of that rank). Refused when it cannot be set at that width
        here (it would print nothing)."""
        key, w = m["story"], int(m["w"])
        kept = self.modules
        self.modules = kept + [m]
        try:
            g = self.generator()
            i = next(i for i, s in enumerate(g.stories) if s.id == key)
            if key in self.partial:
                self._measure(key, DG.rank_class(i), w)
            o, fit, by = self.pick(g.stories[i], w, m["h"])
        finally:
            self.modules = kept
        if o is None:
            raise ValueError(msg("m.edit.moveCannotSet", name=self._name(key), w=w,
                                 cols="column" if w == 1 else "columns", page=self.page))
        return m["h"] + by if fit == "over" else m["h"] - by if fit == "short" else m["h"]

    def free_spot(self, w: int, h: float) -> tuple[float, float] | None:
        """The first place for a module w columns wide and h high on this page as it is now: top to bottom in the
        editor's half-millimetre steps from the news area's top, then left to right by column; inside one of the
        template's regions and clear of every story and of the ads and pictures the page keeps (nothing reaches into
        them, not even by the half millimetre the checks allow). → (x, y) mm, or None when no place is free."""
        top = self.tpl.news_top
        steps = int(math.floor((self.tpl.news_bottom - top) / SNAP_MM + 1e-9))
        hk = _round(h / SNAP_MM)
        span = G.span_mm(w)
        regions = [G.region_box(r) for r in self.tpl.regions]
        boxes = [(x["x"], x["y"], x["x"] + G.span_mm(int(x["w"])), x["y"] + x["h"]) for x in self.modules]
        boxes += [tuple(f) for f in self.fixed_boxes]
        for yk in range(steps - hk + 1):
            y0, y1 = top + yk * SNAP_MM, top + (yk + hk) * SNAP_MM
            for col in range(G.NCOL - w + 1):
                x0 = G.ORIGIN + col * G.PITCH
                x1 = x0 + span
                if (any(x0 >= r[0] - SAME_MM and x1 <= r[2] + SAME_MM and y0 >= r[1] - SAME_MM and y1 <= r[3] + SAME_MM
                        for r in regions)
                        and not any(min(x1, b[2]) - max(x0, b[0]) > SAME_MM and min(y1, b[3]) - max(y0, b[1]) > SAME_MM
                                    for b in boxes)):
                    return _r(x0), _r(y0)
        return None

    def _pinned(self, key: str, to: int) -> int | None:
        """The page the story's article is pinned to in the edition now, when that is not page to (the next layout
        puts it back there), else None. A column of short items has no pin of its own. The layout's own pin when the
        edition's articles cannot be read."""
        it = next((i for i in self.built.items if i["key"] == key), None)
        if it is None or it["brief"]:
            return None
        try:
            live = read_json(self.edition_dir / "articles.json", {"articles": []}).get("articles") or []
            by_id = {a.get("id"): a for a in live if isinstance(a, dict)}
            pins = [by_id[a].get("page") for a in self.built.article_of.get(key, []) if a in by_id]
        except Exception:  # noqa: BLE001 — a warning never refuses a move: the layout's own pin then
            pins = [it.get("pin")]
        pin = next((p for p in pins if isinstance(p, int) and not isinstance(p, bool) and 1 <= p <= self.pages), None)
        return pin if pin != to else None

    # ---- other layouts and fresh text
    def alternative(self, variant: int, base_rev=None) -> dict:
        """Another complete layout of the same stories (gen1 alternatives): 1 the lead on the other side, 2 the lead at
        another width, 3 both. Locked stories stay exactly as they are and the others are laid out in the space around
        them (free_regions), the first exact fill of: the page's short height kept, then the whole news area; columns
        first, then rows first. The lead's side and width change only when the lead is not locked. Set as an edit (the
        editor can undo it); if nothing fills the space exactly, or it cannot be set, the page stays as it was."""
        self.check_rev(base_rev)
        keys = self.order()
        if not keys:
            raise ValueError(msg("m.edit.noStories"))
        held = [m for m in self.modules if is_locked(m)]
        locked = {m["story"] for m in held}
        free = [k for k in keys if k not in locked]
        if not free:
            raise ValueError(ALL_LOCKED)
        if len(free) > G.MAX_STORIES:
            raise ValueError(msg("m.edit.tooManyFree" if held else "m.edit.tooMany", n=len(free), max=G.MAX_STORIES))
        g = self._free_generator(keys, free) if held else self.generator()
        lead = None if keys[0] in locked else next((m for m in self.modules if m["story"] == keys[0]), None)
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
        if held:
            tries = self._around(tries, held)
        res = None
        try:
            for regions in tries:
                res, info = g.run(regions, self.engine.cal.span_prior, side)
                if res is not None:
                    break
        finally:
            g.ban_lead = set()
        if res is None:
            raise ValueError(NO_FILL_AROUND if held else msg("m.edit.noFill"))
        placed = [pl for k, tree in res[1] for pl in g.place(tree, G.ORIGIN + regions[k][0] * G.PITCH, regions[k][2])]
        if sorted(g.stories[i].id for i, *_ in placed) != sorted(free):      # never a story lost on the way
            raise ValueError(msg("m.edit.notAllPlaced"))
        crop = {m["story"]: m.get("crop") for m in self.modules}             # a crop goes with its story
        tr = self._treatments()                                              # and so does a treatment
        return self.apply([dict(m) for m in held] + [{"story": g.stories[i].id, "x": x, "y": y, "w": w, "h": h,
                                                      "locked": False, "crop": crop.get(g.stories[i].id),
                                                      **({"treatment": tr[g.stories[i].id]} if g.stories[i].id in tr else {})}
                                                     for i, x, y, w, h, o in placed])

    def _around(self, areas: list, held: list[dict]) -> list:
        """Where the stories that are not locked may go: each area with the locked stories (held) cut out, columns
        first, then rows first, without repeats. Each bottom goes 0.01 mm further down, as for the short height, so
        gen1's count of whole steps never loses the last one to rounding."""
        boxes = [(m["x"], m["y"], m["x"] + G.span_mm(int(m["w"])), m["y"] + m["h"]) for m in held]
        out = []
        for area in areas:
            for rows_first in (False, True):
                regions = [(c0, w, t, b + 0.01) for c0, w, t, b in free_regions(area, boxes, self.tpl.news_top, rows_first)]
                if regions and regions not in out:
                    out.append(regions)
        return out

    def _free_generator(self, keys: list[str], free: list[str]) -> DG.DeskGenerator:
        """gen1's search over the stories that are not locked (free), each at its rank on the page (keys: the page's
        order), so the span costs, the options (by rank class), the headline hierarchy and the lead are the whole
        page's. The rows added after an overset are shared with the page's own generator."""
        rank = {k: 1000.0 - i for i, k in enumerate(keys)}
        els = [{**e, "size_pt": rank[k]} if e["kind"] == "headline" else e for k in free for e in self.built.els_of[k]]
        kept = {e["id"] for e in self.keep}
        model = {**self.tpl.model, "elements": self.keep + els, "stories": [self.built.story_of[k] for k in free],
                 "unassigned": [u for u in self.tpl.model.get("unassigned", []) if u in kept]}
        pre = {f"{k}|{w}|{cls}": o for k in free for cls, byw in self.options[k].items() for w, o in byw.items()}
        g = DG.DeskGenerator(self.engine.cx, model, self.photo_dir, self.engine.cal.styles, set(free),
                             self.engine.cal.space_em, pre)
        g.extra_rows = self.extra_rows
        for s in g.stories:                          # before anything is measured: display() caches by rank
            s.rank = keys.index(s.id)
        return g

    def refresh_text(self, base_rev=None) -> dict:
        """The articles' current text (edited since the layout) set on the page. Changed stories are measured again;
        the new text is kept for the run (edit-articles.json), so every page of the run uses it. An article deleted
        from the edition since leaves the page. The run's plan is kept (Built, frozen): an article that would now be a
        story rather than a short item, or the other way round, is reported and changes at the next layout. If the page
        cannot be set with the new text, nothing changes (the run's ads included). Refused on an older revision, as a
        change is. → the page, plus "changed" (stories set with new text), "dropped" (stories that left the page),
        "removed" (articles no longer printed on it), "kind_changes", "folio_changed", "ads_changed", "crops_reset"
        (stories whose photo crop was dropped: their photo was replaced or removed)."""
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
                        "folio_changed": False, "ads_changed": [], "crops_reset": []}
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
            crops_reset = self._reset_crops()            # a photo replaced or removed: its crop never prints on another
            if changed or dropped or removed or folio_changed or ads_changed or crops_reset:
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
                "folio_changed": folio_changed, "ads_changed": ads_changed, "crops_reset": crops_reset}

    def draw(self) -> dict:
        """The page as a display list (mm, y down), with the fonts and pictures it needs from the cache. A cropped photo
        is drawn from its whole raster ("src") and the part of it that prints ("sub": x, y, w, h as fractions of the
        whole), so a pan never adds a raster to the cache; the note of each story with a photo has "photo" (as
        _apply_crops gives it, with "full": the key of the whole raster, None when it cannot be read)."""
        B, rep, n_fixed, placed, notes, text, photos = self.render()
        H = self.tpl.page_h
        fonts = {}
        for fk, ef in B.fonts.items():
            h = hashlib.sha256(ef.face_bytes).hexdigest()[:24]
            f = self.engine.cache_dir("fonts") / f"{h}.ttf"
            if not f.exists():
                _atomic(f, ef.face_bytes)
            fonts[fk] = {"face": h, "upem": ef.upem}
        for p in photos.values():
            p["full"] = self._full_raster(p["id"], *p["px"])
        cut = {p["item"]: p for p in photos.values() if "item" in p}
        items = []
        for k, it in enumerate(B.items):
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
                box = {"t": "img", "x": _r(it.x_pt / MM), "y": _r(H - (it.y_pt + it.h_pt) / MM), "w": _r(it.w_pt / MM),
                       "h": _r(it.h_pt / MM)}
                p = cut.get(k)
                if p is not None and p["full"]:
                    (W0, H0), (wx, wy, ww, wh) = p["px"], p["window"]
                    items.append({**box, "src": p["full"], "sub": [wx / W0, wy / H0, ww / W0, wh / H0]})
                else:
                    items.append({**box, "src": self._raster_key(it.cmyk_bytes, it.width_px, it.height_px)})
        state = self.state(text)
        for n in state["notes"]:
            p = photos.get(n["story"])
            if p is not None:
                n["photo"] = {k: v for k, v in p.items() if k != "item"}
        return {**state, "items": items, "fonts": fonts, "fixed_items": n_fixed}

    def _raster_key(self, data: bytes, width_px: int, height_px: int) -> str:
        """A raster in the cache the server makes the screen's pictures from (rasters/<key>.cmyk and its size), keyed by
        its content. Each use marks it used (prune_rasters keeps it); one the cache pruned is written again."""
        h = hashlib.sha1(data).hexdigest()[:24]
        d = self.engine.cache_dir("rasters")
        if not raster_used(d, h):
            _atomic(d / f"{h}.cmyk", data)
            write_json(d / f"{h}.json", {"width_px": width_px, "height_px": height_px})
            _maybe_prune(d)
        return h

    def _full_raster(self, pid: str, W0: int, H0: int) -> str | None:
        """The cache key of a photo's whole raster, the run's own as it prints (the page's photo folder), for the
        editor's photo mode and cropped photos; kept for the session (a photo id's pixels never change), marked used on
        each draw and written again if the cache pruned it. None when it cannot be read: the page is drawn without it."""
        key = self._fulls.get(pid)
        if pid not in self._fulls or (key is not None and not raster_used(self.engine.cache_dir("rasters"), key)):
            try:
                raw = DG.gz_raw(self.photo_dir / f"{pid}.cmyk.gz")
            except (OSError, EOFError, zlib.error):      # missing, cut short or damaged
                raw = None
            self._fulls[pid] = self._raster_key(raw, W0, H0) if raw is not None and len(raw) == W0 * H0 * 4 else None
        return self._fulls[pid]

    def export(self, base_rev=None) -> dict:
        """The edited page as its PDF/X-1a page file (the run's page-NN.pdf; the auto layout kept as page-NN.auto.pdf).
        Stories brought here from other pages leave them now. → file, problems, this page's articles, pages changed.
        A save that would take a story off a page where it is locked is refused before anything is set or written (the
        server checks it too, before it marks any page)."""
        self.check_rev(base_rev)
        held = self._held(self._takes())
        if held:
            raise ValueError(msg("m.edit.saveHeld", name=self._name(held[0]), page=held[1]))
        B, rep, n_fixed, placed, notes, text, photos = self.render()
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
                "printed": self.printed(articles, photos)}

    def printed(self, articles: list, photos: dict | None = None) -> dict:
        """What the page prints (deskprinted): its articles' text and photos, its folio fields, its ads, and, when a
        photo prints cropped, "crops": {article id: deskprinted.crop_sig} (photos: render's). The crops are recorded,
        never compared with the edition (it has none): they are the page's own edits, covered by its revision."""
        by_id, briefs = {a.get("id"): a for a in self.articles}, deskprinted.briefs_of(self.frozen)
        ads = deskprinted.ad_sigs(self.run_dir / "ads")
        out = {"v": deskprinted.VERSION,
               "articles": {a: deskprinted.article_sig(by_id[a], a in briefs) for a in articles if a in by_id},
               "folio": deskprinted.folio_sig(self.folio_fields) if self.prints_folio else None,
               "ads": {s["slot"]: ads.get(s["slot"]) for s in self.tpl.ad_slots}}
        crops = {a: deskprinted.crop_sig(p["id"], *p["px"], p["window"]) for k, p in (photos or {}).items() if "item" in p
                 for a in self.built.article_of.get(k, []) if a in articles}
        if crops:
            out["crops"] = crops
        return out


def _atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_bytes(data)
    tmp.chmod(0o600)
    tmp.replace(path)


# ------------------------------------------------------------------------------------------- the raster cache
RASTER_NAME = re.compile(r"([0-9a-f]{24})\.(json|cmyk|jpg)")   # rasters/<key>.<ext>: nothing else there is touched
RASTER_UNUSED_S = 24 * 3600      # an entry not used for a day goes
RASTER_OPEN_S = 3600             # never one used within the hour: a page open in the editor keeps its pictures
# a whole raster is at most 16 MB (2000 px square, CMYK) and the pilot's largest 8.6 MB (1800 x 1200): 2 GiB holds
# every photo of its biggest edition (109) at that size, twice over
RASTER_CAP = 2 << 30
RASTER_PRUNE_EVERY_S = 300       # in each process, when it writes a raster
_pruned_at = 0.0


def raster_used(d: Path, key: str) -> bool:
    """Marks a cached raster used now (its .json's time is its last use) → whether it is whole (else it is written
    again)."""
    try:
        os.utime(d / f"{key}.json")
    except FileNotFoundError:
        return False
    return (d / f"{key}.cmyk").is_file()


def prune_rasters(d: Path, now: float) -> None:
    """Deletes the cached rasters (each key's .json, .cmyk and .jpg) not used for RASTER_UNUSED_S, and while the folder
    is still over RASTER_CAP the least recently used first, but never one used within RASTER_OPEN_S. The .json goes
    first, so a writer writes the whole entry again; a file already gone is fine (several processes prune one home).
    Only regular files named as the cache names them; a link is never followed."""
    used: dict[str, float] = {}
    size: dict[str, int] = {}
    with os.scandir(d) as files:
        for f in files:
            m = RASTER_NAME.fullmatch(f.name)
            try:
                st = f.stat(follow_symlinks=False) if m else None
            except FileNotFoundError:
                continue
            if st is not None and stat.S_ISREG(st.st_mode):
                used[m[1]] = max(used.get(m[1], 0.0), st.st_mtime)   # its newest file: a writer's .cmyk before its .json
                size[m[1]] = size.get(m[1], 0) + st.st_size
    total = sum(size.values())
    for key in sorted(used, key=used.__getitem__):                   # least recently used first
        age = now - used[key]
        if age <= RASTER_OPEN_S or (age <= RASTER_UNUSED_S and total <= RASTER_CAP):
            continue
        try:
            if now - os.stat(d / f"{key}.json", follow_symlinks=False).st_mtime <= RASTER_OPEN_S:
                continue                                             # used since the folder was read
        except FileNotFoundError:
            pass
        for ext in ("json", "cmyk", "jpg"):
            (d / f"{key}.{ext}").unlink(missing_ok=True)
        total -= size[key]


def _maybe_prune(d: Path) -> None:
    """prune_rasters, at most every RASTER_PRUNE_EVERY_S in this process."""
    global _pruned_at
    now = time.time()
    if now - _pruned_at >= RASTER_PRUNE_EVERY_S:
        _pruned_at = now
        try:
            prune_rasters(d, now)
        except OSError as e:                     # the cache is a convenience: pruned again on a later write
            log_error(e)


def request_ok(req: dict, keys: tuple) -> None:
    missing = [k for k in keys if k not in req]
    if missing:
        raise ValueError(msg("m.edit.missing", fields=data(", ".join(missing))))


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
