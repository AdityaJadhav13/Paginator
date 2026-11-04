/**
 * A 2D canvas context for the editor's tests that paints nothing and records every call: each fill with the transform
 * it was filled under, so where a glyph lands on the page is read back from what the canvas was told, not from the
 * drawing code's own arithmetic.
 */
export type Matrix = readonly [number, number, number, number, number, number];

/** A glyph outline (a Path2D) the recording context can name. */
export class FakePath {
  constructor(
    readonly face: string,
    readonly gid: number,
  ) {}
}

export function recordingContext() {
  const calls: unknown[][] = [];
  const filled: { readonly path: unknown; readonly m: Matrix }[] = [];
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop === "symbol" || ["fillStyle", "strokeStyle", "lineWidth", "font", "then"].includes(prop))
          return undefined;
        return (...args: unknown[]) => {
          calls.push([prop, ...args]);
          if (prop === "setTransform") m = args as unknown as Matrix;
          if (prop === "fill") filled.push({ path: args[0], m });
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, filled };
}

/** Each glyph filled: its face, id, and its origin on the page (mm) from the recorded matrix, for a view at s px per mm,
 * the page's corner at (ox, oy) px, k device px per px. */
export function glyphsOnPage(
  filled: ReturnType<typeof recordingContext>["filled"],
  at: { readonly s: number; readonly ox: number; readonly oy: number; readonly k: number },
) {
  return filled.flatMap(({ path, m }) =>
    path instanceof FakePath
      ? [{ face: path.face, gid: path.gid, x_mm: (m[4] / at.k - at.ox) / at.s, y_mm: (m[5] / at.k - at.oy) / at.s, m }]
      : [],
  );
}
