# ADR-017: Single authoritative publishing kernel behind a language-neutral contract

**Status:**
- **ACCEPTED** (principle and boundary).
- **EXPERIMENTAL** (implementation language, decided by EXP-ENGINE).

Date: 2026-10-07 (second-pass review).
Supersedes ADR-002 and the kernel-language part of ADR-001.

## Context
- ADR-002 required the browser and the server to compose text with the same TypeScript/WASM code, so that preview would match the PDF. That forces three things before any evidence exists:
  - a full port of the only working engine (Python, 182/182 tests passing);
  - cross-JS-engine determinism discipline;
  - shipping font binaries to browsers, which conflicts with font EULAs (ADR-019).
- The underlying principle is that preview and PDF derive from one resolved layout (P1). It is satisfied more simply if **only one resolver exists**.

## Decision
1. **The kernel.** One kernel resolves layouts, writes PDFs and runs model-level preflight. It is versioned. Its contract is JSON Schema (`contracts/kernel/v0`):
   - `ResolveRequest` → `ResolvedPage`;
   - `ExportRequest` → `ExportResult`.
2. **The browser renders `ResolvedPage` display lists only.**
   - Geometric operations (move, nudge, z-order) are applied optimistically on the client as transforms.
   - Operations that change text flow go to the kernel.
3. **Client-side composition is an optimisation.** It is adopted only if EXP-ENGINE (or later production telemetry) shows server round-trips miss the interaction budgets (`16` §5). If adopted, the server stays authoritative and parity is hash-checked.
4. **Kernel language is EXPERIMENTAL.** It is decided by the pre-registered EXP-ENGINE rule (`16` §1.7).
   - Front-runner: Option E (Python, extended from the frozen oracle).
   - Alternatives: A (TS + WASM), B (Rust → WASM and native), D (hybrid).
   - C (C++) is desk-rejected.
5. **Determinism rules** (from ADR-002) apply to whichever kernel is chosen:
   - pinned shaping and segmentation versions;
   - integer or exactly reproducible arithmetic in layout decisions;
   - stable tie-breaks;
   - no locale- or platform-dependent APIs.

## Consequences
- **Parity:** preview/PDF parity holds by construction.
- **Fonts:** restricted fonts can stay on the server.
- **Porting:** no port is needed before Gate 1.
- **Reliability:** editing that changes text flow depends on kernel availability. Mitigated by ADR-020: N+2 instances, local outbox, last-known-good PDFs, emergency kernel CLI.
- **Backend language** becomes a follow-on decision (baseline O3).
