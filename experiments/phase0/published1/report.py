"""EXP-PUBLISHED-1 report generator (EXPERIMENTAL). Sections A–L of the pilot measurement report.

Body frames only (is_body_candidate, not excluded). Every number keeps its confidence label.
Section K (comparison with EXP-COMPOSE-1) is produced ONLY if every sample is PILOT_EVIDENCE — otherwise
it is WITHHELD (tool validation data must never be compared as if it were newspaper evidence).
"""
from __future__ import annotations

import json
import statistics as st
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import measure as M  # noqa: E402
import schema as S  # noqa: E402

REPO = HERE.parents[2]
COMPOSE1 = REPO / "experiments" / "phase0" / "results" / "compose1" / "analysis" / "summary.json"


def body_frames(doc):
    if doc.get("excluded"):
        return []
    return [f for p in doc["pages"] for f in p["frames"] if f["is_body_candidate"] and not f.get("excluded")]


def kept(f):
    return [l for l in f["lines"] if not l.get("excluded")]


def policy_observed(f) -> dict:
    ls = kept(f); nf = [l for l in ls if l["class"] != "FINAL_PARAGRAPH_LINE"]
    if not nf:
        return {"observed": "UNDETERMINED", "confidence": S.UNKNOWN}
    sh = Counter(l["class"] for l in nf); n = len(nf)
    full, rag, near = sh["FULLY_ALIGNED"] / n, sh["RAGGED"] / n, sh["NEAR_ALIGNED"] / n
    rr = [r for l in nf if l["class"] in ("RAGGED", "NEAR_ALIGNED") and l["gap_ratios"] for r, pa in zip(l["gap_ratios"], l["gap_punct_adjacent"]) if not pa]
    med_rr = st.median(rr) if rr else None
    if full >= 0.9:
        obs = "FULL_JUSTIFICATION"
    elif full <= 0.1 and (rag + near) >= 0.6 and med_rr is not None and abs(med_rr - 1) <= 0.1:
        obs = "RAGGED"
    elif 0.1 < full < 0.9:
        obs = ("HYBRID_LIKE (unaligned lines at ~natural spacing)" if med_rr is not None and med_rr <= 1.1
               else "CONSTRAINED_LIKE (unaligned lines at expanded spacing)" if med_rr is not None else "MIXED")
    else:
        obs = "OTHER"
    return {"observed": obs, "fully_aligned_share": round(full, 3), "near_share": round(near, 3), "ragged_share": round(rag, 3),
            "median_ratio_unaligned_lines": med_rr and round(med_rr, 3), "confidence": S.ESTIMATED,
            "caveat": "Observed geometry only; the layout application's alignment setting cannot be read from final geometry."}


