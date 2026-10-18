"""M1.1 — FontRegistry and FontFace.

Every number the typesetter produces starts with a font metric. If a face
reports the wrong vertical metrics every baseline on every page is wrong, and
for Devanagari the failure is invisible to anyone who cannot read the script.
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

from paginator.errors import MissingGlyphError
from paginator.geometry import MM_PER_PT
from paginator.typeset.fonts import FontFace, FontRegistry

ASSETS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
LATIN = ASSETS / "latin"
DEVA = ASSETS / "devanagari"

USE_TYPO_METRICS = 1 << 7


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def registry() -> FontRegistry:
    reg = FontRegistry()
    reg.register_dir(ASSETS)
    return reg


def _synthetic(
    family: str,
    *,
    upem: int = 1000,
    typo: tuple[int, int, int] = (900, -300, 100),
    hhea: tuple[int, int, int] = (750, -250, 0),
    use_typo: bool,
    advance_a: int = 600,
) -> bytes:
    """A minimal, wholly synthetic face.

    Built from scratch rather than by modifying a committed font: OFL 1.1 §3
    forbids distributing a modified face under its original name, and the point
    here is to control the metrics exactly anyway. No real font in `assets/`
    has typo != hhea, so this is the only way to exercise both branches.
    """
    fb = FontBuilder(upem, isTTF=True)
    fb.setupGlyphOrder([".notdef", "A", "B"])
    fb.setupCharacterMap({0x41: "A", 0x42: "B"})
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.lineTo((0, 700))
    pen.lineTo((500, 700))
    pen.lineTo((500, 0))
    pen.closePath()
    solid = pen.glyph()
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "A": solid, "B": solid})
    fb.setupHorizontalMetrics(
        {".notdef": (600, 0), "A": (advance_a, 0), "B": (650, 0)}
    )
    fb.setupHorizontalHeader(ascent=hhea[0], descent=hhea[1], lineGap=hhea[2])
    fb.setupNameTable(
        {
            "familyName": family,
            "styleName": "Regular",
            "psName": family.replace(" ", "") + "-Regular",
        }
    )
    fb.setupOS2(
        version=4,
        sTypoAscender=typo[0],
        sTypoDescender=typo[1],
        sTypoLineGap=typo[2],
        usWinAscent=abs(hhea[0]),
        usWinDescent=abs(hhea[1]),
        usWeightClass=400,
        fsSelection=((1 << 6) | USE_TYPO_METRICS) if use_typo else (1 << 6),
    )
    fb.setupPost()
    buf = io.BytesIO()
    fb.save(buf)
    return buf.getvalue()


@pytest.fixture
def synthetic_dir(tmp_path: Path) -> Path:
    (tmp_path / "TypoMetrics-Regular.ttf").write_bytes(
        _synthetic("Fixture Typo", use_typo=True)
    )
    (tmp_path / "HheaMetrics-Regular.ttf").write_bytes(
        _synthetic("Fixture Hhea", use_typo=False)
    )
    return tmp_path


# ---------------------------------------------------------------------------
# 1-2. Glyph coverage — MissingGlyphError, never .notdef
# ---------------------------------------------------------------------------


def test_has_glyph_false_for_absent_codepoint(registry: FontRegistry):
    face = registry.resolve("Source Serif 4", 400, "normal")
    assert face.has_glyph(ord("A")) is True
    # Devanagari KA is not in a Latin text face.
    assert face.has_glyph(0x0915) is False


def test_missing_glyph_raises_rather_than_returning_notdef(registry: FontRegistry):
    face = registry.resolve("Source Serif 4", 400, "normal")
    with pytest.raises(MissingGlyphError) as exc:
        face.glyph_id(0x0915)
    assert exc.value.codepoint == 0x0915
    assert "Source Serif 4" in str(exc.value)


def test_glyph_id_never_returns_zero_for_a_covered_codepoint(registry: FontRegistry):
    face = registry.resolve("Noto Serif Devanagari", 400, "normal")
    gid = face.glyph_id(0x0915)  # क
    assert gid != 0, "glyph id 0 is .notdef — it must never be returned as a hit"


def test_devanagari_face_covers_devanagari(registry: FontRegistry):
    face = registry.resolve("Noto Serif Devanagari", 400, "normal")
    for ch in "कषत्रियज्ञान":
        assert face.has_glyph(ord(ch)), f"{ch!r} missing from Noto Serif Devanagari"


# ---------------------------------------------------------------------------
# 3. advance_mm
# ---------------------------------------------------------------------------


def test_advance_mm_matches_hand_computed_value(registry: FontRegistry):
    """Static face, so hmtx is unambiguous and the check is independent."""
    face = registry.resolve("Mukta", 400, "normal")
    raw = TTFont(face.path, lazy=True)
    upem = raw["head"].unitsPerEm
    gid = face.glyph_id(ord("A"))
    glyph_name = raw.getGlyphOrder()[gid]
    units = raw["hmtx"][glyph_name][0]
    raw.close()

    size_pt = 10.0
    expected = (units / upem) * size_pt * MM_PER_PT
    assert face.advance_mm(gid, size_pt) == pytest.approx(expected, abs=1e-9)


def test_advance_mm_scales_linearly_with_size(registry: FontRegistry):
    face = registry.resolve("Mukta", 400, "normal")
    gid = face.glyph_id(ord("A"))
    assert face.advance_mm(gid, 20.0) == pytest.approx(
        2 * face.advance_mm(gid, 10.0), rel=1e-12
    )


def test_advance_mm_of_synthetic_face_is_exact(synthetic_dir: Path):
    """Pins the unit conversion against a face whose advance we chose."""
    reg = FontRegistry()
    reg.register_dir(synthetic_dir)
    face = reg.resolve("Fixture Typo", 400, "normal")
    gid = face.glyph_id(ord("A"))
    # 600/1000 em at 12pt = 7.2pt = 7.2 * 25.4/72 mm = 2.54mm
    assert face.advance_mm(gid, 12.0) == pytest.approx(2.54, abs=1e-9)


# ---------------------------------------------------------------------------
# 4 + 8. Vertical metrics
# ---------------------------------------------------------------------------

# Regression lock: ascent / descent / ink_ascent as a multiple of the em,
# measured from the RESOLVED FACE at weight 400 — not from raw file inspection.
# The two differ, for two reasons worth remembering:
#
#   1. Instancing moves ink. Source Sans 3's default instance is wght=200, so
#      resolving at 400 thickens the glyphs and raises yMax from 0.934 to 0.958.
#      Archivo defaults to wght=600 and moves the other way.
#   2. ink_ascent is max(head.yMax, usWinAscent), so a face that under-reports
#      one still reserves enough room.
#
# These are the numbers every baseline depends on. A change here means either a
# font was updated or the metric logic moved; both need a human to look.
EXPECTED_METRICS: dict[tuple[str, int, str], tuple[float, float, float]] = {
    ("Archivo", 400, "normal"): (0.878, -0.210, 1.100),
    ("Archivo Narrow", 400, "normal"): (1.035, -0.312, 1.050),
    ("Mukta", 400, "normal"): (1.130, -0.532, 1.130),
    ("Noto Sans Devanagari", 400, "normal"): (0.896, -0.408, 1.348),
    ("Noto Serif Devanagari", 400, "normal"): (0.930, -0.625, 1.407),
    ("Source Sans 3", 400, "normal"): (1.024, -0.400, 0.958),
    ("Source Serif 4", 400, "normal"): (1.036, -0.335, 1.009),
    ("Tiro Devanagari Hindi", 400, "normal"): (0.755, -0.245, 1.091),
}


@pytest.mark.parametrize(("key", "expected"), sorted(EXPECTED_METRICS.items()))
def test_vertical_metrics_are_regression_locked(
    registry: FontRegistry,
    key: tuple[str, int, str],
    expected: tuple[float, float, float],
):
    family, weight, style = key
    exp_asc, exp_desc, exp_ink = expected
    face = registry.resolve(family, weight, style)

    # Fields are per 1pt; a 1pt em is MM_PER_PT mm, so divide to get em units.
    asc_em = face.ascent_mm_at_1pt / MM_PER_PT
    desc_em = face.descent_mm_at_1pt / MM_PER_PT
    ink_em = face.ink_ascent_mm_at_1pt / MM_PER_PT

    assert asc_em == pytest.approx(exp_asc, abs=0.001), f"{family} ascent drifted"
    assert desc_em == pytest.approx(exp_desc, abs=0.001), f"{family} descent drifted"
    assert ink_em == pytest.approx(exp_ink, abs=0.001), f"{family} ink ascent drifted"


def test_descent_is_negative_below_the_baseline(registry: FontRegistry):
    """Sign convention: the font's own, so line box = ascent - descent + gap."""
    for family in ("Source Serif 4", "Noto Serif Devanagari", "Mukta"):
        face = registry.resolve(family, 400, "normal")
        assert face.descent_mm_at_1pt < 0, f"{family} descent should be negative"
        assert face.ascent_mm_at_1pt > 0


