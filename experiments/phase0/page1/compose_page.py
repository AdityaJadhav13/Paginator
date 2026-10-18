"""EXP-PAGE-1: rebuild a printed page of the pilot newspaper with Pageinator's typesetting (EXPERIMENTAL; PRIVATE OUTPUT).

Input: a page model from page_model.py (the printed page's stories, columns, exact text, rules, boxes, images).
Pageinator re-sets every text element in OFL stand-in fonts and writes one PDF/X-1a:2003 page:
  body       each story's flow (paragraphs, crossheads) through the story's printed columns, justified with the
             EXP-COMPOSE-3 policy (no word breaks; a line may break after a hyphen inside a compound) on the printed
             leading, with TEXT WRAP around images, graphics and ads (a line beside an obstacle is set narrower; a line
             blocked by it moves below it on the leading grid; a paragraph whose available width changes is re-set from
             that character on, as a typesetter re-flows text). Noto Serif Devanagari (wdth 87.5), sized
               --size story (default): per story, so the story's words take their printed width (same-words calibration)
               --size paper: one paper-level ratio (stand-in size ÷ house size × horizontal scale) learned on the
                             CALIBRATION editions only — a held-out prediction of story depth
             Columns never run below their printed bottom; what does not fit is counted as overset, never dropped.
  headlines  head1 composer (EXP_HEAD_1_REPORT.md) with the printed number of lines (the page plan fixes it), shape
             "fill" (the pre-registered selection) and the house pairs counted on the calibration editions; Noto Sans
             Devanagari wght 800/700, width axis (2.5 steps) then size so the words take the printed width; decks alike
  crossheads first-fit (house practice), centred (house practice) in the column they flow into; never truncated
  other text kickers, bylines, captions, folios, furniture: each printed line at its position, sized by its printed glyph
             widths; Wingdings bullets (decoded as l/u/v/n/q) become "•" (textfix.py); run-in leads are part of the
             body line text and are not set a second time
  graphics   box fills, then image/graphic/ad placeholders, then rules and box strokes, then text; colours as DeviceCMYK
             (grey and RGB converted; other colour spaces counted and drawn black — both reported)
Per story the manifest records printed vs our lines, overset lines/characters and paragraphs whose breaks equal print;
per line its role, story/element, extent and baseline (for compare_page.py's geometry and accounting checks).
PDF bytes are reproducible (SOURCE_DATE_EPOCH fixed unless set). Output: <dataset>/report/page1/rebuilt[_paper]/.
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/page1/compose_page.py
                     <dataset_dir> [<sample>__p<page> | model.json ...] [--out DIR] [--size story|paper] [--photos]
--photos: draw the printed photos and ads converted by photos.py instead of grey placeholders
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import statistics as st
import sys
from dataclasses import replace
from pathlib import Path

os.environ.setdefault("SOURCE_DATE_EPOCH", "1791849600")      # 2026-10-13T00:00Z: reproducible PDF bytes
HERE = Path(__file__).resolve().parent
for _sub in ("head1", "pdfx1", "compose3", "compose2", "typeset_harness", "compose1"):
    sys.path.insert(0, str(HERE.parent / _sub))
import headliner as H  # noqa: E402  (installs the OFL font registry)
import make_press_test as MP  # noqa: E402
import pdfx as X  # noqa: E402
import run_compose3 as R3  # noqa: E402
import run_head1 as RH  # noqa: E402

sys.path.insert(0, str(HERE))
from textfix import fix_bullet, fix_bullets_all, only_bullets  # noqa: E402,F401  (the last two: EXP-GEN-1)

from fontTools.ttLib import TTFont  # noqa: E402

K3 = H.K3
MM = X.MM
NBSP = "\u00a0"
PAGE_MAKER = "page1-compose/2.6.1"
BLACK, WHITE = (0, 0, 0, 1), (0, 0, 0, 0)
SERIF, SANS = "Noto Serif Devanagari", "Noto Sans Devanagari"
BODY_AXES = {"wdth": 87.5}
PLACEHOLDER = {"image": ("छायाचित्र", "PHOTO"), "graphic": ("चित्र", "GRAPHIC"), "ad": ("जाहिरात", "AD")}
OBSTACLE_KINDS = ("image", "graphic", "ad")
TEXT_KINDS = ("headline", "deck", "kicker", "byline", "crosshead", "caption", "jump_line", "folio", "furniture", "other_text")
WRAP_GAP_MM = 1.5            # horizontal clearance beside an obstacle
WRAP_GAP_V_MM = 1.0          # vertical clearance below/above an obstacle
MIN_LINE_MM = 15.0           # narrower than this beside an obstacle: the line moves below it instead
ASC, DESC = 0.80, 0.30       # line box above/below the baseline, in ems (Devanagari marks included)
INK_CLEAR_MM = 0.25          # display lines: required clearance between one line's lowest and the next line's highest ink
MIN_LEAD_EM = 1.20           # the stand-in's vowel signs reach further than the house face's: below 1.20 em of leading
                             # a falling sign (ु ू) touches a rising one (ि ी) on the next line, so the stand-in is capped
CODE_HASH = hashlib.sha256(b"".join((HERE / f).read_bytes() for f in ("compose_page.py", "textfix.py"))).hexdigest()[:12]


def is_deva(s: str) -> bool:
    return any("\u0900" <= ch <= "\u097f" for ch in s)


def to_cmyk(colour):
    """Model colour → (DeviceCMYK tuple or None, how): cmyk | gray→cmyk | rgb→cmyk | unsupported."""
    if not colour:
        return None, None
    if isinstance(colour, (list, tuple)):
        return tuple(float(v) for v in colour), "cmyk"
    space, v = colour.get("space"), [float(x) for x in colour.get("values") or []]
    if space == "cmyk" and len(v) == 4:
        return tuple(v), "cmyk"
    if space == "gray" and len(v) == 1:
        return (0.0, 0.0, 0.0, round(1.0 - v[0], 4)), "gray"
    if space == "rgb" and len(v) == 3:
        k = 1.0 - max(v)
        if k >= 0.999:
            return BLACK, "rgb"
        return tuple(round(x, 4) for x in ((1 - v[0] - k) / (1 - k), (1 - v[1] - k) / (1 - k), (1 - v[2] - k) / (1 - k), k)), "rgb"
    return None, "unsupported"


class Builder(MP.PageBuilder):
    """The press-test page builder on a real page: fonts per (family, axes, weight), positions on the model's page."""

    def __init__(self, page_h_mm: float):
        super().__init__(actualtext=True)
        self.page_h = page_h_mm
        self.problems: list = []

    def font(self, family: str, axes: dict, weight: int) -> str:
        key = ("S" if family == SERIF else "N") + str(int(weight)) + "".join(f"_{k}{v:g}" for k, v in sorted(axes.items()) if k != "wght")
        if key not in MP.FONTS:
            MP.FONTS[key] = (family, dict(axes), int(weight), f"{family.replace(' ', '')}-{key}")
        return key

    def register(self, fkey: str, p) -> None:
        """Embed the font instance of an externally prepared text (head1 composer) and refuse missing glyphs."""
        h = hashlib.sha256(p.face_bytes).hexdigest()
        if fkey not in self.fonts:
            self.fonts[fkey] = X.EmbeddedFont(fkey, p.face_bytes, MP.FONTS[fkey][3])
            self.face_hash[fkey] = h
        elif self.face_hash[fkey] != h:
            raise RuntimeError(f"{fkey}: font bytes changed between shapings")
        if any(g == 0 for r in p.runs for g in r.glyph_ids):
            raise RuntimeError(f"missing glyph (.notdef) in {fkey}")

    def _emit(self, fkey, size, cmyk, clusters, overprint, meta, hscale=1.0):
        runs = [(t, [X.Glyph(g, round(x * MM, 3), round((self.page_h - y) * MM, 3)) for g, x, y in gl]) for t, gl in clusters]
        self.items.append(X.TextRun(fkey, size, cmyk, runs, overprint, hscale))
        self.lines.append({**meta, "font": fkey, "size_pt": round(size, 4), "text": "".join(t for t, _ in clusters)})

    def body_line(self, p, c, ln, x0, y, fkey, meta):
        x_end = self.composed_line(p, c, ln, x0, y, fkey, meta=meta)
        self.lines[-1]["x1_mm"] = round(x_end, 3)

    def tokens_line(self, p, i, j, x0, y, fkey, cmyk=BLACK, meta=None, gap_extra=0.0, hscale=1.0):
        """Glued tokens i..j-1 of a prepared text at natural spacing (head1 layouts); gap_extra mm is added to every
        word space and hscale stretches the glyphs horizontally (a line justified to its measure)."""
        widths, spaces, _ = H._words(p)
        out, x = [], x0
        for k in range(i, j):
            for ci in p.words[k]:
                cl = p.clusters[ci]
                gl = []
                for ri, gi in cl.glyphs:
                    r = p.runs[ri]
                    gl.append((r.glyph_ids[gi], x + r.x_offsets_mm[gi] * hscale, y + r.y_offsets_mm[gi]))
                    x += r.x_advances_mm[gi] * hscale
                out.append((p.text[cl.start:cl.end].replace(NBSP, " "), gl))
            if k < j - 1:
                sc = self._space_cluster_after(p, k)
                if sc is not None:
                    r = p.runs[sc.glyphs[0][0]]
                    out.append((" ", [(r.glyph_ids[sc.glyphs[0][1]], x, y)]))
                x += (spaces[k] or 0.0) * hscale + gap_extra
        self._emit(fkey, p.size_pt, cmyk, out, tuple(cmyk) == BLACK,
                   {"kind": "justified" if (gap_extra or hscale != 1.0) else "natural", "x0_mm": round(x0, 3), "x1_mm": round(x, 3), "baseline_mm": round(y, 3), **(meta or {})},
                   hscale)
        return x - x0

    def text_line(self, text, fkey, size, x, y, cmyk=BLACK, align="left", meta=None):
        p = self.prepare(text, fkey, size)
        width = sum(a for r in p.runs for a in r.x_advances_mm)
        x0 = x - width if align == "right" else x - width / 2 if align == "center" else x
        out, cx = [], x0
        for cl in p.clusters:
            gl = []
            for ri, gi in cl.glyphs:
                r = p.runs[ri]
                gl.append((r.glyph_ids[gi], cx + r.x_offsets_mm[gi], y + r.y_offsets_mm[gi]))
                cx += r.x_advances_mm[gi]
            out.append((" " if cl.is_space else p.text[cl.start:cl.end], gl))
        self._emit(fkey, size, cmyk, out, tuple(cmyk) == BLACK,
                   {"kind": "natural", "x0_mm": round(x0, 3), "x1_mm": round(x0 + width, 3), "baseline_mm": round(y, 3), **(meta or {})})
        return width

    def rect_mm(self, x0, top, x1, bottom, cmyk):
        self.items.append(X.Rect(x0 * MM, (self.page_h - bottom) * MM, (x1 - x0) * MM, (bottom - top) * MM, cmyk, False))

    def line_mm(self, p0, p1, width_pt, cmyk):
        op = tuple(cmyk) == BLACK
        self.items.append(X.Line(p0[0] * MM, (self.page_h - p0[1]) * MM, p1[0] * MM, (self.page_h - p1[1]) * MM, width_pt, cmyk, op))


