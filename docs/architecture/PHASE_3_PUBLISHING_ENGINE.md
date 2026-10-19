# Phase 3 — Document and publishing engine

Inputs: [normalized requirements](PHASE_1_ANALYSIS.md), [system architecture](PHASE_2_SYSTEM_ARCHITECTURE.md), read from disk. The shared resolved-geometry contract is CONFIRMED. The engine design below is RECOMMENDED; actual fonts, numeric precision, renderer, writer and performance remain RESEARCH REQUIRED.

## Corrected pipeline

EditableDocument → validate intentions/dependencies → propose layout → shape/compose paragraphs → evaluate constraints → bounded layout/composition iteration → ResolvedDocument → browser rendering and PDF writer.

Layout → typography → composition is a useful responsibility map, not a strictly one-pass algorithm. Width changes alter line breaks; line breaks alter height and placement. Iteration needs fixed ordering, stable tie-breaking, explicit budgets and an infeasible result rather than endless retries. AI can propose priorities, headlines or template choices; validated commands introduce those proposals into editable state. Deterministic checks own feasibility.

## Canonical concepts

| Concept | Responsibility |
|---|---|
| EditableDocument | Versioned editorial and geometric intentions; references immutable content/style/asset versions; manual overrides and locks are first-class data |
| ResolvedDocument | Immutable physical scene plus text mappings, dependency manifest and validation diagnostics; no late reflow by consumers |
| Page | Stable identity, order, physical boxes, orientation, masters and frame/layer membership; display page number separate from ID |
| Frame | Typed physical container with stable ID, transform, clipping, constraints, layer and lock policy |
| Story | Editorial identity outside document; edition selects immutable StoryRevision. Text edits create edition-local revisions with parent/source lineage; placement overrides cover formatting/geometry, not hidden unversioned text. |
| Text frame | Flow-region geometry, columns, insets, linked-flow edges and assigned story ranges |
| Image frame | Asset/version reference and non-destructive placement/crop, caption and credit associations |
| Advertisement | Creative asset plus reservation/placement contract, dimensions, allowed pages, separation/colour constraints; not merely another picture |
| Template | Versioned composition rules, slots, style defaults and constraints, instantiated with persistent IDs |
| Master | Reusable page furniture and guides with explicit local override precedence; version pinned |
| Style | Paragraph/character/object policy resolved through deterministic inheritance; no cyclic inheritance |
| Paragraph | Semantic text unit with language/direction, breaks, keep/widow/orphan and composition policy |
| Character run | Text span with attributes and language/script overrides; boundaries must respect Unicode indexing contract |
| Glyph run | Font-instance identity, glyph IDs, advances/offsets, baseline, cluster-to-source mapping and direction |
| Image placement | Original-to-page affine transform, source crop, mask/clip, colour derivative identity and effective resolution |
| Physical geometry | Explicit unit-tagged coordinates, bounds and transforms, independent of CSS pixels/device scale |
| Layer | Stable stacking order and visibility/printability flags; editorial locks distinct from authorization |
| Guide | Nonprinting alignment constraints; guide snapping never alters export implicitly |
| Print metadata | Profile version, page boxes, colour/output-intent identities, font embedding policies, intended standard and preflight binding |

A resolved scene includes actual font-instance binaries or secured references by hash, glyph and logical-text correspondence, line/paragraph/frame membership, image derivatives/transforms, clipping paths, vector rules, colour-space identifiers, transparency and overprint intent where supported. Original text remains available for accessibility, selection and PDF text mapping. Converting text to outlines is not the default escape from proper shaping/embedding.

## Units and determinism contract

Use a documented canonical physical unit with explicit conversion and rounding. Integer micro-points (one millionth of a 1/72-inch point) are only a candidate, not the recommended scale until RD05 establishes physical error budgets and range safety. Check intermediate products, transforms and accumulations as well as serialized coordinates; individually safe numbers can yield unsafe arithmetic. Compare coarser fixed-point or other explicitly bounded representations before schema freeze. Internal shaping arithmetic may use engine-native fixed point; matrix operations require defined rounding and finite-value checks. Never serialize unlabelled browser pixels. Browser zoom is a view transform only. This targeted Phase 24 correction addresses AR05/06; the shared geometry invariant is unchanged.

