"""Logical text of measured lines, using the PDF's /ActualText marked content (EXPERIMENTAL).

Production PDFs from InDesign + Adobe PDF Library draw Devanagari glyphs in VISUAL order (e.g. the i-matra glyph
before its consonant) and map some glyphs to incomplete ToUnicode strings. For those clusters the PDF carries the
exact Unicode in a marked-content span:  /Span <</ActualText <FEFF...>>> BDC  <glyphs> Tj  EMC.
pdfminer's text ignores /ActualText and PDFium drops characters in these files (EXP_PUBLISHED_1.md §12), so this
module re-reads the content stream with pdfminer's interpreter and a device that tracks the marked-content stack:
  - a glyph inside an ActualText span contributes that span's text once (at the span's first glyph);
  - any other glyph contributes its ToUnicode text;
  - order is CONTENT-STREAM order (InDesign writes text in reading order), never x-sorted.
A line's glyphs are selected by baseline (±0.15 em) and x-range, exactly like measure.py's geometry.
Unmapped glyphs ("(cid:N)") are reported, never guessed.
"""
from __future__ import annotations

import unicodedata
from pathlib import Path

from pdfminer.converter import PDFPageAggregator
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.psparser import PSLiteral

MM = 72 / 25.4


def _decode(v) -> str:
    if isinstance(v, bytes):
        if v[:2] == b"\xfe\xff":
            return v[2:].decode("utf-16-be", "replace")
        if v[:2] == b"\xff\xfe":
            return v[2:].decode("utf-16-le", "replace")
        return v.decode("latin-1", "replace")
    return str(v)


class _ATDevice(PDFPageAggregator):
    """Layout device that tags every LTChar with the innermost enclosing /ActualText span."""

    def __init__(self, rsrc):
        super().__init__(rsrc, laparams=None)
        self.stack: list = []
        self.n_spans = 0
        self.glyphs: list = []      # (order, LTChar, span) with span = (span_id, text) | None

    def begin_tag(self, tag: PSLiteral, props=None) -> None:
        span = None
        if isinstance(props, dict):
            at = props.get("ActualText")
            if at is not None:
                self.n_spans += 1
                span = (self.n_spans, unicodedata.normalize("NFC", _decode(at)))
        self.stack.append(span)

    def end_tag(self) -> None:
        if self.stack:
            self.stack.pop()

    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate):
        adv = super().render_char(matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate)
        item = self.cur_item._objs[-1]
        span = next((s for s in reversed(self.stack) if s is not None), None)
        self.glyphs.append((len(self.glyphs), item, span))
        return adv


def page_glyphs(pdf: Path, page_no: int) -> list[dict]:
    """All glyphs of one page in content order: x0, x1, baseline, size, font, tounicode text, span."""
    rsrc = PDFResourceManager()
    dev = _ATDevice(rsrc)
    interp = PDFPageInterpreter(rsrc, dev)
    with open(pdf, "rb") as fh:
        for i, pg in enumerate(PDFPage.get_pages(fh), 1):
            if i == page_no:
                interp.process_page(pg)
                break
    out = []
    for order, ch, span in dev.glyphs:
        a, b, c, d, e, f = ch.matrix
        out.append({"i": order, "x0": ch.x0, "x1": ch.x1, "by": f, "size": ch.size, "font": ch.fontname,
                    "text": ch.get_text(), "span": span, "upright": abs(b) < 1e-6 and abs(c) < 1e-6 and d > 0})
    return out


def line_text(glyphs: list[dict], baseline_pt: float, x0_pt: float, x1_pt: float, size: float) -> dict:
    """Logical text of the glyphs on one measured line (content order; ActualText spans emitted once)."""
    sel = [g for g in glyphs if g["upright"] and abs(g["by"] - baseline_pt) <= 0.15 * size
           and x0_pt - 1.0 <= (g["x0"] + g["x1"]) / 2 <= x1_pt + 1.0]
    sel.sort(key=lambda g: g["i"])
    parts, seen, unmapped, fonts = [], set(), 0, {}
    for g in sel:
        if g["span"] is not None:
            sid, txt = g["span"]
            if sid in seen:
                continue
            seen.add(sid); parts.append(txt)
        else:
            t = g["text"]
            if t.startswith("(cid:"):
                unmapped += 1
                t = "�"
            parts.append(t)
        if g["text"] != " ":
            base = g["font"].split("+")[-1]
            fonts[base] = fonts.get(base, 0) + 1
    text = unicodedata.normalize("NFC", "".join(parts))
    return {"text": " ".join(text.split()), "glyphs": len(sel), "spans": len(seen), "unmapped": unmapped, "fonts": fonts}
