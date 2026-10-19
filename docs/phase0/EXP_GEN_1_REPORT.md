# EXP-GEN-1: Pageinator Lays Out a Newspaper Page Itself (report)

**Status:** COMPLETE (experiment). On the held-out editions Pageinator lays out **all 28 Marathi pages** by itself (gen1/2.10.0, 2026-10-19). Earlier versions are reported below; the latest results are in §9.
- **All 28 pass every automatic check.**
- 11 pages are outside this version's scope or have no exact fit.
- **No editor has judged the layouts yet. G1: NOT MET.**

**What this is:** experimental engineering in `experiments/phase0/gen1/`. It is not the production layout engine and not an engine-language decision (ADR-017).
- Typesetting is EXP-PAGE-1's (`compose_page.py`, `head1`, `compose3`, the frozen oracle for shaping only).
- No AI is used for layout, sizing, breaking or scoring. The search is deterministic.

**Data:** the pilot newspaper's own 15 editions (evidence level A).
- Layouts are generated on the **held-out (test) editions**.
- Every frequency the generator learns (span by story priority, body type styles, word space, the lead's side) is counted on the **calibration editions only**.
- Only aggregate numbers appear here. Generated PDFs, manifests and side-by-side images stay in `$PAGEINATOR_PRIVATE_CORPUS/report/gen1/`.

**Date:** 2026-10-21. **Versions:** `gen1/2.9.6`, `page1-compose/2.7.1`, check schema `pageinator.gen1.check/2`. Built on `page1-model/0.2.0`, `page1-photos/1.1.0`, `page1-compose/2.6.1`, `head1/1.3.1`, `compose3/1.0.0` and `pdfx1/1.0.0`.

**Reproduce from the repo root, prefixing each command with `PYTHONDONTWRITEBYTECODE=1`; `$DS` is the private dataset:**
```bash
tools/oracle/v0/.venv/bin/python experiments/phase0/gen1/generate.py "$DS"            # ~55 min, 28 test pages; deterministic
experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/gen1/check_gen.py "$DS"   # ~5 min
```
Prerequisites: EXP-PAGE-1's page models, house profile and photos.

---

## 0. In plain words
- **Until now Pageinator copied the printed page plan. Now it makes the plan itself.** It is given:
  - the page's stories (text, headline, photos);
  - which story matters most (the editors' own headline sizes);
  - the page's fixed parts (running head, ads);
  - the paper's design language, learned in EXP-PAGE-1.

  It decides where each story goes, how wide it is, how many text columns it gets, how big its photo is, its headline size and its body type.
- **Result on the held-out editions** (gen1/2.4.2; see §9 for the latest: all 28 laid out, all 28 passing): 17 of 28 Marathi pages laid out; **all 17 pass every check**.
  - **Nothing is lost on any of the 17.** Every word of every story is set, and every part of the page appears:
    - headlines, decks, kickers, bylines, captions, sub-headings, fact boxes, "continued" lines and every photo;
    - text and photos the page model gave to no story. They are joined to the story they were printed with where that is clear (8 items: kickers, a second headline, an intro, photos and a credit). Where it is not clear, they stand as modules of their own (6: an editorial with its body, 3 headlines, 2 sub-headings), which is never wrong but can look odd.
  - **No display text touches anything.** Body lines touch once in all 17 pages, on a page whose printed original has one too. Print has 12 such places on the same pages, by a laxer measure.
  - **No overlaps, nothing outside its space.**
  - **Press-ready:** every page passes the independent PDF/X-1a check.
  - **The lead story** is at the top on all 17 pages and carries the page's biggest headline. 4 pairs of headlines are out of order, and 1 pair is tombstoned.
  - **Story tint panels and fact-box fills** carry over to the new layout.
- **Pageinator's style differs from the paper's:** it often runs the lead wider than print does.
- **What it cannot do yet:**
  - 7 pages with L-shaped or block ads;
  - 2 pages with fixed items inside the news area;
  - 1 page with 18 stories;
  - 1 editorial page with no exact fit.
- **This needed several rounds and four outside checks.**
  - Two earlier claims were too strong (§6): lost text and touching lines, then three wrong story matches.
  - Each fault was fixed, and the checker now tests for it.
- **Not yet judged by people.** Whether an editor would print these pages needs the blind editor review (§9).

## 1. Question
Given a page's stories, the editors' ranking, the page's fixed parts and the paper's learned design language, can Pageinator produce a complete, clean, printable page layout by itself, without the printed plan? How close is it to the house style?

## 2. Inputs
**Stories** (`page1-model/0.2.0`), with all their parts:
- kicker, headline (with any extra parts), decks, byline, body with crossheads, photos, captions;
- jump lines, loose story text (place lines, credits, fact boxes);
- child stories (pull quotes, sidebars), which become stories of their own.

**Loose items:** text, body frames and photos in the news area that the page model gave to no story.
- Examples: an editorial set as a free text frame, a second headline, a box label, a photo beside its story.
- They are grouped by where print had them: an item joins the nearest headline or kicker above it within 30 mm that overlaps it across. Then each group is given to the story it belongs to:
  - a lone headline goes to the story below it that has none;
  - a headline in a story's heading area (above its body) becomes that story's deck;
  - a kicker goes to the story under it;
  - a photo goes to a nearby story without a photo of its own, else to the nearest one (edge to edge, any side);
  - a credit or label printed on a photo goes with that photo's story;
  - a short text (an intro, at most 80 words) inside a story's printed box joins that story;
  - a crosshead goes into a story's flow only if a paragraph of it starts within 15 mm below.
- What finds no story becomes a story of its own: text of 25 words or more becomes body text, shorter text a tag.
- Icons under 25 mm of no story are not placed, but they are listed in the manifest.

**Priority:** printed headline size, ties broken by story order. This is the editors' ranking, not a layout decision.

**Fixed parts:** running head, furniture and ads, set as in the page rebuild at their printed positions.
- Removed with the stories that move: the old layout's rules, boxes, panels, icons and graphics in and around them. Every one is listed with its kind and size in the manifest. A filled box that framed a moved story (its tint panel) or a fact box is carried to the new module as its fill.

**The newshole** (the news area, 8 grid columns wide):
- top: the highest story; bottom: above a full-width band of ads at the foot, else the lowest story;
- small fixed items on its top or bottom edge (under 60 mm tall) move that edge;
- any other fixed item inside it puts the page out of scope.

**Design language** (`results/page1/house_profile.json`): the 8 × 36.5 mm grid, headline size by span, the vertical spacing table and the N → N−1 column-set practice.

**Learned on the calibration editions only:**
- P(span | priority);
- the house body styles (7 size/leading pairs used by at least 10 stories);
- the house word space (median);
- the lead's side.

## 3. Method (`generate.py`)
A **guillotine (slicing-tree) layout search** (after Gange, Marriott & Stuckey 2012): the newshole is cut recursively into rectangles, one story per rectangle.

**1. Modules.** Every story is typeset with the real typesetter in every combination of:
- width w = 1…8 grid columns, set in m = w or w−1 text columns;
- copyfit 100, 98 or 96%;
- each house body style;
- headline at the span table's size, or 0.85× or 0.72× of it (costed; never for the lead).

What each module contains:
- **Display blocks** (jump-in line, kicker, headline, deck, byline, tags). Each block's first baseline sits below the previous block's lowest glyph ink plus its own highest ink plus 0.25 mm, or at the profile's spacing if that is larger. Lines within a block get the same ink clearance. A fact box of 3 or more lines gets the house's 1 pt ruled box.
- **Body:** its first baseline is likewise below the display block's ink.
- **Photo:** spans k of the m text columns, top left, with the body beside and below it on the leading grid. Its aspect may change by up to ×/÷ 1.5 (a costed crop). It is never enlarged below 150 ppi, or below the paper's own printed resolution if that was lower. The caption sits below it; further photos are stacked under it, uncropped.
- **Jump lines:** "continued on" lines go below the body.

Each option is an exact height interval in 0.5 mm units, with up to two leadings of white space at the column feet; more than one is costed.

**2. Pass A, feasibility.** Bottom-up over story subsets: the exact heights each subset can fill at each width. Stacking takes the Minkowski sum of interval sets; side by side takes their intersection.

**3. Pass B, the best layout.** A top-down memoised search for the cheapest tree that fills the newshole exactly. Costs:
- priority order;
- the lead on the house's side;
- headline hierarchy: the lead's headline is the page's largest by 2 pt, and no story's is bigger than a more important one's;
- tombstones;
- −log P(span | priority);
- photo crop, and photo width (narrow photos for the top three stories cost more);
- headline steps, copyfit, body-style rarity and white space.

A node budget (400,000) keeps the search deterministic. On 4 of 17 pages the search reached the budget, and the layout is the best found within it.

**4. Render.**
- The fixed parts first, then the modules: a 0.5 pt rule between stacked modules (no column rules, house practice), centred display text, cropped CMYK photos, and body text through the chosen columns.
- Generated layouts differ from the rebuild in three ways:
  - crossheads are composed at the new column width, get 1.5 leadings above and below, and need room for 2 body lines after them in their column;
  - body size is capped at a leading of 1.25 em of the stand-in font (the rebuild uses 1.20);
  - paragraph indent and word space are the house's, not the story's printed values.
- A single text column deeper than 250 mm costs extra.
- A module whose text overflows after rendering gets one more row, and the page is searched again (2 pages).
- Output: PDF/X-1a:2003, plus a PDF of the fixed parts alone and a manifest.

## 4. Checks (`check_gen.py`, schema 2)
All must hold for a page to pass:
- **Printable:** the independent PDF/X-1a checker, tied to each PDF by its SHA-256.
- **Complete, per story:**
  - every paragraph character for character and in order, none excused;
  - every display part word for word: headline with its parts, deck, kicker, byline, caption, crossheads, tags, jump lines;
  - every photo drawn; no overset; no composer problems.
- **Complete, per page:** every text element of the page outside ads is drawn somewhere (by element id, or as verified body text), and every photo is drawn. Listed icons and decoration are reported separately.
- **Clean:**
  - **ink collisions between text lines, from the real glyph outlines** (`inkcheck.py`: content-stream walk, embedded TrueType outlines, rasterised overlap). Any collision involving display text fails the page. Body–body collisions fail it if they exceed the printed page's own count (PDFium boxes, which miss marks, so the comparison leans against Pageinator). The fixed parts' own collisions (the front-page masthead) are excluded;
  - no overlapping line boxes;
  - no module overlapping another or leaving the newshole;
  - no text outside its module or on a photo;
  - no generated text on ads, photos, graphics, filled boxes or the page's fixed text.
- **House style (reported, not gated):** lead at the top, lead width against print's, headline-hierarchy breaks, tombstones, white space at the module feet.

## 5. Results (held-out editions, Marathi pages, gen1/2.3.1)

| | Pages |
|---|---|
| Attempted | 28 |
| **Laid out by Pageinator** | **17** |
| — passing every check | **17** |
| Out of scope: irregular ad shapes (L-shapes, blocks) | 7 |
| Out of scope: fixed items inside the news area | 2 |
| Out of scope: more than 11 stories (search limit; the page has 15) | 1 |
| No exact fit (an editorial page) | 1 |

**On the 17 laid-out pages:**

| Check | Result |
|---|---|
| Text lost / photos lost, page level | **0 / 0** |
| Loose items joined to their printed story / standing as modules of their own | 8 / 6 |
| Tint panels and fact-box fills carried over | 3 |
| Icons not set (all under 10 mm) | 3 |
| Old-layout items removed, each listed with its size | 112 (60 rules, 38 boxes, 9 vector graphics, 5 icons) |
| Lines that did not fit | 0 |
| Ink collisions involving display text | **0** |
| Ink collisions body–body (the printed originals, PDFium measure) | **1 (12)** |
| Text on photos / overlapping line boxes / modules / text outside its module | 0 / 0 / 0 / 0 |
| PDF/X-1a checker FAILs | 0 |
| Lead story at the top / at least as wide as in print | **17** / 13 |
| Headline-hierarchy breaks (pairs) / tombstones | 4 / 1 |
| Search budget reached (best found, not proven optimal) | 6 pages |

**Reading the tables:**
- **"Pass" is now a strong statement:** every word and photo of the page is accounted for, and collisions are measured from the glyph outlines.
- **One body–body touch remains**, in an editorial, on a page whose printed original has one too. It is the stand-in font's deep and tall vowel signs meeting at the house's leading. Display text never touches.
- **House style:**
  - hierarchy breaks went 34 → 7 → 1 → 4 and tombstones 6 → 1 → 0 → 1 across the versions (the search optimises the page as a whole, so small style measures move when the content of a module changes);
  - Pageinator still tends to run the lead wider than print (the span prior counted on the calibration editions gives 8-column leads a fair share). If the editors want 4–6-column leads, that is one weight.
- **The no-fit page** is an editorial page: the editorial is one 2,900-character block, and the remaining stories cannot fill the rest exactly.

## 6. Verification, and what it changed
**Round 1, code review (agent) of gen1/1.3:** 1 blocker, 2 high, 5 medium and several low findings, all fixed in 1.4–1.8.
- **Blocker:** printed story frames were left on the page and printed twice. The cause was a frame-id prefix mismatch.
- **High:** crossheads were set at the printed measure; story parts (kickers, bylines, captions, child stories, second photos, decks) could disappear unchecked.
- **Medium:** a rounding error added a row; crossheads could widen a column's line limit; the dry run was blind to column breaks (now: retry with one more row); display text had no ink clearance; there were checker gaps.

**My visual review:** led to
- photos narrower than the story, with text beside them;
- house body styles as options;
- the hierarchy and tombstone rules;
- newshole edges moving past small items;
- decoration of moved stories removed;
- Wingdings bullet columns treated as decoration;
- jump lines at the head or foot.

**Round 2, independent verification (agent) of gen1/1.8.0:** my report then said "15 of 15 pass every check". **That was wrong.** The verifier used its own content-stream parser and glyph-outline rasteriser and found:
1. **Silent text loss on 11 of 15 pages.** Text the page model gave to no story was deleted as "old layout": two whole editorials, a grey headline box, a fact box, and loose headlines, kickers and crossheads. My checker compared text per story and could not see it. **Fixed:** loose items become stories (§2), and a page-level gate requires every text element and photo of the page to be drawn.
2. **9 ink collisions on 7 pages**, 7 of them a headline's descending vowel sign touching the first body line at 48.8 pt. My checker used PDFium character boxes, which do not follow combining marks inside ActualText spans. **Fixed:** ink-based spacing between all display blocks and the body; collisions are now measured from the glyph outlines (`inkcheck.py`, which reproduces the verifier's 9 pairs on the old output).
3. **Design weaknesses**, all fixed:
   - lead photos shrunk to 1-column thumbnails (now: photo-width cost for the top three stories);
   - photos enlarged below 150 ppi (now: a floor);
   - hierarchy breaks (now: headline size steps);
   - an orphan crosshead at a column foot (now: keep with 2 lines);
   - the story's printed word space and indent carried over (now: house values).

   Two weaknesses remain: loose word spacing in single 36.5 mm columns (stand-in font, no hyphenation), and shallow wide leads.

   Confirmed sound: photos (68 of 68 drawn, DeviceCMYK, pixel-exact crops, aspect within 0.34%), PDF/X (0 FAIL), byte-identical regeneration, and no printed layout driving the modules.

**Round 3, fresh independent verification (agent) of gen1/2.1.0.** It used its own methods: a pikepdf text walk, its own ToUnicode parser, and each text block rendered alone by PDFium at 1200 dpi for collisions.
- **Confirmed:**
  - text and photos complete, all 158 placed stories in order;
  - 0 display collisions and 1 body–body collision (0.12 mm²);
  - geometry clean (body ink overhang at most 0.67 mm, all from zero-advance marks at line ends);
  - PDF/X 0 FAIL;
  - byte-identical regeneration;
  - no printed geometry driving the layout. Minor inputs taken from print: small-text point sizes, crosshead size and alignment, the paragraph-indent flag, and the photo resolution floor.
- **Press page, re-stamped with the current code:** fit to send.
- **Design defects it found, and what 2.2.0 did:**
  1. 13 of 15 loose items were set as orphan modules (a headline with no body, a photo apart from its story). **Fixed:** loose items join their printed story (§2); 2 remain as stories, both with body text.
  2. Story tint panels and fact-box fills were dropped, and some removals went unreported. **Fixed:** panels and fills carried over (3); every removal listed with its size.
  3. Very deep single columns. **Mitigated:** a cost beyond 250 mm.
  4. The front-page masthead's stand-in lettering overlaps itself. **Not fixed:** this is in the fixed parts (EXP-PAGE-1's placeholder logos).
  5. Gate blind spot: a body frame of no story would vanish unchecked. **Fixed:** the page gate covers body frames, and loose body frames become text.

