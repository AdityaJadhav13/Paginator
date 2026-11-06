# 14 — Platform parity, colour parity, G1's L3 and the press test page: evidence note

> Written for: the owner (who decides D-14 and signs G1-1 and G2) and the engineers or agents who repeat these checks.
> Status: measured 2026-11-05 on the owner's Mac (Apple silicon) and the linux/amd64 worker image built there from this
> checkout (never pushed). Aggregates only: the pages, photos and text stay in `~/PageinatorPrivate` and the private
> evidence folder. **No gate is met by this note.** It records what was measured and what the owner must still sign.

## Summary

| Item | Source | What was measured | Result | Still needed |
|---|---|---|---|---|
| A2 platform parity (risk R1) | 10 L2.3 "Done when" #2, D-14 | Two of the owner's frozen run requests laid out by the engine on the Mac and in the worker image: 12 pages carrying 17 news photos, one back-page ad and the template pages' own art | **12 of 12 page PDFs byte-identical**; the plans, the pages' stories and the stories not placed are the same | The owner accepts the result in writing (D-14); repeat on the real engine host (C16) |
| A3 colour parity | 10 L2.2 "Done when" #2 | 253 real photos through the hosted path (`media.ingest` in the worker image) and the Desk's conversion, with the WAN-IFRA newsprint profile | The CMYK raster the engine places: **253 of 253 byte-identical**; previews 253 of 253 | The SHA-256 list stays private; nothing for the owner to sign |
| A4 G1-2: L3 | 08 §15.1 Track G, 13 G1 | The 24 pages of the owner–editor's round-3 review, from the existing outputs | **3 of 7,907 body lines (0.04 %) outside the spacing policy** (limit 2 %); longest run 1 (limit: no run of 3) | **G1-1:** the owner–editor's signed sheet. G1 stays NOT MET until it is signed |
| A5 G2-1 file | 08 §15.1 G2-1, 11 L2-545 | The product makes the photo + ad press test page: Print profiles → "Download press test page" | Made on the Mac and in the worker image with the WAN-IFRA profile: **the same bytes**, and the independent PDF/X-1a check passes (0 FAIL, 8 WARN) | **G2-1, G2-2 (D-21):** the press prints it, accepts it in writing naming its SHA-256, and the record sheet is filed. Until then no page with photos or ads goes to press |

## A2 — Platform parity of the layout engine (risk R1)

**How it was run.** `tools/parity/layout_parity.py`, with the Desk's Python (it has pikepdf):

```bash
docker build --platform linux/amd64 -f infra/docker/engine-worker.Dockerfile -t pgn-engine-worker:local .
experiments/phase0/pdfx1/.venv/bin/python tools/parity/layout_parity.py --home ~/PageinatorPrivate/desk \
  --edition <edition> --run <run> --image pgn-engine-worker:local --out <new private folder>
```

