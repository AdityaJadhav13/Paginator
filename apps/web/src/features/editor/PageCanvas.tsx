/**
 * The page on a canvas (editor.js draw and its pointer handling): the engine's display list drawn from the PDF's glyph
 * outlines, the stories' outlines over it (selected, locked, with a problem the print would show), the selected story's
 * handles, and a drag's snapped ghost. A click selects (or picks the story to swap with), a drag moves or resizes; the
 * arrow keys move the selected story a column or a grid step, with Shift they change its size.
 * Zoomed in, the stage scrolls: a spacer as large as the zoomed page, the canvas the size of the visible area kept in
 * view (sticky) and drawn at the scroll. The page itself is drawn once per view, size, zoom and scroll into an offscreen
 * canvas; a pointer move only copies it and draws the outlines over it, in the next animation frame. The stage is as tall
 * as the window leaves below it, so "Whole page" shows all of it.
 * The selected story's photo (editor.js §"photo crops"): in photo mode it is dragged in its frame or moved with the
 * arrow keys (2 % of the photo a step, with Shift 10 %), a double-click on it sets its focal point; in focal mode a click
 * on it sets the point. Enter or Esc goes focal → photo → select; a click outside the frame in photo mode selects again.
 * The rulers (mm from the page's top-left corner, the grid's columns, the pointer) are drawn over the view, never into
 * the page drawn offscreen; a click on them does nothing.
 */
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type Ref,
} from "react";
import {
  BAD,
  boxOf,
  clampZoom,
  dragged,
  drawPage,
  fitScale,
  focusAt,
  focusOf,
  gridColumns,
  hitTest,
  panWindow,
  photoExtent,
  rulerLabel,
  rulerSteps,
  rulerTicks,
  samePlace,
  shownWindow,
  stepFocus,
  windowAt,
  zoomToRect,
  type Box,
  type Grid,
  type Module,
  type PageView,
  type Pair,
  type Part,
  type PhotoNote,
  type ViewAt,
  type Win,
} from "./view.ts";

const DRAG_MIN_MM = 0.8; // a smaller pointer move is a click, not a drag
const PAD = 24; // px around the page
const MIN_STAGE_PX = 320;
export const RULER_PX = 20; // the rulers along the top and left of the view
const ZOOM_MARGIN_PX = 32; // room around a story zoomed to

/** "select"; "photo": the selected story's photo is moved in its frame; "focal": its focal point is set. */
export type Mode = "select" | "photo" | "focal";

export interface PageCanvasHandle {
  /** The view fitted around a box on the page (mm), inside the rulers, the stage scrolled to centre it. */
  zoomTo(box: Box): void;
}

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
  /** the mode for the selected story's photo ("select" when it has none) */
  readonly mode: Mode;
  readonly onMode: (mode: Mode) => void;
  /** the selected story's photo moved in its frame, or its focal point set: the focus asked for */
  readonly onCrop: (story: string, focus: Pair) => void;
  readonly rulers: boolean;
  readonly onZoom: (zoom: number) => void;
  readonly ref?: Ref<PageCanvasHandle>;
}

interface Drag {
  readonly part: Part;
  readonly from: Module;
  readonly start: readonly [number, number];
  readonly pointer: number;
  ghost: Module | null;
}

/** The selected story's photo dragged in its frame: the window it started from and the one it is at. */
interface Pan {
  readonly story: string;
  readonly start: Pair;
  readonly base: Win;
  readonly pointer: number;
  win: Win;
  moved: boolean;
}

