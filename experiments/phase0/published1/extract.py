"""EXP-PUBLISHED-1 raw extraction: PDF → raw glyph geometry JSON (no interpretation).

EXPERIMENTAL. Uses pdfminer.six (MIT) only. Never modifies the input. Output = RAW EXTRACTION, which is
never overwritten by later steps (corrections are applied to measurements, not to this file).

Per glyph we keep: x0/x1 (advance box, pt, from glyph origin + rendered advance), baseline y (text matrix
f), rendered size (pt), font ref, extracted text (ToUnicode — UNRELIABLE for Devanagari), matrix a/b/c/d.

Usage: .venv/bin/python extract.py <file.pdf> --out <raw.json> [--pages 1,2]
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTChar
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfinterp import PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser
from pdfminer.pdftypes import resolve1

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema as S  # noqa: E402


def _name(x):
    x = resolve1(x)
    return getattr(x, "name", None) or (x.decode("latin-1") if isinstance(x, bytes) else (str(x) if x is not None else None))


def _box(page, key):
    v = page.attrs.get(key)
    v = resolve1(v) if v is not None else None
    return [float(resolve1(n)) for n in v] if v else None


def font_records(page, rsrc: PDFResourceManager) -> dict:
    out = {}
    fonts = resolve1(page.resources.get("Font", {})) if page.resources else {}
    for res_name, ref in (fonts or {}).items():
        spec = resolve1(ref)
        base = _name(spec.get("BaseFont"))
        rec = {"resource": res_name, "base_font": base, "subtype": _name(spec.get("Subtype")),
               "encoding": _name(spec.get("Encoding")) if not isinstance(resolve1(spec.get("Encoding")), dict) else "dict",
               "has_tounicode": "ToUnicode" in spec, "subset": bool(base and len(base) > 7 and base[6] == "+"),
               "embedded": None, "font_program": None, "space_em": None, "space_em_source": None}
        desc = spec
        if "DescendantFonts" in spec:
            d = resolve1(resolve1(spec["DescendantFonts"])[0])
            rec["cid_subtype"] = _name(d.get("Subtype"))
            desc = d
        fd = resolve1(desc.get("FontDescriptor")) if desc.get("FontDescriptor") else None
        prog = None
        if fd:
            for k in ("FontFile", "FontFile2", "FontFile3"):
                if k in fd:
                    rec["embedded"], rec["font_program"] = True, k
                    try:
                        prog = resolve1(fd[k]).get_data()
                    except Exception:  # noqa: BLE001
                        prog = None
                    break
            else:
                rec["embedded"] = False
            rec["descriptor"] = {k: (_name(fd.get(k)) if k == "FontName" else (float(resolve1(fd[k])) if k in fd and not isinstance(resolve1(fd[k]), list) else None))
                                 for k in ("FontName", "Ascent", "Descent", "CapHeight", "AvgWidth", "MissingWidth")}
        # 1) space width from the PDF's own width table (EXACT): CID/code whose ToUnicode is U+0020
        try:
            f = rsrc.get_font(None, spec)
            umap = getattr(f, "unicode_map", None)
            if umap is not None:
                for cid, uni in getattr(umap, "cid2unichr", {}).items():
                    if uni == " ":
                        rec["space_em"], rec["space_em_source"] = f.char_width(cid), "pdf_widths_via_tounicode"
                        rec["space_cid"] = cid
                        break
        except Exception as e:  # noqa: BLE001
            rec["font_parse_error"] = f"{type(e).__name__}: {e}"[:120]
        # 2) fall back to the embedded font program (DERIVED)
        if rec["space_em"] is None and prog and rec["font_program"] in ("FontFile2", "FontFile3"):
            try:
                from fontTools.ttLib import TTFont  # noqa: PLC0415
                tt = TTFont(io.BytesIO(prog), lazy=True) if rec["font_program"] == "FontFile2" else None
                if tt is not None:
                    upem = tt["head"].unitsPerEm
                    gname = None
                    if "cmap" in tt:
                        gname = (tt.getBestCmap() or {}).get(0x20)
                    if gname is None and "space" in tt.getGlyphOrder():
                        gname = "space"
                    if gname:
                        rec["space_em"], rec["space_em_source"] = tt["hmtx"][gname][0] / upem, "font_program"
            except Exception as e:  # noqa: BLE001
                rec["font_program_error"] = f"{type(e).__name__}: {e}"[:120]
        out[base or res_name] = rec
    return out


def extract(pdf: Path, pages: set[int] | None = None) -> dict:
    data = pdf.read_bytes()
    with open(pdf, "rb") as fh:
        doc = PDFDocument(PDFParser(fh))
        info = {}
        for d in doc.info or []:
            for k, v in d.items():
                v = resolve1(v)
                info[k] = v.decode("latin-1", "replace") if isinstance(v, bytes) else str(v)
        rsrc = PDFResourceManager()
        page_meta = []
        for i, pg in enumerate(PDFPage.create_pages(doc), 1):
            if pages and i not in pages:
                continue
            page_meta.append({"page": i, "mediabox": [float(v) for v in pg.mediabox], "cropbox": [float(v) for v in pg.cropbox],
                              "trimbox": _box(pg, "TrimBox"), "bleedbox": _box(pg, "BleedBox"),
                              "rotate": int(resolve1(pg.attrs.get("Rotate", 0)) or 0),
                              "fonts": font_records(pg, rsrc)})
    out_pages = []
    for i, layout in enumerate(extract_pages(str(pdf), laparams=LAParams(all_texts=True)), 1):
        if pages and i not in pages:
            continue
        chars = []

        def walk(o):
            if isinstance(o, LTChar):
                a, b, c, d, e, f = o.matrix
                chars.append([round(o.x0, 4), round(o.x1, 4), round(f, 4), round(o.y0, 4), round(o.y1, 4),
                              round(o.size, 4), o.fontname, o.get_text(), round(a, 6), round(b, 6), round(c, 6), round(d, 6)])
            elif hasattr(o, "__iter__"):
                for x in o:
                    walk(x)
        walk(layout)
        meta = next(m for m in page_meta if m["page"] == i)
        out_pages.append({**meta, "char_fields": ["x0", "x1", "baseline_y", "y0", "y1", "size", "font", "text", "a", "b", "c", "d"],
                          "chars": chars})
    return {"schema": "pageinator.published1.raw/1", "tool": S.TOOL_VERSION,
            "source": {"file": pdf.name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "info": info},
            "units": "PDF user space points (1/72 in); origin bottom-left as in the PDF",
            "pages": out_pages}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path); ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--pages", default="")
    a = ap.parse_args()
    pages = {int(x) for x in a.pages.split(",") if x} or None
    raw = extract(a.pdf, pages)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(raw, ensure_ascii=False))
    print(f"{a.pdf.name}: pages={len(raw['pages'])} glyphs={sum(len(p['chars']) for p in raw['pages'])}")


if __name__ == "__main__":
    main()
