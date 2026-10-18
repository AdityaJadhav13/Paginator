"""EXP-PUBLISHED-1 display text: headlines, decks/subheads, captions, kickers and bylines (EXPERIMENTAL).

Characterises the NON-body text of a dataset's press PDFs, with exact text, so that a headline composer can be tested
against what the paper actually printed. Evidence tooling only: nothing here is a layout decision. Data-driven: no
publication name, date or text is built in (the grid is estimated from the body frames; recurring furniture is found
by exact text repeated across editions).

Usage:  .venv/bin/python headlines.py <dataset_dir>          (run with PYTHONDONTWRITEBYTECODE=1)
Inputs: <dataset>/samples/<id>/{source.pdf,manifest.json}; <dataset>/work/<id>/corrected.json (else measure.json).
        Samples whose measurement has a top-level "excluded" key (duplicate exports) are skipped.
Outputs, written ONLY inside the dataset, mode 600 (they contain article text or words from it):
  report/headlines.jsonl          one object per classified frame; keys = RECORD_KEYS (lines[] = text, x0_mm, x1_mm,
                                  width_mm, baseline_pt, n_words = geometric tokens, words_width_pt = sum of token
                                  widths; checks = word_counts_match, unmapped, mixed_fonts, colour = dominant fill CMYK)
  report/headline_practice.json   aggregates by role (no article text): counts, fonts, size (pt and x body), lines per
                                  frame, alignment, grid/span, hscale, tracking, word space, balance, fill, words per
                                  line, line-break punctuation, colour, checks, merge statistics, split check
  report/headline_practice.md     the same as tables, plus top-30 line-final/line-initial words (private)

PIPELINE (per page; PDF points, y up; mm = pt x 25.4/72)
 1 Glyphs: actualtext.page_glyphs() (the validated /ActualText reader) once per page; a second pdfminer pass with the
   same device adds per-glyph fill colour and horizontal scale and is asserted glyph-for-glyph identical. Photos: PDFium
   image objects, bounds intersected with their clip paths (visible area), >= PHOTO_MIN_MM.
 2 Atoms: every line of every measure frame with is_body_candidate == false, plus body-frame lines whose glyphs are
   >= RECLAIM_SHARE in one bold font (headings that measure.py's body rule absorbed; reported as "reclaimed"). Glyphs
   are re-selected exactly as actualtext.line_text does (baseline +-0.15 em, glyph centre in the x-range); atoms whose
   glyph set lies inside another atom's are dropped.
 3 Body fragments are dropped, not classified: an atom in the page body font within measure.py's body size band
   (0.8-1.25 x page body size) that continues a body line in content order (only whitespace between) on the same
   baseline inside that frame's measure (+-1.5 mm), or on a baseline <= 2.5 em away overlapping it (transitively).
 4 MERGE. measure.py splits display lines at every word space wider than its 1 mm gutter test, so one 8-column
   headline arrives as up to ~18 one-word frames. Atoms on one baseline (+-0.15 em) are chained left to right when the
   right one FOLLOWS the left one in content-stream order with only whitespace glyphs between and no other glyph lies
   between them on that baseline (InDesign writes a line's glyphs consecutively; two stories side by side are not
   consecutive). Lines are then stacked into one frame when they have the same base font and size (+-0.3 pt), a
   baseline step of 0.5-2.5 em and the lower line follows the upper one in content order. Horizontal scale may differ
   per line. Frames entirely off the page are dropped.
 5 Geometric tokens are re-derived from each merged line: split where the gap to the running right edge
   >= TOKEN_GAP_EM x size. measure.py's 0.12 em (calibrated on body text) merges words in condensed, tightly spaced
   display type: on display lines (>= 1.2 x body) word-boundary gaps have p0.1 = 0.097 em while within-word gaps have
   p99.9 = 0.077 em. Both match rates are reported.

CLASSIFICATION (rule-based, applied in this order, first match wins). r = size / page body size (page mode);
bold = font name matches Bold/Black/Heavy/Semibold/Demi, or a display family (dataset median r >= 1.5);
body style = the page body font inside the body size band; "body-like" = a body line, a dropped fragment or a
body-style frame. Each record's role_reason starts with the rule id.
  other    O1 running text: >= RUNNING_TEXT_LINES lines and r < 1.5 (bold editorial columns, fact boxes)
  byline   B1 dateline: one line of <= 4 words ending ':' whose text continues on its baseline or is followed directly
              by body text; or ':' within the first 3 words of a <= 5-word line (r <= 1.6) followed by body text
  other    O2 number (<= 3 words, digits >= letters); O3 date/issue line (one line, a 4-digit year, r <= 1.6, top 25 %
              of the page); O6 parenthesised one-line jump line that continues a body flow; O7 top 5 % of the page, r < 2
  kicker   K1 one line, <= 4 words, bold or r >= 1.5, not continuing a body flow, directly above (descender to
              ascender -1 mm .. own size + 4 mm) a headline candidate with >= 2 more words that it overlaps by >= 50 %
              of its own width, at <= 1.25 x its size;  K2 one line, <= 3 words, white fill (reversed out of a bar)
  other    O4 recurring furniture: the exact text occurs in >= RECUR_EDITIONS editions (masthead, tagline, imprint,
              house ads, standing box labels, jump lines)
  byline   B2 <= 2 lines, r <= 1.3, starts with a dash followed by a letter, no digits (attribution)
  caption  C1 r <= 1.5, <= 4 lines, not numeric, touching a photo (top within 8 mm under its visible bottom, bottom
              within 4 mm over its top, or wholly inside it; x-extent within the photo +-3 mm) AND not body style,
              not the paragraph that follows a display headline above it, not heading body text that starts within
              1.6 x max(size, body) below (on these pages body-style lines beside photos are wrapped body text);
           C2 follows a caption in content order directly below it (two-part captions)
  deck/headline/kicker, in reading order, when the paragraph before it in content order is a headline (candidate)
              or deck H lying just above (H's last baseline to its first <= 1.2 x H size + 1.5 x own size, overlapping):
           D1 deck: < DECK_RATIO (0.85) x H's size and not body style (H becomes headline, H0)
           S  headline: 0.85-STACK_MAX (1.3) x H's size in H's font: a stacked headline paragraph (copyfit line)
           K3/D3: > 1.3 x H's size: H was an overline: kicker if one line <= 4 words, else deck ("strap")
           D2 deck without content-order adjacency: r >= 1.2, < 0.85 x a headline whose last baseline is <= 0.6 x
              its size + 1.5 x own size above, >= 50 % overlap, >= 20 % of its width
  in a text flow (bold, <= 3 lines, both content-order neighbours body-like, one directly above/below, overlapping):
           H3 headline r >= JUMPHEAD_R (jump heads); H4 headline r >= 1.1 or the next paragraph opens with a bold
              run-in ending ':' (brief headlines inside one flow); O9 other when every line spans the body measure;
              otherwise deck with role_reason "crosshead" (subhead between body paragraphs)
  headline H1 r >= DISPLAY_R (1.5), <= 8 lines;  H2 bold, r >= 0.85, <= 4 lines, >= 2 words, not ending '.'/danda, no
              body text on its baselines, and body lines starting within 3 x max(size, body) below cover >= 50 % of it
  other    O5 body style;  O8 anything else (tables, ads, box text, labels)

SPAN, GRID AND ALIGNMENT
  Grids are estimated from the body frames: the 8-column lattice from frames of the modal body width (left edges
  clustered, origin and pitch by least squares); the 6-column grid shares that text area and gutter. A frame's extent
  [min line x0, max line x1] is covered by columns a..b of each grid (ink in a gutter belongs to the column beside it).
  When the body frames directly below (top <= 40 mm under the frame, each >= 50 % under it) jointly cover the extent,
  a grid's error is the larger edge distance between their union and the grid span; otherwise it is the smallest of
  the worst-line edge errors for the hypotheses {all lines flush left, flush right, centred, full measure}. Smaller
  error wins (ties within 0.5 mm: better both-edge fit, then 8col); error > GRID_FIT_MM -> grid "none", span_cols
  null, span = that body union if present, else the frame's own extent.
  Alignment (multi-line): x0 and x1 equal (<= ALIGN_TOL_MM) -> justified (also: all but a shorter last line, >= 3
  lines); x0 equal -> left; x1 equal -> right; centres equal within max(ALIGN_TOL_MM, 0.15 em) (a trailing space is
  centred too) -> center; else unknown. One line -> "single-line"; its position in the span is aggregated separately.

CHECKS AND MEASURES
  word_counts_match: decoded whitespace-separated words == geometric tokens on every line; unmapped: "(cid:N)" glyphs;
  mixed_fonts: more than one base font among a line's glyphs; colour: dominant fill as CMYK (gray converted; pdfminer
  keeps a stale colour-space name after 'k', so the tuple length decides). Tracking = median gap between
  content-order-consecutive glyphs of a token / (size x hscale), in 1/1000 em (kerning pairs included: an estimate).
  Word space per line = (line width - sum of token widths) / (tokens - 1) / (size x hscale), in em.
  Frame ids are p<page>-b<n> in reading order (top baseline, then x); measure.py frame ids are not unique after merging.
"""
from __future__ import annotations

