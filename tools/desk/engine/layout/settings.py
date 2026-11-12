"""House settings of the Desk's page generator (layout/generate.py, layout/compose_page.py, layout/panels.py).

DEFAULTS reproduce the frozen gen1 output BYTE FOR BYTE (the pilot daily; tools/desk/test/test_layout_parity.py): every
refinement reads its setting here and, at the default, takes exactly the frozen code path. A paper switches them on with
"refined_layout": true in its paper.json; the values then come from its house profile's learned "layout" block
(tools/onboard chain/house_profile.py), mapped by deskprofile.settings_for(). Deterministic: no AI decides any of them.
"""
from __future__ import annotations

DEFAULTS = {
    "refined": False,                 # master switch (paper.json "refined_layout")
    # --- headlines (B3)
    "head_weight": 800,               # Noto Sans Devanagari weight of headlines
    "head_wdth": 87.5,                # starting width axis
    "head_max_lines": 4,              # line cap at every span
    "head_max_lines_1col": 4,         # … at one column
    "head_leading_em": 1.08,          # two-line heads: leading × size (ink clearance still applies)
    "head_tz_min": 1.0,               # horizontal scale floor a line may be squeezed to (1.0: never squeezed)
    "head_tz_max": 1.18,              # horizontal scale ceiling (gen1 HEAD_HSCALE_MAX)
    "head_grow": 1.25,                # the lead's headline may grow this much (gen1 HEAD_GROW)
    "head_align": "fill",             # "fill": justified to the measure (gen1) | "centre": filled by scale, centred
    "head_sizes": None,               # {span: pt} learned size by span (None: the profile's headline_size table)
    "lead_ratio_max": None,           # cap: lead headline size ÷ body size (None: no cap)
    # --- body and story parts (B4)
    "body_family": "serif",           # "serif" Noto Serif Devanagari (gen1) | "sans" Noto Sans Devanagari
    "body_wdth": 87.5,
    "body_fits": (1.04, 1.02, 1.0, 0.98, 0.96),   # copyfit steps on the size (gen1 FITS); weekly: (1.0,)
    "body_leadings_pt": None,         # one size, these leadings to fit (house pt), e.g. (12.0, 12.5, 13.0)
    "body_size_pt": None,             # one body size for the edition (STAND-IN pt, e.g. 9.6; None: the house styles)
    "dateline_bold": False,           # run-in dateline (up to the first " : ") in the bold role
    "byline_mode": "line",            # "line": a byline under the head (today) | "none" | "end": a right-aligned signature
    "kicker_mode": "always",          # "always": the article's kicker (today) | "lead": only the page lead's, in its strap
    "caption_mode": "always",         # "always" (today) | "small": regular, smaller, short credit
    # --- rules and margins (B2)
    "rule_mode": "every",             # "every": 0.5 pt above every module (gen1) | "tiers": only between tiers, full width
    "rule_weight_pt": 0.5,
    "rule_cmyk": (0, 0, 0, 1),
    "white_max": 2,                   # leadings of white a module may leave at its column feet (gen1 WHITE_MAX)
    # --- photos (B5)
    "photo_positions": ("head",),     # "head" (gen1: top left) | "inset" (right, in the text) | "centre" (across a gutter)
    "photo_shapes": ("rect",),        # "rect" | "ellipse" (cut-outs need masks: not available)
    "wrap_gap_mm": 1.5,               # clearance between a photo and the text running round it (compose_page WRAP_GAP_MM)
    "wrap_min_mm": None,              # a text strip beside a photo narrower than this: no wrap (the photo takes whole columns)
    "photo_cols": None,               # {k: share} photo widths in grid columns the paper prints (None: gen1's k = 1 … m)
    "photo_area_share": None,         # median share of a page's news area its photos take
    "credit_mode": "caption",         # "caption": the credit inside the caption (today) | "line": a tiny credit line
    # --- panels (B6)
    "panels": None,                   # {treatment: spec} from the profile (layout/panels.py); None: no treatments
    # --- pages (B7)
    "stories_per_page": None,         # (min, max) target per page; None: the Desk's needs_per_role
    "lead_area_share": None,          # median share of a page's news area its lead story takes
    "head_band_fill": None,           # the running-head band's shaded fill: {"stops": [[c, m, y, k], …], "axis": "x"|"y"}
}

ST: dict = dict(DEFAULTS)


def use(over: dict | None) -> None:
    """The settings in force in this process: the defaults, with `over` on top (unknown keys refused)."""
    bad = sorted(set(over or {}) - set(DEFAULTS))
    if bad:
        raise ValueError(f"unknown layout settings: {bad}")
    ST.clear()
    ST.update(DEFAULTS)
    ST.update(over or {})
