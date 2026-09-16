# Typography and multilingual research — Phase 5

Research date: 2026-09-15; targeted reuse correction 2026-09-16 (AR08). Depends on Phase 3's resolved-geometry contract. Recommendation: WRAP proven shaping/font/Unicode and qualified paragraph primitives; BUILD newspaper column, copyfit and continuation policy. Ownership of policy does not mandate a custom general paragraph algorithm. No evidence gathered here certifies an entire multilingual typesetter.

## Responsibilities and algorithm

Preserve source Unicode text. Compute script, language, bidi levels and legal boundary candidates using pinned data. Select a licensed font instance covering a shaping cluster, rather than falling back per code point and breaking conjuncts. Shape runs with explicit direction, script, language, features and variation axes. Evaluate line candidates, reshape at chosen breaks where required, justify under language policy, compose columns and linked frames, then store glyph geometry and source mappings.

UAX #9 defines bidirectional ordering; UAX #14 defines line-break opportunities rather than selecting the best newspaper line. Grapheme clusters, shaping clusters and glyphs are not interchangeable. Caret movement and deletion must respect those distinctions. [Unicode bidi](https://www.unicode.org/reports/tr9/), [Unicode line breaking](https://www.unicode.org/reports/tr14/), [ICU boundary analysis](https://unicode-org.github.io/icu/userguide/boundaryanalysis/).

## Candidate evaluation

| Candidate | License / commercial position | Runtime / determinism / limitations | Recommendation |
|---|---|---|---|
| HarfBuzz | Old MIT core, notices; optional components reviewed separately | Mature C/C++ shaping, explicit glyph output; native and WASM routes. Pin font funcs, features and build. Shaping alone does not choose newspaper line/column layout. | WRAP TextShaper; evaluate subset component alongside writer |
| FreeType | FTL or GPLv2 alternatives; select/document FTL route and notices | Native font parsing/metrics/rasterization; WASM possible with build audit. Hinting/pixel metrics should not make physical geometry device-dependent. | WRAP FontAccess/Rasterizer if renderer does not already provide required capability |
| ICU | Unicode license and applicable third-party notices | ICU4C server and potential WASM; full data adds size. Provides Unicode/bidi/segmentation facilities, not editorial judgment. Pin code and data together. | WRAP UnicodeServices; investigate smaller data build only after correctness |
| libhyphen | GPL/LGPL/MPL alternatives; bundled pattern notices differ | Native C, WASM possible but compliance and dictionaries need review. Hyphenation opportunity quality depends on specific language data. | RESEARCH then WRAP where approved dictionaries exist |
| Hunspell | Upstream advertises GPL/LGPL/MPL alternatives; inspect exact files/version | Native spellchecker; dictionary licences and quality independent of library. Browser port possible with maintenance/compliance cost. | WRAP optional editorial spellcheck, never a publishing-validity authority |
| Browser text engines | Browser/platform distribution; fonts still separately licensed | Excellent input/IME integration but engine versions and fallback vary; cannot promise server parity through CSS alone | ADOPT input facilities; REJECT as independent final composer |
| harfbuzzjs | MIT wrapper plus HarfBuzz notices/dependencies | Existing JS/WASM binding reduces bespoke glue; test buffer ownership/API coverage/version lag | RESEARCH, prefer maintained binding if parity and needed APIs pass |

