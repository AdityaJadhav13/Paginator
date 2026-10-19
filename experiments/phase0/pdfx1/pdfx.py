"""EXP-PDF-1 minimal PDF/X-1a writer (EXPERIMENTAL / EVIDENCE ONLY) — our own serializer, no PDF library.

Scope (deliberately small, for the press test of gate G2):
  - pages of DeviceCMYK vector graphics (filled rectangles, stroked lines) and text;
  - text in embedded TrueType fonts: Type0 / CIDFontType2, Encoding /Identity-H, CIDToGIDMap /Identity, so CID = the
    glyph ID HarfBuzz produced; the font program is a fontTools subset that RETAINS glyph IDs; /W widths are read from
    the embedded program itself (always consistent); glyphs are placed one by one with absolute text matrices, so the
    positions in the PDF are exactly the composer's;
  - copy/paste text: a ToUnicode CMap for simple glyphs plus /ActualText marked content around clusters whose glyphs
    are reordered or ligated (the same mechanism Adobe InDesign uses for Devanagari);
  - PDF/X-1a Info keys, an OutputIntent, Trim/Bleed boxes, overprint control via ExtGState;
  - deterministic bytes: fixed object order, fixed number formatting, fixed zlib level, ID = MD5 of the body,
    dates from SOURCE_DATE_EPOCH when set.
Not supported (by design): images, transparency, RGB/ICC colour, annotations, encryption, incremental updates.
"""
from __future__ import annotations

import hashlib
import io
import math
import os
import time
import zlib
from dataclasses import dataclass, field

from fontTools import subset as ftsubset
from fontTools.ttLib import TTFont

WRITER_VERSION = "pdfx1/1.0.0"
MM = 72.0 / 25.4


# ------------------------------------------------------------------------------------------- objects
class Name(str):
    """A PDF name (serialised as /Name)."""


@dataclass(frozen=True)
class Ref:
    num: int


@dataclass
class Stream:
    dict: dict
    data: bytes
    compress: bool = True


def num(x) -> str:
    if isinstance(x, bool):
        raise TypeError("bool is not a number")
    if isinstance(x, float) and not math.isfinite(x):
        raise ValueError(f"non-finite number {x!r} cannot be written to a PDF")
    if isinstance(x, int):
        return str(x)
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "", "-") else s


def _name(n: str) -> bytes:
    out = []
    for ch in n.encode("ascii"):
        c = chr(ch)
        out.append(c if (33 <= ch <= 126 and c not in "()<>[]{}/%#") else f"#{ch:02X}")
    return ("/" + "".join(out)).encode("ascii")


def _text_string(s: str) -> bytes:
    """ASCII → literal string; anything else → UTF-16BE hex with BOM (valid PDF text string)."""
    if all(32 <= ord(c) < 127 for c in s):
        return b"(" + s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").encode("ascii") + b")"
    return b"<FEFF" + s.encode("utf-16-be").hex().upper().encode("ascii") + b">"


def ser(o) -> bytes:
    if isinstance(o, Name):
        return _name(o)
    if isinstance(o, Ref):
        return f"{o.num} 0 R".encode("ascii")
    if o is True:
        return b"true"
    if o is False:
        return b"false"
    if o is None:
        return b"null"
    if isinstance(o, (int, float)):
        return num(o).encode("ascii")
    if isinstance(o, str):
        return _text_string(o)
    if isinstance(o, bytes):
        return b"<" + o.hex().upper().encode("ascii") + b">"
    if isinstance(o, (list, tuple)):
        return b"[" + b" ".join(ser(x) for x in o) + b"]"
    if isinstance(o, dict):
        return b"<<" + b"".join(_name(k) + b" " + ser(v) for k, v in o.items()) + b">>"
    raise TypeError(type(o))


