#!/usr/bin/env python3
"""Independent PDF/X-1a conformance checker.

Written from ISO 15930-1:2001 (PDF/X-1a:2001), ISO 15930-4:2003 (PDF/X-1a:2003) and the
PDF 1.3 / 1.4 references only.  It shares no code with, and never imports, the PDF writer it
is meant to verify (the script's own directory is removed from sys.path before any import).

Usage:  python check_pdfx1a_independent.py FILE.pdf [--json OUT.json]
Output: one line per check -- PASS / FAIL / WARN / INFO + detail -- then a summary.
Exit:   0 = no FAIL, 1 = at least one FAIL, 2 = usage error.

Checks
  A  syntax/structure: header version (1.3 / 1.4), binary comment, qpdf strict open (no
     xref recovery), qpdf syntax check, raw classic-xref/trailer validation (20-byte
     entries, every offset hits its "N G obj", /Size), no xref/object streams (PDF 1.5),
     not encrypted, incremental updates / bytes after %%EOF, unreferenced objects,
     content-stream operator syntax (unknown operators, operand types, BT/ET, q/Q).
  B  Info dictionary: GTS_PDFXVersion (+ GTS_PDFXConformance for :2001), Title,
     CreationDate/ModDate syntax, Trapped True/False, trailer /ID, XMP agreement.
  C  OutputIntents: exactly one GTS_PDFX intent, OutputConditionIdentifier, RegistryName
     when no profile, DestOutputProfile = ICC output ('prtr') CMYK profile, version < 4.
  D  Page boxes: MediaBox (inheritable), TrimBox xor ArtBox (not inheritable), BleedBox
     within MediaBox, TrimBox within BleedBox/MediaBox, sizes in mm.
  E  Colour in all content (pages, forms, patterns, Type3 glyphs, annotation appearances):
     only DeviceCMYK / DeviceGray / Separation|DeviceN with CMYK|Gray alternate; max TAC.
  F  Transparency: ExtGState SMask/CA/ca/BM, transparency groups, image soft masks.
  G  Images: colour space, JPX / JBIG2 / LZW / Crypt filters, 16-bit, OPI, Alternates.
  H  Fonts: all used fonts embedded; TrueType programs parsed with fontTools; CIDs within
     the glyph count, outlines present, /W widths == hmtx; CIDToGIDMap; ToUnicode.
  I  Forbidden content: JavaScript, actions, annotations inside the TrimBox, embedded
     files, optional content, PostScript, transfer functions, halftones.
  J  Overprint: ExtGStates with OP/op/OPM; white objects painted with overprint on.
  K  Marked content: BMC/BDC/EMC balance, no crossing of BT/ET, ActualText count.
  L  Text sanity with pdfminer.six: characters extracted, share of "(cid:N)".
  M  Cross-parser sanity: PDFium (pypdfium2) opens and renders every page.
"""

import os
import sys

# Independence: never let a module that sits next to this script (e.g. the writer under
# test) shadow anything we import.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:] = [p for p in sys.path if os.path.abspath(p or os.curdir) != _HERE]

import argparse  # noqa: E402
import datetime as _dt  # noqa: E402
import hashlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
import re  # noqa: E402
from collections import Counter, OrderedDict, defaultdict  # noqa: E402
from decimal import Decimal  # noqa: E402

import pikepdf  # noqa: E402
from pikepdf import Array, Dictionary, Name, Stream, String  # noqa: E402

CHECKER_VERSION = "1.0"
SECTION_ORDER = "ABCDEFGHIJKLM"
TOL = 0.01  # pt, box containment tolerance

STD14 = {
    "/Times-Roman", "/Times-Bold", "/Times-Italic", "/Times-BoldItalic", "/Helvetica",
    "/Helvetica-Bold", "/Helvetica-Oblique", "/Helvetica-BoldOblique", "/Courier",
    "/Courier-Bold", "/Courier-Oblique", "/Courier-BoldOblique", "/Symbol", "/ZapfDingbats",
}
PROCESS_COLORANTS = {"/Cyan", "/Magenta", "/Yellow", "/Black", "/All", "/None"}
# Characterized printing conditions known to this checker (ICC characterization data
# registry, http://www.color.org).  Not exhaustive -- an unknown name is only a WARN.
KNOWN_REGISTERED = {
    "IFRA26", "IFRA30", "CGATS TR 001", "CGATS TR 002", "CGATS TR 003", "CGATS TR 005",
    "CGATS TR 006", "CGATS TR 011", "CGATS TR 012", "CGATS TR 013", "CGATS TR 014",
    "CGATS TR 015", "CGATS TR 016", "JC200103", "JCN2002", "JCW2003",
} | {"FOGRA%d" % n for n in range(27, 61)} | {"CGATS21_CRPC%d" % n for n in range(1, 8)}
SPACE_LIKE = {chr(c) for c in (0x09, 0x0A, 0x0D, 0x20, 0xA0, 0xAD, 0x1680, 0x180E, 0x2028,
                               0x2029, 0x202F, 0x205F, 0x2060, 0x3000, 0xFEFF)}
SPACE_LIKE |= {chr(c) for c in range(0x2000, 0x2010)}
ANNOT_SUBTYPES = {
    "/Text", "/Link", "/FreeText", "/Line", "/Square", "/Circle", "/Polygon", "/PolyLine",
    "/Highlight", "/Underline", "/Squiggly", "/StrikeOut", "/Stamp", "/Caret", "/Ink",
    "/Popup", "/FileAttachment", "/Sound", "/Movie", "/Widget", "/Screen", "/PrinterMark",
    "/TrapNet", "/Watermark", "/3D", "/Redact", "/RichMedia", "/Projection",
}
RISKY_ACTIONS = {"/Launch", "/Sound", "/Movie", "/Hide", "/SubmitForm", "/ResetForm",
                 "/ImportData", "/SetOCGState", "/Rendition", "/GoTo3DView", "/GoToE",
                 "/RichMediaExecute"}

# Content-stream operators: operand signature (n=number, N=name, s=string, a=array,
# D=dict-or-name).  SC/sc/SCN/scn are variadic and handled separately.
_SIG = {
    "BMC": "N", "MP": "N", "BDC": "ND", "DP": "ND", "d": "an", "Do": "N", "gs": "N",
    "ri": "N", "sh": "N", "CS": "N", "cs": "N", "Tf": "Nn", "Tj": "s", "'": "s",
    '"': "nns", "TJ": "a", "PS": "s",
}
for _op, _n in {"b": 0, "B": 0, "b*": 0, "B*": 0, "f": 0, "F": 0, "f*": 0, "n": 0, "h": 0,
                "S": 0, "s": 0, "W": 0, "W*": 0, "q": 0, "Q": 0, "BT": 0, "ET": 0, "T*": 0,
                "EMC": 0, "BX": 0, "EX": 0, "c": 6, "cm": 6, "d0": 2, "d1": 6, "G": 1,
                "g": 1, "i": 1, "j": 1, "J": 1, "K": 4, "k": 4, "l": 2, "m": 2, "M": 1,
                "re": 4, "RG": 3, "rg": 3, "Tc": 1, "Tw": 1, "Tz": 1, "TL": 1, "Ts": 1,
                "Tr": 1, "Td": 2, "TD": 2, "Tm": 6, "v": 4, "y": 4, "w": 1}.items():
    _SIG[_op] = "n" * _n
VAR_COLOUR_OPS = {"SC", "sc", "SCN", "scn"}
UNIT_RANGE_FAMILIES = {"DeviceCMYK", "DeviceGray", "DeviceRGB", "Separation", "DeviceN", "CalRGB", "CalGray"}
TEXT_OK = {"w", "J", "j", "M", "d", "ri", "i", "gs", "CS", "cs", "SC", "SCN", "sc", "scn",
           "G", "g", "RG", "rg", "K", "k", "Tc", "Tw", "Tz", "TL", "Tf", "Tr", "Ts", "Tj",
           "TJ", "'", '"', "Td", "TD", "Tm", "T*", "MP", "DP", "BMC", "BDC", "EMC", "BX",
           "EX", "ET"}
FILL_OPS = {"f", "F", "f*"}
STROKE_OPS = {"S", "s"}
BOTH_OPS = {"B", "B*", "b", "b*"}


# --------------------------------------------------------------------------- helpers
def isnum(x):
    return isinstance(x, (int, float, Decimal)) and not isinstance(x, bool)


def is_dict(o):
    return isinstance(o, Dictionary)


def is_stream(o):
    return isinstance(o, Stream)


def is_dictlike(o):
    return isinstance(o, (Dictionary, Stream))


def dget(o, key, default=None):
    if not isinstance(o, (Dictionary, Stream)):
        return default
    try:
        v = o.get(key)
    except Exception:
        return default
    return default if v is None else v


def nstr(o):
    return str(o) if isinstance(o, Name) else None


def okey(o, fallback):
    try:
        if o.is_indirect:
            return ("R", o.objgen[0], o.objgen[1])
    except Exception:
        pass
    return ("P", fallback)


def short(o, n=80):
    try:
        s = repr(o) if not isinstance(o, pikepdf.Object) else o.unparse(resolved=True).decode("latin-1")
    except Exception:
        s = repr(o)
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 3] + "..."


def examples(locs, n=3):
    locs = list(locs)
    s = ", ".join(str(x) for x in locs[:n])
    return s + (f" (+{len(locs) - n} more)" if len(locs) > n else "")


def mm(pt):
    return pt * 25.4 / 72.0


def page_ranges(nums):
    nums = sorted(nums)
    out, start, prev = [], None, None
    for n in nums:
        if start is None:
            start = prev = n
        elif n == prev + 1:
            prev = n
        else:
            out.append(f"{start}-{prev}" if prev != start else f"{start}")
            start = prev = n
    if start is not None:
        out.append(f"{start}-{prev}" if prev != start else f"{start}")
    return ",".join(out)


def rect(v):
    if not isinstance(v, Array) or len(v) != 4:
        return None
    try:
        a = [float(x) for x in v]
    except Exception:
        return None
    if not all(isnum(x) for x in v):
        return None
    return (min(a[0], a[2]), min(a[1], a[3]), max(a[0], a[2]), max(a[1], a[3]))


def inside(inner, outer, tol=TOL):
    return (inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol
            and inner[2] <= outer[2] + tol and inner[3] <= outer[3] + tol)


def overlaps(a, b):
    return (min(a[2], b[2]) - max(a[0], b[0]) > 1e-6) and (min(a[3], b[3]) - max(a[1], b[1]) > 1e-6)


def get_inherited(page, key):
    o, depth = page, 0
    while is_dict(o) and depth < 64:
        if key in o:
            return o[key]
        o = dget(o, "/Parent")
        depth += 1
    return None


def filter_names(f):
    if f is None:
        return []
    if isinstance(f, Name):
        return [str(f)]
    if isinstance(f, Array):
        return [str(x) for x in f]
    return ["?"]


class Issues:
    """Aggregate repeated findings: message -> [count, first locations]."""

    def __init__(self):
        self.d = OrderedDict()

    def add(self, msg, loc):
        e = self.d.setdefault(msg, [0, []])
        e[0] += 1
        if len(e[1]) < 3:
            e[1].append(loc)

    def __bool__(self):
        return bool(self.d)

    def lines(self):
        for msg, (cnt, locs) in self.d.items():
            yield f"{msg} [x{cnt}; at {', '.join(locs)}]"


class Report:
    def __init__(self):
        self.items = []

    def add(self, status, cid, msg):
        self.items.append({"status": status, "check": cid, "message": msg})

    def ordered(self):
        def k(t):
            i, it = t
            letter = it["check"][:1]
            return (SECTION_ORDER.index(letter) if letter in SECTION_ORDER else 99, i)
        return [it for _, it in sorted(enumerate(self.items), key=k)]

    def counts(self):
        return Counter(i["status"] for i in self.items)


class _LogCapture(logging.Handler):
    def __init__(self, name):
        super().__init__(logging.WARNING)
        self.logname = name
        self.msgs = []

    def emit(self, record):
        try:
            self.msgs.append(record.getMessage())
        except Exception:
            pass

    def __enter__(self):
        lg = logging.getLogger(self.logname)
        self._saved = (lg.propagate, lg.level)
        lg.addHandler(self)
        lg.propagate = False
        if lg.level == logging.NOTSET or lg.level > logging.WARNING:
            lg.setLevel(logging.WARNING)
        return self

    def __exit__(self, *exc):
        lg = logging.getLogger(self.logname)
        lg.removeHandler(self)
        lg.propagate, lvl = self._saved
        lg.setLevel(lvl)
        return False


# ---------------------------------------------------------------- raw file structure
_WS = b"\x00\t\n\x0c\r "
_SUBSEC = re.compile(rb"(\d+)[ ]+(\d+)[ \t]*(?:\r\n|\r|\n)")
_ENTRY20 = re.compile(rb"(\d{10}) (\d{5}) ([nf])(?: \r| \n|\r\n)")
_ENTRY_LAX = re.compile(rb"[ \t]*(\d+)[ \t]+(\d+)[ \t]+([nf])[ \t]*(?:\r\n|\r|\n)")
_OBJHDR = re.compile(rb"(\d+)[\x00\t\n\x0c\r ]+(\d+)[\x00\t\n\x0c\r ]+obj\b")


def _skip_ws(data, pos):
    n = len(data)
    while pos < n and data[pos] in _WS:
        pos += 1
    return pos


def _dict_end(data, pos):
    depth, i, n = 0, pos, len(data)
    while i < n:
        c = data[i]
        if c == 0x3C:
            if i + 1 < n and data[i + 1] == 0x3C:
                depth += 1
                i += 2
                continue
            j = data.find(b">", i + 1)
            if j < 0:
                return -1
            i = j + 1
            continue
        if c == 0x3E:
            if i + 1 < n and data[i + 1] == 0x3E:
                depth -= 1
                i += 2
                if depth == 0:
                    return i
                continue
            i += 1
            continue
        if c == 0x28:
            d = 1
            i += 1
            while i < n and d:
                ch = data[i]
                if ch == 0x5C:
                    i += 2
                    continue
                if ch == 0x28:
                    d += 1
                elif ch == 0x29:
                    d -= 1
                i += 1
            continue
        if c == 0x25:
            while i < n and data[i] not in b"\r\n":
                i += 1
            continue
        i += 1
    return -1


def _parse_xref_table(data, off):
    sec = {"offset": off, "entries": {}, "trailer": {}, "problems": [], "bad_len": 0}
    pos = off + 4
    if not re.compile(rb"[ \t]*(?:\r\n|\r|\n)").match(data, pos):
        sec["problems"].append(f"'xref' keyword at byte {off} not followed by an end-of-line")
    while True:
        pos = _skip_ws(data, pos)
        if data.startswith(b"trailer", pos):
            break
        m = _SUBSEC.match(data, pos)
        if not m:
            sec["problems"].append(f"malformed xref subsection header at byte {pos}")
            return sec
        start, count = int(m.group(1)), int(m.group(2))
        pos = m.end()
        for k in range(count):
            e = _ENTRY20.match(data, pos)
            if e is None:
                e = _ENTRY_LAX.match(data, pos)
                if e is None:
                    sec["problems"].append(f"unparsable xref entry for object {start + k} at byte {pos}")
                    return sec
                sec["bad_len"] += 1
            sec["entries"][start + k] = (int(e.group(1)), int(e.group(2)), e.group(3).decode())
            pos = e.end()
    tpos = _skip_ws(data, pos + 7)
    if not data.startswith(b"<<", tpos):
        sec["problems"].append("'trailer' keyword not followed by a dictionary")
        return sec
    tend = _dict_end(data, tpos)
    if tend < 0:
        sec["problems"].append("unterminated trailer dictionary")
        return sec
    t = data[tpos:tend]
    for key in ("Size", "Prev", "XRefStm"):
        m = re.search(rb"/" + key.encode() + rb"[\x00\t\n\x0c\r ]+(\d+)(?![\d.])", t)
        if m:
            sec["trailer"][key] = int(m.group(1))
    for key in ("Root", "Info", "Encrypt", "ID"):
        if re.search(rb"/" + key.encode() + rb"(?=[\x00\t\n\x0c\r /<\[(])", t):
            sec["trailer"][key] = True
    return sec


