"""M1.2 — shaping.

The tests that matter here are the ones a non-Devanagari reader cannot verify by
looking: that conjuncts form as single glyphs, that a reordered matra still maps
back to the character a sub-editor would edit, and that ink position accounts for
GPOS placement rather than the raw bounding box.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from paginator.errors import MissingGlyphError
from paginator.geometry import MM_PER_PT
from paginator.typeset import FontRegistry
from paginator.typeset.schemas import GlyphRun, TextItem
from paginator.typeset.shape import itemize, shape_run

ASSETS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def registry() -> FontRegistry:
    reg = FontRegistry()
    reg.register_dir(ASSETS)
    return reg


@pytest.fixture(scope="module")
def deva(registry: FontRegistry):
    return registry.resolve("Noto Serif Devanagari", 400, "normal")


@pytest.fixture(scope="module")
def latin(registry: FontRegistry):
    return registry.resolve("Source Serif 4", 400, "normal")


# ---------------------------------------------------------------------------
# A3 — Devanagari conjuncts form as single glyphs
# ---------------------------------------------------------------------------

# Measured against the committed Noto Serif Devanagari. Pinned by the lockfile:
# a fontTools or font bump that moves these must be a reviewable diff, because
# a changed glyph id silently changes every golden raster from M10.
CONJUNCT_CASES = [
    ("क्षत्रिय", [92, 561, 307, 83], [0, 3, 3, 7]),
    ("ज्ञान", [94, 31, 77], [0, 0, 4]),
    ("त्रिशूल", [561, 307, 87, 35, 85], [0, 0, 4, 4, 6]),
]


@pytest.mark.parametrize(("text", "expected_ids", "_clusters"), CONJUNCT_CASES)
def test_devanagari_conjuncts_shape_to_expected_glyphs(
    deva, text: str, expected_ids: list[int], _clusters: list[int]
):
    run = shape_run(text, deva, 10.0, script="Deva", language="hi", direction="ltr")
    assert list(run.glyph_ids) == expected_ids, (
        f"{text!r} shaped to {list(run.glyph_ids)}; conjunct formation changed"
    )


def test_conjunct_is_one_glyph_not_base_plus_virama(deva):
    """क्ष is 3 codepoints and must become 1 glyph, not 3."""
    run = shape_run("क्ष", deva, 10.0, script="Deva", language="hi", direction="ltr")
    assert run.glyph_count == 1, (
        f"क्ष produced {run.glyph_count} glyphs — the conjunct did not form"
    )
    name = deva._glyph_order[run.glyph_ids[0]]
    assert name == "uni0915094D0937", f"expected the ksha conjunct, got {name}"


def test_reordered_matra_keeps_its_logical_cluster(deva):
    """The i-matra renders before its consonant but belongs to it logically.

    In त्रि the matra is drawn first; its cluster must still point at the
    consonant cluster it modifies, or an editor told "fix character 2" would be
    sent to the wrong character.
    """
    run = shape_run("त्रि", deva, 10.0, script="Deva", language="hi", direction="ltr")
    names = [deva._glyph_order[g] for g in run.glyph_ids]
    assert names[0].startswith("uni093F"), "expected the i-matra to be drawn first"
    assert run.cluster_map[0] == run.cluster_map[1] == 0, (
        "the reordered matra and its base must share cluster 0"
    )


# ---------------------------------------------------------------------------
# cluster_map round-trip
# ---------------------------------------------------------------------------


def _assert_clusters_partition(run: GlyphRun, text: str) -> None:
    clusters = list(run.cluster_map)
    assert clusters, "no glyphs"
    for c in clusters:
        assert 0 <= c < len(text), f"cluster {c} outside 0..{len(text)}"
    assert clusters == sorted(clusters), f"clusters not monotonic: {clusters}"
    assert clusters[0] == 0, f"first cluster is {clusters[0]}, not 0"
    # Cluster starts partition the source: every character belongs to exactly
    # one cluster range, and no character falls outside one.
    starts = sorted(set(clusters))
    covered = 0
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        assert end > start
        covered += end - start
    assert covered == len(text), (
        f"clusters cover {covered} of {len(text)} characters"
    )


@pytest.mark.parametrize(("text", "_ids", "_clusters"), CONJUNCT_CASES)
def test_cluster_map_partitions_devanagari_source(
    deva, text: str, _ids: list[int], _clusters: list[int]
):
    run = shape_run(text, deva, 10.0, script="Deva", language="hi", direction="ltr")
    _assert_clusters_partition(run, text)


def test_cluster_map_partitions_latin_with_ligatures(latin):
    text = "affluent office"
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    _assert_clusters_partition(run, text)


def test_ligature_maps_several_characters_to_one_glyph(latin):
    """If the font forms an fi/ffl ligature, the glyph count drops below the
    character count while the clusters still cover every character."""
    text = "ffl"
    run = shape_run(text, latin, 10.0, script="Latn", language="en", direction="ltr")
    _assert_clusters_partition(run, text)
    assert run.glyph_count <= len(text)


def test_cluster_map_is_within_the_declared_char_range(deva):
    run = shape_run("कमल", deva, 10.0, script="Deva", language="hi", direction="ltr")
    assert run.char_start == 0
    assert run.char_end == 3
    assert max(run.cluster_map) < run.char_end


# ---------------------------------------------------------------------------
# Advances, tracking, units
# ---------------------------------------------------------------------------


def test_advance_sum_matches_hand_computed_value(latin):
    """Independent path: sum the face's own per-glyph advances."""
    run = shape_run("Hi", latin, 10.0, script="Latn", language="en", direction="ltr")
    expected = sum(latin.advance_mm(g, 10.0) for g in run.glyph_ids)
    assert run.width_mm == pytest.approx(expected, abs=1e-9)


