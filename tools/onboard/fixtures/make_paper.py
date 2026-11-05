"""Fictional past editions for "Onboard a new paper" (L4): press PDFs that read like InDesign / Adobe PDF Library exports.

Everything here is made up: the papers, people, places and stories (sentences assembled from fixed word lists by a
seeded random generator), the photos and ads (generated patterns). Deterministic: the same arguments give the same
bytes. What the Phase-0 chain reads is made the way the pilot's press PDFs make it:
  - text in embedded, subset TrueType fonts (Type0 / CIDFontType2, Identity-H, ToUnicode; subset tag "ABCDEF+");
  - shaping by HarfBuzz; each glyph placed with TJ so its origin is HarfBuzz's; Devanagari words wrapped in
    /Span <</ActualText …>> BDC … EMC, as InDesign + Adobe PDF Library write them (glyphs in visual order);
  - a space glyph after each word (the PDF's own width table then gives the nominal space), justified body columns
    with indented paragraphs, headlines in a bold face, bylines, captions under photos, rules between stories;
  - a front page with a tall masthead and no ads; a running head (bar, paper name, section, date, folio) on the other
    pages; a recurring imprint line at the foot of page 2; ads at the foot of the back page (images that recur in
    >= 3 editions); producer "Adobe PDF Library", creator "Adobe InDesign".
Two papers, both with a grid and page size unlike the pilot's:
  en  "The Riverside Chronicle", English, 315 x 470 mm, 6 columns of 45.0 mm, gutter 4.2 mm
  mr  "सह्याद्री वार्ता", Marathi, 280 x 400 mm, 5 columns of 48.4 mm, gutter 4.0 mm

Usage: <pdfx1 python> tools/onboard/fixtures/make_paper.py --paper en|mr --out DIR
  writes DIR/*.pdf, DIR/files.json (the onboard CLI's input), DIR/masthead.png and DIR/READY.json.
`tiny_pdf(path, variant)` makes the one-page files the intake tests need (good, scanned, fonts_missing, type3,
no_unicode, big_page), generated at test time so no binary is committed.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
import zlib
from datetime import date
from pathlib import Path

import pikepdf
import uharfbuzz as hb
from fontTools import subset as ftsubset
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parents[3]
DEVA_FONTS = REPO / "tools" / "oracle" / "v0" / "assets" / "fonts" / "devanagari"      # read only (OFL)
C2_FONTS = REPO / "experiments" / "phase0" / "compose2" / "fonts"                        # read only (OFL)
FONT_FILES = {"Mukta-Bold": DEVA_FONTS / "Mukta-Bold.ttf", "Mukta-SemiBold": DEVA_FONTS / "Mukta-SemiBold.ttf",
              "Mukta-Light": DEVA_FONTS / "Mukta-Light.ttf", "Mukta-Regular": DEVA_FONTS / "Mukta-Regular.ttf",
              "Martel-Regular": C2_FONTS / "martel" / "Martel-Regular.ttf", "Hind-Regular": C2_FONTS / "hind" / "Hind-Regular.ttf"}
PT = 72 / 25.4                                   # points per mm
CREATOR = "Adobe InDesign 18.5 (Macintosh)"
PRODUCER = "Adobe PDF Library 17.0"


def is_deva(t: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in t)


# ------------------------------------------------------------------------------------------------ fonts
class Font:
    """One OFL font: HarfBuzz shaping (cached per word) and the glyphs a PDF used, for its subset and ToUnicode."""

    def __init__(self, name: str):
        self.name, self.path = name, FONT_FILES[name]
        data = self.path.read_bytes()
        self.data = data
        self.hb = hb.Font(hb.Face(hb.Blob(data)))
        tt = TTFont(io.BytesIO(data))
        self.upem = tt["head"].unitsPerEm
        self.hmtx = {tt.getGlyphID(g): adv for g, (adv, _) in tt["hmtx"].metrics.items()}
        self.rev = {}
        for cp, g in sorted(tt.getBestCmap().items()):
            self.rev.setdefault(tt.getGlyphID(g), chr(cp))
        self.space = tt.getGlyphID(tt.getBestCmap()[0x20])
        self.asc, self.desc = tt["hhea"].ascent, tt["hhea"].descent
        self.cache: dict = {}

    def shape(self, word: str) -> list:
        """[(gid, hb advance, x offset, cluster text)] in visual order, font units."""
        if word not in self.cache:
            buf = hb.Buffer()
            buf.add_str(word)
            buf.guess_segment_properties()
            hb.shape(self.hb, buf, {"kern": True, "liga": False, "clig": False})
            infos, poss = buf.glyph_infos, buf.glyph_positions
            starts = sorted({i.cluster for i in infos})
            nxt = {s: (starts[k + 1] if k + 1 < len(starts) else len(word)) for k, s in enumerate(starts)}
            self.cache[word] = [(i.codepoint, p.x_advance, p.x_offset, word[i.cluster:nxt[i.cluster]]) for i, p in zip(infos, poss)]
        return self.cache[word]

    def width(self, word: str, size: float) -> float:
        """mm"""
        return sum(a for _, a, _, _ in self.shape(word)) / self.upem * size / PT

    def space_w(self, size: float) -> float:
        return self.hmtx[self.space] / self.upem * size / PT


class PdfFonts:
    """The fonts one PDF uses and the glyphs (gid -> Unicode text for ToUnicode) each one drew."""

    def __init__(self):
        self.fonts: dict = {}         # name -> (Font, resource name, {gid: text})

    def use(self, f: Font) -> tuple:
        if f.name not in self.fonts:
            self.fonts[f.name] = (f, f"T1_{len(self.fonts)}", {})
        return self.fonts[f.name]

    def objects(self, pdf: pikepdf.Pdf, variant: str) -> dict:
        res = {}
        for f, rname, used in self.fonts.values():
            used.setdefault(f.space, " ")
            gids = sorted(used)
            tag = "".join(chr(65 + b % 26) for b in hashlib.sha256((f.name + repr(gids)).encode()).digest()[:6])
            opts = ftsubset.Options()
            opts.retain_gids, opts.notdef_outline, opts.name_IDs, opts.layout_features = True, True, ["*"], []
            opts.drop_tables += ["GSUB", "GPOS", "GDEF"]
            tt = TTFont(io.BytesIO(f.data), recalcTimestamp=False)
            sub = ftsubset.Subsetter(opts)
            sub.populate(gids=gids)
            sub.subset(tt)
            out = io.BytesIO()
            tt.save(out)
            prog = out.getvalue()
            base = f"{tag}+{f.name}"
            sc = 1000 / f.upem
            desc = pikepdf.Dictionary(Type=pikepdf.Name.FontDescriptor, FontName=pikepdf.Name("/" + base), Flags=4,
                                      FontBBox=[-500, round(f.desc * sc), 1500, round(f.asc * sc)], ItalicAngle=0,
                                      Ascent=round(f.asc * sc), Descent=round(f.desc * sc), CapHeight=700, StemV=80)
            if variant != "fonts_missing":
                desc.FontFile2 = pdfikestream(pdf, prog, Length1=len(prog))
            w = []
            for g in gids:
                w += [g, [round(f.hmtx.get(g, 0) * sc, 3)]]
            cid = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.CIDFontType2, BaseFont=pikepdf.Name("/" + base),
                                     CIDSystemInfo=pikepdf.Dictionary(Registry=pikepdf.String("Adobe"), Ordering=pikepdf.String("Identity"), Supplement=0),
                                     FontDescriptor=pdf.make_indirect(desc), W=w, DW=1000, CIDToGIDMap=pikepdf.Name.Identity)
            t0 = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type0, BaseFont=pikepdf.Name("/" + base),
                                    Encoding=pikepdf.Name("/Identity-H"), DescendantFonts=[pdf.make_indirect(cid)])
            if variant != "no_unicode":
                t0.ToUnicode = pdfikestream(pdf, tounicode(used))
            res[rname] = pdf.make_indirect(t0)
        return res


def pdfikestream(pdf, data: bytes, **kw):
    return pdf.make_indirect(pikepdf.Stream(pdf, zlib.compress(data, 9), Filter=pikepdf.Name.FlateDecode, **kw))


def tounicode(used: dict) -> bytes:
    rows = [f"<{g:04X}> <{t.encode('utf-16-be').hex().upper()}>" for g, t in sorted(used.items())]
    body = []
    for k in range(0, len(rows), 100):
        chunk = rows[k:k + 100]
        body += [f"{len(chunk)} beginbfchar", *chunk, "endbfchar"]
    return ("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) "
            "/Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\n"
            "endcodespacerange\n" + "\n".join(body) + "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n").encode()


# ------------------------------------------------------------------------------------------------ images
def make_image(seed: str, w: int, h: int, ad: bool = False) -> bytes:
    """Raw 8-bit RGB: a gradient with a few shapes (a 'photo'), or colour bands with blocks (an 'ad')."""
    r = random.Random(seed)
    c0 = [r.randrange(40, 220) for _ in range(3)]
    c1 = [r.randrange(40, 220) for _ in range(3)]
    shapes = [(r.randrange(w), r.randrange(h), r.randrange(w // 8, w // 3), [r.randrange(256) for _ in range(3)]) for _ in range(5)]
    px = bytearray()
    for y in range(h):
        t = y / max(1, h - 1)
        base = [round(a + (b - a) * t) for a, b in zip(c0, c1)]
        if ad:
            base = c0 if (y * 5 // h) % 2 == 0 else c1
        for x in range(w):
            col = base
            for sx, sy, rad, sc in shapes:
                if (abs(x - sx) <= rad and abs(y - sy) <= rad // 2) if ad else ((x - sx) ** 2 + (y - sy) ** 2 <= rad * rad):
                    col = sc
                    break
            px += bytes(col)
    return bytes(px)


# ------------------------------------------------------------------------------------------------ a page
class Page:
    """Content-stream operators of one page, in reading order, positions in mm from the top-left corner."""

    def __init__(self, w_mm: float, h_mm: float, fonts: PdfFonts, variant: str = ""):
        self.w, self.h, self.fonts, self.variant = w_mm, h_mm, fonts, variant
        self.ops: list[str] = []
        self.images: dict = {}           # resource name -> (key, raw, w, h)

    def y(self, top_mm: float) -> float:
        return (self.h - top_mm) * PT

    def words(self, f: Font, size: float, items: list, colour: str = "0 0 0 1 k") -> None:
        """items: [(x_mm, baseline_mm, word, space_after)] drawn in one BT block."""
        f_, rname, used = self.fonts.use(f)
        ops = ["BT", colour, f"/{rname} {size:g} Tf"]
        sc = 1000 / f.upem
        for x, bl, word, space in items:
            glyphs = f.shape(word)
            tj, cur, pen = [], 0.0, 0.0           # font units from the word's origin: the text point, HarfBuzz's pen
            for gid, adv, xoff, ctext in glyphs:
                if pen + xoff != cur:
                    tj.append(f"{-(pen + xoff - cur) * sc:.2f}")
                tj.append(f"<{gid:04X}>")
                cur, pen = pen + xoff + f.hmtx.get(gid, 0), pen + adv
                alone = sum(1 for g in glyphs if g[3] == ctext) == 1
                # as InDesign: a glyph alone in its cluster maps to the cluster, else to its own character if it has one
                used.setdefault(gid, "?" if self.variant == "no_unicode" else ctext if alone or gid not in f.rev else f.rev[gid])
            pos = f"1 0 0 1 {x * PT:.3f} {self.y(bl):.3f} Tm"
            body = f"{pos} [{' '.join(tj)}] TJ"
            if is_deva(word) and self.variant != "no_unicode":
                body = f"/Span <</ActualText <FEFF{word.encode('utf-16-be').hex().upper()}>>> BDC {body} EMC"
            if space:
                gap = f"{-(pen - cur) * sc:.2f} " if pen != cur else ""
                body += f" [{gap}<{f.space:04X}>] TJ"
            ops.append(body)
        ops.append("ET")
        self.ops.append("\n".join(ops))

    def line(self, f: Font, size: float, x: float, bl: float, text: str, align: str = "left", width: float = 0.0,
             justify: bool = False, colour: str = "0 0 0 1 k") -> None:
        ws = text.split()
        nat = [f.width(w, size) for w in ws]
        sp = f.space_w(size)
        total = sum(nat) + sp * (len(ws) - 1)
        gap = sp + ((width - total) / (len(ws) - 1) if justify and len(ws) > 1 else 0.0)
        x0 = x + (width - total) / 2 if align == "center" else x + width - total if align == "right" else x
        items, cx = [], x0
        for k, (w, n) in enumerate(zip(ws, nat)):
            items.append((cx, bl, w, k < len(ws) - 1))
            cx += n + gap
        self.words(f, size, items, colour)

    def rule(self, x0, y0, x1, y1, width_pt=0.5) -> None:
        self.ops.append(f"0 0 0 1 K {width_pt} w {x0 * PT:.3f} {self.y(y0):.3f} m {x1 * PT:.3f} {self.y(y1):.3f} l S")

    def box(self, x0, y0, x1, y1, colour: str) -> None:
        self.ops.append(f"{colour} {x0 * PT:.3f} {self.y(y1):.3f} {(x1 - x0) * PT:.3f} {(y1 - y0) * PT:.3f} re f")

    def image(self, key: str, raw: bytes, pw: int, ph: int, x0, y0, x1, y1) -> None:
        name = f"Im{hashlib.sha256(key.encode()).hexdigest()[:8]}"
        self.images[name] = (raw, pw, ph)
        self.ops.append(f"q {(x1 - x0) * PT:.3f} 0 0 {(y1 - y0) * PT:.3f} {x0 * PT:.3f} {self.y(y1):.3f} cm /{name} Do Q")


def wrap(f: Font, size: float, words: list, width: float, indent: float = 0.0) -> list:
    """Greedy lines: [[words]], the first narrower by the indent."""
    lines, cur, w = [], [], 0.0
    sp = f.space_w(size)
    for word in words:
        ww = f.width(word, size)
        lim = width - (indent if not lines else 0.0)
        if cur and w + sp + ww > lim:
            lines.append(cur)
            cur, w = [], 0.0
        w = ww if not cur else w + sp + ww
        cur.append(word)
    if cur:
        lines.append(cur)
    return lines


def write_pdf(path: Path, pages: list, fonts: PdfFonts, info: dict, variant: str = "") -> None:
    pdf = pikepdf.new()
    pdf.Root.Type = pikepdf.Name.Catalog
    fres = fonts.objects(pdf, variant) if fonts.fonts else {}
    imgs = {}
    for pg in pages:
        xo = {}
        for name, (raw, pw, ph) in pg.images.items():
            if name not in imgs:
                imgs[name] = pdf.make_indirect(pikepdf.Stream(pdf, zlib.compress(raw, 9), Type=pikepdf.Name.XObject,
                                                              Subtype=pikepdf.Name.Image, Width=pw, Height=ph,
                                                              ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8,
                                                              Filter=pikepdf.Name.FlateDecode))
            xo[name] = imgs[name]
        box = [0, 0, round(pg.w * PT, 3), round(pg.h * PT, 3)]
        res = pikepdf.Dictionary(ProcSet=[pikepdf.Name.PDF, pikepdf.Name.Text, pikepdf.Name.ImageC])
        if fres:
            res.Font = pikepdf.Dictionary({"/" + k: v for k, v in fres.items()})
        if xo:
            res.XObject = pikepdf.Dictionary({"/" + k: v for k, v in xo.items()})
        page = pikepdf.Dictionary(Type=pikepdf.Name.Page, MediaBox=box, TrimBox=box, BleedBox=box, Resources=res,
                                  Contents=pdfikestream(pdf, "\n".join(pg.ops).encode("latin-1")))
        pdf.pages.append(pikepdf.Page(page))
    pdf.docinfo = pdf.make_indirect(pikepdf.Dictionary({"/" + k: pikepdf.String(v) for k, v in info.items()}))
    pdf.save(path, deterministic_id=True, compress_streams=True)


# ------------------------------------------------------------------------------------------------ the two papers
EN_SUBJ = ["The city council", "Local farmers", "The water board", "Residents of the east ward", "The district school board",
           "Traders at the old market", "The river authority", "Volunteers from the youth club", "The transport office",
           "Staff at the general hospital", "The library trust", "The harbour committee", "Parents at the north school",
           "The cricket association", "Officials at the power station", "The housing society"]
EN_VERB = ["approved", "discussed", "announced", "reviewed", "welcomed", "questioned", "postponed", "completed", "opposed", "funded"]
EN_OBJ = ["a new plan for the old bridge", "the budget for road repairs", "longer opening hours for the library",
          "a cleaner route for the river walk", "the new bus timetable", "a study of the flood banks", "the summer water supply",
          "two new classrooms", "a market for local growers", "safer crossings near the school", "a festival in the park",
          "repairs to the clock tower", "a plan to plant trees along the canal", "fresh rules for night parking"]
EN_TAIL = ["on Monday", "after a long meeting", "this week", "despite the rain", "according to officials", "ahead of the monsoon",
           "before the end of the month", "at the town hall", "with support from residents", "for the third time this year"]
EN_FILL = ["Work is expected to begin soon and should take about six weeks.", "Several speakers asked for more time to study the details.",
           "The cost will be shared by the state and the town.", "A public notice will be published in the coming days.",
           "Members said the decision was overdue and welcome.", "Shop owners hope the change will bring more visitors.",
           "The next meeting will look at the remaining questions.", "Residents can send their comments to the ward office."]
EN_FIRST = ["Asha", "Tom", "Nina", "Rafael", "Meera", "Owen", "Leela", "Sam", "Irene", "Kabir", "Joan", "Dev"]
EN_LAST = ["Verma", "Ellery", "Brooks", "Dias", "Kapoor", "Hale", "Moss", "Pinto", "Grant", "Rao", "Shaw", "Fernandes"]
EN_PLACES = ["Riverside", "Millbank", "East Ward", "Old Quay", "Northfield", "Canal Street", "Hilltop", "Station Road"]
MR_FIRST = ["अनिल", "सुनीता", "राहुल", "मीरा", "संजय", "प्रिया", "विजय", "कविता", "अमोल", "स्नेहा"]
MR_LAST = ["पाटील", "देशमुख", "कुलकर्णी", "जाधव", "शिंदे", "पवार", "गोखले", "भोसले", "कदम", "मोरे"]
MR_PLACES = ["सातारा", "कऱ्हाड", "वाई", "महाबळेश्वर", "फलटण", "कोरेगाव", "पाटण", "माण"]
EN_SECTIONS = ["City", "Region", "Business", "Sport", "World", "Opinion"]
EN_NAMES = ["Staff Reporter", "Asha Verma", "Tom Ellery", "Nina Brooks", "Our Correspondent", "Rafael Dias"]

MR_SUBJ = ["नगर परिषदेने", "स्थानिक शेतकऱ्यांनी", "जिल्हा प्रशासनाने", "पाणीपुरवठा विभागाने", "शाळा समितीने", "व्यापारी संघटनेने",
           "आरोग्य विभागाने", "युवक मंडळाने", "परिवहन कार्यालयाने", "ग्रंथालय मंडळाने", "क्रीडा संघटनेने", "गृहनिर्माण संस्थेने"]
MR_OBJ = ["नवीन पुलाच्या कामाचा आराखडा", "रस्ते दुरुस्तीचा निधी", "ग्रंथालयाची वेळ वाढवण्याचा प्रस्ताव", "धरणातील पाणीसाठ्याचा आढावा",
          "बाजारातील स्वच्छता मोहीम", "बसस्थानकातील नवी सुविधा", "नदीकाठी झाडे लावण्याची योजना", "शाळेसाठी दोन नवीन वर्ग",
          "उद्यानातील उत्सवाचा कार्यक्रम", "रात्रीच्या वाहनतळाचे नवे नियम", "शेतकऱ्यांसाठी नवीन बाजार", "घड्याळ मनोऱ्याची दुरुस्ती"]
MR_VERB = ["मंजूर केला", "जाहीर केला", "सादर केला", "स्वीकारला", "पुढे ढकलला", "पूर्ण केला"]
MR_TAIL = ["सोमवारी", "या आठवड्यात", "बैठकीनंतर", "पावसाळ्यापूर्वी", "अधिकाऱ्यांच्या उपस्थितीत", "नागरिकांच्या मागणीनंतर",
           "महिनाअखेरीस", "पुन्हा एकदा"]
MR_FILL = ["हे काम लवकरच सुरू होणार असून सुमारे सहा आठवडे चालेल.", "अनेक सदस्यांनी तपशील अभ्यासण्यासाठी अधिक वेळ मागितला.",
           "या कामाचा खर्च राज्य आणि नगर परिषद मिळून करणार आहेत.", "याबाबतची सूचना येत्या काही दिवसांत प्रसिद्ध केली जाईल.",
           "दुकानदारांना या बदलामुळे ग्राहक वाढतील अशी अपेक्षा आहे.", "पुढील बैठकीत उरलेल्या प्रश्नांवर चर्चा होईल.",
           "नागरिक आपल्या सूचना प्रभाग कार्यालयात देऊ शकतात.", "हवामान अनुकूल राहिल्यास काम वेळेत पूर्ण होईल."]
MR_SECTIONS = ["शहर", "जिल्हा", "अर्थ", "क्रीडा", "देश-विदेश", "संपादकीय"]
MR_NAMES = ["प्रतिनिधी", "विशेष प्रतिनिधी", "वार्ताहर", "आमचे प्रतिनिधी"]
MR_DAYS = ["सोमवार", "मंगळवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार"]
MR_MONTHS = ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"]
EN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

PAPERS = {
    "en": {"name": "The Riverside Chronicle", "short": "THE RIVERSIDE CHRONICLE", "w": 315.0, "h": 470.0, "m": 12.0, "ncol": 6,
           "col": 45.0, "gut": 4.2, "body": ("Martel-Regular", 9.5, 11.5), "masthead_h": 45.0, "masthead_pt": 64,
           "masthead_colour": "1 0.55 0 0.15 k", "ad_h": 150.0,
           "imprint": "Printed and published by Martin Hale for Riverside Chronicle Ltd at Lantern Press, 14 Mill Road, Riverside. "
                      "Editor: Clara Moss.",
           "editions": [("2026-03-02", 4, "RC 2026-03-02.pdf"), ("2026-03-03", 8, "rc_20260303.pdf"),
                        ("2026-03-04", 4, "Riverside Chronicle 2026-03-04.pdf"), ("2026-03-05", 4, "Chronicle final.pdf"),
                        ("2026-03-06", 8, "RC 2026-03-06.pdf"), ("2026-03-09", 4, "RC 20260309.pdf")]},
    "mr": {"name": "सह्याद्री वार्ता", "short": "सह्याद्री वार्ता", "w": 280.0, "h": 400.0, "m": 11.0, "ncol": 5,
           "col": 48.4, "gut": 4.0, "body": ("Hind-Regular", 10.0, 12.6), "masthead_h": 40.0, "masthead_pt": 60,
           "masthead_colour": "0 0.85 0.9 0.1 k", "ad_h": 125.0,
           "imprint": "सह्याद्री वार्ता प्रकाशन लि. साठी मुद्रक व प्रकाशक अ. ब. पाटील यांनी कल्पित मुद्रणालय, सातारा येथे छापून प्रसिद्ध केले. "
                      "संपादक: क. ग. देशमुख.",
           "editions": [("2026-01-12", 4, "सह्याद्री वार्ता 2026-01-12.pdf"), ("2026-01-13", 8, "SV_20260113.pdf"),
                        ("2026-01-14", 4, "SV 2026-01-14.pdf"), ("2026-01-15", 4, "vaarta final.pdf"),
                        ("2026-01-16", 8, "SV 2026-01-16.pdf"), ("2026-01-19", 4, "SV 20260119.pdf")]},
}
HEAD_PT = {1: 16, 2: 22, 3: 28, 4: 34, 5: 38, 6: 42}


class Paper:
    def __init__(self, key: str, fonts: dict):
        self.key, self.p = key, PAPERS[key]
        self.F = fonts
        p = self.p
        self.body = fonts[p["body"][0]]
        self.size, self.lead = p["body"][1], p["body"][2]

    def colx(self, c: int) -> float:
        return self.p["m"] + c * (self.p["col"] + self.p["gut"])

    def span(self, s: int) -> float:
        return s * self.p["col"] + (s - 1) * self.p["gut"]

    def datestr(self, d: date) -> str:
        if self.key == "en":
            return f"{EN_DAYS[d.weekday()]}, {d.day} {EN_MONTHS[d.month - 1]} {d.year}"
        return f"{MR_DAYS[d.weekday()]}, {d.day} {MR_MONTHS[d.month - 1]} {d.year}"

    # ---------------------------------------------------------------- text
    def sentence(self, r: random.Random) -> str:
        if self.key == "en":
            if r.random() < 0.35:
                return r.choice(EN_FILL)
            return f"{r.choice(EN_SUBJ)} {r.choice(EN_VERB)} {r.choice(EN_OBJ)} {r.choice(EN_TAIL)}."
        if r.random() < 0.35:
            return r.choice(MR_FILL)
        return f"{r.choice(MR_SUBJ)} {r.choice(MR_TAIL)} {r.choice(MR_OBJ)} {r.choice(MR_VERB)}."

    def headline(self, r: random.Random) -> str:
        if self.key == "en":
            h = f"{r.choice(EN_SUBJ)} {r.choice(EN_VERB)} {r.choice(EN_OBJ)}"
            return h[0].upper() + h[1:]
        if r.random() < 0.08:                             # now and then an English headline (a brand, an event), as Marathi papers print
            return f"{r.choice(EN_SUBJ)} {r.choice(EN_VERB)} {r.choice(EN_OBJ)}"
        return f"{r.choice(MR_OBJ)} {r.choice(MR_VERB)}"

    # ---------------------------------------------------------------- a story in a module
    def story(self, pg: Page, r: random.Random, c0: int, s: int, top: float, bottom: float, seed: str) -> None:
        F, x0, w = self.F, self.colx(c0), self.span(s)
        hsz = HEAD_PT[s]
        head = self.headline(r)
        lines = wrap(F["Mukta-Bold"], hsz, head.split(), w)
        while len(lines) > 3 and hsz > 14:
            hsz -= 2
            lines = wrap(F["Mukta-Bold"], hsz, head.split(), w)
        y = top + hsz * 0.78 / PT
        align = "center" if r.random() < 0.35 else "left"
        for k, ln in enumerate(lines):
            pg.line(F["Mukta-Bold"], hsz, x0, y + k * hsz * 1.08 / PT, " ".join(ln), align=align, width=w)
        y += (len(lines) - 1) * hsz * 1.08 / PT + 3.0
        if s >= 3 and r.random() < 0.7:                  # a deck under the headline
            dsz = round(hsz * 0.45)
            for k, ln in enumerate(wrap(F["Mukta-Light"], dsz, self.sentence(r).rstrip(".").split(), w)[:2]):
                y += dsz * (1.0 if k == 0 else 1.15) / PT
                pg.line(F["Mukta-Light"], dsz, x0, y, " ".join(ln), width=w)
            y += 3.0
        if r.random() < 0.6:                              # a byline: a dash, a name and a place (seldom the same twice)
            first, last, place = (EN_FIRST, EN_LAST, EN_PLACES) if self.key == "en" else (MR_FIRST, MR_LAST, MR_PLACES)
            pg.line(F["Mukta-SemiBold"], 8.5, x0, y + 2.5, f"— {r.choice(first)} {r.choice(last)}, {r.choice(place)}", width=w)
            y += 5.0
        tops = [y + 1.0] * s
        if bottom - top > 110 and s >= 2 and r.random() < 0.75:
            pc = min(s, 3 if s >= 4 else 2)
            ph = round(self.span(pc) * 0.62, 1)
            pg.image(f"{seed}-photo", make_image(seed, 240, 156), 240, 156, x0, y, x0 + self.span(pc), y + ph)
            cap = f"{self.sentence(r)}"[:120]
            cl = wrap(F["Mukta-Light"], 7.5, cap.split(), self.span(pc))[:2]
            cy = y + ph + 3.0
            for ln in cl:
                pg.line(F["Mukta-Light"], 7.5, x0, cy, " ".join(ln), width=self.span(pc))
                cy += 3.0
            for k in range(pc):
                tops[k] = cy + 2.0
        self.flow(pg, r, [(self.colx(c0 + k), tops[k], bottom) for k in range(s)])

    def flow(self, pg: Page, r: random.Random, cols: list) -> None:
        """Paragraphs into the columns, justified, first lines indented 1 em; stops when the next paragraph does not fit."""
        f, size, lead = self.body, self.size, self.lead / PT
        cw, indent = self.p["col"], size / PT
        slots = []
        for x, t, b in cols:
            yb = t + size * 0.75 / PT
            while yb <= b:
                slots.append((x, yb))
                yb += lead
        k = 0
        while k < len(slots):
            n = r.randint(2, 4)
            while n >= 1:
                words = " ".join(self.sentence(r) for _ in range(n)).split()
                plines = wrap(f, size, words, cw, indent)
                if k + len(plines) <= len(slots) and len(plines) >= 2:
                    break
                n -= 1
            else:
                return
            if k and r.random() < 0.12 and k + len(plines) + 2 <= len(slots) and slots[k][0] == slots[k + 2][0]:
                x, yb = slots[k + 1]                         # a crosshead between paragraphs, a blank line above
                words = (r.choice(EN_OBJ) if self.key == "en" else r.choice(MR_OBJ)).split()[:4]
                pg.line(self.F["Mukta-SemiBold"], size, x, yb, " ".join(words), width=cw)
                k += 2
            for i, ln in enumerate(plines):
                x, yb = slots[k + i]
                last = i == len(plines) - 1
                ind = indent if i == 0 else 0.0
                pg.line(f, size, x + ind, yb, " ".join(ln), width=cw - ind, justify=not last and len(ln) > 1)
            k += len(plines)

    # ---------------------------------------------------------------- pages
    def news(self, pg: Page, r: random.Random, top: float, bottom: float, seed: str) -> None:
        n = self.p["ncol"]
        pats = {6: [[6], [4, 2], [2, 4], [3, 3], [2, 2, 2]], 5: [[5], [3, 2], [2, 3], [2, 3], [3, 2]]}[n]
        rows = 2 if bottom - top < 260 else 3
        cuts = [top] + [round(top + (bottom - top) * (k + 1) / rows + r.uniform(-15, 15), 1) for k in range(rows - 1)] + [bottom]
        for ri in range(rows):
            t, b = cuts[ri], cuts[ri + 1]
            if ri:
                pg.rule(self.colx(0), t - 2.5, self.colx(n - 1) + self.p["col"], t - 2.5)
            pat = pats[0] if (ri == 0 and r.random() < 0.3) else r.choice(pats[1:])
            c = 0
            for k, s in enumerate(pat):
                self.story(pg, r, c, s, t, b - (0 if ri == rows - 1 else 5.0), f"{seed}-r{ri}m{k}")
                c += s

    def running_head(self, pg: Page, d: date, pno: int, section: str) -> None:
        p, F = self.p, self.F
        m, right = p["m"], p["w"] - p["m"]
        pg.box(m, m, right, m + 8.0, "0 0 0 0.15 k")
        bl = m + 5.6
        pg.line(F["Mukta-Bold"], 10, m + 2, bl, p["short"])
        pg.line(F["Mukta-SemiBold"], 9, m, bl, section, align="center", width=right - m)
        ds = self.datestr(d)
        pg.line(F["Mukta-Regular"], 8.5, m, bl, ds, align="right", width=right - m - 12)
        pg.line(F["Mukta-Bold"], 11, m, bl, str(pno), align="right", width=right - m - 2)

    def edition(self, ed_no: int, d: date, n_pages: int) -> tuple:
        p, F = self.p, self.F
        fonts = PdfFonts()
        pages = []
        m, W, H = p["m"], p["w"], p["h"]
        right = W - m
        for pno in range(1, n_pages + 1):
            pg = Page(W, H, fonts)
            r = random.Random(f"{self.key}-{d.isoformat()}-p{pno}")
            seed = f"{self.key}-{d.isoformat()}-p{pno}"
            if pno == 1:
                mh = p["masthead_h"]
                pg.box(m, m, right, m + mh, p["masthead_colour"])
                pg.line(F["Mukta-Bold"], p["masthead_pt"], m, m + mh * 0.68, p["name"], align="center", width=right - m,
                        colour="0 0 0 0 k")
                sb = m + mh + 5.5
                pg.line(F["Mukta-Regular"], 9, m, sb, self.datestr(d))
                vol = f"Vol. 12 No. {40 + ed_no}" if self.key == "en" else f"वर्ष ८ अंक {200 + ed_no}"
                pg.line(F["Mukta-Regular"], 9, m, sb, vol, align="center", width=right - m)
                price = f"{n_pages} pages Rs 6" if self.key == "en" else f"पाने {n_pages} किंमत ५ रुपये"
                pg.line(F["Mukta-Regular"], 9, m, sb, price, align="right", width=right - m)
                pg.rule(m, sb + 2.5, right, sb + 2.5, 1.0)
                self.news(pg, r, sb + 6.0, H - m, seed)
            else:
                secs = EN_SECTIONS if self.key == "en" else MR_SECTIONS
                self.running_head(pg, d, pno, secs[(pno + ed_no) % len(secs)])
                top = m + 12.0
                if pno == n_pages:
                    adt = H - m - p["ad_h"]
                    self.news(pg, r, top, adt - 5.0, seed)
                    for k in range(3):
                        a = (ed_no + k) % 4
                        x0, x1 = self.colx(2 * k if p["ncol"] == 6 else [0, 2, 4][k]), None
                        span = 2 if p["ncol"] == 6 else (2 if k < 2 else 1)
                        x1 = x0 + self.span(span)
                        pg.image(f"{self.key}-ad{a}-{span}", make_image(f"{self.key}-ad{a}-{span}", 90, 140, ad=True), 90, 140,
                                 x0, adt, x1, H - m)
                elif pno == 2:
                    self.news(pg, r, top, H - m - 12.0, seed)
                    pg.rule(m, H - m - 8.0, right, H - m - 8.0)
                    imp = wrap(F["Mukta-Regular"], 6.5, p["imprint"].split(), right - m)
                    for k, ln in enumerate(imp):
                        pg.line(F["Mukta-Regular"], 6.5, m, H - m - 4.5 + k * 2.7, " ".join(ln), align="center", width=right - m)
                else:
                    self.news(pg, r, top, H - m, seed)
            pages.append(pg)
        return pages, fonts


def info_for(d: date, name: str, title: str) -> dict:
    stamp = f"D:{d.strftime('%Y%m%d')}{'013000' if 'final' in name else '000500'}+05'30'"
    return {"Title": title, "Creator": CREATOR, "Producer": PRODUCER, "CreationDate": stamp, "ModDate": stamp, "Trapped": "False"}


def load_fonts() -> dict:
    return {k: Font(k) for k in FONT_FILES}


def make_paper(key: str, out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    paper = Paper(key, load_fonts())
    files = []
    for n, (ds, pages_n, name) in enumerate(PAPERS[key]["editions"], 1):
        d = date.fromisoformat(ds)
        pages, fonts = paper.edition(n, d, pages_n)
        path = out / name
        title = name.rsplit(".", 1)[0] if "final" in name else f"{PAPERS[key]['name']} {ds}"
        write_pdf(path, pages, fonts, info_for(d, name, title))
        files.append({"n": n, "name": name, "path": str(path)})
    (out / "files.json").write_text(json.dumps({"files": files}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    from PIL import Image, ImageDraw  # noqa: PLC0415
    im = Image.new("RGB", (1200, 180), (40, 90, 160) if key == "en" else (200, 40, 30))
    ImageDraw.Draw(im).rectangle((40, 40, 1160, 140), outline=(255, 255, 255), width=8)
    im.save(out / "masthead.png", optimize=False)
    ready = {"paper": key, "name": PAPERS[key]["name"], "editions": len(files),
             "pages": sum(e[1] for e in PAPERS[key]["editions"]), "files": "files.json", "masthead": "masthead.png",
             "sha256": {f["name"]: hashlib.sha256(Path(f["path"]).read_bytes()).hexdigest() for f in files}}
    (out / "READY.json").write_text(json.dumps(ready, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return ready


# ------------------------------------------------------------------------------------------------ intake test files
def tiny_pdf(path: Path, variant: str = "good", key: str = "en", when: str = "2026-03-02") -> Path:
    """One fictional page. variant: good | scanned (one picture, no text) | fonts_missing (fonts not embedded) |
    type3 (a Type 3 font) | no_unicode (no ToUnicode, no ActualText) | big_page (another page size)."""
    paper = Paper(key, {k: Font(k) for k in ("Mukta-Bold", "Mukta-SemiBold", "Mukta-Light", "Mukta-Regular", PAPERS[key]["body"][0])})
    p = paper.p
    w, h = (p["w"] + 40, p["h"] + 40) if variant == "big_page" else (p["w"], p["h"])
    fonts = PdfFonts()
    pg = Page(w, h, fonts, variant)
    if variant == "scanned":
        pg.image("scan", make_image("scan", 60, 90), 60, 90, 0, 0, w, h)
    elif variant == "type3":
        pg.ops.append("BT /T3 12 Tf 1 0 0 1 50 700 Tm (aaa) Tj ET")
    else:
        paper.story(pg, random.Random(variant), 0, 2, 30, 150, f"tiny-{variant}")
    d = date.fromisoformat(when)
    write_pdf(path, [pg], fonts, info_for(d, path.name, "test"), variant)
    if variant == "type3":
        with pikepdf.open(path, allow_overwriting_input=True) as pdf:
            proc = pdf.make_indirect(pikepdf.Stream(pdf, b"1000 0 0 0 750 750 d1 0 0 750 750 re f"))
            t3 = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type3, FontBBox=[0, 0, 750, 750],
                                    FontMatrix=[0.001, 0, 0, 0.001, 0, 0], CharProcs=pikepdf.Dictionary(a=proc),
                                    Encoding=pikepdf.Dictionary(Type=pikepdf.Name.Encoding, Differences=[97, pikepdf.Name.a]),
                                    FirstChar=97, LastChar=97, Widths=[1000], Resources=pikepdf.Dictionary())
            pdf.pages[0].Resources.Font = pikepdf.Dictionary(T3=pdf.make_indirect(t3))
            pdf.save(path, deterministic_id=True)
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--paper", choices=sorted(PAPERS), required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    print(json.dumps(make_paper(a.paper, a.out), ensure_ascii=False))


if __name__ == "__main__":
    main()
