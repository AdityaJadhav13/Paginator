# ADR-006: Open-source-first print pipeline with a commercial validation seam

**Post-review status (2026-10-07):** **PROPOSED (revised).** The writer lives in the kernel language (ADR-017). Pageinator owns content streams and PDF/X semantics; libraries own serialisation, subsetting and colour (`15` §5). **Font flavour (TrueType vs CFF): PROVE** with the press (`17` F2/F3), because typical ad specifications forbid TrueType. **The total ink limit comes from the press** (WAN-IFRAnewspaper26v5 = 220%, not about 240%). The commercial validation strategy is ADR-022. Ghostscript is optional and pending counsel (`18` L1).

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:**
- DECIDED: the pipeline design.
- RESEARCH: the exact PDF/X standard and ICC profile, which depend on the pilot press's specification.

## Decision
- **PDF writer.** A custom TypeScript PDF/X-1a:2003 writer driven by the ResolvedDocument. The structure follows B's spec M10.
- **Fonts.** Type0/CIDFontType2 with Identity-H encoding. Subsetting with hb-subset, keeping glyph IDs unchanged (retain-gids). Advances are written into `/W`. Each font carries a ToUnicode map.
- **Font formats.** Only TrueType-flavoured fonts in the MVP, because hb-subset cannot produce CID-keyed CFF.
- **Images.** sharp/libvips with lcms2 converts images to CMYK at export, using the publication's newsprint ICC profile. Text that is 100% K is set to overprint.
- **Ads.** Normalised when they are uploaded. Embedded as Form XObjects.
- **pdf-lib.** The original package (unmaintained since 2021) is not adopted. The maintained `@pdfme/pdf-lib` fork may be used only to import ad PDF pages.
- **Preflight** has three layers:
  1. model rules over the ResolvedDocument (B's 35 rules plus `RGT001`);
  2. output checks: qpdf, our own PDF/X inspector, pdfium parity, and Ghostscript `inkcov` run as a separate process (needs legal review);
  3. a `PdfValidator` seam for callas or PitStop.
- Buy one callas or Acrobat seat to validate the CI test corpus. **No open-source tool validates PDF/X:** veraPDF covers only PDF/A and PDF/UA, so the RJ04 rejection stands. B's spec item J1 is corrected.
- **Phase 0 gate:** the partner press accepts a Pageinator page, in writing.
