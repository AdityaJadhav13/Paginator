"""EXP-HEAD-1 headline composer (EXPERIMENTAL / EVIDENCE ONLY — deterministic, no AI).

Problem: given a headline's text, the measure (span width), a display font and a size (or a size range), choose the
line breaks (and, in copyfit mode, the size). Headlines are ragged (flush-left or centred), 1–3 lines, never hyphenated.

Model (rules and weights from the sourced research brief, fixed BEFORE the first evaluation; v1.2–1.3 close gaps in the
keep-together rules found by code review and add the "fill" shape — see EXP_HEAD_1_REPORT.md)
  tokens     split at U+0020 only (existing NBSP/WJ respected — H8); never hyphenate, never break at - – — / (H2)
  glue       keep-together, applied by turning a space into NBSP before shaping.
             HARD (never relaxed):
             H3 no line starts with । ॥ . , : ; ! ? ) ] } ” ’ % … – — or a spaced dash    H4 no line ends with “ ‘ ( [ or a
                word-final hyphen (भाग-)
             H5 honorifics/titles and initials (incl. Latin letter names such as एस. एम.) with the next word
             H6 a number with its first unit/currency/multiplier/% (unit words matched by stem); ranges (१० ते २०, २५-३०)
             H7 date/time chains (दि./ता. + day + month (+ year); स./सायं./वाजता + time)
             STRONG (relaxed only when no layout with that line count fits; then the layout breaking the fewest STRONG
             links wins: inside a multiplier run 3 / before the unit 2 / c7 pair 1): H6+ a unit after a multiplier of a number chain (५० हजार कोटी रुपयांचा);
             data-derived (c7) word pairs
  fit        every line ≤ measure (H1); fewest lines that fit (copyfit principle; line count before STRONG glue)
  cost       C = Σ ((M − L)/M)² over ALL lines (shape "balance": minimum width variance = CSS text-wrap:balance) or over
             all lines but the last (shape "fill": Knuth–Plass ragged-right / "printing neatly", the last line is free)
                 + soft penalties (squared-slack units): S1 0.16 line ends with a coordinator/subordinator (c1);
                 S2 0.12 (0.20 negation) line starts with an auxiliary/light verb (c3); S3 0.12 line starts with a detached
                 postposition/particle/postposed title (c4); S4 0.12 line ends with a determiner/quantifier (c2) or a bare
                 count (not a year); S5 0.05 line ends with a genitive (-चा/-ची/-चे/-च्या) or -तील modifier; S7 0.10
                 one-token line shorter than 0.5 M; S8 0.06 break inside a short quotation (≤ 5 words); S9 −0.04 line
                 ends with , ; : – — ”; c7 (data-derived) line ends with a word never line-final in the calibration print
  ties       fewer soft-rule hits (occurrences) → smaller longest line → longer first line → earlier breaks
Search: exact enumeration of every feasible layout (headlines are short), which also gives the RANK of any given layout
(e.g. the printed one) under C — a direct test of the cost function. Copyfit: largest size on a grid anchored at a given
size whose fewest-lines layout has ≤ max_lines lines.
"""
from __future__ import annotations

import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _s in ("compose3", "compose2", "typeset_harness", "compose1"):
    sys.path.insert(0, str(HERE.parent / _s))
import fontreg  # noqa: E402

fontreg.install()
import composer3 as K3  # noqa: E402

HEADLINER_VERSION = "head1/1.3.1"
NBSP = "\u00a0"
DIG = "0-9०-९"

# ---------------------------------------------------------------------------------------------- word classes
C1_END = {"व", "आणि", "अन्", "नि", "किंवा", "अथवा", "वा", "पण", "परंतु", "तर", "तरी", "म्हणून", "नाहीतर", "आणखी", "की", "जर", "जरी",
          "जेव्हा", "कारण", "म्हणजे", "तसेच"}
C2_END = {"हा", "ही", "हे", "तो", "ती", "ते", "या", "त्या", "एक", "एका", "काही", "सर्व", "सगळे", "प्रत्येक", "अनेक", "असा", "अशी", "अशा",
          "इतर", "अन्य"}
C3_START = {"आहे", "आहेत", "नाही", "नाहीत", "नको", "नका", "होता", "होती", "होते", "होईल", "होणार", "असेल", "केला", "केली", "केले",
            "करणार", "झाला", "झाली", "झाले", "घेतला", "दिला", "गेला", "लागला", "शकतो", "शकते", "शकतात", "पाहिजे"}