# ------------------------------------------------------------------------------------------- inputs
def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12] if path.exists() else "-"


class Context:
    """Everything shared by the pages of one dataset: measured frames, display records, policies, learned defaults."""

    def __init__(self, ds: Path, size_mode: str = "story"):
        self.ds, self.size_mode = ds, size_mode
        hl = ds / "report" / "headlines.jsonl"
        self.display = {h["id"]: h for h in (json.loads(l) for l in open(hl, encoding="utf-8"))}
        pols = RH.policies(RH.eligible(list(self.display.values())))
        self.head_pol = pols["FILL_C7"]                         # pre-registered selection + calibration house pairs
        self.c7_hash = RH.c7_hash(pols["FILL_C7"])
        summ = R3.OUT / "summary.json"
        chosen = json.loads(summ.read_text())["selection"]["chosen"] if summ.exists() else None
        self.body_choice = chosen or "C3_floor0.66_stretch1.00"
        self._docs: dict = {}
        # learned design language (house_profile.py): fallbacks where a page does not show the spacing itself
        prof = HERE.parent / "results" / "page1" / "house_profile.json"
        pj = json.loads(prof.read_text()) if prof.exists() else {}
        sp = pj.get("composer_defaults", {}).get("spacing", {})
        self.xh_above = (sp.get("crosshead_space_above") or {}).get("body_leadings", 1.0)
        self.xh_below = (sp.get("crosshead_space_below") or {}).get("body_leadings", 1.0)
        self.indent_mm = pj.get("composer_defaults", {}).get("roles", {}).get("body", {}).get("first_line_indent_mm", 5.0)
        self.inputs = {"headlines.jsonl": _sha(hl), "house_profile.json": _sha(prof), "code": CODE_HASH}
        self.r_cal = None
        if size_mode == "paper":
            self.r_cal = self._paper_ratio()

    def frames(self, sample: str, page: int) -> dict:
        if sample not in self._docs:
            w = self.ds / "work" / sample
            f = w / "corrected.json"
            f = f if f.exists() else w / "measure.json"
            self._docs[sample] = (json.loads(f.read_text()), _sha(f))
        pg = next(p for p in self._docs[sample][0]["pages"] if p["page"] == page)
        return {fr["id"]: fr for fr in pg["frames"]}

    def _paper_ratio(self) -> float:
        """Median over CALIBRATION-edition stories of (story-calibrated stand-in size) ÷ (house size × horizontal scale)."""
        ratios = []
        for f in sorted((self.ds / "report" / "page1" / "pages").glob("*.json")):
            m = json.loads(f.read_text(encoding="utf-8"))
            if m["split"] != "cal":
                continue
            ww = make_words_width(m, self.frames(m["sample"], m["page"]))
            by_frame = {e["frame_id"]: e for e in m["elements"] if e["kind"] == "body_frame"}
            for s in m["stories"]:
                paras = [b for b in s["flow"] if b["type"] == "para" and b["text"].strip()]
                if not paras or not s.get("body_size_pt") or not is_deva(paras[0]["text"]):
                    continue
                w = pp = 0.0
                for b in paras:
                    try:
                        q = per_pt(b["text"], SERIF, BODY_AXES, 400)
                    except Exception:  # noqa: BLE001
                        continue
                    for ln in b["lines"]:
                        fid, k = ln["line_ref"].rsplit(":", 1)
                        e = by_frame.get(fid)
                        if e:
                            w += ww(e["lines"][int(k)])
                    pp += q
                if w > 0 and pp > 0:
                    ratios.append((w / pp) / (s["body_size_pt"] * (s.get("body_hscale") or 1.0)))
        return round(st.median(ratios), 5)


