# 16 — Phase 0 Evidence Plan

Status: ACCEPTED as the plan. Every experiment's *outcome* is open until its evidence exists.
Created by the second-pass review (`15_SECOND_PASS_REVIEW.md`). Supersedes the Phase 0 task list in `14` §"Phase 0 task list".

Phase 0 is **not feature development**. It answers the questions that would invalidate the architecture if answered badly. Each experiment has three things fixed *before* it runs:
- the hypothesis;
- the method;
- the winner and failure criteria.

Nobody may change these criteria after seeing results. A change needs a new dated revision of this document that explains why.

## 0. Evidence already gathered during the review (2026-10-07)

| Fact | Evidence | Consequence |
|---|---|---|
| The old Python engine runs and its tests pass | Ran `pytest` on `tests/test_typeset_{fonts,shape,linebreak}.py` in repo B: **182 passed**. Read-only (`-p no:cacheprovider`, `PYTHONDONTWRITEBYTECODE=1`); repo B's git status was unchanged. Environment: uharfbuzz 0.56.0, which bundles **HarfBuzz 14.3.0**; fontTools 4.63.0 | Repo B can be frozen as an executable oracle (§2) |
| Python composition is fast enough for server-side use | Micro-benchmark (scratchpad `bench_typeset.py`, Apple-silicon laptop): 90-word paragraph → shaping 0.25 ms (English) / 0.41 ms (Marathi); building line-break nodes 0.25 ms; breaking 0.1–0.5 ms | About 1 ms per paragraph. A 16-page edition (about 1,000–1,500 paragraphs) resolves in roughly 1–2 s on one core, before composition overhead. Option E (§1) is plausible, but it has to be measured on server hardware |
| **Justified composition at newspaper widths is unproven** | With B's default spacing (word space min 0.75 / max 1.5, tolerance 1.0), Knuth–Plass found a feasible justification for **0/240** synthetic paragraphs at 30.25, 45 and 60 mm, in both English and Marathi. A trace showed this is a genuine infeasibility, not a defect: a 5-word line at 60 mm needs about 6.9 mm of stretch, and its word spaces allow only 0.41 mm. Loosening to max 3.0 / tolerance 2.0 gives Marathi at 60 mm 31/40, but only 4/40 at 45 mm and 0/40 at 30 mm | The engine breaks lines correctly but has **no newspaper justification policy**. The greedy fallback produced spacing ratios up to 4.7. Gate 1 must prove composition quality, not just shaping. Caveat: the corpus was random vocabulary; real text must be used (§3) |
| The oracle has no Marathi-tagged tests | B's Devanagari tests use `language="hi"` | The Marathi corpus must be generated with `mr` (§2.3) |
| No open-source PDF/X validator was found | veraPDF covers PDF/A and PDF/UA; PDFBox preflight covers PDF/A-1b only | See `18` §2 and ADR-022 |
| Newsprint profile values differ from v2's assumption | WAN-IFRAnewspaper26v5 (from ISO 12647-3:2013) has a total ink coverage limit of **220%**; v2 assumed about 240% (the older 26v4) | The total ink limit comes from the press (`17`) |
| Typical newspaper ad specifications require PDF/X-1a:2001 and some forbid TrueType | Published ad specifications (see `18` sources) | v2's "TrueType-only MVP" has to be proven with the pilot press (`17` §F) |

---

## 1. Core engine decision experiment (EXP-ENGINE)

### 1.1 The question
Which implementation architecture gives deterministic, shared publishing behaviour across browser preview, server-side resolution and PDF output, while meeting the multilingual-correctness, interactive-performance and development-speed requirements?

### 1.2 Reframing found by the review
v2 assumed the browser must *compose* text (ADR-002). It need not.
- If one authoritative resolver (the **publishing kernel**) runs only on the server, the browser can draw its ResolvedDocument display list. Parity between preview and PDF then holds *by construction*: there is one engine and no second implementation to keep in step.
- Composing in the browser is then a **performance optimisation**, adopted only if server round-trips miss the interaction budgets.

So this experiment asks two questions in order:
1. Is server-only resolution good enough?
2. If not, which client-capable kernel should we build?

### 1.3 Options

