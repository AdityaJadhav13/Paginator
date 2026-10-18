# EXP-PDF-1: Pageinator Press-Test PDF (PDF/X-1a, CMYK) — material for gate G2 (report)

**Status:**
- **Press test done (2026-10-13).** The owner reports that the printing unit accepted and printed the test page and that the print looks good.
- **G2: PASSED on the owner's report.** The filled record sheet (RIP report, colour bars, measurements) has not been filed yet; it completes the evidence (§9).
- **Nothing here claims press-readiness beyond that test.**

**What this is:** experimental evidence tooling in `experiments/phase0/pdfx1/`, not the production PDF pipeline. The frozen oracle was not modified. No AI was used in composition or checking.

**Date:** 2026-10-11. **Writer:** `pdfx1/1.0.0`. **Page:** `pdfx1-page/1.0.0`. **Composer:** `compose3/1.0.0`.

**Data rules:**
- The pilot's text appears only in the private output (`$PAGEINATOR_PRIVATE_CORPUS/<dataset>/report/press_test/`).
- This report holds aggregates only.
- A `--synthetic` build uses the Phase 0 corpus and can be shared.

**Run (from any folder):**
```bash
<repo>/experiments/phase0/pdfx1/make_press_test.sh <private_dataset_dir>   # or --synthetic
```
It takes about 60 s and prints `ALL CHECKS PASSED — ready for the press test` and the file to send.

---

## 0. In plain words
- **The page:** one newspaper page in the pilot's exact format (347 × 540 mm, 8 columns of 36.5 mm).
- **The text:** the pilot's own paragraphs, set by Pageinator, in free Noto fonts, saved as a strict print PDF (PDF/X-1a, CMYK only).
- **A test strip at the bottom:** a grey wedge, colour patches, line weights, a 6–12 pt Marathi conjunct ladder, and white-on-black text.
- **Checking:** three separate checkers and two independent PDF renderers examined it, plus a code review by a separate agent.
- **What the review caught:** a real error in the vertical placement of some Devanagari marks (below-base ्र, ु/ू). It was **fixed and is now independently verified**.
- **What remains:** the press runs it through its RIP and prints it. That is the actual gate.

## 1. Question
Can Pageinator produce a PDF that the pilot's press accepts and prints correctly, with Pageinator-composed Marathi text? Correct means:
- the right plates;
- intact Devanagari;
- the right page size.

## 2. What the press told us, and what it demonstrably accepts

**What the owner told us (2026-10-11):**
- format: "PDF/X";
- colour: "CMYK";
- profile and ink limit: not known;
- delivery: **WhatsApp**.

**What the 16 production PDFs that went to press show** (aggregate):

| Property | Observed (16 files, 72 pages) |
|---|---|
| Producer / header | InDesign CS6 + Adobe PDF Library 10.0.1, `%PDF-1.4`. All files use object streams (a PDF 1.5 feature) |
| PDF/X | **No.** No OutputIntents and no GTS keys in any file; `/Trapped /False` |
| Colour | DeviceCMYK vector; **98.7% of 658 image placements are RGB**; a few RGB vector fills |
| Transparency | **Live, in 14 of 16 files** (soft masks, multiply, ca 0.75) |
| Black text | 98.3% of 841,298 text glyphs are `0 0 0 1 k`, **all overprinting** (`/OP /op true`, `/OPM 1`) |
| Ink | Vector TAC up to 291% (raster ink not measured) |
| Fonts | All embedded TrueType (Type0/CIDFontType2/Identity-H and simple), with ToUnicode |
| ActualText | **83,880 spans across all 16 files**, under `%PDF-1.4` |
| Images | 52–450 ppi (median 205) |

**Reading:** the press's RIP accepts plain InDesign PDFs that contain RGB, transparency and PDF 1.5 structures. A strict PDF/X-1a page with CMYK only, no transparency and a classic xref is **more conservative than anything it already accepts**.

## 3. Decisions (and why)

