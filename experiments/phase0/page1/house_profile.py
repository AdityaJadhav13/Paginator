"""EXP-PAGE-1 house profile: learn a newspaper's DESIGN LANGUAGE from its own printed editions (EXPERIMENTAL).

Measures, from the paper's own press PDFs, the rules a page composer (and later a layout generator) needs to build pages
that look like the paper: page geometry, grid, type specs per role, vertical rhythm, rules and boxes, images and
captions, furniture, page composition, headline shape practice and the paper's other habits. Evidence tooling only:
nothing here is a layout decision. Data-driven and deterministic: no publication name, date, text or sample id is built
in or written to the repo; every tolerance below is a general typographic one, fixed before the run.

Usage (repo root):  PYTHONDONTWRITEBYTECODE=1 experiments/phase0/published1/.venv/bin/python \
                      experiments/phase0/page1/house_profile.py <dataset_dir> [--no-figures]
Inputs (published1 and head1 outputs; read only):
  <ds>/samples/<id>/{source.pdf,manifest.json}; <ds>/work/<id>/corrected.json (else measure.json; a top-level
  "excluded" key skips the sample, an "excluded" frame is ignored); <ds>/report/headlines.jsonl (display frames and
  roles), headline_practice.json (display aggregates), paragraphs.jsonl (verified body paragraphs),
  head1/head1_rows.json.gz (headline line-break evaluation).
Outputs:
  experiments/phase0/results/page1/house_profile.json   schema pageinator.page1.house_profile/1, AGGREGATES ONLY
                                                         (no text, sample ids, dates, names or images); every value
                                                         carries n and spread (dist = n, min, p10, median, p90, max)
  <ds>/report/page1/house_profile.md                    private plain-language summary for the owner (mode 600)
  <ds>/report/page1/profile_figs/*.png                  private annotated page renders (mode 600)

PIPELINE (per page; PDF points y-up internally; reported positions are mm from the trim box's top-left corner)
 1 Scan: one pdfminer pass with a device that records every glyph (advance box, baseline, size, font, fill colour,
   horizontal scale, text render mode) and every painted path (geometry after the CTM, stroke/fill, NATIVE colour values:
   pdfminer keeps a stale colour-space name after k/K, so the tuple length decides gray/RGB/CMYK). PDFium page objects
   (pypdfium2) give the top-level paths in the same content order (zipped and asserted geometry-identical; degenerate
   point paths that PDFium drops are skipped) with their true stroke width (PDFium honours ExtGState LW and the PDF
   default 1.0; pdfminer does not), plus images (visible area = bounds intersected with clip-path boxes, as
   published1/headlines.py) and forms. Glyphs on the pasteboard (outside the trim) are not printed and are dropped.
 2 Page model: body runs from the measured body frames (minus lines that headlines.py reclaimed as display text), split
   at baseline steps > RUN_BREAK x leading; non-body measured frames in the page body face and size band are kept as
   body-text FRAGMENTS (spacing and areas only); display frames with roles from headlines.jsonl; images; rules (thin
   paths); boxes (rectangles and rounded rectangles; each text run belongs to the topmost box behind it).
 3 Sections and page types: script per page (Devanagari share of glyph text); a section is a run of same-script pages.
   The "top block" of a page is the union of graphics touching its topmost graphic at least TOPBLOCK_MIN_W of the page
   wide. The page whose top block is tallest in its section, and >= 2x the section's median top block, carries the
   nameplate: FRONT. The page at the other end of the section is BACK (sections of >= 3 pages); the rest INSIDE. Reading
   order runs away from the front (dual-language editions are flip format). Running-head variants are clusters of the
   other pages' top blocks (height to 1 mm, bar fill colour).
 4 Recurrence (furniture): a glyph run recurs when its exact text sits within POS_TOL_MM in >= RECUR_EDITIONS editions
   (static); one font and size at one position with changing text inside the top block or at the page foot is a
   variable slot (date line); a numeric recurring run in the top block is the folio. Images and forms of the same box in
   >= RECUR_EDITIONS editions recur; recurring graphics (>= 25 x 25 mm) and boxes holding >= 3 static runs below the top
   block seed blocks (expanded to the graphics touching them): IMPRINT (page foot, <= 25 mm tall), STANDING MODULE
   (narrower than two columns) or AD.
 5 Column stacks: every element (body run, display frame, photo, rule, box edge) outside ads and standing blocks is put
   in each 8-column grid column it covers (>= COL_COVER of the column or of its own width); consecutive elements of a
   column are vertical neighbour pairs (deduplicated across columns) unless an element straddles the gap or a printed
   glyph lies between them (text no element models). Distances: text->text baseline to baseline (B2B), text->graphic last
   baseline to the graphic's top edge, graphic->text edge to first baseline, graphic->graphic edge to edge; also in body
   leadings (the run's leading, else the page's).
 6 Column sets: side-by-side body frames of one width, one gutter apart, chained; M frames whose total width is an
   N-column span = a story set in M text columns across N grid columns (the 50 mm "6-column" measure is 4 in 3).
 7 Stories: a story is a main headline (not a stacked continuation "S"); its opening is the leftmost body run reached
   downwards through deck, byline, photos and box edges. A run-in dateline is a colon (or a spaced dash) within
   DATELINE_MM of the start of that first line. Photos (>= PHOTO_MIN_MM, not furniture, recurring or in an ad) are placed
   below/above/beside their headline or in the text flow from the column stacks (box edges are transparent); stand-alone
   photos >= AD_MIN_AREA_MM2 are listed as possible one-off ads (geometry cannot tell them from photos).
 8 Aggregates by page type, span, size band and alignment; headline shape from headlines.jsonl (all multi-line main
   headlines) and from the head1 rows (the "choice" subset: comparable, multi-line, >= 2 layouts).
 9 Validation: grid, gutter (also measured directly between columns), body size mode, headline median and centred share
   against the earlier reports; a pixel check of rules, photo edges and body baselines on rendered pages.
"""
from __future__ import annotations

import argparse
import ctypes
import gzip
import json
import math
import os
import re
import statistics as st
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / "published1"))
import headlines as HL  # noqa: E402  (read only: grid estimate, dist/q helpers, the photo-area rule)
import overlay as OV  # noqa: E402  (read only: the minimal PNG writer)
import pypdfium2 as pdfium  # noqa: E402
import pypdfium2.raw as PR  # noqa: E402
from pdfminer.converter import PDFPageAggregator  # noqa: E402
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager  # noqa: E402
from pdfminer.pdfpage import PDFPage  # noqa: E402
from pdfminer.utils import apply_matrix_pt  # noqa: E402

SCHEMA = "pageinator.page1.house_profile/1"
TOOL = "page1/house_profile.py 1.0.0"
OUT_JSON = REPO / "experiments" / "phase0" / "results" / "page1" / "house_profile.json"
MM = 72 / 25.4

# general tolerances (fixed before the run; none is specific to one paper)
POS_TOL_MM = 2.0                   # same position across editions
RECUR_EDITIONS = 3                 # furniture: present in >= 3 editions (headlines.py RECUR_EDITIONS)
RULE_MAX_MM = 1.0                  # a path thinner than this (incl. stroke) and ...
RULE_MIN_LEN_MM = 8.0              # ... at least this long is a rule
BOX_MIN_MM = 4.0                   # a rectangle at least this big in both directions is a box
TOPBLOCK_MIN_W = 0.4               # top block: graphics at least 40 % of the page width
COL_COVER = 0.5                    # column-stack membership
RUN_BREAK = 1.6                    # a body run ends at a baseline step > 1.6 x leading
SAME_LINE_MM = 0.6                 # two baselines closer than this are one line (run-in)
DATELINE_MM = 30.0                 # a run-in dateline ends (':' or a spaced dash) within 30 mm of the line start
PAIR_MAX_LEAD = 12.0               # neighbour pairs farther apart than 12 body leadings are not spacing evidence
AD_MIN_AREA_MM2 = 40 * 40          # a non-story graphic block at least this big is reported as a probable ad
PHOTO_MIN_MM = HL.PHOTO_MIN_MM     # (15, 10) mm, as published1/headlines.py
GRID_SNAP_MM = 3.0                 # an element edge within 3 mm of a grid column edge is "on the grid"
dist = HL.dist
share = HL.share


def d1(xs, nd=2):
    return dist([x for x in xs if x is not None], nd)


def counts(c: Counter, n=None) -> dict:
    n = sum(c.values()) if n is None else n
    return {"n": n, "shares": {str(k): share(v, n) for k, v in sorted(c.items(), key=lambda kv: (-kv[1], str(kv[0])))}}


def base_font(name: str) -> str:
    return HL.base_font(name or "")


def family_of(font: str) -> str:
    """Face family = base font name without a weight/style suffix (typeface names, not content)."""
    f = base_font(font)
    return re.split(r"[-,]", f)[0] if f else f


def cmyk_of(v):
    """Native colour tuple → CMYK (gray converted; RGB kept as rgb)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return ("cmyk", (0.0, 0.0, 0.0, round(1 - float(v), 3)))
    v = tuple(float(x) for x in v)
    if len(v) == 4:
        return ("cmyk", tuple(round(x, 3) for x in v))
    if len(v) == 1:
        return ("cmyk", (0.0, 0.0, 0.0, round(1 - v[0], 3)))
    if len(v) == 3:
        return ("rgb", tuple(round(x, 3) for x in v))
    return None


def colour_name(c) -> str:
    """Plain name of a colour for the owner's summary (approximate; the profile keeps the values)."""
    if not c:
        return "none"
    space, v = c
    if space == "rgb":
        return "rgb" + str(v)
    cc, m, y, k = v
    if max(v) < 0.03:
        return "white (paper)"
    if cc < 0.05 and m < 0.05 and y < 0.05:
        return "black" if k >= 0.95 else f"grey {round(k * 100)}%"
    hue = {(1, 0, 0): "cyan/blue", (0, 1, 0): "magenta", (0, 0, 1): "yellow", (1, 1, 0): "blue/violet",
           (0, 1, 1): "red", (1, 0, 1): "green"}
    key = tuple(int(x >= 0.5) for x in (cc, m, y))
    base = hue.get(key, "dark" if k > 0.5 else "mixed")
    if key == (0, 0, 0):
        base = "pale tint"
    tint = max(cc, m, y)
    return base + (" (light tint)" if tint < 0.5 and key != (0, 0, 0) else "") + (" + black" if k >= 0.2 else "")


# ------------------------------------------------------------------------------------------------- PDF scan
class _ScanDevice(PDFPageAggregator):
    """Records glyphs (with fill colour) and painted paths (geometry after the CTM, native colours, form depth)."""

    def __init__(self, rsrc):
        super().__init__(rsrc, laparams=None)
        self.glyphs, self.paths, self.depth, self._inpath = [], [], 0, False

    def begin_figure(self, name, bbox, matrix):
        self.depth += 1
        return super().begin_figure(name, bbox, matrix)

    def end_figure(self, name):
        self.depth -= 1
        return super().end_figure(name)

    def render_string(self, textstate, seq, ncs, graphicstate):
        self._tr = textstate.render          # text render mode (2 = fill + stroke: a "faux bold")
        return super().render_string(textstate, seq, ncs, graphicstate)

    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate):
        adv = super().render_char(matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate)
        ch = self.cur_item._objs[-1]
        a, b, c, d, e, f = ch.matrix
        self.glyphs.append((ch.x0, ch.x1, f, ch.size, base_font(ch.fontname), cmyk_of(graphicstate.ncolor),
                            (a / d) if d else 1.0, abs(b) < 1e-6 and abs(c) < 1e-6 and d > 0, ch.get_text(), getattr(self, "_tr", 0)))
        return adv

    def paint_path(self, gstate, stroke, fill, evenodd, path):
        if self._inpath:                    # pdfminer recurses once per subpath: record the painted path once
            return super().paint_path(gstate, stroke, fill, evenodd, path)
        self._inpath = True
        try:
            pts = []
            for seg in path:
                nums = seg[1:]
                for k in range(0, len(nums) - 1, 2):
                    pts.append(apply_matrix_pt(self.ctm, (nums[k], nums[k + 1])))
            bbox = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)) if pts else None
            self.paths.append({"depth": self.depth, "bbox": bbox, "ops": "".join(s[0] for s in path), "stroke": bool(stroke),
                               "pts": pts if len(pts) <= 24 else None,
                               "fill": bool(fill), "scol": cmyk_of(gstate.scolor) if stroke else None,
                               "fcol": cmyk_of(gstate.ncolor) if fill else None})
            return super().paint_path(gstate, stroke, fill, evenodd, path)
        finally:
            self._inpath = False


def _pdfium_path_bbox(obj):
    m = PR.FS_MATRIX()
    PR.FPDFPageObj_GetMatrix(obj.raw, m)
    xs, ys = [], []
    for k in range(PR.FPDFPath_CountSegments(obj.raw)):
        seg = PR.FPDFPath_GetPathSegment(obj.raw, k)
        x, y = ctypes.c_float(), ctypes.c_float()
        if PR.FPDFPathSegment_GetPoint(seg, x, y):
            xs.append(m.a * x.value + m.c * y.value + m.e)
            ys.append(m.b * x.value + m.d * y.value + m.f)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def _visible(obj):
    """Bounds intersected with the clip-path boxes (published1/headlines.py photos())."""
    l, b, r, t = obj.get_pos()
    cp = PR.FPDFPageObj_GetClipPath(obj.raw)
    if cp:
        for k in range(PR.FPDFClipPath_CountPaths(cp)):
            xs, ys = [], []
            for j in range(PR.FPDFClipPath_CountPathSegments(cp, k)):
                seg = PR.FPDFClipPath_GetPathSegment(cp, k, j)
                x, y = ctypes.c_float(), ctypes.c_float()
                if PR.FPDFPathSegment_GetPoint(seg, x, y):
                    xs.append(x.value)
                    ys.append(y.value)
            if xs:
                l, b, r, t = max(l, min(xs)), max(b, min(ys)), min(r, max(xs)), min(t, max(ys))
    return l, b, r, t


def scan_page(pdf_path: Path, pdoc, page_no: int) -> dict:
    rsrc = PDFResourceManager()
    dev = _ScanDevice(rsrc)
    interp = PDFPageInterpreter(rsrc, dev)
    with open(pdf_path, "rb") as fh:
        for i, pg in enumerate(PDFPage.get_pages(fh), 1):
            if i == page_no:
                interp.process_page(pg)
                break
    page = pdoc[page_no - 1]
    images, forms, fpaths = [], [], []
    for obj in page.get_objects(max_depth=0):
        if obj.type == PR.FPDF_PAGEOBJ_IMAGE:
            l, b, r, t = _visible(obj)
            if r - l > 0.5 and t - b > 0.5:
                images.append((l, b, r, t))
        elif obj.type == PR.FPDF_PAGEOBJ_FORM:
            forms.append(tuple(obj.get_pos()))
        elif obj.type == PR.FPDF_PAGEOBJ_PATH:
            sw = ctypes.c_float()
            PR.FPDFPageObj_GetStrokeWidth(obj.raw, sw)
            fm, sk = ctypes.c_int(), ctypes.c_int()
            PR.FPDFPath_GetDrawMode(obj.raw, fm, sk)
            fpaths.append({"bbox": _pdfium_path_bbox(obj), "sw": round(sw.value, 3), "fillmode": fm.value,
                           "stroke": bool(sk.value), "nseg": PR.FPDFPath_CountSegments(obj.raw)})
    # zip pdfminer's top-level paths with PDFium's (content order); PDFium drops degenerate point paths
    mp = [p for p in dev.paths if p["depth"] == 0]
    paths, j = [], 0
    for fp in fpaths:
        while j < len(mp) and (mp[j]["bbox"] is None or (mp[j]["bbox"][2] - mp[j]["bbox"][0] < 1e-3 and mp[j]["bbox"][3] - mp[j]["bbox"][1] < 1e-3)) \
                and not (fp["bbox"] and mp[j]["bbox"] and max(abs(u - v) for u, v in zip(mp[j]["bbox"], fp["bbox"])) < 0.05):
            j += 1
        if j >= len(mp) or not fp["bbox"] or max(abs(u - v) for u, v in zip(mp[j]["bbox"], fp["bbox"])) >= 0.05:
            raise RuntimeError(f"{pdf_path} p{page_no}: PDFium and pdfminer paths disagree at PDFium path {len(paths)}")
        paths.append(dict(mp[j], sw=fp["sw"], fillmode=fp["fillmode"], nseg=fp["nseg"]))
        j += 1
    return {"glyphs": dev.glyphs, "paths": paths, "images": images, "forms": forms, "size": page.get_size()}


# ------------------------------------------------------------------------------------------------- dataset
def load_dataset(ds: Path) -> dict:
    sids, docs, mans, skipped = [], {}, {}, []
    for sid in sorted(p.name for p in (ds / "samples").iterdir() if p.is_dir()):
        doc = json.loads(HL.wpath(ds, sid).read_text())
        if "excluded" in doc:
            skipped.append(sid)
            continue
        sids.append(sid)
        docs[sid] = doc
        mans[sid] = json.loads((ds / "samples" / sid / "manifest.json").read_text())
    heads = defaultdict(list)
    with open(ds / "report" / "headlines.jsonl") as fh:
        for line in fh:
            r = json.loads(line)
            heads[(r["sample"], r["page"])].append(r)
    paras = [json.loads(line) for line in open(ds / "report" / "paragraphs.jsonl")]
    practice = json.loads((ds / "report" / "headline_practice.json").read_text())
    rows = json.loads(gzip.open(ds / "report" / "head1" / "head1_rows.json.gz").read())
    # editions in date order (dates are used for ordering and the calibration/test split only; never written to the repo)
    sids.sort(key=lambda s: (mans[s].get("edition_date") or "", s))
    return {"sids": sids, "docs": docs, "mans": mans, "skipped": skipped, "heads": heads, "paras": paras,
            "practice": practice, "head1": rows}


def display_kind(r: dict) -> str:
    role, why = r["role"], r["role_reason"]
    if role == "headline":
        return "headline_stacked" if why.startswith("S ") else "headline_jump" if why.startswith("H3") else \
            "headline_brief" if why.startswith("H4") else "headline"
    if role == "deck":
        return "crosshead" if why.startswith("crosshead") else "strap" if why.startswith("D3") else "deck"
    if role == "byline":
        return "byline_runin" if "run-in" in why else "byline"
    if role == "other":
        code = why.split(" ")[0]
        return {"O2": "number", "O3": "dateline_head", "O4": "recurring_text", "O6": "jump_line", "O7": "page_head_text",
                "O1": "box_text", "O5": "bodystyle_text", "O9": "bold_body_text"}.get(code, "other_text")
    return role


def is_rectangle(pts, bbox_pt, w_pt, h_pt) -> bool:
    """Every point lies on the bbox boundary (a rectangle) or in a corner zone (a rounded rectangle), and all four sides
    are touched; letterforms and icons have points inside or mid-way along the box."""
    if not pts or len(pts) < 4:
        return False
    l, b, r, t = bbox_pt
    rad = min(0.25 * min(w_pt, h_pt), 3 * MM) + 0.5
    def ok(x, y):
        if min(abs(x - l), abs(x - r)) <= 0.5 and (min(abs(y - b), abs(y - t)) <= 0.5 or b + rad - 1 <= y <= t - rad + 1):
            return True
        if min(abs(y - b), abs(y - t)) <= 0.5 and l + rad - 1 <= x <= r - rad + 1:
            return True
        return min(abs(x - l), abs(x - r)) <= rad and min(abs(y - b), abs(y - t)) <= rad
    sides = {k for x, y in pts for k, v in (("l", abs(x - l)), ("r", abs(x - r)), ("b", abs(y - b)), ("t", abs(y - t))) if v <= 0.5}
    return all(ok(x, y) for x, y in pts) and sides == {"l", "r", "b", "t"}


def classify_path(p: dict, W: float, H: float) -> str:
    x0, y0, x1, y1 = p["x0"], p["y0"], p["x1"], p["y1"]
    w, h = x1 - x0, y1 - y0
    sw = p["sw"] / MM if p["stroke"] else 0.0
    if w >= 0.95 * W and h >= 0.95 * H:
        return "page_background"
    simple = p["pts"] is not None and len(p["pts"]) <= 5
    if w >= RULE_MIN_LEN_MM and h + sw <= RULE_MAX_MM and simple:
        return "hrule"
    if h >= RULE_MIN_LEN_MM and w + sw <= RULE_MAX_MM and simple:
        return "vrule"
    if w >= BOX_MIN_MM and h >= BOX_MIN_MM and is_rectangle(p["pts"], p["bbox_pt"], w * MM, h * MM):
        return "box"
    return "artwork"