| Option | Shape | For | Against |
|---|---|---|---|
| **E: single server kernel (Python, extended from oracle-v0)** | Python kernel service; the browser renders display lists | Kernel code already exists and its 182 tests pass. Best ecosystem for PDF and fonts (pikepdf/qpdf, fontTools with `retain_gids` subsetting, Pillow ImageCms/LittleCMS, OR-Tools CP-SAT). Preview/PDF parity is trivial. Restricted font binaries never leave the server | Every reflow needs a network round-trip. Editing stops if the kernel service is down (§1.6). Python CPU cost in generation search. The kernel is a second backend language if the API stays in TypeScript |
| **A: TypeScript orchestration + WASM HarfBuzz/ICU4X** | Same TS kernel in browser workers and in Node | One language with the frontend; offline-capable reflow; mature WASM HarfBuzz | Requires a full port. Determinism needs integer-only discipline across JavaScript engines. The TS PDF ecosystem is weak (pdf-lib is unmaintained; forks exist). Font binaries must reach the browser |
| **B: Rust core → WASM + native** | Rust kernel (HarfRust, ICU4X, own line breaker, `pdf-writer`-class PDF crate) with bindings | One deterministic codebase for both targets, with the best performance. HarfRust 0.13.2 tracks HarfBuzz 14.3.1 and reports < 25% slowdown versus C++ | A third language and a full port. The team has no shown Rust experience. Python/TS bindings add build complexity. HarfRust is young (2025). Its PDF/X stack would be our own |
| **C: C++ core → WASM + native** | HarfBuzz/ICU4C/FreeType native, compiled with Emscripten | Mature underlying libraries; HarfBuzz itself is C++ | The project's own history (repo A: 78k LOC, no glyph ever rendered). Heaviest build (Emscripten, ICU4C data size). Weakest agent velocity and memory safety. **Desk-rejected**; reconsidered only if A, B and E all fail |
| **D: Hybrid (TS app + small WASM kernel for break/flow)** | Option A's orchestration, with hot loops (line breaking, frame flow) in Rust→WASM | Contains Rust to a small kernel | Two kernels' worth of boundary code. Only worth it if A passes everything except throughput |

### 1.4 Common workload

Fixtures come from §2 and §3:
- **W1 paragraph set:** 1,200 real paragraphs (English, Marathi and mixed), drawn from the pilot's published editions where we have permission. Until then, use public-domain Marathi text (government press releases) plus B's corpus.
- **W2 page:** one real broadsheet page reconstructed from a published edition. About 8 columns, 20–25 stories, about 180 paragraphs, 4 photos, 2 ads.
- **W3 edition:** 16 pages, about 1,200–1,500 paragraphs.
- **W4 interactive script:** 200 recorded operations, run against W2:
  - resize text frame (×60);
  - edit 1–20 words in a story (×80);
  - change headline (×30);
  - change a style (×10);
  - move frame (×20);
- **W5 copyfit trials:** for every story on W2, 6 column spans × 4 headline sizes × 3 trackings.

### 1.5 Method (time-boxed)

| Step | Work | Time box |
|---|---|---|
| E1 | Extend the frozen oracle into a **kernel prototype**, `kernel-py v0`: <br>• composition policy (§3.1) <br>• frame flow over columns <br>• headline fit <br>• ResolvedPage output, conforming to the contract in §1.8 | Shared with Gate 1 work (it is needed anyway) |
| E2 | Run `kernel-py` as a stateless HTTP service on a reference server. Use AWS ap-south-1 c7i.large (x86) and c7g.large (ARM): same image, two architectures | 2 days |
| E3 | Thin browser prototype (bake-off harness, §4): <br>• apply W4 operations; <br>• request a resolve; <br>• render the display list. <br>Run over three networks: local, **emulated pilot network** (RTT from pilot measurement P0-14, default 60 ms + 1% loss), and degraded (150 ms + 3% loss) | 3 days |
| A1 | TS slice: <br>• harfbuzzjs shaping; <br>• ICU4X segmentation; <br>• port of B's `linebreak.py`; <br>• frame flow for W1/W2 only. <br>No PDF | **8 engineer-days, hard stop** |
| B1 | Rust slice with the same scope: HarfRust (or `harfbuzz-sys`), ICU4X, line breaker, flow → WASM and native | **8 engineer-days, hard stop**. Run only if E fails a budget **and** A fails a hard criterion |
| D1 | Swap A's line breaker for B's Rust/WASM line breaker | 2 days. Run only if A passes everything except throughput |