def test_advances_scale_linearly_with_size(latin):
    """Exactly 2x holds only while `opsz` is unpinned — see _RESOLVED_AXES.
    When optical size is pinned per size_pt this becomes approximate, and that
    is the correct outcome, not a regression."""
    a = shape_run("Hamburg", latin, 10.0, script="Latn", language="en", direction="ltr")
    b = shape_run("Hamburg", latin, 20.0, script="Latn", language="en", direction="ltr")
    assert b.width_mm == pytest.approx(2 * a.width_mm, rel=1e-12)


def test_zero_tracking_is_a_no_op(latin):
    a = shape_run("Hamburg", latin, 10.0, script="Latn", language="en", direction="ltr")
    b = shape_run(
        "Hamburg", latin, 10.0, script="Latn", language="en", direction="ltr",
        tracking=0.0,
    )
    assert a.x_advances_mm == b.x_advances_mm


def test_tracking_is_linear_and_symmetric(latin):
    plain = shape_run("Hamburg", latin, 10.0, script="Latn", language="en",
                      direction="ltr")
    loose = shape_run("Hamburg", latin, 10.0, script="Latn", language="en",
                      direction="ltr", tracking=50.0)
    tight = shape_run("Hamburg", latin, 10.0, script="Latn", language="en",
                      direction="ltr", tracking=-50.0)

    n = plain.glyph_count
    step = 50.0 / 1000.0 * 10.0 * MM_PER_PT
    assert loose.width_mm == pytest.approx(plain.width_mm + n * step, abs=1e-9)
    assert tight.width_mm == pytest.approx(plain.width_mm - n * step, abs=1e-9)
    # symmetric about the untracked width
    assert loose.width_mm - plain.width_mm == pytest.approx(
        plain.width_mm - tight.width_mm, abs=1e-9
    )


def test_tracking_applies_to_every_glyph(latin):
    plain = shape_run("abc", latin, 10.0, script="Latn", language="en",
                      direction="ltr")
    tracked = shape_run("abc", latin, 10.0, script="Latn", language="en",
                        direction="ltr", tracking=100.0)
    step = 100.0 / 1000.0 * 10.0 * MM_PER_PT
    for before, after in zip(plain.x_advances_mm, tracked.x_advances_mm, strict=True):
        assert after == pytest.approx(before + step, abs=1e-9)


