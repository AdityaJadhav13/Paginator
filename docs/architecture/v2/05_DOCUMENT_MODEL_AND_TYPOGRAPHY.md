# 05 — Document Model and Typography

> **Second-pass review, 2026-10-07.** The principles (Editable → Resolved, determinism, explicit font stacks, script plan) are accepted.

The following are **hypotheses**, decided by EXP-ENGINE:
- the TS/WASM composition pipeline;
- the client/server parity mechanism (§9);
- the browser compose worker.

The composition policy is to be **proven** (TYPO).

The TrueType-only MVP must be proven with the press. The font licensing in §7 is replaced by `19` §1. Status vocabulary: ADR-021. Baseline: `20`.


**Status: DECIDED.** Two exceptions are marked TENTATIVE and RESEARCH where they appear.

**What this document covers:** the heart of the product, which is the rule "What the editor sees must match the PDF."

## 1. The three representations

```
EditableDocument (intent)  ──resolve(engine vN, fonts, profile)──►  ResolvedDocument (physics)  ──►  Canvas preview
        ▲  commands                                                        │                       ──►  PDF/X
        │                                                                  │                       ──►  E-paper
   Editor / Generator / AI suggestions (accepted)                          └──────────────────────►  Preflight
```

- **Never** compute geometry outside `resolve`. The renderer, PDF writer and preflight receive positions; they do not measure (D03, RJ01).
- `resolve` is a **pure function**. It takes:
  - the EditableDocument revision;
  - the story revisions it references;
  - font binaries, identified by hash;
  - the profile version;
  - the engine version.

  Same inputs → byte-identical output → same content address.

## 2. Units and numbers

- **Internal unit: integer micro-points.** 1 pt = 1,000 µpt, so 1 mm = 2,834.6457 µpt (rounded at input).
  - A broadsheet page (≈ 1,580 pt) is about 1.6 × 10⁶ µpt. That is far inside the safe-integer range.
  - Glyph advances: HarfBuzz runs at upem scale (as B does). Advances are converted with `round(adv * size_µpt / upem)` using integer multiplication and division, **per glyph, once, then accumulated as integers**. This is the fix for B's recorded "+0.822 mm" drift.
  - This resolves RD05. TENTATIVE until the Phase-0 parity run confirms no rounding artefacts in justified Devanagari.
- **Determinism rules** for `packages/compose` and `packages/layout-gen`, enforced by lint:
  - no `Math.pow/exp/log/sin/cos`, no `**` (cubes are written as `r*r*r`);
  - no `Intl.*`, no `String.prototype.normalize`, no `localeCompare`;
  - no `Date.now`, no `Math.random` (seeded PRNG only);
  - no iteration over `Map`/`Set` without sorted keys;
  - `+ - * /` and `Math.sqrt/floor/round/min/max` only (IEEE-exact on all engines);
  - WASM: no relaxed-SIMD builds.

## 3. EditableDocument (schema owned by `packages/document`)

```ts
EditableDocument {
  schemaVersion; editionId; profileVersionId;
  pages: Page[]                       // page_no order; shared pages carry sourceEditionId for zones
  stories: StoryRef[]                 // storyId + pinnedRevisionId (text lives in StoryRevision)
  threads: Thread[]                   // story flow: ordered frame IDs (linked frames, jumps)
  packages: Package[]                 // headline+deck+byline+body+photo(+sidebar): the layout unit
  styleOverrides; locks; guides; layers
}
Page { id; no; templateId; colour: 'cmyk'|'mono'; regions; frames: Frame[]; adPlacements: AdRef[]; locked? }
Frame (discriminated):
  TextFrame   { id; rect; columns; gutter; insets; threadId; threadIndex; verticalAlign; role: 'body'|'headline'|'deck'|'byline'|'caption'|'jumpline'|'rail' }
  ImageFrame  { id; rect; assetRevisionId; fit: 'fill'|'fit'|'manual'; crop: {x,y,scale}; focalPoint; captionFrameId? }
  AdFrame     { id; rect; bookingId; artworkId; locked: true by default }
  ShapeFrame  { id; rect|path; stroke; fill; role: 'rule'|'box'|'tint' }
  common: { z; rotation (0/90/180/270 only in P1); lockedBy?: 'user'|'generator'; packageId?; generatorHint? }
```

**Why packages are the layout unit.** The design grammar (§1.3) shows this: moving a headline without its deck and body is never correct. Generation places packages; the editor offers both "select package" and "select frame".