NEGATION = {"नाही", "नाहीत", "नको", "नका"}
C4_START = {"सुद्धा", "देखील", "तरी", "मात्र", "विरुद्ध", "विरोधात", "बाबत", "संदर्भात", "दरम्यान", "नंतर", "पूर्वी", "पर्यंत", "सह", "साठी",
            "मुळे", "कडे", "कडून", "बरोबर", "सोबत", "प्रमाणे", "सारखे", "ऐवजी", "साहेब", "राव", "जी", "ताई", "भाऊ", "दादा", "महाराज"}
HONORIFICS = {"श्री.", "श्रीयुत", "श्रीमती", "सौभाग्यवती", "कु.", "डॉ.", "प्रो.", "सौ.", "प्रा.", "ॲड.", "अ‍ॅड.", "अॅड.", "मा.", "ना.",
              "आ.", "खा.", "कै.", "स्व.", "ह.भ.प.", "पं.", "न्या."}
# Latin letter names written in Devanagari, as initials (एस. एम. जोशी); single-syllable ones are also caught by INITIAL
LATIN_INITIALS = {"ए.", "बी.", "सी.", "डी.", "ई.", "एफ.", "जी.", "एच.", "ऐच.", "आय.", "जे.", "के.", "एल.", "एम.", "एन.", "ओ.", "पी.",
                  "क्यू.", "आर.", "एस.", "टी.", "यू.", "व्ही.", "वी.", "डब्ल्यू.", "डब्लू.", "एक्स.", "वाय.", "झेड.", "जेड."}
UNIT_SYMBOLS = {"₹", "रु.", "%", "कि.मी.", "मि.मी.", "से.मी.", "°से.", "वा."}
# unit / multiplier words are matched by STEM, so inflected forms (हजारांहून, कोटींनी, टक्क्यांपर्यंत, रुपयांचा) are covered;
# UNIT_NOT lists words that merely start like a unit (टक्कर, फुटबॉल, तासगाव …)
UNIT_STEMS = ("रुपय", "कोटी", "लाख", "हजार", "अब्ज", "दशलक्ष", "टक्क", "किलो", "किमी", "टन", "अंश", "तास", "वाजता", "जण", "मीटर",
              "फूट", "फुट", "मिनिट", "सेकंद", "वर्ष", "दिवस", "आठवड", "महिन", "ग्रॅम", "लिटर", "एकर", "हेक्टर", "क्विंटल")
UNIT_NOT = ("टक्कर", "फुटबॉल", "फुटीर", "फुटल", "फुटण", "वर्षाव", "तासगाव", "जणू", "टनेल", "टनल")
MULTIPLIER_STEMS = ("हजार", "लाख", "कोटी", "अब्ज", "दशलक्ष")       # a number chain continues only after a multiplier
DATE_HEAD = {"दि.", "ता.", "इ.", "स.", "सायं.", "सन"}
MONTHS = {"जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"}
NO_START_CHARS = set("।॥.,:;!?)]}”’%…–—")
NO_END_CHARS = set("“‘([-‐‑")                  # a word-final hyphen (भाग-) continues on the next line
STANDALONE_DASHES = {"-", "‐", "‑", "–", "—"}  # a spaced dash stays at the END of a line, never starts one
STRONG_WEIGHT = {"chain_mult": 3, "chain": 2, "pair": 1}   # cost of breaking a STRONG link when relaxation is unavoidable:
                                                          # inside a multiplier run (लाख|कोटी) > before the unit > c7 pair
RANGE_WORDS = ("ते", "–", "-")
NUM = re.compile(rf"^[₹(]?[{DIG}][{DIG},.:]*(?:[-–][{DIG}][{DIG},.:]*)?[%)]?$")
BARE_COUNT = re.compile(rf"^[{DIG}][{DIG},]*$")
YEAR = re.compile(r"^(?:1[89]|20|१[८९]|२०)[0-9०-९]{2}$")
INITIAL = re.compile(r"^[ऀ-ॿ][ा-्ँ-ः़]*\.$|^[A-Z]\.$")
GENITIVE = re.compile(r"(?<!्)(?:चा|ची|चे|च्या)$|तील$")
OPEN_Q, CLOSE_Q = "“\"‘", "”\"’"


@dataclass(frozen=True)
class Weights:
    s1_end_coord: float = 0.16
    s2_start_aux: float = 0.12
    s2_start_neg: float = 0.20
    s3_start_post: float = 0.12
    s4_end_det: float = 0.12
    s5_end_gen: float = 0.05
    s7_short_token_line: float = 0.10
    s8_in_quote: float = 0.06
    s9_end_punct: float = -0.04
    s10_first_shorter: float = 0.0       # optional house-style term (flush-left: L1 < L2 − 0.15 M); off by default


