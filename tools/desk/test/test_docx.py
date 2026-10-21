"""Word import (stdlib only, fictional text). Run: experiments/phase0/pdfx1/.venv/bin/python -m unittest tools/desk/test/test_docx.py"""
from __future__ import annotations

import io
import struct
import sys
import tracemalloc
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskserver.docx import MAX_BYTES, MAX_XML, DocxError, articles_from_docx  # noqa: E402

NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
STRICT_NS = "http://purl.oclc.org/ooxml/wordprocessingml/main"
PREFIXES = {"mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
            "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
            "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
            "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
            "wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
            "v": "urn:schemas-microsoft-com:vml", "o": "urn:schemas-microsoft-com:office:office",
            "w16se": "http://schemas.microsoft.com/office/word/2015/wordml/symex"}
DAMAGED = "This Word file is damaged. Save it again and try again."
NOT_WORD = "This is not a Word (.docx) file. Save it as .docx and try again."
PROTECTED = ("This Word file is protected with a password, or is an old .doc file: save it as .docx without a password "
             "and try again.")
FORMATTING = "Formatting (bold, italic, sizes) is not kept: the Desk sets the type."


def docx(paragraphs: list | tuple, method: int = zipfile.ZIP_STORED, xml: str | None = None,
         strict: bool = False) -> bytes:
    """A minimal .docx: (style id or "", text) per paragraph ("\\n" in text is a line break), or raw body XML (a str);
    `xml` replaces the whole word/document.xml, `strict` writes strict Open XML."""
    body = []
    for item in paragraphs:
        if isinstance(item, str):
            body.append(item)
            continue
        style, text = item
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        runs = "<w:br/>".join(f'<w:t xml:space="preserve">{part}</w:t>' for part in text.split("\n"))
        body.append(f"<w:p>{ppr}<w:r>{runs}</w:r></w:p>")
    xmlns = f'xmlns:w="{STRICT_NS if strict else NS}" ' + " ".join(f'xmlns:{k}="{v}"' for k, v in PREFIXES.items())
    if xml is None:
        xml = f'<?xml version="1.0" encoding="UTF-8"?><w:document {xmlns}><w:body>{"".join(body)}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", method) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def para(*parts: str, style: str = "") -> str:
    """A paragraph of raw runs (see run())."""
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{ppr}{''.join(parts)}</w:p>"


def run(text: str, props: str = "") -> str:
    """A run of text, with raw run properties such as "<w:b/>"."""
    rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


def bold(text: str) -> str:
    return run(text, "<w:b/>")


def table(*cells: str, props: str = "", style: str = "") -> str:
    """A one-row table with a paragraph of text in each cell (its runs have the raw run properties `props`)."""
    return ("<w:tbl><w:tr>" + "".join(f"<w:tc>{para(run(c, props), style=style)}</w:tc>" for c in cells)
            + "</w:tr></w:tbl>")


def text_box(text: str = "", style: str = "", inside: str = "") -> str:
    """A run holding a text box as Word saves it: a drawing shape, and the same box again in VML for older programs.
    It holds a paragraph of `text`, or the raw paragraphs `inside`."""
    inside = f"<w:txbxContent>{inside or para(run(text), style=style)}</w:txbxContent>"
    return ('<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData '
            'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx>'
            f"{inside}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>"
            f"<mc:Fallback><w:pict><v:shape><v:textbox>{inside}</v:textbox></v:shape></w:pict></mc:Fallback>"
            "</mc:AlternateContent></w:r>")


def emoji(code: str, fallback: str = "\U0001F600") -> str:
    """A run holding an emoji as Word saves it: its code, and the same as text for older programs."""
    return (f'<w:r><mc:AlternateContent><mc:Choice Requires="w16se"><w16se:symEx w16se:font="Segoe UI Emoji" '
            f'w16se:char="{code}"/></mc:Choice><mc:Fallback><w:t>{fallback}</w:t></mc:Fallback>'
            "</mc:AlternateContent></w:r>")


PICTURE = ('<w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/'
           'picture"><pic:pic/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')
