"""EXP-PDF-1 mutation test: does verify_press_test.py catch real defects? (EXPERIMENTAL)

Each mutation damages a copy of a generated press-test PDF in one specific way. Where a generator bug would also
corrupt the manifest, the manifest copy is changed CONSISTENTLY (and its hash updated) so the defect cannot be caught by
self-comparison — only by the independent checks. Each mutation must make its target check FAIL.
  A white text drawn with the overprint state      → "overprint only when painting 100K black"
  B body font size changed in the content stream    → "every glyph: font, size, id and position as composed"
  C a Devanagari mark's outline emptied in the font → "every used glyph's outline … = the original font"
  D xref offset corrupted                           → "qpdf structural check"
  E vertical mark offsets mirrored (the review's blocker), manifest consistent → "INDEPENDENT shaping: vertical mark offsets"
  F one glyph id replaced (content + manifest)      → "INDEPENDENT shaping: same glyph ids"
Usage: experiments/phase0/pdfx1/.venv/bin/python mutation_test.py <generated.pdf>   (use a --synthetic build)
"""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pikepdf
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph

HERE = Path(__file__).resolve().parent
PY = sys.executable


def run_verify(pdf: Path) -> dict:
    r = subprocess.run([PY, str(HERE / "verify_press_test.py"), str(pdf), "--json", str(pdf.with_suffix(".v.json"))],
                       capture_output=True, text=True)
    return {x["check"]: x["pass"] for x in json.loads(pdf.with_suffix(".v.json").read_text())["results"]}


def save(pdf: pikepdf.Pdf, out: Path, man: dict) -> None:
    pdf.save(out, object_stream_mode=pikepdf.ObjectStreamMode.disable, static_id=True)
    man["sha256"] = hashlib.sha256(out.read_bytes()).hexdigest()
    out.with_suffix(".manifest.json").write_text(json.dumps(man, ensure_ascii=False))


def rewrite_content(pdf: pikepdf.Pdf, fn) -> None:
    page = pdf.pages[0]
    ops = pikepdf.parse_content_stream(page)
    new = fn(ops)
    page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(new))


