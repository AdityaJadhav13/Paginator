"""G-UNI: the Unicode data the frozen oracle actually uses, for every code point (EVIDENCE TOOLING).

- Python 3.11's unicodedata (Unicode 14.0): general category, str.isspace/isalpha/isdigit/isdecimal, str.lower.
  The oracle uses these for brackets, controls, word characters and splitting.
- HarfBuzz 14.3.0's script for each code point exactly as the oracle's itemizer asks for it
  (shape._script_of: a one-character buffer and guess_segment_properties; "" = Common/Inherited).

Written as ranges [first, last, value] so the TypeScript tables stay small and are compared value for value.
"""
from __future__ import annotations

import unicodedata

from golden import GOLDENS, REPO, Out, cli, environment

from paginator.typeset import shape as S


def ranges(values):
    out, start, prev = [], 0, values[0]
    for cp in range(1, len(values)):
        if values[cp] != prev:
            out.append([start, cp - 1, prev])
            start, prev = cp, values[cp]
    out.append([start, len(values) - 1, prev])
    return out


def main(root=REPO) -> dict:
    out = Out(root)
    n = 0x110000
    category, script, space, alpha, digit, decimal = [], [], [], [], [], []
    lower = []
    for cp in range(n):
        if 0xD800 <= cp <= 0xDFFF:  # surrogates never occur in well-formed text
            category.append("Cs"); script.append(""); space.append(False)
            alpha.append(False); digit.append(False); decimal.append(False)
            continue
        ch = chr(cp)
        category.append(unicodedata.category(ch))
        sc = S._script_of(cp)  # noqa: SLF001  (the oracle's own lookup, cached per code point)
        script.append(sc or "")
        space.append(ch.isspace())
        alpha.append(ch.isalpha())
        digit.append(ch.isdigit())
        decimal.append(ch.isdecimal())
        lo = ch.lower()
        if lo != ch:
            lower.append([cp, [ord(c) for c in lo]])
    doc = {
        "schema": "pageinator.golden.unicode/1",
        "unicode_version": unicodedata.unidata_version,
        "category": ranges(category),
        "hb_script": ranges(script),
        "isspace": [r for r in ranges(space) if r[2]],
        "isalpha": [r for r in ranges(alpha) if r[2]],
        "isdigit": [r for r in ranges(digit) if r[2]],
        "isdecimal": [r for r in ranges(decimal) if r[2]],
        "lower": lower,
    }
    out.json_gz(GOLDENS / "unicode" / "unicode14-hb14.3.0.json.gz", doc)
    counts = {"code_points": n, "category_ranges": len(doc["category"]), "hb_script_ranges": len(doc["hb_script"]),
              "lower_entries": len(lower)}
    out.json(GOLDENS / "unicode" / "info.json", {"schema": "pageinator.golden.unicode-info/1",
                                                 "unicode_version": unicodedata.unidata_version, "counts": counts,
                                                 "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