def build(docs: list[dict], dataset: dict) -> dict:
    classes = {d["sample"].get("dataset_class") for d in docs}
    all_pilot = classes == {S.PILOT_EVIDENCE}
    frames = [(d, f) for d in docs for f in body_frames(d)]
    lines = [l for _, f in frames for l in kept(f)]
    nf = [l for l in lines if l["class"] != "FINAL_PARAGRAPH_LINE"]
    wpl = [l["words"] for l in nf]
    ratios = [r for l in nf if l["gap_ratios"] for r in l["gap_ratios"]]
    ratios_ww = [r for l in nf if l["gap_ratios"] for r, pa in zip(l["gap_ratios"], l["gap_punct_adjacent"]) if not pa]
    brks = [l for l in lines if l.get("break")]
    words_total = sum(l["words"] for l in lines)
    widths = [f["width_mm"] for _, f in frames]
    lat = [l for l in nf if l["token_classes"].get("latin") or l["token_classes"].get("mixed")]
    nolat = [l for l in nf if not (l["token_classes"].get("latin") or l["token_classes"].get("mixed"))]

    def rmed(ls):
        xs = [r for l in ls if l["gap_ratios"] for r, pa in zip(l["gap_ratios"], l["gap_punct_adjacent"]) if not pa]
        return round(st.median(xs), 3) if xs else None

    rep = {
        "schema": "pageinator.published1.report/1", "tool": S.TOOL_VERSION, "dataset": dataset,
        "dataset_classes": sorted(c for c in classes if c), "is_pilot_evidence": all_pilot,
        "A_dataset": {"samples": len(docs), "excluded_samples": sum(1 for d in docs if d.get("excluded")),
                      "pages": sum(len(d["pages"]) for d in docs), "body_frames": len(frames), "body_lines": len(lines),
                      "nonfinal_body_lines": len(nf), "words": words_total,
                      "per_sample": [{"sample_id": d["sample"].get("sample_id"), "publication": d["sample"].get("publication"),
                                      "edition_date": d["sample"].get("edition_date"), "page": d["sample"].get("page_number"),
                                      "section": d["sample"].get("section"), "body_frames": len(body_frames(d)),
                                      "raw_sha256": d["raw_sha256"]} for d in docs]},
        "B_evidence_quality": Counter(d["sample"].get("evidence_level") for d in docs),
        "C_page_geometry": [{"sample_id": d["sample"].get("sample_id"), "page": p["page"], "w_mm": p["page_w_mm"], "h_mm": p["page_h_mm"],
                             "trimbox_mm": p["trimbox_mm"], "column_region_lefts_mm": p["column_region_lefts_mm"],
                             "confidence": p["geometry_confidence"]} for d in docs for p in d["pages"]],
        "C_column_widths_mm": {"distribution": M.dist(widths), "common_values_0.5mm": Counter(round(w * 2) / 2 for w in widths).most_common(6),
                               "confidence": "DERIVED (aligned right edge) or ESTIMATED (ragged frames) — see per-frame"},
        "D_typography": {"fonts": Counter((f.get("font_manual") or {}).get("family") or f["font"] for _, f in frames).most_common(),
                         "font_records": {f["font"]: f["font_record"] for _, f in frames},
                         "body_size_pt": M.dist([f["size_pt"] for _, f in frames]),
                         "leading_pt": M.dist([f["leading_pt"] for _, f in frames if f["leading_pt"]]),
                         "leading_over_size": M.dist([f["leading_pt"] / f["size_pt"] for _, f in frames if f["leading_pt"] and f["size_pt"]]),
                         "mean_advancing_glyph_em": M.dist([f["mean_advancing_glyph_em"] for _, f in frames if f.get("mean_advancing_glyph_em")]),
                         "font_width_reference": "results/published1/font_width_reference.json (EXP-COMPOSE-1 fonts, same metric)",
                         "hscale_frames_not_1": sum(1 for _, f in frames if abs(f["hscale_median"] - 1) > S.TOL["hscale_abs"]),
                         "tracking_intra_token_gap_pt": M.dist([g for l in lines for t in l["tokens"] for g in t["intra_gaps_pt"]]),
                         "nominal_space_confidence": Counter(f["nominal_space_confidence"] for _, f in frames)},
        "E_words_per_line": {"nonfinal": M.dist(wpl), "histogram": dict(sorted(Counter(wpl).items())), "tokenization_policy": S.TOKENIZATION_POLICY.strip()},
        "F_word_spacing": {"all_gaps_nonfinal": M.dist(ratios), "word_word_gaps_nonfinal": M.dist(ratios_ww),
                           "pct_gt_1_5": round(100 * sum(r > 1.5 for r in ratios_ww) / len(ratios_ww), 2) if ratios_ww else None,
                           "pct_gt_2_0": round(100 * sum(r > 2.0 for r in ratios_ww) / len(ratios_ww), 2) if ratios_ww else None,
                           "uncertainty": "± per-gap ratio ≈ ±0.05 validated on ground truth with EXACT nominal space; wider when nominal space is ESTIMATED"},
        "G_alignment": {"line_classes": Counter(l["class"] for l in lines),
                        "frames_policy_observed": [{"frame": f["id"], "sample": d["sample"].get("sample_id"), **policy_observed(f)} for d, f in frames]},
        "H_word_breaking": {"visible_hyphen_breaks": len(brks),
                            "per_100_lines": round(100 * len(brks) / len(lines), 2) if lines else None,
                            "per_100_words": round(100 * len(brks) / words_total, 2) if words_total else None,
                            "consecutive_pairs": sum(f["metrics"]["consecutive_break_pairs"] for _, f in frames),
                            "one_akshara_fragments_est": sum(1 for l in brks if min(l["break"].get("aksharas_before_est", 9), l["break"].get("aksharas_after_est", 9)) <= 1),
                            "manually_verified": sum(1 for l in brks if l["break"].get("confidence") == S.MANUALLY_VERIFIED),
                            "hyph_mr_consistent": Counter(l["break"].get("hyph_mr_consistent") for l in brks),
                            "note": "Unhyphenated in-word breaks are NOT detected automatically — add via corrections (set_break)."},
        "I_long_tokens": {"count": sum(len(l["long_tokens"]) for l in lines),
                          "lines": [{"line": l["id"], "class": l["class"], "flags": l["flags"], "long_tokens": l["long_tokens"],
                                     "median_ratio": rmed([l])} for l in lines if l["long_tokens"]][:200]},
        "J_mixed_script": {"nonfinal_lines_with_latin": len(lat), "median_ratio_with_latin": rmed(lat), "median_ratio_without_latin": rmed(nolat),
                           "class_share_with_latin": Counter(l["class"] for l in lat), "class_share_without_latin": Counter(l["class"] for l in nolat),
                           "lines_with_number": sum(1 for l in lines if l["token_classes"].get("number")),
                           "lines_with_url_email": sum(1 for l in lines if l["token_classes"].get("url_email"))},
    }
    if all_pilot and lines:
        c1 = json.loads(COMPOSE1.read_text())
        rep["K_comparison_to_EXP_COMPOSE_1"] = {
            "synthetic_width_curve_mr": c1["B_width_curve_mr_pooled_fonts_sizes"],
            "pilot": {"column_width_mm_median": M.dist(widths)["median"], "body_size_pt_median": M.dist([f["size_pt"] for _, f in frames])["median"],
                      "words_per_line_median": M.dist(wpl)["median"] if wpl else None, "words_per_line_p90": M.dist(wpl)["p90"] if wpl else None,
                      "breaks_per_100_lines": rep["H_word_breaking"]["per_100_lines"],
                      "space_ratio_median": M.dist(ratios_ww)["median"] if ratios_ww else None, "space_ratio_p95": M.dist(ratios_ww)["p95"] if ratios_ww else None},
            "synthetic_reference": {"words_per_line_range": "3.15–6.58 (30–60 mm, pooled)", "breaks_per_100_lines": "0 / 15.3 / 38.4 (none / hyph-mr min2 hybrid / published-min full)",
                                    "required_space_ratio_median": 2.48, "required_space_ratio_p95": 6.28}}
    else:
        rep["K_comparison_to_EXP_COMPOSE_1"] = {"status": "WITHHELD", "reason": "dataset is not entirely PILOT_EVIDENCE"}
    rep["L_implications"] = {"status": "TO BE WRITTEN BY A HUMAN after reviewing overlays and sections A–K",
                             "decision_tree": "docs/phase0/EXP_PUBLISHED_1.md §Decision tree (outcomes A–G); do not modify the composer before review"}
    return rep


def to_markdown(rep: dict) -> str:
    def j(x):
        return "`" + json.dumps(x, ensure_ascii=False, default=str)[:600] + "`"
    out = [f"# EXP-PUBLISHED-1 measurement report — {rep['dataset'].get('dataset_id')}",
           f"Dataset classes: **{', '.join(rep['dataset_classes'])}** · pilot evidence: **{rep['is_pilot_evidence']}** · tool {rep['tool']}", ""]
    if not rep["is_pilot_evidence"]:
        out += ["> **NOT NEWSPAPER EVIDENCE.** This report is for tool validation only. Do not cite its numbers as Marathi newspaper typography.", ""]
    for k in [k for k in rep if k[:2] in ("A_", "B_", "C_", "D_", "E_", "F_", "G_", "H_", "I_", "J_", "K_", "L_")]:
        out += [f"## {k.replace('_', ' ', 1)}", j(rep[k]), ""]
    return "\n".join(out) + "\n"