### 1.6 Measurements

| ID | Metric | How measured |
|---|---|---|
| M1 | Shaping correctness | % of shaping fixtures with exactly matching glyph IDs and clusters, against HarfBuzz 14.3.x |
| M2 | Line-break correctness | % of break fixtures equal to oracle-v0, or differing by an intentional delta recorded in the changelog |
| M3 | Determinism | Resolved-page hash identity. E: x86 vs ARM Linux. A/B/D: Node, Chrome, Firefox and Safari |
| M4 | Interactive latency | From operation to updated canvas, p50/p95/p99 over W4, per network profile |
| M5 | Throughput | W3 full resolve (s); W5 trials per second per core |
| M6 | Cold start | Kernel and engine initialisation time; browser WASM download size (gzip) |
| M7 | Memory | Kernel RSS with W3 loaded; browser heap with W2 |
| M8 | Availability coupling | What a user can still do when the kernel service is unreachable |
| M9 | Change velocity | Wall-clock time for a fresh agent session plus a human reviewer to implement change **X1**: add ragged-right alignment, with fixtures, in each slice. Measures how hard the code is to change, not who wrote it |
| M10 | Operational cost | Toolchains needed in CI, CI minutes, number of build artefacts |

### 1.7 Pre-registered decision rule

**Hard criteria:** an option is eliminated if it fails any of these.
- H1: M1 = 100%.
- H2: M2 = 100%, counting documented intentional deltas.
- H3: M3 hashes identical on every target runtime of that option.
- H4: no licence blocker (`18`).

**Budget criteria** (from §5):
- B1: resize release → updated frame, p95 ≤ 250 ms on the emulated pilot network.
- B2: text edit → canvas update, p95 ≤ 400 ms. ProseMirror echoes keystrokes locally at once, so this budget covers the canvas update only.
- B3: W3 full resolve ≤ 5 s.
- B4: W5 trials ≥ 2,000 per second per core, which keeps 16-page generation inside 60 s by the estimate in `07`.

**Decision:**
1. If **E** passes H1–H4 and B1–B4, **adopt E** as the kernel through Gate 4.
   - Re-test client composition only if production telemetry shows p95 interaction latency above budget for more than 5% of sessions.
   - Mitigate M8 as described in ADR-020.
2. Otherwise pick the client-capable option that passes H1–H4 and B1–B4 with the best M9/M10. Ties go to **A** (one language with the frontend).
3. **D** is chosen only when A fails only B4.
4. **C** is not built unless every other option fails a hard criterion.

**Output:** a decision memo (`docs/architecture/v2/decisions/EXP-ENGINE.md`) plus an update to ADR-017's status.

### 1.8 Kernel contract, defined now in any case (language-neutral)

These are JSON Schemas, versioned, in `contracts/kernel/v0/`:
- **`ResolveRequest`**:
  - the EditableDocument page subset;
  - story revisions;
  - the font manifest (hashes);
  - the profile version;
  - the kernel version.
- **`ResolvedPage`**:
  - glyph runs: font hash, glyph IDs, integer positions, cluster mapping;
  - images: transform and clip;
  - paths;
  - ad XObject references;
  - overset report;
  - hash.
- **`ExportRequest` / `ExportResult`**.

Every option implements the same contract, which keeps the rest of the product independent of the engine choice.

---

## 2. Python oracle preservation plan (ORACLE)

### 2.1 Freeze before anything else
1. **Snapshot.**
   - Copy (do not move) repo B's `paginator/typeset/`, `ids.py`, `color.py`, `errors.py`, the `tests/test_typeset_*.py` files, `assets/fonts/` and `requirements.lock` into `tools/oracle/v0/` of this repo.
   - Record the source commit `4694f81` and a SHA-256 manifest of every copied file.
   - Repo B itself stays untouched.
2. **Environment.** A Docker image, `python:3.11.14-slim@sha256:<digest>`, with dependencies installed from `requirements.lock` hashes using uv.
   - Record uharfbuzz 0.56.0 (HarfBuzz 14.3.0), fontTools 4.63.0, freetype-py and Pydantic versions in `ORACLE_VERSION.json`.
   - The image digest becomes the oracle's identity.
