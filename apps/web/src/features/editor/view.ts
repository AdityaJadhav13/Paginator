/**
 * The page editor's canvas, as plain TypeScript (a port of the Desk's tools/desk/static/editor-view.js and the drawing
 * of editor.js): the engine's display list (EditorPage.view, deskedit.draw()'s result as it is) read, the view's
 * arithmetic (fit and zoom), the grid's snapping as the engine snaps, hit testing, and the page drawn from the PDF's own
 * glyph outlines. Lengths on the page are in mm, on the screen in CSS px. Nothing here changes what the page prints.
 */

export interface Grid {
  readonly page_w_mm: number;
  readonly page_h_mm: number;
  readonly origin_mm: number;
  readonly column_mm: number;
  readonly gutter_mm: number;
  readonly columns: number;
  readonly news_top_mm: number;
  readonly news_bottom_mm: number;
  readonly snap_mm: number;
}

export interface Module {
  readonly story: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly locked?: boolean;
  readonly crop?: unknown;
  readonly [more: string]: unknown;
}

export type Cmyk = readonly [number, number, number, number];
export type Item =
  | {
      readonly t: "text";
      readonly f: string;
      readonly s: number;
      readonly hs?: number;
      readonly c: Cmyk;
      readonly g: readonly (readonly [number, number, number])[];
    }
  | {
      readonly t: "rect";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly c: Cmyk;
    }
  | {
      readonly t: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly lw: number;
      readonly c: Cmyk;
    }
  | {
      readonly t: "img";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly src: string;
      readonly sub?: readonly [number, number, number, number];
    };

export interface Note {
  readonly story: string;
  readonly fit: string;
  readonly by_mm: number;
  readonly articles: readonly string[];
  readonly headline: string;
}
export interface Problem {
  readonly kind: string;
  readonly stories?: readonly string[];
  readonly mm?: number;
  readonly mm2?: number;
  readonly lines?: number;
  readonly words?: number;
  readonly paragraphs?: number;
}
export interface PoolStory {
  readonly story: string;
  readonly headline: string;
  readonly articles: readonly string[];
  readonly brief: boolean;
  readonly on_page: number | null;
  readonly locked: boolean;
}

export interface PageView {
  readonly page: number;
  readonly role: string;
  readonly rev: number;
  readonly modules: readonly Module[];
  readonly notes: readonly Note[];
  readonly problems: readonly Problem[];
  readonly pool: readonly PoolStory[];
  readonly grid: Grid;
  readonly also_on_pages: Readonly<Record<string, number>>;
  readonly locked_on_pages: Readonly<Record<string, number>>;
  readonly items: readonly Item[];
  readonly fonts: Readonly<Record<string, { readonly face: string; readonly upem: number }>>;
}

const isArray = Array.isArray;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !isArray(v);

/** The engine's display list, read (null when it is not one: the screen says the page cannot be shown). */
export function readView(raw: Record<string, unknown>): PageView | null {
  const ok =
    isArray(raw["modules"]) &&
    isArray(raw["items"]) &&
    isRecord(raw["grid"]) &&
    isRecord(raw["fonts"]) &&
    typeof raw["grid"]["page_w_mm"] === "number";
  if (!ok) return null;
  return {
    notes: [],
    problems: [],
    pool: [],
    also_on_pages: {},
    locked_on_pages: {},
    ...raw,
  } as unknown as PageView;
}

// ------------------------------------------------------------------------------------------- the view's arithmetic

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;
export const PT_PER_MM = 72 / 25.4;
export const MIN_H_MM = 10;
export const HANDLE_PX = 7;
/** The problem kinds the print file would show. */
export const BAD = new Set(["overlap", "outside", "over", "cannot_set", "overset", "unset"]);

export const clampZoom = (zoom: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));

/** The scale (px per mm) at which the whole page fits a view of w × h px with pad px around it. */
export const fitScale = (w: number, h: number, pageW: number, pageH: number, pad = 24) =>
  Math.min((w - 2 * pad) / pageW, (h - 2 * pad) / pageH);