# Measured overflow of ink above the rhythm ascent, in em, at weight 400.
# Five of eight families overflow — this is NOT a Devanagari-only concern,
# though it is worst there and invisible there.
INK_OVERFLOW_EM = {
    "Noto Serif Devanagari": +0.477,
    "Noto Sans Devanagari": +0.452,
    "Tiro Devanagari Hindi": +0.336,
    "Archivo": +0.222,
    "Archivo Narrow": +0.015,
    "Mukta": +0.000,
    "Source Sans 3": -0.066,
    "Source Serif 4": -0.027,
}


@pytest.mark.parametrize(("family", "expected"), sorted(INK_OVERFLOW_EM.items()))
def test_ink_overflow_above_rhythm_ascent_is_locked(
    registry: FontRegistry, family: str, expected: float
):
    """The finding that justifies carrying two metric pairs.

    In Noto Serif Devanagari the repha reaches 1.407 em against a 0.930 em
    declared ascent. Leading set from the rhythm ascent alone puts that ink
    0.477 em into the line above — the shirorekha collision, invisible to a
    reader who cannot read the script.

    Locked per family, including the *negative* cases, so a later
    "simplification" back to one metric pair fails loudly, and so nobody
    concludes from a Devanagari-only test that Latin is exempt. Archivo
    overflows by 0.222 em.
    """
    face = registry.resolve(family, 400, "normal")
    overflow = (face.ink_ascent_mm_at_1pt - face.ascent_mm_at_1pt) / MM_PER_PT
    assert overflow == pytest.approx(expected, abs=0.001), (
        f"{family}: ink overflow moved — if the font was updated, re-measure "
        f"and check the leading policy before changing this number"
    )


