"""EXP-COMPOSE-2 printable proof pages (EXPERIMENTAL) — for the newsroom's printing unit and blind editor review.

Each page = one composition STYLE applied to a whole synthetic page (so editors judge page texture, not a
paragraph). Pages carry only a neutral code; the style key is written separately (KEY_SEALED.json).
Text is the synthetic Phase 0 corpus (NOT news). Grids are PROVISIONAL unless house_profile.measured.json exists.
Glyphs are drawn as outlines from the exact shaped font instance; no glyph scaling/distortion.

Selection rule (fixed in code, not by preference):
  grids  = the 8-column and 6-column provisional grids
  fonts  = best SERIF and best SANS body face by C2_HYBRID_rules justified-lines % at the 6-column width,
           excluding display/rounded faces (Khand, Baloo 2)
  styles = A: full justification at whatever spacing it needs, with Marathi pattern breaks (C2_MEAS_uncapped_rules)
           B: hybrid with Marathi pattern breaks (C2_HYBRID_rules_h2.00)
           C: constrained/semi-justified, no word breaks (C2_CONSTRAINED_c2.00)
           D: ragged-right with Marathi pattern breaks (C2_RAGGED_rules)

Outputs: results/compose2/proofs/{proof-NN.svg, proof-NN_truesize.pdf, proof-NN_A3.pdf, KEY_SEALED.json, INDEX.json}
Usage: PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/proofs.py
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / "typeset_harness")); sys.path.insert(0, str(HERE.parent / "compose1"))
import fontreg  # noqa: E402

fontreg.install()
import common as C  # noqa: E402
import composer2 as K2  # noqa: E402
import render_sheets as RS  # noqa: E402  (compose1 glyph-outline drawing helpers; read-only reuse)
import run_compose2 as R  # noqa: E402

OUT = R.OUT / "proofs"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SEED = 20261011
STYLES = {"A": "PROOF_A_full_any_spacing_rules", "B": "PROOF_B_hybrid_rules_h2.00", "C": "PROOF_C_constrained_c2.00", "D": "PROOF_D_ragged_rules"}
_COMMON = dict(inword_min=(2, 2), token_breaks=True, max_consecutive_inword=2, fallback_max_slack=None)


def proof_policies():
    """Proof variants ALWAYS set every paragraph (soft shortness, no overset), so pages never silently drop text.
    A = like desktop DTP full justification: justify every line at whatever spacing it needs (penalty grows with
        spacing) and set only single-word lines flush left (fallback cost 1e6 makes ragged a last resort)."""
    return {
        STYLES["A"]: K2.Policy(STYLES["A"], "HYBRID", ws_max_hard=50.0, inword="rules",
                               weights=K2.Weights(soft_space=100.0 * (50 - 1.33) ** 2, hybrid_fallback=1e6), **_COMMON),
        STYLES["B"]: K2.Policy(STYLES["B"], "HYBRID", ws_max_hard=2.0, inword="rules", **_COMMON),
        STYLES["C"]: K2.Policy(STYLES["C"], "CONSTRAINED", ws_max_hard=2.0, inword="none", **_COMMON),
        STYLES["D"]: K2.Policy(STYLES["D"], "RAGGED", inword="rules", **_COMMON),
    }
BODY_PT, LEAD_F = 9.0, 1.15
HEAD = ("Noto Sans Devanagari", {"wght": 700.0}, 700, 13.0)


def choose_fonts():
    S = json.loads((R.OUT / "analysis" / "summary.json").read_text())
    six = dict(S["grid_widths_mm"])["PROV-6col"]
    rows = [x for x in S["fonts_by_width"] if x["width_mm"] == six and x["category"] in ("serif", "sans")]
    best = {}
    for cat in ("serif", "sans"):
        c = max((x for x in rows if x["category"] == cat), key=lambda x: x["HYBRID_rules_justified_pct"])
        best[cat] = c["font"]
    return best, six


def set_text(p, pol, width, x0, y, leading_mm, upem_cache):
    c = K2.compose(p, pol, width)
    els = []
    if not c.lines:
        return els, y, c
    upem = RS._font_cache(RS.hashlib.sha256(p.face_bytes).hexdigest()[:10], p.face_bytes)["head"].unitsPerEm  # noqa: SLF001
    for ln in c.lines:
        y += leading_mm
        els.append((y, RS.line_glyphs(p, c, ln, x0, y, upem)))
    return els, y, c


def page_svg(grid, font_label, style_code, code_name, texts, heads):
    fam, axes, wt = next((f[1], f[2], f[3]) for f in R.FONTS if f[0] == font_label)
    pol = proof_policies()[STYLES[style_code]]
    head_pol = K2.Policy("PROOF_headline_ragged", "RAGGED", inword="none", token_breaks=True, fallback_max_slack=None)
    W, H = grid["page_mm"]; M, G, N = grid["margin_mm"], grid["gutter_mm"], grid["columns"]
    cw = (W - 2 * M - (N - 1) * G) / N
    lead = BODY_PT * LEAD_F * C.MM_PER_PT
    RS._GLYPH_DEFS.clear()  # noqa: SLF001
    body, ti, hi = [], 0, 0
    bottom = H - M
    for col in range(N):
        x = M + col * (cw + G); y = M + 18
        while y < bottom - 3 * lead:
            # headline
            h = heads[hi % len(heads)]; hi += 1
            hp = K2.prepare(h["text"], "mr", "Deva", HEAD[0], HEAD[3], HEAD[1], HEAD[2])
            hels, y2, _ = set_text(hp, head_pol, cw, x, y + 2, HEAD[3] * 1.1 * C.MM_PER_PT, None)
            if y2 > bottom:
                break
            body += [e for _, line in hels for e in line]; y = y2 + 1.5
            for _ in range(3):
                t = texts[ti % len(texts)]; ti += 1
                p = K2.prepare(t["text"], "mr", "Deva", fam, BODY_PT, axes, wt)
                els, y3, c = set_text(p, pol, cw, x, y, lead, None)
                for ly, line in els:
                    if ly > bottom:
                        break
                    body += line
                y = min(y3, bottom) + 1.2
                if y >= bottom - lead:
                    break
            y += 3
        if col < N - 1:
            gx = x + cw + G / 2
            body.append(f'<line x1="{gx:.2f}" y1="{M + 16}" x2="{gx:.2f}" y2="{bottom}" stroke="#999" stroke-width="0.15" stroke-dasharray="0.6 0.6"/>')
    hdr = (f'<text x="{M}" y="{M + 6}" font-size="5" font-family="sans-serif">EXP-COMPOSE-2 PROOF {escape(code_name)}</text>'
           f'<text x="{M}" y="{M + 11}" font-size="2.6" font-family="sans-serif">Synthetic text (NOT news) · grid {escape(grid["id"])} '
           f'(PROVISIONAL) {cw:.2f} mm columns · body {escape(font_label)} {BODY_PT} pt / {BODY_PT * LEAD_F:.2f} pt · '
           f'rate with docs/phase0/G1_ACCEPTANCE_PACKAGE.md §7.3</text>'
           f'<line x1="{M}" y1="{M + 14}" x2="{W - M}" y2="{M + 14}" stroke="#000" stroke-width="0.4"/>')
    return RS.svg_doc([hdr] + body, W, H)


def to_pdf(svg_path: Path, w_mm: float, h_mm: float, a3: bool):
    pdf = svg_path.with_name(svg_path.stem + ("_A3.pdf" if a3 else "_truesize.pdf"))
    if a3:
        s = min(297 / w_mm, 420 / h_mm)
        page = "297mm 420mm"; img = f'<img src="{svg_path.name}" style="width:{w_mm * s}mm;height:{h_mm * s}mm;display:block">'
    else:
        page = f"{w_mm}mm {h_mm}mm"; img = f'<img src="{svg_path.name}" style="width:{w_mm}mm;height:{h_mm}mm;display:block">'
    html = svg_path.with_suffix(".print.html")
    html.write_text(f"<!doctype html><html><head><meta charset='utf-8'><style>@page{{size:{page};margin:0}}html,body{{margin:0}}</style></head><body>{img}</body></html>")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--no-pdf-header-footer",
                    "--virtual-time-budget=10000", f"--print-to-pdf={pdf}", html.as_uri()], check=True, capture_output=True)
    html.unlink()
    return pdf


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fonts, six = choose_fonts()
    _, prof, _ = R.profile()
    grids = [g for g in prof["profiles"] if g["id"] in ("PROV-8col", "PROV-6col")]
    texts = [t for t in C.load_corpus() if t["kind"] == "body" and t["lang"] == "mr"]
    heads = [t for t in C.load_corpus() if t["kind"] == "headline" and t["lang"] == "mr"]
    rng = random.Random(SEED)
    jobs = [(g, f, s) for g in grids for f in fonts.values() for s in STYLES]
    rng.shuffle(jobs)
    key = {"seed": SEED, "styles": STYLES, "fonts_rule": "best serif & best sans by C2_HYBRID_rules justified % at 6-col width",
           "fonts": fonts, "grid_status": prof.get("status"), "pages": []}
    for n, (g, f, s) in enumerate(jobs, 1):
        code = f"P{n:02d}"
        svg = OUT / f"proof-{n:02d}.svg"
        svg.write_text(page_svg(g, f, s, code, texts, heads), encoding="utf-8")
        to_pdf(svg, *g["page_mm"], a3=False); to_pdf(svg, *g["page_mm"], a3=True)
        from dataclasses import asdict  # noqa: PLC0415
        key["pages"].append({"code": code, "grid": g["id"], "font": f, "style": s, "policy": STYLES[s],
                             "policy_settings": asdict(proof_policies()[STYLES[s]])})
        print(code, g["id"], f, "→ sealed")
    (OUT / "KEY_SEALED.json").write_text(json.dumps(key, indent=1) + "\n")
    (OUT / "INDEX.json").write_text(json.dumps({"pages": [f"proof-{i:02d}" for i in range(1, len(jobs) + 1)],
                                                "formats": ["_truesize.pdf (print at 100% on a broadsheet-capable proofer)", "_A3.pdf (scaled to fit A3; scale is printed nowhere — note it when judging)"],
                                                "env": C.environment({"composer": K2.COMPOSER_VERSION})}, indent=1) + "\n")


if __name__ == "__main__":
    main()
