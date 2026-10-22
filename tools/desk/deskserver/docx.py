"""Word (.docx) files to Desk articles, with the Python standard library only (a .docx is a zip of XML).

A reporter's file usually holds one story: its first paragraph (or its title / heading) is the headline, a short first
line under it can be the byline ("Byline: …" or "वार्ताहर: …" with a colon, "By A. Writer", "प्रतिनिधी, काल्पनिकनगर",
"वार्ताहर, काल्पनिकनगर"), and the rest is the text. A file can also hold several stories (the first 200 are taken):
every paragraph in a Title or Heading 1 style starts a new one. Paragraphs in Heading 2–4 inside a story become
subheadings ("## "). Only the body's own paragraphs are read, as typed (NFC), from transitional or strict Open XML:
tables, text boxes, pictures, hidden, placeholder and deleted (tracked) text and formatting are not taken (the Desk
sets the type itself), and the result's notes say what was left out."""
from __future__ import annotations

import re
import unicodedata
import zipfile
from collections import Counter
from collections.abc import Iterator
from io import BytesIO
from xml.etree import ElementTree as ET

from .ziplimits import directory

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
STRICT = "{http://purl.oclc.org/ooxml/wordprocessingml/main}"        # the same elements in strict Open XML
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
WPS = "{http://schemas.microsoft.com/office/word/2010/wordprocessingShape}"
SYMEX = "{http://schemas.microsoft.com/office/word/2015/wordml/symex}"
HR = "{urn:schemas-microsoft-com:office:office}hr"                   # o:hr="t": a horizontal line, not a picture
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"   # a password-protected .docx, or an old .doc, starts so
MAX_BYTES = 20 * 1024 * 1024
MAX_XML = 16 * 1024 * 1024                  # the most of document.xml unpacked and read (200 stories are far less)
MAX_STORIES = 200
MAX_ENTRIES = 5000                          # files a .docx lists (Word's own: a few dozen, plus pictures)
MAX_DIRECTORY = 4 * 1024 * 1024             # its central directory, read whole by zipfile before anything else
DAMAGED = "This Word file is damaged. Save it again and try again."
NOT_WORD = "This is not a Word (.docx) file. Save it as .docx and try again."
TOO_LARGE = "This Word file is too large to read."
BYLINE = re.compile(r"\s*(?:byline|by|वार्ताहर)\s*[:：]\s*[-–—]?\s*(.*)", re.IGNORECASE | re.DOTALL)  # "Byline: …"
BY_NAME = re.compile(r"\s*(?i:by)\s+(\S+(?:\s+\S+){0,4})(?<![.?!।])\s*")   # "By A. Writer": 1–5 words, not a sentence
PLACE = r"\S+(?:\s+\S+){0,4}(?<![.?!।])"                             # 1–5 words, not a sentence
# "प्रतिनिधी, काल्पनिकनगर", "आमचे वार्ताहर": a byline as it is (not "प्रतिनिधींनी …", not "प्रतिनिधी, … आहे.")
CORRESPONDENT = re.compile(rf"\s*(?:(?:आमचे|आमच्या)\s+)?"
                           rf"(?:प्रतिनिधी(?:\s*[,:：]\s*{PLACE})?|वार्ताहर(?:\s*,\s*{PLACE})?)\s*")
NEW_STORY = ("title", "heading1")
SUBHEAD = ("heading2", "heading3", "heading4")
BLOCKS = (f"{W}sdt", f"{W}sdtContent", f"{W}customXml")    # content controls and custom XML: they hold body paragraphs
NOT_TEXT = {f"{W}pPr", f"{W}rPr", f"{W}sdtPr", f"{W}sdtEndPr", f"{W}del", f"{W}moveFrom", f"{W}instrText",
            f"{W}txbxContent", f"{MC}Fallback"}
VISUALS = (f"{W}drawing", f"{W}pict", f"{W}object")
BOXES = (f"{W}txbxContent", f"{WPS}linkedTxbx")
EMPHASIS = (f"{W}b", f"{W}bCs", f"{W}i", f"{W}iCs")         # bold and italic (Cs: of Marathi and other complex scripts)


class DocxError(ValueError):
    pass


