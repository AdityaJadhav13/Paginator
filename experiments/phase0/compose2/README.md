# EXP-COMPOSE-2: fonts × grids × break rules (EXPERIMENTAL / EVIDENCE ONLY)

**Removable without affecting Pageinator.** This is not the production typesetter and not an engine-language decision.

- The frozen oracle is used **only for shaping**, through `../typeset_harness/common.py`, and is never modified.
- The compose1 composer is imported read-only, for regression only.

| File | Role |
|---|---|
| `composer2.py` | compose1 copy plus four rules: token breaks for URLs/emails; per-word hyphenation language; hard `max_consecutive_inword`; hard `fallback_max_slack` |
| `fontreg.py` | Font registry: oracle OFL fonts + `fonts/` + optional `$PAGEINATOR_PRIVATE_FONTS`. `python fontreg.py` rewrites `FONTS.json` |
| `fonts/` | 6 OFL families downloaded unmodified from github.com/google/fonts, each with `OFL.txt` |
| `house_profile.provisional.json` | **PROVISIONAL** grids. `house_profile.measured.json` (same schema, from EXP-PUBLISHED-1) overrides it automatically |
| `run_compose2.py` | Stage A baseline (stops on mismatch), font characterisation, then the policy matrix |
| `check_determinism.py [N]` | Fresh-process signature re-check |
| `analyze2.py` | Report tables (programmatic) |
| `house_compare.py` | Illustration at the pilot's measured geometry: one published column re-set with the same words, plus the corpus at the pilot's widths. Font size is calibrated on the same text. Writes only into the private dataset |
| `proofs.py` | 16 blind-coded proof pages (SVG, true-size PDF, A3 PDF) plus `KEY_SEALED.json`. Needs Google Chrome |

## Adding the newsroom's fonts (never committed)
1. Put the font files in a private directory outside git and `export PAGEINATOR_PRIVATE_FONTS=/path/to/dir`. Do this only where the licence permits.
2. In that directory, create `compose2_fonts.json`:
   ```json
   [{"label": "House-Body", "family": "<family name in the font>", "axes": null, "weight": 400, "category": "serif"}]
   ```
3. Re-run `run_compose2.py` and `analyze2.py`. Private fonts appear in the results with the category prefix `PRIVATE`.

   Results contain font **names and metrics only**. If the font names themselves are confidential, keep the results out of git too.

**Report:** `docs/phase0/EXP_COMPOSE_2_REPORT.md`. **Results:** `experiments/phase0/results/compose2/`.
