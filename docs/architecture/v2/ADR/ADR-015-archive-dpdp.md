# ADR-015: Immutable edition packages and the DPDP Act

**Post-review status (2026-10-07):** **PROPOSED, staged.** G2–G4: versioned storage plus a hash manifest of delivered files. G5: full package and restore drill. G7: retention tiers and search. **The DPDP treatment of bylines and archives is a LEGAL UNKNOWN.** The Act and Rules contain no journalism exemption (`15` §9; counsel L5).

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:**
- DECIDED: the design.
- TENTATIVE: counsel's review of how bylines are treated.

## Decision
**The edition package**
- A released edition becomes a signed edition package containing:
  - print and proof PDFs
  - e-paper output
  - the editable document and the resolved document
  - stories
  - an assets manifest
  - ads
  - the profile, ICC profiles and fonts (where licence permits)
  - the preflight report
  - approvals
  - delivery receipts

**Storage and protection**
- The package is stored under S3 Object Lock in governance mode, with replication.
- It holds no personal data beyond pseudonymous actor IDs. Account personal data stays in Postgres, where it can be erased.

**Retention**
- Retention tiers are plan entitlements.
- Legal hold maps to S3 Legal Hold.

**Changes after release**
- Corrections create a new linked release. The original is never modified.