| Decision | Choice | Reason |
|---|---|---|
| Standard | **PDF/X-1a:2003, `%PDF-1.4`** (X-1a:2001 / `%PDF-1.3` available) | 1.4 is the header the press received 16/16 times. Per the spec research: `GTS_PDFXVersion (PDF/X-1a:2003)`, with no Conformance key (Harlequin RIPs prefer that key if present) |
| Output intent | `IFRA26`, `RegistryName http://www.color.org`, no embedded profile; `--dest-profile` embeds a press-supplied ICC v2 profile | IFRA26 (ISOnewspaper26v4, ISO 12647-3 coldset) is the registered newsprint condition and is legal by reference in X-1a. `IFRA30` was dropped: it is no longer in the ICC registry. The page is pure DeviceCMYK, so the label does not change the plates |
| Colour | DeviceCMYK only. Black text and 100K rules overprint (OPM 1); tints, colours and white knock out. Max TAC 200% | Same convention as the press's own files. White can never overprint (guarded in the writer and checked) |
| Fonts | Noto Serif Devanagari (wdth 87.5) and Noto Sans Devanagari Bold/Regular (OFL), as static instances. Type0/CIDFontType2/Identity-H, CIDToGIDMap /Identity. Subsets retain glyph IDs; `/W` comes from the embedded program; names are corrected | CID = HarfBuzz glyph ID, so the positions are exactly the composer's. The house font (4CPlus FourCMR) is not licensed to us |
| Text layer | ToUnicode, plus `/ActualText` around reordered or ligated clusters. A `--no-actualtext` variant exists | Same mechanism as the press's own files (83,880 spans). Formally a PDF 1.5 feature, but it never renders. A fallback exists if a strict preflight objects |
| Page | 347 × 540 mm, Media = Trim = Bleed, no ArtBox; 8 × 36.5 mm grid | The pilot's measured format |
| Body | EXP-COMPOSE-3 chosen spacing policy, no word breaks. 10.79 pt stand-in on 13 pt leading (calibrated on the pilot's words) | The policy that ties the pilot's InDesign |
| Test slugs | "PAGEINATOR PRESS TEST — NOT FOR PUBLICATION — build …" at top and bottom, 7–10 mm inside the trim | The page must never be mistaken for an edition |

## 4. The writer (`pdfx.py`)
- **No PDF library.** It writes a fixed object order with a classic xref (20-byte entries).
- **Deterministic output:** Flate level 9; trailer `/ID` = MD5 of the body; dates from `SOURCE_DATE_EPOCH`.
- **Each glyph is placed individually:** `1 0 0 1 x y Tm <GID> Tj`.
- **Built-in self-checks:** every subset glyph keeps its ID, outline and advance; non-finite numbers are refused; overprint is refused on any colour except 100K.

## 5. Verification

| Layer | Result (real-paragraph page; synthetic page identical in kind) |
|---|---|
| `verify_press_test.py`, **40 checks** | **All pass.** Details in the next table |
| `check_pdfx1a_independent.py` (≈ 2,700 lines, written by a separate agent **without seeing the writer**) | **36 PASS, 7 WARN, 0 FAIL** — "no conformance failures for PDF/X-1a:2003" |
| Mutation self-test (`mutation_test.py`) | **6/6 deliberate defects caught**, each by exactly the intended check: white text overprinting, wrong body size, an emptied mark outline, a corrupted xref offset, mirrored mark offsets with a consistent manifest, a wrong glyph ID |
| Two independent renderers | PDFium and Apple Quartz render the page identically |
| Repeatability | A regenerated copy is byte-identical |
| Code review (separate agent) | 1 blocker, 2 high, 3 medium and 5 low findings. **All fixed or addressed** (§6) |

**The 40 checks in `verify_press_test.py`:**
- **Structure:** qpdf strict structural check.
- **PDF/X:** header and GTS keys, Title, dates, Trapped, ID, output intent.
- **Page:** boxes.
- **Content:** DeviceCMYK only; no transparency; overprint only on 100K for every paint operation; one upright glyph per `Tj`.
- **Glyph placement:** **all 14,714 glyphs** at the composed font, size, ID and position.
- **Fonts:** structure, and `/W` against the embedded advances.
- **Independent glyph check:** **every used glyph's outline and advance are identical to the original font, re-instanced independently** (0 units deviation).
- **Independent shaping:** HarfBuzz from the original files gives **the same glyph IDs on 646/646 lines, 0 vertical mark offsets off, and 0 in-word spacing pairs off**.
- **Text:** every line reads back exactly (ActualText-aware reader).
- **Rendering:** patch colours render as intended.

**The independent checker's 7 warnings, all explained:**
1. **IFRA26 by name:** confirm the RIP knows it. The record sheet asks.
2. **Glyphs without ToUnicode (3 fonts):** half-forms and ligature parts that have no single character; covered by ActualText.
3. **An empty glyph:** `NullMark`, the font's intentional empty mark used when ि+ं form a ligature.
4. **ActualText in a 1.4 file:** the press's own 1.4 files contain 83,880 such spans.
5. **pdfminer placeholders (6%):** pdfminer ignores ActualText; the ActualText-aware read-back is exact.

## 6. The code review's blocker and the other fixes

**The blocker: vertical mark offsets had the wrong sign.**
- The oracle's `y_offsets_mm` are already y-down (`shape.py` negates HarfBuzz). The page builder subtracted them.
- Effect: below-base rakar, ु/ू and some reph forms were drawn mirrored about their attachment point, by up to 0.26 mm at 10.85 pt.
- Why it was missed: the old verifier compared against data from the same source.
- **Fixed** (`y + offset`). A new **independent** shaping check (§5) now catches this class of bug; mutation E proves it.
- **Same defect, upstream:** the frozen SVG helper `compose1/render_sheets.line_glyphs`. It affected the EXP-COMPOSE-1/2 review sheets and proofs, the walkthrough illustration, and the EXP-COMPOSE-3 round-1 sheets.
  - New tools use the corrected copy `compose3/render.py`.
  - **The round-1 blind-review sheets were regenerated.** Same seed, same 28 items, same sealed key.
  - The EXP-COMPOSE-2 synthetic proofs remain defective and **should not be printed**.

**Other fixes:**
- Overprint guarded in the writer and checked per paint operation.
- The verifier no longer confirms itself: outlines are compared with independently re-instanced originals; HarfBuzz re-shaping; Tf/Tm checks.
- The wrapper:
  - prints every FAIL/WARN line;
  - shows SKIP instead of FAIL when a checker is missing;
  - resolves relative paths;
  - runs with `umask 077` in dataset mode;
  - cleans up temporary files.
- A verifiable `--no-actualtext` fallback.
- The build ID covers the policy, the font bytes and the profile.
- Embedded font names are rewritten.
- Non-finite numbers and an empty `SOURCE_DATE_EPOCH` are handled.
- Headline overflow is refused; slugs were moved inward.
- Unused code removed; the zlib version is recorded.

## 7. Limitations (stated, not hidden)
- **No commercial preflight** (Acrobat or callas) was available. The two checkers implement the published rules, but **the press's RIP is the real test**.
- **The press's real output condition and ink limit are unknown.** IFRA26 is a reasoned default. The record sheet asks for both, and `--dest-profile` embeds the press's profile.
- **Stand-in fonts.** The house font needs a 4CPlus licence (P0-11).
- **No photographs on the test page.** Images (the pilot's workflow is 98.7% RGB) are a later pipeline step; this page tests type, tints, colour and structure.
- **ActualText under `%PDF-1.4`** is formally a 1.5 feature. It is accepted in this press's own files, and a fallback exists.

## 8. What to send and what to bring back
- **Send** `pageinator_press_test.pdf` on WhatsApp **as a Document** (paperclip → Document), not as a photo.
- **Ask the printing unit** to run it through their normal RIP/preflight, make plates, and print one copy on newsprint.
- **Ask them to fill in `press_test_record.html`:**
  - RIP name/version and its exact messages;
  - which CMYK profile they use;
  - plate checks (black text only on K);
  - Devanagari intact on the 6–12 pt ladder;
  - grey steps, thinnest line, reversed text;
  - a verdict and signature.
- **Bring back:** the record sheet, the RIP/preflight report, one printed copy, and a photo.

## 9. G2 criteria (this test)
**G2 is MET for this page when all of these hold:**
1. The RIP accepts the file with no errors. Any warnings are recorded and judged harmless.
2. The plates are as specified: text and 100K rules only on K; patches on their plates; 347 × 540 mm.
3. The printed page shows the Devanagari text intact at 8 pt and above. The 6–7 pt lines are informative only.
4. The printing unit's verdict is "would accept for production".

**Otherwise:** the RIP's messages decide the fix. The options are an X-1a:2001 header, `--no-actualtext`, or an embedded press profile. All three are one command away.

## 10. Architecture impact
**No ADR changes.**
- **Supports the planned custom PDF/X writer** (ADR-006 font approach; the print pipeline in `08`): a small own serializer with Type0/CIDFontType2 + HarfBuzz glyph IDs produces conformant output.
- **New requirements for the production pipeline:**
  - (a) a contract test on **mark-offset sign conventions** between shaping and every renderer (PDF and screen);
  - (b) **independent re-shaping verification** in CI for every PDF;
  - (c) per-paint overprint checks;
  - (d) ActualText-based text layers for Devanagari;
  - (e) configurable output intents per press, with embedded profiles supported.

## 11. Risks

| Risk | Status |
|---|---|
| The press RIP rejects something hand-written | Mitigated as far as possible without the press: two checkers, two renderers, a more conservative file than the press's own. Real answer pending |
| The output condition does not match the press | Low impact for a pure-CMYK page; the record sheet asks; `--dest-profile` is ready |
| Mark-offset sign errors in any renderer | **Found and fixed.** Independent check plus mutation test in place; legacy SVG proofs flagged |
| The WhatsApp channel compresses or renames the file | Send as Document; the SHA-256 printed by the command lets the press confirm the file is unchanged |

## 12. Next step
**Send the PDF to the printing unit and get the record sheet back.**
- **If it is accepted and prints correctly:** G2 is met for type and colour. The next print step is images (RGB → CMYK newsprint conversion) and a full page with photos and ads.
- **If it is rejected:** the RIP's exact message decides which variant to send.