def build_page(sid: str, pg: dict, scan: dict, heads: list, n_pages: int) -> dict:
    tb = pg.get("trimbox_mm") or pg["mediabox_mm"]
    tx0, ty0, tx1, ty1 = tb
    W, H = round(tx1 - tx0, 3), round(ty1 - ty0, 3)
    Xm = lambda x_mm: x_mm - tx0  # noqa: E731
    Yp = lambda y_pt: ty1 - y_pt / MM  # noqa: E731   (PDF pt, y-up → mm from the trim top)
    fonts = {base_font(k): v.get("descriptor") or {} for k, v in (pg.get("fonts") or {}).items()}
    P = {"sid": sid, "page": pg["page"], "n_pages": n_pages, "W": W, "H": H,
         "trim_mm": [round(v, 3) for v in tb], "media_mm": pg["mediabox_mm"], "bleed_mm": pg.get("bleedbox_mm"),
         "body_size": pg["body_size_pt_page_mode"], "body_font": pg["body_font_page_mode"], "fonts": fonts}
    # display frames (headlines.py roles)
    disp = []
    for k, r in enumerate(sorted(heads, key=lambda r: r["id"])):
        ls = [{"y": Yp(l["baseline_pt"]), "x0": Xm(l["x0_mm"]), "x1": Xm(l["x1_mm"]), "w": l["width_mm"], "nw": l["n_words"],
               "ww": l["words_width_pt"]} for l in r["lines"]]
        sx0 = Xm(r["span_x0_mm"])
        disp.append({"id": f"d{k}", "kind": display_kind(r), "role": r["role"], "reason": r["role_reason"], "font": r["font"],
                     "family": family_of(r["font"]), "size": r["size_pt"], "hs": r["hscale"], "lead": r["leading_pt"],
                     "x0": min(l["x0"] for l in ls), "x1": max(l["x1"] for l in ls), "y_top": ls[0]["y"], "y_bot": ls[-1]["y"],
                     "lines": ls, "span": (sx0, sx0 + r["span_width_mm"]), "cols": r["span_cols"], "grid": r["grid"],
                     "align": r["alignment"], "colour": ("cmyk", tuple(r["checks"]["colour"])) if r["checks"]["colour"] else None,
                     "text": r["text"], "rec_id": r["id"]})
    P["disp"] = disp
    dlines = [(l["y"], l["x0"], l["x1"]) for d in disp for l in d["lines"]]
    # body runs (measured body frames minus lines that are display text)
    runs, dropped = [], 0
    bsize, bfont = pg["body_size_pt_page_mode"], pg["body_font_page_mode"]
    for f in pg["frames"]:
        if f.get("excluded"):
            continue
        frag = not f["is_body_candidate"]
        # non-body measured frames in the page body face and size band are body-text fragments (published1/headlines.py
        # drops them as such); they count for spacing and areas, never for body type specs or column sets
        if frag and not (base_font(f["font"]) == bfont and f["size_pt"] and HL.FRAG_BAND[0] * bsize <= f["size_pt"] <= HL.FRAG_BAND[1] * bsize):
            continue
        lead = f["leading_pt"] or f["size_pt"] * 1.1
        cur, last_y = [], None
        for ln in sorted(f["lines"], key=lambda l: -l["baseline_pt"]):
            y, x0, x1 = Yp(ln["baseline_pt"]), Xm(ln["x0_mm"]), Xm(ln["x1_mm"])
            if any(abs(dy - y) <= SAME_LINE_MM and HL.overlap(x0, x1, dx0, dx1) >= 0.5 * max(x1 - x0, 0.1) for dy, dx0, dx1 in dlines):
                dropped += 1
                if cur:
                    runs.append((f, cur))
                cur, last_y = [], None
                continue
            if cur and y - last_y > RUN_BREAK * lead / MM:
                runs.append((f, cur))
                cur = []
            cur.append({"y": y, "x0": x0, "x1": x1, "cls": ln["class"], "off": ln.get("left_offset_mm")})
            last_y = y
        if cur:
            runs.append((f, cur))
    P["runs"] = [{"id": f"r{k}", "kind": "body", "frame": f["id"], "fragment": not f["is_body_candidate"],
                  "x0": Xm(f["column_left_mm"]) if f["is_body_candidate"] else min(l["x0"] for l in ls),
                  "x1": Xm(f["right_edge_mm"]) if f["is_body_candidate"] else max(l["x1"] for l in ls),
                  "y_top": ls[0]["y"], "y_bot": ls[-1]["y"], "lines": ls, "size": f["size_pt"], "lead": f["leading_pt"],
                  "font": base_font(f["font"]), "family": family_of(f["font"]), "hs": f["hscale_median"],
                  "width": f["width_mm"], "width_conf": f.get("width_confidence"), "metrics": f.get("metrics") or {},
                  "space_em": (f.get("font_record") or {}).get("space_em")}
                 for k, (f, ls) in enumerate(runs)]
    P["body_lines_dropped_as_display"] = dropped
    # images (visible areas), forms, paths
    P["images"] = [{"id": f"i{k}", "kind": "image", "x0": Xm(l / MM), "x1": Xm(r / MM), "y_top": Yp(t), "y_bot": Yp(b)}
                   for k, (l, b, r, t) in enumerate(scan["images"])]
    P["forms"] = [{"id": f"f{k}", "kind": "form", "x0": Xm(l / MM), "x1": Xm(r / MM), "y_top": Yp(t), "y_bot": Yp(b)}
                  for k, (l, b, r, t) in enumerate(scan["forms"])]
    paths = []
    for k, p in enumerate(scan["paths"]):
        l, b, r, t = p["bbox"]
        q = {"id": f"p{k}", "x0": Xm(l / MM), "x1": Xm(r / MM), "y0": Yp(t), "y1": Yp(b), "sw": p["sw"], "stroke": p["stroke"],
             "fill": p["fill"], "scol": p["scol"], "fcol": p["fcol"], "ops": p["ops"], "pts": p["pts"], "bbox_pt": p["bbox"]}
        q["cls"] = classify_path(q, W, H)
        paths.append(q)
    P["paths"] = paths
    # glyph-level facts
    G = scan["glyphs"]
    letters = [ch for g in G for ch in g[8] if ch.isalpha() or "ऀ" <= ch <= "ॿ"]
    P["deva_share"] = sum("ऀ" <= ch <= "ॿ" for ch in letters) / len(letters) if letters else 0.0
    gl = [{"x0": Xm(g[0] / MM), "x1": Xm(g[1] / MM), "y": Yp(g[2]), "size": g[3], "font": g[4], "col": g[5],
           "hs": g[6], "up": g[7], "t": g[8], "tr": g[9]} for g in G if g[8].strip()]
    on = lambda g: 0 <= (g["x0"] + g["x1"]) / 2 <= W and 0 <= g["y"] <= H  # noqa: E731   (pasteboard glyphs are not printed)
    P["glyphs"] = [g for g in gl if on(g)]
    P["offpage_glyphs"] = len(gl) - len(P["glyphs"])
    return P


def body_runs(P: dict) -> list:
    """Runs from the measured body frames (published1 body candidates), without the body-text fragments."""
    return [r for r in P["runs"] if not r.get("fragment")]


def glyph_runs(P: dict) -> list:
    """Text runs from the glyph scan: content-order glyphs of one font and size on one baseline (+-0.15 em), each
    starting at or after the previous one's left edge and at most 1.5 em after its right edge. Used for furniture and
    reversed text; the text is compared for equality only and never written to the repo."""
    runs, cur = [], None
    for g in P["glyphs"]:
        if cur and g["font"] == cur["font"] and g["tr"] == cur["tr"] and abs(g["size"] - cur["size"]) <= 0.05 and abs(g["y"] - cur["y"]) * MM <= 0.15 * g["size"] \
                and cur["x1"] - 0.3 <= g["x0"] + 0.3 and g["x0"] - cur["x1"] <= 1.5 * g["size"] / MM and g["up"]:
            cur["t"] += g["t"]
            cur["x1"] = max(cur["x1"], g["x1"])
            cur["cols"][g["col"]] += 1
            continue
        if cur:
            runs.append(cur)
        cur = {"font": g["font"], "size": round(g["size"], 2), "y": g["y"], "x0": g["x0"], "x1": g["x1"], "t": g["t"],
               "cols": Counter([g["col"]]), "up": g["up"], "tr": g["tr"]}
    if cur:
        runs.append(cur)
    for r in runs:
        r["col"] = r["cols"].most_common(1)[0][0]
        r["t"] = " ".join(r["t"].split())
    return [r for r in runs if r["t"] and r["up"]]


def is_number(t: str) -> bool:
    t = t.strip()
    return bool(t) and all(unicodedata.category(ch) == "Nd" for ch in t)


def sections_and_types(pages: list) -> None:
    """Script per page, sections (runs of same-script pages of one edition), top block, page type, running-head variant."""
    by_sid = defaultdict(list)
    for P in pages:
        by_sid[P["sid"]].append(P)
        P["script"] = "devanagari" if P["deva_share"] >= 0.5 else "latin"
        P["topblock"] = top_block(P)
    for sid, ps in by_sid.items():
        ps.sort(key=lambda p: p["page"])
        secs, cur = [], [ps[0]]
        for p in ps[1:]:
            if p["script"] == cur[-1]["script"]:
                cur.append(p)
            else:
                secs.append(cur)
                cur = [p]
        secs.append(cur)
        for k, sec in enumerate(secs):
            hs = [p["topblock"]["h"] if p["topblock"] else 0.0 for p in sec]
            front_i = max(range(len(sec)), key=lambda i: (hs[i], -i))
            others = [h for i, h in enumerate(hs) if i != front_i]
            has_front = bool(others) and hs[front_i] >= 2 * st.median(others)
            for i, p in enumerate(sec):
                p["section"] = k
                p["section_len"] = len(sec)
                p["sec_index"] = i
                p["ptype"] = "inside"
            if has_front:
                sec[front_i]["ptype"] = "front"
                if len(sec) >= 3:
                    back_i = len(sec) - 1 if front_i < len(sec) / 2 else 0
                    sec[back_i]["ptype"] = "back"
                # reading order runs away from the front (a flip-format second section starts at the far end)
                for i, p in enumerate(sec):
                    p["read_index"] = abs(i - front_i) + 1
            else:
                for i, p in enumerate(sec):
                    p["read_index"] = i + 1


def page_graphics(P: dict) -> list:
    g = [("image", i["x0"], i["y_top"], i["x1"], i["y_bot"], i["id"]) for i in P["images"]]
    g += [("form", f["x0"], f["y_top"], f["x1"], f["y_bot"], f["id"]) for f in P["forms"]]
    g += [(p["cls"], p["x0"], p["y0"], p["x1"], p["y1"], p["id"]) for p in P["paths"] if p["cls"] != "page_background"]
    return g


def connected(seed, items, tol=1.0):
    """Items transitively touching the seed box (within tol mm); returns (box, members)."""
    x0, y0, x1, y1 = seed[1:5]
    used, members, changed = {seed[5]}, [seed], True
    while changed:
        changed = False
        for g in items:
            if g[5] in used:
                continue
            if g[1] <= x1 + tol and g[3] >= x0 - tol and g[2] <= y1 + tol and g[4] >= y0 - tol:
                used.add(g[5])
                members.append(g)
                x0, y0, x1, y1 = min(x0, g[1]), min(y0, g[2]), max(x1, g[3]), max(y1, g[4])
                changed = True
    return (x0, y0, x1, y1), members


def top_block(P: dict):
    G = page_graphics(P)
    wide = [g for g in G if g[3] - g[1] >= TOPBLOCK_MIN_W * P["W"]]
    if not wide:
        return None
    seed = min(wide, key=lambda g: (g[2], g[1]))
    (x0, y0, x1, y1), mem = connected(seed, G)
    # the block's text (glyph runs inside it) is furniture too
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "h": y1 - y0, "members": [m[5] for m in mem],
            "kinds": dict(Counter(m[0] for m in mem))}


def recurrence(pages: list) -> None:
    """Furniture by recurrence across editions (text runs and graphics)."""
    idx = defaultdict(list)
    for P in pages:
        for r in P["truns"]:
            idx[(round(r["y"] / POS_TOL_MM))].append((P, r))
    for P in pages:
        tb = P["topblock"]
        ylo, yhi = (tb["y0"] - 1, tb["y1"] + 1) if tb else (-1, -1)
        bottom = P["content_bottom"]
        for r in P["truns"]:
            near = [(Q, s) for k in (-1, 0, 1) for Q, s in idx.get(round(r["y"] / POS_TOL_MM) + k, ())
                    if abs(s["y"] - r["y"]) <= POS_TOL_MM and (abs(s["x0"] - r["x0"]) <= POS_TOL_MM or abs(s["x1"] - r["x1"]) <= POS_TOL_MM
                                                              or abs((s["x0"] + s["x1"]) / 2 - (r["x0"] + r["x1"]) / 2) <= POS_TOL_MM)]
            same_text = {Q["sid"] for Q, s in near if s["t"] == r["t"] and abs(s["x0"] - r["x0"]) <= POS_TOL_MM}
            style = [(Q, s) for Q, s in near if s["font"] == r["font"] and abs(s["size"] - r["size"]) <= 0.3]
            in_zone = ylo <= r["y"] <= yhi or r["y"] >= bottom - 1
            r["furn"] = "static" if len(same_text) >= RECUR_EDITIONS else \
                "variable" if in_zone and len({Q["sid"] for Q, s in style}) >= RECUR_EDITIONS and len({s["t"] for Q, s in style}) >= 2 else None
    gidx = defaultdict(list)
    for P in pages:
        for g in P["images"] + P["forms"]:
            gidx[round(g["x0"] / 5)].append((P, g))
    for P in pages:
        for g in P["images"] + P["forms"]:
            eds = {Q["sid"] for k in (-1, 0, 1) for Q, h in gidx.get(round(g["x0"] / 5) + k, ())
                   if all(abs(h[c] - g[c]) <= POS_TOL_MM for c in ("x0", "x1", "y_top", "y_bot"))}
            g["recurs"] = len(eds)


def grid_columns(grid8: dict) -> list:
    o, p, w = grid8["origin"], grid8["pitch"], grid8["width"]
    return [(o + k * p, o + k * p + w) for k in range(grid8["n"])]


def columns_of(x0: float, x1: float, cols: list) -> list:
    out = []
    for k, (a, b) in enumerate(cols):
        ov = min(x1, b) - max(x0, a)
        if ov > 0 and (ov >= COL_COVER * (b - a) or ov >= COL_COVER * max(x1 - x0, 0.1)):
            out.append(k)
    return out


TEXT_KINDS = {"body", "headline", "headline_brief", "headline_jump", "headline_stacked", "deck", "strap", "crosshead", "kicker",
              "byline", "caption", "jump_line", "other_text", "box_text", "bodystyle_text", "bold_body_text"}
SKIP_KINDS = {"byline_runin", "page_head_text", "dateline_head", "number", "recurring_text"}


def stack_elements(P: dict) -> list:
    """Elements of the page body (below the top block, outside ads and standing blocks) for the column stacks."""
    tb = P["topblock"]
    top = tb["y1"] if tb else 0.0
    blocks = P.get("ads", []) + P.get("standing", [])
    out_of = lambda x0, y0, x1, y1: not any(b["x0"] - 1 <= x0 and x1 <= b["x1"] + 1 and b["y_top"] - 1 <= y0 and y1 <= b["y_bot"] + 1 for b in blocks)  # noqa: E731
    els = []
    for r in P["runs"]:
        if r["y_top"] > top and out_of(r["x0"], r["y_top"] - 0.75 * r["size"] / MM, r["x1"], r["y_bot"]):
            els.append(dict(r, ref_top=r["y_top"], ref_bot=r["y_bot"]))
    for d in P["disp"]:
        if d["kind"] in SKIP_KINDS or d["y_top"] <= top or not out_of(d["x0"], d["y_top"] - 0.75 * d["size"] / MM, d["x1"], d["y_bot"]):
            continue
        els.append(dict(d, ref_top=d["y_top"], ref_bot=d["y_bot"]))
    for i in P["images"]:
        if i["y_top"] >= top - 0.5 and i.get("cls") == "photo":
            els.append(dict(i, kind="image", ref_top=i["y_top"], ref_bot=i["y_bot"]))
    for p in P["paths"]:
        if p["y0"] < top - 0.5 or not out_of(p["x0"], p["y0"], p["x1"], p["y1"]):
            continue
        if p["cls"] == "hrule":
            y = (p["y0"] + p["y1"]) / 2
            els.append({"id": p["id"], "kind": "rule", "x0": p["x0"], "x1": p["x1"], "ref_top": y, "ref_bot": y, "path": p})
        elif p["cls"] == "box" and (p["stroke"] or (p["fill"] and p["fcol"] and max(p["fcol"][1]) > 0.03)):
            els.append({"id": p["id"] + "t", "kind": "box_top", "x0": p["x0"], "x1": p["x1"], "ref_top": p["y0"], "ref_bot": p["y0"], "path": p})
            els.append({"id": p["id"] + "b", "kind": "box_bottom", "x0": p["x0"], "x1": p["x1"], "ref_top": p["y1"], "ref_bot": p["y1"], "path": p})
    return els


def text_between(P: dict, a: dict, b: dict, col: tuple) -> bool:
    """Is any printed glyph (>= 4 pt) centred in the column with its baseline strictly between a and b? Then a and b are
    not neighbours: text that no element models (extraction gaps) sits between them."""
    rows = P["rows"]
    for y in range(int(math.floor(a["ref_bot"])), int(math.ceil(b["ref_top"])) + 1):
        for g in rows.get(y, ()):
            if a["ref_bot"] + SAME_LINE_MM < g["y"] < b["ref_top"] - SAME_LINE_MM and col[0] <= (g["x0"] + g["x1"]) / 2 <= col[1] and g["size"] >= 4:
                return True
    return False


def column_pairs(P: dict, cols: list) -> list:
    """Vertical neighbour pairs (upper, lower, distance mm) from the column stacks, deduplicated."""
    els = P["elements"]
    stacks = defaultdict(list)
    for e in els:
        for c in columns_of(e["x0"], e["x1"], cols):
            stacks[c].append(e)
    seen, pairs = set(), []
    for c, es in stacks.items():
        es.sort(key=lambda e: (e["ref_top"], e["ref_bot"]))
        for a in es:
            below = [b for b in es if b["ref_top"] > a["ref_bot"] + 0.05]
            if not below:
                continue
            b = min(below, key=lambda b: (b["ref_top"], b["ref_bot"]))
            # a container or an overlapping element between them (e.g. text over an image) breaks adjacency
            if any(e is not a and e is not b and e["ref_top"] < b["ref_top"] and e["ref_bot"] > a["ref_bot"] for e in es):
                continue
            key = (a["id"], b["id"])
            if key in seen:
                continue
            if text_between(P, a, b, cols[c]):
                P["pairs_blocked_by_text"] = P.get("pairs_blocked_by_text", 0) + 1
                continue
            seen.add(key)
            pairs.append((a, b, b["ref_top"] - a["ref_bot"], c))
    return pairs


def inside(a: dict, b: dict, tol: float = 1.0) -> bool:
    return a["x0"] >= b["x0"] - tol and a["x1"] <= b["x1"] + tol and a["y_top"] >= b["y_top"] - tol and a["y_bot"] <= b["y_bot"] + tol


def classify_images_and_ads(P: dict, colw: float) -> None:
    """Recurring blocks below the top block: seeds are recurring images/forms >= 25 x 25 mm and boxes holding >= 3
    recurring (static) text runs, expanded to the graphics that touch them. A block in the bottom band (its foot within
    3 mm of the lowest text, <= 25 mm tall) is the IMPRINT; a block narrower than two columns is a STANDING MODULE (rail
    boxes such as weather or market rates); the rest are ADS (house and standing ads). Images: furniture (top block,
    imprint, modules), ad, recurring, icon (< PHOTO_MIN_MM) or photo."""
    tb = P["topblock"]
    top = tb["y1"] if tb else 0.0
    G = [g for g in page_graphics(P) if g[2] >= top - 0.5]
    seeds = []
    for im in P["images"] + P["forms"]:
        if im["y_top"] >= top - 0.5 and im.get("recurs", 1) >= RECUR_EDITIONS and \
                (im["x1"] - im["x0"]) * (im["y_bot"] - im["y_top"]) >= 25 * 25:
            seeds.append(next(g for g in G if g[5] == im["id"]))
    static_runs = [r for r in P["truns"] if r.get("furn") == "static" and r["y"] > top]
    for p in P["paths"]:
        if p["cls"] == "box" and p["y0"] >= top - 0.5 and (p["x1"] - p["x0"]) * (p["y1"] - p["y0"]) >= 25 * 25:
            inner = [r for r in static_runs if p["x0"] - 1 <= r["x0"] and r["x1"] <= p["x1"] + 1 and p["y0"] <= r["y"] <= p["y1"]]
            if len(inner) >= 3:
                seeds.append(next(g for g in G if g[5] == p["id"]))
    blocks = []
    for sd in seeds:
        if any(sd[1] >= b["x0"] - 0.5 and sd[3] <= b["x1"] + 0.5 and sd[2] >= b["y_top"] - 0.5 and sd[4] <= b["y_bot"] + 0.5 for b in blocks):
            continue
        (x0, y0, x1, y1), mem = connected(sd, G)
        kind = "imprint" if y1 >= P["content_bottom"] - 3 and y1 - y0 <= 25 else "standing_module" if x1 - x0 < 2 * colw else "ad"
        blocks.append({"x0": x0, "x1": x1, "y_top": y0, "y_bot": y1, "why": "recurring", "type": kind, "members": [m[5] for m in mem]})
    P["ads"] = [b for b in blocks if b["type"] == "ad"]
    P["standing"] = [b for b in blocks if b["type"] != "ad"]
    for im in P["images"]:
        w, h = im["x1"] - im["x0"], im["y_bot"] - im["y_top"]
        if (tb and im["y_bot"] <= tb["y1"] + 0.5) or any(inside(im, b) for b in P["standing"]):
            im["cls"] = "furniture"
        elif any(inside(im, b) for b in P["ads"]):
            im["cls"] = "ad"
        elif im.get("recurs", 1) >= RECUR_EDITIONS:
            im["cls"] = "recurring"
        elif w < PHOTO_MIN_MM[0] or h < PHOTO_MIN_MM[1]:
            im["cls"] = "icon"
        else:
            im["cls"] = "photo"



def ink_box(P: dict) -> tuple:
    """Union of all marks on the trim (glyph em boxes, visible images, forms, non-background paths), clipped to the
    trim, in mm; marks wholly outside the trim (pasteboard) are not printed and are ignored."""
    boxes = [(g["x0"], g["y"] - 0.75 * g["size"] / MM, g["x1"], g["y"] + 0.25 * g["size"] / MM) for g in P["glyphs"]]
    boxes += [(im["x0"], im["y_top"], im["x1"], im["y_bot"]) for im in P["images"] + P["forms"]]
    for p in P["paths"]:
        if p["cls"] != "page_background":
            sw = p["sw"] / MM / 2 if p["stroke"] else 0.0
            boxes.append((p["x0"] - sw, p["y0"] - sw, p["x1"] + sw, p["y1"] + sw))
    clip = [(max(0.0, a), max(0.0, b), min(P["W"], c), min(P["H"], d)) for a, b, c, d in boxes]
    clip = [bx for bx in clip if bx[2] > bx[0] and bx[3] > bx[1]]
    return min(b[0] for b in clip), min(b[1] for b in clip), max(b[2] for b in clip), max(b[3] for b in clip)


DASH_CHARS = ("\u2013", "\u2014", "-")


def dateline_of(r: dict, rows: dict):
    """A run-in dateline opens the run's first line: a colon, or a spaced dash, within DATELINE_MM of the line start.
    Returns {font, size, col, bold, form, width_mm} or None. (Text is only searched for the punctuation mark.)"""
    l0 = r["lines"][0]
    gl = sorted((g for k in (-1, 0, 1) for g in rows.get(round(l0["y"]) + k, ())
                 if abs(g["y"] - l0["y"]) <= SAME_LINE_MM and l0["x0"] - 1.0 <= g["x0"] <= l0["x0"] + DATELINE_MM), key=lambda g: g["x0"])
    if not gl or abs(gl[0]["x0"] - l0["x0"]) > 1.0:
        return None
    for k, g in enumerate(gl[1:], 1):
        form = "colon" if ":" in g["t"] else None
        if not form and g["t"] in DASH_CHARS and k + 1 < len(gl) and g["x0"] - gl[k - 1]["x1"] >= 0.12 * g["size"] / MM \
                and gl[k + 1]["x0"] - g["x1"] >= 0.12 * g["size"] / MM:
            form = "dash"
        if form:
            lead = gl[:k + 1]
            fonts = Counter(x["font"] for x in lead)
            f = fonts.most_common(1)[0][0]
            bold = bool(HL.BOLD_RE.search(f)) or sum(x["tr"] == 2 for x in lead) >= 0.5 * len(lead)
            return {"font": f, "size": round(lead[0]["size"], 2), "col": Counter(x["col"] for x in lead).most_common(1)[0][0],
                    "bold": bold, "faux_bold": sum(x["tr"] == 2 for x in lead) >= 0.5 * len(lead), "form": form,
                    "width_mm": g["x1"] - l0["x0"]}
    return None


