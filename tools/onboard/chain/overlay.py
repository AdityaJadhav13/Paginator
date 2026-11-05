"""EXP-PUBLISHED-1 visual verification overlay (EXPERIMENTAL).

Renders each page with PDFium (pypdfium2, BSD/Apache — consistent with the licence review; NOT Ghostscript/
MuPDF) to PNG, and writes an SVG on top showing: body/other frames (column edges), line boxes coloured by
alignment class, baselines, word gaps coloured by space ratio, and detected line-end breaks.
Purpose: an engineer must LOOK before trusting any statistic (prompt §33).

Usage: .venv/bin/python overlay.py <source.pdf> <measure_or_corrected.json> --out <dir> [--dpi 110]
"""
from __future__ import annotations

import argparse
import json
import struct
import zlib
from html import escape
from pathlib import Path

import pypdfium2 as pdfium

CLASS_COL = {"FULLY_ALIGNED": "#1b9e3e", "NEAR_ALIGNED": "#c9a400", "RAGGED": "#d95f02",
             "FINAL_PARAGRAPH_LINE": "#7570b3", "SPECIAL_CASE": "#e7298a"}


def write_png(path: Path, w: int, h: int, buf: bytes, stride: int, nch: int) -> None:
    """Minimal PNG writer for PDFium's BGR/BGRA/BGRx bitmaps (no Pillow/numpy dependency)."""
    rows = []
    for y in range(h):
        row = buf[y * stride: y * stride + w * nch]
        rgb = bytearray(w * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = row[2::nch], row[1::nch], row[0::nch]
        rows.append(b"\x00" + bytes(rgb))
    raw = zlib.compress(b"".join(rows), 6)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


def render(pdf: Path, meas: dict, out: Path, dpi: int = 110) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(pdf))
    made = []
    for pg in meas["pages"]:
        page = doc[pg["page"] - 1]
        w_pt, h_pt = page.get_size()
        bm = page.render(scale=dpi / 72.0)
        png = out / f"page-{pg['page']:02d}.png"
        write_png(png, bm.width, bm.height, bytes(bm.buffer), bm.stride, bm.n_channels)
        els = [f'<image href="{png.name}" x="0" y="0" width="{w_pt}" height="{h_pt}" opacity="0.55"/>']
        for fr in pg["frames"]:
            L = fr["column_left_mm"] / 25.4 * 72; R = fr["right_edge_mm"] / 25.4 * 72
            top = h_pt - fr["top_baseline_pt"] - (fr["size_pt"] or 10)
            bot = h_pt - fr["lines"][-1]["baseline_pt"] + 3
            col = "#2166ac" if fr["is_body_candidate"] else "#999"
            els.append(f'<rect x="{L:.2f}" y="{top:.2f}" width="{R - L:.2f}" height="{bot - top:.2f}" fill="none" stroke="{col}" stroke-width="0.6" stroke-dasharray="3 2"/>')
            els.append(f'<text x="{L:.1f}" y="{top - 1.5:.1f}" font-size="4" fill="{col}">{escape(fr["id"])} w={fr["width_mm"]}mm {fr["size_pt"]}pt lead={fr["leading_pt"]}</text>')
            sz = fr["size_pt"] or 10
            for ln in fr["lines"]:
                y = h_pt - ln["baseline_pt"]
                x0 = ln["x0_mm"] / 25.4 * 72; x1 = ln["x1_mm"] / 25.4 * 72
                c = CLASS_COL.get(ln["class"], "#000")
                els.append(f'<rect x="{x0:.2f}" y="{y - 0.8 * sz:.2f}" width="{x1 - x0:.2f}" height="{sz:.2f}" fill="none" stroke="{c}" stroke-width="0.35"/>')
                els.append(f'<line x1="{x0:.2f}" y1="{y:.2f}" x2="{x1:.2f}" y2="{y:.2f}" stroke="{c}" stroke-width="0.2"/>')
                for t, r in zip(zip(ln["tokens"], ln["tokens"][1:]), ln["gap_ratios"] or [None] * len(ln["gaps_pt"])):
                    a, b = t
                    gc = "#888" if r is None else ("#d7191c" if r > 2.0 else "#fdae61" if r > 1.5 else "#1a9641")
                    els.append(f'<rect x="{a["x1"]:.2f}" y="{y - 0.5 * sz:.2f}" width="{max(0.2, b["x0"] - a["x1"]):.2f}" height="{0.4 * sz:.2f}" fill="{gc}" opacity="0.6"/>')
                if ln.get("break"):
                    els.append(f'<circle cx="{x1 + 1.5:.2f}" cy="{y - 0.3 * sz:.2f}" r="1.6" fill="#ff00ff"/>')
        svg = out / f"page-{pg['page']:02d}.overlay.svg"
        legend = ("Line classes: green FULLY_ALIGNED · yellow NEAR · orange RAGGED · purple FINAL · pink SPECIAL | "
                  "gap colour: green ≤1.5× · orange ≤2.0× · red >2.0× · grey unknown | magenta dot = line-end hyphen break")
        svg.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w_pt} {h_pt}" width="{w_pt}pt" height="{h_pt}pt">'
                       f'<rect width="100%" height="100%" fill="#fff"/>{"".join(els)}'
                       f'<text x="4" y="{h_pt - 3}" font-size="4">{escape(legend)}</text></svg>\n', encoding="utf-8")
        made += [png, svg]
    return made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path); ap.add_argument("measure", type=Path); ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--dpi", type=int, default=110)
    a = ap.parse_args()
    for p in render(a.pdf, json.loads(a.measure.read_text()), a.out, a.dpi):
        print(p)


if __name__ == "__main__":
    main()
