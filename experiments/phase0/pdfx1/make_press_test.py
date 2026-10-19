"""EXP-PDF-1: generate the Pageinator PRESS TEST page — PDF/X-1a, CMYK — material for gate G2 (EXPERIMENTAL).

The page reproduces the pilot's measured format (EXP_PUBLISHED_1.md §12): 347 × 540 mm, an 8-column grid of 36.5 mm
columns with ≈ 4.1 mm gutters and ≈ 13 mm margins. On it:
  - two stories whose body columns are set by Pageinator (EXP-COMPOSE-3 chosen spacing policy, no word breaks) in an
    OFL stand-in font calibrated to the house body type (12 pt house ≙ stand-in size from the same-words width ratio),
    on the house leading (13 pt);
  - Marathi headlines (Noto Sans Devanagari Bold), a 15 % K photo area with caption, a column rule;
  - a print-control strip: K tint wedge 0–100 %, process colour patches (C, M, Y, K, red, rich black 200 %),
    line weights 0.1–2 pt, a Devanagari type-size ladder (6–12 pt) with conjunct tests, reversed (white) text;
  - "TEST — NOT FOR PUBLICATION" slugs with build information.
Black text and 100 K rules overprint; tints, colours and white text knock out. All colour is DeviceCMYK.

Text source:  --dataset DIR  the pilot's own recovered paragraphs (published1/paragraphs.py) → output stays PRIVATE
              --synthetic    the Phase 0 synthetic Marathi corpus → output may be shared
Writes <out>.pdf and <out>.manifest.json (every glyph's expected position and every line's text, for verification).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/pdfx1/make_press_test.py
                     (--dataset DIR | --synthetic) [--out PATH] [--output-intent IFRA26] [--no-actualtext]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics as st
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _sub in ("compose3", "compose2", "typeset_harness", "compose1"):
    sys.path.insert(0, str(HERE.parent / _sub))
sys.path.insert(0, str(HERE))
import fontreg  # noqa: E402  (OFL font registry; also installs the oracle registry)

fontreg.install()
import common as C  # noqa: E402
import composer3 as K3  # noqa: E402
import pdfx as X  # noqa: E402
import run_compose3 as R3  # noqa: E402

MAKER_VERSION = "pdfx1-page/1.0.0"
PAGE_W, PAGE_H = 347.0, 540.0                     # mm (pilot page, EXACT from the PDFs)
MARGIN_L, COL_W, GUTTER, N_COLS = 13.0, 36.5, 4.1, 8  # measured grid (DERIVED, EXP_PUBLISHED_1.md §12)
RIGHT = MARGIN_L + N_COLS * COL_W + (N_COLS - 1) * GUTTER
HOUSE_BODY_PT, HOUSE_LEADING_PT, HOUSE_SPACE_EM, HOUSE_INDENT_MM = 12.0, 13.0, 0.25, 5.0
DEFAULT_WIDTH_RATIO = 0.904      # published words ÷ stand-in words at equal size (EXP_COMPOSE_2_REPORT.md §18)
NBSP = " "
BLACK, WHITE = (0, 0, 0, 1), (0, 0, 0, 0)
FONTS = {"F1": ("Noto Serif Devanagari", {"wdth": 87.5}, 400, "NotoSerifDevanagari-Condensed875"),
         "F2": ("Noto Sans Devanagari", {"wght": 700.0}, 700, "NotoSansDevanagari-Bold"),
         "F3": ("Noto Sans Devanagari", {"wght": 400.0}, 400, "NotoSansDevanagari-Regular")}
# PDF/X output intents for coldset newsprint (registered characterizations in the ICC registry; no embedded profile)
OUTPUT_INTENTS = {
    "IFRA26": {"OutputConditionIdentifier": "IFRA26", "RegistryName": "http://www.color.org",
               "OutputCondition": "Newsprint, coldset offset (ISO 12647-3), ISOnewspaper26v4",
               "Info": "IFRA26 - ISOnewspaper26v4 - coldset offset on newsprint"},
}   # IFRA30 was dropped: it is no longer in the ICC characterization registry (registry.color.org, checked 2026-10-11)
# PDF/X flavours: Info keys + header. Default X-1a:2003 (%PDF-1.4) = the header this press accepted in 16/16 production files.
PDFX = {"X-1a:2003": {"pdf_version": "1.4", "info": {"GTS_PDFXVersion": "PDF/X-1a:2003"}, "label": "PDF/X-1a:2003"},
        "X-1a:2001": {"pdf_version": "1.3", "info": {"GTS_PDFXVersion": "PDF/X-1:2001", "GTS_PDFXConformance": "PDF/X-1a:2001"},
                      "label": "PDF/X-1a:2001"}}
HEADLINES = ("स्तंभ चाचणी : पेजिनेटरने रचलेला बातम्यांचा मजकूर",
             "छपाई चाचणी : देवनागरी अक्षरे, जोडाक्षरे आणि अंक")
LADDER = "पेजिनेटर चाचणी : क्ष त्र ज्ञ श्र द्ध द्य ह्म र्य ऱ्य ट्र श्‍व ळ ०१२३४५६७८९ ₹"


def col_x(i: int) -> float:
    return MARGIN_L + i * (COL_W + GUTTER)


def span_w(n: int) -> float:
    return n * COL_W + (n - 1) * GUTTER


def is_deva(s: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in s)


class PageBuilder:
    def __init__(self, actualtext: bool):
        self.items: list = []
        self.fonts: dict[str, X.EmbeddedFont] = {}
        self.face_hash: dict[str, str] = {}
        self.lines: list = []          # manifest: one entry per placed text line
        self.actualtext = actualtext

    # -------------------------------------------------------------- fonts / shaping
    def prepare(self, text: str, fkey: str, size: float):
        fam, axes, wt, base = FONTS[fkey]
        deva = is_deva(text)
        p = K3.prepare(text, "mr" if deva else "en", "Deva" if deva else "Latn", fam, size, axes, wt)
        h = hashlib.sha256(p.face_bytes).hexdigest()
        if fkey not in self.fonts:
            self.fonts[fkey] = X.EmbeddedFont(fkey, p.face_bytes, base)
            self.face_hash[fkey] = h
        elif self.face_hash[fkey] != h:
            raise RuntimeError(f"{fkey}: font bytes changed between shapings")
        if any(g == 0 for r in p.runs for g in r.glyph_ids):
            raise RuntimeError(f"missing glyph (.notdef) for text in {fkey}: {text!r}")
        return p

    def _space_cluster_after(self, p, w: int):
        idx = p.words[w][-1] + 1
        while idx < len(p.clusters) and p.clusters[idx].is_space:
            return p.clusters[idx]
        return None

    # -------------------------------------------------------------- text placement
    def _emit(self, fkey, size, cmyk, clusters, overprint, meta):
        """clusters: [(text, [(gid, x_mm, y_mm_down)])] → TextRun in PDF points (origin bottom-left)."""
        # glyph y is in the page's y-down millimetres; the oracle's y_offsets_mm are y-down too (shape.py negates HarfBuzz)
        runs = [(t, [X.Glyph(g, round(x * X.MM, 3), round((PAGE_H - y) * X.MM, 3)) for g, x, y in gl]) for t, gl in clusters]
        self.items.append(X.TextRun(fkey, size, cmyk, runs, overprint))
        self.lines.append({**meta, "font": fkey, "size_pt": round(size, 4),
                           "text": "".join(t for t, _ in clusters),
                           "simple": all(len(gl) == 1 for _, gl in clusters),
                           "glyph_space": [int(t == " ") for t, gl in runs for _ in gl],
                           "glyphs": [[g.gid, g.x_pt, g.y_pt] for _, gl in runs for g in gl]})

    def composed_line(self, p, c, ln, x0, y, fkey, cmyk=BLACK, overprint=None, meta=None):
        overprint = (tuple(cmyk) == BLACK) if overprint is None else overprint
        out, x = [], x0
        for k in range(ln.a, ln.b):
            pc = c.pieces[k]
            ids = p.words[pc.word][pc.cl_from:pc.cl_to]
            for n_ci, ci in enumerate(ids):
                cl = p.clusters[ci]
                text = p.text[cl.start:cl.end]
                gl = []
                for ri, gi in cl.glyphs:
                    r = p.runs[ri]
                    gl.append((r.glyph_ids[gi], x + r.x_offsets_mm[gi], y + r.y_offsets_mm[gi]))
                    x += r.x_advances_mm[gi]
                if ln.tracking_mm_per_gap and n_ci < len(ids) - 1:
                    x += ln.tracking_mm_per_gap
                if text.strip(NBSP) == "":
                    continue                       # paragraph indent: advance only, draw nothing
                out.append((text, gl))
            if k < ln.b - 1 and c.btype[k] == "space":
                sc = self._space_cluster_after(p, pc.word)
                if sc is not None:
                    r = p.runs[sc.glyphs[0][0]]
                    out.append((" ", [(r.glyph_ids[sc.glyphs[0][1]], x, y)]))
                nat = p.spaces[pc.word]
                sf = ln.applied_sf if ln.kind in ("justified", "semi") else min(1.0, ln.applied_sf)
                x += nat * sf
        if ln.end_break == "inword":
            hp = self.prepare("-", fkey, p.size_pt)
            out.append(("-", [(hp.runs[0].glyph_ids[0], x, y)]))
            x += hp.runs[0].x_advances_mm[0]
        if x > x0 + ln.measure_mm + 0.05 or ln.kind == "overfull":
            raise ValueError(f"composed line overflows its measure by {x - x0 - ln.measure_mm:.2f} mm")
        self._emit(fkey, p.size_pt, cmyk, out, overprint, {"kind": ln.kind, "x0_mm": round(x0, 3), "baseline_mm": round(y, 3), **(meta or {})})
        return x

    def natural(self, text, fkey, size, x, y, cmyk=BLACK, align="left", overprint=None, meta=None):
        """Single line at natural spacing (labels, slugs, ladder). Overprint only for 100K black."""
        overprint = (tuple(cmyk) == BLACK) if overprint is None else overprint
        p = self.prepare(text, fkey, size)
        width = sum(a for r in p.runs for a in r.x_advances_mm)
        x0 = x - width if align == "right" else x - width / 2 if align == "center" else x
        if x0 < MARGIN_L - 0.05 or x0 + width > RIGHT + 0.05:
            raise ValueError(f"text runs outside the type area ({x0:.1f}–{x0 + width:.1f} mm): {text[:40]!r}")
        out, cx = [], x0
        for cl in p.clusters:
            text_c = p.text[cl.start:cl.end]
            gl = []
            for ri, gi in cl.glyphs:
                r = p.runs[ri]
                gl.append((r.glyph_ids[gi], cx + r.x_offsets_mm[gi], y + r.y_offsets_mm[gi]))
                cx += r.x_advances_mm[gi]
            out.append((" " if cl.is_space else text_c, gl))
        self._emit(fkey, size, cmyk, out, overprint, {"kind": "natural", "x0_mm": round(x0, 3), "baseline_mm": round(y, 3), **(meta or {})})
        return width

    # -------------------------------------------------------------- graphics
    def rect(self, x, y, w, h, cmyk, overprint=False):
        self.items.append(X.Rect(x * X.MM, (PAGE_H - y - h) * X.MM, w * X.MM, h * X.MM, cmyk, overprint))

    def hline(self, x1, x2, y, width_pt, cmyk=BLACK, overprint=None):
        overprint = (tuple(cmyk) == BLACK) if overprint is None else overprint
        self.items.append(X.Line(x1 * X.MM, (PAGE_H - y) * X.MM, x2 * X.MM, (PAGE_H - y) * X.MM, width_pt, cmyk, overprint))

    def vline(self, x, y1, y2, width_pt, cmyk=BLACK, overprint=None):
        overprint = (tuple(cmyk) == BLACK) if overprint is None else overprint
        self.items.append(X.Line(x * X.MM, (PAGE_H - y1) * X.MM, x * X.MM, (PAGE_H - y2) * X.MM, width_pt, cmyk, overprint))


# ------------------------------------------------------------------------------------------- text sources
def dataset_source(ds: Path):
    pars = [json.loads(l) for l in open(ds / "report" / "paragraphs.jsonl", encoding="utf-8")]
    pars = [p for p in pars if p["width_confidence"] == "DERIVED"]

    def order(p):
        page_line = p["id"].split(":")[1]          # e.g. p3-f5-l12
        pg, fr, ln = (int(x[1:]) for x in page_line.split("-"))
        return (p["edition_date"], p["sample"], pg, fr, ln)
    pars.sort(key=order)
    later = [p for p in pars if p["edition_date"] >= R3.SPLIT_DATE] or pars
    by_page: dict = {}
    for p in later:
        by_page.setdefault((p["sample"], p["page"]), []).append(p)
    pages = sorted(by_page.values(), key=len, reverse=True)
    story_a = [p["text"] for p in pages[0]] + [p["text"] for pg in pages[2::2] for p in pg]
    story_b = [p["text"] for p in pages[1]] + [p["text"] for pg in pages[3::2] for p in pg]
    ratio = st.median(_width_ratio(p) for p in later[:80])
    space_em = st.median(p["nominal_space_pt"] / (p["size_pt"] * p["hscale"]) for p in later)
    indent = st.median(p["indent_mm"] for p in later)
    return story_a, story_b, ratio, space_em, indent, f"pilot dataset ({len(later)} verified paragraphs from editions dated {R3.SPLIT_DATE} or later)"


def _width_ratio(par: dict) -> float:
    fam, axes, wt, _ = FONTS["F1"]
    probe = K3.prepare(par["text"], "mr", "Deva", fam, 10.0, axes, wt)
    per_pt = sum(c.width for c in probe.clusters if not c.is_space) * X.MM / 10.0
    return sum(l["word_width_pt"] for l in par["lines"]) / per_pt / (par["size_pt"] * par["hscale"])


def synthetic_source():
    texts = [t["text"] for t in C.load_corpus() if t["kind"] == "body" and t["lang"] == "mr"]
    return texts * 6, list(reversed(texts)) * 6, DEFAULT_WIDTH_RATIO, HOUSE_SPACE_EM, HOUSE_INDENT_MM, "Phase 0 synthetic Marathi corpus"


# ------------------------------------------------------------------------------------------- page
def build_page(story_a, story_b, ratio, space_em, indent_mm, source_label, intent_label, actualtext, conformance):
    B = PageBuilder(actualtext)
    body_pt = round(HOUSE_BODY_PT * ratio, 3)
    lead = HOUSE_LEADING_PT / X.MM
    fam, axes, wt, _ = FONTS["F1"]
    probe = B.prepare("क ख", "F1", body_pt)
    our_space_mm = st.median(s for s in probe.spaces if s)
    k = (space_em * HOUSE_BODY_PT / X.MM) / our_space_mm
    summ = json.loads((R3.OUT / "summary.json").read_text()) if (R3.OUT / "summary.json").exists() else None
    chosen = summ["selection"]["chosen"] if summ and summ["selection"]["chosen"] else "C3_floor0.66_stretch1.00"
    kind, prm = R3.candidates()[chosen]
    body_pol = R3.policy_for(chosen, kind, prm, k)
    head_pol = K3.Policy("HEADLINE_ragged", "RAGGED", inword="none", token_breaks=True, fallback_max_slack=None)
    nb_adv = C.shape_paragraph(NBSP, "mr", fam, body_pt, axes=axes).runs[0].x_advances_mm[0]
    n_nb = max(1, round(indent_mm / nb_adv))
    for fk in ("F2", "F3"):
        B.prepare("क", fk, 10.0)                  # register every font up front so its bytes enter the build id
    # build id: every input that can change the printed page (texts, parameters, policy, font bytes, software versions)
    build_id = hashlib.sha256(json.dumps([story_a, story_b, round(ratio, 6), round(space_em, 6), round(indent_mm, 4), intent_label, actualtext,
                                          conformance, body_pt, chosen, body_pol.key(), head_pol.key(), sorted(B.face_hash.items()),
                                          X.WRITER_VERSION, MAKER_VERSION, K3.COMPOSER_VERSION], ensure_ascii=False).encode()).hexdigest()[:10]

    # slugs and title band
    B.natural(f"PAGEINATOR PRESS TEST — NOT FOR PUBLICATION — {conformance} — build {build_id}", "F3", 7.0, MARGIN_L, 10.0, meta={"role": "slug"})
    B.natural("चाचणी पान — प्रसिद्धीसाठी नाही", "F3", 7.0, RIGHT, 10.0, align="right", meta={"role": "slug"})
    B.natural("पेजिनेटर मुद्रण चाचणी", "F2", 44.0, MARGIN_L, 30.0, meta={"role": "title"})
    B.natural(f"Pageinator press test · 347 × 540 mm · 8 columns × 36.5 mm · body text composed by Pageinator · CMYK, {conformance}",
              "F3", 10.0, MARGIN_L, 38.5, meta={"role": "subtitle"})
    B.hline(MARGIN_L, RIGHT, 42.5, 3.0, (0, 1, 1, 0), overprint=False)
    B.hline(MARGIN_L, RIGHT, 45.0, 0.5)

    # stories
    def headline(text, c0, ncols, y_top):
        p = B.prepare(text, "F2", 22.0)
        c = K3.compose(p, head_pol, span_w(ncols))
        if len(c.lines) > 2:
            raise ValueError(f"headline needs {len(c.lines)} lines (max 2): {text!r}")
        y = y_top + 7.5
        for ln in c.lines:
            B.composed_line(p, c, ln, col_x(c0), y, "F2", meta={"role": "headline"})
            y += 25.0 / X.MM
        return y - 25.0 / X.MM + 4.5

    def flow(texts, cols, y_top, y_bottom, story):
        ci, y = 0, y_top + 0.8 * lead
        placed = 0
        for t in texts:
            p = B.prepare(NBSP * n_nb + t, "F1", body_pt)
            c = K3.compose(p, body_pol, COL_W)
            if c.status != "OK":
                continue
            for ln in c.lines:
                if y > y_bottom:
                    ci += 1; y = y_top + 0.8 * lead
                    if ci >= len(cols):
                        return placed
                B.composed_line(p, c, ln, col_x(cols[ci]), y, "F1", meta={"role": "body", "story": story, "column": cols[ci] + 1})
                y += lead
            placed += 1
        return placed

    content_top, content_bottom = 50.0, 446.0
    ya = headline(HEADLINES[0], 0, 4, content_top)
    yb = headline(HEADLINES[1], 4, 4, content_top)
    photo_top = yb + 1.0
    B.rect(col_x(4), photo_top, span_w(4), 68.0, (0, 0, 0, 0.15))
    B.natural("छायाचित्र क्षेत्र", "F2", 16.0, col_x(4) + span_w(4) / 2, photo_top + 36.0, align="center", meta={"role": "photo-label"})
    B.natural("PHOTO AREA · 15% K", "F3", 8.0, col_x(4) + span_w(4) / 2, photo_top + 42.0, align="center", meta={"role": "photo-label"})
    B.natural("छायाचित्र क्षेत्र : १५% काळी छटा, फक्त काळी शाई", "F1", 9.0, col_x(4), photo_top + 68.0 + 4.6, meta={"role": "caption"})
    used_a = flow(story_a, [0, 1, 2, 3], ya, content_bottom, "A")
    used_b = flow(story_b, [4, 5, 6, 7], photo_top + 68.0 + 7.5, content_bottom, "B")
    B.vline(col_x(4) - GUTTER / 2, content_top, content_bottom + 1.5, 0.4, (0, 0, 0, 0.6), overprint=False)
    B.hline(MARGIN_L, RIGHT, 449.5, 0.5)

    # print-control strip
    B.natural("मुद्रण नियंत्रण पट्टी", "F2", 10.0, MARGIN_L, 455.5, meta={"role": "strip"})
    B.natural("Print control strip — black 100K overprints; tints, colours and white text knock out", "F3", 7.5,
              MARGIN_L + 33.0, 455.5, meta={"role": "strip"})
    tints = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    pw = (RIGHT - MARGIN_L - (len(tints) - 1) * 1.0) / len(tints)
    for i, t in enumerate(tints):
        x = MARGIN_L + i * (pw + 1.0)
        B.rect(x, 458.5, pw, 12.0, (0, 0, 0, t / 100))
        if t == 0:
            for (x1, y1, x2, y2) in ((x, 458.5, x + pw, 458.5), (x, 470.5, x + pw, 470.5)):
                B.hline(x1, x2, y1, 0.25)
            B.vline(x, 458.5, 470.5, 0.25); B.vline(x + pw, 458.5, 470.5, 0.25)
        B.natural(f"K {t}%", "F3", 6.5, x + pw / 2, 474.5, align="center", meta={"role": "strip"})
    patches = [((1, 0, 0, 0), "C 100"), ((0, 1, 0, 0), "M 100"), ((0, 0, 1, 0), "Y 100"), ((0, 0, 0, 1), "K 100"),
               ((0, 1, 1, 0), "M100 Y100 (red)"), ((0.4, 0.3, 0.3, 1), "C40 M30 Y30 K100 = 200%")]
    for i, (cmyk, label) in enumerate(patches):
        x = MARGIN_L + i * (pw + 1.0)
        B.rect(x, 478.0, pw, 12.0, cmyk)
        B.natural(label, "F3", 6.0, x + pw / 2, 494.0, align="center", meta={"role": "strip"})
    lx = MARGIN_L + 6 * (pw + 1.0) + 4.0
    for j, w in enumerate((0.1, 0.25, 0.5, 1.0, 2.0)):
        y = 479.0 + j * 3.6
        B.natural(f"{w:g} pt", "F3", 6.0, lx, y + 0.8, meta={"role": "strip"})
        B.hline(lx + 12.0, RIGHT, y, w)
    yl = 500.5
    for size in (6, 7, 8, 9, 10, 12):
        B.natural(f"{size} pt  " + LADDER, "F1", float(size), MARGIN_L, yl, meta={"role": "ladder"})
        yl += size / X.MM * 1.25
    rx = col_x(5)
    B.rect(rx, 497.0, RIGHT - rx, 17.0, BLACK)
    B.natural("उलट मजकूर चाचणी : पांढरी अक्षरे", "F2", 12.0, rx + 4.0, 504.5, cmyk=WHITE, overprint=False, meta={"role": "reverse"})
    B.natural("पांढरी अक्षरे काळ्या पार्श्वभूमीवर — White text on 100K, knockout", "F1", 8.0, rx + 4.0, 510.5, cmyk=WHITE,
              overprint=False, meta={"role": "reverse"})
    B.natural(f"Fonts: Noto Serif Devanagari (wdth 87.5; body {body_pt:g} pt on {HOUSE_LEADING_PT:g} pt), Noto Sans Devanagari Bold/Regular — SIL OFL · "
              f"Body: {source_label}; spacing policy {chosen}; no word breaks", "F3", 6.5, MARGIN_L, 523.5, meta={"role": "strip"})
    B.natural(f"Output intent {intent_label} · "
              f"writer {X.WRITER_VERSION} · composer {K3.COMPOSER_VERSION} · page {MAKER_VERSION} · black text 100K overprint", "F3", 6.5, MARGIN_L, 527.0,
              meta={"role": "strip"})
    B.natural(f"PAGEINATOR PRESS TEST — NOT FOR PUBLICATION — build {build_id}", "F3", 6.5, MARGIN_L, 533.0, meta={"role": "slug"})
    B.natural("चाचणी पान — प्रसिद्धीसाठी नाही", "F3", 6.5, RIGHT, 533.0, align="right", meta={"role": "slug"})
    params = {"body_pt": body_pt, "leading_pt": HOUSE_LEADING_PT, "width_ratio": round(ratio, 4), "house_space_em": round(space_em, 4),
              "k_house_per_ours": round(k, 4), "indent_mm": round(indent_mm, 3), "nbsp_indent": n_nb, "policy": chosen,
              "paragraphs_used": {"A": used_a, "B": used_b}, "body_policy_key": body_pol.key()}
    return B, params, build_id


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--dataset", type=Path, help="private pilot dataset directory (output stays private)")
    src.add_argument("--synthetic", action="store_true", help="use the synthetic Phase 0 corpus")
    ap.add_argument("--out", type=Path, help="output PDF path")
    ap.add_argument("--output-intent", default="IFRA26", choices=sorted(OUTPUT_INTENTS))
    ap.add_argument("--no-actualtext", action="store_true", help="omit /ActualText marked content")
    ap.add_argument("--pdfx", default="X-1a:2003", choices=sorted(PDFX), help="PDF/X flavour (default X-1a:2003, %%PDF-1.4)")
    ap.add_argument("--dest-profile", type=Path, help="embed this CMYK output ICC profile (e.g. one supplied by the press)")
    ap.add_argument("--condition-id", help="OutputConditionIdentifier for an embedded non-registered profile (RegistryName is then omitted)")
    a = ap.parse_args()
    if a.dataset:
        ds = a.dataset.expanduser()
        story_a, story_b, ratio, space_em, indent, label = dataset_source(ds)
        out = a.out or ds / "report" / "press_test" / "pageinator_press_test.pdf"
    else:
        story_a, story_b, ratio, space_em, indent, label = synthetic_source()
        out = a.out or C.REPO / "experiments" / "phase0" / "results" / "pdfx1" / "pageinator_press_test_synthetic.pdf"
    out = out.expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    fl = PDFX[a.pdfx]
    intent = dict(OUTPUT_INTENTS[a.output_intent])
    profile = None
    if a.dest_profile:
        profile = a.dest_profile.expanduser().read_bytes()
        X.check_icc(profile)
        if a.condition_id and a.condition_id != intent["OutputConditionIdentifier"]:
            intent = {"OutputConditionIdentifier": a.condition_id, "OutputCondition": a.condition_id,
                      "Info": f"{a.condition_id} (embedded ICC profile {a.dest_profile.name})"}
    intent_label = (f"{intent['OutputConditionIdentifier']} (registered characterization, {intent['RegistryName']}"
                    + (", ICC profile embedded" if profile else "") + ")") if "RegistryName" in intent else \
                   f"{intent['OutputConditionIdentifier']} (ICC profile embedded, sha256 {hashlib.sha256(profile).hexdigest()[:12]})"
    B, params, build_id = build_page(story_a, story_b, ratio, space_em, indent, label, intent_label, not a.no_actualtext, fl["label"])
    data, stats = X.build_pdf([X.Page(PAGE_W * X.MM, PAGE_H * X.MM, B.items)], B.fonts,
                              title=f"Pageinator press test {build_id} (TEST - not for publication)",
                              output_intent=intent, dest_profile=profile, actualtext=not a.no_actualtext,
                              pdf_version=fl["pdf_version"], pdfx_info=fl["info"])
    out.write_bytes(data)
    manifest = {"schema": "pageinator.pdfx1.manifest/1", "pdf": out.name, "sha256": hashlib.sha256(data).hexdigest(),
                "build_id": build_id, "writer": X.WRITER_VERSION, "page_maker": MAKER_VERSION, "composer": K3.COMPOSER_VERSION,
                "page_mm": [PAGE_W, PAGE_H], "output_intent": intent, "actualtext": not a.no_actualtext,
                "dest_profile": {"file": a.dest_profile.name, "sha256": hashlib.sha256(profile).hexdigest()} if profile else None,
                "pdfx": {"flavour": a.pdfx, "pdf_version": fl["pdf_version"], "info": fl["info"]},
                "source": label, "params": params, "stats": stats,
                "fonts": {k: {"family": FONTS[k][0], "axes": FONTS[k][1], "weight": FONTS[k][2], "pdf_name": f.font_name, "face_sha256": B.face_hash[k]}
                          for k, f in B.fonts.items()},
                "lines": B.lines}
    mpath = out.with_suffix(".manifest.json")
    mpath.write_text(json.dumps(manifest, ensure_ascii=False) + "\n", encoding="utf-8")
    if a.dataset:
        out.chmod(0o600); mpath.chmod(0o600)
    print(json.dumps({"pdf": str(out), "bytes": len(data), "sha256": manifest["sha256"], "build_id": build_id,
                      "glyphs": stats["glyphs"], "actualtext_spans": stats["actualtext_spans"], "lines": len(B.lines),
                      "params": params}, ensure_ascii=False))


if __name__ == "__main__":
    main()
