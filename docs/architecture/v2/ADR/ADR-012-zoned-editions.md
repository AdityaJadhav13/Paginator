# ADR-012: Zoned and multi-edition data model

**Post-review status (2026-10-07):** **ACCEPTED** as a data-model hook only (baseline B15). The feature ships when the pilot needs it; it is not tied to a phase.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED. The data model is in place from Phase 1; the feature ships in Phase 2.

## Decision
- An Edition may have a `base_edition_id`. Its flatplan pages are either `shared` with the base edition or a local `variant`.
- Shared pages reference the base edition's document pages. Editing a shared page affects every zone, and the editor warns the user before applying the change.
- Ad bookings target zones.
- Releases are per edition, with per-zone delivery.
- Indian regional dailies routinely publish city editions that swap a few pages. Adding this to the model later would be expensive, so it is in the model now.