import argparse
import bisect
import ctypes
import json
import math
import os
import re
import statistics as st
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import actualtext as AT  # noqa: E402
import pypdfium2 as pdfium  # noqa: E402
import pypdfium2.raw as PR  # noqa: E402
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager  # noqa: E402
from pdfminer.pdfpage import PDFPage  # noqa: E402

MM = 72 / 25.4
BASELINE_EM = 0.15          # same-line tolerance (measure.py / actualtext.py)
TOKEN_GAP_EM = 0.08         # geometric word boundary for display lines (see docstring §5)
SIZE_TOL_PT = 0.3           # same size (measure.py body_size_band_pt)
VSTEP_EM = (0.5, 2.5)       # baseline step for stacking lines into one frame
FRAG_BAND = (0.8, 1.25)     # measure.py body_size_rel_band
RUNNING_TEXT_LINES = 6
DISPLAY_R = 1.5
SMALLHEAD_R = 1.1
DECK_RATIO = 0.85
STACK_MAX = 1.3
KICKER_MAX_RATIO = 1.25
D2_MIN_R = 1.2
SMALLHEAD_MIN_R = 0.85
JUMPHEAD_R = 1.4
PAGE_HEAD = 0.05
RECLAIM_SHARE = 0.95      # a body-frame line is reclaimed as a heading when >= 95 % of its glyphs are in one bold font
CAPTION_MAX_R = 1.5
RECUR_EDITIONS = 3
PHOTO_MIN_MM = (15.0, 10.0)
GRID_FIT_MM = 2.0
ALIGN_TOL_MM = 0.8
ALIGN_CENTER_EM = 0.15    # centred lines may differ by half a word space (a trailing space counted in centring)
ALIGN_RIGHT_EM = 0.3
OVERHANG_MM = 1.5
ROLES = ("headline", "deck", "caption", "kicker", "byline", "other")
RECORD_KEYS = ("id", "sample", "edition_date", "page", "role", "role_reason", "font", "size_pt", "hscale", "leading_pt",
               "frame_x0_mm", "frame_x1_mm", "top_baseline_pt", "span_cols", "grid", "span_x0_mm", "span_width_mm",
               "alignment", "text", "lines", "checks")
BOLD_RE = re.compile(r"bold|black|heavy|semibold|demi", re.I)
YEAR_RE = re.compile(r"(?<![0-9०-९])[12१२][0-9०-९]{3}(?![0-9०-९])")
DIGITS = set("0123456789०१२३४५६७८९")
DASHES = ("-", "–", "—", "‐", "‑")


# ------------------------------------------------------------------------------------------------- small helpers
def base_font(name):
    return name.split("+", 1)[1] if name and len(name) > 7 and name[6] == "+" else (name or "")


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def dist(xs, nd=3):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {"n": len(xs), "min": round(min(xs), nd), "p10": round(q(xs, .1), nd), "median": round(q(xs, .5), nd),
            "p90": round(q(xs, .9), nd), "max": round(max(xs), nd)}


def share(n, d):
    return round(n / d, 4) if d else None


def is_punct(ch):
    return unicodedata.category(ch).startswith("P") or ch in "–—‐‑…"


def strip_punct(w):
    i, j = 0, len(w)
    while i < j and is_punct(w[i]):
        i += 1
    while j > i and is_punct(w[j - 1]):
        j -= 1
    return w[i:j]


def deva_share(text):
    letters = [ch for ch in text if ch.isalpha() or "ऀ" <= ch <= "ॿ"]
    return sum("ऀ" <= ch <= "ॿ" for ch in letters) / len(letters) if letters else 0.0


def invalid_deva(text):
    """Words starting with a combining mark (matra/virama/nukta) cannot be valid Unicode Devanagari: a sign the PDF
    has no ActualText for that run and its ToUnicode is in glyph (visual) order."""
    return sum(1 for w in text.split() if w and unicodedata.category(w[0]) in ("Mn", "Mc"))


def wpath(dataset, sid):
    w = dataset / "work" / sid
    return w / "corrected.json" if (w / "corrected.json").exists() else w / "measure.json"


# ------------------------------------------------------------------------------------------------- PDF reading
class _ExtraDevice(AT._ATDevice):
    """actualtext's device, additionally recording fill colour and horizontal scale per glyph (same glyph order)."""

    def __init__(self, rsrc):
        super().__init__(rsrc)
        self.extra = []

    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate):
        adv = super().render_char(matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate)
        ch = self.cur_item._objs[-1]
        self.extra.append((getattr(ncs, "name", None), graphicstate.ncolor, ch.x0, ch.matrix))
        return adv


def _cmyk(cs, v):
    # pdfminer keeps the colour-space name of the last 'cs' even after 'k'; the tuple length is authoritative
    if isinstance(v, (tuple, list)) and len(v) == 4:
        return tuple(round(float(x), 3) for x in v)
    if isinstance(v, (int, float)) and cs in (None, "DeviceGray"):
        return (0.0, 0.0, 0.0, round(1 - float(v), 3))
    return None


def page_glyphs(pdf, page_no):
    G = AT.page_glyphs(pdf, page_no)
    rsrc = PDFResourceManager()
    dev = _ExtraDevice(rsrc)
    interp = PDFPageInterpreter(rsrc, dev)
    with open(pdf, "rb") as fh:
        for i, pg in enumerate(PDFPage.get_pages(fh), 1):
            if i == page_no:
                interp.process_page(pg)
                break
    if len(dev.extra) != len(G):
        raise RuntimeError(f"{pdf} p{page_no}: second pass glyph count differs")
    for g, (cs, col, x0, m) in zip(G, dev.extra):
        if abs(x0 - g["x0"]) > 1e-9 or abs(m[5] - g["by"]) > 1e-9:
            raise RuntimeError(f"{pdf} p{page_no}: second pass glyph order differs")
        g["cmyk"] = _cmyk(cs, col)
        g["hs"] = (m[0] / m[3]) if m[3] else 1.0
    return G


def photos(pdf_doc, page_no):
    """Visible image areas (bounds ∩ clip-path boxes) of image objects >= PHOTO_MIN_MM, in pt."""
    out = []
    page = pdf_doc[page_no - 1]
    for obj in page.get_objects(max_depth=8):
        if obj.type != PR.FPDF_PAGEOBJ_IMAGE:
            continue
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
        if r - l >= PHOTO_MIN_MM[0] * MM and t - b >= PHOTO_MIN_MM[1] * MM:
            out.append((l, b, r, t))
    return out


# ------------------------------------------------------------------------------------------------- atoms → frames
class GlyphIndex:
    def __init__(self, G):
        self.G = G
        self.order = sorted(range(len(G)), key=lambda i: G[i]["by"])
        self.keys = [G[i]["by"] for i in self.order]

    def line(self, by, x0, x1, size):
        lo = bisect.bisect_left(self.keys, by - BASELINE_EM * size)
        hi = bisect.bisect_right(self.keys, by + BASELINE_EM * size)
        out = []
        for k in range(lo, hi):
            g = self.G[self.order[k]]
            if g["upright"] and x0 - 1.0 <= (g["x0"] + g["x1"]) / 2 <= x1 + 1.0:
                out.append(g)
        return out


def make_atom(GI, f, ln):
    toks = ln["tokens"]
    if not toks:
        return None
    x0 = min(t["x0"] for t in toks)
    x1 = max(t["x1"] for t in toks)
    sel = GI.line(ln["baseline_pt"], x0, x1, f["size_pt"] or 10)
    ink = [g for g in sel if g["text"].strip()]
    if not ink:
        return None
    return {"fid": f["id"], "frame": f, "by": ln["baseline_pt"], "x0": x0, "x1": x1, "ntok_measure": len(toks),
            "font": Counter(base_font(g["font"]) for g in ink).most_common(1)[0][0],
            "size": Counter(round(g["size"], 1) for g in ink).most_common(1)[0][0],
            "idx": sorted(g["i"] for g in sel)}