const inside = (b: Box, x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
const frameOf = (p: PhotoNote): Box => ({ x0: p.box_mm[0], y0: p.box_mm[1], x1: p.box_mm[2], y1: p.box_mm[3] });

export function PageCanvas(props: PageCanvasProps) {
  const { view, modules, selected, zoom, glyphs, images, drawn, mode, rulers } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<Pan | null>(null);
  /** where the pointer is over the view (px), marked on the rulers */
  const pointer = useRef<Pair | null>(null);
  /** the scroll a zoom to a box asks for, once the stage has its new size */
  const want = useRef<{ x: number; y: number } | null>(null);
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
  const sel = modules.find((m) => m.story === selected) ?? null;
  const photo = sel && mode !== "select" ? (view.notes.find((n) => n.story === sel.story)?.photo ?? null) : null;
  const toMm = (px: number, py: number) => [(px - at.ox) / s, (py - at.oy) / s] as const;
  const onRuler = (px: number, py: number) => rulers && (px < RULER_PX || py < RULER_PX);

  useImperativeHandle(props.ref, () => ({
    zoomTo(rect) {
      const r = rulers ? RULER_PX : 0;
      const base = fitScale(size.w, size.h, g.page_w_mm, g.page_h_mm, PAD);
      const v = zoomToRect(rect, { x0: r, y0: r, x1: size.w, y1: size.h }, base, ZOOM_MARGIN_PX);
      if (!v) return;
      // the page's corner where the view puts it, as far as the stage scrolls
      const fw = Math.max(size.w, g.page_w_mm * v.s + 2 * PAD);
      const fh = Math.max(size.h, g.page_h_mm * v.s + 2 * PAD);
      want.current = {
        x: Math.min(fw - size.w, Math.max(0, (fw - g.page_w_mm * v.s) / 2 - v.ox)),
        y: Math.min(fh - size.h, Math.max(0, (fh - g.page_h_mm * v.s) / 2 - v.oy)),
      };
      props.onZoom(v.zoom);
      setFrame((n) => n + 1);
    },
  }));

  useLayoutEffect(() => {
    const el = box.current;
    const to = want.current;
    if (!el || !to) return;
    want.current = null;
    el.scrollLeft = to.x;
    el.scrollTop = to.y;
    setScroll(to);
  });

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
    if (sel && photo) {
      const img = photo.full ? images.get(photo.full) : undefined;
      drawPhoto(ctx, at, photo, img, pan.current?.win ?? shownWindow(sel, photo), !!pan.current, mode === "focal", sel);
    }
    if (rulers) drawRulers(ctx, g, at, size.w, size.h, pointer.current);
  };

  const point = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !(s > 0)) return;
    const [px, py] = point(e);
    if (onRuler(px, py)) return; // the rulers are for reading
    if (sel && photo) {
      const [x, y] = toMm(px, py);
      if (mode === "focal") {
        const ext = photoExtent(photo.box_mm, shownWindow(sel, photo), photo.px);
        if (inside(ext, x, y)) props.onCrop(sel.story, focusAt(x, y, ext));
        return; // a click outside the photo does nothing: Enter or Esc finishes
      }
      if (inside(frameOf(photo), x, y)) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const base = shownWindow(sel, photo);
        pan.current = { story: sel.story, start: [px, py], base, win: base, pointer: e.pointerId, moved: false };
        return;
      }
      props.onMode("select"); // a click elsewhere: back to selecting stories
    }
    const h = hitTest(g, modules, selected, at, px, py);
    const m = h && modules.find((x) => x.story === h.story);
    if (!h || !m) return props.onPick(null);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { part: h.part, from: m, start: [px, py], pointer: e.pointerId, ghost: null };
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const [px, py] = point(e);
    const p = pan.current;
    if (p && e.pointerId === p.pointer) {
      if (!photo) return;
      const dx = (px - p.start[0]) / s;
      const dy = (py - p.start[1]) / s;
      p.moved ||= Math.abs(dx) + Math.abs(dy) >= DRAG_MIN_MM;
      p.win = panWindow(p.base, photo.px, photo.box_mm, dx, dy);
      return setFrame((n) => n + 1);
    }
    const d = drag.current;
    if (!d) {
      const [x, y] = toMm(px, py);
      e.currentTarget.style.cursor =
        mode === "focal" ? "crosshair" : photo && inside(frameOf(photo), x, y) ? "grab" : "";
      if (rulers) {
        pointer.current = [px, py];
        setFrame((n) => n + 1);
      }
      return;
    }
    if (e.pointerId !== d.pointer) return;
    const dx = (px - d.start[0]) / s;
    const dy = (py - d.start[1]) / s;
    d.ghost = Math.abs(dx) + Math.abs(dy) < DRAG_MIN_MM || d.from.locked ? null : dragged(g, d.from, d.part, dx, dy);
    setFrame((n) => n + 1);
  };

  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = pan.current;
    if (p && e.pointerId === p.pointer) {
      pan.current = null;
      if (p.moved && photo) props.onCrop(p.story, focusOf(p.win, photo.px));
      setFrame((n) => n + 1); // the photo drawn where the page has it (a refused or unchanged crop changes nothing)
      return;
    }
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
    pan.current = null;
    setFrame((n) => n + 1);
  };

  const leave = () => {
    pointer.current = null;
    if (rulers) setFrame((n) => n + 1);
  };

  const double = (e: MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "photo" || !photo) return;
    const [x, y] = toMm(...point(e));
    if (inside(frameOf(photo), x, y)) props.onMode("focal");
  };

  const key = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const m = sel;
    if (m && photo) {
      // photo and focal mode: the arrows move the photo in its frame; Enter or Esc goes back a mode
      const f = e.shiftKey ? 0.1 : 0.02;
      const pans: Record<string, Pair> = {
        ArrowLeft: [-f, 0],
        ArrowRight: [f, 0],
        ArrowUp: [0, -f],
        ArrowDown: [0, f],
      };
      const by = pans[e.key];
      if (by) {
        e.preventDefault();
        const win = shownWindow(m, photo);
        const focus = stepFocus(win, photo.px, by[0], by[1]);
        const next = windowAt(focus, win, photo.px);
        if (next[0] !== win[0] || next[1] !== win[1]) props.onCrop(m.story, focus);
      } else if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        props.onMode(mode === "focal" ? "photo" : "select");
      }
      return; // the story's other keys wait until stories are selected again
    }
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
          onLostPointerCapture={() => (drag.current || pan.current) && cancel()}
          onPointerLeave={leave}
          onDoubleClick={double}
          onKeyDown={key}
        />
      </div>
    </div>
  );
}

