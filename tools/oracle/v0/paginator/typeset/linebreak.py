"""Line breaking — M1.3, spec §M1.3.

`build_nodes` turns shaped runs into the classical box/glue/penalty stream;
`break_lines` chooses where the lines end. `measures_mm` is a list — one entry
per line — so ragged frames and text wrapping around an image need no second
algorithm.

**The fallback is the normal path, not an exception.** Measured over 62
realistic ~80-word paragraphs at the §M2/B1 broadsheet column of 30.25 mm,
10/12 pt, Knuth–Plass finds a feasible break set for **0 of 62** English
paragraphs and 1 of 62 Devanagari ones. A 30 mm column holds three words;
justifying it means stretching two word spaces nearly fourfold, which no
tolerance permits — raising tolerance to 10 rescues 2 of 62. Hyphenation (M1.4)
is the precondition for justified English at newspaper measures, not an
improvement to it. `LineBreakResult.used_fallback` is therefore counted rather
than inferred, and M1.4 is measured by that count dropping.

Two rules inherited from earlier sub-sessions:

- **Boxes never begin or end mid-cluster.** M1.2 measured that slicing
  `क्षत्रिय` at glyph 2 decomposes the ksha conjunct into base + virama.
- **Measures constrain advance width, not ink.** Justification arithmetic works
  in advances. Ink that overhangs the line edge is recorded on the breakpoint
  for M11 rather than silently absorbed.

  An earlier version of this note claimed 0.72 mm of line-initial overhang.
  That is ी (U+0940), whose −204 unit bearing draws it back over its own base —
  it is a *post-base* matra and can never start a line. Measured over real
  Hindi at 30.25 mm, the worst overhang at the edges greedy actually chose is
  **0.141 mm left** (ि U+093F, the one pre-base matra) and 0.254 mm right:
  together under 10% of a 4 mm gutter, and smaller than Latin `j` at 0.293 mm.
  So `ink_overhang_mm` is a stub today and that is a defensible deferral, not a
  hidden risk.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .fonts import FontFace
from .schemas import (
    ADJ_DEMERITS,
    DEFAULT_LINE_PENALTY,
    FLAGGED_DEMERITS,
    INF_PENALTY,
    Box,
    Breakpoint,
    Glue,
    GlyphRun,
    HyphenPoint,
    LineBreakResult,
    Node,
    Penalty,
    TextStyle,
)

__all__ = ["break_greedy", "break_knuth_plass", "break_lines", "build_nodes"]

# The final glue's stretch. Large enough that the last line of a paragraph can
# be any length; finite so arithmetic stays well behaved.
_INFINITE_STRETCH_MM = 1.0e6

# Fitness classes for the adjacent-tightness demerit, per Knuth-Plass.
_FITNESS_BOUNDS = (-0.5, 0.5, 1.0)


def _fitness(ratio: float) -> int:
    if ratio < _FITNESS_BOUNDS[0]:
        return 0  # tight
    if ratio <= _FITNESS_BOUNDS[1]:
        return 1  # decent
    if ratio <= _FITNESS_BOUNDS[2]:
        return 2  # loose
    return 3  # very loose


def _measure_at(measures_mm: Sequence[float], line: int) -> float:
    """Measure for `line`, reusing the last when the list runs out.

    A plain frame supplies one measure; a frame wrapping an image supplies
    several. Running past the end must reuse the final value, not raise — the
    caller cannot know the line count in advance, which is the whole reason
    this is a list.
    """
    if not measures_mm:
        raise ValueError("measures_mm must not be empty")
    return measures_mm[min(line, len(measures_mm) - 1)]


def build_nodes(
    runs: Sequence[GlyphRun],
    text: str,
    style: TextStyle,
    hyphen_points: Sequence[HyphenPoint] = (),
    face: FontFace | None = None,
) -> list[Node]:
    """Turn shaped runs into a box/glue/penalty stream.

    `hyphen_points` are character offsets into `text` at which a break inside a
    word is permitted; M1.4 supplies them and M1.3 leaves the hook inert. Each
    becomes a flagged `Penalty` whose width is the hyphen's advance, or zero
    when the point does not insert a glyph.

    `face` is needed only to measure a hyphen; without hyphen points it is
    unused, which is why it is optional.
    """
    for run in runs:
        if run.char_end > len(text):
            # A caller passing a run's slice instead of the whole paragraph
            # would make every cluster index fall outside `text`, so no space
            # would ever be found, so the paragraph would become one enormous
            # box with no breaks — and nothing would raise.
            raise ValueError(
                f"text is {len(text)} characters but a run declares "
                f"char_end={run.char_end}; build_nodes needs the whole paragraph"
            )

    nodes: list[Node] = []
    hyphen_by_offset = {hp.offset: hp for hp in hyphen_points}
    hyphen_width = _hyphen_width_mm(face, style) if hyphen_points else 0.0
    consumed: set[int] = set()

    for run_index, run in enumerate(runs):
        nodes.extend(
            _nodes_for_run(
                run, run_index, text, style, hyphen_by_offset, hyphen_width,
                consumed,
            )
        )

    unused = sorted(set(hyphen_by_offset) - consumed)
    if unused:
        # Silently dropping these is how M1.4's hyphenation would appear to do
        # nothing: an offset that is not a cluster start matches no glyph and
        # produces no penalty. Measured on Devanagari, 20 of 33 offsets vanished
        # this way. Failing loudly turns a mysterious "hyphenation had no
        # effect" into a pointed error.
        raise ValueError(
            f"hyphen points at {unused} do not fall on cluster boundaries and "
            f"would be silently ignored; offsets are paragraph-absolute "
            f"character indices, not word-relative"
        )

    # Spec §M1.3 amendment 1. Without this glue the last line cannot be shorter
    # than the measure, so no active node ever reaches the forced break and
    # every paragraph reports infeasible.
    nodes.append(Glue(width_mm=0.0, stretch_mm=_INFINITE_STRETCH_MM, shrink_mm=0.0))
    nodes.append(Penalty(width_mm=0.0, cost=-INF_PENALTY, flagged=False))
    return nodes


def _hyphen_width_mm(face: FontFace | None, style: TextStyle) -> float:
    """Advance of the hyphen that a flagged break will draw.

    `MissingGlyphError` is deliberately NOT caught. Swallowing it would return
    a zero-width hyphen, understating every hyphenated line and drawing nothing
    where a hyphen belongs — CLAUDE.md's "missing glyphs raise, never render",
    and exactly the silent-wrong-value class the invariants exist to stop. A
    face used for hyphenated text must have a hyphen.
    """
    if face is None:
        return 0.0
    return face.advance_mm(face.glyph_id(ord("-")), style.size_pt)


def _nodes_for_run(
    run: GlyphRun,
    run_index: int,
    text: str,
    style: TextStyle,
    hyphen_by_offset: dict[int, HyphenPoint],
    hyphen_width: float,
    consumed: set[int],
) -> list[Node]:
    nodes: list[Node] = []
    clusters = run.cluster_map
    advances = run.x_advances_mm
    extents = _cluster_extents(run, text)
    start = 0
    width = 0.0

    def flush(end: int) -> None:
        nonlocal start, width
        if end > start:
            nodes.append(
                Box(
                    width_mm=width,
                    glyph_range=(start, end),
                    run_index=run_index,
                )
            )
        start = end
        width = 0.0

    for i in range(run.glyph_count):
        cluster = clusters[i]
        if _is_space(text, cluster, extents.get(cluster, cluster + 1)):
            flush(i)
            space_w = advances[i]
            nodes.append(
                Glue(
                    width_mm=space_w,
                    stretch_mm=space_w * (style.word_space_max - 1.0),
                    shrink_mm=space_w * (1.0 - style.word_space_min),
                )
            )
            start = i + 1
            continue

        # Hyphen points fall between clusters, never inside one.
        hp = hyphen_by_offset.get(cluster)
        if hp is not None and i > start and cluster != clusters[i - 1]:
            consumed.add(cluster)
            flush(i)
            nodes.append(
                Penalty(
                    width_mm=hyphen_width if hp.inserts_glyph else 0.0,
                    cost=DEFAULT_LINE_PENALTY * 5,
                    flagged=True,
                    inserts_glyph=hp.inserts_glyph,
                )
            )
            start = i

        width += advances[i]

    flush(run.glyph_count)
    return nodes


def _cluster_extents(run: GlyphRun, text: str) -> dict[int, int]:
    """Map each cluster's start index to its end (exclusive) in the source."""
    starts = sorted(set(run.cluster_map))
    end = min(run.char_end, len(text))
    extents: dict[int, int] = {}
    for i, start in enumerate(starts):
        extents[start] = starts[i + 1] if i + 1 < len(starts) else end
    return extents


