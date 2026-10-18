"""Units. Spec §2.1 — one rule.

**Internally, everything is millimetres (float).** Points appear only in font
sizes and leading, because that is how typographers speak. Pixels appear only in
the browser.

Round only at the final render boundary. Never round in the engine.

`frontend/src/render/units.ts` MUST match these values exactly. A divergence
between the two is the mechanism by which the canvas and the PDF start
disagreeing, which is the failure this architecture exists to prevent.

M2 extends this module with `PageGeometry` and `BaselineGrid`. M1 needs only the
conversions.
"""

from __future__ import annotations

__all__ = ["MM_PER_PT", "PT_PER_MM", "pt_to_mm", "mm_to_pt"]

MM_PER_PT = 25.4 / 72.0
PT_PER_MM = 72.0 / 25.4


def pt_to_mm(pt: float) -> float:
    return pt * MM_PER_PT


def mm_to_pt(mm: float) -> float:
    return mm * PT_PER_MM
