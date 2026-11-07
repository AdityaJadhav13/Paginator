"""Screen equals print, level L1 (docs/architecture/v2/12_QUALITY_STRATEGY.md §6): the glyphs a page's PDF shows,
recovered from its content stream, against the display list the editor draws (deskedit.PageSession.draw: text items
{"t": "text", "f": font, "s": size, "hs": horizontal scale, "g": [[gid, x_mm, y_mm], …]}, y down from the page's top).

The PDF is the engine's own writer's (experiments/phase0/pdfx1/pdfx.py): every font a Type0 font, Encoding
Identity-H with CIDToGIDMap Identity (a 2-byte code is the glyph id), its resource named by the display list's font
key; every glyph placed with an absolute text matrix ("hs 0 0 1 x y Tm <gid> Tj"). The parser below follows the PDF
rules in general (q/Q/cm, Tm, Td/TD/T*, Tf, Tz, Tc, TJ adjustments, advances from /W), so another writer's output reads
too. The face of a PDF font is the display list's ("fonts": {key: {"face"}}), by its resource name: the embedded
program is a subset, so its bytes are not the face's.

    python -m pgn_worker.screenprint <draw.json> <page.pdf>     → the diff as JSON; exit 0 equal, 1 different"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pikepdf

MM = 72.0 / 25.4
TOL_MM = 0.001        # the display list rounds to 0.001 mm (deskedit._r), the writer to 0.001 pt (pdfx.num)


def _mul(a: list[float], b: list[float]) -> list[float]:
    """a × b, PDF matrices [a b c d e f]."""
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def _widths(font: pikepdf.Dictionary) -> tuple[dict[int, float], float]:
    """A Type0 font's glyph widths (/W, in 1/1000 em) and its default (/DW)."""
    if font.get("/Subtype") != "/Type0" or font.get("/Encoding") != "/Identity-H":
        raise ValueError("a font that is not Type0 Identity-H: its codes are not glyph ids")
    cid = font.DescendantFonts[0]
    if cid.get("/CIDToGIDMap", pikepdf.Name.Identity) != "/Identity":
        raise ValueError("a CID font without CIDToGIDMap Identity")
    w, out, i = list(cid.get("/W", [])), {}, 0
    while i < len(w):
        first = int(w[i])
        if isinstance(w[i + 1], pikepdf.Array):
            out.update({first + k: float(v) for k, v in enumerate(w[i + 1])})
            i += 2
        else:
            out.update({g: float(w[i + 2]) for g in range(first, int(w[i + 1]) + 1)})
            i += 3
    return out, float(cid.get("/DW", 1000))


def pdf_glyphs(pdf_path: Path, page_no: int = 0) -> list[dict]:
    """Every glyph a page shows, in content-stream order: {"font" (resource name), "gid", "x", "y" (mm, y down from
    the top of the MediaBox), "size" (pt), "hs" (the text matrix's horizontal scale)}."""
    with pikepdf.open(pdf_path) as pdf:
        page = pdf.pages[page_no]
        box = [float(v) for v in page.MediaBox]
        top = box[3]
        fonts = {str(k)[1:]: (v, *_widths(v)) for k, v in (page.Resources.get("/Font") or {}).items()}
        ctm, stack = [1.0, 0, 0, 1.0, 0, 0], []
        tm = tlm = [1.0, 0, 0, 1.0, 0, 0]
        font = size = None
        tz, tc, tl = 1.0, 0.0, 0.0
        out = []

        def show(code: bytes) -> None:
            nonlocal tm
            if font is None:
                raise ValueError("text shown before a font is set")
            widths, dw = fonts[font][1], fonts[font][2]
            for i in range(0, len(code) - 1, 2):
                gid = int.from_bytes(code[i:i + 2], "big")
                m = _mul([size * tz, 0, 0, size, 0, 0], _mul(tm, ctm))     # the text rendering matrix
                hs = (tm[0] * ctm[0] + tm[1] * ctm[2])
                out.append({"font": font, "gid": gid, "x": m[4] / MM, "y": (top - m[5]) / MM, "size": size, "hs": hs})
                tm = _mul([1.0, 0, 0, 1.0, (widths.get(gid, dw) / 1000 * size + tc) * tz, 0], tm)

        for operands, op in pikepdf.parse_content_stream(page):
            op = str(op)
            if op == "q":
                stack.append(ctm)
            elif op == "Q":
                ctm = stack.pop()
            elif op == "cm":
                ctm = _mul([float(v) for v in operands], ctm)
            elif op == "BT":
                tm = tlm = [1.0, 0, 0, 1.0, 0, 0]
            elif op == "Tm":
                tm = tlm = [float(v) for v in operands]
            elif op in ("Td", "TD"):
                tx, ty = (float(v) for v in operands)
                if op == "TD":
                    tl = -ty
                tm = tlm = _mul([1.0, 0, 0, 1.0, tx, ty], tlm)
            elif op == "T*":
                tm = tlm = _mul([1.0, 0, 0, 1.0, 0, -tl], tlm)
            elif op == "TL":
                tl = float(operands[0])
            elif op == "Tf":
                font, size = str(operands[0])[1:], float(operands[1])
            elif op == "Tz":
                tz = float(operands[0]) / 100
            elif op == "Tc":
                tc = float(operands[0])
            elif op == "Tj":
                show(bytes(operands[0]))
            elif op == "TJ":
                for part in operands[0]:
                    if isinstance(part, pikepdf.String):
                        show(bytes(part))
                    else:
                        tm = _mul([1.0, 0, 0, 1.0, -float(part) / 1000 * size * tz, 0], tm)
            elif op in ("'", '"'):
                raise ValueError(f"the text operator {op} is not one the engine's writer uses")
        return out


