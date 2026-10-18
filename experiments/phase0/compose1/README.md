# EXP-COMPOSE-1: experimental body-text composer (EXPERIMENTAL / EVIDENCE ONLY)

**Removable without affecting Pageinator.** This is not the production typesetter and not an engine-language decision.

The composer uses frozen oracle-v0 **only for shaping**, through `../typeset_harness/common.py`. The oracle is never modified.

| File | Role |
|---|---|
| `composer.py` | Paragraph model; FULL / CONSTRAINED / RAGGED / HYBRID families; GREEDY and DP; explicit hard/soft limits and penalty model; overset reporting |
| `hyphenation.py` | Our own Liang-algorithm reader for unmodified pattern files |
| `third_party/` | hyph-mr and hyph-en-us pattern data, plus `SOURCES.json` (licence, hash, version, status). **hyph-mr: LICENCE REVIEW REQUIRED** |
| `run_matrix.py` | Stage A baseline reproduction (stops on mismatch), then the full matrix |
| `check_determinism.py` | Fresh-process signature re-check |
| `analyze.py` | All report tables (programmatic) |
| `render_sheets.py` | SVG engineering sheets and blind human sheets |

**Report:** `docs/phase0/EXP_COMPOSE_1_REPORT.md`. **Results:** `experiments/phase0/results/compose1/`.
