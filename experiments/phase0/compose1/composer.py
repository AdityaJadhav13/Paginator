"""EXP-COMPOSE-1 experimental body-text composer.

EXPERIMENTAL / EVIDENCE ONLY. Not the production typesetter, not an engine-language decision.
Uses frozen oracle-v0 ONLY for shaping (through experiments/phase0/typeset_harness/common.py);
all composition logic is here, separate and removable.

Model
-----
paragraph → shaped clusters (HarfBuzz via oracle) → words (split at U+0020 only; NBSP never breaks)
→ pieces (words split at permitted in-word breaks) → line candidates between piece boundaries
→ line cost (explicit penalty model, Policy) → GREEDY or DP (global least-cost) → ComposedParagraph.

No glyph scaling, no glyph distortion, no letter-spacing for Devanagari (prompt §13/§14).
Latin per-line tracking is an EXPLORATORY policy option only.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402  (oracle access: shaping only)
import hyphenation as H  # noqa: E402

COMPOSER_VERSION = "compose1/1.0.0"
EPS = 1e-9


# ------------------------------------------------------------------------------------ policy
@dataclass(frozen=True)
class Weights:
    """Penalty units. Explicit, documented in the report (prompt §18)."""
    soft_space: float = 100.0        # penalty at the hard word-space limit (quadratic from soft limit)
    ragged: float = 400.0            # × (slack/measure)² for a ragged (natural-spacing) line
    ragged_zone_excess: float = 100.0  # × ((slack/measure − zone)/zone)² beyond the ragged zone
    hybrid_fallback: float = 50.0    # fixed cost when HYBRID sets a line ragged instead of justified
    shortfall: float = 400.0         # × (shortfall/measure)² for CONSTRAINED lines that stop at the cap
    hyphen: float = 30.0             # per in-word (rule) break
    hyphen_consecutive: float = 60.0  # extra when the previous line also ended in an in-word break
    emergency: float = 10_000.0      # per emergency break (word wider than measure)
    short_last_line: float = 10.0    # final line shorter than last_line_min_frac × measure
    tracking: float = 20.0           # × (tracking used / tracking max)², Latin only


@dataclass(frozen=True)
class Policy:
    name: str
    family: str                      # FULL | CONSTRAINED | RAGGED | HYBRID
    algorithm: str = "DP"            # DP | GREEDY
    ws_min_hard: float = 0.80        # HARD: never compress word space below this × natural
    ws_min_soft: float = 0.90        # SOFT: preferred lower bound
    ws_max_soft: float = 1.33        # SOFT: preferred upper bound
    ws_max_hard: float = 2.00        # HARD: never exceed (FULL/HYBRID); cap for CONSTRAINED
    inword: str = "none"             # none | rules | ortho   (Marathi: rules = hyph-mr; English: hyph-en-us)
    inword_min: tuple[int, int] | None = None  # (left,right) minima in clusters; None = file's published minima
    emergency: bool = True           # allow cluster-boundary break only for words wider than the measure
    ragged_zone: float = 0.20        # RAGGED/HYBRID: slack beyond this fraction of the measure is penalised hard
    tracking_max_milli_em: float = 0.0   # Latin-only exploratory per-line letter-spacing (expansion)
    last_line_min_frac: float = 0.15
    visible_hyphen: bool = True      # in-word break inserts a hyphen glyph (ASSUMPTION for Marathi)
    weights: Weights = field(default_factory=Weights)

    def key(self) -> str:
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True).encode()).hexdigest()[:12]


# ------------------------------------------------------------------------------------ paragraph model
@dataclass
class Cluster:
    start: int
    end: int
    width: float
    glyphs: list  # (run_idx, glyph_idx)
    is_space: bool


@dataclass
class Prepared:
    text: str
    lang: str
    script: str
    family: str
    size_pt: float
    axes: dict | None
    runs: list
    clusters: list
    words: list          # list[list[int]] cluster indices
    spaces: list         # width of the space after word i (None for last)
    hyphen_w: float
    em_mm: float
    face_bytes: bytes


_HYPH_CACHE: dict = {}


def prepare(text: str, lang: str, script: str, family: str, size_pt: float, axes: dict | None = None,
            weight: int = 400) -> Prepared:
    sh = C.shape_paragraph(text, lang, family, size_pt, weight=weight, axes=axes)
    glyphs = []
    for ri, r in enumerate(sh.runs):
        for gi in range(len(r.glyph_ids)):
            glyphs.append((ri, gi, r.cluster_map[gi], r.x_advances_mm[gi]))
    starts = sorted({g[2] for g in glyphs})
    nxt = {s: (starts[i + 1] if i + 1 < len(starts) else len(text)) for i, s in enumerate(starts)}
    clusters: list[Cluster] = []
    by_start: dict[int, Cluster] = {}
    for ri, gi, cl, adv in glyphs:
        c = by_start.get(cl)
        if c is None:
            c = Cluster(cl, nxt[cl], 0.0, [], text[cl:nxt[cl]] == " ")
            by_start[cl] = c
            clusters.append(c)
        c.width += adv
        c.glyphs.append((ri, gi))
    words, spaces, cur = [], [], []
    for idx, c in enumerate(clusters):
        if c.is_space:
            if cur:
                words.append(cur)
                spaces.append(c.width)
                cur = []
            elif spaces:  # consecutive spaces: accumulate into previous gap
                spaces[-1] += c.width
        else:
            cur.append(idx)
    if cur:
        words.append(cur)
        spaces.append(None)
    else:
        spaces[-1] = None if spaces else None
    fkey = (family, size_pt, json.dumps(axes, sort_keys=True), weight)
    if fkey not in _HYPH_CACHE:
        hr = C.shape_paragraph("-", "en", family, size_pt, weight=weight, axes=axes)
        _HYPH_CACHE[fkey] = sum(sum(r.x_advances_mm) for r in hr.runs)
    face = C.face(family, weight, axes)
    return Prepared(text, lang, script, family, size_pt, axes, sh.runs, clusters, words, spaces,
                    _HYPH_CACHE[fkey], size_pt * C.MM_PER_PT, face._instance_bytes)  # noqa: SLF001 read-only


def inword_points(p: Prepared, policy: Policy) -> dict[int, list[int]]:
    """word index → cluster positions (1..len-1) where an in-word break is permitted."""
    out: dict[int, list[int]] = {}
    if policy.inword == "none":
        return out
    hl = "mr" if p.script == "Deva" else "en"
    for wi, cl_idx in enumerate(p.words):
        n = len(cl_idx)
        if n < 2:
            continue
        starts = [p.clusters[i].start for i in cl_idx]
        if policy.inword == "ortho":
            lm, rm = policy.inword_min or (2, 2)
            pos = [k for k in range(lm, n - rm + 1)]
        else:  # rules: pattern offsets in code points → must coincide with a cluster boundary
            w0, w1 = p.clusters[cl_idx[0]].start, p.clusters[cl_idx[-1]].end
            word = p.text[w0:w1]
            # match only the letter core of the word (strip leading/trailing punctuation)
            core_s = 0
            while core_s < len(word) and not H.is_word_char(word[core_s]):
                core_s += 1
            core_e = len(word)
            while core_e > core_s and not H.is_word_char(word[core_e - 1]):
                core_e -= 1
            core = word[core_s:core_e]
            if not core or any(not H.is_word_char(ch) for ch in core):
                continue  # mixed tokens (URLs, numbers, emails) never hyphenate
            pl, pr = H.PUBLISHED_MINIMA[hl]
            offs = H.word_breaks(core, hl, pl, pr)
            abs_offs = {w0 + core_s + o for o in offs}
            lm, rm = policy.inword_min or (1, 1)
            pos = [k for k in range(1, n) if starts[k] in abs_offs and k >= lm and n - k >= rm]
        if pos:
            out[wi] = pos
    return out


@dataclass
class Piece:
    word: int
    cl_from: int   # index into word's cluster list
    cl_to: int
    width: float
    n_clusters: int


def build_pieces(p: Prepared, policy: Policy, measure: float):
    pts = inword_points(p, policy)
    pieces: list[Piece] = []
    btype: list[str] = []      # boundary type after piece k (between k and k+1): space|inword|emergency
    bspace: list[float] = []   # space width at that boundary (0 for in-word)
    for wi, cl_idx in enumerate(p.words):
        widths = [p.clusters[i].width for i in cl_idx]
        cuts = [0] + pts.get(wi, []) + [len(cl_idx)]
        kinds = ["inword"] * (len(cuts) - 2)
        if policy.emergency and sum(widths) > measure + EPS:
            # emergency: every cluster boundary of an over-wide word becomes available (flagged)
            extra = sorted(set(range(1, len(cl_idx))) - set(cuts))
            allc = sorted(set(cuts) | set(extra))
            kinds = ["inword" if c in cuts else "emergency" for c in allc[1:-1]]
            cuts = allc
        for k in range(len(cuts) - 1):
            a, b = cuts[k], cuts[k + 1]
            pieces.append(Piece(wi, a, b, sum(widths[a:b]), b - a))
            if k < len(cuts) - 2:
                btype.append(kinds[k]); bspace.append(0.0)
        if wi < len(p.words) - 1:
            btype.append("space"); bspace.append(p.spaces[wi])
    return pieces, btype, bspace


# ------------------------------------------------------------------------------------ line cost
@dataclass
class Line:
    a: int
    b: int
    kind: str              # justified | semi | ragged | final | overfull
    n_spaces: int
    n_words: int
    boxes_mm: float
    spaces_mm: float       # natural space width total
    natural_mm: float
    measure_mm: float
    required_sf: float     # spacing needed to justify exactly (inf if no spaces & slack>0)
    applied_sf: float      # spacing actually used
    tracking_mm_per_gap: float
    slack_mm: float        # measure − set width (≥0 short, <0 overfull)
    end_break: str         # space|inword|emergency|end
    cost: float
    within_policy: bool
    flags: list


def _space_pen(sf: float, pol: Policy) -> float:
    w = pol.weights.soft_space
    if sf > pol.ws_max_soft:
        return w * ((sf - pol.ws_max_soft) / max(EPS, pol.ws_max_hard - pol.ws_max_soft)) ** 2
    if sf < pol.ws_min_soft:
        return w * ((pol.ws_min_soft - sf) / max(EPS, pol.ws_min_soft - pol.ws_min_hard)) ** 2
    return 0.0


def _rag_pen(slack: float, m: float, pol: Policy) -> float:
    f = max(0.0, slack) / m
    pen = pol.weights.ragged * f * f
    if f > pol.ragged_zone:
        pen += pol.weights.ragged_zone_excess * ((f - pol.ragged_zone) / pol.ragged_zone) ** 2
    return pen


def eval_line(a, b, P, pieces, btype, bspace, pre, p: Prepared, pol: Policy, m: float, prev_inword: bool) -> Line | None:
    """Cost of a line made of pieces[a:b]. None = forbidden under HARD limits."""
    Wp, Sw, Ns, Nc = pre
    boxes = Wp[b] - Wp[a]
    spaces = Sw[b - 1] - Sw[a] if b - 1 > a else 0.0
    n_sp = Ns[b - 1] - Ns[a] if b - 1 > a else 0
    final = b == P
    end_break = "end" if final else btype[b - 1]
    hy = p.hyphen_w if (end_break in ("inword",) and pol.visible_hyphen) else 0.0
    content = boxes + hy
    natural = content + spaces
    n_words = len({pieces[k].word for k in range(a, b)})
    flags, cost = [], 0.0
    if end_break == "inword":
        cost += pol.weights.hyphen + (pol.weights.hyphen_consecutive if prev_inword else 0.0)
        flags.append("inword_break")
    if end_break == "emergency":
        cost += pol.weights.emergency
        flags.append("emergency_break")
    min_set = content + spaces * pol.ws_min_hard
    if min_set > m + EPS:
        # does not fit even at hard compression
        if b - a == 1:  # single unbreakable piece wider than the measure
            return Line(a, b, "overfull", n_sp, n_words, boxes, spaces, natural, m, math.inf, 1.0, 0.0,
                        m - natural, end_break, math.inf, False, flags + ["overfull"])
        return None
    slack_nat = m - natural
    req = (1.0 + slack_nat / spaces) if spaces > EPS else (math.inf if slack_nat > 1e-6 else 1.0)

    # tracking (Latin-only exploratory): gaps between clusters, excluding spaces
    gaps = max(0, (Nc[b] - Nc[a]) - 1 - n_sp)
    track_max = (pol.tracking_max_milli_em / 1000.0) * p.em_mm if p.script == "Latn" else 0.0

    def justify_with_tracking(target_slack: float):
        """Return (applied_sf, tracking_per_gap) to absorb target_slack (>0) — spaces to soft max first,
        then tracking up to its max, then spaces up to hard max."""
        if spaces <= EPS:
            t = min(track_max, target_slack / gaps) if gaps else 0.0
            return (1.0, t, target_slack - t * gaps)
        to_soft = spaces * (pol.ws_max_soft - 1.0)
        if target_slack <= to_soft + EPS or track_max <= 0 or gaps == 0:
            return (1.0 + target_slack / spaces, 0.0, 0.0)
        rem = target_slack - to_soft
        t = min(track_max, rem / gaps)
        rem -= t * gaps
        return (pol.ws_max_soft + rem / spaces, t, 0.0)

    if final:
        set_w = natural
        kind, applied, trk = "final", 1.0, 0.0
        if slack_nat < -EPS:  # must compress to fit
            applied = req; set_w = m
            if applied < pol.ws_min_hard - EPS:
                return None
            cost += _space_pen(applied, pol)
        if (m - set_w) > m * (1 - pol.last_line_min_frac) and a > 0:
            cost += pol.weights.short_last_line
            flags.append("short_last_line")
        return Line(a, b, kind, n_sp, n_words, boxes, spaces, natural, m, req, applied, trk, m - set_w,
                    end_break, cost, True, flags)

    fam = pol.family
    if fam == "RAGGED":
        if slack_nat < -EPS:  # compress modestly within soft min to fit
            applied = req
            if applied < pol.ws_min_soft - EPS:
                return None
            return Line(a, b, "ragged", n_sp, n_words, boxes, spaces, natural, m, req, applied, 0.0, 0.0,
                        end_break, cost + _space_pen(applied, pol), True, flags)
        cost += _rag_pen(slack_nat, m, pol)
        within = slack_nat / m <= pol.ragged_zone + EPS
        return Line(a, b, "ragged", n_sp, n_words, boxes, spaces, natural, m, req, 1.0, 0.0, slack_nat,
                    end_break, cost, within, flags + ([] if within else ["ragged_beyond_zone"]))

    # justified families
    if slack_nat >= 0:
        sf, trk, resid = justify_with_tracking(slack_nat)
    else:
        sf, trk, resid = req, 0.0, 0.0
    justifiable = (resid <= 1e-6) and (pol.ws_min_hard - EPS <= sf <= pol.ws_max_hard + EPS) and not (
        spaces <= EPS and trk == 0.0 and slack_nat > 1e-6)
    if track_max > 0:
        cost += pol.weights.tracking * (trk / track_max) ** 2 if trk else 0.0
    if justifiable:
        return Line(a, b, "justified", n_sp, n_words, boxes, spaces, natural, m, req, sf, trk, 0.0,
                    end_break, cost + _space_pen(sf, pol), True, flags + (["tracked"] if trk else []))
    if fam == "FULL":
        return None
    if fam == "HYBRID":
        if slack_nat < -EPS:
            return None
        cost += pol.weights.hybrid_fallback + _rag_pen(slack_nat, m, pol)
        return Line(a, b, "ragged", n_sp, n_words, boxes, spaces, natural, m, req, 1.0, 0.0, slack_nat,
                    end_break, cost, False, flags + ["hybrid_fallback_ragged"])
    if fam == "CONSTRAINED":
        if slack_nat < -EPS:
            return None
        cap = pol.ws_max_hard
        set_w = content + spaces * cap if spaces > EPS else content
        short = m - set_w
        cost += _space_pen(cap, pol) + pol.weights.shortfall * (short / m) ** 2
        return Line(a, b, "semi", n_sp, n_words, boxes, spaces, natural, m, req, cap if spaces > EPS else 1.0,
                    0.0, short, end_break, cost, False, flags + ["semi_justified_short"])
    raise ValueError(fam)


# ------------------------------------------------------------------------------------ algorithms
@dataclass
class Composed:
    status: str               # OK | OVERSET
    reason: str
    lines: list
    cost: float
    pieces: list
    btype: list


def _prefix(pieces, bspace):
    P = len(pieces)
    Wp = [0.0] * (P + 1); Nc = [0] * (P + 1)
    for k, pc in enumerate(pieces):
        Wp[k + 1] = Wp[k] + pc.width
        Nc[k + 1] = Nc[k] + pc.n_clusters
    Sw = [0.0] * (P + 1); Ns = [0] * (P + 1)
    # boundary k (1-based, after piece k-1) has space bspace[k-1]; Sw[k] = sum of boundaries 1..k
    for k in range(1, P):
        Sw[k] = Sw[k - 1] + bspace[k - 1]
        Ns[k] = Ns[k - 1] + (1 if bspace[k - 1] > 0 else 0)
    Sw[P] = Sw[P - 1] if P > 0 else 0.0
    Ns[P] = Ns[P - 1] if P > 0 else 0
    return Wp, Sw, Ns, Nc


def compose(p: Prepared, pol: Policy, measure_mm: float) -> Composed:
    pieces, btype, bspace = build_pieces(p, pol, measure_mm)
    P = len(pieces)
    pre = _prefix(pieces, bspace)
    if pol.algorithm == "GREEDY":
        return _greedy(p, pol, measure_mm, pieces, btype, bspace, pre, P)
    best = [math.inf] * (P + 1)
    back: list = [None] * (P + 1)
    best[0] = 0.0
    for a in range(P):
        if best[a] == math.inf:
            continue
        prev_inword = back[a] is not None and back[a][1].end_break == "inword"
        for b in range(a + 1, P + 1):
            ln = eval_line(a, b, P, pieces, btype, bspace, pre, p, pol, measure_mm, prev_inword)
            if ln is None:
                # wider candidates only get wider once even hard compression fails
                if pre[0][b] - pre[0][a] > measure_mm + EPS:
                    break
                continue
            c = best[a] + ln.cost
            if c < best[b] - 1e-12:  # strict: earliest-found wins ties → deterministic
                best[b] = c
                back[b] = (a, ln)
            if ln.kind == "overfull":
                break
    if best[P] == math.inf:
        return Composed("OVERSET", "no composition satisfies HARD limits", [], math.inf, pieces, btype)
    lines, k = [], P
    while k > 0:
        a, ln = back[k]
        lines.append(ln); k = a
    lines.reverse()
    status = "OK" if not any(l.kind == "overfull" for l in lines) else "OVERSET"
    return Composed(status, "" if status == "OK" else "word wider than measure (no emergency break)", lines,
                    best[P], pieces, btype)


def _greedy(p, pol, m, pieces, btype, bspace, pre, P) -> Composed:
    """First-fit: take the longest line that fits at NATURAL spacing (compressing to soft min only if
    the next piece would not otherwise fit), then apply the family's rule to that line."""
    lines, a, prev_inword = [], 0, False
    Wp, Sw, Ns, Nc = pre
    while a < P:
        b = a + 1
        while b < P:
            nb = b + 1
            boxes = Wp[nb] - Wp[a]
            spaces = Sw[nb - 1] - Sw[a]
            hy = p.hyphen_w if (nb < P and btype[nb - 1] == "inword" and pol.visible_hyphen) else 0.0
            if boxes + hy + spaces * pol.ws_min_soft > m + EPS:
                break
            b = nb
        # prefer a space break over an in-word break unless the in-word break fits more
        ln = eval_line(a, b, P, pieces, btype, bspace, pre, p, pol, m, prev_inword)
        if ln is None:  # FULL greedy cannot justify this line → mark violation but keep going
            boxes = Wp[b] - Wp[a]; spaces = Sw[b - 1] - Sw[a] if b - 1 > a else 0.0
            natural = boxes + spaces
            req = (1.0 + (m - natural) / spaces) if spaces > EPS else math.inf
            ln = Line(a, b, "violation", 0, len({pieces[k].word for k in range(a, b)}), boxes, spaces, natural, m,
                      req, 1.0, 0.0, m - natural, btype[b - 1] if b < P else "end", math.inf, False, ["hard_limit_violated"])
        lines.append(ln)
        prev_inword = ln.end_break == "inword"
        a = b
    bad = any(l.kind in ("violation", "overfull") for l in lines)
    return Composed("OVERSET" if bad else "OK", "greedy line violates HARD limits" if bad else "", lines,
                    sum(l.cost for l in lines), pieces, btype)


def signature(c: Composed) -> str:
    """Deterministic fingerprint of the composition decisions."""
    s = json.dumps([(l.a, l.b, l.kind, round(l.applied_sf, 9), round(l.tracking_mm_per_gap, 9)) for l in c.lines]
                   + [c.status], separators=(",", ":"))
    return hashlib.sha256(s.encode()).hexdigest()[:16]