def analyze_raw(data):
    """Independent look at the file bytes: xref chain, offsets, trailer, EOF."""
    r = {"fail": [], "warn": [], "info": [], "sections": [], "inuse": None,
         "linearized": False, "xref_stream": False}
    r["linearized"] = bool(re.search(rb"obj[\x00\t\n\x0c\r ]*<<[^>]{0,200}/Linearized\b", data[:4096]))
    i = data.rfind(b"startxref")
    if i < 0:
        r["fail"].append("no 'startxref' keyword found")
        return r
    m = re.compile(rb"startxref[\x00\t\n\x0c\r ]+(\d+)[\x00\t\n\x0c\r ]+%%EOF").match(data, i)
    if not m:
        r["fail"].append("last 'startxref' is not followed by an offset and %%EOF")
        return r
    last_eof = data.rfind(b"%%EOF")
    tail = data[last_eof + 5:]
    if tail.strip(_WS):
        r["fail"].append(f"{len(tail)} byte(s) of non-whitespace data after the final %%EOF (garbage/truncated update)")
    off = int(m.group(1))
    seen = set()
    while off is not None:
        if off in seen:
            r["fail"].append("xref /Prev chain loops")
            break
        seen.add(off)
        if off >= len(data):
            r["fail"].append(f"xref offset {off} beyond end of file")
            break
        if data.startswith(b"xref", off):
            sec = _parse_xref_table(data, off)
        elif _OBJHDR.match(data, off):
            r["xref_stream"] = True
            r["fail"].append(f"cross-reference STREAM at byte {off} (PDF 1.5 feature; PDF/X-1a requires a classic xref table)")
            break
        else:
            r["fail"].append(f"startxref/Prev offset {off} does not point at an 'xref' keyword")
            break
        r["sections"].append(sec)
        r["fail"].extend(sec["problems"])
        if sec["bad_len"]:
            r["fail"].append(f"{sec['bad_len']} xref entr(y/ies) in section at byte {off} are not exactly 20 bytes (2-byte EOL required)")
        if "XRefStm" in sec["trailer"]:
            r["fail"].append("hybrid-reference file (/XRefStm, PDF 1.5) -- not allowed in PDF/X-1a")
        off = sec["trailer"].get("Prev")
    if not r["sections"]:
        return r
    effective = {}
    for sec in r["sections"]:
        for num, ent in sec["entries"].items():
            effective.setdefault(num, ent)
    oldest = r["sections"][-1]["entries"]
    e0 = oldest.get(0)
    if e0 is None or e0[2] != "f" or e0[1] != 65535:
        r["fail"].append(f"xref entry 0 must be free with generation 65535 (found {e0})")
    bad, ws_only = [], []
    for num, (o, g, t) in sorted(effective.items()):
        if t != "n":
            continue
        mo = _OBJHDR.match(data, o) if o < len(data) else None
        if mo and int(mo.group(1)) == num and int(mo.group(2)) == g:
            continue
        o2 = _skip_ws(data, o) if o < len(data) else o
        mo = _OBJHDR.match(data, o2) if o2 < len(data) else None
        if mo and int(mo.group(1)) == num and int(mo.group(2)) == g:
            ws_only.append(num)
        else:
            bad.append(f"{num} {g} @ {o}")
    if bad:
        r["fail"].append(f"{len(bad)} xref offset(s) do not point at their 'N G obj' header: {examples(bad, 5)}")
    if ws_only:
        r["warn"].append(f"{len(ws_only)} xref offset(s) point at whitespace before 'N G obj' (tolerated by readers, but imprecise): objects {examples(ws_only, 5)}")
    size = r["sections"][0]["trailer"].get("Size")
    maxnum = max(effective) if effective else -1
    if size is None:
        r["fail"].append("trailer has no /Size")
    elif size != maxnum + 1:
        r["fail"].append(f"trailer /Size {size} != highest xref entry + 1 ({maxnum + 1})")
    tr0 = r["sections"][0]["trailer"]
    if "Root" not in tr0 and not any("Root" in s["trailer"] for s in r["sections"]):
        r["fail"].append("trailer has no /Root")
    r["inuse"] = {num for num, (o, g, t) in effective.items() if t == "n"}
    r["size"] = size
    r["n_entries"] = len(effective)
    expected_sections = 2 if r["linearized"] else 1
    r["revisions"] = len(r["sections"])
    if len(r["sections"]) > expected_sections:
        r["warn"].append(f"file has {len(r['sections'])} xref sections ({len(r['sections']) - expected_sections} incremental update(s)); "
                         "conformance is judged on the final revision -- unexpected for a freshly written file")
    return r


def reachable_objnums(pdf):
    """Object numbers reachable from the trailer (via unparsed reference syntax, so that
    indirect scalars such as /Length N 0 R are counted)."""
    ref = re.compile(rb"(\d+) (\d+) R\b")
    seen = set()

    def refs(o):
        try:
            if isinstance(o, Stream):
                b = o.stream_dict.unparse(resolved=True)
            elif isinstance(o, (Dictionary, Array)):
                b = o.unparse(resolved=True)
            else:
                return []
        except Exception:
            return []
        return [(int(a), int(g)) for a, g in ref.findall(b)]

    stack = refs(pdf.trailer)
    while stack:
        og = stack.pop()
        if og in seen:
            continue
        seen.add(og)
        try:
            obj = pdf.get_object(og)
        except Exception:
            continue
        stack.extend(x for x in refs(obj) if x not in seen)
    return {n for n, g in seen}


# ------------------------------------------------------------------------------ ICC
def parse_icc(b):
    if len(b) < 132:
        return None
    h = {
        "size": int.from_bytes(b[0:4], "big"),
        "version": (b[8], b[9] >> 4, b[9] & 0xF),
        "class": b[12:16].decode("latin-1"),
        "space": b[16:20].decode("latin-1"),
        "pcs": b[20:24].decode("latin-1"),
        "magic": b[36:40],
        "desc": None,
    }
    try:
        count = int.from_bytes(b[128:132], "big")
        for k in range(min(count, 512)):
            p = 132 + 12 * k
            sig, off, sz = b[p:p + 4], int.from_bytes(b[p + 4:p + 8], "big"), int.from_bytes(b[p + 8:p + 12], "big")
            if sig != b"desc":
                continue
            t = b[off:off + sz]
            if t[:4] == b"desc":
                n = int.from_bytes(t[8:12], "big")
                h["desc"] = t[12:12 + n].split(b"\0")[0].decode("latin-1", "replace")
            elif t[:4] == b"mluc":
                ln, o2 = int.from_bytes(t[20:24], "big"), int.from_bytes(t[24:28], "big")
                h["desc"] = t[o2:o2 + ln].decode("utf-16-be", "replace")
            break
    except Exception:
        pass
    return h


# ---------------------------------------------------------------------------- CMaps
_CMAP_TOKEN = re.compile(
    rb"(%[^\r\n]*)|(<<|>>)|<([0-9A-Fa-f\x00\t\n\x0c\r ]*)>|(\[)|(\])|(\((?:\\.|[^\\)])*\))"
    rb"|(/[^\x00\t\n\x0c\r ()<>\[\]{}/%]*)|([{}])|([^\x00\t\n\x0c\r ()<>\[\]{}/%]+)", re.S)


class CMapData:
    def __init__(self):
        self.codespace = []  # (nbytes, lo, hi)
        self.bf = {}  # (nbytes, code) -> unicode str
        self.cid = {}  # (nbytes, code) -> cid
        self.cidranges = []  # (nbytes, lo, hi, cid0)
        self.usecmap = None

    def cid_lookup(self, n, code):
        v = self.cid.get((n, code))
        if v is not None:
            return v
        for rn, lo, hi, c0 in self.cidranges:
            if rn == n and lo <= code <= hi:
                return c0 + code - lo
        return None


def _utf16(b):
    if len(b) % 2:
        return b.decode("latin-1")
    return b.decode("utf-16-be", "replace")


def _inc_last(b, k):
    if not k:
        return b
    if len(b) >= 2:
        v = int.from_bytes(b[-2:], "big") + k
        return b[:-2] + (v & 0xFFFF).to_bytes(2, "big")
    return bytes([(b[0] + k) & 0xFF])


def _apply_cmap_block(cm, mode, toks):
    if mode == "codespacerange":
        for i in range(0, len(toks) - 1, 2):
            a, b = toks[i], toks[i + 1]
            if a[0] == "hex" and b[0] == "hex" and a[1] and len(a[1]) == len(b[1]):
                cm.codespace.append((len(a[1]), a[1], b[1]))
    elif mode == "bfchar":
        for i in range(0, len(toks) - 1, 2):
            a, b = toks[i], toks[i + 1]
            if a[0] == "hex":
                key = (len(a[1]), int.from_bytes(a[1], "big"))
                cm.bf[key] = _utf16(b[1]) if b[0] == "hex" else (b[1] if b[0] == "name" else "")
    elif mode == "bfrange":
        for i in range(0, len(toks) - 2, 3):
            lo, hi, dst = toks[i:i + 3]
            if lo[0] != "hex" or hi[0] != "hex":
                continue
            n, a, b = len(lo[1]), int.from_bytes(lo[1], "big"), int.from_bytes(hi[1], "big")
            if b < a or b - a > 0xFFFF:
                continue
            if dst[0] == "hex":
                for k in range(b - a + 1):
                    cm.bf[(n, a + k)] = _utf16(_inc_last(dst[1], k))
            elif dst[0] == "arr":
                for k, item in enumerate(dst[1][: b - a + 1]):
                    if item[0] == "hex":
                        cm.bf[(n, a + k)] = _utf16(item[1])
    elif mode == "cidchar":
        for i in range(0, len(toks) - 1, 2):
            a, b = toks[i], toks[i + 1]
            if a[0] == "hex" and b[0] == "int":
                cm.cid[(len(a[1]), int.from_bytes(a[1], "big"))] = b[1]
    elif mode == "cidrange":
        for i in range(0, len(toks) - 2, 3):
            lo, hi, c = toks[i:i + 3]
            if lo[0] == "hex" and hi[0] == "hex" and c[0] == "int":
                cm.cidranges.append((len(lo[1]), int.from_bytes(lo[1], "big"), int.from_bytes(hi[1], "big"), c[1]))


def parse_cmap(data):
    cm, stack, mode, arr = CMapData(), [], None, None
    for m in _CMAP_TOKEN.finditer(data):
        comment, dct, hx, lb, rbk, lit, name, brace, word = m.groups()
        if comment is not None or dct is not None or brace is not None or lit is not None:
            continue
        if hx is not None:
            h = re.sub(rb"[\x00\t\n\x0c\r ]", b"", hx)
            if len(h) % 2:
                h += b"0"
            tok = ("hex", bytes.fromhex(h.decode("ascii")))
        elif lb is not None:
            arr = []
            continue
        elif rbk is not None:
            tok, arr = ("arr", arr or []), None
        elif name is not None:
            tok = ("name", name.decode("latin-1"))
        else:
            w = word.decode("latin-1")
            if re.fullmatch(r"[+-]?\d+", w):
                tok = ("int", int(w))
            else:
                blocks = ("codespacerange", "bfchar", "bfrange", "cidchar", "cidrange", "notdefchar", "notdefrange")
                if w.startswith("begin") and w[5:] in blocks:
                    mode, stack = w[5:], []
                elif mode and w == "end" + mode:
                    _apply_cmap_block(cm, mode, stack)
                    mode, stack = None, []
                elif w == "usecmap" and stack and stack[-1][0] == "name":
                    cm.usecmap = stack[-1][1]
                    stack = []
                elif mode is None:
                    stack = []
                continue
        if arr is not None:
            arr.append(tok)
            continue
        stack.append(tok)
    return cm


def split_codes(s, ranges):
    lens = sorted({r[0] for r in ranges})
    out, i, n = [], 0, len(s)
    while i < n:
        for L in lens:
            if i + L > n:
                continue
            chunk = s[i:i + L]
            if any(rl == L and all(lo[k] <= chunk[k] <= hi[k] for k in range(L)) for rl, lo, hi in ranges):
                out.append((L, int.from_bytes(chunk, "big")))
                i += L
                break
        else:
            out.append((None, s[i]))
            i += 1
    return out


# ------------------------------------------------------------------- colour spaces
class CSInfo:
    __slots__ = ("family", "ncomp", "ok", "label", "base", "names")

    def __init__(self, family, ncomp, ok, label, base=None, names=()):
        self.family, self.ncomp, self.ok, self.label = family, ncomp, ok, label
        self.base, self.names = base, tuple(names)


CS_GRAY = CSInfo("DeviceGray", 1, True, "DeviceGray")
CS_CMYK = CSInfo("DeviceCMYK", 4, True, "DeviceCMYK")
CS_RGB = CSInfo("DeviceRGB", 3, False, "DeviceRGB")
CS_PATTERN = CSInfo("Pattern", None, True, "Pattern")


def classify_cs(cs, res=None, depth=0):
    if depth > 8:
        return CSInfo("Invalid", None, False, "colour-space nesting too deep")
    if isinstance(cs, Name):
        n = str(cs)
        if n in ("/DeviceCMYK", "/CMYK"):
            return CS_CMYK
        if n in ("/DeviceGray", "/G"):
            return CS_GRAY
        if n in ("/DeviceRGB", "/RGB"):
            return CS_RGB
        if n == "/Pattern":
            return CS_PATTERN
        if n in ("/Indexed", "/I", "/Separation", "/DeviceN", "/ICCBased", "/CalRGB", "/CalGray", "/Lab"):
            return CSInfo("Invalid", None, False, f"{n[1:]} without parameters")
        if res is not None:
            v = dget(dget(res, "/ColorSpace"), n)
            if v is None:
                return CSInfo("Undefined", None, False, f"undefined colour-space resource {n}")
            ci = classify_cs(v, None, depth + 1)
            return CSInfo(ci.family, ci.ncomp, ci.ok, f"{ci.label}", ci.base, ci.names)
        return CSInfo("Undefined", None, False, f"unknown colour-space name {n}")
    if isinstance(cs, Array) and len(cs) >= 1 and isinstance(cs[0], Name):
        fam = str(cs[0])
        if len(cs) == 1 and fam in ("/DeviceCMYK", "/DeviceGray", "/DeviceRGB", "/Pattern"):
            return classify_cs(cs[0], None, depth + 1)
        if fam == "/ICCBased":
            n = dget(cs[1], "/N") if len(cs) > 1 else None
            return CSInfo("ICCBased", int(n) if isnum(n) else None, False, f"ICCBased(N={n})")
        if fam in ("/CalRGB", "/CalGray", "/Lab"):
            return CSInfo(fam[1:], {"/CalRGB": 3, "/CalGray": 1, "/Lab": 3}[fam], False, fam[1:])
        if fam in ("/Indexed", "/I"):
            if len(cs) != 4:
                return CSInfo("Invalid", None, False, "Indexed array must have 4 elements")
            base = classify_cs(cs[1], res, depth + 1)
            return CSInfo("Indexed", 1, base.ok, f"Indexed({base.label})", base, base.names)
        if fam == "/Separation":
            if len(cs) != 4:
                return CSInfo("Invalid", None, False, "Separation array must have 4 elements")
            alt = classify_cs(cs[2], None, depth + 1)
            ok = alt.family in ("DeviceCMYK", "DeviceGray")
            return CSInfo("Separation", 1, ok, f"Separation {cs[1]} (alt {alt.label})", alt, (str(cs[1]),))
        if fam == "/DeviceN":
            if len(cs) not in (4, 5) or not isinstance(cs[1], Array):
                return CSInfo("Invalid", None, False, "malformed DeviceN array")
            names = tuple(str(x) for x in cs[1])
            alt = classify_cs(cs[2], None, depth + 1)
            ok = alt.family in ("DeviceCMYK", "DeviceGray")
            return CSInfo("DeviceN", len(names), ok, f"DeviceN[{','.join(x[1:] for x in names)}] (alt {alt.label})", alt, names)
        if fam == "/Pattern":
            base = classify_cs(cs[1], res, depth + 1)
            return CSInfo("Pattern", None, base.ok, f"Pattern(base {base.label})", base, base.names)
        return CSInfo("Unknown", None, False, f"unknown colour-space family {fam}")
    return CSInfo("Invalid", None, False, f"invalid colour-space object {short(cs, 40)}")


