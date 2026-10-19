# Part 12: PDF and Press Evidence Plan

Includes the PrintProfile fields, newsprint questions, PDF tool evidence, parity and press-fixture specs, and the Phase 0 licence classification.

**Status:**
- G2 is **BLOCKED** on G0, because the real press requirements are unknown.
- **No Pageinator PDF has been written.** Nothing here claims press readiness or PDF/X validity.

## 12.1 What can be tested now and what must wait

| Item | Now (no press) | Waits for G0/G2 |
|---|---|---|
| Font subsetting that keeps HarfBuzz glyph IDs (needed for an Identity CIDToGIDMap) | **DONE.** fontTools `retain_gids` keeps every used glyph ID (outline-compared) for Noto Serif Devanagari (65 glyphs → 15.9 KB) and Source Serif 4 (32 glyphs → 10.3 KB). Glyph *names* were re-synthesised (29 changes; `post` format 3), so **identity checks must compare outlines, not names** (`experiments/phase0/results/pdf_probe/`) | Whether the press accepts TrueType/CIDFontType2 (`17` F2/F3) |
| Writer capability probe: PDF/X-1a structure (OutputIntent, boxes, `GTS_PDFXVersion`, `Trapped`, CMYK-only content, Identity-H fonts, overprint ExtGState) built with pikepdf/qpdf | READY to run in an isolated experiments venv. Needs pikepdf (MPL-2.0); **not installed in Phase 0** to avoid adding dependencies before the press spec | The exact variant (X-1a:2001 / 2003 / X-4), profile, boxes and naming |
| Structural checks (`qpdf --check`, our own inspector) | READY (qpdf is not installed on this machine) | — |
| Rendering for parity (PDFium) | READY (not installed) | — |
| Independent PDF/X validation | **Not possible with open source** (`../architecture/v2/18` §2). Needs a callas, PitStop or Acrobat licence or trial | The press's own preflight profile (`17` A3) |
| Press RIP acceptance | — | **G2** |

**Tools present locally but deliberately not used in Phase 0:**
- Ghostscript 10.08.0 (AGPL-3.0);
- Poppler `pdffonts` 26.07.0 (GPL).

Their use in any pipeline awaits counsel (L1). Ad-hoc inspection on a developer machine is not distribution, but it is still kept out of experiments.

## 12.2 Evidence that would establish each PDF capability (the validation plan)

| Capability | Evidence required | Tool |
|---|---|---|
| Embedded and subset fonts | Every font embedded and subset (`ABCDEF+` prefix); Type0 / CIDFontType2 / Identity-H; ToUnicode present; `/W` widths equal kernel advances (exact) | Own inspector + commercial validator |
| Physical page boxes | MediaBox ⊇ BleedBox ⊇ TrimBox; values equal the PrintProfile in µpt; every page | Own inspector |
| CMYK only | No DeviceRGB, ICCBased-RGB or Lab in page or XObject resources (incl. ads); images DeviceCMYK or Gray | Own inspector + validator |
| ICC output intent | `/OutputIntents` with `/S /GTS_PDFX`, `OutputConditionIdentifier`, and a DestOutputProfile with N=4 that matches the press profile's hash | Own inspector |
| Transparency | No SMask, no `ca/CA < 1`, no transparency Groups (X-1a) | Own inspector + validator |
| PDF/X conformance | A zero-error report from a commercial validator **using the press's profile**, or the standard PDF/X profile if the press has none | callas / PitStop / Acrobat |
| Overprint and black | 100% K text has overprint set (`/OP /op /OPM 1`); no rich-black text below the size threshold | Own inspector + validator |
| Deterministic output | Byte-identical PDF across 10 runs and two machines for the same ResolvedDocument and profile | Hash |
| Press acceptance | The press's written confirmation naming the SHA-256 | G2 |

## 12.3 Questionnaire review (`../architecture/v2/17`)

Every item requested in the Phase 0 brief §36 is collected by the questionnaire:

| Item requested | Questionnaire section |
|---|---|
| Accepted PDF standard | B1 |
| Dimensions, trim, bleed | C1–C3 |
| ICC profile | D1 |
| Total ink coverage (TAC) | D2 |
| Black text, rich black | D3–D4 |
| Image DPI | E1 |
| Transparency | B5 |
| Fonts | F1–F6 |
| Overprint | D3 |
| Registration marks | C4 |
| Multipage vs per-page files | B3 |
| Ads | G1–G4 |
| Delivery | H1–H7 |
| Preflight software | A3 |
| Rejection causes | I1–I3 |

