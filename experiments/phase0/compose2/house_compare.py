"""EXP-COMPOSE-2 illustration at the pilot's MEASURED geometry (EXPERIMENTAL; owner-permitted pilot data).

A  SAME WORDS, SAME COLUMN: one published body column re-set at its own width and leading, with an OFL font whose
   average letter width is matched to the published font (including the story's horizontal scale). The text is
   TRANSCRIBED from the printed column (<sample>_<frame>.transcript.txt) because the PDF text layer is lossy.
B  MANY PARAGRAPHS: the synthetic Phase 0 Marathi corpus set at the pilot's reference widths, compared with ALL
   published non-final body lines of the same width in the dataset ("one attractive paragraph is never a result").

Font size is CALIBRATED ON THE SAME WORDS: the transcribed column is shaped with the OFL font and the size is chosen so
its total word width equals the published words' measured width (the bold dateline word is excluded). The per-glyph
width metric is NOT used for this: fonts split the same text into different glyph sequences (conjuncts, matras).
The same width ratio is applied to the corpus runs (B).
Word gaps are compared in ABSOLUTE size, in units of the published font's normal space ("house spaces").
Policies: SAME_RULES  — justify every line, never break a word (the observed house practice);
          WITH_BREAKS — the same, plus Marathi pattern breaks (hyph-mr; ≥ 2 aksharas each side; ≤ 2 consecutive).
Single-word lines that cannot be justified are set flush left (both policies).

Reads <dataset>/work/* and <dataset>/report/compare/<sample>_<frame>.json (published1/extract_frames.py).
Writes ONLY to <dataset>/report/compare/ (private). Nothing about the pilot is written to the repo.
Usage: PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/house_compare.py <dataset> <sample> <frame>
"""
from __future__ import annotations

import glob
import json
import statistics as st
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / "typeset_harness")); sys.path.insert(0, str(HERE.parent / "compose1"))
import fontreg  # noqa: E402

fontreg.install()
import common as C  # noqa: E402
import composer2 as K2  # noqa: E402
import render_sheets as RS  # noqa: E402  (glyph outlines/defs; read-only reuse)
sys.path.insert(0, str(HERE.parent / "compose3"))
import render as R3R  # noqa: E402  (correct vertical mark offset; see compose3/render.py)

FAM, AXES, WT, LABEL = "Noto Serif Devanagari", {"wdth": 87.5}, 400, "NotoSerifDeva-w87.5"
MM = 72 / 25.4                     # pt per mm
NBSP = " "
BANDS = {"36.5": (36.0, 37.0), "50": (49.5, 50.6), "75.5": (74.5, 76.5)}
COLOURS = [(1.5, "#1a9641"), (2.0, "#fdae61"), (3.0, "#d7191c"), (1e9, "#67000d")]
_COMMON = dict(token_breaks=True, max_consecutive_inword=2, fallback_max_slack=None,
               weights=K2.Weights(soft_space=100.0 * (50 - 1.33) ** 2, hybrid_fallback=1e6))


def policies():
    return {"SAME_RULES": K2.Policy("ILLUS_justify_all_no_breaks", "HYBRID", ws_max_hard=50.0, inword="none", **_COMMON),
            "WITH_BREAKS": K2.Policy("ILLUS_justify_all_hyph_mr", "HYBRID", ws_max_hard=50.0, inword="rules", inword_min=(2, 2), **_COMMON)}


def width_ratio(ds: Path, sample: str, frame: str, out: Path) -> dict:
    """Published word width per pt of (size × hscale) ÷ OFL word width per pt of size, on the SAME words."""
    fr = json.loads((out / f"{sample}_{frame}.json").read_text())
    work = ds / "work" / sample
    doc = json.loads(((work / "corrected.json") if (work / "corrected.json").exists() else (work / "measure.json")).read_text())
    mf = next(f for pg in doc["pages"] for f in pg["frames"] if f["id"] == frame)
    toks = [t for ln in mf["lines"] for t in ln["tokens"]]
    words = transcript_words(out, sample, frame)
    if len(toks) != len(words):
        sys.exit(f"token count {len(toks)} != transcript words {len(words)}: transcription and geometry disagree")
    their_pt = sum(t["x1"] - t["x0"] for t in toks[1:]) / (fr["size_pt"] * fr["hscale"])
    p = K2.prepare(" ".join(words[1:]), "mr", "Deva", FAM, 10.0, AXES, WT)
    ours_pt = sum(c.width for c in p.clusters if not c.is_space) * MM / 10.0
    chars = sum(len(w) for w in words[1:])
    return {"ratio": their_pt / ours_pt, "published_em_per_char": round(their_pt / chars, 4), "ofl_em_per_char": round(ours_pt / chars, 4),
            "words": len(words), "tokens_measured": len(toks), "chars": chars}


