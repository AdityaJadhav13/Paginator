"""Generate a representative 16-page display-list workload for the renderer bake-off (EXP-RENDER).

EXPERIMENTAL / EVIDENCE TOOLING. NOT a layout engine and NOT a ResolvedDocument implementation:
- text is shaped and line-broken by oracle-v0, then set RAGGED (oracle-v0 has no justification),
- page structure is a fixed synthetic pattern (no generation logic),
- geometry is a plausible broadsheet, NOT the pilot's grid (unknown until G0).
Its only purpose: give renderer candidates a realistic glyph/object load with real fonts.

Output (gitignored, regenerate on demand): experiments/phase0/render_workload/out/
  page-01.json … page-16.json, fonts.json (font file refs + hashes), stats.json (committed copy in results/)

Usage: tools/oracle/v0/.venv/bin/python experiments/phase0/render_workload/generate_workload.py [--pages 16]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402

PT = 1 / C.MM_PER_PT  # mm → pt factor
PAGE_W, PAGE_H = 318.0, 510.0          # mm, synthetic broadsheet
MARGIN, GUTTER, COLS = 24.0, 4.0, 8
COL_W = (PAGE_W - 2 * MARGIN - (COLS - 1) * GUTTER) / COLS   # 30.25 mm
BODY = ("Noto Serif Devanagari", 9.5, 11.2)
HEAD = ("Noto Sans Devanagari", 700)
P0 = {"word_space_min": 0.75, "word_space_max": 1.5, "tolerance": 1.0}


def upt(mm: float) -> int:
    return int(round(mm * PT * 1000))  # integer micro-points


def set_paragraph(text, family, size, leading, width, x0, y0, weight=400, algorithm="greedy"):
    sh = C.shape_paragraph(text, "mr", family, size, weight=weight)
    st = C.style(family, size, leading, P0, algorithm=algorithm)
    nodes = C.build_nodes(sh.runs, text, st)
    res = C.break_lines(nodes, [width], st)
    # Flatten glyphs with absolute ragged positions line by line (single run assumed per box run index)
    items, y = [], y0
    start = 0
    for bp in res.breakpoints:
        y += leading * C.MM_PER_PT
        x = x0
        seg = nodes[start:bp.node_index]
        g, pos, cl = [], [], []
        run_ref = None
        for nd in seg:
            name = type(nd).__name__
            if name == "Box":
                r = sh.runs[nd.run_index]
                run_ref = r
                for gi in range(*nd.glyph_range):
                    g.append(r.glyph_ids[gi]); pos += [upt(x + r.x_offsets_mm[gi]), upt(y - r.y_offsets_mm[gi])]
                    cl.append(r.cluster_map[gi]); x += r.x_advances_mm[gi]
            elif name == "Glue" and nd.stretch_mm < C.FINAL_GLUE_STRETCH:
                x += nd.width_mm
        if g:
            items.append({"t": "glyphs", "font": run_ref.font_id, "size_upt": int(size * 1000), "fill": "K100",
                          "glyphs": g, "pos": pos, "clusters": cl})
        start = bp.node_index + 1
    return items, y


def page(n: int, paras: list[dict], heads: list[dict]) -> dict:
    items = []
    ptr = n * 37
    y_top = MARGIN + 12.0
    items.append({"t": "rect", "x": upt(MARGIN), "y": upt(MARGIN), "w": upt(PAGE_W - 2 * MARGIN), "h": upt(8.0), "fill": "C0M100Y80K10"})  # section bar
    # lead package across 4 columns: headline + photo
    h = heads[n % len(heads)]["text"]
    hitems, hy = set_paragraph(h, HEAD[0], 36, 40, 4 * COL_W + 3 * GUTTER, MARGIN, y_top, weight=HEAD[1])
    items += hitems
    photo_h = 80.0
    items.append({"t": "image", "x": upt(MARGIN), "y": upt(hy + 3), "w": upt(4 * COL_W + 3 * GUTTER), "h": upt(photo_h),
                  "rendition": f"photo-{n:02d}-a", "src_px": [4000, 2667]})
    items.append({"t": "image", "x": upt(MARGIN + 5 * (COL_W + GUTTER)), "y": upt(y_top), "w": upt(3 * COL_W + 2 * GUTTER),
                  "h": upt(60.0), "rendition": f"photo-{n:02d}-b", "src_px": [3000, 2000]})
    ad_h = 0.0 if n == 0 else (PAGE_H * 0.25 if n % 3 else PAGE_H * 0.5)
    if ad_h:
        items.append({"t": "ad", "x": upt(MARGIN), "y": upt(PAGE_H - MARGIN - ad_h), "w": upt(PAGE_W - 2 * MARGIN),
                      "h": upt(ad_h), "rendition": f"ad-{n:02d}", "src": "pdf-raster-preview"})
    bottom = PAGE_H - MARGIN - ad_h - 4.0
    for c in range(COLS):
        x0 = MARGIN + c * (COL_W + GUTTER)
        y = (hy + photo_h + 8) if c < 4 else (y_top + 66.0 if c >= 5 else y_top)
        while y < bottom - 12:
            t = paras[ptr % len(paras)]; ptr += 1
            pit, y_new = set_paragraph(t["text"], BODY[0], BODY[1], BODY[2], COL_W, x0, y)
            if y_new > bottom:
                keep = []
                for it in pit:  # clip whole lines beyond the frame (overset not modelled)
                    if it["pos"][1] / 1000 / PT <= bottom:
                        keep.append(it)
                items += keep
                break
            items += pit
            y = y_new + 1.5
        if c < COLS - 1:
            items.append({"t": "rule", "x1": upt(x0 + COL_W + GUTTER / 2), "y1": upt(y_top), "x2": upt(x0 + COL_W + GUTTER / 2),
                          "y2": upt(bottom), "stroke_upt": 250, "dash": [1000, 1000]})
    glyphs = sum(len(i["glyphs"]) for i in items if i["t"] == "glyphs")
    return {"schema": "pageinator.experiment.render-workload-page/1", "page": n + 1,
            "size_upt": [upt(PAGE_W), upt(PAGE_H)], "items": items,
            "stats": {"items": len(items), "glyph_runs": sum(1 for i in items if i["t"] == "glyphs"), "glyphs": glyphs,
                      "images": sum(1 for i in items if i["t"] == "image"), "ads": sum(1 for i in items if i["t"] == "ad"),
                      "rules_rects": sum(1 for i in items if i["t"] in ("rule", "rect"))}}


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--pages", type=int, default=16); a = ap.parse_args()
    out = HERE / "out"; out.mkdir(exist_ok=True)
    corpus = C.load_corpus()
    paras = [t for t in corpus if t["kind"] == "body" and t["lang"] == "mr"]
    heads = [t for t in corpus if t["kind"] == "headline" and t["lang"] == "mr"]
    stats = []
    for n in range(a.pages):
        p = page(n, paras, heads)
        (out / f"page-{n + 1:02d}.json").write_text(json.dumps(p, separators=(",", ":")))
        stats.append({"page": n + 1, **p["stats"], "json_bytes": (out / f"page-{n + 1:02d}.json").stat().st_size})
    fonts = {f: C.font_file_for(f) for f in (BODY[0], HEAD[0])}
    (out / "fonts.json").write_text(json.dumps(fonts, indent=2))
    summary = {"pages": stats, "total_glyphs": sum(s["glyphs"] for s in stats),
               "glyphs_per_page_min_max": [min(s["glyphs"] for s in stats), max(s["glyphs"] for s in stats)],
               "geometry": {"page_mm": [PAGE_W, PAGE_H], "cols": COLS, "col_w_mm": COL_W, "body": BODY},
               "caveats": ["ragged text (no justification in oracle-v0)", "synthetic page pattern",
                           "geometry not pilot's", "images/ads are placeholders referencing renditions"],
               "env": C.environment()}
    res = C.REPO / "experiments" / "phase0" / "results" / "render_workload"
    res.mkdir(parents=True, exist_ok=True)
    (res / "stats.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: summary[k] for k in ("total_glyphs", "glyphs_per_page_min_max")}))


if __name__ == "__main__":
    main()