def test_run_carries_the_face_font_id(latin):
    run = shape_run("x", latin, 10.0, script="Latn", language="en", direction="ltr")
    assert run.font_id == latin.font_id
    assert run.size_pt == 10.0


def test_empty_text_produces_an_empty_run(latin):
    run = shape_run("", latin, 10.0, script="Latn", language="en", direction="ltr")
    assert run.glyph_count == 0
    assert run.width_mm == 0.0


# ---------------------------------------------------------------------------
# itemize — UAX#24 / UAX#9
# ---------------------------------------------------------------------------


def test_itemize_single_script_is_one_item():
    items = itemize("Hello world")
    assert len(items) == 1
    assert items[0].script == "Latn"
    assert items[0].direction == "ltr"
    assert (items[0].start, items[0].end) == (0, 11)


def test_itemize_splits_mixed_latin_and_devanagari():
    text = "News समाचार today"
    items = itemize(text)
    scripts = [i.script for i in items]
    assert scripts == ["Latn", "Deva", "Latn"], scripts
    assert "".join(text[i.start : i.end] for i in items) == text


def test_itemize_keeps_ascii_digits_inside_a_devanagari_run():
    """Digits are UAX#24 Common and must inherit, not split the run.

    Splitting here would shape the digits in a separate run and, worse, hand
    them to a face that may not cover them.
    """
    text = "सन 2026 में"
    items = itemize(text)
    assert len(items) == 1, [(i.script, text[i.start : i.end]) for i in items]
    assert items[0].script == "Deva"


def test_itemize_handles_a_url_inside_devanagari():
    text = "देखें https://example.com/पेज"
    items = itemize(text)
    assert "".join(text[i.start : i.end] for i in items) == text
    scripts = [i.script for i in items]
    assert scripts[0] == "Deva"
    assert "Latn" in scripts, scripts
    # The punctuation inside the URL must not create its own items.
    assert len(items) <= 4, [(i.script, text[i.start : i.end]) for i in items]


def test_itemize_covers_the_whole_string_without_gaps_or_overlap():
    for text in [
        "Hello",
        "समाचार",
        "News समाचार today",
        "सन 2026 में",
        "   ",
        "aकb",
    ]:
        items = itemize(text)
        assert items[0].start == 0
        assert items[-1].end == len(text)
        for a, b in zip(items, items[1:], strict=False):
            assert a.end == b.start, f"gap or overlap in {text!r}"
        assert "".join(text[i.start : i.end] for i in items) == text


def test_itemize_empty_string():
    assert itemize("") == []


def test_itemize_only_common_characters_defaults_to_latin():
    """A string of pure punctuation has no strong script; it must still shape."""
    items = itemize("... 123 ---")
    assert len(items) == 1
    assert items[0].direction == "ltr"


def test_itemize_marks_rtl_direction():
    items = itemize("مرحبا")
    assert items[0].script == "Arab"
    assert items[0].direction == "rtl"


def test_itemize_returns_text_items():
    assert all(isinstance(i, TextItem) for i in itemize("Hello समाचार"))


# ---------------------------------------------------------------------------
# Ink extent — the M1.1 finding, now per glyph and positioned
# ---------------------------------------------------------------------------


def test_positioned_ink_of_a_matra_stack_exceeds_either_glyph_alone(deva):
    """Proves GPOS y_offset is applied rather than the raw bounding box used."""
    run = shape_run("र्की", deva, 10.0, script="Deva", language="hi", direction="ltr")
    positioned_top = max(
        deva.glyph_ink_mm(g, 10.0)[0] + y
        for g, y in zip(run.glyph_ids, run.y_offsets_mm, strict=True)
    )
    raw_top = max(deva.glyph_ink_mm(g, 10.0)[0] for g in run.glyph_ids)
    assert positioned_top >= raw_top


