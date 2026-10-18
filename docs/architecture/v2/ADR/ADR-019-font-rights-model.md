# ADR-019: Font rights model and licence-aware preview modes

**Status:**
- **ACCEPTED** (model and enforcement points).
- **PROPOSED** (legal interpretations, pending counsel L2).

Date: 2026-10-07.

## Decision
- **Fonts.** A font is usable only through a `FontLicenseBinding`. The binding records the uses its licence permits, attested with evidence:
  - server shaping;
  - server rasterisation;
  - browser binary;
  - browser outlines;
  - browser raster tiles;
  - PDF embedding level;
  - archive retention;
  - vendor custody.
- **Renderer modes.** The renderer must support four preview modes per font:
  - binary;
  - outlines;
  - server tiles;
  - a marked substitute.

  It must not assume the font binary is delivered.
- **Licence status.**
  - Customer-uploaded fonts with no evidence are quarantined.
  - Platform OFL fonts are fully permitted.
  - The `fsType` restricted bit blocks PDF embedding, so such a font cannot be printed (`FNT002`).

Details: `19` §1.
