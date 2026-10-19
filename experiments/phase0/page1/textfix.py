"""Symbol-font characters that the pilot's PDFs decode as ASCII letters (Wingdings bullets: l ● u ◆ v ❖ n ■ q ❑).

A lone such letter at the start of a Devanagari line or paragraph is the bullet the page prints, not a Latin word. The
OFL stand-ins have only U+2022 among bullet shapes, so every such bullet becomes "•". Shared by compose_page.py and
compare_page.py so the rebuilt text and the integrity check agree. Standard library only.
"""
from __future__ import annotations

import re

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


def latin_text(texts) -> bool:
    """Mostly Latin letters (an English story): it is hyphenated like print, where Marathi never breaks words."""
    lat = deva = 0
    for t in texts:
        for ch in t:
            if _deva(ch):
                deva += 1
            elif ch.isascii() and ch.isalpha():
                lat += 1
    return lat > deva


_LINE_BREAK = re.compile(r"([A-Za-z]+)- ([A-Za-z][A-Za-z]*)")
_TOKEN = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*")


def english_vocab(models) -> set:
    """Lower-case words (hyphenated compounds whole) that print sets inside a line, never at a line end, across the
    page models: the evidence for whether a word print broke at a line end is one word or a compound."""
    out = set()
    for m in models:
        for s in m["stories"]:
            for b in s["flow"]:
                for ln in b.get("lines") or []:
                    toks = _TOKEN.findall(ln.get("text", ""))
                    out.update(t.lower() for t in toks[:-1])
    return out


def dehyphenate(text: str, vocab=frozenset()) -> str:
    """English paragraph text as the page model joins its printed lines ("re- port"): a word print broke at a line end
    is whole again ("report"). It stays a compound ("post-retirement") when print never sets it as one word and
    either sets the compound elsewhere or sets both parts (the first of 3+ letters) as words; or when the next part
    starts with a capital ("Indo- Japan" -> "Indo-Japan")."""
    def join(mo):
        a, b = mo.group(1), mo.group(2)
        whole, compound = (a + b).lower(), (a + "-" + b).lower()
        if b[0].isupper() or (whole not in vocab and (compound in vocab or (len(a) >= 3 and a.lower() in vocab and b.lower() in vocab))):
            return a + "-" + b                             # a compound: never one word in print, its parts are words
        return a + b
    return _LINE_BREAK.sub(join, text)
