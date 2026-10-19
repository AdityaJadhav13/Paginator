"""EXP-GEN-1: Pageinator lays out a newspaper page itself (EXPERIMENTAL; PRIVATE OUTPUT except aggregates).

Input per page: the page's own stories (from page_model.py: kicker, headline, deck, byline, body flow with crossheads,
photos, captions) in editorial priority order (printed headline size — the editors' ranking), the fixed parts of the page
(running head, furniture, ads) and the paper's design language (page1/house_profile.json, plus span and body-style
frequencies counted on the CALIBRATION editions only). The PRINTED LAYOUT IS NOT USED: positions, spans, column sets,
photo sizes, body type and headline sizes are chosen by Pageinator.

Method (guillotine / slicing-tree layout, after Gange, Marriott & Stuckey 2012):
  modules   every story at every width w = 1…8 grid columns, in m = w or w−1 equal text columns (the house sets N grid
            columns in N−1 text columns in 59 % of column sets), at copyfit 1.00 / 0.98 / 0.96, in each house body style
            (size / leading pairs the house uses), with the real typesetter: kicker, headline (head1 composer, size from
            the profile's size-by-span table, at most 4 lines, ink clearance between lines), deck, byline, photo across k
            of the m text columns (top left; aspect within ×/÷ CROP of the original; caption below it), body text through
            the columns beside and below the photo (EXP-COMPOSE-3 policy, paper-level size). Vertical spacing from the
            profile. Each option gives an exact height interval (up to WHITE_MAX leadings of white space at the column feet).
  pass A    bottom-up over story subsets: the heights each subset can fill exactly at each width (interval sets; stacking =
            Minkowski sum, side by side = intersection). An unreachable newshole is reported as infeasible.
  pass B    top-down memoised search for the cheapest guillotine tree that fills the newshole exactly. Cost: priority
            order (a more important story below a less important one), the lead on the house's side, tombstoning
            (neighbouring top headlines within 6 pt), headline hierarchy (the lead's headline the page's largest), span
            preference −log P(span | priority), photo crop and photo width, copyfit, body-style rarity, white space.
  render    the fixed parts of the page as in the page rebuild (photos included), then the modules: 0.5 pt rules between
            stacked modules (no column rules — house practice), centred display text, photos cropped to the chosen box,
            body text through the chosen columns. A module whose text does not fit after rendering (the one-column dry
            run cannot see column breaks) gets one more row and the page is searched again. PDF/X-1a.
Every story part is set: loose story text (place lines, credits, small fact boxes) under the byline, further photos stacked
under the first at its width, jump lines right-aligned under the body. Anything that cannot be set (a photo missing from
the photo step) is listed in the manifest, and the checker (check_gen.py) fails the page for it.
Deterministic (ordered enumeration, a node budget instead of a clock).
Output: <dataset>/report/gen1/ (private) and experiments/phase0/results/gen1/summary.json (aggregates; full runs only).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/gen1/generate.py <dataset_dir> [<page> ...]
                   [--out DIR] [--lead-side left|right]   (an alternative layout, e.g. for review check pairs)
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import sys
from collections import Counter
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "page1"))
import compose_page as CP  # noqa: E402

H, K3, X, MP, RH = CP.H, CP.K3, CP.X, CP.MP, CP.RH
MM = CP.MM
GEN = "gen1/2.9.2"
UNIT = 0.5                                   # mm per height unit of the search
OUT = HERE.parent / "results" / "gen1"
PROFILE = json.loads((HERE.parent / "results" / "page1" / "house_profile.json").read_text())
G = PROFILE["grid"]
COL_W, GUT, ORIGIN, NCOL = G["column_width_mm"], G["gutter_mm"], G["origin_mm"], G["columns"]
PITCH = COL_W + GUT


def _sp(key, default):
    v = PROFILE["spacing"].get(key)
    med = (v.get("mm") or {}).get("median") if isinstance(v, dict) else None
    return med if med is not None and (v.get("n") or 0) >= 5 else default


SP = {k: _sp(k, d) for k, d in (("rule_to_headline", 11.0), ("headline_to_body", 6.9), ("headline_to_deck", 10.2),
                                 ("deck_to_body", 6.8), ("body_to_rule", 2.5), ("photo_to_body", 5.5), ("headline_to_photo", 4.0),
                                 ("deck_to_photo", 3.5), ("headline_to_byline", 6.3), ("byline_to_body", 4.6),
                                 ("kicker_to_headline", 11.1), ("rule_to_photo", 1.4), ("rule_to_body", 5.6))}
DECOR_MM = 4.0                               # decoration within this margin of a moved story's printed box moves with it
BOX_PAD = 2.0                                # inner margin of a ruled fact box
PHOTO_GAP = 2.0                              # between photos stacked in one story
CAPTION_GAP = 1.5                            # photo bottom → caption cap line (the profile has one observation only)
CROP = 1.5                                   # photo aspect may change by up to ×/÷ 1.5 (cost grows with the square of the log)
FITS = (1.04, 1.02, 1.0, 0.98, 0.96)           # body size: up to 4 % larger (fills columns, the editors' wish) or smaller
SHORT_COST = 0.4                             # per empty line at the foot of the last column (columns should end level)
BUDGET = 400_000
TOMBSTONE = 4.0                              # cost of neighbouring top headlines within 6 pt of each other
LEAD_MARGIN_PT = 2.0
SAMPLES = 9                                  # split heights tried per feasible interval (evenly spaced, ends included)
RETRIES = 6
GEN_MIN_LEAD_EM = 1.25                       # body leading ≥ 1.25 em of the stand-in (rebuild: 1.20, where printed widths
                                             # must be kept): at 1.20 a deep vowel sign still meets a tall one above now and then
XH_KEEP = 2                                  # a crosshead needs room for this many body lines after it in its column
XH_SPACE_L = 1.5                             # crosshead space above/below in body leadings: the house uses 1.0 with its own face;
                                             # the stand-in's taller vowel signs touch the next line at 1.0
MAX_STORIES = 11
RARE_STYLE_MIN = 2                           # body styles used at least this often are the fallback palette
MAX_LEAD_RATIO = 1.3                         # … at a sensible leading (≤ 1.3 × size)
LOOSE_GAP_MM = 30.0                          # a loose item joins a headline at most this far above it
ICON_MM = 25.0
BRIEF_WORDS = 60                             # a brief: at most this many words …
BRIEF_HEAD_PT = 16.0                         # … under a headline of at most this size, with no photo
BOX_WORDS = 300                              # a filled box holding small stories of at most this many words is one fact box
QUOTE_WORDS = 60                             # a child story this short with no headline or photo is a pull quote
CHILD_SPLIT = 0.8                            # cost when a sidebar and its parent story end up in different halves of a cut
AD_STRIP_MM = 6.0                            # a bar this close above/below an ad block, as wide as it, belongs to the ad
MIN_REGION_MM = 25.0                         # a strip of the newshole beside an ad block narrower than this is left empty
LEAD_LOW = 2.0                               # cost when the lead story's region does not start at the top of the newshole
LOOSE_JOIN_MM = 6.0                          # loose pieces of one column this close together are one item
LOOSE_INSIDE = 0.8                           # a loose item at least this much inside the newshole is laid out with it
LOOSE_INTRO_WORDS = 80                       # loose text this short inside a story's printed box is that story's (an intro)
XH_FOLLOW_MM = 15.0                          # a loose crosshead joins a flow only if a paragraph starts this close below it
HEAD_GROW = 1.25                             # a headline may grow this much to fill its measure (same number of lines)
HEAD_HSCALE_MAX = 1.18                       # a short headline line may stretch its letters by up to 18 % horizontally
HEAD_LINE_GROW = 1.2                         # a short headline line may be set up to 20 % larger than the others
HEAD_LINE_GROW_MINOR = 1.08                  # … and up to 8 % for a headline that is not the lead's
HEAD_GAP_EM = 0.5                            # at most this much extra space per word gap when a headline line is justified
LEG_MM = 250.0                               # single-column modules deeper than this cost 0.01 per mm
LOOSE_BODY_WORDS = 25                        # loose text this long is set as body text
HEAD_STEPS = ((1.0, 0.0), (0.85, 0.6), (0.72, 1.5))   # headline size × the span table's, and its cost (not for the lead)
MIN_PPI = 150                                # photos are never enlarged below this (or below the paper's own print, if lower)
BODY_INK_TEST = "\u0915\u093f\u0902 \u0930\u094d\u0915\u0940\u0902 \u0911 \u0915\u0945 \u0907\u0901 \u0936\u094d\u0930\u0940"   # tall marks
WHITE_MAX = 2                                # leadings of white space a module may leave at its column feet (> 1 costs extra)
EDGE_TOP_MM = 15.0                           # … or one that ends within this distance below the newshole's top
EDGE_MM = 60.0                               # fixed items shorter than this on the newshole's top/bottom edge move that edge
DEVA = (chr(0x0900), chr(0x097F))


def span_mm(w: int) -> float:
    return w * COL_W + (w - 1) * GUT


def head_size(w: int) -> float:
    rec = PROFILE["headline_size"]["by_span"].get(f"{NCOL}col:{w}")
    return float(rec["size_pt"]["all"]["median"]) if rec else 14.0 + 5.0 * w


def deva(txt) -> bool:
    letters = [ch for ch in txt if ch.isalpha()]
    return bool(letters) and sum(DEVA[0] <= ch <= DEVA[1] for ch in letters) >= 0.5 * len(letters)


# ------------------------------------------------------------------------------------------- intervals
def merge(iv):
    iv = sorted(iv)
    out = []
    for a, b in iv:
        if out and a <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def inter(A, B):
    out, i, j = [], 0, 0
    while i < len(A) and j < len(B):
        lo, hi = max(A[i][0], B[j][0]), min(A[i][1], B[j][1])
        if lo <= hi:
            out.append((lo, hi))
        if A[i][1] < B[j][1]:
            i += 1
        else:
            j += 1
    return out


def mink(A, B, cap):
    return merge([(a0 + b0, min(cap, a1 + b1)) for a0, a1 in A for b0, b1 in B if a0 + b0 <= cap])


def contains(iv, h):
    return any(a <= h <= b for a, b in iv)


# ------------------------------------------------------------------------------------------- stories
def _text(el) -> str:
    return " ".join(el_text(el).split())


class Story:
    def __init__(self, s, els, photos_index, photo_dir, rank):
        self.id, self.rank, self.src, self.flow = s["id"], rank, s, s["flow"]
        parts = [els[x] for x in [s.get("headline"), *(s.get("headline_parts") or [])] if x in els]
        self.head = " ".join(_text(e) for e in parts) or None
        self.head_ids = [e["id"] for e in parts]
        decks = [els[d] for d in s.get("decks", []) if d in els]
        self.deck = " ".join(_text(d) for d in decks) or None
        self.deck_ids = [d["id"] for d in decks]
        # a run-in dateline is already the start of the first paragraph: never set on its own
        self.kicker = els.get(s.get("kicker")) if s.get("kicker") and not els.get(s.get("kicker"), {}).get("run_in") else None
        self.byline = els.get(s.get("byline")) if s.get("byline") and not els.get(s.get("byline"), {}).get("run_in") else None
        ph = sorted((i for i in s.get("images", []) if i in photos_index),
                    key=lambda i: (-photos_index[i]["width_px"] * photos_index[i]["height_px"], i))
        # min_ppi: never enlarged below MIN_PPI, or below the resolution the paper itself printed it at (if lower)
        photos = [{"id": i, "w": photos_index[i]["width_px"], "h": photos_index[i]["height_px"],
                   "aspect": photos_index[i]["width_px"] / photos_index[i]["height_px"], "path": photo_dir / f"{i}.cmyk.gz",
                   "min_ppi": min(MIN_PPI, 0.95 * (photos_index[i].get("ppi") or MIN_PPI))} for i in ph]
        self.photo = photos[0] if photos else None
        self.photos_extra = photos[1:]                       # stacked under the first photo at its width, uncropped
        other = [x if isinstance(x, str) else x.get("id") for x in s.get("other_elements") or []]
        self.tags = [els[i] for i in other if i in els and el_text(els[i]).strip() and not CP.only_bullets(el_text(els[i]))
                     and not els[i].get("run_in")]
        self.bullet_columns = [i for i in other if i in els and CP.only_bullets(el_text(els[i]))]   # decoration, not set
        # jump lines: "continued from …" (printed in the story's upper half) opens the story, "continued on …" closes it
        first_bl = min((c["first_baseline_mm"] for c in s.get("columns") or []), default=1e9)
        jl = [els[i] for i in s.get("jump_lines") or [] if i in els and not els[i].get("run_in")]   # run-in: inside the paragraph
        self.jump_in = [e for e in jl if e["bbox_mm"][3] <= first_bl]
        self.jumps = [e for e in jl if e not in self.jump_in]
        caps = [els[c] for c in s.get("captions", []) if c in els]
        self.caption = {"text": " ".join(_text(c) for c in caps), "ids": [c["id"] for c in caps], "el": caps[0]} if caps and self.photo else None
        # parts not set by the generator: reported, and failed by the checker
        self.not_set = {"photos": [i for i in s.get("images", []) if i not in photos_index],
                        "captions": [c["id"] for c in caps] if caps and not self.photo else [],
                        "jump_lines": [i for i in s.get("jump_lines") or [] if i not in els],
                        "other_elements": [i for i in other if i not in els or not el_text(els[i]).strip()]}


# ------------------------------------------------------------------------------------------- generator
class Generator:
    def __init__(self, cx, model, photo_dir, styles, ids, space_em):
        self.cx, self.model, self.space_em = cx, model, space_em
        self.styles = sorted(styles)
        top = max(styles.values())
        self.style_cost = {k: math.log(top / v) for k, v in styles.items()}     # 0 for the house's commonest body style
        self.els = {e["id"]: e for e in model["elements"]}
        idx = json.loads((photo_dir / "index.json").read_text())["elements"] if (photo_dir / "index.json").exists() else {}
        order = {s["id"]: k for k, s in enumerate(model["stories"])}
        # every story of the newshole with body text, child stories (pull quotes, sidebars) included as their own modules
        main = [s for s in model["stories"] if s["id"] in ids and (s.get("synthetic") or any(b["type"] == "para" and b["text"].strip() for b in s["flow"]))]

        def prio(s):                                     # printed headline size = the editors' ranking; ties: story order
            he = self.els.get(s.get("headline")) if s.get("headline") else None
            return (-(he["size_pt"] if he else 0.0), order[s["id"]])
        main.sort(key=prio)
        self.stories = [Story(s, self.els, idx, photo_dir, r) for r, s in enumerate(main)]
        self.ext_styles = False                          # True when the rarer house styles are in use (a fallback)
        self.extra_rows: dict = {}                       # (story, w, m, fit, style) → rows added after an overset render
        self._lines: dict = {}
        self._disp: dict = {}
        self._cap: dict = {}
        self._xh: dict = {}
        self._fill: dict = {}
        # every element a flow sets as a crosshead (merged boxes and brief stacks use item headlines): re-anchored too
        self.flow_xh = {b["element"] for s_ in model["stories"] for b in s_["flow"] if b["type"] == "crosshead" and b.get("element")}
        self.head_axes = {"wght": 800.0, "wdth": 87.5}  # house headline type is condensed (hscale 0.90)
        self.pol = replace(self.cx.head_pol, balance=False)
        p = K3.prepare(BODY_INK_TEST, "mr", "Deva", CP.SERIF, 10.0, CP.BODY_AXES, 400)
        self.body_asc_per_pt = CP.line_ink(p, 0, len(p.words))[0] / 10.0      # mm of ink above the baseline per pt of size

    # ---- exact text heights with the real typesetter (dry run in one tall column)
    def body_lines(self, s: Story, cw: float, fit: float, style) -> int:
        key = (s.id, round(cw, 2), fit, style)
        if key not in self._lines:
            B = CP.Builder(2000.0)
            col = [{"frame_ids": [], "x0_mm": 10.0, "x1_mm": 10.0 + cw, "top_mm": 5.0, "bottom_mm": 1990.0, "first_baseline_mm": 10.0,
                    "n_lines": 9999, "leading_mm": style[1] / MM}]
            self.set_body(B, s, col, {"page": 0}, {"colour": {}}, fit, style)
            ys = [l["baseline_mm"] for l in B.lines if l.get("role") == "body"]
            # baselines are stored to 3 decimals: round before counting so 15.0001 leadings are 15, not 16
            self._lines[key] = math.ceil(round((max(ys) - 10.0) / (style[1] / MM), 2) - 1e-6) + 1 if ys else 0
        return self._lines[key]

    def neutral_els(self, cols):
        """Crossheads re-anchored to the generated columns: the first line is anchored on column 0's last usable baseline
        and spans its measure, so the composer maps it to column 0 (without widening that column's line limit) and moves
        it by whole columns to wherever the flow reaches it; it is composed at the column's measure, printed size."""
        c0 = next((c for c in cols if c["n_lines"] >= 1), cols[0])   # a column that holds text (not one filled by a photo)
        anchor = c0["first_baseline_mm"] + (c0["n_lines"] - 1) * c0["leading_mm"]
        measure = c0["x1_mm"] - c0["x0_mm"]
        out = {}
        for k, e in self.els.items():
            if (e["kind"] == "crosshead" or k in self.flow_xh) and e.get("lines"):
                # as many anchor lines as the crosshead takes at THIS measure, so the composer's room check is exact
                n = self.crosshead_lines(e, measure)
                lead = (e.get("leading_pt") or e["size_pt"] * 1.083) / MM
                out[k] = {**e, "kind": "crosshead", "gen_measure_mm": measure, "gen_keep_lines": XH_KEEP,
                          "lines": [{**e["lines"][min(i, len(e["lines"]) - 1)], "baseline_mm": anchor + i * lead, "x0_mm": c0["x0_mm"],
                                     "x1_mm": c0["x1_mm"]} for i in range(n)]}
            else:
                out[k] = e
        return out

    def crosshead_lines(self, e, measure) -> int:
        """Lines a crosshead takes at a measure, composed as set_display composes it (printed size, first-fit)."""
        key = (e["id"], round(measure, 2))
        if key not in self._xh:
            fam, ax, wt = CP.role_font(e.get("font") or "", "crosshead")
            text = CP.fix_bullet(" ".join(e["text"].split()))
            r = H.compose(text, fam, ax, wt, round(e["size_pt"], 3), measure, self.pol)
            if not r.fits:
                r = H.compose(text, fam, ax, wt, round(e["size_pt"], 3), measure + 1.0, self.pol)
            self._xh[key] = len(r.lines) if r.fits else len(e["lines"])
        return self._xh[key]

    def set_body(self, B, story, cols, meta, rep, fit, style):
        """The composer on a generated module: crossheads get XH_SPACE_L leadings above and below (stand-in fonts)."""
        keep = (self.cx.xh_above, self.cx.xh_below, CP.MIN_LEAD_EM)
        self.cx.xh_above = self.cx.xh_below = max(XH_SPACE_L, keep[0])
        CP.MIN_LEAD_EM = max(GEN_MIN_LEAD_EM, keep[2])
        try:
            return CP.set_story(B, self.cx, self.synth(story, cols, style), lambda l: 0.0, self.neutral_els(cols), [], meta, rep, fit=fit)
        finally:
            self.cx.xh_above, self.cx.xh_below, CP.MIN_LEAD_EM = keep

    def synth(self, s: Story, cols, style):
        flow = []
        for b in s.flow:
            if b["type"] == "para":                     # indented or not as printed (structure); the indent is the house's
                flow.append({**b, "indent_mm": self.cx.indent_mm if (b.get("indent_mm") or 0) > 0.5 else 0.0,
                             "lines": [{**ln, "line_ref": "gen:0"} for ln in b["lines"]]})
            else:
                flow.append(b)
        # body type from the house's style palette (size / leading), neutral horizontal scale, the house word space:
        # nothing printed for this story sizes or spaces the text
        return {**s.src, "id": s.id, "columns": cols, "flow": flow, "body_size_pt": style[0], "body_leading_pt": style[1], "body_hscale": 1.0,
                "space_em": self.space_em}

    def compose_block(self, text, family, axes, wt, size, measure, max_lines, lead_em, policy=None):
        """→ (composition, leading mm, ink above the first baseline, ink below the last baseline) or None.
        Leading: lead_em × size, or more where two lines' ink would touch. Policy: the house headline policy for
        headlines and decks, first-fit for small text."""
        r = H.compose(text, family, axes, wt, size, measure, policy or self.pol, max_lines=max_lines)
        if not r.fits:
            return None
        ink = [CP.line_ink(r.p, i, j) for i, j in r.lines]
        lead = lead_em * size / MM
        if len(r.lines) > 1:
            lead = max(lead, max(ink[n][1] + ink[n + 1][0] for n in range(len(ink) - 1)) + CP.INK_CLEAR_MM)
        return r, lead, ink[0][0], ink[-1][1]

    def fill_headline(self, text, measure, size0, policy, grow=True):
        """A headline whose every line runs the full measure, edge to edge (the editors' review: "justify the headline
        so the space left on both sides is filled"). The house policy breaks it at size0 (≤ 4 lines); the size then
        grows (up to HEAD_GROW×) as long as the same number of lines still fits; each line is re-shaped with the width
        axis widened (never letter-spaced: that would break the Devanagari top line) as far as it fits, and the rest is
        spread over its word spaces (at most HEAD_GAP_EM em each; a remainder centres the line).
        → ([(prepared line, axes, gap mm, x offset mm)], leading mm, ink above line 1, ink below the last, size) or None."""
        key = (text, round(measure, 2), round(size0, 2), grow)
        if key in self._fill:
            return self._fill[key]
        axes0, wt = self.head_axes, 800
        r = H.compose(text, CP.SANS, axes0, wt, size0, measure, policy, max_lines=4)
        if not r.fits:
            self._fill[key] = None
            return None
        n = len(r.lines)
        policy = replace(policy, balance=True)           # lines of even length: each needs only a little stretch to fill
        rb = H.compose(text, CP.SANS, axes0, wt, size0, measure, policy, n_lines=n)
        r = rb if rb.fits and len(rb.lines) == n else r
        # only the lead's headline grows as a whole; the others fill their lines without growing past their planned size,
        # so a minor story never shouts louder than the lead (the editors' review, round 2 preview)
        lo, hi, best = size0, size0 * (HEAD_GROW if grow else 1.0), r
        for _ in range(7):
            mid = round((lo + hi) / 2, 2)
            rr = H.compose(text, CP.SANS, axes0, wt, mid, measure, policy, n_lines=n)
            if rr.fits and len(rr.lines) == n:
                lo, best = mid, rr
            else:
                hi = mid
        size = lo
        _, _, texts = H._words(best.p)

        def prep(t, wd, sz=None):
            return K3.prepare(t, "mr", "Deva", CP.SANS, sz or size, {**axes0, "wdth": wd}, wt)

        def width(p):
            return sum(p.clusters[c].width for cl in p.words for c in cl) + sum(x or 0.0 for x in p.spaces[:len(p.words) - 1])
        out, ink = [], []
        for i, j in best.lines:
            t = " ".join(texts[i:j])
            if width(prep(t, 100.0)) <= measure:
                wd = 100.0
            else:
                a, b = 62.5, 100.0
                for _ in range(8):
                    m = (a + b) / 2
                    a, b = (m, b) if width(prep(t, m)) <= measure else (a, m)
                wd = max(62.5, math.floor(a / 2.5) * 2.5)        # whole steps: few font instances per page
            p = prep(t, wd)
            w = width(p)
            if 0 < w * HEAD_HSCALE_MAX < measure:       # still short after stretching: this line is set larger (≤ LINE_GROW×)
                g = min(HEAD_LINE_GROW if grow else HEAD_LINE_GROW_MINOR, measure / (w * HEAD_HSCALE_MAX))
                p = prep(t, wd, round(size * g, 2))
                w = width(p)
            hs = min(HEAD_HSCALE_MAX, measure / w) if 0 < w < measure else 1.0     # then stretch the letters a little
            extra, gaps = measure - w * hs, len(p.words) - 1
            gap = min(extra / gaps, HEAD_GAP_EM * size / MM) if gaps and extra > 0 else 0.0
            out.append((p, {**axes0, "wdth": wd}, gap, max(0.0, extra - gap * gaps) / 2, hs))
            ink.append(CP.line_ink(p, 0, len(p.words)))
        lead = 1.08 * size / MM
        if len(ink) > 1:
            lead = max(lead, max(ink[k][1] + ink[k + 1][0] for k in range(len(ink) - 1)) + CP.INK_CLEAR_MM)
        res = (out, lead, ink[0][0], ink[-1][1], size)
        self._fill[key] = res
        return res

    def body_asc(self, style) -> float:
        """Highest ink of a body line above its baseline (mm), measured on the stand-in with its tallest marks."""
        return self.body_asc_per_pt * style[0] * (self.cx.r_cal or 1.0)

    # ---- display block of a story at width w: composed ONCE, used by options() and render()
    def display(self, s: Story, w: int, step: float = 1.0):
        """→ None if a part has no layout, else dict: blocks [(role, element, composition, baselines, font, align)], ruled
        boxes, size_h, top_text (the last display baseline, 0 without display text), desc_last (ink below it), and the tail
        (jump lines under the body). Baselines relative to the module top. Every block starts below the previous block's
        lowest ink plus its own highest ink plus a clearance, or at the profile's spacing if that is larger."""
        key = (s.id, w, step)
        if key in self._disp:
            return self._disp[key]
        span, size_h = span_mm(w), head_size(w) * step
        blocks, boxes = [], []
        st_ = {"y": None, "desc": 0.0}

        def place(role, eid, text, font, size, measure, max_lines, lead_em, policy, align, nominal, pad=0.0):
            """nominal(y_prev) → the profile's first baseline; returns False if the text has no layout."""
            if st_.get("fail"):                          # an earlier part has no layout: this option is dead
                return False
            fam, ax, wt = font
            cb = self.compose_block(text, fam, ax, wt, size, measure, max_lines, lead_em, policy)
            if cb is None:
                st_["fail"] = True
                return False
            r, lead, asc0, desc = cb
            if st_["y"] is None:
                first = max(nominal(None), 2.0 + pad + asc0)
            else:
                first = max(nominal(st_["y"]), st_["y"] + st_["desc"] + pad + asc0 + CP.INK_CLEAR_MM)
            bl = [first + n * lead for n in range(len(r.lines))]
            blocks.append((role, eid, r, bl, font, align))
            if pad:
                boxes.append((bl[0] - asc0 - pad, bl[-1] + desc + pad, eid))
            st_["y"], st_["desc"] = bl[-1], desc + pad
            return True
        ok = True
        for jl in s.jump_in:
            js = max(8.0, min(14.0, jl.get("size_pt") or 12.0))
            ok &= place("jump_line", jl["id"], _text(jl), CP.role_font(jl.get("font") or "", "jump_line"), js, span, 2, 1.15, None, "right",
                        lambda y: 3.0 + 0.8 * js / MM if y is None else y + 1.15 * js / MM)
        if s.kicker:
            ks = min(s.kicker["size_pt"] or 14.0, 0.6 * size_h)
            ok &= place("kicker", s.kicker["id"], _text(s.kicker), (CP.SANS, {"wght": 700.0}, 700), ks, span, 2, 1.15, None, "center",
                        lambda y: 3.0 + 0.8 * ks / MM if y is None else y + 1.15 * ks / MM)
        if s.head:
            fh = None if st_.get("fail") else self.fill_headline(s.head, span, size_h, self.cx.head_pol, grow=(s.rank == 0))
            if fh is None:
                st_["fail"] = True
                ok = False
            else:                                       # every line runs the full measure (the editors' wish)
                hl, lead, asc0, desc, size_h = fh
                nominal = SP["rule_to_headline"] * size_h / 30.0 if st_["y"] is None else st_["y"] + SP["kicker_to_headline"] * size_h / 30.0
                first = max(nominal, 2.0 + asc0) if st_["y"] is None else max(nominal, st_["y"] + st_["desc"] + asc0 + CP.INK_CLEAR_MM)
                bl = [first + n * lead for n in range(len(hl))]
                blocks.append(("headline", f"gen-h-{s.id}", hl, bl, None, "fill"))
                st_["y"], st_["desc"] = bl[-1], desc
            if s.deck:
                ds_ = min(22.0, 0.6 * size_h)
                ok &= place("deck", f"gen-d-{s.id}", s.deck, (CP.SANS, {"wght": 700.0}, 700), ds_, span, 4, 1.1,
                            replace(self.cx.head_pol, name="deck"), "center", lambda y: y + SP["headline_to_deck"] * ds_ / 22.0)
        if s.byline:
            bs = s.byline["size_pt"] or 12.0
            ok &= place("byline", s.byline["id"], _text(s.byline), CP.role_font(s.byline.get("font") or "", "byline"), bs, span, 2, 1.15,
                        None, "left", lambda y: 3.0 + 0.8 * bs / MM if y is None else y + SP["headline_to_byline"])
        for t in s.tags:
            ts = max(8.0, min(16.0, t.get("size_pt") or 12.0))
            text = CP.fix_bullets_all(_text(t))
            font = CP.role_font(t.get("font") or "", "other_text")
            probe = self.compose_block(text, *font, ts, span - 2 * BOX_PAD, 12, 1.15)
            boxed = probe is not None and (len(probe[0].lines) >= 3 or t["id"].startswith("pq-"))   # a fact box or a pull quote: ruled box
            ok &= place("other_text", t["id"], text, font, ts, span - 2 * BOX_PAD, 12, 1.15, None, "left",
                        lambda y: 3.0 + 0.8 * ts / MM if y is None else y + 1.15 * ts / MM + 1.0, BOX_PAD if boxed else 0.0)
        tail, ty, tdesc = [], 0.0, 0.0                   # jump lines below the body, right-aligned; ty relative to the last row
        for jl in s.jumps:
            js = max(8.0, min(14.0, jl.get("size_pt") or 12.0))
            font = CP.role_font(jl.get("font") or "", "jump_line")
            jb = self.compose_block(_text(jl), *font, js, span, 2, 1.15)
            if jb is None:
                ok = False
                break
            first = ty + max(1.6 * js / MM, (0.35 * self.body_asc_per_pt * 12 if not tail else tdesc) + jb[2] + CP.INK_CLEAR_MM)
            bl = [first + n * jb[1] for n in range(len(jb[0].lines))]
            tail.append(("jump_line", jl["id"], jb[0], bl, font, "right")); ty, tdesc = bl[-1], jb[3]
        if not ok:
            self._disp[key] = None
            return None
        # size_h: the headline's final (filled) size
        out = {"size_h": size_h, "step": step, "blocks": blocks, "boxes": boxes, "top_text": st_["y"] if st_["y"] is not None else 0.0,
               "desc_last": st_["desc"], "has_display": st_["y"] is not None, "tail": tail, "tail_h": ty + (tdesc if tail else 0.0),
               "after": "tags" if s.tags else "byline" if s.byline else "deck" if (s.head and s.deck) else "headline" if s.head else "kicker" if s.kicker else None}
        self._disp[key] = out
        return out

    def caption(self, s: Story, ph_w: float):
        """Caption under the photo at the photo's width: → (composition, leading, height from the photo bottom to the
        caption's last baseline, font, ink below the last line) or None (no caption / no layout)."""
        if not s.caption:
            return None
        key = (s.id, round(ph_w, 2))
        if key not in self._cap:
            el = s.caption["el"]
            cs = max(8.0, min(13.0, el["size_pt"] or 10.0))
            font = CP.role_font(el.get("font") or "", "caption")
            cb = self.compose_block(s.caption["text"], *font, cs, ph_w, 8, 1.15)
            self._cap[key] = None if cb is None else (cb[0], cb[1], CAPTION_GAP + cb[2] + (len(cb[0].lines) - 1) * cb[1], font, cb[3])
        return self._cap[key]

    # ---- module options of a story at width w
    def options(self, s: Story, w: int):
        """Every way to set story s at w grid columns, as height intervals (units of UNIT mm), cheapest per height.
        Headline at the profile's size for the span, or one or two steps smaller (not for the lead). Body: m = w or w−1
        equal text columns. Photo (always kept): across k of the m text columns, top left of the body, with the body
        beside it and below it on the leading grid (j body lines displaced per photo column); its height follows from j
        (and the caption under it), its aspect may differ from the original by ×/÷ CROP, it is never enlarged below
        MIN_PPI. The body needs R rows with k·(R − j) + (m − k)·R ≥ L (L = the story's lines at that measure, from the
        real typesetter). A story without body text (a loose headline, a picture) is its display block (and photo)."""
        span = span_mm(w)
        best = {}
        for step, step_cost in (HEAD_STEPS if s.rank > 0 and s.head else HEAD_STEPS[:1]):
            dsp = self.display(s, w, step)
            if dsp is None:
                continue
            top_text, after, desc = dsp["top_text"], dsp["after"], dsp["desc_last"]
            for style in self.styles:
                lead_b = style[1] / MM
                gap = {"tags": SP["byline_to_body"], "byline": SP["byline_to_body"], "deck": SP["deck_to_body"], "headline": SP["headline_to_body"],
                       "kicker": SP["headline_to_body"], None: SP["rule_to_body"]}[after]
                ink_gap = (desc if dsp["has_display"] else 2.0) + self.body_asc(style) + CP.INK_CLEAR_MM
                y_b0 = top_text + max(gap, ink_gap)                                    # first body baseline
                for m in sorted({w, max(1, w - 1)}):
                    cw = (span - (m - 1) * GUT) / m
                    if cw < 30.0 or cw > 120.0:
                        continue
                    for fit in FITS:
                        extra = self.extra_rows.get((s.id, w, m, fit, style), 0)
                        L = self.body_lines(s, cw, fit, style) + extra * m
                        base = step_cost + 20 * (1 - fit) ** 2 + (0.15 if (m == w and w >= 3) else 0.0) + self.style_cost[style]
                        cands = []
                        if not s.photo:
                            if L == 0:                                  # display only: the block and the rule gap
                                cands.append((0, 0.0, None))
                            else:
                                R0 = math.ceil(L / m)
                                cands.append((R0, SHORT_COST * (R0 * m - L), None))
                        else:
                            ph_top = top_text + max({"deck": SP["deck_to_photo"]}.get(after, SP["headline_to_photo"]), desc + 1.0) \
                                if dsp["has_display"] else SP["rule_to_photo"]
                            for k in (range(1, m + 1) if L else (m,)):
                                ph_w = k * cw + (k - 1) * GUT
                                if any(e["w"] / (ph_w / 25.4) < e["min_ppi"] for e in s.photos_extra):
                                    continue
                                cap = self.caption(s, ph_w)
                                if s.caption and cap is None:
                                    continue
                                below = (cap[2] + max(lead_b, cap[4] + self.body_asc(style) + CP.INK_CLEAR_MM)) if cap \
                                    else max(SP["photo_to_body"], self.body_asc(style) + 1.0)          # photo bottom → first body baseline
                                more = sum(PHOTO_GAP + ph_w / e["aspect"] for e in s.photos_extra)   # further photos, uncropped
                                for j in range(1, 400):
                                    ph_h = y_b0 + j * lead_b - below - more - ph_top
                                    if ph_h < 10.0:
                                        continue
                                    asp = ph_w / ph_h
                                    if asp < s.photo["aspect"] / CROP:
                                        break
                                    if asp > s.photo["aspect"] * CROP:
                                        continue
                                    px_w = min(s.photo["w"], s.photo["h"] * asp)          # source pixels across the crop
                                    if px_w / (ph_w / 25.4) < s.photo["min_ppi"]:
                                        continue
                                    R = max(j, math.ceil((L + k * j) / m))
                                    short = k * (R - j) + (m - k) * R - L          # empty lines at the last column's foot
                                    pc = 3.0 * math.log(asp / s.photo["aspect"]) ** 2 + (3.0 if s.rank <= 2 else 1.0) * (1 - k / m) + SHORT_COST * short
                                    cands.append((R, pc, {"k": k, "j": j, "ph_top": ph_top, "ph_h": ph_h, "ph_w": ph_w, "cap": bool(cap)}))
                        for R, pc, ph in cands:
                            if m == 1 and R * lead_b > LEG_MM:          # a single leg deeper than LEG_MM reads badly
                                pc += 0.01 * (R * lead_b - LEG_MM)
                            if R == 0:
                                h0 = top_text + desc + SP["body_to_rule"] + 1.0 + dsp["tail_h"]
                                lo, hi = math.ceil(h0 / UNIT), math.floor((h0 + WHITE_MAX * lead_b) / UNIT)
                            else:
                                lo = math.ceil((y_b0 + (R - 1) * lead_b + dsp["tail_h"] + SP["body_to_rule"]) / UNIT)
                                hi = math.floor((y_b0 + (R - 1 + WHITE_MAX) * lead_b + dsp["tail_h"] + SP["body_to_rule"]) / UNIT)  # white at the feet
                            if lo > hi:
                                continue
                            c = base + pc
                            if lo not in best or c < best[lo]["static"]:
                                best[lo] = {"w": w, "m": m, "cw": cw, "fit": fit, "rows": R, "lines": L, "lo": lo, "hi": hi, "y_b0": y_b0,
                                            "size_h": dsp["size_h"] if s.head else 0.0, "step": step, "photo": ph, "style": style, "static": c}
        return [best[k] for k in sorted(best)]

    # ---- the search
    def run(self, regions, span_prior, lead_side):
        """regions: [(first grid column, columns, top mm, bottom mm)] that together make the newshole (one, or several
        around an ad block). → ((cost, [(region index, tree)]), info)."""
        n = len(self.stories)
        Hs = [math.floor((b_ - t_) / UNIT) for _, _, t_, b_ in regions]
        Hn = max(Hs)
        leaf = {}
        for i, s in enumerate(self.stories):
            for w in range(1, NCOL + 1):
                leaf[(i, w)] = self.options(s, w)
        R = {}
        full = (1 << n) - 1
        masks = sorted(range(1, full + 1), key=lambda m: (bin(m).count("1"), m))
        for mask in masks:
            bits = [i for i in range(n) if mask >> i & 1]
            for w in range(1, NCOL + 1):
                if len(bits) == 1:
                    R[(mask, w)] = merge([(o["lo"], o["hi"]) for o in leaf[(bits[0], w)]])
                    continue
                acc = []
                low = mask & -mask
                sub = (mask - 1) & mask
                while sub:
                    if sub & low:
                        a, b = sub, mask ^ sub
                        acc += mink(R[(a, w)], R[(b, w)], Hn)
                        for w1 in range(1, w):
                            acc += inter(R[(a, w1)], R[(b, w - w1)])
                    sub = (sub - 1) & mask
                R[(mask, w)] = merge(acc)
        no_option = [self.stories[i].id for i in range(n) if not any(leaf[(i, w)] for w in range(1, NCOL + 1))]
        if len(regions) == 1 and not contains(R[(full, regions[0][1])], Hs[0]):
            return None, {"feasible": False, "reachable_mm": [[a * UNIT, b * UNIT] for a, b in R[(full, regions[0][1])][:6]],
                          "newshole_mm": Hs[0] * UNIT, "stories_without_options": no_option}
        memo, nodes = {}, [0]
        rank = [s.rank for s in self.stories]
        idx = {s.id: i for i, s in enumerate(self.stories)}
        pairs = [(idx[s.src["parent_story"]], i) for i, s in enumerate(self.stories) if s.src.get("parent_story") in idx]

        def split_cost(a, b):                            # a sidebar separated from its parent at this cut
            return CHILD_SPLIT * sum(1 for p_, c_ in pairs if (a >> p_ & 1 and b >> c_ & 1) or (b >> p_ & 1 and a >> c_ & 1))

        def hierarchy(HA, HB):
            """Headline hierarchy: a more important story must not carry a smaller headline; the lead's headline must be the
            page's largest by at least LEAD_MARGIN_PT (counts double)."""
            def bad(r1, s1, r2, s2):                      # story 1 ranks above story 2
                return s1 < s2 + LEAD_MARGIN_PT if r1 == 0 else s1 < s2 - 0.5
            return sum((2.0 if 0 in (ra, rb) else 1.0) for ra, sa in HA for rb, sb in HB
                       if (ra < rb and bad(ra, sa, rb, sb)) or (rb < ra and bad(rb, sb, ra, sa)))

        def leaf_cost(i, w, h):
            best_ = None
            for o in leaf[(i, w)]:
                if not (o["lo"] <= h <= o["hi"]):
                    continue
                ws = (h - o["lo"]) * UNIT / (o["style"][1] / MM)                      # white space in leadings
                c = span_prior(rank[i], w) + o["static"] + ws + 2.0 * max(0.0, ws - 1.0)
                if best_ is None or c < best_[0]:
                    best_ = (c, o)
            return best_

        def best(mask, w, h):
            key = (mask, w, h)
            if key in memo:
                return memo[key]
            nodes[0] += 1
            if nodes[0] > BUDGET:
                return None
            bits = [i for i in range(n) if mask >> i & 1]
            cand = None
            if len(bits) == 1:
                lc = leaf_cost(bits[0], w, h)
                if lc:
                    sz = lc[1]["size_h"]                     # the option's own headline size (steps included)
                    cand = (lc[0], ("leaf", bits[0], w, h, lc[1]), (sz, sz, ((rank[bits[0]], sz),) if sz else ()))
                memo[key] = cand
                return cand
            sub = (mask - 1) & mask
            while sub:
                a, b = sub, mask ^ sub
                # stacked: a on top, b below
                for lo, hi in inter(R[(a, w)], [(h - y1, h - y0) for y0, y1 in reversed(R[(b, w)])]):
                    for ha in sorted({lo + (hi - lo) * k // (SAMPLES - 1) for k in range(SAMPLES)}):
                        if not contains(R[(b, w)], h - ha):
                            continue
                        A = best(a, w, ha)
                        if A is None:
                            continue
                        Bt = best(b, w, h - ha)
                        if Bt is None:
                            continue
                        inv = sum(max(0, rank[x] - rank[y]) for x in range(n) if a >> x & 1 for y in range(n) if b >> y & 1)
                        c = A[0] + Bt[0] + 0.6 * inv + 1.5 * hierarchy(A[2][2], Bt[2][2]) + split_cost(a, b)
                        if cand is None or c < cand[0]:
                            cand = (c, ("v", A[1], Bt[1], ha), (A[2][0], A[2][1], A[2][2] + Bt[2][2]))
                # side by side: a left (w1), b right
                for w1 in range(1, w):
                    if contains(R[(a, w1)], h) and contains(R[(b, w - w1)], h):
                        A, Bt = best(a, w1, h), best(b, w - w1, h)
                        if A is None or Bt is None:
                            continue
                        c = A[0] + Bt[0] + split_cost(a, b)
                        lead_in_b = min(rank[y] for y in range(n) if b >> y & 1) < min(rank[x] for x in range(n) if a >> x & 1)
                        c += 0.8 if lead_in_b == (lead_side == "left") else 0.0
                        if A[2][1] and Bt[2][0] and abs(A[2][1] - Bt[2][0]) < 6.0:
                            c += TOMBSTONE                             # tombstoned: neighbouring top headlines alike in size
                        c += 1.5 * hierarchy(A[2][2], Bt[2][2])
                        if cand is None or c < cand[0]:
                            cand = (c, ("h", A[1], Bt[1], w1), (A[2][0], Bt[2][1], A[2][2] + Bt[2][2]))
                sub = (sub - 1) & mask
            memo[key] = cand
            return cand
        if len(regions) == 1:
            r1 = best(full, regions[0][1], Hs[0])
            res = None if r1 is None else (r1[0], [(0, r1[1])])
        else:
            # several regions: which stories fill which region exactly, the cheapest assignment (each region non-empty);
            # the lead belongs in a region at the top of the newshole
            top0 = min(t_ for _, _, t_, _ in regions)
            lead_i = next((i for i, s_ in enumerate(self.stories) if s_.rank == 0), None)
            F = {}

            def assign(k, mask):
                if k == len(regions):
                    return (0.0, []) if mask == 0 else None
                key = (k, mask)
                if key in F:
                    return F[key]
                c0, w, t_, _ = regions[k]
                out = None
                sub = mask
                while sub:
                    if contains(R[(sub, w)], Hs[k]):
                        rest = assign(k + 1, mask ^ sub)
                        if rest is not None:
                            b_ = best(sub, w, Hs[k])
                            if b_ is not None:
                                c = (b_[0] + rest[0] + (LEAD_LOW if lead_i is not None and sub >> lead_i & 1 and t_ > top0 + 1 else 0.0)
                                     + split_cost(sub, mask ^ sub))           # a sidebar in another region than its story
                                if out is None or c < out[0]:
                                    out = (c, [(k, b_[1])] + rest[1])
                    sub = (sub - 1) & mask
                F[key] = out
                return out
            res = assign(0, full)
        info = {"feasible": res is not None, "nodes": nodes[0], "budget_hit": nodes[0] > BUDGET,
                "newshole_mm": Hs[0] * UNIT if len(regions) == 1 else [h * UNIT for h in Hs], "regions": len(regions)}
        return res, info

    def place(self, tree, x, y):
        """→ list of (story index, x, y, w, h_mm, option)"""
        if tree[0] == "leaf":
            _, i, w, h, o = tree
            return [(i, x, y, w, h * UNIT, o)]
        if tree[0] == "v":
            _, A, Bt, ha = tree
            return self.place(A, x, y) + self.place(Bt, x, y + ha * UNIT)
        _, A, Bt, w1 = tree
        return self.place(A, x, y) + self.place(Bt, x + w1 * PITCH, y)


# ------------------------------------------------------------------------------------------- page inputs
def owned_ids(story) -> set:
    """Element ids a story owns: display parts, images, captions, jump lines, its crossheads and its body frames."""
    ids = {story.get(k) for k in ("headline", "kicker", "byline")} - {None}
    for k in ("decks", "captions", "images", "headline_parts", "jump_lines", "other_elements"):
        ids.update(x if isinstance(x, str) else x.get("id") for x in story.get(k) or [])
    for c in story.get("columns") or []:
        ids.update(c.get("frame_ids") or [])
    for b in story["flow"]:
        if b["type"] == "crosshead" and b.get("element"):
            ids.add(b["element"])
        for ln in b.get("lines") or []:
            if ":" in str(ln.get("line_ref", "")):
                ids.add(ln["line_ref"].split(":")[0])
    ids -= {None}
    return ids | {f"bf-{i}" for i in ids}               # body-frame elements carry the frame id with a "bf-" prefix


def fixed_parts(model, gen_ids, boxes_):
    """The page without the generated stories: (kept stories, kept elements, intruders). Removed: everything a generated
    story owns, and rules / boxes / loose items of the old plan inside or crossing the newshole. Intruders = kept text,
    images, graphics or ads reaching more than 2 mm into the newshole: the newshole is then not a free rectangle."""
    boxes_ = [boxes_] if isinstance(boxes_[0], (int, float)) else boxes_
    owned = set().union(*(owned_ids(s) for s in model["stories"] if s["id"] in gen_ids))
    kept_stories = [s for s in model["stories"] if s["id"] not in gen_ids]
    kept_owned = set().union(*(owned_ids(s) for s in kept_stories)) if kept_stories else set()

    def into(bb, m=2.0):
        return any(min(bb[2], x1) - max(bb[0], x0) > m and min(bb[3], b) - max(bb[1], t) > m for x0, t, x1, b in boxes_)
    gen_boxes = [[b[0] - DECOR_MM, b[1] - DECOR_MM, b[2] + DECOR_MM, b[3] + DECOR_MM]
                 for b in (s["bbox_mm"] for s in model["stories"] if s["id"] in gen_ids and s.get("bbox_mm"))]

    def within(bb, o):
        a = max(0.0, (bb[2] - bb[0]) * (bb[3] - bb[1]))
        ov = max(0.0, min(bb[2], o[2]) - max(bb[0], o[0])) * max(0.0, min(bb[3], o[3]) - max(bb[1], o[1]))
        return a > 0 and ov >= 0.8 * a
    keep, intruders, decor = [], [], []
    for e in model["elements"]:
        if e["id"] in owned:
            continue
        if e["kind"] == "body_frame" and not el_text(e).strip():
            continue                                           # an empty text frame: nothing to keep or to lose
        bb = e["bbox_mm"]
        if e["kind"] in ("rule", "box", "image", "graphic") and e["id"] not in kept_owned and any(within(bb, o) for o in gen_boxes):
            decor.append(e["id"])
            continue                                           # decoration of a story that moved (label panel, icon)
        inside = any(bb[1] >= t - 1 and bb[3] <= b + 1 and bb[0] >= x0 - 1 and bb[2] <= x1 + 1 for x0, t, x1, b in boxes_)
        if e["kind"] in ("rule", "box") and (inside or into(bb, 0.5)) and e["id"] not in kept_owned:
            decor.append(e["id"])
            continue                                           # decoration of the old plan
        if inside and e["id"] not in kept_owned:
            decor.append(e["id"])
            continue                                           # loose items of the old plan (text and photos are stories by now)
        if into(bb):
            intruders.append(e["id"])
        keep.append(e)
    for s in kept_stories:
        if s.get("bbox_mm") and into(s["bbox_mm"]):
            intruders.append(s["id"])
    return kept_stories, keep, sorted(set(intruders)), decor


def panels_of(model, gen_ids, removed):
    """Tint panels and fact-box fills of the old layout carried to the new one: a removed filled box that covers a
    generated story's printed box (≥ 70 % of it, at most 1.6× its size) is that story's panel; one that covers a loose
    text element (≥ 80 %) is that element's fill. → ({story: fill}, {element: fill})."""
    els = {e["id"]: e for e in model["elements"]}
    boxes = [els[i] for i in removed if els[i]["kind"] == "box" and els[i].get("fill")]

    def area(bb):
        return max(0.0, bb[2] - bb[0]) * max(0.0, bb[3] - bb[1])

    def ov(a, c):
        return max(0.0, min(a[2], c[2]) - max(a[0], c[0])) * max(0.0, min(a[3], c[3]) - max(a[1], c[1]))
    story_fill, el_fill = {}, {}
    for s in model["stories"]:
        if s["id"] in gen_ids and s.get("bbox_mm"):
            sb = s["bbox_mm"]
            c = [bx for bx in boxes if ov(bx["bbox_mm"], sb) >= 0.7 * area(sb) and area(bx["bbox_mm"]) <= 1.6 * area(sb)]
            if c:
                story_fill[s["id"]] = min(c, key=lambda bx: area(bx["bbox_mm"]))["fill"]
            for i in ([s["kicker"]] if s.get("kicker") else []) + list(s.get("other_elements") or []):   # label tabs, fact boxes
                if i in els:
                    eb = els[i]["bbox_mm"]
                    c = [bx for bx in boxes if ov(bx["bbox_mm"], eb) >= 0.6 * area(eb) and area(bx["bbox_mm"]) <= 4 * max(area(eb), 1.0)]
                    if c:
                        el_fill[i] = min(c, key=lambda bx: area(bx["bbox_mm"]))["fill"]
    return story_fill, el_fill


TEXT_KINDS = ("headline", "deck", "kicker", "byline", "crosshead", "caption", "jump_line", "other_text", "furniture")


def el_text(e) -> str:
    """An element's text; a body frame's is its body lines'."""
    if e["kind"] == "body_frame":
        return " ".join(l.get("text", "") for l in e.get("lines") or [] if not l.get("excluded") and l.get("use", "body") == "body")
    return e.get("text", "")


def attach_loose(m, loose, box) -> dict:
    """Loose items that belong to a real story by where print had them are given to it instead of standing alone:
    a lone headline to the nearest story below it without one (within LOOSE_GAP_MM, overlapping it across), a lone
    kicker to the nearest headed story below it without one, a lone photo or short text to the story whose printed box
    holds it or touches it (within 10 mm), a lone crosshead into that story's flow before the paragraph that follows it
    in its column. What finds no story stays a module of its own. → the page model with the stories updated."""
    els = {e["id"]: e for e in m["elements"]}
    real = [dict(s) for s in m["stories"] if s.get("bbox_mm") and box[1] - 1 <= (s["bbox_mm"][1] + s["bbox_mm"][3]) / 2 <= box[3] + 1]
    by_id = {s["id"]: s for s in real}

    def xover(a, c):
        return min(a[2], c[2]) - max(a[0], c[0]) >= 0.5 * min(a[2] - a[0], c[2] - c[0])

    def near(bb, s, gap):
        o = s["bbox_mm"]
        return xover(bb, o) and o[1] - gap <= bb[3] and bb[1] <= o[3] + gap
    keep = []
    for L in sorted(loose, key=lambda L: (not L["images"], L["id"])):     # photos first: credits follow their photo
        ids = ([L["headline"]] if L["headline"] else []) + ([L["kicker"]] if L["kicker"] else []) + L["images"] + L["other_elements"] + L["captions"]
        bb = L["bbox_mm"]
        target = None
        if L["flow"]:
            words = sum(len(b["text"].split()) for b in L["flow"])
            inner = [s for s in real if inside_frac(bb, s["bbox_mm"]) >= 0.8]
            if not L["headline"] and not L["images"] and words <= LOOSE_INTRO_WORDS and inner:
                target = min(inner, key=lambda s: (s["bbox_mm"][2] - s["bbox_mm"][0]) * (s["bbox_mm"][3] - s["bbox_mm"][1]))
                target["other_elements"] = list(target.get("other_elements") or []) + [f for c in L["columns"] for f in c["frame_ids"]]
                target.setdefault("attached_loose", []).extend(f for c in L["columns"] for f in c["frame_ids"])
                continue
            keep.append(L); continue
        if L["headline"] and not L["images"]:
            c = [s for s in real if not s.get("headline") and xover(bb, s["bbox_mm"]) and -2 <= s["bbox_mm"][1] - bb[3] <= LOOSE_GAP_MM]
            inner = [s for s in real if s.get("headline") and inside_frac(bb, s["bbox_mm"]) >= 0.8
                     and bb[3] <= min((c["first_baseline_mm"] for c in s.get("columns") or []), default=-1e9) + 2.0]   # head area only
            if not c and inner:                              # a second headline inside a story's printed box: its deck
                target = min(inner, key=lambda s: (s["bbox_mm"][2] - s["bbox_mm"][0]) * (s["bbox_mm"][3] - s["bbox_mm"][1]))
                target["decks"] = list(target.get("decks") or []) + [L["headline"]] + L["headline_parts"]
                if L["kicker"] and not target.get("kicker"):
                    target["kicker"] = L["kicker"]
            elif c:
                target = min(c, key=lambda s: s["bbox_mm"][1])
                target["headline"] = L["headline"]
                target["headline_parts"] = list(target.get("headline_parts") or []) + L["headline_parts"]
                if L["kicker"] and not target.get("kicker"):
                    target["kicker"] = L["kicker"]
        elif L["kicker"] and not L["headline"] and not L["images"] and not L["other_elements"]:
            c = [s for s in real if not s.get("kicker") and xover(bb, s["bbox_mm"]) and -2 <= s["bbox_mm"][1] - bb[3] <= 15.0]
            if c:
                target = min(c, key=lambda s: s["bbox_mm"][1]); target["kicker"] = L["kicker"]
        elif not L["headline"] and not L["kicker"]:
            c = [s for s in real if gap_mm(bb, s["bbox_mm"]) <= 10.0]
            on_photo = [s for s in real for i in s.get("images") or [] if i in els and inside_frac(bb, els[i]["bbox_mm"]) >= 0.8]
            if on_photo and not L["images"]:            # a credit or label printed on a photo goes with that photo's story
                target = on_photo[0]
            elif c:                                     # a photo: a nearby story without a photo of its own first, then the
                # nearest printed box (edge to edge, any side)
                target = min(c, key=lambda s: (bool(L["images"]) and bool(s.get("images")), gap_mm(bb, s["bbox_mm"]), -inside_frac(bb, s["bbox_mm"])))
            if target is not None:
                target["images"] = list(target.get("images") or []) + L["images"]
                target["captions"] = list(target.get("captions") or []) + L["captions"]
                xh = [i for i in L["other_elements"] if els[i]["kind"] == "crosshead"]
                target["other_elements"] = list(target.get("other_elements") or []) + [i for i in L["other_elements"] if i not in xh]
                for i in xh:
                    f2 = insert_crosshead(target["flow"], els, els[i])
                    if f2 is None:                          # it heads something else (a fact box): keep it as its own module
                        keep.append({**L, "id": f"{L['id']}-{i}", "other_elements": [i], "images": [], "captions": []})
                        ids = [x for x in ids if x != i]
                    else:
                        target["flow"] = f2
        if target is None:
            keep.append(L)
        else:
            target.setdefault("attached_loose", []).extend(ids)
    stories = [by_id.get(s["id"], s) for s in m["stories"]] + keep
    return {**m, "stories": stories}


def merge_boxed(m, box) -> dict:
    """Fact boxes: a filled box in the newshole that holds two or more small stories (at most BOX_WORDS words in all)
    becomes one boxed story — the items in printed reading order, an item's headline as a crosshead before it, the box's
    loose title and bullet column with it — so the box stays one module and keeps its fill (panels_of)."""
    els = {e["id"]: e for e in m["elements"]}
    x0, t, x1, b = box
    stories = list(m["stories"])
    owned = set().union(*(owned_ids(s_) for s_ in stories)) if stories else set()
    boxes = [e for e in m["elements"] if e["kind"] == "box" and e.get("fill") and e["bbox_mm"][0] >= x0 - 1 and e["bbox_mm"][2] <= x1 + 1
             and e["bbox_mm"][1] >= t - 1 and e["bbox_mm"][3] <= b + 1 and (e["bbox_mm"][2] - e["bbox_mm"][0]) >= 20 and (e["bbox_mm"][3] - e["bbox_mm"][1]) >= 20]
    for bx in sorted(boxes, key=lambda e: e["id"]):
        bb = bx["bbox_mm"]
        inner = [s_ for s_ in stories if s_.get("bbox_mm") and not s_.get("synthetic") and inside_frac(s_["bbox_mm"], bb) >= 0.9
                 and any(f["type"] == "para" and f["text"].strip() for f in s_["flow"])]
        words = sum(len(f["text"].split()) for s_ in inner for f in s_["flow"] if f["type"] == "para")
        if len(inner) < 2 or words > BOX_WORDS:
            continue
        inner.sort(key=lambda s_: (round(s_["bbox_mm"][1]), s_["bbox_mm"][0]))
        flow, other, images, captions, frames = [], [], [], [], []
        for s_ in inner:
            if s_.get("headline") in els:
                flow.append({"type": "crosshead", "element": s_["headline"]})
            flow += s_["flow"]
            other += [x for x in [s_.get("kicker"), s_.get("byline"), *(s_.get("decks") or []), *(s_.get("headline_parts") or []),
                                  *[y if isinstance(y, str) else y.get("id") for y in s_.get("other_elements") or []]] if x]
            images += s_.get("images") or []
            captions += s_.get("captions") or []
            frames += [f for c in s_.get("columns") or [] for f in c.get("frame_ids") or []]
        loose = [e["id"] for e in m["elements"] if e["id"] not in owned and e["kind"] in TEXT_KINDS and el_text(e).strip()
                 and inside_frac(e["bbox_mm"], bb) >= 0.8]                    # the box's title and bullet column
        for k_, s_ in enumerate(stories):                 # box items the page model gave to a neighbouring story's loose text
            oe = [y if isinstance(y, str) else y.get("id") for y in s_.get("other_elements") or []]
            take = [i for i in oe if i in els and inside_frac(els[i]["bbox_mm"], bb) >= 0.8 and s_ not in inner]
            if take:
                stories[k_] = {**s_, "other_elements": [i for i in oe if i not in take]}
                loose += take
        merged = {"id": f"box-{bx['id']}", "synthetic": True, "boxed": True, "headline": None, "headline_parts": [], "kicker": None,
                  "decks": [], "byline": None, "captions": captions, "images": images, "jump_lines": [], "other_elements": loose + other,
                  "parent_story": None, "bbox_mm": list(bb), "columns": [{"frame_ids": frames, "first_baseline_mm": bb[1]}],
                  "flow": flow, "merged_from": [s_["id"] for s_ in inner]}
        gone = {s_["id"] for s_ in inner}
        stories = [s_ for s_ in stories if s_["id"] not in gone] + [merged]
        owned |= owned_ids(merged)
    return {**m, "stories": stories}


def merge_briefs(m, ids) -> dict:
    """A page with more stories than the search takes: briefs (at most BRIEF_WORDS words, a headline of at most
    BRIEF_HEAD_PT, no photo) printed in the same column are stacked into one "news in brief" module — each brief's
    headline as a crosshead before its text, in printed order — so the page fits the search."""
    els = {e["id"]: e for e in m["elements"]}

    def brief(s_):
        w = sum(len(f["text"].split()) for f in s_["flow"] if f["type"] == "para")
        hs = els[s_["headline"]]["size_pt"] if s_.get("headline") in els else 0.0
        return s_["id"] in ids and s_.get("bbox_mm") and 0 < w <= BRIEF_WORDS and hs <= BRIEF_HEAD_PT and not s_.get("images") \
            and not s_.get("parent_story")
    briefs = sorted([s_ for s_ in m["stories"] if brief(s_)], key=lambda s_: (round(s_["bbox_mm"][0] / 10), s_["bbox_mm"][1]))
    groups = []
    for s_ in briefs:
        b = s_["bbox_mm"]
        for g_ in groups:
            o = g_[-1]["bbox_mm"]
            if min(b[2], o[2]) - max(b[0], o[0]) >= 0.5 * min(b[2] - b[0], o[2] - o[0]) and b[1] - o[3] <= 15.0:
                g_.append(s_); break
        else:
            groups.append([s_])
    stories, n = list(m["stories"]), 0
    for g_ in groups:
        if len(g_) < 2:
            continue
        n += 1
        flow, other, frames = [], [], []
        for s_ in g_:
            if s_.get("headline") in els:
                flow.append({"type": "crosshead", "element": s_["headline"]})
            flow += s_["flow"]
            other += [x for x in [s_.get("kicker"), s_.get("byline"), *(s_.get("decks") or []), *(s_.get("headline_parts") or []),
                                  *[y if isinstance(y, str) else y.get("id") for y in s_.get("other_elements") or []]] if x]
            frames += [f for c in s_.get("columns") or [] for f in c.get("frame_ids") or []]
        bb = [min(x["bbox_mm"][0] for x in g_), min(x["bbox_mm"][1] for x in g_), max(x["bbox_mm"][2] for x in g_), max(x["bbox_mm"][3] for x in g_)]
        gone = {x["id"] for x in g_}
        stories = [x for x in stories if x["id"] not in gone] + [{
            "id": f"briefs{n}", "synthetic": True, "headline": None, "headline_parts": [], "kicker": None, "decks": [], "byline": None,
            "captions": [], "images": [], "jump_lines": [], "other_elements": other, "parent_story": None, "bbox_mm": bb,
            "columns": [{"frame_ids": frames, "first_baseline_mm": bb[1]}], "flow": flow, "merged_from": [x["id"] for x in g_]}]
    return {**m, "stories": stories}


def fold_pull_quotes(m) -> dict:
    """A short child story (a pull quote: at most QUOTE_WORDS words, no headline, no photo) goes into its parent story as
    a boxed block under the parent's display text, so it stays with the story it quotes."""
    by_id = {s_["id"]: dict(s_) for s_ in m["stories"]}
    els = {e["id"]: e for e in m["elements"]}
    gone, new_els = set(), []
    for s_ in m["stories"]:
        par = s_.get("parent_story")
        paras = [f["text"] for f in s_["flow"] if f["type"] == "para" and f["text"].strip()]
        words = sum(len(t.split()) for t in paras)
        if par in by_id and not s_.get("headline") and not s_.get("images") and 0 < words <= QUOTE_WORDS:
            # the quote's own text (its frames may be shared with the parent: never copy a whole frame)
            frame = next((els.get("bf-" + f) for c in s_.get("columns") or [] for f in c.get("frame_ids") or [] if els.get("bf-" + f)), None)
            q = {"id": f"pq-{s_['id']}", "kind": "other_text", "text": " ".join(" ".join(paras).split()),
                 "size_pt": (frame or {}).get("size_pt") or 12.0, "font": (frame or {}).get("font") or "Body",
                 "bbox_mm": list(s_.get("bbox_mm") or [0, 0, 0, 0]), "lines": [], "synthetic": True}
            new_els.append(q)
            p_ = by_id[par]
            extra = [x for x in [s_.get("kicker"), s_.get("byline"), *(s_.get("decks") or []),
                                 *[y if isinstance(y, str) else y.get("id") for y in s_.get("other_elements") or []]] if x]
            p_["other_elements"] = list(p_.get("other_elements") or []) + [q["id"]] + extra
            frames = [f for c in s_.get("columns") or [] for f in c.get("frame_ids") or []]
            p_["columns"] = list(p_.get("columns") or []) + [{"frame_ids": frames, "first_baseline_mm": 1e9}]   # ownership only
            p_.setdefault("folded_quotes", []).append(s_["id"])
            gone.add(s_["id"])
    return {**m, "elements": m["elements"] + new_els, "stories": [by_id[s_["id"]] for s_ in m["stories"] if s_["id"] not in gone]}


def gap_mm(a, b) -> float:
    """Edge-to-edge distance of two boxes (0 if they overlap)."""
    return max(0.0, max(a[0], b[0]) - min(a[2], b[2]), max(a[1], b[1]) - min(a[3], b[3]))


def inside_frac(bb, o) -> float:
    a = max(1e-9, (bb[2] - bb[0]) * (bb[3] - bb[1]))
    return max(0.0, min(bb[2], o[2]) - max(bb[0], o[0])) * max(0.0, min(bb[3], o[3]) - max(bb[1], o[1])) / a


def insert_crosshead(flow, els, xh):
    """A crosshead into a flow before the paragraph whose first printed line follows it in its column."""
    xb = xh["lines"][0]["baseline_mm"] if xh.get("lines") else xh["bbox_mm"][3]
    best, at = None, len(flow)
    for k, b in enumerate(flow):
        if b["type"] != "para" or not b.get("lines"):
            continue
        ref = str(b["lines"][0].get("line_ref", ""))
        fe = els.get("bf-" + ref.split(":")[0]) if ":" in ref else None
        if not fe:
            continue
        ln = fe["lines"][int(ref.split(":")[1])] if int(ref.split(":")[1]) < len(fe["lines"]) else None
        if ln and min(ln["x1_mm"], xh["bbox_mm"][2]) - max(ln["x0_mm"], xh["bbox_mm"][0]) > 0 and ln["baseline_mm"] > xb:
            if best is None or ln["baseline_mm"] < best:
                best, at = ln["baseline_mm"], k
    if best is None or best - xb > XH_FOLLOW_MM:          # no paragraph right under it: not a crosshead of this flow
        return None
    return flow[:at] + [{"type": "crosshead", "element": xh["id"]}] + flow[at:]


def is_icon(e) -> bool:
    """A small image (both sides under ICON_MM): decoration such as a pen or logo icon, not a news photo."""
    b = e["bbox_mm"]
    return b[2] - b[0] < ICON_MM and b[3] - b[1] < ICON_MM


def loose_icons(m, box, photo_ids) -> list:
    """Icons of no story inside the newshole: not set by the generator (reported in the manifest)."""
    owned = set().union(*(owned_ids(s) for s in m["stories"])) if m["stories"] else set()
    x0, t, x1, b = box
    return [e["id"] for e in m["elements"] if e["kind"] == "image" and e["id"] in photo_ids and e["id"] not in owned and is_icon(e)
            and e["bbox_mm"][0] >= x0 - 1 and e["bbox_mm"][2] <= x1 + 1 and e["bbox_mm"][1] >= t - 1 and e["bbox_mm"][3] <= b + 1]


def loose_stories(m, box, photo_ids, ad_block=None) -> list:
    """Text and photos inside the newshole that the page model gave to no story (an editorial set as a free text frame,
    a picture with its headline, a lone label): grouped by where print had them — an item joins the nearest headline or
    kicker above it that overlaps it across by half its width, within LOOSE_GAP_MM — and turned into stories of their
    own, so nothing on the page is lost. Long text (≥ LOOSE_BODY_WORDS words) becomes body text, short text a tag."""
    owned = set().union(*(owned_ids(s) for s in m["stories"])) if m["stories"] else set()
    ads = [e["bbox_mm"] for e in m["elements"] if e["kind"] == "ad"]
    x0, t, x1, b = box

    def inside(bb):                                    # mostly inside (a rail may reach a few mm past the newshole's edge)
        return inside_frac(bb, (x0, t, x1, b)) >= LOOSE_INSIDE

    def in_ad(bb):
        return any(a[0] - 0.5 <= bb[0] and bb[2] <= a[2] + 0.5 and a[1] - 0.5 <= bb[1] and bb[3] <= a[3] + 0.5 for a in ads)
    U = [e for e in m["elements"] if e["id"] not in owned and inside(e["bbox_mm"]) and not in_ad(e["bbox_mm"]) and not e.get("run_in")
         and not (ad_block and inside_frac(e["bbox_mm"], ad_block) >= 0.8) and (
        (e["kind"] in TEXT_KINDS + ("body_frame",) and el_text(e).split() and not CP.only_bullets(el_text(e))) or (e["kind"] == "image" and e["id"] in photo_ids
                                                                                                         and not is_icon(e)))]
    U.sort(key=lambda e: (e["bbox_mm"][1], e["bbox_mm"][0], e["id"]))

    def xover(a, c):
        return min(a[2], c[2]) - max(a[0], c[0]) >= 0.5 * min(a[2] - a[0], c[2] - c[0])
    seeds = [e for e in U if e["kind"] in ("headline", "kicker")]
    group = {e["id"]: [e] for e in seeds}
    head_of = {}
    for e in U:
        if e in seeds and e["kind"] == "headline":
            continue
        above = [sd for sd in seeds if sd is not e and sd["kind"] == "headline" and sd["bbox_mm"][1] <= e["bbox_mm"][1] + 1 and xover(sd["bbox_mm"], e["bbox_mm"])
                 and e["bbox_mm"][1] - sd["bbox_mm"][3] <= LOOSE_GAP_MM] if e["kind"] != "kicker" else \
                [sd for sd in seeds if sd["kind"] == "headline" and sd["bbox_mm"][1] >= e["bbox_mm"][1] - 1 and xover(sd["bbox_mm"], e["bbox_mm"])
                 and sd["bbox_mm"][1] - e["bbox_mm"][3] <= 15.0]                       # a kicker joins the headline below it
        if above:
            sd = max(above, key=lambda q: q["bbox_mm"][3]) if e["kind"] != "kicker" else min(above, key=lambda q: q["bbox_mm"][1])
            group[sd["id"]].append(e); head_of[e["id"]] = sd["id"]
            group.pop(e["id"], None)
        elif e["id"] not in group:
            # no heading above: join the loose piece right above it in the same column (one box's lines), else alone
            prev = next((g_ for g_ in reversed(list(group.values())) if g_[0]["kind"] not in ("headline", "kicker")
                         and min(g_[-1]["bbox_mm"][2], e["bbox_mm"][2]) - max(g_[-1]["bbox_mm"][0], e["bbox_mm"][0])
                         >= 0.8 * min(g_[-1]["bbox_mm"][2] - g_[-1]["bbox_mm"][0], e["bbox_mm"][2] - e["bbox_mm"][0])
                         and 0 <= e["bbox_mm"][1] - g_[-1]["bbox_mm"][3] <= LOOSE_JOIN_MM), None)
            if prev is not None:
                prev.append(e)
            else:
                group[e["id"]] = [e]
    out = []
    for n, (gid, items) in enumerate(sorted(group.items(), key=lambda kv: (kv[1][0]["bbox_mm"][1], kv[0]))):
        heads = [e for e in items if e["kind"] == "headline"]
        kick = [e for e in items if e["kind"] == "kicker"]
        body = [e for e in items if e["kind"] == "body_frame" or (e["kind"] not in ("headline", "kicker", "image", "caption")
                                                                  and len(el_text(e).split()) >= LOOSE_BODY_WORDS)]
        tags = [e for e in items if e["kind"] not in ("headline", "kicker", "image", "caption") and e not in body] + kick[1:]
        bb = [min(e["bbox_mm"][0] for e in items), min(e["bbox_mm"][1] for e in items), max(e["bbox_mm"][2] for e in items), max(e["bbox_mm"][3] for e in items)]
        out.append({"id": f"loose{n + 1}", "synthetic": True, "headline": heads[0]["id"] if heads else None,
                    "headline_parts": [e["id"] for e in heads[1:]], "kicker": kick[0]["id"] if kick else None, "decks": [], "byline": None,
                    "captions": [e["id"] for e in items if e["kind"] == "caption"], "images": [e["id"] for e in items if e["kind"] == "image"],
                    "jump_lines": [], "other_elements": [e["id"] for e in tags], "parent_story": None, "bbox_mm": bb,
                    "columns": [{"frame_ids": [e["id"] for e in body], "first_baseline_mm": bb[1]}],
                    "flow": [{"type": "para", "text": " ".join(el_text(e).split()), "indent_mm": 0.0,
                              "lines": [{"line_ref": "gen:0", "col": 0, "text": " ".join(el_text(e).split())}]} for e in body]})
    return out


def span_prior_from(cal_models):
    """−log P(span | priority bucket), counted on the CALIBRATION editions (add-one smoothing)."""
    cnt = {b: Counter() for b in (0, 1, 2)}
    for m in cal_models:
        els = {e["id"]: e for e in m["elements"]}
        main = [s for s in m["stories"] if not s.get("parent_story") and s.get("bbox_mm")]
        main.sort(key=lambda s: -(els[s["headline"]]["size_pt"] if s.get("headline") in els else 0))
        for r, s in enumerate(main):
            x0, _, x1, _ = s["bbox_mm"]
            w = max(1, min(NCOL, round((x1 - x0 + GUT) / PITCH)))
            cnt[0 if r == 0 else 1 if r <= 2 else 2][w] += 1
    tab = {b: {w: -math.log((c[w] + 1) / (sum(c.values()) + NCOL)) for w in range(1, NCOL + 1)} for b, c in cnt.items()}
    return (lambda r, w: tab[0 if r == 0 else 1 if r <= 2 else 2][w]), {b: dict(c) for b, c in cnt.items()}


def styles_from(cal_models, min_count=10) -> dict:
    """The house's body type styles (size pt, leading pt) used by at least min_count main stories on the CALIBRATION
    editions, with their counts. Marathi stories only (the English flip pages use their own type)."""
    c = Counter()
    for m in cal_models:
        for s in m["stories"]:
            txt = "".join(b["text"] for b in s["flow"] if b["type"] == "para")
            if s.get("parent_story") or not s.get("body_size_pt") or not s.get("body_leading_pt") or not deva(txt):
                continue
            c[(round(s["body_size_pt"] * 2) / 2, round(s["body_leading_pt"] * 2) / 2)] += 1
    out = {k: v for k, v in c.items() if v >= min_count and k[1] / k[0] <= MAX_LEAD_RATIO}
    if not out:
        sys.exit("no house body style with enough calibration stories")
    return out


def space_em_from(cal_models) -> float:
    """The house's nominal word space (em of the house face), the median over the calibration editions' stories."""
    v = sorted(s["space_em"] for m in cal_models for s in m["stories"] if s.get("space_em"))
    return v[len(v) // 2] if v else 0.25


def lead_side_from(cal_models) -> str:
    left = right = 0
    for m in cal_models:
        els = {e["id"]: e for e in m["elements"]}
        main = [s for s in m["stories"] if s.get("headline") in els and s.get("bbox_mm")]
        if not main:
            continue
        lead = max(main, key=lambda s: els[s["headline"]]["size_pt"])
        cx_ = (lead["bbox_mm"][0] + lead["bbox_mm"][2]) / 2
        left += cx_ < m["page_w_mm"] / 2; right += cx_ >= m["page_w_mm"] / 2
    return "left" if left >= right else "right"


def newshole(m):
    """(top, bottom) of the news area or a reason it is not a free rectangle. Top: the highest main story. Bottom: above a
    full-width band of ads at the foot of the page (3 mm clear), else the lowest story."""
    main_ = [s for s in m["stories"] if s.get("headline") and not s.get("parent_story") and s.get("bbox_mm")]
    if not main_:
        return None, "no stories with headlines"
    ads = [e["bbox_mm"] for e in m["elements"] if e["kind"] == "ad"]
    top = min(s["bbox_mm"][1] for s in main_)
    x_hi = ORIGIN + span_mm(NCOL)
    if ads:
        band_top = min(a[1] for a in ads)
        band = (all(a[3] > m["page_h_mm"] * 0.9 for a in ads) and min(a[0] for a in ads) < ORIGIN + GUT
                and max(a[2] for a in ads) > x_hi - GUT and band_top > top + 50)
        if band:
            return (top, band_top - 3.0, None), None
        if len(ads) == 1 and ads[0][1] > top - 1:          # one ad block inside the news area: the newshole goes around it
            ad = list(ads[0])
            for e in m["elements"]:                        # strips touching it (a coloured bar with its text) are the ad's frame
                b = e["bbox_mm"]
                if e["kind"] in ("furniture", "box", "other_text", "graphic") and min(b[2], ad[2]) - max(b[0], ad[0]) >= 0.8 * (ad[2] - ad[0]) \
                        and (0 <= ad[1] - b[3] <= AD_STRIP_MM or 0 <= b[1] - ad[3] <= AD_STRIP_MM or (b[1] < ad[1] < b[3]) or (b[1] < ad[3] < b[3])) \
                        and b[3] - b[1] <= 15.0:
                    ad = [min(ad[0], b[0]), min(ad[1], b[1]), max(ad[2], b[2]), max(ad[3], b[3])]
            return (top, max(s["bbox_mm"][3] for s in m["stories"] if s.get("bbox_mm")), ad), None
        return None, "irregular ad shapes (more than one ad block)"
    return (top, max(s["bbox_mm"][3] for s in m["stories"] if s.get("bbox_mm")), None), None


def regions_for(top, bottom, ad):
    """The newshole as rectangles of whole grid columns: all of it, or — around one ad block — the columns left and right
    of the ad at full height and the ad's columns above and below it (3 mm clear; strips under MIN_REGION_MM dropped).
    → [(first column, columns, top mm, bottom mm)]."""
    if ad is None:
        return [(0, NCOL, top, bottom)]
    c0 = max(0, min(NCOL, math.floor((ad[0] - ORIGIN + 1.0) / PITCH)))      # every column the ad touches is the ad's
    c1 = max(c0 + 1, min(NCOL, math.ceil((ad[2] - ORIGIN - 1.0) / PITCH)))
    out = []
    if c0 > 0:
        out.append((0, c0, top, bottom))
    if ad[1] - 3.0 - top >= MIN_REGION_MM:
        out.append((c0, c1 - c0, top, ad[1] - 3.0))
    if bottom - (ad[3] + 3.0) >= MIN_REGION_MM:
        out.append((c0, c1 - c0, ad[3] + 3.0, bottom))
    if c1 < NCOL:
        out.append((c1, NCOL - c1, top, bottom))
    return out


def region_box(r):
    c0, w, t, b = r
    return (ORIGIN + c0 * PITCH, t, ORIGIN + c0 * PITCH + span_mm(w), b)


# ------------------------------------------------------------------------------------------- render
def draw_block(B, blk, x, y, span, meta, inset=0.0, cmyk=None):
    role, eid, r, bl, font, align = blk
    cmyk = cmyk or CP.BLACK
    x, span = x + inset, span - 2 * inset
    if align == "fill":                                  # a filled headline: each line its own shaping, full measure
        for (p, axes, gap, off, hs), yb in zip(r, bl):
            fk = B.font(CP.SANS, axes, 800)
            B.register(fk, p)
            B.tokens_line(p, 0, len(p.words), x + off, y + yb, fk, CP.BLACK, meta={**meta, "role": role, "element": eid}, gap_extra=gap, hscale=hs)
        return
    fam, ax, wt = font
    fk = B.font(fam, ax, wt)
    B.register(fk, r.p)
    for (a_, b_), wmm, yb in zip(r.lines, r.widths_mm, bl):
        xx = x + (span - wmm) / 2 if align == "center" else x + span - wmm if align == "right" else x
        B.tokens_line(r.p, a_, b_, xx, y + yb, fk, cmyk, meta={**meta, "role": role, "element": eid})


def render(g: Generator, model, placed, news_top, news_bottom, photo_dir, kept_stories, keep, fills=({}, {})):
    """The fixed parts of the page via the page rebuild, then the modules. → (Builder, report, number of fixed items)."""
    kid = {e["id"] for e in keep}
    fixed = {**model, "elements": keep, "stories": kept_stories, "unassigned": [u for u in model.get("unassigned", []) if u in kid]}
    B, rep = CP.build(g.cx, fixed, photo_dir)
    n_fixed, rep["fixed_problems"] = len(B.items), len(B.problems)
    rep.update({"stories": [], "display": []})
    for i, x, y, w, h, o in placed:
        s = g.stories[i]
        span = span_mm(w)
        meta = {"page": model["page"], "story": s.id}
        if s.id in fills[0]:                              # the story's tint panel, as in print (behind the module)
            c, _ = CP.to_cmyk(fills[0][s.id])
            if c:
                B.rect_mm(x, y + 1.0, x + span, y + h - 1.0, c)
        if y > news_top + 0.5:
            B.line_mm((x, y), (x + span, y), 0.5, CP.BLACK)
        dsp = g.display(s, w, o["step"])
        boxed = {b[2] for b in dsp["boxes"]}
        for t0, t1, eid in dsp["boxes"]:                  # a fact box keeps its printed fill
            if eid in fills[1]:
                c, _ = CP.to_cmyk(fills[1][eid])
                if c:
                    B.rect_mm(x, y + t0, x + span, y + t1, c)
        for blk in dsp["blocks"]:
            if blk[0] == "kicker" and blk[1] in fills[1]:    # a label tab: its printed panel and text colour, as wide as print
                kel = g.els[blk[1]]
                c, _ = CP.to_cmyk(fills[1][blk[1]])
                pw = min(span, max(max(blk[2].widths_mm) + 4.0, kel["bbox_mm"][2] - kel["bbox_mm"][0] + 4.0, 20.0))
                ks = blk[2].size_pt / MM
                if c:
                    B.rect_mm(x, y + blk[3][0] - 0.95 * ks, x + pw, y + blk[3][-1] + 0.4 * ks, c)
                draw_block(B, blk, x, y, pw, meta, 0.0, CP._colour(kel, rep) if c else CP.BLACK)   # no panel: never white text
                continue
            draw_block(B, blk, x, y, span, meta, BOX_PAD if blk[1] in boxed else 0.0)
        for t0, t1, _ in dsp["boxes"]:
            for p0, p1 in (((x, y + t0), (x + span, y + t0)), ((x + span, y + t0), (x + span, y + t1)), ((x + span, y + t1), (x, y + t1)), ((x, y + t1), (x, y + t0))):
                B.line_mm(p0, p1, 1.0, CP.BLACK)
        style, ph = o["style"], o["photo"]
        lead_b = style[1] / MM
        R, y_b0 = o["rows"], y + o["y_b0"]
        photo_box, extra_boxes = None, []
        if ph:
            ph_top, ph_h, ph_w = y + ph["ph_top"], ph["ph_h"], ph["ph_w"]
            raw = gzip.decompress(s.photo["path"].read_bytes())
            W0, H0 = s.photo["w"], s.photo["h"]
            want = ph_w / ph_h
            if W0 / H0 > want:                                   # too wide: crop the sides
                cwp = min(W0, max(1, round(H0 * want))); x_off, y_off, cpx, chp = (W0 - cwp) // 2, 0, cwp, H0
            else:                                                # too tall: crop top and bottom
                chp = min(H0, max(1, round(W0 / want))); x_off, y_off, cpx, chp = 0, (H0 - chp) // 2, W0, chp
            rows_px = [raw[((y_off + r_) * W0 + x_off) * 4:((y_off + r_) * W0 + x_off + cpx) * 4] for r_ in range(chp)]
            B.items.append(X.Image(x * MM, (B.page_h - ph_top - ph_h) * MM, ph_w * MM, ph_h * MM, cpx, chp, b"".join(rows_px)))
            photo_box = [round(x, 3), round(ph_top, 3), round(x + ph_w, 3), round(ph_top + ph_h, 3)]
            yb = ph_top + ph_h
            for e in s.photos_extra:                             # further photos: stacked, full frame (no crop)
                eh = ph_w / e["aspect"]
                raw_e = gzip.decompress(e["path"].read_bytes())
                B.items.append(X.Image(x * MM, (B.page_h - yb - PHOTO_GAP - eh) * MM, ph_w * MM, eh * MM, e["w"], e["h"], raw_e))
                extra_boxes.append([round(x, 3), round(yb + PHOTO_GAP, 3), round(x + ph_w, 3), round(yb + PHOTO_GAP + eh, 3)])
                yb += PHOTO_GAP + eh
            if ph["cap"]:
                cr, clead, cap_h, font, _ = g.caption(s, ph_w)
                bl = [yb + cap_h - (len(cr.lines) - 1) * clead + n * clead for n in range(len(cr.lines))]
                draw_block(B, ("caption", f"gen-c-{s.id}", cr, [b - y for b in bl], font, "left"), x, y, ph_w, meta)
        cols = []
        for k in range(o["m"]):
            x0 = x + k * (o["cw"] + GUT)
            under = bool(ph) and k < ph["k"]
            first = y_b0 + (ph["j"] * lead_b if under else 0.0)
            n = R - (ph["j"] if under else 0)
            cols.append({"frame_ids": [], "x0_mm": x0, "x1_mm": x0 + o["cw"], "top_mm": first - 0.8 * style[0] / MM,
                         "bottom_mm": y_b0 + (R - 1) * lead_b + 0.3, "first_baseline_mm": first, "n_lines": max(n, 0), "leading_mm": lead_b})
        res = g.set_body(B, s, cols, meta, rep, o["fit"], style)
        tail_y = y_b0 + (R - 1) * lead_b if R else y + dsp["top_text"] + dsp["desc_last"]
        for blk in dsp["tail"]:
            draw_block(B, blk, x, tail_y, span, meta)
        rep["stories"].append({**res, "w": w, "m": o["m"], "fit": o["fit"], "style": list(style), "photo_box": photo_box, "extra_photo_boxes": extra_boxes,
                               "photo_cols": ph["k"] if ph else None, "x": round(x, 2), "y": round(y, 2), "h": round(h, 2), "photo": bool(ph),
                               "not_set": s.not_set, "bullet_columns_skipped": s.bullet_columns})
    return B, rep, n_fixed


def pdf_bytes(m, B, items):
    data, _ = X.build_pdf([X.Page(m["page_w_mm"] * MM, m["page_h_mm"] * MM, items)], B.fonts, title="Pageinator generated page (TEST)",
                          output_intent=MP.OUTPUT_INTENTS["IFRA26"], actualtext=True, pdf_version="1.4", pdfx_info=MP.PDFX["X-1a:2003"]["info"],
                          creator="Pageinator EXP-GEN-1")
    return data


def main():
    args = sys.argv[1:]
    opt = {}
    for flag in ("--out", "--lead-side"):                # --out DIR: write elsewhere (alternatives); --lead-side: force it
        if flag in args:
            i = args.index(flag); opt[flag] = args[i + 1]; del args[i:i + 2]
    ds = Path(args[0]).expanduser()
    names = args[1:]
    pages_dir = ds / "report" / "page1" / "pages"
    out_dir = Path(opt["--out"]).expanduser() if "--out" in opt else ds / "report" / "gen1"
    out_dir.mkdir(parents=True, exist_ok=True)
    cx = CP.Context(ds, "paper")                              # paper-level body size: nothing printed is used to size text
    models = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted(pages_dir.glob("*.json"))}
    cal = [m for m in models.values() if m["split"] == "cal"]
    span_prior, span_counts = span_prior_from(cal)
    lead_side = opt.get("--lead-side") or lead_side_from(cal)
    assert lead_side in ("left", "right"), lead_side
    styles = styles_from(cal)
    styles_ext = styles_from(cal, RARE_STYLE_MIN)       # rarer house styles (e.g. tight leading on dense pages): fallback only
    space_em = space_em_from(cal)
    print("house body styles (calibration editions):", styles, "word space em:", space_em)
    todo = names or [k for k, m in models.items() if m["split"] == "test"]
    results = []
    for name in todo:
        m = models[name]
        if not deva("".join(b["text"] for s in m["stories"] for b in s["flow"] if b["type"] == "para")):
            continue
        hole, why = newshole(m)
        if hole is None:
            results.append({"page": name, "status": f"skipped: {why}"}); print(name, "skipped:", why); continue
        news_top, news_bottom, ad_block = hole
        x_hi = ORIGIN + span_mm(NCOL)
        photo_dir = ds / "report" / "page1" / "photos" / name
        photo_ids = set(json.loads((photo_dir / "index.json").read_text())["elements"]) if (photo_dir / "index.json").exists() else set()
        m_orig = m
        for _ in range(4):
            hole_box = (ORIGIN, news_top, x_hi, news_bottom)
            m0 = fold_pull_quotes(merge_boxed(m_orig, hole_box))
            m = attach_loose(m0, loose_stories(m0, hole_box, photo_ids, ad_block), hole_box)
            regions = regions_for(news_top, news_bottom, ad_block)
            rboxes = [region_box(r) for r in regions]

            def in_regions(bb):                       # at least half of it lies in the regions (not just its centre, which
                a = max(1e-9, (bb[2] - bb[0]) * (bb[3] - bb[1]))   # for a page-wide story can fall in a gutter between them)
                return sum(max(0.0, min(bb[2], x1) - max(bb[0], x0)) * max(0.0, min(bb[3], b) - max(bb[1], t)) for x0, t, x1, b in rboxes) >= 0.5 * a
            ids = {s["id"] for s in m["stories"] if s.get("bbox_mm") and in_regions(s["bbox_mm"])}
            kept_stories, keep, intruders, decor = fixed_parts(m, ids, rboxes)
            # small fixed items on the newshole's top or bottom edge (a section logo, an emblem, a boxed notice at the foot):
            # move that edge clear of them, as a designer would; anything else inside makes the page irregular
            boxes = {e["id"]: e["bbox_mm"] for e in m["elements"]} | {s_["id"]: s_["bbox_mm"] for s_ in m["stories"] if s_.get("bbox_mm")}
            top_i = [boxes[i] for i in intruders if (boxes[i][1] <= news_top + 2 or boxes[i][3] <= news_top + EDGE_TOP_MM)
                     and boxes[i][3] - boxes[i][1] < EDGE_MM]
            bot_i = [boxes[i] for i in intruders if boxes[i][3] >= news_bottom - 2 and boxes[i][3] - boxes[i][1] < EDGE_MM]
            if not intruders or not (top_i or bot_i):
                break
            if top_i:
                news_top = max(b[3] for b in top_i) + 2.0
            if bot_i:
                news_bottom = min(b[1] for b in bot_i) - 3.0
        if intruders:
            results.append({"page": name, "status": "skipped: fixed parts reach into the newshole", "intruders": len(intruders)})
            print(name, "skipped: fixed parts reach into the newshole", len(intruders)); continue
        n_cand = sum(1 for s_ in m["stories"] if s_["id"] in ids and (s_.get("synthetic") or any(f["type"] == "para" and f["text"].strip() for f in s_["flow"])))
        if n_cand > MAX_STORIES:                     # too many for the search: stack the briefs of each column into one module
            m = merge_briefs(m, ids)
            ids = {s_["id"] for s_ in m["stories"] if s_.get("bbox_mm") and in_regions(s_["bbox_mm"])}
            kept_stories, keep, intruders, decor = fixed_parts(m, ids, rboxes)
            if intruders:
                results.append({"page": name, "status": "skipped: fixed parts reach into the newshole", "intruders": len(intruders)})
                print(name, "skipped: fixed parts reach into the newshole (after stacking briefs)"); continue
        g = Generator(cx, m, photo_dir, styles, ids, space_em)
        if len(g.stories) > MAX_STORIES:
            results.append({"page": name, "status": f"skipped: more than {MAX_STORIES} stories (search limit)"}); print(name, "skipped:", len(g.stories), "stories"); continue
        retries = []
        for attempt in range(RETRIES + 1):
            res, info = g.run(regions, span_prior, lead_side)
            if res is None and not info.get("budget_hit") and len(styles_ext) > len(styles) and not g.ext_styles:
                # no exact fit with the commonest styles: retry once with the house's rarer body styles too (they cost more)
                g = Generator(cx, m, photo_dir, styles_ext, ids, space_em)
                g.ext_styles = True
                res, info = g.run(regions, span_prior, lead_side)
                info["rare_styles"] = True
            if res is None:
                break
            placed = [pl for k, tree in res[1] for pl in g.place(tree, ORIGIN + regions[k][0] * PITCH, regions[k][2])]
            B, rep, n_fixed = render(g, m, placed, news_top, news_bottom, photo_dir, kept_stories, keep, panels_of(m, ids, decor))
            over = [(st_, o) for st_, (_, _, _, _, _, o) in zip(rep["stories"], placed) if st_["overset_lines"] or st_.get("overset_crosshead_words")]
            if not over or attempt == RETRIES:
                break
            for st_, o in over:                          # the dry run missed a column break: one more row, search again
                k = (st_["story"], o["w"], o["m"], o["fit"], o["style"])
                g.extra_rows[k] = g.extra_rows.get(k, 0) + 1
            retries.append([st_["story"] for st_, _ in over])
        if res is None:
            results.append({"page": name, "status": "budget" if info.get("budget_hit") else "infeasible", **info,
                            "stories": len(g.stories), "retries": len(retries)})
            print(name, "no layout", info); continue
        data = pdf_bytes(m, B, B.items)
        pdf = out_dir / f"{name}.pdf"; pdf.write_bytes(data); pdf.chmod(0o600)
        fpdf = out_dir / f"{name}.fixed.pdf"; fpdf.write_bytes(pdf_bytes(m, B, B.items[:n_fixed])); fpdf.chmod(0o600)
        st_ = rep["stories"]
        summ = {"page": name, "status": "generated", "stories": len(g.stories), "cost": round(res[0], 3), **info, "retries": len(retries),
                "overset_lines": sum(s["overset_lines"] for s in st_), "copyfit": sum(1 for s in st_ if s["fit"] < 1.0),
                "spans": [s["w"] for s in st_], "photos": sum(s["photo"] for s in st_), "problems": len(B.problems) - rep["fixed_problems"],
                "not_set": {k: sum(len(s["not_set"][k]) for s in st_) for k in ("photos", "captions", "jump_lines", "other_elements")}}
        man = {"schema": "pageinator.gen1.page/2", "generator": GEN, "sha256": hashlib.sha256(data).hexdigest(), **summ,
               "fixed_problems": rep["fixed_problems"], "lead_side": lead_side,
               "newshole_box_mm": [ORIGIN, round(news_top, 3), round(x_hi, 3), round(news_bottom, 3)],
               "regions_mm": [[round(v, 3) for v in b] for b in rboxes], "ad_block_mm": ad_block,
               "placed": [{"story": g.stories[i].id, "rank": g.stories[i].rank, "x": round(x, 2), "y": round(y, 2), "w": w, "h": round(h, 2),
                           "m": o["m"], "fit": o["fit"], "photo_cols": o["photo"]["k"] if o["photo"] else None} for i, x, y, w, h, o in placed],
               "head_ids": {s.id: s.head_ids for s in g.stories}, "deck_ids": {s.id: s.deck_ids for s in g.stories},
               "caption_ids": {s.id: s.caption["ids"] for s in g.stories if s.caption},
               "synthetic_stories": [s.src for s in g.stories if s.src.get("synthetic")],
               "stories_used": [s.src for s in g.stories],
               "synthetic_elements": [e for e in m["elements"] if e.get("synthetic")],          # as laid out (loose items attached)
               "icons_not_set": loose_icons(m_orig, (ORIGIN, news_top, x_hi, news_bottom), photo_ids),
               "decoration_removed": decor,               # the old layout's rules, boxes, panels, icons, graphics (reported)
               "decoration_removed_detail": [[i, (els_ := {e["id"]: e for e in m["elements"]})[i]["kind"],
                                              round(els_[i]["bbox_mm"][2] - els_[i]["bbox_mm"][0], 1), round(els_[i]["bbox_mm"][3] - els_[i]["bbox_mm"][1], 1),
                                              bool(els_[i].get("fill"))] for i in decor],
               "panels_carried": {"stories": sorted(panels_of(m, ids, decor)[0]), "elements": sorted(panels_of(m, ids, decor)[1])},
               "photos_drawn": sorted({e["id"] for e in keep if e["kind"] in ("image", "ad") and e["id"] in photo_ids}
                                      | {p["id"] for s in g.stories for p in ([s.photo] if s.photo else []) + s.photos_extra}),
               # what stays where print had it and generated text must not touch (ads, photos, graphics, filled boxes)
               "fixed_boxes_mm": [[e["kind"], e["bbox_mm"]] for e in keep if e["kind"] in ("ad", "image", "graphic") or (e["kind"] == "box" and e.get("fill"))],
               "stories_out": st_, "problems": B.problems, "lines": B.lines, "retried": retries}
        (out_dir / f"{name}.manifest.json").write_text(json.dumps(man, ensure_ascii=False) + "\n"); (out_dir / f"{name}.manifest.json").chmod(0o600)
        results.append(summ)
        print(name, json.dumps(summ))
    agg = {"schema": "pageinator.gen1.summary/2", "generator": GEN, "lead_side": lead_side,
           "body_styles": {f"{a}/{b}": v for (a, b), v in sorted(styles.items())}, "span_counts_calibration": span_counts,
           "pages": len(results), "status": dict(Counter(r["status"].split(":")[0] for r in results)),
           "skip_reasons": dict(Counter(r["status"].split(": ", 1)[1] for r in results if r["status"].startswith("skipped"))),
           "overset_lines": sum(r.get("overset_lines", 0) for r in results), "problems": sum(r.get("problems", 0) for r in results),
           "retried_pages": sum(1 for r in results if r.get("retries"))}
    if not names and "--out" not in opt and "--lead-side" not in opt:   # aggregates only from standard full runs
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "summary.json").write_text(json.dumps(agg, indent=1) + "\n")
    print(json.dumps(agg))


if __name__ == "__main__":
    main()
