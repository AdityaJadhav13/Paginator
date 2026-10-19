# Browser editor research — Phase 4

Research date: 2026-09-15. Inputs: Phase 3 publishing contract read from disk. Evidence is upstream documentation/repositories; no benchmark or production compatibility claim is implied. License/dependency clearance requires an exact version before adoption.

## Recommendation

BUILD Pageinator's document commands, newspaper editing policy, flow links, lock/regeneration semantics and accessible task UX. WRAP commodity interaction/graphics capabilities. Recommend a hybrid DOM shell/input layer plus a replaceable resolved-scene renderer. Shortlist Konva for initial interaction experiments and CanvasKit for positioned-glyph rendering. Do not make a canvas library's serialization format Pageinator's durable document model.

| Approach | Useful layer | Limit / decision |
|---|---|---|
| DOM/CSS | Menus, panels, keyboard focus, story editing, accessible content | Browser text reflow is not authoritative print geometry; glyph-per-element pages can be costly |
| SVG | Guides, handles, selected vectors, inspectable small page scenes | Native SVG text can reshape; outlined glyph paths need logical-text/accessibility overlay; large node counts require measurement |
| Canvas 2D | Interaction overlays and cached page painting | No retained accessibility tree or editing model; native text API alone does not expose the needed font/glyph contract |
| WebGL | Batched visual primitives and glyph/image textures | GPU lifetime, texture/memory limits and context loss; own hit testing/input |
| WebGPU | Potential graphics acceleration | No requirement until target-device support and benefit are measured; keep fallback |
| WASM | Shared shaping/graphics code and fixed engine behavior | Download/startup and memory costs; numeric and font parity still need tests |
| Hybrid | DOM UI/input + canvas/GPU scene + selected SVG overlays | RECOMMENDED; coordinate mapping and focus/IME synchronization become explicit adapter contracts |

## Project evaluation

