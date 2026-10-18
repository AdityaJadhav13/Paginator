# EXP-HEAD-1: headline line breaks on the pilot's own headlines (EXPERIMENTAL / EVIDENCE ONLY)

**Removable without affecting Pageinator.** This is not the production typesetter and not an engine-language decision.

- The frozen oracle is used only for shaping (through `compose3/composer3.py`, imported read-only).
- compose1 is imported read-only for glyph outlines and SVG output; vertical mark offsets are applied with the correct sign (`y + y_offset`, as in `compose3/render.py`).

| File | Role |
|---|---|
| `headliner.py` | The headline composer: keep-together rules (HARD H3–H7, never relaxed; STRONG number chains and data-derived pairs, relaxed only when no layout with that line count fits), soft penalties S1–S9, shapes `balance` and `fill`, exact enumeration of every feasible layout (so the printed layout's **rank** is known), first-fit reference, copyfit on a size grid |
| `run_head1.py <dataset>` | Re-sets every eligible pilot headline, deck and crosshead at its own measure with a per-headline calibrated OFL stand-in. Policies V1 / FILL, plus the c7 rules counted on calibration headlines (reported on held-out editions only). Modes FIXED / FIXED_N / GREEDY / COPYFIT. Subsets all / comparable / choice with the chance rate, the shape comparison (McNemar) and the selection rule. Deterministic, about 9 s |
| `proofs_head1.py <dataset>` | Headline blind review: every held-out headline where Pageinator differs from print. Printed breaks vs Pageinator at the printed line count, in both shapes, same font instance, size and box. A3 sheets, score sheet, CSV template and sealed key (with the c7 hash). Refuses to overwrite a folder that holds answers. **Output is private** |

**Inputs:** `published1/headlines.py` must have produced `<dataset>/report/headlines.jsonl` (private).

**Outputs:**
- **Repo (aggregates only, no text, no IDs):** `experiments/phase0/results/head1/summary.json`.
- **Private:** `<dataset>/report/head1/` (per-headline rows, c7 word lists) and `<dataset>/report/round1_headlines/` (review sheets and key).

**Analysis of returned sheets:** `python3 experiments/phase0/compose3/analyze_round1.py <dataset>/report/round1_headlines` (validates every answer; reports per shape).

**Report:** `docs/phase0/EXP_HEAD_1_REPORT.md`.
