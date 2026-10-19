# EXP-PAGE-1: Rebuilding the Pilot's Printed Pages with Pageinator (report)

**Status:** COMPLETE (experiment). All 68 printed pages are rebuilt as PDF/X-1a, **with their real photos and ads in newsprint CMYK**. One page is selected for a press test. **G1: NOT MET** (no human rating yet). G2 was passed earlier with the EXP-PDF-1 test page.

**What this is:** experimental engineering in `experiments/phase0/page1/`, not the production layout engine and not an engine-language decision (ADR-017).
- The frozen oracle is used only for shaping; compose1 and compose2 are untouched.
- No AI was used for layout, breaking, sizing or scoring.
- Free OFL stand-in fonts replace the house fonts; the owner will supply those for the final software.

**Data:** the pilot newspaper's own 15 editions (68 pages; evidence level A). Only aggregate numbers appear here. Page models, rebuilt PDFs, comparison images and the walkthrough stay in `$PAGEINATOR_PRIVATE_CORPUS/report/page1/`.

**Date:** 2026-10-14. **Versions:** `page1-model/0.2.0`, `house_profile`, `page1-photos/1.1.0`, `page1-compose/2.6.1`, compare schema 2, `head1/1.3.1`, `compose3/1.0.0`, `pdfx1/1.0.0` (with CMYK images). The paper-level column of §5 is from the earlier `page1-compose/2.5.0` build.

**Reproduce from the repo root, prefixing each command with `PYTHONDONTWRITEBYTECODE=1`; `$DS` is the private dataset:**
```bash
experiments/phase0/published1/.venv/bin/python experiments/phase0/page1/page_model.py "$DS"        # ~46 s
experiments/phase0/published1/.venv/bin/python experiments/phase0/page1/house_profile.py "$DS"     # ~20 s
experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/page1/photos.py "$DS" --profile <newsprint .icc>   # ~2 min
tools/oracle/v0/.venv/bin/python experiments/phase0/page1/compose_page.py "$DS" --photos           # ~8 min, 68 pages
experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/page1/compare_page.py "$DS"           # ~10 min
tools/oracle/v0/.venv/bin/python experiments/phase0/page1/compose_page.py "$DS" --size paper       # held-out sizing, test editions
experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/page1/compare_page.py "$DS" --variant paper
```

---

## 0. In plain words
- **Pageinator read every page of the paper's 15 editions and learned its design language.**
  - Page and grid: 347 × 540 mm, 8 columns of 36.5 mm. Stories are often set in one column fewer than their grid span, so 4 grid columns become 3 text columns of 50 mm.
  - Headlines grow about 5 pt per column of width. There are no column rules.
  - Fronts carry about 9 stories and 6 photos; back pages carry recurring ads.
- **It then rebuilt all 68 pages** from their own stories, in the printed column geometry, as press-ready PDF/X-1a files.
- **On the 60 Marathi pages:**
  - The rebuilt text takes almost the same space as print: 19,211 lines against 19,404.
  - **97.8% of stories** come within G1's depth tolerance (±1 line per 20 lines); **99.6%** on the held-out editions.
  - With one size ratio learned only on the earlier editions (earlier build), it is still **92.1%** on the later ones, above G1's 90% bar.
  - **29 of 60 pages pass every check** (12 from the held-out editions).
- **Nothing is lost or misplaced:**
  - every character of every story is placed in order, or counted as not fitting;
  - no body line falls outside its column or on a photo;
  - every page passes the independent PDF/X checker.
- **Headlines:** 85.8% of multi-line headlines and decks break exactly as printed, given the printed number of lines (82.7% on held-out editions).
- **Photos print:** 474 photos and ads are placed from the printed pages, converted to the newsprint colour space with a total-ink limit; only vector graphics (logos, icons) remain grey placeholders.
- **What still differs:**
  - On 19 pages a few lines still don't fit (38 lines in all).
  - Lines touch in 6 places across 60 pages, measured glyph by glyph; the printed pages themselves have 88 such places.
  - English (flip) pages need hyphenation, which the Marathi policy never uses.