def prepare(ds: Path, verbose: bool = True):
    D = load_dataset(ds)
    pages = []
    for sid in D["sids"]:
        pdf = ds / "samples" / sid / "source.pdf"
        pdoc = pdfium.PdfDocument(str(pdf))
        doc = D["docs"][sid]
        for pg in doc["pages"]:
            P = build_page(sid, pg, scan_page(pdf, pdoc, pg["page"]), D["heads"][(sid, pg["page"])], len(doc["pages"]))
            P["pdf"] = pdf
            pages.append(P)
        pdoc.close()
    grids, ginfo = HL.estimate_grids(D["docs"].values())
    cols = grid_columns(grids["8col"])
    for P in pages:
        for r in P["runs"]:
            r["measure"] = measure_class(r["width"], r["x0"], grids)
        P["truns"] = glyph_runs(P)
        P["content_bottom"] = max(r["y"] for r in P["truns"])
        leads = Counter()
        for r in body_runs(P):
            leads[r["lead"]] += len(r["lines"])
        P["body_lead"] = leads.most_common(1)[0][0] if leads else P["body_size"] * 1.1
        P["ink"] = ink_box(P)
    sections_and_types(pages)
    recurrence(pages)
    for P in pages:
        classify_images_and_ads(P, grids["8col"]["width"])
        rows = defaultdict(list)
        for g in P["glyphs"]:
            rows[round(g["y"])].append(g)
        P["rows"] = rows
        for r in P["runs"]:
            r["runin"] = dateline_of(r, rows)
        P["elements"] = stack_elements(P)
        P["pairs"] = column_pairs(P, cols)
        place_photos(P, grids["8col"]["pitch"] - grids["8col"]["width"])
        tb = P["topblock"]
        ed = [e for e in P["elements"] if e["kind"] in TEXT_KINDS or e["kind"] == "image"]
        P["editorial_top"] = min((e["ref_top"] - (0.75 * e.get("size", 0) / MM if e["kind"] != "image" else 0.0)) for e in ed) if ed else (tb["y1"] if tb else 0.0)
    if verbose:
        print(f"{len(D['sids'])} editions ({len(D['skipped'])} skipped), {len(pages)} pages scanned", file=sys.stderr)
    return D, pages, grids, ginfo


HEAD_KINDS = {"headline", "headline_brief", "headline_jump", "headline_stacked"}
STORY_TOP_KINDS = HEAD_KINDS | {"deck", "strap", "kicker", "byline"}
BLOCK_KINDS = {"rule", "box_top", "box_bottom"}


def neighbour_maps(P: dict) -> tuple:
    up, down = defaultdict(list), defaultdict(list)
    for a, b, d, c in P["pairs"]:
        up[b["id"]].append((a, d))
        down[a["id"]].append((b, d))
    return up, down


def photo_place(P: dict, im: dict, up: dict, down: dict, gutter: float) -> tuple:
    """Where a photo sits relative to its story's headline, read from the column stacks (box edges are transparent:
    a deck or kicker may sit in a panel; rules block):
    below_headline (the first element above is a headline, deck, strap, kicker or byline), in_text_flow (body text above
    it, reached from such an element without crossing a rule), above_headline (the first element below is a headline or
    kicker), beside_headline (a headline whose first baseline is within -10..+25 mm of the photo top and whose ink is
    within 2 gutters + 2 mm to the side), caption_only, or stand_alone. Returns (place, headline element or None)."""
    def first(nb, eid, seen):
        out = []
        for e, d in sorted(nb.get(eid, []), key=lambda t: t[1]):
            if e["kind"] in ("box_top", "box_bottom") and e["id"] not in seen:
                seen.add(e["id"])
                out += first(nb, e["id"], seen)
            else:
                out.append(e)
        return out
    ups, downs = first(up, im["id"], set()), first(down, im["id"], set())
    if ups and ups[0]["kind"] in STORY_TOP_KINDS:
        return "below_headline", ups[0]
    if downs and downs[0]["kind"] in HEAD_KINDS | {"kicker", "strap"}:
        return "above_headline", downs[0]
    seen, frontier = {im["id"]}, list(ups)
    while frontier:
        e = frontier.pop(0)
        if e["id"] in seen:
            continue
        seen.add(e["id"])
        if e["kind"] in STORY_TOP_KINDS:
            return "in_text_flow", e
        if e["kind"] in ("body", "image", "crosshead"):
            frontier += first(up, e["id"], set(seen))
    for d in P["disp"]:
        if d["kind"] in HEAD_KINDS and -10 <= d["y_top"] - im["y_top"] <= 25:
            gap = max(im["x0"] - d["x1"], d["x0"] - im["x1"])
            if 0 <= gap <= 2 * gutter + 2:
                return "beside_headline", d
    if any(e["kind"] == "caption" for e in ups + downs):
        return "caption_only", None
    return "stand_alone", None


def place_photos(P: dict, gutter: float) -> None:
    """Story placement of every photo. One-off display ads placed as a single image cannot be told from photos by
    geometry; stand-alone photos >= AD_MIN_AREA_MM2 are listed as possible ads (they stay photos)."""
    up, down = neighbour_maps(P)
    for im in P["images"]:
        if im.get("cls") != "photo":
            continue
        im["place"], h = photo_place(P, im, up, down, gutter)
        im["headline"] = h["id"] if h else None
        im["possible_ad"] = im["place"] == "stand_alone" and (im["x1"] - im["x0"]) * (im["y_bot"] - im["y_top"]) >= AD_MIN_AREA_MM2


# ------------------------------------------------------------------------------------------------- aggregates
PTYPES = ("front", "inside", "back")


def mode_of(xs, nd=2):
    c = Counter(round(x, nd) for x in xs if x is not None)
    if not c:
        return None
    v, k = max(c.items(), key=lambda kv: (kv[1], -kv[0]))
    return {"value": v, "share": share(k, sum(c.values())), "n": sum(c.values())}


def by_type(pages, fn, nd=2):
    """dist of fn(P) per page, for all pages and per page type."""
    out = {"all": d1([fn(P) for P in pages], nd)}
    for t in PTYPES:
        out[t] = d1([fn(P) for P in pages if P["ptype"] == t], nd)
    return out


def cmyk_counts(cols, top=6) -> dict:
    """Colour shares; cols is a list of colours or a Counter {colour: weight}."""
    c = Counter()
    for v, k in (cols.items() if isinstance(cols, Counter) else ((v, 1) for v in cols)):
        c[tuple(v[1]) if v and v[0] == "cmyk" else (("rgb",) + tuple(v[1]) if v else None)] += k
    n = sum(c.values())
    return {"n": n, "top": [{"cmyk" if k and k[0] != "rgb" else "value": list(k) if k else None, "name": colour_name(("cmyk", k)) if k and k[0] != "rgb" else ("rgb" if k else "none"),
                             "share": share(v, n)} for k, v in c.most_common(top)]}


def geometry(pages: list, grids: dict) -> dict:
    g8 = grids["8col"]
    area = (g8["n"] - 1) * g8["pitch"] + g8["width"]
    def m(P, side):
        x0, y0, x1, y1 = P["ink"]
        return {"left": x0, "top": y0, "right": P["W"] - x1, "bottom": P["H"] - y1}[side]
    margins = {s: by_type(pages, lambda P, s=s: m(P, s)) for s in ("top", "bottom", "left", "right")}
    recto = [P for P in pages if P["read_index"] % 2 == 1]
    verso = [P for P in pages if P["read_index"] % 2 == 0]
    inside_m = [m(P, "left") for P in recto] + [m(P, "right") for P in verso]
    outside_m = [m(P, "right") for P in recto] + [m(P, "left") for P in verso]
    bleed = [max(abs(a - b) for a, b in zip(P["bleed_mm"], P["trim_mm"])) if P["bleed_mm"] else None for P in pages]
    beyond = sum(1 for P in pages if P["ink"][0] < 0.1 or P["ink"][1] < 0.1 or P["ink"][2] > P["W"] - 0.1 or P["ink"][3] > P["H"] - 0.1)
    tbh = lambda P: P["topblock"]["h"] if P["topblock"] else None  # noqa: E731
    return {
        "trim_mm": {"value": [pages[0]["W"], pages[0]["H"]], "n_pages": len(pages),
                    "pages_same_size": sum(1 for P in pages if abs(P["W"] - pages[0]["W"]) < 0.1 and abs(P["H"] - pages[0]["H"]) < 0.1)},
        "bleed_mm": {"max_bleed_beyond_trim": d1(bleed, 3),
                     "mediabox_equals_trimbox_pages": sum(1 for P in pages if max(abs(a - b) for a, b in zip(P["media_mm"], P["trim_mm"])) < 0.01),
                     "pages_with_printed_marks_reaching_the_trim_edge": beyond,
                     "pages_with_stray_glyphs_on_the_pasteboard": sum(1 for P in pages if P["offpage_glyphs"]),
                     "note": "the press PDFs carry no bleed: MediaBox = TrimBox = BleedBox; nothing is printed beyond the trim"},
        "margins_mm_from_ink": margins,
        "inside_vs_outside_mm": {"inside": d1(inside_m), "outside": d1(outside_m),
                                 "rule": "recto = odd reading index within the section (inside margin = left); verso = even (inside = right)"},
        "type_area_mm": {"x0": round(g8["origin"], 3), "x1": round(g8["origin"] + area, 3), "width": round(area, 3),
                         "left_margin_to_grid": round(g8["origin"], 3), "right_margin_to_grid": round(pages[0]["W"] - g8["origin"] - area, 3),
                         "source": "8-column lattice fitted to body frames (published1/headlines.py estimate_grids)"},
        "top_block_mm": {"top": by_type(pages, lambda P: P["topblock"]["y0"] if P["topblock"] else None),
                         "height": by_type(pages, tbh),
                         "bottom": by_type(pages, lambda P: P["topblock"]["y1"] if P["topblock"] else None)},
        "editorial_top_mm": by_type(pages, lambda P: P["editorial_top"]),
        "lowest_text_baseline_mm": by_type(pages, lambda P: P["content_bottom"]),
    }


def measure_class(w: float, x0: float, grids: dict) -> str:
    """'8col xN' / '6col xN' when the measure equals N columns plus gutters (+-0.6 mm) and the left edge is on that
    lattice (+-1 mm); else 'other'."""
    for name in ("8col", "6col"):
        g = grids[name]
        gut = grids["8col"]["pitch"] - grids["8col"]["width"]
        n = max(1, round((w + gut) / g["pitch"]))
        if abs(w - (n * g["width"] + (n - 1) * gut)) <= 0.6:
            k = (x0 - g["origin"]) / g["pitch"]
            if abs(x0 - (g["origin"] + round(k) * g["pitch"])) <= 1.0:
                return f"{name} x{n}"
    return "other"


def span_fit(w: float, grids: dict) -> tuple:
    """Nearest 8-column span count for a width, and the residual (mm)."""
    g = grids["8col"]
    gut = g["pitch"] - g["width"]
    n = max(1, min(g["n"], round((w + gut) / g["pitch"])))
    return n, w - (n * g["width"] + (n - 1) * gut)


def column_sets(P: dict, grids: dict) -> list:
    """Text-column sets: measured body frames of one width (+-0.8 mm) standing side by side (vertically overlapping)
    one gutter apart (+-0.8 mm), chained left to right. A set of M frames whose total width equals an N-column span of the
    8-column grid (+-1.5 mm) is a story set in M text columns across N grid columns. Each frame gets f['colset'] = (N, M)."""
    g = grids["8col"]
    gut = g["pitch"] - g["width"]
    fr = {}
    for r in body_runs(P):
        f = fr.setdefault(r["frame"], {"id": r["frame"], "x0": r["x0"], "x1": r["x1"], "w": r["width"], "y_top": r["y_top"], "y_bot": r["y_bot"],
                                       "lines": 0, "lead": r["lead"], "runs": []})
        f["y_top"], f["y_bot"] = min(f["y_top"], r["y_top"]), max(f["y_bot"], r["y_bot"])
        f["lines"] += len(r["lines"])
        f["runs"].append(r)
    frames = sorted(fr.values(), key=lambda f: (f["x0"], f["y_top"]))
    used, sets = set(), []
    for a in frames:
        if a["id"] in used:
            continue
        chain = [a]
        used.add(a["id"])
        while True:
            last = chain[-1]
            nxt = [b for b in frames if b["id"] not in used and abs(b["w"] - a["w"]) <= 0.8 and abs(b["x0"] - last["x1"] - gut) <= 0.8
                   and min(b["y_bot"], last["y_bot"]) - max(b["y_top"], last["y_top"]) > 0]
            if not nxt:
                break
            b = min(nxt, key=lambda b: (abs(b["y_top"] - last["y_top"]), b["x0"]))
            chain.append(b)
            used.add(b["id"])
        M, total = len(chain), chain[-1]["x1"] - chain[0]["x0"]
        N = max(1, round((total + gut) / g["pitch"]))
        on = abs(total - (N * g["width"] + (N - 1) * gut)) <= 1.5 and N <= g["n"]
        k = (chain[0]["x0"] - g["origin"]) / g["pitch"]
        left_on = abs(chain[0]["x0"] - (g["origin"] + round(k) * g["pitch"])) <= 1.5
        for f in chain:
            for r in f["runs"]:
                r["colset"] = (N, M) if on else None
        sets.append({"N": N if on else None, "M": M, "w": a["w"], "lines": sum(f["lines"] for f in chain), "left_on_lattice": left_on})
    return sets


def grid_section(pages: list, grids: dict, ginfo: dict) -> dict:
    g8, g6 = grids["8col"], grids["6col"]
    gut = g8["pitch"] - g8["width"]
    sets = [x for P in pages for x in column_sets(P, grids)]
    on = [x for x in sets if x["N"]]
    nm, nml, widths = Counter(), Counter(), defaultdict(list)
    for x in on:
        nm[(x["N"], x["M"])] += 1
        nml[(x["N"], x["M"])] += x["lines"]
        widths[(x["N"], x["M"])].append(x["w"])
    per_span = {}
    for N in range(1, g8["n"] + 1):
        c = Counter({M: v for (n_, M), v in nml.items() if n_ == N})
        if c:
            per_span[str(N)] = {"lines": sum(c.values()), "text_columns_share_by_lines": {str(M): share(v, sum(c.values())) for M, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))},
                                "column_width_mm": {str(M): round((N * g8["width"] + (N - 1) * gut - (M - 1) * gut) / M, 2) for M in sorted(c)}}
    rel = Counter("M = N" if x["M"] == x["N"] else "M = N - 1" if x["M"] == x["N"] - 1 else "M <= N - 2" for x in on)
    rell = Counter()
    for x in on:
        rell["M = N" if x["M"] == x["N"] else "M = N - 1" if x["M"] == x["N"] - 1 else "M <= N - 2"] += x["lines"]
    off = [x for x in sets if not x["N"]]
    colsets = {
        "rule": ("side-by-side body frames of one width, one gutter apart, chained; M frames whose total width is an N-column span "
                 "(+-1.5 mm): the story's text is set in M equal columns across N grid columns, width = (N x col + (N - 1) x "
                 "gutter - (M - 1) x gutter) / M"),
        "sets": len(sets), "sets_on_a_span": len(on), "lines_on_a_span": sum(x["lines"] for x in on), "lines_all": sum(x["lines"] for x in sets),
        "left_edge_on_lattice_share": share(sum(x["left_on_lattice"] for x in on), len(on)),
        "relation_by_sets": counts(rel), "relation_by_lines": counts(rell),
        "by_span_N": per_span,
        "top_N_M_by_lines": [{"N": n_, "M": M, "lines": v, "sets": nm[(n_, M)], "column_width_mm": d1(widths[(n_, M)])}
                             for (n_, M), v in sorted(nml.items(), key=lambda kv: (-kv[1], kv[0]))[:12]],
        "not_on_a_span": {"sets": len(off), "lines": sum(x["lines"] for x in off), "width_mm": d1([x["w"] for x in off]),
                          "note": "single frames narrower or wider than any column set: text in boxes (inset) or wrapped around pictures"},
    }
    def measure_kind(cs):
        if not cs:
            return "not on a column set (boxes, wraps)"
        N, M = cs
        return "8-column measure (M = N)" if M == N else "6-column measure (50 mm: 4 in 3, 8 in 6)" if (N, M) in ((4, 3), (8, 6)) else "other wide measure (M < N)"
    use = Counter()
    for P in pages:
        for r in body_runs(P):
            use[measure_kind(r.get("colset"))] += len(r["lines"])
    story_m, by_pt = Counter(), {t: Counter() for t in PTYPES}
    for P in pages:
        run_by_id = {r["id"]: r for r in P["runs"]}     # stack elements are copies made before the column sets existed
        for h, b in story_openings(P):
            k = measure_kind(run_by_id[b["id"]].get("colset"))
            story_m[k] += 1
            by_pt[P["ptype"]][k] += 1
    return {
        "columns": g8["n"], "column_width_mm": g8["width"], "gutter_mm": round(gut, 3), "pitch_mm": g8["pitch"],
        "origin_mm": g8["origin"], "lattice_residual_mm": ginfo["lattice_residual_mm"],
        "grid_use_by_body_lines": counts(use),
        "stories_by_measure": counts(story_m),
        "stories_by_measure_and_page_type": {t: counts(c) for t, c in by_pt.items()},
        "story_text_columns": colsets,
        "variant_6col": {"columns": 6, "column_width_mm": round(g6["width"], 3), "gutter_mm": round(gut, 3), "pitch_mm": g6["pitch"],
                         "origin_mm": g6["origin"], "derived": "same type area and gutter as the 8-column grid",
                         "note": "its 50 mm column is the 4-grid-columns-in-3 (and 8-in-6) case of story_text_columns"},
        "headlines_fitted_to_6col_grid_by_span": {str(k): v for k, v in sorted(Counter(d["cols"] for P in pages for d in P["disp"]
                                                                                    if d["kind"] == "headline" and d["grid"] == "6col").items())},
        "source": "published1 body frames (corrected.json) chained into column sets; headline span fit from headlines.jsonl",
    }


ROLE_GROUPS = (("headline", "main headlines (headlines.py H0/H1/H2)"), ("headline_stacked", "stacked headline paragraphs (S)"),
               ("headline_brief", "brief headlines inside a text flow (H4)"), ("headline_jump", "jump heads (H3)"),
               ("deck", "decks under a headline (D1/D2)"), ("strap", "straps above a headline (D3)"),
               ("crosshead", "crossheads between paragraphs"), ("kicker", "kickers above a headline (K1/K3)"),
               ("kicker_reversed", "reversed (white) labels (K2 or white kickers)"), ("byline", "bylines on their own line (B1 line, B2)"),
               ("caption", "captions (C1/C2)"))
PRACTICE_ROLE = {"headline": "headline_devanagari", "deck": "deck_under_headline", "crosshead": "deck_crosshead", "kicker": "kicker",
                 "kicker_reversed": "kicker", "byline": "byline", "caption": "caption"}


def is_white(c) -> bool:
    return bool(c) and c[0] == "cmyk" and max(c[1]) <= 0.03


def lightness(c, default: float | None = None) -> float | None:
    """Rough print lightness of a CMYK colour (1 = paper, 0 = black); for telling light text and dark panels apart.
    Colours that are not CMYK (or missing) return `default`."""
    if not c or c[0] != "cmyk":
        return default
    cc, m, y, k = c[1]
    return (1 - k) * (1 - 0.3 * cc - 0.59 * m - 0.11 * y)


def role_group(d: dict) -> str | None:
    k = d["kind"]
    if k == "kicker":
        return "kicker_reversed" if is_white(d["colour"]) or d["reason"].startswith("K2") else "kicker"
    return k if k in dict(ROLE_GROUPS) else None


def weight_of(font: str) -> str:
    f = font.lower()
    return "extrabold" if "extrabold" in f or "black" in f or "heavy" in f else "bold" if "bold" in f or "semibold" in f or "demi" in f else "regular"


def theil_sen(xs, ys):
    sl = sorted((y2 - y1) / (x2 - x1) for (x1, y1), (x2, y2) in ((a, b) for i, a in enumerate(zip(xs, ys)) for b in list(zip(xs, ys))[i + 1:]) if x2 != x1)
    if not sl:
        return None
    b = HL.q(sl, 0.5)
    a = HL.q([y - b * x for x, y in zip(xs, ys)], 0.5)
    return {"intercept": round(a, 3), "slope": round(b, 3), "n": len(xs), "method": "Theil-Sen (median of pairwise slopes)"}


def single_pos(d: dict) -> str:
    a, b = d["lines"][0]["x0"], d["lines"][0]["x1"]
    s0, s1 = d["span"]
    t = GRID_SNAP_MM
    if abs(a - s0) <= t and abs(s1 - b) <= t:
        return "full span"
    if abs((a + b) / 2 - (s0 + s1) / 2) <= t:
        return "centred"
    return "left" if abs(a - s0) <= t else "right" if abs(s1 - b) <= t else "other"


def display_spec(ds: list, pages_by_key: dict, practice: dict, group: str) -> dict:
    n = len(ds)
    if not n:
        return {"n": 0}
    sizes = [d["size"] for d in ds]
    multi = [d for d in ds if len(d["lines"]) >= 2 and d["lead"]]
    hs = [d["hs"] for d in ds if d["hs"]]
    ws = [(l["w"] * MM - l["ww"]) / (l["nw"] - 1) / (d["size"] * (d["hs"] or 1.0)) for d in ds for l in d["lines"] if l["nw"] >= 2]
    nl = [len(d["lines"]) for d in ds]
    body = [d["size"] / pages_by_key[d["page_key"]]["body_size"] for d in ds]
    out = {"n": n, "fonts": counts(Counter(d["font"] for d in ds)), "weight": counts(Counter(weight_of(d["font"]) for d in ds)),
           "size_pt": d1(sizes), "size_mode_pt": mode_of(sizes, 1), "size_over_body": d1(body, 3),
           "leading_pt_multiline": d1([d["lead"] for d in multi]), "leading_over_size_multiline": d1([d["lead"] / d["size"] for d in multi], 3),
           "hscale": d1(hs, 4), "condensed_share_lt_0_99": share(sum(h < 0.99 for h in hs), len(hs)),
           "word_space_em": d1(ws, 3), "alignment": counts(Counter(d["align"] for d in ds)),
           "alignment_multiline": counts(Counter(d["align"] for d in ds if len(d["lines"]) >= 2)),
           "colour": cmyk_counts([d["colour"] for d in ds]), "colour_non_black_share": share(sum(1 for d in ds if d["colour"] and colour_name(d["colour"]) != "black"), n),
           "lines_per_frame": {"dist": d1(nl, 1), "histogram": {str(k): v for k, v in sorted(Counter(nl).items())}},
           "single_line_position_in_span": counts(Counter(single_pos(d) for d in ds if len(d["lines"]) == 1)),
           "by_page_type": {t: {"n": sum(1 for d in ds if d["ptype"] == t), "size_pt": d1([d["size"] for d in ds if d["ptype"] == t])} for t in PTYPES}}
    pr = (practice.get("roles") or {}).get(PRACTICE_ROLE.get(group, ""), {})
    if pr.get("tracking_1000em_frame_median"):
        out["tracking_1000em"] = dict(pr["tracking_1000em_frame_median"], source=f"headline_practice.json role {PRACTICE_ROLE[group]} (all pages)",
                                      nonzero_share_abs_ge_5=pr.get("tracking_nonzero_share_abs_ge_5"))
    return out


