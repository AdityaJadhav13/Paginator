"""Typesetting contracts. Spec §2.2.

`GlyphRun` is the output of shaping and the input to everything downstream. It
is deliberately the *only* place glyph positions exist: the canvas, the PDF and
the e-paper all draw these numbers rather than recomputing them.

Units are millimetres, already scaled from font units and already tracked.
Nothing downstream multiplies by a point size again.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..color import BLACK, CMYK
from ..geometry import MM_PER_PT

__all__ = [
    "ADJ_DEMERITS",
    "DEFAULT_LINE_PENALTY",
    "DEFAULT_TOLERANCE",
    "FLAGGED_DEMERITS",
    "INF_PENALTY",
    "Box",
    "Breakpoint",
    "Direction",
    "GlyphRun",
    "HyphenPoint",
    "Glue",
    "LineBreakAlgorithm",
    "LineBreakResult",
    "InWordBreak",
    "Node",
    "Penalty",
    "TextAlign",
    "TextItem",
    "TextStyle",
]

Direction = Literal["ltr", "rtl"]


class TextItem(BaseModel):
    """A slice of the source with one script and one direction.

    Produced by `itemize()`. `script` is an ISO 15924 tag as HarfBuzz reports
    it — "Latn", "Deva", "Arab". Characters with no strong script of their own
    (spaces, digits, most punctuation — UAX#24 Common and Inherited) are
    resolved into the surrounding run rather than forming runs of their own,
    which is what stops "देखें 2026 में" from splitting into five items.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    start: int = Field(ge=0)
    end: int = Field(gt=0)
    script: str = Field(min_length=4, max_length=4)
    direction: Direction
    language: str = Field(default="", description="BCP-47; '' when unspecified")

    @model_validator(mode="after")
    def _check_range(self) -> TextItem:
        if self.end <= self.start:
            raise ValueError(f"empty item: start={self.start} end={self.end}")
        return self

    @property
    def length(self) -> int:
        return self.end - self.start


class GlyphRun(BaseModel):
    """One contiguous run in one font at one size. The output of HarfBuzz.

    The parallel tuples are all the same length and all indexed by glyph
    position, not by source character: shaping is not one-to-one. A Devanagari
    conjunct is one glyph spanning three codepoints; a reordered i-matra is one
    glyph that appears *before* the character it follows logically.

    `cluster_map[i]` is the index into the source string of the cluster glyph
    `i` belongs to. Several glyphs may share a cluster, and cluster values skip
    — for `क्षत्रिय` they are `[0, 3, 3, 7]` over an 8-character string. The
    guarantee is that clusters are non-decreasing (for LTR) and that the
    cluster boundaries partition the source exactly, which is what lets a
    warning name the character a reader must change.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    font_id: str = Field(min_length=1)
    size_pt: float = Field(gt=0)
    glyph_ids: tuple[int, ...]
    x_advances_mm: tuple[float, ...]
    x_offsets_mm: tuple[float, ...]
    y_offsets_mm: tuple[float, ...]
    cluster_map: tuple[int, ...]
    color: CMYK = BLACK

    # Not in spec §2.2: the source slice this run was shaped from. Required, not
    # defaulted — these fields exist to make `cluster_map` interpretable, and a
    # run whose declared range silently said 0..0 while carrying five glyphs
    # would be worse than no field at all on a structure M5 persists per edit.
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_parallel(self) -> GlyphRun:
        n = len(self.glyph_ids)
        for name in ("x_advances_mm", "x_offsets_mm", "y_offsets_mm", "cluster_map"):
            if len(getattr(self, name)) != n:
                raise ValueError(
                    f"{name} has {len(getattr(self, name))} entries, "
                    f"expected {n} to match glyph_ids"
                )
        if self.char_end < self.char_start:
            raise ValueError(
                f"char_end {self.char_end} precedes char_start {self.char_start}"
            )
        if self.cluster_map:
            lo, hi = min(self.cluster_map), max(self.cluster_map)
            if lo < self.char_start or hi >= self.char_end:
                raise ValueError(
                    f"cluster_map spans {lo}..{hi}, outside the declared "
                    f"character range {self.char_start}..{self.char_end}"
                )
        return self

    @property
    def glyph_count(self) -> int:
        return len(self.glyph_ids)

    @property
    def width_mm(self) -> float:
        """Total advance. Offsets do not contribute — they move ink, not the pen."""
        return sum(self.x_advances_mm)


# ---------------------------------------------------------------------------
# Line breaking — spec §M1.3
# ---------------------------------------------------------------------------

LineBreakAlgorithm = Literal["greedy", "knuth_plass"]
TextAlign = Literal["left", "right", "center", "justify"]

# How a script may break inside a word. Spec §M1.4 amendment 2 — the Devanagari
# choice is an outstanding native-speaker decision, so it is a setting, never a
# hardcoded preference.
InWordBreak = Literal["none", "dictionary", "akshara"]

# Spec §M1.3, with DEFAULT_TOLERANCE added by the 2026-08-13 amendment.
DEFAULT_LINE_PENALTY = 10
ADJ_DEMERITS = 10_000
FLAGGED_DEMERITS = 3_000
INF_PENALTY = 10_000
DEFAULT_TOLERANCE = 1.0


class TextStyle(BaseModel):
    """Everything that governs how a paragraph is set. Spec §2.2.

    Frozen: a style is a value. Two frames sharing one must never let an edit to
    one silently change the other.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    font_family: str = Field(min_length=1)
    font_weight: int = Field(default=400, ge=100, le=900)
    font_style: Literal["normal", "italic"] = "normal"
    size_pt: float = Field(gt=0)
    leading_pt: float = Field(gt=0)
    tracking: float = 0.0

    word_space_min: float = Field(default=0.75, gt=0)
    word_space_opt: float = Field(default=1.00, gt=0)
    word_space_max: float = Field(default=1.50, gt=0)

    align: TextAlign = "left"
    algorithm: LineBreakAlgorithm = "greedy"
    tolerance: float = Field(default=DEFAULT_TOLERANCE, gt=0)

    hyphenate: bool = True
    hyphen_language: str = "en_GB"
    min_hyphen_prefix: int = Field(default=3, ge=1)
    min_hyphen_suffix: int = Field(default=3, ge=1)
    max_consecutive_hyphens: int = Field(default=2, ge=0)

    # Spec §M1.4 amendment 2. `in_word_break` selects the mechanism;
    # `hyphen_glyph` decides whether a break shows ink. Devanagari akshara
    # breaking needs break-without-glyph, which one flag cannot express.
    in_word_break: InWordBreak = "dictionary"
    hyphen_glyph: bool = True

    space_before_pt: float = Field(default=0.0, ge=0.0)
    space_after_pt: float = Field(default=0.0, ge=0.0)
    indent_first_mm: float = 0.0
    indent_left_mm: float = 0.0
    indent_right_mm: float = 0.0

    color: CMYK = BLACK
    keep_with_next_lines: int = Field(default=0, ge=0)
    drop_cap_lines: int = Field(default=0, ge=0)
    drop_cap_chars: int = Field(default=0, ge=0)
    widow_control_lines: int = Field(default=2, ge=0)
    orphan_control_lines: int = Field(default=2, ge=0)
    snap_to_baseline: bool = True

    @model_validator(mode="after")
    def _check_word_space(self) -> TextStyle:
        if not (self.word_space_min <= self.word_space_opt <= self.word_space_max):
            raise ValueError(
                f"word space must satisfy min <= opt <= max, got "
                f"{self.word_space_min} / {self.word_space_opt} / "
                f"{self.word_space_max}"
            )
        return self

    @property
    def leading_mm(self) -> float:
        return self.leading_pt * MM_PER_PT


class HyphenPoint(BaseModel):
    """A permitted break inside a word.

    Spec §M1.4 amendment 1: the offset alone is not enough. Three cases need
    *break here but insert no glyph* — an existing hard hyphen (`co-operate`
    must not gain a second one), a soft hyphen already in the copy, and
    Devanagari akshara breaking if it is ever enabled. A bare `list[int]` cannot
    say that, so M1.5 would stamp hyphens where none belong.

    `offset` is a character index into the PARAGRAPH, not into the word.
    `hyphen_points()` (M1.4) returns word-relative offsets and its caller adds
    the word's start; `build_nodes` matches against absolute cluster indices.
    Passing a word-relative offset produces no penalty at all, silently.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    offset: int = Field(gt=0)
    inserts_glyph: bool = True


class Box(BaseModel):
    """Unbreakable material — one word, or one run of clusters between spaces.

    `glyph_range` indexes into ONE run's glyph stream — the run named by
    `run_index`, not a concatenation across runs. A three-run paragraph yields
    boxes like `(0,4) run 0`, `(0,6) run 1`, `(0,5) run 2`. Slicing run 1 with
    run 0's offsets renders a plausible-looking wrong word in Devanagari, which
    is exactly the kind of error nobody here can see.

    It always falls on cluster boundaries: slicing a
    Devanagari conjunct decomposes it (M1.2 measured `क्षत्रिय`[0:2] losing the
    ksha ligature), so a box never starts or ends mid-cluster.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    width_mm: float = Field(ge=0.0)
    glyph_range: tuple[int, int]
    run_index: int = Field(default=0, ge=0)


class Glue(BaseModel):
    """Stretchable, shrinkable space. A legal breakpoint when it follows a Box."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    width_mm: float = Field(ge=0.0)
    stretch_mm: float = Field(ge=0.0)
    shrink_mm: float = Field(ge=0.0)


class Penalty(BaseModel):
    """A breakpoint with a cost. `flagged` marks a hyphen.

    `width_mm` is what appears *if* the line breaks here — the hyphen's own
    advance — and is zero otherwise. `inserts_glyph` is False for a break that
    shows nothing: an existing hard hyphen, a soft hyphen already in the copy,
    or a Devanagari akshara break.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    width_mm: float = Field(default=0.0, ge=0.0)
    cost: int = 0
    flagged: bool = False
    inserts_glyph: bool = True

    @property
    def is_forced(self) -> bool:
        return self.cost <= -INF_PENALTY

    @property
    def is_forbidden(self) -> bool:
        return self.cost >= INF_PENALTY


Node = Box | Glue | Penalty


class Breakpoint(BaseModel):
    """One chosen line break."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    node_index: int = Field(ge=0)
    line: int = Field(ge=0)
    measure_mm: float = Field(gt=0.0)
    natural_width_mm: float = Field(ge=0.0)
    adjustment_ratio: float
    is_hyphenated: bool = False
    ink_overhang_mm: float = Field(default=0.0, ge=0.0)

    @model_validator(mode="after")
    def _check_ratio(self) -> Breakpoint:
        # INVARIANT: a line that would need to shrink by more than its available
        # shrink is not a line. Spec §M1.3: "Reject any line with
        # adjustment_ratio < -1 (cannot shrink enough)."
        if self.adjustment_ratio < -1.0 - 1e-9:
            raise ValueError(
                f"line {self.line} has adjustment_ratio {self.adjustment_ratio:.4f} "
                f"< -1: it cannot shrink that far"
            )
        return self


class LineBreakResult(BaseModel):
    """Chosen breaks, plus whether the requested algorithm actually produced them.

    `used_fallback` exists because at newspaper column widths the fallback is the
    *normal* path, not an exception — measured 0/62 paragraphs feasible for
    English at 30.25mm before hyphenation. M1.4 is measured by this dropping, so
    it has to be counted rather than inferred.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    breakpoints: tuple[Breakpoint, ...]
    algorithm: LineBreakAlgorithm
    used_fallback: bool = False
    fallback_reason: str = ""

    @property
    def line_count(self) -> int:
        return len(self.breakpoints)

    @property
    def hyphenated_line_count(self) -> int:
        return sum(1 for b in self.breakpoints if b.is_hyphenated)
