"""Story treatments (GAP §6 Batch 6): which story of a page is set off by a strap band, a tint panel, a reverse head or
a box, and how each looks. Deterministic, coded; no AI decides any of it.

The looks come from the house settings: ST["panels"] = {treatment: spec}, learned from the paper's own pages
(tools/onboard chain/house_profile.py). ST["panels"] None (the default: the pilot daily) means the paper has no
treatments: spec() is None for every one and assign() gives every story "none", so nothing changes.

Assignment rule (assign), page by page. A page is known only by its stories' page pins: an unpinned story gets "none".
Short items (briefs) get "none". The page's other stories, in their rank on the page (then by key):
  1. the page lead (the first) gets the strap band when it has a kicker (its strap: the band holds it);
  2. the second story gets a box when it is short (at most BOX_MAX_WORDS words: about two columns' worth), else the
     tint panel;
  3. a box still unused goes to the first short story after the second;
  4. a reverse head goes to the first story after the second that has no photo and nothing yet ("reverse", or
     "reverse_red" when the paper has only the red one).
Each treatment is used at most once per page (so at most one reverse head, one box, one strap). A treatment the paper
has no spec for is never given. An editor's explicit choice (an override: the story's own "treatment", or the overrides
argument) wins over the rule and counts toward the page's limits, so the rule never adds a second of that treatment.
"""
from __future__ import annotations

from settings import ST

TREATMENTS = ("none", "strap", "tint", "reverse", "reverse_red", "box")
SPEC_KEYS = ("cmyk", "text_cmyk", "height_mm", "stroke_pt", "stroke_cmyk", "pad_mm", "fill")
BOX_MAX_WORDS = 250          # "about two columns' worth" of body words at a weekly's 5-column measure
CONTRAST_MIN = 4.5           # WCAG 2 AA contrast ratio for normal text: heads are larger, so this is on the safe side
BLACK = (0.0, 0.0, 0.0, 1.0)


def _luminance(cmyk) -> float:
    """Relative luminance (WCAG 2) of a CMYK colour, through the naive device conversion r = (1-c)(1-k) …: no profile,
    so it ranks inks the same way on every machine."""
    c, m, y, k = (min(1.0, max(0.0, float(v))) for v in cmyk)

    def lin(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast_ok(text_cmyk, bg_cmyk) -> bool:
    """Text of text_cmyk readable on bg_cmyk: their WCAG contrast ratio (L_light + 0.05) / (L_dark + 0.05) is at least
    CONTRAST_MIN, with each colour's luminance from _luminance. White on K100 (21:1) and on 15C 100M 100Y red (≈ 5.3:1)
    pass; white on K10 (≈ 1.25:1) fails; black on Y100 or K10 passes."""
    a, b = _luminance(text_cmyk), _luminance(bg_cmyk)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05) >= CONTRAST_MIN


def spec(name: str) -> dict | None:
    """The look of a treatment on this paper: its spec from ST["panels"] (only SPEC_KEYS kept; colours CMYK 0–1), or
    None when the paper has none (no panels, "none", an unknown name) or when its text would not read on its panel
    (contrast_ok, text black unless the spec says otherwise): white text only where the contrast check allows it."""
    panels = ST.get("panels")
    if not panels or name == "none" or name not in TREATMENTS or not isinstance(panels.get(name), dict):
        return None
    out = {k: v for k, v in panels[name].items() if k in SPEC_KEYS}
    if out.get("cmyk") is not None and out.get("fill", True) and not contrast_ok(out.get("text_cmyk") or BLACK, out["cmyk"]):
        return None
    return out


def available() -> list[str]:
    """The treatments this paper offers, "none" first; [] when it has none (the page editor shows no choice then)."""
    if not ST.get("panels"):
        return []
    return ["none"] + [t for t in TREATMENTS[1:] if spec(t) is not None]


def _group(t: str) -> str:
    """Treatments limited together: a black and a red reverse head are both a page's one reverse head."""
    return "reverse" if t.startswith("reverse") else t


def assign(stories: list[dict], overrides: dict | None = None) -> dict:
    """{story key: treatment} by the rule in the module docstring. stories: [{key, page (pin or None), priority, rank
    (on its page), words, has_photo, has_kicker, brief, and optionally treatment (an editor's choice)}]; overrides:
    {key: treatment}, the editor's choices (they win over a story's own)."""
    out = {s["key"]: "none" for s in stories}
    if not ST.get("panels"):
        return out
    have = set(available())
    chosen = {s["key"]: s["treatment"] for s in stories if s.get("treatment") in have}
    chosen.update({k: t for k, t in (overrides or {}).items() if k in out and t in have})
    out.update(chosen)
    pages: dict = {}
    for s in stories:
        if isinstance(s.get("page"), int) and not isinstance(s["page"], bool) and not s.get("brief"):
            pages.setdefault(s["page"], []).append(s)
    for p in sorted(pages):
        ss = sorted(pages[p], key=lambda s: (s.get("rank") or 0, s["key"]))
        used = {_group(chosen[s["key"]]) for s in ss if s["key"] in chosen}

        def give(s, t):
            if t in have and _group(t) not in used and s["key"] not in chosen and out[s["key"]] == "none":
                out[s["key"]] = t
                used.add(_group(t))
                return True
            return False

        def short(s):
            return (s.get("words") or 0) <= BOX_MAX_WORDS
        if ss and ss[0].get("has_kicker"):
            give(ss[0], "strap")
        if len(ss) > 1 and not (short(ss[1]) and give(ss[1], "box")):
            give(ss[1], "tint")
        for s in ss[2:]:
            if short(s) and give(s, "box"):
                break
        rev = "reverse" if "reverse" in have else "reverse_red"
        for s in ss[2:]:
            if not s.get("has_photo") and give(s, rev):
                break
    return out