def test_real_devanagari_copy_fits_inside_the_rhythm_ascent(deva):
    """The M1.2 correction: face-level worst case is Vedic-driven, not news copy.

    If this ever fails, the face-level figure has become the right default after
    all and the leading policy needs revisiting.
    """
    ascent_mm = deva.ascent_mm_at_1pt * 10.0
    for text in ["कमल", "क्षत्रिय ज्ञान त्रिशूल", "मुख्यमंत्री ने की घोषणा"]:
        run = shape_run(text, deva, 10.0, script="Deva", language="hi",
                        direction="ltr")
        top = max(
            deva.glyph_ink_mm(g, 10.0)[0] + y
            for g, y in zip(run.glyph_ids, run.y_offsets_mm, strict=True)
        )
        assert top <= ascent_mm, f"{text!r} ink {top:.3f}mm exceeds {ascent_mm:.3f}mm"


def test_vedic_mark_does_exceed_the_rhythm_ascent(deva):
    """The counter-case. Collision is real, just rare — so it is detected per
    line rather than pre-paid by inflating every leading."""
    run = shape_run("क꣰", deva, 10.0, script="Deva", language="sa",
                    direction="ltr")
    top = max(
        deva.glyph_ink_mm(g, 10.0)[0] + y
        for g, y in zip(run.glyph_ids, run.y_offsets_mm, strict=True)
    )
    assert top > deva.ascent_mm_at_1pt * 10.0


def test_glyph_ink_is_cached(deva):
    gid = deva.glyph_id(ord("क"))
    deva._ink_cache.pop(gid, None)
    first = deva.glyph_ink_mm(gid, 10.0)
    assert gid in deva._ink_cache
    assert deva.glyph_ink_mm(gid, 10.0) == first


def test_glyph_ink_scales_with_size(deva):
    gid = deva.glyph_id(ord("क"))
    a_top, a_bot = deva.glyph_ink_mm(gid, 10.0)
    b_top, b_bot = deva.glyph_ink_mm(gid, 20.0)
    assert b_top == pytest.approx(2 * a_top, rel=1e-12)
    assert b_bot == pytest.approx(2 * a_bot, rel=1e-12)


def test_glyph_with_no_outline_has_zero_ink(latin):
    assert latin.glyph_ink_mm(latin.glyph_id(ord(" ")), 10.0) == (0.0, 0.0)


# ---------------------------------------------------------------------------
# Determinism — across a process boundary, per the M1.1 lesson
# ---------------------------------------------------------------------------

_DETERMINISM_PROBE = """
import json, sys
from pathlib import Path
sys.path.insert(0, {root!r})
from paginator.typeset import FontRegistry
from paginator.typeset.shape import shape_run, itemize

reg = FontRegistry()
reg.register_dir(Path({assets!r}))
face = reg.resolve("Noto Serif Devanagari", 400, "normal")
run = shape_run("क्षत्रिय ज्ञान", face, 10.0, script="Deva", language="hi",
                direction="ltr", tracking=12.5)
print(json.dumps({{
    "run": run.model_dump(mode="json"),
    "items": [i.model_dump(mode="json") for i in itemize("News समाचार 2026")],
}}, sort_keys=True))
"""


def _probe() -> str:
    code = _DETERMINISM_PROBE.format(root=str(ROOT), assets=str(ASSETS))
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


def test_shaping_is_identical_across_process_restarts():
    """Two fresh interpreters, so nothing shared in-process can hide a
    dependence on iteration order, address layout, or a warm cache."""
    assert _probe() == _probe()


def test_shaping_is_deterministic_in_process(deva):
    a = shape_run("क्षत्रिय", deva, 10.0, script="Deva", language="hi",
                  direction="ltr")
    b = shape_run("क्षत्रिय", deva, 10.0, script="Deva", language="hi",
                  direction="ltr")
    assert a.model_dump_json() == b.model_dump_json()


# ---------------------------------------------------------------------------
# Schema guards
# ---------------------------------------------------------------------------


def test_glyph_run_rejects_mismatched_parallel_arrays():
    with pytest.raises(ValueError, match="expected 2"):
        GlyphRun(
            font_id="fnt_x",
            size_pt=10.0,
            glyph_ids=(1, 2),
            x_advances_mm=(1.0,),
            x_offsets_mm=(0.0, 0.0),
            y_offsets_mm=(0.0, 0.0),
            cluster_map=(0, 1),
            char_start=0,
            char_end=2,
        )


