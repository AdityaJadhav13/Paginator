"""EXP-PUBLISHED-1 measurement: raw glyph geometry JSON → measurement JSON (EXPERIMENTAL).

Geometry first. Extracted text is used only for token CLASS (Unicode block) and for display; never to split
words or to decide alignment. All thresholds come from schema.TOL (fixed before pilot data).

Pipeline per page:
  glyphs → baselines → segments (split at gaps > segment_split_em) → column-left clusters → lines
  (segments re-joined across wide justified gaps) → frames (vertically continuous lines in one column)
  → per frame: dominant size, leading, right edge, nominal space reference → per line: tokens, gaps,
  space ratios, alignment class, break candidate → frame metrics.

Usage: .venv/bin/python measure.py <raw.json> --manifest <sample.manifest.json> --out <measure.json>
"""
from __future__ import annotations

import argparse
import json
import statistics as st
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema as S  # noqa: E402

T = S.TOL
F = dict(x0=0, x1=1, by=2, y0=3, y1=4, size=5, font=6, text=7, a=8, b=9, c=10, d=11)


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def dist(xs):
    if not xs:
        return None
    return {"n": len(xs), "mean": round(st.mean(xs), 4), "median": round(q(xs, .5), 4), "p10": round(q(xs, .1), 4),
            "p90": round(q(xs, .9), 4), "p95": round(q(xs, .95), 4), "min": round(min(xs), 4), "max": round(max(xs), 4)}


def mm(pt):
    return None if pt is None else round(pt * S.MM_PER_PT, 4)


# ------------------------------------------------------------------------------------------- lines
def baselines(glyphs):
    """Cluster glyphs into baselines (same line) — upright text only."""
    up = [g for g in glyphs if abs(g[F["b"]]) < 1e-6 and abs(g[F["c"]]) < 1e-6 and g[F["d"]] > 0]
    up.sort(key=lambda g: (-g[F["by"]], g[F["x0"]]))
    groups, cur, cur_y = [], [], None
    for g in up:
        if cur_y is None or abs(g[F["by"]] - cur_y) <= T["baseline_same_line_em"] * g[F["size"]]:
            cur.append(g); cur_y = g[F["by"]] if cur_y is None else cur_y
        else:
            groups.append(cur); cur, cur_y = [g], g[F["by"]]
    if cur:
        groups.append(cur)
    rotated = len(glyphs) - len(up)
    return groups, rotated


def segments(line):
    line = sorted(line, key=lambda g: (g[F["x0"]], g[F["x1"]]))
    segs, cur, right = [], [], None
    for g in line:
        size = g[F["size"]]
        if cur and g[F["x0"]] - right > T["segment_split_em"] * size and g[F["text"]] != " ":
            segs.append(cur); cur, right = [], None
        cur.append(g)
        if g[F["text"]] != " ":
            right = g[F["x1"]] if right is None else max(right, g[F["x1"]])
        elif right is None:
            right = g[F["x1"]]
    if cur:
        segs.append(cur)
    return [[g for g in s if True] for s in segs]


def seg_x0(s):
    return min(g[F["x0"]] for g in s if g[F["text"]] != " ") if any(g[F["text"]] != " " for g in s) else s[0][F["x0"]]


def seg_x1(s):
    return max(g[F["x1"]] for g in s if g[F["text"]] != " ") if any(g[F["text"]] != " " for g in s) else s[-1][F["x1"]]


def gutter_intervals(glyphs, body_sz):
    """x-intervals (pt) ≥ gutter_min_mm wide with ZERO glyph coverage among the given lines (EXPERIMENTAL).
    Gutters are empty on every line; justified word gaps do not align vertically across many lines."""
    gl = [g for g in glyphs if g[F["text"]] != " " and abs(g[F["size"]] - body_sz) <= T["body_size_band_pt"] + 0.5]
    if not gl:
        gl = [g for g in glyphs if g[F["text"]] != " "]
    if not gl:
        return [], None, None
    lo = min(g[F["x0"]] for g in gl); hi = max(g[F["x1"]] for g in gl)
    res = 0.25
    nb = int((hi - lo) / res) + 2
    cov = bytearray(nb)
    for g in gl:
        a = int((g[F["x0"]] - lo) / res); b = int((g[F["x1"]] - lo) / res)
        for k in range(a, min(b + 1, nb)):
            cov[k] = 1
    out, k = [], 0
    min_bins = int(T["gutter_min_mm"] / S.MM_PER_PT / res)
    while k < nb:
        if not cov[k]:
            j = k
            while j < nb and not cov[j]:
                j += 1
            if j - k >= min_bins and k > 0 and j < nb:
                out.append((lo + k * res, lo + j * res))
            k = j
        else:
            k += 1
    return out, lo, hi


