"""G-LIANG: Liang hyphenation exactly as the Phase-0 composers call it (EVIDENCE TOOLING).

experiments/phase0/compose1/hyphenation.py loads the TeX hyph-utf8 pattern files (hyph-mr, hyph-en-us; tracked and
unmodified) and returns the code-point offsets where a word may break. Recorded:
  liang/patterns-<lang>.json.gz   load(lang): pattern letters → values, exception words → offsets, published minima,
                                  and the SHA-256 of the .tex file (the TypeScript parser is checked against this table)
  liang/breaks.jsonl.gz           word_breaks(word, lang, l, r) with (l, r) = (0, 0) (every permitted offset), the file's
                                  published minima, and (2, 2) (page1's English pattern minima)
Words: the letter cores composer3 hyphenates (non-word characters stripped from both ends; tokens with a non-word
character inside are skipped), with composer3's language rule (any Devanagari letter → mr, else en), taken from the
public corpus fixtures/typeset/v1/corpus/texts.json and the public prose under docs/, plus every exception word and a
short list of edge cases (case mapping that changes length, joiners, one-letter words).
"""
from __future__ import annotations

import hashlib
import json
import sys

from golden import EXPERIMENTS, GOLDENS, REPO, Out, cli, environment

sys.path.insert(0, str(EXPERIMENTS / "compose1"))
import hyphenation as H  # noqa: E402

CORPUS = REPO / "fixtures" / "typeset" / "v1" / "corpus" / "texts.json"
EDGE = ["İstanbul", "Straße", "ﬁnancial", "ǅemal", "a", "ab", "Hyphenation", "HYPHENATION", "re-cover", "क",
        "क्ष", "क्‍ष", "क्‌ष", "श्री", "ज्ञानेश्वर", "ऱ्या", "ॐ", "अ‍ॅड"]


def cores(text: str):
    for token in text.split():
        start, end = 0, len(token)
        while start < end and not H.is_word_char(token[start]):
            start += 1
        while end > start and not H.is_word_char(token[end - 1]):
            end -= 1
        core = token[start:end]
        if core and all(H.is_word_char(ch) for ch in core):
            yield core


def lang_of(word: str) -> str:
    return "mr" if any("ऀ" <= ch <= "ॿ" for ch in word) else "en"


def words() -> list[tuple[str, str]]:
    texts = [t["text"] for t in json.loads(CORPUS.read_text(encoding="utf-8"))["texts"]]
    texts += [p.read_text(encoding="utf-8") for p in sorted((REPO / "docs").rglob("*.md"))]
    found = {w: None for t in texts for w in cores(t)}
    for lang in H.PATTERN_FILES:
        found.update({w: None for w in H.load(lang)[1]})
    found.update({w: None for w in EDGE})
    return sorted(((w, lang_of(w)) for w in found), key=lambda x: (x[1], x[0]))


def main(root=REPO) -> dict:
    out = Out(root)
    counts = {}
    for lang, path in sorted(H.PATTERN_FILES.items()):
        patterns, exceptions = H.load(lang)
        out.json_gz(GOLDENS / "liang" / f"patterns-{lang}.json.gz", {
            "schema": "pageinator.golden.liang-patterns/1", "lang": lang,
            "source": path.relative_to(REPO).as_posix(), "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "published_minima": list(H.PUBLISHED_MINIMA[lang]), "patterns": patterns, "exceptions": exceptions})
        counts[f"patterns_{lang}"] = len(patterns)
        counts[f"exceptions_{lang}"] = len(exceptions)
    records = []
    for word, lang in words():
        pl, pr = H.PUBLISHED_MINIMA[lang]
        records.append({"word": word, "lang": lang, "breaks_0_0": H.word_breaks(word, lang, 0, 0),
                        "breaks_published": H.word_breaks(word, lang, pl, pr), "breaks_2_2": H.word_breaks(word, lang, 2, 2)})
    out.jsonl_gz(GOLDENS / "liang" / "breaks.jsonl.gz", records)
    for lang in H.PATTERN_FILES:
        counts[f"words_{lang}"] = sum(r["lang"] == lang for r in records)
    counts["words_with_breaks"] = sum(bool(r["breaks_0_0"]) for r in records)
    counts["assertions"] = 3 * len(records)
    out.json(GOLDENS / "liang" / "info.json", {"schema": "pageinator.golden.liang/1", "counts": counts,
                                               "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
