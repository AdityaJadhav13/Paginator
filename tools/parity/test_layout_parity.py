"""The structural diff of layout_parity.py on small fictional PDFs (run with the pdfx1 Python, which has pikepdf):
    <pdfx1 python> -B -m unittest discover -s tools/parity -p 'test_layout*'"""
from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

import pikepdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layout_parity as LP  # noqa: E402

GLYPHS = "q BT /F1 10 Tf 0 0 0 1 k 1 0 0 1 {x} 700 Tm <0041> Tj 1 0 0 1 20 700 Tm <0042> Tj ET Q\n" \
         "q 0 0 0 0.5 k 10 10 50 20 re f Q\nq 100 0 0 50 300 400 cm /Im1 Do Q"


def page_pdf(path: Path, x: str = "10", picture: bytes = b"\x00\x10\x20\x30" * 4, level: int = 6) -> Path:
    pdf = pikepdf.new()
    image = pikepdf.Stream(pdf, zlib.compress(picture, level), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image,
                           Width=2, Height=2, ColorSpace=pikepdf.Name.DeviceCMYK, BitsPerComponent=8,
                           Filter=pikepdf.Name.FlateDecode)
    font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1,
                                                BaseFont=pikepdf.Name("/Fictional")))
    content = pikepdf.Stream(pdf, zlib.compress(GLYPHS.format(x=x).encode(), level), Filter=pikepdf.Name.FlateDecode)
    pdf.pages.append(pikepdf.Page(pikepdf.Dictionary(
        Type=pikepdf.Name.Page, MediaBox=[0, 0, 600, 800], Contents=content,
        Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font), XObject=pikepdf.Dictionary(Im1=image)))))
    pdf.save(path, deterministic_id=True, compress_streams=False, stream_decode_level=pikepdf.StreamDecodeLevel.none)
    return path


class Diff(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)

    def kinds(self, a: Path, b: Path) -> dict:
        return {d["what"]: d for d in LP.diff_pdfs(a, b)["differences"]}

    def test_the_same_file_has_no_difference(self):
        a = page_pdf(self.dir / "a.pdf")
        self.assertEqual(LP.diff_pdfs(a, page_pdf(self.dir / "b.pdf"))["differences"], [])

    def test_a_moved_glyph_is_a_changed_number_not_a_missing_mark(self):
        d = self.kinds(page_pdf(self.dir / "a.pdf"), page_pdf(self.dir / "b.pdf", x="10.5"))
        self.assertEqual(d["marks"]["changed_numbers"], {"glyph": 1})
        self.assertEqual(d["marks"]["largest_change"], 0.5)
        self.assertEqual(d["marks"]["unpaired"], {})
        self.assertEqual(d["streams"]["decoded_differ"], 1)

    def test_other_picture_bytes_name_the_picture(self):
        d = self.kinds(page_pdf(self.dir / "a.pdf"), page_pdf(self.dir / "b.pdf", picture=b"\x01" * 16))
        self.assertEqual(d["image"]["fields"], ["data"])
        self.assertNotIn("marks", d)

    def test_only_the_compression_differs(self):
        picture = bytes(i * i % 251 for i in range(4096))[:16] * 256       # compresses differently at levels 1 and 9
        d = self.kinds(page_pdf(self.dir / "a.pdf", picture=picture, level=1),
                       page_pdf(self.dir / "b.pdf", picture=picture, level=9))
        self.assertEqual(d["streams"]["decoded_differ"], 0)
        self.assertGreater(d["streams"]["compressed_differ"], 0)
        self.assertNotIn("marks", d)


if __name__ == "__main__":
    unittest.main()
