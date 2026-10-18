"""EXP-COMPOSE-1 review sheets (SVG, glyph outlines from the exact shaped font instance).

EXPERIMENTAL. Two outputs:
  review/engineering/*.svg — all candidate policies side by side with per-line metrics (for engineers)
  review/human/sample-NN.svg — BLIND: 4 composition families labelled A–D in seeded random order, no metrics,
                               no algorithm names; key in review/human/KEY_SEALED.json (hold with a non-rater)
Selection is programmatic (seeded RNG + fixed rules), never hand-picked.
No glyph scaling/distortion: glyphs are drawn at their shaped advances; only inter-word space (and
Latin tracking where a policy says so) changes.

Usage: PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose1/render_sheets.py
"""
from __future__ import annotations

import hashlib
import io
import json
import random
import sys
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402
import composer as K  # noqa: E402
import run_matrix as R  # noqa: E402
from fontTools.pens.svgPathPen import SVGPathPen  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402

SEED = 20261008
REV = R.OUT / "review"
ENG_POLICIES = ["FULL_DP_h2.00", "FULL_DP_h2.00_rules", "FULL_DP_h2.00_rules_publishedmin", "CONSTRAINED_DP_c1.50",
                "CONSTRAINED_DP_c2.00", "HYBRID_GREEDY_h2.00", "HYBRID_DP_h2.00", "HYBRID_DP_h2.00_rules", "RAGGED_DP"]
_GLYPH_DEFS: dict = {}


def glyph_path(face_bytes: bytes, gid: int) -> tuple[str, str]:
    fh = hashlib.sha256(face_bytes).hexdigest()[:10]
    key = (fh, gid)
    if key not in _GLYPH_DEFS:
        tt = _font_cache(fh, face_bytes)
        name = tt.getGlyphOrder()[gid]
        pen = SVGPathPen(tt.getGlyphSet())
        tt.getGlyphSet()[name].draw(pen)
        _GLYPH_DEFS[key] = (f"g{fh}-{gid}", pen.getCommands())
    return _GLYPH_DEFS[key]


_FONTS: dict = {}


def _font_cache(fh, b):
    if fh not in _FONTS:
        _FONTS[fh] = TTFont(io.BytesIO(b))
    return _FONTS[fh]


def line_glyphs(p: K.Prepared, c: K.Composed, ln: K.Line, x0: float, y: float, upem: int) -> list[str]:
    """<use> elements for one composed line; positions from shaped advances + applied word space."""
    out, x = [], x0
    s = p.em_mm / upem
    for k in range(ln.a, ln.b):
        pc = c.pieces[k]
        cl_ids = p.words[pc.word][pc.cl_from:pc.cl_to]
        for ci_n, ci in enumerate(cl_ids):
            for ri, gi in p.clusters[ci].glyphs:
                r = p.runs[ri]
                gid, adv = r.glyph_ids[gi], r.x_advances_mm[gi]
                did, _ = glyph_path(p.face_bytes, gid)
                out.append(f'<use href="#{did}" transform="translate({x + r.x_offsets_mm[gi]:.4f},{y - r.y_offsets_mm[gi]:.4f}) scale({s:.6f},{-s:.6f})"/>')
                x += adv
            if ln.tracking_mm_per_gap and ci_n < len(cl_ids) - 1:
                x += ln.tracking_mm_per_gap
        if k < ln.b - 1 and c.btype[k] == "space":
            nat = p.spaces[pc.word]
            x += nat * (ln.applied_sf if ln.kind in ("justified", "semi") else (ln.applied_sf if ln.applied_sf < 1 else 1.0))
    if ln.end_break == "inword":
        hr = C.shape_paragraph("-", "en", p.family, p.size_pt, axes=p.axes).runs[0]
        did, _ = glyph_path(p.face_bytes, hr.glyph_ids[0])
        out.append(f'<use href="#{did}" transform="translate({x:.4f},{y:.4f}) scale({s:.6f},{-s:.6f})"/>')
    return out