def _is_space(text: str, start: int, end: int) -> bool:
    """True when this cluster is exactly one inter-word space.

    Read from the source rather than from the glyph, deliberately: identifying
    a space by glyph id would need a per-font lookup, and HarfBuzz maps several
    things to the space glyph.

    The *exactly* matters, and cost an INVARIANT 1 violation to learn. HarfBuzz
    merges a combining mark that follows a space into the space's cluster, so
    both glyphs report the space's source index. Testing only
    `text[start] == " "` classified the mark as word space too: it became Glue,
    landed in no Box, and was silently deleted from the line — measured on
    "राम िगया", where the i-matra vanished and was replaced by 0.868 mm of
    stretchable space. A Devanagari reader sees a different word; nobody else
    sees anything. Requiring the cluster's source to be exactly `" "` keeps such
    a cluster as box material, so malformed input renders as it shaped instead
    of losing a character.
    """
    return 0 <= start < end <= len(text) and text[start:end] == " "


# ---------------------------------------------------------------------------
# Greedy first-fit
# ---------------------------------------------------------------------------


def break_greedy(
    nodes: Sequence[Node],
    measures_mm: Sequence[float],
    style: TextStyle,
) -> LineBreakResult:
    """First-fit: break at the last glue that still fits.

    Always produces an answer, which is what makes it the fallback. It does not
    optimise, and no test should assert its output is *good* typography — only
    that it is stable.
    """
    breakpoints: list[Breakpoint] = []
    line = 0
    width = 0.0
    stretch = 0.0
    shrink = 0.0
    last_glue: int | None = None
    last_at_glue = (0.0, 0.0, 0.0)

    def emit(index: int, natural: float, st: float, sh: float) -> None:
        nonlocal line
        measure = _measure_at(measures_mm, line)
        breakpoints.append(
            Breakpoint(
                node_index=index,
                line=line,
                measure_mm=measure,
                natural_width_mm=natural,
                adjustment_ratio=_ratio(natural, measure, st, sh),
                is_hyphenated=_is_flagged(nodes[index]),
            )
        )
        line += 1

    # Scanning restarts from just after each break rather than carrying a
    # recomputed running total forward. The earlier version skipped the node
    # that triggered the break, so if that node was itself a legal breakpoint it
    # was lost — measured 23 overflowing lines in 60 trials, e.g. two boxes
    # totalling 37.12mm in a 30.25mm measure with a legal break between them.
    # Each node is visited at most twice, so this stays linear in practice.
    line_start = 0
    i = 0
    while i < len(nodes):
        node = nodes[i]

        if isinstance(node, Penalty) and node.is_forced:
            # A forced penalty ends a LINE, not the node stream. `compose()`
            # emits one per paragraph break (M1.5) and M7 adds a user-facing
            # forced line break, so a stream routinely holds several. Stopping
            # at the first silently dropped everything after it — measured, 7
            # of 14 nodes.
            if width > 0.0 or not breakpoints:
                emit(i, width, stretch, shrink)
            i += 1
            line_start = i
            width = stretch = shrink = 0.0
            last_glue = None
            continue

        measure = _measure_at(measures_mm, line)

        # Only material that would actually SIT on the line can overflow it.
        # Glue at a break is discarded, so a trailing space must not count
        # against the measure — testing it here broke one word early on 6.9% of
        # real lines: "the representatives" measures 30.000mm and fits a
        # 30.25mm column, but the following space pushed the total to 30.822mm
        # and greedy emitted "the" alone.
        overflows = not isinstance(node, Glue) and width + node.width_mm > measure

        if overflows and last_glue is not None:
            natural, st, sh = last_at_glue
            emit(last_glue, natural, st, sh)
            i = last_glue + 1
            line_start = i
            width = stretch = shrink = 0.0
            last_glue = None
            continue

        if isinstance(node, Glue):
            # Glue is only a breakpoint when it follows material on this line.
            if i > line_start and isinstance(nodes[i - 1], Box):
                last_glue = i
                last_at_glue = (width, stretch, shrink)
            width += node.width_mm
            stretch += node.stretch_mm
            shrink += node.shrink_mm
        elif isinstance(node, Box):
            width += node.width_mm
        i += 1

    return LineBreakResult(breakpoints=tuple(breakpoints), algorithm="greedy")


