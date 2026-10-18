# ADR-004: Editor rendering and text input

**Post-review status (2026-10-07):** **ACCEPTED** for the architecture: DOM shell; editor core outside React; the browser never lays out text; ProseMirror for input. **EXPERIMENTAL** for the renderer implementation: EXP-RENDER (`16` §4) compares R1 Canvas2D, R2 CanvasKit, R3 Konva drawing glyph paths, and R4 SVG. Konva is now a measured candidate, not rejected outright; only Konva's *own text layout* stays rejected. The renderer must also support licence-aware preview modes (ADR-019).

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:**
- DECIDED: the architecture.
- TENTATIVE: the renderer implementation, which is chosen in the Phase 0 bake-off.

## Decision
- **The React shell** handles panels and routes. A plain-TS editor core (command bus, selection, tools, undo) sits outside React state.
- **Scene rendering:** a `SceneRenderer` interface.
  - Default implementation: Canvas2D in an OffscreenCanvas worker. It draws glyph `Path2D`s from harfbuzzjs outlines and keeps a 512 px tile cache.
  - Fallback: CanvasKit, used if Canvas2D misses the budgets (a full page under 50 ms; re-rendering after zoom settles under 300 ms; 60 fps pan and zoom).
- **Overlay canvas** on the main thread for selection, handles and guides.
- **Text input:** a ProseMirror story editor, as a panel and as an in-place overlay, for correct IME and Devanagari input. Editing text directly on the canvas comes later.
- **Rejected:**
  - Konva. It re-wraps text and is not built for drawing by glyph ID.
  - DOM/SVG text. The browser's own shaping breaks parity.
  - tldraw (RJ05).
  - Raw WebGL/WebGPU, at this team size.
