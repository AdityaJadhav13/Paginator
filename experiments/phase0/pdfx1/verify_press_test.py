"""EXP-PDF-1 verification of a generated press-test PDF (EXPERIMENTAL).

Runs in experiments/phase0/pdfx1/.venv (pikepdf/qpdf, pypdfium2, pdfminer.six, fontTools, uharfbuzz). Several checks
are INDEPENDENT of the generator: fonts are re-instanced here from the original variable font files and every line is
re-shaped here with HarfBuzz, so a generator mistake cannot hide behind data the generator also produced.
  1 structure    qpdf strict parse, no problems; classic xref; not encrypted; manifest hash = file hash
  2 PDF/X keys   header version and GTS keys as declared; Title; dates; /Trapped /False; /ID; OutputIntent with the
                 registered identifier and NO embedded profile
  3 page boxes   MediaBox = TrimBox = BleedBox = the declared page (347 × 540 mm)
  4 paint        DeviceCMYK only (k/K); no images/shadings/XObjects/cm; no transparency; overprint ExtGState used ONLY
                 when painting 100K black (white or colour with overprint would vanish or mix on press)
  5 text ops     every Tj draws one 2-byte glyph with an upright unscaled Tm; Tf font and size equal the manifest
  6 positions    every glyph in the content equals the manifest (order, font, glyph id, position ±0.002 pt)
  7 fonts        Type0/CIDFontType2/Identity-H/CIDToGIDMap Identity/FontFile2/ToUnicode; /W = embedded advances;
                 INDEPENDENT: every used glyph's outline and advance equal the original font instance (re-instanced here)
  8 shaping      INDEPENDENT: every line re-shaped here with HarfBuzz from the original fonts: same glyph ids; vertical
                 mark offsets (y-up) and in-word horizontal spacing in the PDF equal HarfBuzz's
  9 text         every line reads back exactly with the ActualText-aware reader (published1/actualtext.py)
                 (without ActualText: only lines whose clusters ToUnicode can represent are compared)
 10 rendering    PDFium renders; patch colours as intended
Usage: experiments/phase0/pdfx1/.venv/bin/python verify_press_test.py <file.pdf> [--json report.json]
Exit code 0 only when every check passes.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import unicodedata
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / "published1"))
import actualtext as AT  # noqa: E402

MM = 72 / 25.4
FONT_DIRS = [REPO / "tools" / "oracle" / "v0" / "assets" / "fonts", REPO / "experiments" / "phase0" / "compose2" / "fonts"]
results: list = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append({"check": name, "pass": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    return ok


def norm(s: str) -> str:
    return " ".join(unicodedata.normalize("NFC", s.replace(" ", " ")).split())


# ------------------------------------------------------------------------------------------- independent fonts
def original_instance(family: str, axes: dict | None, weight: int) -> bytes:
    """Instance the ORIGINAL font file for `family` at the given axes (all axes pinned), independently of the generator."""
    for d in FONT_DIRS:
        for f in sorted(d.rglob("*.ttf")):
            tt = TTFont(f, lazy=True)
            fam = tt["name"].getDebugName(16) or tt["name"].getDebugName(1)
            if fam != family:
                continue
            if "fvar" not in tt:
                return f.read_bytes()
            loc = {a.axisTag: a.defaultValue for a in tt["fvar"].axes}
            loc.update(axes or {})
            if "wght" in loc and not (axes and "wght" in axes):
                loc["wght"] = float(weight)
            tt = TTFont(f)
            inst = instancer.instantiateVariableFont(tt, loc)
            buf = io.BytesIO(); inst.save(buf)
            return buf.getvalue()
    raise FileNotFoundError(f"original font for {family!r} not found under {FONT_DIRS}")


def shape(face_bytes: bytes, text: str):
    """Itemise by script (Devanagari vs other) and shape each run with HarfBuzz (language mr for Devanagari)."""
    face = hb.Face(face_bytes); font = hb.Font(face)
    upem = face.upem
    runs, cur, cur_deva = [], "", None
    for ch in text:
        deva = "ऀ" <= ch <= "ॿ" or ch in "‌‍"
        strong = deva or ch.isalpha()
        if cur and strong and deva != cur_deva:
            runs.append((cur, cur_deva)); cur = ""
        if strong or cur_deva is None:
            cur_deva = deva if strong else cur_deva
        cur += ch
    if cur:
        runs.append((cur, cur_deva))
    out = []
    for t, deva in runs:
        buf = hb.Buffer(); buf.add_str(t); buf.guess_segment_properties()
        # invisible default-ignorables (ZWJ/ZWNJ) produce no glyph — the same convention as the composer; they do
        # still shape their neighbours (e.g. श्‍व keeps the half-form) and they are kept in the text layer
        buf.flags = hb.BufferFlags.REMOVE_DEFAULT_IGNORABLES
        if deva:
            buf.script = "Deva"; buf.language = "mr"
        hb.shape(font, buf)
        out += [(i.codepoint, p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]
    return out, upem


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("pdf", type=Path); ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    man = json.loads(a.pdf.with_suffix(".manifest.json").read_text(encoding="utf-8"))
    raw = a.pdf.read_bytes()

    # 1 structure
    check("manifest describes this exact file (SHA-256)", hashlib.sha256(raw).hexdigest() == man["sha256"])
    pdf = pikepdf.open(a.pdf)
    problems = pdf.check_pdf_syntax() if hasattr(pdf, "check_pdf_syntax") else pdf.check()
    check("qpdf structural check", len(problems) == 0, "; ".join(str(p) for p in problems[:5]) or "no problems")
    check("not encrypted", not pdf.is_encrypted)
    check("classic xref, no object streams", b"/ObjStm" not in raw and b"\nxref\n" in raw)

    # 2 PDF/X keys
    fl = man["pdfx"]
    head = raw[:9].decode("latin-1")
    info = pdf.docinfo
    check(f"header %PDF-{fl['pdf_version']} ({fl['flavour']})", head.startswith(f"%PDF-{fl['pdf_version']}"), head.strip())
    for k, v in fl["info"].items():
        check(f"Info /{k} = {v}", str(info.get("/" + k)) == v, str(info.get("/" + k)))
    if fl["flavour"] == "X-1a:2003":
        check("no GTS_PDFXConformance key (not used in PDF/X-1a:2003)", "/GTS_PDFXConformance" not in info)
    check("Title present", bool(str(info.get("/Title", ""))))
    for k in ("/CreationDate", "/ModDate"):
        v = str(info.get(k, ""))
        check(f"{k[1:]} is a PDF date", v.startswith("D:") and len(v) >= 16 and v[2:16].isdigit(), v)
    check("/Trapped is /False", str(info.get("/Trapped")) == "/False", str(info.get("/Trapped")))
    tid = pdf.trailer.get("/ID")
    check("trailer /ID present (2 strings)", tid is not None and len(tid) == 2)
    ois = pdf.Root.get("/OutputIntents")
    oi = ois[0] if ois is not None and len(ois) else None
    check("OutputIntent /S /GTS_PDFX", oi is not None and str(oi.get("/S")) == "/GTS_PDFX")
    check("OutputConditionIdentifier as declared", oi is not None and str(oi.get("/OutputConditionIdentifier")) == man["output_intent"]["OutputConditionIdentifier"],
          str(oi.get("/OutputConditionIdentifier")) if oi is not None else "missing")
    if man.get("dest_profile"):
        prof = oi.get("/DestOutputProfile") if oi is not None else None
        data = prof.read_bytes() if prof is not None else b""
        check("embedded DestOutputProfile is the declared CMYK v2 output profile",
              prof is not None and int(prof.get("/N", 0)) == 4 and hashlib.sha256(data).hexdigest() == man["dest_profile"]["sha256"]
              and data[12:20] == b"prtrCMYK" and data[8] == 2)
    else:
        check("registered characterization: RegistryName present, no embedded DestOutputProfile",
              oi is not None and bool(str(oi.get("/RegistryName", ""))) and "/DestOutputProfile" not in oi)

    # 3 boxes
    page = pdf.pages[0]
    want = [0, 0, man["page_mm"][0] * MM, man["page_mm"][1] * MM]
    for box in ("/MediaBox", "/TrimBox", "/BleedBox"):
        got = [float(v) for v in page.obj[box]]
        check(f"{box[1:]} = {man['page_mm'][0]} × {man['page_mm'][1]} mm", all(abs(g - w) < 0.01 for g, w in zip(got, want)), str([round(v, 3) for v in got]))
    check("no ArtBox (TrimBox only)", "/ArtBox" not in page.obj)

    # 4/5/6 content walk
    gs_res = {str(k)[1:]: v for k, v in page.Resources.ExtGState.items()}
    op_gs = {n for n, g in gs_res.items() if bool(g.get("/OP", False)) or bool(g.get("/op", False))}
    stack = []
    state = {"gs": None, "fill": None, "stroke": None}
    bad_ops, op_misuse, tm_bad, glyphs, tf = [], [], [], [], None
    for operands, op in pikepdf.parse_content_stream(page):
        o = str(op)
        if o == "q":
            stack.append(dict(state))
        elif o == "Q":
            state = stack.pop()
        elif o == "gs":
            state["gs"] = str(operands[0])[1:]
        elif o == "k":
            state["fill"] = tuple(round(float(v), 4) for v in operands)
        elif o == "K":
            state["stroke"] = tuple(round(float(v), 4) for v in operands)
        elif o in ("rg", "RG", "g", "G", "sc", "scn", "SC", "SCN", "cs", "CS", "sh", "BI", "Do", "cm", "d0", "d1", "TJ", "'", '"', "Tz", "Ts", "Tr", "Tc", "Tw"):
            bad_ops.append(o)
        elif o == "Tf":
            tf = (str(operands[0])[1:], float(operands[1]))
        elif o == "Tm":
            m = [float(v) for v in operands]
            if m[:4] != [1, 0, 0, 1]:
                tm_bad.append(m)
            tm = (m[4], m[5])
        elif o == "Tj":
            b = bytes(operands[0])
            if len(b) != 2:
                tm_bad.append(("Tj with", len(b), "bytes"))
            glyphs.append((tf[0], tf[1], int.from_bytes(b[:2], "big"), tm[0], tm[1]))
        if o in ("Tj", "f", "F", "f*", "B", "b") and state["gs"] in op_gs and state["fill"] != (0, 0, 0, 1):
            op_misuse.append((o, state["fill"]))
        if o in ("S", "s", "B", "b") and state["gs"] in op_gs and state["stroke"] != (0, 0, 0, 1):
            op_misuse.append((o, state["stroke"]))
    check("only DeviceCMYK k/K colour; no images, shadings, cm, TJ or text-state tricks", not bad_ops, f"unexpected: {sorted(set(bad_ops))}" if bad_ops else "ok")
    check("overprint only when painting 100K black", not op_misuse, f"{len(op_misuse)} paints, e.g. {op_misuse[:3]}" if op_misuse else
          f"{sum(1 for g in glyphs)} glyph paints checked; overprint states {sorted(op_gs)}")
    gs_bad = [f"{n}{k}" for n, g in gs_res.items() for k in ("/SMask", "/CA", "/ca", "/BM", "/TR", "/TR2", "/HT") if k in g]
    check("no transparency, transfer or halftone keys in ExtGState", not gs_bad, ", ".join(gs_bad))
    check("no XObjects / images / annotations", "/XObject" not in page.Resources and "/Annots" not in page.obj)
    check("every Tj: one 2-byte glyph, upright unscaled Tm", not tm_bad, str(tm_bad[:3]))
    exp = [(l["font"], l["size_pt"], g[0], g[1], g[2]) for l in man["lines"] for g in l["glyphs"]]
    mism = [i for i, (e, g) in enumerate(zip(exp, glyphs)) if e[0] != g[0] or abs(e[1] - g[1]) > 1e-3 or e[2] != g[2]
            or abs(e[3] - g[3]) > 0.002 or abs(e[4] - g[4]) > 0.002]
    check("every glyph: font, size, id and position as composed", len(exp) == len(glyphs) and not mism,
          f"{len(glyphs)} glyphs decoded, {len(exp)} expected, {len(mism)} mismatches" + (f"; first {exp[mism[0]]} vs {glyphs[mism[0]]}" if mism else ""))

    # 7 fonts (independent instances)
    fonts = {str(k)[1:]: v for k, v in page.Resources.Font.items()}
    originals = {}
    for fname, fobj in sorted(fonts.items()):
        d = fobj.DescendantFonts[0]; fd = d.FontDescriptor
        ok = (str(fobj.Subtype) == "/Type0" and str(fobj.Encoding) == "/Identity-H" and str(d.Subtype) == "/CIDFontType2"
              and str(d.get("/CIDToGIDMap")) == "/Identity" and "/FontFile2" in fd and "/ToUnicode" in fobj
              and str(fobj.BaseFont)[1:7].isupper() and str(fobj.BaseFont)[7] == "+")
        check(f"{fname}: Type0/CIDFontType2, Identity-H, CIDToGIDMap Identity, FontFile2, ToUnicode, subset tag", ok, str(fobj.BaseFont))
        sub = TTFont(io.BytesIO(fd.FontFile2.read_bytes()))
        spec = man["fonts"][fname]
        orig_bytes = original_instance(spec["family"], spec["axes"], spec.get("weight", 400))
        orig = TTFont(io.BytesIO(orig_bytes)); originals[fname] = orig_bytes
        so, sg, sh = sub.getGlyphOrder(), sub["glyf"], sub["hmtx"].metrics
        oo, og, oh = orig.getGlyphOrder(), orig["glyf"], orig["hmtx"].metrics
        scale = 1000 / sub["head"].unitsPerEm
        w = list(d.W); widths = {}; i = 0
        while i < len(w):
            start = int(w[i])
            if isinstance(w[i + 1], pikepdf.Array):
                for j, v in enumerate(w[i + 1]):
                    widths[start + j] = float(v)
                i += 2
            else:
                for g in range(start, int(w[i + 1]) + 1):
                    widths[g] = float(w[i + 2])
                i += 3
        used = sorted({g for f, _, g, _, _ in glyphs if f == fname})
        wbad = [g for g in used if abs(widths.get(g, -1) - round(sh[so[g]][0] * scale)) > 1]
        check(f"{fname}: /W widths = embedded advances for {len(used)} used glyphs", not wbad, f"mismatch {wbad[:5]}")
        diff, maxd = [], 0
        for g in used:
            ca, cb = sg[so[g]].getCoordinates(sg)[0], og[oo[g]].getCoordinates(og)[0]
            if len(ca) != len(cb) or abs(sh[so[g]][0] - oh[oo[g]][0]) > 1:
                diff.append(g); continue
            if len(ca):
                dd = max(max(abs(x1 - x2), abs(y1 - y2)) for (x1, y1), (x2, y2) in zip(ca, cb))
                maxd = max(maxd, dd)
                if dd > 1:
                    diff.append(g)
        check(f"{fname}: every used glyph's outline and advance = the original font (re-instanced independently)", not diff,
              f"{len(used)} glyphs, max point deviation {maxd} units" + (f"; differing {diff[:8]}" if diff else ""))

    # 8 independent shaping: glyph ids, vertical offsets, in-word spacing
    n_lines = n_cmp = 0; id_bad, y_bad, x_bad = [], [], []
    for ln in man["lines"]:
        text = ln["text"]
        if not text.strip() or not ln["glyphs"]:
            continue
        n_lines += 1
        ref, upem = shape(originals[ln["font"]], text)
        got = ln["glyphs"]                          # positions already proven equal to the content stream (check 6)
        if [r[0] for r in ref] != [g[0] for g in got]:
            id_bad.append(text[:24]); continue
        n_cmp += 1
        s = ln["size_pt"] / upem
        base = (man["page_mm"][1] - ln["baseline_mm"]) * MM
        for (gid, adv, xo, yo), g in zip(ref, got):
            if abs((g[2] - base) - yo * s) > 0.02:
                y_bad.append((text[:16], gid, round(g[2] - base, 3), round(yo * s, 3)))
        for a_, b_ in _word_spans(ln):
            for i in range(a_, b_ - 1):
                exp_dx = (ref[i][1] + ref[i + 1][2] - ref[i][2]) * s
                if abs((got[i + 1][1] - got[i][1]) - exp_dx) > 0.02:
                    x_bad.append((text[:16], i, round(got[i + 1][1] - got[i][1], 3), round(exp_dx, 3)))
    check("INDEPENDENT shaping: same glyph ids as HarfBuzz for every line", not id_bad, f"{n_cmp}/{n_lines} lines identical" + (f"; differ: {id_bad[:3]}" if id_bad else ""))
    check("INDEPENDENT shaping: vertical mark offsets (rakar, u/uu matras, nukta…) as HarfBuzz", not y_bad,
          f"{len(y_bad)} glyphs off" + (f", e.g. {y_bad[:3]}" if y_bad else "; all within 0.02 pt"))
    check("INDEPENDENT shaping: horizontal spacing inside every word as HarfBuzz", not x_bad,
          f"{len(x_bad)} pairs off" + (f", e.g. {x_bad[:3]}" if x_bad else "; all within 0.02 pt"))

    # 9 text read-back
    G = AT.page_glyphs(a.pdf, 1)
    bad_text, compared = [], 0
    for ln in man["lines"]:
        xs = [g[1] for g in ln["glyphs"]]
        if not xs or (not man["actualtext"] and not ln["simple"]):
            continue
        compared += 1
        base = (man["page_mm"][1] - ln["baseline_mm"]) * MM
        got = AT.line_text(G, base, min(xs) - 0.5, max(xs) + ln["size_pt"], ln["size_pt"])["text"]
        if norm(got) != norm(ln["text"]):
            bad_text.append((ln["text"][:30], got[:30]))
    check("every line's text reads back exactly", not bad_text and compared > 0,
          f"{compared} lines compared; mismatches {len(bad_text)}" + (f": {bad_text[:2]}" if bad_text else ""))

    # 10 rendering + colour samples (PDFium)
    doc = pdfium.PdfDocument(str(a.pdf))
    img = doc[0].render(scale=30 / 72).to_pil().convert("RGB")
    px = lambda x_mm, y_mm: img.getpixel((int(x_mm / 25.4 * 30), int(y_mm / 25.4 * 30)))  # noqa: E731
    dark = sum(img.convert("L").histogram()[:67])
    check("page renders with content", dark > 5000, f"{dark} dark pixels at 30 dpi")
    cols = {k: px(*_patch(man, lab)) for k, lab in (("cyan", "C 100"), ("magenta", "M 100"), ("yellow", "Y 100"), ("red", "M100 Y100 (red)"),
                                                    ("k100", "K 100"), ("k50", "K 50%"), ("k0", "K 0%"))}
    ok = (cols["cyan"][0] < 80 and cols["cyan"][2] > 180 and cols["magenta"][1] < 80 and cols["magenta"][0] > 180
          and cols["yellow"][2] < 80 and cols["yellow"][0] > 180 and cols["red"][0] > 180 and cols["red"][1] < 80
          and sum(cols["k100"]) < 200 and 250 < sum(cols["k50"]) < 600 and sum(cols["k0"]) > 740)
    check("patch colours render as intended", ok, json.dumps(cols))
    fails = [r for r in results if not r["pass"]]
    print(f"\n{'ALL CHECKS PASSED' if not fails else str(len(fails)) + ' CHECK(S) FAILED'} ({len(results)} checks)")
    if a.json:
        a.json.write_text(json.dumps({"pdf": str(a.pdf), "results": results, "passed": not fails}, indent=1, ensure_ascii=False) + "\n")
    sys.exit(0 if not fails else 1)


def _word_spans(ln: dict) -> list:
    """Glyph index ranges [a, b) between inter-word space glyphs (manifest marks each space glyph)."""
    spans, start = [], 0
    for i, is_space in enumerate(ln["glyph_space"]):
        if is_space:
            if i > start:
                spans.append((start, i))
            start = i + 1
    if len(ln["glyphs"]) > start:
        spans.append((start, len(ln["glyphs"])))
    return spans


def _patch(man: dict, label: str):
    """Centre of the patch whose label is `label` (labels sit 4 mm below 12 mm patches)."""
    for ln in man["lines"]:
        if ln.get("role") == "strip" and ln["text"] == label:
            xs = [g[1] for g in ln["glyphs"]]
            cx = (min(xs) + max(xs)) / 2 / MM
            cy = man["page_mm"][1] - ln["glyphs"][0][2] / MM
            return (cx, cy - 10.0)
    raise KeyError(label)


if __name__ == "__main__":
    main()
