"""EXP-PUBLISHED-1 — shared definitions: dataset classes, confidence levels, tolerances, tokenization.

EXPERIMENTAL / EVIDENCE TOOLING (not production). Every constant here was fixed BEFORE any pilot file
was seen (2026-10-08) and is justified in docs/phase0/EXP_PUBLISHED_1.md §Tolerances. Changing one
after pilot data arrives requires a dated note explaining why.
"""
from __future__ import annotations

TOOL_VERSION = "published1/1.1.0"  # 1.0.1 skip space-only lines; 1.1.0 per-size gutters + dominant-font body rule (after first pilot overlay review)
MM_PER_PT = 25.4 / 72.0

# ---------------------------------------------------------------- dataset classes (prompt §6, §35)
PILOT_EVIDENCE = "PILOT_EVIDENCE"                         # real pilot newspaper material
TOOL_VALIDATION_SAMPLE = "TOOL_VALIDATION_SAMPLE"         # legally usable public sample, ONLY to test tooling
GROUND_TRUTH_FIXTURE = "GROUND_TRUTH_TOOL_VALIDATION_FIXTURE"  # synthetic, known geometry
DATASET_CLASSES = (PILOT_EVIDENCE, TOOL_VALIDATION_SAMPLE, GROUND_TRUTH_FIXTURE)

# evidence quality levels (prompt §7)
EVIDENCE_LEVELS = {
    "A": "original production PDF sent to press",
    "B": "final published / e-paper PDF with vector text",
    "C": "source layout export + final PDF",
    "D": "high-resolution scan of printed page",
    "E": "high-resolution photograph with scale reference",
}

# ---------------------------------------------------------------- confidence (prompt §32)
EXACT = "EXACT"                     # read directly from PDF numbers (MediaBox, text matrix, glyph origin)
DERIVED = "DERIVED"                 # computed deterministically from EXACT values (column width, gaps, ratios)
ESTIMATED = "ESTIMATED"             # heuristic or statistical (paragraph ends, nominal space from ragged lines)
MANUALLY_VERIFIED = "MANUALLY_VERIFIED"  # confirmed or set by a human correction record
UNKNOWN = "UNKNOWN"

# ---------------------------------------------------------------- tolerances (prompt §36) — fixed in advance
TOL = {
    # Validation acceptance (tool vs ground truth). PDF numbers are typically written with ≥3 decimals in pt
    # (≤0.0005 pt quantisation); browser layout uses 1/64 px (≈0.004 mm). 0.05 mm ≈ 0.14 pt leaves >10×
    # headroom over both while staying far below one word space (~0.8 mm).
    "geom_mm": 0.10,            # page/column edges and widths
    "gap_mm": 0.05,             # individual inter-word gap
    "size_pt": 0.05,            # font size
    "lead_pt": 0.05,            # leading (baseline-to-baseline)
    "ratio_median_abs": 0.02,   # median space ratio vs known ratio
    "ratio_gap_abs": 0.05,      # per-gap space ratio vs known ratio (99 % of gaps)
    "hscale_abs": 0.005,        # horizontal glyph scaling factor
    "tracking_pt": 0.05,        # intra-word extra spacing
    # Measurement thresholds (used on pilot files)
    "baseline_same_line_em": 0.15,      # glyphs on one line share baseline within 0.15 × size
                                        # REVISED 2026-10-08 during TOOL VALIDATION (before any pilot data): the original
                                        # absolute 0.20 pt split real lines whose runs sit 0.28 pt apart (GT-A). Lines are
                                        # ≥ ~0.9 × size apart, so 0.15 em cannot merge two real lines.
    "word_gap_min_em": 0.12,            # geometric gap ≥ this × font size = word gap (natural spaces ≈0.22–0.30 em;
                                        # kerning/tracking inside words is typically <0.05 em)
    "segment_split_em": 0.80,           # gap > this splits a baseline into segments (column detection)
    "column_left_cluster_pt": 1.5,      # column region left boundaries within this are one column
    "gutter_min_mm": 1.0,               # a gutter is ≥ 1 mm with zero glyph coverage across the line window
    "gutter_window_lines": 6,           # ± neighbouring baselines used to find gutters for a line
                                        # (column detection REVISED 2026-10-08 during TOOL VALIDATION, before pilot data:
                                        #  left-edge clustering found spurious columns inside justified text)
    "indent_min_em": 0.50,              # x0 − column left ≥ this → indented (paragraph start)
    "align_full_pt": 0.25,              # right slack ≤ 0.25 pt (0.09 mm) → FULLY ALIGNED
    "align_near_spaces": 1.0,           # right slack ≤ 1 nominal space → NEAR-ALIGNED, else RAGGED
    "para_gap_factor": 1.40,            # baseline gap > 1.4 × leading → paragraph break
    "body_size_rel_band": (0.80, 1.25),  # body frames: page's dominant font, size within these × page mode
                                        # (ADDED 2026-10-11 after first pilot overlay review; see EXP_PUBLISHED_1.md §6)
    "body_size_band_pt": 0.30,          # body lines: size within ±0.3 pt of the column's dominant size
    "long_token_frac": 0.50,            # token width ≥ 50 % of column width → long token
}

