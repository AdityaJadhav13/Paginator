"""FontRegistry and FontFace — M1.1, spec §M1.1.

Every measurement the typesetter makes starts here. Two things in this module
are load-bearing beyond their apparent size:

**Two metric pairs, not one.** The spec says to take vertical metrics from OS/2
`sTypo*` where `USE_TYPO_METRICS` is set and `hhea` otherwise. That is right for
*rhythm* — leading and the baseline grid — and insufficient for *collision*.
Measured across the 16 committed faces at weight 400, ink rises above the
declared ascent in five of the eight families:

    Noto Serif Devanagari  ascent 0.930  ink 1.407  +0.477 em
    Noto Sans Devanagari   ascent 0.896  ink 1.348  +0.452
    Tiro Devanagari Hindi  ascent 0.755  ink 1.091  +0.336
    Archivo                ascent 0.878  ink 1.100  +0.222   <- Latin
    Archivo Narrow         ascent 1.035  ink 1.050  +0.015   <- Latin
    Mukta                  ascent 1.130  ink 1.130  +0.000
    Source Sans 3          ascent 1.024  ink 0.958  -0.066
    Source Serif 4         ascent 1.036  ink 1.009  -0.027

This is **not a Devanagari-only concern** — Archivo overflows by 0.222 em.

But those maxima are set by glyphs that never reach a newspaper: Vedic
Extensions (U+A8E0-A8FF) for Noto Serif Devanagari, `Ǻ` and stacked Vietnamese
diacritics for Archivo. Measuring the *positioned* ink of real copy — conjuncts,
reph plus matra stacks, candrabindu — tops out at 0.898 em, inside the 0.930 em
declared ascent. So the face-level ink pair is an **upper bound for preflight,
not a leading default**: as leading it reserves 7.758 mm where 2.226 mm is
needed at 10pt, which is two thirds of the news hole.

Collision is therefore rare and input-dependent, and is measured per line after
shaping — `glyph_ink_mm()` plus each glyph's GPOS `y_offset`, aggregated into
`ResolvedLine.ascent_mm`. Use `line_box_mm()` for rhythm, `glyph_ink_mm()` for
what a specific line actually needs, and `min_baseline_gap_mm()` only to ask
whether a face could *ever* collide at a given leading.

**One instance, one source of truth.** A variable font is instantiated once, and
the resulting bytes feed HarfBuzz, FreeType, metrics, and PDF subsetting alike.
Letting HarfBuzz apply variations while the embedded PDF font carried the
default instance would put a second text engine in the pipeline by the back
door — the exact failure this architecture exists to prevent.
"""

from __future__ import annotations

import hashlib
import io
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Literal

import uharfbuzz as hb
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

from ..errors import MissingGlyphError
from ..geometry import MM_PER_PT
from ..ids import stable_id

__all__ = ["FontFace", "FontRegistry", "FontResolution", "FontStyle"]

FontStyle = Literal["normal", "italic"]
MetricSource = Literal["typo", "hhea"]

_FONT_SUFFIXES = (".ttf", ".otf")
_USE_TYPO_METRICS = 1 << 7
_ITALIC = 1 << 0
_NOTDEF = 0

# Axes pinned at resolve() time.
#
# `opsz` is deliberately NOT pinned, and this is a known limitation rather than
# a deferral: M1.2's earlier comment claimed shaping would pin it and shaping
# does not. Source Serif 4 therefore renders 8pt agate and 48pt headlines from
# its 20pt optical instance.
#
# Pinning it is not free. `font_id` is derived from `axes_repr`, so a
# size-dependent axis makes the id size-dependent too — one face per size, more
# HarfBuzz handles, and one embedded PDF subset per size at M10. It also
# reopens the "does font_id uniquely name its bytes" question that M1.1 closed.
# Decide deliberately at M1.5, where size and frame are both in scope.
_RESOLVED_AXES = ("wght", "wdth")


