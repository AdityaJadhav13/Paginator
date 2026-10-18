# 01 — Repository Audit

> **Second-pass review, 2026-10-07.** Audit revalidated. Findings stand, with two refinements:
- B's `typeset/` is production-grade for shaping and line breaking but **not for composition**: Knuth–Plass is infeasible for 0/240 synthetic newspaper paragraphs under its default spacing policy.
- The oracle has no `mr`-tagged tests.

See `15` §2 and `16` §0. Status vocabulary: ADR-021. Baseline: `20`.


Status: DECIDED (findings). Audit date: 2026-10-07. Method: read-only inspection of source, tests, docs and git history in all three codebases.

## Why this matters

The current architecture program decided "Fresh codebase; prior work not audited" (D12; `PHASE_1_ANALYSIS.md:30`). This audit makes good that gap. There are **three** codebases, not two:

| ID | Path | Era | Status |
|---|---|---|---|
| **A** | `~/Engineering/Development /My Projects/Paginator-CPP-Engine` | May–Aug 2026, 244 commits | Archived 2026-08-12 (commit `0ee8606`) |
| **B** | `~/Engineering/Development /My Projects/Paginator` | Aug 2026, 12 commits | Extracted from A; dormant since 2026-08-14 |
| **C** | `~/Desktop/Paginator` (this repo) | Sep 2026 → now, 14 commits on stacked branches | Active (`feature/ui005-public-product-journey`) |

**One-line diagnosis.** In all three attempts, process and scaffolding outran the critical path: real text measurement, then resolved geometry, then a PDF the press accepts. Only one piece of code attacks that path, B's `paginator/typeset/`, and it was never connected to anything.

---

## A. C++ engine (archived)

### Inventory
- 393 `.cpp`/`.h` files and 78,348 LOC under `cpp/`. 37,496 of those lines are tests.
- CMake 3.20, C++20, `-Wall -Wextra -Wpedantic`.
- **The only third-party dependency is SDL2.** There is no HarfBuzz, FreeType, ICU, Skia, zlib or PDF library.
- Tests: a home-grown harness in which one `main()` (`tests/test_kernel.cpp`) calls 1,468 `test_*` functions containing 7,265 `assert(` calls.
  - CTest registers only 2 entries.
  - Tests compile to no-ops under `NDEBUG`, because they rely on `assert`.
- The build cache is stale: `CMakeCache.txt` points at the old repo path.