def transcript_words(out: Path, sample: str, frame: str) -> list[str]:
    tr = (out / f"{sample}_{frame}.transcript.txt").read_text(encoding="utf-8")
    return " ".join(l for l in tr.splitlines() if l.strip() and not l.startswith("#")).split()


def pctl(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p * len(xs)))], 3) if xs else None


def summarize(lines: list[dict]) -> dict:
    """lines: {'final': bool, 'justified': bool, 'ragged': bool, 'widest': float|None, 'words': int, 'inword': bool}."""
    nf = [l for l in lines if not l["final"]]
    w = [l["widest"] for l in nf if l["widest"] is not None]
    return {"nonfinal_lines": len(nf), "lines_total": len(lines),
            "justified_pct": round(100 * sum(l["justified"] for l in nf) / max(1, len(nf)), 1),
            "ragged_pct": round(100 * sum(l["ragged"] for l in nf) / max(1, len(nf)), 1),
            "widest_gap_median": pctl(w, .5), "widest_gap_p90": pctl(w, .9), "widest_gap_max": round(max(w), 2) if w else None,
            "lines_widest_gt_2_pct": round(100 * sum(x > 2 for x in w) / max(1, len(w)), 1),
            "lines_widest_gt_3_pct": round(100 * sum(x > 3 for x in w) / max(1, len(w)), 1),
            "words_per_line_mean": round(st.mean(l["words"] for l in nf), 2) if nf else None,
            "inword_breaks_per_100_lines": round(100 * sum(l.get("inword", False) for l in lines) / max(1, len(lines)), 1)}


def our_lines(p, c, house_space_mm: float) -> list[dict]:
    out = []
    for ln in c.lines:
        sf = ln.applied_sf if ln.kind in ("justified", "semi") else min(1.0, ln.applied_sf)
        gaps = [p.spaces[c.pieces[k].word] * sf / house_space_mm for k in range(ln.a, ln.b - 1) if c.btype[k] == "space"]
        out.append({"final": ln.kind == "final", "justified": ln.kind == "justified", "ragged": ln.kind in ("ragged", "semi"),
                    "widest": max(gaps) if gaps else None, "words": ln.n_words, "inword": ln.end_break == "inword"})
    return out


def pub_line(ln: dict, nominal_pt: float) -> dict | None:
    if ln.get("excluded") or ln["class"] == "SPECIAL_CASE":
        return None
    pu = ln.get("gap_punct_adjacent") or [False] * len(ln["gaps_pt"])
    gaps = [g / nominal_pt for g, u in zip(ln["gaps_pt"], pu) if not u]
    return {"final": ln["class"] == "FINAL_PARAGRAPH_LINE", "justified": ln["class"] == "FULLY_ALIGNED",
            "ragged": ln["class"] == "RAGGED", "widest": max(gaps) if gaps else None, "words": ln.get("words") or 0}


def marker(x: float, y: float, leading: float, ln: dict) -> str:
    if ln["final"]:
        return f'<rect x="{x:.2f}" y="{y - 0.55 * leading:.2f}" width="1.6" height="{0.45 * leading:.2f}" fill="#c8c8c8"/>'
    col = next(c for t, c in COLOURS if (ln["widest"] or 0) <= t)
    stroke = ' stroke="#d95f02" stroke-width="0.35"' if ln["ragged"] else ""
    return f'<rect x="{x:.2f}" y="{y - 0.55 * leading:.2f}" width="1.6" height="{0.45 * leading:.2f}" fill="{col}"{stroke}/>'


def compose_paragraphs(paras, size, width, pol, indent_mm, K=K2):
    out, t0 = [], time.perf_counter()
    for txt in paras:
        if indent_mm:
            nb = C.shape_paragraph(NBSP, "mr", FAM, size, axes=AXES).runs[0].x_advances_mm[0]
            txt = NBSP * max(1, round(indent_mm / nb)) + txt
        p = K.prepare(txt, "mr", "Deva", FAM, size, AXES, WT)
        out.append((p, K.compose(p, pol, width)))
    return out, (time.perf_counter() - t0) * 1000


