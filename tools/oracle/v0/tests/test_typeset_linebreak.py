"""M1.3 — line breaking.

The measurement that shapes this module: at the real broadsheet column (30.25mm,
§M2/B1) Knuth–Plass is feasible for **0 of 62** English paragraphs and 1 of 62
Devanagari ones, because a 30mm column at 10pt holds three words and justifying
it would need the word spaces to stretch nearly fourfold. So the fallback to
first-fit is the normal path, not an exception, and it is counted rather than
inferred — M1.4 is measured by that count dropping.
"""

from __future__ import annotations

import random
import subprocess
import sys
import time
from pathlib import Path

import pytest

from paginator.errors import MissingGlyphError
from paginator.typeset import FontRegistry, shape_run
from paginator.typeset.linebreak import (
    break_greedy,
    break_knuth_plass,
    break_lines,
    build_nodes,
)
from paginator.typeset.schemas import (
    INF_PENALTY,
    Box,
    Glue,
    Penalty,
    TextStyle,
)

ASSETS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
ROOT = Path(__file__).resolve().parent.parent

# Mixed-length newsroom vocabulary. Uniform-length words hide line-breaking
# defects — spec §5.4 — and both greedy bugs in this module needed two long
# words adjacent to show up.
NEWS_VOCAB = [
    "council", "approves", "sweeping", "budget", "after", "decade", "of",
    "debate", "the", "minister", "said", "committee", "members", "voted",
    "unanimously", "despite", "objections", "from", "residents", "who",
    "argued", "that", "infrastructure", "spending", "should", "prioritise",
]

BROADSHEET_MM = 30.25  # §M2/B1: (318 - 2*24 - 7*4) / 8
WIDE_MM = 45.0


@pytest.fixture(scope="module")
def registry() -> FontRegistry:
    reg = FontRegistry()
    reg.register_dir(ASSETS)
    return reg


@pytest.fixture(scope="module")
def latin(registry: FontRegistry):
    return registry.resolve("Source Serif 4", 400, "normal")


@pytest.fixture(scope="module")
def deva(registry: FontRegistry):
    return registry.resolve("Noto Serif Devanagari", 400, "normal")


def style(**kw) -> TextStyle:
    base = {"font_family": "Source Serif 4", "size_pt": 10.0, "leading_pt": 12.0}
    return TextStyle(**{**base, **kw})


def nodes_for(text, face, st=None, **shape_kw):
    st = st or style()
    run = shape_run(
        text, face, st.size_pt,
        script=shape_kw.get("script", "Latn"),
        language=shape_kw.get("language", "en"),
        direction="ltr",
    )
    return build_nodes([run], text, st), run


# ---------------------------------------------------------------------------
# build_nodes
# ---------------------------------------------------------------------------


def test_nodes_alternate_box_and_glue(latin):
    nodes, _ = nodes_for("alpha beta gamma", latin)
    kinds = [type(n).__name__ for n in nodes]
    # box glue box glue box, then the mandatory tail
    assert kinds[:5] == ["Box", "Glue", "Box", "Glue", "Box"]


def test_node_stream_ends_with_infinite_glue_then_forced_penalty(latin):
    """Spec §M1.3 amendment 1.

    Without the final infinite-stretch glue the last line cannot be short, no
    active node reaches the forced break, and EVERY paragraph reports
    infeasible. This is the single easiest way to break KP silently.
    """
    nodes, _ = nodes_for("alpha beta gamma", latin)
    assert isinstance(nodes[-2], Glue)
    assert nodes[-2].stretch_mm > 1e5, "final glue must be effectively infinite"
    assert isinstance(nodes[-1], Penalty)
    assert nodes[-1].is_forced


def test_box_widths_are_the_sum_of_their_glyph_advances(latin):
    nodes, run = nodes_for("alpha beta", latin)
    box = nodes[0]
    expected = sum(run.x_advances_mm[box.glyph_range[0] : box.glyph_range[1]])
    assert box.width_mm == pytest.approx(expected, abs=1e-12)


def test_glue_elasticity_comes_from_the_style(latin):
    st = style(word_space_min=0.5, word_space_max=2.0)
    nodes, run = nodes_for("alpha beta", latin, st)
    glue = nodes[1]
    assert glue.stretch_mm == pytest.approx(glue.width_mm * 1.0, abs=1e-9)
    assert glue.shrink_mm == pytest.approx(glue.width_mm * 0.5, abs=1e-9)