_GLYF: dict = {}


def line_ink(p, i, j) -> tuple[float, float]:
    """Highest ink above and lowest ink below the baseline (mm) of glued tokens i..j-1 (glyph bounds + mark offsets)."""
    h = hashlib.sha256(p.face_bytes).hexdigest()
    if h not in _GLYF:
        f = TTFont(io.BytesIO(p.face_bytes))
        _GLYF[h] = (f["glyf"], f.getGlyphOrder(), f["head"].unitsPerEm)
    glyf, order, upem = _GLYF[h]
    s = p.em_mm / upem
    asc = desc = 0.0
    for k in range(i, j):
        for ci in p.words[k]:
            for ri, gi in p.clusters[ci].glyphs:
                r = p.runs[ri]
                g = glyf[order[r.glyph_ids[gi]]]
                if hasattr(g, "yMax"):
                    asc = max(asc, s * g.yMax - r.y_offsets_mm[gi])
                    desc = max(desc, r.y_offsets_mm[gi] - s * g.yMin)
    return asc, desc


def make_words_width(model: dict, frames: dict):
    """Printed word width (pt) of a model line: measured glyph tokens on its baseline inside its extent."""
    toks = [(ln["baseline_pt"], t["x0"], t["x1"], fr["size_pt"]) for fr in frames.values() for ln in fr["lines"] for t in ln["tokens"]]

    def words_width(line) -> float:
        b = (model["page_h_mm"] - line["baseline_mm"]) * MM
        x0, x1 = line["x0_mm"] * MM - 1.5, line["x1_mm"] * MM + 1.5
        return sum(t1 - t0 for bl, t0, t1, sz in toks if abs(bl - b) < 0.15 * sz and x0 <= (t0 + t1) / 2 <= x1)
    return words_width


def per_pt(text: str, family: str, axes: dict, weight: int, spaces: bool = False) -> float:
    """Width in pt of the text at 1 pt (non-space clusters only, unless spaces)."""
    deva = is_deva(text)
    p = K3.prepare(text, "mr" if deva else "en", "Deva" if deva else "Latn", family, 10.0, axes, weight)
    return sum(c.width for c in p.clusters if spaces or not c.is_space) * MM / 10.0


def role_font(font_name: str, role: str) -> tuple[str, dict, int]:
    """Stand-in for a house face: serif for the body face family, sans for display faces; weight from the name."""
    heavy = any(w in font_name for w in ("ExtraBold", "Black", "Laxman"))
    bold = heavy or "Bold" in font_name or role in ("headline", "deck", "kicker", "crosshead")
    weight = 800 if heavy else 700 if bold else 400
    if "Body" in font_name and role not in ("headline", "deck", "kicker"):
        return SERIF, {**BODY_AXES, "wght": float(weight)}, weight
    return SANS, {"wght": float(weight)}, weight


def _colour(el: dict, rep: dict) -> tuple:
    c = el.get("colour_cmyk")
    if c:
        return tuple(c)
    c, how = to_cmyk(el.get("colour"))
    if how and how != "cmyk":
        rep["colour"][how] = rep["colour"].get(how, 0) + 1
    return c or BLACK


# ------------------------------------------------------------------------------------------- text elements
def set_display(B: Builder, cx: Context, el: dict, policy, kind_meta: dict, rep: dict, default_align: str = "left") -> dict:
    """Headline / deck / crosshead with the head1 composer. Every composed line is set (never truncated): lines beyond
    the printed count go one leading lower. Returns metrics, the number of lines used and the last baseline."""
    rec = cx.display.get(el.get("source"))
    lines = el["lines"]
    family, axes0, wt = role_font(el.get("font") or "", el["kind"])
    text = fix_bullet(" ".join(el["text"].split()))
    target = sum(l.get("words_width_pt") or 0 for l in rec["lines"]) if rec else 0.0
    if target <= 0:                                            # no measured word widths: use the printed line extents
        target = sum((l["x1_mm"] - l["x0_mm"]) * MM for l in lines) * 0.85
    axes = dict(axes0)
    if family == SANS and el["kind"] in ("headline", "deck"):  # condensed house display type: width axis first
        size_pt = el["size_pt"]
        lo, hi = 62.5, 100.0
        w = lambda d: per_pt(text, family, {**axes0, "wdth": d}, wt) * size_pt  # noqa: E731
        wd = hi if w(hi) <= target else lo if w(lo) >= target else None
        if wd is None:
            for _ in range(12):
                mid = (lo + hi) / 2
                lo, hi = (mid, hi) if w(mid) < target else (lo, mid)
            wd = (lo + hi) / 2
        axes["wdth"] = max(62.5, min(100.0, round(wd / 2.5) * 2.5))
    size = target / per_pt(text, family, axes, wt)
    x0s, x1s = [l["x0_mm"] for l in lines], [l["x1_mm"] for l in lines]
    span = (rec["span_x0_mm"], rec["span_x0_mm"] + rec["span_width_mm"]) if rec and rec.get("span_width_mm") else (min(x0s), max(x1s))
    measure = max(span[1] - span[0], max(x1 - x0 for x0, x1 in zip(x0s, x1s)))
    if el.get("gen_measure_mm"):                     # a generated layout (EXP-GEN-1): printed size, the new column's measure
        size, measure = el["size_pt"], el["gen_measure_mm"]
    n_lines = len(lines) if policy.balance else None
    r = H.compose(text, family, axes, wt, round(size, 3), measure, policy, n_lines=n_lines)
    if not r.fits:
        r = H.compose(text, family, axes, wt, round(size, 3), measure + 1.0, policy, n_lines=n_lines)
    if not r.fits:
        raise ValueError("no layout with the printed number of lines")
    # ink clearance: the stand-in's vowel signs reach further than the house face's. Where two composed lines would
    # touch at their (printed) baselines, the size shrinks just enough to clear and the width axis widens to keep the
    # printed width (heights scale with size only)
    lead = (el.get("leading_pt") or r.size_pt * 1.083) / MM
    shrunk = 1.0
    for _ in range(4):
        if len(r.lines) < 2:
            break
        ys = []
        for n in range(len(r.lines)):
            ys.append(lines[n]["baseline_mm"] if n < len(lines) else ys[-1] + lead)
        ink = [line_ink(r.p, i, j) for i, j in r.lines]
        f = min(((ys[n + 1] - ys[n] - INK_CLEAR_MM) / (ink[n][1] + ink[n + 1][0]) for n in range(len(r.lines) - 1)
                 if ink[n][1] + ink[n + 1][0] > 0), default=1.0)
        if f >= 0.995:
            break
        new = r.size_pt * max(0.6, f)
        if "wdth" in axes:
            wd = axes["wdth"]
            while wd < 100.0 and per_pt(text, family, {**axes, "wdth": wd}, wt) * new < target:
                wd = min(100.0, wd + 2.5)
            axes["wdth"] = wd
            new = min(new, target / per_pt(text, family, axes, wt))
        shrunk *= new / r.size_pt
        r2 = H.compose(text, family, axes, wt, round(new, 3), measure, policy, n_lines=n_lines)
        if not r2.fits:
            r2 = H.compose(text, family, axes, wt, round(new, 3), measure + 1.0, policy, n_lines=n_lines)
        if not r2.fits:
            break
        r = r2
    fkey = B.font(family, axes, wt)
    B.register(fkey, r.p)
    align = el.get("alignment") if el.get("alignment") in ("left", "center", "right") else default_align
    cmyk = _colour(el, rep)
    centre = st.median((a + b) / 2 for a, b in zip(x0s, x1s))
    y = lines[0]["baseline_mm"]
    for n, ((i, j), wmm) in enumerate(zip(r.lines, r.widths_mm)):
        y = lines[n]["baseline_mm"] if n < len(lines) else y + lead
        x = min(x0s) if align == "left" else max(x1s) - wmm if align == "right" else centre - wmm / 2
        B.tokens_line(r.p, i, j, x, y, fkey, cmyk, meta={**kind_meta, "role": el["kind"], "element": el["id"]})
    cuts = RH.to_unglued(r.text_glued, r.lines)
    pr, acc = [], 0
    for ln in lines:
        acc += len(ln["text"].split()); pr.append(acc)
    return {"element": el["id"], "kind": el["kind"], "lines": len(lines), "lines_used": len(r.lines), "last_baseline_mm": y,
            "same_breaks": list(cuts) == pr, "relaxed": r.relaxed, "size_pt": round(r.size_pt, 3), "wdth": axes.get("wdth"),
            "ink_shrink": round(shrunk, 4)}


