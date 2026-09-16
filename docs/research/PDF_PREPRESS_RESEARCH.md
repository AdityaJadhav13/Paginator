# PDF, print and prepress — Phase 6

Research date: 2026-09-15. Recommendation: Pageinator owns export semantics and the resolved-scene adapter; evaluate a mature PDF writer and professional preflight engine before committing to custom low-level PDF construction. Writer selection remains RESEARCH REQUIRED.

## Output contract

Export consumes an immutable document revision and ResolvedDocument, not original generation inputs or the browser DOM. The writer must accept already selected glyphs/positions, preserve clipping/transforms/stacking, embed permitted fonts, place approved image derivatives, declare colour spaces/output intent and emit correct physical page boxes. It must not silently reflow or reshape text. The adapter contract includes explicit mapping of original font glyph IDs into subset/PDF encodings and logical Unicode recovery.

PDF/X is a family of exchange constraints, not a guarantee of suitable ink coverage, image quality, good typography or the press accepting a particular job. PDF/X-4 permits capabilities such as live transparency and colour-managed content; earlier targets can require different colour/flattening treatment. Pick an exact variant/version with the printer. Do not infer that every PDF/X-4 file must contain only CMYK, or that every press supports it. [PDF Association technical overview](https://pdfa.org/technical-side-and-requirements-of-pdfx/).

## PrintProfile requirements

Versioned profile must define page/trim/bleed/media boxes and orientation, printer-approved standard, ICC output condition/profile hash, colour conversion and rendering intent, allowed colour spaces, total ink limits, black/overprint policy, spot-name mapping, transparency policy, minimum effective image resolution by asset class, font rules, marks and page-order requirements, and authoritative preflight profile/version. A profile is not valid merely because these fields are nonempty: the press must approve it.

Bleed and printer marks are separate; do not hardcode generic commercial-print bleed values for every newspaper. Confirm whether the press receives single reader-order pages, spreads or imposed sheets. Default proposal is single pages with imposition left to the press; this is an owner/press decision, not a universal rule. ICC profiles characterize conditions, not a generic “CMYK” switch ([International Color Consortium](https://www.color.org/)).

## Candidate comparison

| Candidate | Classification | Fit / limitations / license evidence |
|---|---|---|
| qpdf | WRAP | Structural inspection/transformation and parser assistance; not a layout renderer or full PDF/X preflight. Current documentation is 12.4.1; Apache-2.0 applies to current releases. [Overview](https://qpdf.readthedocs.io/en/stable/overview.html), [license](https://qpdf.readthedocs.io/en/stable/license.html). |
| PoDoFo | RESEARCH | C++ PDF manipulation/writing candidate; upstream documents LGPL library licensing, dependency/build burden and evolving API. Need explicit-glyph/Unicode/subsetting/PDF-X tests; do not infer conformance from object-level access. [Project](https://github.com/podofo/podofo). |
| PDFlib commercial | BUY, conditional | Established PDF writer product family with professional output features; compare supported glyph APIs, scripts, exact PDF/X variants, server/OEM terms and per-worker costs. A high-level textflow API alone is unsuitable for resolved output. [Vendor](https://www.pdflib.com/products/pdflib-family/). |
| iText | BUY or RESEARCH | Mature Java/.NET PDF stack, AGPL/commercial licensing; proprietary deployment needs an approved licensing route. Test exact required PDF/X and glyph behavior; do not equate generic PDF generation with press support. [License](https://itextpdf.com/how-buy/AGPLv3-license). |
| Ghostscript | BUY/REFERENCE | Useful rendering/conversion comparator; AGPL/commercial terms require review, including hosted deployment. Rewriting can alter colour/transparency/font behavior; not automatic certification. [Vendor](https://ghostscript.com/about/), [licensing](https://ghostscript.com/licensing/). |
| Antenna House Formatter | BUY/REFERENCE | Serious commercial paged-media alternative with documented PDF output controls. If it owns composition, obtain equivalent resolved geometry; otherwise it creates a second layout authority. [PDF output documentation](https://www.antenna.co.jp/AHF/help/en/ahf-pdf.html). |
| Skia PDF backend | RESEARCH | Potential common graphics path; no reviewed evidence here establishes all required PDF/X/spot/overprint functionality. Renderer reuse alone is insufficient. [Skia user documentation](https://docs.skia.org/docs/user/). |
| Scribus | REFERENCE | Mature desktop DTP reference/comparison, GPL obligations; no proprietary fork or source incorporation proposed. [Project](https://www.scribus.net/). |

No writer is selected. Commercial engines can reduce engineering risk but require written SaaS/OEM, concurrency, deployment, update and disaster-recovery terms. Open-source writers require precise transitive/license and security evaluation. Never assume a subprocess boundary resolves license obligations.

## Colour, fonts and output safety

Embed/subset allowed font binaries; reject missing glyphs and unauthorized substitutions. Ensure ligatures/reordered scripts retain meaningful text mapping. Preserve black-only small text where profile requires it; distinguish rich black backgrounds, registration colour and spot separations. White overprint can make elements disappear and requires explicit checks. Transparency flattening for legacy targets can change appearance: make it a versioned production transformation followed by new preview/approval and final preflight.

Raster images retain appropriate ICC interpretation and effective PPI after crop/scaling. Vector ads/PDF imports preserve output semantics only through a tested writer/import path. Parse ads in isolation, detect embedded active content/attachments and incompatible colour/font data; quarantine unsupported files rather than blindly flattening them. Proofs are separate, labeled artifacts and are not press masters.

## Candidate-to-release protocol

1. Snapshot revision, fonts/assets, print profile and engine manifest.
2. Resolve and run source/document checks.
3. Generate a private candidate PDF; calculate its digest.
4. Run final-file structural and professional preflight on those exact bytes.
5. Bind report/approval to PDF digest, profile version and revision. Any fixup produces new bytes requiring revalidation.
6. Commit an archive manifest before exposing the released print file; retries recover by release ID.
7. Record press handoff/acceptance separately from technical export success.

## Required experiment

Compare at least PoDoFo plus required support tooling and one commercial writer on the same corpus: multilingual glyph positioning and extraction, embedded subsets, cropped/rotated images, vector ads, black text, transparency/spot cases, page boxes and printer-approved profiles. Use independent rendering and professional preflight, then a press test. Score integration effort, supported primitives, output correctness, license/operations costs and replacement burden. Keep geometry-to-writer interface small enough to replace an unsuccessful candidate.

Standards documentation and vendor claims inform requirements; no trial license, installation, sample PDF generation or physical press test was performed in this research program. Acquisition of the applicable normative standard and vendor evaluation terms remains required before a compliance claim.