def body_spec(pages: list, D: dict) -> dict:
    frames, seen = [], set()
    for P in pages:
        for r in body_runs(P):
            key = (P["sid"], P["page"], r["frame"])
            if key in seen:
                continue
            seen.add(key)
            frames.append((P, r, sum(len(x["lines"]) for x in body_runs(P) if x["frame"] == r["frame"])))
    sp = lambda r: (r["metrics"].get("space_ratio_nonfinal") or {}).get("median")  # noqa: E731
    trk = lambda r: ((r["metrics"].get("intra_token_gap_pt") or {}).get("median") or 0.0) / (r["size"] * (r["hs"] or 1.0)) * 1000  # noqa: E731
    cls = Counter()
    for P, r, k in frames:
        cls.update(r["metrics"].get("class_counts") or {})
    nonfinal = {k: v for k, v in cls.items() if k != "FINAL_PARAGRAPH_LINE"}
    cols = Counter()
    for P in pages:
        for g in P["glyphs"]:
            if g["font"] == P["body_font"] and abs(g["size"] - P["body_size"]) <= 0.3:
                cols[g["col"]] += 1
    steps = [b["y"] - a["y"] for P in pages for r in body_runs(P) for a, b in zip(r["lines"], r["lines"][1:])]
    extra = sum(1 for P in pages for r in body_runs(P) for a, b in zip(r["lines"], r["lines"][1:]) if r["lead"] and (b["y"] - a["y"]) * MM > 1.05 * r["lead"])
    keys = {(P["sid"], P["page"]) for P in pages}
    paras = [p for p in D["paras"] if (p["sample"], p["page"]) in keys and p.get("indent_mm") is not None]
    first_off, first_dl = [], []
    for P in pages:
        for h, b in story_openings(P):
            if b["lines"][0].get("off") is not None:
                (first_dl if b.get("runin") else first_off).append(b["lines"][0]["off"])
    w = [k for _, _, k in frames]
    return {
        "n_frames": len(frames), "n_lines": sum(w),
        "fonts": counts(Counter(r["font"] for _, r, _ in frames)),
        "fonts_by_lines": counts(Counter({f: sum(k for _, r, k in frames if r["font"] == f) for f in {r["font"] for _, r, _ in frames}})),
        "size_pt": d1([r["size"] for _, r, _ in frames]), "size_mode_pt_by_lines": mode_of([r["size"] for _, r, k in frames for _ in range(k)], 1),
        "leading_pt": d1([r["lead"] for _, r, _ in frames if r["lead"]]), "leading_mode_pt_by_lines": mode_of([r["lead"] for _, r, k in frames if r["lead"] for _ in range(k)], 2),
        "leading_over_size": d1([r["lead"] / r["size"] for _, r, _ in frames if r["lead"]], 3),
        "size_leading_pairs_by_lines": counts(Counter({f"{s}/{l}": sum(k for _, r, k in frames if r["size"] == s and r["lead"] == l)
                                                       for s, l in {(r["size"], r["lead"]) for _, r, _ in frames}})),
        "hscale": d1([r["hs"] for _, r, _ in frames if r["hs"]], 4),
        "hscale_not_100_share": share(sum(1 for _, r, _ in frames if r["hs"] and abs(r["hs"] - 1) > 0.005), len(frames)),
        "word_space_over_font_space_frame_median": d1([sp(r) for _, r, _ in frames], 3),
        "word_space_em_frame_median": d1([sp(r) * r["space_em"] for _, r, _ in frames if sp(r) is not None and r["space_em"]], 3),
        "tracking_1000em_frame_median": d1([trk(r) for _, r, _ in frames], 1),
        "alignment_nonfinal_lines": counts(Counter(nonfinal)),
        "colour": cmyk_counts(cols) | {"glyphs": sum(cols.values()),
                                       "black_glyph_share": share(sum(k for c, k in cols.items() if colour_name(c) == "black"), sum(cols.values()))},
        "first_line_indent_mm": d1([p["indent_mm"] for p in paras]), "first_line_indent_em": d1([p["indent_mm"] / (p["size_pt"] / MM) for p in paras], 3),
        "first_line_indent_source": f"paragraphs.jsonl ({len(paras)} verified paragraphs on these pages)",
        "story_first_line_offset_mm": d1(first_off), "story_first_line_indented_share": share(sum(1 for o in first_off if o >= 1.0), len(first_off)),
        "story_first_line_with_dateline_indented_share": share(sum(1 for o in first_dl if o >= 1.0), len(first_dl)),
        "story_first_line_rule": "first body line of each story (story_openings); datelines counted apart",
        "extra_space_between_paragraphs_share_of_steps": share(extra, len(steps)),
        "by_page_type": {t: {"size_pt": d1([r["size"] for P, r, _ in frames if P["ptype"] == t]),
                             "leading_pt": d1([r["lead"] for P, r, _ in frames if P["ptype"] == t and r["lead"]])} for t in PTYPES},
        "source": "published1 body frames (corrected.json): size, leading, h-scale, word space ratio, tracking, line classes",
    }


def type_specs(pages: list, D: dict) -> dict:
    pk = {(P["sid"], P["page"]): P for P in pages}
    groups = defaultdict(list)
    for P in pages:
        for d in P["disp"]:
            g = role_group(d)
            if g:
                groups[g].append(dict(d, page_key=(P["sid"], P["page"]), ptype=P["ptype"]))
    roles = {"body": body_spec(pages, D)}
    for g, desc in ROLE_GROUPS:
        roles[g] = dict(display_spec(groups.get(g, []), pk, D["practice"], g), definition=desc)
    faces = defaultdict(Counter)
    for g, ds in groups.items():
        for d in ds:
            faces[d["font"]][g] += 1
    for P in pages:
        for r in body_runs(P):
            faces[r["font"]]["body"] += len(r["lines"])
    roles["face_roles"] = {f: counts(c) for f, c in sorted(faces.items(), key=lambda kv: -sum(kv[1].values()))}
    roles["dateline"] = dateline_spec(pages)
    hd = groups.get("headline", [])
    cuts = size_bands([d["size"] for d in hd])
    bands = band_labels(cuts)               # fixed order: smallest band first
    roles["headline_face_by_size_band_pt"] = {"cuts_pt": cuts, "bands": {b: counts(Counter(d["font"] for d in hd if band_of(d["size"], cuts) == b))
                                                                          for b in bands if any(band_of(d["size"], cuts) == b for d in hd)}}
    return roles


def dateline_spec(pages: list) -> dict:
    dls, ratio, nst = [], [], 0
    for P in pages:
        for h, b in story_openings(P):
            nst += 1
            if b.get("runin"):
                dls.append(b["runin"])
                ratio.append(b["runin"]["size"] / b["size"])
    return {"n": len(dls), "stories": nst, "share_of_stories": share(len(dls), nst),
            "form": counts(Counter(t["form"] for t in dls)), "bold_share": share(sum(t["bold"] for t in dls), len(dls)),
            "faux_bold_share": share(sum(t["faux_bold"] for t in dls), len(dls)),
            "fonts": counts(Counter(t["font"] for t in dls)), "size_pt": d1([t["size"] for t in dls]), "size_over_body_run": d1(ratio, 3),
            "colour": cmyk_counts([t["col"] for t in dls]), "width_mm": d1([t["width_mm"] for t in dls]),
            "definition": ("run-in dateline: a colon, or a spaced dash, within 30 mm of the start of a story's first body line "
                           "(story_openings); bold = a bold face or text render mode 2")}


def headline_size_table(pages: list, grids: dict) -> dict:
    rows, lines, ratio = defaultdict(lambda: defaultdict(list)), defaultdict(list), defaultdict(list)
    xs, ys = [], []
    for P in pages:
        for d in P["disp"]:
            if d["kind"] != "headline":
                continue
            key = f"{d['grid']}:{d['cols']}" if d["grid"] in ("8col", "6col") and d["cols"] else "off_grid"
            rows[key]["all"].append(d["size"])
            rows[key][P["ptype"]].append(d["size"])
            lines[key].append(len(d["lines"]))
            ratio[key].append(d["size"] / P["body_size"])
            if d["grid"] == "8col" and d["cols"]:
                xs.append(d["cols"])
                ys.append(d["size"])
    order = sorted(rows, key=lambda k: (k.split(":")[0] != "8col", k == "off_grid", int(k.split(":")[1]) if ":" in k else 99))
    table = {k: {"size_pt": {t: d1(rows[k][t]) for t in ("all",) + PTYPES}, "lines": {"dist": d1(lines[k], 1),
                 "histogram": {str(a): b for a, b in sorted(Counter(lines[k]).items())}}, "size_over_body": d1(ratio[k], 3)} for k in order}
    return {"by_span": table, "size_vs_8col_span_fit": theil_sen(xs, ys),
            "rule": "span = the headline's fitted grid span (headlines.py); sizes in pt; page type columns per section"}


MAIN_HEADS = {"headline", "headline_stacked"}
SPACING = (  # name, upper kinds, lower kinds, what the distance is
    ("headline_to_deck", MAIN_HEADS, {"deck"}, "B2B: headline last baseline -> deck first baseline"),
    ("deck_to_byline", {"deck"}, {"byline"}, "B2B"),
    ("headline_to_byline", MAIN_HEADS, {"byline"}, "B2B"),
    ("byline_to_body", {"byline"}, {"body"}, "B2B: byline line -> first body baseline"),
    ("headline_to_body", MAIN_HEADS, {"body"}, "B2B: headline last baseline -> first body baseline (no deck, byline or photo between)"),
    ("deck_to_body", {"deck"}, {"body"}, "B2B"),
    ("headline_to_photo", MAIN_HEADS, {"image"}, "headline last baseline -> photo top edge"),
    ("deck_to_photo", {"deck"}, {"image"}, "deck last baseline -> photo top edge"),
    ("photo_to_body", {"image"}, {"body"}, "photo bottom edge -> first body baseline"),
    ("photo_to_headline", {"image"}, MAIN_HEADS, "photo bottom edge -> headline first baseline (photo above its headline)"),
    ("photo_to_caption", {"image"}, {"caption"}, "photo bottom edge -> caption first baseline"),
    ("caption_to_body", {"caption"}, {"body"}, "B2B"),
    ("body_to_rule", {"body"}, {"rule"}, "last body baseline -> rule"),
    ("photo_to_rule", {"image"}, {"rule"}, "photo bottom edge -> rule"),
    ("rule_to_headline", {"rule"}, MAIN_HEADS, "rule -> headline first baseline"),
    ("rule_to_photo", {"rule"}, {"image"}, "rule -> photo top edge"),
    ("rule_to_body", {"rule"}, {"body"}, "rule -> first body baseline"),
    ("body_to_headline_no_rule", {"body"}, MAIN_HEADS, "B2B: last body baseline of the story above -> headline first baseline"),
    ("crosshead_space_above", {"body"}, {"crosshead"}, "B2B: body -> crosshead"),
    ("crosshead_space_below", {"crosshead"}, {"body"}, "B2B: crosshead -> body"),
    ("brief_headline_space_above", {"body"}, {"headline_brief"}, "B2B"),
    ("brief_headline_space_below", {"headline_brief"}, {"body"}, "B2B"),
    ("jump_head_space_above", {"body"}, {"headline_jump"}, "B2B"),
    ("jump_head_space_below", {"headline_jump"}, {"body"}, "B2B"),
    ("body_to_body_between_runs", {"body"}, {"body"}, "B2B across a gap in one column (blank line or a run break)"),
    ("box_top_to_first_baseline", {"box_top"}, TEXT_KINDS, "box top edge -> first baseline inside"),
    ("last_baseline_to_box_bottom", TEXT_KINDS, {"box_bottom"}, "last baseline inside -> box bottom edge"),
    ("box_bottom_to_headline", {"box_bottom"}, MAIN_HEADS, "box bottom edge -> headline first baseline"),
    ("box_bottom_to_body", {"box_bottom"}, {"body"}, "box bottom edge -> first body baseline"),
)


def lead_unit(P: dict, a: dict, b: dict) -> float:
    for e in (b, a):
        if e["kind"] == "body" and e.get("lead"):
            return e["lead"] / MM
    return P["body_lead"] / MM


def spacing_section(pages: list) -> dict:
    out, dropped = {}, Counter()
    vals = defaultdict(list)
    for P in pages:
        for a, b, d, c in P["pairs"]:
            L = lead_unit(P, a, b)
            if d <= 0 or d > PAIR_MAX_LEAD * L:
                dropped[(a["kind"], b["kind"])] += 1
                continue
            for name, ua, lb, _ in SPACING:
                if a["kind"] in ua and b["kind"] in lb:
                    if name == "headline_to_body":
                        name = name + ("_runin_dateline" if b.get("runin") else "")
                    h = a if a["kind"] in HEAD_KINDS else b if b["kind"] in HEAD_KINDS else None
                    vals[name].append((d, d / L, d / (h["size"] / MM) if h else None))
    for name, ua, lb, what in SPACING + (("headline_to_body_runin_dateline", MAIN_HEADS, {"body"}, "B2B; the first body line opens with a run-in dateline"),):
        v = vals.get(name, [])
        out[name] = {"n": len(v), "mm": d1([x for x, _, _ in v]), "body_leadings": d1([y for _, y, _ in v], 3), "measure": what}
        if any(z is not None for _, _, z in v):
            out[name]["over_headline_size"] = d1([z for _, _, z in v], 3)
    # kicker -> headline (box edges between them are allowed: kickers often sit in a label panel)
    kv, kr, kalign, panels = [], [], [], []
    for P in pages:
        heads = [d for d in P["disp"] if d["kind"] in HEAD_KINDS]
        boxes = [p for p in P["paths"] if p["cls"] == "box" and p["fill"]]
        for k in (d for d in P["disp"] if d["kind"] == "kicker"):
            cands = [h for h in heads if 0.5 < h["y_top"] - k["y_bot"] <= 40 and HL.overlap(k["x0"], k["x1"], h["x0"], h["x1"]) >= 0.5 * (k["x1"] - k["x0"])]
            rev = is_white(k["colour"]) or k["reason"].startswith("K2")
            if cands:
                h = min(cands, key=lambda h: h["y_top"])
                dd = h["y_top"] - k["y_bot"]
                (kr if rev else kv).append((dd, dd * MM / P["body_lead"], dd / (h["size"] / MM)))
                s0, s1 = h["span"]
                kalign.append("flush left with the headline span" if abs(k["x0"] - s0) <= GRID_SNAP_MM else
                              "centred on the headline span" if abs((k["x0"] + k["x1"]) / 2 - (s0 + s1) / 2) <= GRID_SNAP_MM else
                              "flush right with the headline span" if abs(k["x1"] - s1) <= GRID_SNAP_MM else "other")
            pan = [p for p in boxes if p["x0"] - 0.5 <= k["x0"] and k["x1"] <= p["x1"] + 0.5 and p["y0"] - 0.5 <= k["y_top"] <= p["y1"] + 0.5 and p["y1"] - p["y0"] <= 3 * k["size"] / MM]
            if pan:
                p = min(pan, key=lambda p: (p["x1"] - p["x0"]) * (p["y1"] - p["y0"]))
                panels.append({"rev": rev, "h": p["y1"] - p["y0"], "top_to_baseline": k["y_top"] - p["y0"], "baseline_to_bottom": p["y1"] - k["y_bot"],
                               "inset_left": k["x0"] - p["x0"], "col": p["fcol"], "w_over_text": (p["x1"] - p["x0"]) / max(k["x1"] - k["x0"], 0.1)})
    out["kicker_to_headline"] = {"n": len(kv), "mm": d1([a for a, _, _ in kv]), "body_leadings": d1([b for _, b, _ in kv], 3),
                                 "over_headline_size": d1([c for _, _, c in kv], 3), "measure": "B2B: kicker baseline -> headline first baseline (K1/K3)"}
    out["reversed_label_to_headline"] = {"n": len(kr), "mm": d1([a for a, _, _ in kr]), "body_leadings": d1([b for _, b, _ in kr], 3),
                                         "measure": "B2B: reversed label baseline -> headline first baseline"}
    out["kicker_alignment_to_headline"] = counts(Counter(kalign))
    out["label_panels"] = {"n": len(panels), "reversed_share": share(sum(p["rev"] for p in panels), len(panels)),
                           "height_mm": d1([p["h"] for p in panels]), "top_to_baseline_mm": d1([p["top_to_baseline"] for p in panels]),
                           "baseline_to_bottom_mm": d1([p["baseline_to_bottom"] for p in panels]), "left_inset_mm": d1([p["inset_left"] for p in panels]),
                           "fill": cmyk_counts([p["col"] for p in panels]), "panel_width_over_text_width": d1([p["w_over_text"] for p in panels], 3)}
    # what sits directly above each main headline (story separation), and body -> rule -> headline chains
    above = Counter()
    chains = []
    for P in pages:
        up, down = neighbour_maps(P)
        for h in (e for e in P["elements"] if e["kind"] == "headline"):
            ups = sorted(up.get(h["id"], []), key=lambda t: t[1])
            above[ups[0][0]["kind"] if ups else "nothing (top of the editorial area)"] += 1
        for r in (e for e in P["elements"] if e["kind"] == "rule"):
            us = [(a, d) for a, d in up.get(r["id"], []) if a["kind"] in ("body", "image")]
            ls = [(b, d) for b, d in down.get(r["id"], []) if b["kind"] in MAIN_HEADS]
            if us and ls:
                a, da = min(us, key=lambda t: t[1])
                b, db = min(ls, key=lambda t: t[1])
                L = (a.get("lead") or P["body_lead"]) / MM
                if da + db <= PAIR_MAX_LEAD * L:
                    chains.append((da + db, (da + db) / L, a["kind"]))
    out["element_directly_above_main_headline"] = counts(above)
    out["story_separation_with_rule"] = {"n": len(chains), "mm": d1([c[0] for c in chains]), "body_leadings": d1([c[1] for c in chains], 3),
                                         "measure": "last body baseline (or photo bottom) above -> rule -> headline first baseline, total"}
    out["pairs_dropped_as_too_far"] = sum(dropped.values())
    out["pairs_dropped_text_between"] = sum(P.get("pairs_blocked_by_text", 0) for P in pages)
    out["rule"] = (f"neighbours in the 8-column stacks; pairs farther than {PAIR_MAX_LEAD} body leadings or overlapping are not "
                   "spacing evidence; L = the body leading of the text involved, else the page's body leading")
    return out


def rules_and_boxes(pages: list, grids: dict) -> dict:
    cols = grid_columns(grids["8col"])
    hr, ctx, lengths, full = [], Counter(), Counter(), 0
    area0, area1 = cols[0][0], cols[-1][1]
    for P in pages:
        up, down = neighbour_maps(P)
        tb = P["topblock"]
        for p in P["paths"]:
            if p["cls"] != "hrule":
                continue
            weight = p["sw"] if p["stroke"] else (p["y1"] - p["y0"]) * MM
            col = p["scol"] if p["stroke"] else p["fcol"]
            hr.append((weight, col))
            w = p["x1"] - p["x0"]
            if tb and p["y0"] <= tb["y1"] + 0.5:
                where = "running head / masthead"
            elif any(abs(p["y0"] - a["y_top"]) <= 3 and HL.overlap(p["x0"], p["x1"], a["x0"], a["x1"]) > 0 for a in P["ads"] + P["standing"]):
                where = "above an ad or standing block"
            else:
                us = {a["kind"] for a, _ in up.get(p["id"], [])}
                ls = {b["kind"] for b, _ in down.get(p["id"], [])}
                if ls & (MAIN_HEADS | {"kicker", "box_top", "strap"}) or (ls & {"image"} and us & {"body", "image"}):
                    where = "between stories (above a headline, kicker, panel or photo)"
                elif us & STORY_TOP_KINDS and ls & {"body", "image"}:
                    where = "under a headline or deck"
                elif any(q["cls"] == "box" and q["x0"] - 1 <= p["x0"] and p["x1"] <= q["x1"] + 1 and q["y0"] <= p["y0"] <= q["y1"] for q in P["paths"]):
                    where = "inside a box"
                elif not ls:
                    where = "nothing below (foot of a column or page)"
                else:
                    where = "other (" + "/".join(sorted(us)) + " -> " + "/".join(sorted(ls)) + ")"
            ctx[where] += 1
            n, res = span_fit(w, grids)
            lengths[f"{n} col" if abs(res) <= GRID_SNAP_MM else "off-grid"] += 1
            full += abs(p["x0"] - area0) <= GRID_SNAP_MM and abs(p["x1"] - area1) <= GRID_SNAP_MM
    weights = Counter(round(w, 2) for w, _ in hr)
    vr = [p for P in pages for p in P["paths"] if p["cls"] == "vrule"]
    # boxes below the top block, outside ads and standing blocks
    cats = defaultdict(list)
    for P in pages:
        tb = P["topblock"]
        photos = [i for i in P["images"] if i["cls"] == "photo"]
        boxes = [p for p in P["paths"] if p["cls"] == "box" and not (tb and p["y0"] < tb["y1"] - 0.5)]
        holder = {}                         # each text run belongs to the topmost box behind it (content order: later on top)
        for r in P["truns"]:
            under = [p for p in boxes if p["x0"] - 0.5 <= r["x0"] and r["x1"] <= p["x1"] + 0.5 and p["y0"] <= r["y"] <= p["y1"]]
            if under:
                holder.setdefault(max(under, key=lambda p: int(p["id"][1:]))["id"], []).append(r)
        for p in boxes:
            b = {"x0": p["x0"], "x1": p["x1"], "y_top": p["y0"], "y_bot": p["y1"]}
            if any(inside(b, a) for a in P["ads"] + P["standing"]):
                continue
            inner = holder.get(p["id"], [])
            fill = p["fcol"] if p["fill"] else None
            dark = fill is not None and lightness(fill, 1.0) <= 0.45
            light_fill = fill is not None and lightness(fill, 0.0) >= 0.85
            on_dark = any(int(q["id"][1:]) < int(p["id"][1:]) and q["fill"] and lightness(q["fcol"], 1.0) <= 0.45 and q["x0"] - 1 <= p["x0"]
                          and p["x1"] <= q["x1"] + 1 and q["y0"] - 1 <= p["y0"] and p["y1"] <= q["y1"] + 1 for q in boxes)
            if any(all(abs(p[a] - i[c]) <= 1.5 for a, c in (("x0", "x0"), ("x1", "x1"), ("y0", "y_top"), ("y1", "y_bot"))) for i in photos) and p["stroke"]:
                cat = "photo_frame"
            elif dark and inner and sum(lightness(r["col"], 0.0) >= 0.6 for r in inner) >= 0.5 * len(inner):
                cat = "reverse_panel"
            elif light_fill and on_dark and inner:
                cat = "inset_label"
            elif fill and not is_white(fill) and inner and p["y1"] - p["y0"] <= 15:
                cat = "label_panel"
            elif fill and not is_white(fill) and inner:
                cat = "tint_panel"
            elif p["stroke"] and inner:
                cat = "ruled_box"
            elif is_white(fill) and not p["stroke"] and inner:
                cat = "white_mask"
            elif not inner:
                cat = "frame_or_tab"
            else:
                cat = "other_box"
            n, res = span_fit(p["x1"] - p["x0"], grids)
            cats[cat].append({"fill": fill, "stroke": p["scol"] if p["stroke"] else None, "sw": p["sw"] if p["stroke"] else None,
                              "w": p["x1"] - p["x0"], "h": p["y1"] - p["y0"], "cols": n if abs(res) <= GRID_SNAP_MM else None,
                              "pad_top": min((r["y"] - p["y0"] for r in inner), default=None),
                              "pad_bottom": min((p["y1"] - r["y"] for r in inner), default=None),
                              "pad_left": min((r["x0"] - p["x0"] for r in inner), default=None), "ptype": P["ptype"]})
    boxes = {}
    for cat, bs in sorted(cats.items()):
        boxes[cat] = {"n": len(bs), "fill": cmyk_counts([b["fill"] for b in bs]), "stroke": cmyk_counts([b["stroke"] for b in bs if b["stroke"]]),
                      "stroke_weight_pt": d1([b["sw"] for b in bs if b["sw"]], 3), "width_mm": d1([b["w"] for b in bs]), "height_mm": d1([b["h"] for b in bs]),
                      "width_in_columns": counts(Counter(str(b["cols"]) if b["cols"] else "off-grid" for b in bs)),
                      "padding_top_to_first_baseline_mm": d1([b["pad_top"] for b in bs]), "padding_last_baseline_to_bottom_mm": d1([b["pad_bottom"] for b in bs]),
                      "padding_left_mm": d1([b["pad_left"] for b in bs]), "by_page_type": {t: sum(1 for b in bs if b["ptype"] == t) for t in PTYPES}}
    return {
        "horizontal_rules": {"n": len(hr), "weight_pt": d1([w for w, _ in hr], 3),
                             "weights_pt": {str(k): {"n": v, "share": share(v, len(hr))} for k, v in weights.most_common(8)},
                             "colour": cmyk_counts([c for _, c in hr]), "where": counts(ctx), "length_in_columns": counts(lengths),
                             "full_type_area_width_share": share(full, len(hr)), "per_page": by_type(pages, lambda P: sum(1 for p in P["paths"] if p["cls"] == "hrule"), 1)},
        "vertical_rules": {"n": len(vr), "note": "no column rules: gutters are white" if not vr else "see weights",
                           "weight_pt": d1([p["sw"] for p in vr if p["stroke"]], 3)},
        "boxes": boxes,
        "box_categories": {"photo_frame": "stroked box on a photo's edges", "reverse_panel": "dark fill (lightness <= 0.45) holding light text (lightness >= 0.6)",
                           "label_panel": "tinted (not white) fill <= 15 mm tall holding a short label", "tint_panel": "tinted (not white) fill taller than 15 mm holding text",
                           "inset_label": "light panel laid on a darker box (a tab label: dark frame, light panel, dark text)",
                           "ruled_box": "stroked box holding text (no tint)", "white_mask": "white fill without stroke holding text (knock-out)",
                           "frame_or_tab": "box with no text of its own (empty frames, the dark tab under an inset label, artwork rectangles)",
                           "other_box": "anything else"},
    }