3. **Self-check.** The 182 typesetting tests must pass inside the image. CI re-runs them whenever fixtures are regenerated.
4. **Immutability.** `oracle-v0` is never edited.
   - A defect found in it is recorded in `tools/oracle/v0/KNOWN_DEFECTS.md`.
   - The fixture marks the affected expectation as `oracle_defect: <id>`.
   - Fixes go into the *kernel*, not into the oracle.

### 2.2 Fixture schema (`fixtures/typeset/v1`)

```jsonc
{ "schema": "pageinator.fixture.typeset/1", "id": "mr-body-030mm-0142", "category": ["marathi","conjunct","narrow"],
  "input": { "text": "…(NFC)…", "language": "mr", "script": "Deva", "direction": "ltr",
             "font": { "sha256": "…", "family": "Noto Serif Devanagari", "axes": {"wght":400,"wdth":100} },
             "size_pt": 9.5, "leading_pt": 11.0, "measures_mm": [30.25],
             "style": { /* every TextStyle field, explicit; no defaults implied */ },
             "algorithm": "knuth_plass", "hyphenation": null },
  "expected": {
    "generator": { "oracle": "v0", "image": "sha256:…", "harfbuzz": "14.3.0" },
    "shaping": { "glyph_ids": [], "clusters": [], "x_advances_fu": [], "y_offsets_fu": [], "upem": 1000 },  // integers, exact
    "breaks":  { "node_indices": [], "ratios_hex": [], "used_fallback": true, "natural_widths_hex": [] },     // floats as float.hex() for bitwise compare
    "derived": { "line_count": 0, "paragraph_height_mm_hex": "…" },
    "not_in_v0": ["overset", "continuation", "justified_positions"]  // honest about what the oracle cannot produce
  } }
```

**Rules:**
- Shaping output is stored in **font units (integers)**, so it compares exactly in any language.
- Floats are stored as hex strings for bitwise comparison against the oracle itself. Cross-language ports compare ratios within 1e-9 and widths within 1 µpt.
- Overset, continuation state and final justified glyph positions do **not** exist in oracle-v0. They become kernel fixtures (`fixtures/compose/v1`) once `kernel-py v0` produces them. They are reviewed by humans (§3), not generated by an oracle.

### 2.3 Corpus (initial target: about 1,500 fixtures)

| Category | Examples | Approx. count |
|---|---|---|
| English body | Short and long words, numbers, punctuation, quotes, em dashes | 200 |
| Marathi body (`mr`) | Real news text: civic, crime, politics, sports, obituaries | 400 |
| Hindi body (`hi`) | Real news text | 150 |
| Mixed mr/en | Brand names, URLs, abbreviations (`BJP`, `IPL`), Latin digits | 150 |
| Numbers | Devanagari digits ०–९ versus Latin; currency (₹), percentages, dates, scores | 80 |
| Punctuation | Danda । and double danda ॥, Latin full stop in Marathi, quotes, brackets (bracket-stack itemisation) | 80 |
| Conjuncts and matras | क्ष ज्ञ त्र श्र द्ध द्व ह्म, reph र्क, half forms, eyelash ra (र्‍), ZWJ/ZWNJ sequences, nukta, candrabindu/anusvara, vowel signs on conjuncts | 150 |
| Marathi-specific forms | ळ, the `mr` vs `hi` locl differences in the chosen fonts (verified per font) | 40 |
| Widths | 1-column broadsheet (≈30 mm), 2-col, 3-col, rails; 6/8/9-column grids from the pilot's specification | crossed with the rows above |
| Headlines | 1–3 lines, large sizes, condensed families, balanced breaking | 100 |
| Justification and hyphenation | English with hyphenation points; Marathi with none (pending pilot practice) | 60 |
| Font fallback | Latin punctuation and digits inside Devanagari styles through explicit stacks; missing glyphs must raise | 40 |
| Legacy-converted text | Output of the legacy converter (`19` §2) compared with hand-verified Unicode | 50 |
| Unusual Unicode | NBSP, ZWSP, soft hyphen, combining-mark storms, unpaired matras (dotted-circle cases must raise or flag), control characters (must raise) | 50 |

Source texts carry licence notes. Pilot material stays in a private fixtures bucket, and only hashes are kept in git when the licence requires it.

