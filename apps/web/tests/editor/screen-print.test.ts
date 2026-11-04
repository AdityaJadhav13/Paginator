/**
 * Screen equals print, level L2 (plan §1 L2.4 "Done when" 5; doc 12 §6): the editor draws a fictional page's display
 * list on a recording 2D context, and what the canvas was told (each fill of a glyph's Path2D and the transform it was
 * filled under) places the same glyph ids of the same faces, in the same order, as the page's PDF shows
 * (apps/engine-worker/test/fixtures/screen-print-page.json, `pdf_glyphs`: [face, gid, x_mm, y_mm] recovered from the
 * content stream by pgn_worker.screenprint), every position within 0.001 mm.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { drawPage, readView, type PageView } from "../../src/features/editor/view.ts";
import { FakePath, glyphsOnPage, recordingContext } from "./fake-canvas.ts";

const FIXTURE = resolve(__dirname, "../../../engine-worker/test/fixtures/screen-print-page.json");
const present = existsSync(FIXTURE);
if (!present) console.warn(`screen equals print: ${FIXTURE} is missing, so the check is skipped`);

describe.skipIf(!present)("screen equals print (L2)", () => {
  it("fills the PDF's glyph ids at the PDF's positions, at any zoom and device scale", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
      items: PageView["items"];
      fonts: PageView["fonts"];
      pdf_glyphs: [string, number, number, number][];
    };
    const grid = { page_w_mm: 1, page_h_mm: 1, news_top_mm: 0, news_bottom_mm: 1, columns: 0 };
    const view = readView({ modules: [], items: fixture.items, fonts: fixture.fonts, grid })!;
    const glyphs = new Map<string, Path2D>();
    for (const it of view.items) {
      if (it.t !== "text") continue;
      const face = view.fonts[it.f]!.face;
      for (const [gid] of it.g) glyphs.set(`${face}:${gid}`, new FakePath(face, gid) as unknown as Path2D);
    }
    expect(fixture.pdf_glyphs.length).toBeGreaterThan(0);
    for (const at of [
      { s: 3.7, ox: 41.5, oy: 18, k: 2 }, // an editor's zoom on a retina screen
      { s: 1.6, ox: -120.25, oy: -300, k: 1 }, // scrolled
    ]) {
      const { ctx, filled } = recordingContext();
      drawPage(ctx, view, { ...at, glyphs, images: new Map() });
      const drawn = glyphsOnPage(filled, at);
      expect(drawn.map((g) => [g.face, g.gid])).toEqual(fixture.pdf_glyphs.map(([face, gid]) => [face, gid]));
      const off = drawn.map((g, i) => {
        const [, , x, y] = fixture.pdf_glyphs[i]!;
        return Math.max(Math.abs(g.x_mm - x), Math.abs(g.y_mm - y));
      });
      expect(Math.max(...off)).toBeLessThanOrEqual(0.001 + 1e-9);
      // each outline is filled upright: font units y up, no shear
      for (const g of drawn) expect([g.m[1], g.m[2], Math.sign(g.m[3])]).toEqual([0, 0, -1]);
    }
  });
});