def test_min_baseline_gap_exceeds_line_box_where_ink_overflows(
    registry: FontRegistry,
):
    """The two helpers must disagree exactly where the collision risk lives."""
    face = registry.resolve("Noto Serif Devanagari", 400, "normal")
    assert face.min_baseline_gap_mm(10.0) > face.line_box_mm(10.0)

    safe = registry.resolve("Source Serif 4", 400, "normal")
    assert safe.min_baseline_gap_mm(10.0) <= safe.line_box_mm(10.0)


def test_line_box_is_the_single_source_of_line_height(registry: FontRegistry):
    face = registry.resolve("Source Serif 4", 400, "normal")
    manual = (
        face.ascent_mm_at_1pt - face.descent_mm_at_1pt + face.line_gap_mm_at_1pt
    ) * 12.0
    assert face.line_box_mm(12.0) == pytest.approx(manual, rel=1e-12)


# ---------------------------------------------------------------------------
# 7. The typo/hhea branch — synthetic, because no real font exercises it
# ---------------------------------------------------------------------------


def test_use_typo_metrics_bit_selects_typo_ascender(synthetic_dir: Path):
    reg = FontRegistry()
    reg.register_dir(synthetic_dir)
    face = reg.resolve("Fixture Typo", 400, "normal")

    assert face.metric_source == "typo"
    assert face.ascent_mm_at_1pt / MM_PER_PT == pytest.approx(0.900, abs=1e-9)
    assert face.descent_mm_at_1pt / MM_PER_PT == pytest.approx(-0.300, abs=1e-9)
    assert face.line_gap_mm_at_1pt / MM_PER_PT == pytest.approx(0.100, abs=1e-9)