@dataclass(frozen=True)
class HeadPolicy:
    name: str = "HEAD_research_v1"
    weights: Weights = field(default_factory=Weights)
    glue: bool = True
    balance: bool = True            # False → greedy first-fit (reference)
    shape: str = "balance"          # "balance" (slack of every line) | "fill" (the last line's slack is free)
    extra_glue_pairs: frozenset = frozenset()     # data-derived (c7) word pairs kept together (STRONG glue)
    word_end_pen: tuple = ()        # data-derived (c7) extra line-END penalties: ((raw word, weight), …)


@dataclass
class HeadResult:
    text_glued: str
    size_pt: float
    measure_mm: float
    lines: list                     # [(first_token, end_token_exclusive)] over GLUED tokens
    widths_mm: list
    fits: bool
    cost: float
    penalties: dict
    p: object = None
    n_layouts: int = 0              # feasible layouts with the chosen line count
    hits: int = 0                   # soft-rule hits (occurrences of positive-weight rules)
    relaxed: bool = False           # True when STRONG glue had to be dropped for this line count
    broken_strong: int = 0          # weighted STRONG links broken by a relaxed layout (STRONG_WEIGHT)


def _bare(w: str) -> str:
    return w.strip("\"'“”‘’()[]{}.,:;!?।॥-–—")


def is_unit(tok: str) -> bool:
    b = _bare(tok)
    if tok in UNIT_SYMBOLS or b in UNIT_SYMBOLS or tok[:1] == "%":
        return True
    return b != "वर्षा" and not b.startswith(UNIT_NOT) and b.startswith(UNIT_STEMS)


def is_multiplier(tok: str) -> bool:
    return _bare(tok).startswith(MULTIPLIER_STEMS)


def links(text: str, extra_pairs: frozenset = frozenset()) -> list:
    """Kind of every U+0020 boundary of text (between tokens b and b+1): "hard" | "chain_mult" | "chain" | "pair" | None.
    Works on the flat list of NBSP segments, so text that already contains NBSP is judged by its facing words."""
    w = text.split(" ")
    segs, first = [], []
    for t in w:
        first.append(len(segs))
        segs += t.split(NBSP)
    in_chain = [False] * len(segs)       # segment is a unit continuing a number (number → multiplier → … → unit)
    for k in range(1, len(segs)):
        in_chain[k] = is_unit(segs[k]) and (bool(NUM.match(segs[k - 1])) or (in_chain[k - 1] and is_multiplier(segs[k - 1])))
    out = []
    for i in range(1, len(w)):
        k = first[i]
        p_last, c_first = segs[k - 1], segs[k]
        n_next = segs[k + 1] if k + 1 < len(segs) else ""
        p_prev = segs[k - 2] if k >= 2 else ""
        num_prev = bool(NUM.match(p_last))
        hard = (c_first[:1] in NO_START_CHARS or c_first in STANDALONE_DASHES                         # H3
                or (p_last[-1:] in NO_END_CHARS and p_last not in STANDALONE_DASHES)                  # H4
                or p_last in HONORIFICS or p_last in LATIN_INITIALS or bool(INITIAL.match(p_last))    # H5
                or (num_prev and is_unit(c_first))                                                    # H6
                or p_last in ("₹", "रु.")
                or (num_prev and c_first in RANGE_WORDS and bool(NUM.match(n_next)))
                or (bool(NUM.match(c_first)) and p_last in RANGE_WORDS and bool(NUM.match(p_prev)))
                or p_last in DATE_HEAD                                                                # H7
                or (num_prev and _bare(c_first) in MONTHS)
                or (_bare(p_last) in MONTHS and bool(NUM.match(c_first))))
        if hard:
            out.append("hard")
        elif in_chain[k - 1] and is_multiplier(p_last) and is_unit(c_first):                         # H6+ (STRONG)
            out.append("chain_mult" if is_multiplier(c_first) else "chain")
        elif (p_last, c_first) in extra_pairs:                                                        # c7 (STRONG)
            out.append("pair")
        else:
            out.append(None)
    return out


def glue(text: str, extra_pairs: frozenset = frozenset(), strong: bool = True) -> str:
    """Keep-together rules (module docstring): turn the space before token i into NBSP when i may not start a line.
    strong=False applies the HARD rules only."""
    w = text.split(" ")
    keep = {"hard", "chain_mult", "chain", "pair"} if strong else {"hard"}
    kinds = links(text, extra_pairs)
    return w[0] + "".join((NBSP if kinds[i - 1] in keep else " ") + w[i] for i in range(1, len(w)))


