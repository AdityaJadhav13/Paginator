# ADR-014: Newsprint colour policy

**Post-review status (2026-10-07):** **ACCEPTED** for the policy: newsprint, K-only text, overprint, mono pages. **CORRECTED:** the total ink limit and ICC values come from the press questionnaire (`17` §D). The current WAN-IFRAnewspaper26v5 profile specifies 220%; the "about 240%" below reflects the older 26v4.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:**
- DECIDED: the policy.
- RESEARCH: the exact profile and TAC (total ink) limit, which depend on the press specification.

## Decision
Every policy value below is set in the print profile.

**Document colour**
- Document colours are defined in CMYK or Gray in the profile. Screen colour is derived once from those values.

**Text and black**
- Body and small text use 100% K with overprint.
- Rich black is used only for solids above a size threshold.

**Page types**
- Mono pages contain gray only.
- Spot colours are used only when declared in the print profile.

**Profile and images**
- The profile is ISOnewspaper26v4-class, or the profile the press provides, with TAC around 240%.
- RGB images are converted at export using the profile's rendering intent.
- Soft proof arrives in Phase 2.
