# Parts 10–11: Renderer Bake-off Specification and Performance Budgets

**Status:**
- The **workload generator exists and has been run.**
- The candidate renderers are **not built**.
- The reference hardware is **unknown**, pending P0-02.

No renderer has been selected (ADR-004: EXPERIMENTAL).

## Part 10: Renderer bake-off (EXP-RENDER)

### 10.1 Candidates (held to three to avoid proliferation)

| ID | Candidate | Included because | Glyph source |
|---|---|---|---|
| R1 | Canvas2D in an OffscreenCanvas worker + `Path2D` glyph cache + 512 px tile cache, with an overlay canvas on the main thread | v2 default; no dependencies | Glyph outlines (works in every font-rights mode except server tiles) |
| R2 | CanvasKit (Skia WASM, WebGL) | GPU path; draws glyph runs natively | Font binary (`browser_binary` mode only) **or** outline paths |
| R3 | Konva with custom `sceneFunc` drawing the same `Path2D` glyphs | The team's existing direction (repo B) and its scene-graph/hit-testing convenience. **Konva's own text layout is excluded**, because it reflows text and breaks P1 | As R1 |

**Dropped:**
- **SVG/DOM.** It was R4 in `16` §4. About 10k path nodes per page plus a DOM per page is expected to be the slowest option and adds a fourth harness. It is reconsidered only if all three candidates fail.
- **Custom WebGL/WebGPU atlas.** Too costly; used only if all candidates fail.

### 10.2 Workload (generated)

`experiments/phase0/render_workload/generate_workload.py`:
- 16 pages of display lists;
- text shaped and broken by oracle-v0, set **ragged** (there is no justifier yet);
- plausible broadsheet geometry: 318 × 510 mm, 8 columns of 30.25 mm, Noto Serif Devanagari 9.5/11.2 pt, Noto Sans Devanagari 700 at 36 pt headlines.

| Measured | Value |
|---|---|
| Total glyphs | **105,893** over 16 pages |
| Glyphs per page | **3,105 to 11,811** (half-page-ad pages to the ad-free front page) |
| Items per page | Up to 721 (glyph runs, 2 images, 0–1 ads, 8 rules or rects) |
| JSON per page | ≈ 96–327 KB |

**Finding:** v2 assumed "≈ 20k glyphs per page" (`16` §4.2, `06` §7). The generated pages carry 3–12k at these sizes.

**Bake-off rule:** add a **stress page**: 8 pt body, no ads, about 25k glyphs. The generator's `set_paragraph` and `page()` can produce it with a smaller size and no ad. Every renderer must pass on both the typical and the stress page. **This is not yet generated.** It is a one-line parameter change done during the bake-off.

**Interaction overlay**, added by the harness rather than the workload:
- column, baseline and margin guides;
- selection of 1, 10 and 50 objects with 8 handles each;
- marquee selection;
- a drag ghost.

### 10.3 Scenarios

From `16` §4.3:
- S1 open edition;
- S2 page switch ×20, cached and uncached;
- S3 zoom 25–800%;
- S4 pan;
- S5 drag (1 and 50 selected);
- S6 resize with a mocked 150 ms kernel reply;
- S7 hit test of 1,000 points plus marquee;
- S8 memory after 16 pages at 100% and 200%;
- S9 fidelity.

**Added:** S10, scrolling between pages in continuous-scroll view.

### 10.4 Metrics
- First meaningful render: page 1 at fit-page.
- Page-switch latency.
- Frame times (FPS, p95 frame) during zoom, pan, drag and scroll.
- Input-to-paint latency for drag (Event Timing API).
- Main-thread long tasks.
- JS heap and GPU memory (Chrome `performance.measureUserAgentSpecificMemory`, tracing).
- CPU from the tracing profile.
- GPU raster time where observable (Chrome tracing).
- Hit-test time.
- Bundle size (gzipped).
- Implementation complexity: lines of code, dependencies, build steps.
- **Fidelity:** level 2 draw-log equality against the display list (must be exact), plus level 3 raster comparison against a PDFium render (`../architecture/v2/12` §6).

