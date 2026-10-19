"""Shaping — M1.2, spec §M1.2.

`itemize()` splits a string into runs of uniform script and direction;
`shape_run()` hands one run to HarfBuzz and converts the result to millimetres.

Two things here are easy to get wrong and expensive to discover late:

**HarfBuzz scale is pinned to units_per_em** (in `FontFace.hb_font`), so
positions arrive in font units and this module does the conversion. HarfBuzz's
own scaling rounds to 26.6 fixed point, and that error accumulates along a line
until the canvas and the PDF disagree — the failure the single-typesetting-source
architecture exists to prevent.

**Clusters are not a one-to-one map.** A Devanagari conjunct is one glyph over
three codepoints; an i-matra is drawn *before* the consonant it follows
logically. `cluster_map` records, for each glyph, the source index of the
cluster it belongs to, so a warning can name the character an editor must change.
"""

from __future__ import annotations

import unicodedata

import uharfbuzz as hb

from ..color import CMYK
from ..errors import MissingGlyphError
from ..geometry import MM_PER_PT
from .fonts import FontFace
from .schemas import Direction, GlyphRun, TextItem

__all__ = ["itemize", "shape_run"]

# UAX#24: characters with no script of their own (spaces, digits, most
# punctuation) take the script of their surroundings. HarfBuzz reports them as
# None, which is the signal to inherit rather than to start a new run.
_INHERIT = None

# Used when a string contains no strongly-scripted character at all — a line of
# digits, or of punctuation. It still has to shape.
_DEFAULT_SCRIPT = "Latn"
_DEFAULT_DIRECTION: Direction = "ltr"

# Script -> direction. HarfBuzz knows this, but only via a buffer, and asking it
# per run costs a buffer allocation for something that never changes.
_RTL_SCRIPTS = frozenset(
    {"Arab", "Hebr", "Syrc", "Thaa", "Nkoo", "Samr", "Mand", "Mend", "Adlm"}
)

# Glyph id 0 is `.notdef` — the □ box. Never allowed to reach a page.
_NOTDEF = 0

# Cc control, Zl line separator, Zp paragraph separator. No font maps these and
# none should: they are layout instructions, not glyphs. Cf (ZWJ/ZWNJ/BOM) is
# deliberately absent — HarfBuzz consumes those for shaping and then removes
# them, so they never surface as .notdef.
_CONTROL_CATEGORIES = frozenset({"Cc", "Zl", "Zp"})

_script_cache: dict[int, str | None] = {}


def _script_of(codepoint: int) -> str | None:
    """ISO 15924 script for one codepoint, or None for Common/Inherited.

    Cached: the underlying call allocates a HarfBuzz buffer, which at ~0.32 us
    would cost 4% of A10's budget over a 5000-word story. Cached it is 0.07 us.
    Script is a pure function of the codepoint, so the cache never goes stale.
    """
    cached = _script_cache.get(codepoint, _INHERIT)
    if codepoint in _script_cache:
        return cached
    buf = hb.Buffer()
    buf.add_str(chr(codepoint))
    buf.guess_segment_properties()
    script: str | None = buf.script
    _script_cache[codepoint] = script
    return script


def _direction_for(script: str) -> Direction:
    return "rtl" if script in _RTL_SCRIPTS else "ltr"


def _cluster_boundaries(clusters: tuple[int, ...]) -> list[bool]:
    """True at each glyph that is the last of its cluster."""
    return [
        i == len(clusters) - 1 or clusters[i + 1] != clusters[i]
        for i in range(len(clusters))
    ]


def run_ink_mm(
    run: GlyphRun,
    face: FontFace,
    start: int = 0,
    end: int | None = None,
) -> tuple[float, float]:
    """Positioned ink extent `(top, bottom)` of a run, or a slice of one, in mm.

    **The single implementation of the ink-collision measurement.** M1.5 builds
    `ResolvedLine.ascent_mm`/`descent_mm` from this over the glyphs that landed
    on each line, and M11's preflight rule compares it against the baseline gap.
    Writing it once means a caller cannot forget the `y_offset` term, which is
    the whole difference between a glyph's box and where its ink actually lands.

    Sign conventions meet here, so nowhere else has to think about it:
    `FontFace.glyph_ink_mm` is y-up (like `ascent_mm_at_1pt`, positive above the
    baseline), while `GlyphRun.y_offsets_mm` is y-down to match the RLD. The
    result is y-up: top positive above the baseline, bottom negative below.

    `start`/`end` index glyphs, not characters — line breaking works in glyph
    space, and a line holds a slice of a run.
    """
    stop = run.glyph_count if end is None else end
    if start >= stop:
        return 0.0, 0.0
    top = 0.0
    bottom = 0.0
    for i in range(start, stop):
        glyph_top, glyph_bottom = face.glyph_ink_mm(run.glyph_ids[i], run.size_pt)
        offset = run.y_offsets_mm[i]  # y-down; subtract to reach y-up
        top = max(top, glyph_top - offset)
        bottom = min(bottom, glyph_bottom - offset)
    return top, bottom


