"""Typesetting core. Spec §M1.

Text is measured and broken here, and nowhere else. The canvas, the PDF, the
proof and the e-paper all draw the result; none of them re-wrap.
"""

from .fonts import FontFace, FontRegistry, FontResolution, FontStyle
from .schemas import Direction, GlyphRun, TextItem
from .shape import itemize, shape_run

__all__ = [
    "Direction",
    "FontFace",
    "FontRegistry",
    "FontResolution",
    "FontStyle",
    "GlyphRun",
    "TextItem",
    "itemize",
    "shape_run",
]
