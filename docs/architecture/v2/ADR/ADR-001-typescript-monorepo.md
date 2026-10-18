# ADR-001: Single-language TypeScript monorepo

**Post-review status (2026-10-07):** **SUPERSEDED in part by ADR-017.** Frontend in TypeScript/React: ACCEPTED. Kernel language: EXPERIMENTAL (EXP-ENGINE). Backend/API language: EXPERIMENTAL; it follows the kernel decision (baseline O3). Monorepo: ACCEPTED in principle, but its layout depends on O1/O3, and restructuring is DEFERRED until after EXP-ENGINE.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED, 2026-10-07. Resolves OP13. Refines OP11 and OP12.

## Context
- The product requirement is that what the editor shows matches the press PDF exactly (D03). That means the same composition code must run in the browser and on the server.
- The existing frontend is TypeScript.
- The best existing engine code is about 2,000 lines of Python (B `typeset/`). It depends on HarfBuzz, which also exists as maintained WASM (harfbuzzjs).
- The team is small and makes heavy use of AI coding agents.

## Options considered
1. **Python backend, TS frontend.** Composition would run only on the server, or as Pyodide in the browser (too heavy). Browser/server parity would rely on round trips, and we would maintain two languages.
2. **Rust or C++ core compiled to WASM and native.** Best raw performance. It means a third language, slower agent velocity, and rewriting B anyway. krilla, Typst's PDF library, has no PDF/X support and cannot embed pages from other PDFs.
3. **TypeScript everywhere, with HarfBuzz and ICU4X as WASM.** Chosen.

## Decision
- **Option 3.** A pnpm monorepo containing `apps/{web,api,worker}`, `modules/*` and `packages/*`, as laid out in `03` §3.
- The Python `typeset/` code is kept only as a test oracle for golden fixtures. It is retired once the TypeScript port reaches parity.
- Rust/WASM stays open as a later replacement for hot kernels, behind the same package API. It is adopted only if profiling demands it.

## Consequences
- One toolchain, shared types and API contracts, and easier agent work.
- Composition speed depends on WASM-to-JS call overhead. This is mitigated by the "shape once, break many" design.
- Engineers must follow the determinism rules (ADR-002).
