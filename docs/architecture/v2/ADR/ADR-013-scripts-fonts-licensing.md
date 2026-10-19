# ADR-013: Script support order, legacy encodings and font licensing

**Post-review status (2026-10-07):** **ACCEPTED** for the script order and the separate Urdu track. **PROVE:** TrueType-only (see ADR-006). **CHANGED:** font licensing and legacy conversion are now specified in ADR-019 and `19` §2.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED.

## Script support order
| Phase | Scripts |
|---|---|
| Phase 0 | Latin and Devanagari (Marathi, Hindi), plus mixed text |
| Phase 1 | Converter from legacy encodings (Shree-Lipi, Akruti, ISM) to Unicode, if pilot fact-finding confirms it is needed |
| Phase 5 | Urdu Nastaliq as its own track: right-to-left, mirrored columns, kashida justification, and a specialist reviewer. The data model carries `direction` from Phase 1 |

## Language and text rules
- The language tag (`mr` or `hi`) is required on Devanagari runs.
- Each publication chooses its digit style.
- Text is normalised to NFC at ingest.
- No Devanagari hyphenation by default.

## Fonts
- Fonts are content-addressed and pinned per edition. TrueType-outline fonts only in the MVP (see ADR-006).
- A font's binary is delivered to browsers only if its licence permits web or server use. Otherwise the editor uses a server-resolve-only mode that streams glyph outlines.
- Licence flags feed preflight check `FNT002`.