**Round 4, focused independent verification (agent) of gen1/2.2.0.** It used its own content-stream text extractor, pixel-matched photos, and its own layered PDFium render for collisions.
- **Confirmed:**
  - 612 elements and 105 photos, nothing lost or duplicated;
  - 0 display collisions and 2 body–body collisions;
  - panels correct (right colour, behind their module);
  - PDF/X 0 FAIL.
- **Found:** 3 of 12 attachments were wrong or harmful, so "16/17 pass" overstated the quality:
  1. A photo printed beside its story went to the story above (the rule looked only above and below).
  2. A separate story's headline became another story's deck (the page model had merged the two bodies).
  3. A fact box's heading was inserted into a story's flow about 1,000 characters early and printed over a photo. The checker's text-on-photo gate covered only body text.

  It also found a 40-word intro left far from its story.
- **gen1/2.3 fixes:**
  - photos prefer a nearby story without a photo, edge to edge on any side;
  - credits follow their photo;
  - a deck must sit in the story's heading area;
  - a crosshead needs a paragraph within 15 mm below;
  - intros inside a story's box join it;
  - the text-on-photo gate covers every text role.

  The result is conservative. The 8 remaining attachments are cases round 4 judged correct or acceptable, plus the two it asked for (the intro, and the photo beside its story, checked visually). Where the match is unclear, items stand alone: 3 headlines that print shows as second headlines, and 2 crossheads, including one round 4 had found correctly placed.