class FontFace:
    """One resolved, immutable font instance.

    Not a Pydantic model — it owns native HarfBuzz and FreeType handles, which
    do not serialise. `font_id` is the value that crosses schema boundaries.
    """

    __slots__ = (
        "__dict__",  # for cached_property
        "_ink_cache",
        "_instance_bytes",
        "ascent_mm_at_1pt",
        "axes",
        "descent_mm_at_1pt",
        "family",
        "font_id",
        "ink_ascent_mm_at_1pt",
        "ink_descent_mm_at_1pt",
        "line_gap_mm_at_1pt",
        "metric_source",
        "path",
        "style",
        "units_per_em",
        "weight",
    )

    def __init__(
        self,
        *,
        font_id: str,
        path: Path,
        family: str,
        weight: int,
        style: FontStyle,
        axes: Mapping[str, float],
        instance_bytes: bytes,
    ) -> None:
        self.font_id = font_id
        self.path = path
        self.family = family
        # `weight` and `style` are what this face ACTUALLY IS, never what some
        # caller asked for. A face returned for an unavailable italic must not
        # report itself as italic: preflight could never catch the lie, and the
        # face is shared between callers anyway. What was *requested* belongs to
        # the request — see `FontRegistry.describe_resolution`.
        self.weight = weight
        self.style: FontStyle = style
        self.axes: Mapping[str, float] = dict(axes)
        self._instance_bytes = instance_bytes
        self._ink_cache: dict[int, tuple[int, int]] = {}

        font = TTFont(io.BytesIO(instance_bytes), lazy=True)
        os2, hhea, head = font["OS/2"], font["hhea"], font["head"]
        upem = int(head.unitsPerEm)
        self.units_per_em = upem

        use_typo = bool(int(os2.fsSelection) & _USE_TYPO_METRICS)
        self.metric_source: MetricSource = "typo" if use_typo else "hhea"
        if use_typo:
            asc, desc, gap = (
                int(os2.sTypoAscender),
                int(os2.sTypoDescender),
                int(os2.sTypoLineGap),
            )
        else:
            asc, desc, gap = int(hhea.ascent), int(hhea.descent), int(hhea.lineGap)

        # Per 1pt: one em at 1pt is MM_PER_PT mm.
        per_unit = MM_PER_PT / upem
        self.ascent_mm_at_1pt = asc * per_unit
        self.descent_mm_at_1pt = desc * per_unit
        self.line_gap_mm_at_1pt = gap * per_unit

        # Ink extent — what actually gets drawn. head yMax/yMin is the union of
        # all glyph bounding boxes; usWinAscent/Descent is the same intent
        # expressed by the designer. Take the larger of the two so a face that
        # under-reports one still reserves enough room.
        ink_up = max(int(head.yMax), int(os2.usWinAscent))
        ink_down = min(int(head.yMin), -int(os2.usWinDescent))
        self.ink_ascent_mm_at_1pt = ink_up * per_unit
        self.ink_descent_mm_at_1pt = ink_down * per_unit
        font.close()

    # -- native handles, built once ----------------------------------------

    @cached_property
    def _tt(self) -> TTFont:
        return TTFont(io.BytesIO(self._instance_bytes), lazy=True)

    @cached_property
    def hb_font(self) -> hb.Font:
        """HarfBuzz font with scale pinned to units_per_em.

        Positions therefore come back in font units and *we* convert. HarfBuzz's
        own scaling rounds to 26.6 fixed point; that error accumulates across a
        line and surfaces at M4 as the canvas and the PDF disagreeing.
        """
        face = hb.Face(self._instance_bytes)
        font = hb.Font(face)
        font.scale = (self.units_per_em, self.units_per_em)
        return font

    @cached_property
    def ft_face(self) -> object:
        import freetype

        return freetype.Face(io.BytesIO(self._instance_bytes))

    @cached_property
    def _cmap(self) -> Mapping[int, str]:
        return dict(self._tt.getBestCmap())

    @cached_property
    def _glyph_order(self) -> list[str]:
        return list(self._tt.getGlyphOrder())

    @cached_property
    def _glyph_index(self) -> Mapping[str, int]:
        return {name: i for i, name in enumerate(self._glyph_order)}

    @cached_property
    def _hmtx(self) -> Mapping[str, tuple[int, int]]:
        return dict(self._tt["hmtx"].metrics)

    # -- public API ---------------------------------------------------------

    def has_glyph(self, codepoint: int) -> bool:
        return codepoint in self._cmap

    def glyph_id(self, codepoint: int) -> int:
        """Glyph id for a codepoint, or raise.

        Never returns `.notdef`. A missing glyph prints as `□`, which is
        invisible to anyone who cannot read the script and therefore reaches the
        page unchallenged — so it fails loudly here instead.
        """
        name = self._cmap.get(codepoint)
        if name is None:
            raise MissingGlyphError(codepoint, self.font_id, self.family)
        gid = self._glyph_index.get(name, _NOTDEF)
        if gid == _NOTDEF:
            raise MissingGlyphError(codepoint, self.font_id, self.family)
        return gid

    def line_box_mm(self, size_pt: float) -> float:
        """Rhythm line height: ascent − descent + line gap, at `size_pt`.

        One place computes this. Every caller recombining the three fields by
        hand would be a second source of truth for line height, in a project
        whose thesis is that there is exactly one.
        """
        return (
            self.ascent_mm_at_1pt - self.descent_mm_at_1pt + self.line_gap_mm_at_1pt
        ) * size_pt

    def min_baseline_gap_mm(self, size_pt: float) -> float:
        """Absolute worst-case baseline gap for this face. NOT a leading default.

        This is the gap that would keep *any* glyph in the font clear of the
        line above, and the maximum is set by glyphs that never occur in news
        copy: for Noto Serif Devanagari it is the Vedic Extensions
        (U+A8E0-A8FF, liturgical Sanskrit); for Archivo it is stacked Latin
        diacritics. Real copy — conjuncts, reph plus matra stacks, candrabindu —
        measures 0.898 em against a 0.930 em declared ascent, i.e. it fits.

        Used as a leading default this reserves 7.758 mm where 2.226 mm is
        needed at 10pt: **248% over, roughly two thirds of the news hole.**

        Use it only as an upper bound — "could this face ever collide at this
        leading?". For the real question, "does *this line* collide?", measure
        the positioned ink of the glyphs actually on the line via
        `glyph_ink_mm` plus each glyph's GPOS y_offset. Collision is rare and
        input-dependent, so it is reported per line, never pre-paid globally.
        """
        return (self.ink_ascent_mm_at_1pt - self.ink_descent_mm_at_1pt) * size_pt

    def glyph_ink_mm(self, glyph_id: int, size_pt: float) -> tuple[float, float]:
        """`(top, bottom)` ink extent of one glyph in mm, relative to the baseline.

        Cached per glyph id: the underlying HarfBuzz call is ~242 ns and this
        makes it ~82 ns, which keeps a 5000-word story's ink measurement at
        about 1% of A10's 250 ms budget.

        This is the glyph's own bounding box. A mark's ink *position* also
        depends on its GPOS placement, so callers must add the shaped
        `y_offset` — a matra's box is identical wherever it lands, and only the
        offset says whether it clears the line above.
        """
        top_units, bottom_units = self._glyph_ink_units(glyph_id)
        scale = size_pt * MM_PER_PT / self.units_per_em
        return top_units * scale, bottom_units * scale

    def _glyph_ink_units(self, glyph_id: int) -> tuple[int, int]:
        cached = self._ink_cache.get(glyph_id)
        if cached is None:
            extents = self.hb_font.get_glyph_extents(glyph_id)
            if extents is None:  # no outline: spaces, marks with no ink
                cached = (0, 0)
            else:
                # HarfBuzz y_bearing is the top; height extends downward and is
                # therefore negative.
                top = extents.y_bearing
                cached = (top, top + extents.height)
            self._ink_cache[glyph_id] = cached
        return cached

    def advance_mm(self, glyph_id: int, size_pt: float) -> float:
        """Unkerned horizontal advance in millimetres.

        Read from `hmtx` as exact integers rather than through FreeType, whose
        26.6 fixed-point conversion would round before we scale.
        """
        name = self._glyph_order[glyph_id]
        units = self._hmtx[name][0]
        return (units / self.units_per_em) * size_pt * MM_PER_PT

    def _subset(
        self, glyph_ids: Iterable[int], *, closure: bool
    ) -> tuple[bytes, dict[int, int]]:
        """Subset by glyph id, returning the bytes and the old→new gid map.

        `closure=True` keeps every glyph reachable through layout tables, which
        is required for Devanagari: the conjunct forms are produced by GSUB from
        the base consonants, so dropping them yields correctly-subset nonsense.
        Pass `closure=False` only when the exact glyph set is already final.
        """
        wanted = sorted(set(glyph_ids))
        names = [self._glyph_order[g] for g in wanted]

        # recalcTimestamp=False: fontTools otherwise stamps the current clock
        # reading into head.modified on save, so the output differs run to run.
        # That breaks INVARIANT 3, and with it every golden PDF from M10.
        font = TTFont(io.BytesIO(self._instance_bytes), recalcTimestamp=False)
        options = subset.Options()
        options.retain_gids = False
        options.notdef_glyph = True
        options.notdef_outline = True
        options.recommended_glyphs = False
        options.layout_features = ["*"] if closure else []
        options.layout_closure = closure
        options.glyph_names = True
        options.hinting = True
        options.desubroutinize = False
        options.drop_tables = []

        subsetter = subset.Subsetter(options=options)
        subsetter.populate(glyphs=names)
        subsetter.subset(font)

        buf = io.BytesIO()
        font.save(buf)
        new_order = list(font.getGlyphOrder())
        font.close()

        index = {name: i for i, name in enumerate(new_order)}
        gid_map = {
            gid: index[self._glyph_order[gid]]
            for gid in wanted
            if self._glyph_order[gid] in index
        }
        return buf.getvalue(), gid_map

    def subset_bytes(self, glyph_ids: Iterable[int], *, closure: bool = True) -> bytes:
        """Subset by glyph id for PDF embedding. Spec §M1.1 signature."""
        return self._subset(glyph_ids, closure=closure)[0]

    def subset_with_map(
        self, glyph_ids: Iterable[int], *, closure: bool = True
    ) -> tuple[bytes, dict[int, int]]:
        """Subset, and return the old→new glyph id mapping alongside it.

        `retain_gids=False` renumbers glyphs, and closure renumbers them
        further. `GlyphRun.glyph_ids` (§2.2) holds ids in the *original* space,
        so whoever writes the PDF content stream must remap. Returning the map
        here means M10 cannot forget — a missed remap draws the wrong glyph,
        which survives every automated check and is caught only by a human
        reading the printed page.
        """
        return self._subset(glyph_ids, closure=closure)

    def __repr__(self) -> str:
        axes = ",".join(f"{k}={v:g}" for k, v in sorted(self.axes.items()))
        return (
            f"FontFace({self.family!r}, {self.weight}, {self.style!r}"
            f"{', ' + axes if axes else ''}, {self.font_id})"
        )