def column(p, c, x0, y0, width, leading_mm, annotate: bool) -> tuple[list[str], float]:
    upem = _font_cache(hashlib.sha256(p.face_bytes).hexdigest()[:10], p.face_bytes)["head"].unitsPerEm
    els = [f'<rect x="{x0}" y="{y0}" width="{width}" height="{max(1, len(c.lines)) * leading_mm + 2}" fill="none" stroke="#c8c8c8" stroke-width="0.1"/>']
    if c.status != "OK" or not c.lines:
        els.append(f'<text x="{x0 + 1}" y="{y0 + 5}" font-size="2.6" fill="#b00">{"OVERSET — no composition within hard limits" if annotate else "(not available)"}</text>')
        return els, y0 + 8
    y = y0
    for ln in c.lines:
        y += leading_mm
        els += line_glyphs(p, c, ln, x0, y, upem)
        if annotate:
            col = "#0a7d32" if ln.kind in ("justified", "final") and ln.applied_sf <= 1.33 else \
                  "#c27c00" if ln.kind in ("justified", "final") and ln.applied_sf <= 2.0 else "#b00"
            tag = {"justified": f"{ln.applied_sf:.2f}×", "final": "end", "semi": f"semi {ln.applied_sf:.2f}× short {ln.slack_mm:.1f}",
                   "ragged": f"rag {ln.slack_mm:.1f}", "violation": "VIOLATION", "overfull": "OVERFULL"}.get(ln.kind, ln.kind)
            if ln.end_break == "inword":
                tag += " ‧brk"
            els.append(f'<text x="{x0 + width + 0.8}" y="{y - 0.4}" font-size="1.7" fill="{col}">{escape(tag)}</text>')
    return els, y + 3


def svg_doc(body: list[str], w: float, h: float) -> str:
    defs = "".join(f'<path id="{i}" d="{d}"/>' for i, d in sorted(set(_GLYPH_DEFS.values())))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}">'
            f'<rect width="100%" height="100%" fill="#fff"/><defs>{defs}</defs>{"".join(body)}</svg>\n')


def metrics(c: K.Composed) -> str:
    nf = [l for l in c.lines if l.kind != "final"]
    app = sorted(l.applied_sf for l in nf if l.kind == "justified")
    wpl = sum(l.n_words for l in nf) / max(1, len(nf))
    def q(xs, p):
        return C.percentile(xs, p) if xs else float("nan")
    warn = sorted({f for l in c.lines for f in l.flags})
    return (f"{c.status} · lines {len(c.lines)} · wpl {wpl:.1f} · justified {len(app)}/{len(nf)} · "
            f"space med {q(app, .5):.2f} p95 {q(app, .95):.2f} max {max(app) if app else float('nan'):.2f} · "
            f"in-word {sum(l.end_break == 'inword' for l in c.lines)} · warn {', '.join(warn) or '—'}")


