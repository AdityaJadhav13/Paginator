# EXP-COMPOSE-3: house-calibrated word spacing on the pilot's own paragraphs (EXPERIMENTAL / EVIDENCE ONLY)

**Removable without affecting Pageinator.** This is not the production typesetter and not an engine-language decision.

- The frozen oracle is used only for shaping.
- compose1 and compose2 stay frozen; their code is imported read-only.

| File | Role |
|---|---|
| `composer3.py` | compose2 copy plus an optional **asymmetric word-space penalty** (`space_model="asym"`, with independent `shrink_scale` and `stretch_scale` around `ws_desired`). The legacy model is the default and reproduces compose2 bit-for-bit |
| `run_compose3.py` | Stage A baseline (stops on mismatch), then every verified pilot paragraph re-set at its own width with a per-paragraph calibrated OFL stand-in. Candidates are tested in house units; the **pre-registered** selection runs on the calibration editions, and results are reported on held-out editions |
| `check_determinism.py <dataset> [N]` | Fresh-process signature re-check |
| `proofs_round1.py <dataset>` | Blind review round 1: A3 paired sheets (published line breaks vs Pageinator, same stand-in font), score sheet, CSV template and sealed key. **Output is private** |
| `render.py` | SVG line renderer with the **correct** vertical mark offset (the frozen `compose1/render_sheets.line_glyphs` mirrors it); used by the round-1 sheets and the illustrations |
| `analyze_round1.py <round_dir>` | Analyses the filled score sheets of a body round (L/R) or the headline round (T/B, `head1/proofs_head1.py`): preference, score B − A (spacing or headline quality), "OK to print" rates, Cohen's κ, consistency on the repeats, and per-variant results when the key has variants. Every answer is validated; a bad value or duplicate row stops it with the row number |

**Inputs:** `published1/paragraphs.py` must have produced `<dataset>/report/paragraphs.jsonl` (private).

**Outputs:**
- **Repo (aggregates only, no text, no IDs):** `experiments/phase0/results/compose3/`.
- **Private:** `<dataset>/report/compose3/` (per-paragraph rows and signatures) and `<dataset>/report/round1/` (review sheets and key).

**Report:** `docs/phase0/EXP_COMPOSE_3_REPORT.md`.
