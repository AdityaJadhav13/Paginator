"""G-PDF: the EXP-PDF-1 writer's building blocks and small whole files (EVIDENCE TOOLING).

experiments/phase0/pdfx1/pdfx.py (pdfx1/1.0.0) wrote the press-accepted PDF/X-1a page: its own serialiser; one
Type0/CIDFontType2 font per instance with a glyph-ID-retaining fontTools subset; ToUnicode plus /ActualText;
ExtGState overprint control; Flate at level 9; ID = MD5 of the body; dates from SOURCE_DATE_EPOCH. Recorded:
  pdf/vectors.jsonl.gz     num(), the name and text-string encoders, ser() on nested values, pdf_date(), the subset
                           tag, the ToUnicode CMap and the CMYK operand text (bytes as Latin-1 text)
  pdf/micro/<case>.pdf     small whole files made with build_pdf() through the press test's PageBuilder: an empty
                           page, rectangles and rules with and without overprint, Latin and Devanagari text (with and
                           without ActualText), white text, horizontal scale, a composed paragraph, an image, two pages,
                           both PDF/X flavours, and titles that need escaping or UTF-16
  pdf/micro.jsonl.gz       each file taken apart by its xref table: every object's dictionary text, every stream
                           decoded (as text when it is ASCII, else its SHA-256 and length), the embedded fonts' used
                           glyphs, widths and ToUnicode map, and build_pdf()'s statistics
The TypeScript writer must reproduce the dictionaries and the decoded content streams byte for byte; font programs
are compared by outline and advance, as they are fontTools subsets.
"""
from __future__ import annotations

import hashlib
import os
import random
import re
import sys
import zlib
from dataclasses import replace

from golden import EXPERIMENTS, GOLDENS, REPO, SEED, Out, cli, ensure_public, environment, fhex

sys.path.insert(0, str(EXPERIMENTS / "pdfx1"))
import make_press_test as MP  # noqa: E402  (its imports install the compose2 font registry)

C, K3, R3, X = MP.C, MP.K3, MP.R3, MP.X
EPOCH = 1791991449                         # the press golden's SOURCE_DATE_EPOCH (gen_press.py)
DEVA = "क्षत्रिय पत्रकार ज्ञानेश्वर श्री द्ध ह्न ॐ । ॥ ०१२"


def latin1(b: bytes) -> str:
    return b.decode("latin-1")


def vectors(rng: random.Random):
    nums = [0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 1e-5, -1e-5, 4e-5, -4e-5, 5e-5, 0.00015, 123.456789, 1e6, 12345.67895,
            2.5e-4, 1 / 3, 2 / 3, 983.6220472440945, 1530.708661417323, 36.5 * X.MM, 4.19 * X.MM, 1e15 + 0.5]
    nums += [rng.uniform(-2000, 2000) for _ in range(800)] + [rng.uniform(-1, 1) / 1000 for _ in range(200)]
    for x in nums:
        yield {"kind": "num", "input": {"x_hex": fhex(x)}, "expected": X.num(x)}
    for i in [0, 1, -1, 7, 1000, -123456, 2 ** 40]:
        yield {"kind": "num", "input": {"int": str(i)}, "expected": X.num(i)}
    for bad in (float("inf"), float("nan")):
        try:
            X.num(bad)
            raise SystemExit("num() accepted a non-finite number")
        except ValueError:
            yield {"kind": "num", "input": {"x_hex": fhex(bad)}, "expected": None, "error": "ValueError"}
    for name in ["F1", "GSop", "Type0", "Identity-H", "A B", "a#b", "x/y", "(x)", "<<", "%", "~", "!", "\x7f", "\x01",
                 "NotoSansDevanagari-Bold", "ABCDEF+NotoSerifDevanagari-Condensed875"]:
        yield {"kind": "name", "input": name, "expected": latin1(X._name(name))}  # noqa: SLF001
    for s in ["Pageinator", "a(b)c", "back\\slash", "", "tab\there", "पेजिनेटर", "é",
              "Pageinator press test 7354475e64 (TEST - not for publication)", "D:20261014152409+00'00'", "😀"]:
        yield {"kind": "text_string", "input": s, "expected": latin1(X._text_string(s))}  # noqa: SLF001
    nested = {"Type": X.Name("Page"), "Kids": [X.Ref(3), X.Ref(4)], "Count": 2, "Flag": True, "Off": False,
              "Null": None, "F": 0.5, "Neg": -0.00004, "S": "x(y)", "U": "मराठी", "B": b"\x00\xff",
              "L": [1, 2.25, [X.Name("A"), X.Name("B C")]], "D": {"Inner": X.Name("X")}}
    yield {"kind": "ser", "input": "nested (see gen_pdf.py)", "expected": latin1(X.ser(nested))}
    for epoch in [0, 1, 951782400, 951868799, EPOCH, 2147483647, 4102444799] + [rng.randrange(0, 4102444800)
                                                                                 for _ in range(200)]:
        yield {"kind": "pdf_date", "input": {"epoch": epoch}, "expected": X.pdf_date(epoch)}
    for _ in range(200):
        key = rng.choice(["F1", "F2", "F3", "NotoSansDevanagari-Bold", "NotoSerifDevanagari-Condensed875"])
        gids = sorted(rng.sample(range(0, 3000), rng.randint(0, 40)))
        yield {"kind": "subset_tag", "input": {"key": key, "gids": gids}, "expected": X._subset_tag(key, gids)}  # noqa: SLF001
    texts = ["क", "क्ष", "ff", "fi", "😀", "₹", "॥", " ", "a"]
    for n in (0, 1, 3, 100, 101, 250):
        m = {gid: rng.choice(texts) for gid in rng.sample(range(1, 4000), n)}
        yield {"kind": "tounicode", "input": {"map": [[g, t] for g, t in sorted(m.items())]},
               "expected": latin1(X._tounicode_cmap(m))}  # noqa: SLF001
    for c in [(0, 0, 0, 1), (0.1, 0.2, 0.3, 0.4), (0.15, 0, 0, 0.6), (1 / 3, 2 / 3, 0.123456, 0.99995), (0, 1, 1, 0)]:
        yield {"kind": "cmyk", "input": [fhex(float(v)) for v in c], "expected": X._cmyk(c)}  # noqa: SLF001