def screen_glyphs(draw: dict) -> list[dict]:
    """The display list's glyphs, in its order: {"font", "gid", "x", "y", "size", "hs"}."""
    return [{"font": it["f"], "gid": g[0], "x": g[1], "y": g[2], "size": it["s"], "hs": it.get("hs", 1.0)}
            for it in draw.get("items") or [] if it.get("t") == "text" for g in it["g"]]


def compare(draw: dict, pdf: list[dict], tol_mm: float = TOL_MM) -> dict:
    """The display list against the PDF's glyphs: the same glyph ids in the same fonts, in the same order, each at the
    same place (within tol_mm), size and scale. → {"equal", "screen_glyphs", "pdf_glyphs", "max_dx_mm", "max_dy_mm",
    "differences": the first 50 [{index, what, screen, pdf}]}."""
    screen = screen_glyphs(draw)
    diffs, dx, dy = [], 0.0, 0.0
    if len(screen) != len(pdf):
        diffs.append({"index": min(len(screen), len(pdf)), "what": "count", "screen": len(screen), "pdf": len(pdf)})
    for i, (s, p) in enumerate(zip(screen, pdf)):
        dx, dy = max(dx, abs(s["x"] - p["x"])), max(dy, abs(s["y"] - p["y"]))
        what = ("font" if s["font"] != p["font"] else "glyph" if s["gid"] != p["gid"]
                else "position" if abs(s["x"] - p["x"]) > tol_mm or abs(s["y"] - p["y"]) > tol_mm
                else "size" if abs(s["size"] - p["size"]) > 1e-4 or abs(s["hs"] - p["hs"]) > 1e-4 else None)
        if what:
            diffs.append({"index": i, "what": what, "screen": s, "pdf": p})
    return {"equal": not diffs, "screen_glyphs": len(screen), "pdf_glyphs": len(pdf), "max_dx_mm": round(dx, 6),
            "max_dy_mm": round(dy, 6), "differences": diffs[:50]}


def faced(draw: dict, pdf: list[dict]) -> list[list]:
    """The PDF's glyphs as [face, gid, x_mm, y_mm] (draw's "g" with its 24-hex face key, by the font's resource)."""
    faces = {k: v.get("face") for k, v in (draw.get("fonts") or {}).items()}
    return [[faces.get(g["font"], g["font"]), g["gid"], round(g["x"], 4), round(g["y"], 4)] for g in pdf]


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print(__doc__.rsplit("\n\n", 1)[1].strip(), file=sys.stderr)
        return 2
    draw = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    draw = draw.get("result", draw) if isinstance(draw.get("result"), dict) else draw     # an answer, or its result
    diff = compare(draw, pdf_glyphs(Path(args[1])))
    print(json.dumps(diff, ensure_ascii=False, indent=1))
    return 0 if diff["equal"] else 1


if __name__ == "__main__":
    sys.exit(main())
