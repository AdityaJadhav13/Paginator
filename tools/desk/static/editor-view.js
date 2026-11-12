/* Pageinator Desk — page editor: the arithmetic of the view (rulers and zoom), with no page or screen in it, so that
 * Node's own test runner can check it (tools/desk/test/test_editor_view.mjs). Lengths on the page are in mm; lengths
 * on the screen are in CSS pixels. Nothing here changes the page or what it prints. */

/** The editor's zoom range, as multiples of the scale at which the whole page fits the view. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;

/** A zoom kept in the editor's range. */
export const clampZoom = (zoom) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));

/** The scale (px per mm) at which the whole page fits a view of w × h px with pad px around it. The editor's zoom is a
 * multiple of it (zoom 1, "100%", is the whole page). */
export const fitScale = (w, h, pageW, pageH, pad = 24) => Math.min((w - 2 * pad) / pageW, (h - 2 * pad) / pageH);

/** The zoom at which the page's width fills the view, pad px on each side (1 when the view has no room yet). */
export function fitWidthZoom(w, h, pageW, pageH, pad = 24) {
  const base = fitScale(w, h, pageW, pageH, pad);
  return base > 0 && w > 2 * pad ? (w - 2 * pad) / pageW / base : 1;
}

/** The smallest box ({x0, y0, x1, y1}) around boxes; null for none. */
export function unionBox(boxes) {
  if (!boxes.length) return null;
  return boxes.reduce((u, b) => ({
    x0: Math.min(u.x0, b.x0),
    y0: Math.min(u.y0, b.y0),
    x1: Math.max(u.x1, b.x1),
    y1: Math.max(u.y1, b.y1),
  }));
}

/** The view that shows rect (mm) as large as it fits in area (px, {x0, y0, x1, y1}) with margin px on every side,
 * centred in it, with its zoom kept in the editor's range: {zoom, s (px per mm), ox, oy (where the page's top-left
 * corner is, px)}. base is the fit scale (fitScale). null when there is no view or no box yet. */
export function zoomToRect(rect, area, base, margin = 32) {
  if (!rect || !(base > 0)) return null;
  const room = (a, b) => Math.max(1, b - a - 2 * margin); // a view smaller than its margins still shows the box
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

/** Steps a ruler's numbered ticks may take (mm), and steps for the ticks between them. */
const MAJOR_MM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const MINOR_MM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const whole = (x) => Math.abs(x - Math.round(x)) < 1e-9;

/** A ruler's tick spacing at s px per mm: numbered ticks every major mm, the smallest of 1, 2, 5, 10, 20, 50 … mm that
 * leaves labelPx between numbers; small ticks every minor mm, the smallest step that divides major evenly and leaves
 * tickPx between ticks (major itself when none does). */
export function rulerSteps(s, labelPx = 40, tickPx = 5) {
  const px = s > 0 && Number.isFinite(s) ? s : 0;
  const major = MAJOR_MM.find((mm) => mm * px >= labelPx) ?? MAJOR_MM[MAJOR_MM.length - 1];
  const minor = MINOR_MM.find((mm) => mm < major && mm * px >= tickPx && whole(major / mm)) ?? major;
  return { major, minor };
}

/** The ticks of a ruler from one mm to another, every minor mm: {mm, kind, label}. kind is "major" for a numbered tick
 * (label: its mm, a whole number), "mid" halfway between two numbered ticks when the small steps split the gap evenly,
 * else "minor". No ticks for an empty or reversed range, or for more than limit of them. */
export function rulerTicks(from, to, { major, minor }, limit = 4000) {
  const per = Math.round(major / minor); // small steps between two numbered ticks
  const first = Math.ceil(from / minor - 1e-9);
  const last = Math.floor(to / minor + 1e-9);
  if (!(per >= 1) || !(last - first < limit)) return [];
  const ticks = [];
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
export const rulerLabel = (mm) => (mm < 0 ? `−${-mm}` : String(mm));

/** The page grid's columns (mm): n (from 1), their left and right edges and centre. */
export function gridColumns(grid) {
  const pitch = grid.column_mm + grid.gutter_mm;
  return Array.from({ length: grid.columns }, (_, i) => {
    const x0 = grid.origin_mm + i * pitch;
    return { n: i + 1, x0, x1: x0 + grid.column_mm, mid: x0 + grid.column_mm / 2 };
  });
}

/* Photo crops. The engine decides which pixels of a photo fill its frame (deskedit.crop_window) and sends them as the
 * window [x, y, w, h] (pixels of the whole photo, px = [width, height]); a crop is the point of the photo the frame
 * keeps as near its centre as the photo's edges allow (its focus, fractions of the photo) and a zoom. These are the
 * screen's side of it: where the whole photo lies around its frame, and the focus a pan, a click or an arrow asks for.
 * The engine's answer is what the page shows and prints. */

/** Fractions kept to four places, as the engine keeps a crop. */
const frac = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;

/** The whole photo around its frame box [x0, y0, x1, y1] (mm) when its window fills the frame: {x0, y0, x1, y1} mm. */
export function photoExtent(box, win, px) {
  const sx = (box[2] - box[0]) / win[2];
  const sy = (box[3] - box[1]) / win[3];
  const x0 = box[0] - win[0] * sx;
  const y0 = box[1] - win[1] * sy;
  return { x0, y0, x1: x0 + px[0] * sx, y1: y0 + px[1] * sy };
}

/** The window after the photo is dragged by (dx, dy) mm in its frame: the photo follows the pointer, so the window
 * goes the other way, and it never leaves the photo. Its size stays. */
export function panWindow(win, px, box, dx, dy) {
  const [x, y, w, h] = win;
  const nx = Math.min(px[0] - w, Math.max(0, x - (dx * w) / (box[2] - box[0])));
  const ny = Math.min(px[1] - h, Math.max(0, y - (dy * h) / (box[3] - box[1])));
  return [nx, ny, w, h];
}

/** The focus that keeps a window where it is: its centre, as fractions of the photo (half a pixel more, so the
 * engine, which rounds down, puts it back exactly where it was, whatever the four places of the fractions cut off). */
export const focusOf = (win, px) => [
  frac((Math.round(win[0]) + win[2] / 2 + 0.5) / px[0]),
  frac((Math.round(win[1]) + win[3] / 2 + 0.5) / px[1]),
];

/** The focus at a point of the page (mm) over the whole photo (photoExtent), kept on the photo. */
export const focusAt = (x, y, ext) => [frac((x - ext.x0) / (ext.x1 - ext.x0)), frac((y - ext.y0) / (ext.y1 - ext.y0))];

/** The window of the same size that a focus gives, as the engine places it (centred, inside the photo; whole pixels). */
export function windowAt(focus, win, px) {
  const [, , w, h] = win;
  const x = Math.max(0, Math.min(px[0] - w, Math.floor(focus[0] * px[0] - w / 2)));
  const y = Math.max(0, Math.min(px[1] - h, Math.floor(focus[1] * px[1] - h / 2)));
  return [x, y, w, h];
}

/** The focus an arrow key asks for: the window's centre moved by (fx, fy) of the photo (0.02 a step). */
export const stepFocus = (win, px, fx, fy) => {
  const [cx, cy] = focusOf(win, px);
  return [frac(cx + fx), frac(cy + fy)];
};

/** The resolution a photo prints at with another zoom: the window shrinks as the zoom grows. */
export const ppiAt = (ppi, zoom, next) => (ppi * zoom) / next;