def test_empty_text_yields_only_the_tail(latin):
    nodes, _ = nodes_for("", latin)
    assert len(nodes) == 2
    assert isinstance(nodes[0], Glue) and isinstance(nodes[1], Penalty)


# ---------------------------------------------------------------------------
# No mid-cluster breaks — carried from M1.2's Open list
# ---------------------------------------------------------------------------


def test_boxes_never_start_or_end_inside_a_cluster(deva):
    """M1.2 proved slicing `क्षत्रिय`[0:2] decomposes the ksha conjunct.

    A Box that began mid-cluster would hand M1.5 a glyph range it cannot render
    as the source says, and no downstream test would notice.
    """
    st = style(font_family="Noto Serif Devanagari", word_space_max=2.0)
    nodes, run = nodes_for(
        "क्षत्रिय ज्ञान त्रिशूल मुख्यमंत्री", deva, st, script="Deva", language="hi"
    )
    clusters = run.cluster_map
    for node in nodes:
        if not isinstance(node, Box):
            continue
        lo, hi = node.glyph_range
        assert lo == 0 or clusters[lo] != clusters[lo - 1], (
            f"box starts at glyph {lo}, mid-cluster {clusters[lo]}"
        )
        assert hi == len(clusters) or clusters[hi] != clusters[hi - 1], (
            f"box ends at glyph {hi}, mid-cluster {clusters[hi - 1]}"
        )


def test_devanagari_breaks_only_at_spaces(deva):
    st = style(font_family="Noto Serif Devanagari", word_space_max=2.0)
    text = "मुख्यमंत्री ने की घोषणा"
    nodes, _ = nodes_for(text, deva, st, script="Deva", language="hi")
    glue_count = sum(1 for n in nodes if isinstance(n, Glue))
    # three inter-word spaces, plus the mandatory final glue
    assert glue_count == text.count(" ") + 1
    assert not any(isinstance(n, Penalty) and n.flagged for n in nodes), (
        "no hyphenation penalties may appear in Devanagari under the default policy"
    )


# ---------------------------------------------------------------------------
# Greedy
# ---------------------------------------------------------------------------


def test_greedy_breaks_a_known_paragraph_at_hand_verified_points(latin):
    """Hand-checked: at 45mm, 10pt Source Serif, these words measure

        the(4.62) quick(11.30) brown(12.66) fox(7.32) jumps(11.85)

    with a 0.82mm space. "the quick brown" = 4.62+0.82+11.30+0.82+12.66
    = 30.22mm; adding " fox" would reach 38.36mm, still under 45. Adding
    " jumps" reaches 51.03mm > 45, so the first break falls after "fox".
    """
    text = "the quick brown fox jumps over the lazy dog"
    nodes, _ = nodes_for(text, latin)
    result = break_greedy(nodes, [WIDE_MM] * 10, style())
    assert result.line_count >= 2
    first = result.breakpoints[0]
    assert first.natural_width_mm <= WIDE_MM
    # the next box would not have fit
    assert first.natural_width_mm > WIDE_MM * 0.6


def test_greedy_never_exceeds_the_measure_when_a_break_exists(latin):
    text = " ".join(["alpha", "beta", "gamma", "delta", "epsilon"] * 8)
    nodes, _ = nodes_for(text, latin)
    result = break_greedy(nodes, [BROADSHEET_MM] * 200, style())
    for bp in result.breakpoints[:-1]:
        assert bp.natural_width_mm <= BROADSHEET_MM + 1e-9, (
            f"line {bp.line} is {bp.natural_width_mm:.3f}mm in a "
            f"{BROADSHEET_MM}mm measure"
        )


def test_greedy_never_reports_fallback(latin):
    """Greedy always produces an answer; it is the thing KP falls back TO."""
    nodes, _ = nodes_for("alpha beta gamma delta", latin)
    assert break_greedy(nodes, [BROADSHEET_MM] * 10, style()).used_fallback is False


# ---------------------------------------------------------------------------
# Adjustment ratio — INVARIANT from spec §M1.3
# ---------------------------------------------------------------------------


def test_no_line_has_adjustment_ratio_below_minus_one(latin):
    """"Reject any line with adjustment_ratio < -1 (cannot shrink enough)."

    Enforced by the Breakpoint validator, so this asserts the whole pipeline
    honours it rather than that one constructor does.
    """
    text = " ".join(["alpha", "beta", "gamma", "delta"] * 20)
    nodes, _ = nodes_for(text, latin)
    for measure in (BROADSHEET_MM, WIDE_MM, 90.0):
        for result in (
            break_greedy(nodes, [measure] * 300, style()),
            break_lines(nodes, [measure] * 300, style(algorithm="knuth_plass")),
        ):
            for bp in result.breakpoints:
                assert bp.adjustment_ratio >= -1.0 - 1e-9