/** The zoom at which the page's width fills the view, pad px on each side (1 when the view has no room yet). */
export function fitWidthZoom(w: number, h: number, pageW: number, pageH: number, pad = 24) {
  const base = fitScale(w, h, pageW, pageH, pad);
  return base > 0 && w > 2 * pad ? (w - 2 * pad) / pageW / base : 1;
}

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The smallest box around boxes; null for none. */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.reduce((u, b) => ({
    x0: Math.min(u.x0, b.x0),
    y0: Math.min(u.y0, b.y0),
    x1: Math.max(u.x1, b.x1),
    y1: Math.max(u.y1, b.y1),
  }));
}

export interface ViewAt {
  /** px per mm */
  readonly s: number;
  /** where the page's top-left corner is (px) */
  readonly ox: number;
  readonly oy: number;
}

/** The view that shows rect (mm) as large as it fits in area (px) with margin px around it, centred, its zoom in range. */
export function zoomToRect(
  rect: Box | null,
  area: Box,
  base: number,
  margin = 32,
): (ViewAt & { readonly zoom: number }) | null {
  if (!rect || !(base > 0)) return null;
  const room = (a: number, b: number) => Math.max(1, b - a - 2 * margin);
  const fits = Math.min(
    room(area.x0, area.x1) / Math.max(rect.x1 - rect.x0, 1e-3),
    room(area.y0, area.y1) / Math.max(rect.y1 - rect.y0, 1e-3),
  );
  const zoom = clampZoom(fits / base);
  const s = base * zoom;
  return {
    zoom,
    s,
    ox: (area.x0 + area.x1) / 2 - ((rect.x0 + rect.x1) / 2) * s,
    oy: (area.y0 + area.y1) / 2 - ((rect.y0 + rect.y1) / 2) * s,
  };
}

/** The grid's columns (mm): n (from 1), their left and right edges and centre. */
export function gridColumns(grid: Pick<Grid, "origin_mm" | "column_mm" | "gutter_mm" | "columns">) {
  const pitch = grid.column_mm + grid.gutter_mm;
  return Array.from({ length: grid.columns }, (_, i) => {
    const x0 = grid.origin_mm + i * pitch;
    return { n: i + 1, x0, x1: x0 + grid.column_mm, mid: x0 + grid.column_mm / 2 };
  });
}

// ------------------------------------------------------------------------------------------- modules on the grid

export const span = (g: Grid, w: number) => w * g.column_mm + (w - 1) * g.gutter_mm;
const pitch = (g: Grid) => g.column_mm + g.gutter_mm;
export const colOf = (g: Grid, x: number) => Math.round((x - g.origin_mm) / pitch(g));
export const boxOf = (g: Grid, m: Module): Box => ({ x0: m.x, y0: m.y, x1: m.x + span(g, m.w), y1: m.y + m.h });

const SAME_MM = 0.01;
/** The same place and size (to a hundredth of a mm). */
export const samePlace = (a: Module, b: Module) =>
  a.w === b.w && Math.abs(a.x - b.x) < SAME_MM && Math.abs(a.y - b.y) < SAME_MM && Math.abs(a.h - b.h) < SAME_MM;

/** The module on the grid, as the engine snaps it (editor.js snapModule): whole columns; y and h in whole steps from
 * the news area's top, inside it. keep "h" (a move): pushed past the foot it stops there with its height; keep "y" (a
 * resize): it keeps its top and is shortened to the foot. */
export function snapModule<M extends Module>(g: Grid, m: M, keep: "h" | "y" = "h"): M {
  const w = Math.max(1, Math.min(g.columns, Math.round(m.w)));
  const col = Math.max(0, Math.min(g.columns - w, colOf(g, m.x)));
  const step = g.snap_mm;
  const top = g.news_top_mm;
  const steps = Math.floor((g.news_bottom_mm - top) / step + 1e-9);
  const least = Math.ceil(MIN_H_MM / step - 1e-9);
  let yk = Math.max(0, Math.round((m.y - top) / step));
  let hk = Math.max(least, Math.round(m.h / step));
  if (keep === "h") {
    hk = Math.min(hk, steps);
    yk = Math.min(yk, steps - hk);
  } else {
    yk = Math.min(yk, steps - least);
    hk = Math.min(hk, steps - yk);
  }
  return { ...m, x: g.origin_mm + col * pitch(g), y: top + yk * step, w, h: hk * step };
}

