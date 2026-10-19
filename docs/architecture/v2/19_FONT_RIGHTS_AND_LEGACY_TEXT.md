# 19 — Font Rights Model and Legacy Marathi Text Workflow

**Status:**
- The rights model and the converter architecture are ACCEPTED.
- Legal interpretations are open; counsel must review them (`18` L2).
- Converter coverage must be proven with the pilot's own files (P0-11, P0-12).

These topics can decide whether an existing Marathi newspaper can adopt Pageinator at all. Architecture v2 treated them in two sentences. That was not enough.

## 1. Font rights model

### 1.1 The problem
A browser-based publishing system can touch a font in seven different ways. A typical desktop font licence (EULA) may allow some of them and forbid others.

| # | Use | Typical desktop EULA |
|---|---|---|
| U1 | Install and use on a named computer | Allowed (per seat) |
| U2 | **Use on a server** (shaping or rendering for many users) | Often **forbidden**, or needs a server/SaaS licence |
| U3 | **Send the font file to a browser** (web delivery) | Needs a web licence; often forbidden |
| U4 | Send *glyph outlines* or *rendered pixels* derived from the font to browsers | Unclear. **Legal question L2** |
| U5 | Embed a subset in a PDF for print | Usually allowed, governed by the OS/2 `fsType` embedding bits |
| U6 | Keep the font in an archive for re-editing years later | Unclear. L2 |
| U7 | Transfer the font to a vendor (Pageinator) at all | Some EULAs forbid sharing with third parties |

### 1.2 The model

```
FontAsset { sha256, family, style, format (ttf|otf_cff), version, fsType bits, owner: platform|org, source }
FontLicense { id, org_id?, font_family_pattern, licensor, licence_kind (ofl|apache|commercial_desktop|commercial_server|
              commercial_web|commercial_app|custom), evidence_asset_id (EULA/PO), seats/servers, valid_from, valid_to,
              attested_by, attested_at,
              permits: { server_shaping, server_rasterisation, browser_binary, browser_outlines, browser_raster_tiles,
                         pdf_embedding: none|preview_print|editable|installable, archive_retention, vendor_custody } }
FontAsset ─< FontLicenseBinding >─ FontLicense      (a font is usable only via a binding)
```

**Defaults:**
- **Platform OFL fonts** permit everything.
- **An organisation's uploaded font** with no evidence permits nothing. The font stays in quarantine and cannot be used.
- **A font with evidence** gets exactly the permissions the customer attests to, recorded with who attested and when.

### 1.3 Enforcement points

| Point | Rule |
|---|---|
| Upload | Parse `fsType`. If it says "restricted licence embedding" (bit 1), PDF embedding is blocked, so the font can never print. A licence attestation is required before use |
| Shaping | The kernel shapes only with fonts whose binding has `server_shaping`. All of Option E requires this |
| Browser preview | Choose a mode for each font:<br>(a) `browser_binary` sends the font file;<br>(b) `browser_outlines` sends subset glyph paths with the display list;<br>(c) `browser_raster_tiles` has the server rasterise tiles;<br>(d) none: the page is previewed in a substitute font, clearly marked "preview substitute", and print output is still exact.<br>**The renderer must support (b) and (c), not only (a).** This is an architecture consequence. |
| PDF export | Embed a subset only if `pdf_embedding ≥ preview_print`. Otherwise preflight error `FNT002` |
| Archive | Include the font binary only if `archive_retention` is granted. Otherwise store its hash and a reference to the customer's own copy |
| Deletion | When a licence ends, the font is no longer usable for new revisions. Archived PDFs keep their embedded subsets, as normal print practice |

### 1.4 Commercial consequences
- **Onboarding must include a font audit.** Many Indian regional papers use legacy-encoded fonts (§2), licensed per machine by vendors such as Modular Infotech (Shree-Lipi) or Akruti. The vendor may need to sell the paper a **server/SaaS licence** or a **Unicode OpenType edition** of the same design. Contact vendors in Phase 0 (P0-11).
- **Offer a bundled set of quality OFL Devanagari families** as a migration path: Noto Serif/Sans Devanagari, Mukta, Tiro Devanagari Marathi/Hindi, Martel, Hind, Baloo 2, Yantramanav, Kalam for display. Validate each in the typography plan (`16` §3) before recommending it.