def size_groups(line):
    """Split one baseline's glyphs into size groups (consecutive sizes within body_size_band_pt)."""
    groups = []
    for g in sorted(line, key=lambda g: g[F["size"]]):
        if groups and g[F["size"]] - groups[-1][-1][F["size"]] <= T["body_size_band_pt"]:
            groups[-1].append(g)
        else:
            groups.append([g])
    return [sorted(gs, key=lambda g: (g[F["x0"]], g[F["x1"]])) for gs in groups]


def base_font(name):
    """Font name without the 6-letter subset tag (ABCDEF+Name → Name)."""
    return name.split("+", 1)[1] if name and len(name) > 7 and name[6] == "+" else name


def column_lines(lines_bl, body_sz):
    """Split every baseline at local gutters (window of ±W neighbouring baselines) and cluster the regions'
    left boundaries into columns. Returns ({col_key: [[col_key, glyphs], ...]}, sorted col keys)."""
    W = T["gutter_window_lines"]
    pieces = []
    for i, line in enumerate(lines_bl):
        win = [g for l in lines_bl[max(0, i - W): i + W + 1] for g in l]
        # Gutters are found per text-size group of the line (REVISED 2026-10-11 after the first pilot overlay
        # review: papers set different stories at different body sizes; one page-wide size made other-size
        # text invisible to gutter detection, merging columns).
        for sub in size_groups(line):
            gut, lo, hi = gutter_intervals(win, dominant_size(sub) or sub[0][F["size"]])
            if lo is None:
                continue
            regions = defaultdict(list)
            for g in sub:
                cx = (g[F["x0"]] + g[F["x1"]]) / 2
                k = sum(1 for a, b in gut if b <= cx)
                regions[k].append(g)
            for k, gs in regions.items():
                left = gut[k - 1][1] if k > 0 else lo
                pieces.append((left, gs))
    keys = []
    for left in sorted(p[0] for p in pieces):
        if keys and left - keys[-1][-1] <= T["column_left_cluster_pt"]:
            keys[-1].append(left)
        else:
            keys.append([left])
    reps = [st.median(k) for k in keys]
    col = defaultdict(list)
    for left, gs in pieces:
        key = min(reps, key=lambda r: abs(r - left))
        col[key].append([key, gs])
    return col, sorted(col)


def dominant_size(glyphs):
    c = Counter(round(g[F["size"]], 1) for g in glyphs if g[F["text"]] != " ")
    return c.most_common(1)[0][0] if c else None


def column_lefts(all_segs):
    xs = sorted(seg_x0(s) for s in all_segs)
    clusters, cur = [], []
    for x in xs:
        if cur and x - cur[-1] > T["column_left_cluster_pt"]:
            clusters.append(cur); cur = []
        cur.append(x)
    if cur:
        clusters.append(cur)
    cand = [(st.median(c), len(c)) for c in clusters if len(c) >= 3]
    # indents: a weaker cluster within (0, 3 em] right of a stronger cluster is that column's indent band
    cand.sort()
    lefts = []
    for x, n in cand:
        if lefts and 0 < x - lefts[-1][0] <= 3 * 10.0 and n < lefts[-1][1]:
            continue
        lefts.append((x, n))
    return [x for x, _ in lefts]


# ------------------------------------------------------------------------------------------- tokens
def tokens_of(line_glyphs):
    gl = sorted(line_glyphs, key=lambda g: (g[F["x0"]], g[F["x1"]]))
    toks, cur, right = [], [], None
    for g in gl:
        if g[F["text"]] == " ":
            continue   # space glyphs are NOT trusted as boundaries (GT-E: Chrome maps an unbroken soft hyphen to a
                       # zero-advance glyph whose ToUnicode is U+0020). Boundaries are decided by geometry only.
        if cur and g[F["x0"]] - right >= T["word_gap_min_em"] * g[F["size"]]:
            toks.append(cur); cur, right = [], None
        cur.append(g)
        right = g[F["x1"]] if right is None else max(right, g[F["x1"]])
    if cur:
        toks.append(cur)
    out = []
    for t in toks:
        x0 = min(g[F["x0"]] for g in t); x1 = max(g[F["x1"]] for g in t)
        text = "".join(g[F["text"]] for g in t)
        intra = []
        adv = [g for g in t if g[F["x1"]] - g[F["x0"]] > 1e-6]
        for p_, n_ in zip(adv, adv[1:]):
            intra.append(n_[F["x0"]] - p_[F["x1"]])
        out.append({"x0": round(x0, 4), "x1": round(x1, 4), "text": text, "cls": S.classify_token(text),
                    "n_glyphs": len(t), "intra_gaps_pt": [round(v, 4) for v in intra],
                    "hscale": round(st.median(g[F["a"]] / g[F["d"]] for g in t), 5) if t else None})
    return out