export type Part = "body" | "right" | "bottom" | "corner";

/** What is under the pointer (px): the selected module's handles first (a locked one has none), then the topmost
 * module. */
export function hitTest(
  g: Grid,
  modules: readonly Module[],
  selected: string | null,
  at: ViewAt,
  px: number,
  py: number,
): { readonly story: string; readonly part: Part } | null {
  const toPx = (x: number, y: number) => [at.ox + x * at.s, at.oy + y * at.s] as const;
  const sel = modules.find((m) => m.story === selected);
  if (sel && !sel.locked) {
    const b = boxOf(g, sel);
    const [x0, y0] = toPx(b.x0, b.y0);
    const [x1, y1] = toPx(b.x1, b.y1);
    const nearR = Math.abs(px - x1) <= HANDLE_PX && py >= y0 && py <= y1;
    const nearB = Math.abs(py - y1) <= HANDLE_PX && px >= x0 && px <= x1;
    if (nearR && nearB) return { story: sel.story, part: "corner" };
    if (nearR) return { story: sel.story, part: "right" };
    if (nearB) return { story: sel.story, part: "bottom" };
  }
  const x = (px - at.ox) / at.s;
  const y = (py - at.oy) / at.s;
  for (let i = modules.length - 1; i >= 0; i -= 1) {
    const m = modules[i]!;
    const b = boxOf(g, m);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { story: m.story, part: "body" };
  }
  return null;
}

/** A module dragged by (dx, dy) mm from where it was: moved ("body") or resized (a handle), then snapped. */
export function dragged(g: Grid, m: Module, part: Part, dx: number, dy: number): Module {
  if (part === "body") return snapModule(g, { ...m, x: m.x + dx, y: m.y + dy }, "h");
  // the left edge stays: at most the columns to the right of it
  const w =
    part === "bottom"
      ? m.w
      : Math.max(1, Math.min(g.columns - colOf(g, m.x), Math.round((span(g, m.w) + dx + g.gutter_mm) / pitch(g))));
  const h = part === "right" ? m.h : m.h + dy;
  return snapModule(g, { ...m, w, h }, part === "right" ? "h" : "y");
}

// ------------------------------------------------------------------------------------------- problems in words

/** A problem as the Desk words it (editor.js problemMsg): [the catalogue key, its parameters]; null for a kind the
 * editor does not know (named as the engine names it). name(story) is the story's name ("“headline”"). */
