# 07 — Newspaper Generation Engine

> **Second-pass review, 2026-10-07.** The stage structure is accepted.
- Top-k = 5 and beam = 24 are now parameters (default: up to 3 structurally distinct alternatives).
- AI never runs inside the search loop.
- Typography runs as cached depth curves, then full composition of finalists only.
- The solver follows the kernel language.
- The front page stays manual or template-assisted until G6.

See `15` §6. Status vocabulary: ADR-021. Baseline: `20`.


**Status:**
- The architecture is DECIDED.
- The search algorithms are TENTATIVE: they get tuned against measured quality in Phase 2 and Phase 3.

**Package:** `packages/layout-gen`, which is pure and deterministic, and runs in the batch worker.

## 1. First principles

**What generating a newspaper involves**

Generating a newspaper is **not** one big optimisation problem. In a real newsroom it is a sequence of decisions, each with a different owner:

1. The **ad department** fixes the *dummy* first. This decides which pages exist, their colour, and where ads sit. In practice it is how the news hole is decided.
2. The **chief editor** assigns sections to pages and chooses the lead stories.
3. The **desk** fits packages onto each page.
4. **Sub-editors** copyfit by trimming, adjusting headlines and jumping stories.

The engine mirrors that sequence. Each stage hands *hard facts* to the next, and each stage can be locked or overridden by a human.

**Where AI fits**
- AI understands meaning: importance, topic, headline candidates and shortened versions.
- Deterministic code decides geometry.
- AI output reaches the engine only through typed fields (priority, kicker, headline variants), never as coordinates (D02, RJ01).

## 2. Inputs

- Edition: page count, zone, flatplan, and the profile version (templates, grid, styles, sections, print profile).
- Ads: bookings and placements (fixed or rule-based).
- EditionStories. Each one carries:
  - its pinned revision;
  - section, priority, the lead flag and `must_page`;
  - its photos (with focal points);
  - optional AI-provided headline variants and trimmed versions (already approved, or flagged for approval).
- Locks: locked pages, locked packages and frames, and locked regions.
- Seed: for tie-breaks only (§8).

## 3. Hard and soft constraints

**Hard constraints** (any violation makes a candidate invalid):
- No overlap between frames, except where a template explicitly allows it (for example a masthead on a jacket ad).
- Everything stays inside the page trim and template regions.
- Ads are placed exactly as booked (size within ±0.5 mm; page and region rule satisfied). Colour ads go only on colour pages.
- Locked objects, packages and pages do not change.
- No overset on any frame in the result.
- Every selected story is placed, either fully or with legal jumps.
- Jumps:
  - at most one per story (two for the lead);
  - never backwards;
  - the continuation sits on a page of the same section or a designated jump page.
- The lead story sits above the fold on page 1 (or on the section front for section leads).
- Rail items (60–120 words, single column) stay in rails, and rails hold only rail items (grammar §1.2).
- Packages stay intact: headline, deck, byline, body and photo move together.
- Minimum geometry:
  - body frame of at least 2 columns × 40 mm, unless it is a rail;
  - headline sizes within the style's allowed range;
  - photos of at least 2 columns × 30 mm.
- Every photo has a credit (preflight `IMG003`).

**Soft constraints** (weighted, normalised per page; weights live in the profile):