### 2.4 Versioning
- Path layout: `fixtures/typeset/v1/<category>/<id>.json` and `fixtures/typeset/v1/CHANGELOG.md`.
- Every regeneration records the generator image digest.
- A diff between two versions must be explained line by line in the changelog before merge. Only humans approve fixture changes (`14`).

---

## 3. Typography validation plan: Marathi and Devanagari (TYPO)

"HarfBuzz supports Devanagari" proves shaping only. Gate 1 requires the whole composition chain. The plan has six layers.

| Layer | What it proves | Method | Kind |
|---|---|---|---|
| L1 Shaping | Glyph selection and positioning | The fixture corpus (§2.3) compared with HarfBuzz reference output. Zero dotted-circle insertions on valid text. Zero `.notdef`. Language tag `mr` enforced | Automated |
| L2 Segmentation | Clusters, words and break opportunities | Grapheme clusters per UAX#29 at the **pinned Unicode version**. Unicode 15.1 added Indic conjunct break rules (InCB): virama sequences must not split. Line-break opportunities per UAX#14: no break inside a cluster, none before a danda. Caret positions on cluster boundaries | Automated; segmentation library pinned (PyICU or ICU4X) |
| L3 Composition quality | Justification and line quality | Real corpus at the pilot's measures. Metrics: <br>• % of lines with spacing ratio inside policy <br>• maximum word-space expansion <br>• tracking applied <br>• consecutive loose lines <br>• river detector <br>• widow/orphan count <br>• headline line balance | Automated metrics + thresholds |
| L4 Reference comparison | Matches professional expectations | Take 20 real paragraphs and 10 headlines as **published** by the pilot (same text, same column width). Compare line count per paragraph and the depth of every story; target ±1 line per 20 lines. Then compare side by side visually | Semi-automated |
| L5 Native editorial review | Acceptable to Marathi sub-editors | Two native Marathi sub-editors from the pilot rate a blind sample of **200 paragraphs and 30 headlines**, mixed between Pageinator and the pilot's current output. Rubric: shaping errors, ugly breaks, loose or tight lines, punctuation, digits | Human |
| L6 Print review | Holds up on newsprint | The Gate 2 page printed on the press (or a press proof): body legibility at the pilot's body size, matra/ascender clipping, halos (overprint), ink spread | Human, at the press |

### 3.1 Composition policy to prototype (`kernel-py v0`)

Ordered fallbacks for justified body text. Every parameter is a profile setting, measured against L3 and L5:
1. Knuth–Plass within the word-space limits.
2. Add emergency stretch (TeX `\emergencystretch` analogue). B measured 8 mm → 59/62 feasible.
3. Tracking of ±10/1000 em at most, applied per line.
4. English only: hyphenation (Liang patterns). Marathi: **ask the pilot**; no hyphenation by default.
5. Greedy, reported as a *loose-line warning* in the overset/quality report. Never silent.

**Question for the pilot:** do their pages justify Marathi body text at all, or do they run some sections ragged-right? Ragged-right removes most of the problem.

### 3.2 Gate 1 acceptance criteria (measurable)

| Criterion | Threshold |
|---|---|
| L1 shaping errors on corpus and page | **0** |
| L2 cluster-split or illegal break | **0** |
| L3 lines outside the spacing policy (after fallbacks 1–4) | ≤ 2% of lines; no 3 consecutive loose lines |
| L4 story depth versus the published reference | Within ±1 line per 20 for ≥ 90% of stories |
| L5 paragraphs rated acceptable for print by both reviewers | ≥ 95%; headlines ≥ 90%; **zero** shaping complaints |
| L6 print | No defect the pilot's chief sub-editor would reject |

---

## 4. Browser renderer bake-off (EXP-RENDER)

**Hypothesis.** A Canvas2D renderer of glyph outlines, drawn in an OffscreenCanvas worker with a tile cache, meets the interaction budgets on typical newsroom hardware.

### 4.1 Candidates

| ID | Candidate | Why it is included |
|---|---|---|
| R1 | Canvas2D + OffscreenCanvas worker + Path2D glyph cache + 512 px tiles | v2 default; no dependencies |
| R2 | CanvasKit (Skia WASM, WebGL) | GPU path; draws glyph runs natively |
| R3 | Konva with glyph `Path2D` drawn in a custom `sceneFunc` | Familiar to the team (repo B); measures scene-graph overhead. Konva's *own text* is excluded, because it would reflow text |
| R4 | SVG with glyph `<symbol>`/`<use>` | Measures the DOM/SVG option honestly |
| — | Custom WebGL/WebGPU glyph atlas | **Excluded.** Cost is too high for the team; reconsidered only if R1–R4 all fail |