def initial_colour(ci):
    if ci.family == "DeviceCMYK":
        return (0.0, 0.0, 0.0, 1.0)
    if ci.family in ("Separation", "DeviceN"):
        return tuple([1.0] * (ci.ncomp or 1))
    if ci.family == "Pattern":
        return ("pattern",)
    return tuple([0.0] * (ci.ncomp or 1))


def is_white(ci, col):
    if not col or not all(isinstance(x, float) for x in col):
        return False
    if ci.family == "DeviceCMYK":
        return all(abs(x) < 1e-9 for x in col)
    if ci.family == "DeviceGray":
        return col[0] >= 1 - 1e-9
    if ci.family in ("Separation", "DeviceN"):
        return all(abs(x) < 1e-9 for x in col)
    return False


# ------------------------------------------------------------------ content walker
class GState:
    __slots__ = ("fcs", "scs", "fcol", "scol", "font", "opf", "ops", "opm", "tr")

    def __init__(self):
        self.fcs, self.scs = CS_GRAY, CS_GRAY
        self.fcol, self.scol = (0.0,), (0.0,)
        self.font = None
        self.opf = self.ops = False
        self.opm = 0
        self.tr = 0

    def copy(self):
        g = GState.__new__(GState)
        for s in GState.__slots__:
            setattr(g, s, getattr(self, s))
        return g


class FontUse:
    def __init__(self, font, resname, where):
        self.font, self.resname, self.where = font, resname, where
        self.codes = set()
        self.shows = 0


def _sig_ok(sig, ops):
    if len(ops) != len(sig):
        return False
    for t, o in zip(sig, ops):
        if t == "n" and not isnum(o):
            return False
        if t == "N" and not isinstance(o, Name):
            return False
        if t == "s" and not isinstance(o, String):
            return False
        if t == "a" and not isinstance(o, Array):
            return False
        if t == "D" and not isinstance(o, (Name, Dictionary)):
            return False
    return True


class Walker:
    def __init__(self):
        self.visited = set()
        self.streams = 0
        self.nops = 0
        self.sf = Issues()  # content syntax FAIL
        self.sw = Issues()  # content syntax WARN
        self.mcf = Issues()  # marked-content FAIL
        self.bad_colour = Issues()
        self.cs_count = Counter()
        self.spots = set()
        self.tac_max, self.tac_where = 0.0, None
        self.tac300, self.tac260 = Issues(), Issues()
        self.range_bad = Issues()
        self.fonts = OrderedDict()
        self.gs_used = OrderedDict()
        self.white_op = Issues()
        self.op_fill_paints = 0
        self.actualtext = 0
        self.bdc = 0
        self.oc_refs = []
        self.ps_ops = []
        self.ps_xobjects = []
        self.used_images = OrderedDict()
        self.used_shadings = OrderedDict()
        self.inline = []  # (loc, CSInfo|None, filters, imagemask, bpc)
        self.defaults = []  # (where, name, label)
        self._res_seen = set()

    # -- helpers
    def _defaults(self, res, where):
        if not is_dictlike(res):
            return
        k = okey(res, where)
        if k in self._res_seen:
            return
        self._res_seen.add(k)
        csm = dget(res, "/ColorSpace")
        if is_dict(csm):
            for n in ("/DefaultRGB", "/DefaultCMYK", "/DefaultGray"):
                if n in csm:
                    self.defaults.append((where, n, classify_cs(csm[n]).label))

    def _use_cs(self, ci, loc, how):
        self.cs_count[ci.label] += 1
        for n in ci.names:
            self.spots.add(n)
        if not ci.ok:
            self.bad_colour.add(f"{ci.label} selected by {how}", loc)

    def _tac(self, vals, loc):
        t = sum(vals) * 100.0
        if t > self.tac_max:
            self.tac_max, self.tac_where = t, loc
        if t > 300.0 + 1e-6:
            self.tac300.add(f"{t:.0f}%", loc)
        elif t > 260.0 + 1e-6:
            self.tac260.add(f"{t:.0f}%", loc)

    def _range(self, vals, loc):
        if any(v < -1e-9 or v > 1 + 1e-9 for v in vals):
            self.range_bad.add(f"colour component(s) outside 0..1: {tuple(round(v, 4) for v in vals)}", loc)

    def _paint(self, st, loc, fill=False, stroke=False, text=False):
        if text:
            fill = st.tr in (0, 2, 4, 6)
            stroke = st.tr in (1, 2, 5, 6)
        if fill and st.opf:
            self.op_fill_paints += 1
            if is_white(st.fcs, st.fcol):
                self.white_op.add(f"white fill ({st.fcs.label} {st.fcol}) painted with overprint on (OPM {st.opm})", loc)
        if stroke and st.ops and is_white(st.scs, st.scol):
            self.white_op.add(f"white stroke ({st.scs.label} {st.scol}) painted with overprint on (OPM {st.opm})", loc)

    def _font(self, font, name, loc, res):
        k = okey(font, f"{loc}:{name}")
        fu = self.fonts.get(k)
        if fu is None:
            fu = FontUse(font, name, loc)
            self.fonts[k] = fu
            if nstr(dget(font, "/Subtype")) == "/Type3":
                procs = dget(font, "/CharProcs")
                fres = dget(font, "/Resources") or res
                if is_dict(procs):
                    for g in list(procs.keys()):
                        self.walk(procs[g], fres, f"{loc}>Type3 {name}{g}", key=("t3",) + k + (g,))
        return fu

    def _shading(self, sh, res, loc, how):
        if not is_dictlike(sh):
            self.sf.add("shading is not a dictionary/stream", loc)
            return
        self.used_shadings.setdefault(okey(sh, loc), loc)
        cs = dget(sh, "/ColorSpace")
        if cs is None:
            self.sf.add("shading without /ColorSpace", loc)
            return
        self._use_cs(classify_cs(cs, res), loc, how)

    def _pattern(self, name, res, loc, where, ci, nums):
        pat = dget(dget(res, "/Pattern"), str(name))
        if pat is None:
            self.sf.add(f"pattern {name} not found in /Pattern resources", loc)
            return
        pt = dget(pat, "/PatternType")
        k = okey(pat, f"{loc}/{name}")
        if pt == 1:
            if not is_stream(pat):
                self.sf.add(f"tiling pattern {name} is not a stream", loc)
                return
            if dget(pat, "/PaintType") == 2 and (ci.base is None):
                self.sf.add(f"uncoloured tiling pattern {name} used without an underlying colour space", loc)
            pres = dget(pat, "/Resources")
            if pres is None:
                self.sw.add("tiling pattern without /Resources", loc)
            self.walk(pat, pres, f"{where}>Pattern{name}", key=("pat",) + k)
        elif pt == 2:
            self._shading(dget(pat, "/Shading"), res, loc, f"shading pattern {name}")
        else:
            self.sf.add(f"pattern {name} has invalid /PatternType {pt}", loc)

    def _do(self, name, res, loc, where, st, in_text):
        xo = dget(dget(res, "/XObject"), str(name))
        if xo is None:
            self.sf.add(f"XObject {name} not found in resources", loc)
            return
        if in_text:
            self.sw.add("'Do' inside a text object (BT/ET)", loc)
        sub = nstr(dget(xo, "/Subtype"))
        k = okey(xo, f"{loc}/{name}")
        if sub == "/Form":
            if nstr(dget(xo, "/Subtype2")) == "/PS":
                self.ps_xobjects.append(loc)
            fres = dget(xo, "/Resources")
            if fres is None:
                self.sw.add("form XObject without /Resources (inherits the caller's; deprecated)", loc)
                fres = res
            self.walk(xo, fres, f"{where}>{str(name)[1:]}", st=st, key=("form",) + k)
        elif sub == "/Image":
            self.used_images.setdefault(k, loc)
            if dget(xo, "/ImageMask") is True:
                self._paint(st, loc, fill=True)
        elif sub == "/PS":
            self.ps_xobjects.append(loc)
        else:
            self.sf.add(f"XObject {name} has invalid /Subtype {sub}", loc)

    def _inline(self, inst, res, loc, st):
        try:
            d = inst.iimage.obj
        except Exception as e:
            self.sf.add(f"inline image cannot be parsed: {e}", loc)
            return
        imask = dget(d, "/ImageMask") is True
        filters = filter_names(dget(d, "/Filter"))
        cs = dget(d, "/ColorSpace")
        ci = None
        if imask:
            self._paint(st, loc, fill=True)
        elif cs is None:
            ci = CSInfo("Missing", None, False, "no /ColorSpace")
        else:
            ci = classify_cs(cs, res)
        self.inline.append((loc, ci, filters, imask, dget(d, "/BitsPerComponent")))

    # -- main
    def walk(self, src, res, where, st=None, key=None):
        if key is not None:
            if key in self.visited:
                return
            self.visited.add(key)
        self._defaults(res, where)
        try:
            insts = pikepdf.parse_content_stream(src)
        except Exception as e:
            self.sf.add(f"content stream cannot be parsed: {type(e).__name__}: {e}", where)
            return
        self.streams += 1
        st = st.copy() if st is not None else GState()
        qstack, mc = [], []
        in_text, bt_id, bx = False, 0, 0
        for idx, inst in enumerate(insts):
            loc = f"{where}#{idx}"
            self.nops += 1
            if isinstance(inst, pikepdf.ContentStreamInlineImage):
                if in_text:
                    self.sw.add("inline image inside a text object (BT/ET)", loc)
                self._inline(inst, res, loc, st)
                continue
            op = str(inst.operator)
            opr = list(inst.operands)
            sig = _SIG.get(op)
            if sig is None and op not in VAR_COLOUR_OPS:
                if bx == 0:
                    self.sf.add(f"unknown operator '{op}' outside BX/EX", loc)
                continue
            if sig is not None and not _sig_ok(sig, opr):
                self.sf.add(f"wrong operands for '{op}': {short(opr, 60)}", loc)
                continue
            if in_text and op not in TEXT_OK and op != "BT":
                self.sw.add(f"operator '{op}' is not allowed inside a text object (BT/ET)", loc)

            if op == "q":
                qstack.append(st.copy())
            elif op == "Q":
                if qstack:
                    st = qstack.pop()
                else:
                    self.sw.add("'Q' without matching 'q' (graphics-state stack underflow)", loc)
            elif op == "BT":
                if in_text:
                    self.sf.add("nested BT (BT inside a text object)", loc)
                in_text = True
                bt_id += 1
            elif op == "ET":
                if not in_text:
                    self.sf.add("ET without BT", loc)
                else:
                    if any(b == bt_id for _, b in mc):
                        self.mcf.add("marked-content sequence opened inside BT is still open at ET (crosses the text-object boundary)", loc)
                        mc = [m for m in mc if m[1] != bt_id]
                in_text = False
            elif op in ("BMC", "BDC"):
                tag = str(opr[0])
                if op == "BDC":
                    self.bdc += 1
                    props = opr[1]
                    if isinstance(props, Name):
                        pd = dget(dget(res, "/Properties"), str(props))
                        if pd is None:
                            self.sf.add(f"BDC property list {props} not found in /Properties resources", loc)
                        props = pd
                    if is_dictlike(props):
                        if "/ActualText" in props:
                            self.actualtext += 1
                        if nstr(dget(props, "/Type")) in ("/OCG", "/OCMD"):
                            self.oc_refs.append(loc)
                    if tag == "/OC" and loc not in self.oc_refs:
                        self.oc_refs.append(loc)
                mc.append((tag, bt_id if in_text else None))
            elif op == "EMC":
                if not mc:
                    self.mcf.add("EMC without a matching BMC/BDC", loc)
                else:
                    _, b = mc.pop()
                    if b != (bt_id if in_text else None):
                        if b is None:
                            self.mcf.add("marked-content sequence opened outside a text object is closed inside BT/ET (crosses the text-object boundary)", loc)
                        else:
                            self.mcf.add("marked-content sequence opened inside a text object is closed outside it", loc)
            elif op == "BX":
                bx += 1
            elif op == "EX":
                if bx:
                    bx -= 1
                else:
                    self.sw.add("EX without BX", loc)
            elif op in ("g", "G"):
                v = (float(opr[0]),)
                self._range(v, loc)
                self.cs_count["DeviceGray"] += 1
                if op == "g":
                    st.fcs, st.fcol = CS_GRAY, v
                else:
                    st.scs, st.scol = CS_GRAY, v
            elif op in ("k", "K"):
                v = tuple(float(x) for x in opr)
                self._range(v, loc)
                self._tac(v, loc)
                self.cs_count["DeviceCMYK"] += 1
                if op == "k":
                    st.fcs, st.fcol = CS_CMYK, v
                else:
                    st.scs, st.scol = CS_CMYK, v
            elif op in ("rg", "RG"):
                v = tuple(float(x) for x in opr)
                self._use_cs(CS_RGB, loc, f"'{op}' operator")
                if op == "rg":
                    st.fcs, st.fcol = CS_RGB, v
                else:
                    st.scs, st.scol = CS_RGB, v
            elif op in ("cs", "CS"):
                ci = classify_cs(opr[0], res)
                self._use_cs(ci, loc, f"'{opr[0]} {op}'")
                if op == "cs":
                    st.fcs, st.fcol = ci, initial_colour(ci)
                else:
                    st.scs, st.scol = ci, initial_colour(ci)
            elif op in VAR_COLOUR_OPS:
                fill = op in ("sc", "scn")
                ci = st.fcs if fill else st.scs
                nums = [x for x in opr if isnum(x)]
                names = [x for x in opr if isinstance(x, Name)]
                if len(nums) + len(names) != len(opr) or len(names) > 1 or (names and not isinstance(opr[-1], Name)) \
                        or (names and op in ("sc", "SC")):
                    self.sf.add(f"wrong operands for '{op}': {short(opr, 60)}", loc)
                    continue
                if ci.family == "Pattern":
                    if not names:
                        self.sf.add(f"'{op}' in a Pattern colour space without a pattern name", loc)
                        continue
                    if nums:
                        base = ci.base
                        if base is None:
                            self.sf.add(f"'{op}' gives colour components but the Pattern space has no base", loc)
                        else:
                            if base.ncomp is not None and len(nums) != base.ncomp:
                                self.sf.add(f"'{op}' gives {len(nums)} components; base {base.label} needs {base.ncomp}", loc)
                            if base.family == "DeviceCMYK":
                                self._tac(tuple(float(x) for x in nums), loc)
                    self._pattern(names[0], res, loc, where, ci, nums)
                    col = ("pattern",)
                else:
                    if names:
                        self.sf.add(f"pattern name given to '{op}' but the current colour space is {ci.label}", loc)
                        continue
                    if ci.ncomp is not None and len(nums) != ci.ncomp:
                        self.sf.add(f"'{op}' gives {len(nums)} component(s); {ci.label} needs {ci.ncomp}", loc)
                    col = tuple(float(x) for x in nums)
                    if ci.family in UNIT_RANGE_FAMILIES:
                        self._range(col, loc)
                    if ci.family == "DeviceCMYK":
                        self._tac(col, loc)
                    if op in ("sc", "SC") and ci.family in ("Separation", "DeviceN", "ICCBased"):
                        self.sw.add(f"'{op}' used with a {ci.family} colour space ('{op + ('n' if op == 'sc' else 'N')}' is required by the spec)", loc)
                if fill:
                    st.fcol = col
                else:
                    st.scol = col
            elif op == "Tf":
                font = dget(dget(res, "/Font"), str(opr[0]))
                if font is None:
                    self.sf.add(f"font resource {opr[0]} not found", loc)
                    st.font = None
                else:
                    st.font = self._font(font, str(opr[0]), loc, res)
            elif op in ("Tj", "'", '"', "TJ"):
                if not in_text:
                    self.sf.add(f"text-showing operator '{op}' outside BT/ET", loc)
                if st.font is None:
                    self.sf.add(f"'{op}' with no font selected (missing Tf)", loc)
                else:
                    strs = [bytes(x) for x in opr[0] if isinstance(x, String)] if op == "TJ" else [bytes(opr[-1])]
                    for s in strs:
                        st.font.codes.add(s)
                    st.font.shows += 1
                self._paint(st, loc, text=True)
            elif op == "Tr":
                st.tr = int(opr[0])
            elif op in ("Td", "TD", "Tm", "T*"):
                if not in_text:
                    self.sw.add(f"text-positioning operator '{op}' outside BT/ET", loc)
            elif op == "gs":
                gs = dget(dget(res, "/ExtGState"), str(opr[0]))
                if not is_dict(gs):
                    self.sf.add(f"ExtGState {opr[0]} not found in resources", loc)
                else:
                    self.gs_used.setdefault(okey(gs, f"{where}/ExtGState{opr[0]}"), (str(opr[0]), loc, gs))
                    v = dget(gs, "/OP")
                    if isinstance(v, bool):
                        st.ops = v
                        if "/op" not in gs:
                            st.opf = v
                    v = dget(gs, "/op")
                    if isinstance(v, bool):
                        st.opf = v
                    v = dget(gs, "/OPM")
                    if isnum(v):
                        st.opm = int(v)
                    fnt = dget(gs, "/Font")
                    if isinstance(fnt, Array) and len(fnt) >= 1 and is_dict(fnt[0]):
                        st.font = self._font(fnt[0], f"{opr[0]}/Font", loc, res)
            elif op == "Do":
                self._do(opr[0], res, loc, where, st, in_text)
            elif op == "sh":
                self._shading(dget(dget(res, "/Shading"), str(opr[0])), res, loc, f"'sh {opr[0]}'")
            elif op in FILL_OPS:
                self._paint(st, loc, fill=True)
            elif op in STROKE_OPS:
                self._paint(st, loc, stroke=True)
            elif op in BOTH_OPS:
                self._paint(st, loc, fill=True, stroke=True)
            elif op == "PS":
                self.ps_ops.append(loc)
        if in_text:
            self.sf.add("text object not closed (BT without ET) at end of stream", where)
        if mc:
            self.mcf.add(f"{len(mc)} marked-content sequence(s) not closed by EMC at end of stream", where)
        if qstack:
            self.sw.add(f"{len(qstack)} 'q' not restored by 'Q' at end of stream", where)
        if bx:
            self.sw.add("BX without EX at end of stream", where)