def column_svg(comp, width, leading, first_baseline, pad, house_space_mm, height):
    RS._GLYPH_DEFS.clear()  # noqa: SLF001
    body, y, metrics = [], first_baseline, []
    for p, c in comp:
        upem = RS._font_cache(RS.hashlib.sha256(p.face_bytes).hexdigest()[:10], p.face_bytes)["head"].unitsPerEm  # noqa: SLF001
        for ln, m in zip(c.lines, our_lines(p, c, house_space_mm)):
            body += R3R.line_glyphs(p, c, ln, pad, y, upem)
            body.append(marker(pad + width + 0.8, y, leading, m))
            metrics.append(m); y += leading
    return RS.svg_doc(body, width + 2 * pad + 3, max(height, y - leading + pad + 2)), metrics


def part_a(ds: Path, sample: str, frame: str, out: Path, ratio: float) -> dict:
    fr = json.loads((out / f"{sample}_{frame}.json").read_text())
    tr = (out / f"{sample}_{frame}.transcript.txt").read_text(encoding="utf-8")
    paras = [" ".join(b.split()) for b in "\n".join(l for l in tr.splitlines() if not l.startswith("#")).split("\n\n") if b.strip()]
    size = fr["size_pt"] * fr["hscale"] * ratio
    lead = fr["leading_pt"] / MM; width = fr["width_mm"]; house_sp = fr["nominal_space_pt"] / MM
    starts = [l["left_offset_mm"] for l in fr["lines"] if l["left_offset_mm"] >= 0.5 * fr["size_pt"] / MM]
    indent = st.median(starts) if starts else 0.0
    cp = fr["crop_pt"]; Wc, Hc = (cp["x1"] - cp["x0"]) / MM, (cp["y_top"] - cp["y_bottom"]) / MM
    first = (cp["y_top"] - fr["lines"][0]["baseline_pt"]) / MM; pad = 2.0
    theirs = []
    els = [f'<image href="{fr["png"]}" x="0" y="0" width="{Wc:.3f}" height="{Hc:.3f}"/>']
    for ln in fr["lines"]:
        m = {"final": ln["class"] == "FINAL_PARAGRAPH_LINE", "justified": ln["class"] == "FULLY_ALIGNED", "ragged": ln["class"] == "RAGGED",
             "widest": max(r for r in ln["gap_ratios_word_word"]) if ln["gap_ratios_word_word"] else None, "words": ln["words"] or 0}
        theirs.append(m)
        els.append(marker(Wc - pad + 0.8 + 0.0, (cp["y_top"] - ln["baseline_pt"]) / MM, lead, m))
    svg_t = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{Wc + 3:.3f}mm" height="{Hc:.3f}mm" viewBox="0 0 {Wc + 3:.3f} {Hc:.3f}">'
             f'<rect width="100%" height="100%" fill="#fff"/>{"".join(els)}</svg>\n')
    (out / f"{sample}_{frame}_theirs.svg").write_text(svg_t, encoding="utf-8")
    p1 = next(i for i, l in enumerate(theirs, 1) if l["final"])
    res = {"frame": frame, "width_mm": width, "published": {"size_pt": fr["size_pt"], "hscale": fr["hscale"], "leading_pt": fr["leading_pt"],
           "font": fr["font"].split("+")[-1], "house_space_mm": round(house_sp, 3), "summary": summarize(theirs),
           "lines_first_paragraph": p1, "first_paragraph": summarize(theirs[:p1]),
           "note": "the column's last line continues into the next column, so it is justified in print; ours ends the paragraph there"},
           "ours": {"font": f"{FAM} (wdth 87.5, OFL)", "size_pt": round(size, 2), "leading_pt": fr["leading_pt"], "indent_mm": indent,
                    "paragraphs": len(paras)}, "policies": {}}
    for key, pol in policies().items():
        comp, ms = compose_paragraphs(paras, size, width, pol, indent)
        svg, mets = column_svg(comp, width, lead, first, pad, house_sp, Hc)
        (out / f"{sample}_{frame}_ours_{key}.svg").write_text(svg, encoding="utf-8")
        res["policies"][key] = {"policy": pol.name, "status": [c.status for _, c in comp], "compose_ms": round(ms, 2),
                                "lines_per_paragraph": [len(c.lines) for _, c in comp], "summary": summarize(mets),
                                "first_paragraph": summarize(mets[:len(comp[0][1].lines)])}
    # EXP-COMPOSE-3 spacing model (chosen on the calibration editions), if its results exist
    summ = HERE.parent / "results" / "compose3" / "summary.json"
    if summ.exists() and json.loads(summ.read_text())["selection"]["chosen"]:
        sys.path.insert(0, str(HERE.parent / "compose3"))
        import run_compose3 as R3  # noqa: PLC0415
        chosen = json.loads(summ.read_text())["selection"]["chosen"]
        kind, prm = R3.candidates()[chosen]
        probe = R3.K3.prepare(paras[0], "mr", "Deva", FAM, size, AXES, WT)
        k = house_sp / st.median(x for x in probe.spaces if x)
        for key, inword in (("NEW_NO_BREAKS", "none"), ("NEW_WITH_BREAKS", "rules")):
            pol = R3.policy_for(chosen + ("_with_breaks" if inword == "rules" else ""), kind, prm, k, inword=inword)
            comp, ms = compose_paragraphs(paras, size, width, pol, indent, K=R3.K3)
            svg, mets = column_svg(comp, width, lead, first, pad, house_sp, Hc)
            (out / f"{sample}_{frame}_ours_{key}.svg").write_text(svg, encoding="utf-8")
            res["policies"][key] = {"policy": pol.name, "composer": R3.K3.COMPOSER_VERSION, "status": [c.status for _, c in comp],
                                    "compose_ms": round(ms, 2), "lines_per_paragraph": [len(c.lines) for _, c in comp],
                                    "summary": summarize(mets), "first_paragraph": summarize(mets[:len(comp[0][1].lines)])}
    return res