@dataclass(frozen=True)
class FontResolution:
    """What a caller asked for, and what they actually got.

    Separate from `FontFace` because faces are shared by `font_id`: the request
    is a property of the call, not of the font.
    """

    face: FontFace
    requested_weight: int
    requested_style: FontStyle

    @property
    def style_substituted(self) -> bool:
        return self.face.style != self.requested_style

    @property
    def weight_substituted(self) -> bool:
        return self.face.weight != self.requested_weight

    @property
    def is_fallback(self) -> bool:
        return self.style_substituted or self.weight_substituted

    def describe(self) -> str:
        if not self.is_fallback:
            return f"{self.face.family} {self.face.weight} {self.face.style}"
        return (
            f"{self.face.family}: requested {self.requested_weight} "
            f"{self.requested_style}, got {self.face.weight} {self.face.style}"
        )


class _Candidate:
    """A registered file, before any instance is resolved."""

    __slots__ = ("axes", "family", "file_sha", "italic", "path", "weight")

    def __init__(self, path: Path) -> None:
        self.path = path
        data = path.read_bytes()
        self.file_sha = hashlib.sha256(data).hexdigest()
        font = TTFont(io.BytesIO(data), lazy=True)
        name = font["name"]
        # nameID 16 (typographic family) before nameID 1: for a variable font
        # nameID 1 names the *default instance* — Archivo[wdth,wght].ttf reports
        # "Archivo SemiBold" there, which would make resolve("Archivo") fail.
        family = name.getDebugName(16) or name.getDebugName(1) or path.stem
        self.family = str(family).strip()
        self.italic = bool(int(font["OS/2"].fsSelection) & _ITALIC)
        self.weight = int(font["OS/2"].usWeightClass)
        self.axes = {
            axis.axisTag: (axis.minValue, axis.defaultValue, axis.maxValue)
            for axis in font["fvar"].axes
        } if "fvar" in font else {}
        font.close()

    @property
    def style(self) -> FontStyle:
        return "italic" if self.italic else "normal"

    def supports(self, weight: int) -> bool:
        rng = self.axes.get("wght")
        return rng[0] <= weight <= rng[2] if rng else self.weight == weight

    def distance(self, weight: int) -> int:
        rng = self.axes.get("wght")
        if rng:
            clamped = min(max(weight, rng[0]), rng[2])
            return int(abs(weight - clamped))
        return abs(self.weight - weight)