# ------------------------------------------------------------- object inventory
class Inventory:
    def __init__(self):
        self.extgstates = OrderedDict()
        self.images = OrderedDict()
        self.forms = OrderedDict()
        self.fonts = OrderedDict()
        self.shadings = OrderedDict()
        self.cs_defs = []
        self.flags = defaultdict(list)
        self.n_objects = 0

    def add_gs(self, key, gs, label):
        if key not in self.extgstates:
            self.extgstates[key] = (gs, label)


def _inspect(inv, o, is_st, path):
    key = ("R", o.objgen[0], o.objgen[1]) if o.is_indirect else ("P", path)
    typ, sub = nstr(dget(o, "/Type")), nstr(dget(o, "/Subtype"))
    label = f"{path}({(typ or sub or '')[1:]})" if (typ or sub) else path
    if is_st and sub == "/Image":
        inv.images[key] = (o, path)
    elif is_st and sub == "/Form":
        inv.forms[key] = (o, path)
    if sub == "/PS" or nstr(dget(o, "/Subtype2")) == "/PS":
        inv.flags["ps_xobject"].append(label)
    if typ == "/Font" and sub in ("/Type0", "/Type1", "/MMType1", "/TrueType", "/Type3"):
        inv.fonts[key] = (o, path)
    if typ == "/ExtGState":
        inv.add_gs(key, o, path)
    egs = dget(o, "/ExtGState")
    if "/PatternType" in o:
        if is_dict(egs):
            inv.add_gs(okey(egs, path + "/ExtGState"), egs, path + "/ExtGState")
    elif is_dict(egs):
        for n in list(egs.keys()):
            g = dget(egs, n)
            if is_dict(g):
                inv.add_gs(okey(g, f"{path}/ExtGState{n}"), g, f"{path}/ExtGState{n}")
    csm = dget(o, "/ColorSpace")
    if is_dict(csm):
        for n in list(csm.keys()):
            inv.cs_defs.append((n, dget(csm, n), path))
    if "/ShadingType" in o:
        inv.shadings[key] = (o, path)
    grp = dget(o, "/Group")
    if is_dict(grp) and nstr(dget(grp, "/S")) == "/Transparency":
        inv.flags["transparency_group"].append(label)
    s_val = nstr(dget(o, "/S"))
    if "/JS" in o or s_val == "/JavaScript":
        inv.flags["js"].append(label)
    if "/JavaScript" in o:
        inv.flags["js"].append(f"{label} /Names/JavaScript")
    if s_val in RISKY_ACTIONS:
        inv.flags["risky_action"].append(f"{label} {s_val}")
    if "/AA" in o:
        inv.flags["aa"].append(label)
    if "/EmbeddedFiles" in o or "/EF" in o or typ == "/EmbeddedFile":
        inv.flags["embedded"].append(label)
    if "/OCProperties" in o:
        inv.flags["ocproperties"].append(label)
    if "/OC" in o:
        inv.flags["oc"].append(label)
    if typ in ("/OCG", "/OCMD"):
        inv.flags["ocg"].append(label)
    if "/OPI" in o:
        inv.flags["opi"].append(label)
    if typ == "/ObjStm":
        inv.flags["objstm"].append(label)
    if typ == "/XRef":
        inv.flags["xrefstm"].append(label)
    if "/XFA" in o:
        inv.flags["xfa"].append(label)
    if "/Rect" in o and sub in ANNOT_SUBTYPES:
        ca = dget(o, "/CA")
        if isnum(ca) and float(ca) < 1.0:
            inv.flags["annot_ca"].append(f"{label} CA={float(ca):g}")


def build_inventory(pdf):
    inv = Inventory()
    for top in pdf.objects:
        if not isinstance(top, pikepdf.Object):
            continue
        try:
            og = top.objgen
        except Exception:
            continue
        inv.n_objects += 1
        stack = [(top, f"obj{og[0]}")]
        while stack:
            o, path = stack.pop()
            if isinstance(o, Array):
                for i, ch in enumerate(o):
                    if isinstance(ch, (Array, Dictionary)) and not ch.is_indirect:
                        stack.append((ch, f"{path}[{i}]"))
                continue
            if isinstance(o, Stream):
                is_st = True
            elif isinstance(o, Dictionary):
                is_st = False
            else:
                continue
            _inspect(inv, o, is_st, path)
            for k in list(o.keys()):
                try:
                    ch = o[k]
                except Exception:
                    continue
                if isinstance(ch, (Array, Dictionary)) and not ch.is_indirect:
                    stack.append((ch, f"{path}{k}"))
    return inv


# ------------------------------------------------------------------- context
class Ctx:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as fh:
            self.data = fh.read()
        self.pdf = None
        self.hver = None
        self.eff_ver = None
        self.flavour = None
        self.page_boxes = {}
        self.walker = None
        self.inv = None
        self.raw = None


def peek_flavour(pdf):
    info = dget(pdf.trailer, "/Info")
    v, c = dget(info, "/GTS_PDFXVersion"), dget(info, "/GTS_PDFXConformance")
    v = str(v) if isinstance(v, String) else None
    c = str(c) if isinstance(c, String) else None
    if v == "PDF/X-1:2001":
        return "2001"
    if v == "PDF/X-1a:2003":
        return "2003"
    return None


# ========================================================================= A
def check_A(ctx, rep):
    data = ctx.data
    m = re.match(rb"%PDF-(\d+)\.(\d+)", data)
    hdr_off = 0
    if not m:
        i = data.find(b"%PDF-", 0, 1024)
        if i >= 0:
            m = re.compile(rb"%PDF-(\d+)\.(\d+)").match(data, i)
            hdr_off = i
    if not m:
        rep.add("FAIL", "A.header", "no '%PDF-x.y' header in the first 1024 bytes")
    else:
        ctx.hver = (int(m.group(1)), int(m.group(2)))
        if hdr_off:
            rep.add("WARN", "A.header", f"header found at byte {hdr_off}, should be at byte 0")
        rest = data[m.end():m.end() + 64]
        bm = re.match(rb"[ \t]*(?:\r\n|\r|\n)%([^\r\n]*)", rest)
        if bm and sum(1 for b in bm.group(1)[:16] if b >= 128) >= 4:
            rep.add("PASS", "A.binary-comment", "binary comment line (>=4 bytes >= 128) follows the header")
        else:
            rep.add("WARN", "A.binary-comment", "no binary comment line after the header (recommended so transfer tools treat the file as binary)")
    # strict open
    pdf = None
    try:
        pdf = pikepdf.open(ctx.path, attempt_recovery=False, inherit_page_attributes=False)
        rep.add("PASS", "A.open-strict", f"qpdf {pikepdf.__libqpdf_version__} opened the file without xref recovery "
                f"({len(pdf.pages)} page(s), {len(pdf.objects)} objects)")
    except pikepdf.PasswordError:
        rep.add("FAIL", "A.encrypt", "file is encrypted and needs a password (PDF/X forbids encryption)")
        return
    except Exception as e:
        rep.add("FAIL", "A.open-strict", f"qpdf strict open (attempt_recovery=False) failed: {type(e).__name__}: {e}")
        try:
            pdf = pikepdf.open(ctx.path, inherit_page_attributes=False)
            rep.add("WARN", "A.open-strict", "continuing with qpdf's recovered reading of the file; later results may be unreliable")
        except Exception as e2:
            rep.add("FAIL", "A.open", f"qpdf cannot open the file even with recovery: {e2}")
            return
    ctx.pdf = pdf
    ctx.flavour = peek_flavour(pdf)
    # encryption
    if pdf.is_encrypted or "/Encrypt" in pdf.trailer:
        rep.add("FAIL", "A.encrypt", "file is encrypted (/Encrypt in trailer) -- PDF/X forbids encryption")
    else:
        rep.add("PASS", "A.encrypt", "not encrypted")
    # version
    if ctx.hver:
        eff = ctx.hver
        cv = dget(pdf.Root, "/Version")
        note = ""
        if cv is not None:
            mv = re.fullmatch(r"/(\d+)\.(\d+)", str(cv))
            if mv:
                vv = (int(mv.group(1)), int(mv.group(2)))
                note = f"; catalog /Version {str(cv)[1:]}"
                eff = max(eff, vv)
            else:
                note = f"; invalid catalog /Version {cv}"
        ctx.eff_ver = eff
        hv = f"{ctx.hver[0]}.{ctx.hver[1]}"
        ev = f"{eff[0]}.{eff[1]}"
        flav = {"2001": "PDF/X-1a:2001", "2003": "PDF/X-1a:2003"}.get(ctx.flavour, "unknown PDF/X flavour")
        if eff not in ((1, 3), (1, 4)):
            rep.add("FAIL", "A.version", f"header %PDF-{hv} (effective {ev}{note}): PDF/X-1a requires PDF 1.3 (:2001) or 1.3/1.4 (:2003)")
        elif ctx.flavour == "2001" and eff != (1, 3):
            rep.add("FAIL", "A.version", f"header %PDF-{hv} (effective {ev}{note}) but {flav} is based on PDF 1.3")
        else:
            rep.add("PASS", "A.version", f"header %PDF-{hv} (effective {ev}{note}); allowed for {flav}")
    # qpdf syntax check
    try:
        probs = pdf.check_pdf_syntax()
    except Exception as e:
        probs = [f"check_pdf_syntax raised {type(e).__name__}: {e}"]
    if probs:
        probs = [p.replace(os.path.abspath(ctx.path), os.path.basename(ctx.path)).replace(ctx.path, os.path.basename(ctx.path)) for p in probs]
        rep.add("FAIL", "A.qpdf-check", f"{len(probs)} problem(s) reported by qpdf: {examples(probs, 3)}")
    else:
        rep.add("PASS", "A.qpdf-check", "qpdf check_pdf_syntax: no warnings or errors (all streams decode, page content parses)")
    # raw xref / trailer
    raw = analyze_raw(data)
    ctx.raw = raw
    for msg in raw["fail"]:
        rep.add("FAIL", "A.xref", msg)
    for msg in raw["warn"]:
        rep.add("WARN", "A.xref", msg)
    if not raw["fail"] and raw["sections"]:
        nin = len(raw["inuse"] or ())
        rep.add("PASS", "A.xref", f"classic xref table ({raw['n_entries']} entries, {len(raw['sections'])} section(s)"
                f"{', linearized' if raw['linearized'] else ''}); all {nin} in-use offsets hit their 'N G obj'; "
                f"/Size {raw.get('size')} consistent; nothing but whitespace after %%EOF")
    tr = pdf.trailer
    missing = [k for k in ("/Root", "/Size") if k not in tr]
    if missing:
        rep.add("FAIL", "A.trailer", f"trailer lacks {', '.join(missing)}")
    if "/Info" not in tr:
        rep.add("FAIL", "A.trailer", "trailer lacks /Info (PDF/X requires the document information dictionary)")
    # object/xref streams found among objects
    inv_flags = []
    for o in pdf.objects:
        if isinstance(o, Stream) and nstr(dget(o, "/Type")) in ("/ObjStm", "/XRef"):
            inv_flags.append(f"obj {o.objgen[0]} {str(o.get('/Type'))[1:]}")
    if inv_flags:
        rep.add("FAIL", "A.pdf15-structures", f"object/xref streams present (PDF 1.5 features): {examples(inv_flags)}")
    elif re.search(rb"/Type[\x00\t\n\x0c\r ]*/ObjStm\b", data):
        rep.add("FAIL", "A.pdf15-structures", "an /ObjStm object stream is present in the file bytes (PDF 1.5 feature)")
    else:
        rep.add("PASS", "A.pdf15-structures", "no object streams or cross-reference streams")
    # unreferenced objects
    if raw.get("inuse"):
        try:
            reach = reachable_objnums(pdf)
            unref = sorted(raw["inuse"] - reach)
            if raw["linearized"] and unref:
                keep = []
                for num in unref:  # linearization dict and hint streams are unreferenced by design
                    try:
                        o = pdf.get_object((num, 0))
                    except Exception:
                        o = None
                    if is_dictlike(o) and ("/Linearized" in o or (is_stream(o) and isnum(dget(o, "/S")))):
                        continue
                    keep.append(num)
                unref = keep
            if unref:
                rep.add("WARN", "A.unreferenced", f"{len(unref)} in-use object(s) not reachable from the trailer (dead weight / writer garbage): {examples(unref, 8)}")
            else:
                rep.add("PASS", "A.unreferenced", "every in-use object is reachable from the trailer")
        except Exception as e:
            rep.add("WARN", "A.unreferenced", f"reachability analysis failed: {e}")