def images_section(pages: list, grids: dict, spacing: dict) -> dict:
    photos = [(P, im) for P in pages for im in P["images"] if im["cls"] == "photo"]
    fit = [(P, im, *span_fit(im["x1"] - im["x0"], grids)) for P, im in photos]
    widths = Counter(str(n) if abs(res) <= GRID_SNAP_MM else "off-grid" for _, _, n, res in fit)
    hb = defaultdict(list)
    for P, im, n, res in fit:
        if abs(res) <= GRID_SNAP_MM:
            hb[str(n)].append(im["y_bot"] - im["y_top"])
    asp = [(im["x1"] - im["x0"]) / (im["y_bot"] - im["y_top"]) for _, im in photos]
    caps, gaps = 0, []
    framed = 0
    text_over = 0
    span_rel = Counter()
    for P, im in photos:
        cs = [d for d in P["disp"] if d["kind"] == "caption" and d["x0"] >= im["x0"] - 3 and d["x1"] <= im["x1"] + 3
              and (-1 <= d["y_top"] - im["y_bot"] <= 10 or (im["y_top"] <= d["y_top"] <= im["y_bot"]))]
        if cs:
            caps += 1
            gaps += [d["y_top"] - im["y_bot"] for d in cs if d["y_top"] >= im["y_bot"] - 1]
        framed += any(p["cls"] == "box" and p["stroke"] and all(abs(p[a] - im[c]) <= 1.5 for a, c in (("x0", "x0"), ("x1", "x1"), ("y0", "y_top"), ("y1", "y_bot")))
                      for p in P["paths"])
        text_over += any(im["x0"] + 1 < r["x0"] and r["x1"] < im["x1"] - 1 and im["y_top"] + 1 < r["y"] < im["y_bot"] - 1 for r in P["truns"])
        if im.get("place") in ("below_headline", "above_headline") and im.get("headline"):
            h = next((e for e in P["elements"] if e["id"] == im["headline"]), None)
            if h and h.get("span"):
                s0, s1 = h["span"]
                l, r = abs(im["x0"] - s0) <= GRID_SNAP_MM, abs(im["x1"] - s1) <= GRID_SNAP_MM
                span_rel["full headline span" if l and r else "flush left in the span" if l else "flush right in the span" if r else "inside the span"] += 1
    by_place_size = defaultdict(list)
    for P, im, n, res in fit:
        by_place_size[im.get("place")].append(n)
    gut = grids["8col"]["pitch"] - grids["8col"]["width"]
    local, kcols, fitcls = [], Counter(), Counter()
    for P, im, n, res in fit:
        up, down = neighbour_maps(P)
        near = sorted([(d, b) for b, d in down.get(im["id"], []) if b["kind"] == "body" and not b.get("fragment")]
                      + [(d, a) for a, d in up.get(im["id"], []) if a["kind"] == "body" and not a.get("fragment")], key=lambda t: (t[0], t[1]["x0"]))
        w = im["x1"] - im["x0"]
        if near:
            wc = near[0][1]["width"]
            k = max(1, round((w + gut) / (wc + gut)))
            r2 = w - (k * wc + (k - 1) * gut)
            local.append(r2)
            if abs(r2) <= 1.5:
                kcols[str(k)] += 1
        else:
            r2 = None
        fitcls["fits the story's text columns" if r2 is not None and abs(r2) <= 1.5 else "fits the 8-column grid" if abs(res) <= 1.5
               else "neither (no body text next to it, or a free width)" if r2 is None else "neither"] += 1
    return {
        "n_photos": len(photos), "image_classes": counts(Counter(im["cls"] for P in pages for im in P["images"])),
        "photos_per_page": by_type(pages, lambda P: sum(1 for i in P["images"] if i["cls"] == "photo"), 1),
        "width_in_8col_spans": counts(widths), "width_residual_to_8col_span_mm": d1([res for *_, res in fit], 2),
        "width_fit": counts(fitcls), "width_in_story_text_columns": counts(kcols),
        "width_residual_to_story_text_columns_mm": d1(local, 2),
        "height_mm": d1([im["y_bot"] - im["y_top"] for _, im in photos]), "height_mm_by_width_columns": {k: d1(v) for k, v in sorted(hb.items())},
        "aspect_w_over_h": d1(asp, 3), "orientation": counts(Counter("landscape" if a > 1.05 else "portrait" if a < 0.95 else "square" for a in asp)),
        "place_relative_to_headline": counts(Counter(im.get("place") for _, im in photos)),
        "width_relative_to_headline_span": counts(span_rel),
        "columns_by_place": {k: d1(v, 1) for k, v in sorted(by_place_size.items(), key=lambda kv: str(kv[0]))},
        "possible_one_off_ads": sum(1 for _, im in photos if im.get("possible_ad")),
        "with_caption_share": share(caps, len(photos)), "caption_gap_photo_bottom_to_first_baseline_mm": d1(gaps),
        "with_frame_share": share(framed, len(photos)), "with_text_over_photo_share": share(text_over, len(photos)),
        "spacing": {k: spacing[k] for k in ("headline_to_photo", "deck_to_photo", "photo_to_body", "photo_to_headline", "photo_to_caption", "rule_to_photo", "photo_to_rule")},
        "rule": ("photos = images >= 15 x 10 mm that are not furniture, recurring or inside an ad block; widths fitted to the "
                 "8-column spans and to k text columns of the body frame directly below or above the photo (gutter between)"),
    }


def furniture_section(pages: list) -> dict:
    out = {}
    fronts = [P for P in pages if P["ptype"] == "front"]
    mb = [P["topblock"] for P in fronts if P["topblock"]]
    faces, name_runs = Counter(), defaultdict(list)
    for P in fronts:
        tb = P["topblock"]
        for r in P["truns"]:
            if tb and tb["y0"] - 1 <= r["y"] <= tb["y1"] + 1 and tb["x0"] - 1 <= r["x0"] and r["x1"] <= tb["x1"] + 1 and r["size"] >= 3 * P["body_size"]:
                faces[r["font"]] += 1
                name_runs[r["font"]].append(r)
    out["masthead"] = {"n_pages": len(mb), "x0_mm": d1([b["x0"] for b in mb]), "y0_mm": d1([b["y0"] for b in mb]), "x1_mm": d1([b["x1"] for b in mb]),
                       "y1_mm": d1([b["y1"] for b in mb]), "height_mm": d1([b["h"] for b in mb]),
                       "made_of": counts(sum((Counter(b["kinds"]) for b in mb), Counter())), "nameplate_text_faces": counts(faces),
                       "nameplate_text": {f: {"runs": len(v), "size_pt": d1([r["size"] for r in v]), "baseline_mm": d1([r["y"] for r in v]),
                                              "x0_mm": d1([r["x0"] for r in v]), "x1_mm": d1([r["x1"] for r in v]), "colour": cmyk_counts([r["col"] for r in v])}
                                          for f, v in sorted(name_runs.items())},
                       "positions_seen": counts(Counter(f"x0 {round(b['x0'])} mm, width {round(b['x1'] - b['x0'])} mm" for b in mb))}
    # running heads (inside and back pages)
    var = defaultdict(list)
    for P in pages:
        if P["ptype"] == "front" or not P["topblock"]:
            continue
        tb = P["topblock"]
        bars = [p for p in P["paths"] if p["id"] in tb["members"] and p["cls"] == "box"]
        bar = max(bars, key=lambda p: (p["x1"] - p["x0"]) * (p["y1"] - p["y0"])) if bars else None
        key = f"height {round(tb['h'])} mm, fill {colour_name(bar['fcol']) if bar and bar['fill'] else 'none'}"
        var[key].append((P, tb, bar))
    rh = {}
    for k, (key, items) in enumerate(sorted(var.items(), key=lambda kv: -len(kv[1]))):
        dl, fo, logos = [], [], []
        for P, tb, bar in items:
            for r in P["truns"]:
                if tb["y0"] - 1 <= r["y"] <= tb["y1"] + 1 and r.get("furn"):
                    if is_number(r["t"]):
                        fo.append((P, r))
                    elif r["furn"] == "variable":
                        dl.append((P, r))
            logos += [im for im in P["images"] if im["id"] in tb["members"]]
        spec = lambda rs: {"n": len(rs), "fonts": counts(Counter(r["font"] for _, r in rs)), "size_pt": d1([r["size"] for _, r in rs]),  # noqa: E731
                           "colour": cmyk_counts([r["col"] for _, r in rs]), "baseline_mm": d1([r["y"] for _, r in rs]),
                           "x0_mm": d1([r["x0"] for _, r in rs]), "x1_mm": d1([r["x1"] for _, r in rs])}
        bars = [b for _, _, b in items if b]
        rh[f"variant_{chr(65 + k)}"] = {
            "n_pages": len(items), "by_page_type": counts(Counter(P["ptype"] for P, _, _ in items)), "key": key,
            "block_mm": {"y0": d1([tb["y0"] for _, tb, _ in items]), "y1": d1([tb["y1"] for _, tb, _ in items]), "height": d1([tb["h"] for _, tb, _ in items]),
                         "x0": d1([tb["x0"] for _, tb, _ in items]), "x1": d1([tb["x1"] for _, tb, _ in items])},
            "bar": {"fill": cmyk_counts([b["fcol"] for b in bars if b["fill"]]), "stroke": cmyk_counts([b["scol"] for b in bars if b["stroke"]]),
                    "stroke_weight_pt": d1([b["sw"] for b in bars if b["stroke"]], 3)},
            "logo": {"n": len(logos), "x0_mm": d1([i["x0"] for i in logos]), "y0_mm": d1([i["y_top"] for i in logos]),
                     "width_mm": d1([i["x1"] - i["x0"] for i in logos]), "height_mm": d1([i["y_bot"] - i["y_top"] for i in logos])},
            "date_line": spec(dl), "folio": spec(fo)}
    out["running_head"] = rh
    # imprint, standing modules, section labels
    imp = [(P, b) for P in pages for b in P["standing"] if b["type"] == "imprint"]
    imp_runs = [r for P, b in imp for r in P["truns"] if b["y_top"] - 0.5 <= r["y"] <= b["y_bot"] + 0.5 and b["x0"] - 0.5 <= r["x0"]]
    out["imprint"] = {"n_pages": len(imp), "by_page_type": counts(Counter(P["ptype"] for P, _ in imp)),
                      "y0_mm": d1([b["y_top"] for _, b in imp]), "y1_mm": d1([b["y_bot"] for _, b in imp]),
                      "fonts": counts(Counter(r["font"] for r in imp_runs)), "size_pt": d1([r["size"] for r in imp_runs])}
    mods = [(P, b) for P in pages for b in P["standing"] if b["type"] == "standing_module"]
    out["standing_modules"] = {"n": len(mods), "by_page_type": counts(Counter(P["ptype"] for P, _ in mods)),
                               "x0_mm": d1([b["x0"] for _, b in mods]), "y0_mm": d1([b["y_top"] for _, b in mods]),
                               "width_mm": d1([b["x1"] - b["x0"] for _, b in mods]), "height_mm": d1([b["y_bot"] - b["y_top"] for _, b in mods])}
    labels = defaultdict(list)
    for P in pages:
        tb = P["topblock"]
        for r in P["truns"]:
            if r.get("furn") != "static" or (tb and r["y"] <= tb["y1"] + 1):
                continue
            if any(b["x0"] - 1 <= r["x0"] and r["x1"] <= b["x1"] + 1 and b["y_top"] - 1 <= r["y"] <= b["y_bot"] + 1 for b in P["ads"] + P["standing"]):
                continue
            labels[(P["ptype"], r["font"], round(r["size"], 1), "white" if is_white(r["col"]) else colour_name(r["col"]))].append(r)
    out["standing_labels"] = [{"page_type": k[0], "font": k[1], "size_pt": k[2], "colour": k[3], "n_runs": len(v),
                               "x0_mm": d1([r["x0"] for r in v]), "baseline_mm": d1([r["y"] for r in v])}
                              for k, v in sorted(labels.items(), key=lambda kv: -len(kv[1]))[:12]]
    out["rule"] = (f"furniture = text repeated at the same position (+-{POS_TOL_MM} mm) in >= {RECUR_EDITIONS} editions (static), or one "
                   "font and size at one position with changing text inside the top block or at the page foot (variable: date line, folio)")
    return out


def raster_shares(P: dict) -> dict:
    """Share of the trim area by class on a 1 mm grid; later classes overwrite earlier ones:
    graphics (boxes, rules, icons) < text (line em boxes) < photo < furniture (top block, imprint, modules) < ad."""
    W, H = int(math.ceil(P["W"])), int(math.ceil(P["H"]))
    grid = [bytearray(W) for _ in range(H)]

    def paint(x0, y0, x1, y1, v):
        a, b = max(0, int(math.floor(x0))), min(W, int(math.ceil(x1)))
        if b <= a:
            return
        for y in range(max(0, int(math.floor(y0))), min(H, int(math.ceil(y1)))):
            grid[y][a:b] = bytes([v]) * (b - a)
    for p in P["paths"]:
        if p["cls"] in ("box", "hrule") and not (p["fill"] and is_white(p["fcol"]) and not p["stroke"]):
            paint(p["x0"], p["y0"], p["x1"], max(p["y1"], p["y0"] + 0.3), 1)
    for im in P["images"]:
        if im["cls"] == "icon":
            paint(im["x0"], im["y_top"], im["x1"], im["y_bot"], 1)
    for r in P["runs"]:
        paint(r["x0"], r["y_top"] - 0.75 * r["size"] / MM, r["x1"], r["y_bot"] + 0.25 * r["size"] / MM, 2)
    for d in P["disp"]:
        for l in d["lines"]:
            paint(l["x0"], l["y"] - 0.75 * d["size"] / MM, l["x1"], l["y"] + 0.25 * d["size"] / MM, 2)
    for im in P["images"]:
        if im["cls"] == "photo":
            paint(im["x0"], im["y_top"], im["x1"], im["y_bot"], 3)
    tb = P["topblock"]
    if tb:
        paint(tb["x0"], tb["y0"], tb["x1"], tb["y1"], 4)
    for b in P["standing"]:
        paint(b["x0"], b["y_top"], b["x1"], b["y_bot"], 4)
    for im in P["images"]:
        if im["cls"] in ("furniture", "recurring"):
            paint(im["x0"], im["y_top"], im["x1"], im["y_bot"], 4)
    for b in P["ads"]:
        paint(b["x0"], b["y_top"], b["x1"], b["y_bot"], 5)
    c = Counter()
    for row in grid:
        c.update(row)
    n = W * H
    return {"white": c[0] / n, "graphics": c[1] / n, "text": c[2] / n, "photo": c[3] / n, "furniture": c[4] / n, "ad": c[5] / n}


def composition_section(pages: list, grids: dict) -> dict:
    per = []
    for P in pages:
        heads = [d for d in P["disp"] if d["kind"] == "headline"]
        lead = max(heads, key=lambda d: (d["size"], d["span"][1] - d["span"][0], -d["y_top"])) if heads else None
        ed_h = max(P["content_bottom"] - P["editorial_top"], 1.0)
        rec = {"P": P, "main": len(heads), "brief": sum(d["kind"] == "headline_brief" for d in P["disp"]),
               "jump": sum(d["kind"] == "headline_jump" for d in P["disp"]), "photos": sum(i["cls"] == "photo" for i in P["images"]),
               "ads": len(P["ads"]), "areas": raster_shares(P)}
        if lead:
            n, res = span_fit(lead["span"][1] - lead["span"][0], grids)
            col0 = min(range(grids["8col"]["n"]), key=lambda k: abs(grid_columns(grids["8col"])[k][0] - lead["span"][0]))
            rec["lead"] = {"size": lead["size"], "cols": n if abs(res) <= GRID_SNAP_MM else None, "lines": len(lead["lines"]),
                           "first_col": col0 + 1, "y_rel": (lead["y_top"] - P["editorial_top"]) / ed_h,
                           "topmost": not any(d["y_top"] < lead["y_top"] - 1 for d in heads),
                           "photo": any(i.get("headline") == lead["id"] for i in P["images"])}
        per.append(rec)
    out = {}
    for t in ("all",) + PTYPES:
        rs = [r for r in per if t == "all" or r["P"]["ptype"] == t]
        leads = [r["lead"] for r in rs if r.get("lead")]
        out[t] = {
            "pages": len(rs),
            "main_stories_per_page": d1([r["main"] for r in rs], 1), "brief_items_per_page": d1([r["brief"] for r in rs], 1),
            "jump_heads_per_page": d1([r["jump"] for r in rs], 1), "photos_per_page": d1([r["photos"] for r in rs], 1),
            "pages_with_ads": sum(1 for r in rs if r["ads"]),
            "lead_story": {"n": len(leads), "size_pt": d1([l["size"] for l in leads]), "span_columns": counts(Counter(str(l["cols"]) if l["cols"] else "off-grid" for l in leads)),
                           "lines": counts(Counter(str(l["lines"]) for l in leads)), "first_column": counts(Counter(str(l["first_col"]) for l in leads)),
                           "vertical_position_share_of_editorial_height": d1([l["y_rel"] for l in leads], 3),
                           "is_topmost_story_share": share(sum(l["topmost"] for l in leads), len(leads)),
                           "has_photo_share": share(sum(l["photo"] for l in leads), len(leads))},
            "area_share_of_trim": {k: d1([r["areas"][k] for r in rs], 3) for k in ("text", "photo", "ad", "furniture", "graphics", "white")}}
    out["rule"] = ("lead story = the page's largest main headline (ties: wider span, higher); vertical position = (first baseline - "
                   "editorial top) / editorial height; areas on a 1 mm raster, priority ad > furniture > photo > text > graphics")
    return out


def size_bands(sizes: list) -> list:
    qs = [HL.q(sizes, p) for p in (0.25, 0.5, 0.75)]
    return [round(v, 1) for v in qs]


def band_labels(cuts: list) -> list:
    return [f"<{cuts[0]}"] + [f"{a}-{b}" for a, b in zip(cuts, cuts[1:])] + [f">={cuts[-1]}"]


def band_of(s: float, cuts: list) -> str:
    lo = None
    for c in cuts:
        if s < c:
            return f"<{c}" if lo is None else f"{lo}-{c}"
        lo = c
    return f">={cuts[-1]}"


def shape_section(pages: list, D: dict) -> dict:
    heads = []
    for P in pages:
        for d in P["disp"]:
            if d["kind"] == "headline" and len(d["lines"]) >= 2 and HL.deva_share(d["text"]) >= 0.5:
                heads.append((P, d))
    cuts = size_bands([d["size"] for _, d in heads])

    def feats(P, d):
        w = [l["w"] for l in d["lines"]]
        span = d["span"][1] - d["span"][0]
        return {"bal": min(w) / max(w), "first": w[0] > max(w[1:]) + 1.0, "last": w[-1] > max(w[:-1]) + 1.0,
                "fill": max(w) / span if d["grid"] != "none" and span > 0 else None}
    F = [(P, d, feats(P, d)) for P, d in heads]
    keys = {"page_in_section": lambda P, d: str(P["read_index"]), "page_type": lambda P, d: P["ptype"],
            "span_columns": lambda P, d: f"{d['grid']}:{d['cols']}" if d["grid"] != "none" else "off_grid",
            "size_band_pt": lambda P, d: band_of(d["size"], cuts), "alignment": lambda P, d: d["align"]}
    printed = {}
    for name, fn in keys.items():
        g = defaultdict(list)
        for P, d, f in F:
            g[fn(P, d)].append(f)
        order = band_labels(cuts) if name == "size_band_pt" else sorted(g)
        g = {k: g[k] for k in order if k in g}
        printed[name] = {k: {"n": len(v), "balance_min_over_max": d1([f["bal"] for f in v], 3),
                             "first_line_longest_share": share(sum(f["first"] for f in v), len(v)),
                             "last_line_longest_share": share(sum(f["last"] for f in v), len(v)),
                             "longest_line_fill_of_span": d1([f["fill"] for f in v], 3)} for k, v in g.items()}
    allf = [f for _, _, f in F]
    printed["all"] = {"n": len(allf), "balance_min_over_max": d1([f["bal"] for f in allf], 3),
                      "first_line_longest_share": share(sum(f["first"] for f in allf), len(allf)),
                      "last_line_longest_share": share(sum(f["last"] for f in allf), len(allf)),
                      "longest_line_fill_of_span": d1([f["fill"] for f in allf], 3)}
    # head1 rows: which shape reproduces the printed breaks where there was a real choice
    where = {}
    for P in pages:
        for d in P["disp"]:
            where[d["rec_id"]] = (P, d)
    rows = []
    for r in D["head1"]:
        if r["role"] != "headline" or r["id"] not in where:
            continue
        v1, fl = r["V1"], r["FILL"]
        if v1["token_mismatch"] or not v1["print_fits_standin"] or v1["print"]["lines"] < 2 or v1["n_layouts"] < 2:
            continue
        P, d = where[r["id"]]
        rows.append({"P": P, "d": d, "split": r["split"], "chance": 1 / v1["n_layouts"],
                     "BALANCE": v1["FIXED"].get("same_breaks", False), "FILL": fl["FIXED"].get("same_breaks", False),
                     "FIRST_FIT": v1["GREEDY"].get("same_breaks", False),
                     "BALANCE_N": v1["FIXED_N"].get("same_breaks", False), "FILL_N": fl["FIXED_N"].get("same_breaks", False)})
    arms = ("BALANCE", "FILL", "FIRST_FIT", "BALANCE_N", "FILL_N")

    def summ(rs):
        return {"n": len(rs), "chance_pct": round(100 * sum(x["chance"] for x in rs) / len(rs), 1) if rs else None,
                "exact_pct": {a: round(100 * sum(x[a] for x in rs) / len(rs), 1) if rs else None for a in arms}}
    choice = {"all": summ(rows), "calibration": summ([x for x in rows if x["split"] == "cal"]), "test": summ([x for x in rows if x["split"] == "test"])}
    for name, fn in keys.items():
        g = defaultdict(list)
        for x in rows:
            g[fn(x["P"], x["d"])].append(x)
        order = band_labels(cuts) if name == "size_band_pt" else sorted(g)
        choice[name] = {k: summ(g[k]) for k in order if k in g}
    # a per-page rule learned on the calibration editions, scored on the test editions
    learn = {}
    for pg in sorted({x["P"]["read_index"] for x in rows}):
        cal = [x for x in rows if x["split"] == "cal" and x["P"]["read_index"] == pg]
        tst = [x for x in rows if x["split"] == "test" and x["P"]["read_index"] == pg]
        best = max(("FILL", "BALANCE", "FIRST_FIT"), key=lambda a: (sum(x[a] for x in cal), a == "FILL")) if cal else "FILL"
        learn[str(pg)] = {"calibration_n": len(cal), "chosen": best, "test_n": len(tst),
                          "test_exact_pct": {a: round(100 * sum(x[a] for x in tst) / len(tst), 1) if tst else None for a in ("FILL", "BALANCE", "FIRST_FIT")}}
    tst = [x for x in rows if x["split"] == "test"]
    per_page_rule = sum(x[learn[str(x["P"]["read_index"])]["chosen"]] for x in tst)
    summary_path = REPO / "experiments" / "phase0" / "results" / "head1" / "summary.json"
    sel = json.loads(summary_path.read_text()).get("shape_selection", {}) if summary_path.exists() else {}
    return {
        "printed_multiline_headlines": printed, "size_band_cuts_pt": cuts,
        "choice_headlines": choice,
        "per_page_rule_learned_on_calibration": {"pages": learn, "test_exact_pct": round(100 * per_page_rule / len(tst), 1) if tst else None,
                                                 "test_n": len(tst)},
        "default": {"headline_shape": "fill", "per_page_option": "balanced", "crosshead_shape": "first-fit",
                    "line_count": "an input from the page plan (the owner fixes it before the headline is written)",
                    "why": ("'fill' (earlier lines as full as possible, Knuth-Plass ragged-right) won the pre-registered selection on the "
                            "calibration editions; the later editions tie it with 'balanced', and no page, span, size or alignment "
                            "group separates the shapes reliably, so the paper's own rule (by page and by designer) has to be set per page"),
                    "selection_evidence": {"calibration": sel.get("calibration", {}).get("exact_pct"),
                                           "calibration_n": sel.get("calibration", {}).get("n"),
                                           "calibration_mcnemar_fill_vs_balance": (sel.get("calibration", {}).get("mcnemar") or {}).get("FILL_vs_BALANCE"),
                                           "test": sel.get("test_V1_rules", {}).get("exact_pct"), "test_n": sel.get("test_V1_rules", {}).get("n"),
                                           "source": "experiments/phase0/results/head1/summary.json shape_selection"}},
        "rule": ("printed: Devanagari main headlines with >= 2 lines; balance = shortest / longest line; first line longest = longer than "
                 "every other line by > 1 mm; fill = longest line / span. choice: head1 rows that are comparable, multi-line and have "
                 ">= 2 feasible layouts (V1 rules; FIXED = fewest lines, *_N = printed line count); exact = the printed breaks."),
    }


