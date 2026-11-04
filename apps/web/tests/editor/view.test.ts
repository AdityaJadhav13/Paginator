/**
 * The page editor's view arithmetic and display list (src/features/editor/view.ts), with the cases of the Desk's own
 * tests (tools/desk/test/test_editor_view.mjs) for the helpers ported, and the grid snapping, hit testing, problem
 * wording and draw log. The page and grid are fictional (300 × 500 mm, 6 columns of 40 mm with 5 mm gutters from 15 mm).
 */
import { describe, expect, it } from "vitest";
import { FakePath, glyphsOnPage, recordingContext } from "./fake-canvas.ts";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  boxOf,
  clampZoom,
  cmyk,
  dragged,
  drawPage,
  fitScale,
  fitWidthZoom,
  gridColumns,
  hitTest,
  missingGlyphs,
  problemMsg,
  readView,
  snapModule,
  unionBox,
  zoomToRect,
  type Grid,
  type PageView,
} from "../../src/features/editor/view.ts";

const PAGE_W = 300;
const PAGE_H = 500;
const GRID: Grid = {
  page_w_mm: PAGE_W,
  page_h_mm: PAGE_H,
  origin_mm: 15,
  column_mm: 40,
  gutter_mm: 5,
  columns: 6,
  news_top_mm: 50,
  news_bottom_mm: 480,
  snap_mm: 5,
};
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("the view's arithmetic (the Desk's cases)", () => {
  it("grid columns: numbered from 1, with their edges and centres", () => {
    const cols = gridColumns(GRID);
    expect(cols.length).toBe(6);
    expect(cols[0]).toEqual({ n: 1, x0: 15, x1: 55, mid: 35 });
    expect(cols[2]).toEqual({ n: 3, x0: 105, x1: 145, mid: 125 });
    expect(cols[5]!.x1).toBe(280);
  });

  it("fit scale: the whole page inside the view with 24 px around it", () => {
    near(fitScale(880, 950, PAGE_W, PAGE_H), (950 - 48) / PAGE_H);
    near(fitScale(500, 2000, PAGE_W, PAGE_H), (500 - 48) / PAGE_W);
  });

  it("fit width: the page's width fills the view, 24 px each side", () => {
    const zoom = fitWidthZoom(880, 950, PAGE_W, PAGE_H);
    near(fitScale(880, 950, PAGE_W, PAGE_H) * zoom * PAGE_W, 880 - 48);
    expect(fitWidthZoom(30, 30, PAGE_W, PAGE_H)).toBe(1);
  });

  it("zoom stays in the editor's range", () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(2)).toBe(2);
  });

  it("union box: the smallest box around boxes, none for none", () => {
    expect(unionBox([])).toBeNull();
    expect(
      unionBox([
        { x0: 10, y0: 20, x1: 30, y1: 40 },
        { x0: 5, y0: 25, x1: 50, y1: 35 },
      ]),
    ).toEqual({ x0: 5, y0: 20, x1: 50, y1: 40 });
  });

  it("zoom to a box: as large as it fits, centred, in range; none without a box or a view", () => {
    const area = { x0: 0, y0: 0, x1: 864, y1: 964 };
    const base = fitScale(864, 964, PAGE_W, PAGE_H);
    const v = zoomToRect({ x0: 100, y0: 100, x1: 200, y1: 150 }, area, base)!;
    near(v.s, (864 - 64) / 100);
    near(v.ox + 150 * v.s, 432);
    near(v.oy + 125 * v.s, 482);
    expect(zoomToRect({ x0: 0, y0: 0, x1: 0.01, y1: 0.01 }, area, base)!.zoom).toBe(ZOOM_MAX);
    expect(zoomToRect(null, area, base)).toBeNull();
    expect(zoomToRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, area, 0)).toBeNull();
  });
});