def report_content_syntax(ctx, rep):
    w = ctx.walker
    if w.sf:
        for line in w.sf.lines():
            rep.add("FAIL", "A.content-syntax", line)
    else:
        rep.add("PASS", "A.content-syntax", f"{w.streams} content stream(s), {w.nops} operators: all known, operand types/arity correct, "
                "BT/ET balanced, all named resources resolve")
    for line in w.sw.lines():
        rep.add("WARN", "A.content-syntax", line)


# ========================================================================= B
_DATE_TZ = re.compile(r"(?:Z(?:00'?(?:00'?)?)?|([+\-])(\d{2})(?:'(?:(\d{2})'?)?)?)$")


def parse_pdf_date(s):
    """Return (datetime|None, error|None, warnings[])."""
    warns = []
    if not s.startswith("D:"):
        if re.match(r"\d{4}", s):
            warns.append("missing 'D:' prefix (tolerated by many readers)")
            body = s
        else:
            return None, "does not start with 'D:'", warns
    else:
        body = s[2:]
    m = re.match(r"(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?", body)
    if not m or not m.group(1):
        return None, "no year", warns
    parts = [int(x) if x else None for x in m.groups()]
    if any(p is None for p in parts):
        warns.append("truncated date (fields after the year are optional, but full precision is expected)")
    y, mo, d, h, mi, se = [p if p is not None else dflt for p, dflt in zip(parts, (0, 1, 1, 0, 0, 0))]
    try:
        dt = _dt.datetime(y, mo, d, h, mi, se)
    except ValueError as e:
        return None, f"invalid date/time value ({e})", warns
    rest = body[m.end():]
    if rest == "":
        warns.append("no time-zone offset (e.g. +00'00' or Z)")
        return dt, None, warns
    tm = _DATE_TZ.match(rest)
    if not tm:
        return None, f"unexpected {rest!r} after the date digits (expected D:YYYYMMDDHHmmSS then Z or +HH'mm')", warns
    if tm.group(1):
        oh, om = int(tm.group(2)), int(tm.group(3) or 0)
        if oh > 23 or om > 59:
            return None, f"time-zone offset out of range {rest!r}", warns
        delta = _dt.timedelta(hours=oh, minutes=om)
        dt = dt - delta if tm.group(1) == "+" else dt + delta
    return dt, None, warns


def check_B(ctx, rep):
    pdf = ctx.pdf
    info = dget(pdf.trailer, "/Info")
    if not is_dict(info):
        rep.add("FAIL", "B.info", "no document information dictionary (/Info) -- all PDF/X identification keys missing")
        return

    def sval(key):
        v = info.get(key)
        if v is None:
            return None, None
        return (str(v), "string") if isinstance(v, String) else (str(v), type(v).__name__)

    ver, vt = sval("/GTS_PDFXVersion")
    conf, ct = sval("/GTS_PDFXConformance")
    if ver is None:
        rep.add("FAIL", "B.pdfx-version", "Info /GTS_PDFXVersion missing")
    elif vt != "string":
        rep.add("FAIL", "B.pdfx-version", f"Info /GTS_PDFXVersion must be a string (found {vt} {ver})")
    elif ver == "PDF/X-1:2001":
        if conf == "PDF/X-1a:2001" and ct == "string":
            rep.add("PASS", "B.pdfx-version", "GTS_PDFXVersion (PDF/X-1:2001) + GTS_PDFXConformance (PDF/X-1a:2001)")
        else:
            rep.add("FAIL", "B.pdfx-version", f"GTS_PDFXVersion PDF/X-1:2001 requires GTS_PDFXConformance (PDF/X-1a:2001); found {conf!r}")
    elif ver == "PDF/X-1a:2003":
        rep.add("PASS", "B.pdfx-version", "GTS_PDFXVersion (PDF/X-1a:2003)")
        if conf is not None:
            rep.add("WARN", "B.pdfx-version", f"GTS_PDFXConformance ({conf}) is not used by PDF/X-1a:2003")
    elif ver == "PDF/X-1a:2001":
        rep.add("FAIL", "B.pdfx-version", "GTS_PDFXVersion (PDF/X-1a:2001) is invalid: :2001 files use GTS_PDFXVersion (PDF/X-1:2001) plus GTS_PDFXConformance (PDF/X-1a:2001)")
    else:
        rep.add("FAIL", "B.pdfx-version", f"GTS_PDFXVersion {ver!r} does not identify PDF/X-1a")
    # Title
    t, tt = sval("/Title")
    if t is None:
        rep.add("FAIL", "B.title", "Info /Title missing (required by PDF/X)")
    elif tt != "string":
        rep.add("FAIL", "B.title", f"Info /Title is not a text string ({tt})")
    elif not t.strip():
        rep.add("WARN", "B.title", "Info /Title is empty")
    else:
        rep.add("PASS", "B.title", f"Title {t!r}")
    # dates
    dates = {}
    for key in ("/CreationDate", "/ModDate"):
        v, vt2 = sval(key)
        if v is None:
            rep.add("FAIL", "B.dates", f"Info {key} missing (required by PDF/X)")
            continue
        if vt2 != "string":
            rep.add("FAIL", "B.dates", f"Info {key} is not a string")
            continue
        dt, err, warns = parse_pdf_date(v)
        if err:
            rep.add("FAIL", "B.dates", f"{key} {v!r} is not a valid PDF date: {err}")
            continue
        dates[key] = dt
        if warns:
            rep.add("WARN", "B.dates", f"{key} {v!r}: {'; '.join(warns)}")
        else:
            rep.add("PASS", "B.dates", f"{key} {v!r} valid")
    if len(dates) == 2 and dates["/ModDate"] < dates["/CreationDate"]:
        rep.add("WARN", "B.dates", "ModDate is earlier than CreationDate")
    # Trapped
    tr = info.get("/Trapped")
    if tr is None:
        rep.add("FAIL", "B.trapped", "Info /Trapped missing (PDF/X requires /True or /False)")
    elif not isinstance(tr, Name):
        rep.add("FAIL", "B.trapped", f"Info /Trapped must be a name (/True or /False), found {short(tr)}")
    elif str(tr) in ("/True", "/False"):
        rep.add("PASS", "B.trapped", f"Trapped {tr}")
    else:
        rep.add("FAIL", "B.trapped", f"Info /Trapped is {tr}; PDF/X requires /True or /False")
    # ID
    tid = pdf.trailer.get("/ID")
    if tid is None:
        rep.add("FAIL", "B.id", "trailer /ID missing (required by PDF/X)")
    elif not isinstance(tid, Array) or len(tid) != 2 or not all(isinstance(x, String) and len(bytes(x)) > 0 for x in tid):
        rep.add("FAIL", "B.id", f"trailer /ID must be an array of two non-empty byte strings, found {short(tid)}")
    else:
        rep.add("PASS", "B.id", f"trailer /ID present ({len(bytes(tid[0]))}+{len(bytes(tid[1]))} bytes)")
    prod, cre = sval("/Producer")[0], sval("/Creator")[0]
    rep.add("INFO", "B.producer", f"Producer {prod!r}, Creator {cre!r}")
    # XMP agreement (optional metadata)
    md = dget(pdf.Root, "/Metadata")
    if is_stream(md):
        try:
            x = md.read_bytes().decode("utf-8", "replace")
            mx = re.search(r"GTS_PDFXVersion(?:>|=\")\s*([^<\"]+)", x)
            if mx and ver and mx.group(1).strip() != ver:
                rep.add("WARN", "B.xmp", f"XMP GTS_PDFXVersion {mx.group(1).strip()!r} differs from Info {ver!r}")
            elif mx:
                rep.add("PASS", "B.xmp", "XMP metadata GTS_PDFXVersion agrees with Info")
        except Exception as e:
            rep.add("WARN", "B.xmp", f"XMP metadata stream unreadable: {e}")


# ========================================================================= C
def check_C(ctx, rep):
    root = ctx.pdf.Root
    ois = dget(root, "/OutputIntents")
    if ois is None:
        rep.add("FAIL", "C.outputintents", "Catalog /OutputIntents missing (PDF/X requires a GTS_PDFX output intent)")
        return
    if not isinstance(ois, Array) or len(ois) == 0:
        rep.add("FAIL", "C.outputintents", "Catalog /OutputIntents is not a non-empty array")
        return
    xs = [oi for oi in ois if is_dict(oi) and nstr(dget(oi, "/S")) == "/GTS_PDFX"]
    others = [str(dget(oi, "/S")) for oi in ois if is_dict(oi) and nstr(dget(oi, "/S")) != "/GTS_PDFX"]
    if not xs:
        rep.add("FAIL", "C.outputintents", f"no output intent with /S /GTS_PDFX (found {others})")
        return
    if len(xs) > 1:
        rep.add("FAIL", "C.outputintents", f"{len(xs)} GTS_PDFX output intents; exactly one is allowed")
    else:
        rep.add("PASS", "C.outputintents", "exactly one GTS_PDFX output intent" + (f" (+ other intents {others})" if others else ""))
    oi = xs[0]
    ident = dget(oi, "/OutputConditionIdentifier")
    ident_s = str(ident) if isinstance(ident, String) else None
    if ident_s is None or not ident_s.strip():
        rep.add("FAIL", "C.identifier", "OutputConditionIdentifier missing, empty or not a string")
    else:
        rep.add("PASS", "C.identifier", f"OutputConditionIdentifier {ident_s!r}")
    reg = dget(oi, "/RegistryName")
    cond = dget(oi, "/OutputCondition")
    info = dget(oi, "/Info")
    prof = dget(oi, "/DestOutputProfile")
    if prof is None:
        if reg is None:
            rep.add("FAIL", "C.registry", "no DestOutputProfile and no RegistryName: the printing condition is not identified")
        else:
            rep.add("PASS", "C.registry", f"no embedded profile; RegistryName {str(reg)!r} present")
        known = ident_s in KNOWN_REGISTERED if ident_s else False
        if ident_s and ident_s.strip().lower() == "custom":
            rep.add("FAIL", "C.registry", "identifier 'Custom' names no registered condition, so a DestOutputProfile is required")
        rep.add("WARN", "C.registered-condition",
                f"printing condition referenced by name only: {ident_s!r} -- "
                + ("a registered ICC characterization known to this checker" if known else "NOT in this checker's list of registered characterizations")
                + "; a human must confirm the press/RIP supports it (newsprint: IFRA26 / IFRA30)")
    else:
        if not is_stream(prof):
            rep.add("FAIL", "C.profile", "DestOutputProfile is not a stream")
        else:
            n = dget(prof, "/N")
            try:
                b = prof.read_bytes()
            except Exception as e:
                b = b""
                rep.add("FAIL", "C.profile", f"DestOutputProfile stream cannot be decoded: {e}")
            h = parse_icc(b) if b else None
            probs = []
            if n != 4:
                probs.append(f"/N is {n}, must be 4 (CMYK)")
            if h is None:
                probs.append("not a parsable ICC profile (too short)")
            else:
                if h["magic"] != b"acsp":
                    probs.append("ICC signature 'acsp' missing")
                if h["class"] != "prtr":
                    probs.append(f"device class {h['class']!r}, must be 'prtr' (output)")
                if h["space"] != "CMYK":
                    probs.append(f"data colour space {h['space']!r}, must be 'CMYK'")
                if h["version"][0] >= 4:
                    probs.append(f"ICC version {h['version'][0]}.{h['version'][1]} requires PDF 1.5+ (PDF/X-1a allows v2 profiles)")
            if probs:
                rep.add("FAIL", "C.profile", "DestOutputProfile: " + "; ".join(probs))
            else:
                rep.add("PASS", "C.profile", f"DestOutputProfile: ICC v{h['version'][0]}.{h['version'][1]} prtr/CMYK/{h['pcs'].strip()}, "
                        f"{len(b)} bytes, desc {h['desc']!r}")
            if h is not None and h["size"] != len(b):
                rep.add("WARN", "C.profile", f"ICC header size {h['size']} != stream length {len(b)}")
            if info is None and ident_s not in KNOWN_REGISTERED:
                rep.add("WARN", "C.profile", "/Info should be present when the identifier is not a registered standard condition")
    rep.add("INFO", "C.summary", f"identifier={ident_s!r} condition={str(cond) if cond is not None else None!r} "
            f"registry={str(reg) if reg is not None else None!r} info={str(info) if info is not None else None!r} "
            f"profile={'embedded' if prof is not None else 'none'}")