| Module | Files | LOC | Note |
|---|---|---|---|
| ui_render | 100 | 18,575 | Software rasteriser, chrome, Phase 16–17 rich-text plumbing |
| ui_shell | 100 | 8,861 | Docking, panels, selection tool, transform handles |
| ai | 12 | 2,839 | Not core; not wired to the product |
| persist | 12 | 1,684 | `.pgn` binary format, atomic save |
| core headers | 18 | 1,665 | COM-style interfaces |
| export | 7 | 1,169 | PDF writer |
| text | 3 | 1,125 | Stub font, stub shaper, line breakers |
| ui | 3 | 1,016 | Older tools, `CommandStack`, `SnapEngine` |
| layout | 3 | 802 | Greedy grid packer (mirrors B's Python) |
| dom / render / engine | 11 | 1,363 | Document tree, display list, plugin kernel |

### Findings by subsystem

**Typography is a stub.**
- `modules/text/src/text_impl.cpp:158` says: *"Treats every codepoint as having advance = font.size * 0.6"*. Line 197 returns `s.size_pt * 0.60`.
- `GetGlyphId` returns the codepoint.
- Rich text is painted as **coloured bands, not glyphs** (`rich_text_render.cpp:97`).
- Editor chrome uses a hand-coded 3×5 bitmap font.

**The Knuth–Plass breaker is broken** (`text_impl.cpp:440–594`).
- Too-loose candidates drop their active node.
- The first glue has zero cumulative stretch, so `compute_ratio` returns `1e9` and the root node is dropped.
- So it falls back to greedy on almost any real input.
- The test (`test_knuth_plass_returns_lines_within_tolerance`) only asserts `n >= 3`, so it passes via the fallback.

**Layout** (`layout_impl.cpp`, 709 lines) is greedy first-fit on cells:
- size tables `{6,4,3,2,2}`;
- capacity = `w*h*words_per_cell`;
- the continuation queue's `push_front` reverses order.

It is not linked into the editor app.

**Rendering.**
- The rasteriser (`software_renderer.cpp`) fills axis-aligned rectangles only.
- A separate display-list renderer (`render_impl.cpp`) exists but the live app does not use it.

**PDF** (`export/src/pdf_exporter.cpp`, 535 lines).
- Base-14 Helvetica with WinAnsi encoding (lines 6, 9, 204), so any non-ASCII text is corrupted.
- No font embedding and no compression.
- Image placeholders only.
- Bleed/trim boxes and crop marks are present.

**Editor interaction.**
- Selection, hit-testing by z-order, and 8 transform handles (7 px box, 2 px hit padding).
- No resize-by-drag yet.
- Two tool systems (the older `ui` module and the Phase-18 shell).
- **At least six independent undo stacks.**
- The text cursor uses byte offsets, so editing non-ASCII text corrupts it.

**Persistence.**
- Bounds-checked binary reader.
- Atomic save: temp file → reload-verify → `.bak` → rename. No fsync and no checksum.

**Bloat.**
- Phase 17 added 5,666 LOC of "runtime rich-text boundary/adapter/smoke/gate" wrappers, which still draw no glyphs.
- 1,165 LOC of `*_smoke.cpp` ships inside the production library.
- An FNV-1a hash is duplicated in 11 files.

**Why it was archived.**
- `README.md` says development moved to the Python/React web stack.
- The commit pace collapsed after May 4. The last ~50 steps went into rich-text plumbing that still drew no text.

### Verdict
**ARCHIVE.** What to carry forward are ideas, not code:
- verify-after-write atomic save with a `.bak`;
- command coalescing (`CommandStack`);
- hit-testing in z-order, transform-handle geometry and cursor routing;
- `ContinuationLink` (`continued_on_page` / `continued_from_page`);
- the box/glue/penalty `BreakItem` model.

---

## B. Old Python web stack

### Inventory
- **Size and runtime:** 41 package files (~4,100 LOC). Python pinned to 3.11 only.
- **Libraries:** FastAPI 0.141 and Pydantic 2.13 with `extra="forbid"`.
  - Runtime typography libraries: `uharfbuzz`, `freetype-py`, `fontTools`.
  - Named in the spec but not installed: pikepdf, pyphen, SQLAlchemy.
- **Lockfile:** `requirements.lock` (uv) pins 40 packages with hashes.
- **Tests:** 349 tests collected, including 11 Hypothesis property tests.
  - Tooling: `mypy --strict` and ruff.
  - CI: `.github/workflows/check.yml`, which runs `make check`, a font-licence audit and an ICC check.
- **Fonts:** 16 OFL fonts in `assets/fonts/{latin,devanagari}`.
- **Missing:** a database, authentication, logging and a job queue.

### Two layers that never touch

**1. `paginator/typeset/` (1,977 LOC): production grade, with no caller outside its tests.**

The only other mention of it is a comment in `errors.py:5`.

**`fonts.py` (629 lines): `FontRegistry`, `FontFace`.**
- Registration order is deterministic (sorted, ties broken by file SHA-256).
- Variable fonts are instanced, and the same bytes feed HarfBuzz, FreeType and the subsetter.
- Two sets of vertical metrics: a typographic/hhea pair for line spacing, and an ink pair (`max(head.yMax, usWinAscent)`).
- Each glyph's ink height is cached.
- `subset_with_map` returns the old→new glyph-ID map, with `recalcTimestamp=False` so output is byte-identical.
- Font IDs are content-hash `stable_id`s.

**`shape.py` (345 lines): `itemize`, `shape_run`.**
- Itemises by script (UAX#24), using a bracket stack so paired brackets take the right script.
- Shapes at the font's units-per-em scale (avoids 26.6 fixed-point rounding).
- Sets `DO_NOT_INSERT_DOTTED_CIRCLE | REMOVE_DEFAULT_IGNORABLES`.
- Applies tracking per cluster and flips the y axis (y-up → y-down).
- Raises `MissingGlyphError` instead of emitting `.notdef`.
- Right-to-left text is not implemented.
- The language tag (mr vs hi) is optional, although it changes the glyph for श.

**`linebreak.py` (629 lines).** A real Knuth–Plass:
- four fitness classes;
- demerits `(10 + 100|r|³)²` (line 496);
- `ADJ_DEMERITS = 10000`, `FLAGGED_DEMERITS = 3000`;
- a separate measure per line;
- a greedy fallback (`break_greedy`, line 268) whose use is counted;
- correct handling of multiple forced breaks (commit `0651838`).

Its gaps:
- `word_space_max` is not enforced;
- `style.align` is ignored, so ragged-right is impossible;
- the hyphen penalty is hard-coded (`DEFAULT_LINE_PENALTY*5`, line 219);
- `ink_overhang_mm` is always 0.

**`schemas.py` (353 lines).** `GlyphRun`, `TextStyle` (~35 fields, most not yet consumed), and `Box`/`Glue`/`Penalty`/`Breakpoint`.

**Tests.** About 2.3k LOC (`tests/test_typeset_*.py`) lock real glyph IDs and metrics.

**2. The application path, which is throwaway.**
- `overflow/splitter.py:5`: `WORDS_PER_CELL = 20`.
- `grid/schemas.py:7`: `DEFAULT_ROWS = 12`, split into 30/50/20% zones.
- Greedy cell-scan placement (`placement/engine.py`).
- Queue-based pagination with a 12-segment cap (`pagination/engine.py`).
- Four sizing variants, each scored with weight 1.0. `CLAUDE.md` itself admits the metrics are broken.
- `reflow/` moves blocks but does not reflow text.
- Images are accepted but never placed. No ads, copyfit or PDF.

### Defects
- **Hidden text loss.** When the segment cap is hit, or `split_text` returns `None`, the remainder is dumped into one block. `export/html.py` then hides the excess with `overflow:hidden`. Word-conservation tests still pass.
- **CSS/HTML injection.** `export/html.py:118` `_stylesheet()` interpolates unvalidated brand strings into `<style>` (line 191). They arrive through the unauthenticated `PUT /brand`.
- **Unbounded work.** `/layout` runs 4 paginations of up to 200 pages each, with no request limits.
- **Native handles.** The script cache is an unbounded global, and `FontFace` holds native handles that are not thread-safe.

### Knowledge assets (more valuable than most of the code)

**`PAGINATOR_BUILD_SPEC.md` (89 KB, milestones M0–M16).** About 1.5 of 17 milestones are done (M0, M0a, M1.1–M1.3). Sections to reuse:
- **M10, PDF writer** (line 1123). The exact PDF/X-1a:2003 object structure: Identity-H CIDFontType2, ToUnicode, OutputIntent `ISOnewspaper26v4`, TrimBox/BleedBox, overprint for 100% K text, marks and imposition order.
- **M11, preflight** (line 1213). 35 rules (TXT/FNT/COL/IMG/GEO/ADS/JMP/EDT) with severities, and the policy that errors block export while overriding a warning requires an audit entry.
- **M12, layout search** (line 1281). Hard constraints, the metric fixes, new metrics (tombstoning, greyness, photo distribution, column fill), and the **copyfit ladder**.
- **Correction:** M10 J1 expects veraPDF to validate PDF/X-1a. veraPDF only validates PDF/A and PDF/UA (as of v1.30.2). See ADR-006.

**`NEWSPAPER_DESIGN_GRAMMAR.md`.** Observations from a real Indian broadsheet edition:
- 8 columns, dotted column rules;
- five page roles (folio bar, left rail, news hole, right rail, full-width foot);
- **the package (headline + deck + byline + body + photo + sidebar) is the atomic layout unit**;
- two headline families used against tombstoning;
- drop caps;
- jump lines that name the destination headline fragment;
- a palette of two inks plus tints;
- ad positions `jacket` and `masthead_strip`.

**`PROGRESS.md`** records measurements:
- Knuth–Plass at a 30.25 mm column is feasible for 0/62 English and 1/62 Devanagari paragraphs.
- An 8 mm `emergencystretch` raises that to 59/62.
- Hyphenation adds 0 feasible English paragraphs in that setting.
- It also records Devanagari ink measurements and an analysis of `hyph_mr_IN`.

**`.claude/`.** Strong invariant discipline: conservation tests, `test_reconciliation_detects_a_planted_loss`, byte-identical pipeline tests, and meta-tests that stop rules from being quietly weakened.

### Verdict
**PORT `typeset/`, `ids.py`, `color.py` and `geometry/` into TypeScript**, using the Python code as a golden-vector oracle (ADR-002, `12_QUALITY_STRATEGY.md`).
**Migrate** the knowledge assets into `docs/knowledge/`. **ARCHIVE** the rest.

---

## C. Current repo (Desktop/Paginator)

### Inventory
- **Code:** `frontend/` holds ~7.7k LOC of TS/TSX plus 1.8k CSS.
  - Runtime: React 19.3, React Router 8.4.
  - Tooling: TS 7.0.2, Vite 8.3, Vitest 5, jsdom, Testing Library, axe-core.
  - Exact-pinned dependencies (`DEPENDENCIES.md`).
- **Docs and specs:** about 10.4k lines.
  - The decision register is D01–D13, OP01–14, RD01–12, DF01–06 and RJ01–07.
  - 17 phase and research documents.
  - Specs UI001–UI005: 3.2k lines.
  - Reviews: 3.0k lines.

### What exists
- **`src/ui/`.**
  - `--pg-*` tokens with contrast tests and logical (RTL-aware) CSS.
  - 12 accessible controls and 7 layout primitives.
- **`src/app/`.**
  - Typed route table (`routes.ts`, about 31 routes).
  - Four shells, `RouteAnnouncer`, `SkipLink`, breadcrumbs.
- **Mock service layer (UI003).**
  - Four DTOs and six read operations returning a typed result.
  - Scenario control for latency, failure and denial.
  - Seed data includes an Urdu/RTL publication.
- **Simulated session (UI004).** Profile picker, org/publication switching, **stale-request race guards** (`SessionProvider.tsx`).
- **Public marketing journey (UI005, uncommitted).**
  - Five pages; copy lives in `content.ts` (1,082 lines).
  - A 51-term forbidden-claims test.

### What does not exist
- An editor, canvas, document model, composition/typography or PDF code.
- Any backend.
- 22 of the 31 routes render `PlaceholderScreen`, including the editor route (`src/demo/ui002/EditorRouteContent.tsx`).

### Structural and quality issues
- **The app root lives under `src/demo/`.** `main.tsx` renders `Ui004App` from `src/demo/ui004/routeTree.tsx`. Durable wiring depends on code labelled disposable.
- **Test volume is inflated.**
  - 1,347 tests come from about 450 `it(` sites.
  - Loops that generate tests multiply regex checks per file (`tests/ui001/boundary.test.ts:64-73`).
  - The repo's own review already flagged this (`UI001_INDEPENDENT_CODE_REVIEW.md`, finding M-11).
- **Specs are oversized.** 600–900 lines per unit (UI005: 888) for a login picker and marketing pages.
- **Delivery is thin.**
  - 5 of 26 backlog units are done, all of them foundation or marketing.
  - `main` holds only `0a406b7`, and `specs/completed/` is empty.
  - RM04, "early publishing feasibility", was meant to start early "to prevent the UI from becoming a substitute for feasibility". It has not started.
- **Smaller issues.**
  - The error types in `services/result.ts` embed user-facing copy as literal types.
  - `EditionDto` has only `label`.
  - No ESLint, CI, E2E tests or error boundaries.

### Verdict
**KEEP + IMPROVE:**
- the decision register (amended by ADRs in `ADR/`);
- `src/ui`, `src/app/routes.ts` and the shells;
- the session race handling;
- the typed result and scenario controller;
- the marketing pages.

**RESTRUCTURE** into `apps/web` and move the app root out of `demo/`.

**SHRINK:**
- collapse regex-loop tests to one test per rule;
- keep specs to ≤ 150 lines;
- trim the claim-governance machinery.

---

## Cross-repo lessons
1. **Real measurement first.** Every layout engine across A and B was built on word-count guesses. That is why none of them produced a credible page.
2. **Integration beats isolated excellence.** B's best code (`typeset/`) and A's best interaction code both sat unconnected.
3. **Wrapping a stub does not make it real.** A's Phase 17 and C's UI-first program both added rigour around placeholders.
4. **A press-acceptance gate must come first.** No codebase has ever produced a PDF that a press could accept. Phase 0 makes that the gate (`13_ROADMAP_AND_RISKS.md`).