describe("modules on the grid (editor.js snapModule)", () => {
  it("snaps a move to whole columns and grid steps from the news area's top", () => {
    const m = snapModule(GRID, { story: "d0000000001", x: 63, y: 57.4, w: 2, h: 101 });
    expect(m).toMatchObject({ x: 60, y: 55, w: 2, h: 100 });
  });

  it("keeps a moved module inside the news area with its height; a resize is shortened to the foot", () => {
    expect(snapModule(GRID, { story: "d1", x: 500, y: 470, w: 2, h: 100 })).toMatchObject({ x: 195, y: 380, h: 100 });
    expect(snapModule(GRID, { story: "d1", x: 15, y: 470, w: 9, h: 100 }, "y")).toMatchObject({ w: 6, y: 470, h: 10 });
    expect(snapModule(GRID, { story: "d1", x: 15, y: 50, w: 0, h: 2 })).toMatchObject({ w: 1, h: 10 }); // at least 10 mm
  });

  it("a drag moves the body, or resizes from the right or bottom edge keeping the left edge and top", () => {
    const m = { story: "d1", x: 60, y: 100, w: 2, h: 100 };
    expect(dragged(GRID, m, "body", 46, 12)).toMatchObject({ x: 105, y: 110, w: 2, h: 100 });
    expect(dragged(GRID, m, "right", 44, 0)).toMatchObject({ x: 60, w: 3, h: 100 });
    expect(dragged(GRID, m, "right", 999, 0)).toMatchObject({ w: 5 }); // at most the columns right of its left edge
    expect(dragged(GRID, m, "bottom", 0, 22)).toMatchObject({ y: 100, w: 2, h: 120 });
    expect(dragged(GRID, m, "corner", 44, 22)).toMatchObject({ w: 3, h: 120 });
  });

  it("hit test: the selected module's handles first (none when locked), then the topmost module", () => {
    const at = { s: 2, ox: 10, oy: 10 };
    const mods = [
      { story: "a", x: 15, y: 50, w: 2, h: 100 },
      { story: "b", x: 15, y: 100, w: 1, h: 20 },
    ];
    const px = (x: number, y: number) => [at.ox + x * at.s, at.oy + y * at.s] as const;
    const right = boxOf(GRID, mods[0]!).x1;
    expect(hitTest(GRID, mods, null, at, ...px(20, 110))).toEqual({ story: "b", part: "body" });
    expect(hitTest(GRID, mods, null, at, ...px(80, 60))).toEqual({ story: "a", part: "body" });
    expect(hitTest(GRID, mods, "a", at, ...px(right, 60))).toEqual({ story: "a", part: "right" });
    expect(hitTest(GRID, mods, "a", at, ...px(60, 150))).toEqual({ story: "a", part: "bottom" });
    expect(hitTest(GRID, mods, "a", at, ...px(right, 150))).toEqual({ story: "a", part: "corner" });
    const locked = [{ ...mods[0]!, locked: true }];
    expect(hitTest(GRID, locked, "a", at, ...px(right, 60))).toEqual({ story: "a", part: "body" });
    expect(hitTest(GRID, mods, null, at, ...px(200, 400))).toBeNull();
  });
});

describe("problems in the Desk's words (editor.js problemMsg)", () => {
  const name = (s: string) => `“${s}”`;
  it("names each kind the editor knows, and none for one it does not", () => {
    expect(problemMsg({ kind: "overlap", stories: ["A", "B"], mm: 3.6 }, name)).toEqual([
      "pageEditor.p.overlap",
      { a: "“A”", b: "“B”", mm: "4" },
    ]);
    expect(problemMsg({ kind: "outside", stories: ["A"] }, name)).toEqual(["pageEditor.p.outside", { name: "“A”" }]);
    expect(problemMsg({ kind: "over", stories: ["A"], mm: 12.2 }, name)).toEqual([
      "pageEditor.p.over",
      { name: "“A”", mm: "12" },
    ]);
    expect(problemMsg({ kind: "short", stories: ["A"], mm: 9.6 }, name)![0]).toBe("pageEditor.p.short");
    expect(problemMsg({ kind: "cannot_set", stories: ["A"] }, name)![0]).toBe("pageEditor.p.cannotSet");
    expect(problemMsg({ kind: "empty", stories: [], mm2: 1260 }, name)).toEqual(["pageEditor.p.empty", { n: 13 }]);
    expect(problemMsg({ kind: "overset", stories: ["A"], lines: 2 }, name)![0]).toBe("pageEditor.p.oversetLines");
    expect(problemMsg({ kind: "overset", stories: ["A"], words: 1 }, name)![0]).toBe("pageEditor.p.oversetWords");
    expect(problemMsg({ kind: "unset", stories: ["A"], paragraphs: 1 }, name)![0]).toBe("pageEditor.p.unset");
    expect(problemMsg({ kind: "something_new" }, name)).toBeNull();
  });
});