def test_use_typo_metrics_clear_falls_back_to_hhea(synthetic_dir: Path):
    reg = FontRegistry()
    reg.register_dir(synthetic_dir)
    face = reg.resolve("Fixture Hhea", 400, "normal")

    assert face.metric_source == "hhea"
    assert face.ascent_mm_at_1pt / MM_PER_PT == pytest.approx(0.750, abs=1e-9)
    assert face.descent_mm_at_1pt / MM_PER_PT == pytest.approx(-0.250, abs=1e-9)
    assert face.line_gap_mm_at_1pt / MM_PER_PT == pytest.approx(0.0, abs=1e-9)


def test_metric_source_recorded_for_every_committed_font(registry: FontRegistry):
    """Only Mukta has USE_TYPO_METRICS clear; the rest set it."""
    assert registry.resolve("Mukta", 400, "normal").metric_source == "hhea"
    for family in ("Source Serif 4", "Archivo", "Noto Serif Devanagari"):
        assert registry.resolve(family, 400, "normal").metric_source == "typo"


# ---------------------------------------------------------------------------
# 5. Subsetting
# ---------------------------------------------------------------------------


def test_subset_bytes_contains_exactly_the_requested_glyphs(registry: FontRegistry):
    """With closure off, the subset is exactly `.notdef` plus what was asked."""
    face = registry.resolve("Source Serif 4", 400, "normal")
    wanted = {face.glyph_id(ord(c)) for c in "Hello"}
    data = face.subset_bytes(wanted, closure=False)

    sub = TTFont(io.BytesIO(data), lazy=True)
    # retain_gids=False compacts the order, so count rather than compare ids:
    # .notdef is always kept, plus one glyph per requested id.
    assert sub.getGlyphOrder()[0] == ".notdef"
    assert len(sub.getGlyphOrder()) == len(wanted) + 1
    sub.close()


def test_subset_closure_keeps_glyphs_reachable_through_layout(
    registry: FontRegistry,
):
    """With closure on the set grows, and that is the point.

    Substitution targets must survive or the shaped output references glyphs the
    embedded font does not contain.
    """
    face = registry.resolve("Source Serif 4", 400, "normal")
    wanted = {face.glyph_id(ord(c)) for c in "Hello"}
    closed = TTFont(io.BytesIO(face.subset_bytes(wanted, closure=True)), lazy=True)
    exact = TTFont(io.BytesIO(face.subset_bytes(wanted, closure=False)), lazy=True)

    assert len(closed.getGlyphOrder()) > len(exact.getGlyphOrder())
    for name in exact.getGlyphOrder():
        assert name in closed.getGlyphOrder(), "closure dropped a requested glyph"
    closed.close()
    exact.close()


def test_subset_bytes_is_a_loadable_font(registry: FontRegistry):
    face = registry.resolve("Source Serif 4", 400, "normal")
    data = face.subset_bytes({face.glyph_id(ord("A"))})
    assert data[:4] in (b"\x00\x01\x00\x00", b"true", b"ttcf", b"OTTO")
    TTFont(io.BytesIO(data), lazy=True).close()


def test_subset_of_devanagari_retains_shaping_tables(registry: FontRegistry):
    """A subset that drops GSUB shapes correctly alone and wrongly in the PDF."""
    face = registry.resolve("Noto Serif Devanagari", 400, "normal")
    gids = {face.glyph_id(ord(c)) for c in "कषत्रिय"}
    data = face.subset_bytes(gids)
    sub = TTFont(io.BytesIO(data), lazy=True)
    assert "GSUB" in sub, "GSUB dropped — conjuncts cannot be formed"
    sub.close()


def test_subset_head_timestamp_is_not_recalculated(registry: FontRegistry):
    """The precise guard. INVARIANT 3.

    fontTools stamps the current clock reading into `head.modified` on save
    unless told not to, which made subset output differ run to run. The earlier
    version of this test called `subset_bytes` twice back to back, so both
    landed in the same second and it passed while the bug was live — a green
    determinism test sitting on top of time-derived output.

    Asserting the timestamp is *inherited from the source* catches it in
    microseconds rather than depending on crossing a second boundary.
    """
    face = registry.resolve("Mukta", 400, "normal")  # static: no instancing
    source = TTFont(face.path, lazy=True)["head"].modified
    gids = {face.glyph_id(ord(c)) for c in "Hello"}
    subset = TTFont(io.BytesIO(face.subset_bytes(gids)), lazy=True)["head"].modified
    assert subset == source, (
        "head.modified was recalculated — pass recalcTimestamp=False"
    )