def _document(data: bytes) -> ET.Element:
    """The parsed word/document.xml (DocxError when the file is not a .docx that can be read)."""
    if len(data) > MAX_BYTES:
        raise DocxError("This Word file is larger than 20 MB.")
    if data.startswith(OLE):
        raise DocxError("This Word file is protected with a password, or is an old .doc file: save it as .docx "
                        "without a password and try again.")
    listed = directory(data)                          # before zipfile reads a central directory of any size
    if listed is not None and (listed.entries > MAX_ENTRIES or listed.size > MAX_DIRECTORY):
        raise DocxError(TOO_LARGE)
    try:
        z = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, ValueError, NotImplementedError):    # not a zip, or a cut-off or garbled one
        raise DocxError(DAMAGED if data.startswith(b"PK") else NOT_WORD) from None
    try:
        info = z.getinfo("word/document.xml")
    except KeyError:                                                  # a zip, but not a Word file (.odt, .xlsx…)
        raise DocxError(NOT_WORD) from None
    if info.file_size > MAX_XML:
        raise DocxError(TOO_LARGE)
    # Word packs only these two ways; bzip2 and lzma would unpack a whole member at once, however large.
    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise DocxError(DAMAGED)
    try:
        with z.open(info) as f:
            raw = f.read(MAX_XML + 1)       # bounded: the size the zip lists may not be true
    except Exception:  # noqa: BLE001 — bad checksum, cut-off or garbled data (zipfile and zlib raise several kinds)
        raise DocxError(DAMAGED) from None
    if len(raw) > MAX_XML:
        raise DocxError(TOO_LARGE)
    try:
        root = ET.fromstring(raw)
    except (ET.ParseError, ValueError, LookupError):                  # broken XML, or an encoding it cannot read
        raise DocxError(DAMAGED) from None
    if root.tag.startswith(STRICT):                                   # strict Open XML: read as transitional
        for el in root.iter():
            if el.tag.startswith(STRICT):
                el.tag = W + el.tag[len(STRICT):]
            for name in [n for n in el.attrib if n.startswith(STRICT)]:
                el.set(W + name[len(STRICT):], el.attrib.pop(name))
    return root


def _on(el: ET.Element | None) -> bool:
    """Whether an on/off property (w:b, w:vanish, w:showingPlcHdr…) is there and on."""
    return el is not None and el.get(f"{W}val", "1").lower() not in ("0", "false", "off")


def _placeholder(el: ET.Element) -> bool:
    """Whether a content control shows only its placeholder text ("Click or tap here to enter text.")."""
    return _on(el.find(f"{W}sdtPr/{W}showingPlcHdr"))


def _body_paragraphs(body: ET.Element, seen: Counter) -> Iterator[ET.Element]:
    """The body's own paragraphs in order, also those in content controls; tables are counted, not read."""
    todo = [iter(body)]
    while todo:
        el = next(todo[-1], None)
        if el is None:
            todo.pop()
        elif el.tag == f"{W}p":
            yield el
        elif el.tag == f"{W}tbl":
            seen["tables"] += 1
        elif el.tag in BLOCKS and not _placeholder(el):
            todo.append(iter(el))


def _text(p: ET.Element, seen: Counter) -> tuple[str, int]:
    """A paragraph's text as typed, and where its last bold or italic text ends in it (0: there is none). Deleted or
    moved-away text, field codes, hidden and placeholder text, text boxes and the copy Word keeps for older programs
    (mc:Fallback) are left out; a soft hyphen gives nothing. Text boxes and pictures are counted in `seen`."""
    parts: list[str] = []
    size = strong = 0
    todo = [(iter(p), False)]
    while todo:
        it, emphasis = todo[-1]
        node = next(it, None)
        if node is None:
            todo.pop()
            continue
        tag, piece = node.tag, ""
        if tag == f"{W}t":
            piece = node.text or ""
            if emphasis and piece.strip():
                strong = size + len(piece)
        elif tag == f"{W}tab":
            piece = " "
        elif tag in (f"{W}br", f"{W}cr"):
            piece = "\n"
        elif tag == f"{W}noBreakHyphen":
            piece = "-"
        elif tag == f"{SYMEX}symEx":                 # an emoji Word keeps as a code (as text only in the mc:Fallback)
            piece = _character(node.get(f"{SYMEX}char", ""))
        elif tag in VISUALS:                         # a text box, a picture (photo, chart, shape) or an object
            if kind := _visual(node):
                seen[kind] += 1
        elif tag == f"{W}r":
            rpr = node.find(f"{W}rPr")
            if not (rpr is not None and _on(rpr.find(f"{W}vanish"))):          # hidden text does not show
                todo.append((iter(node), rpr is not None and any(el.tag in EMPHASIS and _on(el) for el in rpr)))
        elif tag not in NOT_TEXT and not (tag == f"{W}sdt" and _placeholder(node)):
            todo.append((iter(node), emphasis))      # links, fields, content controls, tracked insertions…
        if piece:
            parts.append(piece)
            size += len(piece)
    return "".join(parts), strong


def _visual(node: ET.Element) -> str | None:
    """What a drawing, VML shape or object is: "text boxes" (one, whatever it holds), "pictures", or None for a
    horizontal line."""
    if any(el.tag in BOXES for el in node.iter()):
        return "text boxes"
    return None if any(el.get(HR) in ("t", "true") for el in node.iter()) else "pictures"