def only_space_between(G, a_max, b_min):
    return b_min > a_max and all(not G[k]["text"].strip() for k in range(a_max + 1, b_min))


def prev_ink(G, i):
    k = i - 1
    while k >= 0 and not G[k]["text"].strip():
        k -= 1
    return k


def next_ink(G, i):
    k = i + 1
    while k < len(G) and not G[k]["text"].strip():
        k += 1
    return k


def tokens_of(glyphs):
    ink = sorted([g for g in glyphs if g["text"].strip()], key=lambda g: (g["x0"], g["x1"]))
    out, cur, right = [], [], None
    for g in ink:
        if cur and g["x0"] - right >= TOKEN_GAP_EM * g["size"]:
            out.append(cur)
            cur, right = [], None
        cur.append(g)
        right = g["x1"] if right is None else max(right, g["x1"])
    if cur:
        out.append(cur)
    return out


def foreign_between(GI, a, b):
    own = set(a["idx"]) | set(b["idx"])
    size = max(a["size"], b["size"])
    return any(g["text"].strip() and g["i"] not in own for g in GI.line(a["by"], a["x1"] + 1.5, b["x0"] - 1.5, size)
               if a["x1"] + 0.5 < (g["x0"] + g["x1"]) / 2 < b["x0"] - 0.5)


def chain_lines(G, GI, atoms):
    used, chains = set(), []
    for a in sorted(atoms, key=lambda a: (-a["by"], a["x0"])):
        if id(a) in used:
            continue
        chain = [a]
        used.add(id(a))
        while True:
            last = chain[-1]
            nxt = [b for b in atoms if id(b) not in used
                   and abs(b["by"] - last["by"]) <= BASELINE_EM * max(b["size"], last["size"])
                   and b["x0"] >= last["x1"] - 1.0 and only_space_between(G, last["idx"][-1], b["idx"][0])
                   and not foreign_between(GI, last, b)]
            if not nxt:
                break
            b = min(nxt, key=lambda b: b["x0"])
            chain.append(b)
            used.add(id(b))
        chains.append(chain)
    lines = []
    for ch in chains:
        idx = sorted({i for a in ch for i in a["idx"]})
        gl = [G[i] for i in idx]
        ink = [g for g in gl if g["text"].strip()]
        lines.append({"atoms": ch, "idx": idx, "glyphs": gl, "by": st.median(a["by"] for a in ch),
                      "x0": min(g["x0"] for g in ink), "x1": max(g["x1"] for g in ink),
                      "font": Counter(base_font(g["font"]) for g in ink).most_common(1)[0][0],
                      "size": Counter(round(g["size"], 1) for g in ink).most_common(1)[0][0],
                      "hs": round(st.median(g["hs"] for g in ink), 4), "tokens": tokens_of(gl),
                      "ntok_measure": sum(a["ntok_measure"] for a in ch)})
    return lines


def stack_frames(G, lines):
    lines = sorted(lines, key=lambda l: -l["by"])
    frames = []
    for l in lines:
        best = None
        for fr in frames:
            p = fr["lines"][-1]
            d = p["by"] - l["by"]
            if p["font"] == l["font"] and abs(p["size"] - l["size"]) <= SIZE_TOL_PT \
                    and VSTEP_EM[0] * l["size"] <= d <= VSTEP_EM[1] * l["size"] \
                    and only_space_between(G, p["idx"][-1], l["idx"][0]) and (best is None or d < best[0]):
                best = (d, fr)
        if best:
            best[1]["lines"].append(l)
        else:
            frames.append({"lines": [l]})
    return frames


def build_page(G, pg):
    """Non-body frames of one measured page, plus body anchors for context."""
    GI = GlyphIndex(G)
    body_font, body_size = pg["body_font_page_mode"], pg["body_size_pt_page_mode"]
    nb = [a for f in pg["frames"] if not f["is_body_candidate"] for ln in f["lines"] for a in [make_atom(GI, f, ln)] if a]
    body, n_reclaimed = [], 0
    for f in pg["frames"]:
        if not f["is_body_candidate"]:
            continue
        for ln in f["lines"]:
            a = make_atom(GI, f, ln)
            if not a:
                continue
            ink = [G[i] for i in a["idx"] if G[i]["text"].strip()]
            maj, cnt = Counter(base_font(g["font"]) for g in ink).most_common(1)[0]
            if maj != body_font and BOLD_RE.search(maj) and cnt >= RECLAIM_SHARE * len(ink):
                a["reclaimed"] = True
                nb.append(a)
                n_reclaimed += 1
            else:
                body.append(a)
    sets = [set(a["idx"]) for a in nb]
    dup = {k for k, sk in enumerate(sets) for j, sj in enumerate(sets) if j != k and sk <= sj and (len(sk) < len(sj) or j < k)}
    nb = [a for k, a in enumerate(nb) if k not in dup]
    lo, hi = FRAG_BAND[0] * body_size, FRAG_BAND[1] * body_size
    anchors = list(body)
    by_end, by_start = defaultdict(list), defaultdict(list)
    for a in anchors:
        by_end[a["idx"][-1]].append(a)
        by_start[a["idx"][0]].append(a)
    frag, changed = set(), True
    while changed:
        changed = False
        for a in nb:
            if id(a) in frag or a["font"] != body_font or not lo <= a["size"] <= hi:
                continue
            cands = by_end.get(prev_ink(G, a["idx"][0]), []) + by_start.get(next_ink(G, a["idx"][-1]), [])
            for b in cands:
                fr = b["frame"]
                same = abs(b["by"] - a["by"]) <= BASELINE_EM * a["size"]
                inside = fr["column_left_mm"] * MM - OVERHANG_MM * MM <= a["x0"] and a["x1"] <= fr["right_edge_mm"] * MM + OVERHANG_MM * MM
                near = abs(b["by"] - a["by"]) <= 2.5 * a["size"] and min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]) > 0
                if (same and inside) or (not same and near):
                    frag.add(id(a))
                    a = dict(a, frame=fr)
                    anchors.append(a)
                    by_end[a["idx"][-1]].append(a)
                    by_start[a["idx"][0]].append(a)
                    changed = True
                    break
    atoms = [a for a in nb if id(a) not in frag]
    frames = stack_frames(G, chain_lines(G, GI, atoms))
    pw = pg.get("page_w_mm") or 1e9
    n_off = sum(1 for fr in frames if max(l["x1"] for l in fr["lines"]) <= 0 or min(l["x0"] for l in fr["lines"]) >= pw * MM)
    frames = [fr for fr in frames if not (max(l["x1"] for l in fr["lines"]) <= 0 or min(l["x0"] for l in fr["lines"]) >= pw * MM)]
    for fr in frames:
        ls = fr["lines"]
        ink = [g for l in ls for g in l["glyphs"] if g["text"].strip()]
        fr.update(font=Counter(base_font(g["font"]) for g in ink).most_common(1)[0][0],
                  size=Counter(l["size"] for l in ls).most_common(1)[0][0],
                  hs=round(st.median(l["hs"] for l in ls), 4),
                  x0=min(l["x0"] for l in ls), x1=max(l["x1"] for l in ls), top=ls[0]["by"], bot=ls[-1]["by"],
                  imin=min(l["idx"][0] for l in ls), imax=max(l["idx"][-1] for l in ls),
                  cmyk=Counter(g["cmyk"] for g in ink).most_common(1)[0][0])
        for l in ls:
            l["at"] = AT.line_text(G, l["by"], l["x0"], l["x1"], l["size"])
        fr["text"] = " ".join(l["at"]["text"] for l in ls)
        fr["words"] = len(fr["text"].split())
    frames.sort(key=lambda f: (-round(f["top"], 1), f["x0"]))
    owner = {}
    for a in anchors:                       # body lines and dropped body fragments
        for i in a["idx"]:
            owner[i] = ("body", a)
    for k, fr in enumerate(frames):
        fr["fid"] = f"p{pg['page']}-b{k + 1}"
        for l in fr["lines"]:
            for i in l["idx"]:
                owner.setdefault(i, ("frame", k))
    for fr in frames:                       # content-order neighbours (the glyph list is not kept)
        j = next_ink(G, fr["imax"])
        fr["prev_owner"] = owner.get(prev_ink(G, fr["imin"]))
        fr["next_owner"] = owner.get(j)
        fr["next_glyph"] = (G[j]["by"], G[j]["x0"]) if j < len(G) else None
        fr["reclaimed"] = any(a.get("reclaimed") for l in fr["lines"] for a in l["atoms"])
        # does the following paragraph open with a run-in dateline (bold glyphs ending in ':' on its first baseline)?
        run, k = [], j
        while k < len(G) and len(run) < 40 and abs(G[k]["by"] - G[j]["by"]) <= BASELINE_EM * G[j]["size"]:
            if G[k]["text"].strip():
                if not BOLD_RE.search(base_font(G[k]["font"])):
                    break
                run.append(G[k]["text"])
            k += 1
        fr["next_runin"] = ":" in "".join(run)
    return frames, anchors, len(frag), len(dup), n_reclaimed, n_off