def item_dump(it) -> dict:
    """A page item exactly as build_pdf() receives it (coordinates in PDF points, y up)."""
    def hx(v):
        return fhex(float(v))
    if isinstance(it, X.TextRun):
        return {"type": "text", "font": it.font, "size_pt_hex": hx(it.size_pt), "cmyk_hex": [hx(v) for v in it.cmyk],
                "overprint": it.overprint, "hscale_hex": hx(it.hscale),
                "clusters": [[t, [[g.gid, hx(g.x_pt), hx(g.y_pt)] for g in gl]] for t, gl in it.clusters]}
    if isinstance(it, X.Rect):
        return {"type": "rect", "x_pt_hex": hx(it.x_pt), "y_pt_hex": hx(it.y_pt), "w_pt_hex": hx(it.w_pt),
                "h_pt_hex": hx(it.h_pt), "cmyk_hex": [hx(v) for v in it.cmyk], "overprint": it.overprint}
    if isinstance(it, X.Line):
        return {"type": "line", "x1_pt_hex": hx(it.x1), "y1_pt_hex": hx(it.y1), "x2_pt_hex": hx(it.x2),
                "y2_pt_hex": hx(it.y2), "width_pt_hex": hx(it.width_pt), "cmyk_hex": [hx(v) for v in it.cmyk],
                "overprint": it.overprint}
    if isinstance(it, X.Image):
        return {"type": "image", "x_pt_hex": hx(it.x_pt), "y_pt_hex": hx(it.y_pt), "w_pt_hex": hx(it.w_pt),
                "h_pt_hex": hx(it.h_pt), "width_px": it.width_px, "height_px": it.height_px,
                "cmyk_bytes": it.cmyk_bytes.hex(), "cmyk_hex": [hx(v) for v in it.cmyk], "overprint": it.overprint}
    raise TypeError(type(it))


COMPOSED = {"text_id": "mr-body-01", "nbsp_indent": 5, "candidate": "C3_floor0.66_stretch1.00", "k": 1.1475}


