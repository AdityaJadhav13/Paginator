"""Liang-style pattern hyphenation for EXP-COMPOSE-1 (EXPERIMENTAL).

Loads TeX hyph-utf8 pattern files (unmodified, see third_party/*/SOURCE.md) and returns permitted
in-word break offsets. Written from the published algorithm (Liang 1983); no third-party code.

Break classes (prompt §15) are kept distinct by the caller:
  "rules"  = pattern-derived (hyph-mr / hyph-en-us)            — RULE-BASED, not dictionary/linguistic
  "ortho"  = every cluster boundary (Phase 0 upper bound)        — ARBITRARY, exploratory only
  emergency breaks are produced by the composer, never here.
"""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATTERN_FILES = {"mr": HERE / "third_party" / "hyph-mr" / "hyph-mr.tex",
                 "en": HERE / "third_party" / "hyph-en-us" / "hyph-en-us.tex"}
# Published minima in each file's header (left, right) — recorded, overridable per policy.
PUBLISHED_MINIMA = {"mr": (1, 1), "en": (2, 3)}


def _block(text: str, name: str) -> str:
    m = re.search(r"\\" + name + r"\s*\{(.*?)\n\}", text, re.S)
    return m.group(1) if m else ""


@lru_cache(maxsize=None)
def load(lang: str) -> tuple[dict[str, list[int]], dict[str, list[int]]]:
    raw = PATTERN_FILES[lang].read_text(encoding="utf-8")
    patterns: dict[str, list[int]] = {}
    for line in _block(raw, "patterns").splitlines():
        line = line.split("%", 1)[0].strip()
        for tok in line.split():
            letters = re.sub(r"\d", "", tok)
            vals = [0] * (len(letters) + 1)
            i = 0
            for ch in tok:
                if ch.isdigit():
                    vals[i] = int(ch)
                else:
                    i += 1
            patterns[letters] = vals
    exceptions: dict[str, list[int]] = {}
    for line in _block(raw, "hyphenation").splitlines():
        line = line.split("%", 1)[0].strip()
        for tok in line.split():
            word = tok.replace("-", "")
            pts, k = [], 0
            for ch in tok:
                if ch == "-":
                    pts.append(k)
                else:
                    k += 1
            exceptions[word.lower()] = pts
    return patterns, exceptions


def word_breaks(word: str, lang: str, left_min: int, right_min: int) -> list[int]:
    """Offsets (in code points, 0 < o < len) where the patterns permit a break."""
    patterns, exceptions = load(lang)
    key = word.lower() if lang == "en" else word
    if key in exceptions:
        pts = exceptions[key]
    else:
        w = "." + key + "."
        vals = [0] * (len(w) + 1)
        for i in range(len(w)):
            for j in range(i + 1, len(w) + 1):
                p = patterns.get(w[i:j])
                if p:
                    for k, v in enumerate(p):
                        if v > vals[i + k]:
                            vals[i + k] = v
        # vals index k corresponds to the gap before w[k]; word gap o ↔ w index o+1
        pts = [o for o in range(1, len(word)) if vals[o + 1] % 2 == 1]
    return [o for o in pts if o >= left_min and len(word) - o >= right_min]


def is_word_char(ch: str) -> bool:
    return unicodedata.category(ch)[0] in "LM" or ch in "‌‍"