# ------------------------------------------------------------------------------------------------- grid
def estimate_grids(docs):
    """8-col lattice from body frames of the modal width; 6-col grid on the same text area and gutter."""
    widths, frames = Counter(), []
    for doc in docs:
        for pg in doc["pages"]:
            for f in pg["frames"]:
                if f["is_body_candidate"] and not f.get("excluded") and f.get("width_confidence") == "DERIVED":
                    widths[round(f["width_mm"] * 2) / 2] += 1
                    frames.append(f)
    w8 = widths.most_common(1)[0][0]
    lefts = sorted(f["column_left_mm"] for f in frames if abs(f["width_mm"] - w8) <= 0.6)
    clusters, cur = [], [lefts[0]]
    for x in lefts[1:]:
        if x - cur[-1] > 5.0:
            clusters.append(cur)
            cur = []
        cur.append(x)
    clusters.append(cur)
    cl = [st.median(c) for c in clusters if len(c) >= 3]
    step = st.median(b - a for a, b in zip(cl, cl[1:]))
    ks = [round((c - cl[0]) / step) for c in cl]
    n = len(cl)
    mk, mc = sum(ks) / n, sum(cl) / n
    pitch = sum((k - mk) * (c - mc) for k, c in zip(ks, cl)) / sum((k - mk) ** 2 for k in ks)
    origin = mc - pitch * mk
    ncol = max(ks) + 1
    resid = [abs(x - (origin + round((x - origin) / pitch) * pitch)) for x in lefts]
    gutter = pitch - w8
    area = (ncol - 1) * pitch + w8
    w6 = (area - 5 * gutter) / 6
    grids = {"8col": {"origin": origin, "pitch": pitch, "width": w8, "n": ncol},
             "6col": {"origin": origin, "pitch": w6 + gutter, "width": w6, "n": 6}}
    w6_lefts = [f["column_left_mm"] for f in frames if abs(f["width_mm"] - w6) <= 0.6]
    on6 = sum(1 for x in w6_lefts if abs(x - (origin + round((x - origin) / (w6 + gutter)) * (w6 + gutter))) <= 1.0)
    info = {"body_frames": len(frames), "modal_width_mm": w8, "frames_at_modal_width": len(lefts),
            "lattice_residual_mm": dist(resid, 3), "gutter_mm": round(gutter, 3), "text_area_mm": [round(origin, 3), round(origin + area, 3)],
            "6col_width_mm": round(w6, 3), "6col_frames_at_width": len(w6_lefts), "6col_frames_on_lattice_1mm": on6}
    for g in grids.values():
        g.update({k: round(v, 4) for k, v in g.items() if isinstance(v, float)})
    return grids, info


def cover(g, x0, x1):
    o, p, w, n = g["origin"], g["pitch"], g["width"], g["n"]
    a = max(0, min(n - 1, math.ceil((x0 - o - w) / p)))
    b = max(a, min(n - 1, math.floor((x1 - o) / p)))
    return a, b, o + a * p, o + b * p + w


def edge_error(lines_mm, s0, s1):
    """(best-hypothesis error, both-edges error) in mm: hypotheses are all lines flush left, flush right, centred,
    or full measure; the second value breaks ties between grids that share an edge (e.g. the page margin)."""
    sc = (s0 + s1) / 2
    full = max(max(abs(a - s0), abs(s1 - b)) for a, b in lines_mm)
    hyp = (max(abs(a - s0) for a, b in lines_mm), max(abs(s1 - b) for a, b in lines_mm),
           max(abs((a + b) / 2 - sc) for a, b in lines_mm), full)
    return min(hyp), full


def fit_span(grids, fr, body_union):
    lines_mm = [(l["x0"] / MM, l["x1"] / MM) for l in fr["lines"]]
    x0, x1 = fr["x0"] / MM, fr["x1"] / MM
    res = {}
    for name, g in grids.items():
        a, b, s0, s1 = cover(g, x0, x1)
        if body_union:
            err = (max(abs(s0 - body_union[0]), abs(s1 - body_union[1])),) * 2
        else:
            err = edge_error(lines_mm, s0, s1)
        res[name] = (err, b - a + 1, s0, s1)
    # smaller primary error wins; within 0.5 mm the better both-edge fit wins; then 8col
    best = min(res, key=lambda k: (round(res[k][0][0] / 0.5), res[k][0][1] - (0.3 if k == "8col" else 0.0)))
    if res[best][0][0] <= GRID_FIT_MM:
        err, ncols, s0, s1 = res[best]
        return best, ncols, s0, s1
    if body_union:
        return "none", None, body_union[0], body_union[1]
    return "none", None, x0, x1


def body_union_below(fr, body_frames):
    x0, x1 = fr["x0"] / MM, fr["x1"] / MM
    sel = [f for f in body_frames if 0 < fr["bot"] - f["top_baseline_pt"] <= 40 * MM + fr["size"]
           and min(f["right_edge_mm"], x1) - max(f["column_left_mm"], x0) >= 0.5 * f["width_mm"]]
    if not sel:
        return None
    u0, u1 = min(f["column_left_mm"] for f in sel), max(f["right_edge_mm"] for f in sel)
    return (u0, u1) if u0 <= x0 + 2.0 and u1 >= x1 - 2.0 else None


def alignment(fr, s0, s1):
    ls = [(l["x0"] / MM, l["x1"] / MM) for l in fr["lines"]]
    if len(ls) == 1:
        return "single-line"
    t = ALIGN_TOL_MM
    em = fr["size"] * (fr["hs"] or 1.0) / MM          # one (scaled) em in mm
    tc, tr = max(t, ALIGN_CENTER_EM * em), max(t, ALIGN_RIGHT_EM * em)
    sp = lambda v: max(v) - min(v)  # noqa: E731
    x0s, x1s, cs = [a for a, b in ls], [b for a, b in ls], [(a + b) / 2 for a, b in ls]
    if sp(x0s) <= t and sp(x1s) <= t:
        return "justified"
    if sp(x0s) <= t and sp(x1s[:-1]) <= t and len(ls) >= 3 and x1s[-1] < min(x1s[:-1]) - t:
        return "justified"
    if sp(x0s) <= t:
        return "left"
    if sp(x1s) <= tr and sp(x0s) > tr:
        return "right"
    if sp(cs) <= tc:
        return "center"
    return "unknown"


def single_line_position(l, s0, s1):
    a, b = l["x0"] / MM, l["x1"] / MM
    t = GRID_FIT_MM
    if abs(a - s0) <= t and abs(s1 - b) <= t:
        return "full"
    if abs((a + b) / 2 - (s0 + s1) / 2) <= t and abs(a - s0) > t:
        return "center"
    if abs(a - s0) <= t:
        return "left"
    if abs(s1 - b) <= t:
        return "right"
    return "other"


# ------------------------------------------------------------------------------------------------- classification
def is_bold(font, display_fonts):
    return bool(BOLD_RE.search(font)) or font in display_fonts


def overlap(a0, a1, b0, b1):
    return min(a1, b1) - max(a0, b0)