# ------------------------------------------------------------------------------------------- main measure
def measure(raw: dict, manifest: dict) -> dict:
    pages_out = []
    for pg in raw["pages"]:
        glyphs = pg["chars"]
        lines_bl, rotated = baselines(glyphs)
        page_body_sz = dominant_size([g for g in glyphs if g[F["text"]] != " "]) or 10
        col_lines, col_keys = column_lines(lines_bl, page_body_sz)
        lefts = col_keys
        orphans = 0
        space_only = 0
        frames_out = []
        page_body = dominant_size([g for g in glyphs if g[F["text"]] != " "])
        bf = Counter(base_font(g[F["font"]]) for g in glyphs if g[F["text"]] != " ")
        page_body_font = bf.most_common(1)[0][0] if bf else None
        fid = 0
        for ci in sorted(col_lines):
            lines = sorted(col_lines[ci], key=lambda cl: -st.median(g[F["by"]] for g in cl[1]))
            # column left = flush-left position of its lines (robust to indents): lower quartile of line x0
            L = q([min(g[F["x0"]] for g in cl[1] if g[F["text"]] != " ") for cl in lines if any(g[F["text"]] != " " for g in cl[1])], 0.25)
            # frames = vertically continuous runs of lines with consistent size
            runs, cur = [], []
            for cl in lines:
                if not any(g[F["text"]] != " " for g in cl[1]):
                    space_only += 1   # a "line" of space glyphs only carries no text (first seen in InDesign pilot PDFs)
                    continue
                gl = cl[1]; by = st.median(g[F["by"]] for g in gl); sz = dominant_size(gl)
                if cur:
                    pby, psz = cur[-1][0], cur[-1][1]
                    if (pby - by) > 3.0 * (psz or 10) * 1.2 or (sz and psz and abs(sz - psz) > T["body_size_band_pt"]):
                        runs.append(cur); cur = []
                cur.append((by, sz, gl))
            if cur:
                runs.append(cur)
            for run in runs:
                fid += 1
                frames_out.append(frame_measure(pg, f"p{pg['page']}-f{fid}", L, run, page_body, page_body_font))
        pages_out.append({"page": pg["page"], "mediabox_mm": [mm(v) for v in pg["mediabox"]] if pg.get("mediabox") else None,
                          "trimbox_mm": [mm(v) for v in pg["trimbox"]] if pg.get("trimbox") else None,
                          "bleedbox_mm": [mm(v) for v in pg["bleedbox"]] if pg.get("bleedbox") else None,
                          "page_w_mm": mm(pg["mediabox"][2] - pg["mediabox"][0]) if pg.get("mediabox") else None,
                          "page_h_mm": mm(pg["mediabox"][3] - pg["mediabox"][1]) if pg.get("mediabox") else None,
                          "geometry_confidence": S.EXACT, "rotated_glyphs_excluded": rotated,
                          "orphan_segments": orphans, "space_only_lines_skipped": space_only, "column_region_lefts_mm": [mm(x) for x in lefts],
                          "body_size_pt_page_mode": page_body, "body_font_page_mode": page_body_font, "fonts": pg["fonts"], "frames": frames_out})
    return {"schema": "pageinator.published1.measure/1", "tool": S.TOOL_VERSION, "raw_sha256": raw["source"]["sha256"],
            "source_file": raw["source"]["file"], "sample": manifest, "tolerances": T,
            "tokenization_policy": S.TOKENIZATION_POLICY.strip(), "pages": pages_out}


