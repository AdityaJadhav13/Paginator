# Phase 0 experiments (EXPERIMENTAL / EVIDENCE ONLY)

Nothing here is production code or an architecture decision. A Python harness does not make Python the kernel language (ADR-017; `docs/phase0/`).

## Environment
The harness uses the frozen oracle's isolated environment:
```bash
cd tools/oracle/v0 && uv venv --python 3.11.14 .venv && uv pip install --python .venv/bin/python --require-hashes -r requirements.lock
```
Run everything from the repo root, prefixed with `PYTHONDONTWRITEBYTECODE=1`.

| Script | Answers | Output |
|---|---|---|
| `typeset_harness/generate_goldens.py` | BEHAVIOR goldens + `hb-shape` cross-check | `fixtures/typeset/v1/behavior/` |
| `typeset_harness/investigate_justification.py` | Why justification fails (0/240), the failure taxonomy, an independent bug check | `results/justification/` |
| `typeset_harness/measure_performance.py [--iters 50]` | Stage timings, edition throughput, server-compute interaction scenarios, payload size | `results/performance/` |
| `render_workload/generate_workload.py` | 16-page display-list workload for the renderer bake-off | `render_workload/out/` (gitignored), `results/render_workload/stats.json` |
| `compose1/run_matrix.py`, `check_determinism.py`, `analyze.py`, `render_sheets.py` | EXP-COMPOSE-1: composition policy families × fonts × sizes × widths, plus review sheets | `results/compose1/` |
| `compose2/run_compose2.py`, `check_determinism.py`, `analyze2.py`, `proofs.py` | EXP-COMPOSE-2: OFL fonts × grids × break rules, plus printable blind proofs (private fonts via `$PAGEINATOR_PRIVATE_FONTS`) | `results/compose2/` |
| `published1/` (own venv): `run.py`, `validation/make_fixtures.py`, `validation/validate.py` | EXP-PUBLISHED-1: measure real published PDFs (pilot data stays PRIVATE); tool validation against ground truth | `results/published1/` |
| `published1/extract_frames.py`, `compose2/house_compare.py`, `published1/walkthrough.py` | Pilot illustration: export published columns, re-set the same words at the same width (calibrated on the same text), and build a private HTML walkthrough. Outputs are written inside the private dataset only | `$PAGEINATOR_PRIVATE_CORPUS/<dataset>/report/` (never in git) |
| `published1/actualtext.py`, `published1/paragraphs.py` | Exact Devanagari text from production PDFs via `/ActualText`; complete, verified paragraphs. Output is private | `$PAGEINATOR_PRIVATE_CORPUS/<dataset>/report/paragraphs.jsonl` |
| `compose3/run_compose3.py`, `check_determinism.py`, `proofs_round1.py`, `analyze_round1.py` | EXP-COMPOSE-3: asymmetric spacing model on the pilot's own paragraphs (held-out test), plus blind-review round 1 | `results/compose3/` (aggregates); private per-paragraph results and review sheets |
| `pdfx1/make_press_test.sh` (+ `pdfx.py`, `make_press_test.py`, `verify_press_test.py`, `check_pdfx1a_independent.py`, `mutation_test.py`) | EXP-PDF-1: press-test PDF/X-1a page with Pageinator-composed text; 40-check verifier; independent checker; mutation self-test; byte-identical regeneration | private `<dataset>/report/press_test/` or `results/pdfx1/` (synthetic) |
| `published1/headlines.py` (own venv), `head1/run_head1.py`, `proofs_head1.py` (+ `headliner.py`) | EXP-HEAD-1: headline line breaks on the pilot's own headlines (keep-together rules, balanced/fill/first-fit, held-out test), plus the headline blind-review round | `results/head1/summary.json` (aggregates); private per-headline rows and review sheets |
| `page1/page_model.py`, `house_profile.py` (published1 venv), `photos.py` (pdfx1 venv), `compose_page.py` (oracle venv), `compare_page.py` (pdfx1 venv) | EXP-PAGE-1: page models of every printed page, the learned house design language, photos and ads in newsprint CMYK, rebuilds as PDF/X-1a with text wrap, checks against print | `results/page1/` (aggregates); private models, photos, PDFs, comparisons |
| `gen1/generate.py` (oracle venv), `check_gen.py` (pdfx1 venv) | EXP-GEN-1: Pageinator lays out a page itself from its stories and the learned design profile (guillotine search over real typeset module heights), then checks it | `results/gen1/` (aggregates); private PDFs, manifests, side-by-side images |
| `pdf_probe/subset_probe.py` | Whether subsetting keeps glyph IDs | `results/pdf_probe/` |

Every results directory has an `env.json`, or embeds `env`, recording:
- hardware and OS;
- the Python and HarfBuzz versions;
- the oracle manifest hash;
- the corpus and conditions hashes;
- the iteration counts.

Results from different machines are **not** comparable unless their environments are recorded side by side.