- **Remaining design defects it listed (not fixed):**
  - a fact box's list items are set as separate small modules, and its 46% yellow fill is not carried;
  - 6 of 19 sidebars or child stories land more than 30 mm from their parent story;
  - a bullet list is set as one run-on paragraph;
  - small coloured label tabs are dropped;
  - one lead is decided by a 0.7 pt headline difference against print.

**Round 5, focused independent verification (agent) of gen1/2.3.1 attachments.** Method: the printed geometry against the generated placement, side-by-side renders, and two text-over-photo checks.
- **All 8 attachments correct:** the kickers on two reader-notice boxes, a photo and its credit, a deck and an intro, the photo beside its story, and a second headline made a deck.
- **The 3 round-4 errors are fixed.**
- **The 6 stand-alone items are harmless.** The editorial reads correctly. The 5 headlines and crossheads sit at column or page feet with a rule above and nothing below, so none appears to head the wrong text. They are odd, though: each is a crosshead or second headline that print had inside a story, promoted to a display module.
- **Text over photos: none.**
- **Note:** the manifest's `photos_drawn` also lists small images inside ads, which are drawn as part of the ad raster rather than as separate image objects. The photo-loss gate excludes images inside ads, so this overstates the list but hides no loss.

## 7. Limitations
- **No human judgement yet.** "Passes every check" means complete, clean and printable, not "an editor would print it".
- **Guillotine layouts only:** no L-shaped stories, no doglegs, no wraps around irregular ads. Pages with irregular ad shapes are out of scope.
- **Fixed parts stay where print had them.** A page with a fixed item inside the news area is out of scope.
- **At most 11 stories per page.** Fronts with 12 or more need a two-level search (zones first).
- **Loose items are grouped by printed proximity, and loose long text is one paragraph:** the page model has no paragraph breaks for free text frames.
- **Ranking by printed headline size** stands in for the editors' ranking. In production the editors supply it (or approve AI importance scores).
- **Jump lines:** direction is judged by printed position, not by reading the line.
- **Stand-in fonts:** heights are measured with OFL stand-ins, with wider crosshead spacing and a 1.25 em leading floor to clear their taller vowel signs. The house fonts (owner) will change heights slightly.
- **Masthead and logos are placeholders** in the fixed parts, as in EXP-PAGE-1. The front-page masthead lettering overlaps itself.
- **The old layout's rules, boxes, graphics and small icons around moved stories are removed** (listed with sizes). Only tint panels and fact-box fills are carried over.
- **Loose items are joined to stories by printed proximity.** That is a heuristic. It is kept conservative, so uncertain items stand alone (6 modules), and fact boxes broken up by the page model stay broken up.
- **Sidebars and child stories are placed as independent modules**, not next to their parent story.