def _words(p) -> tuple[list, list, list]:
    widths, texts = [], []
    for cl_ids in p.words:
        widths.append(sum(p.clusters[c].width for c in cl_ids))
        texts.append(p.text[p.clusters[cl_ids[0]].start:p.clusters[cl_ids[-1]].end])
    return widths, p.spaces, texts


def _line_width(widths, spaces, i, j) -> float:
    return sum(widths[i:j]) + sum(spaces[k] or 0.0 for k in range(i, j - 1))


def _quote_spans(texts) -> list:
    """Token ranges [a, b] of short quotations (≤ 5 words) delimited by “…” or "…" (segments of glued tokens checked)."""
    def opens(s):
        return bool(s) and s[0] in OPEN_Q

    def closes(s):
        x = s.rstrip(".,!?:;")
        return bool(x) and x[-1] in CLOSE_Q
    spans, open_at = [], None
    for k, t in enumerate(texts):
        segs = t.split(NBSP)
        if open_at is None and any(opens(s) for s in segs):
            open_at = k
        if open_at is not None and any(closes(s) for s in segs) and (k > open_at or len(t) > 1):
            if sum(len(texts[m].split(NBSP)) for m in range(open_at, k + 1)) <= 5:
                spans.append((open_at, k))
            open_at = None
    return spans


def line_penalties(texts, widths, lines, measure, pol: HeadPolicy) -> tuple[dict, int]:
    """Soft penalties of a layout: (weights summed per rule, number of positive-weight rule hits)."""
    w = pol.weights
    pen = {k: 0.0 for k in ("s1", "s2", "s3", "s4", "s5", "s7", "s8", "s9", "s10", "c7")}
    hits = 0
    quotes = _quote_spans(texts)
    extra = dict(pol.word_end_pen)
    lw = [_line_width(widths, [0.0] * len(widths), i, j) for i, j in lines]

    def add(key, value):
        nonlocal hits
        pen[key] += value
        hits += value > 0

    for n, (i, j) in enumerate(lines):
        last = n == len(lines) - 1
        first_tok = _bare(texts[i].split(NBSP)[0])
        if n > 0:
            if first_tok in C3_START:
                add("s2", w.s2_start_neg if first_tok in NEGATION else w.s2_start_aux)
            if first_tok in C4_START:
                add("s3", w.s3_start_post)
        if not last:
            end_glued = texts[j - 1]
            end_raw = end_glued.split(NBSP)[-1]
            end_tok = _bare(end_raw)
            if end_tok in C1_END:
                add("s1", w.s1_end_coord)
            if end_tok in C2_END or (BARE_COUNT.match(end_glued) and not YEAR.match(end_glued)):
                add("s4", w.s4_end_det)
            if GENITIVE.search(end_tok):
                add("s5", w.s5_end_gen)
            if end_raw[-1:] in ",;:–—”’":
                add("s9", w.s9_end_punct)
            if end_raw in extra:                       # exact raw token, as counted (so "सरकार:" ≠ "सरकार")
                add("c7", extra[end_raw])
            if any(a <= j - 1 < b for a, b in quotes):
                add("s8", w.s8_in_quote)
        if len(lines) > 1 and j - i == 1 and widths[i] < 0.5 * measure:
            add("s7", w.s7_short_token_line)
    if len(lines) > 1 and w.s10_first_shorter and lw[0] < lw[1] - 0.15 * measure:
        add("s10", w.s10_first_shorter)
    return pen, hits


def score_layout(widths, spaces, texts, lines, measure, pol: HeadPolicy):
    """Cost C of a given layout: (cost, hits, line widths, penalties); None if a line overflows."""
    ws = [_line_width(widths, spaces, i, j) for i, j in lines]
    if any(x > measure + 1e-6 for x in ws):
        return None
    pen, hits = line_penalties(texts, widths, lines, measure, pol)
    slack = ws if pol.shape == "balance" else ws[:-1]
    cost = sum(((measure - x) / measure) ** 2 for x in slack) + sum(pen.values())
    return cost, hits, ws, pen


