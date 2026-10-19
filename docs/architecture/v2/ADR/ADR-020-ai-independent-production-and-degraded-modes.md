# ADR-020: AI-independent production path and deadline degraded modes

**Status:** ACCEPTED. 2026-10-07. Extends ADR-016.

## Decision

**No AI on the critical path.** The path edit → resolve → preflight → export → deliver never calls an AI service. Every AI feature degrades to "unavailable" without blocking work.

**During the deadline window:**
- Kernel and export capacity are reserved.
- Each preflight-passing revision becomes **last-known-good (LKG)**. Its per-page print PDFs are pre-rendered and kept downloadable.

**If the kernel service is unavailable, these still work:**
- viewing and navigation;
- geometric edits;
- queued text edits (a local IndexedDB outbox);
- downloading LKG PDFs.

**Emergency package (by G4).** One download per edition containing:
- the LKG PDFs;
- the current editable and resolved documents;
- the font manifest;
- a standalone kernel CLI or container that can re-export offline.

**Targets:** local edit durability ≤ 2 s; server recovery point ≤ 10 s; deadline export start within 30 s (p95).

Details: `15` §12.
