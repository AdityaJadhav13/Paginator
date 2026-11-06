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
  focusAt,
  focusOf,
  panWindow,
  photoExtent,
  ppiAt,
  rulerLabel,
  rulerSteps,
  rulerTicks,
  sameCrop,
  shownWindow,
  stepFocus,
  windowAt,
  type Grid,
  type PageView,
  type PhotoNote,
  type Win,
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

describe("the rulers (the Desk's cases)", () => {
  const divides = (step: number, mm: number) => Math.abs(mm / step - Math.round(mm / step)) < 1e-9;
  const SCALES = Array.from({ length: 120 }, (_, i) => 0.05 * 1.08 ** i); // 0.05 … about 450 px per mm
  const MAJORS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

  it("steps: numbered ticks at least 40 px apart, at the smallest of 1, 2, 5, 10, 20, 50 … mm", () => {
    for (const s of SCALES) {
      const { major } = rulerSteps(s);
      const i = MAJORS.indexOf(major);
      expect(i, `${major} mm at ${s} px/mm`).toBeGreaterThanOrEqual(0);
      if (major * s < 40) expect(major).toBe(1000);
      if (i > 0) expect(MAJORS[i - 1]! * s).toBeLessThan(40);
    }
  });

  it("steps: small ticks divide the numbered step evenly, far enough apart, as fine as they can be", () => {
    const MINORS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
    for (const [labelPx, tickPx] of [
      [40, 5],
      [40, 15],
      [30, 3],
      [60, 8],
      [40, 25],
    ] as const) {
      for (const s of SCALES) {
        const { major, minor } = rulerSteps(s, labelPx, tickPx);
        expect(divides(minor, major), `${minor} | ${major} at ${s}`).toBe(true);
        expect(minor === major || minor * s >= tickPx, `${minor} mm at ${s}`).toBe(true);
        for (const finer of MINORS.filter((m) => m < minor && divides(m, major)))
          expect(finer * s).toBeLessThan(tickPx);
      }
    }
    expect(rulerSteps(10, 40, 15)).toEqual({ major: 5, minor: 5 }); // 2 mm is far enough apart, but 5 / 2 is not whole
  });

  it("ticks at every zoom: numbered with whole millimetres where they stand, evenly spaced", () => {
    for (const s of SCALES) {
      const steps = rulerSteps(s);
      const ticks = rulerTicks(-60, -60 + 3000 / s, steps); // a ruler 3000 px long, from left of the page
      expect(ticks.length > 0 && ticks.length <= 3000 / 5 + 1, `${ticks.length} ticks at ${s}`).toBe(true);
      for (const [i, t] of ticks.entries()) {
        if (i) near(t.mm - ticks[i - 1]!.mm, steps.minor);
        if (t.kind !== "major") continue;
        expect(Number.isInteger(t.label)).toBe(true);
        near(t.label!, t.mm);
      }
    }
  });

  it("steps at the zooms an editor shows, and for a scale that is none", () => {
    expect(rulerSteps(1.67)).toEqual({ major: 50, minor: 5 }); // a page fitted to a laptop's view
    expect(rulerSteps(2.09)).toEqual({ major: 20, minor: 5 });
    expect(rulerSteps(5)).toEqual({ major: 10, minor: 1 });
    expect(rulerSteps(13.4)).toEqual({ major: 5, minor: 0.5 });
    expect(rulerSteps(50)).toEqual({ major: 1, minor: 0.1 });
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY])
      expect(rulerSteps(bad)).toEqual({ major: 1000, minor: 1000 });
  });

  it("ticks: every small step, numbered at the numbered steps, mid ticks halfway, also left of the page", () => {
    const ticks = rulerTicks(-12, 64, { major: 20, minor: 5 });
    expect(ticks.map((t) => t.mm)).toEqual([-10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(ticks.filter((t) => t.kind === "major").map((t) => t.label)).toEqual([0, 20, 40, 60]);
    expect(ticks.filter((t) => t.kind === "mid").map((t) => t.mm)).toEqual([-10, 10, 30, 50]);
    for (const t of ticks) if (t.kind !== "major") expect(t.label).toBeNull();
    expect(rulerTicks(0, 100, { major: 50, minor: 10 }).every((t) => t.kind !== "mid")).toBe(true);
  });

  it("ticks: whole-mm numbers and even spacing with tenth-of-a-mm steps", () => {
    const ticks = rulerTicks(0.05, 10.01, { major: 1, minor: 0.1 });
    expect(ticks.length).toBe(100); // 0.1 … 10.0
    expect(ticks.filter((t) => t.kind === "major").map((t) => t.label)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 1; i < ticks.length; i += 1) near(ticks[i]!.mm - ticks[i - 1]!.mm, 0.1, 1e-12);
    const mids = ticks.filter((t) => t.kind === "mid").map((t) => t.mm);
    expect(mids.length).toBe(10);
    for (const [i, mm] of mids.entries()) near(mm, i + 0.5, 1e-12);
  });

  it("ticks: none for an empty, reversed or unreadable range, or one too long to draw", () => {
    expect(rulerTicks(10, 5, { major: 10, minor: 1 })).toEqual([]);
    expect(rulerTicks(Number.NaN, 5, { major: 10, minor: 1 })).toEqual([]);
    expect(rulerTicks(0, 1e6, { major: 1, minor: 0.1 })).toEqual([]);
    expect(rulerTicks(0, 0, { major: 10, minor: 1 }).length).toBe(1);
  });

  it("labels: a true minus sign left of and above the page's corner", () => {
    expect(rulerLabel(-20)).toBe("−20");
    expect(rulerLabel(0)).toBe("0");
    expect(rulerLabel(-0)).toBe("0");
    expect(rulerLabel(340)).toBe("340");
  });
});