| Candidate / license | Classification | Evidence and Pageinator fit |
|---|---|---|
| Konva / MIT | WRAP, conditional | Mature retained canvas interaction, transforms, events and React bindings. Good for selection/handles; its text wrapping is not the publishing engine. Avoid one scene node per glyph; cache resolved pages and render interactive overlays. [Project](https://github.com/konvajs/konva), [performance guidance](https://konvajs.org/docs/performance/All_Performance_Tips.html). |
| Fabric.js / MIT | RESEARCH | Object manipulation, text editing and SVG interchange; test complex-script IME and adapter cost. Does not supply newspaper composition or PDF/X. Rival to Konva, not an additional mandatory layer. [Project](https://github.com/fabricjs/fabric.js). |
| Skia/CanvasKit / BSD-style core plus third parties | WRAP, pending spike | Common graphics APIs and WASM build make it a serious resolved-scene renderer. Manual WASM object disposal and GPU fallback need explicit engineering. Do not invoke its paragraph reflow after receiving resolved lines. [Modules](https://skia.org/docs/user/modules/), [quickstart](https://skia.org/docs/user/modules/quickstart/). |
| PixiJS / MIT | RESEARCH | Established WebGL/WebGPU-oriented 2D renderer; strong batching/image pipeline, but no newspaper editing semantics or complete glyph-to-PDF bridge. Compare only if CanvasKit budget fails. [Project](https://github.com/pixijs/pixijs). |
| Excalidraw / MIT | REFERENCE | Useful interaction/keyboard/history patterns; whiteboard scene/text semantics are wrong as Pageinator's canonical format. [Project](https://github.com/excalidraw/excalidraw). |
| Penpot / MPL-2.0 | REFERENCE | Serious browser design application; complex product/runtime and file-level copyleft make wholesale reuse unattractive. Reference workflows without copying code; any later code reuse needs compliance review. [Project](https://github.com/penpot/penpot). |
| tldraw SDK / proprietary source-available terms | RESEARCH or BUY | Production requires appropriate license; do not call it a permissive open-source dependency. Whiteboard editing value must justify commercial cost and schema coupling. [Vendor license](https://tldraw.dev/community/license). |

Repositories and maintained documentation were accessible; this establishes available projects, not uniform maintenance quality. Exact releases, security advisories and runtime dependency sets belong to the adoption gate in the registry. Prefer one graphics strategy, not simultaneous use of every candidate.

## Interaction responsibilities

| Operation | Pageinator policy / acceptance behavior |
|---|---|
| Selection, hit testing | Stable frame IDs, transformed/clipped hit regions, multi-select and keyboard list equivalent |
| Move/resize/rotation | Local gesture preview; one validated command per gesture; physical-unit rounding; enforce ad and lock constraints |
| Crop | Modify placement matrix/mask, preserve original; show effective resolution and reset control |
| Snap/guides/align/distribute | View-aware tolerance mapped to physical units, deterministic final geometry; guides nonprinting |
| Group/lock/layers | Transform hierarchy with stable child IDs; lock explicit properties; printability separate from visibility and permissions |
| Text editing | DOM input/IME integration with semantic ranges; composition events preserved; recomposition maps logical clusters to visual carets |
| Zoom/pan | View state only; page-coordinate conversion round-trips; handle high device-pixel ratios |
| Undo/redo | Semantic command transaction history; no vendor history as persistent revision authority |
| Keyboard | Predictable tool shortcuts, focus escape, numerical movement, accessible menus and no trapping story input |
| Clipboard | Sanitize external text/HTML; allowed style subset; image paste creates an asset; cross-tenant copied references require reauthorization |
| Accessibility | DOM outline of pages/frames/story text, named controls, keyboard alternatives, announcements of save/overset/errors |

IME and bidirectional text are architecture gates, not polish. A hidden textarea alone does not solve caret placement, selection and composing text in Urdu or Devanagari. Keep text editing available in a side-panel story workspace while direct on-page editing is proven; this is a fallback workflow, not abandonment of professional browser editing.

## Performance research protocol

Use representative licensed 16-page fixtures with dense columns, ads, photos and mixed scripts; also test one enlarged stress edition after pilot limits are known. Virtualize offscreen pages, retain low-resolution thumbnails, cap bitmap caches and release WASM/GPU resources. During gestures avoid a full edition re-resolve. Measure first editable page, selection/move latency, text-to-resolution latency, zoom smoothness, memory after page traversal and recovery after context loss.

Proposed experiment targets, not promises: visible drag p95 under 50 ms, active-page text response under 300 ms locally when feasible, UI input stays responsive during server jobs; determine remote resolution budget from pilot network tests. Record device/browser/version, glyph/object count, viewport, network and cold/warm caches. Test current Chrome/Edge, Firefox and Safari before selecting supported launch browsers; mobile is review-oriented.

Exit gate: demonstrated resolved-glyph rendering, accurate selection mapping, IME/RTL editing, locked-region regeneration, bounded memory and keyboard workflow. The immediate UI backlog can use an explicit sample preview and limited frame manipulation; it cannot claim this gate has passed.

## Phase 24 correction — text input reuse and layer count

AR08/09 identified missing mature semantic text-input comparisons. ProseMirror and Lexical are RESEARCH candidates for a WRAP of the story-input layer, not replacements for Pageinator's print model. Their history/schema/selection facilities may reduce bespoke input work; Pageinator still owns edition revisions and maps editor transactions to story commands. External pasted HTML must be sanitized and adapter mappings must preserve supported semantics, IME and RTL. No rich-text library is required for the bounded UI demonstration's simple inputs.

ProseMirror uses MIT licensing and custom semantic document schemas. Its GitHub meta-repository is archived with a relocation notice, so inspect actual module provenance at the new upstream before judging maintenance; the new upstream returned 403 during this review. [Migration notice and license](https://github.com/ProseMirror/prosemirror).

Lexical's MIT editor core and React bindings are a serious alternative with history/serialization facilities. Upstream accessibility claims are not proof that Pageinator's canvas/keyboard/input bridge is accessible. Exact package/plugin graph, browser behavior and updates remain unqualified. [Lexical upstream](https://github.com/facebook/lexical).

Prefer one input adapter and one canonical scene. Konva plus CanvasKit is an experiment, not a mandatory combined dependency: compare a smaller interaction overlay before adopting duplicate scene graphs/hit testing. No library may independently reshape the already resolved print scene. DEP61/62 record runtime, maintenance, licensing, security, performance and replacement limits; RD06 is still open.
