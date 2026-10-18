# EXP-PDF-1: Pageinator press-test PDF (PDF/X-1a, CMYK) — material for gate G2 (EXPERIMENTAL / EVIDENCE ONLY)

**Removable without affecting Pageinator.** This is not the production PDF pipeline. It is the smallest writer that can put Pageinator-composed Marathi text on a page in a form a newspaper press RIP accepts, so that the press test (gate G2) can happen early.

## One command (≈ 60 s; from any folder)
```bash
<repo>/experiments/phase0/pdfx1/make_press_test.sh <private_dataset_dir>   # the paper's own paragraphs (output stays private)
<repo>/experiments/phase0/pdfx1/make_press_test.sh --synthetic             # synthetic Marathi text (shareable)
```

**What it does:**
1. Generates the page.
2. Runs **40 verification checks**. Several are independent of the generator: fonts re-instanced from the original files, every line re-shaped with HarfBuzz.
3. Runs the **independent PDF/X-1a checker**.
4. Regenerates and confirms the output is **byte-identical**.
5. **Self-tests the verifier**: 6 deliberately damaged copies must each be caught.
6. Writes a preview PNG and the press-test record sheet.

It ends with `ALL CHECKS PASSED — ready for the press test` and the file to send; the exit code is 0. Send the PDF on WhatsApp **as a Document**, not as a photo.

**Options (environment variables):**

| Variable | Values |
|---|---|
| `PDFX` | `X-1a:2003` (default, `%PDF-1.4`) or `X-1a:2001` (`%PDF-1.3`) |
| `ACTUALTEXT` | `0` turns off the ActualText fallback |
| `DEST_PROFILE` | A press-supplied CMYK ICC v2 profile to embed |
| `CONDITION_ID` | The profile's condition name, if it is not IFRA26 |

## Files

| File | Role |
|---|---|
| `pdfx.py` | Our own PDF serializer (no PDF library). Writes DeviceCMYK graphics and text in embedded TrueType fonts: Type0/CIDFontType2, Identity-H, CIDToGIDMap Identity, with glyph-ID-retaining subsets checked glyph by glyph against the original. Also writes ToUnicode and `/ActualText`, PDF/X-1a Info keys, the OutputIntent (IFRA26 by reference, or an embedded profile), page boxes and guarded overprint. Output is deterministic |
| `make_press_test.py` | Builds the test page on the pilot's measured format (347 × 540 mm; 8 × 36.5 mm columns) with body text set by the EXP-COMPOSE-3 policy (control strip contents below). Writes the PDF and its manifest |
| `verify_press_test.py` | The 40 checks (listed below) |
| `check_pdfx1a_independent.py` | PDF/X-1a checker written by a separate agent **without access to the writer** (≈ 2,700 lines, tested on 85 variants) |
| `mutation_test.py` | Proves the verifier catches 6 kinds of real defect |
| `make_press_test.sh` | The one-command wrapper |
| `press_test_record.html` | Printable record sheet for the printing unit (RIP messages, profile, plates, printed result, verdict) |
| `requirements.txt` | Exact versions of the isolated check environment (`.venv`: pikepdf/qpdf, pypdfium2, pdfminer.six, fontTools, uharfbuzz; no AGPL tools) |

**Test page content:**
- headlines, a 15% K photo area and a column rule;
- a print-control strip: K wedge 0–100%; C, M, Y, K, red and rich-black (200%) patches; 0.1–2 pt lines; a 6–12 pt conjunct ladder; reversed text;
- "TEST — NOT FOR PUBLICATION" slugs.

**The 40 checks in `verify_press_test.py`:**
- **Structure and keys:** qpdf structure; PDF/X keys; output intent; boxes.
- **Paint:** DeviceCMYK only; no transparency; **overprint only on 100K for every paint operation**.
- **Text operators and glyphs:** upright one-glyph `Tj`; every glyph's font, size, ID and position.
- **Fonts:** structure and `/W`; **outlines identical to the independently re-instanced original**.
- **Shaping:** **independent HarfBuzz** agreement on glyph IDs, vertical mark offsets and in-word spacing.
- **Text and rendering:** exact text read-back; patch colours.

**Environments:**
- Generation runs in `tools/oracle/v0/.venv`.
- Checks run in `experiments/phase0/pdfx1/.venv`. The wrapper creates it if missing.

**Report:** `docs/phase0/EXP_PDF_1_REPORT.md`.