## 8. Architecture impact
- **Confirms the generation design** (`docs/architecture/v2/07_GENERATION_ENGINE.md`):
  - candidates are measured by the real composition engine;
  - hard constraints are checked, soft constraints are costed;
  - the search is deterministic.
- **Cost:** the interval search with typesetting of every option takes about 1–5 min per page in Python.
- **The verification lesson is architectural:**
  - the page-level accounting gate ("everything on the page is somewhere") must be part of the engine's own invariants;
  - collision checks must use glyph outlines, never character boxes, for Devanagari.
- **Production needs:**
  - non-guillotine shapes;
  - zones for big fronts;
  - a jump-line model with direction;
  - paragraph structure for free text;
  - top-k alternatives;
  - per-page style weights set by the editors.

## 9. Editor review, round 1 (2026-10-18)
**Setup:**
- A blind side-by-side review in an offline kit (`gen1/review_kit.py`).
- 17 real pairs: Pageinator's layout against the printed layout rebuilt in the same stand-in fonts, so the type gives nothing away.
- Sides balanced and order shuffled; 3 check pairs where both sides are of one kind.
- Answers in Marathi and English.
- One reviewer: the owner and editor, who made most of these pages.

| His choice on the 17 real pairs | Pairs |
|---|---|
| Pageinator's page | 4 |
| The printed layout | 4 |
| "Both are fine" | 9 |

