# EXP-ENG-1: English pages, hyphenated like print (EXPERIMENTAL / EVIDENCE ONLY)

**Status:** COMPLETE (experiment), 2026-10-19. `page1-compose/2.8.0`.

**Result:** on the pilot's 8 English (flip) pages, story depth within the G1 A7 tolerance rises from **36.6% to 61.0%** of stories. Characters in order stay at 100%, now also checked word by word. Lines that do not fit fall from 291 to 162. One English page now passes every gate; none did before. Marathi typesetting is unchanged.

## 1. Question

The pilot prints its English flip pages hyphenated. The Marathi body policy never breaks words, and on the English pages it reached only 36.6% depth (`EXP_PAGE_1_REPORT.md`). How close does Pageinator get when English stories break words the way print does?

## 2. What print does (measured on the page models)

These are the 8 pages whose story text is mostly Latin: 41 stories and 4,476 body lines, set in Times, justified.

- **Line-end breaks:** 783 of 4,476 lines (17.5%) end in a hyphen that breaks a word. 656 joined words were confirmed as real words; only 2 breaks are a compound's own hyphen.
- **Fragments:** the shortest are 2 letters before and 2 after the break.
- **Runs of broken lines:** 1 line 560 times, 2 lines 81 times, 3 lines 19 times, 4 lines once.
- **Pattern coverage:** the repo's `hyph-en-us` patterns (Liang, all-permissive licence, already in `compose1/third_party/`) allow 86% of print's breaks at minima (2, 2), and 81% at the file's published minima (2, 3).

## 3. Method (the compound rule, the 25 mm runaround minimum and the word-by-word check were added after the independent verification)

- **Which stories:** a story is English when its text has more Latin letters than Devanagari (`textfix.latin_text`). Marathi stories keep the never-break policy, so Marathi output is unchanged.
- **Input text:** the page model joins printed lines as "re- port". `textfix.dehyphenate` makes such a word whole again. A word stays a compound ("post-retirement") when print never sets it as one word and either sets the compound inside a line elsewhere or sets both parts as words, the first of at least 3 letters (`english_vocab`). It also stays a compound when the next part starts with a capital ("Indo-Japan").
- **Runaround:** English lines beside a photo or box need at least 25 mm, against 15 mm for Marathi; a narrower line moves below the obstacle. English words did not fit 15 mm slivers and were broken there without a hyphen.
- **Policy:** EXP-COMPOSE-3's composer with `inword="rules"` (hyph-en-us):
  - minima (2, 2), for the pattern file as well (new optional `Policy.pattern_min`, default unchanged);
  - at most 3 consecutive broken lines;
  - a hyphenated compound may also break after its own hyphen, with no hyphen added (new optional `Policy.compound_breaks`, default off);
  - the composer draws the hyphen glyph (it already did).
- **Integrity:** `compare_page` joins a word our composer broke (lines carry `"hy": true`) and drops our hyphen. It compares characters in order as before, and for English stories also word by word, so a word split without a hyphen fails.
- **Gates:** the same as EXP-PAGE-1.

**Hyphen penalty**, swept on the same 8 pages (there are no held-out English pages, so this choice is tuned):

| Penalty | Lines broken | Stories within depth | Lines that do not fit |
|---|---|---|---|
| 30 (composer default) | 32.5% | 58.5% | 166 |
| 100 | 31.2% | 58.5% | 166 |
| **300 (chosen)** | 28.0% | 58.5% | 169 |
| 1000 | 20.7% | 51.2% | 189 |
| 3000 | 12.0% | 41.5% | 222 |

We break more lines than print (28% vs 17.5%). The free stand-in serif is wider than Times, so lines hold fewer letters and need more breaks to reach print's depth. Raising the penalty to print's rate costs depth. With the house font this should come closer.

## 4. Results (8 English pages, `page1-compose/2.8.0`)

| | Before (never break) | After (hyphenated) |
|---|---|---|
| Stories within depth tolerance | 36.6% | **61.0%** |
| Characters in order | 100% | 100% (also word by word) |
| Lines that do not fit | 291 | 162 |
| Paragraphs with print's exact line breaks | 24.2% | 18.4% |
| Pages passing every gate | 0 | 1 |
| Checker FAIL pages | 0 | 0 |

- **Marathi (60 pages):** 29 pass every gate, as before. The press page still passes.
- **Exact breaks** dropped. Print and we now break inside words at different places, which affects whole paragraphs.

**Line ends on English stories:** 1,192 lines end in a hyphenated break, 44 at a token point (a URL, initials or a compound's own hyphen), and 7 at an emergency point with no hyphen:
- 4 are in a 10.6 mm column that print itself sets beside a photo;
- 1 is in a 4 mm sliver that print also has;
- 2 are at words glued to a quote mark in the source text ("comprehensive“blueprint").

The sweep table above was measured before the compound breaks, the 25 mm minimum and the compound rule were added; the chosen penalty was not re-tuned.

## 5. Limits

- **Tuned, not held out:** all 8 English pages are calibration-edition pages, and the penalty was chosen on them.
- **Stand-in font:** this is the main gap to print. The owner will supply the house fonts.
- **English page models are weaker** than Marathi ones: their story grouping has more errors (EXP-PAGE-1 §7). This report measures typesetting on the stories as modelled.
- **No editor review** of English pages has been done.
