# ADR-011: Amendments to DECISION_REGISTER.md

**Post-review status (2026-10-07):** **ACCEPTED with revisions.** OP13 and OP14 are **re-opened** as EXPERIMENTAL (ADR-017; baseline O1–O3). The **DF05 revision is withdrawn**: e-paper stays deferred until after G4 (`15` §13). The D10 supersession stands, limited to the Phase 0 evidence work in `16`.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED. The existing register stays valid except where this ADR amends it.

| Register item | Amendment |
|---|---|
| D10 (UI simulation only) | **Superseded for the next phase.** Phase 0 starts real engine work (compose, pdf) together with the monorepo restructure. The UI simulation work (UI001–UI005) is kept. |
| D12 (fresh codebase; prior work not audited) | **Superseded.** Prior work has now been audited (`01`, `02`). B's `typeset/` is ported through the oracle. A is archived; only its ideas carry forward. |
| D13 (one feature, one spec, one branch, one session) | **Kept**, with these changes: specs are at most 150 lines, and package boundaries plus golden gates apply (`14`). |
| OP11, OP12 | **Concretised** by ADR-007 and ADR-008. |
| OP13 | **Resolved:** TypeScript (ADR-001). |
| OP14 | **Resolved:** the server is authoritative and the browser recomposes interactively with the same engine (ADR-002). |
| RD01 | Narrowed to: the Phase 0 bake-off plus the press acceptance gate (ADR-004, ADR-006). |
| RD05 | Tentatively resolved: integer micro-points (ADR-002). |
| DF05 (e-paper deferred) | **Revised:** e-paper page images and article regions move into Phase 2, because the resolved document makes them cheap. An external publishing API, press control and an ad-sales CRM stay deferred. |
| RJ04 | Confirmed. Note: no open-source PDF/X validator exists, so one commercial seat is used for corpus validation (ADR-006). |
| New | ADR-012 to ADR-016 record decisions that were missing from the register. |