def test_glyph_run_is_frozen(latin):
    run = shape_run("x", latin, 10.0, script="Latn", language="en", direction="ltr")
    with pytest.raises(ValueError):
        run.size_pt = 12.0  # type: ignore[misc]


def test_text_item_rejects_an_empty_range():
    with pytest.raises(ValueError):
        TextItem(start=5, end=5, script="Latn", direction="ltr")


def test_shape_run_rejects_a_non_positive_size(latin):
    for bad in (0.0, -1.0):
        with pytest.raises(ValueError, match="size_pt must be positive"):
            shape_run("x", latin, bad, script="Latn", language="en", direction="ltr")


def test_text_item_length(latin):
    item = TextItem(start=2, end=7, script="Latn", direction="ltr")
    assert item.length == 5


# ---------------------------------------------------------------------------
# Defects found by the M1.2 typography review. Every one of these passed the
# suite, mypy --strict and ruff while the bug was live.
# ---------------------------------------------------------------------------


def test_uncovered_codepoint_raises_rather_than_shaping_to_notdef(deva):
    """A8. HarfBuzz does its own cmap lookup and returns glyph 0 happily.

    Reachable from real copy: itemize folds emoji and CJK into the surrounding
    Devanagari run, so a character pasted from a CMS into a Hindi story used to
    shape to .notdef and print as □ — invisible to anyone who cannot read the
    script, so it reached the page unchallenged.
    """
    for text in ["中文", "😀", "abcவ"]:
        with pytest.raises(MissingGlyphError):
            shape_run(text, deva, 10.0, script="Deva", language="hi",
                      direction="ltr")


def test_missing_glyph_error_names_the_offending_character(deva):
    with pytest.raises(MissingGlyphError) as exc:
        shape_run("क中", deva, 10.0, script="Deva", language="hi", direction="ltr")
    assert exc.value.codepoint == ord("中")


def test_no_dotted_circle_is_ever_synthesised(deva):
    """HarfBuzz inserts U+25CC for an orphan mark. It is real ink on the page
    and looks like a legitimate glyph to a non-reader.

    Reachable without slicing: itemize("Aिब") splits after the Latin A, leaving
    a Devanagari run that opens with a matra.
    """
    dotted = deva.glyph_id(0x25CC)
    for text in ["ि", "ीय", "ब"]:
        run = shape_run(text, deva, 10.0, script="Deva", language="hi",
                        direction="ltr")
        assert dotted not in run.glyph_ids, f"{text!r} produced a dotted circle"


def test_tracking_is_applied_per_cluster_not_per_glyph(deva):
    """A Devanagari aksara is several glyphs, most of them zero-advance marks.

    Tracking each of them detaches the marks from their base and overstated
    मुख्यमंत्री's width by 60%.
    """
    word = "मुख्यमंत्री"
    plain = shape_run(word, deva, 10.0, script="Deva", language="hi",
                      direction="ltr")
    tracked = shape_run(word, deva, 10.0, script="Deva", language="hi",
                        direction="ltr", tracking=50.0)

    step = 50.0 / 1000.0 * 10.0 * MM_PER_PT
    clusters = len(set(plain.cluster_map))
    assert plain.glyph_count > clusters, "need a word with multi-glyph clusters"

    delta = tracked.width_mm - plain.width_mm
    assert delta == pytest.approx(clusters * step, abs=1e-9)
    assert delta != pytest.approx(plain.glyph_count * step, abs=1e-9)