def _is_flagged(node: Node) -> bool:
    return isinstance(node, Penalty) and node.flagged


def _ratio(natural: float, measure: float, stretch: float, shrink: float) -> float:
    """Adjustment ratio, clamped at -1.

    Clamped rather than allowed to go below: `Breakpoint` rejects anything under
    -1 as un-shrinkable, and greedy's whole job is to always return something.
    A line that overflows is reported at exactly -1 with its true natural width,
    so the overflow is visible without inventing a ratio the schema forbids.

    A short line with no stretch reports `INF_PENALTY`, not 0.0. Returning 0.0
    made a 5.066mm line in a 30.25mm column indistinguishable from one that
    filled the measure exactly — and §M1.5 step 7 (loose/tight warnings) and A4
    (justified width within 0.01mm) both read this number. "Cannot be stretched
    to fit" is a different fact from "fits perfectly" and must not share a
    value.
    """
    if natural < measure:
        return (measure - natural) / stretch if stretch > 0 else float(INF_PENALTY)
    if natural > measure:
        if shrink <= 0:
            return -1.0
        return max(-1.0, (measure - natural) / shrink)
    return 0.0


# ---------------------------------------------------------------------------
# Knuth–Plass
# ---------------------------------------------------------------------------


@dataclass
class _Active:
    """A candidate break, and the totals a line starting after it inherits.

    Two width totals, not one, because the glue we break at belongs to neither
    line. `total_width` is measured AFTER it — where the next line starts.
    `line_end_width` is measured BEFORE it — where this line ends. Collapsing
    them into one field made every Knuth-Plass line report exactly one word
    space too wide (measured +0.8220 mm against greedy on the same node stream,
    2.7% of a 30.25 mm column), and M1.5 justifies from that number.
    """

    node_index: int
    line: int
    fitness: int
    total_width: float
    total_stretch: float
    total_shrink: float
    demerits: float
    previous: _Active | None
    ratio: float = 0.0
    line_end_width: float = 0.0