def set_lines(B: Builder, el: dict, meta: dict, rep: dict, words_width=None) -> None:
    """Short text (kicker, byline, caption, folio, furniture …): each printed line at its position. Size: the printed
    glyph widths (measured tokens) when available — robust to tabs inside a line's extent — else the line's extent."""
    family, axes, wt = role_font(el.get("font") or "", el["kind"])
    cmyk = _colour(el, rep)
    align = el.get("alignment") if el.get("alignment") in ("left", "center", "right") else "left"
    todo = []
    for ln in el["lines"]:
        text = fix_bullet(" ".join(ln["text"].split()))
        if not text:
            continue
        w_tok = words_width(ln) if words_width else 0.0
        if w_tok > 0:
            size = w_tok / per_pt(text, family, axes, wt)
        else:
            w1 = per_pt(text, family, axes, wt, spaces=True) / MM          # mm per pt of size
            size = (ln["x1_mm"] - ln["x0_mm"]) / w1 if w1 > 0 else el["size_pt"]
        todo.append([ln, text, max(0.6 * el["size_pt"], min(1.3 * el["size_pt"], size))])
    # ink clearance between consecutive lines of the block (the stand-in's vowel signs reach further than the house
    # face's): one factor for the block; a width-axis face widens to keep each line's printed width
    if len(todo) > 1:
        fkey0 = B.font(family, axes, wt)
        inks = []
        for ln, text, size in todo:
            p0 = B.prepare(text, fkey0, round(size, 3))
            inks.append(line_ink(p0, 0, len(p0.words)))
        f = min(((b[0]["baseline_mm"] - a[0]["baseline_mm"] - INK_CLEAR_MM) / (ia[1] + ib[0])
                 for a, b, ia, ib in zip(todo, todo[1:], inks, inks[1:]) if 0 < b[0]["baseline_mm"] - a[0]["baseline_mm"] < 3 * a[2] / MM
                 and ia[1] + ib[0] > 0), default=1.0)
        if f < 0.995:
            f = max(0.6, f)
            if "wdth" in axes:
                axes = {**axes, "wdth": min(100.0, round(axes["wdth"] / f / 2.5) * 2.5)}
                for t in todo:                                   # size back to the printed width, never above the clear size
                    t[2] = min(t[2] * f, t[2] * per_pt(t[1], family, {**axes, "wdth": BODY_AXES["wdth"]}, wt) / per_pt(t[1], family, axes, wt))
            else:
                for t in todo:
                    t[2] *= f
    fkey = B.font(family, axes, wt)
    for ln, text, size in todo:
        x = ln["x0_mm"] if align == "left" else ln["x1_mm"] if align == "right" else (ln["x0_mm"] + ln["x1_mm"]) / 2
        B.text_line(text, fkey, round(size, 3), x, ln["baseline_mm"], cmyk, align, meta={**meta, "role": el["kind"], "element": el["id"]})


# ------------------------------------------------------------------------------------------- body stories
def story_from_frame(el: dict) -> dict:
    """A body frame that the page model left outside every story becomes a one-column story of its own."""
    em = el["size_pt"] / MM
    flow, cur = [], None
    for n, ln in enumerate(el["lines"]):
        if ln.get("excluded") or ln.get("use", "body") != "body":
            continue
        starts = ln.get("left_offset_mm", 0.0) >= 0.5 * em
        if cur is None or starts:
            cur = {"type": "para", "text": "", "indent_mm": ln.get("left_offset_mm", 0.0) if starts else 0.0, "lines": []}
            flow.append(cur)
        cur["lines"].append({"col": 0, "line_ref": f"{el['frame_id']}:{n}", "text": ln["text"], "n_words": ln.get("n_words")})
        cur["text"] = (cur["text"] + " " + ln["text"]).strip()
    bls = [l["baseline_mm"] for l in el["lines"] if not l.get("excluded") and l.get("use", "body") == "body"]
    return {"id": f"frame-{el['id']}", "headline": None, "columns": [{"frame_ids": [el["frame_id"]], "x0_mm": el["x0_mm"], "x1_mm": el["x1_mm"],
            "top_mm": el["bbox_mm"][1], "bottom_mm": el["bbox_mm"][3], "first_baseline_mm": min(bls) if bls else el["bbox_mm"][1], "n_lines": len(bls)}],
            "flow": flow, "body_font": el["font"], "body_size_pt": el["size_pt"], "body_leading_pt": el["leading_pt"] or el["size_pt"] * 1.15,
            "body_hscale": el.get("hscale") or 1.0, "space_em": el.get("space_em"), "complete": False, "from_frame": True}


def _col_of(cols, x_mid, y):
    """Column whose box contains the point (x AND y), else None."""
    return next((i for i, c in enumerate(cols) if c["x0_mm"] - 1 <= x_mid <= c["x1_mm"] + 1
                 and c["top_mm"] - 1 <= y <= c["bottom_mm"] + 1), None)


COPYFIT_STEPS = (0.99, 0.98, 0.97, 0.96)   # house per-story horizontal scale reaches 0.96 (house_profile: body hscale 0.96–1.06)