def _character(code: str) -> str:
    """The character of a hexadecimal code ("1F600"), or nothing."""
    try:
        n = int(code, 16)
    except ValueError:
        return ""
    return chr(n) if 0 < n <= 0x10FFFF and not 0xD800 <= n <= 0xDFFF else ""


def _paragraphs(data: bytes) -> tuple[list[tuple[str, str, int]], Counter]:
    """[(style id lowercased, text, where its last bold or italic text ends)] of the document body's paragraphs that
    have text, in order, and how many tables, text boxes and pictures it holds."""
    body = _document(data).find(f"{W}body")
    seen: Counter = Counter()
    out = []
    for p in _body_paragraphs(body, seen) if body is not None else ():
        raw, strong = _text(p, seen)
        text = unicodedata.normalize("NFC", raw).strip()
        if text:
            style = p.find(f"{W}pPr/{W}pStyle")
            sid = (style.get(f"{W}val") if style is not None else "") or ""
            out.append((sid.lower().replace(" ", ""), text, max(strong - (len(raw) - len(raw.lstrip())), 0)))
    return out, seen


def _byline(text: str) -> tuple[str, int] | None:
    """(byline, length of its label such as "Byline: ") of a short first line under the headline, or None. An empty
    "Byline:" gives ""; "प्रतिनिधी, काल्पनिकनगर" and "वार्ताहर, काल्पनिकनगर" are kept as they are."""
    if len(text) > 80:
        return None
    if m := BYLINE.fullmatch(text):
        return " ".join(m.group(1).split()), m.start(1)
    if (m := BY_NAME.fullmatch(text)) and unicodedata.name(m.group(1)[0], "").startswith("LATIN CAPITAL LETTER"):
        return " ".join(m.group(1).split()), m.start(1)                  # a name, not "By noon …" or "By 2030 …"
    return (" ".join(text.split()), 0) if CORRESPONDENT.fullmatch(text) else None


def _left_out(seen: Counter) -> list[str]:
    """What the file holds that was not imported, in plain words (nothing when there is none)."""
    said = []
    if n := seen["tables"]:
        said.append(f"{n} tables were not imported: copy their text into the article if it is needed." if n > 1 else
                    "1 table was not imported: copy its text into the article if it is needed.")
    if n := seen["text boxes"]:
        said.append(f"{n} text boxes were not imported." if n > 1 else "1 text box was not imported.")
    if n := seen["pictures"]:
        said.append(f"{n} pictures were not imported: add photos in the Desk." if n > 1 else
                    "1 picture was not imported: add photos in the Desk.")
    return said


def articles_from_docx(data: bytes) -> dict:
    """→ {"articles": [{headline, byline, body}], "notes": [...]}"""
    paras, seen = _paragraphs(data)
    stories: list[dict] = []
    cur: dict | None = None
    for style, text, strong in paras:                # strong: bold or italic text, which is not kept
        if style in NEW_STORY or cur is None:        # no heading styles: the first paragraph is the headline
            cur = {"headline": " ".join(text.split()), "byline": None, "paras": [], "strong": strong > 0}
            stories.append(cur)                      # byline None: not looked for yet
            continue
        if cur["byline"] is None:                    # only the first line under the headline, never a subheading
            found = None if style in SUBHEAD else _byline(text)
            cur["byline"] = found[0] if found else ""
            if found:
                cur["strong"] |= strong > found[1]   # the label ("Byline: ") is not imported
                continue
        cur["strong"] |= strong > 0
        if style in SUBHEAD:
            cur["paras"].append("## " + " ".join(text.split()))
        else:
            cur["paras"].extend(" ".join(line.split()) for line in text.split("\n") if line.strip())
    full = [s for s in stories if s["headline"] and any(not p.startswith("## ") for p in s["paras"])]
    left_out = _left_out(seen)
    if not full:                                     # say why when the text is all in tables or text boxes
        raise DocxError(" ".join(["No story was found in this Word file: it needs a headline and some text.",
                                  *left_out]))
    taken = full[:MAX_STORIES]
    notes = []
    if len(full) > MAX_STORIES:
        notes.append(f"This file holds more than {MAX_STORIES} stories; only the first {MAX_STORIES} were imported.")
    if empty := sum(1 for s in stories if s["headline"]) - len(full):
        notes.append("1 heading had no text under it and was not imported." if empty == 1 else
                     f"{empty} headings had no text under them and were not imported.")
    notes += left_out
    if any(s["strong"] for s in taken):              # only what is imported (not a skipped heading, not a label)
        notes.append("Formatting (bold, italic, sizes) is not kept: the Desk sets the type.")
    arts = [{"headline": s["headline"][:2000], "byline": (s["byline"] or "")[:2000], "body": "\n\n".join(s["paras"])}
            for s in taken]
    return {"articles": arts, "notes": notes}