def _reject_uncovered(
    glyph_ids: tuple[int, ...],
    clusters: tuple[int, ...],
    text: str,
    face: FontFace,
    char_offset: int,
) -> None:
    """Raise if shaping produced `.notdef`, naming the character responsible.

    `FontFace.glyph_id` guards the direct path, but HarfBuzz does its own cmap
    lookup and happily returns glyph 0 for anything the face does not cover.
    Without this check a `中` or an emoji pasted into a Hindi story shapes to
    `.notdef` and prints as `□` — invisible to anyone who cannot read the
    script, so it reaches the page unchallenged. Spec A8, CLAUDE.md.
    """
    for gid, cluster in zip(glyph_ids, clusters, strict=True):
        if gid != _NOTDEF:
            continue
        index = cluster - char_offset
        char = text[index] if 0 <= index < len(text) else "�"
        if unicodedata.category(char) in _CONTROL_CATEGORIES:
            # Not a font problem, so not a MissingGlyphError: no face maps a
            # newline or a tab, and calling it a missing glyph would send
            # someone hunting for a font that does. These are layout
            # characters and must be resolved before shaping — M1.5 splits
            # paragraphs on "\n\n" and turns the rest into word space.
            raise ValueError(
                f"control character U+{ord(char):04X} reached shape_run; "
                f"normalise it to word space or a paragraph break first"
            )
        raise MissingGlyphError(ord(char), face.font_id, face.family)


def itemize(text: str, language: str = "") -> list[TextItem]:
    """Split `text` into runs of uniform script and direction. UAX#24.

    Direction is derived from the script. This is **not** the full UAX#9
    bidirectional algorithm: there are no embedding levels, no neutral
    resolution and no visual reordering, so European numbers inside Arabic
    are not given level 2. Sufficient for the Hindi/English editions M1
    targets; an RTL edition needs the real thing, and M3 should not build
    on a conformance claim this does not meet.

    Characters with no strong script inherit from the run in progress, so
    "सन 2026 में" is one Devanagari item rather than three. A leading run of
    such characters takes the script of the first strong character that follows,
    which keeps "  समाचार" from starting in the wrong script.

    `language` is threaded through rather than guessed: it is not derivable from
    the text, and both hyphenation (M1.4) and locale-sensitive shaping need it.
    """
    if not text:
        return []

    # Resolve every character's script, inheriting forwards — except that a
    # closing bracket takes the script its opener took, not the script of
    # whatever happens to sit in front of it (UAX#24 §5.1). Without this,
    # "News (समाचार) today" sets "(" in the Latin face and ")" in the
    # Devanagari one: a mismatched pair, and one of the few defects here that
    # is visible to a reader of neither script.
    resolved: list[str | None] = []
    current: str | None = None
    bracket_stack: list[str | None] = []
    for ch in text:
        script = _script_of(ord(ch))
        if script is _INHERIT:
            category = unicodedata.category(ch)
            if category == "Ps":  # opening bracket
                bracket_stack.append(current)
                resolved.append(current)
            elif category == "Pe" and bracket_stack:  # closing bracket
                opener = bracket_stack.pop()
                resolved.append(opener)
                current = opener
            else:
                resolved.append(current)
        else:
            current = script
            resolved.append(script)

    # A leading stretch with no script yet takes the first strong one found.
    first_strong = next((s for s in resolved if s is not None), _DEFAULT_SCRIPT)
    resolved = [s if s is not None else first_strong for s in resolved]

    items: list[TextItem] = []
    start = 0
    for i in range(1, len(resolved) + 1):
        if i == len(resolved) or resolved[i] != resolved[start]:
            script = resolved[start] or _DEFAULT_SCRIPT
            items.append(
                TextItem(
                    start=start,
                    end=i,
                    script=script,
                    direction=_direction_for(script),
                    language=language,
                )
            )
            start = i
    return items


