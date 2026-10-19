# 02 — Repository Comparison Matrix

> **Second-pass review, 2026-10-07.** Rows that assumed a TypeScript port ("PORT B → TS") are now **conditional** on EXP-ENGINE. The current front-runner extends B's engine in place as the single kernel (ADR-017).

Renderer: Konva-drawing-glyph-paths is a measured bake-off candidate. Konva's own text layout stays rejected.

See `15` §3. Status vocabulary: ADR-021. Baseline: `20`.


**Status: DECIDED.**

**Key**

Codebases:
- **A** = the C++ engine
- **B** = the old Python stack
- **C** = this repo

Decision words:

| Decision | Meaning |
|---|---|
| KEEP | use as-is |
| KEEP+IMPROVE | use, with listed fixes |
| PORT | re-implement in the target stack, preserving behaviour (golden tests) |
| REWRITE | concept kept, new code |
| NEW | nothing usable exists |
| REPLACE-LIB | delegate to a mature library |
| ARCHIVE | keep read-only for reference |
| REMOVE | do not carry forward |

Each row names where the work lives in the target architecture (`03`) and the roadmap phase (`13`).

## Engine and publishing

| Subsystem | A (C++) | B (Python) | C (current) | Decision | Reason | Target / Phase |
|---|---|---|---|---|---|---|
| Font registry, metrics, instancing | Stub (fixed 0.6 em advance) | `typeset/fonts.py`: excellent | — | **PORT B** | Deterministic, content-hashed, dual metrics; proven by tests | `packages/compose/fonts` · P0 |
| Font subsetting | — | `subset_with_map` (fontTools) | — | **PORT B → REPLACE-LIB** | Use hb-subset WASM with retained glyph IDs; B's tests define the expected behaviour | `packages/pdf/fonts` · P0–P1 |
| Script itemization | — | `shape.py` UAX#24 + bracket stack | — | **PORT B** | Correct and tested | `compose/itemize` · P0 |
| Shaping | Stub (codepoint = glyph) | uharfbuzz at upem scale | — | **PORT B on harfbuzzjs** | Same HarfBuzz engine, run as WASM | `compose/shape` · P0 |
| Bidi / RTL | — | Raises `NotImplementedError` | Logical CSS in UI only | **NEW** (ICU4X bidi) | Needed for Urdu; must be in the data model now | `compose/bidi` · P1 model, P5 Urdu |
| Line breaking (Knuth–Plass) | Broken (falls back to greedy) | Correct, per-line measures | — | **PORT B + IMPROVE** | Add emergency stretch, ragged-right, `word_space_max`, multiplication-only maths | `compose/linebreak` · P0 |
| Line-break opportunities (UAX#14) | — | — | — | **REPLACE-LIB** (ICU4X) | Never use `Intl.Segmenter` (results vary by browser) | `compose/segment` · P0 |
| Hyphenation | — | Planned (M1.4) | — | **DEFER**: English at P2, Devanagari none by default | Measured gain is small; observed English broadsheets do hyphenate | `compose/hyphen` · P2 |
| Paragraph / frame composition, baseline grid, widows and orphans, overset | — | Not started (M1.5) | — | **NEW** | Core missing piece | `compose/paragraph`, `compose/frame` · P1 |
| Copyfit | — | Spec ladder (M12) | — | **NEW** following B's spec ladder | Matches how sub-editors work | `layout-gen/copyfit` · P2 |
| Headline fitting | — | — | — | **NEW** | Size and line-count search over the real composition engine | `layout-gen/headline` · P2 |
| Layout / pagination | Greedy grid, `words_per_cell` | Greedy grid, `WORDS_PER_CELL=20` | — | **REWRITE** | Guesses rather than measurements; cannot produce credible pages | `packages/layout-gen` · P2–P3 |
| Variants and scoring | Magic-number scorer | 4 profiles, broken metrics | — | **REWRITE** (concept kept) | B's M12 spec already lists the metric fixes | `layout-gen/score` · P2–P3 |
| Continuations / jumps | `ContinuationLink` | `_build_continuation_map` | — | **REWRITE** inside story allocation | Whether a story jumps changes where it fits | `layout-gen/allocate` · P2 |
| Design grammar | — | `NEWSPAPER_DESIGN_GRAMMAR.md` | — | **KEEP** (knowledge) | Package as the layout unit, rails, tombstoning, jump-line style | `docs/knowledge/` · P0 |
| Colour model | — | `color.py` (CMYK, total ink, pure black) | — | **PORT B** | Small and correct | `packages/color` · P1 |
| Geometry and units | POD `Rect`/`Transform2D` | `geometry/page.py` (mm) | — | **PORT B**, integer micro-units | Determinism (ADR-002) | `packages/document/units` · P0 |
| Stable IDs | Process-global atomic counter | `ids.py` `stable_id` | — | **PORT B** | Content-hash IDs | `packages/document/ids` · P0 |

## Document, editor and rendering

| Subsystem | A | B | C | Decision | Reason | Target / Phase |
|---|---|---|---|---|---|---|
| Editable document model | Document → Spread → Page → Frame; unstable IDs | Ad-hoc Pydantic blocks | D03 in docs only | **NEW** per D03 | Neither implementation fits the needs of pages, packages, stories and locks | `packages/document` · P1 |
| Resolved document | Display list (`render_impl`) | "RLD" in spec only | D03 in docs only | **NEW** | The single geometry that preview and PDF both use | `packages/document/resolved` · P1 |
| Scene rendering | Rectangle rasteriser + bitmap font | Konva (lets the browser wrap text, which is wrong) | — | **REPLACE**: Canvas2D worker that draws resolved glyphs; CanvasKit as fallback | Konva re-wraps text itself, breaking the preview/PDF match | `packages/render` · P0 bake-off, P1 |
| Selection and hit testing | z-order hit test | Konva | — | **REWRITE** using A's ideas | Hit-test against resolved geometry | `apps/web/editor/tools` · P1 |
| Move, resize, transform handles | 8 handles, hit padding, no drag | Konva drag + `/reflow` | — | **REWRITE** using A's geometry | — | P1 |
| Snapping, guides, rulers | `SnapEngine` | — | — | **REWRITE** | — | P1–P2 |
| Commands and undo/redo | 6 separate stacks; `CommandStack` coalescing | `useState` stacks | — | **NEW** single command bus (keep the coalescing idea) | One source of truth | `packages/document/commands` · P1 |
| Story text editing | Byte-offset cursor (breaks UTF-8) | — | — | **REPLACE-LIB** (ProseMirror) | Handles IME and Devanagari input correctly | `apps/web/story-editor` · P1 |
| Persistence and autosave | `.pgn` binary, atomic save + `.bak` | `brand.json` with a lock | — | **NEW** (Postgres + object store); keep the verify-after-write idea | Multi-tenant SaaS | `modules/document` · P1 |
| Plugin kernel | COM-style `dlopen`; the app never uses it | — | — | **ARCHIVE** | Not needed | — |
| Phase-17 rich-text plumbing | 5.7k LOC of wrappers | — | — | **REMOVE** | Adds no capability | — |

## Print

| Subsystem | A | B | C | Decision | Reason | Target / Phase |
|---|---|---|---|---|---|---|
| PDF writer | ASCII Helvetica, no embedding | Spec M10 (excellent) | Research doc | **NEW** in TS, built from B's M10 spec | No existing writer is usable | `packages/pdf` · P0 single page, P1 |
| PDF/X validation | — | Spec assumes veraPDF (wrong) | RJ04 is correct | **Own rule engine + qpdf + pdfium + gs inkcov**; one callas/Acrobat seat for checking test files in CI only | No open-source PDF/X validator exists | `packages/preflight` · P1 |
| Preflight rules | — | 35 rules (M11) | Research doc | **PORT the B spec** into rule modules | Complete and well reasoned | `packages/preflight` · P1–P2 |
| Images / ICC | Placeholders | Images not placed; ICC CI check exists | Research doc | **NEW** (sharp/libvips + lcms2) | Use mature libraries | `apps/worker/images` · P1 |
| Ads | — | Spec M9 + grammar positions | — | **NEW** | First-class content | `modules/ads` · P2 |
| Imposition | — | Spec M10 | — | **DEFER** (presses usually impose) | Confirm in pilot fact-finding | P3+ |

## Platform

| Subsystem | A | B | C | Decision | Reason | Target / Phase |
|---|---|---|---|---|---|---|
| Backend API | — | 122-line FastAPI, no auth | None | **NEW**: TS modular monolith | ADR-001 | `apps/api` · P1 |
| Database | — | None | None | **NEW**: Postgres with row-level security | ADR-007 | P1 |
| Jobs | — | None | Docs (outbox) | **NEW**: Graphile Worker + outbox | ADR-007 | P1 |
| Auth | — | None | Simulated session (good UX) | **NEW** (Better Auth); **KEEP** C's session UX and race guards | Standard, maintained auth library | `modules/identity` · P1 |
| RBAC / tenancy | — | — | Scoped mocks | **NEW** using C's scoping concepts | ADR-007 | P1 |
| UI kit and tokens | — | — | Solid | **KEEP** | Accessible and RTL-aware | `apps/web/src/ui` · now |
| Routes and shells | — | — | Solid | **KEEP+IMPROVE** (move the root out of `demo/`) | — | P0 |
| Mock services | — | — | Scenario controller | **KEEP** for UI tests; **REPLACE** the data path with a generated API client | — | P1 |
| Marketing site (UI005) | — | — | Uncommitted | **KEEP**; trim claim-governance machinery | — | now |
| AI layer | 2.8k LOC, unconnected | None | Docs | **NEW** behind a provider adapter | ADR-009 | P3 |
| Newsroom / ingestion | — | `ingestion/` (payload normaliser only) | Research doc | **NEW** | ADR-010 | P4 |
| Archive | — | — | Docs | **NEW** | `10_ARCHIVE…` | P2 |
| Observability | — | No logging | — | **NEW** (OTel, Sentry, pino) | — | P1 |
| CI | — | GitHub Actions `make check` | None | **NEW** in the monorepo; reuse B's meta-test ideas | — | P0 |

## Process

| Practice | A | B | C | Decision |
|---|---|---|---|---|
| Specs | `current_task.md` step scripts | 89 KB master spec | 600–900 lines per unit | ≤ 150 lines per unit; one master architecture (this set) |
| Tests | 7k asserts; disabled when `NDEBUG` is set | Invariants, property tests, planted-loss meta-tests | 1,347 mostly regex loops | **KEEP B's style**: golden vectors, invariants, property tests. **REMOVE** regex-loop multiplication |
| Agent guardrails | Strict "do not touch" rules | Hooks + meta-tests | Long reviews | Package boundaries + size budgets + golden gates (`14_AGENT_WORKFLOW.md`) |

## Repository fate
- **A** is archived read-only. Nothing is copied except ideas, which are recorded in `01`.
- **B** is archived read-only, with exceptions:
  - `typeset/` and its tests are frozen as the **oracle** in a pinned Python venv that generates fixtures in P0, and are retired after parity.
  - The fonts and the ICC/font audit scripts are copied.
  - `NEWSPAPER_DESIGN_GRAMMAR.md`, spec M9–M12 and the PROGRESS measurements are copied into `docs/knowledge/`.
- **C** becomes the monorepo root (`03_TARGET_ARCHITECTURE.md` §Repository layout).