def main():
    src = Path(sys.argv[1]); man0 = json.loads(src.with_suffix(".manifest.json").read_text(encoding="utf-8"))
    tmp = Path(tempfile.mkdtemp(prefix="pdfx1-mut-"))
    results = {}

    def case(name, target, build):
        out = tmp / f"{name}.pdf"
        man = json.loads(json.dumps(man0))
        build(out, man)
        res = run_verify(out)
        hit = [k for k, v in res.items() if not v and target in k]
        results[name] = {"target": target, "caught": bool(hit), "failed_checks": [k for k, v in res.items() if not v]}
        print(f"{'CAUGHT' if hit else 'MISSED'}  {name}: {target}  (failed: {len(results[name]['failed_checks'])} checks)")

    def mut_a(out, man):          # white text with overprint
        pdf = pikepdf.open(src)

        def fn(ops):
            res, white = [], False
            for operands, op in ops:
                if str(op) == "k":
                    white = [float(v) for v in operands] == [0, 0, 0, 0]
                res.append((operands, op))
            # second pass: in every q…Q group that later selects white fill, switch its gs to GSop
            out_ops, i = [], 0
            while i < len(res):
                operands, op = res[i]
                if str(op) == "gs" and str(operands[0]) == "/GSko":
                    j = i + 1
                    while j < len(res) and str(res[j][1]) not in ("Q",):
                        if str(res[j][1]) == "k" and [float(v) for v in res[j][0]] == [0, 0, 0, 0] and str(res[j - 1][1]) == "Tf":
                            operands = [pikepdf.Name("/GSop")]
                            break
                        j += 1
                out_ops.append((operands, op)); i += 1
            return out_ops
        rewrite_content(pdf, fn); save(pdf, out, man)

    def mut_b(out, man):          # body size 10.848 → 13 in content stream only
        pdf = pikepdf.open(src)
        body = man["params"]["body_pt"]

        def fn(ops):
            return [([o[0], 13] if str(op) == "Tf" and abs(float(o[1]) - body) < 1e-6 else o, op) for o, op in ops]
        rewrite_content(pdf, fn); save(pdf, out, man)

    def mut_c(out, man):          # empty the outline of a used zero-advance mark glyph in F1
        pdf = pikepdf.open(src)
        f1 = pdf.pages[0].Resources.Font.F1
        ff = f1.DescendantFonts[0].FontDescriptor.FontFile2
        tt = TTFont(io.BytesIO(ff.read_bytes()))
        order, hm = tt.getGlyphOrder(), tt["hmtx"].metrics
        used = {g[0] for l in man["lines"] if l["font"] == "F1" for g in l["glyphs"]}
        target = next(g for g in sorted(used) if hm[order[g]][0] == 0 and tt["glyf"][order[g]].numberOfContours != 0)
        tt["glyf"][order[target]] = Glyph()
        buf = io.BytesIO(); tt.save(buf)
        data = buf.getvalue()
        ff.write(data); ff.Length1 = len(data)
        save(pdf, out, man)

    def mut_d(out, man):          # corrupt one xref offset
        raw = bytearray(src.read_bytes())
        i = raw.rfind(b"\nxref\n") + len(b"\nxref\n0 ")
        j = raw.index(b" 00000 n", i)
        raw[j - 10:j] = b"%010d" % 7
        out.write_bytes(bytes(raw))
        man["sha256"] = hashlib.sha256(bytes(raw)).hexdigest()
        out.with_suffix(".manifest.json").write_text(json.dumps(man, ensure_ascii=False))

    def mut_e(out, man):          # mirror vertical mark offsets in content AND manifest (the review's blocker)
        pdf = pikepdf.open(src)
        H = man["page_mm"][1] * 72 / 25.4
        moved = {}
        for l in man["lines"]:
            base = round((man["page_mm"][1] - l["baseline_mm"]) * 72 / 25.4, 3)
            for g in l["glyphs"]:
                if abs(g[2] - base) > 0.01:
                    new_y = round(2 * base - g[2], 3)
                    moved[(round(g[1], 3), round(g[2], 3))] = new_y
                    g[2] = new_y

        def fn(ops):
            res = []
            for o, op in ops:
                if str(op) == "Tm":
                    key = (round(float(o[4]), 3), round(float(o[5]), 3))
                    if key in moved:
                        o = [o[0], o[1], o[2], o[3], o[4], moved[key]]
                res.append((o, op))
            return res
        rewrite_content(pdf, fn); save(pdf, out, man)
        print(f"   (E moved {len(moved)} marked glyphs)")

    def mut_f(out, man):          # replace one body glyph id consistently
        pdf = pikepdf.open(src)
        line = next(l for l in man["lines"] if l.get("role") == "body")
        old, new = line["glyphs"][0][0], line["glyphs"][0][0] + 1
        pos = (round(line["glyphs"][0][1], 3), round(line["glyphs"][0][2], 3))
        line["glyphs"][0][0] = new
        state = {"tm": None}

        def fn(ops):
            res = []
            for o, op in ops:
                if str(op) == "Tm":
                    state["tm"] = (round(float(o[4]), 3), round(float(o[5]), 3))
                if str(op) == "Tj" and state["tm"] == pos and int.from_bytes(bytes(o[0]), "big") == old:
                    o = [pikepdf.String(new.to_bytes(2, "big"))]
                res.append((o, op))
            return res
        rewrite_content(pdf, fn); save(pdf, out, man)

    case("A_white_overprint", "overprint only when painting 100K black", mut_a)
    case("B_body_size", "every glyph: font, size, id and position", mut_b)
    case("C_empty_mark_outline", "outline and advance = the original font", mut_c)
    case("D_xref_offset", "qpdf structural check", mut_d)
    case("E_mirrored_mark_offsets", "INDEPENDENT shaping: vertical mark offsets", mut_e)
    case("F_wrong_glyph_id", "INDEPENDENT shaping: same glyph ids", mut_f)
    (src.parent / (src.stem + ".mutation.json")).write_text(json.dumps(results, indent=1) + "\n")
    shutil.rmtree(tmp)
    missed = [k for k, v in results.items() if not v["caught"]]
    print("\nALL MUTATIONS CAUGHT" if not missed else f"\nMISSED: {missed}")
    sys.exit(0 if not missed else 1)


if __name__ == "__main__":
    main()
