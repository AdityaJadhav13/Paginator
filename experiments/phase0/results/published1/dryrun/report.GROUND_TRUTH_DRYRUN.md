# EXP-PUBLISHED-1 measurement report — dryrun-ground-truth
Dataset classes: **GROUND_TRUTH_TOOL_VALIDATION_FIXTURE** · pilot evidence: **False** · tool published1/1.0.0

> **NOT NEWSPAPER EVIDENCE.** This report is for tool validation only. Do not cite its numbers as Marathi newspaper typography.

## A dataset
`{"samples": 3, "excluded_samples": 0, "pages": 5, "body_frames": 10, "body_lines": 283, "nonfinal_body_lines": 265, "words": 924, "per_sample": [{"sample_id": "GT-D_broadsheet_8col_justify", "publication": "(synthetic)", "edition_date": "2026-10-08", "page": 1, "section": "other", "body_frames": 8, "raw_sha256": "93f697a6b21e9ab61540e33cc61f07265eab23ff74c85348dfbcbafa052d6aa2"}, {"sample_id": "GT-E_manual_hyphen_justify", "publication": "(synthetic)", "edition_date": "2026-10-08", "page": 1, "section": "other", "body_frames": 1, "raw_sha256": "324e78416e04494be168f7a0cb9546be4e3e29cc1c20c5950`

## B evidence_quality
`{"N/A": 3}`

## C page_geometry
`[{"sample_id": "GT-D_broadsheet_8col_justify", "page": 1, "w_mm": 317.8387, "h_mm": 510.1167, "trimbox_mm": null, "column_region_lefts_mm": [23.9985, 58.218, 92.4374, 126.745, 160.9645, 195.1839, 229.4916, 263.711], "confidence": "EXACT"}, {"sample_id": "GT-E_manual_hyphen_justify", "page": 1, "w_mm": 209.8887, "h_mm": 297.0107, "trimbox_mm": null, "column_region_lefts_mm": [19.9967], "confidence": "EXACT"}, {"sample_id": "GT-E_manual_hyphen_justify", "page": 2, "w_mm": 209.8887, "h_mm": 297.0107, "trimbox_mm": null, "column_region_lefts_mm": [], "confidence": "EXACT"}, {"sample_id": "GT-F_mix`

## C column_widths_mm
`{"distribution": {"n": 10, "mean": 32.4884, "median": 30.2469, "p10": 30.2463, "p90": 38.69, "p95": 41.8007, "min": 30.2458, "max": 44.9114}, "common_values_0.5mm": [[30.0, 8], [38.0, 1], [45.0, 1]], "confidence": "DERIVED (aligned right edge) or ESTIMATED (ragged frames) — see per-frame"}`

## D typography
`{"fonts": [["AAAAAA+Mukta-Regular", 9], ["Mukta", 1]], "font_records": {"AAAAAA+Mukta-Regular": {"subtype": "Type0", "cid_subtype": "CIDFontType2", "embedded": true, "font_program": "FontFile2", "subset": true, "has_tounicode": true, "space_em": 0.222, "space_em_source": "pdf_widths_via_tounicode"}}, "body_size_pt": {"n": 10, "mean": 9.1, "median": 9.0, "p10": 9.0, "p90": 9.5, "p95": 9.5, "min": 9.0, "max": 9.5}, "leading_pt": {"n": 10, "mean": 10.7391, "median": 10.625, "p10": 10.6067, "p90": 11.197, "p95": 11.1997, "min": 10.6034, "max": 11.2024}, "leading_over_size": {"n": 10, "mean": 1.180`

## E words_per_line
`{"nonfinal": {"n": 265, "mean": 3.3283, "median": 3.0, "p10": 2.0, "p90": 5.0, "p95": 5.0, "min": 1, "max": 6}, "histogram": {"1": 9, "2": 38, "3": 109, "4": 77, "5": 30, "6": 2}, "tokenization_policy": "A TOKEN is a maximal run of non-space glyphs on one line with no inter-glyph gap ≥ word_gap_min_em × size\n(GEOMETRY ONLY: extracted text is not used to split tokens because Devanagari ToUnicode extraction is\nunreliable, and space glyphs are not trusted as boundaries because PDFs may contain zero-advance glyphs that\nmap to U+0020 — observed in tool validation for an unbroken soft hyphen). WO`