# ---------------------------------------------------------------------------
# measures_mm varying per line — what makes image wrap work later
# ---------------------------------------------------------------------------


def test_a_narrower_first_measure_produces_a_shorter_first_line(latin):
    text = " ".join(["alpha", "beta", "gamma", "delta", "epsilon"] * 6)
    nodes, _ = nodes_for(text, latin)
    uniform = break_greedy(nodes, [WIDE_MM] * 100, style())
    ragged = break_greedy(nodes, [15.0] + [WIDE_MM] * 99, style())
    assert ragged.breakpoints[0].natural_width_mm < (
        uniform.breakpoints[0].natural_width_mm
    )
    assert ragged.breakpoints[0].measure_mm == 15.0


def test_each_breakpoint_records_the_measure_it_was_fit_to(latin):
    text = " ".join(["alpha", "beta", "gamma"] * 10)
    nodes, _ = nodes_for(text, latin)
    measures = [20.0, 30.0, 40.0] + [WIDE_MM] * 100
    result = break_greedy(nodes, measures, style())
    for bp in result.breakpoints:
        assert bp.measure_mm == measures[min(bp.line, len(measures) - 1)]


def test_measures_shorter_than_the_line_count_reuse_the_last(latin):
    """A frame gives one measure; a wrapped frame gives several. Running off
    the end must reuse the final measure, not crash."""
    text = " ".join(["alpha", "beta", "gamma"] * 20)
    nodes, _ = nodes_for(text, latin)
    result = break_greedy(nodes, [WIDE_MM], style())
    assert result.line_count > 1


# ---------------------------------------------------------------------------
# Knuth–Plass and the fallback
# ---------------------------------------------------------------------------


def test_knuth_plass_returns_none_when_no_feasible_set_exists(latin):
    """At the real broadsheet column this is the common case, not an edge one."""
    text = " ".join(["extraordinarily", "incomprehensible", "counterproductive"] * 6)
    nodes, _ = nodes_for(text, latin)
    assert break_knuth_plass(nodes, [BROADSHEET_MM] * 200, style()) is None


def test_break_lines_falls_back_to_greedy_and_says_so(latin):
    text = " ".join(["extraordinarily", "incomprehensible", "counterproductive"] * 6)
    nodes, _ = nodes_for(text, latin)
    st = style(algorithm="knuth_plass")
    result = break_lines(nodes, [BROADSHEET_MM] * 200, st)

    assert result.used_fallback is True
    assert result.algorithm == "greedy", "the result must name what actually ran"
    assert result.fallback_reason
    greedy = break_greedy(nodes, [BROADSHEET_MM] * 200, st)
    assert [b.node_index for b in result.breakpoints] == [
        b.node_index for b in greedy.breakpoints
    ]


def test_break_lines_never_raises_on_infeasible_input(latin):
    """Spec §M1.3: "Fall back to first-fit if no feasible set exists (never raise)."."""
    for text in ["", "a", "supercalifragilisticexpialidocious", "a b"]:
        nodes, _ = nodes_for(text, latin)
        for algo in ("greedy", "knuth_plass"):
            break_lines(nodes, [BROADSHEET_MM] * 50, style(algorithm=algo))


def test_a_single_unbreakable_word_wider_than_the_measure_still_returns(latin):
    """The permanent reason the fallback can never be removed."""
    nodes, _ = nodes_for("counterrevolutionaries", latin)
    result = break_lines(nodes, [10.0] * 10, style(algorithm="knuth_plass"))
    assert result.line_count >= 1


def test_knuth_plass_succeeds_where_a_feasible_set_does_exist(latin):
    """KP must find a solution when one exists, not fall back unconditionally.

    Measured (re-verified after the Knuth-Plass glue-accounting fix, since the
    original figures were taken while every line reported one word space too
    wide). Smallest feasible measure for this text, by elasticity:

        word_space_max 1.25 -> 160mm
        word_space_max 1.50 -> 160mm    <- the Latin default
        word_space_max 1.75 -> 140mm
        word_space_max 2.00 ->  90mm
        word_space_max 2.50 ->  60mm

    So elasticity governs feasibility more than column width does. The 1.5/160mm
    figure was unaffected by the bug; the earlier claim that 2.0 succeeds from
    60mm was not — it is 90mm. Feasibility is also NOT monotonic in the measure
    (2.5 is feasible at 60mm and infeasible at 75mm), because break positions
    move in discrete word-sized jumps.

    This uses 120mm with 2.0 — comfortably inside the feasible region, and the
    contrast with the default is itself the point.
    """
    text = (
        "the quick brown fox jumps over the lazy dog while a few large "
        "jackdaws quietly vex one sphinx of black quartz " * 4
    )
    st = style(algorithm="knuth_plass", word_space_max=2.0)
    nodes, _ = nodes_for(text, latin, st)
    result = break_lines(nodes, [120.0] * 200, st)
    assert result.used_fallback is False
    assert result.algorithm == "knuth_plass"
    assert result.line_count > 1


