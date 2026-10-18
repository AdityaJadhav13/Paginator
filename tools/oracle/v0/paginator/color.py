"""Colour value types.

CMYK is the engine's native colour space because the deliverable is a press
PDF: newsprint is printed from four separations, and converting RGB at the last
moment is how muddy colour and blown ink limits happen. Spec §2.2, §5.2.

M8 adds the ICC transforms in `media/color.py`; this module holds only the
value type those transforms move between.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["CMYK", "BLACK", "REGISTRATION"]


class CMYK(BaseModel):
    """A colour in CMYK, each channel 0.0-1.0.

    Frozen: a colour is a value, and sharing one between frames must never let
    an edit to one change the other.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    c: float = Field(ge=0.0, le=1.0)
    m: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    k: float = Field(ge=0.0, le=1.0)

    @classmethod
    def of(cls, c: float, m: float, y: float, k: float) -> CMYK:
        """Positional construction, spelling out all four channels.

        Spec §2.2 writes `CMYK(0, 0, 0, 1.0)`. Pydantic models take keywords
        only, and the obvious workaround — a custom `__init__` with defaults —
        sets `__pydantic_custom_init__` and lets those defaults override the
        required fields, so `CMYK.model_validate({})` silently returns *white*.
        An under-specified colour becoming white rather than an error is
        invisible ink on the page and a wrong answer for the M11 ink-limit and
        overprint checks, so the channels stay required and positional
        construction goes through here.
        """
        return cls(c=c, m=m, y=y, k=k)

    @property
    def total_ink(self) -> float:
        """Total area coverage, 0.0-4.0.

        Preflight compares this against the press profile's limit — 2.40 for
        ISOnewspaper26v4, 2.20 for WAN-IFRAnewspaper26v5 (spec §M11 COL002).
        """
        return self.c + self.m + self.y + self.k

    @property
    def is_pure_black(self) -> bool:
        """100% K and nothing else.

        Body text must be pure black and set to overprint, or registration
        drift leaves a white halo around every letter (spec §M11 COL005).
        """
        return self.k == 1.0 and self.c == self.m == self.y == 0.0


BLACK = CMYK.of(0.0, 0.0, 0.0, 1.0)
REGISTRATION = CMYK.of(1.0, 1.0, 1.0, 1.0)
