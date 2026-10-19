# 08 — Print Pipeline: Images, Colour, Ads, PDF/X, Preflight and Press Delivery

> **Second-pass review, 2026-10-07.** Corrected:
- The total ink limit, ICC profile, PDF/X variant and font flavour come from the press questionnaire (`17`). The WAN-IFRAnewspaper26v5 default is 220%.
- The writer lives in the kernel language (`15` §5).
- Commercial preflight follows ADR-022.
- Press delivery is built only for the pilot's actual mechanism.
- PDF tooling capabilities are in `18` §2. Status vocabulary: ADR-021. Baseline: `20`.


**Status.** DECIDED, with three sub-areas marked RESEARCH:
- the press's written specification;
- whether X-1a or X-4 is the deliverable;
- the newsprint ICC profile.

The pilot fact-finding in Phase 0 resolves all three.

**Policy.** Open-source first, with a seam for commercial preflight (callas pdfToolbox / Enfocus PitStop).

## 1. Image pipeline

```
upload (presigned PUT to S3 quarantine/) → worker: size/type sniff (magic bytes, not extension) → ClamAV scan
 → decode in sandboxed libvips (sharp) with pixel limits (max 200 MP; reject decompression bombs)
 → metadata: pixel dims, ICC profile, colour space, EXIF/IPTC/XMP (caption, credit, photographer, date) → ImageMeta
 → sha256 → move original to originals/<org>/<sha256> (immutable, never modified)
 → renditions: thumb (256 px), preview (1600 px sRGB), screen ladder (for zoom buckets), all sRGB WebP/AVIF
 → (on export) print rendition: crop + scale to placed size at effective DPI ≤ 2× target, convert to CMYK via lcms2
   with the publication ICC (rendering intent: relative colorimetric + BPC by default; perceptual for RGB photos when
   profile says so), apply optional unsharp mask for newsprint, JPEG q=90 inside PDF
```

- **Effective DPI** = pixel dimensions ÷ placed size (after crop). It is computed in `resolve` and checked by preflight (`IMG001`). The editor shows a warning badge.
- **Focal point** is set by the user, with optional AI face/subject detection as a suggestion (P3). Fill-crop centres on it.
- **Originals are never modified**, and every operation is a parameterised rendition (D06). Rendition key = `hash(original, params)`.
- Supported inputs: JPEG, PNG, TIFF (including CMYK TIFF from photo desks), WebP, HEIC (via libheif in libvips), and PSD (flattened preview only).
- Sharp's rendering-intent control is limited. If the bake-off needs explicit intent or black-point compensation, the worker calls the `vips icc_transform` CLI with an explicit `--intent`.

## 2. Colour management (`packages/color` + worker)

- **Document colours are specified in CMYK** (0–100.00%) or Gray, plus named spot colours. Brand colours are defined in CMYK in the profile. Screen preview colours come from a one-time lcms2 transform of profile CMYK to sRGB, cached in the ProfileVersion.
- **Newsprint policy**, set in the print profile:
  - Profile: an ISOnewspaper26v4-class profile (or the profile the press provides).
  - Total area coverage (TAC) limit: **from the press** (`17` D2). *Revised 2026-10-07: WAN-IFRAnewspaper26v5 specifies 220%. The earlier "around 240%" was the older 26v4.*
  - Body and small text: **100% K only, with overprint** (`/OP true /op true /OPM 1`). B's spec explains why: registration halos otherwise.
  - Rich black is allowed only for solids above a size threshold.
  - Mono pages: grayscale only. Colour objects on a mono page are a `COL003` error.
  - Spot colours are allowed only if the profile declares them.
- **Image conversion** to CMYK happens at export, never at upload (the original stays RGB). TAC is checked on converted images (`COL002`) by sampling the converted raster in the worker.
- **Soft proof** (P2): the editor can preview CMYK-converted image renditions (lcms2 CMYK→sRGB) so editors see newsprint dullness before print.
- Tools:
  - lcms2 through sharp/libvips in the worker (native);
  - no colour conversion in the browser beyond the cached preview colours and soft-proof renditions.

## 3. Advertisements