## 2. Legacy Marathi text workflow

### 2.1 Reality to plan for
- Marathi DTP was built for decades on **non-Unicode ("legacy") fonts**: Shree-Lipi (for example "Shree Dev 0714/0715"), Akruti, Kruti Dev (mostly Hindi), ISM / DV-TT families (C-DAC), and Yogesh, among others.
- In these fonts, Latin code points are mapped to Devanagari glyph shapes. The stored "text" is meaningless without the font, and glyph order is *visual*, not logical. For example, the short-i matra ि is stored before its consonant.
- A pilot newspaper's reporters, wire desks and archives may still produce such text. Shree Dev fonts remain widely used in Maharashtra government offices, DTP centres and newspapers.
- **This must be confirmed per pilot** (P0-12). The design below is ready if the answer is "yes".

### 2.2 Architecture

```
Import (DOCX/RTF/TXT/HTML/PDF-text/paste/email)
 → Font & encoding detection
 → Per-encoding converter (mapping table + reordering rules)
 → Unicode normalisation (NFC) + validation
 → Confidence scoring
 → (low confidence) manual review queue with side-by-side rendering
 → StoryRevision (Unicode) + provenance { original bytes asset, detected font/encoding, converter version, confidence }
```

**1. Detection.** Three signals, in order of strength:
- (a) explicit font names in the source: `w:rFonts` in DOCX, `\fonttbl` in RTF, `font-family` in HTML, font resources in PDF;
- (b) statistical: Latin-1 or symbol-range text with no characters from the Devanagari block, and character n-gram profiles typical of each legacy encoding (the classifier is trained on converted samples);
- (c) the user's declared source ("This came from Shree-Lipi").

The output is a ranked list of candidate encodings with scores.

**2. Conversion.** One versioned converter per legacy family (`converters/<family>/<version>`). Each converter has three parts:
- a mapping table from code point to Unicode sequence (glyph-level);
- reordering rules from visual to logical order: pre-base i-matra, reph, half forms, nukta, and eyelash ra;
- post-fixes for known ambiguities.

Sources for these tables, in order of preference:
- licensed vendor converters or tables (preferred: the vendors know their encodings);
- open-source tables after a licence review (`18`);
- tables we build ourselves from glyph charts, validated by native reviewers.

**3. Validation and confidence.** Per paragraph:
- all output falls in the Devanagari block or allowed punctuation;
- there are no orphan matras or viramas (the HarfBuzz dotted-circle check);
- the ratio of dictionary hits against a Marathi word list;
- **round-trip visual check**: render the original with the legacy font and the converted text with a Unicode font, then compare glyph-shape similarity. This is OCR-free; it uses image similarity.

Confidence bands:
- **high**: accept automatically;
- **medium**: accept, flagged in the story;
- **low**: goes to the review queue.

**4. Preservation.** Original bytes and font names are kept as an asset linked from provenance. Conversion is never applied destructively.

**5. Manual review.** The side-by-side view shows the original rendered in the legacy font next to the converted Unicode text. The reviewer can edit, and the converter learns patterns from the corrections: frequent corrections become proposals for converter rules, which a human approves.

**6. Testing.** Each converter version has a golden suite. Inputs are real pilot samples, used with permission. Expected outputs are hand-verified Unicode. Acceptance per converter: ≥ 99.5% of words exact on the golden suite, and zero silent corruption (every low-confidence word is flagged).

### 2.3 Output direction (Unicode → legacy)
**Not planned.** Pageinator composes only with Unicode/OpenType fonts.

If the pilot insists on a legacy-encoded *design* for its masthead or headlines, the options are:
- the vendor's Unicode OpenType version of that design;
- a licensed equivalent;
- placing the masthead as artwork (a vector PDF or SVG asset). This is fine for a fixed masthead, but not for text.

### 2.4 Decisions to make after P0-12
- **Build, buy or license** converters, depending on the pilot's actual encodings and on vendor terms.
- **Scope:** only the 1–3 encodings the pilot actually uses.
