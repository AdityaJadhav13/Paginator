# Parts 8–9: Engine Bake-off Specification and Server-Authoritative Latency Experiment

**Status:** specification ACCEPTED for execution, with one deviation from the original plan noted below. Engine compute is **measured**; network and rendering are **not**. **No engine language has been selected** (ADR-017 remains EXPERIMENTAL).

## Part 8: Engine bake-off (EXP-ENGINE) — refined specification

This refines `../architecture/v2/16` §1 using the Phase 0 evidence. It is not a competing plan.

### 8.1 Candidates (this prompt's labels → `16` labels)

| Here | `16` | Definition | Status |
|---|---|---|---|
| **A** | E | Existing Python engine (oracle-v0 behaviour), extended with the composition policy from the next experiment, running server-side only | Baseline. It already exists |
| **B** | A | TypeScript orchestration plus WASM HarfBuzz (harfbuzzjs) and ICU4X; the same code in a browser worker and in Node | Slice only |
| **C** | B | Rust core (HarfRust or HarfBuzz bindings, plus ICU4X), compiled to WASM and native | Slice only; **conditional** |
| — | D (hybrid) | TypeScript plus a Rust/WASM kernel | Kept only as B's fallback if B fails *only* on throughput |
| — | C++ | — | **Excluded.** There is no strong reason. The existence of the archived C++ repository is not one |

### 8.2 Vertical slice (the minimum needed to answer the question)

```
Unicode paragraph (fixtures/typeset/v1 corpus) + font + size + measure + composition policy
 → itemize → shape → break opportunities (UAX#14 at pinned Unicode version) → line breaking (soft-cap KP)
 → justification (word space [+ Latin letter-space if policy allows]) → ResolvedParagraph
ResolvedParagraph = { glyph ids, clusters, integer µpt positions per glyph, line boxes, per-line space factor, warnings }
```

**Out of scope for every candidate:** frame flow across columns, PDF, the editor, images and generation.

### 8.3 Ordering change from `16` (evidence-driven)

Phase 0 measurements show warm Python compute of **0.3–0.5 ms per paragraph** and **≤ 3 ms per single-story edit**. That is two to three orders of magnitude inside the interaction budgets. So performance is **unlikely** to discriminate between candidates. The question that actually decides whether B or C are needed is:

> **Does a server-authoritative resolver meet interactive budgets over the pilot's real network?** (Part 9)

**Revised sequence:**
1. Build the composition policy for candidate A (next experiment), because every candidate needs a policy to implement.
2. Run Part 9.
3. If Part 9 **passes**, B and C are built **only** if another requirement forces client-side composition: offline editing, or a font-licence mode that needs browser shaping. Without such a requirement, record "not needed" and skip slices B and C. That saves about 16 engineer-days.
4. If Part 9 **fails**, build slices B and then C in the pre-registered order of `16` §1.5–1.7.

**Impact on ADR-017:** none yet. This is a sequencing refinement within the experiment, recorded here, and does not change the decision rule.

### 8.4 Metrics (all candidates, same corpus and fixtures)

| Area | Metric |
|---|---|
| Correctness | M1 shaping identical to the HarfBuzz reference (glyph IDs, clusters); M2 line breaks identical to candidate A's ResolvedParagraph fixtures (documented deltas only); M2b the composition metrics of `JUSTIFICATION_INVESTIGATION.md` within ±1% |
| Determinism | M3 identical ResolvedParagraph hash across: (A) x86_64 + arm64 Linux images; (B) Node, Chrome, Firefox, Safari; (C) native + WASM in two browsers |
| Performance | Per paragraph p50/p95; per frame (one story); per page (≈ 180 paragraphs); per edition (1,200 paragraphs); cold start including font load (Phase 0 found cold font loading of **0.5–3.2 s** in A) |
| Integration | Server worker fit; browser bundle size gzipped (B/C); PDF path availability (A: pikepdf/fontTools proven for subsetting; B/C: to be shown); font-licence modes supported |
| Engineering | M9: wall-clock time for change task X1 (add ragged-right plus fixtures) by a fresh agent session plus a human reviewer; number of defects found in review; debugging time for a planted defect (a wrong cluster mapping) |
| Build and deploy | Number of toolchains; CI minutes; artefact count; reproducible-build check |
| Risk | Library maturity (releases, maintainers); licence class (`18`); browser support |

### 8.5 Disqualifiers (any one eliminates a candidate)
- D1: any shaping mismatch against the reference on the corpus that is not explained by documented flags.
- D2: non-deterministic output on any of the candidate's own target runtimes.
- D3: a licence classed DO NOT USE without a cleared alternative.
- D4: cannot meet the frame-level ceiling (250 ms end to end) in its intended deployment mode.
- D5: requires sending font binaries to browsers for fonts whose rights do not permit it, with no fallback mode.

### 8.6 Scoring of non-disqualified candidates (weights fixed before running)

