# 06 — Editor, Rendering and Performance

> **Second-pass review, 2026-10-07.** The editor-core architecture is accepted.
- The renderer comes from EXP-RENDER (`16` §4).
- The performance budgets in §7 are replaced by the grounded targets and ceilings in `16` §5.
- Under a single server kernel, "recompose in worker" becomes a server round-trip; that budget is a ceiling of 250 ms.
- The renderer must support licence-aware preview modes (ADR-019). Status vocabulary: ADR-021. Baseline: `20`.


Status: DECIDED. The renderer implementation is TENTATIVE until the Phase-0 bake-off.

## 1. Editor architecture

```
apps/web
 ├─ React shell: toolbar, panels (pages, layers, properties, styles, story list, comments, AI), dialogs
 ├─ Editor core (plain TS, no React): DocumentStore · CommandBus · UndoManager · SelectionModel · ToolManager
 │                                    ViewportModel (zoom, pan, page virtualization) · SnapIndex · Hotkeys
 ├─ Compose worker   (packages/compose + document)  ◄─ fonts/WASM loaded once; incremental resolve
 ├─ Render worker    (packages/render, OffscreenCanvas)  ◄─ resolved pages + viewport → tiles
 └─ Overlay canvas   (main thread): selection boxes, handles, guides, snapping lines, carets, drag ghosts
```

- **React does not own document state.** React panels subscribe to the editor core through selectors, using `useSyncExternalStore`. This keeps re-renders to the panels that actually changed and keeps the canvas out of React reconciliation.
- **The main thread draws only the overlay.** It composites tiles that the render worker produces as `ImageBitmap` transfers.
- **Hit testing** uses an R-tree (`rbush`) of frame rects per page, plus glyph cluster boxes from the ResolvedDocument for text carets and selection. Hit order is z-order and then package (an idea from A).

## 2. Renderer (`packages/render`)

**Interface.** `SceneRenderer.renderTile(page: ResolvedPage, tileRect, scale) → ImageBitmap`.

**Implementation 1 (default, TENTATIVE): Canvas2D in an OffscreenCanvas worker.**
- Glyphs are drawn as `Path2D` built from harfbuzzjs `glyphToPath`, cached per (font hash, glyph ID). Each glyph is drawn with `setTransform` and `fill`.
- Images use pre-scaled screen renditions, picked by zoom level (bucketed at 0.25, 0.5, 1, 2 and 4).
- Ad PDFs appear as raster previews, made in the worker with pdfium at upload time.
- **Tiles** are 512 px. The tile cache is keyed by (page hash, zoom bucket, tile).
  - During zoom gestures, existing tiles are scaled on the GPU through `drawImage`, then re-rasterised once the zoom settles.
  - Memory budget: 256 MB of tiles, LRU.

**Implementation 2 (fallback): CanvasKit (Skia WASM, WebGL).** Adopted if Canvas2D misses the page-raster budget in the bake-off.

**Rejected:**
- Konva, because it re-wraps text, duplicates the scene graph, and is not designed for drawing glyph IDs.
- SVG/DOM text, because the browser shapes and wraps it, which breaks parity.
- Raw WebGL/WebGPU, because the cost is too high for a small team.

**Phase-0 bake-off.**
- Test material: a real 8-column broadsheet Marathi page with about 20k glyphs and 3 images, tested on a mid-range Windows laptop with integrated GPU and on a MacBook Air.
- Measures: first full-page raster, tile re-raster at 200% zoom, glyph-cache memory, and frame time during pan and zoom.
- Pass criteria: full page raster under 50 ms, settle re-raster under 300 ms, pan and zoom at 60 fps.

## 3. Tools and features (with phase)

| Capability | Phase | Notes |
|---|---|---|
| Select (frame and package), multi-select, marquee | P1 | Package-first selection; Alt-click selects the frame inside a package |
| Move, resize (8 handles), nudge, numeric fields | P1 | Handle geometry follows A: 7 px box, 2 px hit padding |
| Zoom (fit page, fit width, 25–800%), pan (space-drag, wheel) | P1 | Tile-scaled during the gesture |
| Rulers (mm, pt, columns), column guides, baseline grid display | P1 | Taken from the template grid |
| Snapping to columns, gutters, baselines, other frame edges, page edges | P1 | SnapIndex per page; threshold of 6 screen px |
| Text frames, linking (threads), overset indicator (red +) | P1 | Overset is computed by `resolve` |
| Story editor (ProseMirror) as a panel and as an in-place overlay | P1 | Styles map to the StyleSheet; IME tested (§6) |
| Image frames: place, replace, fit/fill, crop and pan inside the frame, focal point | P1 | Crop is stored in the document; originals are never modified |
| Lock / unlock, layers, z-order, group (= package) | P1 | Locks are hard constraints for the generator |
| Undo/redo (single stack, per document per user session) | P1 | Server revisions are separate from the local undo stack |
| Copy/paste frames and packages (within and between pages) | P1 | |
| Page thumbnails panel, page navigation, spreads view | P1 | Thumbnails are low-resolution renders of resolved pages from the worker |
| Paragraph, character and object styles panel | P2 | Edits the edition overrides; publication styles are edited in the profile |
| Templates and master pages: apply to page, detach | P2 | |
| Align and distribute, smart guides | P2 | |
| Rotation (90° steps in P1; arbitrary rotation in P3) | P1/P3 | Arbitrary rotation affects preflight and hit testing |
| Comments pinned to objects | P5 | |
| Contextual AI (selection-aware) | P3 | `09` §6 |
| Regenerate page or area | P3 | Area = marquee; locked objects kept |

