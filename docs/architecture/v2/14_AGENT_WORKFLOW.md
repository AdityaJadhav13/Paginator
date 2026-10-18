# 14 — Engineering Workflow with AI Coding Agents

> **Second-pass review, 2026-10-07.** Safeguards 12–16 were added. The Phase 0 list is superseded by `16` §7. Status vocabulary: ADR-021. Baseline: `20`.


**Status:** DECIDED. This replaces the spec-per-unit sizing practice in D13 and Phase 16, but keeps D13's "one feature, one branch, one fresh session" rule.

## Lessons from the three codebases

| Codebase | What happened | Rule we take from it |
|---|---|---|
| A | AI-scripted steps built 78k LOC, including 5.7k lines of wrappers around stubs, and never drew a glyph. | Agents optimise for whatever gate they are given, so the gate must be a real capability. |
| B | Strong invariants and meta-tests caught real bugs. The best code still sat unconnected. | Every task must integrate its work into something a user or the press can see. |
| C | Specs of 600–900 lines and over 1,300 tests were written for UI shells while the feasibility work went unstarted. | Effort must follow the critical path, and specs must stay short. |

## Rules

1. **Gate-driven work.** Every task names the phase gate it serves (`13`). If a task serves none, question whether to do it.

2. **Spec size.** At most 150 lines, with these sections:
   - goal (2–3 lines);
   - user-visible outcome;
   - packages touched;
   - inputs and outputs (types);
   - acceptance tests, listed by name;
   - out of scope.

   Architecture lives in these docs; specs only reference it.

3. **Package boundaries are the agent's sandbox.** A task gets a list of the packages it may edit. Dependency-cruiser fails CI if any boundary in `03` §3 is crossed.

4. **Size budgets per package.** These are soft limits that trigger review, not hard failures. Typical values:

   | Package | Budget |
   |---|---|
   | `compose` | ≤ 6k LOC |
   | `pdf` | ≤ 4k LOC |
   | `layout-gen` | ≤ 8k LOC |
   | `render` | ≤ 3k LOC |

   A PR that adds more than 800 LOC to one package needs a human design note.

5. **Tests that prove behaviour.** These count:
   - golden fixtures;
   - invariants;
   - property tests;
   - planted defects;
   - end-to-end tests of the user workflow.

   These do not:
   - test-count targets;
   - per-file loops of the same regex;
   - snapshot tests of large component trees.

6. **Tasks a human must review.** Agents may draft any of the following, but a human engineer must approve the merge:
   - changes to `packages/compose`, `packages/pdf` and `packages/preflight`;
   - any golden-fixture change;
   - migrations;
   - RLS policies;
   - authorization rules.

7. **Determinism lint is non-negotiable.** No agent may disable it. An exception needs an ADR.

8. **No stubs that claim capability.** A placeholder must say so in the UI ("Not available yet") and must not be wrapped in further layers. A stub must not get tests that make it look finished. Codebase A's band-drawn text is the example to avoid.

9. **Context packs.** Each package keeps a `README.md` of at most 60 lines covering its purpose, public API, invariants and the commands that run its tests. Agents read the package README plus the relevant section of these docs, not the whole repository (D13). Keep `CLAUDE.md` short and pointing here. Run `graphify update .` after code changes, as `CLAUDE.md` already instructs.

10. **Review cadence.**
    - At each phase gate: an architecture review against these docs, and an ADR update where reality has diverged.
    - Weekly: a 30-minute demo of the real product path, from content to PDF.

11. **Branches and merging.** Short-lived branches merge to `main` behind feature flags. No stacked branches more than two deep. The current repo has 14 unmerged commits stacked on branches; Phase 0 merges or retires them.

## Safeguards added by the second-pass review (2026-10-07)

12. **Task card.** Every significant task starts from a card. Agents refuse work that lacks one. The card contains:
    - **Objective**: the user- or press-visible result.
    - **Gate served** (`13`) and **risk addressed** (`13` risk register).
    - **Architectural boundary**: which kernel or contract version, and which module.
    - **Allowed paths**: a glob list. Changes outside it make CI fail.
    - **Acceptance criteria**: named tests or fixtures, and the measurement thresholds.
    - **Prohibited shortcuts**, specific to the task. For example:
      - no `float` geometry outside the kernel;
      - no new dependency;
      - no relaxing thresholds;
      - no stub dressed up as a capability;
      - no editing oracle-v0.
    - **Dependency decisions**: any new dependency needs a licence class (`18`) and a human OK *before* it is added.
    - **Documentation implications**: which doc or ADR changes, and the status class (ADR-021).

13. **Workflow:**

    ```
    PLAN (card + design note if > 400 LOC or touches kernel/PDF/RLS)  → human approves plan
     → IMPLEMENT (small commits; ≤ 400 net LOC per PR in kernel/PDF/preflight, ≤ 800 elsewhere)
     → TEST (fixtures/tests named in the card; evidence attached to the PR: fixture diff, benchmark numbers, screenshots)
     → REVIEW (independent reviewer agent in a fresh session + human for kernel/PDF/RLS/auth/fixtures)
     → VALIDATE AGAINST GATE (does this move a gate's evidence? record in the gate log)
     → COMMIT/MERGE (only after the above; never "phase complete" claims — only gate evidence)
    ```

14. **Anti-volume rules:**
    - A PR without attached evidence is not reviewed.
    - Generated code larger than the card's estimate × 2 is stopped and re-planned.
    - Weekly, net LOC per package is compared with the size budgets (rule 4). Growth without gate movement triggers a scope review.

15. **Verify external claims.** Versions, CVEs, licences and capabilities that an agent writes into a document or code comment must link to a source a human has checked (ADR-021).

16. **Credential hygiene.** Agents run with dev-only, least-privilege credentials (`18` §4). Production secrets never enter an agent session.

## Phase 0 task list: superseded

**The authoritative Phase 0 list is now `16_PHASE0_EVIDENCE_PLAN.md` §7.** It classifies each original task below as KEEP, MODIFY, DEFER or ADD. The original list is kept for history.

**Original seed backlog (revision 1, superseded).** Each item fits in one agent session and has a named gate.

| # | Task | Gate |
|---|---|---|
| 1 | Monorepo restructure (pnpm workspaces; `frontend` → `apps/web`; app root out of `demo/`; CI skeleton; boundary and determinism lint) | G0 hygiene |
| 2 | `tools/py-oracle` (freeze B's `typeset/`; pin the HarfBuzz alignment; fixture generator; initial English, Marathi and mixed corpus) | G0.2 |
| 3 | `packages/document`: units, IDs (port of `ids.py`), colour (port of `color.py`) and base types | G0.2 |
| 4 | `packages/compose/fonts` (port of `fonts.py` on harfbuzzjs; a custom hb-subset wrapper) | G0.2 |
| 5 | `packages/compose/shape` and `itemize` (port of `shape.py`) | G0.2 |
| 6 | `packages/compose/segment` (custom ICU4X data build: line breaks, graphemes, bidi, NFC) | G0.2 |
| 7 | `packages/compose/linebreak` (port of `linebreak.py` with multiplication-only arithmetic, plus emergency stretch) | G0.2 |
| 8 | Marathi feasibility measurement report | G0 input |
| 9 | Renderer bake-off (Canvas2D vs CanvasKit) with a report | G0.3 |
| 10 | `packages/pdf` minimum: a single page in X-1a with fonts, a CMYK image and an ad XObject. Validated on the callas or Acrobat seat, then sent to the press | **G0.1** |
| 11 | Pilot fact-finding: questionnaire and collection of the press specification (founder) | G0 input |