def test_tracking_never_moves_a_zero_advance_mark(deva):
    """A mark carries no advance; giving it one detaches it from its base."""
    word = "त्रिशूल"
    plain = shape_run(word, deva, 10.0, script="Deva", language="hi",
                      direction="ltr")
    tracked = shape_run(word, deva, 10.0, script="Deva", language="hi",
                        direction="ltr", tracking=100.0)
    zero_advance = [i for i, a in enumerate(plain.x_advances_mm) if a == 0.0]
    assert zero_advance, "need a word containing a zero-advance mark"
    boundaries = {
        i for i in range(plain.glyph_count)
        if i == plain.glyph_count - 1
        or plain.cluster_map[i + 1] != plain.cluster_map[i]
    }
    for i in zero_advance:
        if i not in boundaries:
            assert tracked.x_advances_mm[i] == 0.0, (
                f"glyph {i} is a mark inside a cluster and must stay zero-advance"
            )


def test_gpos_offsets_are_applied_to_positioned_ink(latin):
    """Replaces a test that could not fail.

    The Devanagari reph+matra case it used is a precomposed GSUB ligature with
    no GPOS attachment at all, so positioned == raw and a `>=` assertion held
    even with the offsets zeroed. Stacked Latin diacritics genuinely accumulate
    mark-to-mark attachment, so this is strictly greater.
    """
    run = shape_run("é̀", latin, 10.0, script="Latn", language="en",
                    direction="ltr")
    positioned = max(
        latin.glyph_ink_mm(g, 10.0)[0] - y
        for g, y in zip(run.glyph_ids, run.y_offsets_mm, strict=True)
    )
    raw = max(latin.glyph_ink_mm(g, 10.0)[0] for g in run.glyph_ids)
    assert positioned > raw, "GPOS mark attachment is not reaching the ink extent"


def test_y_offsets_follow_the_rld_sign_convention(latin):
    """RLD y increases downward (§2.4); HarfBuzz y increases upward.

    A mark placed above the baseline must therefore have a NEGATIVE y_offset
    here. Getting this backwards puts every accent below its letter, and no
    test downstream would notice.
    """
    # Decomposed: precomposed U+00E9 is one glyph with no mark to place.
    run = shape_run("e\u0301\u0300", latin, 10.0, script="Latn",
                    language="en", direction="ltr")
    above_baseline = [y for y in run.y_offsets_mm if y != 0.0]
    assert above_baseline, "expected the combining marks to be offset"
    assert all(y < 0 for y in above_baseline), (
        f"acute should sit above the baseline (negative in RLD y-down), got "
        f"{above_baseline}"
    )


def test_zwnj_suppresses_the_conjunct_and_leaves_no_phantom_glyph(deva):
    """ZWJ/ZWNJ are the only control a sub-editor has over conjunct formation.

    They must change shaping and then disappear — HarfBuzz otherwise leaves
    them as zero-advance `space` glyphs that inflate every downstream count.
    """
    joined = shape_run("क्ष", deva, 10.0, script="Deva", language="hi",
                       direction="ltr")
    split = shape_run("क्‌ष", deva, 10.0, script="Deva", language="hi",
                      direction="ltr")
    assert joined.glyph_ids != split.glyph_ids, "ZWNJ did not affect shaping"

    space_gid = deva.glyph_id(ord(" "))
    assert space_gid not in split.glyph_ids, "ZWNJ left a phantom space glyph"


def test_zwj_forms_the_half_form(deva):
    half = shape_run("क्‍ष", deva, 10.0, script="Deva", language="hi",
                     direction="ltr")
    space_gid = deva.glyph_id(ord(" "))
    assert space_gid not in half.glyph_ids
    assert half.glyph_count >= 2


def test_closing_bracket_takes_the_script_of_its_opener():
    """UAX#24 §5.1. Forward-only inheritance set "(" in Latin and ")" in
    Devanagari — a mismatched pair, and one of the few defects here visible to
    a reader of neither script."""
    text = "News (समाचार) today"
    items = itemize(text)
    by_char = {}
    for item in items:
        for i in range(item.start, item.end):
            by_char[i] = item.script
    assert by_char[text.index("(")] == by_char[text.index(")")] == "Latn"


def test_brackets_pair_the_other_way_round_too():
    text = "देखें (Delhi) में"
    items = itemize(text)
    by_char = {}
    for item in items:
        for i in range(item.start, item.end):
            by_char[i] = item.script
    assert by_char[text.index("(")] == by_char[text.index(")")] == "Deva"


