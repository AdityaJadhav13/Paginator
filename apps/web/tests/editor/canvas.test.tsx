/**
 * The page's canvas (L2.4 review): the page is drawn once into an offscreen canvas per view, size, zoom and scroll, and
 * a pointer move only copies it and draws the outlines over it, in an animation frame; zoomed in, the stage scrolls over
 * a spacer as large as the zoomed page; the stage is as tall as the window leaves below it. A recording 2D context;
 * fictional page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "../../src/test/render.tsx";
import { PageCanvas } from "../../src/features/editor/PageCanvas.tsx";
import { readView } from "../../src/features/editor/view.ts";
import { FakePath, recordingContext } from "./fake-canvas.ts";

const FACE = "c".repeat(24);
const view = readView({
  modules: [{ story: "d0000000001", x: 10, y: 60, w: 2, h: 100 }],
  grid: {
    page_w_mm: 300,
    page_h_mm: 500,
    origin_mm: 10,
    column_mm: 45,
    gutter_mm: 5,
    columns: 5,
    news_top_mm: 60,
    news_bottom_mm: 480,
    snap_mm: 5,
  },
  fonts: { F0: { face: FACE, upem: 1000 } },
  items: [{ t: "text", f: "F0", s: 10, c: [0, 0, 0, 1], g: [[1, 20, 80] as const, [2, 25, 80] as const] }],
})!;
const glyphs = new Map([1, 2].map((gid) => [`${FACE}:${gid}`, new FakePath(FACE, gid) as unknown as Path2D]));

let contexts: Map<HTMLCanvasElement, ReturnType<typeof recordingContext>>;
beforeEach(() => {
  contexts = new Map();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, recordingContext());
    return contexts.get(this)!.ctx as never;
  });
  vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => (draw(0), 1));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const stage = (el: Element, px: number) => (el.classList.contains("pg-editor__stage") ? px : 0);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return stage(this, 800);
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return stage(this, 600);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const draw = (zoom: number) => (
  <PageCanvas
    view={view}
    modules={view.modules}
    selected="d0000000001"
    zoom={zoom}
    glyphs={glyphs}
    images={new Map()}
    drawn={0}
    label="The page"
    sizeText={() => ""}
    onPick={() => {}}
    onChange={() => {}}
    onLocked={() => {}}
  />
);

function screenAndPage(canvas: HTMLCanvasElement) {
  const main = contexts.get(canvas)!;
  const page = [...contexts].find(([el]) => el !== canvas)![1];
  return { main, page, count: (c: typeof main, what: string) => c.calls.filter((x) => x[0] === what).length };
}

describe("the page's canvas", () => {
  it("draws the page once; a pointer move only copies it and draws the outlines over it", () => {
    const { getByRole } = render(draw(1));
    const canvas = getByRole("application") as HTMLCanvasElement;
    const { main, page, count } = screenAndPage(canvas);
    expect(page.filled).toHaveLength(2); // the two glyphs, offscreen
    const copies = count(main, "drawImage");
    expect(copies).toBeGreaterThan(0);
    expect(main.filled).toHaveLength(0); // no glyph is filled on screen
    // the story is at about (245..350, 90..200) px
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 300, clientY: 150 });
    for (const y of [160, 180, 200]) fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: y });
    expect(count(main, "drawImage")).toBeGreaterThan(copies);
    expect(page.filled).toHaveLength(2); // not drawn again
  });

  it("zoomed in, the stage scrolls over the zoomed page and the page is drawn at the scroll", () => {
    const { getByRole, container } = render(draw(4));
    const canvas = getByRole("application") as HTMLCanvasElement;
    const spacer = container.querySelector<HTMLElement>(".pg-editor__spacer")!;
    const s = ((600 - 48) / 500) * 4; // the whole page's scale, zoomed
    expect(spacer.style.inlineSize).toBe(`${300 * s + 48}px`);
    expect(spacer.style.blockSize).toBe(`${500 * s + 48}px`);
    expect(canvas.style.inlineSize).toBe("800px"); // the visible area
    const { page } = screenAndPage(canvas);
    const before = page.filled[0]!.m;
    const stage = container.querySelector<HTMLElement>(".pg-editor__stage")!;
    stage.scrollLeft = 200;
    stage.scrollTop = 300;
    fireEvent.scroll(stage);
    const after = page.filled.at(-2)!.m; // the first glyph again
    const k = window.devicePixelRatio || 1;
    expect(before[4] - after[4]).toBeCloseTo(200 * k);
    expect(before[5] - after[5]).toBeCloseTo(300 * k);
  });

  it("is as tall as the window leaves below it, so the whole page fits the screen", () => {
    vi.stubGlobal("innerHeight", 900);
    const { container } = render(draw(1));
    const stage = container.querySelector<HTMLElement>(".pg-editor__stage")!;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    expect(stage.style.blockSize).toBe(`${900 - top - 16}px`);
  });
});
