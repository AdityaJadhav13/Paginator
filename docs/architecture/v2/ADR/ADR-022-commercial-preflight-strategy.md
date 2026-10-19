# ADR-022: Commercial preflight strategy

**Status:**
- **ACCEPTED** for the strategy.
- **EXPERIMENTAL** for production licensing, which is reviewed before G4.

Date: 2026-10-07. Refines ADR-006.

## Options considered
| Option | Assessment |
|---|---|
| **A. Internal checks + a commercial checker in development only** | Cheapest (an Acrobat Pro seat, or a pdfToolbox desktop or trial licence). Production files are not independently validated. |
| **B. Commercial preflight integrated into production** (callas pdfToolbox Server/CLI/SDK, or Enfocus PitStop Server) | Strongest assurance. Cost is roughly €5k-class per server, plus maintenance. Multi-tenant SaaS terms must be negotiated. |
| **C. Commercial preflight only on premium plans** | **Rejected as the default.** Print correctness must not be a premium feature. Advanced auto-fix may be premium later. |
| **D. Rely on the printer's validation** | **Rejected as the sole line of defence.** Rejections arrive late, at deadline. Kept as the final external check. |
| **E. Hybrid** | Internal model-level rules (fast, live in the editor), plus validation against **the press's own preflight profile** before delivery, plus the press's intake. |

## Decision
1. **E as the target.**
   - **Phase 0 to G3:** option A. Validate every gate artefact with a commercial tool using the press's profile, if they share it.
   - **Before G4:**
     - decide on a production server licence (B) for the pilot press's profile;
     - require it if the press runs callas or PitStop and shares a profile;
     - otherwise decide on cost and risk.
2. **No open-source tool is claimed to validate PDF/X.** See `18` §2.