- **Booking**: advertiser, campaign, run dates, zones, size (named or columns × mm), colour, placement rule, fixed flag, contract ref.
  - Named positions follow the grammar: `full`, `half`, `quarter`, `strip`, `jacket` (whole page with the masthead overlaid), `masthead_strip`, and `ear` (beside the masthead).
- **Artwork intake** (at upload, not at export):
  1. Accept PDF (preferred), TIFF, JPEG, EPS (converted through Ghostscript in the worker).
  2. Inspect: page size against the booked size (±0.5 mm), TrimBox, fonts embedded, colour spaces (RGB?), transparency, resolution of embedded images, TAC.
  3. **Normalise** where the profile allows:
     - RGB → CMYK using the profile;
     - flatten transparency (Ghostscript `-dHaveTransparency=false` to X-1a), keeping the original.
  4. Report problems in an `AdArtwork.report` with severity. The ads team fixes non-compliant artwork *before* deadline night.
- **Placement**: ads are hard reservations in the flatplan (`07` stage 1). In the ResolvedDocument they are `AdXObject` items, embedded in the PDF as **Form XObjects** from the normalised PDF page. Their colour spaces are preserved (B spec acceptance criterion J9).
- **Missing-ad warnings**: a booking without artwork by a configurable cutoff time (for example 18:00) → notification to the advertising role, then preflight `ADS003` at export.
- Preview: pdfium rasterises ad PDFs to screen renditions in the worker.

## 4. PDF/X writer (`packages/pdf`)

**Target.** PDF/X-1a:2003 by default (PDF 1.4, CMYK and spot only, no transparency), which is the conservative newspaper standard. PDF/X-4 (1.6, live transparency, ICC-based) is a later option per print profile. This is RESEARCH: confirm with the pilot press.

**Implementation.** A custom TypeScript serializer (about 1.5–2.5k LOC), driven entirely by the ResolvedDocument.
- The original `pdf-lib` is unmaintained (last release Nov 2021) and is **not adopted**.
- We may borrow the object model of the maintained fork `@pdfme/pdf-lib` for importing ad PDF pages (parse plus copy objects). TENTATIVE: decide in P0 by reading its source.
- B's spec M10 is the reference structure.

**Document level:**
- `%PDF-1.4`, no object streams, no cross-reference streams.
- `/Info` with `/GTS_PDFXVersion (PDF/X-1a:2003)`, `/Trapped /False`, `/Title`, `/CreationDate`, `/ModDate`, `/Producer (Pageinator <engine version>)`.
- `/ID` derived from `hash(resolved address, profile)`, so it is deterministic.
- `/OutputIntents` with `/S /GTS_PDFX`, `/OutputConditionIdentifier`, `/Info` and `/DestOutputProfile`.

**Pages:**
- `MediaBox` = trim + bleed + slug; `TrimBox` = trim; `BleedBox` = trim + bleed.
- No `/Group`.

**Fonts:**
- Type0 + CIDFontType2, `Identity-H`, `/CIDToGIDMap /Identity`.
- Subset with hb-subset using **retain-gids**, so glyph IDs in the content stream match the resolved IDs.
- `/W` widths come from the same HarfBuzz advances.
- A `/ToUnicode` CMap is built from resolved clusters. For Devanagari conjuncts, a glyph maps to its cluster's text where the mapping is one glyph to many characters. Search fidelity in PDFs is best-effort.
- **Archive search uses the editable text, never text extracted from the PDF.**

**Text:**
- One `BT … ET` per line or run.
- Absolute `Tm` per run, and a `TJ` array with per-glyph adjustments computed from resolved positions. The writer never re-derives positions.
- Y-flip happens in one function.

**Graphics:**
- Paths with `k/K` or `g/G`.
- Overprint via an ExtGState for 100% K text and rules.

**Images:**
- DCTDecode (JPEG) CMYK print renditions.
- Clipping from the resolved crop path.

**Ads:**
- Form XObjects with a `/BBox` equal to the ad trim.

**Marks (optional per profile):**
- crop marks (0.25 pt, 3 mm beyond bleed);
- registration targets;
- a colour bar;
- a slug line with publication, edition, date, page, revision and resolved hash (traceability).

**Imposition:** deferred. Most newspaper presses impose in their own workflow; confirm in P0.

**Outputs:** `print_pdf` (whole edition and per page), `proof_pdf` (RGB, compressed, watermark "PROOF r<rev>"), and page PNGs for e-paper (`10` §5).

