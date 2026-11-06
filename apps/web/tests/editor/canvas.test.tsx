/**
 * The page's canvas (L2.4 review): the page is drawn once into an offscreen canvas per view, size, zoom and scroll, and
 * a pointer move only copies it and draws the outlines over it, in an animation frame; zoomed in, the stage scrolls over
 * a spacer as large as the zoomed page; the stage is as tall as the window leaves below it. The photo modes (A6): a
 * drag of the photo, a focal click, the arrows, a double-click, Enter and Esc; the rulers drawn over the view and never
 * into the page, a click on them selecting nothing; zoom to a box. A recording 2D context; fictional page and photo.
 */
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "../../src/test/render.tsx";
import { PageCanvas, type PageCanvasHandle, type PageCanvasProps } from "../../src/features/editor/PageCanvas.tsx";
import { readView } from "../../src/features/editor/view.ts";
import { FakePath, recordingContext } from "./fake-canvas.ts";

const FACE = "c".repeat(24);
const STORY = "d0000000001";
// a fictional 1900 × 1500 px photo, 20 px a mm in its frame of 95 × 60 mm: the layout shows its middle 1200 rows
const PHOTO = {
  id: "p-00000000b2",
  px: [1900, 1500],
  box_mm: [10, 70, 105, 130],
  window: [0, 150, 1900, 1200],
  ppi: 508,
  zoom: 1,
  zoom_max: 3.386,
  floor_ppi: 150,
  focus: null,
  full: null,
} as const;
const view = readView({
  modules: [{ story: STORY, x: 10, y: 60, w: 2, h: 100 }],
  notes: [{ story: STORY, fit: "fits", by_mm: 0, articles: [], headline: "Fictional", photo: PHOTO }],
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

const draw = (zoom: number, more: Partial<PageCanvasProps> = {}) => (
  <PageCanvas
    view={view}
    modules={view.modules}
    selected={STORY}
    zoom={zoom}
    glyphs={glyphs}
    images={new Map()}
    drawn={0}
    label="The page"
    sizeText={() => ""}
    onPick={() => {}}
    onChange={() => {}}
    onLocked={() => {}}
    mode="select"
    onMode={() => {}}
    onCrop={() => {}}
    rulers={false}
    onZoom={() => {}}
    {...more}
  />
);

// the whole page at zoom 1 in 800 × 600 px: 1.104 px a mm, its corner at (234.4, 24)
const S = 552 / 500;
const toPx = (x: number, y: number) => ({ clientX: Math.round(234.4 + x * S), clientY: Math.round(24 + y * S) });
const toMm = ({ clientX, clientY }: { clientX: number; clientY: number }) => [
  (clientX - 234.4) / S,
  (clientY - 24) / S,
];

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

describe("the photo modes (A6)", () => {
  it("photo mode: a drag moves the photo in its frame, one crop on letting go, its window kept in the photo", () => {
    const onCrop = vi.fn();
    const { getByRole } = render(draw(1, { mode: "photo", onCrop }));
    const canvas = getByRole("application");
    const from = toPx(50, 100); // inside the frame
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, ...from });
    for (const dy of [-10, -20, -40])
      fireEvent.pointerMove(canvas, { pointerId: 1, ...from, clientY: from.clientY + dy });
    expect(onCrop).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, { pointerId: 1, ...from, clientY: from.clientY - 40 });
    // 36 mm up: 725 rows, but the window stops at the photo's foot (300); the window's whole width cannot move
    expect(onCrop).toHaveBeenCalledTimes(1);
    expect(onCrop).toHaveBeenCalledWith(STORY, [0.5003, 0.6003]);
  });

  it("photo mode: a click without a drag changes nothing; a click outside the frame goes back to selecting", () => {
    const onCrop = vi.fn();
    const onMode = vi.fn();
    const onPick = vi.fn();
    const { getByRole } = render(draw(1, { mode: "photo", onCrop, onMode, onPick }));
    const canvas = getByRole("application");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, ...toPx(50, 100) });
    fireEvent.pointerUp(canvas, { pointerId: 1, ...toPx(50, 100) });
    expect(onCrop).not.toHaveBeenCalled();
    expect(onMode).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, ...toPx(50, 150) }); // the story, under its photo
    fireEvent.pointerUp(canvas, { pointerId: 2, ...toPx(50, 150) });
    expect(onMode).toHaveBeenCalledWith("select");
    expect(onPick).toHaveBeenCalledWith(STORY);
  });

  it("photo mode: a double-click on the photo sets its focal point; the arrows pan 2 %, with Shift 10 %", () => {
    const onCrop = vi.fn();
    const onMode = vi.fn();
    const { getByRole } = render(draw(1, { mode: "photo", onCrop, onMode }));
    const canvas = getByRole("application");
    fireEvent.doubleClick(canvas, toPx(50, 100));
    expect(onMode).toHaveBeenLastCalledWith("focal");
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    expect(onCrop).toHaveBeenLastCalledWith(STORY, [0.5003, 0.5203]); // the window's centre, 2 % down
    fireEvent.keyDown(canvas, { key: "ArrowUp", shiftKey: true });
    expect(onCrop).toHaveBeenLastCalledWith(STORY, [0.5003, 0.4003]);
    fireEvent.keyDown(canvas, { key: "ArrowLeft" }); // the window is the photo's whole width: nothing to move
    expect(onCrop).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(onMode).toHaveBeenLastCalledWith("select");
  });

  it("focal mode: a click on the photo sets the focus under it; outside it nothing; Esc goes back to photo mode", () => {
    const onCrop = vi.fn();
    const onMode = vi.fn();
    const { getByRole } = render(draw(1, { mode: "focal", onCrop, onMode }));
    const canvas = getByRole("application");
    const at = toPx(50, 100);
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, ...at });
    // the whole photo spans 10..105 mm across and 62.5..137.5 mm down around its frame
    const [x, y] = toMm(at);
    const [fx, fy] = onCrop.mock.calls[0]![1] as [number, number];
    expect(fx).toBeCloseTo((x! - 10) / 95, 4);
    expect(fy).toBeCloseTo((y! - 62.5) / 75, 4);
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, ...toPx(50, 150) });
    expect(onCrop).toHaveBeenCalledTimes(1);
    expect(onMode).not.toHaveBeenCalled();
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(onMode).toHaveBeenLastCalledWith("photo");
  });

  it("draws the frame, the whole photo's outline and the focal point over the view, never into the page", () => {
    const { getByRole } = render(draw(1, { mode: "focal" }));
    const { main, page } = screenAndPage(getByRole("application") as HTMLCanvasElement);
    const arcs = (c: typeof main) => c.calls.filter((x) => x[0] === "arc");
    expect(arcs(main)).toHaveLength(2); // the crosshair's ring, white under orange
    expect(arcs(page)).toHaveLength(0);
    const [, fx, fy] = arcs(main)[0]! as [string, number, number];
    expect(fx).toBeCloseTo(234.4 + (10 + 0.5003 * 95) * S, 1); // the window's centre
    expect(fy).toBeCloseTo(24 + (62.5 + 0.5003 * 75) * S, 1);
  });
});