def set_story(B: Builder, cx: Context, story: dict, words_width, els: dict, obstacles: list, meta: dict, rep: dict,
              fit: float = 1.0) -> dict:
    flow = story["flow"]
    paras = [b for b in flow if b["type"] == "para" and b["text"].strip()]
    cols = story["columns"]
    out = {"story": story["id"], "printed_lines": sum(len(b["lines"]) for b in paras), "our_lines": 0, "overset_lines": 0, "overset_words": 0,
           "overset_chars": 0, "paragraphs": len(paras), "paragraphs_same_breaks": 0, "words": sum(len(b["text"].split()) for b in paras),
           "columns": [[round(c["x0_mm"], 2), round(c["top_mm"], 2), round(c["x1_mm"], 2), round(c["bottom_mm"], 2)] for c in cols]}
    if not paras:
        return out
    by_frame = {e["frame_id"]: e for e in els.values() if e["kind"] == "body_frame"}

    def printed_line(ref):
        fid, k = ref.rsplit(":", 1)
        e = by_frame.get(fid)
        return e["lines"][int(k)] if e and int(k) < len(e["lines"]) else None
    base_of, ww_of = {}, {}
    for b in paras:
        for ln in b["lines"]:
            pl = printed_line(ln["line_ref"])
            base_of[ln["line_ref"]] = pl["baseline_mm"] if pl else None
            ww_of[ln["line_ref"]] = words_width(pl) if pl else 0.0
    family, wt = SERIF, 400
    fkey = B.font(family, BODY_AXES, wt)
    house_size = story.get("body_size_pt") or st.median(e["size_pt"] for e in by_frame.values() if e.get("size_pt"))
    hscale = story.get("body_hscale") or 1.0
    if cx.size_mode == "paper":
        size = round(house_size * hscale * cx.r_cal, 3)
    else:   # calibration over the paragraphs the stand-in can shape (a missing character must not void the whole story)
        w_ok = pp_ok = 0.0
        for b in paras:
            try:
                pp = per_pt(b["text"], family, BODY_AXES, wt)
            except Exception:  # noqa: BLE001
                continue
            w_ok += sum(ww_of.get(ln["line_ref"], 0.0) for ln in b["lines"]); pp_ok += pp
        size = round(w_ok / pp_ok, 3) if w_ok > 0 and pp_ok > 0 else round(house_size * hscale * 0.904, 3)
    lead_pt_story = story.get("body_leading_pt") or None
    lead_mm_cols = [c["leading_mm"] for c in cols if c.get("leading_mm")]
    lead_pt_eff = lead_pt_story or (st.median(lead_mm_cols) * MM if lead_mm_cols else house_size * 1.083)
    axes = dict(BODY_AXES)
    if size * MIN_LEAD_EM > lead_pt_eff:            # vertical: size the leading allows; horizontal: wider letterforms (wdth)
        out["size_capped_from"] = size
        cap = lead_pt_eff / MIN_LEAD_EM
        text_ok = " ".join(b["text"] for b in paras if b["text"].strip())
        try:
            target = size * per_pt(text_ok, family, axes, wt)                      # printed words width (pt)
            wd = axes["wdth"]
            while wd < 100.0 and per_pt(text_ok, family, {**axes, "wdth": wd}, wt) * cap < target:
                wd = min(100.0, wd + 2.5)
            axes["wdth"] = wd
            size = round(min(cap, target / per_pt(text_ok, family, axes, wt)), 3)
        except Exception:  # noqa: BLE001
            size = round(cap, 3)
        out["wdth"] = axes["wdth"]
        fkey = B.font(family, axes, wt)
    if fit != 1.0:
        size = round(size * fit, 3)
        out["copyfit"] = fit
    out["size_pt"] = size
    probe = B.prepare("क ख", fkey, size)
    our_space = st.median(s for s in probe.spaces if s)
    space_em = story.get("space_em") or next((e["space_em"] for fid in cols[0].get("frame_ids", [])
                                              if (e := by_frame.get(fid)) and e.get("space_em")), 0.25)
    k = (space_em * house_size * hscale / MM) / our_space          # house word space (nominal × horizontal scale)
    kind, prm = R3.candidates()[cx.body_choice]
    pol = R3.policy_for(cx.body_choice, kind, prm, k)
    # obstacles the PRINTED lines of this story overlap are backgrounds (e.g. a shape behind a box), not wrap objects
    em_h = house_size / MM
    plines = [pl for b in paras for ln in b["lines"] if (pl := printed_line(ln["line_ref"]))]
    obstacles = [o for o in obstacles if not any(min(o[2], pl["x1_mm"]) - max(o[0], pl["x0_mm"]) > 1.0
                                                 and min(o[3], pl["baseline_mm"] + DESC * em_h) - max(o[1], pl["baseline_mm"] - ASC * em_h) > 1.0
                                                 for pl in plines)]
    out["obstacles"] = len(obstacles)
    lead_mm = [c["leading_mm"] for c in cols if c.get("leading_mm")]
    lead = story["body_leading_pt"] / MM if story.get("body_leading_pt") else st.median(lead_mm) if lead_mm else house_size * 1.083 / MM
    em = size / MM
    # usable baselines per column: up to the last printed baseline in that column (body lines, and crossheads assigned
    # by x AND y), never below the column's printed bottom
    last_bl = {}
    for b in flow:
        if b["type"] == "para":
            for ln in b["lines"]:
                if base_of.get(ln["line_ref"]) is not None:
                    last_bl[ln["col"]] = max(last_bl.get(ln["col"], -1e9), base_of[ln["line_ref"]])
        elif b["type"] == "crosshead" and b.get("element") in els:
            for ln in els[b["element"]]["lines"]:
                c = _col_of(cols, (ln["x0_mm"] + ln["x1_mm"]) / 2, ln["baseline_mm"])
                if c is not None:
                    last_bl[c] = max(last_bl.get(c, -1e9), ln["baseline_mm"])

    def limit(c):
        col = cols[c]
        lb = last_bl.get(c, col["first_baseline_mm"] + (col["n_lines"] - 1) * lead)
        return min(lb + 0.3 * lead, col["bottom_mm"] + 0.3 * lead)

    def avail(c, yb):
        """(x0, x1) available at baseline yb in column c with text wrap, or ("blocked", y_below) if an obstacle blocks it."""
        col = cols[c]
        x0, x1 = col["x0_mm"], col["x1_mm"]
        top, bot = yb - ASC * em, yb + DESC * em
        below = None
        for ox0, ot, ox1, ob in obstacles:
            if ob <= top or ot >= bot or ox1 <= x0 or ox0 >= x1:
                continue
            if ox0 - WRAP_GAP_MM - x0 >= max(MIN_LINE_MM, 0.4 * (col["x1_mm"] - col["x0_mm"])) and ox0 > (x0 + x1) / 2 - 1:
                x1 = min(x1, ox0 - WRAP_GAP_MM)                       # obstacle on the right: narrower line
            elif x1 - (ox1 + WRAP_GAP_MM) >= max(MIN_LINE_MM, 0.4 * (col["x1_mm"] - col["x0_mm"])) and ox1 < (x0 + x1) / 2 + 1:
                x0 = max(x0, ox1 + WRAP_GAP_MM)                       # obstacle on the left
            else:
                below = max(below or -1e9, ob)
        if below is not None:
            return "blocked", below
        if x1 - x0 < MIN_LINE_MM:
            obs = [ob for ox0, ot, ox1, ob in obstacles if not (ob <= top or ot >= bot or ox1 <= col["x0_mm"] or ox0 >= col["x1_mm"])]
            return ("blocked", max(obs)) if obs else (x0, x1)       # a column narrower than MIN_LINE_MM by itself
        return x0, x1

    state = {"ci": 0, "y": cols[0]["first_baseline_mm"], "placed": 0}

    def next_col():
        state["ci"] += 1; state["placed"] = 0
        if state["ci"] < len(cols):
            state["y"] = cols[state["ci"]]["first_baseline_mm"]

    def position():
        """Next usable (x0, x1) for a body line at state y (moves y past obstacles and to later columns); None = overset."""
        while state["ci"] < len(cols):
            if state["y"] > limit(state["ci"]):
                next_col(); continue
            a = avail(state["ci"], state["y"])
            if a[0] == "blocked":
                need = a[1] + WRAP_GAP_V_MM + ASC * em                # first baseline on the leading grid below the obstacle
                steps = max(1, int((need - state["y"]) / lead + 0.999))
                state["y"] += steps * lead
                continue
            return a
        return None

    prev_printed_base = None
    for bi, b in enumerate(flow):
        if b["type"] == "crosshead":
            el = els.get(b["element"])
            if el is None:
                continue
            words = len(el["text"].split())
            if state["ci"] >= len(cols) or position() is None:
                out["overset_crosshead_words"] = out.get("overset_crosshead_words", 0) + words
                continue
            ci = state["ci"]
            cbl = [l["baseline_mm"] for l in el["lines"]]
            gap_before = (cbl[0] - prev_printed_base) if prev_printed_base is not None and 0 < cbl[0] - prev_printed_base < 6 * lead else cx.xh_above * lead
            first = (state["y"] - lead + gap_before) if state["placed"] else state["y"] + max(0.0, gap_before - lead)
            if first + (cbl[-1] - cbl[0]) + el.get("gen_keep_lines", 0) * lead > limit(ci):   # (generated layouts: keep with next)
                next_col()
                if state["ci"] >= len(cols):
                    out["overset_crosshead_words"] = out.get("overset_crosshead_words", 0) + words
                    continue
                ci, first = state["ci"], state["y"]
            pc = _col_of(cols, (el["lines"][0]["x0_mm"] + el["lines"][0]["x1_mm"]) / 2, cbl[0])
            dx = 0.0 if pc is None or pc == ci else cols[ci]["x0_mm"] - cols[pc]["x0_mm"]
            shifted = {**el, "lines": [{**l, "baseline_mm": first + (l["baseline_mm"] - cbl[0]), "x0_mm": l["x0_mm"] + dx,
                                        "x1_mm": l["x1_mm"] + dx} for l in el["lines"]]}
            last = shifted["lines"][-1]["baseline_mm"]
            try:
                d = set_display(B, cx, shifted, replace(cx.head_pol, balance=False), {**meta, "story": story["id"]}, rep, default_align="center")
                last = d["last_baseline_mm"]
            except Exception as e:  # noqa: BLE001
                B.problems.append({"element": el["id"], "problem": f"crosshead: {type(e).__name__}: {e}"})
                set_lines(B, shifted, {**meta, "story": story["id"]}, rep)
            nxt = next((bb for bb in flow[bi + 1:] if bb["type"] == "para" and bb["lines"]), None)
            nb = base_of.get(nxt["lines"][0]["line_ref"]) if nxt else None
            gap_after = (nb - cbl[-1]) if nb is not None and 0 < nb - cbl[-1] < 6 * lead else cx.xh_below * lead
            state["y"] = last + gap_after
            state["placed"] += 1
            continue
        if not b["text"].strip():
            continue
        indent = b.get("indent_mm") or 0.0
        if indent > 2.0 * house_size / MM:                       # an offset beside an obstacle, not a paragraph indent
            indent = cx.indent_mm
        rest, first_part, per_line_all, unset = fix_bullet(b["text"]), True, [], False
        while rest:                                        # one pass per line width the paragraph runs through
            pos = position()
            x0, x1 = pos if pos else (cols[-1]["x0_mm"], cols[-1]["x1_mm"])
            width = x1 - x0
            seg = (NBSP * max(1, round(indent / C_shape_nbsp(family, size, axes))) + rest) if first_part and indent > 0 else rest
            try:
                p = B.prepare(seg, fkey, size)
            except Exception as ex:  # noqa: BLE001  — a character the stand-in font lacks: report, never guess
                B.problems.append({"story": story["id"], "problem": f"paragraph not set: {type(ex).__name__}: {ex}"})
                out["unset_paragraphs"] = out.get("unset_paragraphs", 0) + 1
                out["unset_chars"] = out.get("unset_chars", 0) + _chars(rest)
                out.setdefault("unset_para_index", []).append(next(i for i, q in enumerate(paras) if q is b))
                unset = True
                break
            c = K3.compose(p, pol, width)
            if c.status != "OK":
                B.problems.append({"story": story["id"], "problem": f"paragraph overset: {c.status}"})
            per_line = _line_words(p, c)
            restart = False
            for n_ln, ln in enumerate(c.lines):
                pos = position()
                if pos is not None and abs((pos[1] - pos[0]) - width) > 0.5:
                    if n_ln > 0:                           # the available width changed: re-set the rest from this character
                        pc_ = c.pieces[ln.a]
                        rest = p.text[p.clusters[p.words[pc_.word][pc_.cl_from]].start:].lstrip(NBSP + " ")
                        first_part = False
                    restart = True
                    break
                out["our_lines"] += 1
                per_line_all.append(per_line[n_ln])
                if pos is None:
                    out["overset_lines"] += 1
                    out["overset_words"] += per_line[n_ln]
                    out["overset_chars"] += _line_chars(p, c, ln)
                    continue
                B.body_line(p, c, ln, pos[0], state["y"], fkey, {**meta, "role": "body", "story": story["id"], "column": state["ci"]})
                state["y"] += lead; state["placed"] += 1
            if not restart:
                break
        if unset:
            continue
        pr_counts = [len(l["text"].split()) for l in b["lines"]]
        out["paragraphs_same_breaks"] += int(_cuts(pr_counts) == _cuts(per_line_all))
        prev_printed_base = base_of.get(b["lines"][-1]["line_ref"])
    return out