- **The same call on both sides.** Each runs the worker's own call, `<engine python> tools/desk/engine/desk_engine.py
  generate`, from the repository's root. The environment holds only PATH, HOME and the Python settings, as
  `pgn_worker/engine.py` gives the engine, plus one fixed `SOURCE_DATE_EPOCH` (the writer's dates).
- **A fresh home on each side:** the Desk's config (its dataset path changed to where that side sees it), the edition's
  articles, photos and ads, and the run's `request.json`.
- **The same code.** The image runs from its own code, so the script first compares the engine's code in the image with
  the checkout's, file by file. 151 files: the Desk's engine and server, the frozen oracle with its fonts, the Phase-0
  engines. All were equal. (The press test page added two files later; the check now also fails on a file that only
  the checkout has.)
- **Page by page.** Every page PDF is compared by SHA-256. A page that differs gets a structural diff (`--compare A B`
  runs it alone):
  - decoded and compressed streams;
  - every glyph, picture, rule and tint, paired in drawing order, with the largest change;
  - fonts and pictures, by the SHA-256 of what decides their look;
  - the document's own keys.
  Its four tests use fictional PDFs (`tools/parity/test_layout_parity.py`).

**Result (2026-11-05).**

| Request | Pages | Pictures drawn (news photos, ad, template art) | Mac | Image | Page PDFs identical |
|---|---|---|---|---|---|
| A 4-page edition with a back-page ad (the Desk's run of 2026-10-20) | 4 | 22 (7, 1, 14) | 180 s | 284 s | **4 of 4** |
| The owner's latest edition (8 pages, 158 articles, the run of 2026-11-04) | 8 | 49 (10, 0, 39) | 623 s | 679 s | **8 of 8** |

- **More than the PDFs agree.** The plan, the stories on each page, the stories not placed with their reasons,
  `printed.json` and every page's manifest are the same on both sides.
- **The two sides differ underneath.** HarfBuzz comes from a macOS arm64 wheel on one side and a manylinux x86-64 wheel
  on the other; the maths library is macOS's against glibc's; zlib is 1.2.12 against 1.2.13. The Flate streams still
  came out the same.
- Nothing differed, so the structural diff had nothing to list for the owner.

**Not proven.**
- **Not on the real host.** The image ran under Rosetta on the Mac, not on the AWS engine host. On real hardware a library
  may pick other vector instructions at run time. Before the first hosted edition goes to press, repeat the same command
  with the same two requests on the host (C16).
- **A sample.** Two requests are a sample, not every page the paper will make. Run the script again whenever the image
  or its base changes.
- **The rule is the owner's.** D-14 asks for bytes, or a structural diff plus a press test. Bytes held here.

## A3 — Colour parity (hosted CMYK path against the Desk)

**How it was run.** `tools/parity/colour_parity.py --image <tag> --icc ~/PageinatorPrivate/icc/<profile> --out <new
private folder> ~/PageinatorPrivate/desk/editions/*/photos`
- **Hosted:** the worker's `media.ingest`, unchanged, in the worker image. The profile is mounted where the worker reads
  it, and every photo is first stored as an asset's original (in a store held in memory: no S3, no network).
- **Desk:** `deskserver.images.convert_photo` from the checkout, run by the Desk server's Python.
- **Compared per photo by SHA-256:** the raw CMYK raster the engine places, its gzip file, that file without its 10-byte
  header, and the preview.

**Result.** Profile `WAN-IFRAnewspaper26v5_TIC220`, SHA-256 `515b9276e7e1…`; both sides read the same file.

| | Photos | Identical |
|---|---|---|
| Raw CMYK raster (what goes on the page) | 253 | **253** |
| gzip file | 253 | 0: only its header's OS byte differs (macOS writes 19, Linux 3) |
| gzip file without its header | 253 | 253 |
| Preview JPEG | 253 | 253 |
| The raster the owner's Desk stored at upload (photos whose original the Desk kept) | 1 | 1 |

The SHA-256 list (each photo and its raster on each side) is `report.json` in the private folder. Both sides run
Python 3.11.14, Pillow 12.3.0 and LittleCMS 2.19.

**Not proven.**
- **Inputs.** The inputs are the Desk's own previews of the owner's photos (RGB JPEG, at most 1,600 px), plus the one
  camera original the Desk kept. The Desk keeps no other originals, so full-size camera files were not run. They go
  through the same decoder and colour transform, after a reduced-size decode. Repeat with a week of real uploads (L2.2
  "Done when" #1).
- **The gzip header.** Its difference is harmless, since the engine reads the raster bytes. But a stored raster's file
  SHA-256 differs between the Desk and the hosted product: compare rasters by their unpacked bytes.

## A4 — G1-2: L3 on the 24 reviewed pages

**How it was run.** `tools/parity/l3_spacing.py <dataset> <new private folder>`, with the Desk's Python. The criterion
(doc 16 §3.2, doc 13 G1): lines outside the spacing policy at most 2 %, and no 3 consecutive loose lines.
- **The pages:** the 24 "real" pairs of the round-3 review key. The measurement is made on their existing page PDFs
  (gen1/2.10.0); nothing was regenerated.
- **The policy in force:** EXP-COMPOSE-3's `C3_floor0.66_stretch1.00`.
  - Every non-final body line is justified to its measure.
  - No word space is below 0.66 of a house space.
  - There is no stretch ceiling, because the paper justifies every line.
- **Outside the policy:**
  - a line that runs past its column (overfull);
  - a non-final line that does not reach its column's right edge (±0.15 mm);
  - a word space below 0.66.
- **Measured from the PDFs**, not from the composer's own report:
  - every glyph's position, with the space glyphs found through the font's ToUnicode map;
  - a gap runs from the space glyph's x to the next word's x, in house spaces (0.25 × the story's house size);
  - the page manifests are used only to find the body lines and to cross-check.

**Result.**

| | Measured |
|---|---|
| Body lines | 7,907 on 24 pages |
| Outside the policy | **3 (0.04 %)**: three one-word lines on two pages, which cannot be justified (they have no word space). 22 pages have none |
| Longest run of outside lines in one column | **1** |
| Narrowest word space | 0.661 house spaces (the floor is 0.66) |
| Cross-check with the manifests | 0 lines unmatched, 0 line kinds that disagree, 0 line ends off by more than 0.15 mm, 0 space counts that differ |

**How loose the lines are.** The policy has no stretch ceiling, so the number above is close to automatic. Here are
Pageinator and the paper's own print on the same 24 pages. Print counts its kept paragraphs, with gaps next to
punctuation left out, as EXP-COMPOSE-3 measured it.

| Non-final lines | Pageinator | Print |
|---|---|---|
| Lines measured | 7,272 | 2,815 |
| Widest gap over 2× | 48.3 % | 47.2 % |
| Widest gap over 3× | 23.3 % | 23.8 % |
| 95th percentile of the widest gap | 5.31× | 5.73× |
| Word space under 0.8× | 3.9 % | 3.6 % |
| Runs of 3 or more consecutive lines over 3× (ours within a column, print within a paragraph: not quite like for like) | 18.8 per 1,000 lines | 17.8 per 1,000 lines |

If "loose" in the rule meant "a gap over 3×" rather than "outside the policy", the no-3-in-a-row rule would fail for
print as well as for Pageinator. The owner–editor judges that on paper.

**Caveats.**
- **Not the exact images.** The round-3 kit was rendered on 2026-10-19 from an earlier gen1 build, and the kit is not on
  this machine. These are the gen1/2.10.0 outputs of the same 24 pages (2026-10-20): the closest existing ones, not the
  exact images he saw.
- **Tables left out.** 12 lines of set-as-printed tables are not body text under the policy, so they are left out
  (they are counted in the private report).

**What G1 still needs.** G1-1, the owner–editor's signed sheet. G1 stays **NOT MET** until it is signed; this note
gives the L3 number to put beside it.

## A5 — G2-1: the press test page with a photo and an ad

**What exists now.** "Download press test page" on Print profiles. Anyone who can see print profiles can press it.
- **How it is made.** The API asks the edit gateway (`GET /v1/press-test`, signed) for the page. The gateway runs
  `tools/desk/deskserver/presstest.py`:
  - a fictional photo and a fictional ad, drawn by software the same every time, are converted to CMYK by the Desk's own
    conversion with the press colour profile, exactly as real photos and ads are;
  - the engine's page writer lays them out in the engine's Python (`tools/desk/engine/deskpresstest.py`) on one page of
    the pilot's format, 347 × 540 mm, with the accepted test page's Marathi body text (the Phase-0 synthetic corpus,
    composed by the engine), tints of each ink, solids, rich black, a grey balance pair, rules from 0.1 to 2 pt, a type
    ladder, white text on black, and a registration mark in each corner;
  - the independent PDF/X-1a checker reads it.
- **What the screen shows.** The file is saved, and the screen shows its SHA-256 (the press accepts the file by it), the
  check's result, and that the photo and the ad are fictional.
- **When it is refused.** The API refuses a page that failed its check, a paper whose recorded page size is not
  347 × 540 mm, and a gateway whose colour profile is not the one the engine was set up with.
- **On the Mac.** The Desk can make the same page without the hosted product:
  `cd tools/desk && <Desk python> -m deskserver.presstest <folder>`.

**Measured (2026-11-05, WAN-IFRA profile `515b9276e7e1…`).**

| | Mac (the Desk's command) | Worker image (linux/amd64) |
|---|---|---|
| SHA-256 | `00cb124ecbb00e74356968d1b0a22c4bf472f451dc60b2b49a19310a0945f692` | the same |
| Size | 329,371 bytes | the same |
| Independent PDF/X-1a check | 36 PASS, 8 WARN, 0 FAIL | the same |

**In the product (the independent verification, a real stack on the Mac and Chromium; a fictional colour profile).**
- **The first press** made the page in 6 s. The SHA-256 on the screen was the downloaded file's, and the check line and
  the fictional note were shown.
- **Every later press gave the same SHA-256:** a second press (0.2 s, kept by the gateway), the Marathi screen, and a
  cold make after the gateway was restarted.
- **A Reporter** has no button (the API answers 403).
- **With the gateway stopped**, the screen says the page cannot be made just now (503).
- **The page itself:** the downloaded file checked again by the verifier (0 FAIL), 347 × 540 mm, two pictures. The
  Desk's command and the worker image gave the same SHA-256 with that profile too.

- **Seven of the warnings** are the ones the text-only page the press accepted also gets: the output condition named
  only (IFRA26), glyphs without a text mapping, ActualText in a PDF 1.4 file, unmapped text above 5 %.
- **The eighth is new: the registration marks.** They are drawn in C100 M100 Y100, with K100 overprinted on top, so all
  four plates carry them: 300 % in one object (the checker warns above 260 %; coldset newsprint usually stays at or
  under 240 %), 400 % of ink where the K lies over them. They are thin lines and small targets in the four corners.
  Elsewhere the vector colours reach at most 200 % (the rich black and red patches), and the converted photo and ad
  peak at 229 %, as the profile converts real photos. The press decides whether the marks are acceptable.
- **Two makes give the same bytes,** on one machine and across the two platforms measured (the Mac and the worker image
  under emulation; with a fictional profile too, through the real stack). The page's date is fixed (2026-01-01), so the
  file is expected to be the same on the engine host while the code and the profile are the same: confirm it there
  with A2's run (C16) before the press's acceptance is relied on for hosted pages.

**What the owner must still do (G2-1, G2-2, D-21).**
1. Download the page and send it to the press as a normal page file.
2. The press runs it through its intake and RIP, prints it, and confirms acceptance **in writing, naming its SHA-256**.
3. Record that on the Release tab (press test: the SHA-256, the date, a note), and file the record sheet (RIP report,
   the file's SHA-256).

Until then, no page with photos or ads goes to press: the release check already asks for the press test.

**Not proven.**
- **Not yet printed.** Nobody has printed this page yet. Its colours, the photo's tones and the ad's small type on
  newsprint are exactly what the press test is for.
- **The pilot's format only.** Another paper's format gets a refusal (doc 11).
- **A fictional photo and ad.** G2-1 in doc 08 asks for "one real ad"; the photo and the ad here are fictional, drawn to
  exercise the same conversion. If the press or the owner wants a real ad on the test page, that is the owner's choice
  (D-21).
