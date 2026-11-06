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

export type Pair = readonly [number, number];
/** A photo's window: [x, y, w, h], pixels of the whole photo. */
export type Win = readonly [number, number, number, number];

/** A story's photo crop (deskedit.crop_value): the photo's id, the point of the photo (fractions of its width and height)
 * the frame keeps as near its centre as the photo's edges allow, and how much it is enlarged (1: as the layout sets it). */
export interface Crop {
  readonly photo: string;
  readonly focus: Pair;
  readonly zoom: number;
}

export interface Module {
  readonly story: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly locked?: boolean;
  readonly crop?: Crop | null;
  readonly [more: string]: unknown;
}

/** A story's photo as the engine drew it (deskedit._apply_crops): the whole photo's pixels, its frame on the page (mm),
 * the window of the photo the frame shows, the resolution it prints at, its zoom and the most it may have, the lowest
 * resolution allowed for it, its crop's focus, and the raster key of the whole photo (null when it cannot be read). */
export interface PhotoNote {
  readonly id: string;
  readonly px: Pair;
  readonly box_mm: Win;
  readonly window: Win;
  readonly ppi: number;
  readonly zoom: number;
  readonly zoom_max: number;
  readonly floor_ppi: number;
  readonly focus: Pair | null;
  readonly full: string | null;
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
  readonly photo?: PhotoNote | null;
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

// ------------------------------------------------------------------------------------------- rulers

/** Steps a ruler's numbered ticks may take (mm), and steps for the ticks between them. */
const MAJOR_MM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const MINOR_MM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;

export interface RulerSteps {
  readonly major: number;
  readonly minor: number;
}
export interface Tick {
  readonly mm: number;
  readonly kind: "major" | "mid" | "minor";
  readonly label: number | null;
}

/** A ruler's tick spacing at s px per mm: numbered ticks every major mm, the smallest of 1, 2, 5, 10, 20, 50 … mm that
 * leaves labelPx between numbers; small ticks every minor mm, the smallest step that divides major evenly and leaves
 * tickPx between ticks (major itself when none does). */
export function rulerSteps(s: number, labelPx = 40, tickPx = 5): RulerSteps {
  const px = s > 0 && Number.isFinite(s) ? s : 0;
  const major = MAJOR_MM.find((mm) => mm * px >= labelPx) ?? MAJOR_MM[MAJOR_MM.length - 1]!;
  const minor = MINOR_MM.find((mm) => mm < major && mm * px >= tickPx && whole(major / mm)) ?? major;
  return { major, minor };
}

/** The ticks of a ruler from one mm to another, every minor mm. kind is "major" for a numbered tick (label: its mm, a
 * whole number), "mid" halfway between two numbered ticks when the small steps split the gap evenly, else "minor". No
 * ticks for an empty or reversed range, or for more than limit of them. */
export function rulerTicks(from: number, to: number, { major, minor }: RulerSteps, limit = 4000): Tick[] {
  const per = Math.round(major / minor); // small steps between two numbered ticks
  const first = Math.ceil(from / minor - 1e-9);
  const last = Math.floor(to / minor + 1e-9);
  if (!(per >= 1) || !(last - first < limit)) return [];
  const ticks: Tick[] = [];
  for (let k = first; k <= last; k += 1) {
    const numbered = k % per === 0;
    const mid = !numbered && per % 2 === 0 && k % (per / 2) === 0;
    ticks.push({
      mm: k * minor,
      kind: numbered ? "major" : mid ? "mid" : "minor",
      label: numbered ? (k / per) * major : null,
    });
  }
  return ticks;
}

/** A ruler's number as it is shown: a true minus sign left of and above the page's corner. */
export const rulerLabel = (mm: number) => (mm < 0 ? `−${-mm}` : String(mm));

// ------------------------------------------------------------------------------------------- photo crops

/* The engine decides which pixels of a photo fill its frame (deskedit.crop_window) and sends them as the window; a crop
 * is the photo's focus and zoom. These are the screen's side of it (editor-view.js): where the whole photo lies around
 * its frame, and the focus a pan, a click or an arrow asks for. The engine's answer is what the page shows and prints. */

/** Fractions kept to four places, as the engine keeps a crop. */
const frac = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;

/** The whole photo around its frame box (mm) when its window fills the frame. */
export function photoExtent(box: Win, win: Win, px: Pair): Box {
  const sx = (box[2] - box[0]) / win[2];
  const sy = (box[3] - box[1]) / win[3];
  const x0 = box[0] - win[0] * sx;
  const y0 = box[1] - win[1] * sy;
  return { x0, y0, x1: x0 + px[0] * sx, y1: y0 + px[1] * sy };
}

/** The window after the photo is dragged by (dx, dy) mm in its frame: the photo follows the pointer, so the window goes
 * the other way, and it never leaves the photo. Its size stays. */
export function panWindow(win: Win, px: Pair, box: Win, dx: number, dy: number): Win {
  const [x, y, w, h] = win;
  const nx = Math.min(px[0] - w, Math.max(0, x - (dx * w) / (box[2] - box[0])));
  const ny = Math.min(px[1] - h, Math.max(0, y - (dy * h) / (box[3] - box[1])));
  return [nx, ny, w, h];
}

/** The focus that keeps a window where it is: its centre, as fractions of the photo (half a pixel more, so the engine,
 * which rounds down, puts it back exactly where it was, whatever the four places of the fractions cut off). */
export const focusOf = (win: Win, px: Pair): Pair => [
  frac((Math.round(win[0]) + win[2] / 2 + 0.5) / px[0]),
  frac((Math.round(win[1]) + win[3] / 2 + 0.5) / px[1]),
];

/** The focus at a point of the page (mm) over the whole photo (photoExtent), kept on the photo. */
export const focusAt = (x: number, y: number, ext: Box): Pair => [
  frac((x - ext.x0) / (ext.x1 - ext.x0)),
  frac((y - ext.y0) / (ext.y1 - ext.y0)),
];

/** The window of the same size that a focus gives, as the engine places it (centred, inside the photo; whole pixels). */
export function windowAt(focus: Pair, win: Win, px: Pair): Win {
  const [, , w, h] = win;
  const x = Math.max(0, Math.min(px[0] - w, Math.floor(focus[0] * px[0] - w / 2)));
  const y = Math.max(0, Math.min(px[1] - h, Math.floor(focus[1] * px[1] - h / 2)));
  return [x, y, w, h];
}

/** The focus an arrow key asks for: the window's centre moved by (fx, fy) of the photo (0.02 a step). */
export function stepFocus(win: Win, px: Pair, fx: number, fy: number): Pair {
  const [cx, cy] = focusOf(win, px);
  return [frac(cx + fx), frac(cy + fy)];
}

/** The resolution a photo prints at with another zoom: the window shrinks as the zoom grows. */
export const ppiAt = (ppi: number, zoom: number, next: number) => (ppi * zoom) / next;

/** The window the frame shows for a story now (editor.js shownWindow): the one its crop asks for (it may be on its way
 * to the engine), else the engine's. */
export const shownWindow = (m: Module, p: PhotoNote): Win =>
  m.crop && m.crop.photo === p.id ? windowAt(m.crop.focus, p.window, p.px) : p.window;

/** The same crop, to the places the engine keeps (editor.js sameCrop). */
export const sameCrop = (a: Crop | null, b: Crop | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.photo === b.photo &&
    Math.abs(a.focus[0] - b.focus[0]) < 1e-4 &&
    Math.abs(a.focus[1] - b.focus[1]) < 1e-4 &&
    Math.abs(a.zoom - b.zoom) < 1e-3);

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
