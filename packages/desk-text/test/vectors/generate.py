"""Parity vectors for @pageinator/desk-text: what the Desk's own text functions return (docs/product/
10-l2-newsroom-plan.md §2.1 and §10, PR 15).

The Desk's functions are imported from tools/desk, read-only, and run on fictional inputs only:
  - deskarticles.blocks, body_words and is_brief: the engine's body parser, so what the engine prints and counts;
  - deskserver.util.clean_text: text as the Desk stores it;
  - deskserver.store.parse_bulk, and Store.bulk_create in a throwaway Desk home: the `---` paste;
  - deskserver.store.count_words and decorate, which must agree with the engine (the generator stops if not).
It writes two files; with --check it writes nothing and fails when either differs from what it would write:
  - desk-text.jsonl, next to it: one vector per line, the first describing the run;
  - packages/desk-text/src/unicode14.gen.ts: the code points Unicode 14 leaves unassigned, which the TypeScript port
    keeps out of the JavaScript engine's newer normalisation (src/nfc.ts).

Run it in the frozen oracle venv (Python 3.11, Unicode 14.0.0: the environment the Desk's engine runs in):
    tools/oracle/v0/.venv/bin/python -B packages/desk-text/test/vectors/generate.py [--check]
deskserver.store imports deskserver.images, which needs Pillow (not in that venv); no function used here touches it,
so an empty module stands in for it. The paste vectors write a Desk home into a temporary folder (TMPDIR), then
delete it.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True   # like -B: importing the Desk's modules writes no __pycache__ into tools/desk

import hashlib
import json
import re
import tempfile
import types
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
VECTORS = HERE / "desk-text.jsonl"
TABLE = REPO / "packages" / "desk-text" / "src" / "unicode14.gen.ts"
FORMAT = "pageinator.desk-text.vectors/1"

if sys.version_info[:2] != (3, 11) or unicodedata.unidata_version != "14.0.0":
    raise SystemExit(f"Run this in the oracle venv (Python 3.11, Unicode 14.0.0), not Python {sys.version.split()[0]} "
                     f"with Unicode {unicodedata.unidata_version}: tools/oracle/v0/.venv/bin/python -B {__file__}")

sys.path[:0] = [str(REPO / "tools" / "desk" / "engine"), str(REPO / "tools" / "desk")]
sys.modules["deskserver.images"] = types.ModuleType("deskserver.images")   # Pillow's half of the server: unused here
import deskarticles  # noqa: E402
from deskserver import store, util  # noqa: E402

# The Desk's code each vector exercises. The parity test hashes the same blocks of these files, so a change to any of
# them makes it fail until the vectors are made again (block(): a definition and the lines indented under it).
SOURCES = {
    "tools/desk/engine/deskcommon.py": ["nfc"],
    "tools/desk/engine/deskarticles.py": ["BRIEF_WORDS", "SENTENCE_END", "is_subheading", "blocks", "body_words",
                                          "is_brief"],
    "tools/desk/deskserver/util.py": ["_CONTROL", "clean_text"],
    "tools/desk/deskserver/store.py": ["BRIEF_WORDS", "LINE_LIMIT", "BODY_LIMIT", "TEXT_FIELDS", "_SEPARATOR",
                                       "_BYLINE", "count_words", "decorate", "parse_bulk", "_apply",
                                       "Store._new_article", "Store.bulk_create", "Store.create_many"],
}
ALL = range(0x110000)
SURROGATES = range(0xD800, 0xE000)
NFC_BLOCK = 0x1000
NFC_PROBES = ("x", "̴", "ͅ")    # a base letter; combining marks of the lowest (1) and highest (240) class


# ------------------------------------------------------------------------------------------------ sources


def indentation(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def blank(line: str) -> bool:
    return line.strip(" \t") == ""


def block(lines: list[str], name: str) -> str:
    """The lines of one definition: `def name(` or `name =` (in a class for `Class.name`), and every line after it
    that is blank or indented deeper, without the blank lines at its end."""
    *classes, inner = name.split(".")
    start, indent = 0, ""
    for cls in classes:
        start = next(i for i in range(start, len(lines)) if re.match(rf"{indent}class {cls}\b", lines[i]))
        indent += "    "
    head = re.compile(rf"{indent}(?:def {re.escape(inner)}\(|{re.escape(inner)} *[:=])")
    begin = next(i for i in range(start, len(lines)) if head.match(lines[i]))
    end = begin + 1
    while end < len(lines) and (blank(lines[end]) or indentation(lines[end]) > len(indent)):
        end += 1
    while blank(lines[end - 1]):
        end -= 1
    return "\n".join(lines[begin:end])


def sources() -> list[dict]:
    out = []
    for file, names in SOURCES.items():
        lines = (REPO / file).read_text(encoding="utf-8").split("\n")
        for name in names:
            digest = hashlib.sha256(block(lines, name).encode("utf-8")).hexdigest()
            out.append({"file": file, "name": name, "sha256": digest})
    return out


# ------------------------------------------------------------------------------------------------ inputs


LONG = 500   # an output string longer than this is written as its SHA-256 and length


class Big(str):
    """A long input, written to the vectors as its parts: strings and [unit, times] repeats."""

    parts: list

    def __new__(cls, *parts):
        text = super().__new__(cls, "".join(p if isinstance(p, str) else p[0] * p[1] for p in parts))
        text.parts = [p if isinstance(p, str) else list(p) for p in parts]
        return text


def encode_input(value):
    """An input as the parity test rebuilds it: a long one ({"concat": parts}) from its parts."""
    if isinstance(value, Big):
        return {"concat": value.parts}
    if isinstance(value, dict):
        return {k: encode_input(v) for k, v in value.items()}
    if isinstance(value, list):
        return [encode_input(v) for v in value]
    return value


def encode_output(value):
    """An output as the parity test compares it: a long string as {"sha256", "chars"} (its UTF-8 and its length)."""
    if isinstance(value, str) and len(value) > LONG:
        return {"sha256": hashlib.sha256(value.encode("utf-8")).hexdigest(), "chars": len(value)}
    if isinstance(value, dict):
        return {k: encode_output(v) for k, v in value.items()}
    if isinstance(value, list):
        return [encode_output(v) for v in value]
    return value


def encode(vector: dict) -> dict:
    return {k: encode_input(v) if k == "input" else encode_output(v) for k, v in vector.items()}


def words(n: int, word: str = "word") -> str:
    return " ".join([word] * n)


MR_RAIN = ("काल्पनिकनगर येथे सोमवारी सकाळी जोरदार पाऊस झाला. शहरातील अनेक रस्त्यांवर पाणी साचले होते.\n\n"
           "नगरपालिकेच्या कर्मचाऱ्यांनी दुपारपर्यंत पाण्याचा निचरा केला. शाळा नेहमीप्रमाणे सुरू होत्या.\n\n"
           "## बाजारपेठ\n\n"
           "भाजी बाजारात सकाळी गर्दी कमी होती। संध्याकाळी व्यवहार पूर्ववत झाले।")
MR_WHATSAPP = ("ग्रामपंचायतीची बैठक आज पार पडली.\n"
               "बैठकीत पाणीपुरवठा योजनेवर चर्चा झाली.\n"
               "नवीन विहिरीसाठी निधी मंजूर करण्यात आला.\n"
               "पुढील बैठक पुढच्या महिन्यात होईल.")
MR_MARGIN = ("काल्पनिकनगर क्रीडा मंडळाच्या वतीने रविवारी\n"
             "शहरात धावण्याची स्पर्धा आयोजित करण्यात आली\n"
             "होती. स्पर्धेत दोनशेहून अधिक धावपटू\n"
             "सहभागी झाले.")
MR_QUOTE = ("“आम्ही लवकरच रस्ता दुरुस्त करू,” असे अधिकाऱ्यांनी सांगितले.\n"
            "नागरिकांनी या निर्णयाचे स्वागत केले ॥\n"
            "‘हा निर्णय योग्य आहे’\n"
            "असे एका दुकानदाराने सांगितले.")
MR_BRIEF = "काल्पनिकनगर वाचनालयात उद्या सकाळी दहा वाजता कथाकथन कार्यक्रम होणार आहे."
EN_COUNCIL = ("The Kalpaniknagar town council met on Tuesday to discuss the new bus depot.\n\n"
              "Residents asked for more street lights near the market.\n\n"
              "## What happens next\n\n"
              "A public hearing is planned for next month.")
EN_WHATSAPP = ("The fictional fair opens today!\n"
               "Will the rain stop?\n"
               "Stalls close at nine (the organisers said)\n"
               "Entry is free; parking is not:")

BODIES = [
    ("nothing", ""),
    ("no body at all", None),
    ("only blank space", "   \n\t\n  "),
    ("the Desk's own test: a subheading between paragraphs", "One two.\n\n## A subheading\n\nThree four five."),
    ("the Desk's own test: Marathi, three blank lines", "पाऊस आला.\n\n\n## शहर\n\nबातमी"),
    ("the Desk's own test: pasted, one paragraph per line", "पहिला परिच्छेद.\n## शहर\nदुसरा परिच्छेद."),
    ("a Marathi story: paragraphs and a subheading", MR_RAIN),
    ("WhatsApp: one Marathi paragraph per line", MR_WHATSAPP),
    ("lines broken at the margin are joined", MR_MARGIN),
    ("quotes and dandas end sentences", MR_QUOTE),
    ("a Marathi brief", MR_BRIEF),
    ("an English story", EN_COUNCIL),
    ("English, one paragraph per line, every sentence end", EN_WHATSAPP),
    ("3 of 5 lines end a sentence: one paragraph each", "a.\nb.\nc.\nd\ne"),
    ("2 of 5 lines end a sentence: joined", "a.\nb.\nc\nd\ne"),
    ("2 of 3 lines end a sentence: one paragraph each", "a.\nb.\nc"),
    ("1 of 2 lines ends a sentence: joined", "a.\nb"),
    ("2 of 2 lines end a sentence", "a.\nb."),
    ("6 of 10 lines end a sentence", "\n".join(f"l{k}." if k < 6 else f"l{k}" for k in range(10))),
    ("5 of 10 lines end a sentence", "\n".join(f"l{k}." if k < 5 else f"l{k}" for k in range(10))),
    ("one line is never split", "One line. Two sentences."),
    ("an empty line anywhere joins the lines", "a.\nb.\n\nc.\nd."),
    ("a line of spaces counts as empty", "a.\nb.\n \t \nc."),
    ("each sentence end", "\n".join(f"word{c}" for c in deskarticles.SENTENCE_END)),
    ("lines ending in what does not end a sentence", "a,\nb—\nc…\nd»\ne-\nf]"),
    ("a line ends where its spaces start", "a.  \nb.\t\nc. 　\nd"),
    ("a sentence end before a combining mark", "बातमी।́\nदुसरी।́\nतिसरी"),
    ("an emoji at a line's end", "Good news 😀\nMore 😀\nAnd more."),
    ("a mark after a full stop", "a.́\nb.\nc."),
    ("subheadings: ##, ###, indented, tabbed",
     "Para one.\n##\n## \n###\n#### Deep heading\n  ## Indented heading\n##\tTabbed\nPara two."),
    ("one # is not a subheading", "# Not a heading\n#also not\nText."),
    ("a subheading's own hashes and spaces", "## Two  spaces   inside ##\n## ## twice\n##   \nEnd."),
    ("only subheadings", "## A\n## B"),
    ("a subheading between two lines of one paragraph", "first half\n## Middle\nsecond half"),
    ("CRLF and CR line ends", "a.\r\nb.\r\nc.\rd."),
    ("CRLF between paragraphs", "Para one.\r\n\r\nPara two.\r\n"),
    ("tabs and runs of spaces inside a paragraph", "word\tword    word\t\tword"),
    ("no-break and other Unicode spaces split words",
     "a b c d　e f g h i"),
    ("these are not spaces to Python: zero-width space, BOM, Mongolian vowel separator, ZWJ, ZWNJ",
     "a​b c﻿d e᠎f g‍h i‌j"),
    ("next line, line and paragraph separators, file and unit separators split words",
     "a\x85b c d e f g\x1cg h\x1fi"),
    ("vertical tab and form feed", "a\x0bb\x0cc"),
    ("a next-line character at a line's end is trailing space", "a.\x85\nb.\x85\nc"),
    ("a line of next-line characters is blank", "a.\n\x85\x85\nb."),
    ("a BOM line is not blank", "a.\n﻿\nb."),
    ("leading and trailing blank lines", "\n\n\n  Text here.  \n\n\n"),
    ("NFC: a decomposed é", "Café opens.\n\nCafé closes."),
    ("NFC: nukta letters stay decomposed, ऱ composes", "क़ ज़ फ़\n\nक़ ऱ ड़"),
    ("NFC: combining marks in the wrong order", "á̖ ọ̈"),
    ("NFC: Hangul jamo", "각 한"),
    ("Unicode 15-17 code points Python 3.11 does not know",
     "\U000113c2\U000113c2 \U000105d2̇ e\U0001e08f́ a᫏̖ \U00016121"),
    ("Devanagari digits and eyelash ra", "२०२६ साली र्‍या बातमी १२ ओळींची."),
    ("lone surrogates", "a\ud800b \udc00c\n\ne\ud800́"),
    ("a long paragraph", Big(("शब्द ", 300))),
]

ARTICLES = [
    ("no words", {"body": "", "photo": None}),
    ("one word", {"body": "word", "photo": None}),
    ("59 words", {"body": words(59), "photo": None}),
    ("60 words: the most a brief has", {"body": words(60), "photo": None}),
    ("61 words", {"body": words(61), "photo": None}),
    ("a photo", {"body": words(10), "photo": {"id": "p-0123456789"}}),
    ("an empty photo record is no photo", {"body": words(10), "photo": {}}),
    ("photo: empty text", {"body": words(10), "photo": ""}),
    ("photo: text", {"body": words(10), "photo": "p-0123456789"}),
    ("photo: 0", {"body": words(10), "photo": 0}),
    ("photo: 1", {"body": words(10), "photo": 1}),
    ("photo: empty list", {"body": words(10), "photo": []}),
    ("photo: a list", {"body": words(10), "photo": [1]}),
    ("photo: false", {"body": words(10), "photo": False}),
    ("photo: true", {"body": words(10), "photo": True}),
    ("no photo key", {"body": words(10)}),
    ("no body key", {"photo": None}),
    ("body: null", {"body": None, "photo": None}),
    ("subheadings are not counted", {"body": words(60) + "\n## " + words(5), "photo": None}),
    ("only subheadings", {"body": "## " + words(5), "photo": None}),
    ("a Marathi brief", {"body": MR_BRIEF, "photo": None}),
    ("a Marathi story", {"body": MR_RAIN + "\n\n" + words(40, "शब्द"), "photo": None}),
    ("no-break spaces split words", {"body": " ".join(["w"] * 61), "photo": None}),
    ("zero-width spaces do not", {"body": "​".join(["w"] * 61), "photo": None}),
]

CLEAN = [
    ("null", None, "headline", 2000),
    ("empty", "", "headline", 2000),
    ("the Desk's own test", "Café  \r\nline two \t\r\n\r\n", "x", 100),
    ("the Desk's own test: nukta", "क़", "x", 10),
    ("the Desk's own test: controls, ZWJ kept", "a\x00b\x07c‍d", "x", 10),
    ("trailing spaces on each line, blank lines inside kept", "line  \n\n  indented\n", "body", 100),
    ("every control character that is dropped", "".join(map(chr, [*range(0, 9), *range(11, 32), 127])) + "x",
     "x", 10),
    ("tab is kept inside", "a\tb", "x", 10),
    ("NFC first, then controls: the mark is left decomposed", "e\x00́", "x", 10),
    ("next line is not a control, but is trailing space", "\x85text\x85", "x", 10),
    ("C1 controls other than next line are kept", "a\x80b\x9fc", "x", 10),
    ("a BOM is not space to Python", "﻿text﻿", "x", 10),
    ("file and unit separators are dropped", "\x1c\x1d\x1e\x1ftext", "x", 10),
    ("ideographic and no-break space trimmed", " text　", "x", 10),
    ("line and paragraph separators trimmed at a line's end", "a \nb ", "x", 10),
    ("CR and CRLF", "a\rb\r\nc", "x", 10),
    ("vertical tab and form feed are dropped", "\x0b\x0c", "x", 10),
    ("tabs trimmed", "\t\ttext\t", "x", 10),
    ("spaces-only lines inside become empty", "a\n \t\nb", "x", 10),
    ("NFC composes", "Café", "x", 10),
    ("NFC: ऱ composes, क़ decomposes", "ऱ क़", "x", 10),
    ("NFC: Hangul", "각", "x", 10),
    ("NFC: reordered marks", "á̖", "x", 10),
    ("Unicode 16 composition Python does not know", "\U000113c2\U000113c2\U000105d2̇", "x", 10),
    ("Unicode 15 mark Python does not know", "e\U0001e08f̖́", "x", 10),
    ("lone surrogates are kept", "a\ud800b", "x", 10),
    ("a lone surrogate between a letter and its mark", "e\ud800́", "x", 10),
    ("exactly at the limit", "x" * 10, "headline", 10),
    ("one over the limit", "x" * 11, "headline", 10),
    ("emoji count once each: at the limit", "😀" * 10, "headline", 10),
    ("emoji count once each: over the limit", "😀" * 11, "article text", 10),
    ("the length is counted after cleaning", "x" * 10 + "   \n\n", "headline", 10),
    ("composed by NFC before counting", "é" * 10, "headline", 10),
    ("the line limit", Big(("क", 2000)), "headline", 2000),
    ("over the line limit", Big(("क", 2001)), "headline", 2000),
    ("a number of characters with five digits", Big(("x", 200_001)), "article text", 200_000),
    ("true is not text", True, "headline", 2000),
    ("false is not text", False, "headline", 2000),
    ("a list is not text", ["no"], "headline", 2000),
    ("an object is not text", {"a": 1}, "byline", 2000),
]
# Not here: numbers. The Desk writes them as text with Python's str() (str(1.0) is "1.0"); JavaScript cannot tell 1.0
# from 1, so the port refuses numbers, as the hosted API's schemas do (test/desk-text.test.ts).

PASTES = [
    ("the Desk's own test", "\n\nFirst fictional headline\nByline: A. Writer\n\nFirst paragraph.\n\n"
     "Second paragraph.\r\n---\n   \n---\nदुसरी बातमी\n\nवार्ताहर: लेखक\nपहिला परिच्छेद.\n\n## उपशीर्षक\n\n"
     "दुसरा.\n --- \nBYLINE : someone\n\nThe headline line above is the byline marker's headline.\n"
     "---\nOnly a headline\n"),
    ("the Desk's own test: nothing in any part", "---\n\n---"),
    ("nothing", ""),
    ("two Marathi stories", "पावसाने शहर ओलेचिंब\nवार्ताहर : काल्पनिक प्रतिनिधी\n\n" + MR_RAIN + "\n-----\n"
     "ग्रामसभेत पाण्यावर चर्चा\nवार्ताहर :- प्रतिनिधी, काल्पनिकनगर\n" + MR_WHATSAPP),
    ("an English story and a brief", "Council discusses depot\nByline: Staff Reporter (fictional)\n" + EN_COUNCIL
     + "\n---\nStory hour at the library\n" + MR_BRIEF),
    ("separators: spaces around, more dashes", "A\nbody a\n   ---   \nB\nbody b\n----------\nC\nbody c"),
    ("separators: Unicode spaces around", "A\nbody a\n　--- \nB\nbody b\n\x85--- \nC\nbody c"),
    ("not separators", "A\n--\n- - -\n---x\nx---\n—-—\n-- -\n--- end ---\nbody"),
    ("a separator at each end, and two together", "---\nA\nbody a\n---\n---\nB\nbody b\n---"),
    ("bylines: the full-width colon, a dash after the colon", "A\nBYLINE： Name One\nbody\n---\n"
     "B\nByline :—  Name Two  \nbody\n---\nC\nbyline:-Name Three\nbody\n---\nD\nByline: – Name Four\nbody"),
    ("bylines: dotted and dotless i", "A\nBYLİNE: Name\nbody\n---\nB\nbylıne: Name\nbody\n---\n"
     "C\nBYLİNE: decomposed dot\nbody"),
    ("not bylines", "A\nByline Name\nbody\n---\nB\nBylines: Name\nbody\n---\nC\nＢｙｌｉｎｅ: Name\nbody\n---\n"
     "D\nBy line: Name\nbody\n---\nE\nThe byline: Name\nbody"),
    ("a byline with nothing after it", "A\nByline:\nbody\n---\nB\nवार्ताहर:\nशब्द"),
    ("a byline after blank lines, indented", "A\n\n\n   Byline:   Name   \nbody"),
    ("a byline that is the last line", "A\nByline: Name"),
    ("a byline with separators inside", "A\nByline: one two\u0085three\nbody"),
    ("only the second line can be the byline", "A\nbody first\nByline: Name"),
    ("CR and CRLF", "A\r\nByline: N\r\nbody\r---\rB\rbody b"),
    ("NFC before parsing", "Café news\nbody\n---\nक़ headline\nऱ body"),
    ("indented headline and body", "\t  Indented headline  \n\n   indented body   \n\n   more   "),
    ("a headline of control characters only", "\x01\x02\nbody one\n---\nGood\nbody two"),
    ("parts without text are skipped", "A\nbody\n---\nNo text here\n---\nNor here\n\n\n"),
    ("every part skipped", "One\n---\nTwo\n---\nThree"),
    ("a headline at the line limit", Big(("ह", 2000), "\nbody")),
    ("a headline over the line limit", Big(("ह", 2001), "\nbody\n---\nShort\nbody")),
    ("a headline of emoji at the limit", Big(("😀", 2000), "\nbody")),
    ("a headline of emoji over the limit", Big(("😀", 2001), "\nbody")),
    ("a byline over the line limit", Big("H\nByline: ", ("b", 1993), "\nbody\n---\nH2\nbody")),
    ("a body at the body limit", Big("H\n", ("x", 200_000))),
    ("a body over the body limit", Big("H\n", ("x", 200_001), "\n---\nH2\nbody")),
    ("a body of emoji under the limit, though longer in UTF-16", Big("H\n", ("😀", 100_001))),
    ("a body of emoji over the limit", Big("H\n", ("😀", 200_001))),
    ("a skipped headline is cut at 200 characters", Big(("a", 199), ("😀", 3), ("b", 100), "\n---\nH\nbody")),
    ("a skipped headline is trimmed first", Big("   ", ("a", 199), "😀b \t\n---\nH\nbody")),
    ("not text: null", None),
    ("not text: a number", 12),
    ("not text: a list", ["a"]),
    ("lone surrogates", "Head\ud800\nbody\udc00"),
]


# ------------------------------------------------------------------------------------------------ vectors


def outcome(fn, *args) -> dict:
    try:
        return {"output": fn(*args)}
    except util.DeskError as e:
        return {"error": {"status": e.status, "message": e.message}}


def body_vector(why: str, text) -> dict:
    found = [list(b) for b in deskarticles.blocks(text)]
    count = deskarticles.body_words(text)
    if store.count_words(text) != count:
        raise SystemExit(f"{why}: the server's word count is not the engine's")
    return {"fn": "blocks", "why": why, "input": text, "blocks": found, "words": count}


def brief_vector(why: str, article: dict) -> dict:
    engine = deskarticles.is_brief(article)
    shown = store.decorate(article)
    if shown["is_brief"] != engine or shown["words"] != deskarticles.body_words(article.get("body", "")):
        raise SystemExit(f"{why}: the server's short-item rule is not the engine's")
    return {"fn": "is_brief", "why": why, "input": article, "output": engine}


def clean_vector(why: str, value, field: str, limit: int) -> dict:
    return {"fn": "clean_text", "why": why, "input": [value, field, limit], **outcome(util.clean_text, value, field,
                                                                                         limit)}


def paste(text):
    with tempfile.TemporaryDirectory(prefix="desk-text-vectors-") as home:
        desk = store.Store(Path(home))
        eid = desk.create_edition({"date": "2026-10-21", "pages": 8})["id"]
        result = desk.bulk_create(eid, text)
    created = []
    for a in result["articles"]:
        if (a["kicker"], a["deck"], a["priority"], a["page"], a["photo"], a["source"]) != ("", "", 3, None, None,
                                                                                           "pasted"):
            raise SystemExit(f"a pasted article is not as the port makes it: {a}")
        if a["words"] != deskarticles.body_words(a["body"]) or a["is_brief"] != deskarticles.is_brief(a):
            raise SystemExit("a pasted article's counts are not the engine's")
        created.append({k: a[k] for k in ("headline", "byline", "body", "words", "is_brief")})
    if result["created"] != len(created):
        raise SystemExit("bulk_create counted its articles wrongly")
    return {"created": created, "skipped": result["skipped"]}


def paste_vectors(why: str, text) -> list[dict]:
    parsed = {"fn": "parse_bulk", "why": why, "input": text, **outcome(store.parse_bulk, text)}
    try:
        return [parsed, {"fn": "paste", "why": why, "input": text, **outcome(paste, text)}]
    except UnicodeEncodeError:
        # The Desk cannot save text with a lone surrogate (write_json's UTF-8 refuses it: a 500), so there is nothing
        # to compare the paste with; the hosted API refuses such text before it reaches the port.
        return [parsed]


def matching(pattern: re.Pattern, make, check=lambda m: m is not None) -> list[int]:
    """The code points c for which check(pattern.fullmatch(make(c))) holds: every one is tried."""
    return [c for c in ALL if c not in SURROGATES and check(pattern.fullmatch(make(chr(c))))]


def character_vector() -> dict:
    """The Desk's character classes, read from the Desk's own expressions by trying every code point."""
    space = [c for c in ALL if chr(c).isspace()]
    if [c for c in ALL if c not in SURROGATES and re.fullmatch(r"\s", chr(c))] != space:
        raise SystemExit("re's \\s is not str.isspace here: the port assumes it is")
    word = "byline"
    letters = [matching(store._BYLINE, lambda ch, k=k: f"{word[:k]}{ch}{word[k + 1:]}:x") for k in range(len(word))]
    marathi = "वार्ताहर"
    marks = [matching(store._BYLINE, lambda ch, k=k: f"{marathi[:k]}{ch}{marathi[k + 1:]}:x")
             for k in range(len(marathi))]
    return {
        "fn": "characters",
        "why": "str.isspace, and what each part of the paste parser's expressions accepts",
        "isspace": space,
        "separator_space": matching(store._SEPARATOR, lambda ch: f"{ch}---{ch}"),
        "byline_space_before": matching(store._BYLINE, lambda ch: f"{ch}byline:x"),
        "byline_space_after": matching(store._BYLINE, lambda ch: f"byline{ch}:x"),
        "byline_letters": letters,
        "byline_marathi": marks,
        "byline_colon": matching(store._BYLINE, lambda ch: f"byline{ch}x"),
        "byline_dash_or_space": matching(store._BYLINE, lambda ch: f"byline:{ch}x", lambda m: m.group(1) == "x"),
        "byline_rest_refused": [c for c in ALL if c not in SURROGATES and not store._BYLINE.fullmatch(f"byline:x{chr(c)}")],
        "sentence_end": deskarticles.SENTENCE_END,
    }


def nfc_vector() -> dict:
    """unicodedata.normalize over every code point but the surrogates, summed up block by block: for each code point c
    the NFC and NFD of c, and the NFC of c after a letter and before a mark of class 1, and after a letter and a mark of
    class 240 (which shows any combining class c has). Each block's SHA-256 (its first 16 hex digits) covers these four
    strings of each of its code points, joined with NUL and ended with U+0001, in UTF-8."""
    base, low, high = NFC_PROBES
    hashes = []
    for start in range(0, 0x110000, NFC_BLOCK):
        h = hashlib.sha256()
        for c in range(start, start + NFC_BLOCK):
            if c in SURROGATES:
                continue
            ch = chr(c)
            got = [unicodedata.normalize("NFC", ch), unicodedata.normalize("NFD", ch),
                   unicodedata.normalize("NFC", base + ch + low), unicodedata.normalize("NFC", base + high + ch)]
            h.update(("\0".join(got) + "\1").encode("utf-8"))
        hashes.append(h.hexdigest()[:16])
    return {"fn": "nfc", "why": "Python's NFC and NFD of every code point", "block": NFC_BLOCK, "probes": NFC_PROBES,
            "hashes": hashes}


def unassigned() -> list[list[int]]:
    ranges: list[list[int]] = []
    for c in ALL:
        if unicodedata.category(chr(c)) != "Cn":
            continue
        if ranges and ranges[-1][1] == c - 1:
            ranges[-1][1] = c
        else:
            ranges.append([c, c])
    return ranges


def about() -> dict:
    return {
        "fn": "about",
        "format": FORMAT,
        "generator": "packages/desk-text/test/vectors/generate.py",
        "python": sys.version.split()[0],
        "unicode": unicodedata.unidata_version,
        "constants": {"BRIEF_WORDS": deskarticles.BRIEF_WORDS, "server_BRIEF_WORDS": store.BRIEF_WORDS,
                      "LINE_LIMIT": store.LINE_LIMIT, "BODY_LIMIT": store.BODY_LIMIT,
                      "TEXT_FIELDS": [list(f) for f in store.TEXT_FIELDS]},
        "sources": sources(),
    }


def vectors() -> list[dict]:
    out = [about(), character_vector(), nfc_vector()]
    out += [body_vector(why, text) for why, text in BODIES]
    out += [brief_vector(why, article) for why, article in ARTICLES]
    out += [clean_vector(*case) for case in CLEAN]
    for why, text in PASTES:
        out += paste_vectors(why, text)
    return out


# ------------------------------------------------------------------------------------------------ output


def escaped(line: str) -> str:
    """JSON text with every character Python does not print (controls, format characters, separators, unassigned code
    points, lone surrogates), but the plain space, written as an escape, so the file shows what is in it and holds no
    line break but its own."""
    def escape(m: re.Match) -> str:
        c = ord(m.group())
        if c > 0xFFFF:
            c -= 0x10000
            return f"\\u{0xD800 + (c >> 10):04x}\\u{0xDC00 + (c & 0x3FF):04x}"
        return f"\\u{c:04x}"
    return re.sub(r"[^ -~]", lambda m: m.group() if m.group().isprintable() else escape(m), line)


def jsonl(items: list[dict]) -> str:
    return "".join(escaped(json.dumps(encode(item), ensure_ascii=False)) + "\n" for item in items)


def table(ranges: list[list[int]]) -> str:
    rows = "".join(f"  [0x{a:x}, 0x{b:x}],\n" for a, b in ranges)
    return ("// Generated by packages/desk-text/test/vectors/generate.py from Python's unicodedata (Unicode "
            f"{unicodedata.unidata_version}): do\n"
            "// not edit it. The code points Unicode 14 leaves unassigned (general category Cn), as [first, last] "
            "ranges: Python\n"
            "// 3.11, which the Desk's engine runs on, gives none of them a decomposition or a combining class, so "
            "src/nfc.ts keeps\n"
            "// them out of the JavaScript engine's newer normalisation.\n"
            "export const UNASSIGNED: readonly (readonly [number, number])[] = [\n"
            f"{rows}];\n")


def main() -> int:
    check = sys.argv[1:] == ["--check"]
    if sys.argv[1:] not in ([], ["--check"]):
        raise SystemExit("usage: generate.py [--check]")
    files = {VECTORS: jsonl(vectors()), TABLE: table(unassigned())}
    stale = [path for path, text in files.items() if not path.is_file() or path.read_text(encoding="utf-8") != text]
    for path in stale:
        where = path.relative_to(REPO)
        if check:
            print(f"{where} differs from what the generator makes: run it without --check", file=sys.stderr)
        else:
            path.write_text(files[path], encoding="utf-8")
            print(f"wrote {where}")
    if not stale:
        print("the vectors and the table are what the Desk's functions give")
    return 1 if check and stale else 0


if __name__ == "__main__":
    sys.exit(main())