class Doc:
    """Objects in a fixed order; serialised once at the end with a classic xref table (no object streams)."""

    def __init__(self, version: str = "1.3"):
        self.version = version
        self.objs: list = []

    def reserve(self) -> Ref:
        self.objs.append(None)
        return Ref(len(self.objs))

    def set(self, ref: Ref, obj) -> Ref:
        self.objs[ref.num - 1] = obj
        return ref

    def add(self, obj) -> Ref:
        return self.set(self.reserve(), obj)

    def _obj_bytes(self, o) -> bytes:
        if isinstance(o, Stream):
            data = zlib.compress(o.data, 9) if o.compress else o.data
            d = dict(o.dict)
            if o.compress:
                d["Filter"] = Name("FlateDecode")
            d["Length"] = len(data)
            return ser(d) + b"\nstream\n" + data + b"\nendstream"
        return ser(o)

    def write(self, root: Ref, info: Ref) -> bytes:
        out = io.BytesIO()
        out.write(f"%PDF-{self.version}\n".encode("ascii") + b"%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, o in enumerate(self.objs, 1):
            if o is None:
                raise ValueError(f"object {i} reserved but never set")
            offsets.append(out.tell())
            out.write(f"{i} 0 obj\n".encode("ascii") + self._obj_bytes(o) + b"\nendobj\n")
        body = out.getvalue()
        fid = hashlib.md5(body).digest()
        xref = out.tell()
        out.write(f"xref\n0 {len(self.objs) + 1}\n".encode("ascii"))
        out.write(b"0000000000 65535 f \n")
        for off in offsets:
            out.write(f"{off:010d} 00000 n \n".encode("ascii"))
        out.write(b"trailer\n" + ser({"Size": len(self.objs) + 1, "Root": root, "Info": info, "ID": [fid, fid]})
                  + f"\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
        return out.getvalue()


def pdf_date(epoch: int | None = None) -> str:
    """PDF date string in UTC; SOURCE_DATE_EPOCH (reproducible builds) wins over the clock."""
    if epoch is None:
        env = os.environ.get("SOURCE_DATE_EPOCH", "").strip()
        epoch = int(env) if env else int(time.time())
    return time.strftime("D:%Y%m%d%H%M%S+00'00'", time.gmtime(epoch))


# ------------------------------------------------------------------------------------------- fonts
def _subset_tag(key: str, gids) -> str:
    h = hashlib.sha256((key + ",".join(map(str, sorted(gids)))).encode()).digest()
    return "".join(chr(65 + b % 26) for b in h[:6])


class EmbeddedFont:
    """One font instance (static TrueType bytes) → Type0/CIDFontType2 with a glyph-ID-retaining subset."""

    def __init__(self, res_name: str, face_bytes: bytes, base_name: str):
        self.res_name, self.face_bytes, self.base_name = res_name, face_bytes, base_name
        self.tt = TTFont(io.BytesIO(face_bytes), lazy=False)
        if "glyf" not in self.tt:
            raise ValueError(f"{base_name}: only TrueType (glyf) outlines are supported for CIDFontType2")
        self.upem = self.tt["head"].unitsPerEm
        self.order = self.tt.getGlyphOrder()
        self.tounicode: dict[int, str] = {}
        self.used: set[int] = set()
        self.nominal = {self.tt.getGlyphID(gn): chr(cp) for cp, gn in sorted(self.tt.getBestCmap().items(), reverse=True)}

    def use(self, gid: int, text: str | None) -> bool:
        """Record a glyph. Returns True when the ToUnicode entry for gid equals `text` (no ActualText needed)."""
        if not 0 <= gid < len(self.order):
            raise ValueError(f"{self.base_name}: glyph id {gid} out of range")
        self.used.add(gid)
        if text is None:
            return True
        if gid not in self.tounicode:
            self.tounicode[gid] = text
        return self.tounicode[gid] == text

    def map_nominal(self, gid: int) -> None:
        """Glyph of a multi-glyph cluster: give it its nominal character (if any) for ActualText-unaware readers."""
        self.used.add(gid)
        if gid in self.nominal:
            self.tounicode.setdefault(gid, self.nominal[gid])

    def display_names(self) -> tuple[str, str]:
        base = self.base_name.split("-")
        return " ".join(base[:-1]) if len(base) > 1 else base[0], base[-1] if len(base) > 1 else "Regular"

    def _check_retained(self, sub_tt: TTFont, gids) -> None:
        """Every used glyph must keep its id, outline and advance in the subset (CID = GID)."""
        so, sg, sh = sub_tt.getGlyphOrder(), sub_tt["glyf"], sub_tt["hmtx"].metrics
        og, oh = self.tt["glyf"], self.tt["hmtx"].metrics
        if len(so) <= max(gids):
            raise RuntimeError(f"{self.base_name}: subset has {len(so)} glyphs; glyph id {max(gids)} lost")
        for g in gids:
            a, b = og[self.order[g]], sg[so[g]]
            ca, cb = a.getCoordinates(og)[0], b.getCoordinates(sg)[0]
            if list(ca) != list(cb) or oh[self.order[g]][0] != sh[so[g]][0]:
                raise RuntimeError(f"{self.base_name}: glyph {g} changed in the subset")

    def build(self, doc: Doc) -> Ref:
        gids = sorted(self.used | {0})
        font = TTFont(io.BytesIO(self.face_bytes), recalcTimestamp=False)
        opts = ftsubset.Options()
        opts.retain_gids = True
        opts.notdef_outline = True
        opts.layout_features = []
        opts.drop_tables += ["GSUB", "GPOS", "GDEF", "STAT", "BASE", "JSTF", "MATH", "DSIG", "kern", "gasp", "MVAR", "HVAR", "VVAR"]
        opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        opts.name_languages = ["*"]
        opts.glyph_names = False
        opts.hinting = True
        opts.recalc_bounds = True
        opts.recalc_timestamp = False
        opts.canonical_order = False
        sub = ftsubset.Subsetter(opts)
        sub.populate(gids=gids)
        sub.subset(font)
        family, style = self.display_names()
        for rec in list(font["name"].names):
            if rec.nameID in (1, 2, 4, 6, 16, 17):
                font["name"].removeNames(nameID=rec.nameID)
        for nid, val in ((1, family), (2, style), (4, f"{family} {style}"), (6, self.base_name)):
            font["name"].setName(val, nid, 3, 1, 0x409)
            font["name"].setName(val, nid, 1, 0, 0)
        buf = io.BytesIO()
        font.save(buf)
        prog = buf.getvalue()
        sub_tt = TTFont(io.BytesIO(prog))
        self._check_retained(sub_tt, gids)
        scale = 1000.0 / self.upem
        hmtx = sub_tt["hmtx"].metrics
        order = sub_tt.getGlyphOrder()
        widths = {g: int(round(hmtx[order[g]][0] * scale)) for g in gids}
        w_arr: list = []
        run: list = []
        start = None
        for g in gids:
            if start is not None and g == start + len(run):
                run.append(widths[g])
            else:
                if start is not None:
                    w_arr += [start, run]
                start, run = g, [widths[g]]
        if start is not None:
            w_arr += [start, run]
        head, hhea, os2 = sub_tt["head"], sub_tt["hhea"], sub_tt["OS/2"]
        cap = getattr(os2, "sCapHeight", 0) or hhea.ascent
        tag = _subset_tag(self.base_name, gids)
        fname = f"{tag}+{self.base_name}"
        ff = doc.add(Stream({"Length1": len(prog)}, prog))
        desc = doc.add({"Type": Name("FontDescriptor"), "FontName": Name(fname), "Flags": 4,
                        "FontBBox": [int(round(head.xMin * scale)), int(round(head.yMin * scale)),
                                     int(round(head.xMax * scale)), int(round(head.yMax * scale))],
                        "ItalicAngle": 0, "Ascent": int(round(hhea.ascent * scale)), "Descent": int(round(hhea.descent * scale)),
                        "CapHeight": int(round(cap * scale)), "StemV": 80, "FontFile2": ff})
        cid = doc.add({"Type": Name("Font"), "Subtype": Name("CIDFontType2"), "BaseFont": Name(fname),
                       "CIDSystemInfo": {"Registry": "Adobe", "Ordering": "Identity", "Supplement": 0},
                       "FontDescriptor": desc, "DW": 1000, "W": w_arr, "CIDToGIDMap": Name("Identity")})
        tu = doc.add(Stream({}, _tounicode_cmap(self.tounicode)))
        self.subset_bytes = prog
        self.font_name = fname
        self.widths = widths
        return doc.add({"Type": Name("Font"), "Subtype": Name("Type0"), "BaseFont": Name(fname), "Encoding": Name("Identity-H"),
                        "DescendantFonts": [cid], "ToUnicode": tu})


def _tounicode_cmap(m: dict[int, str]) -> bytes:
    items = sorted((g, t) for g, t in m.items() if t)
    lines = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
             "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
             "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
             "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"]
    for i in range(0, len(items), 100):
        chunk = items[i:i + 100]
        lines.append(f"{len(chunk)} beginbfchar")
        lines += [f"<{g:04X}> <{t.encode('utf-16-be').hex().upper()}>" for g, t in chunk]
        lines.append("endbfchar")
    lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    return ("\n".join(lines) + "\n").encode("ascii")


# ------------------------------------------------------------------------------------------- page content
@dataclass
class Glyph:
    gid: int
    x_pt: float
    y_pt: float


@dataclass
class TextRun:
    """Glyphs of one line in one font/size/colour. clusters: [(text, [Glyph,...])] in visual order."""
    font: str
    size_pt: float
    cmyk: tuple
    clusters: list
    overprint: bool = False
    hscale: float = 1.0          # horizontal glyph scale (a headline line stretched to its measure); 1 = none


@dataclass
class Rect:
    x_pt: float
    y_pt: float
    w_pt: float
    h_pt: float
    cmyk: tuple
    overprint: bool = False


@dataclass
class Line:
    x1: float
    y1: float
    x2: float
    y2: float
    width_pt: float
    cmyk: tuple
    overprint: bool = False


@dataclass
class Image:
    """An 8-bit DeviceCMYK raster (width × height × 4 bytes, already converted to the output condition) drawn into
    the rectangle (x_pt, y_pt, w_pt, h_pt). Flate-compressed in the file; never overprints."""
    x_pt: float
    y_pt: float
    w_pt: float
    h_pt: float
    width_px: int
    height_px: int
    cmyk_bytes: bytes
    cmyk: tuple = (0, 0, 0, 0)
    overprint: bool = False


@dataclass
class Page:
    width_pt: float
    height_pt: float
    items: list = field(default_factory=list)


def _cmyk(c) -> str:
    return " ".join(num(round(v, 4)) for v in c)


def check_icc(data: bytes) -> None:
    """Minimal ICC header check for a PDF/X-1a output intent: an output-device (prtr) CMYK profile, version 2."""
    if len(data) < 132 or data[36:40] != b"acsp":
        raise ValueError("not an ICC profile (no 'acsp' signature)")
    if data[12:16] != b"prtr" or data[16:20] != b"CMYK":
        raise ValueError(f"ICC profile must be an output (prtr) CMYK profile, got {data[12:16]!r}/{data[16:20]!r}")
    if data[8] != 2:
        raise ValueError(f"PDF/X-1a needs an ICC version 2 profile, got version {data[8]}")


def build_pdf(pages: list[Page], fonts: dict[str, EmbeddedFont], *, title: str, output_intent: dict,
              pdfx_info: dict, pdf_version: str = "1.4", actualtext: bool = True, dest_profile: bytes | None = None,
              creator: str = "Pageinator EXP-PDF-1") -> tuple[bytes, dict]:
    """Serialise pages to PDF/X-1a bytes. Returns (pdf_bytes, stats)."""
    doc = Doc(pdf_version)
    catalog, pages_ref, info = doc.reserve(), doc.reserve(), doc.reserve()
    gs_op = doc.add({"Type": Name("ExtGState"), "OP": True, "op": True, "OPM": 1})
    gs_ko = doc.add({"Type": Name("ExtGState"), "OP": False, "op": False, "OPM": 0})
    stats = {"glyphs": 0, "actualtext_spans": 0, "text_runs": 0, "rects": 0, "lines": 0, "images": 0}
    contents, page_images = [], []
    for pg in pages:
        ops: list[str] = []
        xobjs: dict = {}
        for it in pg.items:
            if it.overprint and tuple(it.cmyk) != (0, 0, 0, 1):
                raise ValueError(f"overprint is only allowed for 100K black, not {it.cmyk} ({type(it).__name__})")
            if isinstance(it, Rect):
                ops.append(f"q /{'GSop' if it.overprint else 'GSko'} gs {_cmyk(it.cmyk)} k {num(round(it.x_pt, 3))} {num(round(it.y_pt, 3))} "
                           f"{num(round(it.w_pt, 3))} {num(round(it.h_pt, 3))} re f Q")
                stats["rects"] += 1
            elif isinstance(it, Line):
                ops.append(f"q /{'GSop' if it.overprint else 'GSko'} gs {_cmyk(it.cmyk)} K {num(round(it.width_pt, 3))} w 0 J "
                           f"{num(round(it.x1, 3))} {num(round(it.y1, 3))} m {num(round(it.x2, 3))} {num(round(it.y2, 3))} l S Q")
                stats["lines"] += 1
            elif isinstance(it, Image):
                if len(it.cmyk_bytes) != it.width_px * it.height_px * 4:
                    raise ValueError("Image: cmyk_bytes must be width × height × 4 bytes (DeviceCMYK, 8 bpc)")
                name = f"Im{len(xobjs) + 1}"
                xobjs[name] = doc.add(Stream({"Type": Name("XObject"), "Subtype": Name("Image"), "Width": it.width_px,
                                              "Height": it.height_px, "ColorSpace": Name("DeviceCMYK"), "BitsPerComponent": 8},
                                             it.cmyk_bytes))                                  # the writer Flate-compresses streams
                ops.append(f"q /GSko gs {num(round(it.w_pt, 3))} 0 0 {num(round(it.h_pt, 3))} {num(round(it.x_pt, 3))} "
                           f"{num(round(it.y_pt, 3))} cm /{name} Do Q")
                stats["images"] += 1
            elif isinstance(it, TextRun):
                f = fonts[it.font]
                body = [f"q /{'GSop' if it.overprint else 'GSko'} gs BT /{f.res_name} {num(round(it.size_pt, 4))} Tf {_cmyk(it.cmyk)} k"]
                hs = "1" if it.hscale == 1.0 else num(round(it.hscale, 4))
                for text, glyphs in it.clusters:
                    simple = len(glyphs) == 1 and f.use(glyphs[0].gid, text)
                    if len(glyphs) != 1:
                        for g in glyphs:
                            f.map_nominal(g.gid)
                    span = actualtext and text is not None and not simple
                    if span:
                        body.append("/Span <</ActualText <FEFF" + text.encode("utf-16-be").hex().upper() + ">>> BDC")
                        stats["actualtext_spans"] += 1
                    for g in glyphs:
                        body.append(f"{hs} 0 0 1 {num(round(g.x_pt, 3))} {num(round(g.y_pt, 3))} Tm <{g.gid:04X}> Tj")
                        stats["glyphs"] += 1
                    if span:
                        body.append("EMC")
                body.append("ET Q")
                ops.append("\n".join(body))
                stats["text_runs"] += 1
            else:
                raise TypeError(type(it))
        contents.append("\n".join(ops).encode("ascii"))
        page_images.append(xobjs)
    font_refs = {name: f.build(doc) for name, f in sorted(fonts.items())}
    kids = []
    for pg, data, xobjs in zip(pages, contents, page_images):
        c = doc.add(Stream({}, data))
        box = [0, 0, num(round(pg.width_pt, 4)), num(round(pg.height_pt, 4))]
        box = [0, 0, float(box[2]), float(box[3])]
        kids.append(doc.add({"Type": Name("Page"), "Parent": pages_ref, "MediaBox": box, "TrimBox": box, "BleedBox": box,
                             "Resources": {"Font": {f.res_name: font_refs[n] for n, f in sorted(fonts.items())},
                                           "ExtGState": {"GSop": gs_op, "GSko": gs_ko},
                                           **({"XObject": xobjs} if xobjs else {}),
                                           "ProcSet": [Name("PDF"), Name("Text")] + ([Name("ImageC")] if xobjs else [])},
                             "Contents": c}))
    doc.set(pages_ref, {"Type": Name("Pages"), "Kids": kids, "Count": len(kids)})
    oi_dict = {"Type": Name("OutputIntent"), "S": Name("GTS_PDFX"), **output_intent}
    if dest_profile is not None:
        check_icc(dest_profile)
        oi_dict["DestOutputProfile"] = doc.add(Stream({"N": 4}, dest_profile))
    oi = doc.add(oi_dict)
    doc.set(catalog, {"Type": Name("Catalog"), "Pages": pages_ref, "OutputIntents": [oi]})
    d = pdf_date()
    doc.set(info, {"Title": title, "Creator": creator, "Producer": f"Pageinator {WRITER_VERSION}", "CreationDate": d, "ModDate": d,
                   "Trapped": Name("False"), **pdfx_info})
    data = doc.write(catalog, info)
    stats.update({"objects": len(doc.objs), "bytes": len(data), "zlib": zlib.ZLIB_RUNTIME_VERSION, "fonts": {n: {"base": f.font_name, "glyphs_used": len(f.used),
                  "subset_bytes": len(f.subset_bytes)} for n, f in fonts.items()}})
    return data, stats