def classify_page(P, ctx):
    """Assign role + role_reason to every frame of one page (rules in the module docstring; first match wins)."""
    frames, body, B, photos_pt, H = P["frames"], P["body"], P["body_size"], P["photos"], P["page_h"]
    for fr in frames:
        fr["r"] = fr["size"] / B
        fr["bold"] = is_bold(fr["font"], ctx["display_fonts"])
        fr["bodystyle"] = fr["font"] == P["body_font"] and FRAG_BAND[0] * B <= fr["size"] <= FRAG_BAND[1] * B
        fr["role"] = None
    tag = lambda fr: " [incl. bold lines reclaimed from a body frame]" if fr["reclaimed"] else ""  # noqa: E731

    def setr(fr, role, why):
        if fr["role"] is None:
            fr["role"], fr["role_reason"] = role, why + tag(fr)

    def hc(fr):  # headline candidate (typography only)
        return fr["role"] is None and len(fr["lines"]) <= 6 and (
            fr["r"] >= DISPLAY_R or (fr["bold"] and fr["r"] >= SMALLHEAD_R and len(fr["lines"]) <= 4))

    def width(fr):
        return fr["x1"] - fr["x0"]

    def body_below(fr, reach):
        """Body lines starting within `reach` below the frame cover >= 50 % of its width (union of the lines)."""
        iv = sorted((max(a["x0"], fr["x0"]), min(a["x1"], fr["x1"])) for a in body
                    if 0 < fr["bot"] - a["by"] <= reach and overlap(fr["x0"], fr["x1"], a["x0"], a["x1"]) > 0)
        cov, end = 0.0, None
        for a, b in iv:
            if end is None or a > end:
                cov += b - a
                end = b
            elif b > end:
                cov += b - end
                end = b
        return cov >= 0.5 * width(fr)

    def bodylike(o):
        """(by_top, by_bottom, x0, x1) of a content-order neighbour that is body text (a body line, a dropped
        fragment, or a frame in body style); None otherwise."""
        if not o:
            return None
        if o[0] == "body":
            a = o[1]
            return a["by"], a["by"], a["x0"], a["x1"]
        f2 = frames[o[1]]
        return (f2["top"], f2["bot"], f2["x0"], f2["x1"]) if f2["bodystyle"] else None

    def flow_above(fr):  # the text before it in content order is body text on its baseline or the line above
        a = bodylike(fr["prev_owner"])
        return bool(a and -BASELINE_EM * fr["size"] <= a[1] - fr["top"] <= 1.6 * max(fr["size"], B))

    def standalone(fr):
        return not any(abs(a["by"] - l["by"]) <= BASELINE_EM * fr["size"] and overlap(l["x0"] - 3 * MM, l["x1"] + 3 * MM, a["x0"], a["x1"]) > 0
                       for l in fr["lines"] for a in body)

    def numeric(t):
        d = sum(ch in DIGITS for ch in t)
        a = sum(ch.isalpha() for ch in t)
        return d > 0 and d >= a

    # 1. hard rules
    for fr in frames:
        n, t = len(fr["lines"]), fr["text"].strip()
        if n >= RUNNING_TEXT_LINES and fr["r"] < DISPLAY_R:
            setr(fr, "other", f"O1 running text: {n} lines at {fr['r']:.2f}x body")
        ng = fr["next_glyph"]
        runon = bool(ng and abs(ng[0] - fr["lines"][0]["by"]) <= BASELINE_EM * fr["size"] and ng[1] >= fr["x1"] - 1.0)
        if n == 1 and fr["words"] <= 4 and t.endswith(":"):
            nb_ = bodylike(fr["next_owner"])
            if runon:
                setr(fr, "byline", "B1 run-in dateline (ends ':' and the text continues on its baseline)")
            elif nb_ and 0 < fr["bot"] - nb_[0] <= 1.6 * max(fr["size"], B):
                setr(fr, "byline", "B1 dateline line (ends ':' and body text follows directly below)")
        if n == 1 and fr["words"] <= 5 and ":" in " ".join(t.split()[:3]) and fr["r"] <= 1.6:
            nb_ = bodylike(fr["next_owner"])
            if runon or (nb_ and 0 < fr["bot"] - nb_[0] <= 1.6 * max(fr["size"], B)):
                setr(fr, "byline", "B1 run-in dateline (':' in its first words, body text continues)")

        if fr["words"] <= 3 and numeric(t):
            setr(fr, "other", "O2 number (folio, phone, date box)")
        if n == 1 and YEAR_RE.search(t) and fr["r"] <= 1.6 and (H - fr["top"]) <= 0.25 * H:
            setr(fr, "other", "O3 date/issue line in the page head")
        if n == 1 and fr["words"] <= 5 and t[:1] == "(" and t[-1:] == ")" and flow_above(fr):
            setr(fr, "other", "O6 jump line closing a text flow")
        if (H - fr["top"]) <= PAGE_HEAD * H and fr["r"] < 2.0:
            setr(fr, "other", "O7 page-head zone (top 5 % of the page)")
    # 2. kickers
    for fr in frames:
        if fr["role"] is not None or len(fr["lines"]) != 1:
            continue
        if fr["words"] <= 4 and (fr["bold"] or fr["r"] >= DISPLAY_R) and not flow_above(fr):
            desc = fr["top"] - 0.25 * fr["size"]
            for h in frames:
                if h is fr or not hc(h) or fr["size"] > KICKER_MAX_RATIO * h["size"] or h["words"] < fr["words"] + 2:
                    continue
                gap = desc - (h["top"] + 0.8 * h["size"])
                if -1 * MM <= gap <= fr["size"] + 4 * MM and overlap(fr["x0"], fr["x1"], h["x0"], h["x1"]) >= 0.5 * width(fr):
                    setr(fr, "kicker", "K1 short label directly above a headline")
                    break
        if fr["words"] <= 3 and fr["cmyk"] is not None and sum(fr["cmyk"]) <= 0.05:
            setr(fr, "kicker", "K2 short reversed (white) label")
    # 3. recurring furniture
    for fr in frames:
        if len(ctx["recur"].get(fr["text"], ())) >= RECUR_EDITIONS:
            setr(fr, "other", f"O4 recurring text ({len(ctx['recur'][fr['text']])} editions)")
    for fr in frames:
        t = fr["text"].strip()
        if len(fr["lines"]) <= 2 and fr["r"] <= 1.3 and t[:1] in DASHES and t[1:].strip()[:1].isalpha() \
                and not any(ch in DIGITS for ch in t):
            setr(fr, "byline", "B2 attribution starting with a dash")
    # 4. captions: a non-body style, beside a photo, not heading body text, not the paragraph after a display headline
    def photo_relation(fr):
        top_ink, bot_ink = fr["top"] + 0.75 * fr["size"], fr["bot"] - 0.25 * fr["size"]
        for (l, b, r, t) in photos_pt:
            if not (l - 3 * MM <= fr["x0"] and fr["x1"] <= r + 3 * MM):
                continue
            if b - 8 * MM <= top_ink <= b + 1 * MM:
                return "under a photo"
            if t - 1 * MM <= bot_ink <= t + 4 * MM:
                return "over a photo"
            if b <= bot_ink and top_ink <= t:
                return "label inside a photo"
        return None

    for fr in frames:
        if fr["role"] is not None or fr["r"] > CAPTION_MAX_R or len(fr["lines"]) > 4 or numeric(fr["text"]):
            continue
        rel = photo_relation(fr)
        if not rel:
            continue
        if fr["bodystyle"]:
            ctx["stats"]["caption_rejected_body_style"] += 1
            continue
        o = fr["prev_owner"]
        if o and o[0] == "frame" and frames[o[1]]["r"] >= DISPLAY_R and frames[o[1]]["bot"] > fr["top"]:
            ctx["stats"]["caption_rejected_follows_display_headline"] += 1
            continue
        if body_below(fr, 1.6 * max(fr["size"], B)):
            ctx["stats"]["caption_rejected_heads_body_text"] += 1
            continue
        setr(fr, "caption", "C1 " + rel)
    order = sorted(range(len(frames)), key=lambda k: (-frames[k]["top"], frames[k]["x0"]))
    for k in order:
        fr = frames[k]
        o = fr["prev_owner"]
        if fr["role"] is None and fr["r"] <= CAPTION_MAX_R and len(fr["lines"]) <= 4 and o and o[0] == "frame" \
                and frames[o[1]]["role"] == "caption":
            c = frames[o[1]]
            if 0 < c["bot"] - fr["top"] <= 3 * fr["size"] and overlap(fr["x0"], fr["x1"], c["x0"], c["x1"]) > 0:
                setr(fr, "caption", "C2 continues the caption above (content order)")
    # 5. decks, stacked headline paragraphs and overlines (reading order, so deck chains resolve)
    for k in order:
        fr = frames[k]
        if fr["role"] is not None or len(fr["lines"]) > 4:
            continue
        o = fr["prev_owner"]
        if o and o[0] == "frame":
            h = frames[o[1]]
            if h is not fr and (h["role"] in ("headline", "deck") or hc(h)) \
                    and 0 < h["bot"] - fr["top"] <= 1.2 * h["size"] + 1.5 * fr["size"] \
                    and overlap(fr["x0"], fr["x1"], h["x0"], h["x1"]) > 0:
                ratio = fr["size"] / h["size"]
                if ratio < DECK_RATIO and not fr["bodystyle"]:
                    setr(fr, "deck", f"D1 follows the {'deck' if h['role'] == 'deck' else 'headline'} in content order at {ratio:.2f}x its size")
                    setr(h, "headline", "H0 headline followed by its deck in content order")
                elif h["role"] != "deck":
                    if ratio > STACK_MAX and h["role"] is None:
                        if h["words"] <= 4 and len(h["lines"]) == 1:
                            setr(h, "kicker", f"K3 short label above a {ratio:.2f}x larger headline (content order)")
                        else:
                            setr(h, "deck", f"D3 strap above a {ratio:.2f}x larger headline (content order)")
                    elif fr["font"] == h["font"] and ratio <= STACK_MAX:
                        setr(fr, "headline", f"S stacked headline paragraph at {ratio:.2f}x the one above (same font, content order)")
                        setr(h, "headline", "H0 headline continued by a stacked paragraph")
        if fr["role"] is None and fr["r"] >= D2_MIN_R:
            for h in frames:
                if h is fr or not (h["role"] == "headline" or hc(h)) or fr["size"] >= DECK_RATIO * h["size"]:
                    continue
                gap = h["bot"] - fr["top"]
                if 0 < gap <= 0.6 * h["size"] + 1.5 * fr["size"] and overlap(fr["x0"], fr["x1"], h["x0"], h["x1"]) >= 0.5 * width(fr) \
                        and width(fr) >= 0.2 * width(h):
                    setr(fr, "deck", f"D2 directly below a headline at {fr['size'] / h['size']:.2f}x its size")
                    break
    # 6. headings inside a text flow: crosshead, brief headline (next paragraph opens with a run-in dateline), jump head
    for fr in frames:
        if fr["role"] is not None or not fr["bold"] or len(fr["lines"]) > 3:
            continue
        pa, na = bodylike(fr["prev_owner"]), bodylike(fr["next_owner"])
        if not (pa and na):
            continue
        adj_above = 0 < pa[1] - fr["top"] <= 3 * B + fr["size"] and overlap(fr["x0"], fr["x1"], pa[2], pa[3]) > 0
        adj_below = 0 < fr["bot"] - na[0] <= 3 * B + fr["size"] and overlap(fr["x0"], fr["x1"], na[2], na[3]) > 0
        if not (adj_above or adj_below):
            continue
        ref = [x for x, ok in ((pa, adj_above), (na, adj_below)) if ok]
        if fr["r"] >= JUMPHEAD_R:
            setr(fr, "headline", f"H3 heading inside a text flow at {fr['r']:.2f}x body (jump head)")
        elif fr["next_runin"] or fr["r"] >= SMALLHEAD_R:
            setr(fr, "headline", f"H4 small headline inside a text flow at {fr['r']:.2f}x body"
                 + (" (next paragraph opens with a run-in dateline)" if fr["next_runin"] else ""))
        elif all(abs(l["x0"] - min(x[2] for x in ref)) <= 1 * MM and abs(l["x1"] - max(x[3] for x in ref)) <= 1 * MM for l in fr["lines"]):
            setr(fr, "other", "O9 bold text set to the body measure inside a text flow")
        else:
            setr(fr, "deck", "crosshead: bold line(s) between body paragraphs of one text flow")
    # 7. headlines
    for fr in frames:
        if fr["role"] is not None:
            continue
        if fr["r"] >= DISPLAY_R and len(fr["lines"]) <= 8:
            setr(fr, "headline", f"H1 display size {fr['r']:.2f}x body")
        elif fr["bold"] and fr["r"] >= SMALLHEAD_MIN_R and len(fr["lines"]) <= 4 and fr["words"] >= 2 \
                and fr["text"].rstrip()[-1:] not in (".", "।") and standalone(fr) and body_below(fr, 3 * max(fr["size"], B)):
            setr(fr, "headline", f"H2 bold {fr['r']:.2f}x body heading the body text below")
    # 8. bylines and the rest
    for fr in frames:
        if fr["bodystyle"]:
            setr(fr, "other", "O5 body-style text outside the measured body frames")
        setr(fr, "other", f"O8 unclassified {fr['font']} {fr['r']:.2f}x body, {len(fr['lines'])} line(s)")