def story_openings(P: dict) -> list:
    """(headline, body run) per main headline: the leftmost, then topmost body run reached downwards from the headline
    through its deck, strap, byline and photos (column stacks)."""
    up, down = neighbour_maps(P)
    out = []
    for h in (e for e in P["elements"] if e["kind"] in MAIN_HEADS):
        seen, frontier, runs = {h["id"]}, [b for b, _ in down.get(h["id"], [])], []
        while frontier:
            e = frontier.pop(0)
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            if e["kind"] == "body":
                runs.append(e)
            elif e["kind"] in ("deck", "strap", "byline", "image", "box_top", "box_bottom"):
                frontier += [b for b, _ in down.get(e["id"], [])]
        if runs:
            out.append((h, min(runs, key=lambda r: (round(r["x0"]), r["y_top"]))))
    return out


def other_practice(pages: list, D: dict, types: dict) -> dict:
    drop, bullets, rev = [], [], []
    for P in pages:
        smin = min((r["size"] for r in body_runs(P)), default=P["body_size"])
        bigs = [g for g in P["glyphs"] if g["size"] >= 2 * smin]
        for r in body_runs(P):
            first = r["lines"][:3]
            big = [g for g in bigs if g["size"] >= 2 * r["size"] and abs(g["x0"] - r["x0"]) <= 2.0
                   and first[0]["y"] - 1 <= g["y"] <= first[-1]["y"] + 1]
            if big:
                drop.append((P["ptype"], big[0]["font"], big[0]["size"] / r["size"]))
        for g in P["glyphs"]:
            if re.search(r"dings|symbol|webdings", g["font"], re.I) or g["t"] in "•●■▪►➤✓◆♦":
                starts_line = any(abs(g["y"] - l["y"]) <= SAME_LINE_MM and g["x0"] - r["x0"] <= 3 for r in P["runs"] for l in r["lines"]) or \
                    any(abs(g["y"] - t["y"]) <= SAME_LINE_MM and abs(g["x0"] - t["x0"]) <= 0.5 for t in P["truns"])
                bullets.append((g["font"], round(g["size"], 1), colour_name(g["col"]), starts_line))
        for t in P["truns"]:
            if is_white(t["col"]):
                under = [p for p in P["paths"] if p["fill"] and p["x0"] - 1 <= t["x0"] and t["x1"] <= p["x1"] + 1 and p["y0"] - 1 <= t["y"] <= p["y1"] + 1
                         and not is_white(p["fcol"])]
                panel = min(under, key=lambda p: (p["x1"] - p["x0"]) * (p["y1"] - p["y0"]))["fcol"] if under else None
                rev.append((P["ptype"], t["size"], panel, t["font"]))
    digits = Counter()
    keys = {(P["sid"], P["page"]) for P in pages}
    for p in D["paras"]:
        if (p["sample"], p["page"]) in keys:
            for ch in p["text"]:
                if unicodedata.category(ch) == "Nd":
                    digits["devanagari" if "०" <= ch <= "९" else "ascii" if "0" <= ch <= "9" else "other"] += 1
    hcol = {}
    for t in PTYPES:
        hs_ = [d for P in pages if P["ptype"] == t for d in P["disp"] if d["kind"] == "headline"]
        hcol[t] = {"share": share(sum(1 for d in hs_ if d["colour"] and colour_name(d["colour"]) != "black"), len(hs_)), "n": len(hs_)}
    st_ = D["practice"].get("stacked", {})
    return {
        "run_in_datelines": "see type.dateline",
        "drop_caps": {"n": len(drop), "by_page_type": counts(Counter(t for t, _, _ in drop)), "size_over_body": d1([r for _, _, r in drop], 2)},
        "bullets_and_dingbats": {"n": len(bullets), "fonts": counts(Counter(f for f, _, _, _ in bullets)), "size_pt": d1([s for _, s, _, _ in bullets]),
                                 "colour": counts(Counter(c for _, _, c, _ in bullets)), "at_line_start_share": share(sum(b[3] for b in bullets), len(bullets))},
        "reversed_text_runs": {"n": len(rev), "by_page_type": counts(Counter(t for t, _, _, _ in rev)), "size_pt": d1([s for _, s, _, _ in rev]),
                               "panel_colour": cmyk_counts([p for _, _, p, _ in rev]), "fonts": counts(Counter(f for _, _, _, f in rev))},
        "numerals_in_body_text": counts(digits),
        "headline_colour_non_black_share": hcol,
        "stacked_headline_paragraphs": {"n": st_.get("count"), "size_over_previous": st_.get("size_ratio"), "source": "headline_practice.json (all pages)"},
        "jump_lines": sum(1 for P in pages for d in P["disp"] if d["kind"] == "jump_line"),
        "jump_heads": sum(1 for P in pages for d in P["disp"] if d["kind"] == "headline_jump"),
        "hyphenation": "line-end hyphens are rare: 3.4 unverified candidates per 100 body lines (docs/phase0/EXP_PUBLISHED_1.md section 12)",
    }


def latin_section(pages: list, D: dict) -> dict:
    if not pages:
        return {"pages": 0}
    t = type_specs(pages, D)
    return {"pages": len(pages), "by_page_type": counts(Counter(P["ptype"] for P in pages)),
            "body": {k: t["body"][k] for k in ("n_frames", "fonts", "size_pt", "size_mode_pt_by_lines", "leading_pt", "leading_mode_pt_by_lines", "hscale")},
            "headline": {k: t["headline"].get(k) for k in ("n", "fonts", "size_pt", "alignment", "colour", "lines_per_frame")},
            "note": "the dual-language editions carry a Latin-script section with its own masthead (flip format); reported apart"}


def gutter_direct(pages: list, grids: dict) -> dict:
    """Independent gutter check: the white gap between side-by-side single-column body runs that overlap vertically."""
    gaps = []
    for P in pages:
        rs = [r for r in body_runs(P) if r.get("measure") == "8col x1"]
        for a in rs:
            right = [b for b in rs if 0 < b["x0"] - a["x1"] < 10 and min(a["y_bot"], b["y_bot"]) - max(a["y_top"], b["y_top"]) > 10]
            if right:
                gaps.append(min(b["x0"] - a["x1"] for b in right))
    return d1(gaps, 3)


def render_gray(pdf: Path, page_no: int, dpi: int):
    pdoc = pdfium.PdfDocument(str(pdf))
    bm = pdoc[page_no - 1].render(scale=dpi / 72, grayscale=True)
    out = (bm.width, bm.height, bm.stride, bytes(bm.buffer))
    pdoc.close()
    return out


def pixel_check(pages: list, dpi: int = 300) -> dict:
    """Vector geometry against the rendered page, on the front, inside and back page with the most stroked rules: each
    rule's darkest pixel row; photo edges (largest luminance step across the expected edge, accepted when the step is
    >= 40 of 255); body-line headstrokes against the measured baselines."""
    nrules = lambda P: sum(1 for p in P["paths"] if p["cls"] == "hrule" and p["stroke"])  # noqa: E731
    pick = [min((P for P in pages if P["ptype"] == t), key=lambda P: (-nrules(P), pages.index(P))) for t in PTYPES if any(P["ptype"] == t for P in pages)]
    s = dpi / 25.4
    rule_d, edge_d, line_d, off = [], [], [], []
    for P in pick:
        w, h, stride, buf = render_gray(P["pdf"], P["page"], dpi)
        px = lambda x, y: buf[min(h - 1, max(0, y)) * stride + min(w - 1, max(0, x))]  # noqa: E731
        for p in P["paths"]:
            if p["cls"] != "hrule" or not p["stroke"]:
                continue
            xm, ym = (p["x0"] + p["x1"]) / 2, (p["y0"] + p["y1"]) / 2
            xs = range(int((xm - 2) * s), int((xm + 2) * s))
            rows = range(int((ym - 1.5) * s), int((ym + 1.5) * s))
            best = min(rows, key=lambda y: (sum(px(x, y) for x in xs), y))
            rule_d.append((best + 0.5) / s - ym)
        for im in P["images"]:
            if im["cls"] != "photo":
                continue
            xs = range(int((im["x0"] + 0.3 * (im["x1"] - im["x0"])) * s), int((im["x1"] - 0.3 * (im["x1"] - im["x0"])) * s), 3)
            for edge in (im["y_top"], im["y_bot"]):
                rows = range(int((edge - 1.5) * s), int((edge + 1.5) * s))
                prof = [sum(px(x, y) for x in xs) / len(xs) for y in rows]
                steps = [(abs(prof[k + 1] - prof[k]), k) for k in range(len(prof) - 1)]
                if steps:
                    st_, k = max(steps)
                    if st_ >= 40:
                        edge_d.append((rows[0] + k + 1) / s - edge)
        # body lines: the darkest pixel row in the upper part of each line (the Devanagari headstroke) must sit a constant
        # distance above the measured baseline, and line-to-line pixel steps must equal the measured leading
        for r in body_runs(P)[:40]:
            if len(r["lines"]) < 4 or not r["lead"]:
                continue
            tops = []
            for l in r["lines"][:6]:
                xs = range(int((l["x0"] + 1) * s), int((l["x1"] - 1) * s), 2)
                rows = range(int((l["y"] - 0.9 * r["size"] / MM) * s), int((l["y"] - 0.3 * r["size"] / MM) * s))
                if not xs or not rows:
                    continue
                best = min(rows, key=lambda y: (sum(px(x, y) for x in xs), y))
                tops.append((l["y"], (best + 0.5) / s))
            for (ya, ta), (yb, tb_) in zip(tops, tops[1:]):
                line_d.append((tb_ - ta) - (yb - ya))
            off += [(y - t) / (r["size"] / MM) for y, t in tops]
    return {"pages_checked": [P["ptype"] for P in pick], "dpi": dpi,
            "rules": {"n": len(rule_d), "abs_diff_mm": d1([abs(v) for v in rule_d], 3)},
            "photo_edges": {"n": len(edge_d), "abs_diff_mm": d1([abs(v) for v in edge_d], 3)},
            "body_line_steps": {"n": len(line_d), "abs_diff_mm": d1([abs(v) for v in line_d], 3),
                                "what": "pixel step between headstrokes of consecutive body lines minus the measured baseline step"},
            "headstroke_above_baseline_em": {"dist": d1(off, 3), "what": "constant if the measured baselines are right"}}


def validation(prof: dict, pages_all: list, D: dict, grids: dict) -> dict:
    pr = D["practice"]
    checks = []

    def chk(name, ours, ref, tol, src):
        checks.append({"check": name, "ours": ours, "reference": ref, "tolerance": tol,
                       "pass": ours is not None and ref is not None and abs(ours - ref) <= tol + 1e-9, "reference_source": src})
    chk("8-column width (mm)", prof["grid"]["column_width_mm"], 36.5, 0.1, "EXP_PUBLISHED_1.md section 12: 36.5 mm columns")
    chk("gutter (mm), lattice", prof["grid"]["gutter_mm"], pr["grid"]["estimate"]["gutter_mm"], 0.05, "headline_practice.json grid estimate (4.19 mm)")
    gd = gutter_direct(pages_all, grids)
    chk("gutter (mm), measured directly between adjacent columns", gd["median"] if gd else None, pr["grid"]["estimate"]["gutter_mm"], 0.15,
        "headline_practice.json grid estimate; ours is an independent measurement")
    body_all = [(r["size"], len(r["lines"])) for P in pages_all for r in body_runs(P)]
    bm = mode_of([sz for sz, k in body_all for _ in range(k)], 1)
    chk("body size mode by lines (pt)", bm["value"], 12.0, 0.0, "EXP_PUBLISHED_1.md section 12: median 12 pt on 13 pt")
    dh = [d for P in pages_all for d in P["disp"] if d["role"] == "headline" and HL.deva_share(d["text"]) >= 0.5]
    chk("Devanagari headline size median (pt)", HL.q([d["size"] for d in dh], 0.5), pr["roles"]["headline_devanagari"]["size_pt"]["median"], 0.5,
        "headline_practice.json headline_devanagari (EXP_HEAD_1_REPORT.md: 30 pt)")
    chk("Devanagari headlines centred (share)", share(sum(d["align"] == "center" for d in dh), len(dh)),
        pr["roles"]["headline_devanagari"]["alignment_share"]["center"], 0.01, "headline_practice.json (EXP_HEAD_1_REPORT.md: 55 %)")
    ah = [d for P in pages_all for d in P["disp"] if d["role"] == "headline"]
    chk("all headlines centred (share)", share(sum(d["align"] == "center" for d in ah), len(ah)), pr["roles"]["headline"]["alignment_share"]["center"], 0.01,
        "headline_practice.json headline (51 %)")
    return {"checks": checks, "all_pass": all(c["pass"] for c in checks), "pixel_check": pixel_check([P for P in pages_all if P["script"] == "devanagari"])}


def privacy_guard(text: str, D: dict, pages: list) -> None:
    """The repo JSON may hold aggregates only: no Devanagari, sample ids, dates, file names, publication or display text."""
    bad = []
    if re.search(r"[ऀ-ॿ]", text):
        bad.append("Devanagari text")
    for sid in D["sids"] + D["skipped"]:
        if sid in text:
            bad.append("a sample id")
    for m in D["mans"].values():
        for k in ("edition_date", "publication", "file_name_as_received", "received_from", "file_sha256"):
            v = m.get(k)
            if isinstance(v, str) and len(v) >= 4 and v in text:
                bad.append(k)
    if re.search(r"20\d\d-\d\d-\d\d", text):
        bad.append("a date")
    for P in pages:
        for d in P["disp"]:
            t = d["text"].strip()
            if len(t) >= 8 and t in text:
                bad.append("display text")
                break
    if bad:
        raise SystemExit(f"privacy guard: refusing to write the repo profile ({', '.join(sorted(set(bad)))})")


# ------------------------------------------------------------------------------------------------- figures (private)
class Annot:
    """A copy of one printed page with annotation objects added through PDFium, rendered to PNG."""

    def __init__(self, pdf: Path, page_no: int):
        self.src = pdfium.PdfDocument(str(pdf))
        self.doc = pdfium.PdfDocument.new()
        self.doc.import_pages(self.src, [page_no - 1])
        self.page = self.doc[0]
        self.W, self.H = self.page.get_size()
        self.font = PR.FPDFText_LoadStandardFont(self.doc.raw, b"Helvetica-Bold")

    def _put(self, o):
        PR.FPDFPage_InsertObject(self.page.raw, o)

    def rect(self, x0, y0, x1, y1, stroke=None, width=1.0, fill=None):
        o = PR.FPDFPageObj_CreateNewRect(x0 * MM, self.H - y1 * MM, (x1 - x0) * MM, (y1 - y0) * MM)
        if stroke:
            PR.FPDFPageObj_SetStrokeColor(o, *stroke)
            PR.FPDFPageObj_SetStrokeWidth(o, ctypes.c_float(width))
        if fill:
            PR.FPDFPageObj_SetFillColor(o, *fill)
        PR.FPDFPath_SetDrawMode(o, 1 if fill else 0, bool(stroke))
        self._put(o)

    def line(self, x0, y0, x1, y1, stroke, width=1.0):
        o = PR.FPDFPageObj_CreateNewPath(ctypes.c_float(x0 * MM), ctypes.c_float(self.H - y0 * MM))
        PR.FPDFPath_LineTo(o, ctypes.c_float(x1 * MM), ctypes.c_float(self.H - y1 * MM))
        PR.FPDFPageObj_SetStrokeColor(o, *stroke)
        PR.FPDFPageObj_SetStrokeWidth(o, ctypes.c_float(width))
        PR.FPDFPath_SetDrawMode(o, 0, True)
        self._put(o)

    def text(self, x, y, s, size=9.0, colour=(0, 0, 0, 255), bg=(255, 255, 255, 225)):
        """Label with its baseline at (x, y) mm; a translucent white box behind it."""
        if bg:
            w = 0.58 * size * len(s) / MM
            self.rect(x - 0.6, y - 0.8 * size / MM, x + w + 0.6, y + 0.3 * size / MM, fill=bg)
        t = PR.FPDFPageObj_CreateTextObj(self.doc.raw, self.font, ctypes.c_float(size))
        buf = (ctypes.c_ushort * (len(s) + 1))(*[ord(ch) for ch in s], 0)
        PR.FPDFText_SetText(t, ctypes.cast(buf, PR.FPDF_WIDESTRING))
        PR.FPDFPageObj_Transform(t, 1, 0, 0, 1, x * MM, self.H - y * MM)
        PR.FPDFPageObj_SetFillColor(t, *colour)
        self._put(t)

    def vgap(self, x, y0, y1, colour, label, size=8.0):
        """A measured vertical distance: ticks at both ends, a connecting line and the label to the right."""
        self.line(x - 1.5, y0, x + 1.5, y0, colour, 0.8)
        self.line(x - 1.5, y1, x + 1.5, y1, colour, 0.8)
        self.line(x, y0, x, y1, colour, 0.8)
        self.text(x + 2.0, (y0 + y1) / 2 + 0.35 * size / MM, label, size, colour)

    def save(self, out: Path, dpi: int, crop=None):
        PR.FPDFPage_GenerateContent(self.page.raw)
        kw = {}
        if crop:
            x0, y0, x1, y1 = crop
            kw["crop"] = (x0 * MM, self.H - y1 * MM, self.W - x1 * MM, y0 * MM)
        bm = self.page.render(scale=dpi / 72, **kw)
        OV.write_png(out, bm.width, bm.height, bytes(bm.buffer), bm.stride, bm.n_channels)
        os.chmod(out, 0o600)
        self.doc.close()
        self.src.close()
        return out


RED, GREEN, BLUE, ORANGE, MAGENTA, GREY, CYAN = (220, 20, 60, 255), (0, 150, 60, 255), (20, 90, 220, 255), (240, 120, 0, 255), (200, 0, 200, 255), (90, 90, 90, 255), (0, 160, 200, 255)


def pick_page(pages: list, ptype: str, score) -> dict:
    cands = [P for P in pages if P["ptype"] == ptype]
    return min(cands, key=lambda P: (score(P), pages.index(P))) if cands else None


def fig_front(P: dict, prof: dict, grids: dict, out: Path) -> Path:
    A = Annot(P["pdf"], P["page"])
    cols = grid_columns(grids["8col"])
    top, bot = P["editorial_top"], P["content_bottom"]
    for k, (a, b) in enumerate(cols):
        A.rect(a, top, b, bot, stroke=BLUE, width=0.8, fill=(40, 120, 255, 45))
        A.text(a + 1, top + 5, f"col {k + 1}", 11, BLUE)
    x0, y0, x1, y1 = P["ink"]
    A.rect(x0, y0, x1, y1, stroke=GREY, width=0.6)
    mid = P["H"] * 0.62
    A.vgap(P["W"] / 2, 0, y0, MAGENTA, f"top margin {y0:.1f} mm", 9)
    A.vgap(P["W"] / 2 + 60, y1, P["H"], MAGENTA, f"bottom margin {P['H'] - y1:.1f} mm", 9)
    A.line(0, mid, x0, mid, MAGENTA, 1.2)
    A.text(0.5, mid - 2, f"{x0:.1f} mm", 8, MAGENTA)
    A.line(x1, mid, P["W"], mid, MAGENTA, 1.2)
    A.text(x1 - 12, mid - 2, f"{P['W'] - x1:.1f} mm", 8, MAGENTA)
    tb = P["topblock"]
    if tb:
        A.rect(tb["x0"], tb["y0"], tb["x1"], tb["y1"], stroke=ORANGE, width=2.0)
        A.text(tb["x0"] + 2, tb["y1"] - 2, f"nameplate block {tb['x1'] - tb['x0']:.0f} x {tb['h']:.0f} mm", 10, ORANGE)
    heads = [d for d in P["disp"] if d["kind"] == "headline"]
    if heads:
        L = max(heads, key=lambda d: (d["size"], d["span"][1] - d["span"][0], -d["y_top"]))
        n, res = span_fit(L["span"][1] - L["span"][0], grids)
        A.rect(L["span"][0], L["y_top"] - 0.8 * L["size"] / MM, L["span"][1], L["y_bot"] + 0.3 * L["size"] / MM, stroke=RED, width=2.2)
        A.text(L["span"][0] + 1, L["y_bot"] + 0.3 * L["size"] / MM + 4, f"LEAD: {n} col, {L['size']:g} pt, {len(L['lines'])} line(s)", 10, RED)
    for im in P["images"]:
        if im["cls"] == "photo":
            n, res = span_fit(im["x1"] - im["x0"], grids)
            A.rect(im["x0"], im["y_top"], im["x1"], im["y_bot"], stroke=GREEN, width=1.8)
            A.text(im["x0"] + 1, im["y_top"] + 4, f"photo {n} col x {im['y_bot'] - im['y_top']:.0f} mm", 8, GREEN)
    for p in P["paths"]:
        if p["cls"] == "hrule":
            A.line(p["x0"], (p["y0"] + p["y1"]) / 2, p["x1"], (p["y0"] + p["y1"]) / 2, MAGENTA, 1.5)
            A.text(p["x1"] - 16, (p["y0"] + p["y1"]) / 2 - 1, f"rule {p['sw']:g} pt", 7, MAGENTA)
    return A.save(out, 60)