LINE_CLASSES = ("FULLY_ALIGNED", "NEAR_ALIGNED", "RAGGED", "FINAL_PARAGRAPH_LINE", "SPECIAL_CASE")

# ---------------------------------------------------------------- tokenization policy (prompt §14)
TOKENIZATION_POLICY = """
A TOKEN is a maximal run of non-space glyphs on one line with no inter-glyph gap ≥ word_gap_min_em × size
(GEOMETRY ONLY: extracted text is not used to split tokens because Devanagari ToUnicode extraction is
unreliable, and space glyphs are not trusted as boundaries because PDFs may contain zero-advance glyphs that
map to U+0020 — observed in tool validation for an unbroken soft hyphen). WORDS PER LINE = number of tokens on the line, after removing tokens
that consist only of punctuation glyphs (e.g. a detached '—' or '।'). Numbers, abbreviations (डॉ.),
English words and URLs/emails each count as one token. A line-final fragment ending in a hyphen glyph
counts as one token (it is half of a broken word — reported separately as a break). Token CLASSES
(devanagari / latin / number / url_email / mixed / punct / unknown) are assigned from the Unicode blocks of
extracted characters (block membership survives Devanagari reordering even when order does not).
"""


def classify_token(text: str) -> str:
    t = text.strip()
    if not t:
        return "unknown"
    if "@" in t or "www." in t.lower() or "://" in t or any(t.lower().endswith(s) for s in (".com", ".in", ".org", ".gov.in")):
        return "url_email"
    deva = sum(1 for ch in t if "ऀ" <= ch <= "ॿ")
    latin = sum(1 for ch in t if ch.isascii() and ch.isalpha())
    digit = sum(1 for ch in t if ch.isdigit())  # includes Devanagari digits
    letters = deva + latin
    if letters == 0 and digit == 0:
        return "punct"
    if letters == 0:
        return "number"
    if deva and latin:
        return "mixed"
    return "devanagari" if deva else "latin"


def akshara_estimate(text: str) -> int:
    """Order-insensitive akshara estimate: consonants + independent vowels − viramas (robust to the
    reordering seen in Devanagari ToUnicode extraction). ESTIMATED confidence."""
    cons = sum(1 for ch in text if "क" <= ch <= "ह" or "क़" <= ch <= "य़" or ch in "ऱळ")
    vow = sum(1 for ch in text if "ऄ" <= ch <= "औ" or ch in "ॲ")
    vir = text.count("्")
    return max(0, cons + vow - vir)


HYPHEN_GLYPHS = {"-", "‐", "‑", "­"}

# Punctuation that commonly kerns against the adjacent space (GT-A: Mukta ',' and '.' + space measured 0.82×).
# Gaps touching these are reported separately from word–word gaps. Added during TOOL VALIDATION, before pilot data.
PUNCT_CHARS = set(",.;:!?\"'()[]{}।॥‘’“”—–")