def main() -> None:
    (REV / "engineering").mkdir(parents=True, exist_ok=True)
    (REV / "human").mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    texts = [t for t in C.load_corpus() if t["kind"] == "body" and t["lang"] == "mr"]
    fonts = {lab: (fam, axes, wt) for lab, fam, axes, wt in R.FONTS["Deva"]}
    pols = {p.name: p for p in R.policies("Deva")}

    # ---------- engineering sheets: seeded sample + the two worst-spacing texts from analysis ----------
    eng_texts = sorted(rng.sample([t["id"] for t in texts], 6)) + ["mr-body-13", "mr-body-04"]
    configs = [("NotoSerifDeva-w100", 9.5, 38.0), ("NotoSerifDeva-w100", 9.5, 45.0), ("NotoSerifDeva-w100", 9.5, 52.0),
               ("NotoSerifDeva-w75", 9.5, 45.0)]
    index = []
    for tid in dict.fromkeys(eng_texts):
        t = next(x for x in texts if x["id"] == tid)
        for lab, size, width in configs:
            _GLYPH_DEFS.clear()
            fam, axes, wt = fonts[lab]
            p = K.prepare(t["text"], "mr", "Deva", fam, size, axes, wt)
            body, x, ymax = [], 6.0, 0.0
            head = f"EXP-COMPOSE-1 ENGINEERING · {tid} · mr · {lab} · {size} pt · {width} mm · composer {K.COMPOSER_VERSION}"
            body.append(f'<text x="6" y="6" font-size="2.6">{escape(head)}</text>')
            for name in ENG_POLICIES:
                c = K.compose(p, pols[name], width)
                body.append(f'<text x="{x}" y="12" font-size="2.2" font-weight="bold">{escape(name)}</text>')
                body.append(f'<text x="{x}" y="15" font-size="1.5" fill="#444">{escape(metrics(c))[:150]}</text>')
                els, yend = column(p, c, x, 18.0, width, size * 1.18 * C.MM_PER_PT, annotate=True)
                body += els; ymax = max(ymax, yend); x += width + 34
            fn = f"{tid}__{lab}__{size}pt__{width}mm.svg"
            (REV / "engineering" / fn).write_text(svg_doc(body, x, ymax + 6), encoding="utf-8")
            index.append(fn)

    # ---------- human blind sheets: family representatives chosen by documented rule ----------
    S = json.loads((R.OUT / "analysis" / "summary.json").read_text())["internal_plausibility_mr_ge45mm"]
    def best(prefix):
        cands = [(v["pooled_lines_within_policy_pct"], k) for k, v in S.items()
                 if k.startswith(prefix) and "ortho" not in k and v["composable_pct"] >= 85.0]
        return max(cands)[1]
    reps = {"FULL": best("FULL_"), "CONSTRAINED": best("CONSTRAINED_"), "HYBRID": best("HYBRID_"), "RAGGED": "RAGGED_DP"}
    pool = [(t["id"], w) for t in texts for w in (38.0, 45.0, 52.0)]
    samples = rng.sample(sorted(pool), 12)
    key = {"seed": SEED, "rule": "per family: highest pooled lines-within-policy at ≥45 mm among policies with "
                                 "spaces ≤2.0×, composable ≥85 %, excluding EXPLORATORY; RAGGED = RAGGED_DP",
           "representatives": reps, "font": "NotoSerifDeva-w100", "size_pt": 9.5, "samples": []}
    fam, axes, wt = fonts["NotoSerifDeva-w100"]
    for n, (tid, width) in enumerate(samples, 1):
        _GLYPH_DEFS.clear()
        t = next(x for x in texts if x["id"] == tid)
        p = K.prepare(t["text"], "mr", "Deva", fam, 9.5, axes, wt)
        order = list(reps.items()); rng.shuffle(order)
        body = [f'<text x="6" y="7" font-size="2.8">Sample {n:02d} · Marathi · font: Noto Serif Devanagari · 9.5 pt · column {width} mm</text>',
                '<text x="6" y="11" font-size="2">Rate each version with the G1 score sheet (docs/phase0/G1_ACCEPTANCE_PACKAGE.md §7.3). Text is fictional and internally written.</text>']
        x, ymax, mapping = 6.0, 0.0, {}
        for label, (fam_name, pol_name) in zip("ABCD", order):
            c = K.compose(p, pols[pol_name], width)
            mapping[label] = pol_name
            body.append(f'<text x="{x}" y="17" font-size="3" font-weight="bold">{label}</text>')
            els, yend = column(p, c, x, 20.0, width, 9.5 * 1.18 * C.MM_PER_PT, annotate=False)
            body += els; ymax = max(ymax, yend); x += width + 10
        (REV / "human" / f"sample-{n:02d}.svg").write_text(svg_doc(body, x, ymax + 6), encoding="utf-8")
        key["samples"].append({"sample": n, "text_id": tid, "width_mm": width, "labels": mapping})
    (REV / "human" / "KEY_SEALED.json").write_text(json.dumps(key, indent=2) + "\n")
    (REV / "INDEX.json").write_text(json.dumps({"engineering": index, "human": [f"sample-{i:02d}.svg" for i in range(1, 13)],
                                                "env": C.environment({"composer": K.COMPOSER_VERSION})}, indent=2) + "\n")
    print(len(index), "engineering sheets; 12 human sheets; reps", reps)


if __name__ == "__main__":
    main()