def rhythm_pairs(P: dict) -> dict:
    found = {}
    for a, b, d, c in sorted(P["pairs"], key=lambda t: (t[0]["ref_bot"], t[0]["x0"])):
        L = lead_unit(P, a, b)
        if d <= 0 or d > PAIR_MAX_LEAD * L:
            continue
        for name, ua, lb, _ in SPACING:
            if a["kind"] in ua and b["kind"] in lb and name not in found:
                found[name] = (a, b, d, L)
    return found


def fig_rhythm(P: dict, out: Path, window_mm: float = 230.0) -> tuple:
    """Measured vertical distances drawn on the page (cyan = the two reference lines, red = the distance), cropped to the
    window_mm tall band of the page that holds the most different kinds of pair."""
    found = rhythm_pairs(P)
    ys = sorted((v[0]["ref_bot"], name) for name, v in found.items())
    best = max((sum(1 for y, _ in ys if y0 <= y <= y0 + window_mm - 30), -y0) for y0 in [y for y, _ in ys]) if ys else (0, 0)
    y0 = max(0.0, -best[1] - 20)
    keep = {name: v for name, v in found.items() if y0 <= v[0]["ref_bot"] and v[1]["ref_top"] <= y0 + window_mm}
    A = Annot(P["pdf"], P["page"])
    for k, (name, (a, b, d, L)) in enumerate(sorted(keep.items(), key=lambda kv: kv[1][0]["ref_bot"])):
        lo, hi = max(a["x0"], b["x0"]), min(a["x1"], b["x1"])
        x = lo + 3 if hi - lo > 20 else (lo + hi) / 2
        for e, y in ((a, a["ref_bot"]), (b, b["ref_top"])):
            A.line(e["x0"], y, e["x1"], y, CYAN, 0.6)
        A.vgap(x, a["ref_bot"], b["ref_top"], RED, f"{name.replace('_', ' ')}: {d:.1f} mm = {d / L:.2f} L", 9)
    return A.save(out, 130, (0, y0, P["W"], min(P["H"], y0 + window_mm))), keep


def fig_check(P: dict, pair: tuple, out: Path) -> Path:
    """High-zoom crop of one measured pair: the drawn baselines must sit on the printed baselines."""
    a, b, d, L = pair
    A = Annot(P["pdf"], P["page"])
    for e, y in ((a, a["ref_bot"]), (b, b["ref_top"])):
        A.line(e["x0"], y, e["x1"], y, CYAN, 0.4)
    A.vgap(max(a["x0"], b["x0"]) + 3, a["ref_bot"], b["ref_top"], RED, f"{d:.2f} mm", 8)
    x0 = max(0.0, max(a["x0"], b["x0"]) - 5)
    return A.save(out, 300, (x0, a["ref_bot"] - 15, min(P["W"], x0 + 80), b["ref_top"] + 6))


def fig_areas(P: dict, prof: dict, out: Path) -> Path:
    A = Annot(P["pdf"], P["page"])
    for r in P["runs"]:
        A.rect(r["x0"], r["y_top"] - 0.75 * r["size"] / MM, r["x1"], r["y_bot"] + 0.25 * r["size"] / MM, fill=(30, 100, 255, 70))
    for d in P["disp"]:
        for l in d["lines"]:
            A.rect(l["x0"], l["y"] - 0.75 * d["size"] / MM, l["x1"], l["y"] + 0.25 * d["size"] / MM, fill=(30, 100, 255, 70))
    for im in P["images"]:
        if im["cls"] == "photo":
            A.rect(im["x0"], im["y_top"], im["x1"], im["y_bot"], stroke=GREEN, width=2, fill=(0, 180, 60, 70))
    for b in P["ads"]:
        A.rect(b["x0"], b["y_top"], b["x1"], b["y_bot"], stroke=RED, width=3, fill=(230, 0, 40, 60))
        A.text(b["x0"] + 3, b["y_top"] + 8, "AD (recurring)", 14, RED)
    tb = P["topblock"]
    if tb:
        A.rect(tb["x0"], tb["y0"], tb["x1"], tb["y1"], fill=(80, 80, 80, 90))
    for b in P["standing"]:
        A.rect(b["x0"], b["y_top"], b["x1"], b["y_bot"], fill=(80, 80, 80, 90))
    sh = raster_shares(P)
    A.text(14, P["H"] - 14, f"this page: text {sh['text']:.0%}  photos {sh['photo']:.0%}  ads {sh['ad']:.0%}  furniture {sh['furniture']:.0%}  "
           f"rules/boxes {sh['graphics']:.0%}  white {sh['white']:.0%}", 11, (0, 0, 0, 255))
    A.text(14, P["H"] - 6, "blue = text, green = photos, red = ads, grey = furniture", 10, GREY)
    return A.save(out, 60)