def break_knuth_plass(
    nodes: Sequence[Node],
    measures_mm: Sequence[float],
    style: TextStyle,
) -> LineBreakResult | None:
    """Optimal breaking by total demerits. Returns None when nothing is feasible.

    Returning None rather than raising or silently degrading is what lets
    `break_lines` count the fallback — see the module docstring for why that
    count matters.
    """
    active: list[_Active] = [_Active(0, 0, 1, 0.0, 0.0, 0.0, 0.0, None)]
    best_final: _Active | None = None
    width = stretch = shrink = 0.0

    for i, node in enumerate(nodes):
        if _is_legal_break(nodes, i, node) and active:
            best_final, active = _consider_break(
                nodes, i, node, active, best_final,
                (width, stretch, shrink), measures_mm, style,
            )
            if not active and best_final is None:
                return None

        if isinstance(node, Box):
            width += node.width_mm
        elif isinstance(node, Glue):
            width += node.width_mm
            stretch += node.stretch_mm
            shrink += node.shrink_mm

    if best_final is None:
        return None
    return LineBreakResult(
        breakpoints=_unwind(best_final, nodes, measures_mm),
        algorithm="knuth_plass",
    )


def _is_legal_break(nodes: Sequence[Node], i: int, node: Node) -> bool:
    if isinstance(node, Glue):
        return i > 0 and isinstance(nodes[i - 1], Box)
    if isinstance(node, Penalty):
        return not node.is_forbidden
    return False