Sources: [HarfBuzz project](https://github.com/harfbuzz/harfbuzz), [HarfBuzz license](https://raw.githubusercontent.com/harfbuzz/harfbuzz/main/COPYING), [FreeType licensing](https://freetype.org/license.html), [Unicode license](https://www.unicode.org/license.txt), [libhyphen license and pattern exception](https://raw.githubusercontent.com/hunspell/hyphen/master/COPYING), [Hunspell project](https://github.com/hunspell/hunspell), [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs).

These are established projects with public source/docs; maintained availability is not a vulnerability clearance. Native parsers must be patched, isolated and fuzzed; downloaded browser fonts/WASM are distributed artifacts with notice obligations. Transitive font codecs, dictionary data and bindings must appear in the eventual SBOM. No dependency lock or complete license audit was performed in this documentation-only program.

## Language-specific acceptance

| Language/script | Necessary corpus | Specific risk / policy |
|---|---|---|
| English | Narrow justified columns, punctuation, numerals, abbreviations, names, long URLs | Hyphenation exceptions and rag/river quality; no unbounded tracking |
| Hindi/Devanagari | Conjuncts, reph, matras, nukta, ZWJ/ZWNJ, mixed Latin numbers | No split of prohibited clusters; font-specific substitution/mark positioning; script support is not Hindi dictionary quality |
| Marathi/Devanagari | Marathi-specific forms, local names, editorial samples, mixed English | Shared script does not imply identical language rules, hyphenation or editorial conventions |
| Urdu | RTL paragraphs, Nastaliq fonts, diacritics, mixed Latin/Arabic numerals and brackets | Sloping/overhanging forms and large vertical extents; bidi cursor/selection, line collision and justification require native-reader review |
| Mixed | Script switches, captions, currency, phone numbers, URLs, quoted names | Logical reading order must survive visual reorder, PDF extraction and editing |

Do not justify Urdu by arbitrary letter spacing or indiscriminate kashida insertion. Start with an explicitly approved policy and font; defer advanced justification until a qualified language reviewer approves representative pages. Hyphenation may be disabled by language/profile where appropriate, with layout consequences visible. Support promises apply to a tested font/language matrix, not every font available online.

## Font asset contract

Font record stores binary hash, family/version, face/index, axes, permitted browser use, server use, embedding/subsetting and archival rights. Technical embedding flags are one check, not a replacement for the font license. Restriction bits, including subsetting/embedding limitations, need inspection ([OpenType OS/2 specification](https://learn.microsoft.com/en-us/typography/opentype/spec/os2)). Unsupported or unavailable fonts block production rather than silently substitute. Browser delivery must respect font licensing, including whether customers may access full font binaries.

Font subsets must retain the glyph closure needed by the writer and map glyph IDs to PDF character identifiers correctly. Store Unicode mappings/ActualText strategy for ligatures and reordered scripts. Avoid an assumption that one glyph equals one Unicode character. Archive exact font inputs only where licensed; if archival rights are absent, explain restoration limits and require an acceptable alternative before promising editable recovery.

## Server/browser strategy and research gate

Prefer pinned server composition initially; browser consumes resolved glyph positions and provides immediate interaction. Compare native C++/HarfBuzz/ICU and a maintained WASM build against the same corpus. A server-only fallback reduces client distribution and parity risk but may increase editing latency. Existing high-level compositors and commercial publishing engines should be compared before implementing a general paragraph optimizer; Pageinator still owns its newspaper rules and resolved contract.

Measure shape/compose time, cache hit behavior, font/WASM startup, long-story memory and repeated recomposition. Cache keys include text, style, font hash/axes, width, language/direction and engine data versions. Exit requires native-reader approval, glyph geometry golden tests, browser/PDF parity, font license clearance and acceptable interactive behavior. These are unresolved research gates; eventual multilingual support is not reduced to English-only architecture.

## Phase 24 reuse correction — paragraph layers

| Candidate | Classification / license | Evidence and integration judgment |
|---|---|---|
| Pango | RESEARCH, possible WRAP; LGPL-2.1-or-later | Native internationalized paragraph layout with glyph-based rendering and HarfBuzz integration; GObject/font backends add runtime/compliance surface. Compare line policy, explicit fonts, glyph/source extraction and column integration before writing a general paragraph optimizer. Browser/WASM path is unqualified, not assumed. [Pango API](https://docs.gtk.org/Pango/), [Layout API](https://docs.gtk.org/Pango/class.Layout.html). |
| SkParagraph | RESEARCH, possible WRAP; Skia BSD-style core plus third-party notices | Native API exposes layout, line metrics and visitors containing font/glyph/position/source-offset data. This is evidence of a potential resolved-scene bridge, not tested PDF subset mapping or CanvasKit binding parity. Compare with Pango and lower-level primitives on the same font/corpus. [Paragraph interface](https://raw.githubusercontent.com/google/skia/main/modules/skparagraph/include/Paragraph.h), [Skia license](https://github.com/google/skia/blob/main/LICENSE). |

Both candidates may reduce commodity work, but neither is qualified here for newspaper continuation, Urdu justification, font rights, native/WASM determinism or press PDF. Pin backend/font selection and Unicode data; disable reflow in preview/output consumers after canonical resolution. Integration/replacement costs are high enough to require RD01/RD02/RD10 evidence. DEP63/64 hold full registry dimensions. No source was downloaded into the repository or installed.