# ========================================================================= D
def check_D(ctx, rep):
    pdf = ctx.pdf
    groups = defaultdict(list)
    nfail = 0
    pages = list(pdf.pages)
    if not pages:
        rep.add("FAIL", "D.pages", "document has no pages")
        return
    for i, page in enumerate(pages):
        p, pn = page.obj, i + 1
        mb = rect(get_inherited(p, "/MediaBox"))
        if mb is None or mb[2] - mb[0] <= 0 or mb[3] - mb[1] <= 0:
            rep.add("FAIL", "D.boxes", f"p{pn}: MediaBox missing or invalid")
            nfail += 1
            continue
        tb_raw, ab_raw, bb_raw = p.get("/TrimBox"), p.get("/ArtBox"), p.get("/BleedBox")
        cb = rect(get_inherited(p, "/CropBox"))
        if tb_raw is None and ab_raw is None:
            inh = get_inherited(p, "/TrimBox") is not None
            rep.add("FAIL", "D.boxes", f"p{pn}: no TrimBox (or ArtBox) in the page dictionary"
                    + (" -- a TrimBox on a parent Pages node is NOT inherited" if inh else ""))
            nfail += 1
            continue
        if tb_raw is not None and ab_raw is not None:
            rep.add("FAIL", "D.boxes", f"p{pn}: both TrimBox and ArtBox present (PDF/X-1a: one or the other, not both)")
            nfail += 1
        kind = "TrimBox" if tb_raw is not None else "ArtBox"
        tb = rect(tb_raw if tb_raw is not None else ab_raw)
        if tb is None or tb[2] - tb[0] <= 0 or tb[3] - tb[1] <= 0:
            rep.add("FAIL", "D.boxes", f"p{pn}: {kind} invalid or empty")
            nfail += 1
            continue
        bb = None
        if bb_raw is not None:
            bb = rect(bb_raw)
            if bb is None:
                rep.add("FAIL", "D.boxes", f"p{pn}: BleedBox invalid")
                nfail += 1
        if bb is not None:
            if not inside(bb, mb):
                rep.add("FAIL", "D.boxes", f"p{pn}: BleedBox {bb} extends beyond MediaBox {mb}")
                nfail += 1
            if not inside(tb, bb):
                rep.add("FAIL", "D.boxes", f"p{pn}: {kind} {tb} extends beyond BleedBox {bb}")
                nfail += 1
        elif not inside(tb, mb):
            rep.add("FAIL", "D.boxes", f"p{pn}: {kind} {tb} extends beyond MediaBox {mb}")
            nfail += 1
        if cb is not None and not inside(tb, cb):
            rep.add("WARN", "D.boxes", f"p{pn}: {kind} extends beyond CropBox {cb} (effective box is clipped)")
        rot = get_inherited(p, "/Rotate")
        if isnum(rot) and int(rot) % 90:
            rep.add("FAIL", "D.boxes", f"p{pn}: /Rotate {rot} is not a multiple of 90")
        ctx.page_boxes[i] = {"media": mb, "trim": tb, "bleed": bb, "kind": kind}
        bleed = None
        if bb is not None:
            bleed = min(tb[0] - bb[0], tb[1] - bb[1], bb[2] - tb[2], bb[3] - tb[3])
        key = (kind, round(mm(tb[2] - tb[0]), 1), round(mm(tb[3] - tb[1]), 1),
               round(mm(mb[2] - mb[0]), 1), round(mm(mb[3] - mb[1]), 1),
               None if bleed is None else round(mm(bleed), 1), int(rot) if isnum(rot) else 0)
        groups[key].append(pn)
    if nfail == 0:
        rep.add("PASS", "D.boxes", f"all {len(pages)} page(s): MediaBox present, TrimBox/ArtBox in page dict, BleedBox <= MediaBox, Trim <= Bleed/Media")
    for (kind, tw, th, mw, mh, bl, rot), pns in groups.items():
        rep.add("INFO", "D.size", f"pages {page_ranges(pns)}: {kind} {tw} x {th} mm, MediaBox {mw} x {mh} mm, "
                + (f"BleedBox min bleed {bl} mm" if bl is not None else "no BleedBox") + (f", Rotate {rot}" if rot else ""))


# ========================================================================= walk
def run_walk(ctx, rep):
    pdf = ctx.pdf
    w = Walker()
    for i, page in enumerate(pdf.pages):
        p = page.obj
        res = get_inherited(p, "/Resources")
        if res is None:
            w.sw.add("page without /Resources", f"p{i + 1}")
        w.walk(page, res, f"p{i + 1}", key=("page", i))
        annots = dget(p, "/Annots")
        if isinstance(annots, Array):
            for j, a in enumerate(annots):
                ap = dget(dget(a, "/AP"), "/N")
                sub = nstr(dget(a, "/Subtype")) or "?"
                streams = []
                if is_stream(ap):
                    streams = [("", ap)]
                elif is_dict(ap):
                    streams = [(str(k), ap[k]) for k in ap.keys() if is_stream(ap[k])]
                for state, s in streams:
                    w.walk(s, dget(s, "/Resources"), f"p{i + 1}>annot{j}{sub}{state}",
                           key=("ap",) + okey(s, f"p{i + 1}a{j}{state}"))
    ctx.walker = w
    ctx.inv = build_inventory(pdf)
    for k, (name, loc, gs) in w.gs_used.items():
        if k[0] == "R":  # direct ExtGStates are always found by the inventory scan
            ctx.inv.add_gs(k, gs, f"{loc} ({name})")


# ========================================================================= E
def check_E(ctx, rep):
    w = ctx.walker
    if w.bad_colour:
        for line in w.bad_colour.lines():
            rep.add("FAIL", "E.colour", line)
    else:
        rep.add("PASS", "E.colour", "content uses only DeviceCMYK / DeviceGray / Separation|DeviceN with CMYK|Gray alternates (no RGB, ICC, Cal, Lab)")
    used = ", ".join(f"{k} x{v}" for k, v in w.cs_count.most_common(8))
    rep.add("INFO", "E.colour-usage", f"colour selections: {used or 'none'}")
    spots = sorted(n for n in w.spots if n not in PROCESS_COLORANTS)
    if spots:
        rep.add("WARN", "E.spot", f"spot colourants used: {', '.join(spots)} (allowed by PDF/X-1a; a CMYK newspaper press prints process only)")
    if w.defaults:
        for where, n, label in w.defaults:
            st = "WARN" if n == "/DefaultRGB" else "FAIL"
            rep.add(st, "E.default-cs", f"{where}: resource {n} = {label} remaps device colour to a CIE-based space (not allowed in PDF/X-1a)")
    tac = w.tac_max
    where = f" at {w.tac_where}" if w.tac_where else ""
    if w.tac300:
        rep.add("FAIL", "E.tac", f"max total area coverage {tac:.0f}%{where} (> 300%): " + "; ".join(w.tac300.lines()))
    elif w.tac260:
        rep.add("WARN", "E.tac", f"max total area coverage {tac:.0f}%{where} (> 260%; coldset newsprint usually <= 240%)")
    else:
        rep.add("PASS", "E.tac", f"max total area coverage in k/K and DeviceCMYK sc/scn: {tac:.0f}%{where}")
    for line in w.range_bad.lines():
        rep.add("WARN", "E.range", line)
    # unused but defined non-X-1a colour spaces / shadings
    bad_defs = []
    for n, cs, path in ctx.inv.cs_defs:
        ci = classify_cs(cs)
        if not ci.ok:
            bad_defs.append(f"{path}/ColorSpace{n}={ci.label}")
    if bad_defs:
        rep.add("WARN", "E.defined-cs", f"{len(bad_defs)} non-X-1a colour space definition(s) in resource dictionaries (FAIL above if used): {examples(bad_defs)}")
    unused_sh = []
    for k, (sh, path) in ctx.inv.shadings.items():
        if k in w.used_shadings:
            continue
        ci = classify_cs(dget(sh, "/ColorSpace"))
        if not ci.ok:
            unused_sh.append(f"{path}={ci.label}")
    if unused_sh:
        rep.add("WARN", "E.defined-cs", f"unused shading(s) with non-X-1a colour: {examples(unused_sh)}")


# ========================================================================= F
def check_F(ctx, rep):
    inv = ctx.inv
    bad = []
    for key, (gs, label) in inv.extgstates.items():
        probs = []
        sm = gs.get("/SMask")
        if sm is not None and nstr(sm) != "/None":
            probs.append("SMask (soft mask)")
        for k in ("/CA", "/ca"):
            v = gs.get(k)
            if v is not None:
                if not isnum(v):
                    probs.append(f"{k[1:]} not a number")
                elif float(v) < 1.0:
                    probs.append(f"{k[1:]}={float(v):g}")
        bm = gs.get("/BM")
        if bm is not None:
            names = [str(bm)] if isinstance(bm, Name) else [str(x) for x in bm] if isinstance(bm, Array) else ["?"]
            badbm = [n for n in names if n not in ("/Normal", "/Compatible")]
            if badbm:
                probs.append("BM=" + ",".join(badbm))
        if probs:
            bad.append(f"{label}: {', '.join(probs)}")
    if bad:
        rep.add("FAIL", "F.extgstate", f"{len(bad)} ExtGState(s) use transparency: " + "; ".join(bad[:6]))
    else:
        rep.add("PASS", "F.extgstate", f"{len(inv.extgstates)} ExtGState(s): no SMask, CA/ca = 1, BM Normal/Compatible")
    tg = inv.flags.get("transparency_group")
    if tg:
        rep.add("FAIL", "F.group", f"transparency group(s) (/Group /S /Transparency): {examples(tg)}")
    else:
        rep.add("PASS", "F.group", "no transparency groups on pages or forms")
    sm_imgs = []
    for k, (img, path) in inv.images.items():
        if "/SMask" in img:
            sm_imgs.append(f"{path} SMask")
        v = img.get("/SMaskInData")
        if isnum(v) and int(v) != 0:
            sm_imgs.append(f"{path} SMaskInData={v}")
    if sm_imgs:
        rep.add("FAIL", "F.image-smask", f"image soft masks: {examples(sm_imgs)}")
    else:
        rep.add("PASS", "F.image-smask", f"no image soft masks ({len(inv.images)} image XObject(s) checked)")
    if inv.flags.get("annot_ca"):
        rep.add("WARN", "F.annot-ca", f"annotation opacity /CA < 1: {examples(inv.flags['annot_ca'])}")


# ========================================================================= G
def _image_problems(img, ctx):
    probs = []  # (severity, msg)
    imask = img.get("/ImageMask") is True
    filters = filter_names(img.get("/Filter"))
    if "/JPXDecode" in filters:
        probs.append(("FAIL", "JPXDecode (JPEG 2000, PDF 1.5)"))
    if "/JBIG2Decode" in filters:
        if ctx.flavour == "2001" or (ctx.eff_ver or (1, 3)) < (1, 4):
            probs.append(("FAIL", "JBIG2Decode (PDF 1.4) in a PDF 1.3 / X-1a:2001 file"))
    if "/LZWDecode" in filters:
        probs.append(("WARN", "LZWDecode"))
    if "/Crypt" in filters:
        probs.append(("FAIL", "Crypt filter (PDF 1.5)"))
    cs = img.get("/ColorSpace")
    label = "ImageMask" if imask else None
    if imask:
        if cs is not None:
            probs.append(("FAIL", "ImageMask image must not have /ColorSpace"))
    elif cs is None:
        probs.append(("FAIL", "no /ColorSpace"))
    else:
        ci = classify_cs(cs)
        label = ci.label
        if not ci.ok:
            probs.append(("FAIL", f"colour space {ci.label}"))
    bpc = img.get("/BitsPerComponent")
    if isnum(bpc) and int(bpc) == 16:
        probs.append(("FAIL", "16 bits per component (PDF 1.5)"))
    if "/OPI" in img:
        probs.append(("FAIL", "OPI dictionary"))
    if "/Alternates" in img:
        probs.append(("WARN", "/Alternates (alternate images)"))
    return probs, label or "?", filters


def check_G(ctx, rep):
    inv, w = ctx.inv, ctx.walker
    if not inv.images and not w.inline:
        rep.add("INFO", "G.images", "no images")
        return
    cs_c, f_c = Counter(), Counter()
    nfail = 0
    for k, (img, path) in inv.images.items():
        used = k in w.used_images
        probs, label, filters = _image_problems(img, ctx)
        cs_c[label] += 1
        for f in filters or ["(none)"]:
            f_c[f] += 1
        where = w.used_images.get(k) or "unused"
        for sev, msg in probs:
            if sev == "FAIL" and not used:
                sev = "WARN"
                msg += " (image not used on any page)"
            if sev == "FAIL":
                nfail += 1
            rep.add(sev, "G.image", f"{path} [{where}] {img.get('/Width')}x{img.get('/Height')}: {msg}")
    for loc, ci, filters, imask, bpc in w.inline:
        label = "ImageMask" if imask else ci.label
        cs_c[label + " (inline)"] += 1
        if ci is not None and not ci.ok:
            nfail += 1
            rep.add("FAIL", "G.inline-image", f"{loc}: inline image colour space {ci.label}")
        if "/LZWDecode" in filters:
            rep.add("WARN", "G.inline-image", f"{loc}: LZWDecode")
        if isnum(bpc) and int(bpc) == 16:
            nfail += 1
            rep.add("FAIL", "G.inline-image", f"{loc}: 16 bits per component")
    used_n = sum(1 for k in inv.images if k in w.used_images)
    summary = (f"{len(inv.images)} image XObject(s) ({used_n} used), {len(w.inline)} inline; colour: "
               + ", ".join(f"{k} x{v}" for k, v in cs_c.most_common()) + "; filters: "
               + ", ".join(f"{k[1:] if k.startswith('/') else k} x{v}" for k, v in f_c.most_common()))
    rep.add("PASS" if nfail == 0 else "INFO", "G.images", summary)


# ========================================================================= H
def font_program(fd):
    for k in ("/FontFile", "/FontFile2", "/FontFile3"):
        s = dget(fd, k)
        if s is not None:
            return k, s
    return None, None


class Widths:
    def __init__(self, warr):
        self.map, self.ranges, self.problems = {}, [], []
        if warr is None:
            return
        if not isinstance(warr, Array):
            self.problems.append(("FAIL", "/W is not an array"))
            return
        items, i = list(warr), 0
        while i < len(items):
            a = items[i]
            if not isnum(a):
                self.problems.append(("FAIL", f"malformed /W array at element {i}"))
                return
            if i + 1 < len(items) and isinstance(items[i + 1], Array):
                for j, x in enumerate(items[i + 1]):
                    if isnum(x):
                        self.map[int(a) + j] = float(x)
                i += 2
            elif i + 2 < len(items) and isnum(items[i + 1]) and isnum(items[i + 2]):
                self.ranges.append((int(a), int(items[i + 1]), float(items[i + 2])))
                i += 3
            else:
                self.problems.append(("FAIL", f"malformed /W array at element {i}"))
                return

    def get(self, cid, dflt):
        v = self.map.get(cid)
        if v is not None:
            return v
        for lo, hi, w in self.ranges:
            if lo <= cid <= hi:
                return w
        return dflt


def _load_ttf(data):
    from fontTools.ttLib import TTFont
    return TTFont(io.BytesIO(data))