def frame_measure(pg, fid, L, run, page_body, page_body_font=None):
    fonts = pg["fonts"]
    allg = [g for _, _, gl in run for g in gl if g[F["text"]] != " "]
    size = dominant_size(allg)
    font = Counter(g[F["font"]] for g in allg).most_common(1)[0][0]
    frec = fonts.get(font, {})
    hs = st.median(g[F["a"]] / g[F["d"]] for g in allg)
    # leading: mode of consecutive baseline deltas
    bys = [by for by, _, _ in run]
    deltas = [a - b for a, b in zip(bys, bys[1:])]
    med = st.median(deltas) if deltas else None
    regular = [d for d in deltas if med and 0.5 * med <= d <= T["para_gap_factor"] * med]
    # mean, not mode: renderers snap baselines (e.g. 11.25/10.5 pt alternating for 11.2 pt leading)
    leading = round(st.mean(regular), 4) if regular else None
    leading_dist = dist(regular)
    # right edge: the aligned group (x1 within 0.5 mm of max)
    x1s = sorted(max(g[F["x1"]] for g in gl if g[F["text"]] != " ") for _, _, gl in run)
    # right edge = the x1 value most lines agree on (cluster ±0.5 pt), so a few overflowing lines (e.g. an
    # unbreakable URL) do not move the measured column edge. Fallback: max x1 (ESTIMATED, e.g. ragged frames).
    clusters, cur = [], []
    for x in x1s:
        if cur and x - cur[0] > 0.5:
            clusters.append(cur); cur = []
        cur.append(x)
    if cur:
        clusters.append(cur)
    best = max(clusters, key=len)
    if len(best) >= 3 and len(best) >= 0.2 * len(x1s):
        right, right_conf = st.median(best), S.DERIVED
    else:
        right, right_conf = x1s[-1], S.ESTIMATED
    # nominal space reference
    space_glyphs = [g[F["x1"]] - g[F["x0"]] for _, _, gl in run for g in gl if g[F["text"]] == " " and g[F["font"]] == font]
    if frec.get("space_em") and frec.get("space_em_source") == "pdf_widths_via_tounicode":
        nom, nom_src, nom_conf = frec["space_em"] * size * hs, "font width table (PDF /W via ToUnicode U+0020)", S.EXACT
    elif frec.get("space_em"):
        nom, nom_src, nom_conf = frec["space_em"] * size * hs, "embedded font program (cmap/post 'space')", S.DERIVED
    else:
        nom, nom_src, nom_conf = None, None, S.UNKNOWN
    measured_space_glyph = round(st.median(space_glyphs), 4) if space_glyphs else None
    # Font-file-free width characteristic: mean advance of advancing (non-space, non-zero-width) glyphs, in em,
    # normalised by horizontal scale. Comparable with EXP-COMPOSE-1 fonts (results/published1/font_width_reference.json).
    adv = [(g[F["x1"]] - g[F["x0"]]) / (g[F["size"]] * (g[F["a"]] / g[F["d"]])) for g in allg if g[F["x1"]] - g[F["x0"]] > 0.01]
    mean_adv_em = round(st.mean(adv), 4) if adv else None

    lines = []
    for k, (by, sz, gl) in enumerate(run):
        toks = tokens_of(gl)
        x0 = min(t["x0"] for t in toks); x1 = max(t["x1"] for t in toks)
        gaps = [round(b["x0"] - a["x1"], 4) for a, b in zip(toks, toks[1:])]
        gap_punct = [bool((a["text"] and a["text"][-1] in S.PUNCT_CHARS) or (b["text"] and b["text"][0] in S.PUNCT_CHARS))
                     for a, b in zip(toks, toks[1:])]
        nxt = run[k + 1] if k + 1 < len(run) else None
        nx0 = min(t["x0"] for t in tokens_of(nxt[2])) if nxt else None
        indent_next = nxt is not None and (nx0 - L) >= T["indent_min_em"] * (size or 10)
        para_gap_next = nxt is not None and leading and (by - nxt[0]) > T["para_gap_factor"] * leading
        is_last = nxt is None
        slack = right - x1
        words = [t for t in toks if t["cls"] != "punct"]
        flags = []
        if sz and size and abs(sz - size) > T["body_size_band_pt"]:
            flags.append("size_outside_frame_band")
        if (x0 - L) > 3 * (size or 10):
            flags.append("left_offset_gt_3em")
        if slack < -T["align_full_pt"]:
            flags.append("overhangs_right_edge")
        near_tol = T["align_near_spaces"] * (nom or (0.25 * (size or 10)))
        if slack <= T["align_full_pt"] and slack >= -T["align_full_pt"] * 4:
            cls = "FULLY_ALIGNED"
        elif is_last or indent_next or para_gap_next:
            cls = "FINAL_PARAGRAPH_LINE"
        elif slack <= near_tol:
            cls = "NEAR_ALIGNED"
        else:
            cls = "RAGGED"
        if len(words) <= 1 and cls != "FINAL_PARAGRAPH_LINE":
            flags.append("single_token_line")
        if flags and cls != "FINAL_PARAGRAPH_LINE":
            cls = "SPECIAL_CASE" if ("size_outside_frame_band" in flags or "left_offset_gt_3em" in flags or "single_token_line" in flags) else cls
        last_glyph = max(gl, key=lambda g: g[F["x1"]])
        brk = None
        if last_glyph[F["text"]] in S.HYPHEN_GLYPHS and nxt is not None and cls != "FINAL_PARAGRAPH_LINE":
            nt = tokens_of(nxt[2])
            frag1, frag2 = toks[-1]["text"], (nt[0]["text"] if nt else "")
            brk = {"visible_hyphen": True, "line_end_fragment_text": frag1, "next_line_fragment_text": frag2,
                   "aksharas_before_est": S.akshara_estimate(frag1), "aksharas_after_est": S.akshara_estimate(frag2),
                   "fragment_width_mm": mm(toks[-1]["x1"] - toks[-1]["x0"]),
                   "hyph_mr_consistent": None, "manual_or_auto": None,
                   "confidence": S.ESTIMATED,
                   "note": "A line-final hyphen glyph may also be a real compound hyphen; fragment text order is unreliable for Devanagari; hyph-mr consistency requires manual verification (corrections)."}
        lines.append({"id": f"{fid}-l{k + 1}", "baseline_pt": round(by, 4), "x0_mm": mm(x0), "x1_mm": mm(x1),
                      "left_offset_mm": mm(x0 - L), "right_slack_mm": mm(slack), "class": cls, "flags": flags,
                      "tokens": toks, "words": len(words), "gaps_pt": gaps, "gap_punct_adjacent": gap_punct,
                      "gap_ratios": [round(g / nom, 4) for g in gaps] if nom else None,
                      "token_classes": dict(Counter(t["cls"] for t in toks)),
                      "long_tokens": [t["text"] for t in toks if (t["x1"] - t["x0"]) >= T["long_token_frac"] * (right - L)],
                      "break": brk})
    # Paragraph ends without indent/extra space: in a frame that is mostly FULLY_ALIGNED, a RAGGED line whose
    # gaps are natural (median ratio ≤ 1.15) and whose last token ends with sentence punctuation is inferred to
    # be a paragraph-final line (ESTIMATED). Without the punctuation cue it stays RAGGED (could be a hybrid
    # fallback line). Punctuation is reliable in extraction even when Devanagari order is not.
    full_share = sum(l["class"] == "FULLY_ALIGNED" for l in lines) / max(1, len(lines))
    if full_share >= 0.5:
        for l in lines:
            if l["class"] in ("RAGGED", "NEAR_ALIGNED") and l["tokens"]:
                tail = l["tokens"][-1]["text"][-2:]
                rat = l["gap_ratios"] or ([g / (nom or 0.25 * (size or 10)) for g in l["gaps_pt"]])
                if any(ch in ".\u0964\u0965?!\u201d\")" for ch in tail) and (not rat or st.median(rat) <= 1.15):
                    l["class"] = "FINAL_PARAGRAPH_LINE"; l["flags"].append("final_inferred_punctuation_in_justified_frame")
    # ESTIMATED nominal space from unjustified lines if none available
    if nom is None:
        ug = [g for l in lines if l["class"] in ("RAGGED", "FINAL_PARAGRAPH_LINE") for g in l["gaps_pt"]]
        if len(ug) >= 10:
            nom = st.median(ug); nom_src, nom_conf = "median gap on ragged/final lines (assumes natural spacing there)", S.ESTIMATED
            for l in lines:
                l["gap_ratios"] = [round(g / nom, 4) for g in l["gaps_pt"]]
    # Body candidate (REVISED 2026-10-11 after the first pilot overlay review): the page's dominant font family
    # (subset tag ignored) within ±25 % of the page's dominant size, ≥ 3 lines. Papers set stories at several body
    # sizes; the old ±0.3 pt-of-one-size rule dropped most body copy. Single-size pages behave as before.
    body = bool(size and page_body and base_font(font) == page_body_font
                and T["body_size_rel_band"][0] * page_body <= size <= T["body_size_rel_band"][1] * page_body) and len(lines) >= 3
    return {"id": fid, "column_left_mm": mm(L), "right_edge_mm": mm(right), "width_mm": mm(right - L),
            "width_confidence": right_conf, "top_baseline_pt": round(run[0][0], 3), "lines_n": len(lines),
            "is_body_candidate": body, "font": font, "font_record": {k: frec.get(k) for k in ("subtype", "cid_subtype", "embedded", "font_program", "subset", "has_tounicode", "space_em", "space_em_source")},
            "font_family_confidence": S.EXACT if frec else S.UNKNOWN,
            "size_pt": size, "size_confidence": S.EXACT, "leading_pt": leading, "leading_confidence": S.DERIVED if leading else S.UNKNOWN, "leading_deltas_pt": leading_dist,
            "hscale_median": round(hs, 5), "nominal_space_pt": round(nom, 4) if nom else None,
            "nominal_space_source": nom_src, "nominal_space_confidence": nom_conf,
            "space_glyph_measured_pt": measured_space_glyph, "mean_advancing_glyph_em": mean_adv_em, "lines": lines, "metrics": frame_metrics(lines)}