class FontRegistry:
    """Registers font files and resolves them to instances.

    Registration and resolution are both deterministic. `Path.rglob` returns
    filesystem order, which differs between machines; an unsorted walk would
    make `resolve()` pick different files on CI than locally, changing every
    `font_id`, every frame id, and every golden raster. INVARIANT 3.
    """

    def __init__(self) -> None:
        self._candidates: list[_Candidate] = []
        self._registered: set[Path] = set()
        self._faces: dict[str, FontFace] = {}
        self._by_request: dict[tuple[str, int, FontStyle, str], FontFace] = {}

    # -- registration -------------------------------------------------------

    def register_dir(self, path: Path) -> None:
        """Register every font under `path`. Idempotent.

        Sorted by name, not by `rglob` order, which is filesystem order and
        differs between machines. The absolute path is deliberately NOT part of
        any sort key: it would make registration machine-dependent, and the
        final ordering below settles ties on content hash instead.
        """
        found = [
            p
            for p in path.rglob("*")
            if p.is_file() and p.suffix.lower() in _FONT_SUFFIXES
        ]
        for file_path in sorted(found, key=lambda p: p.name):
            resolved = file_path.resolve()
            if resolved in self._registered:
                continue
            self._registered.add(resolved)
            self._candidates.append(_Candidate(file_path))
        self._candidates.sort(key=lambda c: (c.family, c.style, c.weight, c.file_sha))

    def families(self) -> list[str]:
        return sorted({c.family for c in self._candidates})

    def font_files(self) -> list[Path]:
        return [c.path for c in self._candidates]

    def font_ids(self) -> list[str]:
        return sorted(self._faces)

    # -- resolution ---------------------------------------------------------

    def resolve(
        self,
        family: str,
        weight: int,
        style: FontStyle,
        axes: Mapping[str, float] | None = None,
    ) -> FontFace:
        extra = dict(axes or {})
        cache_key = (
            family,
            weight,
            style,
            ",".join(f"{k}={v:g}" for k, v in sorted(extra.items())),
        )
        cached = self._by_request.get(cache_key)
        if cached is not None:
            return cached

        pool = [c for c in self._candidates if c.family == family]
        if not pool:
            raise KeyError(
                f"no font registered for family {family!r}; "
                f"registered: {self.families()}"
            )
        styled = [c for c in pool if c.style == style] or pool

        # Exact/covering match first; otherwise nearest weight. Ties break on
        # (distance, weight, file_sha) so the winner never depends on walk order.
        exact = [c for c in styled if c.supports(weight)]
        chosen = min(
            exact or styled,
            key=lambda c: (c.distance(weight), c.weight, c.file_sha),
        )

        pinned = self._pin_axes(chosen, weight, extra)
        axes_repr = ",".join(f"{k}={v:g}" for k, v in sorted(pinned.items()))
        # Keyed on what is DELIVERED, not what was asked for. Mukta has no 620,
        # so resolve(620) and resolve(600) reach the same file at the same
        # instance; giving them separate ids would build two HarfBuzz handles
        # and embed the same font twice in one PDF.
        delivered_weight = int(pinned["wght"]) if "wght" in pinned else chosen.weight
        font_id = stable_id(
            "fnt",
            family,
            str(delivered_weight),
            chosen.style,
            axes_repr,
            chosen.file_sha,
        )

        existing = self._faces.get(font_id)
        if existing is not None:
            self._by_request[cache_key] = existing
            return existing

        face = FontFace(
            font_id=font_id,
            path=chosen.path,
            family=family,
            weight=delivered_weight,
            style=chosen.style,
            axes=pinned,
            instance_bytes=self._instance_bytes(chosen, pinned),
        )
        self._faces[font_id] = face
        self._by_request[cache_key] = face
        return face

    def describe_resolution(
        self,
        family: str,
        weight: int,
        style: FontStyle,
        axes: Mapping[str, float] | None = None,
    ) -> FontResolution:
        """Resolve, and report how far the result is from what was asked.

        Faces are shared by `font_id`, so a face cannot carry "what was
        requested" — whoever asked first would win and the answer would be
        wrong for everyone else. The request is described here instead.

        M11 preflight should refuse to release an edition that silently
        substituted a roman for a missing italic.
        """
        face = self.resolve(family, weight, style, axes)
        return FontResolution(
            face=face,
            requested_weight=weight,
            requested_style=style,
        )

    def face(self, font_id: str) -> FontFace:
        try:
            return self._faces[font_id]
        except KeyError:
            raise KeyError(f"unknown font_id {font_id!r}") from None

    # -- internals ----------------------------------------------------------

    @staticmethod
    def _pin_axes(
        candidate: _Candidate, weight: int, extra: Mapping[str, float]
    ) -> dict[str, float]:
        """Clamp the requested coordinates into each axis's range.

        Clamping rather than raising: Archivo Narrow's wght axis stops at 700,
        and refusing a legitimate request for 900 is worse than delivering the
        boldest available. The pinned value is recorded in `axes` and feeds
        `font_id`, so what was actually used stays auditable.
        """
        pinned: dict[str, float] = {}
        for tag, (lo, _default, hi) in candidate.axes.items():
            if tag not in _RESOLVED_AXES:
                continue
            requested = float(extra.get(tag, weight if tag == "wght" else _default))
            pinned[tag] = float(min(max(requested, lo), hi))
        return pinned

    @staticmethod
    def _instance_bytes(
        candidate: _Candidate, pinned: Mapping[str, float]
    ) -> bytes:
        if not pinned:
            return candidate.path.read_bytes()
        # recalcTimestamp=False for the same reason as in subset_bytes: the
        # saved bytes must depend only on the input, never on when we ran.
        font = TTFont(candidate.path, recalcTimestamp=False)
        instantiateVariableFont(font, dict(pinned), inplace=True, updateFontNames=False)
        buf = io.BytesIO()
        font.save(buf)
        font.close()
        return buf.getvalue()
