/**
 * The page on a canvas (editor.js draw and its pointer handling): the engine's display list drawn from the PDF's glyph
 * outlines, the stories' outlines over it (selected, locked, with a problem the print would show), the selected story's
 * handles, and a drag's snapped ghost. A click selects (or picks the story to swap with), a drag moves or resizes; the
 * arrow keys move the selected story a column or a grid step, with Shift they change its size.
 * Zoomed in, the stage scrolls: a spacer as large as the zoomed page, the canvas the size of the visible area kept in
 * view (sticky) and drawn at the scroll. The page itself is drawn once per view, size, zoom and scroll into an offscreen
 * canvas; a pointer move only copies it and draws the outlines over it, in the next animation frame. The stage is as tall
 * as the window leaves below it, so "Whole page" shows all of it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  BAD,
  boxOf,
  clampZoom,
  dragged,
  drawPage,
  fitScale,
  hitTest,
  samePlace,
  type Module,
  type PageView,
  type Part,
  type ViewAt,
} from "./view.ts";

const DRAG_MIN_MM = 0.8; // a smaller pointer move is a click, not a drag
const PAD = 24; // px around the page
const MIN_STAGE_PX = 320;

export interface PageCanvasProps {
  readonly view: PageView;
  readonly modules: readonly Module[];
  readonly selected: string | null;
  readonly zoom: number;
  readonly glyphs: ReadonlyMap<string, Path2D>;
  readonly images: ReadonlyMap<string, HTMLImageElement>;
  /** bumped when a picture or an outline has come */
  readonly drawn: number;
  readonly label: string;
  readonly sizeText: (m: Module) => string;
  readonly onPick: (story: string | null) => void;
  /** a story moved or resized (snapped) */
  readonly onChange: (next: Module) => void;
  /** a locked story would be moved */
  readonly onLocked: (story: string) => void;
}

interface Drag {
  readonly part: Part;
  readonly from: Module;
  readonly start: readonly [number, number];
  readonly pointer: number;
  ghost: Module | null;
}