- **Chosen for the press:** page 3 of the 11 November edition, a full news page, picked by the rule fixed in advance from the pages that pass every check.

## 1. Question
Starting from what a newsroom has (the stories, a page plan and the house style), can Pageinator set a complete newspaper page that matches the printed page and is fit for the press?

Here the page plan is the printed page's own geometry: the stories, their columns, headline line counts and image boxes. The question is whether Pageinator's typesetting, filled into that plan, reproduces the page.

## 2. Inputs

### 2.1 Page model (`page_model.py`)
Every printed page is turned into stories, each with:
- kicker, headline, decks, byline;
- body columns in reading order, with exact text, paragraphs and crossheads;
- captions, images and jump lines.

Plus rules, boxes, images, ads and furniture.
- **Coverage:** 100% of 29,633 text lines and 672,075 glyphs; every body line sits in exactly one story flow on all 68 pages.
- **Stories:** 494, of which 277 lie entirely on their page and 302 are high-confidence. 33 ads were found.
- **How stories are grouped:** InDesign's content order threads each story's frames. Threads are cut at story boundaries (rules, headlines, jump lines), and headlines are assigned by geometry and confirmed by content order.
- **Known limits:**
  - frames excluded during measurement lose their body text;
  - a story that continues on another page without a jump line looks incomplete;
  - one-off picture ads look like photos.

**Page model 0.2.0 (step 1 of the follow-up):** a story's columns are now derived only from its own printed lines, one column per printed measure (a column splits wherever either edge of the lines changes), in reading order. In 0.1.0 a pull quote or sidebar could inherit the column box of the frame it sat in, so its lines were set at a wrong measure; that caused most of the remaining overset and collisions. Effect on the Marathi pages: overset 110 → 38 lines, pages passing every gate 22 → 29, touching line pairs 24 → 6.

### 2.2 House design language (`house_profile.py` → `results/page1/house_profile.json`)
Learned from all editions and checked against the earlier reports (7/7 agree) and against pixels at 300 dpi.
- **Geometry:** 347 × 540 mm, no bleed, ~12.5 mm margins all round (not mirrored). Type area x 12.8–334.1 mm. News starts at 84.7 mm on fronts and 26.6 mm inside.
- **Grid:** 8 × 36.5 mm with 4.19 mm gutters. A story spanning N grid columns is set in N−1 equal text columns in 59% of column sets (4→3 = 50.06 mm, the "6-column variant"). 77% of body lines sit in such sets.
- **Type:**
  - body 12/13 pt, justified on 88% of lines, indent 5.0 mm, word spaces median 1.81× the font's space;
  - headlines median 30 pt, about 14 + 5 pt per column of span, horizontal scale 0.90, multi-line ones 81% centred;
  - decks 22 pt; crossheads 12 pt bold, centred;
  - run-in datelines open 69% of stories.
- **Rhythm:**
  - headline → body 6.9 mm (1.46 leadings);
  - headline → deck 10.2 mm;
  - crossheads take exactly one leading above and below;
  - between stories: body → rule 2.5 mm, rule → headline 11.0 mm.
- **Rules and boxes:** 0.5 pt rules (72%), mostly black; no column rules; ruled boxes are 1 pt black; reverse panels about 8 mm tall.
- **Images:** about 5 per page, 92% landscape, 79% directly below the headline, 58% sized to the story's text columns.
- **Page types:** fronts carry 9 stories and 6 photos; inside pages 6 and 5; back pages 4 stories, 3 photos and 37% ads. Two running-head variants.
- **Headline shape:** no clean rule by page, span, size or alignment (agrees with EXP-HEAD-1). The default is "fill", with "balanced" available per page.
- **Owner's answer, 2026-10-13:** the shape varies by page and by designer, and the line count comes from the page plan.