export function problemMsg(
  p: Problem,
  name: (story: string) => string,
): readonly [string, Record<string, string | number>] | null {
  const names = (p.stories ?? []).map(name);
  const first = names[0] ?? "";
  const mm = String(Math.round(p.mm ?? 0));
  switch (p.kind) {
    case "overlap":
      return ["pageEditor.p.overlap", { a: names[0] ?? "", b: names[1] ?? "", mm }];
    case "outside":
      return ["pageEditor.p.outside", { name: first }];
    case "over":
      return ["pageEditor.p.over", { name: first, mm }];
    case "overset":
      return p.lines
        ? ["pageEditor.p.oversetLines", { name: first, n: p.lines }]
        : ["pageEditor.p.oversetWords", { name: first, n: p.words ?? 0 }];
    case "unset":
      return ["pageEditor.p.unset", { name: first, n: p.paragraphs ?? 0 }];
    case "short":
      return ["pageEditor.p.short", { name: first, mm }];
    case "cannot_set":
      return ["pageEditor.p.cannotSet", { name: first }];
    case "empty":
      return ["pageEditor.p.empty", { n: Math.round((p.mm2 ?? 0) / 100) }];
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------- drawing

/** CMYK (0..1) as the screen's RGB: the editor's approximation (editor.js cmyk), not a colour-managed proof. */
export function cmyk(c: Cmyk): string {
  const [C, M, Y, K] = c.map((v) => Math.max(0, Math.min(1, v))) as unknown as Cmyk;
  return `rgb(${Math.round(255 * (1 - C) * (1 - K))},${Math.round(255 * (1 - M) * (1 - K))},${Math.round(255 * (1 - Y) * (1 - K))})`;
}

export interface DrawOptions extends ViewAt {
  /** device pixels per CSS px */
  readonly k: number;
  /** glyph outlines by `${face}:${gid}` */
  readonly glyphs: ReadonlyMap<string, Path2D>;
  readonly images: ReadonlyMap<string, HTMLImageElement>;
}

/** The page's content (editor.js drawContent): the paper, the news area's column guides and the display list. Each
 * glyph is filled from its outline with its own transform (font units, y up), so where it lands on the page can be read
 * back from the transform (tests/editor/screen-print.test.ts). */
export function drawPage(ctx: CanvasRenderingContext2D, view: PageView, o: DrawOptions): void {
  const g = view.grid;
  const { s, ox, oy, k } = o;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(ox * k, oy * k, g.page_w_mm * s * k, g.page_h_mm * s * k);
  ctx.strokeStyle = "rgba(139, 92, 246, 0.25)";
  ctx.lineWidth = 1;
  for (const col of gridColumns(g)) {
    for (const x of [col.x0, col.x1]) {
      ctx.beginPath();
      ctx.moveTo((ox + x * s) * k, (oy + g.news_top_mm * s) * k);
      ctx.lineTo((ox + x * s) * k, (oy + g.news_bottom_mm * s) * k);
      ctx.stroke();
    }
  }
  for (const it of view.items) {
    if (it.t === "text") {
      const f = view.fonts[it.f];
      if (!f) continue;
      const unit = (it.s / PT_PER_MM / f.upem) * s * k; // device px per font unit
      ctx.fillStyle = cmyk(it.c);
      for (const [gid, x, y] of it.g) {
        const path = o.glyphs.get(`${f.face}:${gid}`);
        if (!path) continue;
        ctx.setTransform(unit * (it.hs || 1), 0, 0, -unit, (ox + x * s) * k, (oy + y * s) * k); // font units are y up
        ctx.fill(path);
      }
      continue;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (it.t === "rect") {
      ctx.fillStyle = cmyk(it.c);
      ctx.fillRect((ox + it.x * s) * k, (oy + it.y * s) * k, it.w * s * k, it.h * s * k);
    } else if (it.t === "line") {
      ctx.strokeStyle = cmyk(it.c);
      ctx.lineWidth = Math.max(0.6, (it.lw / PT_PER_MM) * s * k);
      ctx.beginPath();
      ctx.moveTo((ox + it.x1 * s) * k, (oy + it.y1 * s) * k);
      ctx.lineTo((ox + it.x2 * s) * k, (oy + it.y2 * s) * k);
      ctx.stroke();
    } else {
      const img = o.images.get(it.src);
      const box = [(ox + it.x * s) * k, (oy + it.y * s) * k, it.w * s * k, it.h * s * k] as const;
      if (img && img.complete && img.naturalWidth) {
        if (it.sub) {
          const [sx, sy, sw, sh] = it.sub; // a cropped photo: the part of the whole photo that prints
          const [nw, nh] = [img.naturalWidth, img.naturalHeight];
          ctx.drawImage(img, sx * nw, sy * nh, sw * nw, sh * nh, ...box);
        } else ctx.drawImage(img, ...box);
      } else {
        ctx.fillStyle = "#e5e7eb";
        ctx.fillRect(...box);
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** The outlines a view needs and the editor does not have yet: face → glyph ids. */
export function missingGlyphs(view: PageView, have: ReadonlyMap<string, unknown>): Map<string, number[]> {
  const need = new Map<string, Set<number>>();
  for (const it of view.items) {
    if (it.t !== "text") continue;
    const f = view.fonts[it.f];
    if (!f) continue;
    const set = need.get(f.face) ?? new Set<number>();
    need.set(f.face, set);
    for (const [gid] of it.g) if (!have.has(`${f.face}:${gid}`)) set.add(gid);
  }
  return new Map([...need].filter(([, set]) => set.size > 0).map(([face, set]) => [face, [...set]]));
}
