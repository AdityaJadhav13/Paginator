# ADR-003: EditableDocument → ResolvedDocument display list

**Post-review status (2026-10-07):** **ACCEPTED** (frozen principle P1, baseline B2). The serialisation format (MessagePack + zstd) and the exact unit (integer µpt) are implementation details or hypotheses, defined by the kernel contract (`16` §1.8).

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED. Implements D03.

## Decision
- **EditableDocument** holds intent: pages, packages, frames, threads, story references, style overrides and locks.
  - It changes only through typed Commands, which can be inverted (for undo) and are idempotent by `opId`.
  - It is stored as revision snapshots plus a bounded command log.
- **ResolvedDocument** is an immutable, content-addressed display list. It contains:
  - glyph runs: font hash, glyph IDs, integer positions and cluster mapping back to the source text;
  - images with transform and clip;
  - paths;
  - ad PDFs placed as XObjects.
- Its address is a hash of:
  - the editable revision;
  - the font hashes;
  - the engine, HarfBuzz and ICU versions;
  - the profile version.
- The preview renderer, PDF writer, e-paper and preflight consume **only** the ResolvedDocument. Measuring outside `resolve` is forbidden.
- "Exact match" means identical geometry, verified by hash. Pixel antialiasing is out of scope.
- The **package** (headline, deck, byline, body, photo, sidebar) is the unit of layout. This comes from `NEWSPAPER_DESIGN_GRAMMAR.md` §1.3.