OLD_PICTURE = "<w:r><w:pict><v:shape><v:imagedata/></v:shape></w:pict></w:r>"        # a picture in VML (older Word)
OBJECT = "<w:r><w:object><v:shape><v:imagedata/></v:shape></w:object></w:r>"          # an embedded chart or equation
HORIZONTAL_LINE = '<w:r><w:pict><v:rect o:hr="t" o:hrstd="t" o:hralign="center" stroked="f"/></w:pict></w:r>'
VML_TEXT_BOX = (f"<w:r><w:pict><v:shape><v:textbox><w:txbxContent>{para(run('Old box text'))}</w:txbxContent>"
                "</v:textbox></v:shape></w:pict></w:r>")
LINKED_TEXT_BOX = (                                         # a box the text flows on into: no text of its own
    '<w:r><w:drawing><wp:anchor><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/'
    'wordprocessingShape"><wps:wsp><wps:linkedTxbx id="1" seq="1"/></wps:wsp></a:graphicData></a:graphic></wp:anchor>'
    "</w:drawing></w:r>")
GROUPED_TEXT_BOX = (                                                    # both copies of the box inside one drawing
    '<w:r><w:drawing><wp:anchor><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/'
    'wordprocessingGroup"><wpg:wgp><mc:AlternateContent><mc:Choice Requires="wps"><wps:wsp><wps:txbx><w:txbxContent>'
    f'{para(run("Grouped box"))}</w:txbxContent></wps:txbx></wps:wsp></mc:Choice><mc:Fallback><w:pict><v:shape>'
    f'<v:textbox><w:txbxContent>{para(run("Grouped box"))}</w:txbxContent></v:textbox></v:shape></w:pict>'
    "</mc:Fallback></mc:AlternateContent></wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>")
PLACEHOLDER = ("<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>{}</w:sdtContent></w:sdt>")


def story(*paragraphs) -> dict:
    """The one article of a file: a headline, then the given paragraphs."""
    r = articles_from_docx(docx([("", "Fictional headline"), *paragraphs]))
    assert len(r["articles"]) == 1, r
    return r["articles"][0]


def notes(*paragraphs) -> list[str]:
    return articles_from_docx(docx([("", "Fictional headline"), *paragraphs]))["notes"]