describe("the rulers (A6)", () => {
  it("are drawn over the view, never into the page drawn offscreen, and mark the pointer", () => {
    const { getByRole } = render(draw(1, { rulers: true }));
    const canvas = getByRole("application") as HTMLCanvasElement;
    const { main, page } = screenAndPage(canvas);
    const texts = (c: typeof main) => c.calls.filter((x) => x[0] === "fillText").map((x) => x[1]);
    expect(texts(main)).toContain("mm");
    expect(texts(main)).toEqual(expect.arrayContaining(["0", "50", "100", "1", "2", "3", "4", "5"])); // mm, columns
    expect(texts(page)).toEqual([]);
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 250 });
    const marks = main.calls.filter((x) => x[0] === "fillRect" && x[3] === 1 && x[4] === 19);
    expect(marks.at(-1)).toEqual(["fillRect", 300, 0, 1, 19]);
  });

  it("a click on a ruler does nothing; without them the same click selects nothing", () => {
    const onPick = vi.fn();
    const { getByRole, rerender } = render(draw(1, { rulers: true, onPick }));
    const canvas = getByRole("application");
    const left = { button: 0, pointerId: 1, clientX: 10, clientY: 150 };
    fireEvent.pointerDown(canvas, left);
    fireEvent.pointerUp(canvas, left);
    expect(onPick).not.toHaveBeenCalled();
    rerender(draw(1, { rulers: false, onPick }));
    fireEvent.pointerDown(canvas, left);
    expect(onPick).toHaveBeenCalledWith(null);
  });
});

describe("zoom to a box (A6)", () => {
  it("zooms so the box fills the view inside its margin, and scrolls the stage to centre it", () => {
    const handle = createRef<PageCanvasHandle>();
    const onZoom = vi.fn();
    function Zoomable() {
      const [zoom, setZoom] = useState(1);
      return draw(zoom, { rulers: true, ref: handle, onZoom: (z) => (onZoom(z), setZoom(z)) });
    }
    const { getByRole, container } = render(<Zoomable />);
    const canvas = getByRole("application") as HTMLCanvasElement;
    act(() => handle.current!.zoomTo({ x0: 10, y0: 60, x1: 105, y1: 160 }));
    // inside the rulers (780 × 580 px) with 32 px around: 516 px for 100 mm down
    const s = 516 / 100;
    expect(onZoom).toHaveBeenCalledWith(s / S);
    const stage = container.querySelector<HTMLElement>(".pg-editor__stage")!;
    expect(container.querySelector<HTMLElement>(".pg-editor__spacer")!.style.blockSize).toBe(`${500 * s + 48}px`);
    // the box's middle (110 mm down) at the middle of the area below the top ruler
    const glyph = screenAndPage(canvas).page.filled.at(-2)!.m; // the first glyph, 80 mm down
    expect(glyph[5] + 30 * s).toBeCloseTo(20 + 580 / 2, 0);
    expect(stage.scrollTop).toBeGreaterThan(0);
  });
});