def build(case: str, flavour: str = "X-1a:2003", actualtext: bool = True, title: str | None = None):
    """One micro case: (pdf bytes, stats, builder, pages)."""
    B = MP.PageBuilder(actualtext)
    split = None
    if case == "rects":
        B.rect(13.0, 20.0, 50.0, 10.0, (0.1, 0.2, 0.3, 0.4))
        B.rect(70.0, 20.0, 50.0, 10.0, MP.BLACK, overprint=True)
        B.rect(130.0, 20.0, 30.0, 10.0, (0, 0, 0, 0.15))
    elif case == "rules":
        B.hline(13.0, 334.0, 40.0, 0.5)
        B.hline(13.0, 334.0, 42.5, 3.0, (0, 1, 1, 0), overprint=False)
        B.vline(100.0, 50.0, 90.0, 0.25)
        B.vline(120.0, 50.0, 90.0, 0.4, (0, 0, 0, 0.6), overprint=False)
    elif case == "latin":
        B.natural("Pageinator 2026 (press test) - €", "F3", 10.0, 13.0, 30.0)
    elif case in ("deva", "x1a_2001", "no_actualtext"):
        B.natural(DEVA, "F1", 12.0, 13.0, 40.0)
        B.natural("पेजिनेटर मुद्रण चाचणी", "F2", 24.0, 13.0, 60.0)
    elif case == "white_text":
        B.rect(13.0, 20.0, 120.0, 17.0, MP.BLACK)
        B.natural("उलट मजकूर चाचणी : पांढरी अक्षरे", "F2", 12.0, 17.0, 27.5, cmyk=MP.WHITE, overprint=False)
    elif case == "hscale":
        B.natural("दुसरी ओळ ताणलेली : मथळा", "F2", 22.0, 13.0, 40.0)
        B.items[-1] = replace(B.items[-1], hscale=0.95)
    elif case == "composed":
        text = MP.NBSP * COMPOSED["nbsp_indent"] + next(t["text"] for t in C.load_corpus()
                                                         if t["id"] == COMPOSED["text_id"])
        body_pt = round(MP.HOUSE_BODY_PT * MP.DEFAULT_WIDTH_RATIO, 3)
        p = B.prepare(text, "F1", body_pt)
        kind, prm = R3.candidates()[COMPOSED["candidate"]]
        pol = R3.policy_for(COMPOSED["candidate"] + "_with_breaks", kind, prm, COMPOSED["k"], inword="rules")
        c = K3.compose(p, pol, MP.COL_W)
        y = 60.0
        for ln in c.lines:
            B.composed_line(p, c, ln, MP.MARGIN_L, y, "F1")
            y += MP.HOUSE_LEADING_PT / X.MM
    elif case == "image":
        data = bytes((i * 37 + j) % 256 for i in range(12) for j in range(4))
        B.items.append(X.Image(36.0, 600.0, 72.0, 54.0, 4, 3, data))
    elif case == "two_pages":
        B.natural("Page one", "F3", 10.0, 13.0, 30.0)
        split = len(B.items)
        B.natural(DEVA, "F1", 12.0, 13.0, 40.0)
        B.rect(13.0, 50.0, 40.0, 5.0, (0, 0, 0, 0.5))
    elif case in ("title_escapes", "title_deva", "empty"):
        pass
    else:
        raise SystemExit(f"unknown case {case}")
    items = B.items
    pages = [items] if split is None else [items[:split], items[split:]]
    fl = MP.PDFX[flavour]
    data, stats = X.build_pdf([X.Page(MP.PAGE_W * X.MM, MP.PAGE_H * X.MM, it) for it in pages], B.fonts,
                              title=title or f"Pageinator golden {case}", output_intent=dict(MP.OUTPUT_INTENTS["IFRA26"]),
                              actualtext=actualtext, pdf_version=fl["pdf_version"], pdfx_info=fl["info"])
    return data, stats, B, [[item_dump(it) for it in page] for page in pages]


CASES = [  # (case, flavour, actualtext, title)
    ("empty", "X-1a:2003", True, None),
    ("rects", "X-1a:2003", True, None),
    ("rules", "X-1a:2003", True, None),
    ("latin", "X-1a:2003", True, None),
    ("deva", "X-1a:2003", True, None),
    ("no_actualtext", "X-1a:2003", False, None),
    ("x1a_2001", "X-1a:2001", True, None),
    ("white_text", "X-1a:2003", True, None),
    ("hscale", "X-1a:2003", True, None),
    ("composed", "X-1a:2003", True, None),
    ("image", "X-1a:2003", True, None),
    ("two_pages", "X-1a:2003", True, None),
    ("title_escapes", "X-1a:2003", True, "Pageinator (golden) \\ escapes"),
    ("title_deva", "X-1a:2003", True, "पेजिनेटर चाचणी पान"),
]