def _consider_break(
    nodes: Sequence[Node],
    i: int,
    node: Node,
    active: list[_Active],
    best_final: _Active | None,
    totals: tuple[float, float, float],
    measures_mm: Sequence[float],
    style: TextStyle,
) -> tuple[_Active | None, list[_Active]]:
    width, stretch, shrink = totals
    forced = isinstance(node, Penalty) and node.is_forced
    candidates: dict[int, tuple[float, _Active, float]] = {}
    survivors: list[_Active] = []

    for a in active:
        measure = _measure_at(measures_mm, a.line)
        line_width = width - a.total_width
        if isinstance(node, Penalty):
            line_width += node.width_mm
        line_stretch = stretch - a.total_stretch
        line_shrink = shrink - a.total_shrink
        ratio = _raw_ratio(line_width, measure, line_stretch, line_shrink)

        # An active node stays alive only while a later break could still fit.
        if ratio >= -1.0 and not forced:
            survivors.append(a)

        if ratio < -1.0 or ratio > style.tolerance:
            continue

        demerits = (DEFAULT_LINE_PENALTY + 100.0 * abs(ratio) ** 3) ** 2
        if isinstance(node, Penalty) and node.cost > 0:
            demerits += float(node.cost) ** 2
        fitness = _fitness(ratio)
        if abs(fitness - a.fitness) > 1:
            demerits += ADJ_DEMERITS
        if (
            isinstance(node, Penalty)
            and node.flagged
            and _is_flagged(nodes[a.node_index])
        ):
            demerits += FLAGGED_DEMERITS
        demerits += a.demerits

        best = candidates.get(fitness)
        if best is None or demerits < best[0]:
            candidates[fitness] = (demerits, a, ratio)

    # Totals carried forward must EXCLUDE the glue we broke at: the next line
    # starts after it, and TeX discards glue at a break. Recording the totals
    # from before the glue made every Knuth-Plass line report exactly one word
    # space too wide — measured +0.8220 mm against greedy on the same node
    # stream, which is 2.7% of a 30.25 mm broadsheet column. M1.5 justifies from
    # `natural_width_mm`, so those lines would have been set short of the right
    # margin. Two algorithms disagreeing about one line is the very failure the
    # single-engine principle exists to prevent.
    if isinstance(node, Glue):
        carry = (width + node.width_mm,
                 stretch + node.stretch_mm,
                 shrink + node.shrink_mm)
    else:
        carry = (width, stretch, shrink)

    if forced:
        # A forced penalty ends a line and the stream continues past it. Every
        # active dies — nothing may span a mandatory break — and the cheapest
        # candidate becomes the sole continuation. Treating it as the end of
        # the paragraph made a two-paragraph stream infeasible outright, which
        # would have reported `used_fallback=True` for perfectly valid input
        # and corrupted the metric M1.4 is measured by.
        if not candidates:
            return best_final, []
        demerits, previous, ratio = min(candidates.values(), key=lambda c: c[0])
        node_break = _Active(
            i, previous.line + 1, _fitness(ratio), carry[0], carry[1], carry[2],
            demerits, previous, ratio, line_end_width=width,
        )
        # The last forced break reached is the end of the stream, because
        # `build_nodes` always terminates with one.
        return node_break, [node_break]

    for fitness, (demerits, previous, ratio) in candidates.items():
        survivors.append(
            _Active(
                i, previous.line + 1, fitness, carry[0], carry[1], carry[2],
                demerits, previous, ratio, line_end_width=width,
            )
        )

    return best_final, survivors


def _raw_ratio(
    natural: float, measure: float, stretch: float, shrink: float
) -> float:
    """Unclamped, so KP can see and reject an impossible line."""
    if natural < measure:
        return (measure - natural) / stretch if stretch > 0 else float(INF_PENALTY)
    if natural > measure:
        return (measure - natural) / shrink if shrink > 0 else -float(INF_PENALTY)
    return 0.0


def _unwind(
    final: _Active, nodes: Sequence[Node], measures_mm: Sequence[float]
) -> tuple[Breakpoint, ...]:
    chain: list[_Active] = []
    cursor: _Active | None = final
    while cursor is not None and cursor.previous is not None:
        chain.append(cursor)
        cursor = cursor.previous
    chain.reverse()

    out: list[Breakpoint] = []
    for line, a in enumerate(chain):
        measure = _measure_at(measures_mm, line)
        out.append(
            Breakpoint(
                node_index=a.node_index,
                line=line,
                measure_mm=measure,
                natural_width_mm=max(
                    0.0,
                    a.line_end_width
                    - (a.previous.total_width if a.previous else 0.0),
                ),
                adjustment_ratio=max(-1.0, a.ratio),
                is_hyphenated=_is_flagged(nodes[a.node_index]),
            )
        )
    return tuple(out)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def break_lines(
    nodes: Sequence[Node],
    measures_mm: Sequence[float],
    style: TextStyle,
) -> LineBreakResult:
    """Break according to `style.algorithm`, falling back to greedy. Never raises.

    The returned `algorithm` names what actually ran, not what was asked for —
    a result that claimed "knuth_plass" while holding greedy's breakpoints would
    make the fallback count meaningless.
    """
    if style.algorithm == "knuth_plass":
        result = break_knuth_plass(nodes, measures_mm, style)
        if result is not None:
            return result
        fallback = break_greedy(nodes, measures_mm, style)
        return fallback.model_copy(
            update={
                "used_fallback": True,
                "fallback_reason": (
                    "no feasible Knuth-Plass break set at tolerance "
                    f"{style.tolerance}"
                ),
            }
        )
    return break_greedy(nodes, measures_mm, style)