## F word_spacing
`{"all_gaps_nonfinal": {"n": 618, "mean": 3.2767, "median": 2.5175, "p10": 1.0037, "p90": 6.6828, "p95": 8.6569, "min": 0.8227, "max": 21.432}, "word_word_gaps_nonfinal": {"n": 569, "mean": 3.2903, "median": 2.5278, "p10": 1.004, "p90": 6.6827, "p95": 8.5099, "min": 1.0001, "max": 21.432}, "pct_gt_1_5": 70.47, "pct_gt_2_0": 60.81, "uncertainty": "± per-gap ratio ≈ ±0.05 validated on ground truth with EXACT nominal space; wider when nominal space is ESTIMATED"}`

## G alignment
`{"line_classes": {"FULLY_ALIGNED": 230, "SPECIAL_CASE": 9, "FINAL_PARAGRAPH_LINE": 18, "RAGGED": 25, "NEAR_ALIGNED": 1}, "frames_policy_observed": [{"frame": "p1-f1", "sample": "GT-D_broadsheet_8col_justify", "observed": "FULL_JUSTIFICATION", "fully_aligned_share": 0.967, "near_share": 0.0, "ragged_share": 0.0, "median_ratio_unaligned_lines": null, "confidence": "ESTIMATED", "caveat": "Observed geometry only; the layout application's alignment setting cannot be read from final geometry."}, {"frame": "p1-f2", "sample": "GT-D_broadsheet_8col_justify", "observed": "FULL_JUSTIFICATION", "fully_ali`

## H word_breaking
`{"visible_hyphen_breaks": 16, "per_100_lines": 5.65, "per_100_words": 1.73, "consecutive_pairs": 2, "one_akshara_fragments_est": 7, "manually_verified": 1, "hyph_mr_consistent": {"null": 15, "true": 1}, "note": "Unhyphenated in-word breaks are NOT detected automatically — add via corrections (set_break)."}`

## I long_tokens
`{"count": 16, "lines": [{"line": "p1-f1-l1", "class": "FULLY_ALIGNED", "flags": [], "long_tokens": ["महानगरपा\u0000लके\u0000ा"], "median_ratio": 8.615}, {"line": "p1-f1-l8", "class": "FULLY_ALIGNED", "flags": [], "long_tokens": ["पावसा\u0000ापूव\u0000"], "median_ratio": 3.636}, {"line": "p1-f1-l21", "class": "FULLY_ALIGNED", "flags": [], "long_tokens": ["मराठवा\u0000ातील"], "median_ratio": 11.311}, {"line": "p1-f3-l11", "class": "SPECIAL_CASE", "flags": ["single_token_line"], "long_tokens": ["गुणपडताळणीसाठ\u0000"], "median_ratio": null}, {"line": "p1-f3-l16", "class": "FULLY_ALIGNED", "flags":`

## J mixed_script
`{"nonfinal_lines_with_latin": 3, "median_ratio_with_latin": 1.004, "median_ratio_without_latin": 2.532, "class_share_with_latin": {"FULLY_ALIGNED": 1, "RAGGED": 2}, "class_share_without_latin": {"FULLY_ALIGNED": 229, "SPECIAL_CASE": 9, "RAGGED": 23, "NEAR_ALIGNED": 1}, "lines_with_number": 5, "lines_with_url_email": 5}`

## K comparison_to_EXP_COMPOSE_1
`{"status": "WITHHELD", "reason": "dataset is not entirely PILOT_EVIDENCE"}`

## L implications
`{"status": "TO BE WRITTEN BY A HUMAN after reviewing overlays and sections A–K", "decision_tree": "docs/phase0/EXP_PUBLISHED_1.md §Decision tree (outcomes A–G); do not modify the composer before review"}`