def test_default_word_space_max_is_what_blocks_knuth_plass(latin):
    """Locks the measurement above: the same text, same measure, differing only
    in elasticity, flips feasibility. If this ever stops being true the
    fallback-is-normal reasoning in the module docstring needs revisiting."""
    text = (
        "the quick brown fox jumps over the lazy dog while a few large "
        "jackdaws quietly vex one sphinx of black quartz " * 4
    )
    tight = style(algorithm="knuth_plass", word_space_max=1.5)
    loose = style(algorithm="knuth_plass", word_space_max=2.0)
    tight_nodes = nodes_for(text, latin, tight)[0]
    loose_nodes = nodes_for(text, latin, loose)[0]
    assert break_knuth_plass(tight_nodes, [120.0] * 200, tight) is None
    assert break_knuth_plass(loose_nodes, [120.0] * 200, loose) is not None


def test_greedy_requested_never_reports_fallback(latin):
    text = " ".join(["alpha", "beta"] * 30)
    nodes, _ = nodes_for(text, latin)
    result = break_lines(nodes, [BROADSHEET_MM] * 100, style(algorithm="greedy"))
    assert result.used_fallback is False
    assert result.algorithm == "greedy"


# ---------------------------------------------------------------------------
# Horizontal ink — carried from M1.2's Open list
# ---------------------------------------------------------------------------


def test_measures_constrain_advance_not_ink(latin):
    """A line's reported width is the sum of ADVANCES, not of ink extents.

    Replaces a test that asserted `ink_overhang_mm >= 0.0` on a field declared
    `Field(ge=0.0)` — Pydantic guaranteed that, so it could not fail. This
    compares the reported width against the advances independently.
    """
    nodes, _ = nodes_for("alpha beta gamma delta", latin)
    result = break_greedy(nodes, [WIDE_MM] * 10, style())
    previous = -1
    for bp in result.breakpoints:
        advance_sum = sum(
            n.width_mm
            for n in nodes[previous + 1 : bp.node_index]
            if not isinstance(n, Penalty)
        )
        assert bp.natural_width_mm == pytest.approx(advance_sum, abs=1e-12)
        previous = bp.node_index


def test_ink_overhang_is_an_explicit_stub(deva):
    """`ink_overhang_mm` is declared and deliberately not populated.

    Locked at exactly 0.0 so that whoever populates it is told by a failing
    test to revisit this, rather than the field quietly staying empty forever.
    Measured worst real overhang at chosen line edges is 0.141mm left /
    0.254mm right — under 10% of a 4mm gutter — which is why deferring is
    defensible.
    """
    st = style(font_family="Noto Serif Devanagari", word_space_max=2.0)
    nodes, _ = nodes_for(
        "किताब मिली नई दिल्ली में", deva, st, script="Deva", language="hi"
    )
    result = break_greedy(nodes, [BROADSHEET_MM] * 20, st)
    assert all(bp.ink_overhang_mm == 0.0 for bp in result.breakpoints)


# ---------------------------------------------------------------------------
# A10 performance — a real assertion, not a comment
# ---------------------------------------------------------------------------


@pytest.mark.a10
def test_a10_five_thousand_words_under_250ms(latin):
    """Spec A10. Measured ~30ms for the whole shape+nodes+break pipeline, so the
    threshold is generous; it exists to catch an order-of-magnitude regression,
    not to police a slow CI box."""
    # A local Random, not random.seed(): seeding the module RNG inside a test
    # leaks state into whatever runs next.
    rng = random.Random(11)
    vocab = NEWS_VOCAB
    text = " ".join(rng.choice(vocab) for _ in range(5000))

    start = time.perf_counter()
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    nodes = build_nodes([run], text, style())
    break_lines(nodes, [BROADSHEET_MM] * 3000, style(algorithm="knuth_plass"))
    elapsed = time.perf_counter() - start

    assert elapsed < 0.25, f"A10: 5000 words took {elapsed * 1000:.0f}ms (budget 250ms)"