# ------------------------------------------------------------------------------------------------- records
def tracking_1000em(fr):
    vals = []
    for l in fr["lines"]:
        for tok in l["tokens"]:
            ids = sorted(g["i"] for g in tok)
            byi = {g["i"]: g for g in tok}
            for i, j in zip(ids, ids[1:]):
                if j == i + 1:
                    a, b = byi[i], byi[j]
                    if b["x0"] >= a["x0"]:
                        vals.append((b["x0"] - a["x1"]) / (b["size"] * (b["hs"] or 1.0)) * 1000)
    return round(st.median(vals), 1) if len(vals) >= 5 else None


def record(sid, man, P, fr, grids):
    union = body_union_below(fr, P["body_frames"])
    grid, ncols, s0, s1 = fit_span(grids, fr, union)
    lines, wc_ok, unm, mixed = [], True, 0, False
    for l in fr["lines"]:
        at = l["at"]
        nw = len(l["tokens"])
        wc_ok &= len(at["text"].split()) == nw
        unm += at["unmapped"]
        mixed |= len(at["fonts"]) > 1
        lines.append({"text": at["text"], "x0_mm": round(l["x0"] / MM, 2), "x1_mm": round(l["x1"] / MM, 2),
                      "width_mm": round((l["x1"] - l["x0"]) / MM, 2), "baseline_pt": round(l["by"], 3), "n_words": nw,
                      "words_width_pt": round(sum(max(g["x1"] for g in t) - min(g["x0"] for g in t) for t in l["tokens"]), 3)})
    steps = [a["by"] - b["by"] for a, b in zip(fr["lines"], fr["lines"][1:])]
    rec = {"id": f"{sid}:{fr['fid']}", "sample": sid, "edition_date": man.get("edition_date"), "page": P["page"],
           "role": fr["role"], "role_reason": fr["role_reason"], "font": fr["font"], "size_pt": fr["size"],
           "hscale": round(fr["hs"], 4), "leading_pt": round(st.median(steps), 3) if steps else None,
           "frame_x0_mm": round(fr["x0"] / MM, 2), "frame_x1_mm": round(fr["x1"] / MM, 2), "top_baseline_pt": round(fr["top"], 3),
           "span_cols": ncols, "grid": grid, "span_x0_mm": round(s0, 2), "span_width_mm": round(s1 - s0, 2),
           "alignment": alignment(fr, s0, s1), "text": fr["text"], "lines": lines,
           "checks": {"word_counts_match": bool(wc_ok), "unmapped": unm, "mixed_fonts": bool(mixed),
                      "colour": list(fr["cmyk"]) if fr["cmyk"] is not None else None}}
    assert tuple(rec) == RECORD_KEYS
    extra = {"r": fr["size"] / P["body_size"], "line_hs": [l["hs"] for l in fr["lines"]], "tracking": tracking_1000em(fr),
             "measure_tokens_match": all(len(l["at"]["text"].split()) == l["ntok_measure"] for l in fr["lines"]),
             "single_pos": single_line_position(fr["lines"][0], s0, s1) if len(fr["lines"]) == 1 else None,
             "deva": deva_share(fr["text"]), "invalid": invalid_deva(fr["text"]), "union": union is not None,
             "src_frames": len({a["fid"] for l in fr["lines"] for a in l["atoms"]}),
             "atoms_per_line": [len(l["atoms"]) for l in fr["lines"]],
             "colours": Counter(g["cmyk"] for l in fr["lines"] for g in l["glyphs"] if g["text"].strip())}
    return rec, extra


# ------------------------------------------------------------------------------------------------- aggregates
PUNCT_END = {":": "colon", ",": "comma", "।": "danda", "!": "exclamation", "?": "question"}