def _layouts(widths, spaces, measure, k):
    """All feasible layouts with exactly k lines (recursion with pruning on overflow)."""
    n, out = len(widths), []

    def rec(start, left, acc):
        if left == 1:
            if _line_width(widths, spaces, start, n) <= measure + 1e-6:
                out.append(acc + [(start, n)])
            return
        for cut in range(start + 1, n - left + 2):
            if _line_width(widths, spaces, start, cut) > measure + 1e-6:
                break
            rec(cut, left - 1, acc + [(start, cut)])
    rec(0, k, [])
    return out


def ranked_layouts(widths, spaces, texts, measure, pol: HeadPolicy, k: int):
    """All feasible k-line layouts ranked by (C, hits, longest line, −first line, breaks)."""
    scored = []
    for lay in _layouts(widths, spaces, measure, k):
        s = score_layout(widths, spaces, texts, lay, measure, pol)
        if s is None:
            continue
        cost, hits, ws, pen = s
        scored.append(((round(cost, 9), hits, round(max(ws), 6), -round(ws[0], 6), [j for _, j in lay]), lay, cost, pen, ws, hits))
    scored.sort(key=lambda x: x[0])
    return scored


def greedy_lines(widths, spaces, measure: float):
    lines, i = [], 0
    while i < len(widths):
        j = i + 1
        while j < len(widths) and _line_width(widths, spaces, i, j + 1) <= measure + 1e-6:
            j += 1
        lines.append((i, j)); i = j
    return lines


def compose(text: str, family: str, axes: dict | None, weight: int, size_pt: float, measure_mm: float,
            policy: HeadPolicy = HeadPolicy(), n_lines: int | None = None, max_lines: int = 8) -> HeadResult:
    """Fewest lines that fit (or exactly n_lines). At each line count the STRONG glue is tried first, then HARD only."""
    glued = {s: (glue(text, policy.extra_glue_pairs, s) if policy.glue else text) for s in (True, False)}
    kinds = links(text, policy.extra_glue_pairs) if policy.glue else []
    soft_w = [STRONG_WEIGHT.get(x, 0) for x in kinds if x != "hard"]     # per boundary between HARD-only tokens
    shaped = {}

    def broken(lines) -> int:
        return sum(soft_w[j - 1] for _, j in lines[:-1] if j - 1 < len(soft_w))

    def variant(strong: bool):
        if strong not in shaped:
            shaped[strong] = (glued[strong], K3.prepare(glued[strong], "mr", "Deva", family, size_pt, axes, weight))
        return shaped[strong]

    order = (True, False) if glued[False] != glued[True] else (True,)     # relaxing STRONG glue must change something
    if not policy.balance:
        for strong in order:
            t, p = variant(strong)
            widths, spaces, texts = _words(p)
            lines = greedy_lines(widths, spaces, measure_mm)
            s = score_layout(widths, spaces, texts, lines, measure_mm, policy)
            if s is not None:
                return HeadResult(t, size_pt, measure_mm, lines, s[2], True, s[0], s[3], p, 1, s[1], not strong,
                                  0 if strong else broken(lines))
        t, p = variant(True)
        return HeadResult(t, size_pt, measure_mm, [], [], False, float("inf"), {}, p)
    for k in ([n_lines] if n_lines else range(1, max_lines + 1)):
        for strong in order:
            t, p = variant(strong)
            widths, spaces, texts = _words(p)
            if k > len(widths):
                continue
            r = ranked_layouts(widths, spaces, texts, measure_mm, policy, k)
            if r:
                # relaxed: break as few STRONG links as possible (STRONG_WEIGHT), then the usual order
                pick = r[0] if strong else min(r, key=lambda x: (broken(x[1]), x[0]))
                _, lay, cost, pen, ws, hits = pick
                return HeadResult(t, size_pt, measure_mm, lay, ws, True, cost, pen, p, len(r), hits, not strong,
                                  0 if strong else broken(lay))
    t, p = variant(True)
    return HeadResult(t, size_pt, measure_mm, [], [], False, float("inf"), {}, p)


def copyfit(text: str, family: str, axes: dict | None, weight: int, measure_mm: float, size_min: float, size_max: float,
            max_lines: int, step: float = 0.5, policy: HeadPolicy = HeadPolicy(), anchor: float | None = None) -> HeadResult | None:
    """Largest size on the grid anchor + n·step inside [size_min, size_max] whose fewest-lines layout has ≤ max_lines lines."""
    a = size_max if anchor is None else anchor
    n = math.floor((size_max - a) / step + 1e-9)
    while a + n * step >= size_min - 1e-9:
        r = compose(text, family, axes, weight, round(a + n * step, 3), measure_mm, policy, max_lines=max_lines)
        if r.fits and len(r.lines) <= max_lines:
            return r
        n -= 1
    return None