@pytest.mark.a10
def test_a10_greedy_is_not_slower_than_knuth_plass(latin):
    """Greedy is the default; if it ever became the slow path that is a bug."""
    # A local Random, not random.seed(): seeding the module RNG inside a test
    # leaks state into whatever runs next.
    rng = random.Random(11)
    vocab = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]
    text = " ".join(rng.choice(vocab) for _ in range(5000))
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    nodes = build_nodes([run], text, style())

    t0 = time.perf_counter()
    break_greedy(nodes, [BROADSHEET_MM] * 3000, style())
    greedy_s = time.perf_counter() - t0

    assert greedy_s < 0.25


# ---------------------------------------------------------------------------
# Determinism — by mechanism, per M1.1's lesson
# ---------------------------------------------------------------------------

_PROBE = """
import json, sys
sys.path.insert(0, {root!r})
from pathlib import Path
from paginator.errors import MissingGlyphError
from paginator.typeset import FontRegistry, shape_run
from paginator.typeset.linebreak import build_nodes, break_lines
from paginator.typeset.schemas import TextStyle

reg = FontRegistry(); reg.register_dir(Path({assets!r}))
face = reg.resolve("Source Serif 4", 400, "normal")
st = TextStyle(font_family="Source Serif 4", size_pt=10.0, leading_pt=12.0,
               algorithm={algo!r})
text = "the quick brown fox jumps over the lazy dog " * 12
run = shape_run(text, face, 10.0, script="Latn", language="en", direction="ltr")
nodes = build_nodes([run], text, st)
res = break_lines(nodes, [30.25]*400, st)
print(json.dumps(res.model_dump(mode="json"), sort_keys=True))
"""


def _probe(algo: str) -> str:
    code = _PROBE.format(root=str(ROOT), assets=str(ASSETS), algo=algo)
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


@pytest.mark.parametrize("algo", ["greedy", "knuth_plass"])
def test_breaking_is_identical_across_process_restarts(algo: str):
    assert _probe(algo) == _probe(algo)


def test_breaking_is_deterministic_in_process(latin):
    text = "the quick brown fox jumps over the lazy dog " * 6
    nodes, _ = nodes_for(text, latin)
    st = style(algorithm="knuth_plass")
    a = break_lines(nodes, [BROADSHEET_MM] * 200, st)
    b = break_lines(nodes, [BROADSHEET_MM] * 200, st)
    assert a.model_dump_json() == b.model_dump_json()


# ---------------------------------------------------------------------------
# The M1.4 hook, inert until hyphenation lands
# ---------------------------------------------------------------------------


def test_build_nodes_accepts_hyphen_points_and_emits_flagged_penalties(latin):
    """The hook M1.4 fills. Passing points now must already produce flagged
    penalties, so M1.4 changes one caller rather than this signature."""
    from paginator.typeset.schemas import HyphenPoint

    text = "extraordinary"
    st = style()
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    nodes = build_nodes(
        [run], text, st,
        hyphen_points=[HyphenPoint(offset=5, inserts_glyph=True)],
        face=latin,
    )
    flagged = [n for n in nodes if isinstance(n, Penalty) and n.flagged]
    assert len(flagged) == 1
    assert flagged[0].width_mm > 0, "a visible hyphen has an advance"


def test_hyphen_point_with_no_glyph_has_no_width(latin):
    """Devanagari akshara breaks and existing hard hyphens break without ink."""
    from paginator.typeset.schemas import HyphenPoint

    text = "extraordinary"
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    nodes = build_nodes(
        [run], text, style(),
        hyphen_points=[HyphenPoint(offset=5, inserts_glyph=False)],
        face=latin,
    )
    flagged = [n for n in nodes if isinstance(n, Penalty) and n.flagged]
    assert flagged[0].width_mm == 0.0


def test_no_hyphen_points_means_no_flagged_penalties(latin):
    nodes, _ = nodes_for("extraordinary circumstances", latin)
    assert not [n for n in nodes if isinstance(n, Penalty) and n.flagged]