def _chars(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace())


def _line_chars(p, c, ln) -> int:
    """Non-space characters of one composed line (exact overset accounting, including breaks inside a token)."""
    n = 0
    for k in range(ln.a, ln.b):
        pc = c.pieces[k]
        for ci in p.words[pc.word][pc.cl_from:pc.cl_to]:
            n += _chars(p.text[p.clusters[ci].start:p.clusters[ci].end])
    return n


def _cuts(counts):
    acc, out = 0, []
    for n in counts:
        acc += n; out.append(acc)
    return out


def _line_words(p, c) -> list:
    """Words (space-separated tokens) touched by each composed line."""
    return [len({c.pieces[k].word for k in range(ln.a, ln.b)}) for ln in c.lines]


_NBSP_W: dict = {}


def C_shape_nbsp(family: str, size: float, axes: dict = BODY_AXES) -> float:  # noqa: N802
    key = (family, size, tuple(sorted(axes.items())))
    if key not in _NBSP_W:
        _NBSP_W[key] = K3.C.shape_paragraph(NBSP, "mr", family, size, axes=axes).runs[0].x_advances_mm[0]
    return _NBSP_W[key]


# ------------------------------------------------------------------------------------------- page
def build(cx: Context, model: dict, photo_dir: Path | None = None) -> tuple[Builder, dict]:
    B = Builder(model["page_h_mm"])
    photos = {}
    if photo_dir and (photo_dir / "index.json").exists():
        photos = json.loads((photo_dir / "index.json").read_text())["elements"]
    els = {e["id"]: e for e in model["elements"]}
    frames = cx.frames(model["sample"], model["page"])
    words_width = make_words_width(model, frames)
    ads = [e["bbox_mm"] for e in model["elements"] if e["kind"] == "ad"]
    obstacles = [tuple(e["bbox_mm"]) for e in model["elements"] if e["kind"] in OBSTACLE_KINDS
                 and (e["bbox_mm"][2] - e["bbox_mm"][0]) > 3 and (e["bbox_mm"][3] - e["bbox_mm"][1]) > 3]
    # text blocks other stories' text wraps around in print: child stories (pull quotes, sidebars) and free text frames.
    # Per story, obstacles its own printed lines overlap are dropped as backgrounds (set_story), so a story never
    # wraps around itself.
    text_obstacles = [(s["id"], tuple(s["bbox_mm"])) for s in model["stories"] if s.get("parent_story") and s.get("bbox_mm")]
    text_obstacles += [(None, tuple(e["bbox_mm"])) for e in model["elements"] if e["kind"] in ("other_text", "caption")
                       and e["id"] in set(model.get("unassigned", []))]

    def in_ad(e):
        x0, t, x1, b = e["bbox_mm"]
        return any(a[0] - 0.5 <= x0 and x1 <= a[2] + 0.5 and a[1] - 0.5 <= t and b <= a[3] + 0.5 for a in ads)
    meta = {"page": model["page"]}
    rep = {"stories": [], "display": [], "skipped_in_ads": 0, "run_in_skipped": 0, "colour": {}, "unsupported_colour_items": 0}
    # 1. box fills, 2. placeholders, 3. rules and box strokes, 4. text
    for e in model["elements"]:
        if e["kind"] == "box" and e.get("fill"):
            c, how = to_cmyk(e["fill"])
            if how and how != "cmyk":
                rep["colour"][how] = rep["colour"].get(how, 0) + 1
            if c:
                B.rect_mm(*e["bbox_mm"], c)
    rep["photos"] = 0
    drawn = []
    for e in model["elements"]:
        if e["kind"] in PLACEHOLDER and not (e["kind"] != "ad" and in_ad(e)):
            x0, t, x1, b = e["bbox_mm"]
            if photos.get(e["id"]):
                drawn.append(e)                           # drawn after every placeholder: a placeholder never covers a photo
                continue
            B.rect_mm(x0, t, x1, b, (0, 0, 0, 0.06))
            for p0, p1 in (((x0, t), (x1, t)), ((x1, t), (x1, b)), ((x1, b), (x0, b)), ((x0, b), (x0, t))):
                B.line_mm(p0, p1, 0.3, (0, 0, 0, 0.4))
            mr, en = PLACEHOLDER[e["kind"]]
            if (x1 - x0) > 25 and (b - t) > 12 and not any(
                    te["kind"] in TEXT_KINDS and min(x1, te["bbox_mm"][2]) > max(x0, te["bbox_mm"][0])
                    and min(b, te["bbox_mm"][3]) > max(t, te["bbox_mm"][1]) for te in model["elements"]):
                fk = B.font(SANS, {"wght": 400.0}, 400)
                B.text_line(f"{mr} · {en}", fk, 8.0, (x0 + x1) / 2, (t + b) / 2, (0, 0, 0, 0.5), "center", meta={**meta, "role": "placeholder"})
    for e in drawn:                                       # the printed photo / ad, converted to newsprint CMYK (photos.py)
        x0, t, x1, b = e["bbox_mm"]
        ph = photos[e["id"]]
        raw = gzip.decompress((photo_dir / f"{e['id']}.cmyk.gz").read_bytes())
        B.items.append(X.Image(x0 * MM, (B.page_h - b) * MM, (x1 - x0) * MM, (b - t) * MM, ph["width_px"], ph["height_px"], raw))
        rep["photos"] += 1
    for e in model["elements"]:
        if e["kind"] == "rule":
            c, how = to_cmyk(e.get("colour"))
            if how and how != "cmyk":
                rep["colour"][how] = rep["colour"].get(how, 0) + 1
            B.line_mm(e["p0_mm"], e["p1_mm"], e.get("stroke_pt") or 0.5, c or BLACK)
        elif e["kind"] == "box" and e.get("stroke_pt") and e.get("stroke"):
            x0, t, x1, b = e["bbox_mm"]
            c, how = to_cmyk(e["stroke"])
            if how and how != "cmyk":
                rep["colour"][how] = rep["colour"].get(how, 0) + 1
            for p0, p1 in (((x0, t), (x1, t)), ((x1, t), (x1, b)), ((x1, b), (x0, b)), ((x0, b), (x0, t))):
                B.line_mm(p0, p1, e["stroke_pt"], c or BLACK)
    in_story = set()
    stories = list(model["stories"])
    for s in stories:
        in_story.update(x for x in [s.get("headline"), s.get("kicker"), s.get("byline"), *s.get("decks", []), *s.get("captions", [])] if x)
        in_story.update(b["element"] for b in s["flow"] if b["type"] == "crosshead")
    for eid in model.get("unassigned", []):
        e = els.get(eid)
        if e and e["kind"] == "body_frame" and not in_ad(e):
            stories.append(story_from_frame(e))
    for s in stories:
        for role in ("kicker", "headline", "byline"):
            e = els.get(s.get(role)) if s.get(role) else None
            if e and not in_ad(e) and not e.get("run_in"):
                _display_or_lines(B, cx, e, rep, meta, s["id"], words_width)
        for eid in s.get("decks", []) + s.get("captions", []):
            e = els.get(eid)
            if e and not in_ad(e) and not e.get("run_in"):
                _display_or_lines(B, cx, e, rep, meta, s["id"], words_width)
        try:
            obst = obstacles + [o for sid, o in text_obstacles if sid != s["id"]]
            mark = (len(B.items), len(B.lines), len(B.problems))
            res = set_story(B, cx, s, words_width, els, obst, meta, rep)
            for f in (COPYFIT_STEPS if res["overset_lines"] or res.get("overset_crosshead_words") else ()):
                keep = (B.items[mark[0]:], B.lines[mark[1]:], B.problems[mark[2]:])
                del B.items[mark[0]:], B.lines[mark[1]:], B.problems[mark[2]:]
                trial = set_story(B, cx, s, words_width, els, obst, meta, rep, fit=f)
                if trial["overset_lines"] == 0 and not trial.get("overset_crosshead_words"):
                    res = trial
                    break
                del B.items[mark[0]:], B.lines[mark[1]:], B.problems[mark[2]:]   # keep the full-size setting
                B.items += keep[0]; B.lines += keep[1]; B.problems += keep[2]
            rep["stories"].append(res)
        except Exception as ex:  # noqa: BLE001
            B.problems.append({"story": s["id"], "problem": f"{type(ex).__name__}: {ex}"})
    for e in model["elements"]:
        if e["kind"] in TEXT_KINDS and e["id"] not in in_story:
            if e.get("run_in"):                          # its words are already in the body line that starts with them
                rep["run_in_skipped"] += 1
                continue
            if in_ad(e):
                rep["skipped_in_ads"] += 1
                continue
            _display_or_lines(B, cx, e, rep, meta, None, words_width)
    return B, rep