describe("the display list", () => {
  const view = readView({
    page: 1,
    role: "front",
    rev: 0,
    modules: [],
    grid: GRID,
    items: [
      { t: "rect", x: 0, y: 0, w: 10, h: 10, c: [0, 0, 0, 1] },
      {
        t: "text",
        f: "F1",
        s: 10,
        hs: 0.9,
        c: [0, 0, 0, 1],
        g: [
          [3, 20.125, 60.5],
          [4, 25, 60.5],
          [99, 30, 60.5],
        ],
      },
      { t: "text", f: "F2", s: 12, c: [0, 0, 0, 1], g: [[7, 40, 70]] },
      { t: "text", f: "missing", s: 12, c: [0, 0, 0, 1], g: [[8, 40, 70]] },
    ],
    fonts: { F1: { face: "a".repeat(24), upem: 1000 }, F2: { face: "b".repeat(24), upem: 2048 } },
  }) as PageView;

  it("reads a display list, refusing one that is not", () => {
    expect(view.notes).toEqual([]);
    expect(readView({ items: [] })).toBeNull();
  });

  it("CMYK as the screen's RGB (the editor's approximation)", () => {
    expect(cmyk([0, 0, 0, 0])).toBe("rgb(255,255,255)");
    expect(cmyk([0, 0, 0, 1])).toBe("rgb(0,0,0)");
    expect(cmyk([1, 0, 0, 0])).toBe("rgb(0,255,255)");
    expect(cmyk([0, 0.5, 2, -1])).toBe("rgb(255,128,0)");
  });

  it("asks for the outlines it does not have, per face", () => {
    const have = new Map([[`${"a".repeat(24)}:3`, {}]]);
    expect([...missingGlyphs(view, have)]).toEqual([
      ["a".repeat(24), [4, 99]],
      ["b".repeat(24), [7]],
    ]);
  });

  it("every glyph filled at its place on the page, whatever the zoom and device scale", () => {
    const glyphs = new Map(
      (
        [
          ["a".repeat(24), 3],
          ["a".repeat(24), 4],
          ["b".repeat(24), 7],
        ] as const
      ).map(([face, gid]) => [`${face}:${gid}`, new FakePath(face, gid) as unknown as Path2D]),
    );
    for (const [s, ox, oy, k] of [
      [1, 0, 0, 1],
      [2.37, 13.5, -40, 2],
    ] as const) {
      const { ctx, filled } = recordingContext();
      drawPage(ctx, view, { s, ox, oy, k, glyphs, images: new Map() });
      const drawn = glyphsOnPage(filled, { s, ox, oy, k });
      expect(drawn.map((g) => [g.face.slice(0, 1), g.gid])).toEqual([
        ["a", 3],
        ["a", 4],
        ["b", 7],
      ]); // an outline the editor does not have is not drawn
      near(drawn[0]!.x_mm, 20.125, 1e-9);
      near(drawn[0]!.y_mm, 60.5, 1e-9);
      near(drawn[2]!.x_mm, 40, 1e-9);
    }
  });

  it("draws on a canvas with the glyph's own transform: size over upem, horizontal scale, y up", () => {
    const calls: unknown[][] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "fillStyle" || prop === "strokeStyle" || prop === "lineWidth"
            ? undefined
            : (...args: unknown[]) => calls.push([prop, ...args]),
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const glyphs = new Map([[`${"a".repeat(24)}:3`, {} as Path2D]]);
    drawPage(ctx, view, { s: 2, ox: 0, oy: 0, k: 1, glyphs, images: new Map() });
    const unit = (10 / (72 / 25.4) / 1000) * 2;
    const glyph = calls.find((c) => c[0] === "setTransform" && c[1] !== 1)!;
    near(glyph[1] as number, unit * 0.9);
    near(glyph[4] as number, -unit);
    near(glyph[5] as number, 40.25);
    expect(calls.filter((c) => c[0] === "fill").length).toBe(1);
  });
});