def dissect(data: bytes) -> dict:
    sx = data.rindex(b"startxref\n")
    xref_at = int(data[sx + 10:].split(b"\n")[0])
    lines = data[xref_at:].split(b"\n")
    if lines[0] != b"xref":
        raise SystemExit("no xref table where startxref points")
    n = int(lines[1].split()[1])
    offsets = [int(entry[:10]) for entry in lines[3:3 + n - 1]]
    objects = []
    for i, off in enumerate(offsets, 1):
        head = f"{i} 0 obj\n".encode("ascii")
        if data[off:off + len(head)] != head:
            raise SystemExit(f"object {i}: xref offset {off} does not point at its header")
        start = off + len(head)
        nl = data.index(b"\n", start)                      # ser() writes no newline inside a value
        obj = {"num": i, "dict": latin1(data[start:nl])}
        if data[nl:nl + 8] == b"\nstream\n":
            length = int(re.search(rb"/Length (\d+)", data[start:nl]).group(1))
            raw = data[nl + 8:nl + 8 + length]
            if data[nl + 8 + length:nl + 8 + length + 18] != b"\nendstream\nendobj\n":
                raise SystemExit(f"object {i}: stream length does not end at endstream")
            decoded = zlib.decompress(raw) if b"/Filter /FlateDecode" in data[start:nl] else raw
            text = decoded.decode("ascii") if all(32 <= b < 127 or b == 10 for b in decoded) else None
            obj["stream"] = {"raw_length": length, "decoded_length": len(decoded),
                             "decoded_sha256": hashlib.sha256(decoded).hexdigest(), "decoded_text": text}
        elif data[nl:nl + 8] != b"\nendobj\n":
            raise SystemExit(f"object {i}: neither a stream nor endobj after the value")
        objects.append(obj)
    body_end = xref_at
    trailer_at = data.index(b"trailer\n", xref_at)
    return {"header": latin1(data[:data.index(b"\n", 9) + 1]), "objects": objects,
            "trailer": latin1(data[trailer_at + 8:sx - 1]), "startxref": xref_at,
            "id_is_md5_of_body": hashlib.md5(data[:body_end]).hexdigest().upper() in latin1(data[trailer_at:sx])}


def main(root=REPO) -> dict:
    ensure_public()
    os.environ["SOURCE_DATE_EPOCH"] = str(EPOCH)
    out = Out(root)
    rng = random.Random(SEED)
    vecs = list(vectors(rng))
    out.jsonl_gz(GOLDENS / "pdf" / "vectors.jsonl.gz", vecs)
    micro = []
    for case, flavour, actualtext, title in CASES:
        data, stats, B, pages = build(case, flavour, actualtext, title)
        rel = GOLDENS / "pdf" / "micro" / f"{case}.pdf"
        out.bytes(rel, data)
        fonts = {k: {"font_name": f.font_name, "face_sha256": hashlib.sha256(f.face_bytes).hexdigest(),
                     "used": sorted(f.used), "widths": {str(g): w for g, w in sorted(f.widths.items())},
                     "tounicode": {str(g): t for g, t in sorted(f.tounicode.items())},
                     "subset_sha256": hashlib.sha256(f.subset_bytes).hexdigest()} for k, f in sorted(B.fonts.items())}
        micro.append({"schema": "pageinator.golden.pdf-micro/1", "case": case, "file": rel.as_posix(),
                      "input": {"flavour": flavour, "actualtext": actualtext, "title": title,
                                "source_date_epoch": EPOCH, "page_mm": [MP.PAGE_W, MP.PAGE_H],
                                "fonts": {k: list(MP.FONTS[k]) for k in sorted(B.fonts)},
                                "composed": COMPOSED if case == "composed" else None, "pages": pages},
                      "expected": {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                                   "stats": {k: v for k, v in stats.items() if k != "zlib"},
                                   "fonts": fonts, "dissected": dissect(data)}})
    out.jsonl_gz(GOLDENS / "pdf" / "micro.jsonl.gz", micro)
    kinds = {}
    for v in vecs:
        kinds[v["kind"]] = kinds.get(v["kind"], 0) + 1
    counts = {"vectors": len(vecs), "by_kind": dict(sorted(kinds.items())), "micro_files": len(micro),
              "objects": sum(len(m["expected"]["dissected"]["objects"]) for m in micro)}
    out.json(GOLDENS / "pdf" / "info.json", {"schema": "pageinator.golden.pdf-info/1", "writer": X.WRITER_VERSION,
                                             "zlib": zlib.ZLIB_RUNTIME_VERSION, "counts": counts,
                                             "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