- **Pageinator's page was as good or better in 13 of 17 pairs (76%).**
- Check pairs: "neither", one pick and "both fine". These do not suggest he was recognising his own pages.

**His notes:**
- **Headlines (4 notes; 3 on Pageinator's pages, 1 on the rebuilt print):** justify the headline so that the space left on both sides is filled.
- **White space (1 note):** no open space after a story ends; adjust the font size.
- **Masthead (2 notes):** the masthead is wrong (the known placeholder).
- **Wording (1 note):** an editorial rewording of one headline.

His summary, through the owner's family: the placement of images, text and stories is fine; the remaining fault is headlines not justified.

**gen1/2.4.0, headlines filled to the measure:**
1. Headlines break into lines of even length (the house policy at the planned size, then balanced at the same line count).
2. The size grows (up to 1.25×) while the line count holds.
3. Each line is re-shaped:
   - the width axis widened as far as it fits;
   - letters stretched horizontally up to 18% (a new `hscale` on PDF text runs);
   - a short line set up to 20% larger;
   - the rest spread over word spaces (at most 0.5 em each).

   No letter-spacing is used, because it would break the Devanagari top line.
4. The PDF writer change is backward-compatible: the press page rebuilt with the new code is pixel-identical above its slug.
5. **gen1/2.4.2:**
   - Only the lead's headline grows as a whole. In 2.4.0 every headline grew, and a minor story could shout louder than the lead.
   - Other headlines fill their lines through the width axis, the stretch, word space, and at most 8% per-line growth.
   - A crosshead fix: it is anchored on a column that holds text, not one a photo fills. On two pages a crosshead had been drawn over its own story's photo.

   **Result on the held-out pages:**
   - all 17 pass every check;
   - 0 display collisions and 1 body–body collision;
   - the lead at the top on 16 pages;
   - the lead's headline the page's largest (42–61 pt, others 14–37 pt).

   The hierarchy measure counts 35 pairs, but these are first-line differences of 1–3 pt between stories of equal width, caused by the per-line growth.
6. **Round 2 of the review** (`review2`, new shuffle) is built from 2.4.2 for the same reviewer.
7. **gen1/2.5.0, no empty space after a story ends** (the reviewer's other note):
   - Every empty line left at the foot of a story's last column costs 0.4 in the search.
   - Body text may be set up to 4% larger as well as up to 4% smaller.
   - **Result:** empty lines at column feet fall from 57 to 25 on the 17 pages. All 17 pages still pass every check, and the lead is at the top on all 17.

**Overnight, 2026-10-19/20 (gen1/2.5–2.8.2, page1-compose/2.7.1):**

| Change | Effect |
|---|---|
| Level column ends (cost per empty line at a story's last column foot; body size 104–96%) | Empty lines at column feet 57 → 25 (17 pages), 20 on 24 pages |
| Printed-layout side: headline lines and free-text lines that print filled are filled/justified to their printed extent | Rebuild unchanged at 29/60 pages passing; the press page passes |
| Fact boxes: a filled box with two or more small stories becomes one boxed story with its title and fill | Items stay together inside the yellow box |
| Pull quotes: a child story of ≤ 60 words is folded into its parent as a ruled box (its own words only) | Quotes stay with their story |
| Sidebars: separating a child story from its parent costs extra (within and across regions) | Sidebars land near their story |
| Label tabs: a filled panel behind a kicker is carried with the kicker's printed colour | e.g. white text on a black notice bar |
| Ad blocks: the newshole becomes rectangles around one ad block; stories are assigned to regions | 6 pages that were out of scope now lay out |
| Busy fronts: briefs in one column are stacked into a news-in-brief module | The 15-story front now lays out |

**Code review (agent)** found 1 critical and 4 required issues, all fixed before the final run:
- the pull-quote fold copied whole shared frames, which would print a parent's text twice;
- item headlines in merged modules kept their printed position;
- kicker panel width and white-text fallback;
- an intruder check after stacking briefs;
- budget hits reported as infeasible.

**Results, gen1/2.8.2 (held-out, 28 Marathi pages):**
- **Laid out: 24.** 23 pass every check; 1 fails on one body–body touch (its print has none).
- **Not laid out: 4.**
  - skipped: 3, where fixed items sit inside the news area (a full-height text rail; leftover items);
  - no exact fit: 1, the editorial page.
- **On the 24:**
  - 0 text or photos lost;
  - 0 display-text collisions, 3 body–body (print: 14 by the laxer measure);
  - 0 overlaps; PDF/X 0 FAIL;
  - lead at the top on 23;
  - empty lines at column feet 20.
- **Review kit round 3** (`review3`, 24 real + 3 check pairs, sides balanced) is built for the same reviewer, offline only.

**Independent verification (agent) of gen1/2.8.2, then gen1/2.8.4.** The verifier used its own text extraction, outline-box collision check, pixel-matched photos, and renders beside print.
- **Confirmed:**
  - no text printed twice through pull quotes or merged boxes;
  - 0 display collisions and 3 body–body collisions;
  - nothing crosses an ad block;
  - PDF/X 0 FAIL on 24 pages;
  - 98% of column segments end with at most one empty line.
- **Found, and fixed in 2.8.3–2.8.4:**
  - Run-in datelines and run-in jump lines (text that is already part of a paragraph) were set again as separate lines by loose-item handling and brief stacks. They are no longer set on their own.
  - Text on the coloured bars touching an ad block was attached to unrelated stories. The bars now belong to the ad.
  - A new `duplicate_text` gate fails a page whose drawn characters exceed what its stories hold (characters, because body text may break a compound after its hyphen).
- **Found, not fixed (recorded):**
  - On one front, a brief carries the wrong headline: the page model's story grouping, carried through.
  - On one inside page, a printed story is split in two (page model).
  - Two "in brief" label tabs print black, where print has white on red (their panel is not detected).
  - Two lines of a dateline box are not set on three fronts.
  - Two 8 mm icons are neither set nor listed.
  - Glyph ink runs up to 1.25 mm past a region edge in four places.
  - The masthead and bottom logos, rebuilt from text, overlap (placeholders until the house fonts arrive).

**Final, gen1/2.8.4 (held-out, 28 Marathi pages):**
- **24 laid out, 23 pass every check.** The 24th has one body–body touch; its print has none.
- **Text:** complete on all 24 pages, 0 duplicate characters, 0 text or photos lost.
- **Collisions:** 0 involving display text.
- **Columns:** 12 empty lines at column feet (57 at the start of the night).
- **Layout:** the lead is at the top on 23 pages.

**The last four pages (gen1/2.9.x, 2026-10-21):**
- **The editorial page (no exact fit before).** Print set the long lead story with tighter leading (12.5/12) than any common house style. The house's rarer body styles (used at least twice on the calibration editions, leading at most 1.3 × size) are now a fallback when a page has no exact fit with the common ones.
- **An editorial rail reaching a few mm past the newshole.** A loose item at least 80% inside the newshole is laid out with it.
- **A small boxed list split into five loose modules.** Loose pieces of one column within 6 mm of each other, with no heading between, are one item.
- **A one-line frame in the newshole's top band.** An item ending within 15 mm of the top moves the top edge.
- **A promo strip under an ad block (13 loose pieces).** The ad block grows over fixed artwork touching it (furniture text, boxes, graphics, rules, coloured bars). Its first version also swallowed the fronts' boxed rail of briefs, keeping them as printed; it now never takes in a panel that holds story text.
- **"In brief" label tabs.** A label carried as loose text keeps its printed panel and colour (white on red).

**Alternatives for the editor (`alternatives.py`).** Three complete, checked layouts of a page:
- A, the best;
- B, the lead on the other side;
- C, the lead at another width (new generator option `--ban-lead-width`).

**Final, gen1/2.9.6 (held-out, 28 Marathi pages):**
- **28 laid out, 28 pass every check.**
- **Text and photos:** 0 text or photos lost, 0 duplicate characters.
- **Collisions:** 0 display-text collisions; 2 body–body (print 47 by the laxer PDFium measure).
- **Layout:** the lead is at the top on 28 pages; 25 empty lines at column feet.
- **Press:** PDF/X-1a 0 FAIL.

**Closing the test stage (gen1/2.10.0, page model 0.3.0, 2026-10-19):**
- **Page model 0.3.0** fixes the two story-grouping errors recorded above:
  - the front's brief now carries its own headline;
  - the inside page's story is no longer split.
  
  It changes the grouping on 5 of 68 pages, each confirmed by the independent verifier against the printed text (EXP-PAGE-1 §7 item 12).
- **The dateline-box lines are now set** on every front. The fixed-artwork ad growth (2.9.5–2.9.6) took them in; all 7 fronts report nothing unset.
- **Body lines that touch, caught by the generator itself.** After the page model changed, one page had two body lines of one story touching in ink (a deep conjunct over a tall vowel sign), where print had none. The generator now runs the outline-based ink check (`inkcheck.py`) on its draft page. A story whose own body lines touch is set again with another of its options; the last complete layout is kept if none is left. It retried on 3 pages.
  - After the verifier's review, a complete layout is never traded for an overflowing one, and a layout shipped with a touch is flagged (`ink_touch_kept`).
  - A touch between two different stories is not retried; the gate still catches it.
- **The verifier found text lost that no gate saw.** The front-page weather box, a small story the generator keeps where print had it, lost its last row (the temperatures) on 4 fronts. The generator had dropped the reports of the stories it keeps.
  - Now those reports are kept (`fixed_stories_out`), and the overset and character-integrity gates cover them.
  - Short table-like boxes are set line by line as printed (EXP-PAGE-1 §7 item 14).
- **The paper's own masthead artwork** replaces the stand-in lettering on the fronts (EXP-PAGE-1 §7 item 15). It is supplied by the owner and is private.

**Final, gen1/2.10.0 (held-out, 28 Marathi pages):**
- **28 laid out, 28 pass every check.**
- **Text and photos:** 0 text or photos lost, 0 duplicate characters.
- **Collisions:** 0 display-text and **0 body–body** (print: 47 by the laxer PDFium measure).
- **Layout:** the lead is at the top on 28 pages; 24 empty lines at column feet.

## 10. Next steps
1. **Editors:** a blind review of generated vs printed pages, side by side and unlabelled: "which would you print?" and "what would you change?". Sheets come from `report/gen1/check/*.side.png` (private).
2. **Engineering:**
   - L-shaped modules around ad blocks (covers the 7 out-of-scope pages);
   - zones for big fronts;
   - top-k alternatives;
   - the editors' preference on lead width as a weight.