| Metric | Intent |
|---|---|
| hierarchy | Larger and higher placement for higher priority; one dominant element per page |
| min_page_density | Score each page and take the **minimum** across pages, not the mean (B's spec M12 fix) |
| column_fill | Frames reach the last column; columns bottom out evenly |
| tombstoning | Penalise adjacent headlines at the same height with similar size *and* family (a family change resolves it, grammar §1.4) |
| greyness_balance | Penalise any quadrant that is a solid slab of text with no photo, headline or white space |
| photo_distribution | Spread photos across the page and the edition; 2–4 per page |
| headline_variety | Penalise three identical headline shapes in a row |
| alignment / column_discipline | Shared edges, measured on the mm grid (fixes B's saturated metric) |
| jump_cost | Penalise every jump, more for front-page jumps |
| copyfit_cost | Penalise each step taken down the copyfit ladder (§6) |
| adjacency | Related stories near each other; same-section continuity |
| stability | During regeneration, penalise moving things the user did not ask to change |

## 4. Pipeline

### Stage 1: Flatplan (ad dummy)
- Start from the profile's default flatplan for this weekday (for example: page 1 front, 2–3 city, … 8 editorial, … last page sports).
- Place all fixed-position ads first. Then place rule-based ads, using a small exact search over legal (page, region) slots. The aim is to balance news-hole area per section and to respect "no competing advertisers on the same page" rules where these are booked.
- Output: for every page, its section, colour, template family, the reserved ad rectangles, and the **news hole** as a set of free regions on the column grid.
- The flatplan can be edited by humans before stage 2, which matches newsroom practice.

### Stage 2: Story → page allocation, with jump decisions
- Estimate each story's area as a function of width, using the **real composition engine**. Body depth is computed at 2, 3, 4, 5 and 6 columns at the default style, giving `depth(cols)` curves. The cost is small because text is shaped once (`05` §5).
- Solve the allocation problem:
  - **Variables:** which page each story goes on (from section-eligible pages), whether it jumps, and the continuation page.
  - **Capacity:** the sum of chosen story areas plus packaging overhead must be at most the page's news hole × a fill target (0.88–1.0).
  - **Objective:** priority-weighted page-importance match + section correctness − jump costs − fill deviation.
- **MVP solver:** greedy in priority order, followed by local search (swap and move) on a deterministic schedule.
- **v2:** an exact MIP via **highs-js** (WASM, MIT), which keeps us single-language.
- Only if HiGHS proves inadequate on measured instances: Python CP-SAT (OR-Tools) as a worker sidecar, behind the same `Allocator` interface.
- Whether a story jumps is decided **here**, not afterwards, because jumping changes what fits.

### Stage 3: Per-page layout

Candidates come from two generators.
- **Template slots** (P2 first): the publication's page patterns, where each pattern is a set of package slots with column spans, depth ranges and roles (lead, secondary, standard, brief, photo-led). Packages are matched to slots by solving an assignment problem (Hungarian algorithm over a fit score).
- **Guillotine partition search** (P3): recursive horizontal and vertical cuts of the news hole on the column grid, with beam search (width 24, from B's spec) over partitions × package treatments.
  - Treatments: the column span, the headline size step, photo size and placement (top, left or inset), and with or without a deck.
  - The beam is seeded with the best template result, so the search never regresses.

For each candidate, every package goes through:
1. **Headline fitting:** search the allowed size steps and line counts. Use balanced breaking with the real fonts. AI headline variants are offered as alternates when they are approved.
2. **Body copyfit:** the copyfit ladder (§6) until there is zero overset.
3. **Photo crop:** fill the frame around the focal point (no upscaling past the effective-DPI limit).

Then hard constraints are checked, the soft score is computed, and the **top-k valid candidates per page** are kept. *Revised 2026-10-07: k is a parameter, default "up to 3 structurally distinct"; see `15` §6.* They are shown as "Alternatives" in the editor.

### Stage 4: Continuations and assembly
- Create the jump-line frames. Style, from grammar §1.5: `▶'<headline fragment>', P 20` and `Continued from P 1`.
- Create the continuation headers.
- Re-resolve the affected pages, then emit `ApplyGeneration` commands, which create one new DocumentRevision.

## 5. Regeneration (granular)

| Action | What reruns | What is fixed |
|---|---|---|
| Regenerate edition | Stages 1–4 for unlocked pages | Locked pages and objects |
| Regenerate page | Stage 3 (+4) for that page; stage 2 may move ≤ 1 story in or out if the page cannot fit | All other pages |
| Regenerate area (marquee) | Stage 3 restricted to the region; objects outside are hard constraints | The rest of the page |
| Regenerate story layout | Treatments for that package only, inside its current rect | Everything else |
| Regenerate headline | Headline fit plus AI variants | Rect and body |
| "Try another" | Next of the top-k candidates (instant, already computed) | — |

The **stability** term penalises gratuitous change, so regenerating page 7 does not shuffle story order on page 7 more than necessary.

## 6. Copyfit ladder

This is from B's spec M12 and mirrors what a sub-editor does. Steps are applied in order, stopping as soon as the story fits:
1. Tighten leading by ≤ 2% (invisible).
2. Tighten tracking by ±5/1000 em (invisible).
3. Adjust the column span or reduce the headline size step.
4. Jump to another page (only within stage 2 or 4 decisions).
5. Use an AI-suggested trim, which needs editor approval (`Suggestion` status `pending`). It is **never applied automatically** to final text.
6. Escalate: report "Cut 34 words or add 18 mm" to the editor as a desk task.

Each step taken adds to `copyfit_cost`. The final result records which steps were used, so preflight and editors can see them.

## 7. Performance targets

- Stage 2 allocation: < 3 s for 80 stories and 16 pages.
- Stage 3: < 2 s per page with template slots, and < 6 s per page with beam search. Pages run in parallel across worker threads (Node `worker_threads`, deterministic merge).
- **Full edition: < 60 s p95 (target 30 s).**

## 8. Determinism

- All iteration is over sorted stable IDs. Tie-breaks use `(score, stable_id)`.
- The seeded PRNG (xoshiro128) is used only for local-search move order. The seed is stored on the GenerationJob.
- `input_hash` covers stories, revisions, flatplan, locks, profile version and engine version. The same hash produces the same output, which a CI test checks (B's spec acceptance item L6: 100 runs).

## 9. Measuring quality (the product's real KPI)

**Offline**
- A corpus of real published editions from the pilot, described as stories, photos and ads, with the human layout as reference.
- Metrics: the hard-constraint pass rate, the soft-score distribution, overset/unplaced counts, and blinded designer ratings on a 1–5 scale.

**Online**
- **Edit distance after generation:** the number of commands applied to generated pages before release, per page and per class.
- Time from "generate" to "ready for print".
- Acceptance rate of the top-1 candidate versus the alternatives.
- Regenerate rate per page type.

**Gate (P3):** the generated edition needs less total human edit time than the pilot's current manual process for the same edition (measured by side-by-side trials).

## 10. Evaluation of OR-Tools / CP-SAT

| Option | Fit | Decision |
|---|---|---|
| CP-SAT for stage 2 allocation | Excellent modelling fit (assignment + capacity + jumps) | **Deferred.** First try greedy + local search, then highs-js MIP. Add a Python CP-SAT sidecar only if the measured gap exceeds 5% on the objective, or for infeasibility diagnosis |
| CP-SAT for stage 3 geometry (no-overlap 2D on a discretised grid) | Feasible, but the objective is hard to express (copyfit is non-linear and comes from the composition engine) | **Rejected** for geometry. Use candidate enumeration with the real composition engine, then score |
| AI generating coordinates | Not deterministic, cannot verify fit, cannot be audited | **Rejected** (RJ01) |
| Pure templates | Fast, on-brand, predictable, but rigid | **Start here** (P2), then extend with partition search (P3) |
