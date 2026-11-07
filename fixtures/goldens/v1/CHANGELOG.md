# Golden vectors — changelog

Every change to `fixtures/goldens/v1` (or `fixtures/fonts/v1`) comes from a generator change in `tools/goldens/v1`,
is explained here, and is approved by a human in its pull request.

## v1.0.0 — 2026-10-20 (M0.5)

First set, from the frozen oracle (`tools/oracle/v0`, manifest SHA-256 `04522301…`) and the Phase-0 experiments
at the tip of `feature/phase0-close` (page1-compose 2.8.0, gen1 2.10.0). It was generated on the reference
machine (macOS arm64, CPython 3.11.14, uharfbuzz 0.56.0 / HarfBuzz 14.3.0, fontTools 4.63.0), and `--check` passes
there.

**Contents.** Unicode 14 / HarfBuzz script tables; Python-semantics vectors (616,073 assertions); 23 font records
(13 pinned instance files, 19 distinct instances); Liang tables and 11,719 words; 6,565 full compositions and 184
prepared paragraphs; 2,585 headline records; 892 placed lines; 1,477 PDF building-block vectors and 14 micro PDFs;
the synthetic press-test page.

**Self-checks done while generating:**
- All 3,564 dumped compose2-grid compositions reproduce `experiments/phase0/results/compose2/signatures.json`.
- The five fixture fonts resolve to the `font_id`s of `fixtures/typeset/v1`.
- The press-test fonts resolve to the instance hashes in the press manifest.
- The 14 micro PDFs and the press golden pass the independent checker
  (`experiments/phase0/pdfx1/check_pdfx1a_independent.py`) with 0 FAIL. Its warnings are the ones the press-accepted
  file also carries: the printing condition named by its registry entry, Devanagari conjunct glyphs mapped through
  ActualText rather than ToUnicode, and ActualText in a PDF 1.4 file.

**The press golden differs from the EXP-PDF-1 file of 2026-10-14 in its build id only** (`press/info.json` →
`reference`).
- *Cause:* page1-compose 2.8.0 (`c9786fd`) added `pattern_min` and `compound_breaks` to `composer3.Policy`.
  `Policy.key()` hashes `asdict()`, so the body policy key changed (`2d2631806ae1` → `45f91132685a`), and with it
  the build id printed in the two slug lines and the Title (`39b217c097` → `7354475e64`).
- *Proof:* rebuilding from `c9786fd^` with the same `SOURCE_DATE_EPOCH` reproduces the old file byte for byte
  (SHA-256 `7593d3f4…`). Diffing that against this golden: 644 of 646 manifest lines and 6 of 7 streams are
  identical. In the page stream, only the 20 build-id glyphs differ, in their ids and x positions. Outside the
  streams, only the Title, the page stream's Length, the xref offsets and `/ID` differ.
- *For M6:* the private press-accepted page was made before `c9786fd` too. Compare the TypeScript writer against the
  current Python output for that page, and repeat this proof privately, to tie the current output to the accepted
  file.
