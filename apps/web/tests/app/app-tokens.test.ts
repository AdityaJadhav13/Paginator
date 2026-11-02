/**
 * The signed-in app's tokens (src/ui/app-tokens.css): every pair meets WCAG AA, the values tested are the file's own,
 * they exist only under `.pg-app`, and tokens.css (the public website's) is untouched by them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CONTRAST_PAIRS, contrastRatio } from "../../src/test/contrast.ts";

const read = (path: string) => readFileSync(resolve(__dirname, "../../src", path), "utf-8");
const APP_TOKENS = read("ui/app-tokens.css");
const KIT = read("ui/kit.css").replace(/\/\*[\s\S]*?\*\//g, "");
const FRAME = read("app/frame.css").replace(/\/\*[\s\S]*?\*\//g, "");

function value(token: string): string | undefined {
  return APP_TOKENS.match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
}

describe("App token contrast (WCAG AA)", () => {
  for (const pair of APP_CONTRAST_PAIRS) {
    it(`${pair.label} achieves ≥ ${pair.minimum}:1, with the file's own values`, () => {
      expect(value(pair.fgToken)?.toUpperCase()).toBe(pair.fg);
      expect(value(pair.bgToken)?.toUpperCase()).toBe(pair.bg);
      expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(pair.minimum);
    });
  }
});

describe("App tokens are scoped to the signed-in app", () => {
  it("defines its tokens on .pg-app only", () => {
    const selectors = [...APP_TOKENS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((match) => match[1]!.trim());
    expect(selectors).toEqual([".pg-app"]);
  });

  it("is not read by tokens.css, and the kit and frame use tokens, not raw colours", () => {
    expect(read("ui/tokens.css")).not.toContain("--pg-app-");
    expect(KIT).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(FRAME).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  it("uses logical properties only in the kit and the frame", () => {
    for (const css of [KIT, FRAME]) {
      expect(css).not.toMatch(/(margin|padding|border)-(left|right)\b|\b(left|right):/);
    }
  });
});