**No changes needed.** The instruction against pre-filling defaults is already explicit in the document.

## 12.4 PrintProfile fields (conceptual; not a database model)

Every value is filled **only** from a cited source.

| Group | Field | Source |
|---|---|---|
| Identity | press_id, profile_version, valid_from, sources[] (questionnaire refs, documents) | G0 |
| Geometry | trim_w/h (µpt), bleed (per side), safety margin, slug allowed (bool), marks required / allowed / forbidden, page orientation | C1–C5 |
| File | pdf_standard (enum), max_pdf_version, files: per_page \| multipage \| spreads_policy, naming_template, max_file_size | B1–B4, B7 |
| Colour | output_condition_identifier, icc_profile_asset (hash), tac_limit_pct, black_text_policy (k_only, overprint), rich_black_recipe + min size, rgb_policy (reject \| convert with intent), spot_policy, mono_page_policy, dot_gain_expectation, min/max dot | D1–D10 |
| Images | min_effective_ppi, preferred_ppi, max_ppi (downsample), lineart_ppi, allowed_compression, 16-bit / JPEG2000 allowed | E1–E5 |
| Fonts | embedding_required, subset_allowed, truetype_ok, cff_ok, min_text_pt (positive / reversed), min_rule_pt | F1–F6 |
| Transparency | allowed (bool), flatten_required | B5 |
| Ads | separate_delivery (bool), accepted_formats, spec_ref | G1–G2 |
| Delivery | method, endpoint (secret ref), folder_structure, receipt_format, deadlines per section, replacement_procedure, contingency_method | H1–H7 |
| Validation | press_preflight_software + version, press_profile_asset (hash), common_rejections[] | A3, I1 |

## 12.5 Newsprint colour (kept separate from commercial print)

Questions are in `17` §D. Evidence status:

| Topic | Evidence status |
|---|---|
| ICC profile and TAC | **Unknown for the pilot.** WAN-IFRAnewspaper26v5 = 220% is one published profile and **must not be generalised** |
| Dot gain / TVI | Unknown (D8) |
| Black text, overprint, rich black | Unknown (D3–D4) |
| Grayscale / mono pages | Unknown (D7, D10) |
| Image conversion (intent, BPC, sharpening) | Unknown (D5, D11) |
| Proof expectations | Unknown (I4) |

## 12.6 Parity and press-acceptance fixture specs

These are already specified, with no change from Phase 0 evidence:
- **Parity** (layout parity vs rasterisation difference, three levels): `../architecture/v2/12` §6.
- **Press-accepted fixture contents and revalidation policy:** `12` §7.

**Phase 0 addition:** identity comparisons between font subsets and resolved glyph IDs must compare **outlines at glyph IDs**, never glyph names (§12.1 finding).

## 12.7 Dependency licence classification (Phase 0-relevant; engineering view, not legal advice)

**Evidence basis:**
- package metadata read from the oracle venv;
- project licences as recorded in `../architecture/v2/18` (2026-10-07).

| Class | Items |
|---|---|
| **PERMISSIVE / ACCEPTABLE** | uharfbuzz (Apache-2.0); HarfBuzz (Old MIT); fontTools (MIT); freetype-py (BSD; bundled FreeType under FTL, attribution); Pydantic (MIT); pytest (MIT); OFL fonts (SIL OFL 1.1, licence files shipped); `hb-shape` CLI (HarfBuzz); planned: qpdf (Apache-2.0), PDFium (BSD-3), LittleCMS (MIT), Pillow (MIT-CMU), ICU4X (Unicode-3.0), harfbuzzjs (MIT), CanvasKit (BSD-3), Konva (MIT) |
| **REVIEW REQUIRED** | pikepdf (MPL-2.0: fine unmodified; review if modified); hypothesis, certifi and pathspec (MPL-2.0, dev/test only); libvips (LGPL-2.1+); hyphenation pattern files incl. `hyph-mr` (per-file licences); ICC profile redistribution; customer and commercial fonts (EULAs) |
| **COMMERCIAL LICENCE POSSIBLE / REQUIRED** | callas pdfToolbox; Enfocus PitStop; Adobe Acrobat (engineering validation only); PDFlib; Artifex commercial licences for Ghostscript or MuPDF if ever needed |
| **DO NOT USE WITHOUT LEGAL REVIEW** | **Ghostscript** (AGPL-3.0) in any pipeline; **MuPDF** (AGPL-3.0); iText (AGPL-3.0); Poppler (GPL) beyond ad-hoc local inspection |