def test_subset_bytes_is_deterministic_across_a_second_boundary(
    registry: FontRegistry,
):
    """The blunt version, which the timestamp fix above is what makes pass."""
    face = registry.resolve("Source Serif 4", 400, "normal")
    gids = {face.glyph_id(ord(c)) for c in "Hello"}
    first = face.subset_bytes(gids)
    time.sleep(1.05)
    assert face.subset_bytes(gids) == first


def test_instance_bytes_are_identical_across_registries():
    """Two registries built seconds apart must produce byte-identical
    instances, because `font_id` promises exactly that."""
    a = FontRegistry()
    a.register_dir(LATIN)
    first = a.resolve("Archivo", 400, "normal")
    time.sleep(1.05)
    b = FontRegistry()
    b.register_dir(LATIN)
    second = b.resolve("Archivo", 400, "normal")

    assert first.font_id == second.font_id
    assert first._instance_bytes == second._instance_bytes, (
        "same font_id, different bytes — font_id is a promise the bytes break"
    )


def test_subset_with_map_returns_the_gid_remap(registry: FontRegistry):
    """retain_gids=False renumbers; GlyphRun holds original ids (§2.2)."""
    face = registry.resolve("Noto Serif Devanagari", 400, "normal")
    wanted = {face.glyph_id(ord(c)) for c in "कषत्रिय"}
    data, gid_map = face.subset_with_map(wanted)

    assert set(gid_map) == wanted, "every requested gid needs a mapping"
    assert all(new != 0 for new in gid_map.values()), "nothing may map to .notdef"

    sub = TTFont(io.BytesIO(data), lazy=True)
    order = sub.getGlyphOrder()
    for old, new in gid_map.items():
        assert order[new] == face._glyph_order[old], (
            f"gid {old} -> {new} points at the wrong glyph"
        )
    sub.close()


# ---------------------------------------------------------------------------
# 6. font_id stability
# ---------------------------------------------------------------------------


def test_font_id_is_identical_across_registry_instances():
    a, b = FontRegistry(), FontRegistry()
    a.register_dir(ASSETS)
    b.register_dir(ASSETS)
    assert (
        a.resolve("Source Serif 4", 400, "normal").font_id
        == b.resolve("Source Serif 4", 400, "normal").font_id
    )