## 4. Autosave, revisions and crash recovery

1. Each command is applied locally, then pushed to an IndexedDB **outbox** right away, so crash recovery works across browser restarts.
2. A sync loop batches the outbox every 1 s, or immediately on idle. It sends `POST /documents/:id/commands {baseRev, ops[]}` with idempotent `opId`s.
3. The server applies the commands transactionally, appends to `command_log`, bumps `rev`, triggers an authoritative resolve of the affected pages, and acknowledges with `{rev, pageHashes}`.
4. Snapshots are taken every 200 revisions and also on generate, on release and on the user's explicit "Save version".
5. Recovery on open: the client loads the latest snapshot plus the commands after it, then replays any unacknowledged outbox entries.
6. **Exports always reference an exact `rev`** (D05, RJ02). After a manual edit, an export is never regenerated from the original inputs.

## 5. Collaboration (MVP → later)

- **MVP (P1–P2):**
  - presence per edition and per page (SSE heartbeat);
  - **page-level soft locks** ("Priya is editing page 3"); others can view, or take over with a confirmation;
  - story-level edit lease in the story editor.
- Conflicts are resolved by object-level rebase. Commands touching other objects merge; a command touching the same object gets a `409` and the client re-fetches and re-applies or drops it. RJ07 forbids silently overwriting the other user's change (last-write-wins).
- **Later (P5):**
  - comments and approvals per page and per story;
  - review states (`draft → subbed → approved → locked`);
  - per-page approval locks feeding release.
- **CRDT** (Yjs on story text only) is reconsidered only if pilots need two people typing in one story at the same time (DF02 stays deferred).

## 6. Text input and IME (risk area)

- All text input goes through ProseMirror, which handles composition events. It is never done through canvas key handling.
- **Phase-1 test matrix:**
  - Windows 10/11 with the Marathi InScript keyboard, the Marathi Phonetic keyboard, and Google Input Tools;
  - macOS with the Devanagari QWERTY keyboard;
  - Chrome and Edge (primary), Firefox and Safari (supported).

  Checks: conjunct entry, nukta, ZWJ/ZWNJ, deletion by grapheme versus codepoint, and paste from Word and from legacy-font documents (which goes through the converter).
- Caret and selection on the canvas overlay are mapped through ResolvedDocument `clusters`. The overlay editor then reveals the ProseMirror view in place.

## 7. Performance budgets (p95 unless noted)

| Interaction | Budget | How it is measured |
|---|---|---|
| Marketing page LCP | < 2.0 s | web-vitals RUM |
| Cold editor load (shell + WASM + fonts cached by service worker on second visit) | < 3 s first visit, < 1 s warm | `editor_ready` mark |
| Open a 16-page edition (thumbnails visible) | < 2 s | `edition_open` span |
| Switch page | < 150 ms | tile-cache hit or fresh raster |
| Drag, pan, zoom | 60 fps; input-to-paint < 16 ms (p95 frame time < 20 ms) | `requestAnimationFrame` frame-time histogram |
| Recompose one story after a text edit | < 100 ms (p50 < 30 ms) | compose worker span |
| Full-page raster (~20k glyphs) | < 50 ms | render worker span |
| Re-raster after zoom settles | < 300 ms | render worker span |
| Autosave acknowledgement | < 500 ms | sync span |
| Server authoritative resolve, one page | < 300 ms | worker span |
| AI headline suggestions | < 5 s | AIInvocation latency |
| Generate a 16-page edition | < 60 s (target 30 s) | GenerationJob metrics |
| Preflight, 16 pages | < 30 s | PreflightRun |
| Print PDF export, 16 pages | < 60 s | ExportJob |

**Techniques** (designed in, not "optimise later"):
- workers for composition and rendering;
- tile caches;
- page virtualisation (only visible pages ±1 are resolved and painted at full resolution);
- a shaping cache;
- incremental resolve by thread dependency graph;
- transferable `ArrayBuffer`s rather than structured clones for glyph arrays;
- an image rendition ladder;
- a service worker that precaches WASM and fonts;
- code-splitting the editor route.

## 8. Observability for the editor

- OpenTelemetry Web SDK spans for `edition_open`, `compose`, `raster`, `sync` and `generate_wait`.
- Custom metrics: frame-time histogram, long tasks, tile-cache hit rate, `parity_mismatch` count, outbox depth.
- Sentry for errors and replay of the editor shell (with text masking; story content is customer-confidential).
- Telemetry is sampled at 10% normally and at 100% for pilot organisations. It is tagged with `engine_version`, browser, GPU tier (`navigator.gpu` / WebGL renderer string) and the edition's page count.
- Performance tests in CI (`12`): Playwright drives a golden 16-page edition, records traces, and fails if the budgets regress more than 15% against the baseline.
