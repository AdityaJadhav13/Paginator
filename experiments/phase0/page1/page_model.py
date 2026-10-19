"""EXP-PAGE-1 page model: printed newspaper page -> elements and stories (EXPERIMENTAL; PILOT DATA STAYS PRIVATE).

Turns every page of a dataset's press PDFs into a structured model a page composer can rebuild the page from. Evidence
tooling only: nothing here is a layout decision. Data-driven: no publication name, date or text is built in (house
fonts, recurring furniture and recurring images are learned from the dataset; column measures come from the frames).

Usage:  PYTHONDONTWRITEBYTECODE=1 experiments/phase0/published1/.venv/bin/python experiments/phase0/page1/page_model.py \
            "$PAGEINATOR_PRIVATE_CORPUS/<dataset>" [--overlays SAMPLE:PAGE,...] [--only SAMPLE[:PAGE]]
Inputs (read-only): <dataset>/samples/<id>/{source.pdf | *.pdf, manifest.json}; <dataset>/work/<id>/corrected.json
        (else measure.json; samples with a top-level "excluded" key and frames with "excluded" are skipped);
        <dataset>/report/headlines.jsonl (display-text roles from published1/headlines.py).
Outputs: <dataset>/report/page1/pages/<sample>__p<page>.json   one page model each (mode 600; holds article text)
         <dataset>/report/page1/overlays/<sample>__p<page>.png story overlays for --overlays pages (mode 600)
         <dataset>/report/page1/page_model_summary.json       per-page coverage, story counts, checks (mode 600)
         experiments/phase0/results/page1/page_model_coverage.json   AGGREGATES ONLY (counts and percentages; no text,
                                                                     no sample ids, no dates, no publication name)
The dataset must live outside the git repository (refused otherwise).

SCHEMA "pageinator.page1.page_model/1" (the composer contract; keys may be added, never renamed). mm; x from the
MediaBox left edge, y DOWN from the MediaBox top edge; baselines y-down mm. Keys added beyond the contract:
  page: unassigned_lines [{line_ref, reason}], body_font_page, body_size_pt_page; checks.paths/threads/flow_accounting.
  text elements: colour {space, values}, words_match, role_reason, span_mm, span_cols, grid, source_role,
      text_matches_source, kind_was/kind_reason (kind changed here), jump/jump_page, run_in/run_in_line, image, ad;
      lines[].words_match, lines[].unmapped.
  body_frame: lines[].use (body | display | merged), element, merged, merged_into, split/split_of, words_match,
      unmapped, hyphen_break, class_measure; width_confidence, measure_source (own | borrowed), promoted, split_from.
  rule: orientation, colour_paired; box: dash, panel, colour_paired; image: placement_bbox_mm, recurring_editions,
      captions; graphic: n_paths, shading, colours; ad: parts.
  story: bbox_mm, space_em, headline_parts, jump_lines, other_elements, parent_story; flow para: hyphen_breaks, checks,
      lines[].words_match; columns[]: measure_mm, left_edge_mm (sustained left edge, null if every line may open a
      paragraph); checks: column_order_violations, columns_reordered, column_lines_outside, columns_wider_than_lines,
      indents_gt_2em. page checks.columns and summary totals.column_checks: the column self-checks summed.

PIPELINE (per page; PDF points y-up internally, converted at output)
 1 Glyphs: actualtext.page_glyphs(), the validated /ActualText reader; ALL output text comes from actualtext.line_text().
   A second pdfminer pass (actualtext's device + glyph box, horizontal scale, fill colour, painted paths) is asserted
   glyph-for-glyph identical. pdfminer's PDFGraphicState.copy() drops colour spaces; this interpreter keeps them
   across q/Q (otherwise CMYK set before q reads as DeviceGray after Q).
 2 Display text: each headlines.jsonl record of the page is an element (deck with a crosshead reason -> crosshead;
   other: O6 -> jump_line, O2 in the page head/foot, O3, O7 -> folio, O4 -> furniture, O1/O8/O9 -> other_text).
   O5 (body style outside body frames) is body material, not an element. A short text naming another page number of
   the edition (parenthesised, or <= 3 words) is a jump_line: lower page = jump in, higher = jump out.
 3 Lines: measure.py frames (not excluded). A line >= 50 % covered by a display element is a "display" line. A
   one-line display element on the same baseline as, and content-order adjacent to, another line in one column measure
   is a RUN-IN lead (dateline, bold lead-in): it stays inside that printed line. A measured line whose glyphs form
   >= 2 content-order runs >= 2 mm apart joins several columns (measure.py merge, e.g. under a box): it is cut at the
   run boundaries; foreign pieces form split frames "<frame>~<n>".
 4 Fragments: a line whose glyphs all lie inside another same-baseline body line is part of it; a line on the same
   baseline whose first glyph follows (or last precedes) a body line's in content order with only whitespace between
   is merged into it (text re-read over the merged range) when the union fits a body frame's measure (+-1.5 mm), or the
   gap is a word space (<= 12 mm) between pieces of non-body frames / a non-body piece hanging past the measure. Other
   non-body frames in a page body font and size band (0.8-1.25 x) are promoted to body frames, which borrow the measure
   of the tightest measure.py body frame containing them; class and left offset of reshaped lines are re-derived with
   measure.py's rules. Remaining uncovered lines become other_text. Glyphs in no element (frames excluded by
   corrections, stray glyphs) become residual text blocks (split at content-order runs and gaps > 1 em, stacked by
   alignment); residual lines recurring verbatim in >= 3 editions make the block furniture. Every glyph is in a text
   element.
 5 Vector art: PDFium page objects (form XObjects descended, matrices composed). Paths: 2-point stroked lines and thin
   filled rectangles (<= 1 mm, >= 3 mm long) -> rule; axis-aligned rectangles -> box; anything else -> graphic
   (consecutive touching graphic paths joined). Colours from the paired pdfminer path in its native colour space
   (cmyk|rgb|gray|separation|...); unpaired paths fall back to PDFium RGBA (space rgb, source pdfium). Images: visible
   bbox = placement bbox intersected with its clip-path boxes; pixel size and colour space from PDFium.
 6 Ads, only with evidence, below the page head (first body-frame line): (a) image content (raw stream hash) recurring
   in >= 3 editions, >= 1500 mm2 per group of touching images; (b) a panel (box >= 1500 mm2, both sides >= 30 mm) with
   <= 2 story body lines whose text is >= 50 % recurring or in non-house fonts, or >= 50 % covered by recurring images.
   House fonts: used in body frames or as headline/deck/kicker/byline/caption in >= 3 editions. Ad parts keep their
   element kinds with "ad": <ad id> and never join a story.

STORY GROUPING
 a Units and content order: every body line and text-element line with its ink glyphs. InDesign writes a threaded
   story's frames consecutively in reading order, so content-order adjacency is evidence of a text flow; but frames of
   different stories are also drawn consecutively, so links are cut at story boundaries (d).
 b Blocks: a frame's body lines top to bottom, split where the next line is not the content-order successor. A
   successor may sit behind <= 3 IN-FLOW display units (bold or coloured, < 1.1 x page body size, <= 3 lines, not a
   byline/kicker/caption/jump line/folio/furniture, within 4 leadings in the column of a line they join, not followed by
   a run-in dateline, which marks a brief headline). In-flow units become crossheads.
 c Threads: block A links to block B when B's first line is A's last line's content-order successor (through in-flow
   units), unless the link crosses a story boundary.
 d Story boundary for A -> B: A ends with a quote attribution (dash-led short line set off from the left edge); or A's
   governing head (its geometric head, else inherited along its chain) differs from B's and: B is the first body line
   under its headline and that headline lies below A's last line; or a horizontal rule across A's column lies between
   them; or the text breaks between paragraphs there (A ends a paragraph; B indented, opens with a run-in dateline, or
   is the first line under its head) with two different heads, or with one head while B lies below A.
 e Heads: headline elements (not ad parts, not in-flow). Stacked "S" headline paragraphs join the head above
   (headline_parts); a heading <= 0.85 x a headline's size directly under or above it within its span, nothing in
   between, is its deck. A head's bottom is its last baseline + 0.1 em. A line's geometric heads: heads above it whose
   span (headlines.py grid span) covers >= 50 % of its column, no horizontal rule across the column in between, same
   panels; nearest first. A thread's head: column-weighted vote of its columns' nearest geometric heads; a farther
   candidate that is the thread's content-order neighbour wins only when the nearest is strongly claimed by another
   thread; no geometric head -> a content-order neighbouring head beside the flow.
 f Assembly per head: the largest thread is the main flow. Other threads, in reading order, join before it when they
   end mid-paragraph (or the main flow starts mid-paragraph) and after it when the flow so far ends mid-paragraph or
   they start non-indented (and lie right of / below its last column); otherwise they are stories with headline null
   and "parent_story" (pull quote, sidebar). Headless threads: joined to a story on their left when both sides are
   mid-paragraph; else child of a headline above them ignoring panels; else child of the story whose flow they touch in
   content order; else standalone (briefs without headline, tables).
 g Attachments: decks (content-order cluster of the head, else directly under it within its span above the body
   under it, or straps above), kicker (directly above the head), run-in leads (opening the first line: byline;
   elsewhere: other_elements), other bylines (content-order neighbour of the flow, else directly above/below it),
   jump lines (geometry first: below the last line, above the first line or headline; then content order), images
   (inside the smallest story region, else directly above a headline within its span; recurring image content never),
   captions (headlines.py C1 geometry to an image, then its story), other text inside exactly one story region. Every
   relation above a headline must have nothing printed in between (no rule, no other text).
 h Flow: thread order. A line indented by >= 0.5 em starts a paragraph, as does the line after a crosshead or after a
   gap > 1.4 leadings; a non-indented line at the top of a column continues the paragraph. Paragraph text = the lines'
   exact texts joined by single spaces, as paragraphs.py joins them; paragraphs.py never de-hyphenates (it excludes
   paragraphs with a line-end hyphen break), so line-end hyphens stay as printed and each paragraph reports
   hyphen_breaks. Paragraph indents are measured against the line's own column entry, so an offset beside an inset
   is not an indent; indent_mm is the first line's offset from its entry's left edge.
 i Columns (0.2.0): one entry per printed measure, derived from its own printed lines only (never from a frame
   measure): x0/x1 = min/max of the lines' glyph extents, top/bottom = first/last baseline -0.8/+0.3 em (crossheads
   in the entry included), first_baseline = its first line's. A new entry starts where the flow goes up, leaves a gap
   > 4 leadings, moves sideways (< 50 % overlap), or another printed body line lies between two consecutive lines; or
   where EITHER edge changes by > 1 mm for >= 2 consecutive lines (a run-around beside an inset). Left edge: lines that
   cannot open a paragraph (previous line ends mid-paragraph) sit on it; possible openers on it or <= 2 em right (not
   beside an image/graphic/ad). Right edge (justified flows only): justified lines, and runs of >= 3 level non-final
   lines, end on it; final/ragged lines end at or before it. A single deviating line stays in its entry; a possible
   opener just above a change goes with the measure that makes its offset an indent (none or the page's typical one).
   Order: content order, unless it contradicts the geometric reading order of the entries (an entry wholly above
   another it overlaps horizontally, or wholly left of one it overlaps vertically, reads first); then the stable
   geometric order, and the flow (paragraphs, crossheads) follows it (story checks.columns_reordered).

CHECKS
 Page (asserted): every body_frame line with use "body" is in exactly one story flow or listed in unassigned_lines (and
 its frame id is in "unassigned" when no line of it is in a story); merged lines are accounted through their host,
 display lines through their element. Each line's decoded word count is compared with its geometric token count
 (words_match). Also: path pairing PDFium/pdfminer, glyph-pass identity, residual glyphs, links cut, lines split.
 Columns (self-checks, reported per story, page and dataset): every flow line inside its column box (+-0.5 mm);
 columns in geometric reading order (i); no column wider than its widest line + 1 mm (an entry holding an indented
 opener and shorter lines can be); paragraph indents > 2 em.
 Story: words_match, unmapped glyphs, starts_paragraph (indented, run-in dateline, or first line under the head),
 ends_paragraph (last line "final", or "ambiguous": a frame's last line labelled FINAL by measure.py while within one
 space of the measure), column transitions consistent (mid-paragraph end -> non-indented start, final -> indented or
 crosshead; ambiguous fits both), single thread, headline evidence (geo+content | geo | content | none), text of
 excluded frames inside the story's columns (a gap in the flow). complete = no jump in/out and all checks pass.
 confidence: high = no weak point, medium = one, low = more. Weak points: headline not confirmed by both geometry and
 content order, several threads, a words mismatch, inconsistent transitions, ends mid-paragraph without a jump out,
 starts mid-paragraph (not counted for child stories), excluded-frame text inside. "reasons" lists them.
"""
from __future__ import annotations

import argparse
import bisect
import ctypes
import hashlib
import json
import math
import os
import platform
import re
import statistics as st
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUB1 = HERE.parent / "published1"
sys.path.insert(0, str(PUB1))
import actualtext as AT  # noqa: E402
import headlines as HL  # noqa: E402
import overlay as OV  # noqa: E402  (minimal PNG writer, no Pillow)
import pypdfium2 as pdfium  # noqa: E402
import pypdfium2.raw as PR  # noqa: E402
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager  # noqa: E402
from pdfminer.pdfpage import PDFPage  # noqa: E402
from pdfminer.utils import apply_matrix_pt  # noqa: E402

SCHEMA = "pageinator.page1.page_model/1"
TOOL = "page1-model/0.2.0"
MM = AT.MM                              # points per mm
SPLIT_DATE = "2025-11-10"               # protocol: editions before this date are calibration ("cal"), the rest "test"
BASELINE_EM = HL.BASELINE_EM            # 0.15 em: same line (measure.py, actualtext.py)
INDENT_EM = 0.5                         # a line indented by >= 0.5 em starts a paragraph (measure.py indent_min_em)
PARA_GAP = 1.4                          # a vertical gap > 1.4 leadings starts a paragraph (measure.py para_gap_factor)
OVERHANG_MM = HL.OVERHANG_MM            # 1.5 mm: a merged fragment must lie inside the host frame's measure
SPLIT_GAP_MM = 2.0                      # content-order runs of one measured line this far apart are different columns
FRAG_GAP_MM = 12.0                      # pieces of promoted frames on one baseline merge across a gap up to this
SKIP_STRAY = 3                          # unowned ink glyphs tolerated between two content-order neighbours
INFLOW_MAX = 3                          # in-flow display units walked through when linking body lines
INFLOW_REACH = 4.0                      # an in-flow heading lies within this many leadings of a line it joins
COL_TOL_MM = 1.0                        # same column: both measure edges agree within this
COL_BREAK = 4.0                         # a gap > 4 leadings inside one column starts a new column entry
INDENT_MAX_EM = 2.0                     # a paragraph indent is at most 2 em; a larger offset is a measure (run-around)
COL_ASC, COL_DESC = 0.80, 0.30          # column box: first baseline - 0.8 em to last baseline + 0.3 em (line box)
HEAD_COVER = 0.5                        # a headline span owns a column it covers by >= 50 % of the column width
RULE_MAX_MM = 1.0                       # filled rectangles at most this thick and at least RULE_MIN_MM long are rules
RULE_MIN_MM = 3.0
GRAPHIC_JOIN_MM = 1.0                   # graphic paths this close (consecutive in content order) form one graphic
PANEL_MIN_MM2 = 1500.0                  # boxes this large (and >= PANEL_MIN_SIDE_MM on both sides) are panels
PANEL_MIN_SIDE_MM = 30.0
AD_SHARE = 0.5                          # ad evidence share (see docstring step 6)
RECUR_EDITIONS = HL.RECUR_EDITIONS      # 3
SMALLHEAD_R = HL.SMALLHEAD_R            # 1.1: in-flow headings at or above this size ratio are headlines
DISPLAY_R = HL.DISPLAY_R                # 1.5
FRAG_BAND = HL.FRAG_BAND                # body size band, x page body size
CAPTION_MM = (8.0, 4.0, 3.0)            # headlines.py C1: under (top <= 8 mm below), over (bottom <= 4 mm above), x +-3 mm
PHOTO_ABOVE_HEAD_MM = 15.0
HEAD_DESCENT_EM = 0.1                   # a headline's bottom for "above" tests: last baseline + 0.1 em
SUBHEAD_RATIO = 0.85                    # a heading <= 0.85 x a headline's size directly under it is its deck (headlines.py D1)
FOOT_HEAD_SHARE = 0.05                  # page head / foot zone for folios (headlines.py PAGE_HEAD)
DASHES = HL.DASHES
DEVA_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
CS_NAMES = {0: "unknown", 1: "DeviceGray", 2: "DeviceRGB", 3: "DeviceCMYK", 4: "CalGray", 5: "CalRGB", 6: "Lab",
            7: "ICCBased", 8: "Separation", 9: "DeviceN", 10: "Indexed", 11: "Pattern"}
INFLOW_KINDS = {"crosshead", "headline", "deck", "other_text"}
TEXT_KINDS = ("headline", "deck", "kicker", "byline", "crosshead", "caption", "jump_line", "folio", "furniture",
              "other_text")


# ------------------------------------------------------------------------------------------------- small helpers
def r2(v, nd=2):
    return None if v is None else round(float(v), nd)


def overlap(a0, a1, b0, b1):
    return min(a1, b1) - max(a0, b0)


def area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def inter(a, b):
    return [max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])]


def union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def inside_share(a, b):
    """Share of box a's area inside box b (a point-like box counts by its centre)."""
    if area(a) <= 1e-9:
        cx, cy = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
        return 1.0 if b[0] <= cx <= b[2] and b[1] <= cy <= b[3] else 0.0
    return area(inter(a, b)) / area(a)


def centre(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def contains(b, p, m=0.0):
    return b[0] - m <= p[0] <= b[2] + m and b[1] - m <= p[1] <= b[3] + m


def box_gap(a, b):
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return max(dx, dy)


def rbox(b):
    return [r2(v) for v in b]


def page_refs(text, page, n_pages):
    """Valid page numbers of this edition, other than the current page, named in a text (ASCII or Devanagari)."""
    out = []
    for m in re.findall(r"[0-9०-९]+", text):
        n = int(m.translate(DEVA_DIGITS))
        if 1 <= n <= n_pages and n != page:
            out.append(n)
    return out


def is_bold(font, display_fonts):
    return bool(HL.BOLD_RE.search(font or "")) or font in display_fonts


def black(cmyk):
    return cmyk is None or (cmyk[0] <= 0.05 and cmyk[1] <= 0.05 and cmyk[2] <= 0.05 and cmyk[3] >= 0.9)


class Frame:
    """MediaBox coordinate frame: PDF points (y up) <-> output mm (x from the left edge, y down from the top edge)."""

    def __init__(self, mb):
        self.l, self.b, self.r, self.t = mb

    def x(self, xpt):
        return (xpt - self.l) / MM

    def y(self, ypt):
        return (self.t - ypt) / MM

    def xpt(self, xmm):
        return self.l + xmm * MM

    def ypt(self, ymm):
        return self.t - ymm * MM

    def box_from_pt(self, l, b, r, t):
        return [self.x(l), self.y(t), self.x(r), self.y(b)]


# ------------------------------------------------------------------------------------------------- PDF: pdfminer pass
class _Interp(PDFPageInterpreter):
    """pdfminer interpreter whose saved graphics states keep their colour spaces (PDFGraphicState.copy() drops
    scs/ncs, so after Q a CMYK colour would otherwise be reported in DeviceGray)."""

    def get_current_state(self):
        ctm, ts, gs = super().get_current_state()
        gs.scs, gs.ncs = self.graphicstate.scs, self.graphicstate.ncs
        return ctm, ts, gs


def colour(cs, v):
    """A colour in its native space: {"space": cmyk|rgb|gray|lab|separation|devicen|indexed|pattern, "values": [...]}."""
    name = getattr(cs, "name", None) or "DeviceGray"
    vals = v if isinstance(v, (tuple, list)) else (v,)
    try:
        vals = [round(float(x), 4) for x in vals]
    except (TypeError, ValueError):
        return None
    n = len(vals)
    if name == "DeviceN":
        space = "devicen"
    elif name == "Separation" and n == 1:
        space = "separation"
    elif name in ("Indexed", "Pattern"):
        space = name.lower()
    elif n == 4:
        space = "cmyk"
    elif n == 3:
        space = "lab" if name == "Lab" else "rgb"
    elif n == 1:
        space = "gray"
    else:
        space = name.lower()
    return {"space": space, "values": vals}


def cmyk_of(c):
    if not c:
        return None
    if c["space"] == "cmyk":
        return list(c["values"])
    if c["space"] == "gray":
        return [0.0, 0.0, 0.0, round(1 - c["values"][0], 4)]
    return None


class _ModelDevice(AT._ATDevice):
    """actualtext's device, additionally recording per glyph: glyph box, horizontal scale, fill colour; and every
    painted path (CTM applied, line width in page units, native stroke/fill colours, dash)."""

    def __init__(self, rsrc):
        super().__init__(rsrc)
        self.gx = []
        self.paths = []

    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate):
        adv = super().render_char(matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate)
        ch = self.cur_item._objs[-1]
        m = ch.matrix
        self.gx.append((ch.x0, m[5], ch.y0, ch.y1, (m[0] / m[3]) if m[3] else 1.0, colour(ncs, graphicstate.ncolor)))
        return adv

    def paint_path(self, gstate, stroke, fill, evenodd, path):
        pts = []
        try:
            for seg in path:
                vals = seg[1:]
                for k in range(0, len(vals) - 1, 2):
                    pts.append(apply_matrix_pt(self.ctm, (float(vals[k]), float(vals[k + 1]))))
        except (TypeError, ValueError):
            pts = []
        a, b, c, d = self.ctm[:4]
        dash = gstate.dash
        self.paths.append({"stroke": bool(stroke), "fill": bool(fill), "pts": pts,
                           "lw": float(gstate.linewidth or 0) * math.sqrt(abs(a * d - b * c)),
                           "scol": colour(gstate.scs, gstate.scolor), "fcol": colour(gstate.ncs, gstate.ncolor),
                           "dash": bool(dash and isinstance(dash, (tuple, list)) and dash[0])})