def break_stats(recs):
    ends = starts = 0
    c_end, c_start = Counter(), Counter()
    fin, ini = Counter(), Counter()
    num_end = any_end = hyph = 0
    for r in recs:
        ls = [l["text"] for l in r["lines"]]
        for a, b in zip(ls, ls[1:]):
            if not a or not b:
                continue
            ends += 1
            last = a.rstrip()[-1]
            for ch, name in PUNCT_END.items():
                if a.rstrip().endswith(ch):
                    c_end[name] += 1
            if is_punct(last):
                any_end += 1
                if last in DASHES:
                    hyph += 1
            lw = a.split()[-1]
            if any(ch in DIGITS for ch in strip_punct(lw)[-1:] or lw[-1:]):
                num_end += 1
            starts += 1
            if is_punct(b.lstrip()[0]):
                c_start["any"] += 1
                c_start[b.lstrip()[0]] += 1
            fw, iw = strip_punct(lw), strip_punct(b.split()[0])
            if fw:
                fin[fw] += 1
            if iw:
                ini[iw] += 1
    out = {"line_breaks": ends,
           "end_after": {k: share(c_end[k], ends) for k in PUNCT_END.values()},
           "end_after_any_punctuation": share(any_end, ends), "end_after_dash_or_hyphen": share(hyph, ends),
           "end_after_numeral": share(num_end, ends),
           "next_line_starts_with_punctuation": share(c_start["any"], starts),
           "next_line_start_punctuation_chars": {k: v for k, v in c_start.most_common() if k != "any"}}
    return out, fin, ini


def role_aggregates(recs, extras):
    n = len(recs)
    if not n:
        return {"count": 0}
    sizes = [r["size_pt"] for r in recs]
    rs = [e["r"] for e in extras]
    hs = [r["hscale"] for r in recs]
    nl = [len(r["lines"]) for r in recs]
    multi = [(r, e) for r, e in zip(recs, extras) if len(r["lines"]) >= 2]
    bal = {"frames": len(multi)}
    if multi:
        w = lambda r: [l["width_mm"] for l in r["lines"]]  # noqa: E731
        bal["shortest_over_longest"] = dist([min(w(r)) / max(w(r)) for r, _ in multi])
        bal["last_over_previous"] = dist([w(r)[-1] / w(r)[-2] for r, _ in multi])
        firstl = sum(1 for r, _ in multi if w(r)[0] > max(w(r)[1:]) + 1.0)
        lastl = sum(1 for r, _ in multi if w(r)[-1] > max(w(r)[:-1]) + 1.0)
        eq = sum(1 for r, _ in multi if max(w(r)) - min(w(r)) <= 1.0)
        bal.update({"first_line_longest_share": share(firstl, len(multi)), "last_line_longest_share": share(lastl, len(multi)),
                    "middle_line_longest_share": share(len(multi) - firstl - lastl - eq, len(multi)),
                    "all_lines_equal_within_1mm_share": share(eq, len(multi)),
                    "two_line": {"n": sum(1 for r, _ in multi if len(r["lines"]) == 2),
                                 "first_longer_share": share(sum(1 for r, _ in multi if len(r["lines"]) == 2 and w(r)[0] > w(r)[1] + 1.0),
                                                             sum(1 for r, _ in multi if len(r["lines"]) == 2))},
                    "lines_differ_in_hscale_share": share(sum(1 for r, e in multi if max(e["line_hs"]) - min(e["line_hs"]) > 0.01), len(multi)),
                    "leading_over_size": dist([r["leading_pt"] / r["size_pt"] for r, _ in multi])})
    fill = [max(l["width_mm"] for l in r["lines"]) / r["span_width_mm"] for r in recs if r["grid"] != "none" and r["span_width_mm"]]
    wpl = [l["n_words"] for r in recs for l in r["lines"]]
    trk = [e["tracking"] for e in extras if e["tracking"] is not None]
    wsp = [(l["width_mm"] * MM - l["words_width_pt"]) / (l["n_words"] - 1) / (r["size_pt"] * (r["hscale"] or 1.0))
           for r in recs for l in r["lines"] if l["n_words"] >= 2]
    brk, fin, ini = break_stats(recs)
    agg = {"count": n,
           "fonts": dict(Counter(r["font"] for r in recs).most_common()),
           "size_pt": dist(sizes, 2), "size_over_body": dist(rs, 3),
           "lines_per_frame": {"dist": dist(nl, 1), "histogram": dict(sorted(Counter(nl).items()))},
           "alignment_share": {k: share(v, n) for k, v in Counter(r["alignment"] for r in recs).most_common()},
           "single_line_position_share": {k: share(v, sum(1 for e in extras if e["single_pos"])) for k, v in
                                          Counter(e["single_pos"] for e in extras if e["single_pos"]).most_common()},
           "grid_share": {k: share(v, n) for k, v in Counter(r["grid"] for r in recs).most_common()},
           "span_cols": {g: dict(sorted(Counter(r["span_cols"] for r in recs if r["grid"] == g).items())) for g in ("8col", "6col")},
           "span_width_mm": dist([r["span_width_mm"] for r in recs if r["grid"] != "none"], 1),
           "hscale": dist(hs, 4), "condensed_share_lt_0_99": share(sum(h < 0.99 for h in hs), n),
           "expanded_share_gt_1_01": share(sum(h > 1.01 for h in hs), n),
           "tracking_1000em_frame_median": dist(trk, 1),
           "tracking_nonzero_share_abs_ge_5": share(sum(abs(t) >= 5 for t in trk), len(trk)),
           "word_space_em_per_line": dist(wsp, 3),
           "balance_multiline": bal,
           "longest_line_fill_of_span": dist(fill, 3),
           "words_per_line": {"dist": dist(wpl, 1), "histogram": dict(sorted(Counter(wpl).items()))},
           "line_breaks": brk,
           "colour_non_black_share": share(sum(1 for r in recs if r["checks"]["colour"] not in ([0.0, 0.0, 0.0, 1.0], None)), n),
           "multi_colour_share": share(sum(1 for e in extras if len([c for c, k in e["colours"].items() if k >= 2]) > 1), n),
           "checks": {"word_counts_match_share": share(sum(r["checks"]["word_counts_match"] for r in recs), n),
                      "word_counts_match_share_with_measure_py_tokens_0_12em": share(sum(e["measure_tokens_match"] for e in extras), n),
                      "frames_with_unmapped": sum(1 for r in recs if r["checks"]["unmapped"]),
                      "frames_mixed_fonts": sum(1 for r in recs if r["checks"]["mixed_fonts"]),
                      "frames_invalid_devanagari_order": sum(1 for e in extras if e["invalid"])},
           "merge": {"frames_built_from_2plus_measure_frames": sum(1 for e in extras if e["src_frames"] >= 2),
                     "max_measure_frames_in_one_frame": max(e["src_frames"] for e in extras),
                     "lines": sum(len(e["atoms_per_line"]) for e in extras),
                     "lines_joined_from_2plus_pieces": sum(1 for e in extras for k in e["atoms_per_line"] if k >= 2),
                     "max_pieces_in_one_line": max(k for e in extras for k in e["atoms_per_line"])}}
    return agg, fin, ini