def fig_roles(P: dict, out: Path) -> Path:
    A = Annot(P["pdf"], P["page"])
    colours = {"headline": RED, "deck": ORANGE, "kicker": MAGENTA, "crosshead": BLUE, "byline": GREEN, "byline_runin": GREEN,
               "caption": CYAN, "headline_brief": RED, "headline_jump": RED, "headline_stacked": RED, "strap": ORANGE}
    for d in P["disp"]:
        c = colours.get(d["kind"])
        if not c:
            continue
        A.rect(d["x0"], d["y_top"] - 0.8 * d["size"] / MM, d["x1"], d["y_bot"] + 0.3 * d["size"] / MM, stroke=c, width=1.2)
        A.text(d["x0"], d["y_top"] - 0.8 * d["size"] / MM - 0.8, f"{d['kind'].replace('_', ' ')} {d['size']:g} pt {d['font']}", 6.5, c)
    br = [r for r in body_runs(P) if r["lead"]]
    for r in br[:: max(1, len(br) // 12)]:
        A.text(r["x0"], r["y_top"] - 0.9 * r["size"] / MM, f"body {r['size']:g}/{r['lead']:g} pt", 6, GREY)
    return A.save(out, 70)


# ------------------------------------------------------------------------------------------------- profile
def med(d, k="median"):
    return d.get(k) if isinstance(d, dict) else None


def top_colour(c: dict):
    t = (c or {}).get("top") or []
    return {"cmyk": t[0].get("cmyk"), "name": t[0].get("name"), "share": t[0].get("share"), "n": c.get("n")} if t else None


def top_key(c: dict):
    sh = (c or {}).get("shares") or {}
    if not sh:
        return None
    k = next(iter(sh))
    return {"value": k, "share": sh[k], "n": c.get("n")}


def composer_defaults(p: dict) -> dict:
    t, sp, g = p["type"], p["spacing"], p["geometry"]
    role = lambda r: {"font": top_key(t[r].get("fonts")), "size_pt": med(t[r].get("size_pt")),  # noqa: E731
                      "leading_over_size": med(t[r].get("leading_over_size_multiline")), "hscale": med(t[r].get("hscale")),
                      "alignment_multiline": top_key(t[r].get("alignment_multiline")),
                      "single_line_position": top_key(t[r].get("single_line_position_in_span")),
                      "colour": top_colour(t[r].get("colour")), "n": t[r].get("n")}
    roles = {"body": {"font": top_key(t["body"]["fonts_by_lines"]), "size_pt": t["body"]["size_mode_pt_by_lines"],
                      "leading_pt": t["body"]["leading_mode_pt_by_lines"], "hscale": med(t["body"]["hscale"]),
                      "alignment": "justified (" + str(round(100 * (t["body"]["alignment_nonfinal_lines"]["shares"].get("FULLY_ALIGNED") or 0))) + " % of non-final lines)",
                      "first_line_indent_mm": med(t["body"]["first_line_indent_mm"]), "story_first_line_indented_share": t["body"]["story_first_line_indented_share"],
                      "colour": top_colour(t["body"]["colour"]), "n_frames": t["body"]["n_frames"]}}
    for r in ("headline", "deck", "crosshead", "kicker", "kicker_reversed", "byline", "caption", "headline_brief", "headline_jump"):
        roles[r] = role(r)
    dl = t["dateline"]
    roles["dateline"] = {"share_of_stories": dl["share_of_stories"], "n": dl["n"], "form": top_key(dl["form"]), "bold_share": dl["bold_share"],
                         "font": top_key(dl["fonts"]), "size_over_body": med(dl["size_over_body_run"]), "colour": top_colour(dl["colour"])}
    roles["headline"]["face_by_size_band"] = {b: top_key(c) for b, c in t["headline_face_by_size_band_pt"]["bands"].items()}
    spacing = {k: {"mm": med(v.get("mm")), "body_leadings": med(v.get("body_leadings")), "n": v.get("n")}
               for k, v in sp.items() if isinstance(v, dict) and "mm" in v}
    hs = p["headline_size"]["by_span"]
    rb = p["rules_and_boxes"]["horizontal_rules"]
    return {
        "page": {"trim_mm": g["trim_mm"]["value"], "bleed_mm": 0.0 if not (g["bleed_mm"]["max_bleed_beyond_trim"] or {}).get("max") else g["bleed_mm"]["max_bleed_beyond_trim"]["max"],
                 "type_area_x_mm": [g["type_area_mm"]["x0"], g["type_area_mm"]["x1"]],
                 "margins_mm": {s: med(g["margins_mm_from_ink"][s]["all"]) for s in ("top", "bottom", "left", "right")},
                 "editorial_top_mm": {pt: med(g["editorial_top_mm"][pt]) for pt in PTYPES},
                 "lowest_baseline_mm": {pt: med(g["lowest_text_baseline_mm"][pt]) for pt in PTYPES}},
        "grid": {"columns": p["grid"]["columns"], "column_mm": p["grid"]["column_width_mm"], "gutter_mm": p["grid"]["gutter_mm"],
                 "origin_mm": round(p["grid"]["origin_mm"], 3), "variant": {"columns": 6, "column_mm": p["grid"]["variant_6col"]["column_width_mm"]},
                 "text_columns_for_span": {N: {"text_columns": int(next(iter(v["text_columns_share_by_lines"]))),
                                               "share_of_lines": next(iter(v["text_columns_share_by_lines"].values())),
                                               "column_mm": v["column_width_mm"][next(iter(v["text_columns_share_by_lines"]))],
                                               "alternatives": {M: x for M, x in list(v["text_columns_share_by_lines"].items())[1:]}, "lines": v["lines"]}
                                           for N, v in p["grid"]["story_text_columns"]["by_span_N"].items()}},
        "roles": roles,
        "headline_size_pt_by_span": {k: {"median": med(v["size_pt"]["all"]), "n": (v["size_pt"]["all"] or {}).get("n"),
                                         "front": med(v["size_pt"]["front"]), "inside": med(v["size_pt"]["inside"]), "back": med(v["size_pt"]["back"]),
                                         "lines_median": med(v["lines"]["dist"])} for k, v in hs.items()},
        "spacing": spacing,
        "rules": {"story_separator": {"weight_pt": next(iter(rb["weights_pt"]), None), "colour": top_colour(rb["colour"]),
                                      "where": top_key(rb["where"]), "length_in_columns": top_key(rb["length_in_columns"])},
                  "column_rules": bool(p["rules_and_boxes"]["vertical_rules"]["n"])},
        "photos": {"place": top_key(p["images"]["place_relative_to_headline"]), "width_fit": top_key(p["images"]["width_fit"]),
                   "width_in_story_text_columns": top_key(p["images"]["width_in_story_text_columns"]),
                   "height_mm": med(p["images"]["height_mm"]), "aspect_w_over_h": med(p["images"]["aspect_w_over_h"]),
                   "caption_share": p["images"]["with_caption_share"], "frame_share": p["images"]["with_frame_share"]},
        "headline_shape": {k: p["headline_shape"]["default"][k] for k in ("headline_shape", "per_page_option", "crosshead_shape", "line_count")},
    }


LIMITATIONS = (
    "One-off display ads placed as a single picture cannot be told from photos by geometry; recurring ads are found by "
    "recurrence, and stand-alone photos >= 40 x 40 mm are counted as possible ads (images.possible_one_off_ads).",
    "Captions are rare in this paper (most photos run without one), so caption specs rest on few frames.",
    "Text ink extents use the em box (0.75 em above, 0.25 em below the baseline), not glyph outlines; distances between "
    "text are baseline to baseline, which is exact.",
    "Display tracking comes from published1/headline_practice.json (all pages, its own role rules); body tracking and word "
    "space from the measured body frames.",
    "Which designer made a page is not in the files: running-head variants are reported as variants, not as designers.",
    "Headline-shape evidence is limited to the head1 'choice' headlines (a few dozen per split); differences under about "
    "20 points cannot be detected.",
    "Photo content (crops, cut-outs, colour) and image resolution are not analysed.",
    "Page types follow the nameplate: in the dual-language (flip-format) editions each language section has its own front.",
)


def build_profile(D: dict, pages: list, grids: dict, ginfo: dict) -> dict:
    dev = [P for P in pages if P["script"] == "devanagari"]
    lat = [P for P in pages if P["script"] == "latin"]
    types = type_specs(dev, D)
    spacing = spacing_section(dev)
    grid = grid_section(dev, grids, ginfo)
    prof = {
        "schema": SCHEMA, "tool": TOOL,
        "scope": {"editions": len(D["sids"]), "editions_skipped_duplicates": len(D["skipped"]), "pages": len(pages),
                  "pages_profiled_devanagari": len(dev), "pages_latin_section": len(lat),
                  "page_types": {t: sum(1 for P in dev if P["ptype"] == t) for t in PTYPES},
                  "pages_per_edition": counts(Counter(P["n_pages"] for P in pages if P["page"] == 1)),
                  "inputs": ["published1 corrected.json/measure.json", "report/headlines.jsonl", "report/headline_practice.json",
                             "report/paragraphs.jsonl", "report/head1/head1_rows.json.gz", "source PDFs (pdfminer + PDFium)"]},
        "conventions": {"positions": "mm from the trim box's top-left corner (y down)", "type": "pt", "dist": "n, min, p10, median, p90, max",
                        "shares": "fractions with their denominator n", "L": "one body leading of the text involved (else the page's body leading)",
                        "B2B": "baseline to baseline", "page_types": "front = carries the nameplate; back = far end of its section; inside = the rest"},
        "geometry": geometry(dev, grids),
        "grid": grid,
        "type": types,
        "headline_size": headline_size_table(dev, grids),
        "spacing": spacing,
        "rules_and_boxes": rules_and_boxes(dev, grids),
        "images": images_section(dev, grids, spacing),
        "furniture": furniture_section(dev),
        "composition": composition_section(dev, grids),
        "headline_shape": shape_section(dev, D),
        "other_practice": other_practice(dev, D, types),
        "latin_section": latin_section(lat, D),
    }
    prof["composer_defaults"] = composer_defaults(prof)
    prof["validation"] = validation(prof, pages, D, grids)
    prof["limitations"] = list(LIMITATIONS)
    return prof


def jsonable(o):
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, float):
        return round(o, 4)
    return o


def make_figures(pages: list, prof: dict, grids: dict, fig_dir: Path) -> dict:
    fig_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(fig_dir, 0o700)
    dev = [P for P in pages if P["script"] == "devanagari"]
    tb_med = med(prof["geometry"]["top_block_mm"]["height"]["front"]) or 0
    ms_med = med(prof["composition"]["front"]["main_stories_per_page"]) or 0
    ph_med = med(prof["composition"]["front"]["photos_per_page"]) or 0
    tall = 1.5 * (med(prof["images"]["height_mm"], "p90") or 1e9)       # an outlier picture is more likely a one-off ad
    front = pick_page(dev, "front", lambda P: (any(i.get("possible_ad") or (i["cls"] == "photo" and i["y_bot"] - i["y_top"] > tall) for i in P["images"]),
                                               abs(P["topblock"]["h"] - tb_med) > 3,
                                               abs(sum(d["kind"] == "headline" for d in P["disp"]) - ms_med)
                                               + abs(sum(i["cls"] == "photo" for i in P["images"]) - ph_med)))
    inside = pick_page(dev, "inside", lambda P: (bool(P["ads"]), -len(rhythm_pairs(P))))
    ad_med = med(prof["composition"]["back"]["area_share_of_trim"]["ad"]) or 0.0
    back = pick_page(dev, "back", lambda P: (not P["ads"], round(abs(raster_shares(P)["ad"] - ad_med), 3)))
    figs = {}
    if front:
        figs["front_grid"] = fig_front(front, prof, grids, fig_dir / "fig1_front_grid_margins.png")
    if inside:
        figs["inside_rhythm"], found = fig_rhythm(inside, fig_dir / "fig2_inside_vertical_rhythm.png")
        figs["inside_rhythm_pairs"] = {k: round(v[2], 2) for k, v in sorted(found.items())}
        figs["inside_roles"] = fig_roles(inside, fig_dir / "fig4_inside_type_roles.png")
        for k in ("headline_to_body", "photo_to_body", "rule_to_headline"):
            if k in found:
                figs[f"check_{k}"] = fig_check(inside, found[k], fig_dir / f"fig5_check_{k}.png")
    if back:
        figs["back_areas"] = fig_areas(back, prof, fig_dir / "fig3_back_page_areas.png")
    figs["pages"] = {"front": front and (front["ptype"], front["read_index"]), "inside": inside and (inside["ptype"], inside["read_index"]),
                     "back": back and (back["ptype"], back["read_index"])}
    figs["_page_refs"] = {k: (P["sid"], P["page"]) for k, P in (("front", front), ("inside", inside), ("back", back)) if P}
    return figs


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dataset", type=Path)
    ap.add_argument("--no-figures", action="store_true", help="skip the private page renders")
    a = ap.parse_args()
    ds = a.dataset.expanduser().resolve()
    if REPO in ds.parents or ds == REPO:
        raise SystemExit("the dataset must live outside the repository (pilot data is private)")
    D, pages, grids, ginfo = prepare(ds)
    prof = jsonable(build_profile(D, pages, grids, ginfo))
    text = json.dumps(prof, ensure_ascii=False, indent=1) + "\n"
    privacy_guard(text, D, pages)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(text)
    priv = ds / "report" / "page1"
    priv.mkdir(parents=True, exist_ok=True)
    os.chmod(priv, 0o700)
    figs = {} if a.no_figures else make_figures(pages, prof, grids, priv / "profile_figs")
    md = priv / "house_profile.md"
    md.write_text(write_md(prof, figs, D))
    os.chmod(md, 0o600)
    v = prof["validation"]
    print(f"{prof['scope']['pages']} pages ({prof['scope']['pages_profiled_devanagari']} profiled) -> {OUT_JSON.relative_to(REPO)}")
    print(f"private: {md}" + ("" if a.no_figures else f" + {len([k for k in figs if not k.startswith('_') and k not in ('pages', 'inside_rhythm_pairs')])} figures"))
    print("validation: " + ", ".join(f"{c['check']}: {c['ours']} vs {c['reference']} {'ok' if c['pass'] else 'FAIL'}" for c in v["checks"]))


def fm(d, unit="", nd=1, n=True) -> str:
    """'median (p10-p90), n' for a dist."""
    if not d or d.get("median") is None:
        return "-"
    f = lambda v: f"{v:.{nd}f}"  # noqa: E731
    return f"{f(d['median'])}{unit} ({f(d['p10'])}-{f(d['p90'])}{unit}" + (f", n {d['n']})" if n else ")")


def pc(x) -> str:
    return "-" if x is None else f"{100 * x:.0f} %"


def topn(c: dict, k=3, pct=True) -> str:
    sh = (c or {}).get("shares") or {}
    return ", ".join(f"{a} {pc(b)}" if pct else str(a) for a, b in list(sh.items())[:k]) or "-"


def cname(c: dict, k=2) -> str:
    t = (c or {}).get("top") or []
    return ", ".join(f"{x['name']} {pc(x['share'])}" + (f" (CMYK {'/'.join(str(round(100 * v)) for v in x['cmyk'])})" if x.get("cmyk") else "") for x in t[:k]) or "-"


def write_md(prof: dict, figs: dict, D: dict) -> str:
    g, gr, t, sp, rb, im, fu, co, sh, ot, cd = (prof[k] for k in ("geometry", "grid", "type", "spacing", "rules_and_boxes", "images", "furniture",
                                                                   "composition", "headline_shape", "other_practice", "composer_defaults"))
    sc = prof["scope"]
    st_ = gr["story_text_columns"]
    L = []
    w = L.append
    w("# The paper's design language, measured from its own pages (PRIVATE)")
    w("")
    w(f"Generated by `experiments/phase0/page1/house_profile.py` ({TOOL}). Source: the {sc['editions']} press PDFs the owner supplied "
      f"({sc['pages']} pages; one duplicate export skipped). The profile covers the {sc['pages_profiled_devanagari']} Marathi pages "
      f"({sc['page_types']['front']} front, {sc['page_types']['inside']} inside, {sc['page_types']['back']} back pages); the "
      f"{sc['pages_latin_section']} English pages of the two dual-language editions are summarised apart. Every number is measured: "
      "'n' is how many things were measured and the range in brackets holds the middle 80 % of them. The machine-readable profile "
      "(numbers only, no text) is `experiments/phase0/results/page1/house_profile.json`; the pictures are in `profile_figs/` next to this file.")
    w("")
    w("## In one minute")
    bm = t["body"]
    w(f"- **Page**: {g['trim_mm']['value'][0]:g} x {g['trim_mm']['value'][1]:g} mm, no bleed; about {cd['page']['margins_mm']['left']:.1f} mm of white "
      f"on every side, the same on left and right pages.")
    w(f"- **Grid**: {gr['columns']} columns of {gr['column_width_mm']} mm with {gr['gutter_mm']} mm gutters. A story takes N grid columns but is "
      f"often set in one text column fewer (N - 1 wide columns) - that is where the 50 mm '6-column' measure comes from "
      f"({pc(st_['relation_by_sets']['shares'].get('M = N - 1'))} of column sets; {pc(st_['relation_by_sets']['shares'].get('M = N'))} keep N columns).")
    w(f"- **Body text**: {cd['roles']['body']['font']['value']} {bm['size_mode_pt_by_lines']['value']:g} pt on {bm['leading_mode_pt_by_lines']['value']:g} pt "
      f"(the commonest pair; stories vary 12-14 pt), justified, 5 mm first-line indent, black, no extra space between paragraphs.")
    w(f"- **Headlines**: median {t['headline']['size_pt']['median']:g} pt, bigger for wider stories (about {prof['headline_size']['size_vs_8col_span_fit']['intercept']:g} "
      f"+ {prof['headline_size']['size_vs_8col_span_fit']['slope']:g} pt per column); centred when they run to two lines "
      f"({pc(cd['roles']['headline']['alignment_multiline']['share'])}), full width when on one line; mostly black.")
    w(f"- **Datelines**: {pc(t['dateline']['share_of_stories'])} of stories open with a run-in place name and a colon on the first body line.")
    w(f"- **Separators**: thin {next(iter(rb['horizontal_rules']['weights_pt']))} pt black rules between stories; no vertical column rules.")
    w(f"- **Photos**: about {co['all']['photos_per_page']['median']:g} per page, almost always landscape, mostly placed directly under "
      f"the headline ({pc(im['place_relative_to_headline']['shares'].get('below_headline'))}) and sized to the story's text columns; captions are rare "
      f"({pc(im['with_caption_share'])}).")
    w("- **Headline line breaks**: no single rule explains the paper's choices; the default is the 'fill' shape, with 'balanced' as a per-page option.")
    w("")
    w("## 1. The page")
    w("| What | Measured |")
    w("|---|---|")
    w(f"| Page size (trim) | {g['trim_mm']['value'][0]:g} x {g['trim_mm']['value'][1]:g} mm on all {g['trim_mm']['pages_same_size']} pages |")
    w("| Bleed | none: the PDFs' page box, trim box and bleed box are the same; nothing touches the paper edge |")
    for s_ in ("top", "bottom", "left", "right"):
        w(f"| {s_.title()} margin (paper edge to the first mark) | {fm(g['margins_mm_from_ink'][s_]['all'], ' mm', 2)} |")
    w(f"| Inside vs outside margin | inside {fm(g['inside_vs_outside_mm']['inside'], ' mm', 2)}, outside {fm(g['inside_vs_outside_mm']['outside'], ' mm', 2)}: no mirrored margins |")
    w(f"| Type area (the 8 columns) | {g['type_area_mm']['x0']:.1f} to {g['type_area_mm']['x1']:.1f} mm from the left edge ({g['type_area_mm']['width']:.1f} mm wide) |")
    w(f"| Where the news starts | front page {fm(g['editorial_top_mm']['front'], ' mm')} from the top (below the nameplate); "
      f"inside {fm(g['editorial_top_mm']['inside'], ' mm')}; back {fm(g['editorial_top_mm']['back'], ' mm')} |")
    w(f"| Lowest line of text | {fm(g['lowest_text_baseline_mm']['all'], ' mm')} from the top |")
    w("")
    w("## 2. The grid and the columns of a story")
    w(f"The page has **{gr['columns']} columns of {gr['column_width_mm']} mm**, with **{gr['gutter_mm']} mm** of white between them (the gutter), starting "
      f"{gr['origin_mm']:.1f} mm from the left edge. Measured directly between neighbouring columns of text, the gutter is "
      f"{prof['validation']['checks'][2]['ours']:.2f} mm. There are no vertical lines in the gutters.")
    w("")
    w(f"Stories do not always use those columns as they are. A story occupies N grid columns, and its text is set in M equal columns "
      f"across that width. Of {st_['sets_on_a_span']} column sets whose total width is exactly N grid columns "
      f"({pc(st_['lines_on_a_span'] / st_['lines_all'])} of all body lines; left edge on the grid in {pc(st_['left_edge_on_lattice_share'])}):")
    w("")
    w("| Story width N (grid columns) | Text columns used (share of lines) | Width of each text column |")
    w("|---|---|---|")
    for N, v in st_["by_span_N"].items():
        w(f"| {N} | " + ", ".join(f"{M} ({pc(x)})" for M, x in v["text_columns_share_by_lines"].items()) + " | "
          + ", ".join(f"{M}: {x} mm" for M, x in v["column_width_mm"].items()) + " |")
    w("")
    w(f"So the '6-column' 50 mm measure is a 4-column story set in 3 columns (or a full page set in 6). The rest of the text "
      f"({st_['not_on_a_span']['lines']} lines) sits in boxes with insets or is wrapped around pictures.")
    w("")
    w(f"How often each measure is used (share of body lines): {topn(gr['grid_use_by_body_lines'], 4)}. Stories by the measure of their "
      f"first column: {topn(gr['stories_by_measure'], 4)}; on front pages {topn(gr['stories_by_measure_and_page_type']['front'], 2)}.")
    w("")
    w("## 3. The type")
    w("Typeface names are the fonts embedded in the PDFs (the house fonts).")
    w("")
    w("| Role | Typeface (share) | Size pt | Line spacing | Width scale | Alignment | Colour | n |")
    w("|---|---|---|---|---|---|---|---|")
    w(f"| Body text | {topn(bm['fonts_by_lines'], 1)} | {fm(bm['size_pt'], '', 1, False)}; commonest {bm['size_mode_pt_by_lines']['value']:g} | "
      f"{fm(bm['leading_pt'], ' pt', 1, False)} ({fm(bm['leading_over_size'], ' x size', 2, False)}) | {fm(bm['hscale'], '', 3, False)} | "
      f"justified {pc(bm['alignment_nonfinal_lines']['shares'].get('FULLY_ALIGNED'))} | {cname(bm['colour'], 1)} | {bm['n_frames']} frames |")
    names = {"headline": "Headline", "deck": "Deck (under a headline)", "crosshead": "Crosshead (between paragraphs)", "kicker": "Kicker (above a headline)",
             "kicker_reversed": "Reversed label (white on a panel)", "byline": "Byline line", "caption": "Caption", "headline_brief": "Brief headline",
             "headline_jump": "Jump head (story continued)"}
    for r, nm in names.items():
        x = t[r]
        if not x.get("n"):
            continue
        w(f"| {nm} | {topn(x['fonts'], 2)} | {fm(x['size_pt'], '', 1, False)} | {fm(x['leading_over_size_multiline'], ' x size', 2, False)} | "
          f"{fm(x['hscale'], '', 2, False)} | {topn(x['alignment_multiline'], 1) if x['alignment_multiline']['n'] else '-'} (multi-line); "
          f"{topn(x['single_line_position_in_span'], 1)} (one line) | {cname(x['colour'], 1)} | {x['n']} |")
    dl = t["dateline"]
    w(f"| Run-in dateline | {topn(dl['fonts'], 2)} | same as its body text ({fm(dl['size_over_body_run'], ' x', 2, False)}) | - | - | "
      f"opens the first body line, ends with {topn(dl['form'], 1)} | {cname(dl['colour'], 1)} | {dl['n']} |")
    w("")
    bands = t["headline_face_by_size_band_pt"]["bands"]
    w("Headline faces by size: " + "; ".join(f"{b} pt: {topn(c, 2)}" for b, c in bands.items())
      + ". The commonest face changes with size (" + ", ".join(f"{b} pt {next(iter(c['shares']))}" for b, c in bands.items())
      + "), but no size band uses one face only: the paper mixes its display faces.")
    w("")
    w(f"Body text details: word spaces are {fm(bm['word_space_over_font_space_frame_median'], ' x', 2, False)} the font's own space "
      f"(justification stretches them); {pc(bm['hscale_not_100_share'])} of stories are slightly condensed or expanded as a whole "
      f"({fm(bm['hscale'], '', 3, False)}); first-line indent {fm(bm['first_line_indent_mm'], ' mm', 1)}; the first line of a story is indented "
      f"when it opens with a dateline ({pc(bm['story_first_line_with_dateline_indented_share'])}) and in {pc(bm['story_first_line_indented_share'])} of the others.")
    w("")
    w("### Headline size by story width")
    w("| Width | Headlines | Size pt, all pages | Front | Inside | Back | Lines (commonest) |")
    w("|---|---|---|---|---|---|---|")
    for k, v in prof["headline_size"]["by_span"].items():
        sz = v["size_pt"]
        lab = k.replace("8col:", "").replace("6col:", "6-col grid: ") + (" col" if k.startswith(("8col", "6col")) else "")
        lab = lab.replace("off_grid", "not on the grid")
        hist = v["lines"]["histogram"]
        top_l = max(hist.items(), key=lambda kv: kv[1])[0] if hist else "-"
        w(f"| {lab} | {(sz['all'] or {}).get('n', 0)} | {fm(sz['all'], '', 1, False)} | {(sz['front'] or {}).get('median', '-')} | "
          f"{(sz['inside'] or {}).get('median', '-')} | {(sz['back'] or {}).get('median', '-')} | {top_l} |")
    w("")
    w("## 4. Spacing: how far apart things sit")
    w("Distances are measured from the baseline (the line the letters sit on) or from the edge of a picture or rule, in millimetres and in "
      "'lines of body text' (one line = the body leading, about 4.6 mm).")
    w("")
    w("| From -> to | mm | Lines of body text | n |")
    w("|---|---|---|---|")
    rows = (("kicker_to_headline", "Kicker -> headline"), ("reversed_label_to_headline", "Reversed label -> headline"),
            ("headline_to_deck", "Headline -> deck"), ("headline_to_body", "Headline -> first body line (no deck, no dateline)"),
            ("headline_to_body_runin_dateline", "Headline -> first body line that opens with a dateline"), ("deck_to_body", "Deck -> first body line"),
            ("headline_to_byline", "Headline -> byline line"), ("byline_to_body", "Byline line -> first body line"),
            ("headline_to_photo", "Headline -> top of photo"), ("deck_to_photo", "Deck -> top of photo"), ("photo_to_body", "Bottom of photo -> first body line"),
            ("photo_to_headline", "Bottom of photo -> headline below it"), ("photo_to_caption", "Bottom of photo -> caption"),
            ("body_to_rule", "Last body line -> rule below the story"), ("rule_to_headline", "Rule -> next headline"),
            ("story_separation_with_rule", "Last body line -> rule -> next headline (total)"), ("body_to_headline_no_rule", "Last body line -> next headline (no rule)"),
            ("crosshead_space_above", "Body line -> crosshead"), ("crosshead_space_below", "Crosshead -> body line"),
            ("box_top_to_first_baseline", "Top of a box -> first line inside"), ("last_baseline_to_box_bottom", "Last line inside -> bottom of the box"))
    for k, nm in rows:
        v = sp.get(k) or {}
        if v.get("n"):
            w(f"| {nm} | {fm(v['mm'], '', 1, False)} | {fm(v['body_leadings'], '', 2, False)} | {v['n']} |")
        else:
            w(f"| {nm} | not used by the paper | - | 0 |")
    w("")
    w(f"Crossheads sit exactly one line of text below and above the paragraphs around them: no extra space. "
      f"A rule above a headline sits about {sp['rule_to_headline']['over_headline_size']['median']:.2f} of the headline size above its baseline. "
      f"Directly above a headline is: {topn(sp['element_directly_above_main_headline'], 4)}.")
    w("")
    w("## 5. Rules and boxes")
    h = rb["horizontal_rules"]
    w(f"- **Horizontal rules**: {h['n']} on {sc['pages_profiled_devanagari']} pages ({fm(h['per_page']['all'], '', 0)} per page). Weights: "
      + ", ".join(f"{k} pt {pc(v['share'])}" for k, v in list(h["weights_pt"].items())[:4]) + f". Colour: {cname(h['colour'], 2)}. Where: {topn(h['where'], 3)}. "
      f"Length: {topn(h['length_in_columns'], 4)} ({pc(h['full_type_area_width_share'])} run the full width).")
    w(f"- **Vertical (column) rules**: {rb['vertical_rules']['n']} - the paper separates columns with white space only.")
    for k, v in rb["boxes"].items():
        w(f"- **{k.replace('_', ' ')}** ({prof['rules_and_boxes']['box_categories'][k]}): {v['n']}; fill {cname(v['fill'], 2)}; "
          f"stroke {cname(v['stroke'], 1)} {fm(v['stroke_weight_pt'], ' pt', 2, False)}; size {fm(v['width_mm'], '', 0, False)} x {fm(v['height_mm'], ' mm', 0, False)}; "
          f"first line {fm(v['padding_top_to_first_baseline_mm'], ' mm', 1, False)} below the top edge.")
    lp = sp["label_panels"]
    w(f"- **Label panels** (a short label on a coloured strip above a headline): {lp['n']}, {pc(lp['reversed_share'])} with white text; "
      f"{fm(lp['height_mm'], ' mm', 1, False)} tall; fill {cname(lp['fill'], 3)}.")
    w("")
    w("## 6. Photos and captions")
    w(f"- {im['n_photos']} photos ({fm(co['all']['photos_per_page'], '', 0, False)} per page). Shape: {topn(im['orientation'], 3)}; width/height "
      f"{fm(im['aspect_w_over_h'], '', 2, False)}; height {fm(im['height_mm'], ' mm', 0, False)}.")
    w(f"- Width: {topn(im['width_fit'], 3)}. In the story's own text columns: {topn(im['width_in_story_text_columns'], 3)} columns.")
    w(f"- Place: {topn(im['place_relative_to_headline'], 5)}. Relative to the headline's width: {topn(im['width_relative_to_headline_span'], 4)}.")
    w(f"- Captions: only {pc(im['with_caption_share'])} of photos have one; when they do, the caption's first line sits "
      f"{fm(im['caption_gap_photo_bottom_to_first_baseline_mm'], ' mm', 1)} below the photo. Frames around photos: {pc(im['with_frame_share'])}. "
      f"Text printed over a photo: {pc(im['with_text_over_photo_share'])}.")
    w(f"- {im['possible_one_off_ads']} photo-sized pictures stand alone (no headline, text or caption touching them): they may be one-off ads.")
    w("")
    w("## 7. Furniture (what repeats on every page)")
    m = fu["masthead"]
    w(f"- **Nameplate (front page)**: a block from {fm(m['y0_mm'], ' mm', 1, False)} to {fm(m['y1_mm'], ' mm', 1, False)} from the top "
      f"({fm(m['height_mm'], ' mm', 1, False)} tall) across the page; made of {topn(m['made_of'], 3)}. Title faces: "
      + "; ".join(f"{f} {fm(v['size_pt'], ' pt', 1, False)}" for f, v in m["nameplate_text"].items()) + f". Positions seen: {topn(m['positions_seen'], 3)}.")
    for k, v in fu["running_head"].items():
        w(f"- **Running head {k.split('_')[1]}** ({v['n_pages']} pages: {topn(v['by_page_type'], 2)}): a bar {fm(v['block_mm']['height'], ' mm', 1, False)} tall at "
          f"{fm(v['block_mm']['y0'], ' mm', 1, False)} from the top; fill {cname(v['bar']['fill'], 1)}, edge {cname(v['bar']['stroke'], 1)} "
          f"{fm(v['bar']['stroke_weight_pt'], ' pt', 1, False)}; small logo {fm(v['logo']['width_mm'], '', 0, False)} x {fm(v['logo']['height_mm'], ' mm', 0, False)} "
          f"at {fm(v['logo']['x0_mm'], ' mm', 0, False)} from the left; date line {topn(v['date_line']['fonts'], 1)} {fm(v['date_line']['size_pt'], ' pt', 1, False)} "
          f"{cname(v['date_line']['colour'], 1)}, right edge at {fm(v['date_line']['x1_mm'], ' mm', 0, False)}; page number {topn(v['folio']['fonts'], 1)} "
          f"{fm(v['folio']['size_pt'], ' pt', 1, False)} at {fm(v['folio']['x0_mm'], ' mm', 0, False)} from the left.")
    w(f"- **Imprint** (printer's line): on {fu['imprint']['n_pages']} pages ({topn(fu['imprint']['by_page_type'], 2)}), "
      f"{fm(fu['imprint']['y0_mm'], ' mm', 0, False)} to {fm(fu['imprint']['y1_mm'], ' mm', 0, False)} from the top, {topn(fu['imprint']['fonts'], 1)} {fm(fu['imprint']['size_pt'], ' pt', 1, False)}.")
    w(f"- **Standing boxes** on the front page's left column (weather, market rates): {fu['standing_modules']['n']}, {fm(fu['standing_modules']['width_mm'], ' mm', 1, False)} wide.")
    for l in fu["standing_labels"][:5]:
        w(f"- Standing label ({l['page_type']} pages): {l['font']} {l['size_pt']} pt {l['colour']}, at {fm(l['x0_mm'], ' mm', 0, False)} from the left, "
          f"{fm(l['baseline_mm'], ' mm', 0, False)} from the top ({l['n_runs']} times).")
    w("")
    w("## 8. How pages are put together")
    w("| | Front | Inside | Back |")
    w("|---|---|---|---|")
    w("| Pages | " + " | ".join(str(co[k]["pages"]) for k in PTYPES) + " |")
    w("| Main stories per page | " + " | ".join(fm(co[k]["main_stories_per_page"], "", 0, False) for k in PTYPES) + " |")
    w("| Photos per page | " + " | ".join(fm(co[k]["photos_per_page"], "", 0, False) for k in PTYPES) + " |")
    w("| Pages with ads | " + " | ".join(str(co[k]["pages_with_ads"]) for k in PTYPES) + " |")
    w("| Lead headline size pt | " + " | ".join(fm(co[k]["lead_story"]["size_pt"], "", 1, False) for k in PTYPES) + " |")
    w("| Lead story width (columns) | " + " | ".join(topn(co[k]["lead_story"]["span_columns"], 2) for k in PTYPES) + " |")
    w("| Lead story is the top story | " + " | ".join(pc(co[k]["lead_story"]["is_topmost_story_share"]) for k in PTYPES) + " |")
    w("| Lead story has a photo | " + " | ".join(pc(co[k]["lead_story"]["has_photo_share"]) for k in PTYPES) + " |")
    for a, nm in (("text", "text"), ("photo", "photos"), ("ad", "ads"), ("furniture", "furniture"), ("white", "white space")):
        w(f"| Share of the page: {nm} | " + " | ".join(pc(med(co[k]["area_share_of_trim"][a])) for k in PTYPES) + " |")
    w("")
    w("## 9. Headline shape: is there a rule?")
    pr = sh["printed_multiline_headlines"]["all"]
    w(f"On the {pr['n']} printed two-or-more-line headlines the shortest line is {fm(pr['balance_min_over_max'], '', 2, False)} of the longest; "
      f"the first line is the longest in {pc(pr['first_line_longest_share'])} and the last in {pc(pr['last_line_longest_share'])}; the longest line "
      f"fills {fm(pr['longest_line_fill_of_span'], '', 3, False)} of the column width.")
    w("")
    w("| Group | Headlines | Lines balanced (short/long) | First line longest |")
    w("|---|---|---|---|")
    for grp in ("page_in_section", "page_type", "alignment"):
        for k, v in sh["printed_multiline_headlines"][grp].items():
            w(f"| {grp.replace('_', ' ')} {k} | {v['n']} | {fm(v['balance_min_over_max'], '', 2, False)} | {pc(v['first_line_longest_share'])} |")
    w("")
    ch = sh["choice_headlines"]
    w(f"Where the paper really had a choice of line breaks ({ch['all']['n']} headlines), the share of headlines whose printed breaks each shape reproduces:")
    w("")
    w("| Headlines | n | Chance | Balanced | Fill | First-fit |")
    w("|---|---|---|---|---|---|")
    for k in ("calibration", "test"):
        v = ch[k]
        w(f"| {'earlier editions' if k == 'calibration' else 'later editions'} | {v['n']} | {v['chance_pct']} % | {v['exact_pct']['BALANCE']} % | {v['exact_pct']['FILL']} % | {v['exact_pct']['FIRST_FIT']} % |")
    for k, v in ch["page_in_section"].items():
        w(f"| page {k} (all editions) | {v['n']} | {v['chance_pct']} % | {v['exact_pct']['BALANCE']} % | {v['exact_pct']['FILL']} % | {v['exact_pct']['FIRST_FIT']} % |")
    w("")
    w(f"**Honest reading.** The earlier editions mostly 'fill' the first line; the later ones are mixed (fill and balanced tie). Split by page, "
      f"width, size or alignment, no group shows a clean rule; a per-page rule learned on the earlier editions scores "
      f"{sh['per_page_rule_learned_on_calibration']['test_exact_pct']} % on the later ones (n {sh['per_page_rule_learned_on_calibration']['test_n']}), "
      "no better than one rule for all pages. This fits what the owner said: the rule changes by page and by designer, and the files do not say who made a page.")
    w("")
    w(f"**Default for the composer**: shape '{sh['default']['headline_shape']}' (the earlier lines as full as possible), which won the selection fixed "
      f"in advance on the earlier editions; '{sh['default']['per_page_option']}' as an option per page; crossheads '{sh['default']['crosshead_shape']}'; "
      f"the number of lines comes from the page plan.")
    w("")
    w("## 10. Other habits")
    w(f"- Run-in datelines open {pc(dl['share_of_stories'])} of stories ({topn(dl['form'], 2)}; bold face in {pc(dl['bold_share'])}).")
    w(f"- Drop caps: {ot['drop_caps']['n']}. Bullets: {ot['bullets_and_dingbats']['n']} ({topn(ot['bullets_and_dingbats']['fonts'], 1)}, "
      f"{topn(ot['bullets_and_dingbats']['colour'], 2)}, always at a line start).")
    w(f"- White text on coloured panels: {ot['reversed_text_runs']['n']} runs, panels {cname(ot['reversed_text_runs']['panel_colour'], 3)}.")
    w(f"- Numbers in body text: {topn(ot['numerals_in_body_text'], 2)} (Devanagari or Latin digits).")
    hc = ot["headline_colour_non_black_share"]
    w(f"- Headlines not in black: front {pc(hc['front']['share'])} (n {hc['front']['n']}), inside {pc(hc['inside']['share'])} (n {hc['inside']['n']}), "
      f"back {pc(hc['back']['share'])} (n {hc['back']['n']}).")
    w(f"- Jump heads (story continued from another page): {ot['jump_heads']}; jump lines: {ot['jump_lines']}. {ot['hyphenation']}.")
    lat = prof["latin_section"]
    if lat.get("pages"):
        w(f"- English section ({lat['pages']} pages, flip format with its own nameplate): body {topn(lat['body']['fonts'], 1)} "
          f"{(lat['body']['size_mode_pt_by_lines'] or {}).get('value')} pt on {(lat['body']['leading_mode_pt_by_lines'] or {}).get('value')} pt; "
          f"headlines {topn(lat['headline']['fonts'], 1)} {fm(lat['headline']['size_pt'], ' pt', 1, False)}.")
    w("")
    w("## 11. Checks")
    w("| Check | This profile | Earlier report | Agrees |")
    w("|---|---|---|---|")
    for c in prof["validation"]["checks"]:
        w(f"| {c['check']} | {c['ours']} | {c['reference']} ({c['reference_source']}) | {'yes' if c['pass'] else 'NO'} |")
    px = prof["validation"]["pixel_check"]
    w("")
    w(f"Pixel check on rendered pages ({', '.join(px['pages_checked'])} page, {px['dpi']} dpi): {px['rules']['n']} rules sit within "
      f"{fm(px['rules']['abs_diff_mm'], ' mm', 2, False)} of where the measurement puts them; {px['photo_edges']['n']} photo edges within "
      f"{fm(px['photo_edges']['abs_diff_mm'], ' mm', 2, False)}; {px['body_line_steps']['n']} line-to-line steps of body text agree with the "
      f"measured leading within {fm(px['body_line_steps']['abs_diff_mm'], ' mm', 2, False)}, and the headstroke of every checked line sits "
      f"{fm(px['headstroke_above_baseline_em']['dist'], ' em', 3, False)} above the measured baseline (constant, as it should be).")
    if figs.get("visual_check"):
        w("")
        w(figs["visual_check"])
    w("")
    w("## 12. What could not be measured")
    for x in prof["limitations"]:
        w(f"- {x}")
    w("")
    w("## Pictures")
    for k, nm in (("front_grid", "Front page: the 8 columns, the margins, the nameplate block, the lead story, photo sizes and rule weights"),
                  ("inside_rhythm", "Inside page: measured distances between kicker, headline, deck, photo, body text and rules (red ticks)"),
                  ("inside_roles", "Inside page: every text role with its typeface and size"),
                  ("back_areas", "Back page: what the page area is used for (blue text, green photos, red ads, grey furniture)")):
        if figs.get(k):
            w(f"- {nm}: ![{k}](profile_figs/{Path(figs[k]).name})")
    w("")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
