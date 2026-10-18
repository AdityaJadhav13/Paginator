# oracle-v0: Known Limitations and Defects

Facts recorded, not fixed. Fixtures that touch an item carry `oracle_limitation: <ID>`.

| ID | Kind | Finding | Evidence |
|---|---|---|---|
| OL-01 | Capability | No justified glyph positions, frame flow, overset or continuation | Module scope (M1.5 never built) |
| OL-02 | Capability | No hyphenator. `HyphenPoint` is accepted as input only | `linebreak.build_nodes(hyphen_points=…)` |
| OL-03 | Capability | No emergency stretch and no tracking inside line breaking | `linebreak.py` |
| OL-04 | Capability | Right-to-left raises `NotImplementedError` | `shape.py` |
| OL-05 | Policy | `word_space_max` limits stretch per glue only. Knuth–Plass feasibility is all-or-nothing per paragraph, so one unfittable line makes the whole paragraph "infeasible" and the greedy fallback runs | `docs/phase0/JUSTIFICATION_INVESTIGATION.md` |
| OL-06 | Policy | Hyphen penalty is hard-coded (`DEFAULT_LINE_PENALTY*5`) | `linebreak.py:219` |
| OL-07 | Policy | `style.align` is not read by line breaking, so ragged-right is not modelled | Audit `01` |
| OL-08 | Test gap | Devanagari tests use `language="hi"`; nothing is tagged `mr` | `tests/test_typeset_linebreak.py` |
| OL-09 | Fonts | The `opsz` axis (Source Serif 4) is not pinned. There is no Marathi-specific Tiro build (only "Tiro Devanagari Hindi") | `ORACLE_MANIFEST.json` fonts |
| OL-10 | Determinism | Demerits use Python `**` (libm `pow`). Cross-platform bit-equality is not guaranteed; same-image determinism is | `linebreak.py:496` |
| OL-11 | Version skew | uharfbuzz bundles HarfBuzz 14.3.0. System `hb-shape` on the measurement machine is 14.5.0, so cross-checks compare versions, not engines | Manifest; `hb-shape --version` |
| OL-12 | Validation gap | Malformed Devanagari (orphan matra, e.g. `ि क`) shapes **silently**. The oracle sets `DO_NOT_INSERT_DOTTED_CIRCLE`, raises no error and emits no flag. `hb-shape` 14.5.0 inserts a dotted circle (gid 756 in Noto Serif Devanagari) | `fixtures/typeset/v1/behavior/difficult.jsonl` id `mr-diff-17…` (shaping cross-check DISAGREE). The harness's `orphan_combining_mark_offsets` invariant detects it |
| OL-13 | Behaviour | The oracle removes default-ignorables (ZWJ, ZWNJ, soft hyphen, ZWSP) from glyph output (`REMOVE_DEFAULT_IGNORABLES`). ZWJ/ZWNJ still affect conjunct formation during shaping. A soft hyphen in copy is therefore **not** available as a break hint | Cross-check: agreement only with `hb-shape --remove-default-ignorables` |
