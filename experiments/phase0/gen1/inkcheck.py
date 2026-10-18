"""Ink collisions between text lines of a Pageinator PDF, from the real glyph outlines (EXPERIMENTAL).

Method (from EXP-GEN-1's independent verification): walk the page's content stream with pikepdf. Every BT…ET block
is one text line, every Tj one glyph (CID = glyph id, Identity-H). Each glyph's TrueType outline is taken from the
embedded font with fontTools and transformed by Tm × CTM × size. Two lines collide when their outlines, rasterised at
RES px per pt, share ink. PDFium's character boxes (compare_page.glyph_collisions) do not follow combining marks inside
ActualText spans, so they miss vowel signs that reach into the next line; this measure does not.
Only for PDFs written by pdfx1/pdfx.py (one glyph per Tj, no TJ kerning, no text-state operators).
"""
from __future__ import annotations

import io

import pikepdf
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw

RES = 12.0                         # px per pt
MIN_MM2 = 0.005                    # overlaps smaller than this are anti-aliasing noise
PT2_PER_MM2 = (72 / 25.4) ** 2


def _mul(a, b):
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def _apply(m, x, y):
    return m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]


class _Pen(BasePen):
    def __init__(self, gs):
        super().__init__(gs)
        self.contours, self.cur = [], []

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        self.cur += [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
                     for t in (i / 6 for i in range(1, 7))]

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        self.cur += [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
                      (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
                     for t in (i / 8 for i in range(1, 9))]

    def _closePath(self):
        if len(self.cur) > 2:
            self.contours.append(self.cur)
        self.cur = []

    _endPath = _closePath


class _Font:
    def __init__(self, fobj):
        d = fobj.DescendantFonts[0] if "/DescendantFonts" in fobj else fobj
        self.tt = TTFont(io.BytesIO(d.FontDescriptor.FontFile2.read_bytes()))
        self.upem, self.gs, self.order, self.cache = self.tt["head"].unitsPerEm, self.tt.getGlyphSet(), self.tt.getGlyphOrder(), {}

    def outline(self, gid):
        if gid not in self.cache:
            pen = _Pen(self.gs)
            if gid < len(self.order):
                self.gs[self.order[gid]].draw(pen)
            self.cache[gid] = pen.contours
        return self.cache[gid]


def lines(path) -> list:
    """Text lines of page 1: [{"glyphs": [(polys, bbox)], "bbox": …}] in pt, y up."""
    pdf = pikepdf.open(path)
    pg = pdf.pages[0]
    fonts = {str(k): _Font(v) for k, v in (pg.Resources.get("/Font") or {}).items()}
    ctm, stack, tm, font, size, cur, out = [1, 0, 0, 1, 0, 0], [], [1, 0, 0, 1, 0, 0], None, None, None, []
    for operands, op in pikepdf.parse_content_stream(pg):
        op = str(op)
        if op == "q":
            stack.append(ctm[:])
        elif op == "Q":
            ctm = stack.pop()
        elif op == "cm":
            ctm = _mul([float(x) for x in operands], ctm)
        elif op == "BT":
            cur = []
        elif op == "ET":
            if cur:
                out.append({"glyphs": cur})
            cur = None
        elif op == "Tf":
            font, size = str(operands[0]), float(operands[1])
        elif op == "Tm":
            tm = [float(x) for x in operands]
        elif op in ("Tj", "TJ"):
            if op == "TJ" and any(not isinstance(x, pikepdf.String) for x in operands[0]):
                raise RuntimeError("TJ kerning is not expected in pdfx1 output")
            for sb in ([operands[0]] if op == "Tj" else list(operands[0])):
                b = bytes(sb)
                if len(b) != 2:
                    raise RuntimeError("one glyph per Tj is expected in pdfx1 output")
                gid, F = int.from_bytes(b, "big"), fonts[font]
                m = _mul([size / F.upem, 0, 0, size / F.upem, 0, 0], _mul(tm, ctm))
                polys = [[_apply(m, x, y) for x, y in c] for c in F.outline(gid)]
                pts = [p for c in polys for p in c]
                if pts:
                    cur.append((polys, (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))))
        elif op in ("Td", "TD", "T*", "'", '"', "Tz", "Tc", "Tw", "TL", "Ts"):
            raise RuntimeError(f"text operator {op} is not expected in pdfx1 output")
    for ln in out:
        bb = [b for _, b in ln["glyphs"]]
        ln["bbox"] = (min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb), max(b[3] for b in bb))
    return out


def _meet(a, b):
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def _area(c):
    return sum(c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1] for i in range(len(c))) / 2


def _raster(polys_list, reg):
    x0, y0, x1, y1 = reg
    W, H = max(1, int((x1 - x0) * RES) + 1), max(1, int((y1 - y0) * RES) + 1)
    fill, hole = Image.new("1", (W, H), 0), Image.new("1", (W, H), 0)
    df, dh = ImageDraw.Draw(fill), ImageDraw.Draw(hole)
    for polys in polys_list:
        for c in polys:            # TrueType: outer contours clockwise (negative area, y up), holes counter-clockwise
            (df if _area(c) < 0 else dh).polygon([((x - x0) * RES, (y1 - y) * RES) for x, y in c], fill=1)
    return ImageChops.logical_and(fill, ImageChops.invert(hole))


def overlap_mm2(la, lb) -> float:
    if not _meet(la["bbox"], lb["bbox"]):
        return 0.0
    pa = [p for p, b in la["glyphs"] if any(_meet(b, b2) for _, b2 in lb["glyphs"])]
    pb = [p for p, b in lb["glyphs"] if any(_meet(b, b2) for _, b2 in la["glyphs"])]
    if not pa or not pb:
        return 0.0
    reg = (max(la["bbox"][0], lb["bbox"][0]), max(la["bbox"][1], lb["bbox"][1]), min(la["bbox"][2], lb["bbox"][2]), min(la["bbox"][3], lb["bbox"][3]))
    h = ImageChops.logical_and(_raster(pa, reg), _raster(pb, reg)).histogram()
    return (h[-1] if len(h) > 1 else 0) / (RES * RES) / PT2_PER_MM2


def collisions(path) -> list:
    """Pairs of text lines whose glyph ink overlaps by more than MIN_MM2: [(area mm², bbox a, bbox b)] (bboxes in mm, y down
    from the top is not needed here: pt, y up)."""
    L = lines(path)
    L.sort(key=lambda ln: ln["bbox"][1])
    out = []
    for i, a in enumerate(L):
        for b in L[i + 1:]:
            if b["bbox"][1] >= a["bbox"][3]:
                break
            ov = overlap_mm2(a, b)
            if ov > MIN_MM2:
                out.append((round(ov, 3), [round(v, 1) for v in a["bbox"]], [round(v, 1) for v in b["bbox"]]))
    return out