**Commands** (single bus; the one undo/redo stack):
- Every edit is a `Command {opId, type, baseRev, payload}`. Example types: `MoveFrames`, `ResizeFrame`, `SetFrameProps`, `CreateFrame`, `DeleteFrames`, `LinkFrames`, `PlaceStory`, `ReplaceImage`, `SetCrop`, `ApplyStyle`, `LockObjects`, `EditStoryText(storyId, prosemirrorSteps)`, and `ApplyGeneration(jobId, pages)`.
- Each command has an `invert(doc)` that produces its undo.
- Consecutive same-target drags coalesce within 500 ms. This is the idea from A's `CommandStack`.
- The server rejects a command whose base revision conflicts on the same objects (`409`), and the client rebases. MVP rule: page-level soft locks (`06` §5) make conflicts rare.
- Story text edits produce a **new StoryRevision** at each autosave checkpoint, not one per keystroke. The pinned revision is updated through `PlaceStory`.

## 4. ResolvedDocument (display list)

```ts
ResolvedDocument { address; engine: {compose, harfbuzz, icu4x}; fonts: FontRef[] /* sha256 */; pages: ResolvedPage[] }
ResolvedPage { pageId; trim; bleed; hash; items: Item[] /* painter's order */; overset: OversetReport[]; anchors }
Item =
  | GlyphRun { font: idx; size_µpt; fill: Color; overprint; origin: {x,y}; glyphs: Uint32[]; positions: Int32[] /* x,y pairs */;
               clusters: Uint32[]; source: {storyId, rev, textRange}; lineIndex; frameId }
  | Image    { assetRev; renditionForPrint; transform; clip: Rect|Path; effectiveDpi; frameId }
  | Path     { d: Int32 commands; stroke; fill; dash; frameId }
  | AdXObject{ artworkId; normalizedAssetRev; transform; clip }
Color = { cmyk:[c,m,y,k] /* 0–10000 */ } | { gray } | { spot: name, tint }   // screen preview colour derived once from the profile
```

- Text positions are absolute in page space. The PDF writer converts y-down to y-up in **exactly one function**, as B's spec warns.
- `clusters` and `source` map glyphs back to text. This drives the caret and selection in the editor, links preflight issues to stories, and supports search highlighting.
- Serialisation: compact binary (MessagePack + zstd) per page, cached at `s3://…/resolved/<address>/<page>.bin`. Pages invalidate independently. A story that flows across pages invalidates every page in its thread.

## 5. Composition pipeline (`packages/compose`)

```
StoryRevision text (NFC, normalised at ingest)
 → itemize: script runs (UAX#24 + bracket stack, ported from B), bidi runs (ICU4X UAX#9), style runs
 → shape: harfbuzzjs per (font, size, features, script, language) run; cache key = hash(text, run attrs)
 → segment: ICU4X line-break opportunities (UAX#14), grapheme clusters (UAX#29)
 → build items: box/glue/penalty (B's schemas), hyphenation points (English, P2), emergency-stretch glue
 → break: Knuth–Plass (ported from B) with per-line measures (columns, wraps around images) → greedy fallback counted
 → justify: word-space distribution within [min, max], then tracking within ±5/1000 em, then emergency stretch
 → frame flow: lines placed on the baseline grid; column → column → next frame in thread; overset recorded
 → output: GlyphRuns + line metrics (ascent/descent ink and leading) + overset report
```

**Performance design: shape once, break many times.**
- Shaping results are cached per word-run and are independent of measure.
- Copyfit and generation then call only `break` + `flow` at different widths and sizes, which is cheap.
- A size change reshapes only when the font has optical sizes or hinting effects. Our fonts are unhinted outlines, so a size change is a linear scale of upem advances.

**Target throughput** (worker, mid-range laptop):
- 1 story (600 words) composed in < 15 ms;
- a full 16-page edition resolved in < 3 s;
- copyfit search: < 2 ms per trial break.

## 6. Line breaking and justification policy

- Knuth–Plass is ported from B with fixes:
  - enforce `word_space_max`;
  - support ragged-right (`style.align`);
  - make the hyphen penalty configurable;
  - add emergency stretch as a second pass, as in TeX's `\emergencystretch`.
- Measured basis (B `PROGRESS.md`): K-P alone is feasible for 0/62 English paragraphs at a 30.25 mm column; adding 8 mm of emergency stretch makes 59/62 feasible.
- Default policy, set per StyleSheet:
  - **English body:** justified; K-P with tolerance 200; emergency stretch 8 mm-equivalent; hyphenation from P2 (Liang patterns, `en-GB`/`en-US`); minimum word length 6; at most 2 consecutive hyphens.
  - **Marathi/Hindi body:** justified; K-P; emergency stretch; **no hyphenation by default**, because it is uncommon in Indian-language press. Break opportunities only at spaces and ICU4X opportunities, never inside a cluster.
  - **Headlines:** not justified; balanced breaking (minimise variance of line lengths); no hyphenation.
