"""Typed engine exceptions.

CLAUDE.md: the engine raises typed exceptions; `api/` maps them to HTTP. They
live in one module because they are raised across package boundaries — putting
`MissingGlyphError` in `typeset/` and `PreflightError` in `preflight/` would
have `render/` importing both and eventually cycling.
"""

from __future__ import annotations

__all__ = ["PaginatorError", "MissingGlyphError"]


class PaginatorError(Exception):
    """Base for every error the engine raises deliberately."""


class MissingGlyphError(PaginatorError):
    """A required codepoint has no glyph in the resolved face.

    Never substitute `.notdef`. A `□` in a printed newspaper is invisible to
    anyone who cannot read the script, so it reaches the page unchallenged —
    which makes silent fallback more dangerous than a hard failure.
    """

    def __init__(self, codepoint: int, font_id: str, family: str) -> None:
        self.codepoint = codepoint
        self.font_id = font_id
        self.family = family
        # chr() raises above U+10FFFF, and an error constructor that itself
        # throws replaces a precise diagnostic with a confusing one.
        try:
            shown = f" ({chr(codepoint)!r})"
        except (ValueError, OverflowError):
            shown = ""
        super().__init__(
            f"U+{codepoint:04X}{shown} has no glyph in "
            f"{family!r} (font_id={font_id})"
        )