### 4.2 Workload
The W3 edition rendered from **ResolvedPage display lists** produced by `kernel-py`. If not ready yet, use synthetic pages built from the same fonts with real glyph counts.

Per page:
- 18–25k glyphs;
- 15–25 text frames;
- 4 photos (2–8 MP source, screen renditions);
- 2 ads (raster previews);
- 30–60 rules and boxes.

The overlay shows guides, column grid, baseline grid, and selection of 1, 10 and 50 objects with handles.

### 4.3 Scenarios
1. **S1 open:** a 16-page edition, with thumbnails and page 1 at fit-page.
2. **S2 page switch:** 20 times, both cached and uncached.
3. **S3 zoom:** continuous 25% ↔ 800%, by wheel and pinch, for 3 s.
4. **S4 pan:** 5 s at 200%.
5. **S5 drag:** move a frame for 3 s, at 1 and at 50 selected objects.
6. **S6 resize:** resize a text frame. The kernel response is mocked at 150 ms, then displayed.
7. **S7 hit test:** 1,000 random points, plus marquee selection.
8. **S8 memory:** after visiting all 16 pages at 100% and 200%.
9. **S9 fidelity:** the level-2 parity check (the draw log equals the display list) and the level-3 raster check (`12` §Parity).

### 4.4 Reference machines
These are confirmed by the hardware inventory in P0-02:
- **RM1:** Windows 10/11 desktop, Intel Core i5 (8th–10th gen) with integrated graphics, 8 GB RAM, 1920×1080, Chrome stable. Believed typical of Indian newsrooms; to be verified.
- **RM2:** MacBook Air (M1/M2), Safari and Chrome.
- **RM3:** RM1 with Firefox.

### 4.5 Winner criteria (pre-registered)

**Hard criteria (must pass on RM1 Chrome):**
- S5 p95 frame time ≤ 16.7 ms;
- S3 and S4 median ≥ 55 fps with a p95 frame ≤ 33 ms;
- S2 p95 ≤ 300 ms uncached and ≤ 100 ms cached;
- S8 tab memory ≤ 1.5 GB;
- S9 has zero geometry mismatches;
- works on RM2 Safari and RM3 Firefox, where an S3/S4 p95 ≤ 50 ms is acceptable.

**Ranking among those that pass:**
1. lowest implementation complexity (lines of code, number of dependencies, gzipped bundle size);
2. then best S1;
3. ties go to R1.

**Failure:** if no candidate passes, record the gaps and run a scoped WebGL atlas spike (5 days). Do not relax the criteria silently.

---

## 5. Performance budgets (grounded)

**Where the numbers come from:**
- Human response-time limits: about 0.1 s feels instantaneous, about 1 s keeps the user's flow of thought, and about 10 s is the limit of attention (Nielsen).
- Google's RAIL model: respond to input within 100 ms; animation frames of about 16 ms; idle work in chunks of 50 ms or less.
- Direct manipulation (dragging) must update every frame.

These budgets are **targets**. Phase 0 measurements turn them into proven or revised numbers. **Ceilings** are the levels at which a gate fails.

| Interaction | Target (p95) | Ceiling (p95) | Rationale |
|---|---|---|---|
| Drag, move, pan: frame time | 16.7 ms | 33 ms | Direct manipulation means 60 fps; 30 fps is the floor |
| Zoom (scaling during the gesture) | 16.7 ms | 33 ms | As above; re-rasterisation happens after the gesture settles |
| Re-raster after zoom settles | 300 ms | 600 ms | Progressive sharpening is acceptable |
| Text frame resize: release → reflowed text | 100 ms | 250 ms | The 0.1 s "instant" threshold; the ceiling allows a server round-trip |
| Headline recompose after edit | 100 ms | 250 ms | Same |
| Story text edit → canvas updated | 200 ms | 400 ms | The keystroke itself echoes instantly in ProseMirror |
| Page recompose (style change on a page) | 500 ms | 1 s | Keeps flow |
| Page switch | 150 ms (cached) / 300 ms | 300 / 600 ms | Between instant and flow |
| Edition open → first page visible | 2 s (warm) | 5 s (cold) | Flow and load expectations |
| Autosave: durable locally | 1 s | 2 s | IndexedDB outbox |
| Autosave: acknowledged by server | 2 s | 5 s | Not user-blocking; recovery point (RPO) |
| Generate 16 pages | 60 s | 180 s | Batch operation; first generated page must stream within 10 s (attention limit) |
| Print export of 16 pages | 60 s | 120 s | Deadline night |
| Full preflight | 30 s | 60 s | Deadline night; model-level checks run continuously, under 1 s per page change |

