# ADR-021: Decision status discipline

**Status:** ACCEPTED. 2026-10-07.

## Decision

**ADR statuses**

| Status | Meaning |
|---|---|
| **PROPOSED** | Written, not yet adopted |
| **ACCEPTED** | Adopted, with evidence or reasoning that suffices for its certainty class |
| **EXPERIMENTAL** | Adopted provisionally; names the experiment that will settle it |
| **SUPERSEDED** | Replaced; names its successor |
| **REJECTED** | Considered and refused, with the reason |

**Certainty classes.** Every decision also carries one: PRINCIPLE, ARCHITECTURE DECISION, WORKING HYPOTHESIS or IMPLEMENTATION DETAIL (`15` §4).

**Rules**
- Factual claims about external tools (versions, licences, CVEs, capabilities) must cite a source checked by a human, or be marked "unverified".
- History is preserved. Status changes add a dated status block at the top of the ADR; the original text below it stays unchanged.
- "DECIDED" is retired as a status word.