def write_md(path, out, words):
    L = ["# Display text practice (headlines, decks, captions) — PRIVATE", "",
         "Generated by `experiments/phase0/published1/headlines.py`. Aggregates only, except the line-final/initial word",
         "tables at the end (private: they quote words from the paper). Rules: see the script docstring.", ""]
    L += ["## Dataset", "", "| Item | Value |", "|---|---|"]
    for k, v in out["dataset"].items():
        L.append(f"| {k} | {json.dumps(v, ensure_ascii=False)} |")
    L += ["", "## Grid (estimated from body frames)", "", "```", json.dumps(out["grid"], ensure_ascii=False, indent=1), "```", ""]
    L += ["## Summary by role", "",
          "| Role | Frames | Lines | Size pt median (p10-p90) | x body | Lines/frame median | Top alignment | 8col / 6col / none |"
          " hscale median | Condensed <0.99 | Word space em | Longest line / span | First line longest | Breaks after punct. |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for role in ("headline", "headline_devanagari", "headline_latin", "deck", "deck_under_headline", "deck_crosshead",
                 "caption", "kicker", "byline", "other"):
        a = out["roles"].get(role, {})
        if not a.get("count"):
            continue
        g = a["grid_share"]
        top = max(a["alignment_share"].items(), key=lambda kv: kv[1])
        nlines = sum(k * v for k, v in a["lines_per_frame"]["histogram"].items())
        f = lambda d, k="median": "-" if not d else d[k]  # noqa: E731
        L.append(f"| {role} | {a['count']} | {nlines} | {f(a['size_pt'])} ({f(a['size_pt'], 'p10')}-{f(a['size_pt'], 'p90')}) "
                 f"| {f(a['size_over_body'])} | {f(a['lines_per_frame']['dist'])} | {top[0]} {top[1]:.0%} "
                 f"| {g.get('8col', 0):.0%} / {g.get('6col', 0):.0%} / {g.get('none', 0):.0%} | {f(a['hscale'])} "
                 f"| {a['condensed_share_lt_0_99']:.0%} | {f(a['word_space_em_per_line'])} | {f(a['longest_line_fill_of_span'])} "
                 f"| {'-' if a['balance_multiline'].get('first_line_longest_share') is None else format(a['balance_multiline']['first_line_longest_share'], '.0%')} "
                 f"| {'-' if a['line_breaks']['end_after_any_punctuation'] is None else format(a['line_breaks']['end_after_any_punctuation'], '.0%')} |")
    L += ["", "Reasons:", ""]
    for k, v in out["role_reasons"].items():
        L.append(f"- {k}: {v}")
    L += ["", "## Validation evidence", "", "```", json.dumps({"split_check": out["split_check"],
                                                             "caption_rule_rejections": out["caption_rule_rejections"]},
                                                            ensure_ascii=False, indent=1), "```"]
    for role in ("headline", "headline_devanagari", "headline_latin", "deck", "deck_under_headline", "deck_crosshead",
                 "caption", "kicker", "byline", "other"):
        a = out["roles"].get(role)
        if not a or not a.get("count"):
            continue
        L += ["", f"## {role}", "", "```", json.dumps(a, ensure_ascii=False, indent=1), "```"]
    L += ["", "## Stacked same-font headline paragraphs (line-by-line copyfit)", "", "```", json.dumps(out["stacked"], ensure_ascii=False, indent=1), "```"]
    for role in ("headline", "deck", "caption"):
        fin, ini = words.get(role, (Counter(), Counter()))
        L += ["", f"## {role}: line-final words (top 30, private)", "", "| Word | n |", "|---|---|"]
        L += [f"| {w} | {c} |" for w, c in fin.most_common(30)]
        L += ["", f"## {role}: line-initial words (top 30, private)", "", "| Word | n |", "|---|---|"]
        L += [f"| {w} | {c} |" for w, c in ini.most_common(30)]
    path.write_text("\n".join(L) + "\n")


# ------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dataset", type=Path)
    a = ap.parse_args()
    ds = a.dataset.expanduser().resolve()
    os.umask(0o077)                         # outputs hold article text: never world-readable, even briefly
    sids, docs, mans, skipped = [], {}, {}, []
    for sid in sorted(p.name for p in (ds / "samples").iterdir() if p.is_dir()):
        doc = json.loads(wpath(ds, sid).read_text())
        if "excluded" in doc:
            skipped.append(sid)
            continue
        sids.append(sid)
        docs[sid] = doc
        mans[sid] = json.loads((ds / "samples" / sid / "manifest.json").read_text())
    grids, grid_info = estimate_grids(docs.values())
    pages, n_frag, n_dup, n_recl, n_offpage = [], 0, 0, 0, 0
    for sid in sids:
        pdf = ds / "samples" / sid / "source.pdf"
        pdoc = pdfium.PdfDocument(str(pdf))
        for pg in docs[sid]["pages"]:
            G = page_glyphs(pdf, pg["page"])
            frames, body, nf, nd, nr, no = build_page(G, pg)
            n_recl += nr
            n_offpage += no
            n_frag += nf
            n_dup += nd
            del G
            pages.append({"sid": sid, "page": pg["page"], "frames": frames, "body": body,
                          "body_frames": [f for f in pg["frames"] if f["is_body_candidate"] and not f.get("excluded")],
                          "body_size": pg["body_size_pt_page_mode"], "body_font": pg["body_font_page_mode"],
                          "page_h": pdoc[pg["page"] - 1].get_size()[1],
                          "photos": photos(pdoc, pg["page"])})
        pdoc.close()
    # dataset context: recurring texts, display font families
    recur, fr_r = defaultdict(set), defaultdict(list)
    for P in pages:
        for fr in P["frames"]:
            recur[fr["text"]].add(P["sid"])
            fr_r[fr["font"]].append(fr["size"] / P["body_size"])
    display_fonts = {f for f, rs in fr_r.items() if st.median(rs) >= DISPLAY_R}
    ctx = {"recur": recur, "display_fonts": display_fonts, "stats": Counter()}
    out_dir = ds / "report"
    out_dir.mkdir(parents=True, exist_ok=True)
    jl = out_dir / "headlines.jsonl"
    recs, extras = [], []
    with open(jl, "w") as fh:
        for P in pages:
            classify_page(P, ctx)
            for fr in P["frames"]:
                rec, ex = record(P["sid"], mans[P["sid"]], P, fr, grids)
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                recs.append(rec)
                extras.append(ex)
    os.chmod(jl, 0o600)
    # aggregates
    roles, words = {}, {}
    groups = {role: [k for k, r in enumerate(recs) if r["role"] == role] for role in ROLES}
    groups["headline_devanagari"] = [k for k in groups["headline"] if extras[k]["deva"] >= 0.5]
    groups["headline_latin"] = [k for k in groups["headline"] if extras[k]["deva"] < 0.5]
    groups["deck_under_headline"] = [k for k in groups["deck"] if not recs[k]["role_reason"].startswith("crosshead")]
    groups["deck_crosshead"] = [k for k in groups["deck"] if recs[k]["role_reason"].startswith("crosshead")]
    for name, ks in groups.items():
        agg, fin, ini = role_aggregates([recs[k] for k in ks], [extras[k] for k in ks])
        roles[name] = agg
        words[name] = (fin, ini)
    # split check: headline frames of one page that share a first baseline, font and size and sit side by side
    # within one gutter (+2 mm) would be a multi-column headline the merge failed to join
    gut = grids["8col"]["pitch"] - grids["8col"]["width"]
    heads = defaultdict(list)
    for r in recs:
        if r["role"] in ("headline", "deck"):
            heads[(r["sample"], r["page"])].append(r)
    split_pairs = []
    for hs_ in heads.values():
        for a in hs_:
            for b in hs_:
                if a is not b and a["font"] == b["font"] and abs(a["size_pt"] - b["size_pt"]) <= SIZE_TOL_PT \
                        and abs(a["top_baseline_pt"] - b["top_baseline_pt"]) <= BASELINE_EM * a["size_pt"] \
                        and 0 <= b["frame_x0_mm"] - a["frame_x1_mm"] <= gut + 2.0:
                    split_pairs.append((a["id"], b["id"], round(b["frame_x0_mm"] - a["frame_x1_mm"], 2)))
    stacked = [r for r in recs if r["role_reason"].startswith("S ")]
    ratios = [float(re.search(r"at ([0-9.]+)x", r["role_reason"]).group(1)) for r in stacked]
    out = {"schema": "pageinator.published1.headline_practice/1", "tool": "headlines.py",
           "dataset": {"samples": len(sids), "skipped_excluded_samples": len(skipped), "pages": len(pages),
                       "frames_classified": len(recs), "body_fragments_dropped": n_frag, "duplicate_atoms_dropped": n_dup,
                       "bold_lines_reclaimed_from_body_frames": n_recl, "off_page_frames_dropped": n_offpage,
                       "display_fonts_by_median_size": sorted(display_fonts),
                       "word_counts_match_share_all": share(sum(r["checks"]["word_counts_match"] for r in recs), len(recs))},
           "grid": {"grids": grids, "estimate": grid_info},
           "roles": roles,
           "role_reasons": dict(Counter(r["role_reason"].split(" ")[0] + " " + r["role"] for r in recs).most_common()),
           "stacked": {"count": len(stacked), "size_ratio": dist(ratios, 3)},
           "caption_rule_rejections": dict(ctx["stats"]),
           "split_check": {"side_by_side_same_style_headline_or_deck_pairs_within_one_gutter": len(split_pairs),
                           "pairs": split_pairs},
           "parameters": {k: v for k, v in globals().items() if k.isupper() and isinstance(v, (int, float, tuple))}}
    pj = out_dir / "headline_practice.json"
    pj.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    os.chmod(pj, 0o600)
    pm = out_dir / "headline_practice.md"
    write_md(pm, out, words)
    os.chmod(pm, 0o600)
    print(f"{len(sids)} samples ({len(skipped)} skipped), {len(pages)} pages, {len(recs)} frames → {jl.name}")
    for role in ROLES:
        print(f"  {role:9s} {roles[role].get('count', 0)}")


if __name__ == "__main__":
    main()
