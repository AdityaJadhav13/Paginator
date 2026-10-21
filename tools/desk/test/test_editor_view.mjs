// Pageinator Desk — the page editor's view arithmetic (static/editor-view.js): ruler ticks, the fit scales and zoom to
// a box. Node's own test runner, no other tools: node --test tools/desk/test/test_editor_view.mjs
// The page and grid here are fictional (300 × 500 mm, 6 columns of 40 mm with 5 mm gutters from x = 15 mm).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitScale,
  fitWidthZoom,
  gridColumns,
  rulerLabel,
  rulerSteps,
  rulerTicks,
  unionBox,
  zoomToRect,
} from "../static/editor-view.js";

const PAGE_W = 300;
const PAGE_H = 500;
const GRID = { origin_mm: 15, column_mm: 40, gutter_mm: 5, columns: 6 };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b} (±${eps})`);
const divides = (step, mm) => Math.abs(mm / step - Math.round(mm / step)) < 1e-9; // step fits mm a whole number of times
const SCALES = Array.from({ length: 120 }, (_, i) => 0.05 * 1.08 ** i); // 0.05 … about 450 px per mm
const MAJORS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

test("ruler steps: numbered ticks at least 40 px apart, at the smallest of 1, 2, 5, 10, 20, 50 … mm", () => {
  for (const s of SCALES) {
    const { major } = rulerSteps(s);
    const i = MAJORS.indexOf(major);
    assert.ok(i >= 0, `${major} mm is not a ruler step`);
    if (major * s < 40) assert.equal(major, 1000, `at ${s} px/mm only the largest step may be closer than 40 px`);
    if (i > 0) assert.ok(MAJORS[i - 1] * s < 40, `at ${s} px/mm ${MAJORS[i - 1]} mm would do`);
  }
});

test("ruler steps: small ticks divide the numbered step evenly, far enough apart, as fine as they can be", () => {
  const MINORS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  // the editor's spacing (40 px between numbers, 5 px between ticks) and others, where a step that does not divide
  // the numbered one would otherwise be the finest far enough apart
  for (const [labelPx, tickPx] of [
    [40, 5],
    [40, 15],
    [30, 3],
    [60, 8],
    [40, 25],
  ]) {
    for (const s of SCALES) {
      const { major, minor } = rulerSteps(s, labelPx, tickPx);
      assert.ok(divides(minor, major), `at ${s} px/mm, ${minor} mm does not divide ${major} mm`);
      assert.ok(minor === major || minor * s >= tickPx, `at ${s} px/mm, ticks every ${minor} mm are too close`);
      for (const finer of MINORS.filter((m) => m < minor && divides(m, major)))
        assert.ok(finer * s < tickPx, `at ${s} px/mm, ticks every ${finer} mm would do`);
    }
  }
  assert.deepEqual(rulerSteps(10, 40, 15), { major: 5, minor: 5 }); // 2 mm would be far enough apart, but 5 / 2 is not whole
});

test("ruler ticks at every zoom: numbered with whole millimetres where they stand, evenly spaced", () => {
  for (const s of SCALES) {
    const steps = rulerSteps(s);
    const ticks = rulerTicks(-60, -60 + 3000 / s, steps); // a ruler 3000 px long, from left of the page
    assert.ok(ticks.length > 0 && ticks.length <= 3000 / 5 + 1, `${ticks.length} ticks at ${s} px/mm`);
    for (const [i, t] of ticks.entries()) {
      if (i) near(t.mm - ticks[i - 1].mm, steps.minor, 1e-9);
      if (t.kind !== "major") continue;
      assert.ok(Number.isInteger(t.label), `at ${s} px/mm, the number ${t.label} is not whole`);
      near(t.label, t.mm, 1e-9);
    }
  }
});

test("ruler steps at the zooms an editor shows", () => {
  assert.deepEqual(rulerSteps(1.67), { major: 50, minor: 5 }); // a page fitted to a laptop's view
  assert.deepEqual(rulerSteps(2.09), { major: 20, minor: 5 });
  assert.deepEqual(rulerSteps(5), { major: 10, minor: 1 });
  assert.deepEqual(rulerSteps(13.4), { major: 5, minor: 0.5 });
  assert.deepEqual(rulerSteps(50), { major: 1, minor: 0.1 });
  for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY])
    assert.deepEqual(rulerSteps(bad), { major: 1000, minor: 1000 });
});

test("ruler ticks: every small step, numbered at the numbered steps, mid ticks halfway, also left of the page", () => {
  const ticks = rulerTicks(-12, 64, { major: 20, minor: 5 });
  assert.deepEqual(
    ticks.map((t) => t.mm),
    [-10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  );
  assert.deepEqual(
    ticks.filter((t) => t.kind === "major").map((t) => t.label),
    [0, 20, 40, 60],
  );
  assert.deepEqual(
    ticks.filter((t) => t.kind === "mid").map((t) => t.mm),
    [-10, 10, 30, 50],
  );
  for (const t of ticks) if (t.kind !== "major") assert.equal(t.label, null);
  // five small steps to a number: no tick is halfway
  assert.ok(rulerTicks(0, 100, { major: 50, minor: 10 }).every((t) => t.kind !== "mid"));
});

test("ruler ticks: whole-mm numbers and even spacing with tenth-of-a-mm steps", () => {
  const ticks = rulerTicks(0.05, 10.01, { major: 1, minor: 0.1 });
  assert.equal(ticks.length, 100); // 0.1 … 10.0
  assert.deepEqual(
    ticks.filter((t) => t.kind === "major").map((t) => t.label),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  for (let i = 1; i < ticks.length; i += 1) near(ticks[i].mm - ticks[i - 1].mm, 0.1, 1e-12);
  const mids = ticks.filter((t) => t.kind === "mid").map((t) => t.mm);
  assert.equal(mids.length, 10);
  for (const [i, mm] of mids.entries()) near(mm, i + 0.5, 1e-12);
});

test("ruler ticks: none for an empty, reversed or unreadable range, or one too long to draw", () => {
  assert.deepEqual(rulerTicks(10, 5, { major: 10, minor: 1 }), []);
  assert.deepEqual(rulerTicks(Number.NaN, 5, { major: 10, minor: 1 }), []);
  assert.deepEqual(rulerTicks(0, 1e6, { major: 1, minor: 0.1 }), []);
  assert.equal(rulerTicks(0, 0, { major: 10, minor: 1 }).length, 1);
});

test("ruler labels: a true minus sign left of and above the page's corner", () => {
  assert.equal(rulerLabel(-20), "−20");
  assert.equal(rulerLabel(0), "0");
  assert.equal(rulerLabel(-0), "0");
  assert.equal(rulerLabel(340), "340");
});

test("grid columns: numbered from 1, with their edges and centres", () => {
  const cols = gridColumns(GRID);
  assert.equal(cols.length, 6);
  assert.deepEqual(cols[0], { n: 1, x0: 15, x1: 55, mid: 35 });
  assert.deepEqual(cols[2], { n: 3, x0: 105, x1: 145, mid: 125 });
  assert.equal(cols[5].x1, 280);
});

test("fit scale: the whole page inside the view with 24 px around it", () => {
  near(fitScale(880, 950, PAGE_W, PAGE_H), (950 - 48) / PAGE_H); // a tall page: its height decides
  near(fitScale(500, 2000, PAGE_W, PAGE_H), (500 - 48) / PAGE_W); // a narrow view: its width decides
});

test("fit width: the page's width fills the view, 24 px each side", () => {
  const zoom = fitWidthZoom(880, 950, PAGE_W, PAGE_H);
  near(fitScale(880, 950, PAGE_W, PAGE_H) * zoom * PAGE_W, 880 - 48);
  assert.ok(zoom > 1);
  near(fitWidthZoom(500, 2000, PAGE_W, PAGE_H), 1); // the page's width already decides the fit
  assert.equal(fitWidthZoom(40, 40, PAGE_W, PAGE_H), 1); // no room yet
});

test("zoom range: the editor's own, half to eight times the whole page", () => {
  assert.equal(ZOOM_MIN, 0.5);
  assert.equal(ZOOM_MAX, 8);
  assert.equal(clampZoom(0.1), 0.5);
  assert.equal(clampZoom(2), 2);
  assert.equal(clampZoom(100), 8);
});

test("zoom to a box: as large as it fits inside the margin, centred in the view (the rulers left out)", () => {
  const area = { x0: 20, y0: 20, x1: 880, y1: 950 };
  const base = fitScale(880, 950, PAGE_W, PAGE_H);
  const box = { x0: 60, y0: 100, x1: 145, y1: 260 }; // two columns, 160 mm deep
  const v = zoomToRect(box, area, base, 32);
  near(v.s, base * v.zoom);
  const px = (x, y) => [v.ox + x * v.s, v.oy + y * v.s];
  const [x0, y0] = px(box.x0, box.y0);
  const [x1, y1] = px(box.x1, box.y1);
  near((x0 + x1) / 2, (area.x0 + area.x1) / 2, 1e-6);
  near((y0 + y1) / 2, (area.y0 + area.y1) / 2, 1e-6);
  assert.ok(x0 >= area.x0 + 32 - 1e-6 && x1 <= area.x1 - 32 + 1e-6);
  assert.ok(y0 >= area.y0 + 32 - 1e-6 && y1 <= area.y1 - 32 + 1e-6);
  // one side touches the margin: it could not be larger
  assert.ok(Math.abs(y1 - y0 - (area.y1 - area.y0 - 64)) < 1e-6 || Math.abs(x1 - x0 - (area.x1 - area.x0 - 64)) < 1e-6);
});

test("zoom to a box: kept in the editor's zoom range", () => {
  const area = { x0: 0, y0: 0, x1: 880, y1: 950 };
  const base = fitScale(880, 950, PAGE_W, PAGE_H);
  const tiny = zoomToRect({ x0: 100, y0: 100, x1: 101, y1: 101 }, area, base);
  assert.equal(tiny.zoom, ZOOM_MAX);
  near(tiny.ox + 100.5 * tiny.s, 440, 1e-6); // still centred
  const huge = zoomToRect({ x0: -2000, y0: -2000, x1: 2000, y1: 2000 }, area, base);
  assert.equal(huge.zoom, ZOOM_MIN);
  const cramped = zoomToRect({ x0: 0, y0: 0, x1: 40, y1: 20 }, { x0: 20, y0: 20, x1: 50, y1: 50 }, base);
  assert.ok(Number.isFinite(cramped.zoom) && cramped.zoom >= ZOOM_MIN); // a view smaller than its margins
});

test("zoom to a box: nothing without a box or a view", () => {
  assert.equal(zoomToRect(null, { x0: 0, y0: 0, x1: 100, y1: 100 }, 1), null);
  assert.equal(zoomToRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 0, y0: 0, x1: 100, y1: 100 }, 0), null);
  assert.equal(zoomToRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 0, y0: 0, x1: 100, y1: 100 }, -1), null);
});

test("union box: around every box, or none", () => {
  assert.equal(unionBox([]), null);
  assert.deepEqual(unionBox([{ x0: 10, y0: 20, x1: 30, y1: 40 }]), { x0: 10, y0: 20, x1: 30, y1: 40 });
  assert.deepEqual(
    unionBox([
      { x0: 10, y0: 20, x1: 30, y1: 40 },
      { x0: 5, y0: 30, x1: 25, y1: 90 },
    ]),
    { x0: 5, y0: 20, x1: 30, y1: 90 },
  );
});