def _display_or_lines(B, cx, e, rep, meta, story_id, words_width=None):
    m = {**meta, "story": story_id}
    try:
        if e["kind"] in ("headline", "deck") and len(e["lines"]) > 0:
            rep["display"].append(set_display(B, cx, e, cx.head_pol, m, rep))
        else:
            set_lines(B, e, m, rep, words_width)
    except Exception as ex:  # noqa: BLE001
        B.problems.append({"element": e["id"], "kind": e["kind"], "problem": f"{type(ex).__name__}: {ex}"})
        if e["kind"] in ("headline", "deck"):
            rep["display"].append({"element": e["id"], "kind": e["kind"], "lines": len(e["lines"]), "failed": True, "same_breaks": False})
            try:
                set_lines(B, e, m, rep, words_width)
            except Exception as ex2:  # noqa: BLE001
                B.problems.append({"element": e["id"], "kind": e["kind"], "problem": f"fallback: {type(ex2).__name__}: {ex2}"})


def main():
    args = sys.argv[1:]
    out_dir, size_mode = None, "story"
    if "--out" in args:
        i = args.index("--out"); out_dir = Path(args[i + 1]).expanduser(); del args[i:i + 2]
    use_photos = "--photos" in args
    if use_photos:
        args.remove("--photos")
    if "--size" in args:
        i = args.index("--size"); size_mode = args[i + 1]; del args[i:i + 2]
    assert size_mode in ("story", "paper"), size_mode
    ds = Path(args[0]).expanduser()
    names = args[1:]
    src = ds / "report" / "page1" / "pages"
    out_dir = out_dir or ds / "report" / "page1" / ("rebuilt" if size_mode == "story" else "rebuilt_paper")
    out_dir.mkdir(parents=True, exist_ok=True)
    cx = Context(ds, size_mode)
    files = [Path(n) if n.endswith(".json") else src / f"{n}.json" for n in names] if names else sorted(src.glob("*.json"))
    intent, fl = MP.OUTPUT_INTENTS["IFRA26"], MP.PDFX["X-1a:2003"]
    for f in files:
        model = json.loads(f.read_text(encoding="utf-8"))
        if size_mode == "paper" and model["split"] != "test":
            continue                                       # the held-out prediction is reported on the test editions
        pdir = ds / "report" / "page1" / "photos" / f.stem if use_photos else None
        B, rep = build(cx, model, pdir)
        cx.frames(model["sample"], model["page"])
        inputs = {**cx.inputs, "model": _sha(f), "measure": cx._docs[model["sample"]][1]}
        build_id = hashlib.sha256(json.dumps([inputs, sorted(B.face_hash.items()), cx.body_choice, cx.c7_hash, size_mode, cx.r_cal,
                                              X.WRITER_VERSION, PAGE_MAKER, K3.COMPOSER_VERSION, H.HEADLINER_VERSION]).encode()).hexdigest()[:10]
        fk = B.font(SANS, {"wght": 400.0}, 400)
        B.text_line(f"PAGEINATOR REBUILD — TEST, NOT FOR PUBLICATION — page {model['page']} — build {build_id}", fk, 5.5, 8.0,
                    model["page_h_mm"] - 6.0, (0, 0, 0, 1), "left", meta={"role": "slug", "page": model["page"]})
        data, stats = X.build_pdf([X.Page(model["page_w_mm"] * MM, model["page_h_mm"] * MM, B.items)], B.fonts,
                                  title=f"Pageinator page rebuild {build_id} (TEST - not for publication)", output_intent=intent,
                                  actualtext=True, pdf_version=fl["pdf_version"], pdfx_info=fl["info"], creator="Pageinator EXP-PAGE-1")
        pdf = out_dir / f"{f.stem}.pdf"
        pdf.write_bytes(data)
        st_ = rep["stories"]
        summary = {"printed_body_lines": sum(s["printed_lines"] for s in st_), "our_body_lines": sum(s["our_lines"] for s in st_),
                   "overset_lines": sum(s["overset_lines"] for s in st_),
                   "overset_crosshead_words": sum(s.get("overset_crosshead_words", 0) for s in st_),
                   "paragraphs": sum(s["paragraphs"] for s in st_), "paragraphs_same_breaks": sum(s["paragraphs_same_breaks"] for s in st_),
                   "display": len(rep["display"]), "display_same_breaks": sum(d["same_breaks"] for d in rep["display"]),
                   "display_failed": sum(bool(d.get("failed")) for d in rep["display"]), "problems": len(B.problems)}
        manifest = {"schema": "pageinator.page1.rebuild/2", "page_maker": PAGE_MAKER, "build_id": build_id, "model": f.name,
                    "size_mode": size_mode, "r_cal": cx.r_cal, "inputs": inputs,
                    "sha256": hashlib.sha256(data).hexdigest(), "writer": X.WRITER_VERSION, "composer": K3.COMPOSER_VERSION,
                    "headliner": H.HEADLINER_VERSION, "body_policy": cx.body_choice, "head_policy": cx.head_pol.name, "c7_hash": cx.c7_hash,
                    "house_profile": cx.inputs["house_profile.json"], "crosshead_space_leadings": [cx.xh_above, cx.xh_below],
                    "stats": stats, "summary": summary, "stories": st_, "display": rep["display"], "problems": B.problems,
                    "skipped_in_ads": rep["skipped_in_ads"], "photos": rep.get("photos", 0), "run_in_skipped": rep["run_in_skipped"], "colour_conversions": rep["colour"],
                    "fonts": {k: {"family": MP.FONTS[k][0], "axes": MP.FONTS[k][1], "weight": MP.FONTS[k][2], "face_sha256": B.face_hash[k]} for k in B.fonts},
                    "lines": B.lines}
        mp = pdf.with_suffix(".manifest.json")
        mp.write_text(json.dumps(manifest, ensure_ascii=False) + "\n", encoding="utf-8")
        pdf.chmod(0o600); mp.chmod(0o600)
        print(f.stem, json.dumps(summary))
    if cx.r_cal is not None:
        print("paper-level calibration ratio (calibration editions):", cx.r_cal)


if __name__ == "__main__":
    main()