def pdfminer_pass(pdf, page_no, G):
    """Second pass: glyph extras (asserted identical glyph order to actualtext) and painted paths."""
    rsrc = PDFResourceManager()
    dev = _ModelDevice(rsrc)
    interp = _Interp(rsrc, dev)
    with open(pdf, "rb") as fh:
        for i, pg in enumerate(PDFPage.get_pages(fh), 1):
            if i == page_no:
                interp.process_page(pg)
                break
    if len(dev.gx) != len(G):
        raise RuntimeError(f"p{page_no}: second pass glyph count differs")
    for g, (x0, by, y0, y1, hs, col) in zip(G, dev.gx):
        if abs(x0 - g["x0"]) > 1e-6 or abs(by - g["by"]) > 1e-6:
            raise RuntimeError(f"p{page_no}: second pass glyph order differs")
        g["y0"], g["y1"], g["hs"], g["col"] = y0, y1, hs, col
    return dev.paths


# ------------------------------------------------------------------------------------------------- PDF: PDFium objects
def _matrix(obj):
    m = PR.FS_MATRIX()
    if not PR.FPDFPageObj_GetMatrix(obj, m):
        return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    return (m.a, m.b, m.c, m.d, m.e, m.f)


def _mul(m1, m2):
    """m1 then m2 (PDF row-vector convention)."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2,
            e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2)


def _apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def _clip_box(obj, parent_m):
    """Intersection of the bounding boxes of an object's clip paths (PDF pt), or None when unclipped."""
    cp = PR.FPDFPageObj_GetClipPath(obj)
    if not cp:
        return None
    box = None
    for k in range(max(0, PR.FPDFClipPath_CountPaths(cp))):
        xs, ys = [], []
        for j in range(max(0, PR.FPDFClipPath_CountPathSegments(cp, k))):
            seg = PR.FPDFClipPath_GetPathSegment(cp, k, j)
            x, y = ctypes.c_float(), ctypes.c_float()
            if seg and PR.FPDFPathSegment_GetPoint(seg, x, y):
                X, Y = _apply(parent_m, x.value, y.value)
                xs.append(X)
                ys.append(Y)
        if xs:
            b = (min(xs), min(ys), max(xs), max(ys))
            box = b if box is None else (max(box[0], b[0]), max(box[1], b[1]), min(box[2], b[2]), min(box[3], b[3]))
    return box


def _rgba(fn, obj):
    r, g, b, a = (ctypes.c_uint() for _ in range(4))
    if not fn(obj, r, g, b, a):
        return None
    return {"space": "rgb", "values": [round(r.value / 255, 4), round(g.value / 255, 4), round(b.value / 255, 4)],
            "source": "pdfium"}


def image_hash(obj):
    n = PR.FPDFImageObj_GetImageDataRaw(obj, None, 0)
    if n <= 0:
        return None
    buf = (ctypes.c_ubyte * n)()
    PR.FPDFImageObj_GetImageDataRaw(obj, buf, n)
    return hashlib.sha256(bytes(buf)).hexdigest()


def pdfium_objects(page):
    """Path, image and shading objects of a page in content order (form XObjects descended, matrices composed)."""
    out = []

    def walk(n, get, parent_m, level):
        for i in range(n):
            o = get(i)
            t = PR.FPDFPageObj_GetType(o)
            if t == PR.FPDF_PAGEOBJ_FORM:
                fm = _mul(_matrix(o), parent_m)
                walk(PR.FPDFFormObj_CountObjects(o), lambda j, o=o: PR.FPDFFormObj_GetObject(o, j), fm, level + 1)
            elif t in (PR.FPDF_PAGEOBJ_PATH, PR.FPDF_PAGEOBJ_IMAGE, PR.FPDF_PAGEOBJ_SHADING):
                out.append({"type": t, "obj": o, "parent_m": parent_m, "level": level})

    walk(PR.FPDFPage_CountObjects(page.raw), lambda j: PR.FPDFPage_GetObject(page.raw, j), (1.0, 0.0, 0.0, 1.0, 0.0, 0.0), 0)
    return out


def path_data(rec):
    o, pm = rec["obj"], rec["parent_m"]
    m = _mul(_matrix(o), pm)
    segs = []
    for j in range(max(0, PR.FPDFPath_CountSegments(o))):
        s = PR.FPDFPath_GetPathSegment(o, j)
        x, y = ctypes.c_float(), ctypes.c_float()
        if not s or not PR.FPDFPathSegment_GetPoint(s, x, y):
            continue
        X, Y = _apply(m, x.value, y.value)
        segs.append((PR.FPDFPathSegment_GetType(s), X, Y, bool(PR.FPDFPathSegment_GetClose(s))))
    fm, stroke = ctypes.c_int(), ctypes.c_int()
    PR.FPDFPath_GetDrawMode(o, fm, stroke)
    w = ctypes.c_float()
    PR.FPDFPageObj_GetStrokeWidth(o, w)
    xs, ys = [s[1] for s in segs], [s[2] for s in segs]
    return {"segs": segs, "fill": fm.value != 0, "stroke": bool(stroke.value),
            "sw": w.value * math.sqrt(abs(m[0] * m[3] - m[1] * m[2])),
            "bbox": (min(xs), min(ys), max(xs), max(ys)) if xs else None, "clip": _clip_box(o, pm),
            "rgba_s": _rgba(PR.FPDFPageObj_GetStrokeColor, o), "rgba_f": _rgba(PR.FPDFPageObj_GetFillColor, o),
            "dash_pdfium": PR.FPDFPageObj_GetDashCount(o) > 0}


