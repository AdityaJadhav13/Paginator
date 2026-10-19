# ADR-005: Staged deterministic generation engine; AI never places geometry

**Post-review status (2026-10-07):** **ACCEPTED** for the stage structure. **CHANGED:** "top-5" and "beam width 24" become parameters (default: up to 3 structurally distinct alternatives). AI never runs inside the search loop. Typography runs as cached depth curves, then as full composition of finalists only. The solver choice follows the kernel language (CP-SAT is native in Python). The front page stays manual or template-assisted until G6. See `15` §6.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:**
- DECIDED: the staging.
- TENTATIVE: the solvers.

## Decision
Four stages:
1. **Flatplan.** Ads are hard reservations, placed first, as in the newsroom "ad dummy".
2. **Story → page allocation, including jump decisions.**
   - Start with greedy plus local search.
   - Then a highs-js MIP.
   - A Python CP-SAT sidecar is added only if measurements show a gap.
3. **Per-page layout.**
   - Phase 2: template-slot assignment.
   - Phase 3: guillotine beam search, width 24.
   - Every candidate is copyfit with the real composition engine. Hard constraints filter candidates; soft scores rank them.
   - The top 5 are kept as alternatives.
4. **Continuations.**

Rules that apply across the stages:
- Locks are hard constraints.
- Regeneration reruns only the requested scope, with a stability penalty so unchanged areas don't drift.
- Tie-breaks are deterministic.
- AI supplies typed semantics only: importance, headline variants, trims that need approval, and strategy hints.

## Rejected
- AI-generated coordinates.
- CP-SAT for 2D geometry.
- Greedy word-count packing. A and B both used it; it does not measure real text.
