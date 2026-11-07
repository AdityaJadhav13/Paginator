// The media library's sharpness rule (src/modules/media/library.ts): the Desk's 150 ppi across N columns of a grid.
import { describe, expect, it } from "vitest";
import { MIN_PPI, sharpColumns } from "../../src/modules/media/library.ts";

describe("sharpColumns", () => {
  it("is null when the grid is not known", () => {
    expect(sharpColumns(4000, null)).toBeNull();
  });

  it("counts a column sharp at exactly 150 ppi, and not one pixel less", () => {
    const inch = { columns: 6, columnMm: 25.4, gutterMm: 0 };
    expect(MIN_PPI).toBe(150);
    expect(sharpColumns(150, inch)).toBe(1);
    expect(sharpColumns(149, inch)).toBe(0);
    expect(sharpColumns(300, inch)).toBe(2);
  });

  it("adds a gutter between columns: N·column + (N−1)·gutter mm", () => {
    const grid = { columns: 6, columnMm: 50, gutterMm: 4 };
    // one column, 50 mm: 295.3 px; two, 104 mm: 614.2 px; three, 158 mm: 933.1 px
    expect(sharpColumns(295, grid)).toBe(0);
    expect(sharpColumns(296, grid)).toBe(1);
    expect(sharpColumns(614, grid)).toBe(1);
    expect(sharpColumns(615, grid)).toBe(2);
    expect(sharpColumns(934, grid)).toBe(3);
  });

  it("is at most the grid's columns", () => {
    expect(sharpColumns(100_000, { columns: 5, columnMm: 50, gutterMm: 4 })).toBe(5);
  });
});