def test_font_id_changes_when_the_binary_changes(tmp_path: Path):
    src = LATIN / "ArchivoNarrow[wght].ttf"
    first = tmp_path / "a"
    second = tmp_path / "b"
    first.mkdir()
    second.mkdir()
    data = src.read_bytes()
    (first / src.name).write_bytes(data)
    # Flip one byte in the middle — enough to change the digest, and we only
    # read metadata, so the file still parses.
    mutated = bytearray(data)
    mutated[len(mutated) // 2] ^= 0x01
    (second / src.name).write_bytes(bytes(mutated))

    ra, rb = FontRegistry(), FontRegistry()
    ra.register_dir(first)
    rb.register_dir(second)
    assert (
        ra.resolve("Archivo Narrow", 400, "normal").font_id
        != rb.resolve("Archivo Narrow", 400, "normal").font_id
    )


def test_font_id_survives_a_touch(tmp_path: Path):
    """mtime, inode and path must not participate in the derivation."""
    src = LATIN / "ArchivoNarrow[wght].ttf"
    (tmp_path / src.name).write_bytes(src.read_bytes())

    reg_a = FontRegistry()
    reg_a.register_dir(tmp_path)
    before = reg_a.resolve("Archivo Narrow", 400, "normal").font_id

    (tmp_path / src.name).touch()
    reg_b = FontRegistry()
    reg_b.register_dir(tmp_path)
    assert reg_b.resolve("Archivo Narrow", 400, "normal").font_id == before


def test_font_id_differs_per_variable_instance(registry: FontRegistry):
    """Two instances that shape differently must not share an id."""
    light = registry.resolve("Archivo", 300, "normal")
    bold = registry.resolve("Archivo", 700, "normal")
    assert light.font_id != bold.font_id
    assert light.path == bold.path, "same file, different instance"


def test_font_id_differs_between_roman_and_italic(registry: FontRegistry):
    roman = registry.resolve("Archivo Narrow", 400, "normal")
    italic = registry.resolve("Archivo Narrow", 400, "italic")
    assert roman.font_id != italic.font_id
    assert roman.path != italic.path


def test_face_lookup_by_font_id_round_trips(registry: FontRegistry):
    face = registry.resolve("Source Sans 3", 600, "normal")
    assert registry.face(face.font_id) is face


# ---------------------------------------------------------------------------
# 9-10. Determinism (INVARIANT 3)
# ---------------------------------------------------------------------------


def test_register_dir_is_order_independent(tmp_path: Path):
    """`Path.rglob` order is filesystem-dependent; registration must not be."""
    names = [
        "ArchivoNarrow[wght].ttf",
        "ArchivoNarrow-Italic[wght].ttf",
        "SourceSans3[wght].ttf",
    ]
    forward = tmp_path / "forward"
    reverse = tmp_path / "reverse"
    for d in (forward, reverse):
        d.mkdir()
    for i, name in enumerate(names):
        (forward / f"{i}_{name}").write_bytes((LATIN / name).read_bytes())
    for i, name in enumerate(reversed(names)):
        (reverse / f"{i}_{name}").write_bytes((LATIN / name).read_bytes())

    a, b = FontRegistry(), FontRegistry()
    a.register_dir(forward)
    b.register_dir(reverse)
    assert sorted(a.font_ids()) == sorted(b.font_ids())
    assert (
        a.resolve("Archivo Narrow", 400, "normal").font_id
        == b.resolve("Archivo Narrow", 400, "normal").font_id
    )


def test_resolve_is_deterministic_with_duplicate_candidates(tmp_path: Path):
    """Two byte-identical files under different names must resolve stably."""
    src = LATIN / "ArchivoNarrow[wght].ttf"
    data = src.read_bytes()
    (tmp_path / "aaa.ttf").write_bytes(data)
    (tmp_path / "zzz.ttf").write_bytes(data)

    seen = set()
    for _ in range(5):
        reg = FontRegistry()
        reg.register_dir(tmp_path)
        seen.add(reg.resolve("Archivo Narrow", 400, "normal").font_id)
    assert len(seen) == 1, "resolve() picked different faces across runs"


def test_repeated_resolve_returns_the_same_object(registry: FontRegistry):
    """Faces are cached — building HarfBuzz handles per call would be slow."""
    assert registry.resolve("Mukta", 400, "normal") is registry.resolve(
        "Mukta", 400, "normal"
    )


# ---------------------------------------------------------------------------
# Resolution rules
# ---------------------------------------------------------------------------


def test_family_comes_from_typographic_name_not_the_default_instance():
    """nameID 1 of Archivo[wdth,wght].ttf is 'Archivo SemiBold' (default wght
    600). Registering under that would make resolve('Archivo', ...) fail."""
    reg = FontRegistry()
    reg.register_dir(LATIN)
    assert "Archivo" in reg.families()
    assert "Archivo SemiBold" not in reg.families()
    assert "Source Sans 3" in reg.families()
    assert "Source Sans 3 ExtraLight" not in reg.families()


def test_variable_font_serves_any_weight_in_its_axis_range(registry: FontRegistry):
    for weight in (100, 400, 700, 900):
        face = registry.resolve("Archivo", weight, "normal")
        assert face.axes["wght"] == pytest.approx(float(weight))


def test_weight_is_clamped_to_the_axis_range(registry: FontRegistry):
    """Archivo Narrow's wght axis is 400..700; 900 must clamp, not explode."""
    face = registry.resolve("Archivo Narrow", 900, "normal")
    assert face.axes["wght"] == pytest.approx(700.0)


def test_static_family_picks_the_nearest_weight(registry: FontRegistry):
    """Mukta ships 300/400/600/700."""
    assert registry.resolve("Mukta", 700, "normal").path.name == "Mukta-Bold.ttf"
    assert registry.resolve("Mukta", 300, "normal").path.name == "Mukta-Light.ttf"
    assert registry.resolve("Mukta", 620, "normal").path.name == "Mukta-SemiBold.ttf"


def test_unknown_family_raises(registry: FontRegistry):
    with pytest.raises(KeyError, match="Nonexistent"):
        registry.resolve("Nonexistent Family", 400, "normal")


def test_unknown_font_id_raises(registry: FontRegistry):
    with pytest.raises(KeyError):
        registry.face("fnt_0000000000000000")


def test_all_sixteen_committed_faces_register(registry: FontRegistry):
    assert len(registry.font_files()) == 16
    assert len(registry.families()) == 8


# ---------------------------------------------------------------------------
# HarfBuzz wiring (M1.2 depends on this being right)
# ---------------------------------------------------------------------------


def test_hb_font_scale_is_units_per_em(registry: FontRegistry):
    """Spec §M1.2: positions must come back in font units.

    HarfBuzz's own scaling rounds to 26.6 fixed point, which accumulates as
    sub-millimetre drift and surfaces at M4 as the canvas and the PDF
    disagreeing.
    """
    face = registry.resolve("Source Serif 4", 400, "normal")
    assert face.hb_font.scale == (face.units_per_em, face.units_per_em)


def test_native_handles_are_cached(registry: FontRegistry):
    face = registry.resolve("Source Serif 4", 400, "normal")
    assert face.hb_font is face.hb_font
    assert face.ft_face is face.ft_face


def test_face_is_not_a_pydantic_model():
    """It holds native HarfBuzz and FreeType handles; noting so it is not
    "fixed" for consistency with the schemas later."""
    assert not hasattr(FontFace, "model_validate")


# ---------------------------------------------------------------------------
# Fallback honesty — a face must not claim to be something it is not
# ---------------------------------------------------------------------------


def test_face_never_claims_a_style_it_does_not_have(registry: FontRegistry):
    """Noto Serif Devanagari ships no italic.

    Returning the roman while reporting style="italic" would have the face
    assert something false about itself, which preflight could never catch.
    """
    face = registry.resolve("Noto Serif Devanagari", 400, "italic")
    assert face.style == "normal", "delivered style must be the truth"


def test_resolution_report_records_the_style_substitution(registry: FontRegistry):
    got = registry.describe_resolution("Noto Serif Devanagari", 400, "italic")
    assert got.face.style == "normal"
    assert got.requested_style == "italic"
    assert got.style_substituted is True
    assert got.is_fallback is True
    assert "requested 400 italic, got 400 normal" in got.describe()


def test_resolution_report_records_the_weight_substitution(registry: FontRegistry):
    got = registry.describe_resolution("Mukta", 620, "normal")
    assert got.face.path.name == "Mukta-SemiBold.ttf"
    assert got.face.weight == 600, "delivered weight must be the truth"
    assert got.requested_weight == 620
    assert got.weight_substituted is True


def test_exact_match_is_not_flagged_as_a_fallback(registry: FontRegistry):
    got = registry.describe_resolution("Mukta", 700, "normal")
    assert got.is_fallback is False
    assert got.describe() == "Mukta 700 normal"


def test_font_id_keys_on_the_delivered_face_not_the_request(
    registry: FontRegistry,
):
    """Mukta has no 620; 600 and 620 reach the same file at the same instance.

    Separate ids would build two HarfBuzz handles and embed one font twice.
    """
    assert (
        registry.resolve("Mukta", 620, "normal").font_id
        == registry.resolve("Mukta", 600, "normal").font_id
    )


def test_register_dir_is_idempotent(registry: FontRegistry):
    before = len(registry.font_files())
    registry.register_dir(ASSETS)
    assert len(registry.font_files()) == before


def test_missing_glyph_error_survives_an_impossible_codepoint():
    """An error constructor that itself throws replaces a precise diagnostic
    with a confusing one. chr() raises above U+10FFFF."""
    err = MissingGlyphError(0x110000, "fnt_x", "Some Family")
    assert "U+110000" in str(err)
    assert err.codepoint == 0x110000
