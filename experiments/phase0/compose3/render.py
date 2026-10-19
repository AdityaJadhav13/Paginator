"""Glyph-outline line renderer for SVG proofs, with the CORRECT vertical mark offset (EXPERIMENTAL).

compose1/render_sheets.line_glyphs (frozen with EXP-COMPOSE-1, and reused by EXP-COMPOSE-2 proofs) computes
`y - r.y_offsets_mm[gi]`. The oracle's y_offsets_mm are already y-down (tools/oracle/v0/paginator/typeset/shape.py
negates HarfBuzz's y-up offsets), so in the y-down SVG frame the correct position is `y + y_offset`. Marks with a
vertical GPOS offset — below-base rakar (्र), u/uu matras, some reph forms — were drawn mirrored about their attachment
point by up to ≈ 0.07 em. Found by the EXP-PDF-1 code review (2026-10-11); this copy is used by the compose3 review
sheets and the pilot illustrations. Outlines and defs still come from render_sheets (read-only reuse).
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "compose1")); sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402
import render_sheets as RS  # noqa: E402


def line_glyphs(p, c, ln, x0: float, y: float, upem: int) -> list[str]:
    """<use> elements for one composed line; positions from shaped advances + applied word space."""
    out, x = [], x0
    s = p.em_mm / upem
    for k in range(ln.a, ln.b):
        pc = c.pieces[k]
        cl_ids = p.words[pc.word][pc.cl_from:pc.cl_to]
        for ci_n, ci in enumerate(cl_ids):
            for ri, gi in p.clusters[ci].glyphs:
                r = p.runs[ri]
                did, _ = RS.glyph_path(p.face_bytes, r.glyph_ids[gi])
                out.append(f'<use href="#{did}" transform="translate({x + r.x_offsets_mm[gi]:.4f},{y + r.y_offsets_mm[gi]:.4f}) '
                           f'scale({s:.6f},{-s:.6f})"/>')
                x += r.x_advances_mm[gi]
            if ln.tracking_mm_per_gap and ci_n < len(cl_ids) - 1:
                x += ln.tracking_mm_per_gap
        if k < ln.b - 1 and c.btype[k] == "space":
            nat = p.spaces[pc.word]
            x += nat * (ln.applied_sf if ln.kind in ("justified", "semi") else min(1.0, ln.applied_sf))
    if ln.end_break == "inword":
        hr = C.shape_paragraph("-", "en", p.family, p.size_pt, axes=p.axes).runs[0]
        did, _ = RS.glyph_path(p.face_bytes, hr.glyph_ids[0])
        out.append(f'<use href="#{did}" transform="translate({x:.4f},{y:.4f}) scale({s:.6f},{-s:.6f})"/>')
    return out