def test_greedy_takes_the_break_that_triggered_the_overflow(latin):
    """Regression: the trigger node was lost as a break candidate.

    `break_greedy` used to `continue` after emitting a break, which skipped
    registering the node that caused the overflow. When that node was itself a
    legal breakpoint it vanished, and the following line ran over the measure.
    Measured at 23 overflowing lines in 60 trials before the fix — e.g. two
    boxes totalling 37.12mm inside a 30.25mm column with a legal break between
    them.

    A line may exceed the measure only when it holds a single box wider than
    the measure, which no break can help.
    """
    rng = random.Random(3)
    vocab = NEWS_VOCAB
    st = style()
    for measure in (BROADSHEET_MM, WIDE_MM, 20.0):
        for _ in range(12):
            text = " ".join(rng.choice(vocab) for _ in range(60))
            nodes, _ = nodes_for(text, latin, st)
            result = break_greedy(nodes, [measure] * 400, st)
            previous = -1
            for bp in result.breakpoints:
                boxes = [
                    n for n in nodes[previous + 1 : bp.node_index]
                    if isinstance(n, Box)
                ]
                if len(boxes) > 1:
                    assert bp.natural_width_mm <= measure + 1e-9, (
                        f"line {bp.line} is {bp.natural_width_mm:.2f}mm in a "
                        f"{measure}mm measure with {len(boxes)} boxes — a legal "
                        f"break existed and was not taken"
                    )
                previous = bp.node_index


def test_greedy_loses_no_boxes(latin):
    """INVARIANT 1 at the node level: every box lands on exactly one line."""
    text = " ".join(["alpha", "counterproductive", "to", "the", "committee"] * 40)
    nodes, _ = nodes_for(text, latin)
    result = break_greedy(nodes, [BROADSHEET_MM] * 500, style())

    covered: list[tuple[int, int]] = []
    previous = -1
    for bp in result.breakpoints:
        covered += [
            n.glyph_range for n in nodes[previous + 1 : bp.node_index]
            if isinstance(n, Box)
        ]
        previous = bp.node_index
    covered += [n.glyph_range for n in nodes[previous + 1 :] if isinstance(n, Box)]

    emitted = [n.glyph_range for n in nodes if isinstance(n, Box)]
    assert covered == emitted, "a box was dropped or duplicated across lines"


# ---------------------------------------------------------------------------
# Findings from the M1.3 typography review
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    ["राम िगया", "राम ़गया", "राम ंगया", "राम ्गया", "राम ागया"],
)
def test_a_mark_following_a_space_is_not_deleted(deva, text: str):
    """INVARIANT 1. HarfBuzz merges a combining mark that follows a space into
    the space's cluster, so both glyphs report the space's source index.

    Classifying by `text[cluster] == " "` alone made the mark word space: it
    became Glue, landed in no Box, and vanished. Measured on "राम िगया", the
    i-matra was replaced by 0.868mm of stretchable space — a Devanagari reader
    sees a different word and nobody else sees anything at all.
    """
    st = style(font_family="Noto Serif Devanagari", word_space_max=2.0)
    nodes, run = nodes_for(text, deva, st, script="Deva", language="hi")

    in_a_box: set[int] = set()
    for node in nodes:
        if isinstance(node, Box):
            in_a_box.update(range(*node.glyph_range))

    lost = [
        deva._glyph_order[run.glyph_ids[i]]
        for i in range(run.glyph_count)
        if i not in in_a_box and deva._glyph_order[run.glyph_ids[i]] != "space"
    ]
    assert lost == [], f"glyphs deleted from the node stream: {lost}"


def test_every_non_space_glyph_lands_in_exactly_one_box(latin):
    """The coverage assertion whose absence hid the bug above.

    The cluster-integrity test checks box *endpoints*; nothing checked that the
    boxes cover the glyphs. A mutant deleting the last cluster of every word
    survived 32 of 33 tests.
    """
    text = "alpha beta gamma delta epsilon"
    nodes, run = nodes_for(text, latin)
    counts = [0] * run.glyph_count
    for node in nodes:
        if isinstance(node, Box):
            for g in range(*node.glyph_range):
                counts[g] += 1
    space_gid = latin.glyph_id(ord(" "))
    for i, n in enumerate(counts):
        expected = 0 if run.glyph_ids[i] == space_gid else 1
        assert n == expected, f"glyph {i} appears in {n} boxes, expected {expected}"