## 3. Method (`compose_page.py`)
- **Body**
  - Each story's flow is set through its printed columns with the EXP-COMPOSE-3 justification policy: no word breaks, though a line may break after the hyphen inside a compound.
  - Leading is as printed; word spaces are in house units, including the horizontal scale.
  - Size: the stand-in, Noto Serif Devanagari wdth 87.5, is sized in one of two ways:
    - **story:** so each story's words take their printed width;
    - **paper:** one ratio for the whole paper (0.901) learned on the calibration editions, a held-out prediction reported on the test editions.
  - **Copyfit:** a story that does not fit is re-set at 99%, 98%, 97% or 96% of its size, the first that fits (the house's per-story horizontal scale reaches 0.96). This was used on 83 of 453 Marathi stories, 52 of them only at 99%.
  - **Vertical clearance:** the stand-in's vowel signs reach further than the house face's. Where the calibrated size would leave less than 1.20 em of leading, the size is capped and the width axis is raised (up to 100) so the words still take their printed width. Without this, falling and rising signs touched between lines.
  - **Text wrap:**
    - Obstacles are images, graphics, ads, pull-quote stories and free text blocks; anything the story's own printed lines overlap counts as a background, not an obstacle.
    - A line beside an obstacle is set narrower; a blocked line moves below the obstacle on the leading grid.
    - When the available width changes, the rest of the paragraph is re-set from that exact character.
  - Columns never run below their printed bottom. What does not fit is counted as overset, never dropped.
- **Display text** (exact ink clearance: where two composed lines of a headline, deck, crosshead or small text block would touch at their printed baselines, the size shrinks just enough to clear, and the width axis widens to keep the printed width)
  - **Headlines and decks** use the EXP-HEAD-1 composer at the printed line count, with shape "fill" and the house pairs. The stand-in is Noto Sans Devanagari: width axis first, then size to the printed width.
  - **Crossheads** are set first-fit and centred, and are never truncated.
  - **Kickers, bylines, captions and furniture** are set at their printed positions, sized by their printed glyph widths.
  - **Wingdings bullets** are set as "•".
  - **Run-in datelines** are not set twice: they are already part of the body line.
- **Graphics:** box fills, then graphic placeholders, then photos and ads (never under a placeholder), then rules and box strokes, then text. Everything is DeviceCMYK; colour conversions are recorded.
- **Photos and ads (`photos.py`, `--photos`):**
  - each photo is taken from the printed PDF at its native resolution, with its mask, cropped to the visible box, reduced to at most 200 ppi at printed size (never enlarged);
  - transparency is flattened (PDF/X-1a allows none): onto paper white, or for a cut-out photo onto the colour printed behind it (27 cut-outs);
  - converted from sRGB to CMYK with littleCMS using the WAN-IFRA newsprint profile `WAN-IFRAnewspaper26v5_TIC220.icc` (perceptual intent, black-point compensation); the profile caps total ink at 240% (measured maximum in our images: 229%). WAN-IFRA distributes its profiles free of charge; the file stays in the private folder;
  - ads are rasterised from the printed page at 200 dpi, as a stand-in for placing the advertiser's own PDF;
  - images are written as DeviceCMYK, 8 bit, Flate, with no soft masks.
- **Output:** PDF/X-1a:2003 with reproducible bytes.

## 4. Checks (`compare_page.py`)
- **PDF/X:** the independent checker, run fresh per page and tied to each PDF by its SHA-256.
- **Story depth:** G1 A7, which allows ±max(1, printed ÷ 20) lines.
- **Integrity:** every character of every story placed in order, or counted as overset.
- **Geometry:**
  - body lines inside their column box;
  - body lines over images, graphics or ads, beyond what print itself has;
  - text collisions beyond the printed page's own.
- **Accounting:** every other text element set with exactly its words.
- **Headlines:** breaks equal to print given the printed number of lines, on multi-line items, with failures counted as misses.

## 5. Results

| Marathi pages | All 60 | Calibration editions (32) | **Test editions (28)** | Test editions, paper-level size |
|---|---|---|---|---|
| Stories | 453 | 226 | 227 | 227 |
| Body lines printed → ours | 19,404 → 19,211 | 10,145 → 10,029 | 9,259 → 9,182 | 9,259 → 9,203 |
| Lines that did not fit (overset) | 38 (0.2%) | 19 | 19 | 94 |
| **Story depth within G1 A7** | **97.8%** | 96.0% | **99.6%** | **92.1%** |
| — complete, high-confidence stories | 99.6% | 99.3% | 100% | 93.6% |
| Characters in order (stories) | 100% | 100% | 100% | 100% |
| Paragraphs with the printed breaks | 31.5% | 32.7% | 30.2% | 29.7% |
| Multi-line headlines/decks with the printed breaks (given line count) | 85.8% (296) | 88.5% | 82.7% | 82.7% |
| Body lines outside their column | 0 | 0 | 0 | 0 |
| Touching line pairs, glyph level: ours (print's own) | 6 (88) | 3 (41) | 3 (47) | 11 (47) |
| Extra line-box overlaps (print's own) | 14 (144) | 9 (69) | 5 (75) | 14 (75) |
| Pages with checker FAILs | 0 | 0 | 0 | 0 |
| Pages passing every gate | **29** | 17 | **12** | 10 |

The first three columns are the `page1-compose/2.6.1` build with page model 0.2.0 and photos; the paper-level column is the earlier 2.5.0 build with page model 0.1.0. Gate failures on the 31 Marathi pages that do not pass: overset 19, composer problems 10, extra overlaps 6, extra glyph collisions 4 (a page can fail several).

**Reading the table:**
- **Depth with story sizing is partly by construction:** each story's size is fitted to its own printed word width. Line breaks do not leak, because total width does not depend on where the lines break. The **paper-level** column is the honest prediction: one ratio learned on other editions still keeps 92.1% of stories within tolerance.
- **Overset is still the most common gate failure** (19 of 60 Marathi pages, down from 54 before copyfit and 25 before page model 0.2.0). The free font's per-word widths differ from the house font's, and justified columns have no give. With the house fonts this should shrink; the owner will supply them.
- **Collisions:** most remaining ones are running-head elements, and body text against free text that the print wraps around frames we do not model.
- **Display problems:** 11 headlines or decks had no layout at the printed line count in the stand-in and were set line by line at their printed positions. 1 text element was set with a different word count.
- **English flip pages (8):** 26.8% depth. Print hyphenates English; the Marathi policy never breaks words. They are reported separately.

**The press page** (rule fixed before the results were read):
- a Marathi test-edition page passing every gate (0 checker FAILs, 0 problems, 0 overset, 0 geometry violations, 0 accounting mismatches, every character in order);
- among those, the one with the most body lines in complete, high-confidence stories.

Result: **page 3 of the 11 November edition**, a full news page. An earlier run, before copyfit, chose page 4 of 16 November, a back page with two ads. The Marathi-only clause was added after the first run had shown that the English pages hyphenate. Gates were added after the code review.

## 6. Verification
- **Code review (agent), round 1:** 2 blockers, 3 high, 5 medium and several low findings. All were addressed in `page1-compose/2.x` and compare schema 2:
  - **blockers:** run-in datelines set twice; columns running below their printed bottom;
  - **high:** no text wrap; crossheads truncated; a flattering headline number;
  - **medium:** off-centre crossheads; depth partly by construction; checks blind to layout errors; possibly stale checker results; selection without gates.

  Re-check on the real outputs: both blockers and all three high findings FIXED; H3 and M5 partly (the walkthrough now quotes the held-out figure; the folder is untracked in git, so "rule fixed before looking" rests on this report). No lost text and no infinite-loop path in the wrap logic. Residuals come from page-model grouping: overlapping column boxes, and one column with a borrowed measure. They are caught by the gates.
- **Independent verification of the press page from its own PDF (agent), with its own parser and glyph outlines:**
  - **First pass, verdict NO:** 12 line pairs in one story touched (falling and rising vowel signs) where print has none. This led to the v2.2 leading cap with width compensation.
  - **Second pass, verdict YES, fit to send as a press test:**
    - text complete and in order (every glyph covered by ActualText or ToUnicode; HarfBuzz re-shaping of the model text gives the same glyphs);
    - no ink near the trim, nothing inside image or ad boxes except their labels, **0 colliding line pairs**;
    - PDF/X-1a: 40 PASS, 11 WARN, 0 FAIL;
    - byte-identical regeneration.
  - **Notes for the press:** the red date line carries 253% total ink, inherited from the original. The press should confirm it accepts IFRA26.
  - **All 68 pages, glyph-outline collisions (v2.2):** ours 413 line pairs against 87 in the printed originals, on 49 pages more than print. This led to v2.3–2.4: exact ink clearance for display text and text blocks, a PDFium glyph-collision gate, and placeholder labels never over text. Result: 24 pairs against 88 on the Marathi pages (gate measure). Verifier re-measure on v2.5 (outline method): **92 pairs against print's 87** (body text 53 against 77, display text of 16 pt or more 39 against 10); 29 pages still exceed their original (down from 49).
  - **Final press page (v2.5): page 3 of 11 November, verdict YES, fit to send.**
    - All 6 stories (8,525 characters) and every non-ad display element are exact and in order. Wingdings bullets are set as "•".
    - 0 touching line pairs (the original has 1); nothing near the trim; PDF/X-1a 46 PASS, 18 WARN, 0 FAIL; byte-identical regeneration.
    - Cosmetic notes: the date line is 17.5 pt against the printed 16 pt and ends 0.76 mm from the folio box (the page model's box for it runs over the folio); one single-column story ends one line short.
- **Independent verification of the photo step (agent):** the press page passes: all 7 images DeviceCMYK, 8 bit, Flate, no masks; total ink in image pixels at most 229.0% (limit 240%); every image box within 0.000 mm of the page model's visible box, upright, crop matching the original (correlation 0.88–1.00, worse when mirrored); text complete; 0 colliding line pairs; byte-identical regeneration. Three other pages were checked. It found two faults on other pages, both fixed in `page1-compose/2.6.1` and `page1-photos/1.1.0`: grey graphic placeholders painted over photos (69 on 23 pages; photos are now drawn after all placeholders) and cut-out photos flattened onto white on coloured panels (now onto the printed backdrop colour). The fix changed the drawing order, so the press page was re-stamped with the current code and **verified again by a fresh independent agent: fit to send as a press test**. It found:
  - 7 images, all DeviceCMYK, no masks;
  - image ink at most 229%;
  - 1,775 of 1,775 text tokens;
  - 0 ink collisions, measured by rendering each line alone at 1200 dpi;
  - PDF/X-1a: 0 FAIL;
  - byte-identical regeneration.
- **Own checks:**
  - every rebuilt page passes the independent PDF/X-1a checker (warnings only, as on the EXP-PDF-1 page);
  - the verifier regenerated the press page byte-identically (fixed SOURCE_DATE_EPOCH);
  - I viewed the press page and other pages side by side with print.

## 7. What changed during the experiment
1. A paragraph that runs into a column of a different width is re-set from that exact character, as InDesign does. The first version would have let wide lines stick out.
2. Characters the stand-in lacks (a superscript "¹") skip one paragraph, reported, instead of failing the whole story.
3. Wingdings bullets are decoded as letters by the PDF text layer; they are now set as "•".
4. Short lines are sized by their printed glyph widths, not their extent. A date line had run into the page number.
5. After the code review:
   - text wrap;
   - run-ins not duplicated;
   - columns capped at their bottom;
   - crossheads complete and centred;
   - geometry and accounting checks, gates, the honest headline figure;
   - the held-out paper-level sizing.
6. **After the independent verifier found glyph collisions** (12 line pairs in one story of the press page, 0 in print): the leading-based size cap with width-axis compensation (v2.2). On that page the story keeps its 86 printed lines, with 0 collisions.
7. **After the verifier's all-pages count (413 against 87):** exact ink clearance for display text and text blocks; placeholder labels kept off text; a glyph-collision gate (v2.3–2.4).
8. **Copyfit (v2.5):** stories that do not fit are re-set at 99–96% of their size. Pages passing every gate went from 4 to 22.
9. **Page model 0.2.0:** column geometry from each story's own printed lines (pull quotes and sidebars). Pages passing every gate went from 22 to 29.
10. **Photo pipeline (`photos.py`, `--photos`, v2.6):** real photos and ads in newsprint CMYK. After the verifier's report: photos drawn above placeholders, cut-outs flattened onto the printed backdrop (v2.6.1, photos 1.1.0).
11. **Editor review, round 1 (2026-10-18, v2.7.1):**
   - Headline lines that print set to at least 85% of their measure are filled to exactly their printed extent (letters stretched by at most 18%, the rest spread over word spaces).
   - Lines of free text blocks that print justified to the block's width (not a block's last line) are justified again; the editorial no longer reads ragged.
   - Results are unchanged: 29 of 60 Marathi pages pass every gate. A first version filled headlines to the whole measure and pushed some into the next column (25/60); it was corrected before commit.
   - The press page's bytes changed with this, so it is to be re-verified.

## 8. G1 and G2
- **G1: NOT MET.** The automated evidence is strong: depth within G1 A7 for 92–95% of stories on held-out editions, against a 90% bar, and no lost text. G1 still needs the editors' blind reviews (body round 1, the headline round) and fresh copy.
- **G2: passed on the owner's report** with the EXP-PDF-1 page. A rebuilt real page printed on the press would be stronger evidence.

## 9. Architecture impact
- **The composition pipeline holds together end to end:**
  - page model → design profile → typesetting with text wrap → PDF/X → automatic checks;
  - about 5 s per page; deterministic.
- **The design profile is the input a layout generator needs** (grid with N→N−1 column sets, size by span, spacing table, page types); the next step is to generate layouts, not copy them.
- **Production needs:**
  - text wrap as a first-class engine feature;
  - hyphenation for English pages;
  - symbol-font mapping;
  - a font-fallback policy for missing characters;
  - an image pipeline (CMYK conversion).

## 10. Risks
- **NR18:** stand-in font widths leave 1–2 overset lines on most pages. Mitigation: the house fonts (owner) and a copyfit step (slight tracking or size adjustments) within house tolerances.
- **NR19:** bilingual flip editions need English hyphenation and English typography rules. Mitigation: a separate English policy.

## 11. Limitations
- **The page plan is copied from print**, not generated, so this tests typesetting and assembly, not layout decisions.
- **Vector graphics are placeholders** (photos and ads are real). The page head's logo and page-number box are graphics, so they are placeholders too. Ads are rasterised from the printed page, a stand-in for the advertiser's PDF; small images inside an ad are part of that raster.
- **One flattening colour per cut-out photo:** a cut-out that straddles the edge of a coloured panel gets one backdrop colour.
- **Headline weight comes from the font name.** A display face whose name does not reveal its weight can be set heavier than print.
- **Story grouping is automatic:** 56% of stories are complete on their page; jump-outs and grouping errors are not separated.
- **The house profile was learned on all editions**, so its fallback spacing carries a little test-edition data.
- **Remaining collisions and overset come mostly from the page model:** pull quotes and sidebars whose column boxes do not match where their printed lines sit, and columns listed out of reading order. By the verifier's stricter outline measure, 29 pages still have more touching line pairs than print, mostly in display text (39 against 10).

## 12. Next steps
1. **Owner:** print the press page (`report/page1/rebuilt/<chosen page>.pdf`, private), now with its photos, on the press, as for the EXP-PDF-1 test.
2. **Editors:** run body round 1 and the headline round.
3. **Engineering:**
   - the remaining overset (38 lines) and composer problems: house fonts (owner) and per-story review;
   - vector graphics (logos) from the printed page;
   - an English hyphenation policy;
   - **EXP-GEN-1** (started): Pageinator lays out the page itself from the stories and this design profile — see `docs/phase0/EXP_GEN_1_REPORT.md`.
