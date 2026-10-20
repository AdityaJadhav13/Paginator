## Project rules

- **Product source of truth:** `docs/product/` (specification and build plan). **Architecture:** `docs/architecture/v2/` (gates G0–G7 in doc 13; ADR-023 TS kernel with a Python oracle; ADR-024 units). **Setup:** `docs/DEVELOPMENT.md`.
- **Gates decide what may be built.** The editor comes after G1 plus the engine and renderer memos. The backend comes after G0 and the full G2. Screens are built when their gate opens. Never show a feature in the real product before it works.
- **Public repository.**
  - Pilot newspaper content, fonts, colour profiles, artwork and review answers stay in `~/PageinatorPrivate`.
  - Only aggregates and fictional examples go into the repo.
  - Run `pnpm run guard` before every push.
- **Frozen evidence.**
  - Never edit `tools/oracle/v0`.
  - `experiments/phase0` and `fixtures/typeset/v1` change only with the evidence-change approval.
  - Golden vectors change only through `tools/goldens/v1` generators, with a changelog entry and human approval.
- **Kernel packages are deterministic** (ESLint enforces it). Use `@pageinator/pyshim` for Python semantics. Disable a rule only with a description citing an ADR.
- **No AI** for layout, line breaks, fit or validity.
- **No unproven claims.** Do not claim press-ready, PDF/X-valid or a gate met without evidence.
- **Two independent checks.** Every substantial change gets a code review and an independent verification.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **PR bodies end with:** `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