def frame_metrics(lines):
    nonfinal = [l for l in lines if l["class"] != "FINAL_PARAGRAPH_LINE"]
    ratios_nf = [r for l in nonfinal if l["gap_ratios"] for r in l["gap_ratios"]]
    ratios_nf_ww = [r for l in nonfinal if l["gap_ratios"] for r, pa in zip(l["gap_ratios"], l["gap_punct_adjacent"]) if not pa]
    ratios_fin = [r for l in lines if l["class"] == "FINAL_PARAGRAPH_LINE" and l["gap_ratios"] for r in l["gap_ratios"]]
    wpl = [l["words"] for l in nonfinal]
    intra = [g for l in lines for t in l["tokens"] for g in t["intra_gaps_pt"]]
    brks = [l for l in lines if l["break"]]
    consec = sum(1 for a, b in zip(lines, lines[1:]) if a["break"] and b["break"])
    words_total = sum(l["words"] for l in lines)
    return {
        "lines": len(lines), "nonfinal_lines": len(nonfinal),
        "class_counts": dict(Counter(l["class"] for l in lines)),
        "words_per_line_nonfinal": dist(wpl), "words_per_line_histogram": dict(sorted(Counter(wpl).items())),
        "space_ratio_nonfinal": dist(ratios_nf), "space_ratio_nonfinal_word_word": dist(ratios_nf_ww), "space_ratio_final_lines": dist(ratios_fin),
        "pct_ratio_gt_1_5": round(100 * sum(r > 1.5 for r in ratios_nf) / len(ratios_nf), 2) if ratios_nf else None,
        "pct_ratio_gt_2_0": round(100 * sum(r > 2.0 for r in ratios_nf) / len(ratios_nf), 2) if ratios_nf else None,
        "intra_token_gap_pt": dist(intra),
        "visible_hyphen_breaks": len(brks), "breaks_per_100_lines": round(100 * len(brks) / len(lines), 2) if lines else None,
        "breaks_per_100_words": round(100 * len(brks) / words_total, 2) if words_total else None,
        "consecutive_break_pairs": consec,
        "one_akshara_fragments_est": sum(1 for l in brks if min(l["break"]["aksharas_before_est"], l["break"]["aksharas_after_est"]) <= 1),
        "lines_with_latin": sum(1 for l in lines if l["token_classes"].get("latin") or l["token_classes"].get("mixed")),
        "lines_with_number": sum(1 for l in lines if l["token_classes"].get("number")),
        "lines_with_url_email": sum(1 for l in lines if l["token_classes"].get("url_email")),
        "long_tokens": [t for l in lines for t in l["long_tokens"]],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw", type=Path); ap.add_argument("--manifest", type=Path, required=True); ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    raw = json.loads(a.raw.read_text()); man = json.loads(a.manifest.read_text())
    if man.get("dataset_class") not in S.DATASET_CLASSES:
        sys.exit(f"manifest dataset_class must be one of {S.DATASET_CLASSES}")
    m = measure(raw, man)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(m, ensure_ascii=False))
    fr = [f for p in m["pages"] for f in p["frames"]]
    print(f"{raw['source']['file']}: frames={len(fr)} body={sum(f['is_body_candidate'] for f in fr)} lines={sum(f['lines_n'] for f in fr)}")


if __name__ == "__main__":
    main()