**Measurement:**
- performance marks and spans described in `06` §8, on the reference machines (§4.4);
- the pilot's measured network round-trip to the chosen region (P0-14).

---

## 6. PDF and press validation plan (PRESS)

Steps marked **gate step** produce the evidence for a gate.

1. **P0-01: requirements.** Run `17_PRESS_REQUIREMENTS_QUESTIONNAIRE.md` with the press. Get the specification, the press's own preflight profile and sample accepted files. **No PDF decision is frozen before this.**
2. **Writer prototype.** Built in the kernel prototype (Python):
   - our own content streams from the ResolvedPage;
   - pikepdf for objects and serialisation;
   - fontTools subsetting with `retain_gids`;
   - Pillow ImageCms (LittleCMS) for converting images to CMYK;
   - pikepdf `as_form_xobject` to place ad pages.

   Output: whatever variant the press specifies, PDF/X-1a:2001, X-1a:2003 or X-4.
3. **Our own checks** (`packages/preflight` rules ported from B's M11) and `qpdf --check`.
4. **Independent validation.** Use a callas pdfToolbox trial or an Acrobat Pro Preflight seat with the matching PDF/X profile, and **the press's own preflight profile** if they use PitStop or pdfToolbox. The best outcome is a zero-error report against the exact profile the press uses.
5. **Press RIP test (gate step).** Send the file through the press's normal intake. Collect:
   - their preflight report;
   - RIP acceptance;
   - a plate or proof if offered;
   - written confirmation naming the file hash.
6. **Fixture capture (gate step).** Store everything in the press-accepted fixture set (`12` §Press fixtures).
7. **Negative tests.** Deliberately send a known-bad variant: RGB image, missing bleed, or a TrueType font if their specification is unclear. This tests whether the press's checks catch what ours catch, and shows us the format of their rejections.

---

## 7. Revised Phase 0 task list

Classification of the original 11 tasks from `14`:

| # | Original task | Verdict | Reason |
|---|---|---|---|
| 1 | Monorepo restructure | **DEFER** | Its shape depends on EXP-ENGINE. Restructuring reduces no risk |
| 2 | `tools/py-oracle` | **KEEP + MODIFY** | Freeze first (§2.1), add a Marathi `mr` corpus, add the fixture schema |
| 3 | `packages/document` units/ids/colour in TS | **MODIFY** | Becomes the language-neutral kernel contract (§1.8) |
| 4 | TS port of `fonts.py` | **DEFER (conditional)** | Only if EXP-ENGINE selects A or D; slice A1 covers the experiment |
| 5 | TS port of shape/itemize | **DEFER (conditional)** | As above |
| 6 | ICU4X segmentation in TS | **MODIFY** | Part of A1; the E path evaluates PyICU or ICU4X for L2 |
| 7 | TS port of linebreak | **DEFER (conditional)** | As above |
| 8 | Marathi feasibility report | **KEEP + EXPAND** | Becomes TYPO (§3) |
| 9 | Renderer bake-off | **KEEP + MODIFY** | Defined workload and criteria (§4) |
| 10 | PDF minimum in TS | **MODIFY** | Write it in the kernel prototype; validate against the real press specification (§6) |
| 11 | Pilot fact-finding | **KEEP + EXPAND** | Split into P0-01, P0-02 and P0-03 |

**Revised list:**

| ID | Task | Owner | Depends on | Output | Evidence for |
|---|---|---|---|---|---|
| **P0-00** | Secure the pilot partner: a memorandum of understanding (named production team, permission to use editions as fixtures, test nights, press introduction) | Founder | — | Signed MoU | **G0** |
| P0-01 | Press requirements questionnaire with the pilot's press | Founder + prepress advisor | P0-00 | Completed `17`, sample files, press preflight profile | G0, PRESS |
| P0-02 | Newsroom observation: shadow 2 production nights; inventory of hardware, network and tools; time-and-motion baseline | Founder + engineer | P0-00 | Baseline report (feeds G5), reference machines | G5 baseline, EXP-RENDER |
| P0-03 | Acquire a real corpus: 3–5 published editions with source text, photos, ads and fonts (permission recorded) | Founder | P0-00 | Private corpus | TYPO, EXP-ENGINE |
| P0-04 | Freeze the oracle (`oracle-v0`), fixture generator, fixtures v1 | Engineer (agent-assisted) | — | `tools/oracle/v0`, `fixtures/typeset/v1` | ORACLE |
| P0-05 | Kernel contract v0 (JSON Schemas) | Engineer | — | `contracts/kernel/v0` | EXP-ENGINE |
| P0-06 | `kernel-py v0`: composition policy, frame flow, headline fit, ResolvedPage | Engine lead | P0-04, P0-05 | Kernel prototype | **G1**, EXP-ENGINE |
| P0-07 | Typography validation harness (L1–L4) and native review session (L5) | Engine lead + pilot sub-editors | P0-03, P0-06 | TYPO report | **G1** |
| P0-08 | EXP-ENGINE: E latency and throughput; A1 slice; B1/D1 if triggered | Engineers | P0-05, P0-06, P0-14 | Decision memo, ADR-017 status | Architecture |
| P0-09 | EXP-RENDER bake-off | Frontend engineer | P0-02 (machines), P0-06 (display lists) | Decision memo, ADR-004 status | Architecture |
| P0-10 | PDF writer prototype + independent validation + press RIP test | Engine lead + prepress advisor | P0-01, P0-06 | Accepted PDF + fixtures | **G2** |
| P0-11 | Font rights investigation: the pilot's font inventory, licences (EULAs) and legal questions | Founder + counsel | P0-00 | Font rights memo (`19` §1) | G1/G3 enabler |
| P0-12 | Legacy text investigation: sample files, evaluation of existing converters, build-or-buy decision | Engineer | P0-03 | Memo (`19` §2) | G3 enabler |
| P0-13 | Ad input investigation: collect 2 weeks of real ad files and run them through inspection | Engineer + pilot ad department | P0-00 | Ad intake requirements | G4 enabler |
| P0-14 | Measurements: round-trip from pilot newsroom to candidate regions, bandwidth, reference machine benchmarks | Engineer | P0-02 | Budgets v1 (§5 revised) | EXP-ENGINE, EXP-RENDER |
| P0-15 | Dependency licence review, including counsel on AGPL, fonts and ICC profiles | Founder + counsel | — | Licence register (`18`) | All |

**Phase 0 is done** when G0, G1 and G2 have evidence and the EXP-ENGINE and EXP-RENDER memos are written. "Done" does not mean every task above is closed.

---

## Phase 0 evidence log (pointer; added 2026-10-07)

Evidence lives in `docs/phase0/`. This plan is **not rewritten** by it. The items flagged by evidence so far:
- **§3.1 composition policy: CHALLENGED by evidence.** Word-spacing-only justification is infeasible for most lines at 3–6 words per line. Emergency stretch would mean visibly loose lines. Devanagari letter-spacing is an open editorial question.
  - Revise this section after EXP-COMPOSE-1 and the pilot's published-page measurements.
  - Until then the original text stands as the plan of record.
  - See `docs/phase0/JUSTIFICATION_INVESTIGATION.md` and `RISKS_AND_ARCHITECTURE_IMPACT.md` Part 16.
- **§1 EXP-ENGINE sequencing refinement.** Run the server-authoritative latency experiment before the B/C slices, because measured compute (≤ 3 ms per story operation) will not discriminate between candidates. The decision rule in §1.7 is unchanged. See `docs/phase0/ENGINE_AND_LATENCY_EXPERIMENTS.md` §8.3.
- **§4.2 workload.** Generated pages carry 3–12k glyphs (not about 20k). A 25k-glyph stress page is added to the bake-off.
- **Task status:** `docs/phase0/README.md`.