class DocxTest(unittest.TestCase):
    def test_one_story_per_file(self):
        r = articles_from_docx(docx([("", "शहरात नव्या उड्डाणपुलाचे काम सुरू"), ("", "प्रतिनिधी, काल्पनिकनगर"),
                                     ("", "पहिला परिच्छेद."), ("Heading2", "कामाचा कालावधी"), ("", "दुसरा परिच्छेद.")]))
        self.assertEqual(len(r["articles"]), 1)
        a = r["articles"][0]
        self.assertEqual(a["headline"], "शहरात नव्या उड्डाणपुलाचे काम सुरू")
        self.assertEqual(a["byline"], "प्रतिनिधी, काल्पनिकनगर")
        self.assertEqual(a["body"], "पहिला परिच्छेद.\n\n## कामाचा कालावधी\n\nदुसरा परिच्छेद.")
        self.assertEqual(r["notes"], [])                                    # nothing was left out: nothing is said

    def test_headings_start_new_stories_and_bylines(self):
        r = articles_from_docx(docx([("Heading1", "First fictional story"), ("", "Byline: A. Writer"), ("", "Its text."),
                                     ("Title", "Second story"), ("", "Line one\nLine two"), ("Heading1", "Empty one")]))
        self.assertEqual([a["headline"] for a in r["articles"]], ["First fictional story", "Second story"])
        self.assertEqual(r["articles"][0]["byline"], "A. Writer")
        self.assertEqual(r["articles"][1]["body"], "Line one\n\nLine two")
        self.assertEqual(r["notes"], ["1 heading had no text under it and was not imported."])
        r = articles_from_docx(docx([("Heading1", "Empty one"), ("Heading1", "Empty two"), ("Heading1", "A story"),
                                     ("", "Its text.")]))
        self.assertEqual(r["notes"], ["2 headings had no text under them and were not imported."])

    def test_headings_2_to_4_are_subheadings(self):
        a = story(("Heading2", "Two"), ("", "Text."), ("Heading3", "Three"), ("Heading4", "Four"), ("", "End."))
        self.assertEqual(a["body"], "## Two\n\nText.\n\n## Three\n\n## Four\n\nEnd.")

    def test_text_is_taken_as_typed_in_nfc(self):
        r = articles_from_docx(docx([("", "Café headline"), ("", "क़ and café.")]))
        self.assertEqual(r["articles"][0]["headline"], "Café headline")
        self.assertEqual(r["articles"][0]["body"], "क़ and café.")     # U+0958 is not kept composed

    def test_strict_open_xml_is_read_like_transitional(self):
        paragraphs = [("Title", "काल्पनिक बातमी"), ("", "प्रतिनिधी, काल्पनिकनगर"), para(bold("ठळक"), run(" मजकूर.")),
                      ("Heading2", "उपशीर्षक"), table("कोष्टक"), para(run("शेवट."), PICTURE)]
        strict = articles_from_docx(docx(paragraphs, strict=True))
        self.assertEqual(strict, articles_from_docx(docx(paragraphs)))
        self.assertEqual(strict["articles"][0]["body"], "ठळक मजकूर.\n\n## उपशीर्षक\n\nशेवट.")
        self.assertEqual(len(strict["notes"]), 3)                           # the table, the picture, the bold text

    def test_not_a_word_file(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("content.xml", "<x/>")                              # a zip, but not a Word file (an .odt…)
        for data in (b"plain text, not a zip", b"", buf.getvalue()):
            with self.assertRaises(DocxError) as e:
                articles_from_docx(data)
            self.assertEqual(str(e.exception), NOT_WORD)
        with self.assertRaisesRegex(DocxError, "larger than 20 MB"):
            articles_from_docx(b"\0" * (MAX_BYTES + 1))
        with self.assertRaises(DocxError) as e:
            articles_from_docx(docx([("", "Only a headline")]))
        self.assertEqual(str(e.exception), "No story was found in this Word file: it needs a headline and some text.")

    def test_a_password_protected_file_or_an_old_doc(self):
        with self.assertRaises(DocxError) as e:
            articles_from_docx(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + bytes(504))
        self.assertEqual(str(e.exception), PROTECTED)


class BylineTest(unittest.TestCase):
    def byline(self, line: str) -> tuple[str, str]:
        """(byline, body) when `line` is the first line under the headline."""
        a = story(("", line), ("", "Its text."))
        return a["byline"], a["body"]

    def test_bylines(self):
        cases = {"Byline: A. Writer": "A. Writer", "BYLINE :  A.   Writer": "A. Writer", "By: A. Writer": "A. Writer",
                 "By A. Writer": "A. Writer", "by A. Writer and B. Writer": "A. Writer and B. Writer",
                 "By A. B. C. D. Writer": "A. B. C. D. Writer", "By É. Writer": "É. Writer",       # five words
                 "Byline :- A. Writer": "A. Writer", "Byline:– A. Writer": "A. Writer",
                 "Byline: — A. Writer": "A. Writer",
                 "वार्ताहर: काल्पनिक लेखक": "काल्पनिक लेखक", "वार्ताहर : काल्पनिक लेखक": "काल्पनिक लेखक",
                 "वार्ताहर :- काल्पनिक लेखक": "काल्पनिक लेखक"}
        as_it_is = ("प्रतिनिधी, काल्पनिकनगर", "आमच्या प्रतिनिधी, काल्पनिकनगर", "आमचे प्रतिनिधी", "प्रतिनिधी",
                    "प्रतिनिधी: काल्पनिकनगर", "प्रतिनिधी : काल्पनिकनगर", "प्रतिनिधी :- काल्पनिकनगर",
                    "प्रतिनिधी, काल्पनिकनगर, ता. काल्पनिक", "वार्ताहर, काल्पनिकनगर", "आमचे वार्ताहर", "वार्ताहर")
        for line, want in [*cases.items(), *((line, line) for line in as_it_is)]:
            with self.subTest(line=line):
                self.assertEqual(self.byline(line), (want, "Its text."))

    def test_a_soft_line_break_in_a_labelled_byline(self):
        self.assertEqual(self.byline("Byline: A. Writer\nकाल्पनिकनगर"), ("A. Writer काल्पनिकनगर", "Its text."))
        self.assertEqual(self.byline("वार्ताहर: काल्पनिक लेखक\nकाल्पनिकनगर"),
                         ("काल्पनिक लेखक काल्पनिकनगर", "Its text."))

    def test_a_short_opening_line_is_not_taken_for_a_byline(self):
        for line in ("Bypass road work starts in May", "वार्ताहरांशी बोलताना मंत्री म्हणाले", "प्रतिनिधींनी सांगितले",
                     "प्रतिनिधींना", "प्रतिनिधीमंडळ", "प्रतिनिधी मंडळाने काल्पनिक गावाला भेट दिली", "Byline A. Writer",
                     "वार्ताहर काल्पनिकनगर", "By noon the road was open.", "By noon the road was open",
                     "By 2030 the plan", "By road and rail", "By evening!",
                     "By the time the fictional council met, the road was closed",
                     "By A. Writer.", "By A. B. C. D. E. Writer",                                  # six words
                     "प्रतिनिधी, काल्पनिकनगर.", "प्रतिनिधी, काल्पनिकनगर।",
                     "प्रतिनिधी, काल्पनिकनगर : आज काल्पनिक शहरात पाणीपुरवठा बंद राहणार आहे.", "Byline: " + "A" * 80):
            with self.subTest(line=line):
                self.assertEqual(self.byline(line), ("", f"{line}\n\nIts text."))

    def test_an_empty_byline_label_is_dropped(self):
        self.assertEqual(self.byline("Byline:"), ("", "Its text."))

    def test_only_the_first_line_under_the_headline_can_be_the_byline(self):
        a = story(("", "First line."), ("", "Byline: A. Writer"))
        self.assertEqual((a["byline"], a["body"]), ("", "First line.\n\nByline: A. Writer"))

    def test_a_subheading_under_the_headline_is_never_the_byline(self):
        for style, line in (("Heading2", "By The Fictional Desk"), ("Heading3", "प्रतिनिधी, काल्पनिकनगर"),
                            ("Heading4", "Byline: A. Writer")):
            with self.subTest(line=line):
                a = story((style, line), ("", "Its text."))
                self.assertEqual((a["byline"], a["body"]), ("", f"## {line}\n\nIts text."))


class ContentTest(unittest.TestCase):
    def test_tables_are_left_out_and_counted(self):
        r = articles_from_docx(docx([("", "काल्पनिक बातमी"), ("", "पहिला परिच्छेद."), table("कोष्टक", "आकडे"),
                                     ("", "दुसरा परिच्छेद."), table("एक"),
                                     table("A heading in a cell", style="Heading1")]))
        self.assertEqual(len(r["articles"]), 1)
        self.assertEqual(r["articles"][0]["body"], "पहिला परिच्छेद.\n\nदुसरा परिच्छेद.")
        self.assertEqual(r["notes"], ["3 tables were not imported: copy their text into the article if it is needed."])

    def test_a_text_box_is_left_out_once(self):
        a = story(para(run("Own text."), text_box("Box text", style="Heading1")), ("", "More."))
        self.assertEqual(a["body"], "Own text.\n\nMore.")
        self.assertEqual(notes(para(run("Own text."), text_box("A")), para(text_box("B"), text_box("C"))),
                         ["3 text boxes were not imported."])

    def test_each_drawing_with_a_text_box_counts_once(self):
        boxes = {"grouped": GROUPED_TEXT_BOX, "nested": text_box(inside=para(run("Outer box"), text_box("Inner box"))),
                 "linked": LINKED_TEXT_BOX, "VML only": VML_TEXT_BOX}
        for case, box in boxes.items():
            with self.subTest(case=case):
                r = articles_from_docx(docx([("", "Fictional headline"), para(run("Own text."), box)]))
                self.assertEqual(r["articles"][0]["body"], "Own text.")
                self.assertEqual(r["notes"], ["1 text box was not imported."])

    def test_pictures_are_counted(self):
        self.assertEqual(story(para(PICTURE), para(run("Text."), OLD_PICTURE))["body"], "Text.")
        cases = {"photos": (PICTURE + OLD_PICTURE, ["2 pictures were not imported: add photos in the Desk."]),
                 "an object": (OBJECT, ["1 picture was not imported: add photos in the Desk."]),
                 "a horizontal line": (HORIZONTAL_LINE, [])}                   # a line is not a picture
        for case, (runs, want) in cases.items():
            with self.subTest(case=case):
                self.assertEqual(notes(para(run("Text."), runs)), want)

    def test_one_of_each(self):
        self.assertEqual(notes(para(run("Text."), PICTURE, text_box("Box")), table("Cell")),
                         ["1 table was not imported: copy its text into the article if it is needed.",
                          "1 text box was not imported.", "1 picture was not imported: add photos in the Desk."])

    def test_deleted_and_moved_away_text_and_field_codes_are_left_out(self):
        a = story(para(run("Kept "), "<w:del><w:r><w:delText>deleted </w:delText></w:r></w:del>",
                       "<w:del><w:r><w:t>deleted too </w:t></w:r></w:del>",
                       "<w:ins><w:r><w:t>inserted </w:t></w:r></w:ins>",
                       "<w:moveFrom><w:r><w:t>moved </w:t></w:r></w:moveFrom>",
                       "<w:moveTo><w:r><w:t>moved </w:t></w:r></w:moveTo>",
                       '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>'
                       '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r>'
                       '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
                       '<w:hyperlink><w:r><w:t xml:space="preserve"> link</w:t></w:r></w:hyperlink>'))
        self.assertEqual(a["body"], "Kept inserted moved 3 link")

    def test_text_that_does_not_show_is_left_out(self):
        a = story(para(run("Shown "), run("hidden ", "<w:vanish/>"), run("shown too", '<w:vanish w:val="0"/>')),
                  para(run("A control: "), PLACEHOLDER.format(run("Click or tap here to enter text."))),
                  PLACEHOLDER.format(para(run("Click or tap here to enter text."))), ("", "End."))
        self.assertEqual(a["body"], "Shown shown too\n\nA control:\n\nEnd.")

    def test_hyphens_tabs_and_breaks(self):
        a = story(para('<w:r><w:t>e</w:t><w:noBreakHyphen/><w:t>mail</w:t><w:tab/><w:t>news</w:t><w:softHyphen/>'
                       "<w:t>paper</w:t><w:br/><w:t>next line</w:t><w:cr/><w:t>last line</w:t></w:r>"))
        self.assertEqual(a["body"], "e-mail newspaper\n\nnext line\n\nlast line")

    def test_content_controls_and_custom_xml_are_read_but_not_their_tables(self):
        nested = f"<w:sdt><w:sdtContent>{para(run('Nested.'))}</w:sdtContent></w:sdt>"
        control = (f'<w:sdt><w:sdtPr><w:alias w:val="Story"/></w:sdtPr><w:sdtContent>{para(run("Inside a control."))}'
                   f"{table('Cell')}{nested}</w:sdtContent></w:sdt>")
        custom = f'<w:customXml w:element="story">{para(run("In custom XML."))}</w:customXml>'
        r = articles_from_docx(docx([("Heading1", "Fictional headline"), control, custom, ("", "After it.")]))
        self.assertEqual(r["articles"][0]["body"], "Inside a control.\n\nNested.\n\nIn custom XML.\n\nAfter it.")
        self.assertEqual(r["notes"], ["1 table was not imported: copy its text into the article if it is needed."])

    def test_an_emoji_comes_through_once(self):
        self.assertEqual(story(para(run("Smile "), emoji("1F600")))["body"], "Smile \U0001F600")
        for code in ("D800", "DFFF", "110000", "ZZ", ""):                 # not a character: nothing
            with self.subTest(code=code):
                self.assertEqual(story(para(run("Smile"), emoji(code, fallback="")))["body"], "Smile")

    def test_no_story_says_what_was_left_out(self):
        with self.assertRaises(DocxError) as e:
            articles_from_docx(docx([("", "Only a headline"), table("The whole story is in a table.")]))
        self.assertEqual(str(e.exception), "No story was found in this Word file: it needs a headline and some text. "
                                           "1 table was not imported: copy its text into the article if it is needed.")


class FormattingTest(unittest.TestCase):
    def test_said_once_for_bold_or_italic_text(self):
        self.assertEqual(notes(para(bold("Bold"), run(" and italic.", "<w:i/>")), ("", "Plain.")), [FORMATTING])
        for props in ("<w:b/>", "<w:bCs/>", '<w:i w:val="1"/>', "<w:iCs/>", '<w:b w:val="true"/>', '<w:i w:val="on"/>'):
            with self.subTest(props=props):
                self.assertEqual(notes(para(run("काल्पनिक मजकूर.", props))), [FORMATTING])

    def test_said_for_a_bold_byline(self):
        for line in (para(run("Byline: "), bold("A. Writer")), para(bold("Byline: A"), run(". Writer")),
                     para(bold("प्रतिनिधी, काल्पनिकनगर"))):
            with self.subTest(line=line):
                self.assertEqual(notes(line, ("", "Its text.")), [FORMATTING])

    def test_not_said_for_formatting_that_is_off_or_not_bold_or_italic(self):
        cases = {"off": para(run("Text.", '<w:b w:val="0"/><w:i w:val="false"/><w:bCs w:val="off"/>')),
                 "off, in capitals": para(run("Text.", '<w:b w:val="OFF"/><w:iCs w:val="False"/>')),
                 "a size": para(run("Text.", '<w:sz w:val="28"/>')),
                 "a bold paragraph mark": '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Text.</w:t></w:r></w:p>',
                 "a bold run with no text": para(run("Text."), "<w:r><w:rPr><w:b/></w:rPr><w:tab/></w:r>"),
                 "bold spaces": para(run("Text."), bold("   "))}
        for case, paragraph in cases.items():
            with self.subTest(case=case):
                self.assertEqual(notes(paragraph), [])

    def test_not_said_for_text_that_is_not_imported(self):
        cases = {"a table": [para(run("Text.")), table("Bold, but only in a table.", props="<w:b/>")],
                 "a text box": [para(run("Text."), text_box(inside=para(bold("Bold box."))))],
                 "hidden text": [para(run("Text."), run(" hidden", "<w:b/><w:vanish/>"))],
                 "deleted text": [para(run("Text."), f"<w:del>{bold(' deleted')}</w:del>")],
                 "the byline label": [para(bold("Byline:"), run(" A. Writer")), ("", "Text.")],
                 "the By of a byline": [para(bold("By"), run(" A. Writer")), ("", "Text.")]}
        for case, paragraphs in cases.items():
            with self.subTest(case=case):
                self.assertNotIn(FORMATTING, notes(*paragraphs))

    def test_not_said_for_stories_that_are_not_imported(self):
        r = articles_from_docx(docx([para(bold("A heading with nothing under it"), style="Heading1"),
                                     ("Heading1", "A story"), ("", "Its text.")]))
        self.assertEqual(r["notes"], ["1 heading had no text under it and was not imported."])
        many = [p for i in range(200) for p in (("Heading1", f"Story {i + 1}"), ("", "Its text."))]
        r = articles_from_docx(docx([*many, ("Heading1", "Story 201"), para(bold("Bold, but not imported."))]))
        self.assertEqual(r["notes"], ["This file holds more than 200 stories; only the first 200 were imported."])


class StoryLimitTest(unittest.TestCase):
    def test_at_most_200_stories(self):
        many = [p for i in range(201) for p in (("Heading1", f"Story {i + 1}"), ("", "Its text."))]
        r = articles_from_docx(docx(many))
        self.assertEqual(len(r["articles"]), 200)
        self.assertEqual(r["articles"][-1]["headline"], "Story 200")
        self.assertEqual(r["notes"], ["This file holds more than 200 stories; only the first 200 were imported."])
        r = articles_from_docx(docx(many[:400]))                              # exactly 200: all, and nothing is said
        self.assertEqual((len(r["articles"]), r["notes"]), (200, []))


def member_start(data: bytes) -> int:
    """Where word/document.xml's stored or compressed bytes start in the zip."""
    info = zipfile.ZipFile(io.BytesIO(data)).getinfo("word/document.xml")
    name_len, extra_len = struct.unpack("<HH", data[info.header_offset + 26:info.header_offset + 30])
    return info.header_offset + 30 + name_len + extra_len


def directory_entry(data: bytes, name: bytes) -> int:
    """Where a file's entry in the zip's central directory starts."""
    i = 0
    while (i := data.find(b"PK\x01\x02", i)) >= 0:
        if data[i + 46:i + 46 + struct.unpack("<H", data[i + 28:i + 30])[0]] == name:
            return i
        i += 4
    raise LookupError(name)


class DamagedFileTest(unittest.TestCase):
    PARAS = (("", "Fictional headline"), ("", "Its text, long enough to be worth packing: " + "words " * 40))

    def assertDamaged(self, data: bytes | bytearray, message: str = DAMAGED) -> None:
        with self.assertRaises(DocxError) as e:
            articles_from_docx(bytes(data))
        self.assertEqual(str(e.exception), message)

    def test_a_changed_byte_fails_the_checksum(self):
        data = bytearray(docx(self.PARAS))
        data[member_start(data) + 200] ^= 0x01
        self.assertDamaged(data)

    def test_packed_data_that_does_not_unpack(self):
        data = bytearray(docx(self.PARAS, zipfile.ZIP_DEFLATED))
        data[member_start(data)] = 0xFF                                       # a deflate block of the reserved type
        self.assertDamaged(data)

    def test_only_the_packing_word_uses_is_read(self):
        for method in (zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):                  # these unpack a member all at once
            with self.subTest(method=method):
                self.assertDamaged(docx(self.PARAS, method))

    def test_a_cut_off_file(self):
        whole = docx(self.PARAS, zipfile.ZIP_DEFLATED)
        self.assertDamaged(whole[:len(whole) // 2])                           # starts as a zip does, then stops
        data = bytearray(whole)
        at = directory_entry(data, b"word/document.xml") + 20                 # the packed size: half of it is read
        data[at:at + 4] = struct.pack("<I", struct.unpack("<I", data[at:at + 4])[0] // 2)
        self.assertDamaged(data)
        # Pythons without the zip "overlapped entries" check can also end a cut-off member with EOFError.
        with mock.patch.object(zipfile.ZipExtFile, "read", side_effect=EOFError):
            self.assertDamaged(docx(self.PARAS))

    def test_a_zip_directory_that_cannot_be_read(self):
        data = bytearray(docx(self.PARAS))
        at = directory_entry(data, b"[Content_Types].xml")
        data[at + 8:at + 10] = struct.pack("<H", struct.unpack("<H", data[at + 8:at + 10])[0] | 0x800)
        data[at + 46] = 0xFF                                                  # a name marked UTF-8 that is not
        self.assertDamaged(data)
        data = bytearray(docx(self.PARAS))
        at = directory_entry(data, b"word/document.xml")
        data[at + 6:at + 8] = struct.pack("<H", 99)                           # needs zip version 9.9
        self.assertDamaged(data)

    def test_xml_that_cannot_be_read(self):
        for xml in ("<w:document", '<?xml version="1.0" encoding="shift_jis"?><w:document/>',
                    '<?xml version="1.0" encoding="no-such-encoding"?><w:document/>'):
            with self.subTest(xml=xml):
                self.assertDamaged(docx([], xml=xml))

    def test_a_document_too_large_to_read(self):
        data = bytearray(docx(self.PARAS))
        at = directory_entry(data, b"word/document.xml") + 24                 # the unpacked size, as the zip says
        data[at:at + 4] = struct.pack("<I", MAX_XML + 1)
        self.assertDamaged(data, "This Word file is too large to read.")

    def test_unpacking_is_bounded(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", "<Types/>")
            with z.open("word/document.xml", "w") as f:
                for _ in range(64):
                    f.write(bytes(1 << 20))                                   # 64 MB of zeros pack into 64 KB
        data = bytearray(buf.getvalue())
        at = directory_entry(data, b"word/document.xml") + 24
        data[at:at + 4] = struct.pack("<I", 1000)                             # but the zip says 1000 bytes
        tracemalloc.start()
        try:
            self.assertDamaged(data)
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 64 * 1024 * 1024)                               # not unpacked all at once


if __name__ == "__main__":
    unittest.main()
