"""Export selected measured body frames for side-by-side comparison (EXPERIMENTAL; PILOT DATA STAYS PRIVATE).

For each frame: a high-resolution crop of the original page (PNG) and, per line, the class, break flag, measured
word-gap ratios and three TEXT readings: actualtext.py (the PDF's /ActualText spans + ToUnicode, in content order —
the exact text), and, for comparison only, PDFium (characters whose origin lies on the baseline) and pdfminer (the
measured tokens), which both mis-read Devanagari in these files. Output goes INSIDE the dataset directory (private).

Usage: .venv/bin/python extract_frames.py <dataset_dir> <sample_id> <frame_id> [<frame_id> ...] [--dpi 600]
Output: <dataset_dir>/report/compare/<sample_id>_<frame_id>.{png,json}
"""
from __future__ import annotations

import argparse
import ctypes
import json
import statistics as st
from pathlib import Path

import pypdfium2 as pdfium

import actualtext as AT
import overlay as O

MM = 72 / 25.4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", type=Path); ap.add_argument("sample"); ap.add_argument("frames", nargs="+")
    ap.add_argument("--dpi", type=int, default=600)
    a = ap.parse_args()
    work = a.dataset / "work" / a.sample
    doc = json.loads(((work / "corrected.json") if (work / "corrected.json").exists() else (work / "measure.json")).read_text())
    pdf = pdfium.PdfDocument(str(next((a.dataset / "samples" / a.sample).glob("*.pdf"))))
    out = a.dataset / "report" / "compare"; out.mkdir(parents=True, exist_ok=True)
    for fid in a.frames:
        pno = int(fid.split("-")[0][1:])
        fr = next(f for f in next(p for p in doc["pages"] if p["page"] == pno)["frames"] if f["id"] == fid)
        page = pdf[pno - 1]; tp = page.get_textpage()
        ox, oy = ctypes.c_double(), ctypes.c_double()
        origins = []
        for i in range(tp.count_chars()):
            pdfium.raw.FPDFText_GetCharOrigin(tp.raw, i, ctypes.byref(ox), ctypes.byref(oy))
            origins.append((ox.value, oy.value, chr(pdfium.raw.FPDFText_GetUnicode(tp.raw, i))))
        at_glyphs = AT.page_glyphs(next((a.dataset / "samples" / a.sample).glob("*.pdf")), pno)
        pw, ph = page.get_size()
        sz = fr["size_pt"]; L = fr["column_left_mm"] * MM; R = fr["right_edge_mm"] * MM
        pad = 2 * MM
        top = fr["lines"][0]["baseline_pt"] + 1.0 * sz + pad
        bot = fr["lines"][-1]["baseline_pt"] - 0.45 * sz - pad
        crop = (L - pad, bot, pw - (R + pad), ph - top)          # amounts cut from left, bottom, right, top (pt)
        bm = page.render(scale=a.dpi / 72, crop=crop)
        png = out / f"{a.sample}_{fid}.png"
        O.write_png(png, bm.width, bm.height, bytes(bm.buffer), bm.stride, bm.n_channels)
        lines = []
        for ln in fr["lines"]:
            y = ln["baseline_pt"]
            txt = "".join(c for x, yy, c in origins if abs(yy - y) <= 0.35 * sz and L - 1.5 <= x <= R + 1.5)
            txt = " ".join(txt.replace("\r", " ").replace("\n", " ").split())
            miner = " ".join(t["text"] for t in ln["tokens"])
            gr = [r for r, pu in zip(ln["gap_ratios"] or [], ln.get("gap_punct_adjacent") or [False] * 999) if r is not None and not pu]
            at = AT.line_text(at_glyphs, y, ln["x0_mm"] * MM, ln["x1_mm"] * MM, sz)
            lines.append({"text_actualtext": at["text"], "text_pdfium": txt, "text_pdfminer": miner, "class": ln["class"], "break": bool(ln.get("break")), "baseline_pt": y,
                          "left_offset_mm": ln["left_offset_mm"], "x1_mm": ln["x1_mm"], "words": ln.get("words"),
                          "gap_ratios_word_word": gr, "line_space_factor": round(st.median(gr), 4) if gr else None})
        rec = {"sample": a.sample, "frame": fid, "page": pno, "width_mm": fr["width_mm"], "size_pt": sz,
               "leading_pt": fr["leading_pt"], "hscale": fr["hscale_median"], "mean_advancing_glyph_em": fr["mean_advancing_glyph_em"],
               "nominal_space_pt": fr["nominal_space_pt"], "font": fr["font"], "column_left_mm": fr["column_left_mm"],
               "crop_pt": {"x0": L - pad, "x1": R + pad, "y_top": top, "y_bottom": bot}, "png": png.name, "dpi": a.dpi,
               "lines": lines}
        (out / f"{a.sample}_{fid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1))
        print(fid, f"{fr['width_mm']:.1f} mm", len(lines), "lines →", png.name)


if __name__ == "__main__":
    main()