def _ttf_checks(data, uses, wfun, tmap, gidmap):
    """uses: iterable of (nbytes, code, cid). wfun(cid)->PDF width."""
    out, facts = [], []
    with _LogCapture("fontTools") as cap:
        try:
            tt = _load_ttf(data)
            if tt.sfntVersion == "OTTO":
                return [("FAIL", "FontFile2 holds a CFF-flavoured OpenType font (FontFile2 must be TrueType/glyf)")], facts
            missing = [t for t in ("head", "hhea", "hmtx", "maxp", "loca", "glyf") if t not in tt]
            if missing:
                return [("FAIL", f"embedded TrueType lacks required table(s): {', '.join(missing)}")], facts
            upem = tt["head"].unitsPerEm
            nglyphs = tt["maxp"].numGlyphs
            go = tt.getGlyphOrder()
            glyf, hmtx = tt["glyf"], tt["hmtx"]
            oob, beyond, notdef, empties, spaces, wbad, gerr = [], [], [], [], [], [], []
            maxd, n_used = 0.0, 0
            for n, code, cid in uses:
                n_used += 1
                if gidmap is None:
                    gid = cid
                elif 2 * cid + 1 < len(gidmap):
                    gid = int.from_bytes(gidmap[2 * cid:2 * cid + 2], "big")
                else:
                    beyond.append(cid)
                    continue
                if gid >= nglyphs or gid >= len(go):
                    oob.append(cid)
                    continue
                if gid == 0:
                    notdef.append(cid)
                gname = go[gid]
                try:
                    g = glyf[gname]
                    empty = getattr(g, "numberOfContours", 0) == 0
                except Exception as e:
                    gerr.append(f"{cid}:{e}")
                    continue
                if empty and gid != 0:
                    uni = tmap.get((n, code)) if tmap is not None else None
                    if uni and all(ch in SPACE_LIKE for ch in uni):
                        spaces.append(cid)
                    else:
                        empties.append(f"{cid}->{uni!r}" if uni is not None else str(cid))
                adv = hmtx[gname][0]
                exp = adv * 1000.0 / upem
                pw = wfun(cid)
                d = abs(pw - exp)
                maxd = max(maxd, d)
                if d > 1.0:
                    wbad.append(f"cid {cid}: W={pw:g} vs hmtx {exp:.1f}")
            facts.append(f"{nglyphs} glyphs, upem {upem}, {n_used} distinct code(s) used, max |W-hmtx| {maxd:.2f}")
            if oob:
                out.append(("FAIL", f"{len(oob)} used CID(s) map to a GID >= numGlyphs ({nglyphs}): {examples(oob, 8)}"))
            if beyond:
                out.append(("FAIL", f"{len(beyond)} used CID(s) lie beyond the CIDToGIDMap stream: {examples(beyond, 8)}"))
            if gerr:
                out.append(("FAIL", f"glyph outlines unreadable: {examples(gerr)}"))
            if wbad:
                out.append(("FAIL", f"{len(wbad)} used glyph(s) whose PDF width differs from the font's hmtx by > 1/1000 em: {examples(wbad, 4)}"))
            if notdef:
                out.append(("WARN", f"{len(notdef)} used code(s) map to GID 0 (.notdef) -- missing glyphs: {examples(notdef, 8)}"))
            if empties:
                out.append(("WARN", f"{len(empties)} used glyph(s) have an empty outline and no space-like ToUnicode (space/NBSP?): {examples(empties, 6)}"))
            if spaces:
                facts.append(f"{len(spaces)} empty glyph(s) are spaces per ToUnicode")
            if "OS/2" in tt:
                fs = tt["OS/2"].fsType
                if fs & 0x0002:
                    out.append(("WARN", f"OS/2 fsType {fs:#06x}: restricted-licence embedding"))
                if fs & 0x0200:
                    out.append(("WARN", f"OS/2 fsType {fs:#06x}: bitmap-only embedding"))
        except Exception as e:
            out.append(("FAIL", f"embedded TrueType program cannot be parsed by fontTools: {type(e).__name__}: {e}"))
    if cap.msgs:
        out.append(("WARN", f"fontTools warnings while parsing the program: {examples(cap.msgs, 2)}"))
    return out, facts


def _type0_codes(codes, enc):
    """Return (list of (nbytes, code, cid) or None, encoding label, problems)."""
    if isinstance(enc, Name):
        e = str(enc)
        if e in ("/Identity-H", "/Identity-V"):
            out, odd = set(), 0
            for s in codes:
                if len(s) % 2:
                    odd += 1
                for i in range(0, len(s) - 1, 2):
                    c = (s[i] << 8) | s[i + 1]
                    out.add((2, c, c))
            probs = [("FAIL", f"{odd} shown string(s) have an odd byte count under {e[1:]} (2-byte codes)")] if odd else []
            return sorted(out), e[1:], probs
        return None, e[1:], [("WARN", f"predefined CMap {e[1:]}: CID decoding not supported here; per-glyph checks skipped")]
    if is_stream(enc):
        try:
            cm = parse_cmap(enc.read_bytes())
        except Exception as ex:
            return None, "embedded CMap", [("WARN", f"embedded CMap unparsable: {ex}")]
        probs = []
        if cm.usecmap:
            probs.append(("WARN", f"embedded CMap uses usecmap {cm.usecmap}; parent mappings not resolved"))
        if not cm.codespace:
            return None, "embedded CMap", probs + [("FAIL", "embedded CMap has no codespace ranges")]
        out, bad = set(), 0
        for s in codes:
            for n, code in split_codes(s, cm.codespace):
                if n is None:
                    bad += 1
                    continue
                cid = cm.cid_lookup(n, code)
                out.add((n, code, cid if cid is not None else 0))
        if bad:
            probs.append(("FAIL", f"{bad} byte(s) of shown text match no codespace range"))
        return sorted(out), "embedded CMap", probs
    return None, "?", [("FAIL", "Type0 /Encoding missing or invalid")]


def _analyze_type0(f, fu):
    out, facts = [], []
    df = dget(f, "/DescendantFonts")
    if not isinstance(df, Array) or len(df) != 1 or not is_dict(df[0]):
        return [("FAIL", "DescendantFonts must be an array holding exactly one CIDFont dictionary")], facts
    cf = df[0]
    csub = nstr(dget(cf, "/Subtype"))
    facts.append((csub or "/?")[1:])
    if csub not in ("/CIDFontType0", "/CIDFontType2"):
        out.append(("FAIL", f"invalid CIDFont subtype {csub}"))
    fd = dget(cf, "/FontDescriptor")
    kind, prog = font_program(fd) if is_dict(fd) else (None, None)
    if not is_dict(fd):
        out.append(("FAIL", "CIDFont has no /FontDescriptor -> font NOT embedded"))
    elif prog is None:
        out.append(("FAIL", "font program NOT embedded (no FontFile/FontFile2/FontFile3)"))
    else:
        ps = nstr(dget(prog, "/Subtype"))
        if csub == "/CIDFontType2" and kind != "/FontFile2":
            out.append(("FAIL", f"CIDFontType2 must embed FontFile2, found {kind[1:]}"))
        if csub == "/CIDFontType0":
            if ps == "/OpenType":
                out.append(("FAIL", "FontFile3/OpenType is a PDF 1.6 feature"))
            elif kind != "/FontFile3" or ps != "/CIDFontType0C":
                out.append(("FAIL", "CIDFontType0 must embed FontFile3 /Subtype /CIDFontType0C"))
        try:
            facts.append(f"embedded {kind[1:]} {len(prog.read_bytes()) / 1024:.1f} KB")
        except Exception as e:
            out.append(("FAIL", f"font program stream cannot be decoded: {e}"))
            prog = None
    csi = dget(cf, "/CIDSystemInfo")
    if not is_dict(csi) or any(k not in csi for k in ("/Registry", "/Ordering", "/Supplement")):
        out.append(("FAIL", "CIDSystemInfo missing or incomplete (Registry/Ordering/Supplement)"))
    else:
        facts.append(f"{csi.get('/Registry')}-{csi.get('/Ordering')}-{csi.get('/Supplement')}")
    uses, enc_label, probs = _type0_codes(fu.codes, dget(f, "/Encoding"))
    facts.insert(1, enc_label)
    out += probs
    tu, tmap = dget(f, "/ToUnicode"), None
    if tu is None:
        out.append(("WARN", "no /ToUnicode CMap (text extraction/search will not work)"))
    elif not is_stream(tu):
        out.append(("WARN", "/ToUnicode is not a stream"))
    else:
        try:
            tmap = parse_cmap(tu.read_bytes()).bf
            if uses is not None:
                unm = [c for n, c, _ in uses if (n, c) not in tmap]
                if unm:
                    out.append(("WARN", f"{len(unm)} used code(s) have no ToUnicode mapping: {examples([hex(c) for c in unm], 6)}"))
                else:
                    facts.append("ToUnicode covers all used codes")
        except Exception as e:
            out.append(("WARN", f"ToUnicode CMap unparsable: {e}"))
    W = Widths(dget(cf, "/W"))
    out += W.problems
    dw = dget(cf, "/DW", 1000)
    dw = float(dw) if isnum(dw) else 1000.0
    if csub == "/CIDFontType2" and kind == "/FontFile2" and prog is not None:
        c2g = dget(cf, "/CIDToGIDMap")
        gidmap = None
        if c2g is None:
            out.append(("WARN", "/CIDToGIDMap missing (defaults to Identity; some RIPs/validators want it explicit)"))
        elif nstr(c2g) == "/Identity":
            facts.append("CIDToGIDMap Identity")
        elif is_stream(c2g):
            gidmap = c2g.read_bytes()
            facts.append(f"CIDToGIDMap stream ({len(gidmap) // 2} CIDs)")
        else:
            out.append(("FAIL", f"invalid /CIDToGIDMap {short(c2g)}"))
        if uses is not None:
            o2, f2 = _ttf_checks(prog.read_bytes(), uses, lambda cid: W.get(cid, dw), tmap, gidmap)
            out += o2
            facts += f2
    elif csub == "/CIDFontType0" and prog is not None and kind == "/FontFile3":
        try:
            from fontTools.cffLib import CFFFontSet
            cff = CFFFontSet()
            cff.decompile(io.BytesIO(prog.read_bytes()), None)
            facts.append(f"CFF parses ({len(cff.fontNames)} font)")
        except Exception as e:
            out.append(("FAIL", f"embedded CFF program cannot be parsed: {e}"))
        out.append(("WARN", "CIDFontType0 (CFF): glyph-count/width cross-check not implemented"))
    return out, facts


def _simple_tt_mapper(tt, f, fd):
    from fontTools import agl
    subt = {}
    if "cmap" in tt:
        for pid, eid in ((3, 0), (3, 1), (1, 0)):
            t = tt["cmap"].getcmap(pid, eid)
            if t is not None:
                subt[(pid, eid)] = t.cmap
    flags = dget(fd, "/Flags", 0)
    symbolic = bool(int(flags) & 4) if isnum(flags) else False
    enc = dget(f, "/Encoding")
    base, diffs = None, {}
    if isinstance(enc, Name):
        base = str(enc)
    elif is_dict(enc):
        be = dget(enc, "/BaseEncoding")
        base = str(be) if isinstance(be, Name) else None
        d = dget(enc, "/Differences")
        if isinstance(d, Array):
            c = None
            for x in d:
                if isnum(x):
                    c = int(x)
                elif isinstance(x, Name) and c is not None:
                    diffs[c] = str(x)[1:]
                    c += 1
    rev = set(tt.getGlyphOrder())

    def mapper(code):
        if (3, 0) in subt and (symbolic or (3, 1) not in subt):
            for cand in (code, 0xF000 + code, 0xF100 + code, 0xF200 + code):
                g = subt[(3, 0)].get(cand)
                if g:
                    return g
        if code in diffs:
            gname = diffs[code]
            u = agl.toUnicode(gname)
            if u and (3, 1) in subt and subt[(3, 1)].get(ord(u[0])):
                return subt[(3, 1)][ord(u[0])]
            if gname in rev:
                return gname
        codec = {"/WinAnsiEncoding": "cp1252", "/MacRomanEncoding": "mac_roman"}.get(base, None if symbolic else "cp1252")
        if codec and (3, 1) in subt:
            try:
                u = bytes([code]).decode(codec)
                g = subt[(3, 1)].get(ord(u))
                if g:
                    return g
            except UnicodeDecodeError:
                pass
        if (1, 0) in subt:
            return subt[(1, 0)].get(code)
        return None
    return mapper


def _analyze_simple(f, fu, sub):
    out, facts = [], []
    base = nstr(dget(f, "/BaseFont")) or "?"
    fd = dget(f, "/FontDescriptor")
    if not is_dict(fd):
        std = " (standard-14 font)" if base in STD14 else ""
        return [("FAIL", f"NOT embedded: no FontDescriptor{std} -- PDF/X-1a requires every font to be embedded")], facts
    kind, prog = font_program(fd)
    if prog is None:
        return [("FAIL", "NOT embedded: descriptor has no FontFile/FontFile2/FontFile3")], facts
    ps = nstr(dget(prog, "/Subtype"))
    if kind == "/FontFile3" and ps == "/OpenType":
        out.append(("FAIL", "FontFile3/OpenType is a PDF 1.6 feature"))
    elif sub in ("/Type1", "/MMType1") and not (kind == "/FontFile" or (kind == "/FontFile3" and ps == "/Type1C")):
        out.append(("FAIL", f"Type1 font embedded as {kind[1:]}{'/' + ps[1:] if ps else ''} (expected FontFile or FontFile3/Type1C)"))
    elif sub == "/TrueType" and kind != "/FontFile2":
        out.append(("FAIL", f"TrueType font embedded as {kind[1:]} (expected FontFile2)"))
    try:
        data = prog.read_bytes()
        facts.append(f"embedded {kind[1:]}{'/' + ps[1:] if ps else ''} {len(data) / 1024:.1f} KB")
    except Exception as e:
        return out + [("FAIL", f"font program stream cannot be decoded: {e}")], facts
    if kind == "/FontFile" and not all(k in prog for k in ("/Length1", "/Length2", "/Length3")):
        out.append(("WARN", "FontFile lacks /Length1, /Length2 or /Length3"))
    fc, lc, wa = dget(f, "/FirstChar"), dget(f, "/LastChar"), dget(f, "/Widths")
    if not (isnum(fc) and isnum(lc) and isinstance(wa, Array)):
        out.append(("FAIL" if base not in STD14 else "WARN", "FirstChar/LastChar/Widths missing"))
        fc = lc = wa = None
    elif len(wa) != int(lc) - int(fc) + 1:
        out.append(("FAIL", f"/Widths has {len(wa)} entries, FirstChar..LastChar needs {int(lc) - int(fc) + 1}"))
    used = sorted({b for s in fu.codes for b in s})
    facts.append(f"{len(used)} distinct code(s) used")
    if wa is not None:
        outside = [c for c in used if not (int(fc) <= c <= int(lc))]
        if outside:
            out.append(("WARN", f"{len(outside)} used code(s) outside FirstChar..LastChar (MissingWidth applies): {examples(outside, 8)}"))
    if sub == "/TrueType" and kind == "/FontFile2":
        with _LogCapture("fontTools") as cap:
            try:
                tt = _load_ttf(data)
                missing = [t for t in ("head", "hhea", "hmtx", "maxp", "loca", "glyf") if t not in tt]
                if missing:
                    out.append(("FAIL", f"embedded TrueType lacks table(s): {', '.join(missing)}"))
                elif wa is not None:
                    upem, hmtx = tt["head"].unitsPerEm, tt["hmtx"]
                    mapper = _simple_tt_mapper(tt, f, fd)
                    mw = dget(fd, "/MissingWidth", 0)
                    unm, wbad, maxd = [], [], 0.0
                    for c in used:
                        g = mapper(c)
                        if g is None:
                            unm.append(c)
                            continue
                        pw = float(wa[c - int(fc)]) if int(fc) <= c <= int(lc) and c - int(fc) < len(wa) else float(mw)
                        exp = hmtx[g][0] * 1000.0 / upem
                        maxd = max(maxd, abs(pw - exp))
                        if abs(pw - exp) > 1.0:
                            wbad.append(f"code {c} ({g}): Widths={pw:g} vs hmtx {exp:.1f}")
                    if wbad:
                        out.append(("FAIL", f"{len(wbad)} used glyph(s) whose /Widths differ from hmtx by > 1/1000 em: {examples(wbad, 4)}"))
                    if unm:
                        out.append(("WARN", f"{len(unm)} used code(s) could not be mapped to a glyph via the font cmap: {examples(unm, 8)}"))
                    facts.append(f"upem {upem}, max |Widths-hmtx| {maxd:.2f}")
            except Exception as e:
                out.append(("FAIL", f"embedded TrueType cannot be parsed by fontTools: {type(e).__name__}: {e}"))
        if cap.msgs:
            out.append(("WARN", f"fontTools warnings: {examples(cap.msgs, 2)}"))
    elif kind == "/FontFile3" and ps == "/Type1C":
        try:
            from fontTools.cffLib import CFFFontSet
            cff = CFFFontSet()
            cff.decompile(io.BytesIO(data), None)
            facts.append("CFF parses; width cross-check not implemented for CFF")
        except Exception as e:
            out.append(("FAIL", f"embedded CFF (Type1C) cannot be parsed: {e}"))
    if dget(f, "/ToUnicode") is None:
        facts.append("no ToUnicode")
    return out, facts


