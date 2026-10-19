# ADR-010: Rights class as a first-class domain invariant

**Post-review status (2026-10-07):** **ACCEPTED** (frozen principle P8). Built after G6. The embargo field is added as a first-class security control (`15` §10).

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED. Implements D07 and RJ03.

## Decision
- Every SourceItem and StoryRevision carries a `rights_class`, one of:
  - `licensed_republish`
  - `official_public`
  - `customer_owned`
  - `discovery_only`
  - `unknown`, which is treated as `discovery_only`

  It also carries a reference to the governing licence.
- **AI cannot change the rights class.** Text an AI derives from a source keeps the source's provenance and rights class.
- **Discovery-only text cannot be placed in an edition.** Two checks enforce this:
  - the domain blocks it at `PlaceStory`;
  - preflight `RGT001` blocks it as a release error.
- **Verification is evidence-based.** It is a transparent, versioned rule set that combines:
  - corroboration
  - authority
  - primary documents
  - wire confirmation
  - contradictions
  - fact-check matches

  It never returns a true/false verdict from a model.