def part_b(ds: Path, ratio: float) -> dict:
    band_lines = {b: [] for b in BANDS}; band_frames = {b: [] for b in BANDS}
    for wd in sorted(glob.glob(str(ds / "work" / "*"))):
        f = Path(wd) / "corrected.json"
        doc = json.loads((f if f.exists() else Path(wd) / "measure.json").read_text())
        if doc.get("excluded"):
            continue
        for pg in doc["pages"]:
            for fr in pg["frames"]:
                if not fr["is_body_candidate"] or fr.get("excluded") or not fr["nominal_space_pt"]:
                    continue
                for b, (lo, hi) in BANDS.items():
                    if lo <= fr["width_mm"] <= hi:
                        band_frames[b].append(fr)
                        band_lines[b] += [x for x in (pub_line(l, fr["nominal_space_pt"]) for l in fr["lines"]) if x]
    texts = [t for t in C.load_corpus() if t["kind"] == "body" and t["lang"] == "mr"]
    res = {}
    for b, frs in band_frames.items():
        sp_mm = st.median(f["nominal_space_pt"] for f in frs) / MM
        width = st.median(f["width_mm"] for f in frs); size = st.median(f["size_pt"] * f["hscale_median"] for f in frs) * ratio
        r = {"published_frames": len(frs), "width_mm": round(width, 2), "our_size_pt": round(size, 2), "house_space_mm": round(sp_mm, 3),
             "published": summarize(band_lines[b]), "ours": {}}
        for key, pol in policies().items():
            mets = []
            for t in texts:
                p = K2.prepare(t["text"], "mr", "Deva", FAM, size, AXES, WT)
                mets += our_lines(p, K2.compose(p, pol, width), sp_mm)
            r["ours"][key] = summarize(mets)
        res[b] = r
    return res


def main():
    ds, sample, frame = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    out = ds / "report" / "compare"
    cal = width_ratio(ds, sample, frame, out)
    res = {"schema": "pageinator.compose2.house_compare/1", "composer": K2.COMPOSER_VERSION, "font": LABEL, "calibration": cal,
           "gap_unit": "house spaces: the published font's normal word space (EXACT, from the PDF width table)",
           "A_same_column": part_a(ds, sample, frame, out, cal["ratio"]), "B_corpus_at_house_widths": part_b(ds, cal["ratio"]),
           "env": C.environment({"composer": K2.COMPOSER_VERSION})}
    (out / "house_compare.json").write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str) + "\n")
    a = res["A_same_column"]
    print("calibration", cal, "| our size", a["ours"]["size_pt"])
    print("A published", a["published"]["summary"])
    for k, v in a["policies"].items():
        print("A", k, v["status"], v["compose_ms"], "ms", v["summary"])
    for b, r in res["B_corpus_at_house_widths"].items():
        print("B", b, r["published_frames"], "frames | published", r["published"])
        for k, v in r["ours"].items():
            print("   ", k, v)


if __name__ == "__main__":
    main()