| Factor | Weight | Why this weight |
|---|---|---|
| Development velocity and debuggability (M9, defects, debug time) | 30% | Small, agent-assisted team |
| Maintainability and ecosystem (PDF, fonts, Unicode libraries) | 20% | |
| Integration fit (server, browser need, PDF, font modes) | 20% | |
| Build and operational complexity | 15% | |
| Performance headroom over budgets | 10% | Low weight because the measured headroom is large |
| Risk (maturity, licensing, support) | 5% | |

**Tie-break:** fewer languages on the production path.

## Part 9: Server-authoritative latency experiment

### 9.1 Question and hypothesis
- **Question:** can browser edits that change text flow be answered by a server-side kernel within the interaction budgets?
- **Hypothesis H9:** on the pilot's network to an India region, p95 end-to-end time for story-level operations is ≤ 250 ms and for page-level operations ≤ 1 s, with engine compute a small fraction of either.

### 9.2 Latency decomposition (each part measured separately)
`T = T_client(apply + request build) + T_net(RTT + transfer) + T_queue + T_compute + T_serialize + T_client(decode + reconcile + render)`

**Measured (Phase 0, Apple M4 Pro, warm, engine compute only, a lower bound):**

| Scenario | p50 | p95 | Payload (gzip) |
|---|---|---|---|
| Headline edit (36 pt, 132 mm) | 0.06 ms | 0.06 ms | small |
| Body text edit (1 paragraph reshaped, 5 re-broken) | 1.27 ms | 1.31 ms | story ≈ 9.6 KB |
| Frame resize (6-paragraph story re-broken) | 1.01 ms | 1.03 ms | ≈ 9.6 KB |
| Column resize (3 stories) | 3.05 ms | 3.11 ms | ≈ 29 KB |
| Image move with text wrap (per-line measures) | 0.98 ms | 1.00 ms | ≈ 9.6 KB |
| Story continuation change (2 stories) | 1.98 ms | 2.01 ms | ≈ 19 KB |
| Page recompose, shaping cached (≈180 paragraphs) | 24.3 ms | 24.7 ms | page ≈ 201 KB |
| Page recompose, uncached | 60.8 ms | 80.8 ms | ≈ 201 KB |

**Caveats:**
- Frame flow, justified positions and display-list construction are not included, because oracle-v0 lacks them. The real kernel will be slower; how much slower is unknown.
- Server CPUs may be about 1.5–3× slower than this laptop. This is an assumption to measure.
- The page scenario has about 2× the text of a real broadsheet page (`RENDERER_BAKEOFF_AND_BUDGETS.md` §10.2). It is conservative.
- **Cold font load (0.5–3.2 s) must never sit on the interactive path.** Kernels must preload the publication's font instances.

### 9.3 Procedure

| Step | Work | Status |
|---|---|---|
| S1 | Wrap the kernel prototype (with the composition policy from the next experiment) in a minimal stateless HTTP endpoint: request = page subset plus operation; response = changed ResolvedParagraphs and lines | **READY after the next experiment.** Not built now: it would wrap a policy that does not exist yet |
| S2 | Thin browser client: apply the operation optimistically (geometric ops locally); send; receive; reconcile; render with the bake-off renderer (R1). Instrument every part of T with Performance API marks | Shares the renderer bake-off harness |
| S3 | Run locally with network emulation: (a) 20 ms RTT / 50 Mbps; (b) 60 ms / 10 Mbps / 1% loss; (c) 150 ms / 2 Mbps / 3% loss; (d) offline for 30 s, then reconnect | READY once S1 and S2 exist |
| S4 | Deploy the endpoint in the candidate region on two instance types (x86, ARM). Measure server CPU relative to the laptop | Needs a cloud account. **Partially external** |
| S5 | Run the scripted operations (W4 in `16` §1.4) from the **pilot newsroom's real network and PCs** | **BLOCKED** (P0-02, P0-14) |

### 9.4 Metrics, thresholds and outcome

| Operation class | Target p95 | Ceiling p95 (fail above) |
|---|---|---|
| Story-level operations (headline edit, body edit, frame resize, image wrap, continuation) | 150 ms | 250 ms |
| Multi-story operations (column resize, 3 stories) | 250 ms | 400 ms |
| Page-level recompose (style change on a page) | 500 ms | 1 s |
| Offline or interrupted | Geometric edits continue; text edits queue; no data loss | Any data loss = fail |

**Outcomes:**
- **PASS on S5:** supports ADR-017 as written (single server kernel). Client composition is "not needed".
- **FAIL:** record which component dominates.
  - If the network dominates, client-side composition becomes necessary, and B/C slices run.
  - If compute dominates, optimise or change the kernel language.

**Predicted from the measured components (not evidence).** Compute is ≤ 10 ms even at 3× slower, so the network decides. At 60 ms RTT and 10 Mbps, a story operation is about 60 + 8 + render time. That should pass if rendering is under 100 ms. Page-level operations add about 160 ms of transfer for a 200 KB payload at 10 Mbps. Binary or delta encoding is the lever if needed.

### 9.5 What this experiment must not do
- It must not choose a language.
- It must not build a production API or editor.
- It must not run against customer data.
