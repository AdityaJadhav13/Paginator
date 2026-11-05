"""O4 intake: one cheap check per uploaded PDF before the heavy steps (packages/contracts/src/onboard.ts FileCheck).

Deterministic: pikepdf structure and content-stream operators only (no rendering, no AI). Every threshold is here:
  - not_pdf          pikepdf cannot open it, it is encrypted, or it has no page                      (refused)
  - scanned          no text-showing operator (Tj/TJ/'/") on any page                                (refused)
  - fonts_missing    a font without an embedded program (FontFile/2/3), or a Type 3 font            (refused)
  - no_unicode       a font without /ToUnicode while the file carries no /ActualText at all          (refused)
  - untested_program neither Creator "InDesign" nor Producer "Adobe PDF Library"                    (warning)
  - page_size_mix    its first page differs from the set's most common size by > PAGE_TOL_MM        (refused)
  - no_date          no date in the file name (YYYY-MM-DD or YYYYMMDD) and no /CreationDate        (refused)
  - duplicate        the same bytes as another file (the lower n is kept), or the same edition date
                     (the later export by /CreationDate is kept, as the pilot's owner chose; ties: the higher n)  (refused)
frames_excluded (a warning) is added later by the O6 step, which reads the frames.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from datetime import date
from pathlib import Path

import pikepdf

PAGE_TOL_MM = 2.0
MM = 25.4 / 72
NAME_DATE = (re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)"), re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)"))
TEXT_OPS = {"Tj", "TJ", "'", '"'}


def name_date(name: str) -> str | None:
    for rx in NAME_DATE:
        for m in rx.finditer(name):
            try:
                return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
            except ValueError:
                continue
    return None


def pdf_date(v) -> str | None:
    m = re.match(r"(?:D:)?(\d{4})(\d{2})(\d{2})", str(v or ""))
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def _fonts(res, seen: set):
    """Every font dictionary reachable from a resource dictionary (forms and Type 3 resources included)."""
    if res is None:
        return
    for _, f in (res.get("/Font") or {}).items():
        if f.objgen in seen and f.objgen != (0, 0):
            continue
        seen.add(f.objgen)
        yield f
        yield from _fonts(f.get("/Resources"), seen)
    for _, x in (res.get("/XObject") or {}).items():
        if x.get("/Subtype") == "/Form" and x.objgen not in seen:
            seen.add(x.objgen)
            yield from _fonts(x.get("/Resources"), seen)


def _has_program(font) -> bool:
    if font.get("/Subtype") == "/Type0":
        font = font.DescendantFonts[0]
    fd = font.get("/FontDescriptor")
    return fd is not None and any(k in fd for k in ("/FontFile", "/FontFile2", "/FontFile3"))


def _text_and_actualtext(page) -> tuple[int, bool]:
    n, at = 0, False
    for operands, op in pikepdf.parse_content_stream(page):
        o = str(op)
        if o in TEXT_OPS:
            n += 1
        elif o in ("BDC", "DP") and len(operands) == 2 and isinstance(operands[1], pikepdf.Dictionary) and "/ActualText" in operands[1]:
            at = True
    return n, at


def _read(pdf, out: dict):
    """The file's text, font and program facts (None: encrypted or no page); fills out's date, pages and size."""
    if pdf.is_encrypted or len(pdf.pages) == 0:
        return None
    info = pdf.docinfo
    out["created"] = str(info.get("/CreationDate", "")) or None
    out["date"] = out["date"] or pdf_date(info.get("/CreationDate"))
    out["pages"] = len(pdf.pages)
    box = pdf.pages[0].trimbox
    out["size_mm"] = [round(float(box[2] - box[0]) * MM, 1), round(float(box[3] - box[1]) * MM, 1)]
    text_ops, actualtext, missing, no_uni, seen = 0, False, False, False, set()
    for page in pdf.pages:
        n, at = _text_and_actualtext(page)
        text_ops += n
        actualtext |= at
        for f in _fonts(page.get("/Resources"), seen):
            if f.get("/Subtype") == "/Type3" or not _has_program(f):
                missing = True
            if "/ToUnicode" not in f:
                no_uni = True
    creator, producer = str(info.get("/Creator", "")), str(info.get("/Producer", ""))
    return text_ops, actualtext, missing, no_uni, creator, producer


def check_file(path: Path, name: str) -> dict:
    """The facts of one file (no set-level decision yet)."""
    data = path.read_bytes()
    out = {"sha256": hashlib.sha256(data).hexdigest(), "pages": 0, "date": name_date(name), "created": None, "size_mm": None,
           "codes": []}
    try:
        pdf = pikepdf.open(path)
    except Exception:  # noqa: BLE001  (damaged, encrypted without the password, not a PDF)
        out["codes"].append("onboard.not_pdf")
        return out
    try:
        with pdf:
            facts = _read(pdf, out)
    except Exception:  # noqa: BLE001  (opens, but a page, a font or a box cannot be read: refuse the file, not the set)
        out.update(pages=0, size_mm=None, codes=["onboard.not_pdf"])
        return out
    if facts is None:
        out["codes"].append("onboard.not_pdf")
        return out
    text_ops, actualtext, missing, no_uni, creator, producer = facts
    if text_ops == 0:
        out["codes"].append("onboard.scanned")
    elif missing:
        out["codes"].append("onboard.fonts_missing")
    elif no_uni and not actualtext:
        out["codes"].append("onboard.no_unicode")
    if "InDesign" not in creator and "Adobe PDF Library" not in producer:
        out["codes"].append("onboard.untested_program")
    if out["date"] is None:
        out["codes"].append("onboard.no_date")
    return out


REFUSING = {"onboard.not_pdf", "onboard.scanned", "onboard.fonts_missing", "onboard.no_unicode", "onboard.page_size_mix",
            "onboard.duplicate", "onboard.no_date"}


def check_set(files: list) -> list:
    """files: [{"n", "name", "path"}] -> [{"n", "facts", "check": FileCheck}] in n order; set-level codes added here."""
    rows = [{"n": f["n"], "name": f["name"], "path": Path(f["path"]), "facts": check_file(Path(f["path"]), f["name"])}
            for f in sorted(files, key=lambda f: f["n"])]
    sizes = Counter(tuple(r["facts"]["size_mm"]) for r in rows if r["facts"]["size_mm"] and not set(r["facts"]["codes"]) & REFUSING)
    if sizes:
        common = max(sizes.items(), key=lambda kv: (kv[1], kv[0]))[0]
        for r in rows:
            s = r["facts"]["size_mm"]
            if s and not set(r["facts"]["codes"]) & REFUSING and max(abs(a - b) for a, b in zip(s, common)) > PAGE_TOL_MM:
                r["facts"]["codes"].append("onboard.page_size_mix")
    first = {}
    for r in rows:
        if set(r["facts"]["codes"]) & REFUSING:
            continue
        if r["facts"]["sha256"] in first:
            r["facts"]["codes"].append("onboard.duplicate")
        else:
            first[r["facts"]["sha256"]] = r["n"]
    by_date = {}
    for r in rows:
        if not set(r["facts"]["codes"]) & REFUSING:
            by_date.setdefault(r["facts"]["date"], []).append(r)
    for same in by_date.values():
        keep = max(same, key=lambda r: (pdf_stamp(r["facts"]["created"]), r["n"]))
        for r in same:
            if r is not keep:
                r["facts"]["codes"].append("onboard.duplicate")
    for r in rows:
        r["check"] = file_check(r)
    return rows


def pdf_stamp(v) -> str:
    return re.sub(r"[^0-9]", "", str(v or ""))[:14]


def file_check(r: dict, extra: list | None = None) -> dict:
    codes = r["facts"]["codes"]
    notes = [{"code": c, "count": None} for c in codes] + (extra or [])
    status = "refused" if set(codes) & REFUSING else "warning" if notes else "ok"
    return {"n": r["n"], "status": status, "date": r["facts"]["date"], "pages": r["facts"]["pages"], "notes": notes[:20]}