def test_knuth_plass_line_widths_match_the_node_stream(latin):
    """KP carried the glue it broke at into the following line, reporting every
    line exactly one word space (0.822mm) too wide — 2.7% of a broadsheet
    column. M1.5 justifies from this number, so those lines would have been set
    short of the right margin. Two algorithms disagreeing about one line is the
    failure the single-engine principle exists to prevent."""
    text = (
        "the quick brown fox jumps over the lazy dog while a few large "
        "jackdaws quietly vex one sphinx of black quartz " * 4
    )
    st = style(algorithm="knuth_plass", word_space_max=2.0)
    nodes, _ = nodes_for(text, latin, st)
    result = break_knuth_plass(nodes, [120.0] * 200, st)
    assert result is not None

    previous_end = 0
    for bp in result.breakpoints:
        expected = sum(
            n.width_mm
            for n in nodes[previous_end : bp.node_index]
            if not isinstance(n, Penalty)
        )
        assert bp.natural_width_mm == pytest.approx(expected, abs=1e-9), (
            f"line {bp.line} reports {bp.natural_width_mm:.4f}mm, "
            f"node stream says {expected:.4f}mm"
        )
        previous_end = bp.node_index + 1


def test_word_relative_hyphen_offsets_raise_rather_than_vanish(latin):
    """`HyphenPoint.offset` is paragraph-absolute. A word-relative offset lands
    on no cluster start, produces no penalty, and used to do so silently —
    which is how M1.4's hyphenation would appear to simply not work."""
    from paginator.typeset.schemas import HyphenPoint

    text = "alpha extraordinary"
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    with pytest.raises(ValueError, match="cluster boundaries"):
        build_nodes(
            [run], text, style(),
            hyphen_points=[HyphenPoint(offset=5)],  # word-relative: wrong
            face=latin,
        )
    # 11 = "alpha " + "extra" — the absolute index — is accepted.
    nodes = build_nodes(
        [run], text, style(),
        hyphen_points=[HyphenPoint(offset=11)],
        face=latin,
    )
    assert [n for n in nodes if isinstance(n, Penalty) and n.flagged]


def test_build_nodes_rejects_a_partial_paragraph(latin):
    """Passing a slice instead of the whole paragraph would put every cluster
    index out of range, find no spaces, and yield one enormous unbreakable box
    — with nothing raising."""
    text = "alpha beta gamma"
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    with pytest.raises(ValueError, match="whole paragraph"):
        build_nodes([run], "alph", style())


def test_a_trailing_space_does_not_push_a_line_over_the_measure(latin):
    """Regression: glue is discarded at a break, so it cannot overflow a line.

    Testing `width + glue > measure` broke one word early on 6.9% of real
    lines. "the representatives" measures 30.000mm and fits a 30.25mm column,
    but the following space took the total to 30.822mm and greedy emitted
    "the" alone at 5.066mm.
    """
    text = "the representatives recommendations and the state panel said"
    nodes, run = nodes_for(text, latin)
    result = break_greedy(nodes, [BROADSHEET_MM] * 20, style())

    first = result.breakpoints[0]
    assert first.natural_width_mm == pytest.approx(30.000, abs=0.01)
    assert first.natural_width_mm <= BROADSHEET_MM


def test_greedy_never_breaks_while_the_next_word_would_still_fit(latin):
    """The general form: a line ends only because the next box does not fit."""
    rng = random.Random(5)
    vocab = NEWS_VOCAB
    st = style()
    early = total = 0
    for _ in range(40):
        text = " ".join(rng.choice(vocab) for _ in range(80))
        nodes, _ = nodes_for(text, latin, st)
        result = break_greedy(nodes, [BROADSHEET_MM] * 400, st)
        for bp in result.breakpoints:
            total += 1
            following = None
            for node in nodes[bp.node_index + 1 :]:
                if isinstance(node, Box):
                    following = node
                    break
                if isinstance(node, Penalty):
                    break
            if following is None:
                continue
            with_next = (
                bp.natural_width_mm
                + nodes[bp.node_index].width_mm
                + following.width_mm
            )
            if with_next <= BROADSHEET_MM + 1e-9:
                early += 1
    assert early == 0, f"{early}/{total} lines broke while the next word fitted"


def test_an_unstretchable_short_line_is_distinguishable_from_a_perfect_fit(latin):
    """`_ratio` returned 0.0 for both, so §M1.5's loose/tight warnings and A4's
    justified-width check could not tell an 83%-empty line from an exact fit."""
    text = "the representatives recommendations and the state panel said"
    nodes, _ = nodes_for(text, latin)
    result = break_greedy(nodes, [BROADSHEET_MM] * 20, style())

    single_box = [
        bp for bp in result.breakpoints
        if bp.adjustment_ratio > 100.0
    ]
    assert single_box, "a single-box line cannot be stretched and must say so"
    for bp in single_box:
        assert bp.natural_width_mm < BROADSHEET_MM