The resolution manifest pins document/schema, font files and variation axes, Unicode/segmentation data, hyphenation dictionaries, engine binaries/build flags, styles/templates/profiles, asset/derivative hashes, locale policy and deterministic solver configuration. Define canonical ordering, stable IDs, seeds and tie-breakers. A solver wall-clock timeout can produce different incumbents on different machines; persist the accepted layout and avoid claiming rerun identity from seed alone. Production determinism is first scoped to a pinned server environment. Cross-browser/native-WASM parity must be demonstrated separately.

Byte-identical PDF regeneration is a stronger property than equal geometry; timestamps, compression and subset ordering can vary. Exact reprint uses archived bytes. Recomposition is an explicit new operation with reported toolchain identity.

## Typography and composition

Run Unicode analysis and font fallback before shaping; preserve source text and map any normalization used for lookup. Calculate legal break opportunities and shape candidate/final lines with required context. A paragraph cannot always be shaped once and cut arbitrarily: joining scripts and hyphen insertion require reshaping at selected breaks. Compose lines under language-specific justification policy, then columns/linked frames under widow/orphan/keep and continuation rules. Hyphenation dictionaries and Urdu/Nastaliq behavior require separate validation.

Copyfit may adjust only explicitly allowed variables, such as selected wording, approved tracking range or font-size bounds. Never silently discard text, scale glyphs outside policy, or rewrite a story to hide overset. Headline fitting uses real shaping and limited style alternatives; failure produces a fixable diagnostic. Track unplaced text ranges and show overset even if the clipped preview appears tidy. Continuation labels and page references are computed from stable links and rechecked after repagination.

## Geometry, layout and editing

Reserve fixed advertisements before allocating editorial news-hole. Model hard constraints (ad dimensions, legal frames, required content, locks) separately from soft objectives (balance, prominence, whitespace). Not every overlap is illegal: text over an image, crop masks and rule intersections need typed overlap policy. Validate transformed bounds and clipping, not just axis-aligned boxes. Rotation/crop are matrices on immutable assets. Stable stacking order and printable flags must survive preview/export.

For a manual edit, preview the gesture locally, commit one semantic command on completion, then resolve the affected dependency closure. Debounced text editing creates coherent transactions. Autosave acknowledges a committed document revision; optimistic interaction is not a saved guarantee. Undo is a new command restoring earlier state, while persistent revision restoration creates a new revision. Conflicts must not become silent last-write-wins changes.

Regeneration receives scope, base revision, content/style versions, locks and manual overrides. Precedence: immutable ad/press constraints → explicit locks → explicit local overrides → template rules → generated suggestions. A conflict with a lock returns an explanation; it does not relax the lock automatically. Scope invalidation follows linked stories, continuation/page references, shared masters and affected geometry. Show expanded affected pages before applying a proposal. Whole-edition generation does not replace a more local operation by default.

## Preview/output interface

The browser and PDF writer consume the same resolved positions, glyph selection, clips and image transforms. Browser DOM text may supply input/accessibility, but cannot independently lay out the print preview. Rendering can differ in antialiasing and screen colour; geometry and text-flow identity may not differ. Unsupported primitives must fail explicitly rather than silently rasterize or omit content. A server-rendered proof fallback is acceptable for inspection, not a substitute for a responsive editable interaction surface.

The CSS paged-media specification describes page layout features but does not establish implementation support or PDF/X conformance ([W3C CSS Paged Media](https://www.w3.org/TR/css-page-3/)). HTML printing is therefore a research comparator, not the assumed print master.

## Required feasibility exit criteria

Before freezing engine APIs, demonstrate: (1) a licensed English/Devanagari/Urdu mixed-script corpus with selected fonts, (2) identical glyph/line/frame geometry in preview and exported file, (3) round-trip resolved-schema serialization, (4) linked-frame overflow and local regeneration preserving locks, (5) explicit-position font-subset export with correct logical text mapping, (6) accepted colour/page-box output and final-file preflight, (7) interactive latency and memory at a representative 16-page newspaper. Record actual measured budgets on agreed pilot hardware; no claim of production feasibility follows from this document alone.
