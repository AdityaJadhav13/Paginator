# 12 — Quality Strategy

> **Second-pass review, 2026-10-07.** Added:
- the three-level parity test (§6), which replaces the SSIM threshold;
- press-accepted fixtures (§7);
- the test-value hierarchy (§8);
- oracle preservation, now detailed in `16` §2. Status vocabulary: ADR-021. Baseline: `20`.


**Status:** DECIDED

**Core idea.** Tests must prove *the newspaper is right*. Proving that the code has been looked at is not enough.

- Keep the old Python stack's discipline: invariants, golden data, property tests, and planted-defect meta-tests.
- Drop the current repo's habit of multiplying tests: one regex test generated per file, and placeholder-page measurements.

## 1. Test pyramid by package

| Layer | What it proves | Tools | Where |
|---|---|---|---|
| **Golden vectors** (compose) | Exact glyph IDs, advances, break positions, line widths and overset for a fixed corpus of fonts × texts × styles | Vitest + JSON fixtures | `packages/compose` |
| Property tests | Invariants hold for random input: text conservation (no characters lost or duplicated, order preserved), no overlap, determinism, monotonicity (a wider column never needs more lines) | fast-check | compose, layout-gen, document |
| Planted-defect meta-tests | Each invariant check really fails when a defect is planted (e.g. a dropped word, an overlapping frame, an RGB object) | Vitest | all checkers, preflight rules |
| Unit tests | Pure functions, commands and their inverses, permission resolution | Vitest | everywhere |
| Preflight rule tests | Each rule fires on a crafted document and stays silent on a clean one (B's spec acceptance criteria K1 and K2) | Vitest | `packages/preflight` |
| PDF conformance | Structure (qpdf), our PDF/X-1a inspector, deterministic bytes, text extraction sanity | Vitest + CLI tools in the worker image | `packages/pdf` |
| **Parity** | *(Revised 2026-10-07; the SSIM ≥ 0.995 threshold was arbitrary and is removed.)* Three levels: structural, draw log, raster. See §6 | Kernel PDF inspector, renderer draw log, Playwright + PDFium | CI job `parity` |
| Tenancy | Two orgs; every repository and endpoint returns zero cross-tenant rows; RLS cannot be bypassed by the app role | Vitest + Testcontainers Postgres | `modules/*` |
| API contract | Request/response matches the Zod contracts; generated client compiles | Vitest | `apps/api` |
| E2E | The golden workflow: sign up → publication → edition → import stories and images → place → edit → preflight → export → release → archive → reopen | Playwright | `apps/web` |
| Accessibility | axe checks on app shells and forms; keyboard paths for the editor's non-canvas UI | axe + Playwright | `apps/web` |
| Performance | The budgets in `06` §7 on a golden 16-page edition, against a baseline | Playwright traces + worker benchmarks | CI `perf` (nightly, plus per PR as a smoke run) |
| Generation quality | Hard-constraint pass rate, soft-score distribution, unplaced count = 0 on the corpus; determinism over 100 runs | Benchmark harness | `packages/layout-gen` (nightly) |
| AI evals | Task quality per prompt or model version | Eval harness | `packages/ai` (on change) |
| **Physical** | Real press acceptance and physical print (D11) | Humans | Phase gates |

## 2. Golden data and the Python oracle (Phase 0)

1. Freeze B's `typeset/` and tests into `tools/py-oracle/`, with a pinned venv (Python 3.11, the exact uharfbuzz and fontTools versions).
2. **Align HarfBuzz versions.** The uharfbuzz build must contain the same HarfBuzz version as the pinned harfbuzzjs, or the oracle and the port will disagree for reasons that are not bugs.
3. The oracle writes language-neutral JSON fixtures:
   - inputs: font hash, text, style, measures;
   - outputs: glyph IDs, clusters, advances in µpt, break indices, adjustment ratios, `used_fallback`.

   The corpus covers English, Marathi and Hindi, plus mixed text; edge cases (forced breaks, empty paragraphs, missing glyphs, control characters); and B's 62-paragraph feasibility set.
4. The TypeScript port must match the fixtures **exactly**. Where the port intentionally fixes a B gap (`word_space_max`, ragged-right), the fixture is regenerated and the change is noted in a fixture changelog.
5. Once parity is reached, the oracle is archived. The fixtures, not Python, are the source of truth from then on.

## 3. Fixtures corpus (`tools/fixtures/`)

- **Fonts:**
  - the OFL set from B (Source Serif 4, Source Sans 3, Archivo, Noto Serif/Sans Devanagari, Tiro, Mukta);
  - the pilot's licensed fonts, kept in a private fixtures bucket (not in git) when their licences allow.
- **Editions:**
  - `golden-4p-english`, `golden-8p-marathi`, `golden-16p-mixed` (with ads and photos);
  - one *recreation of a real pilot edition* (with permission).
- **Press-accepted PDFs:** each one carries its acceptance record. Regression means the same input produces the same bytes; if the engine changes, the change is reviewed and re-accepted.
- **Ad artwork:** valid PDF/X-1a, RGB PDF, PDF with transparency, wrong size, missing fonts.
- **Images:** low-DPI, CMYK TIFF, HEIC, a decompression bomb (rejected), corrupted EXIF.

## 4. CI pipeline (GitHub Actions)

```
on PR:  install (pnpm, cached) → lint (eslint + determinism rules + dependency-cruiser boundaries)
        → typecheck → unit+property+golden (packages) → tenancy (Testcontainers) → contract → build
        → parity (Chromium vs Node, 4 golden pages) → perf-smoke → e2e-smoke (happy path) → bundle-size budget
nightly: full e2e, full parity (all golden editions), perf baseline, generation-quality benchmark,
         PDF conformance with internal inspector (+ callas/Acrobat check on the engineering machine weekly)
on prompt/model change: AI evals
```

**Rules agents and humans must not break** (from the old Python stack's discipline, enforced by meta-tests):
- no `skip`/`only` in committed tests;
- no lowering of thresholds without an ADR;
- no `@ts-ignore` in `packages/*`;
- golden fixture changes require a changelog entry.

## 5. What we stop doing

- **Tests that loop one regex check over every file.** Replace them with one dependency-cruiser rule or one lint rule.
- **Tests that compare a component's output with itself** (e.g. checking that RTL DOM order equals the order React produced).
- **Marketing-copy word-ban tests with source citations for every sentence.** Keep a single short claims checklist that people review.
- **Counting tests as progress.** Report gate status instead: parity, press acceptance, edition printed.

## 6. Browser/PDF parity test (added by the 2026-10-07 review)

**Goal:** prove that the browser image and the PDF come from the same resolved layout. A *layout mismatch* (a defect) must be distinguishable from a *rasterisation difference* (expected).

```
ResolvedPage fixture ──► PDF writer ──► PDF ──(L1 parse content streams)──► glyph/image/path list ─┐
        │                                                                                           ├─► compare to ResolvedPage (exact)
        └──────────────► browser renderer ──(L2 instrumented draw log)───────────────────────────────┘
PDF ──PDFium 300 dpi──► raster A          browser canvas at 300 dpi-equivalent ──► raster B ──(L3)──► compare masks
```

**L1, structural (primary; exact):**
- Parse the PDF content streams with the kernel's PDF inspector.
- For every text-showing operation, recover the font, glyph IDs and absolute positions, applying the text matrix and the TJ adjustments.
- Compare these with the ResolvedPage glyph runs. **Glyph IDs must match exactly.** Positions must match within the writer's numeric precision (coordinates written to 3 decimal places in points → tolerance ±0.001 pt).
- Do the same for images (CTM and clip) and paths.
- Any difference is a **layout mismatch**, and the test fails.

**L2, renderer draw log (exact):**
- The renderer can be switched into a mode that records every draw call (glyph ID, transform, image, path) instead of, or as well as, painting.
- The log must match the ResolvedPage exactly. This proves the browser never re-measures or reflows.
- Any difference is a **layout mismatch**.

**L3, raster (sanity; tolerant):**
- Rasterise both outputs at the same scale.
- Binarise, dilate by 1 px, and compare:
  - (a) per-glyph-box ink centroids: an offset greater than 0.5 px at 300 dpi (≈ 0.04 mm) is a **layout mismatch suspect**, which is triaged through L1 and L2;
  - (b) the global differing-pixel ratio within glyph boxes is reported, never gated alone.
- Anti-aliasing, hinting and gamma differences are expected here and are **not** defects.

**Rule:** a parity failure is real only if L1 or L2 fails. L3 alone opens an investigation.

## 7. Press-accepted fixtures (added by the 2026-10-07 review)

**Layout.** Each accepted file becomes a permanent regression asset:

```
fixtures/press-accepted/<press>/<yyyy-mm-dd>-<slug>/
  editable.json, resolved/*.bin, print.pdf (or hash + private-bucket ref if confidential)
  print-profile.json, fonts.manifest.json (+ binaries only where licence permits archival), images.manifest.json
  preflight-internal.json, validator-report.(pdf|xml)  (commercial tool, press profile)
  press-confirmation.(pdf|eml|jpg)  (names the file SHA-256), proof-photos/
  versions.json  (kernel version, oracle/fixture versions, library versions, container digests)
```

**Regression policy:**
- **Same inputs, same kernel version:** the output must be byte-identical.
- **New kernel version:** when output bytes change, CI fails with `PRESS_REVALIDATION_REQUIRED`. A release is allowed only in one of two cases:
  - (a) the L1 structural diff shows no geometry, colour or font change (metadata only), and a human approves; or
  - (b) the new file has been re-validated, against the press profile and, where it matters, by the press itself, and the new acceptance is recorded.

Previously accepted output must never change silently.

## 8. Test-value hierarchy (added by the 2026-10-07 review)

The current-repo test triage is in `15` §11. In brief, tests are ranked by what they protect:
- **T1:** publishing contracts (typography, layout, PDF, parity, press fixtures).
- **T2:** isolation and security.
- **T3:** workflow behaviour.
- **T4:** components and accessibility.
- **T5:** static policy. This is configuration, not tests.

There is no target count.