/** Photo and focal mode (editor.js drawPhoto): the frame, where the whole photo lies around it (faded while it is
 * dragged and while its focal point is set), what the frame will show, and the focal point. */
function drawPhoto(
  ctx: CanvasRenderingContext2D,
  at: ViewAt,
  p: PhotoNote,
  img: HTMLImageElement | undefined,
  win: Win,
  dragging: boolean,
  focal: boolean,
  m: Module,
) {
  const toPx = (x: number, y: number) => [at.ox + x * at.s, at.oy + y * at.s] as const;
  const ext = photoExtent(p.box_mm, win, p.px);
  const [ex0, ey0] = toPx(ext.x0, ext.y0);
  const [ex1, ey1] = toPx(ext.x1, ext.y1);
  const [bx0, by0] = toPx(p.box_mm[0], p.box_mm[1]);
  const [bx1, by1] = toPx(p.box_mm[2], p.box_mm[3]);
  ctx.save();
  if (img && img.complete && img.naturalWidth && (dragging || focal)) {
    ctx.globalAlpha = 0.35;
    ctx.drawImage(img, ex0, ey0, ex1 - ex0, ey1 - ey0);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.rect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.clip();
    ctx.drawImage(img, ex0, ey0, ex1 - ex0, ey1 - ey0);
  }
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(30, 41, 59, 0.7)";
  ctx.strokeRect(ex0 + 0.5, ey0 + 0.5, ex1 - ex0 - 1, ey1 - ey0 - 1); // the whole photo
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#d97706";
  ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); // its frame
  const own = m.crop && m.crop.photo === p.id ? m.crop.focus : null;
  const [fx, fy] = dragging || !own ? focusOf(win, p.px) : own;
  const cx = ex0 + fx * (ex1 - ex0);
  const cy = ey0 + fy * (ey1 - ey0);
  for (const [colour, width] of [
    ["#ffffff", 3],
    ["#d97706", 1.5],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();
  }
  ctx.restore();
}

const RULER = {
  ground: "#e5e7eb", // over the pasteboard
  page: "#fafafa", // along the page
  column: "rgba(139, 92, 246, 0.18)", // a column of the grid (the violet of the page's column guides)
  number: "#5b21b6",
  tick: "#6b7280",
  text: "#374151",
  edge: "#b9bfc8",
  pointer: "#e11d48",
};
const TICK_PX = { major: RULER_PX, mid: 8, minor: 4 } as const;
const RULER_FONT = "9px system-ui, -apple-system, sans-serif";

