"""Symbol-font characters that the pilot's PDFs decode as ASCII letters (Wingdings bullets: l ● u ◆ v ❖ n ■ q ❑).

A lone such letter at the start of a Devanagari line or paragraph is the bullet the page prints, not a Latin word. The
OFL stand-ins have only U+2022 among bullet shapes, so every such bullet becomes "•". Shared by compose_page.py and
compare_page.py so the rebuilt text and the integrity check agree. Standard library only.
"""
from __future__ import annotations

BULLET = "\u2022"
WINGDINGS_BULLET_LETTERS = frozenset("luvnq")


def _deva(ch: str) -> bool:
    return "\u0900" <= ch <= "\u097f"


def fix_bullet(text: str) -> str:
    t = text.lstrip()
    if len(t) >= 2 and t[0] in WINGDINGS_BULLET_LETTERS and (t[1] == " " or _deva(t[1])):
        rest = t[1:].lstrip()
        if any(_deva(c) for c in rest):
            return BULLET + " " + rest
    return text


def only_bullets(text: str) -> bool:
    """A text element made only of Wingdings bullet letters (a list's bullet column drawn in its own frame): decoration."""
    toks = text.split()
    return bool(toks) and all(t in WINGDINGS_BULLET_LETTERS for t in toks)


def fix_bullets_all(text: str) -> str:
    """fix_bullet for every list item of a run-together list: a lone bullet letter between items becomes "•"."""
    toks = fix_bullet(text).split(" ")
    return " ".join(BULLET if (t in WINGDINGS_BULLET_LETTERS and k + 1 < len(toks) and any(_deva(c) for c in toks[k + 1][:1])) else t
                    for k, t in enumerate(toks))