- Widow and orphan control: a paragraph's first and last line may not be alone at a column or frame break (configurable). This is enforced in frame flow by pulling or pushing lines.
- Baseline grid: body lines snap to the grid. Headlines and decks may break the grid and then re-align the next body line. Preflight `TXT009` (ink collision) remains a check, as B specified.

## 7. Fonts

- **Fonts are content-addressed** (`FontAsset.sha256`), and editions pin a font manifest. A vendor update to a font creates a new hash and does not affect archived editions.
- Instancing of variable fonts uses hb-subset `pin_axis_location`, as B does with fontTools instancing. The instance bytes are hashed, and **the same instance bytes** feed shaping, rendering and PDF embedding.
- Metrics:
  - B's dual metrics are kept: line metrics from `OS/2 typo` or `hhea`; ink metrics from `max(head.yMax, usWinAscent)`.
  - Per-glyph ink extents are cached for the `TXT009` check.
- Missing glyphs: `MissingGlyphError`. Missing glyphs are never rendered as `.notdef`, and there is no silent fallback (C's typography research).
- Fallback fonts exist only as **explicit font stacks per style**, for example a Latin font for digits and punctuation inside a Devanagari style. They are recorded in the resolved document.
- **MVP format restriction (PROVE, 2026-10-07):** TrueType-outline (glyf) fonts only, subject to the press confirming that TrueType/CIDFontType2 is accepted (`17` F2). Typical ad specifications forbid TrueType. The reason is the PDF/X-1a + CFF problem: hb-subset does not produce CID-keyed CFF. CFF support comes later, through a fontTools conversion job in the worker.
- Browser delivery: the compose worker needs the font **binary** for shaping. That binary is delivered only when the font's licence permits web or server use (`FontAsset.licence`). Otherwise the editor uses a server-resolve-only mode for that style: geometry comes from the server, and the browser draws glyph outlines streamed from a server-side outline cache. This is slower but still exact.

## 8. Scripts and languages

| Script | Plan | Notes |
|---|---|---|
| Latin (English) | P0 | Hyphenation P2 |
| Devanagari (Marathi, Hindi) | **P0**, as the pilot script | Language tag `mr`/`hi` is **required** (it changes glyph choice, e.g. श). Reph and matra reordering are handled by HarfBuzz. Caret movement by grapheme cluster (ICU4X). Devanagari vs Latin digits are a publication setting (`digit_style`). Conjunct-aware ink metrics are measured in P0 |
| Mixed Latin + Devanagari | P0 | Itemisation by script and explicit font stacks |
| Legacy encodings (Shree-Lipi, Akruti, ISM) | P1 (converter) | Incoming copy is converted to Unicode at import, using a mapping table per legacy font family. The original is kept in provenance. **Confirm in pilot fact-finding** |
| Urdu (Nastaliq) | **P5, separate track** | RTL paragraph direction, mirrored column order (the model already has `direction` on Page/Frame from P1), tall line metrics, justification by kashida/stretched forms instead of word spacing. Needs a Nastaliq-specialist reviewer. InPage is the market incumbent |
| Gujarati, Bengali, Tamil, … | Later | Same pipeline; font corpus and native-reader sign-off per script (RD02) |

## 9. Browser ↔ server parity mechanism

1. The same package version and the same `.wasm` artefacts (harfbuzzjs version pinned; ICU4X custom data blob pinned) are used in both places. The engine version is a single string baked into both builds.
2. The client resolves locally for interactivity. The server resolves authoritatively when commands are committed.
3. Each resolved page carries a `hash`. The server returns its page hashes with the commit acknowledgement. On a mismatch, the client replaces its pages with the server's, logs `parity_mismatch` telemetry (with page, story and engine version), and continues.
4. If the client's engine version ≠ the server's, the document opens read-only with a "reload to update" banner. A document resolved by one engine version is never mixed with another.
5. CI parity test: the golden edition corpus is resolved in Node and in headless Chromium (via Playwright), and the hashes are asserted equal. PDF output is rasterised with pdfium and canvas output with Chromium; the two are compared with an SSIM threshold (`12`).
6. "Exact match" is defined as identical glyph IDs, positions, transforms and crops. Pixel-level anti-aliasing differences between canvas and RIP are expected and are not defects.