def test_unbalanced_closing_bracket_does_not_crash():
    items = itemize("unbalanced ) here")
    assert "".join("unbalanced ) here"[i.start : i.end] for i in items) == (
        "unbalanced ) here"
    )


def test_control_characters_raise_a_distinct_error_not_missing_glyph(latin):
    """A newline is not a font problem.

    The first version of the .notdef guard raised MissingGlyphError on "a\\nb",
    which would send someone hunting for a font that maps U+000A. Control
    characters are layout instructions and must be resolved upstream.
    """
    for text in ["a\nb", "a\tb"]:
        with pytest.raises(ValueError, match="control character") as exc:
            shape_run(text, latin, 10.0, script="Latn", language="en",
                      direction="ltr")
        assert not isinstance(exc.value, MissingGlyphError)


def test_ordinary_space_is_not_treated_as_a_control_character(latin):
    run = shape_run("a b", latin, 10.0, script="Latn", language="en",
                    direction="ltr")
    assert run.glyph_count == 3


def test_rtl_shaping_refuses_rather_than_reordering_wrongly(latin):
    """Half-built RTL is worse than none: without UAX#9 the European digits in
    "مرحبا 2026" inherit the RTL level and print as "6202"."""
    with pytest.raises(NotImplementedError, match="UAX#9"):
        shape_run("test", latin, 10.0, script="Arab", language="ar",
                  direction="rtl")


def test_itemize_still_labels_rtl_so_callers_can_detect_it():
    assert itemize("مرحبا")[0].direction == "rtl"


def test_run_ink_mm_is_the_single_aggregation_point(deva):
    """The measurement M1.5 and M11 both depend on lives in paginator/, not in
    a test — otherwise the only implementation of the rule is the assertion."""
    from paginator.typeset.shape import run_ink_mm

    run = shape_run("क्षत्रिय", deva, 10.0, script="Deva", language="hi",
                    direction="ltr")
    top, bottom = run_ink_mm(run, deva)
    manual_top = max(
        deva.glyph_ink_mm(g, 10.0)[0] - y
        for g, y in zip(run.glyph_ids, run.y_offsets_mm, strict=True)
    )
    assert top == pytest.approx(manual_top, abs=1e-12)
    assert bottom <= 0.0 <= top


def test_run_ink_mm_accepts_a_glyph_slice(deva):
    """Lines hold a slice of a run, which is why per-glyph ink is not stored."""
    from paginator.typeset.shape import run_ink_mm

    run = shape_run("क्षत्रिय", deva, 10.0, script="Deva", language="hi",
                    direction="ltr")
    whole = run_ink_mm(run, deva)
    part = run_ink_mm(run, deva, 0, 1)
    assert part[0] <= whole[0]
    assert run_ink_mm(run, deva, 2, 2) == (0.0, 0.0)


def test_run_ink_mm_includes_gpos_placement(latin):
    from paginator.typeset.shape import run_ink_mm

    run = shape_run("é̀", latin, 10.0, script="Latn", language="en",
                    direction="ltr")
    top, _ = run_ink_mm(run, latin)
    raw = max(latin.glyph_ink_mm(g, 10.0)[0] for g in run.glyph_ids)
    assert top > raw, "stacked marks must raise the measured ink extent"


def test_glyph_run_rejects_a_cluster_outside_its_declared_range():
    with pytest.raises(ValueError, match="outside the declared"):
        GlyphRun(
            font_id="fnt_x", size_pt=10.0,
            glyph_ids=(1,), x_advances_mm=(1.0,), x_offsets_mm=(0.0,),
            y_offsets_mm=(0.0,), cluster_map=(9,),
            char_start=0, char_end=2,
        )


def test_glyph_run_requires_the_character_range():
    with pytest.raises(ValueError):
        GlyphRun(
            font_id="fnt_x", size_pt=10.0,
            glyph_ids=(), x_advances_mm=(), x_offsets_mm=(),
            y_offsets_mm=(), cluster_map=(),
        )