def shape_run(
    text: str,
    face: FontFace,
    size_pt: float,
    script: str,
    language: str,
    direction: Direction,
    features: dict[str, bool] | None = None,
    tracking: float = 0.0,
    *,
    char_offset: int = 0,
    color: CMYK | None = None,
) -> GlyphRun:
    """Shape one run with HarfBuzz and return positions in millimetres.

    `tracking` is in 1/1000 em and is added once per **cluster**, on the glyph
    that closes it — not per glyph. A Devanagari aksara is several glyphs, most
    of them zero-advance marks, and tracking each would detach the marks from
    their base and overstate the run's width by 60% on a word like
    मुख्यमंत्री. The trailing unit after the final cluster is real and makes
    tracking symmetric, but must be trimmed from a line's measured width before
    justification or every justified line ends up short by one unit;
    `GlyphRun.width_mm` includes it, and the trim belongs to M1.5 where the
    line's last cluster is known.

    `char_offset` shifts `cluster_map` into the coordinates of the full source
    string, so a run shaped from a slice still names absolute character indices.
    """
    if size_pt <= 0:
        raise ValueError(f"size_pt must be positive, got {size_pt}")
    if direction == "rtl":
        # `itemize` labels RTL runs so a caller can detect them, but shaping one
        # would be a half-built feature pretending to be finished. Without
        # UAX#9, European digits inside Arabic inherit the RTL level and
        # "2026" comes out "6202"; RTL also makes cluster_map *decreasing*,
        # which every downstream consumer here assumes it is not. CLAUDE.md:
        # finish it or don't start it. M1 targets Hindi and English.
        raise NotImplementedError(
            "RTL shaping is not implemented: UAX#9 bidi is required first "
            "(European digits reorder, and cluster_map runs backwards). "
            "See itemize() — RTL runs are detected but must not be shaped."
        )

    scale = size_pt * MM_PER_PT / face.units_per_em
    track_mm = tracking / 1000.0 * size_pt * MM_PER_PT

    if not text:
        return GlyphRun(
            font_id=face.font_id,
            size_pt=size_pt,
            glyph_ids=(),
            x_advances_mm=(),
            x_offsets_mm=(),
            y_offsets_mm=(),
            cluster_map=(),
            char_start=char_offset,
            char_end=char_offset,
            **({"color": color} if color is not None else {}),
        )

    buf = hb.Buffer()
    buf.add_str(text)
    buf.script = script
    buf.direction = direction
    if language:
        buf.language = language
    # Cluster level 0: HarfBuzz merges clusters across ligatures and reordering,
    # which is what we want — a cluster is the smallest editable unit, not the
    # smallest glyph.
    buf.cluster_level = 0
    # Never synthesise a dotted circle, and drop ZWJ/ZWNJ from the output once
    # they have done their shaping work. Both would otherwise reach the page:
    # the circle as visible ink nobody asked for, the format characters as
    # phantom zero-advance glyphs that inflate every downstream glyph count.
    buf.flags = (
        hb.BufferFlags.DO_NOT_INSERT_DOTTED_CIRCLE
        | hb.BufferFlags.REMOVE_DEFAULT_IGNORABLES
    )

    hb.shape(face.hb_font, buf, features)

    infos = buf.glyph_infos
    positions = buf.glyph_positions

    glyph_ids = tuple(info.codepoint for info in infos)
    clusters = tuple(info.cluster + char_offset for info in infos)
    _reject_uncovered(glyph_ids, clusters, text, face, char_offset)

    # Tracking is letter-spacing, so it belongs between *clusters*, not between
    # glyphs. A Devanagari aksara is several glyphs — base plus zero-advance
    # matras and marks — and adding a tracking unit to each would both detach
    # the marks from their base and overstate the run's width (measured: 60%
    # over on मुख्यमंत्री). Add it once, on the glyph that closes each cluster.
    advances = tuple(
        pos.x_advance * scale + (track_mm if closes_cluster else 0.0)
        for pos, closes_cluster in zip(
            positions, _cluster_boundaries(clusters), strict=True
        )
    )
    x_offsets = tuple(pos.x_offset * scale for pos in positions)
    # HarfBuzz y is up; the RLD's y is down (§2.4, `pdf_y = page_h_mm - rld_y`).
    # Negate here, at the one boundary where the convention changes, so no
    # renderer downstream has to guess the sign of a mark's placement.
    y_offsets = tuple(-pos.y_offset * scale for pos in positions)

    return GlyphRun(
        font_id=face.font_id,
        size_pt=size_pt,
        glyph_ids=glyph_ids,
        x_advances_mm=advances,
        x_offsets_mm=x_offsets,
        y_offsets_mm=y_offsets,
        cluster_map=clusters,
        char_start=char_offset,
        char_end=char_offset + len(text),
        **({"color": color} if color is not None else {}),
    )