**Determinism:** same ResolvedDocument + profile → byte-identical PDF. No timestamps except `CreationDate`, which is taken from the release time. A test asserts this.

## 5. Preflight (`packages/preflight` + worker tools)

**Rule engine.** Rules are TypeScript modules: `Rule {id, severity, category, check(resolved, ctx) → Finding[]}`.
- **Errors block export.** There is no override (D05, RJ07).
- **Warnings** can be overridden with a reason, which is written to the audit log.

**Rule set.** The 35 rules from B's spec M11, kept as-is:
- `TXT001–009`: overset, unplaced text, text below 6 pt, widows and orphans, hyphen ladders, rivers, missing glyphs, placeholder strings such as "lorem/TK/XXX", ink collision.
- `FNT001–002`: font not embedded, font licence does not permit embedding.
- `COL001–005`: RGB in a CMYK document, TAC, colour on a mono page, unintended spot colour, 100% K without overprint.
- `IMG001–004`: DPI, missing link, **missing credit** (legal), face cropped (AI warning, P3).
- `GEO001–004`: outside bleed, unintended overlap, empty frame, page count ≠ booked count.
- `ADS001–003`: an ad not placed, the wrong size, or missing material.
- `JMP001–003`: broken jump line, multiple jumps, jump backwards.
- `EDT001–005`: no approver, **masthead date ≠ edition date**, unresolved AI suggestion, duplicate headline, duplicate photo.
- **Added:** `RGT001`, an error for text whose rights class is `discovery_only` placed in an edition (D07).

**Three layers:**
1. **Model checks** run on the ResolvedDocument, before the PDF exists. These are fast (< 5 s for 32 pages) and cover most rules. They also run continuously in the editor as live issue badges.
2. **Output checks** run on the produced PDF:
   - `qpdf --check` for structure;
   - our own PDF inspector for X-1a conformance: version, OutputIntent, boxes, no RGB/ICCBased, no transparency, fonts embedded, `/Trapped` set;
   - **pdfium** rasterisation, compared with the canvas render using an SSIM threshold (parity);
   - **Ghostscript `inkcov`** for per-page TAC estimation. Ghostscript is run as an unmodified separate process. Its AGPL licence needs legal sign-off before production; the alternative is our own TAC check on separations rendered with pdfium.
3. **External validation (seam)**: a `PdfValidator` interface. Implementations:
   - `internal` (default);
   - `callas` (pdfToolbox CLI/SDK, when a customer contract funds it);
   - `pitstop`.

   **Before the paid integration:** buy one callas pdfToolbox Desktop or Acrobat Pro seat **for the engineering team only**, used to validate the CI golden corpus against PDF/X-1a. Nothing open-source validates PDF/X (veraPDF covers only PDF/A and PDF/UA; RJ04 stands).

**The summary screen matches the vision (§33):** 16/16 pages · Fonts PASS · Images PASS · Ads PASS · Layout PASS · Colour PASS · Print profile PASS · Blocking issues 0 → **READY FOR PRINT**.

## 6. Press delivery

- The publication configures delivery targets (P2):
  - SFTP or FTPS hot folder (most common);
  - an email link (for small presses);
  - manual download.
- Delivery job:
  1. upload the per-page PDFs with the press's naming convention template (for example `LOKMAH_PUNE_20261015_P01.pdf`);
  2. verify the remote size, and the checksum where supported;
  3. record a **receipt** (time, file list, hashes) on the Release;
  4. retry with backoff;
  5. alert the prepress role on failure.
- Late-page corrections create a new revision. The release state machine then re-delivers only the changed pages, as `_v2` files, with an audit trail.

## 7. Phase-0 press acceptance gate (the most important early milestone)

1. Get the pilot press's written specification: standard, profile, TAC, bleed, naming, delivery method, and how they handle imposition.
2. Produce one real broadsheet page with Marathi body, an English headline, two photos and a supplied ad PDF, through `compose → resolve → pdf`.
3. Validate it with the callas or Acrobat seat, then send it to the press's RIP and get **written acceptance** from the prepress operator, plus a physical proof if they will run one.
4. Store the file and the acceptance in `tools/fixtures/press-accepted/`. It becomes the first golden regression file.