def check_H(ctx, rep):
    w, inv = ctx.walker, ctx.inv
    if not w.fonts:
        rep.add("INFO", "H.fonts", "no fonts used by any content stream")
    for k, fu in w.fonts.items():
        f = fu.font
        sub = nstr(dget(f, "/Subtype")) or "/?"
        base = nstr(dget(f, "/BaseFont")) or "/(no BaseFont)"
        lab = f"{fu.resname} {base[1:]} [{sub[1:]}] (first use {fu.where})"
        if sub == "/Type3":
            rep.add("PASS", "H.font", f"{lab}: Type3 font -- glyph procedures checked as content (allowed in PDF/X-1a)")
            continue
        if sub == "/Type0":
            out, facts = _analyze_type0(f, fu)
        elif sub in ("/Type1", "/MMType1", "/TrueType"):
            out, facts = _analyze_simple(f, fu, sub)
        else:
            out, facts = [("FAIL", f"unknown font subtype {sub}")], []
        for sev, msg in out:
            rep.add(sev, "H.font", f"{lab}: {msg}")
        if not any(s == "FAIL" for s, _ in out):
            rep.add("PASS", "H.font", f"{lab}: embedded; " + "; ".join(facts))
        else:
            rep.add("INFO", "H.font", f"{lab}: " + "; ".join(facts))
    unused_bad = []
    for k, (f, path) in inv.fonts.items():
        if k in w.fonts or nstr(dget(f, "/Subtype")) == "/Type3":
            continue
        fd = dget(f, "/FontDescriptor")
        if nstr(dget(f, "/Subtype")) == "/Type0":
            df = dget(f, "/DescendantFonts")
            fd = dget(df[0], "/FontDescriptor") if isinstance(df, Array) and len(df) else None
        if not is_dict(fd) or font_program(fd)[1] is None:
            unused_bad.append(f"{path} {dget(f, '/BaseFont')}")
    if unused_bad:
        rep.add("WARN", "H.unused-fonts", f"non-embedded font(s) present but not used by content: {examples(unused_bad)}")


# ========================================================================= I
def check_I(ctx, rep):
    inv, w, pdf = ctx.inv, ctx.walker, ctx.pdf
    root = pdf.Root
    js = list(inv.flags.get("js", []))
    oa = dget(root, "/OpenAction")
    if js:
        rep.add("FAIL", "I.javascript", f"JavaScript present: {examples(js)}")
    else:
        rep.add("PASS", "I.javascript", "no JavaScript (no /JS, no JavaScript actions, no JavaScript name tree)")
    if oa is not None:
        st = nstr(dget(oa, "/S")) if is_dict(oa) else None
        rep.add("INFO", "I.actions", f"/OpenAction present ({st or 'destination'})")
    if inv.flags.get("aa"):
        rep.add("WARN", "I.actions", f"additional-actions (/AA) dictionaries: {examples(inv.flags['aa'])}")
    if inv.flags.get("risky_action"):
        rep.add("WARN", "I.actions", f"interactive actions not meaningful for print: {examples(inv.flags['risky_action'])}")
    # annotations
    inside_trim, in_bleed, unplaced, outside, marks = [], [], [], 0, 0
    for i, page in enumerate(pdf.pages):
        annots = dget(page.obj, "/Annots")
        boxes = ctx.page_boxes.get(i)
        if not isinstance(annots, Array):
            continue
        for j, a in enumerate(annots):
            sub = nstr(dget(a, "/Subtype")) or "/?"
            if sub in ("/PrinterMark", "/TrapNet"):
                marks += 1
                continue
            r = rect(dget(a, "/Rect"))
            lab = f"p{i + 1} annot#{j} {sub[1:]}"
            if r is None:
                inside_trim.append(lab + " (no valid /Rect)")
            elif boxes is None:
                unplaced.append(lab)
            elif overlaps(r, boxes["trim"]):
                inside_trim.append(lab)
            elif boxes["bleed"] is not None and overlaps(r, boxes["bleed"]):
                in_bleed.append(lab)
            else:
                outside += 1
    if inside_trim:
        rep.add("FAIL", "I.annotations", f"{len(inside_trim)} annotation(s) other than PrinterMark/TrapNet inside the TrimBox/ArtBox: {examples(inside_trim)}")
    else:
        rep.add("PASS", "I.annotations", f"no annotations inside the TrimBox other than PrinterMark/TrapNet ({marks} mark/trap, {outside} outside bleed)")
    if in_bleed:
        rep.add("WARN", "I.annotations", f"annotation(s) in the bleed area: {examples(in_bleed)}")
    if unplaced:
        rep.add("WARN", "I.annotations", f"annotation(s) on pages without valid boxes (see D) could not be placed: {examples(unplaced)}")
    if dget(root, "/AcroForm") is not None:
        rep.add("WARN", "I.acroform", "interactive form (/AcroForm) present")
    if inv.flags.get("xfa"):
        rep.add("FAIL", "I.acroform", "XFA form data present")
    for flag, cid, what in (("embedded", "I.embedded-files", "embedded files"),
                            ("ocproperties", "I.optional-content", "/OCProperties (optional content, PDF 1.5)")):
        if inv.flags.get(flag):
            rep.add("FAIL", cid, f"{what}: {examples(inv.flags[flag])}")
        else:
            rep.add("PASS", cid, f"no {what}")
    ocx = inv.flags.get("oc", []) + inv.flags.get("ocg", []) + w.oc_refs
    if ocx:
        rep.add("FAIL", "I.optional-content", f"optional-content references (/OC, OCG/OCMD, BDC /OC): {examples(ocx)}")
    ps = inv.flags.get("ps_xobject", []) + w.ps_xobjects + w.ps_ops
    if ps:
        rep.add("FAIL", "I.postscript", f"PostScript XObjects / PS operator: {examples(ps)}")
    else:
        rep.add("PASS", "I.postscript", "no PostScript XObjects, Subtype2 /PS forms or PS operators")
    tr_bad, ht = [], []
    for k, (gs, label) in inv.extgstates.items():
        for key in ("/TR", "/TR2"):
            v = gs.get(key)
            if v is not None and nstr(v) != "/Default":
                tr_bad.append(f"{label} {key[1:]}={short(v, 20)}")
        h = gs.get("/HT")
        if h is not None and nstr(h) != "/Default":
            extra = " with TransferFunction" if is_dictlike(h) and "/TransferFunction" in h else ""
            ht.append(f"{label} HT{extra}")
    if tr_bad:
        rep.add("FAIL", "I.transfer", f"transfer functions in ExtGState: {examples(tr_bad)}")
    else:
        rep.add("PASS", "I.transfer", "no transfer functions (TR/TR2 absent or /Default)")
    if ht:
        rep.add("WARN", "I.halftone", f"halftone dictionaries in ExtGState (press/RIP should own screening): {examples(ht)}")
    if inv.flags.get("opi"):
        rep.add("FAIL", "I.opi", f"OPI dictionaries: {examples(inv.flags['opi'])}")


# ========================================================================= J
def check_J(ctx, rep):
    w, inv = ctx.walker, ctx.inv
    ops = []
    for k, (gs, label) in inv.extgstates.items():
        bits = [f"{key[1:]}={gs.get(key)}" for key in ("/OP", "/op", "/OPM") if key in gs]
        if bits:
            ops.append(f"{label}: {' '.join(bits)}")
    if ops:
        rep.add("INFO", "J.overprint", f"{len(ops)} ExtGState(s) set overprint: {examples(ops, 4)}; "
                f"{w.op_fill_paints} fill paint operation(s) with overprint on")
    else:
        rep.add("INFO", "J.overprint", "no ExtGState sets OP/op/OPM (everything knocks out)")
    if w.white_op:
        for line in w.white_op.lines():
            rep.add("WARN", "J.white-overprint", line + " -- white set to overprint disappears on press")
    else:
        rep.add("PASS", "J.white-overprint", "no white (0 0 0 0 k / 1 g / 0-tint) fills or strokes painted with overprint on")


# ========================================================================= K
def check_K(ctx, rep):
    w = ctx.walker
    if w.mcf:
        for line in w.mcf.lines():
            rep.add("FAIL", "K.marked-content", line)
    else:
        rep.add("PASS", "K.marked-content", f"BMC/BDC/EMC balanced in all {w.streams} content stream(s); none crosses a BT/ET boundary ({w.bdc} BDC)")
    hv = f"{ctx.eff_ver[0]}.{ctx.eff_ver[1]}" if ctx.eff_ver else "?"
    if w.actualtext and ctx.eff_ver and ctx.eff_ver < (1, 5):
        rep.add("WARN", "K.actualtext", f"{w.actualtext} ActualText span(s) in a PDF {hv} file (ActualText marked content is PDF 1.5; "
                "tolerated -- Adobe InDesign PDF/X-1a exports contain it)")
    else:
        rep.add("INFO", "K.actualtext", f"{w.actualtext} ActualText span(s); PDF version {hv}")


# ========================================================================= L
def check_L(ctx, rep):
    try:
        import pdfminer
        from pdfminer.high_level import extract_text
        logging.getLogger("pdfminer").setLevel(logging.ERROR)
        text = extract_text(ctx.path)
    except Exception as e:
        rep.add("WARN", "L.text", f"pdfminer could not extract text: {type(e).__name__}: {e}")
        return
    ph = re.findall(r"\(cid:\d+\)", text)
    rest = re.sub(r"\(cid:\d+\)", "", text)
    chars = sum(1 for ch in rest if not ch.isspace())
    total = chars + len(ph)
    share = len(ph) / total if total else 0.0
    repl = rest.count("�")
    msg = (f"pdfminer.six {getattr(pdfminer, '__version__', '?')}: {chars} non-space character(s), "
           f"{len(ph)} '(cid:N)' placeholder(s) = {share:.1%}" + (f", {repl} U+FFFD" if repl else ""))
    if total == 0:
        rep.add("WARN", "L.text", msg + " -- no extractable text")
    elif share > 0.05:
        rep.add("WARN", "L.text", msg + " (> 5% unmapped glyphs)")
    else:
        rep.add("PASS", "L.text", msg)


# ========================================================================= M
def check_M(ctx, rep):
    try:
        import pypdfium2 as pdfium
    except Exception as e:
        rep.add("WARN", "M.pdfium", f"pypdfium2 unavailable: {e}")
        return
    try:
        doc = pdfium.PdfDocument(ctx.path)
    except Exception as e:
        rep.add("FAIL", "M.pdfium", f"PDFium cannot open the file: {e}")
        return
    try:
        n = len(doc)
        errs, nchar = [], 0
        for i in range(n):
            try:
                page = doc[i]
                bm = page.render(scale=24 / 72)
                bm.close()
                tp = page.get_textpage()
                nchar += sum(1 for ch in tp.get_text_bounded() if not ch.isspace())
                tp.close()
                page.close()
            except Exception as e:
                errs.append(f"p{i + 1}: {e}")
        npk = len(ctx.pdf.pages)
        if errs:
            rep.add("FAIL", "M.pdfium", f"PDFium render errors: {examples(errs)}")
        elif n != npk:
            rep.add("FAIL", "M.pdfium", f"PDFium sees {n} page(s), qpdf {npk}")
        else:
            rep.add("PASS", "M.pdfium", f"PDFium opened and rendered all {n} page(s) at 24 dpi; PDFium text layer: {nchar} non-space character(s)")
    finally:
        doc.close()


# ========================================================================= main
def run(path):
    rep = Report()
    ctx = Ctx(path)
    try:
        check_A(ctx, rep)
    except Exception as e:
        rep.add("FAIL", "A.internal", f"checker error, could not verify: {type(e).__name__}: {e}")
    if ctx.pdf is None:
        return rep, ctx
    steps = [("B", check_B), ("C", check_C), ("D", check_D), ("E", run_walk), ("A", report_content_syntax),
             ("E", check_E), ("F", check_F), ("G", check_G), ("H", check_H), ("I", check_I), ("J", check_J),
             ("K", check_K), ("L", check_L), ("M", check_M)]
    needs_walk = (report_content_syntax, check_E, check_F, check_G, check_H, check_I, check_J, check_K)
    for letter, fn in steps:
        if fn in needs_walk and (ctx.walker is None or ctx.inv is None):
            rep.add("FAIL", f"{letter}.internal", f"{fn.__name__} not run: content walk / object inventory unavailable")
            continue
        try:
            fn(ctx, rep)
        except Exception as e:
            rep.add("FAIL", f"{letter}.internal", f"checker error in {fn.__name__}, could not verify: {type(e).__name__}: {e}")
    return rep, ctx


def main(argv=None):
    ap = argparse.ArgumentParser(description="Independent PDF/X-1a conformance checker (ISO 15930-1:2001 / 15930-4:2003)")
    ap.add_argument("pdf", help="PDF file to check")
    ap.add_argument("--json", metavar="OUT.json", help="also write the results as JSON")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(errors="backslashreplace")
    except Exception:
        pass
    if not os.path.isfile(args.pdf):
        print(f"error: no such file: {args.pdf}", file=sys.stderr)
        return 2
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))
    rep, ctx = run(args.pdf)
    sha = hashlib.sha256(ctx.data).hexdigest()
    print(f"check_pdfx1a_independent {CHECKER_VERSION} -- {args.pdf} ({len(ctx.data)} bytes, sha256 {sha[:16]})")
    for it in rep.ordered():
        line = f"{it['status']:<4}  {it['check']:<22} {it['message']}"
        print(line if len(line) <= 420 else line[:417] + "...")
    c = rep.counts()
    nfail = c.get("FAIL", 0)
    flav = {"2001": "PDF/X-1a:2001", "2003": "PDF/X-1a:2003"}.get(ctx.flavour, "PDF/X-1a (no valid identification)")
    print("-" * 78)
    print(f"SUMMARY  {c.get('PASS', 0)} PASS, {c.get('WARN', 0)} WARN, {nfail} FAIL, {c.get('INFO', 0)} INFO")
    if nfail:
        print(f"VERDICT  FAIL -- not conformant to {flav} ({nfail} failing check line(s))")
    else:
        print(f"VERDICT  PASS -- no conformance failures found for {flav}"
              + (f"; review {c.get('WARN', 0)} WARN line(s)" if c.get("WARN") else ""))
    if args.json:
        doc = {
            "checker": "check_pdfx1a_independent", "version": CHECKER_VERSION, "file": os.path.abspath(args.pdf),
            "bytes": len(ctx.data), "sha256": sha,
            "header_version": f"{ctx.hver[0]}.{ctx.hver[1]}" if ctx.hver else None,
            "pdfx": flav, "results": rep.ordered(), "summary": dict(c),
            "verdict": "FAIL" if nfail else "PASS", "exit_code": 1 if nfail else 0,
            "tools": {"pikepdf": pikepdf.__version__, "qpdf": pikepdf.__libqpdf_version__},
        }
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
    return 1 if nfail else 0


if __name__ == "__main__":
    sys.exit(main())
