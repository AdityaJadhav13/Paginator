/**
 * DOM order, heading sequence and the region order each surface fixes
 * (UI005 §28 "Reading order" row; AC-53, AC-55).
 *
 * jsdom has no layout engine, so *visual* order is verified in a real
 * browser (RB-04). What is verified here is the property that makes the
 * browser check meaningful: the DOM order itself is fixed and no CSS
 * reordering mechanism is used anywhere in the public stylesheet.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, within } from "../../src/test/render.tsx";
import { PUBLIC_ROUTES, renderPublic } from "./renderPublic.tsx";

async function mainFor(path: string, heading: string) {
  const { container } = renderPublic(path);
  await screen.findByRole("heading", { level: 1, name: heading });
  return within(container).getByRole("main");
}

describe("Heading structure (AC-53)", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" has one <h1> and a sequential heading outline`, async () => {
      const main = await mainFor(path, heading);
      const headings = Array.from(main.querySelectorAll("h1, h2, h3, h4, h5, h6"));

      expect(headings.filter((node) => node.tagName === "H1")).toHaveLength(1);
      expect(headings[0]!.tagName).toBe("H1");

      let previous = 1;
      for (const node of headings) {
        const level = Number(node.tagName.slice(1));
        expect(
          level - previous,
          `"${path}" skips from h${previous} to h${level} at "${node.textContent}"`
        ).toBeLessThanOrEqual(1);
        previous = level;
      }
    });
  }
});

describe("Region order is fixed (§12, §15 – §18)", () => {
  const EXPECTED: Record<string, string[]> = {
    "/": [
      "What actually works today",
      "Seven stages, one edition",
      "A newspaper page is a constraint problem",
      "What Pageinator will not be",
      "Two decisions that are still open",
      "Look at the build itself",
    ],
    "/features": [
      "Seven stages, one edition",
      "What Pageinator will not be",
      "What actually works today",
      "Look at the build itself",
    ],
    "/pricing": [
      "Packaging is an open decision",
      "Three shapes a subscription might take",
      "What is not being offered",
      "Look at the build itself",
    ],
    "/security": [
      "What is true today",
      "How tenancy is intended to work",
      "What is not true today",
      "Inaccessible context is generic by construction",
      "Where a security note would go",
      "Look at the build itself",
    ],
    "/contact": [
      "Write something and see what happens",
      "Look at the build itself",
    ],
  };

  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" renders its sections in the specified order`, async () => {
      const main = await mainFor(path, heading);
      const order = Array.from(main.querySelectorAll("h2")).map((node) =>
        node.textContent?.trim()
      );
      expect(order).toEqual(EXPECTED[path]);
    });
  }
});

describe("The stylesheet cannot reorder content (AC-55)", () => {
  const css = readFileSync(
    resolve(__dirname, "../../src/features/public/public.css"),
    "utf8"
  );

  it("uses no CSS order, reversed flex direction or explicit grid placement", () => {
    expect(css).not.toMatch(/(^|[^-\w])order\s*:/m);
    expect(css).not.toMatch(/row-reverse|column-reverse/);
    expect(css).not.toMatch(/grid-row\s*:/);
    // `grid-column: span N` keeps DOM flow; an explicit line number
    // (`grid-column: 3 / 5`) would not.
    for (const match of css.matchAll(/grid-column\s*:\s*([^;]+);/g)) {
      expect(match[1]!.trim()).toMatch(/^span \d+$/);
    }
  });

  it("uses no absolute positioning that could detach an element from flow", () => {
    expect(css).not.toMatch(/position\s*:\s*(absolute|fixed)/);
  });
});