describe("photo crops (the Desk's cases)", () => {
  // a fictional 2000 × 1500 photo whose window [500, 375, 1000, 750] fills a frame 100 × 75 mm at (50, 200)
  const PX = [2000, 1500] as const;
  const WIN = [500, 375, 1000, 750] as const;
  const BOX = [50, 200, 150, 275] as const;

  it("the whole photo lies around its frame at the window's scale", () => {
    const ext = photoExtent(BOX, WIN, PX);
    near(ext.x0, 0); // 500 px at 0.1 mm a pixel left of the frame
    near(ext.y0, 162.5);
    near(ext.x1, 200);
    near(ext.y1, 312.5);
  });

  it("a pan moves the window against the pointer and never out of the photo", () => {
    expect(panWindow(WIN, PX, BOX, 10, -5)).toEqual([400, 425, 1000, 750]); // 10 mm right: 100 px to the left
    expect(panWindow(WIN, PX, BOX, 1000, 1000)).toEqual([0, 0, 1000, 750]);
    expect(panWindow(WIN, PX, BOX, -1000, -1000)).toEqual([1000, 750, 1000, 750]);
    expect(panWindow([0, 0, 2000, 1500], PX, BOX, 30, 30)).toEqual([0, 0, 2000, 1500]); // all of it: nowhere to go
  });

  it("a window's focus brings the engine back to the same window, pixel for pixel", () => {
    for (const px of [PX, [1999, 1333], [37, 1000], [640, 480]] as const)
      for (const w of [1, 7, 333, Math.min(px[0], 1000)].filter((v) => v <= px[0]))
        for (const x of [0, 1, Math.floor((px[0] - w) / 3), px[0] - w].filter((v) => v <= px[0] - w)) {
          const win: Win = [x, 0, w, Math.min(px[1], 5)];
          expect(windowAt(focusOf(win, px), win, px), `${px} ${win}`).toEqual(win);
        }
  });

  it("a click sets the focus under it, kept on the photo", () => {
    const ext = photoExtent(BOX, WIN, PX);
    expect(focusAt(50, 200, ext)).toEqual([0.25, 0.25]); // the frame's top left corner
    expect(focusAt(-20, 400, ext)).toEqual([0, 1]);
  });

  it("an arrow moves the focus a step from the window's centre", () => {
    const [fx, fy] = stepFocus(WIN, PX, 0.02, -0.1);
    near(fx, 0.5203); // the centre (half a pixel on) and 2 %
    near(fy, 0.4003);
    expect(stepFocus([1000, 750, 1000, 750], PX, 0.5, 0.5)).toEqual([1, 1]); // kept on the photo
  });

  it("a photo prints sharper as its zoom falls", () => {
    near(ppiAt(200, 2, 1), 400);
    near(ppiAt(200, 1, 1.25), 160);
  });

  it("the window shown is the one the story's own crop asks for, else the engine's; crops compare to its places", () => {
    const note: PhotoNote = {
      id: "p-00000000c3",
      px: PX,
      box_mm: BOX,
      window: WIN,
      ppi: 254,
      zoom: 1,
      zoom_max: 1.69,
      floor_ppi: 150,
      focus: null,
      full: null,
    };
    const m = { story: "d0000000001", x: 50, y: 190, w: 2, h: 100 };
    expect(shownWindow(m, note)).toEqual(WIN);
    expect(shownWindow({ ...m, crop: { photo: note.id, focus: [0, 0], zoom: 1 } }, note)).toEqual([0, 0, 1000, 750]);
    expect(shownWindow({ ...m, crop: { photo: "p-00000000d4", focus: [0, 0], zoom: 1 } }, note)).toEqual(WIN); // another photo's
    const crop = { photo: note.id, focus: [0.5, 0.5] as const, zoom: 1.5 };
    expect(sameCrop(crop, { ...crop, focus: [0.50004, 0.5], zoom: 1.5004 })).toBe(true);
    expect(sameCrop(crop, { ...crop, focus: [0.5002, 0.5] })).toBe(false);
    expect(sameCrop(crop, { ...crop, zoom: 1.502 })).toBe(false);
    expect(sameCrop(crop, null)).toBe(false);
    expect(sameCrop(null, null)).toBe(true);
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