/** The rulers along the top and left of the view (editor.js drawRulers): mm from the page's top-left corner, the grid's
 * columns numbered at their centres on the top one, and where the pointer is. They cover the view's edges, never the
 * page's content. */
function drawRulers(
  ctx: CanvasRenderingContext2D,
  g: Grid,
  { s, ox, oy }: ViewAt,
  w: number,
  h: number,
  pointer: Pair | null,
) {
  const R = RULER_PX;
  const steps = rulerSteps(s);
  ctx.save();
  ctx.font = RULER_FONT;
  ctx.textBaseline = "top";

  // top: across the page, with its columns
  ctx.save();
  ctx.beginPath();
  ctx.rect(R, 0, w - R, R);
  ctx.clip();
  ctx.fillStyle = RULER.ground;
  ctx.fillRect(R, 0, w - R, R);
  ctx.fillStyle = RULER.page;
  ctx.fillRect(ox, 0, g.page_w_mm * s, R);
  const cols = gridColumns(g);
  ctx.fillStyle = RULER.column;
  for (const c of cols) ctx.fillRect(ox + c.x0 * s, 0, (c.x1 - c.x0) * s, R);
  const across = rulerTicks((R - ox) / s - steps.major, (w - ox) / s, steps);
  ctx.fillStyle = RULER.tick;
  for (const tick of across) ctx.fillRect(Math.round(ox + tick.mm * s), R - TICK_PX[tick.kind], 1, TICK_PX[tick.kind]);
  ctx.fillStyle = RULER.text;
  ctx.textAlign = "left";
  for (const tick of across)
    if (tick.label !== null) ctx.fillText(rulerLabel(tick.label), Math.round(ox + tick.mm * s) + 3, 1);
  ctx.font = "600 10px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  for (const c of cols) {
    const x = ox + c.mid * s;
    const room = ctx.measureText(String(c.n)).width + 6;
    if (room > (c.x1 - c.x0) * s) continue; // too narrow to number at this zoom
    ctx.fillStyle = RULER.page; // the number on a patch of its column, over the ticks
    ctx.fillRect(x - room / 2, 9, room, R - 10);
    ctx.fillStyle = RULER.column;
    ctx.fillRect(x - room / 2, 9, room, R - 10);
    ctx.fillStyle = RULER.number;
    ctx.fillText(String(c.n), x, 9);
  }
  ctx.restore();

  // left: down the page (numbers turned to read upwards)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, R, R, h - R);
  ctx.clip();
  ctx.fillStyle = RULER.ground;
  ctx.fillRect(0, R, R, h - R);
  ctx.fillStyle = RULER.page;
  ctx.fillRect(0, oy, R, g.page_h_mm * s);
  const down = rulerTicks((R - oy) / s - steps.major, (h - oy) / s, steps);
  ctx.fillStyle = RULER.tick;
  for (const tick of down) ctx.fillRect(R - TICK_PX[tick.kind], Math.round(oy + tick.mm * s), TICK_PX[tick.kind], 1);
  ctx.fillStyle = RULER.text;
  ctx.textAlign = "right";
  for (const tick of down) {
    if (tick.label === null) continue;
    ctx.save();
    ctx.translate(1, Math.round(oy + tick.mm * s) + 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(rulerLabel(tick.label), 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // the corner (the unit), the rulers' inner edges, and where the pointer is
  ctx.fillStyle = RULER.ground;
  ctx.fillRect(0, 0, R, R);
  ctx.fillStyle = RULER.text;
  ctx.textAlign = "center";
  ctx.fillText("mm", R / 2, 6);
  ctx.fillStyle = RULER.edge;
  ctx.fillRect(0, R - 1, w, 1);
  ctx.fillRect(R - 1, 0, 1, h);
  if (pointer && pointer[0] >= R && pointer[1] >= R && pointer[0] < w && pointer[1] < h) {
    ctx.fillStyle = RULER.pointer;
    ctx.fillRect(Math.round(pointer[0]), 0, 1, R - 1);
    ctx.fillRect(0, Math.round(pointer[1]), R - 1, 1);
  }
  ctx.restore();
}
