"""Tests for l3_spacing.py on fictional data: a tiny PDF with a Type0 font dictionary (no font program) and the pure
gap and run functions. Run: python -B -m unittest discover -s tools/parity -p 'test_l3*'"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import pikepdf

import l3_spacing as L3

CMAP = b"""/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar
<0001> <0915>
<0002> <0020>
endbfchar
1 beginbfrange
<0010> <0012> <001F>
endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end"""


def tiny_pdf(path: Path, content: bytes) -> None:
    pdf = pikepdf.new()
    cid = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.CIDFontType2, BaseFont=pikepdf.Name.Test,
                             DW=1000, W=pikepdf.Array([1, pikepdf.Array([500, 250]), 3, 4, 600]))
    font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type0, BaseFont=pikepdf.Name.Test,
                              Encoding=pikepdf.Name("/Identity-H"), DescendantFonts=pikepdf.Array([cid]),
                              ToUnicode=pikepdf.Stream(pdf, CMAP))
    page = pikepdf.Page(pikepdf.Dictionary(Type=pikepdf.Name.Page, MediaBox=[0, 0, 200, 300],
                                           Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font)),
                                           Contents=pikepdf.Stream(pdf, content)))
    pdf.pages.append(page)
    pdf.save(path)


class PdfLines(unittest.TestCase):
    def test_glyphs_advances_spaces_and_blocks(self):
        content = (b"q BT /F1 10 Tf 1 0 0 1 20 250 Tm <0001> Tj 1 0 0 1 25 250 Tm <0002> Tj "
                   b"1 0 0 1 29 250 Tm <00030012> Tj 1 0 0 1 40 251 Tm <0001> Tj ET Q "
                   b"BT /F1 20 Tf 0.5 0 0 1 20 200 Tm <0005> Tj ET")
        with tempfile.TemporaryDirectory() as d:
            tiny_pdf(Path(d) / "t.pdf", content)
            height, lines = L3.pdf_lines(Path(d) / "t.pdf")
        self.assertEqual(height, 300.0)
        self.assertEqual(len(lines), 2)
        first, second = lines
        self.assertEqual(first["y"], 250.0)                  # the most common y; a raised mark does not move it
        # <0001> 500/1000 × 10; <0002> a space; <0003> 600, then <0012> (no /W: DW 1000) after it; a raised glyph
        self.assertEqual(first["glyphs"], [(20.0, 5.0, False), (25.0, 2.5, True), (29.0, 6.0, False),
                                           (35.0, 10.0, False), (40.0, 5.0, False)])
        self.assertEqual(second["glyphs"], [(20.0, 1000 / 1000 * 20 * 0.5, False)])   # CID 5 falls to /DW; a = 0.5

    def test_unhandled_text_operator_fails_loudly(self):
        with tempfile.TemporaryDirectory() as d:
            tiny_pdf(Path(d) / "t.pdf", b"BT /F1 10 Tf 1 0 0 1 20 250 Tm [<0001> -50 <0001>] TJ ET")
            with self.assertRaises(ValueError):
                L3.pdf_lines(Path(d) / "t.pdf")


class MeasurePage(unittest.TestCase):
    def test_the_three_ways_out_of_the_policy(self):
        """One column (right edge 30 mm), house space 0.25 × 10 pt = 2.5 pt; <0001> is 5 pt wide, <0002> the space."""
        edge = 30 * L3.MM
        lines = {  # y pt → (manifest kind, glyphs as (x pt, cid), expected outside)
            250: ("justified", [(60, 1), (65, 2), (edge - 5, 1)], None),                    # gap 6.02 house spaces
            230: ("ragged", [(60, 1), (65, 2), (70, 1)], "short_of_measure"),
            210: ("justified", [(edge - 10.5, 1), (edge - 5.5, 2), (edge - 5, 1)], "below_floor"),   # gap 0.2
            190: ("overfull", [(edge - 4, 1)], "overfull"),
            170: ("final", [(60, 1), (65, 2), (70, 1)], None),                              # a final line may be short
        }
        content, manifest = b"", []
        for y, (kind, glyphs, _) in lines.items():
            content += b"BT /F1 10 Tf " + b" ".join(b"1 0 0 1 %.3f %d Tm <%04x> Tj" % (x, y, c) for x, c in glyphs) + b" ET "
            manifest.append({"role": "body", "kind": kind, "story": "s1", "column": 0, "baseline_mm": (300 - y) / L3.MM,
                             "x0_mm": glyphs[0][0] / L3.MM, "x1_mm": (glyphs[-1][0] + 5) / L3.MM,
                             "text": " ".join("क" for _, c in glyphs if c == 1)})
        with tempfile.TemporaryDirectory() as d:
            rep = Path(d)
            (rep / "gen1").mkdir()
            (rep / "page1" / "pages").mkdir(parents=True)
            tiny_pdf(rep / "gen1" / "p.pdf", content)
            (rep / "gen1" / "p.manifest.json").write_text(json.dumps({
                "lines": manifest, "fixed_stories_out": [],
                "stories_out": [{"story": "s1", "style": [10.0, 11.0], "columns": [[0, 0, 30.0, 100]]}]}))
            (rep / "page1" / "pages" / "p.json").write_text(json.dumps({"stories": []}))
            out, n = L3.measure_page(rep, "p")
        self.assertEqual([ln["outside"] for ln in out], [want for _, _, want in lines.values()])
        self.assertEqual(n["unmatched"], 0)
        self.assertAlmostEqual(out[0]["gaps"][0], (edge - 70) / 2.5, places=3)
        self.assertEqual(L3.longest_run([ln["outside"] is not None for ln in out]), 3)


class PureFunctions(unittest.TestCase):
    def test_space_codes_bfchar_and_bfrange(self):
        self.assertEqual(L3.space_codes(CMAP), {0x0002, 0x0011})   # <0010>-<0012> → U+001F..U+0021: 0x11 is U+0020

    def test_widths_both_forms(self):
        self.assertEqual(L3.widths(pikepdf.Array([1, pikepdf.Array([500, 250]), 3, 4, 600])),
                         {1: 500.0, 2: 250.0, 3: 600.0, 4: 600.0})

    def test_gaps_from_space_glyph_to_next_glyph(self):
        glyphs = [(0.0, 5.0, False), (5.0, 2.0, True), (9.0, 4.0, False), (13.0, 2.0, True), (14.5, 4.0, False)]
        self.assertEqual(L3.gaps_pt(glyphs), [4.0, 1.5])
        self.assertEqual(L3.gaps_pt([(0.0, 5.0, False)]), [])

    def test_runs(self):
        flags = [True, True, False, True, True, True, False, True]
        self.assertEqual(L3.longest_run(flags), 3)
        self.assertEqual(L3.runs_at_least(flags, 3), 1)
        self.assertEqual(L3.runs_at_least(flags, 2), 2)
        self.assertEqual(L3.runs_at_least([True] * 3, 3), 1)          # a run that ends the column counts
        self.assertEqual(L3.longest_run([]), 0)

    def test_context(self):
        mk = lambda widest, space=1.0, final=False, justified=True: {  # noqa: E731
            "widest": widest, "space": space, "final": final, "justified": justified}
        lines = [mk(1.5), mk(2.5), mk(3.5, 0.7), mk(None, None), mk(9.0, final=True)]
        c = L3.context(lines, runs3=0)
        self.assertEqual((c["nonfinal_lines"], c["nonfinal_with_gap"]), (4, 3))
        self.assertEqual((c["gt2_pct"], c["gt3_pct"], c["lt08_pct"]), (66.67, 33.33, 33.33))
        self.assertEqual(c["widest_p95"], 2.5)                          # sorted(w)[int(0.95 × (n − 1))], as compose3


if __name__ == "__main__":
    unittest.main()