### 10.5 Reference machines (to confirm in P0-02)
- **RM1:** the pilot's actual typical desk PC. The hypothesis is Windows 10/11, Core i5 8th–10th generation with integrated graphics, 8 GB RAM, Chrome.
- **RM2:** MacBook Air (Safari and Chrome).
- **RM3:** RM1 with Firefox.

The development machine (M4 Pro) is used only for debugging and is **never** used for verdicts.

### 10.6 Winner criteria (pre-registered; `16` §4.5 unchanged except the stress page)

**Hard requirements (RM1 Chrome, both workloads):**

| Scenario | Requirement |
|---|---|
| S5 drag | p95 frame ≤ 16.7 ms |
| S3 zoom / S4 pan | median ≥ 55 fps and p95 ≤ 33 ms |
| S2 page switch | p95 ≤ 300 ms uncached, ≤ 100 ms cached |
| S8 memory | ≤ 1.5 GB |
| S9 fidelity | Zero geometry mismatches |
| RM2 / RM3 | Functional, with S3/S4 p95 ≤ 50 ms |

**Ranking among candidates that pass:**
1. Lowest complexity.
2. Best S1.
3. Ties go to R1.

**If none pass:** report the gaps. Then run the scoped WebGL-atlas spike (5 days). Criteria are never loosened silently.

## Part 11: Performance budgets

**Sources:**
- Human response-time thresholds: about 100 ms feels instantaneous, about 1 s keeps flow, about 10 s holds attention (Nielsen).
- The RAIL model: respond to input within 100 ms, animate at about 16 ms per frame.
- Direct manipulation must update every frame.

**Status:** these are **targets to validate**. Phase 0 measured engine compute only.

**Columns:**
- **Target:** what we design for.
- **Acceptable:** the ceiling at which a gate still passes.
- **Unacceptable:** above the ceiling.

| Area | Target (p95) | Acceptable (p95 ceiling) | Unacceptable | Perceptual basis | Phase 0 evidence |
|---|---|---|---|---|---|
| Editor initial load (warm cache) | 1 s | 2 s | > 2 s | Flow | — |
| Editor initial load (cold) | 3 s | 5 s | > 5 s | Load expectation | Cold font load alone is 0.5–3.2 s server-side → **preload and cache fonts** |
| Edition open → first page visible | 2 s | 5 s | > 5 s | Flow / attention | Page payload ≈ 200 KB gzip (JSON) |
| Page switch | 150 ms cached / 300 ms | 300 / 600 ms | above | Between instantaneous and flow | — |
| Zoom / pan frame time | 16.7 ms | 33 ms (30 fps floor) | > 33 ms | Animation | — |
| Object drag frame time | 16.7 ms | 33 ms | > 33 ms | Direct manipulation | Geometric ops need no kernel round trip |
| Frame resize → reflowed text | 100 ms | 250 ms | > 250 ms | Instantaneous threshold, plus one round trip | Engine compute ≈ 1 ms (story) |
| Headline edit → recomposed | 100 ms | 250 ms | > 250 ms | Same | 0.06 ms compute |
| Body text edit → canvas updated (keystrokes echo locally at once) | 200 ms | 400 ms | > 400 ms | Feedback lag, not input lag | 1.3 ms compute |
| Page recompose (style change) | 500 ms | 1 s | > 1 s | Flow | 24–95 ms compute (≈ 2× page text) |
| Autosave: durable locally | 1 s | 2 s | > 2 s | Recovery point | — |
| Autosave: server acknowledgement | 2 s | 5 s | > 5 s | Not blocking | — |
| 16-page generation | 60 s, first page ≤ 10 s | 180 s | > 180 s | Attention limit → progress UI | Edition re-break 0.17–0.41 s compute (generation search not built) |
| 16-page print PDF export | 60 s | 120 s | > 120 s | Deadline night | — |
| Full preflight | 30 s | 60 s | > 60 s | Deadline night | — |

**Measurement standard:**
- Every budget is reported as p50, p95 and p99 together with `env.json`: hardware, OS, runtime, network profile, warm or cold.
- **Laptop numbers are not verdicts.** Only RM1 and server measurements decide.