export function PageCanvas(props: PageCanvasProps) {
  const { view, modules, selected, zoom, glyphs, images, drawn } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const page = useRef<{ key: readonly unknown[]; canvas: HTMLCanvasElement } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0, stage: 0 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [, setFrame] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // the visible area: the stage's width, and the window's height below the stage's top
    const measure = () => {
      const stage = Math.max(MIN_STAGE_PX, window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - 16);
      setSize({ w: el.clientWidth, h: el.clientHeight || stage, stage });
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  const g = view.grid;
  const s = Math.max(0, fitScale(size.w, size.h, g.page_w_mm, g.page_h_mm, PAD)) * clampZoom(zoom);
  // the zoomed page with its margin: what the stage scrolls over
  const full = { w: Math.max(size.w, g.page_w_mm * s + 2 * PAD), h: Math.max(size.h, g.page_h_mm * s + 2 * PAD) };
  const at: ViewAt = {
    s,
    ox: (full.w - g.page_w_mm * s) / 2 - scroll.x,
    oy: (full.h - g.page_h_mm * s) / 2 - scroll.y,
  };

  useEffect(() => {
    const el = canvas.current;
    const ctx = el && s > 0 ? el.getContext("2d") : null;
    if (!el || !ctx) return;
    const frame = requestAnimationFrame(() => paint(el, ctx));
    return () => cancelAnimationFrame(frame);
  });

  const paint = (el: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const k = window.devicePixelRatio || 1;
    const [w, h] = [Math.round(size.w * k), Math.round(size.h * k)];
    const key = [view, w, h, at.s, at.ox, at.oy, drawn, glyphs, images];
    let cached = page.current;
    if (!cached || cached.key.some((v, i) => v !== key[i])) {
      const off = cached?.canvas ?? document.createElement("canvas");
      const octx = off.getContext("2d");
      if (!octx) return;
      off.width = w;
      off.height = h;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.fillStyle = "#3a3f47";
      octx.fillRect(0, 0, w, h);
      drawPage(octx, view, { ...at, k, glyphs, images });
      cached = page.current = { key, canvas: off };
    }
    if (el.width !== w || el.height !== h) [el.width, el.height] = [w, h];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cached.canvas, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const bad = new Set(view.problems.filter((p) => BAD.has(p.kind)).flatMap((p) => p.stories ?? []));
    const px = (b: ReturnType<typeof boxOf>) =>
      [at.ox + b.x0 * s, at.oy + b.y0 * s, at.ox + b.x1 * s, at.oy + b.y1 * s] as const;
    for (const m of modules) {
      const [x0, y0, x1, y1] = px(boxOf(g, m));
      const sel = m.story === selected;
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeStyle = sel ? "#2563eb" : bad.has(m.story) ? "rgba(220, 38, 38, 0.9)" : "rgba(37, 99, 235, 0.25)";
      if (bad.has(m.story) && !sel) {
        ctx.fillStyle = "rgba(220, 38, 38, 0.06)";
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (m.locked) ctx.setLineDash([6, 4]); // locked: a dashed outline and no handles
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      ctx.setLineDash([]);
      if (sel && !m.locked) {
        ctx.fillStyle = "#2563eb";
        for (const [hx, hy] of [
          [x1, (y0 + y1) / 2],
          [(x0 + x1) / 2, y1],
          [x1, y1],
        ] as const)
          ctx.fillRect(hx - 4, hy - 4, 8, 8);
      }
    }
    const ghost = drag.current?.ghost;
    if (ghost) {
      const [x0, y0, x1, y1] = px(boxOf(g, ghost));
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(244, 63, 94, 0.08)";
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = "#111827";
      ctx.font = `12px ${getComputedStyle(el).fontFamily}`;
      ctx.fillText(props.sizeText(ghost), x0 + 6, y0 - 6);
    }
  };

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !(s > 0)) return;
    const [px, py] = point(e);
    const h = hitTest(g, modules, selected, at, px, py);
    const m = h && modules.find((x) => x.story === h.story);
    if (!h || !m) return props.onPick(null);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { part: h.part, from: m, start: [px, py], pointer: e.pointerId, ghost: null };
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const [px, py] = point(e);
    const dx = (px - d.start[0]) / s;
    const dy = (py - d.start[1]) / s;
    d.ghost = Math.abs(dx) + Math.abs(dy) < DRAG_MIN_MM || d.from.locked ? null : dragged(g, d.from, d.part, dx, dy);
    setFrame((n) => n + 1);
  };

  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    const [px, py] = point(e);
    const moved = Math.abs(px - d.start[0]) / s + Math.abs(py - d.start[1]) / s >= DRAG_MIN_MM;
    if (!moved) return props.onPick(d.from.story);
    if (d.from.locked) return props.onLocked(d.from.story);
    if (d.ghost && !samePlace(d.ghost, d.from)) props.onChange(d.ghost);
    else setFrame((n) => n + 1);
  };

  const cancel = () => {
    drag.current = null;
    setFrame((n) => n + 1);
  };

  const key = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const m = modules.find((x) => x.story === selected);
    const step: Record<string, readonly [number, number]> = {
      ArrowLeft: [-(g.column_mm + g.gutter_mm), 0],
      ArrowRight: [g.column_mm + g.gutter_mm, 0],
      ArrowUp: [0, -g.snap_mm],
      ArrowDown: [0, g.snap_mm],
    };
    const by = step[e.key];
    if (e.key === "Escape") return props.onPick(null);
    if (!m || !by) return;
    e.preventDefault();
    if (m.locked) return props.onLocked(m.story);
    const next = e.shiftKey
      ? dragged(g, m, by[0] ? "right" : "bottom", by[0], by[1])
      : dragged(g, m, "body", by[0], by[1]);
    if (!samePlace(next, m)) props.onChange(next);
  };

  return (
    <div
      ref={box}
      className="pg-editor__stage"
      style={size.stage ? { blockSize: `${size.stage}px` } : undefined}
      data-drawn={drawn}
      onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
    >
      <div className="pg-editor__spacer" style={{ inlineSize: `${full.w}px`, blockSize: `${full.h}px` }}>
        <canvas
          ref={canvas}
          className="pg-editor__canvas"
          style={{ inlineSize: `${size.w}px`, blockSize: `${size.h}px` }}
          tabIndex={0}
          role="application"
          aria-label={props.label}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
          onLostPointerCapture={() => drag.current && cancel()}
          onKeyDown={key}
        />
      </div>
    </div>
  );
}