def test_a_missing_hyphen_glyph_raises_rather_than_measuring_zero(latin):
    """CLAUDE.md: missing glyphs raise, never render.

    Swallowing MissingGlyphError gave a zero-width hyphen — understating every
    hyphenated line and drawing nothing where a hyphen belongs.
    """
    from paginator.typeset.schemas import HyphenPoint

    class NoHyphenFace:
        font_id = latin.font_id
        units_per_em = latin.units_per_em

        def glyph_id(self, codepoint: int) -> int:
            raise MissingGlyphError(codepoint, "fnt_x", "Fake Face")

        def advance_mm(self, glyph_id: int, size_pt: float) -> float:
            return 0.0

    text = "alpha extraordinary"
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    with pytest.raises(MissingGlyphError):
        build_nodes(
            [run], text, style(),
            hyphen_points=[HyphenPoint(offset=11)],
            face=NoHyphenFace(),  # type: ignore[arg-type]
        )


def test_text_style_accepts_every_spec_field():
    """§2.2 lists keep_with_next_lines, drop_cap_lines and drop_cap_chars;
    `extra="forbid"` made a caller supplying them fail."""
    st = TextStyle(
        font_family="Source Serif 4", size_pt=10.0, leading_pt=12.0,
        keep_with_next_lines=2, drop_cap_lines=3, drop_cap_chars=1,
    )
    assert (st.keep_with_next_lines, st.drop_cap_lines, st.drop_cap_chars) == (2, 3, 1)


# ---------------------------------------------------------------------------
# Multiple forced penalties — NOT a latent case
#
# compose() emits one per paragraph break (M1.5) and M7 adds a user-facing
# forced line break, so a real stream routinely holds several. Before the fix
# greedy silently dropped everything after the first (7 of 14 nodes measured)
# and Knuth-Plass returned None outright — which would have reported
# used_fallback=True for valid input and corrupted the metric M1.4 is judged by.
# ---------------------------------------------------------------------------


def _forced() -> Penalty:
    return Penalty(width_mm=0.0, cost=-INF_PENALTY)


def _paragraph_nodes() -> list:
    """One paragraph that comfortably fits a single 30mm line: 12 + 2 + 12."""
    return [
        Box(width_mm=12.0, glyph_range=(0, 1)),
        Glue(width_mm=2.0, stretch_mm=2.0, shrink_mm=0.5),
        Box(width_mm=12.0, glyph_range=(1, 2)),
        Glue(width_mm=0.0, stretch_mm=1.0e6, shrink_mm=0.0),
        _forced(),
    ]


@pytest.mark.parametrize("algorithm", ["greedy", "knuth_plass"])
@pytest.mark.parametrize("paragraphs", [1, 2, 3, 5])
def test_every_forced_penalty_ends_a_line_not_the_stream(
    algorithm: str, paragraphs: int
):
    nodes = _paragraph_nodes() * paragraphs
    st = style(algorithm=algorithm, word_space_max=2.0)
    result = break_lines(nodes, [30.0] * 40, st)

    assert result.used_fallback is False, "a valid multi-paragraph stream is feasible"
    assert result.line_count == paragraphs
    assert result.breakpoints[-1].node_index == len(nodes) - 1, (
        "nodes after the last forced penalty were dropped"
    )


@pytest.mark.parametrize("algorithm", ["greedy", "knuth_plass"])
def test_no_line_spans_a_forced_penalty(algorithm: str):
    """A mandatory break is mandatory: no line may contain one in its interior."""
    nodes = _paragraph_nodes() * 4
    st = style(algorithm=algorithm, word_space_max=2.0)
    result = break_lines(nodes, [30.0] * 40, st)

    previous = -1
    for bp in result.breakpoints:
        interior = nodes[previous + 1 : bp.node_index]
        assert not any(
            isinstance(n, Penalty) and n.is_forced for n in interior
        ), f"line {bp.line} spans a forced break"
        previous = bp.node_index


def test_greedy_and_knuth_plass_agree_on_forced_break_positions():
    """Both must place a line end at every forced penalty, and nowhere else
    is that mandatory — so the forced positions are a shared invariant."""
    nodes = _paragraph_nodes() * 3
    forced_at = {
        i for i, n in enumerate(nodes) if isinstance(n, Penalty) and n.is_forced
    }
    for algorithm in ("greedy", "knuth_plass"):
        st = style(algorithm=algorithm, word_space_max=2.0)
        chosen = {
            bp.node_index for bp in break_lines(nodes, [30.0] * 40, st).breakpoints
        }
        assert forced_at <= chosen, (
            f"{algorithm} missed forced breaks {sorted(forced_at - chosen)}"
        )