def image_data(rec, page_raw):
    o, pm = rec["obj"], rec["parent_m"]
    m = _mul(_matrix(o), pm)
    pts = [_apply(m, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
    full = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
    clip = _clip_box(o, pm)
    vis = full if clip is None else (max(full[0], clip[0]), max(full[1], clip[1]), min(full[2], clip[2]), min(full[3], clip[3]))
    w, h = ctypes.c_uint(), ctypes.c_uint()
    PR.FPDFImageObj_GetImagePixelSize(o, w, h)
    md = PR.FPDF_IMAGEOBJ_METADATA()
    cs = CS_NAMES.get(md.colorspace, "unknown") if PR.FPDFImageObj_GetImageMetadata(o, page_raw, md) else "unknown"
    return {"full": full, "vis": vis, "pw": w.value, "ph": h.value, "cs": cs, "hash": image_hash(o)}


def pair_paths(pd_paths, mn_paths):
    """Pair PDFium path objects with pdfminer's painted paths (same content order; pdfminer also reports degenerate
    one-point paths that PDFium drops). Pairs need agreeing point bounding boxes (<= 0.5 pt)."""
    mn = [p for p in mn_paths if len({(round(x, 2), round(y, 2)) for x, y in p["pts"]}) >= 2]
    pairs, j = {}, 0
    for i, p in enumerate(pd_paths):
        if p["bbox"] is None:
            continue
        for jj in range(j, min(j + 4, len(mn))):
            q = mn[jj]
            xs, ys = [a for a, _ in q["pts"]], [b for _, b in q["pts"]]
            if all(abs(u - v) <= 0.5 for u, v in zip(p["bbox"], (min(xs), min(ys), max(xs), max(ys)))):
                pairs[i] = q
                j = jj + 1
                break
    return pairs, len(mn)


# ------------------------------------------------------------------------------------------------- dataset context
def load_dataset(ds):
    samples, skipped = [], []
    for sdir in sorted(p for p in (ds / "samples").iterdir() if p.is_dir()):
        doc = json.loads(HL.wpath(ds, sdir.name).read_text())
        if "excluded" in doc:
            skipped.append(sdir.name)
            continue
        man = json.loads((sdir / "manifest.json").read_text())
        pdf = sdir / "source.pdf" if (sdir / "source.pdf").exists() else next(sdir.glob("*.pdf"))
        samples.append({"sid": sdir.name, "doc": doc, "man": man, "pdf": pdf, "date": man.get("edition_date") or ""})
    recs = defaultdict(list)
    for line in open(ds / "report" / "headlines.jsonl", encoding="utf-8"):
        r = json.loads(line)
        recs[(r["sample"], r["page"])].append(r)
    return samples, skipped, recs


def dataset_context(samples, recs):
    """Learned from the whole dataset: house fonts, display fonts, recurring texts and recurring image contents."""
    body_eds, disp_eds, recur, ratios = defaultdict(set), defaultdict(set), defaultdict(set), defaultdict(list)
    for smp in samples:
        for pg in smp["doc"]["pages"]:
            for f in pg["frames"]:
                if f["is_body_candidate"] and not f.get("excluded"):
                    body_eds[HL.base_font(f["font"])].add(smp["sid"])
            for r in recs.get((smp["sid"], pg["page"]), []):
                recur[r["text"]].add(smp["sid"])
                ratios[r["font"]].append(r["size_pt"] / (pg["body_size_pt_page_mode"] or 10))
                if r["role"] in ("headline", "deck", "kicker", "byline", "caption"):
                    disp_eds[r["font"]].add(smp["sid"])
    house = {f for f, e in body_eds.items() if len(e) >= RECUR_EDITIONS} | \
            {f for f, e in disp_eds.items() if len(e) >= RECUR_EDITIONS}
    display_fonts = {f for f, rs in ratios.items() if st.median(rs) >= DISPLAY_R}
    img_eds = defaultdict(set)
    for smp in samples:
        pdoc = pdfium.PdfDocument(str(smp["pdf"]))
        for k in range(len(pdoc)):
            page = pdoc[k]                  # keep the page alive while its object handles are used
            for rec in pdfium_objects(page):
                if rec["type"] == PR.FPDF_PAGEOBJ_IMAGE:
                    h = image_hash(rec["obj"])
                    if h:
                        img_eds[h].add(smp["sid"])
            page.close()
        pdoc.close()
    return {"house_fonts": house, "display_fonts": display_fonts, "recur": recur,
            "img_eds": {h: len(e) for h, e in img_eds.items()}}


# ------------------------------------------------------------------------------------------------- record -> kind
def kind_from_record(rec, top_mm, bot_mm, page_h_mm):
    role, why = rec["role"], rec["role_reason"]
    code = why.split(" ")[0]
    if role == "headline":
        return "headline"
    if role == "deck":
        return "crosshead" if "crosshead" in why else "deck"
    if role in ("kicker", "byline", "caption"):
        return role
    if code == "O5":
        return None                                   # body material (step 4)
    if code == "O6":
        return "jump_line"
    if code in ("O3", "O7"):
        return "folio"
    if code == "O2":
        edge = FOOT_HEAD_SHARE * page_h_mm
        return "folio" if (bot_mm <= 2 * edge or top_mm >= page_h_mm - 2 * edge) else "other_text"
    if code == "O4":
        return "furniture"
    return "other_text"


# ------------------------------------------------------------------------------------------------- the page model
class PageModel:
    """All state of one page; build() runs the pipeline, json() returns the contract dict."""

    def __init__(self, ctx, smp, pg, recs, pdoc):
        self.ctx, self.smp, self.pg, self.recs = ctx, smp, pg, recs
        self.sid, self.pno = smp["sid"], pg["page"]
        self.n_pages = len(smp["doc"]["pages"])
        self.page = pdoc[self.pno - 1]
        self.fr = Frame(self.page.get_mediabox())
        self.W, self.H = (self.fr.r - self.fr.l) / MM, (self.fr.t - self.fr.b) / MM
        self.body_size = pg["body_size_pt_page_mode"] or 10.0
        self.body_font = pg["body_font_page_mode"]
        self.checks = {}

    # ---------------------------------------------------------------- glyph helpers
    def sel(self, by, x0, x1, size):
        return sorted(g["i"] for g in self.GI.line(by, x0, x1, size or self.body_size) if g["text"].strip())

    def vext(self, idx):
        """(top, bottom) in output mm from the glyph boxes."""
        if not idx:
            return None
        return self.fr.y(max(self.G[i]["y1"] for i in idx)), self.fr.y(min(self.G[i]["y0"] for i in idx))

    def glyph_stats(self, idx):
        ink = [self.G[i] for i in idx]
        if not ink:
            return {"font": None, "size": None, "hs": None, "col": None}
        cols = Counter(json.dumps(g["col"], sort_keys=True) for g in ink if g["col"])
        return {"font": Counter(HL.base_font(g["font"]) for g in ink).most_common(1)[0][0],
                "size": Counter(round(g["size"], 1) for g in ink).most_common(1)[0][0],
                "hs": round(st.median(g["hs"] for g in ink), 4),
                "col": json.loads(cols.most_common(1)[0][0]) if cols else None}

    def next_ink(self, i):
        k = self.pos[i] + 1
        return self.ink[k] if k < len(self.ink) else None

    def prev_ink(self, i):
        k = self.pos[i] - 1
        return self.ink[k] if k >= 0 else None

    def read_line(self, by, x0, x1, size):
        return AT.line_text(self.G, by, x0, x1, size or self.body_size)

    # ---------------------------------------------------------------- build
    def build(self):
        self.G = AT.page_glyphs(self.smp["pdf"], self.pno)
        self.mn_paths = pdfminer_pass(self.smp["pdf"], self.pno, self.G)
        self.GI = HL.GlyphIndex(self.G)
        self.ink = [g["i"] for g in self.G if g["text"].strip()]
        self.pos = {i: k for k, i in enumerate(self.ink)}
        self.text_elements()
        self.body_lines()
        self.vector_elements()
        self.residual_text()
        self.detect_ads()
        self.prepare_heads()
        self.units()
        self.threads()
        self.stories()
        self.validate()
        return self

    # ---------------------------------------------------------------- step 2: display text from headlines.jsonl
    def text_elements(self):
        self.tx = []
        for rec in sorted(self.recs, key=lambda r: r["id"]):
            lines = []
            for l in rec["lines"]:
                by, x0, x1 = l["baseline_pt"], l["x0_mm"] * MM, l["x1_mm"] * MM
                lines.append({"by": by, "x0": x0, "x1": x1, "size": rec["size_pt"], "ntok": l["n_words"],
                              "idx": self.sel(by, x0, x1, rec["size_pt"])})
            idx = sorted({i for l in lines for i in l["idx"]})
            ve = self.vext(idx) or (self.fr.y(lines[0]["by"]), self.fr.y(lines[-1]["by"]))
            kind = kind_from_record(rec, ve[0], ve[1], self.H)
            if kind is None:
                continue
            fid = rec["id"].split(":", 1)[1]
            E = {"id": "tx-" + fid, "kind": kind, "_lines": lines, "_rec": rec, "_src": rec["id"],
                 "_run_in": rec["role"] == "byline" and "run-in" in rec["role_reason"],
                 "_reason": rec["role_reason"], "_size": rec["size_pt"], "_font": rec["font"]}
            self.tx.append(E)
        # jump lines: short texts naming another page of this edition
        for E in self.tx:
            text = " ".join(self.read_line(l["by"], l["x0"], l["x1"], l["size"])["text"] for l in E["_lines"])
            E["_text"] = text
            refs = page_refs(text, self.pno, self.n_pages)
            words = len(text.split())
            paren = "(" in text and ")" in text
            if refs and len(set(refs)) == 1 and len(E["_lines"]) <= 2 and \
                    ((paren and words <= 5) or (E["kind"] in ("kicker", "furniture", "other_text", "jump_line") and words <= 3)):
                E["kind"] = "jump_line"
                E["_jump"] = "in" if refs[0] < self.pno else "out"
                E["_jump_page"] = refs[0]
            elif E["kind"] == "jump_line":
                E["_jump"] = None
        self.disp_owner, self.runin_owner = {}, {}
        for E in self.tx:
            tgt = self.runin_owner if E["_run_in"] else self.disp_owner
            for l in E["_lines"]:
                for i in l["idx"]:
                    tgt.setdefault(i, E)

    # ---------------------------------------------------------------- step 3a: split lines measure.py merged across columns
    def split_frames(self, frames):
        """measure.py sometimes joins the lines of neighbouring columns on one baseline (e.g. right under a box). Such a
        line's glyphs form several content-order runs that are x-disjoint with gaps >= SPLIT_GAP_MM: it is cut at the
        run boundaries. The piece inside the frame's measure (else the leftmost) keeps the line; the other pieces
        become lines of split frames "<frame>~<n>" (one per source frame and column). Inputs are not modified."""
        out, split, n_split = [], [], 0
        for f in frames:
            size = f["size_pt"] or self.body_size
            L0, R0 = f["column_left_mm"] * MM, f["right_edge_mm"] * MM
            new_lines, extra, changed = [], [], False
            for k, ln in enumerate(f["lines"]):
                x0 = min(t["x0"] for t in ln["tokens"])
                x1 = max(t["x1"] for t in ln["tokens"])
                idx = self.sel(ln["baseline_pt"], x0, x1, size)
                runs = []
                for i in idx:
                    if runs and self.pos[i] == self.pos[runs[-1][-1]] + 1:
                        runs[-1].append(i)
                    else:
                        runs.append([i])
                pieces = sorted(({"x0": min(self.G[i]["x0"] for i in r), "x1": max(self.G[i]["x1"] for i in r)} for r in runs),
                                key=lambda q: q["x0"])
                if len(pieces) < 2 or any(b["x0"] - a["x1"] < SPLIT_GAP_MM * MM for a, b in zip(pieces, pieces[1:])):
                    new_lines.append(ln)
                    continue
                n_split += 1
                changed = True
                inside = [q for q in pieces if L0 - OVERHANG_MM * MM <= (q["x0"] + q["x1"]) / 2 <= R0 + OVERHANG_MM * MM]
                keep = inside[0] if inside else pieces[0]
                for q in pieces:
                    toks = [t for t in ln["tokens"] if q["x0"] - 0.5 <= (t["x0"] + t["x1"]) / 2 <= q["x1"] + 0.5]
                    if not toks:
                        continue
                    m = dict(ln, tokens=toks, x0_mm=round(q["x0"] / MM, 4), x1_mm=round(q["x1"] / MM, 4),
                             flags=list(ln.get("flags", [])) + ["split_from_merged_columns"], class_measure=ln["class"])
                    if q is keep:
                        new_lines.append(m)
                    else:
                        m["break"] = None
                        m["split_of"] = f"{f['id']}:{k}"
                        extra.append(m)
            out.append(dict(f, lines=new_lines) if changed else f)
            groups = []
            for m in sorted(extra, key=lambda m: m["x0_mm"]):
                for g in groups:
                    if overlap(m["x0_mm"], m["x1_mm"], g["x0"], g["x1"]) > 0.5 * min(m["x1_mm"] - m["x0_mm"], g["x1"] - g["x0"]):
                        g["lines"].append(m)
                        g["x0"], g["x1"] = min(g["x0"], m["x0_mm"]), max(g["x1"], m["x1_mm"])
                        break
                else:
                    groups.append({"lines": [m], "x0": m["x0_mm"], "x1": m["x1_mm"]})
            for n, g in enumerate(groups, 1):
                split.append({"id": f"{f['id']}~{n}", "column_left_mm": g["x0"], "right_edge_mm": g["x1"],
                              "width_mm": round(g["x1"] - g["x0"], 4), "width_confidence": "SPLIT",
                              "is_body_candidate": f["is_body_candidate"], "font": f["font"], "size_pt": f["size_pt"],
                              "leading_pt": f["leading_pt"], "hscale_median": f["hscale_median"],
                              "nominal_space_pt": f.get("nominal_space_pt"),
                              "lines": sorted(g["lines"], key=lambda m: -m["baseline_pt"]), "split_from": f["id"]})
        self.n_split_lines = n_split
        return out + split

    def column_of(self, f, x0, x1, by):
        """Column measure (pt) of a line. A measure.py body frame keeps its own measure; promoted and split frames
        borrow the measure of the tightest measure.py body frame (DERIVED width) containing the line, nearest
        vertically; else their own measure when it contains the line; else the line's extent."""
        tol = OVERHANG_MM * MM
        own = (f["column_left_mm"] * MM, f["right_edge_mm"] * MM)
        if f["is_body_candidate"] and not f.get("split_from"):
            return own, False
        cands = []
        for g in self.ref_frames:
            L, R = g["column_left_mm"] * MM, g["right_edge_mm"] * MM
            if L - tol <= x0 and x1 <= R + tol:
                bys = [ln["baseline_pt"] for ln in g["lines"]]
                d = 0.0 if min(bys) <= by <= max(bys) else min(abs(by - min(bys)), abs(by - max(bys)))
                cands.append((R - L, d, g["id"], (L, R)))
        if cands:
            wmin = min(c[0] for c in cands)
            return min((c for c in cands if c[0] <= wmin + 2 * MM), key=lambda c: (c[1], c[2]))[3], True
        if own[0] - tol <= x0 and x1 <= own[1] + tol:
            return own, False
        return (x0, x1), True

    # ---------------------------------------------------------------- steps 3-4: body frames, fragments, promotion
    def body_lines(self):
        pg = self.pg
        self.mframes = self.split_frames([f for f in pg["frames"] if not f.get("excluded")])
        self.excluded_frames = [f for f in pg["frames"] if f.get("excluded")]
        body_fonts = {HL.base_font(f["font"]) for f in self.mframes if f["is_body_candidate"]} | {self.body_font}
        lo, hi = FRAG_BAND[0] * self.body_size, FRAG_BAND[1] * self.body_size
        self.mlines = {}
        all_lines = []
        for f in self.mframes:
            body_like = f["is_body_candidate"] or (HL.base_font(f["font"]) in body_fonts and lo <= (f["size_pt"] or 0) <= hi)
            f_lines = []
            for k, ln in enumerate(f["lines"]):
                x0 = min(t["x0"] for t in ln["tokens"])
                x1 = max(t["x1"] for t in ln["tokens"])
                size = f["size_pt"] or self.body_size
                idx = self.sel(ln["baseline_pt"], x0, x1, size)
                L = {"ref": f"{f['id']}:{k}", "f": f, "k": k, "by": ln["baseline_pt"], "x0": x0, "x1": x1, "size": size,
                     "idx": idx, "ntok": len(ln["tokens"]), "m": ln, "use": None, "el": None, "merged": [], "host": None,
                     "body_like": body_like}
                own = Counter(self.disp_owner[i]["id"] for i in idx if i in self.disp_owner)
                if idx and own and sum(own.values()) >= 0.5 * len(idx):
                    L["use"], L["el"] = "display", next(E for E in self.tx if E["id"] == own.most_common(1)[0][0])
                elif body_like:
                    L["use"] = "body"
                else:
                    L["use"] = "other"
                f_lines.append(L)
                all_lines.append(L)
            self.mlines[f["id"]] = f_lines
        # merge same-baseline fragments that continue a body line in content order (only whitespace between)
        n_merged = 0
        buckets = defaultdict(list)
        for L in all_lines:
            buckets[round(L["by"])].append(L)

        def same_line(L):
            out = []
            for b in (round(L["by"]) - 1, round(L["by"]), round(L["by"]) + 1):
                out += [M for M in buckets.get(b, []) if M is not L and abs(M["by"] - L["by"]) <= BASELINE_EM * max(M["size"], L["size"])]
            return out

        def adjacent(a, b):
            return bool(a["idx"] and b["idx"]) and (self.next_ink(a["idx"][-1]) == b["idx"][0] or self.next_ink(b["idx"][-1]) == a["idx"][0])

        def fits(a, b):
            """The union of two same-baseline lines fits the measure of a body-candidate frame of either; pieces of
            promoted frames (no measure of their own) fit when the gap between them is a word space, not a gutter."""
            for f in (b["f"], a["f"]):
                if f["is_body_candidate"] and min(a["x0"], b["x0"]) >= f["column_left_mm"] * MM - OVERHANG_MM * MM \
                        and max(a["x1"], b["x1"]) <= f["right_edge_mm"] * MM + OVERHANG_MM * MM:
                    return True
            gap = max(a["x0"], b["x0"]) - min(a["x1"], b["x1"])
            if gap > FRAG_GAP_MM * MM:
                return False
            if not (a["f"]["is_body_candidate"] or b["f"]["is_body_candidate"]):
                return True
            # a fragment of a non-body frame hanging past a body line's measure (glyphs set beyond the frame edge)
            host, frag = (a, b) if a["f"]["is_body_candidate"] else (b, a)
            over = max(host["f"]["column_left_mm"] * MM - min(a["x0"], b["x0"]),
                       max(a["x1"], b["x1"]) - host["f"]["right_edge_mm"] * MM)
            return not frag["f"]["is_body_candidate"] and over <= FRAG_GAP_MM * MM

        # run-in leads: a one-line display element (dateline, bold lead-in) on the same baseline as, and content-order
        # adjacent to, another line within one column measure is part of that printed line, not a separate line
        runin_ids = set()
        for L in all_lines:
            if L["use"] != "display" or len(L["el"]["_lines"]) != 1:
                continue
            for M in same_line(L):
                if M["use"] in ("body", "other") and adjacent(L, M) and fits(L, M):
                    runin_ids.add(L["el"]["id"])
                    L["use"], L["el"] = ("body" if L["body_like"] else "other"), None
                    break
        for E in self.tx:
            if E["id"] in runin_ids:
                E["_run_in"] = True
                for l in E["_lines"]:
                    for i in l["idx"]:
                        self.runin_owner.setdefault(i, E)

        # a line whose glyphs all lie inside another same-baseline body line (a run measure.py split off by size,
        # e.g. digits in another point size) is part of that line (headlines.py drops such duplicate atoms too)
        for c in sorted((L for L in all_lines if L["use"] in ("body", "other") and L["idx"]), key=lambda L: (len(L["idx"]), L["ref"])):
            cs = set(c["idx"])
            for h in sorted(same_line(c), key=lambda h: (-len(h["idx"]), h["ref"])):
                if h["use"] == "body" and h is not c and len(h["idx"]) > len(cs) and cs <= set(h["idx"]):
                    h["merged"] += [c["ref"]] + c["merged"]
                    c["use"], c["host"] = "merged", h
                    n_merged += 1
                    break
        changed = True
        while changed:
            changed = False
            for c in sorted((L for L in all_lines if L["use"] in ("body", "other") and L["idx"]), key=lambda L: L["idx"][0]):
                if c["use"] not in ("body", "other"):
                    continue
                hosts = sorted((h for h in same_line(c) if h["use"] == "body"),
                               key=lambda h: (not h["f"]["is_body_candidate"], -len(h["f"]["lines"]), h["x0"], h["ref"]))
                for h in hosts:
                    if not adjacent(h, c) or not fits(h, c):
                        continue
                    if c["use"] == "body":
                        # the host is the line whose own frame measure holds the union (else a body frame's line)
                        holds = [M for M in (h, c) if M["f"]["is_body_candidate"]
                                 and min(h["x0"], c["x0"]) >= M["f"]["column_left_mm"] * MM - OVERHANG_MM * MM
                                 and max(h["x1"], c["x1"]) <= M["f"]["right_edge_mm"] * MM + OVERHANG_MM * MM]
                        if holds == [c] or (not holds and c["f"]["is_body_candidate"] and not h["f"]["is_body_candidate"]):
                            h, c = c, h
                    h["idx"] = sorted(set(h["idx"]) | set(c["idx"]))
                    h["x0"], h["x1"] = min(h["x0"], c["x0"]), max(h["x1"], c["x1"])
                    h["ntok"] += c["ntok"]
                    h["merged"] += [c["ref"]] + c["merged"]
                    c["use"], c["host"] = "merged", h
                    n_merged += 1
                    changed = True
                    break
        self.n_merged = n_merged
        # lines a run-in dateline owns but that did not join a body line are that byline's own lines
        for L in all_lines:
            if L["use"] == "other":
                own = Counter(self.runin_owner[i]["id"] for i in L["idx"] if i in self.runin_owner)
                if own and sum(own.values()) >= 0.5 * len(L["idx"]):
                    L["use"], L["el"] = "display", next(E for E in self.tx if E["id"] == own.most_common(1)[0][0])
        # run-in status: the dateline's glyphs ended up inside body lines
        in_body = {i for L in all_lines if L["use"] == "body" for i in L["idx"]}
        for E in self.tx:
            if E["_run_in"]:
                idx = [i for l in E["_lines"] for i in l["idx"]]
                E["_run_in"] = bool(idx) and sum(1 for i in idx if i in in_body) >= 0.5 * len(idx)
        # elements: body frames (incl. promoted), other text from frames
        self.bframes, self.otext = [], []
        for f in self.mframes:
            ls = self.mlines[f["id"]]
            if any(L["use"] == "body" for L in ls) or (f["is_body_candidate"] and ls):
                E = {"id": "bf-" + f["id"], "kind": "body_frame", "_f": f, "_lines": ls,
                     "_promoted": None if f["is_body_candidate"] else "body-style lines outside measure.py body frames"}
                for L in ls:
                    L["bf"] = E
                self.bframes.append(E)
            others = [L for L in ls if L["use"] == "other"]
            if others:
                E = {"id": "ot-" + f["id"], "kind": "other_text", "_src": f["id"],
                     "_lines": [{"by": L["by"], "x0": L["x0"], "x1": L["x1"], "size": L["size"], "ntok": L["ntok"],
                                 "idx": L["idx"]} for L in others], "_reason": "measure frame not covered by a display record"}
                self.otext.append(E)
                for L in others:
                    L["el"] = E
        # column measure, left offset and class: kept from measure.py, re-derived (with measure.py's rules) for lines
        # that were merged, split, or belong to promoted / split frames (their own measure is just their extent)
        self.ref_frames = [f for f in self.mframes if f["is_body_candidate"] and f.get("width_confidence") == "DERIVED"
                           and not f.get("split_from")]
        for E in self.bframes:
            f = E["_f"]
            near = f.get("nominal_space_pt") or 0.25 * (f["size_pt"] or self.body_size)
            lead = f["leading_pt"] or 1.15 * (f["size_pt"] or self.body_size)
            ls = E["_lines"]
            for j, L in enumerate(ls):
                L["text_at"] = self.read_line(L["by"], L["x0"], L["x1"], L["size"])
                (Lp, Rp), borrowed = self.column_of(f, L["x0"], L["x1"], L["by"])
                L["Lpt"], L["Rpt"], L["borrowed"] = Lp, Rp, borrowed
                L["cls"] = L["m"]["class"]
                L["left_off"] = L["m"]["left_offset_mm"]
                reshaped = bool(L["merged"]) or "split_from_merged_columns" in L["m"].get("flags", ())
                if not (reshaped or borrowed):
                    continue
                L["left_off"] = round((L["x0"] - Lp) / MM, 4)
                slack = Rp - L["x1"]
                nxt = ls[j + 1] if j + 1 < len(ls) else None
                if -1.0 <= slack <= 0.25:
                    L["cls"] = "FULLY_ALIGNED"
                elif nxt is None or (nxt["x0"] - Lp) >= INDENT_EM * L["size"] or (L["by"] - nxt["by"]) > PARA_GAP * lead:
                    L["cls"] = "FINAL_PARAGRAPH_LINE"
                elif slack <= near:
                    L["cls"] = "NEAR_ALIGNED"
                else:
                    L["cls"] = "RAGGED"
        self.n_promoted = sum(1 for E in self.bframes if E["_promoted"])

    # ---------------------------------------------------------------- step 5: vector art and images
    def vector_elements(self):
        fr = self.fr
        objs = pdfium_objects(self.page)
        pd_paths = [path_data(o) for o in objs if o["type"] == PR.FPDF_PAGEOBJ_PATH]
        pairs, n_mn = pair_paths(pd_paths, self.mn_paths)
        self.checks["paths"] = {"pdfium": len(pd_paths), "pdfminer_nondegenerate": n_mn, "paired": len(pairs)}
        self.rules, self.boxes, self.graphics, self.images = [], [], [], []
        n_invisible = 0
        graphic_run = None
        k_path = 0
        for o in objs:
            if o["type"] == PR.FPDF_PAGEOBJ_IMAGE:
                d = image_data(o, self.page.raw)
                vis = d["vis"]
                if vis[2] - vis[0] <= 0.05 or vis[3] - vis[1] <= 0.05:
                    n_invisible += 1
                    continue
                self.images.append({"id": f"im-{len(self.images) + 1}", "kind": "image",
                                    "bbox": fr.box_from_pt(*vis), "full": fr.box_from_pt(*d["full"]),
                                    "pw": d["pw"], "ph": d["ph"], "cs": d["cs"], "hash": d["hash"],
                                    "recur": self.ctx["img_eds"].get(d["hash"], 0)})
                graphic_run = None
                continue
            if o["type"] == PR.FPDF_PAGEOBJ_SHADING:
                b = PR.FPDFPageObj_GetBounds
                l, bb, r, t = ctypes.c_float(), ctypes.c_float(), ctypes.c_float(), ctypes.c_float()
                if b(o["obj"], l, bb, r, t):
                    self.graphics.append({"id": f"gr-{len(self.graphics) + 1}", "kind": "graphic",
                                          "bbox": fr.box_from_pt(l.value, bb.value, r.value, t.value), "n_paths": 0,
                                          "shading": True, "colours": []})
                graphic_run = None
                continue
            p = pd_paths[k_path]
            q = pairs.get(k_path)
            k_path += 1
            if p["bbox"] is None or (not p["fill"] and not p["stroke"]):
                n_invisible += 1
                continue
            bx = p["bbox"]
            if p["clip"]:
                c = p["clip"]
                vis = (max(bx[0], c[0]), max(bx[1], c[1]), min(bx[2], c[2]), min(bx[3], c[3]))
                if vis[2] < vis[0] - 0.01 or vis[3] < vis[1] - 0.01:
                    n_invisible += 1
                    continue
            else:
                vis = bx
            scol = (q["scol"] if q else p["rgba_s"]) if p["stroke"] else None
            fcol = (q["fcol"] if q else p["rgba_f"]) if p["fill"] else None
            dash = q["dash"] if q else p["dash_pdfium"]
            kind, geo = self.classify_path(p)
            if kind == "rule":
                (x0, y0), (x1, y1), thick, filled = geo
                horiz = abs(y0 - y1) <= abs(x0 - x1)
                # clip the rule to its visible extent
                x0, x1 = max(min(x0, x1), vis[0]), min(max(x0, x1), vis[2])
                y0, y1 = max(min(y0, y1), vis[1]), min(max(y0, y1), vis[3])
                if horiz:
                    p0, p1 = (fr.x(x0), fr.y((y0 + y1) / 2)), (fr.x(x1), fr.y((y0 + y1) / 2))
                else:
                    p0, p1 = (fr.x((x0 + x1) / 2), fr.y(y1)), (fr.x((x0 + x1) / 2), fr.y(y0))
                sw_pt = thick if filled else p["sw"]
                self.rules.append({"id": f"ru-{len(self.rules) + 1}", "kind": "rule",
                                   "bbox": [min(p0[0], p1[0]), min(p0[1], p1[1]) - sw_pt / MM / 2,
                                            max(p0[0], p1[0]), max(p0[1], p1[1]) + sw_pt / MM / 2],
                                   "p0": p0, "p1": p1, "sw": sw_pt, "colour": fcol if filled else scol, "dash": dash,
                                   "orient": "h" if horiz else "v", "paired": q is not None})
                graphic_run = None
            elif kind == "box":
                self.boxes.append({"id": f"bx-{len(self.boxes) + 1}", "kind": "box", "bbox": fr.box_from_pt(*vis),
                                   "fill": fcol, "sw": p["sw"] if p["stroke"] else None, "stroke": scol, "dash": dash,
                                   "paired": q is not None})
                graphic_run = None
            else:
                b = fr.box_from_pt(*vis)
                cols = [c for c in (fcol, scol) if c]
                if graphic_run is not None and box_gap(graphic_run["bbox"], b) <= GRAPHIC_JOIN_MM:
                    graphic_run["bbox"] = union([graphic_run["bbox"], b])
                    graphic_run["n_paths"] += 1
                    for c in cols:
                        if c not in graphic_run["colours"] and len(graphic_run["colours"]) < 4:
                            graphic_run["colours"].append(c)
                else:
                    graphic_run = {"id": f"gr-{len(self.graphics) + 1}", "kind": "graphic", "bbox": b, "n_paths": 1,
                                   "shading": False, "colours": cols[:4]}
                    self.graphics.append(graphic_run)
        self.checks["paths"]["invisible_or_unpainted"] = n_invisible
        # panels: large boxes (story boundaries for headline ownership; ad candidates)
        self.panels = [b for b in self.boxes if area(b["bbox"]) >= PANEL_MIN_MM2
                       and min(b["bbox"][2] - b["bbox"][0], b["bbox"][3] - b["bbox"][1]) >= PANEL_MIN_SIDE_MM]

    def classify_path(self, p):
        segs = p["segs"]
        if any(t == PR.FPDF_SEGMENT_BEZIERTO for t, *_ in segs):
            return "graphic", None
        subs = []
        for t, X, Y, _c in segs:
            if t == PR.FPDF_SEGMENT_MOVETO or not subs:
                subs.append([])
            subs[-1].append((X, Y))
        if len(subs) != 1:
            return "graphic", None
        pts = []
        for q in subs[0]:
            if not pts or abs(q[0] - pts[-1][0]) > 0.01 or abs(q[1] - pts[-1][1]) > 0.01:
                pts.append(q)
        if len(pts) > 2 and abs(pts[0][0] - pts[-1][0]) <= 0.01 and abs(pts[0][1] - pts[-1][1]) <= 0.01:
            pts = pts[:-1]
        if len(pts) == 2:
            if p["stroke"]:
                return "rule", (pts[0], pts[1], p["sw"], False)
            return "graphic", None
        if len(pts) == 4:
            axis = all(abs(a[0] - b[0]) <= 0.01 or abs(a[1] - b[1]) <= 0.01 for a, b in zip(pts, pts[1:] + pts[:1]))
            if axis:
                xs, ys = [q[0] for q in pts], [q[1] for q in pts]
                w, h = (max(xs) - min(xs)) / MM, (max(ys) - min(ys)) / MM
                thick, long_ = min(w, h), max(w, h)
                if p["fill"] and not p["stroke"] and thick <= RULE_MAX_MM and long_ >= RULE_MIN_MM:
                    if w >= h:
                        y = (min(ys) + max(ys)) / 2
                        return "rule", ((min(xs), y), (max(xs), y), thick * MM, True)
                    x = (min(xs) + max(xs)) / 2
                    return "rule", ((x, min(ys)), (x, max(ys)), thick * MM, True)
                if p["stroke"] and not p["fill"] and thick <= 0.05 and long_ >= RULE_MIN_MM:
                    if w >= h:
                        y = (min(ys) + max(ys)) / 2
                        return "rule", ((min(xs), y), (max(xs), y), p["sw"], False)
                    x = (min(xs) + max(xs)) / 2
                    return "rule", ((x, min(ys)), (x, max(ys)), p["sw"], False)
                return "box", None
        return "graphic", None

    # ---------------------------------------------------------------- step 4 (end): residual glyphs
    def residual_text(self):
        owned = set()
        for E in self.tx + self.otext:
            for l in E["_lines"]:
                owned.update(l["idx"])
        for E in self.bframes:
            for L in E["_lines"]:
                if L["use"] in ("body", "display"):
                    owned.update(L["idx"])
        res = sorted((self.G[i] for i in self.ink if i not in owned), key=lambda g: (-g["by"], g["x0"]))
        groups = []
        for g in res:
            if groups and abs(g["by"] - groups[-1][0]["by"]) <= BASELINE_EM * g["size"]:
                groups[-1].append(g)
            else:
                groups.append([g])
        segs = []
        for grp in groups:
            # content-order runs first (text of different columns joined on one baseline), then gaps > 1 em
            runs = []
            for g in sorted(grp, key=lambda g: g["i"]):
                if runs and self.pos[g["i"]] == self.pos[runs[-1][-1]["i"]] + 1:
                    runs[-1].append(g)
                else:
                    runs.append([g])
            pieces = []
            for r in sorted(runs, key=lambda r: min(g["x0"] for g in r)):
                x0, x1 = min(g["x0"] for g in r), max(g["x1"] for g in r)
                if pieces and x0 - pieces[-1]["x1"] < SPLIT_GAP_MM * MM:
                    pieces[-1]["g"] += r
                    pieces[-1]["x1"] = max(pieces[-1]["x1"], x1)
                else:
                    pieces.append({"g": list(r), "x1": x1})
            for pc in pieces:
                cur, right = [], None
                for g in sorted(pc["g"], key=lambda g: (g["x0"], g["x1"])):
                    if cur and g["x0"] - right > 1.0 * max(g["size"], cur[-1]["size"]):
                        segs.append(cur)
                        cur, right = [], None
                    cur.append(g)
                    right = g["x1"] if right is None else max(right, g["x1"])
                if cur:
                    segs.append(cur)
        segs = [{"g": s, "by": st.median(g["by"] for g in s), "x0": min(g["x0"] for g in s), "x1": max(g["x1"] for g in s),
                 "font": Counter(HL.base_font(g["font"]) for g in s).most_common(1)[0][0],
                 "size": Counter(round(g["size"], 1) for g in s).most_common(1)[0][0]} for s in segs]
        segs.sort(key=lambda s: (-s["by"], s["x0"]))
        blocks = []
        for s in segs:
            best = None
            for b in blocks:
                p = b[-1]
                d = p["by"] - s["by"]
                ov = overlap(p["x0"], p["x1"], s["x0"], s["x1"])
                wb = max(q["x1"] - q["x0"] for q in b)          # the block's widest line so far
                ws = s["x1"] - s["x0"]
                aligned = ov >= 0.6 * max(wb, ws) or (abs(p["x0"] - s["x0"]) <= 3 * MM and ws <= 1.5 * wb)
                if p["font"] == s["font"] and abs(p["size"] - s["size"]) <= 0.3 and 0.5 * s["size"] <= d <= 2.5 * s["size"] \
                        and ov > 0 and aligned and (best is None or d < best[0]):
                    best = (d, b)
            if best:
                best[1].append(s)
            else:
                blocks.append([s])
        excl_idx = {}
        for f in self.excluded_frames:
            for ln in f["lines"]:
                x0, x1 = min(t["x0"] for t in ln["tokens"]), max(t["x1"] for t in ln["tokens"])
                for i in self.sel(ln["baseline_pt"], x0, x1, f["size_pt"]):
                    excl_idx[i] = f["id"]
        self.residual = []
        blocks.sort(key=lambda b: (-round(b[0]["by"], 1), b[0]["x0"]))
        for b in blocks:
            lines = []
            for s in b:
                toks = HL.tokens_of(s["g"])
                lines.append({"by": s["by"], "x0": s["x0"], "x1": s["x1"], "size": s["size"], "ntok": len(toks),
                              "idx": sorted(g["i"] for g in s["g"])})
            idx = [i for l in lines for i in l["idx"]]
            ex = Counter(excl_idx.get(i) for i in idx).most_common(1)[0][0]
            E = {"id": f"rt-{len(self.residual) + 1}", "kind": "other_text", "_lines": lines, "_src": "residual-glyphs",
                 "_reason": ("glyphs of measure frame " + ex + " (excluded by corrections)") if ex else "glyphs in no measure line",
                 "_excluded_src": ex}
            self.residual.append(E)
        self.n_residual_glyphs = len(res)

    # ---------------------------------------------------------------- text element finishing (text, style, kind tweaks)
    def finish_text(self, E):
        lines = []
        for l in E["_lines"]:
            at = self.read_line(l["by"], l["x0"], l["x1"], l["size"])
            ve = self.vext(l["idx"]) or (self.fr.y(l["by"]) - l["size"] / MM * 0.8, self.fr.y(l["by"]) + l["size"] / MM * 0.2)
            l["at"], l["top"], l["bot"] = at, ve[0], ve[1]
            lines.append(l)
        idx = sorted({i for l in lines for i in l["idx"]})
        gs = self.glyph_stats(idx)
        E["_idx"] = idx
        E["_text"] = " ".join(l["at"]["text"] for l in lines)
        E["bbox"] = [self.fr.x(min(l["x0"] for l in lines)), min(l["top"] for l in lines),
                     self.fr.x(max(l["x1"] for l in lines)), max(l["bot"] for l in lines)]
        rec = E.get("_rec")
        if rec:
            E["_font"], E["_size"], E["_hs"], E["_lead"], E["_align"] = rec["font"], rec["size_pt"], rec["hscale"], rec["leading_pt"], rec["alignment"]
            s0 = rec["span_x0_mm"] * MM
            E["_span"] = (self.fr.x(s0), self.fr.x(s0 + rec["span_width_mm"] * MM))
        else:
            E["_font"], E["_size"], E["_hs"] = gs["font"], gs["size"], gs["hs"]
            steps = [a["by"] - b["by"] for a, b in zip(lines, lines[1:])]
            E["_lead"] = round(st.median(steps), 3) if steps else None
            E["_align"] = HL.alignment({"lines": [{"x0": l["x0"], "x1": l["x1"]} for l in lines], "size": gs["size"] or 10,
                                        "hs": gs["hs"] or 1.0}, 0, 0)
            E["_span"] = (E["bbox"][0], E["bbox"][2])
        E["_col"] = gs["col"]
        E["_r"] = (E["_size"] or self.body_size) / self.body_size
        # nominal ink extent for vertical relations (headlines.py: 0.75 em above the first baseline, 0.25 em below the
        # last); glyph boxes come from font metrics and overlap neighbours for large Devanagari type
        em = (E["_size"] or self.body_size) / MM
        E["_ink_top"] = self.fr.y(lines[0]["by"]) - 0.75 * em
        E["_ink_bot"] = self.fr.y(lines[-1]["by"]) + 0.25 * em
        E["_base_bot"] = self.fr.y(lines[-1]["by"]) + HEAD_DESCENT_EM * em
        if E["kind"] == "other_text" and not E.get("_rec"):
            t = E["_text"]
            d = sum(ch.isdigit() or ch in "०१२३४५६७८९" for ch in t)
            a = sum(ch.isalpha() for ch in t)
            edge = FOOT_HEAD_SHARE * self.H
            if d and d >= a and (E["bbox"][3] <= 2 * edge or E["bbox"][1] >= self.H - 2 * edge):
                E["kind"] = "folio"
            elif len(self.ctx["recur"].get(t, ())) >= RECUR_EDITIONS:
                E["kind"] = "furniture"

    # ---------------------------------------------------------------- step 6: ads
    def detect_ads(self):
        for E in self.tx + self.otext + self.residual:
            self.finish_text(E)
        self.texts = self.tx + self.otext + self.residual
        for E in self.bframes:
            self.finish_body_frame(E)
        # page head = everything above the first line of a measure.py body frame (masthead, running head)
        body_tops = [L["top"] for E in self.bframes if not E["_promoted"] for L in E["_lines"] if L["use"] == "body"]
        self.first_body_top = min(body_tops) if body_tops else self.H
        house = self.ctx["house_fonts"]
        ads = []
        # (a) recurring image content outside the page head
        rec_imgs = [im for im in self.images if im["recur"] >= RECUR_EDITIONS and im["bbox"][1] >= self.first_body_top - 1.0]
        groups = []
        for im in sorted(rec_imgs, key=lambda m: (m["bbox"][1], m["bbox"][0])):
            for g in groups:
                if box_gap(g["bbox"], im["bbox"]) <= 1.0:
                    g["bbox"] = union([g["bbox"], im["bbox"]])
                    g["n"] += 1
                    g["eds"] = max(g["eds"], im["recur"])
                    break
            else:
                groups.append({"bbox": list(im["bbox"]), "n": 1, "eds": im["recur"]})
        for g in groups:
            if area(g["bbox"]) >= PANEL_MIN_MM2:
                ads.append({"bbox": g["bbox"], "reason": f"image content recurs in {g['eds']} editions "
                                                         f"({g['n']} image object(s)) outside the page head"})
        # (b) panels with no story text whose content is recurring furniture / non-house fonts / recurring images
        for p in self.panels:
            pb = p["bbox"]
            if pb[1] < self.first_body_top - 1.0:
                continue                                  # page head (masthead panel): furniture, not an ad
            n_body = sum(1 for E in self.bframes for L in E["_lines"] if L["use"] == "body" and contains(pb, centre(L["box"])))
            if n_body > 2:
                continue
            gl, rec_gl, nonhouse_gl = 0, 0, 0
            for E in self.texts:
                if inside_share(E["bbox"], pb) < 0.8:
                    continue
                n = len(E["_idx"])
                gl += n
                if E["kind"] == "furniture" or len(self.ctx["recur"].get(E["_text"], ())) >= RECUR_EDITIONS:
                    rec_gl += n
                nonhouse_gl += sum(1 for i in E["_idx"] if HL.base_font(self.G[i]["font"]) not in house)
            img_area = sum(area(inter(im["bbox"], pb)) for im in self.images if im["recur"] >= RECUR_EDITIONS)
            ev = []
            if gl and rec_gl >= AD_SHARE * gl:
                ev.append(f"{rec_gl / gl:.0%} of its text recurs in >= {RECUR_EDITIONS} editions")
            if gl and nonhouse_gl >= AD_SHARE * gl:
                ev.append(f"{nonhouse_gl / gl:.0%} of its text in non-house fonts")
            if img_area >= AD_SHARE * area(pb):
                ev.append("recurring images cover >= 50 % of it")
            if ev:
                ads.append({"bbox": list(pb), "reason": "panel without story text: " + "; ".join(ev)})
        # merge overlapping ad regions
        merged = []
        for a in sorted(ads, key=lambda a: (a["bbox"][1], a["bbox"][0])):
            for m in merged:
                if area(inter(m["bbox"], a["bbox"])) > 0.3 * min(area(m["bbox"]), area(a["bbox"])):
                    m["bbox"] = union([m["bbox"], a["bbox"]])
                    if a["reason"] not in m["reason"]:
                        m["reason"] += " | " + a["reason"]
                    break
            else:
                merged.append(dict(a))
        self.ads = []
        for k, a in enumerate(sorted(merged, key=lambda a: (round(a["bbox"][1], 1), a["bbox"][0]))):
            A = {"id": f"ad-{k + 1}", "kind": "ad", "bbox": a["bbox"], "reason": a["reason"], "parts": []}
            for E in self.texts + self.images + self.graphics + self.boxes + self.rules + self.bframes:
                if E.get("_ad") or E is A:
                    continue
                if inside_share(E["bbox"], A["bbox"]) >= 0.8 and not (E["kind"] == "box" and area(E["bbox"]) > 1.05 * area(A["bbox"])):
                    E["_ad"] = A["id"]
                    A["parts"].append(E["id"])
            self.ads.append(A)

    def finish_body_frame(self, E):
        f = E["_f"]
        near = f.get("nominal_space_pt") or 0.25 * (f["size_pt"] or self.body_size)
        for L in E["_lines"]:
            ve = self.vext(L["idx"]) or (self.fr.y(L["by"]) - L["size"] / MM * 0.8, self.fr.y(L["by"]) + L["size"] / MM * 0.2)
            L["top"], L["bot"], L["bl"] = ve[0], ve[1], self.fr.y(L["by"])
            L["ink_top"], L["ink_bot"] = L["bl"] - 0.75 * L["size"] / MM, L["bl"] + 0.25 * L["size"] / MM
            L["box"] = [self.fr.x(L["x0"]), ve[0], self.fr.x(L["x1"]), ve[1]]
            L["L"], L["R"] = self.fr.x(L["Lpt"]), self.fr.x(L["Rpt"])
            L["lead"] = (f["leading_pt"] or L["size"] * 1.15) / MM
            # line end: "final" ends a paragraph, "mid" continues it; measure.py labels a frame's last line FINAL
            # unless it is flush within 0.25 pt, so a frame-last FINAL line short by <= one space is "ambiguous"
            slack = L["Rpt"] - L["x1"]
            if L["cls"] != "FINAL_PARAGRAPH_LINE":
                L["end"] = "mid"
            elif L["k"] == len(f["lines"]) - 1 and slack <= near:
                L["end"] = "ambiguous"
            else:
                L["end"] = "final"
        tops = [L["top"] for L in E["_lines"]]
        bots = [L["bot"] for L in E["_lines"]]
        # the element's column measure: measure.py's for its body frames, else the measure most of its lines borrow
        borrowed = Counter((round(L["Lpt"], 2), round(L["Rpt"], 2)) for L in E["_lines"] if L["borrowed"])
        if borrowed and (not f["is_body_candidate"] or f.get("split_from")):
            E["_measure"], E["_measure_src"] = borrowed.most_common(1)[0][0], "borrowed"
        else:
            E["_measure"], E["_measure_src"] = (f["column_left_mm"] * MM, f["right_edge_mm"] * MM), "own"
        E["bbox"] = [self.fr.x(E["_measure"][0]), min(tops), self.fr.x(E["_measure"][1]), max(bots)]

    # ---------------------------------------------------------------- story grouping: units
    def units(self):
        self.owner = {}
        self.unit_of_line = {}
        self.units_of_el = defaultdict(list)
        for E in self.bframes:
            if E.get("_ad"):
                continue
            for L in E["_lines"]:
                if L["use"] == "body" and L["idx"]:
                    u = {"t": "body", "L": L, "first": L["idx"][0], "last": L["idx"][-1]}
                    self.unit_of_line[L["ref"]] = u
                    for i in L["idx"]:
                        self.owner.setdefault(i, u)
        for E in sorted(self.texts, key=lambda E: E["id"]):
            for k, l in enumerate(E["_lines"]):
                if not l["idx"]:
                    continue
                u = {"t": "text", "E": E, "k": k, "first": l["idx"][0], "last": l["idx"][-1]}
                self.units_of_el[E["id"]].append(u)
                for i in l["idx"]:
                    self.owner.setdefault(i, u)

    def succ(self, u):
        k, n = self.pos[u["last"]] + 1, 0
        while k < len(self.ink):
            o = self.owner.get(self.ink[k])
            if o is not None and o is not u:
                return o
            if o is None:
                n += 1
                if n > SKIP_STRAY:
                    return None
            k += 1
        return None

    def pred(self, u):
        k, n = self.pos[u["first"]] - 1, 0
        while k >= 0:
            o = self.owner.get(self.ink[k])
            if o is not None and o is not u:
                return o
            if o is None:
                n += 1
                if n > SKIP_STRAY:
                    return None
            k -= 1
        return None

    # ---------------------------------------------------------------- story grouping: blocks and threads
    def runin_start(self, L):
        return any(i in self.runin_owner and self.runin_owner[i]["_run_in"] for i in L["idx"][:12])

    def inflow_ok(self, u, A, B):
        """May display unit u sit inside a text flow between body line A (above/before) and body line B (after)?"""
        E = u["E"]
        if E.get("_ad") or E["kind"] not in INFLOW_KINDS or len(E["_lines"]) > 3:
            return False
        if E["_r"] >= SMALLHEAD_R:
            return False
        if not (is_bold(E["_font"], self.ctx["display_fonts"]) or not black(cmyk_of(E["_col"])) or E["kind"] == "crosshead"):
            return False
        if B is not None and self.runin_start(B):
            return False                                  # a brief headline: the next paragraph opens with a dateline
        x0, x1 = E["bbox"][0], E["bbox"][2]
        w = max(0.1, x1 - x0)

        def near(L, below):
            if overlap(x0, x1, L["L"], L["R"]) < 0.5 * w:
                return False
            dy = (E["_ink_top"] - L["ink_bot"]) if below else (L["ink_top"] - E["_ink_bot"])
            return -0.5 * L["lead"] <= dy <= INFLOW_REACH * L["lead"]
        return (A is not None and near(A, True)) or (B is not None and near(B, False))

    def walk(self, start, target_ok):
        """From body unit `start`, follow content-order successors through in-flow display units; returns
        (body unit reached or None, [display units passed])."""
        u, passed = self.succ(start), []
        while u is not None and u["t"] == "text" and len({p["E"]["id"] for p in passed} | {u["E"]["id"]}) <= INFLOW_MAX:
            passed.append(u)
            u = self.succ(u)
        if u is None or u["t"] != "body":
            return None, []
        if passed and not all(self.inflow_ok(p, start["L"], u["L"]) for p in passed):
            return None, []
        if not target_ok(u):
            return None, []
        return u, passed

    def threads(self):
        self.big_heads = [h for h in self.heads_all if h["_r"] >= SMALLHEAD_R]
        self.all_body_lines = [L for E in self.bframes if not E.get("_ad") for L in E["_lines"] if L["use"] == "body"]
        self.n_cut = 0
        blocks = []
        for E in self.bframes:
            if E.get("_ad"):
                continue
            ls = sorted((L for L in E["_lines"] if L["use"] == "body" and L["ref"] in self.unit_of_line), key=lambda L: -L["by"])
            cur = None
            for L in ls:
                if cur is not None:
                    prev = cur["items"][-1][1] if cur["items"][-1][0] == "line" else None
                    reached, passed = self.walk(self.unit_of_line[prev["ref"]], lambda v, L=L: v["L"] is L)
                    if reached is not None and (self.attribution(prev) or (L["bl"] - prev["bl"] > 2 * L["lead"] and
                                                                          self.story_boundary(cur["items"][0][1], prev, L))):
                        reached = None
                        self.n_cut += 1
                    if reached is not None:
                        if passed:
                            cur["items"].append(("xh", passed))
                        cur["items"].append(("line", L))
                        continue
                    blocks.append(cur)
                cur = {"items": [("line", L)]}
            if cur:
                blocks.append(cur)
        first_of = {}
        for b in blocks:
            b["first"] = b["items"][0][1]
            b["last"] = b["items"][-1][1]
            b["next"] = b["prev"] = None
            first_of[b["first"]["ref"]] = b
        for b in sorted(blocks, key=lambda b: b["last"]["idx"][-1]):
            # governing head: the block's own geometric head, else the one inherited along its chain (blocks under
            # a rule-boxed quote have no head of their own)
            own = self.geo_heads(b["first"], self.big_heads)
            b["ghead"] = own[0] if own else (b["prev"]["ghead"] if b["prev"] is not None else None)
            reached, passed = self.walk(self.unit_of_line[b["last"]["ref"]],
                                        lambda v: v["L"]["ref"] in first_of and first_of[v["L"]["ref"]]["prev"] is None
                                        and first_of[v["L"]["ref"]] is not b)
            if reached is not None and self.story_boundary(b["first"], b["last"], reached["L"], True, b["ghead"]):
                reached = None
                self.n_cut += 1
            if reached is not None:
                nb = first_of[reached["L"]["ref"]]
                b["next"], nb["prev"], b["link"] = nb, b, passed
        self.threads_ = []
        for b in sorted(blocks, key=lambda b: b["first"]["idx"][0]):
            if b["prev"] is not None:
                continue
            items, nblocks, cur = [], 0, b
            while cur is not None:
                items += cur["items"]
                nblocks += 1
                if cur["next"] is not None and cur.get("link"):
                    items.append(("xh", cur["link"]))
                cur = cur["next"]
            lines = [it[1] for it in items if it[0] == "line"]
            T = {"items": items, "lines": lines, "first": lines[0], "last": lines[-1], "n_blocks": nblocks}
            self.threads_.append(T)
        # in-flow display units become crossheads
        self.inflow = {}
        for T in self.threads_:
            for it in T["items"]:
                if it[0] == "xh":
                    for u in it[1]:
                        E = u["E"]
                        if E["kind"] != "crosshead":
                            E["_kind_was"], E["kind"] = E["kind"], "crosshead"
                            E["_kind_reason"] = "inside a content-order text flow between body blocks (in-flow heading)"
                        self.inflow[E["id"]] = T
        self.checks["threads"] = {"blocks": len(blocks), "threads": len(self.threads_),
                                  "block_links": sum(1 for b in blocks if b["next"] is not None),
                                  "links_cut_at_story_boundary": self.n_cut, "lines_split": self.n_split_lines}

    # ---------------------------------------------------------------- story grouping: heads -> stories
    def prepare_heads(self):
        """Headline elements (not ad parts); stacked "S" headline paragraphs join the head above them."""
        heads = [E for E in self.texts if E["kind"] == "headline" and not E.get("_ad")]
        parts = defaultdict(list)
        for E in [h for h in heads if h.get("_rec") and h["_rec"]["role_reason"].startswith("S ")]:
            above = [h for h in heads if h is not E and h["_ink_bot"] <= E["_ink_top"] + 1.0
                     and E["_ink_top"] - h["_ink_bot"] <= 1.5 * max(h["_size"], E["_size"]) / MM
                     and overlap(h["bbox"][0], h["bbox"][2], E["bbox"][0], E["bbox"][2]) > 0]
            if above:
                h = max(above, key=lambda h: h["_ink_bot"])
                parts[h["id"]].append(E)
                E["_part_of"] = h
        heads = [h for h in heads if "_part_of" not in h]
        for E in sorted(heads, key=lambda E: E["bbox"][1]):
            w = max(0.1, E["bbox"][2] - E["bbox"][0])
            for h in heads:
                if h is E or E["_size"] > SUBHEAD_RATIO * h["_size"] or "_sub_of" in h:
                    continue
                if overlap(E["bbox"][0], E["bbox"][2], h["_span"][0], h["_span"][1]) < 0.8 * w:
                    continue
                reach = 1.5 * max(E["_size"], self.body_size) / MM + 4.0
                below, above = E["_ink_top"] - h["_ink_bot"], h["_ink_top"] - E["_ink_bot"]
                if -1.0 <= below <= reach:
                    y0, y1, where = h["_ink_bot"], E["_ink_top"], "under"
                elif -1.0 <= above <= reach:
                    y0, y1, where = E["_ink_bot"], h["_ink_top"], "above"
                else:
                    continue
                if any(G is not E and G is not h and G["_ink_top"] >= y0 - 0.3 and G["_ink_bot"] <= y1 + 0.3
                       and overlap(G["bbox"][0], G["bbox"][2], E["bbox"][0], E["bbox"][2]) > 0 for G in self.texts):
                    continue
                E["_sub_of"] = h
                E["_kind_was"], E["kind"] = E["kind"], "deck"
                E["_kind_reason"] = f"smaller heading directly {where} a larger headline, within its span"
                break
        heads = [h for h in heads if "_sub_of" not in h]
        for h in heads:
            h["_parts"] = sorted(parts.get(h["id"], []), key=lambda E: E["bbox"][1])
            # last baseline + a small descent: Devanagari display type descends little below its baseline, and a
            # nominal 0.25 em would reach into the first body line under very large headlines
            h["_bottom"] = max([h["_base_bot"]] + [p["_base_bot"] for p in h["_parts"]])
        self.heads_all = heads
        self.hrules = [r for r in self.rules if r["orient"] == "h"]

    def panel_set(self, pt):
        return frozenset(p["id"] for p in self.panels if contains(p["bbox"], pt, 0.5))

    def geo_heads(self, L, heads, panels=True):
        """Heads that may own body line L geometrically (span covers >= 50 % of its column, above it, same panels,
        no horizontal rule across the column in between), nearest first."""
        cw = max(0.1, L["R"] - L["L"])
        out = []
        for h in heads:
            s0, s1 = h["_span"]
            if overlap(s0, s1, L["L"], L["R"]) < HEAD_COVER * cw:
                continue
            if h["_bottom"] > L["ink_top"] + 1.0:
                continue
            if panels and self.panel_set(centre(h["bbox"])) != self.panel_set(centre(L["box"])):
                continue
            if any(h["_bottom"] - 1.0 <= r["p0"][1] <= L["ink_top"] + 0.5
                   and overlap(min(r["p0"][0], r["p1"][0]), max(r["p0"][0], r["p1"][0]), L["L"], L["R"]) >= 0.5 * cw
                   for r in self.hrules):
                continue
            out.append(((-h["_bottom"], -overlap(s0, s1, L["L"], L["R"]), h["id"]), h))
        return [h for _, h in sorted(out, key=lambda kh: kh[0])]

    def attribution(self, L):
        """A dash-led short line set off from the column's left edge (right-aligned or indented >= 1 em), no digits:
        the attribution that closes a quote / statement block (headlines.py B2 rule, on a body line)."""
        t = L["text_at"]["text"].strip()
        if len(t) < 3 or t[0] not in DASHES or not t[1:].strip()[:1].isalpha() or len(t.split()) > 10:
            return False
        if any(ch.isdigit() or ch in "०१२३४५६७८९" for ch in t):
            return False
        em = L["size"] / MM
        flush_right = L["cls"] in ("FULLY_ALIGNED", "NEAR_ALIGNED")
        return L["left_off"] >= 1.0 * em or (flush_right and L["left_off"] >= 0.25 * em)

    def story_boundary(self, A_first, A_last, B_first, ha_given=False, ha=None):
        """Does the content-order link from block A to block B cross a story boundary? Yes when A ends with a quote
        attribution. Otherwise only if A's governing head and B's geometric head differ, and then when: B is the first
        body line under its headline and that headline lies below A's last line (a story never continues under another
        story's headline); or a horizontal rule across A's column lies between A and B (B below A); or the text breaks
        between paragraphs (A ends a paragraph, B starts one: indented, run-in dateline, or first line under its head)
        with two different heads, or with a head on one side only while B starts below A's last line."""
        if self.attribution(A_last):
            return True                                   # a quote block ends with its attribution
        big = self.big_heads
        if not ha_given:
            ga = self.geo_heads(A_first, big)
            ha = ga[0] if ga else None
        gb = self.geo_heads(B_first, big)
        hb = gb[0] if gb else None
        if ha is hb:
            return False
        # B is the first body line under another headline that lies below A's last line: a story never continues
        # under another story's headline (modular layout), even mid-paragraph
        if hb is not None and hb["_ink_top"] > A_last["bl"] and self.top_under(B_first, hb):
            return True
        # a horizontal rule across A's column below A's last line closes A (rule-boxed quotes, sidebars)
        cw = max(0.1, A_last["R"] - A_last["L"])
        if B_first["ink_top"] > A_last["ink_bot"] and any(
                A_last["ink_bot"] - 0.5 <= r["p0"][1] <= B_first["ink_top"] + 0.5
                and overlap(min(r["p0"][0], r["p1"][0]), max(r["p0"][0], r["p1"][0]), A_last["L"], A_last["R"]) >= 0.5 * cw
                for r in self.hrules):
            return True
        if A_last["end"] == "mid":
            return False
        # B starts a paragraph: indented, opening with a run-in dateline, or the first body line under its headline
        starts = self.indented(B_first) or self.runin_start(B_first) or (hb is not None and self.top_under(B_first, hb))
        if not starts:
            return False
        if ha is not None and hb is not None:
            return True
        return B_first["ink_top"] > A_last["ink_bot"]

    def top_under(self, L, h):
        """No other body line lies in L's column between head h and L."""
        return not any(abs(M["L"] - L["L"]) <= COL_TOL_MM and h["_bottom"] < M["bl"] < L["bl"] - 0.5
                       for M in self.all_body_lines)

    def stories(self):
        heads = [h for h in self.heads_all if h["id"] not in self.inflow]

        def geo_heads(T):
            """Heads of a thread: each column's first line votes for its nearest geometric head, weighted by the
            column's lines (a body may start under a photo beside its headline); then nearest to the first line."""
            votes, order, prev = Counter(), {}, None
            for L in T["lines"]:
                if prev is None or abs(L["L"] - prev["L"]) > COL_TOL_MM or L["bl"] < prev["bl"] - 0.5:
                    gs = self.geo_heads(L, heads)
                    cur = gs[0] if gs else None
                    if cur is not None:
                        order.setdefault(cur["id"], (len(order), cur))
                if cur is not None:
                    votes[cur["id"]] += 1
                prev = L
            first = self.geo_heads(T["first"], heads)
            rank = {h["id"]: k for k, h in enumerate(first)}
            return [order[k][1] for k in sorted(votes, key=lambda k: (-votes[k], rank.get(k, 99), order[k][0]))]

        cluster_kinds = {"deck", "kicker", "byline", "headline", "jump_line"}
        head_ids = {h["id"] for h in heads}

        def content_heads(T):
            out = {}
            fu, lu = self.unit_of_line[T["first"]["ref"]], self.unit_of_line[T["last"]["ref"]]
            for start, step, how in ((fu, self.pred, "before"), (lu, self.succ, "after")):
                u, k = step(start), 0
                while u is not None and u["t"] == "text" and k < 6:
                    E = u["E"]
                    if E["kind"] == "headline" and E["id"] in head_ids:
                        out[E["id"]] = how
                        break
                    if E.get("_part_of") is not None:
                        out[E["_part_of"]["id"]] = how
                        break
                    if E["kind"] not in cluster_kinds:
                        break
                    u, k = step(u), k + 1
            return out

        by_head = defaultdict(list)
        headless = []
        for T in self.threads_:
            T["geo"], T["content"] = geo_heads(T), content_heads(T)
        # a head is strongly claimed by a thread for which it is the nearest geometric head AND a content neighbour
        claimed = defaultdict(set)
        for k, T in enumerate(self.threads_):
            if T["geo"] and T["geo"][0]["id"] in T["content"]:
                claimed[T["geo"][0]["id"]].add(k)
        for k, T in enumerate(self.threads_):
            gs, c = T["geo"], T["content"]
            # the nearest geometric head, unless another thread strongly claims it and a farther geometric
            # candidate is this thread's content-order neighbour
            g = gs[0] if gs else None
            if g is not None and g["id"] not in c and claimed.get(g["id"], set()) - {k}:
                g = next((h for h in gs[1:] if h["id"] in c), g)
            if g is not None:
                T["head"], T["evidence"] = g, ("geo+content" if g["id"] in c else "geo")
                if c and g["id"] not in c:
                    T["conflict"] = sorted(c)
            elif c:
                cands = [h for h in heads if h["id"] in c and overlap(h["_span"][0], h["_span"][1],
                         min(L["L"] for L in T["lines"]) - 5, max(L["R"] for L in T["lines"]) + 5) > 0]
                if cands:
                    T["head"], T["evidence"] = sorted(cands, key=lambda h: h["id"])[0], "content"
                else:
                    T["head"], T["evidence"] = None, "none"
            else:
                T["head"], T["evidence"] = None, "none"
            if T["head"] is not None:
                by_head[T["head"]["id"]].append(T)
            else:
                headless.append(T)
        heads_by_id = {h["id"]: h for h in heads}
        stories = []
        for hid in sorted(by_head, key=lambda k: (heads_by_id[k]["bbox"][1], heads_by_id[k]["bbox"][0])):
            h = heads_by_id[hid]
            ts = by_head[hid]
            main = max(ts, key=lambda T: (len(T["lines"]), hid in T["content"], -T["first"]["idx"][0]))
            S = {"head": h, "threads": [main], "evidence": main["evidence"], "parent": None, "reasons": []}
            if main.get("conflict"):
                S["reasons"].append("content order also links this flow to another headline")
            stories.append(S)
            order = sorted((T for T in ts if T is not main), key=lambda T: (round(T["first"]["L"]), T["first"]["top"]))
            before = [T for T in order if T["first"]["L"] < main["first"]["L"] - COL_TOL_MM
                      or (abs(T["first"]["L"] - main["first"]["L"]) <= COL_TOL_MM and T["first"]["bl"] < main["first"]["bl"])]
            after = [T for T in order if T not in before]
            for T in reversed(before):
                if self.ends_mid(T["last"]) or not self.indented(S["threads"][0]["first"]):
                    S["threads"].insert(0, T)
                    S["reasons"].append("another content-order thread joined before (paragraph continuity)")
                else:
                    stories.append({"head": None, "threads": [T], "evidence": "none", "parent": S, "reasons":
                                    ["separate text flow under this headline (pull quote / sidebar)"]})
            for T in after:
                if self.continues(S, T):
                    S["threads"].append(T)
                    S["reasons"].append("another content-order thread joined after (paragraph continuity)")
                else:
                    stories.append({"head": None, "threads": [T], "evidence": "none", "parent": S, "reasons":
                                    ["separate text flow under this headline (pull quote / sidebar)"]})
            if any(hid in T["content"] for T in S["threads"]):
                S["evidence"] = "geo+content" if any(T["evidence"].startswith("geo") for T in S["threads"]) else "content"
        head_story = {S["head"]["id"]: S for S in stories if S["head"] is not None}
        for T in sorted(headless, key=lambda T: (T["first"]["L"], T["first"]["top"])):
            host = None
            if not self.indented(T["first"]):
                for S in stories:
                    last = S["threads"][-1]["last"]
                    if self.ends_mid(last) and 0 <= T["first"]["L"] - last["R"] <= 12.0 and not S.get("parent"):
                        host = S
                        break
            if host is not None:
                host["threads"].append(T)
                host["reasons"].append("headless thread joined as continuation (mid-paragraph start)")
                continue
            # a flow inside a panel (boxed pull quote, fact box) under a headline outside it: child of that story
            parent = next((head_story[h["id"]] for h in self.geo_heads(T["first"], heads, panels=False)
                           if h["id"] in head_story), None)
            if parent is not None:
                stories.append({"head": None, "threads": [T], "evidence": "none", "parent": parent, "reasons":
                                ["separate (boxed) text flow under this headline (pull quote / sidebar)"]})
                continue
            # else a content-order neighbour of a headed story's flow (quote drawn just before / after it)
            line_story = {L["ref"]: S2 for S2 in stories if S2["head"] is not None for T2 in S2["threads"] for L in T2["lines"]}
            nb = [self.succ(self.unit_of_line[T["last"]["ref"]]), self.pred(self.unit_of_line[T["first"]["ref"]])]
            parent = next((line_story[u["L"]["ref"]] for u in nb if u is not None and u["t"] == "body"
                           and u["L"]["ref"] in line_story), None)
            if parent is not None:
                stories.append({"head": None, "threads": [T], "evidence": "none", "parent": parent, "reasons":
                                ["separate text flow drawn next to this story's flow (pull quote / sidebar)"]})
            else:
                stories.append({"head": None, "threads": [T], "evidence": "none", "parent": None, "reasons": []})
        self.stories_ = stories
        self.attach()

    def indented(self, L):
        return L["left_off"] >= INDENT_EM * L["size"] / MM

    def ends_mid(self, L):
        return L["end"] == "mid"

    def continues(self, S, T):
        last = S["threads"][-1]["last"]
        if not (self.ends_mid(last) or not self.indented(T["first"])):
            return False
        right = T["first"]["L"] >= last["R"] - 1.0
        below = abs(T["first"]["L"] - last["L"]) <= COL_TOL_MM and T["first"]["ink_top"] >= last["ink_bot"] - 1.0
        return right or below

    # ---------------------------------------------------------------- attachments
    def attach(self):
        S_all = self.stories_
        for S in S_all:
            S["lines"] = [L for T in S["threads"] for L in T["lines"]]
            S["cols_box"] = union([L["box"] for L in S["lines"]])
            S["decks"], S["kicker"], S["byline"], S["captions"], S["images"], S["jumps"], S["others"] = [], None, None, [], [], [], []
            S["extra_bylines"] = []
            h = S["head"]
            S["region"] = union([S["cols_box"]] + ([h["bbox"]] + [p["bbox"] for p in h["_parts"]] if h else []))
        used = set()
        for S in S_all:
            if S["head"]:
                used.add(S["head"]["id"])
                used.update(p["id"] for p in S["head"]["_parts"])
        for E in self.texts:
            if E["id"] in self.inflow:
                used.add(E["id"])
        heads = {S["head"]["id"]: S for S in S_all if S["head"]}
        avail = lambda E: not E.get("_ad") and E["id"] not in used  # noqa: E731
        hrules = [r for r in self.rules if r["orient"] == "h"]

        def clear(y_top, y_bot, x0, x1, skip=()):
            """Nothing printed between y_top and y_bot over [x0, x1]: no horizontal rule, no other text element."""
            w = max(0.1, x1 - x0)
            if y_bot - y_top <= 0.3:
                return True
            for r in hrules:
                if y_top + 0.3 < r["p0"][1] < y_bot - 0.3 and overlap(min(r["p0"][0], r["p1"][0]), max(r["p0"][0], r["p1"][0]), x0, x1) >= 0.3 * w:
                    return False
            for E in self.texts:
                if E["id"] in skip or E.get("_ad"):
                    continue
                if E["_ink_top"] >= y_top - 0.3 and E["_ink_bot"] <= y_bot + 0.3 and overlap(E["bbox"][0], E["bbox"][2], x0, x1) >= 0.3 * w:
                    return False
            return True

        def cluster(h):
            """Ids of display elements adjacent to head h in content order (its decks / kicker / byline)."""
            out = set()
            us = self.units_of_el.get(h["id"], [])
            if not us:
                return out
            for step, start in ((self.pred, us[0]), (self.succ, us[-1])):
                u, k = step(start), 0
                while u is not None and u["t"] == "text" and k < 6 and u["E"]["kind"] in ("deck", "kicker", "byline", "jump_line"):
                    out.add(u["E"]["id"])
                    u, k = step(u), k + 1
            return out

        # decks
        for E in sorted((E for E in self.texts if E["kind"] == "deck" and avail(E)), key=lambda E: E["id"]):
            best = None
            for S in heads.values():
                h = S["head"]
                ov = overlap(E["bbox"][0], E["bbox"][2], h["_span"][0], h["_span"][1])
                w = E["bbox"][2] - E["bbox"][0]
                gap_below = E["_ink_top"] - h["_bottom"]
                under = [L["ink_top"] for L in S["lines"] if overlap(L["L"], L["R"], E["bbox"][0], E["bbox"][2]) > 0]
                below = -1.0 <= gap_below <= 2.5 * max(h["_size"], E["_size"]) / MM + 2.0 \
                    and (not under or E["_ink_bot"] <= min(under) + 2.0)
                gap_above = h["_ink_top"] - E["_ink_bot"]
                strap = -1.0 <= gap_above <= 1.5 * E["_size"] / MM + 2.0
                skip = {E["id"], h["id"]} | {d["id"] for d in S["decks"]}
                below = below and clear(h["_bottom"], E["_ink_top"], E["bbox"][0], E["bbox"][2], skip)
                strap = strap and clear(E["_ink_bot"], h["_ink_top"], E["bbox"][0], E["bbox"][2], skip)
                score = None
                if E["id"] in cluster(h):
                    score = 0.0
                elif ov >= 0.5 * w and (below or strap):
                    score = abs(gap_below) if below else abs(gap_above)
                if score is not None and (best is None or score < best[0]):
                    best = (score, S)
            if best:
                best[1]["decks"].append(E)
                used.add(E["id"])
        # kickers (jump labels above a headline are jump lines)
        for E in sorted((E for E in self.texts if E["kind"] == "kicker" and avail(E)), key=lambda E: E["id"]):
            best = None
            for S in heads.values():
                h = S["head"]
                top = min([h["_ink_top"]] + [d["_ink_top"] for d in S["decks"] if d["_ink_bot"] <= h["_ink_top"] + 1])
                gap = top - E["_ink_bot"]
                w = E["bbox"][2] - E["bbox"][0]
                if -1.0 <= gap <= E["_size"] / MM + 4.0 and overlap(E["bbox"][0], E["bbox"][2], h["_span"][0], h["_span"][1]) >= 0.5 * w \
                        and clear(E["_ink_bot"], top, E["bbox"][0], E["bbox"][2], {E["id"], h["id"]} | {d["id"] for d in S["decks"]}):
                    if best is None or gap < best[0]:
                        best = (gap, S)
            if best and best[1]["kicker"] is None:
                best[1]["kicker"] = E
                used.add(E["id"])
        # run-in leads (datelines, bold lead-ins) are printed inside a flow line: the story's byline when they open
        # its first line (<= 4 words), else another element of the story
        line_story = {L["ref"]: S for S in S_all for L in S["lines"]}
        for E in sorted((E for E in self.texts if E.get("_run_in") and avail(E)), key=lambda E: E["id"]):
            hit = Counter()
            for i in E["_idx"]:
                u = self.owner.get(i)
                if u is not None and u["t"] == "body" and u["L"]["ref"] in line_story:
                    hit[u["L"]["ref"]] += 1
            if not hit:
                continue
            ref = min(hit, key=lambda r: (-hit[r], r))
            S = line_story[ref]
            E["_run_in_line"] = ref
            if ref == S["lines"][0]["ref"] and len(E["_text"].split()) <= 4 and S["byline"] is None:
                if E["kind"] != "byline":
                    E["_kind_was"], E["kind"] = E["kind"], "byline"
                    E["_kind_reason"] = "run-in lead opening the story's first line (dateline)"
                S["byline"] = E
            else:
                S["others"].append(E)
            used.add(E["id"])
        # other bylines: content-order neighbour of the flow, else directly above / below it in its column
        for E in sorted((E for E in self.texts if E["kind"] == "byline" and avail(E)), key=lambda E: E["id"]):
            S = None
            us = self.units_of_el.get(E["id"], [])
            for S2 in S_all:
                fu = self.unit_of_line[S2["lines"][0]["ref"]]
                lu = self.unit_of_line[S2["lines"][-1]["ref"]]
                if us and (self.pred(fu) is us[-1] or self.succ(lu) is us[0]):
                    S = S2
                    break
            if S is None:
                for S2 in S_all:
                    for L in (S2["lines"][0], S2["lines"][-1]):
                        if overlap(E["bbox"][0], E["bbox"][2], L["L"], L["R"]) >= 0.5 * (E["bbox"][2] - E["bbox"][0]) and \
                                (-0.5 <= L["ink_top"] - E["_ink_bot"] <= 2 * L["lead"] or -0.5 <= E["_ink_top"] - L["ink_bot"] <= 2 * L["lead"]):
                            S = S2
                            break
                    if S is not None:
                        break
            if S is not None:
                if S["byline"] is None:
                    S["byline"] = E
                else:
                    S["extra_bylines"].append(E)
                used.add(E["id"])
        # jump lines: directly below the flow's last line / above its first line or headline (geometry first: a jump
        # label can head a whole continuation column and be drawn after it), else a content-order neighbour
        for E in sorted((E for E in self.texts if E["kind"] == "jump_line" and avail(E)), key=lambda E: E["id"]):
            us = self.units_of_el.get(E["id"], [])
            hit, best = None, None
            w = E["bbox"][2] - E["bbox"][0]
            for S in S_all:
                first, last = S["lines"][0], S["lines"][-1]
                cands = []
                if overlap(E["bbox"][0], E["bbox"][2], last["L"], last["R"]) >= 0.5 * w and \
                        -0.5 <= E["_ink_top"] - last["ink_bot"] <= 3 * last["lead"]:
                    cands.append((E["_ink_top"] - last["ink_bot"], "out"))
                if overlap(E["bbox"][0], E["bbox"][2], first["L"], first["R"]) >= 0.5 * w and \
                        -0.5 <= first["ink_top"] - E["_ink_bot"] <= 3 * first["lead"]:
                    cands.append((first["ink_top"] - E["_ink_bot"], "in"))
                if S["head"] is not None:
                    h = S["head"]
                    top = min([h["_ink_top"]] + ([S["kicker"]["_ink_top"]] if S["kicker"] else []))
                    if overlap(E["bbox"][0], E["bbox"][2], h["_span"][0], h["_span"][1]) >= 0.5 * w and -1.0 <= top - E["_ink_bot"] <= 12.0 \
                            and clear(E["_ink_bot"], top, E["bbox"][0], E["bbox"][2], {E["id"], h["id"]}):
                        cands.append((top - E["_ink_bot"], "in"))
                for d, how in cands:
                    if best is None or d < best[0]:
                        best = (d, (S, how))
            if best:
                hit = best[1]
            else:
                for S in S_all:
                    fu = self.unit_of_line[S["lines"][0]["ref"]]
                    lu = self.unit_of_line[S["lines"][-1]["ref"]]
                    if us and self.succ(lu) is us[0]:
                        hit = (S, "out")
                    elif us and self.pred(fu) is us[-1]:
                        hit = (S, "in")
                    if hit:
                        break
            if hit:
                S, how = hit
                E["_jump"] = E.get("_jump") or how
                S["jumps"].append(E)
                used.add(E["id"])
        # images: inside exactly the smallest story region, else directly above a headline within its span
        for im in self.images:
            if im.get("_ad") or im["recur"] >= RECUR_EDITIONS:
                continue                                  # ads; recurring image content (logos, house ads)
            c = centre(im["bbox"])
            cands = [S for S in S_all if S["region"] and contains(S["region"], c) and not S.get("parent")]
            S = min(cands, key=lambda S: area(S["region"])) if cands else None
            if S is None:
                w = im["bbox"][2] - im["bbox"][0]
                best = None
                for S2 in S_all:
                    h = S2["head"]
                    if h is None:
                        continue
                    top = min([h["_ink_top"]] + ([S2["kicker"]["_ink_top"]] if S2["kicker"] else []) +
                              [d["_ink_top"] for d in S2["decks"]])
                    gap = top - im["bbox"][3]
                    if -2.0 <= gap <= PHOTO_ABOVE_HEAD_MM and overlap(im["bbox"][0], im["bbox"][2], h["_span"][0], h["_span"][1]) >= 0.5 * w \
                            and clear(im["bbox"][3], top, im["bbox"][0], im["bbox"][2],
                                      {h["id"]} | {d["id"] for d in S2["decks"]} | ({S2["kicker"]["id"]} if S2["kicker"] else set())):
                        if best is None or gap < best[0]:
                            best = (gap, S2)
                S = best[1] if best else None
            if S is not None:
                S["images"].append(im)
                im["_story"] = S
        # captions -> touching image (headlines.py C1 geometry on nominal ink) -> its story
        under, over, xm = CAPTION_MM
        for E in sorted((E for E in self.texts if E["kind"] == "caption" and avail(E)), key=lambda E: E["id"]):
            best = None
            for im in self.images:
                b = im["bbox"]
                if not (b[0] - xm <= E["bbox"][0] and E["bbox"][2] <= b[2] + xm):
                    continue
                if b[3] - 1.0 <= E["_ink_top"] <= b[3] + under:
                    d = abs(E["_ink_top"] - b[3])
                elif b[1] - over <= E["_ink_bot"] <= b[1] + 1.0:
                    d = abs(b[1] - E["_ink_bot"])
                elif b[1] <= E["_ink_top"] and E["_ink_bot"] <= b[3]:
                    d = 0.0
                else:
                    continue
                if best is None or d < best[0]:
                    best = (d, im)
            if best:
                E["_image"] = best[1]
                best[1].setdefault("_captions", []).append(E)
                S = best[1].get("_story")
                if S is not None:
                    S["captions"].append(E)
                    used.add(E["id"])
        # other text inside exactly one story region
        for E in sorted((E for E in self.texts if E["kind"] == "other_text" and avail(E)), key=lambda E: E["id"]):
            c = centre(E["bbox"])
            cands = [S for S in S_all if S["region"] and contains(S["region"], c)]
            if len(cands) == 1:
                cands[0]["others"].append(E)
                used.add(E["id"])
        self.used_text = used
        self.finish_stories()

    # ---------------------------------------------------------------- flows, columns, paragraphs, checks
    def finish_stories(self):
        S_all = self.stories_
        for S in S_all:
            boxes = [L["box"] for L in S["lines"]]
            h = S["head"]
            for E in ([h] + h["_parts"] if h else []) + S["decks"] + ([S["kicker"]] if S["kicker"] else []) + \
                    ([S["byline"]] if S["byline"] else []) + S["captions"] + S["images"] + S["jumps"]:
                boxes.append(E["bbox"])
            S["bbox"] = union(boxes)
        S_all.sort(key=lambda S: (round(S["bbox"][1]), S["bbox"][0]))
        for k, S in enumerate(S_all):
            S["id"] = f"s{k + 1}"
        # every printed body line (ads included) by baseline: a line of another flow between two consecutive lines of
        # one column entry splits it; the page's typical paragraph indent (em) arbitrates openers at a measure change
        self.body_by_bl = sorted((L for E in self.bframes for L in E["_lines"] if L["use"] == "body"),
                                 key=lambda L: (L["bl"], L["box"][0], L["ref"]))
        self.body_bls = [L["bl"] for L in self.body_by_bl]
        ind = [L["left_off"] * MM / L["size"] for L in self.body_by_bl
               if INDENT_EM <= L["left_off"] * MM / L["size"] <= INDENT_MAX_EM]
        self.typ_indent_em = st.median(ind) if ind else INDENT_EM
        self.insets = [E["bbox"] for E in self.images + self.graphics + self.ads
                       if E["bbox"][2] - E["bbox"][0] > 3 and E["bbox"][3] - E["bbox"][1] > 3]
        for S in S_all:
            self.build_flow(S)

    # ---------------------------------------------------------------- columns: one entry per printed measure
    def lx(self, L):
        """Printed extent (mm) of a body line: its own glyphs (merged fragments included), never a frame measure."""
        return L["box"][0], L["box"][2]

    def seg_box(self, seg):
        """Box of a column entry from its own printed lines: min x0 / max x1, top/bottom = baselines -/+ ascent/descent."""
        return [min(self.lx(L)[0] for L in seg), min(L["bl"] - COL_ASC * L["size"] / MM for L in seg),
                max(self.lx(L)[1] for L in seg), max(L["bl"] + COL_DESC * L["size"] / MM for L in seg)]

    def seg_left(self, seg, starts):
        """The sustained left edge of a column entry: its leftmost line that cannot open a paragraph (None if all can)."""
        xs = [self.lx(L)[0] for L in seg if L["ref"] not in starts]
        return min(xs) if xs else None

    def starts_para(self, L, left):
        """Paragraph-opening indent, measured against the line's own column entry (an offset beside an inset is part
        of the entry's measure, not an indent); without a sustained left edge, measure.py's offset when it is an indent."""
        em = L["size"] / MM
        if left is not None:
            return self.lx(L)[0] - left >= INDENT_EM * em
        return self.indented(L) and abs(L["left_off"]) <= INDENT_MAX_EM * em

    def col_break(self, prev, L, seg):
        """A new column entry is forced between consecutive flow lines: the flow goes up, leaves a gap > COL_BREAK
        leadings (the larger of the two lines' frame leadings), moves sideways (< 50 % horizontal overlap), or another printed body line lies between them."""
        if L["bl"] < prev["bl"] - 0.5 or (L["bl"] - prev["bl"]) > COL_BREAK * max(L["lead"], prev["lead"]):
            return True
        b = self.seg_box(seg)
        x0, x1 = self.lx(L)
        if overlap(x0, x1, b[0], b[2]) < 0.5 * min(x1 - x0, b[2] - b[0]):
            return True
        lo, hi = min(x0, b[0]), max(x1, b[2])
        for M in self.body_by_bl[bisect.bisect_right(self.body_bls, prev["bl"] + 0.5):
                                  bisect.bisect_left(self.body_bls, L["bl"] - 0.5)]:
            if overlap(self.lx(M)[0], self.lx(M)[1], lo, hi) > 1.0:
                return True
        return False

    def beside_inset(self, L, left):
        """An image, graphic or ad fills the space between a left edge and line L's first glyph: L's offset is a
        run-around, not a paragraph indent."""
        x0, em = self.lx(L)[0], L["size"] / MM
        top, bot = L["bl"] - COL_ASC * em, L["bl"] + COL_DESC * em
        return any(overlap(b[0], b[2], left, x0) > 0.5 and overlap(b[1], b[3], top, bot) > 0.5 for b in self.insets)

    def fits(self, seg, L, starts, hard):
        """Is line L set on the same measure as column entry seg? Left: a line that cannot open a paragraph sits on the
        entry's sustained left edge (+-COL_TOL_MM); a possible paragraph opener sits on it or up to INDENT_MAX_EM right of
        it (not beside an inset). Right: a line with a hard right edge (`hard`: justified, or flush with its neighbours)
        ends on the entry's right edge; any other line ends at or before it."""
        tol, em = COL_TOL_MM, L["size"] / MM
        x0, x1 = self.lx(L)
        left = self.seg_left(seg, starts)
        if left is not None:
            if L["ref"] in starts:
                if not (left - tol <= x0 <= left + INDENT_MAX_EM * em + tol) or (x0 > left + tol and self.beside_inset(L, left)):
                    return False
            elif abs(x0 - left) > tol:
                return False
        else:   # only possible paragraph openers so far: an opener sits level with one of them or one paragraph
            # indent (the page's typical, +-0.5 em) away; a line that cannot open a paragraph is their left edge
            if L["ref"] in starts:
                typ = self.typ_indent_em * em

                def level(M):
                    x = self.lx(M)[0]
                    if abs(x0 - x) <= tol:
                        return True
                    if abs(abs(x0 - x) - typ) > 0.5 * em:
                        return False
                    return not (self.beside_inset(L, x) if x0 > x else self.beside_inset(M, x0))
                if not any(level(M) for M in seg):
                    return False
            elif not all(-tol <= self.lx(M)[0] - x0 <= INDENT_MAX_EM * em + tol for M in seg):
                return False
        rh = [self.lx(M)[1] for M in seg if M["ref"] in hard]
        if L["ref"] in hard:
            if rh and abs(x1 - max(rh)) > tol:
                return False
            if not rh and x1 < max(self.lx(M)[1] for M in seg) - tol:
                return False
        elif rh and x1 > max(rh) + tol:
            return False
        return True

    def hard_right(self, lines, justified):
        """Lines whose right edge is a measure edge: in a justified flow, the justified lines and runs of >= 3
        consecutive non-final lines ending level (+-COL_TOL_MM; set flush beside an inset). Ragged flows: none."""
        if not justified:
            return set()
        out = {L["ref"] for L in lines if L["cls"] in ("FULLY_ALIGNED", "NEAR_ALIGNED")}
        run = []
        for L in lines + [None]:
            if L is not None and L["cls"] != "FINAL_PARAGRAPH_LINE" and \
                    (not run or (abs(self.lx(L)[1] - self.lx(run[-1])[1]) <= COL_TOL_MM and not self.col_break(run[-1], L, [run[-1]]))):
                run.append(L)
                continue
            if len(run) >= 3:
                out.update(M["ref"] for M in run)
            run = [L] if L is not None and L["cls"] != "FINAL_PARAGRAPH_LINE" else []
        return out

    def segments(self, lines, starts, justified):
        hard = self.hard_right(lines, justified)
        """Flow lines (reading order) -> column entries: consecutive lines on one printed measure. An entry ends at a
        forced break (col_break) or where EITHER edge changes by more than COL_TOL_MM for at least two lines (a
        run-around beside an inset); a single deviating line between agreeing ones stays in its entry."""
        segs = []
        for i, L in enumerate(lines):
            if not segs or self.col_break(lines[i - 1], L, segs[-1]):
                segs.append([L])
                continue
            if self.fits(segs[-1], L, starts, hard):
                segs[-1].append(L)
                continue
            nxt = lines[i + 1] if i + 1 < len(lines) and not self.col_break(L, lines[i + 1], [L]) else None
            if nxt is not None and self.fits(segs[-1], nxt, starts, hard):
                segs[-1].append(L)                      # one deviating line: not a new measure
                continue
            # a possible paragraph opener just above the change belongs to the new measure when its offset from that
            # measure's left edge is then closer to an indent (none, or the page's typical paragraph indent)
            prev = segs[-1][-1]
            segs.append([L])
            if len(segs[-2]) >= 2 and prev["ref"] in starts and self.fits([L], prev, starts, hard):
                rest = segs[-2][:-1]
                old_left = self.seg_left(rest, starts)
                old_left = self.seg_box(rest)[0] if old_left is None else old_left
                new_left = self.seg_left([L], starts)
                new_left = self.lx(L)[0] if new_left is None else new_left
                typ = self.typ_indent_em * prev["size"] / MM
                x0 = self.lx(prev)[0]

                def miss(d):
                    return min(abs(d), abs(d - typ))
                if miss(x0 - new_left) < miss(x0 - old_left):
                    segs[-2].pop()
                    segs[-1].insert(0, prev)
        return segs

    def possible_starts(self, items):
        """Lines that may open a paragraph: the first line, a line after a crosshead, a line after a non-mid line end."""
        out, prev, after_xh = set(), None, False
        for it in items:
            if it[0] == "xh":
                after_xh = True
                continue
            L = it[1]
            if prev is None or after_xh or prev["end"] != "mid":
                out.add(L["ref"])
            prev, after_xh = L, False
        return out

    def assign_xh(self, items, line_col):
        """Crosshead item -> {element id: column entry}: of the next line when the crosshead overlaps it horizontally,
        else of the previous line."""
        out, prevL = {}, None
        for k, it in enumerate(items):
            if it[0] == "xh":
                nxt = next((x[1] for x in items[k + 1:] if x[0] == "line"), None)
                out[k] = {}
                for u in it[1]:
                    b = u["E"]["bbox"]
                    out[k][u["E"]["id"]] = line_col[nxt["ref"]] if nxt and overlap(b[0], b[2], *self.lx(nxt)) > 0 else \
                        (line_col[prevL["ref"]] if prevL else 0)
            else:
                prevL = it[1]
        return out

    @staticmethod
    def precedes(a, b):
        """Geometric reading order of two column boxes: stacked (horizontal overlap > 1 mm) -> the upper first; side
        by side (vertical overlap > 1 mm) -> the left first; diagonal -> no constraint."""
        xo, yo = overlap(a[0], a[2], b[0], b[2]), overlap(a[1], a[3], b[1], b[3])
        if xo > 1.0:
            return a[3] <= b[1] + 1.0
        if yo > 1.0:
            return a[2] <= b[0] + 1.0
        return False

    def order_violations(self, boxes):
        return sum(1 for i in range(len(boxes)) for j in range(i + 1, len(boxes)) if self.precedes(boxes[j], boxes[i]))

    def broken_transitions(self, segs, items, starts):
        pos = {it[1]["ref"]: k for k, it in enumerate(items) if it[0] == "line"}
        n = 0
        for a, b in zip(segs, segs[1:]):
            la, fb = a[-1], b[0]
            ia, ib = pos[la["ref"]], pos[fb["ref"]]
            xh = ib > ia and any(it[0] == "xh" for it in items[ia + 1:ib])
            if not (xh or la["end"] == "ambiguous" or self.ends_mid(la) != self.starts_para(fb, self.seg_left(b, starts))):
                n += 1
        return n

    def build_flow(self, S):
        items = []
        for T in S["threads"]:
            items += T["items"]
        lines = [it[1] for it in items if it[0] == "line"]
        nonfinal = [L for L in lines if L["cls"] != "FINAL_PARAGRAPH_LINE"]
        justified = bool(nonfinal) and sum(1 for L in nonfinal if L["cls"] in ("FULLY_ALIGNED", "NEAR_ALIGNED")) >= 0.6 * len(nonfinal)
        starts = self.possible_starts(items)
        segs = self.segments(lines, starts, justified)
        # reading order: content order, unless it contradicts the geometric order of the column entries (text never
        # runs back up a column, and side-by-side entries read left to right); then the stable geometric order
        S["reordered"] = False
        boxes = [self.seg_box(g) for g in segs]
        if len(segs) > 1 and self.order_violations(boxes):
            n = len(segs)
            indeg = [sum(1 for j in range(n) if j != i and self.precedes(boxes[j], boxes[i])) for i in range(n)]
            done, order = set(), []
            while len(order) < n:
                ready = [i for i in range(n) if i not in done and indeg[i] == 0]
                if not ready:
                    break
                i = ready[0]
                order.append(i)
                done.add(i)
                for j in range(n):
                    if j not in done and self.precedes(boxes[i], boxes[j]):
                        indeg[j] -= 1
            if len(order) == n and order != list(range(n)):
                line_col = {L["ref"]: k for k, g in enumerate(segs) for L in g}
                xh_col = self.assign_xh(items, line_col)
                groups = defaultdict(list)
                for k, it in enumerate(items):
                    groups[list(xh_col[k].values())[-1] if it[0] == "xh" else line_col[it[1]["ref"]]].append(it)
                items2 = [it for i in order for it in groups[i]]
                lines2 = [it[1] for it in items2 if it[0] == "line"]
                starts2 = self.possible_starts(items2)
                segs2 = self.segments(lines2, starts2, justified)
                if self.order_violations([self.seg_box(g) for g in segs2]) < self.order_violations(boxes):
                    items, lines, starts, segs = items2, lines2, starts2, segs2
                    S["reordered"] = True
                    S["reasons"].append("column entries re-ordered to geometric reading order (content order contradicted it)")
        S["lines"], S["items"], S["starts"] = lines, items, starts
        cols = [{"lines": g, "xh": [], "left": self.seg_left(g, starts), "box": self.seg_box(g)} for g in segs]
        line_col = {L["ref"]: k for k, g in enumerate(segs) for L in g}
        xh_col = self.assign_xh(items, line_col)
        # flow + paragraphs
        flow, cur, prevL, after_xh = [], None, None, False
        S["xh"] = []
        for pos_it, it in enumerate(items):
            if it[0] == "xh":
                if cur:
                    flow.append(cur)
                    cur = None
                for E in dict.fromkeys(u["E"]["id"] for u in it[1]):
                    El = next(u["E"] for u in it[1] if u["E"]["id"] == E)
                    flow.append({"type": "crosshead", "element": E})
                    S["xh"].append(El)
                    cols[xh_col[pos_it][E]]["xh"].append(El)
                after_xh = True
                continue
            L = it[1]
            ci = line_col[L["ref"]]
            top_of_col = prevL is None or line_col[prevL["ref"]] != ci
            gap = (not top_of_col) and (L["bl"] - prevL["bl"]) > PARA_GAP * max(L["lead"], prevL["lead"]) + 0.01
            if cur is None or self.starts_para(L, cols[ci]["left"]) or after_xh or gap:
                if cur:
                    flow.append(cur)
                cur = {"type": "para", "lines": [], "_L": []}
            cur["_L"].append(L)
            after_xh = False
            prevL = L
        if cur:
            flow.append(cur)
        S["cols"], S["flow_raw"], S["line_col"] = cols, flow, line_col

    # ---------------------------------------------------------------- validation and output
    def validate(self):
        count = Counter()
        for S in self.stories_:
            for p in S["flow_raw"]:
                if p["type"] == "para":
                    for L in p["_L"]:
                        count[L["ref"]] += 1
        dup = [r for r, n in count.items() if n > 1]
        assert not dup, f"{self.sid} p{self.pno}: body lines in more than one flow: {dup[:5]}"
        self.unassigned_lines = []
        n_body = n_in = 0
        for E in self.bframes:
            for L in E["_lines"]:
                if L["use"] == "body":
                    n_body += 1
                    if count[L["ref"]] == 1:
                        n_in += 1
                    else:
                        why = "inside ad " + E["_ad"] if E.get("_ad") else "no glyphs" if not L["idx"] else "in no story flow"
                        self.unassigned_lines.append({"line_ref": L["ref"], "reason": why})
                elif L["use"] == "merged":
                    assert count[L["ref"]] == 0, L["ref"]
                    host = L["host"]
                    while host["use"] == "merged":
                        host = host["host"]
                    if count[host["ref"]] != 1:
                        self.unassigned_lines.append({"line_ref": L["ref"], "reason": "merged into " + host["ref"] + " (unassigned)"})
        assert n_in + sum(1 for u in self.unassigned_lines if not u["reason"].startswith("merged")) == n_body
        self.checks["flow_accounting"] = {"body_lines": n_body, "in_story_flows": n_in,
                                          "unassigned_lines": len(self.unassigned_lines), "duplicates": len(dup), "ok": True}

    def text_json(self, E):
        fr = self.fr
        rec = E.get("_rec")
        lines = []
        wm = True
        for l in E["_lines"]:
            nw = l["ntok"]
            ok = len(l["at"]["text"].split()) == nw
            wm &= ok
            lines.append({"text": l["at"]["text"], "x0_mm": r2(fr.x(l["x0"])), "x1_mm": r2(fr.x(l["x1"])),
                          "baseline_mm": r2(fr.y(l["by"]), 3), "n_words": nw, "words_match": ok,
                          "unmapped": l["at"]["unmapped"]})
        out = {"id": E["id"], "kind": E["kind"], "bbox_mm": rbox(E["bbox"]), "text": E["_text"], "font": E["_font"],
               "size_pt": E["_size"], "hscale": E["_hs"], "leading_pt": E["_lead"], "alignment": E["_align"],
               "colour_cmyk": cmyk_of(E["_col"]), "lines": lines, "source": E["_src"],
               "colour": E["_col"], "words_match": bool(wm), "role_reason": E.get("_reason")}
        if rec is not None:
            out["span_mm"] = [r2(E["_span"][0]), r2(E["_span"][1])]
            out["span_cols"] = rec["span_cols"]
            out["grid"] = rec["grid"]
            out["source_role"] = rec["role"]
            out["text_matches_source"] = E["_text"] == rec["text"]
        if E.get("_kind_was"):
            out["kind_was"] = E["_kind_was"]
            out["kind_reason"] = E.get("_kind_reason")
        if E["kind"] == "jump_line":
            out["jump"] = E.get("_jump")
            if E.get("_jump_page"):
                out["jump_page"] = E["_jump_page"]
        if E.get("_run_in") or E["kind"] == "byline":
            out["run_in"] = bool(E.get("_run_in"))
            if E.get("_run_in_line"):
                out["run_in_line"] = E["_run_in_line"]
        if E.get("_image") is not None:
            out["image"] = E["_image"]["id"]
        if E.get("_ad"):
            out["ad"] = E["_ad"]
        return out

    def body_json(self, E):
        f, fr = E["_f"], self.fr
        lines = []
        for L in E["_lines"]:
            at = L["text_at"]
            ok = len(at["text"].split()) == L["ntok"]
            d = {"text": at["text"], "x0_mm": r2(fr.x(L["x0"])), "x1_mm": r2(fr.x(L["x1"])), "baseline_mm": r2(L["bl"], 3),
                 "n_words": L["ntok"], "class": L["cls"], "left_offset_mm": r2(L["left_off"], 3),
                 "excluded": bool(L["m"].get("excluded")), "use": L["use"], "words_match": ok, "unmapped": at["unmapped"],
                 "hyphen_break": bool(L["m"].get("break"))}
            if L["cls"] != L["m"]["class"]:
                d["class_measure"] = L["m"]["class"]
            if L["merged"]:
                d["merged"] = L["merged"]
            if L["use"] == "merged":
                d["merged_into"] = L["host"]["ref"]
            if L["m"].get("split_of"):
                d["split_of"] = L["m"]["split_of"]
            elif "split_from_merged_columns" in L["m"].get("flags", ()):
                d["split"] = True
            if L["use"] == "display" and L["el"] is not None:
                d["element"] = L["el"]["id"]
            lines.append(d)
        out = {"id": E["id"], "kind": "body_frame", "bbox_mm": rbox(E["bbox"]), "frame_id": f["id"],
               "x0_mm": r2(fr.x(E["_measure"][0])), "x1_mm": r2(fr.x(E["_measure"][1])),
               "font": HL.base_font(f["font"]), "size_pt": f["size_pt"], "hscale": f["hscale_median"],
               "leading_pt": f["leading_pt"],
               "space_em": r2(f["nominal_space_pt"] / f["size_pt"], 4) if f.get("nominal_space_pt") and f["size_pt"] else None,
               "lines": lines, "width_confidence": f.get("width_confidence"), "measure_source": E["_measure_src"],
               "promoted": E["_promoted"], "split_from": f.get("split_from")}
        if E.get("_ad"):
            out["ad"] = E["_ad"]
        return out

    def story_json(self, S):
        flow, cols_out = [], []
        for c in S["cols"]:
            ls = c["lines"]
            fids = list(dict.fromkeys([L["f"]["id"] for L in ls] + [m.split(":")[0] for L in ls for m in L["merged"]]))
            steps = [b["bl"] - a["bl"] for a, b in zip(ls, ls[1:]) if 0 < b["bl"] - a["bl"] <= 1.6 * a["lead"]]
            b = c["box"]
            tops = [b[1]] + [E["bbox"][1] for E in c["xh"]]
            bots = [b[3]] + [E["bbox"][3] for E in c["xh"]]
            cols_out.append({"frame_ids": fids, "x0_mm": r2(b[0]), "x1_mm": r2(b[2]),
                             "top_mm": r2(min(tops)),
                             "bottom_mm": r2(max(bots)), "first_baseline_mm": r2(ls[0]["bl"], 3), "n_lines": len(ls),
                             "leading_mm": r2(st.median(steps), 3) if steps else r2(ls[0]["lead"], 3),
                             "measure_mm": r2(b[2] - b[0]),
                             "left_edge_mm": r2(c["left"]) if c["left"] is not None else None})
        n_hyph = n_unm = n_mis = n_special = 0
        para_texts = []
        for p in S["flow_raw"]:
            if p["type"] == "crosshead":
                flow.append(p)
                continue
            ls = []
            hb = 0
            ok_all = True
            unm = 0
            for j, L in enumerate(p["_L"]):
                at = L["text_at"]
                ok = len(at["text"].split()) == L["ntok"]
                ok_all &= ok
                unm += at["unmapped"]
                if L["m"].get("break") and j < len(p["_L"]) - 1:
                    hb += 1
                n_special += L["cls"] == "SPECIAL_CASE"
                ls.append({"col": S["line_col"][L["ref"]], "line_ref": L["ref"], "text": at["text"], "n_words": L["ntok"],
                           "words_match": ok})
            text = " ".join(l["text"] for l in ls)
            para_texts.append(text)
            n_hyph += hb
            n_unm += unm
            n_mis += sum(1 for l in ls if not l["words_match"])
            L0 = p["_L"][0]
            indent = max(0.0, self.lx(L0)[0] - S["cols"][S["line_col"][L0["ref"]]]["box"][0])
            flow.append({"type": "para", "text": text, "indent_mm": r2(indent, 3), "lines": ls,
                         "hyphen_breaks": hb, "checks": {"words_match": bool(ok_all), "unmapped": unm,
                                                          "ends_final": p["_L"][-1]["cls"] == "FINAL_PARAGRAPH_LINE"}})
        lines = S["lines"]
        first, last = lines[0], lines[-1]
        # column transitions
        trans = ok_trans = 0
        trans = len(S["cols"]) - 1 if S["cols"] else 0
        ok_trans = trans - self.broken_transitions([c["lines"] for c in S["cols"]], S["items"], S["starts"])
        # model self-checks of the column entries (from the rounded output, as the composer reads it)
        by_ref = {L["ref"]: L for L in lines}
        em_story = (Counter(L["f"]["size_pt"] for L in lines).most_common(1)[0][0] or self.body_size) / MM
        n_out = n_wide = 0
        widest = defaultdict(float)
        for p in flow:
            for ln in p.get("lines", []):
                L, c = by_ref[ln["line_ref"]], cols_out[ln["col"]]
                x0, x1, bl = r2(self.lx(L)[0]), r2(self.lx(L)[1]), r2(L["bl"], 3)
                widest[ln["col"]] = max(widest[ln["col"]], x1 - x0)
                n_out += not (x0 >= c["x0_mm"] - 0.5 and x1 <= c["x1_mm"] + 0.5 and c["top_mm"] - 0.5 <= bl <= c["bottom_mm"] + 0.5)
        for k, c in enumerate(cols_out):
            n_wide += (c["x1_mm"] - c["x0_mm"]) > widest[k] + 1.0
        n_ind = sum(1 for p in flow if p["type"] == "para" and p["indent_mm"] > 2 * em_story)
        n_viol = self.order_violations([c["box"] for c in S["cols"]])
        fonts = Counter()
        for L in lines:
            fonts.update(L["text_at"]["fonts"])
        sizes = Counter(L["f"]["size_pt"] for L in lines)
        leads = [L["f"]["leading_pt"] for L in lines if L["f"]["leading_pt"]]
        hss = [L["f"]["hscale_median"] for L in lines if L["f"]["hscale_median"]]
        sps = [L["f"]["nominal_space_pt"] / L["f"]["size_pt"] for L in lines if L["f"].get("nominal_space_pt") and L["f"]["size_pt"]]
        nonfinal = [L for L in lines if L["cls"] != "FINAL_PARAGRAPH_LINE"]
        just = sum(1 for L in nonfinal if L["cls"] in ("FULLY_ALIGNED", "NEAR_ALIGNED"))
        # jumps (elements, then inline markers at the very start / end of the flow)
        jump_in = any(E.get("_jump") == "in" for E in S["jumps"])
        jump_out = any(E.get("_jump") == "out" for E in S["jumps"])
        reasons = list(S["reasons"])
        if para_texts:
            m_end = re.search(r"\(([^()]{1,40})\)\s*$", para_texts[-1])
            m_start = re.match(r"^\s*\(([^()]{1,40})\)", para_texts[0])
            for m, where in ((m_end, "end"), (m_start, "start")):
                if m:
                    refs = page_refs(m.group(1), self.pno, self.n_pages)
                    if refs:
                        if refs[0] > self.pno:
                            jump_out = True
                        else:
                            jump_in = True
                        reasons.append(f"inline page reference at the flow {where}")
        # text of frames excluded by corrections lying inside this story's columns: the flow has a gap there
        n_excl = 0
        for E in self.residual:
            if E.get("_excluded_src") and contains(S["bbox"], centre(E["bbox"])) and \
                    any(overlap(E["bbox"][0], E["bbox"][2], c["lines"][0]["L"], c["lines"][0]["R"]) >= 0.5 * (E["bbox"][2] - E["bbox"][0])
                        for c in S["cols"]):
                n_excl += len(E["_lines"])
        if n_excl:
            reasons.append(f"{n_excl} line(s) of a frame excluded by corrections lie inside its columns (gap in the flow)")
        checks = {"words_match": n_mis == 0, "lines_words_mismatch": n_mis, "unmapped_glyphs": n_unm,
                  "excluded_text_lines_inside": n_excl,
                  "starts_paragraph": self.indented(first) or self.runin_start(first) or
                  (S["head"] is not None and self.top_under(first, S["head"])),
                  "ends_paragraph": last["end"] in ("final", "ambiguous"), "last_line_end": last["end"],
                  "column_transitions": trans, "column_transitions_consistent": ok_trans,
                  "transitions_consistent": ok_trans == trans, "single_thread": len(S["threads"]) == 1,
                  "threads": len(S["threads"]), "headline_evidence": S["evidence"] if S["head"] else "none",
                  "reading_order_geometric": n_viol == 0,
                  "column_order_violations": n_viol, "columns_reordered": bool(S.get("reordered")),
                  "column_lines_outside": n_out, "columns_wider_than_lines": n_wide, "indents_gt_2em": n_ind,
                  "hyphen_breaks": n_hyph, "special_case_lines": n_special,
                  "excluded_lines": sum(1 for L in lines if L["m"].get("excluded"))}
        bool_ok = checks["words_match"] and n_unm == 0 and checks["starts_paragraph"] and checks["ends_paragraph"] \
            and checks["transitions_consistent"] and n_excl == 0
        complete = bool_ok and not jump_in and not jump_out
        if not checks["starts_paragraph"]:
            reasons.append("flow starts mid-paragraph (continuation or grouping error)")
        if not checks["ends_paragraph"]:
            reasons.append("flow ends mid-paragraph (continues elsewhere or grouping error)")
        if not checks["transitions_consistent"]:
            reasons.append(f"{trans - ok_trans} of {trans} column transitions break paragraph continuity")
        if n_mis:
            reasons.append(f"{n_mis} line(s) whose decoded word count differs from the geometric token count")
        if n_unm:
            reasons.append(f"{n_unm} unmapped glyph(s)")
        if jump_in:
            reasons.append("jump in: continues from another page")
        if jump_out:
            reasons.append("jump out: continues on another page")
        weak = 0
        if S["head"] is not None:
            if S["evidence"] == "geo+content":
                reasons.insert(0, "headline: geometry and content order agree")
            else:
                weak += 1
                reasons.insert(0, f"headline: {S['evidence']} evidence only")
        else:
            if S["parent"] is not None:
                reasons.insert(0, "no headline: separate flow under " + S["parent"]["id"] + "'s headline")
            else:
                reasons.insert(0, "no headline above this flow")
                if not checks["starts_paragraph"]:
                    weak += 1
        if not checks["single_thread"]:
            weak += 1
        weak += sum(1 for k in ("words_match", "transitions_consistent") if not checks[k])
        weak += 0 if checks["ends_paragraph"] or jump_out else 1
        weak += 1 if n_excl else 0
        if checks["starts_paragraph"] is False and S["head"] is not None:
            weak += 1
        confidence = "high" if weak == 0 else "medium" if weak == 1 else "low"
        h = S["head"]
        out = {"id": S["id"], "headline": h["id"] if h else None,
               "kicker": S["kicker"]["id"] if S["kicker"] else None,
               "decks": [E["id"] for E in sorted(S["decks"], key=lambda E: E["bbox"][1])],
               "byline": S["byline"]["id"] if S["byline"] else None,
               "captions": [E["id"] for E in S["captions"]], "images": [im["id"] for im in S["images"]],
               "columns": cols_out, "flow": flow,
               "body_font": fonts.most_common(1)[0][0] if fonts else None,
               "body_size_pt": sizes.most_common(1)[0][0] if sizes else None,
               "body_leading_pt": r2(st.median(leads), 3) if leads else None,
               "body_hscale": r2(st.median(hss), 4) if hss else None,
               "body_alignment": "justified" if nonfinal and just >= 0.6 * len(nonfinal) else "ragged",
               "space_em": r2(st.median(sps), 4) if sps else None,
               "jump_in": bool(jump_in), "jump_out": bool(jump_out), "complete": bool(complete),
               "confidence": confidence, "reasons": reasons, "checks": checks,
               "bbox_mm": rbox(S["bbox"]),
               "headline_parts": [p["id"] for p in h["_parts"]] if h else [],
               "jump_lines": [E["id"] for E in S["jumps"]],
               "other_elements": [E["id"] for E in S["others"] + S["extra_bylines"]],
               "parent_story": S["parent"]["id"] if S["parent"] else None}
        return out

    def json(self):
        pg, smp = self.pg, self.smp
        date = smp["date"]
        els = []
        text_sorted = sorted(self.texts, key=lambda E: (round(E["bbox"][1], 1), E["bbox"][0], E["id"]))
        body_sorted = sorted(self.bframes, key=lambda E: (round(E["bbox"][1], 1), E["bbox"][0], E["id"]))
        for E in text_sorted:
            els.append(self.text_json(E))
        for E in body_sorted:
            els.append(self.body_json(E))
        for im in self.images:
            d = {"id": im["id"], "kind": "image", "bbox_mm": rbox(im["bbox"]), "pixel_w": im["pw"], "pixel_h": im["ph"],
                 "colour_space": im["cs"], "placement_bbox_mm": rbox(im["full"]), "recurring_editions": im["recur"],
                 "captions": [E["id"] for E in im.get("_captions", [])]}
            if im.get("_ad"):
                d["ad"] = im["_ad"]
            els.append(d)
        for r in self.rules:
            d = {"id": r["id"], "kind": "rule", "bbox_mm": rbox(r["bbox"]), "p0_mm": [r2(r["p0"][0]), r2(r["p0"][1])],
                 "p1_mm": [r2(r["p1"][0]), r2(r["p1"][1])], "stroke_pt": r2(r["sw"], 3), "colour": r["colour"],
                 "dash": bool(r["dash"]), "orientation": r["orient"], "colour_paired": r["paired"]}
            if r.get("_ad"):
                d["ad"] = r["_ad"]
            els.append(d)
        for b in self.boxes:
            d = {"id": b["id"], "kind": "box", "bbox_mm": rbox(b["bbox"]), "fill": b["fill"],
                 "stroke_pt": r2(b["sw"], 3) if b["sw"] is not None else None, "stroke": b["stroke"],
                 "dash": bool(b["dash"]), "panel": b in self.panels, "colour_paired": b["paired"]}
            if b.get("_ad"):
                d["ad"] = b["_ad"]
            els.append(d)
        for g in self.graphics:
            d = {"id": g["id"], "kind": "graphic", "bbox_mm": rbox(g["bbox"]), "n_paths": g["n_paths"],
                 "shading": g["shading"], "colours": g["colours"]}
            if g.get("_ad"):
                d["ad"] = g["_ad"]
            els.append(d)
        for a in self.ads:
            els.append({"id": a["id"], "kind": "ad", "bbox_mm": rbox(a["bbox"]), "reason": a["reason"],
                        "parts": sorted(a["parts"])})
        stories = [self.story_json(S) for S in self.stories_]
        self.checks["columns"] = column_checks(stories)
        in_story = set()
        for s in stories:
            for k in ("headline", "kicker", "byline"):
                if s[k]:
                    in_story.add(s[k])
            for k in ("decks", "captions", "images", "headline_parts", "jump_lines", "other_elements"):
                in_story.update(s[k])
            for c in s["columns"]:
                in_story.update("bf-" + f for f in c["frame_ids"])
            for p in s["flow"]:
                if p["type"] == "crosshead":
                    in_story.add(p["element"])
        unassigned = sorted(e["id"] for e in els if e["id"] not in in_story)
        # display lines of body frames are accounted through their element
        for E in self.bframes:
            for L in E["_lines"]:
                if L["use"] == "display" and L["el"] is not None:
                    assert L["el"]["id"] in in_story or L["el"]["id"] in unassigned
        # coverage
        text_idx = set()
        for E in self.texts:
            text_idx.update(E["_idx"])
        for E in self.bframes:
            for L in E["_lines"]:
                if L["use"] in ("body", "display"):
                    text_idx.update(L["idx"])
        n_lines = n_lines_in = 0
        for f in pg["frames"]:
            for ln in f["lines"]:
                x0, x1 = min(t["x0"] for t in ln["tokens"]), max(t["x1"] for t in ln["tokens"])
                idx = self.sel(ln["baseline_pt"], x0, x1, f["size_pt"])
                n_lines += 1
                if idx and sum(1 for i in idx if i in text_idx) >= 0.5 * len(idx):
                    n_lines_in += 1
        n_body = self.checks["flow_accounting"]["body_lines"]
        n_body_in = self.checks["flow_accounting"]["in_story_flows"]
        line_mis = sum(1 for e in els if e["kind"] == "body_frame" for l in e["lines"] if l["use"] == "body" and not l["words_match"])
        line_mis += sum(1 for e in els if e["kind"] in TEXT_KINDS for l in e["lines"] if not l["words_match"])
        coverage = {"text_lines_total": n_lines, "text_lines_in_elements": n_lines_in,
                    "body_lines_total": n_body, "body_lines_in_stories": n_body_in,
                    "glyphs_total": len(self.ink), "glyphs_in_text_elements": len(text_idx & set(self.ink)),
                    "text_lines_in_excluded_frames": sum(len(f["lines"]) for f in self.excluded_frames),
                    "fragments_merged": self.n_merged, "frames_promoted": self.n_promoted,
                    "residual_text_elements": len(self.residual), "residual_glyphs": self.n_residual_glyphs,
                    "lines_words_mismatch": line_mis,
                    "pct_text_lines_in_elements": r2(100 * n_lines_in / n_lines, 2) if n_lines else None,
                    "pct_body_lines_in_stories": r2(100 * n_body_in / n_body, 2) if n_body else None,
                    "pct_glyphs_in_text_elements": r2(100 * len(text_idx & set(self.ink)) / len(self.ink), 2) if self.ink else None}
        mb = pg.get("mediabox_mm") or [0, 0, self.W, self.H]

        def box_out(b):
            if not b:
                return None
            x0, y0, x1, y1 = b
            top = mb[3]
            return [r2(x0 - mb[0]), r2(top - y1), r2(x1 - mb[0]), r2(top - y0)]
        self.checks["glyph_pass_identical"] = True
        self.checks["elements_by_kind"] = dict(sorted(Counter(e["kind"] for e in els).items()))
        out = {"schema": SCHEMA, "tool": TOOL, "sample": self.sid, "edition_date": date,
               "split": "cal" if date < SPLIT_DATE else "test", "page": self.pno,
               "page_w_mm": r2(self.W, 3), "page_h_mm": r2(self.H, 3),
               "trimbox_mm": box_out(pg.get("trimbox_mm")), "bleedbox_mm": box_out(pg.get("bleedbox_mm")),
               "elements": els, "stories": stories, "unassigned": unassigned,
               "unassigned_lines": self.unassigned_lines, "coverage": coverage, "checks": self.checks,
               "body_font_page": self.body_font, "body_size_pt_page": self.body_size}
        return out


# ------------------------------------------------------------------------------------------------- overlay
PALETTE = [(230, 25, 75), (60, 180, 75), (0, 130, 200), (245, 130, 48), (145, 30, 180), (70, 190, 190), (240, 50, 230),
           (128, 128, 0), (0, 128, 128), (170, 110, 40), (128, 0, 0), (0, 0, 128), (200, 160, 0), (100, 100, 255)]


def render_overlay(pdf, model, out_png, width_px=1800):
    """Private overlay: story columns filled by story colour with reading-order labels, head elements outlined,
    rules (magenta), images (story colour or grey), ads (orange), unassigned text (red)."""
    doc = pdfium.PdfDocument(str(pdf))
    page = doc[model["page"] - 1]
    l, _b, _r, t = page.get_mediabox()
    font = PR.FPDFText_LoadStandardFont(doc.raw, b"Helvetica-Bold")
    keep = []

    def X(xmm):
        return l + xmm * MM

    def Y(ymm):
        return t - ymm * MM

    def rect(bb, stroke=None, fill=None, sw=1.0, dash=False):
        x0, y0, x1, y1 = bb
        o = PR.FPDFPageObj_CreateNewRect(X(x0), Y(y1), (x1 - x0) * MM, (y1 - y0) * MM)
        if fill:
            PR.FPDFPageObj_SetFillColor(o, *fill)
        if stroke:
            PR.FPDFPageObj_SetStrokeColor(o, *stroke)
            PR.FPDFPageObj_SetStrokeWidth(o, sw)
            if dash:
                arr = (ctypes.c_float * 2)(4.0, 3.0)
                PR.FPDFPageObj_SetDashArray(o, arr, 2, 0.0)
        PR.FPDFPath_SetDrawMode(o, PR.FPDF_FILLMODE_WINDING if fill else PR.FPDF_FILLMODE_NONE, bool(stroke))
        PR.FPDFPage_InsertObject(page.raw, o)

    def line(p0, p1, stroke, sw):
        o = PR.FPDFPageObj_CreateNewPath(X(p0[0]), Y(p0[1]))
        PR.FPDFPath_LineTo(o, X(p1[0]), Y(p1[1]))
        PR.FPDFPageObj_SetStrokeColor(o, *stroke)
        PR.FPDFPageObj_SetStrokeWidth(o, sw)
        PR.FPDFPath_SetDrawMode(o, PR.FPDF_FILLMODE_NONE, True)
        PR.FPDFPage_InsertObject(page.raw, o)

    def label(xmm, ymm, s, rgb, size=11.0, bg=True):
        if bg:
            rect([xmm - 0.3, ymm - size / MM * 0.85, xmm + len(s) * size * 0.62 / MM + 0.3, ymm + size / MM * 0.2],
                 fill=(255, 255, 255, 215))
        o = PR.FPDFPageObj_CreateTextObj(doc.raw, font, size)
        buf = ctypes.create_string_buffer((s + "\x00").encode("utf-16-le"))
        keep.append(buf)
        PR.FPDFText_SetText(o, ctypes.cast(buf, ctypes.POINTER(ctypes.c_ushort)))
        PR.FPDFPageObj_SetFillColor(o, *rgb, 255)
        PR.FPDFPageObj_Transform(o, 1, 0, 0, 1, X(xmm), Y(ymm))
        PR.FPDFPage_InsertObject(page.raw, o)

    els = {e["id"]: e for e in model["elements"]}
    unassigned = set(model["unassigned"])
    for k, s in enumerate(model["stories"]):
        c = PALETTE[k % len(PALETTE)]
        for ci, col in enumerate(s["columns"]):
            rect([col["x0_mm"], col["top_mm"], col["x1_mm"], col["bottom_mm"]], stroke=(*c, 255), fill=(*c, 48), sw=1.2)
        for key in ("headline", "kicker", "byline"):
            if s[key]:
                rect(els[s[key]]["bbox_mm"], stroke=(*c, 255), sw=3.0)
        for eid in s["decks"] + s["headline_parts"]:
            rect(els[eid]["bbox_mm"], stroke=(*c, 255), sw=2.0)
        for eid in s["images"]:
            rect(els[eid]["bbox_mm"], stroke=(*c, 255), sw=2.5, dash=True)
        for eid in s["captions"] + s["jump_lines"] + s["other_elements"]:
            rect(els[eid]["bbox_mm"], stroke=(*c, 255), sw=1.5, dash=True)
        for p in s["flow"]:
            if p["type"] == "crosshead":
                rect(els[p["element"]]["bbox_mm"], stroke=(*c, 255), sw=1.5)
    for e in model["elements"]:
        if e["kind"] == "rule":
            line(e["p0_mm"], e["p1_mm"], (255, 0, 255, 255), max(1.5, e["stroke_pt"]))
        elif e["kind"] == "image" and e["id"] in unassigned and not e.get("ad"):
            rect(e["bbox_mm"], stroke=(120, 120, 120, 255), sw=2.0, dash=True)
        elif e["kind"] == "ad":
            rect(e["bbox_mm"], stroke=(255, 140, 0, 255), fill=(255, 140, 0, 40), sw=4.0)
            label(e["bbox_mm"][0] + 1, e["bbox_mm"][1] + 6, e["id"].upper(), (255, 110, 0), 16.0)
        elif e["kind"] in TEXT_KINDS and e["id"] in unassigned and not e.get("ad") and e["kind"] not in ("folio", "furniture"):
            rect(e["bbox_mm"], stroke=(220, 0, 0, 255), sw=1.2)
    for u in model["unassigned_lines"]:
        fid, k = u["line_ref"].rsplit(":", 1)
        bf = els.get("bf-" + fid)
        if bf:
            ln = bf["lines"][int(k)]
            rect([ln["x0_mm"], ln["baseline_mm"] - 3.5, ln["x1_mm"], ln["baseline_mm"] + 1.0], fill=(255, 0, 0, 90))
    for k, s in enumerate(model["stories"]):
        c = PALETTE[k % len(PALETTE)]
        anchor = els[s["headline"]]["bbox_mm"] if s["headline"] else [s["columns"][0]["x0_mm"], s["columns"][0]["top_mm"]]
        tag = s["id"] + ("" if s["confidence"] == "high" else " " + s["confidence"][0].upper()) + (" C" if s["complete"] else "")
        label(anchor[0] + 0.5, anchor[1] + 5.0, tag, c, 15.0)
        for ci, col in enumerate(s["columns"]):
            label(col["x0_mm"] + 0.5, col["top_mm"] + 4.0, f"{s['id']}.{ci + 1}", c, 10.0)
    legend = "fill = story columns (label sNN.k = reading order); thick = headline/kicker/byline; dashed = images, " \
             "captions, jump lines; magenta = rules; orange = ads; red = unassigned text / lines; M/L = medium/low conf, C = complete"
    label(2, model["page_h_mm"] - 1.5, legend, (0, 0, 0), 8.0)
    w, _h = page.get_size()
    bm = page.render(scale=width_px / w)
    OV.write_png(out_png, bm.width, bm.height, bytes(bm.buffer), bm.stride, bm.n_channels)
    os.chmod(out_png, 0o600)
    doc.close()


# ------------------------------------------------------------------------------------------------- corpus pass
def residual_furniture(models):
    """Residual text (glyphs in no measure line, e.g. excluded imprint frames) whose lines recur verbatim in
    >= RECUR_EDITIONS editions is furniture (imprint, standing labels), like headlines.py's O4 rule."""
    seen = defaultdict(set)
    for smp, m in models:
        for e in m["elements"]:
            if e.get("source") == "residual-glyphs":
                for l in e["lines"]:
                    seen[l["text"]].add(smp["sid"])
    for smp, m in models:
        changed = False
        for e in m["elements"]:
            if e.get("source") == "residual-glyphs" and e["kind"] == "other_text" and e["lines"]:
                rec = sum(1 for l in e["lines"] if len(seen[l["text"]]) >= RECUR_EDITIONS)
                if rec >= 0.5 * len(e["lines"]):
                    e["kind"], e["kind_was"] = "furniture", "other_text"
                    e["kind_reason"] = f"{rec} of {len(e['lines'])} lines recur verbatim in >= {RECUR_EDITIONS} editions"
                    changed = True
        if changed:
            m["checks"]["elements_by_kind"] = dict(sorted(Counter(e["kind"] for e in m["elements"]).items()))


# ------------------------------------------------------------------------------------------------- aggregates
def dist(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return {"n": len(xs), "min": xs[0], "p10": HL.q(xs, .1), "median": HL.q(xs, .5), "p90": HL.q(xs, .9), "max": xs[-1]}


def column_checks(stories):
    """Model self-checks of the story column entries: flow lines outside their entry's box (+-0.5 mm), stories whose
    entries are not in geometric reading order (and entries re-ordered to it), entries wider than their widest line
    + 1 mm, paragraph indents > 2 em."""
    c = [s["checks"] for s in stories]
    return {"columns": sum(len(s["columns"]) for s in stories),
            "flow_lines": sum(len(p["lines"]) for s in stories for p in s["flow"] if p["type"] == "para"),
            "lines_outside_column": sum(x["column_lines_outside"] for x in c),
            "stories_columns_out_of_order": sum(1 for x in c if x["column_order_violations"]),
            "column_order_violations": sum(x["column_order_violations"] for x in c),
            "stories_columns_reordered": sum(1 for x in c if x["columns_reordered"]),
            "columns_wider_than_lines": sum(x["columns_wider_than_lines"] for x in c),
            "paragraphs": sum(1 for s in stories for p in s["flow"] if p["type"] == "para"),
            "indents_gt_2em": sum(x["indents_gt_2em"] for x in c)}


def aggregate(pages):
    cov_keys = ("text_lines_total", "text_lines_in_elements", "body_lines_total", "body_lines_in_stories", "glyphs_total",
                "glyphs_in_text_elements", "text_lines_in_excluded_frames", "fragments_merged", "frames_promoted",
                "residual_text_elements", "residual_glyphs", "lines_words_mismatch")
    tot = {k: sum(p["coverage"][k] for p in pages) for k in cov_keys}

    def pct(a, b):
        return round(100 * tot[a] / tot[b], 2) if tot[b] else None
    tot["pct_text_lines_in_elements"] = pct("text_lines_in_elements", "text_lines_total")
    tot["pct_body_lines_in_stories"] = pct("body_lines_in_stories", "body_lines_total")
    tot["pct_glyphs_in_text_elements"] = pct("glyphs_in_text_elements", "glyphs_total")
    stories = [s for p in pages for s in p["stories"]]
    n = len(stories)
    conf = Counter(s["confidence"] for s in stories)
    per_page = [len(p["stories"]) for p in pages]
    chk = Counter()
    for s in stories:
        c = s["checks"]
        for k in ("words_match", "starts_paragraph", "ends_paragraph", "transitions_consistent", "single_thread",
                  "reading_order_geometric"):
            chk[k] += bool(c[k])
        chk["headline_" + c["headline_evidence"]] += 1
    out = {"pages": len(pages), "coverage": tot,
           "stories": {"total": n, "per_page": dist(per_page), "per_page_histogram": dict(sorted(Counter(per_page).items())),
                       "with_headline": sum(1 for s in stories if s["headline"]),
                       "headless": sum(1 for s in stories if not s["headline"]),
                       "headless_with_parent": sum(1 for s in stories if not s["headline"] and s["parent_story"]),
                       "complete": sum(1 for s in stories if s["complete"]),
                       "incomplete": sum(1 for s in stories if not s["complete"]),
                       "jump_in": sum(1 for s in stories if s["jump_in"]), "jump_out": sum(1 for s in stories if s["jump_out"]),
                       "confidence": {k: conf.get(k, 0) for k in ("high", "medium", "low")},
                       "pct_complete": round(100 * sum(1 for s in stories if s["complete"]) / n, 2) if n else None,
                       "columns_per_story": dist([len(s["columns"]) for s in stories]),
                       "paragraphs_per_story": dist([sum(1 for f in s["flow"] if f["type"] == "para") for s in stories]),
                       "checks_true": dict(sorted(chk.items()))},
           "elements_by_kind": dict(sorted(sum((Counter(p["checks"]["elements_by_kind"]) for p in pages), Counter()).items())),
           "paths": {k: sum(p["checks"]["paths"][k] for p in pages) for k in ("pdfium", "pdfminer_nondegenerate", "paired",
                                                                                 "invisible_or_unpainted")},
           "threads": {k: sum(p["checks"]["threads"][k] for p in pages) for k in ("blocks", "threads", "block_links")},
           "flow_accounting_ok_pages": sum(1 for p in pages if p["checks"]["flow_accounting"]["ok"]),
           "column_checks": {k: sum(p["checks"]["columns"][k] for p in pages) for k in pages[0]["checks"]["columns"]}
           if pages else {}}
    return out


# ------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dataset", type=Path)
    ap.add_argument("--overlays", default="", help="comma-separated SAMPLE:PAGE list to render private overlays for")
    ap.add_argument("--only", default="", help="SAMPLE or SAMPLE:PAGE (debugging; skips the dataset aggregates)")
    a = ap.parse_args()
    ds = a.dataset.expanduser().resolve()
    repo = HERE.parents[2]
    if repo in ds.parents or ds == repo:
        sys.exit("refusing: the dataset (pilot data) must live outside the git repository")
    os.umask(0o077)                         # outputs hold article text: never world-readable, even briefly
    out_dir = ds / "report" / "page1"
    (out_dir / "pages").mkdir(parents=True, exist_ok=True)
    (out_dir / "overlays").mkdir(parents=True, exist_ok=True)
    samples, skipped, recs = load_dataset(ds)
    ctx = dataset_context(samples, recs)
    want_ov = {(s.split(":")[0], int(s.split(":")[1])) for s in a.overlays.split(",") if s.strip()}
    only = a.only.split(":") if a.only else None
    models = []
    for smp in samples:
        if only and smp["sid"] != only[0]:
            continue
        pdoc = pdfium.PdfDocument(str(smp["pdf"]))
        for pg in smp["doc"]["pages"]:
            if only and len(only) > 1 and pg["page"] != int(only[1]):
                continue
            models.append((smp, PageModel(ctx, smp, pg, recs.get((smp["sid"], pg["page"]), []), pdoc).build().json()))
        pdoc.close()
    residual_furniture(models)
    summary_pages = []
    for smp, model in models:
        path = out_dir / "pages" / f"{smp['sid']}__p{model['page']}.json"
        path.write_text(json.dumps(model, ensure_ascii=False, indent=1), encoding="utf-8")
        os.chmod(path, 0o600)
        if (smp["sid"], model["page"]) in want_ov:
            render_overlay(smp["pdf"], model, out_dir / "overlays" / f"{smp['sid']}__p{model['page']}.png")
        conf = Counter(s["confidence"] for s in model["stories"])
        summary_pages.append({"sample": smp["sid"], "edition_date": smp["date"], "split": model["split"],
                              "page": model["page"], "coverage": model["coverage"], "stories": len(model["stories"]),
                              "stories_with_headline": sum(1 for s in model["stories"] if s["headline"]),
                              "complete": sum(1 for s in model["stories"] if s["complete"]),
                              "confidence": {k: conf.get(k, 0) for k in ("high", "medium", "low")},
                              "elements_by_kind": model["checks"]["elements_by_kind"],
                              "unassigned_elements": len(model["unassigned"]),
                              "unassigned_lines": len(model["unassigned_lines"]), "checks": model["checks"]})
        cv = model["coverage"]
        print(f"{smp['sid']} p{model['page']}: {len(model['stories'])} stories "
              f"({summary_pages[-1]['complete']} complete; {dict(conf)}), body lines in stories "
              f"{cv['body_lines_in_stories']}/{cv['body_lines_total']}, glyphs {cv['pct_glyphs_in_text_elements']} %")
    models = [m for _, m in models]
    if only:
        return
    agg = aggregate(models)
    by_split = {sp: aggregate([m for m in models if m["split"] == sp]) for sp in ("cal", "test")}
    summ = {"schema": "pageinator.page1.page_model_summary/1", "tool": TOOL, "dataset": ds.name,
            "samples": len(samples), "skipped_excluded_samples": skipped, "pages": summary_pages, "totals": agg,
            "by_split": by_split, "house_fonts": sorted(ctx["house_fonts"]), "display_fonts": sorted(ctx["display_fonts"])}
    sp = out_dir / "page_model_summary.json"
    sp.write_text(json.dumps(summ, ensure_ascii=False, indent=1), encoding="utf-8")
    os.chmod(sp, 0o600)
    # repo copy: AGGREGATES ONLY (no text, no sample ids, no dates, no publication name)
    digest = hashlib.sha256()
    for m in sorted(models, key=lambda m: (m["sample"], m["page"])):
        digest.update(json.dumps(m, ensure_ascii=False, sort_keys=True).encode("utf-8"))
    import pdfminer
    repo_out = {"schema": "pageinator.page1.page_model_coverage/1", "tool": TOOL,
                "env": {"python": platform.python_version(), "platform": platform.platform(terse=True),
                        "machine": platform.machine(), "pdfminer.six": pdfminer.__version__,
                        "pypdfium2": pdfium.PYPDFIUM_INFO.__str__(), "pdfium": pdfium.PDFIUM_INFO.__str__()},
                "dataset_class": "PILOT_EVIDENCE (private; aggregates only)",
                "samples": len(samples), "skipped_excluded_samples": len(skipped),
                "models_sha256": digest.hexdigest(), "totals": agg, "by_split": by_split}
    rdir = repo / "experiments" / "phase0" / "results" / "page1"
    rdir.mkdir(parents=True, exist_ok=True)
    rp = rdir / "page_model_coverage.json"
    os.umask(0o022)
    rp.write_text(json.dumps(repo_out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    t = agg["coverage"]
    print(f"{len(models)} pages: body lines in stories {t['pct_body_lines_in_stories']} %, text lines in elements "
          f"{t['pct_text_lines_in_elements']} %, glyphs in text elements {t['pct_glyphs_in_text_elements']} %; "
          f"stories {agg['stories']['total']} ({agg['stories']['complete']} complete) -> {sp} ; {rp}")


if __name__ == "__main__":
    main()
