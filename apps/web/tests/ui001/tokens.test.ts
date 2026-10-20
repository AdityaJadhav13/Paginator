/**
 * Task 2 — Token completeness and contrast tests.
 * Verifies that tokens.css defines every required token from UI001 §6
 * and that contrast ratios meet WCAG AA thresholds.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { contrastRatio, TOKEN_CONTRAST_PAIRS } from "../../src/test/contrast.ts";

// Read via Node's fs rather than a Vite `?raw` import: `?raw`/`?inline`
// queries on `.css` files resolve to an empty string under Vitest's SSR
// transform pipeline (verified directly; plain non-CSS `?raw` imports
// work correctly, so this is CSS-specific, not a general limitation).
const TOKENS_CSS = readFileSync(
  resolve(__dirname, "../../src/ui/tokens.css"),
  "utf-8"
);
const BASE_CSS = readFileSync(
  resolve(__dirname, "../../src/ui/base.css"),
  "utf-8"
);

function tokenExists(name: string): boolean {
  return TOKENS_CSS.includes(`${name}:`);
}

// ── Token completeness ──────────────────────────────────────────────

describe("Typography tokens", () => {
  const fontFamilies = ["--pg-font-sans", "--pg-font-mono"];
  for (const t of fontFamilies) {
    it(`defines ${t}`, () => expect(tokenExists(t)).toBe(true));
  }

  const sizes = ["100", "200", "300", "400", "500", "600"];
  for (const s of sizes) {
    it(`defines --pg-font-size-${s}`, () =>
      expect(tokenExists(`--pg-font-size-${s}`)).toBe(true));
    it(`defines --pg-line-height-${s}`, () =>
      expect(tokenExists(`--pg-line-height-${s}`)).toBe(true));
  }

  const weights = [
    "--pg-font-weight-regular",
    "--pg-font-weight-medium",
    "--pg-font-weight-semibold",
    "--pg-font-weight-bold",
  ];
  for (const w of weights) {
    it(`defines ${w}`, () => expect(tokenExists(w)).toBe(true));
  }
});

describe("Spacing tokens", () => {
  for (let i = 0; i <= 9; i++) {
    it(`defines --pg-space-${i}`, () =>
      expect(tokenExists(`--pg-space-${i}`)).toBe(true));
  }

  const sizes = [
    "--pg-control-height-sm",
    "--pg-control-height-md",
    "--pg-control-height-lg",
    "--pg-content-measure",
    "--pg-reading-measure",
  ];
  for (const s of sizes) {
    it(`defines ${s}`, () => expect(tokenExists(s)).toBe(true));
  }
});

describe("Radius, border, elevation tokens", () => {
  const tokens = [
    "--pg-radius-sm",
    "--pg-radius-md",
    "--pg-radius-lg",
    "--pg-radius-pill",
    "--pg-border-width",
    "--pg-shadow-raised",
  ];
  for (const t of tokens) {
    it(`defines ${t}`, () => expect(tokenExists(t)).toBe(true));
  }
});

describe("Colour tokens", () => {
  const colours = [
    "--pg-color-canvas",
    "--pg-color-surface",
    "--pg-color-surface-subtle",
    "--pg-color-text",
    "--pg-color-text-muted",
    "--pg-color-border",
    "--pg-color-border-subtle",
    "--pg-color-action",
    "--pg-color-action-hover",
    "--pg-color-on-action",
    "--pg-color-focus",
    "--pg-color-danger",
    "--pg-color-success",
    "--pg-color-warning",
    "--pg-color-disabled-bg",
    "--pg-color-disabled-text",
  ];
  for (const c of colours) {
    it(`defines ${c}`, () => expect(tokenExists(c)).toBe(true));
  }
});

describe("Status accent tokens", () => {
  const states = [
    "simulated",
    "pending",
    "saved-intention",
    "recomposing",
    "confirmed-proof",
    "stale",
    "failed",
    "approved-candidate",
  ];
  for (const s of states) {
    it(`defines --pg-status-${s}`, () =>
      expect(tokenExists(`--pg-status-${s}`)).toBe(true));
  }
});

describe("Motion tokens", () => {
  it("defines --pg-duration-default", () =>
    expect(tokenExists("--pg-duration-default")).toBe(true));
});

// ── Token raw value boundary ────────────────────────────────────────

describe("Token file does not reference external assets", () => {
  it("has no url() asset references", () => {
    expect(TOKENS_CSS).not.toMatch(/url\(/);
  });

  it("has no @import statements that fetch external resources", () => {
    // The tokens file itself should have no @import
    expect(TOKENS_CSS).not.toMatch(/@import/);
  });
});

// ── Contrast ratios ─────────────────────────────────────────────────

describe("Token contrast ratios meet WCAG AA thresholds", () => {
  for (const pair of TOKEN_CONTRAST_PAIRS) {
    it(`${pair.label} achieves ≥ ${pair.minimum}:1`, () => {
      const ratio = contrastRatio(pair.fg, pair.bg);
      expect(ratio).toBeGreaterThanOrEqual(pair.minimum);
    });
  }
});

// ── Typography roles in base.css ────────────────────────────────────

describe("Base CSS defines all typography roles", () => {
  const roles = [
    "pg-type-display",
    "pg-type-page-title",
    "pg-type-section-title",
    "pg-type-body",
    "pg-type-body-small",
    "pg-type-label",
    "pg-type-caption",
    "pg-type-code",
  ];
  for (const r of roles) {
    it(`defines .${r}`, () => expect(BASE_CSS).toContain(`.${r}`));
  }

  it("defines :focus-visible with outline", () => {
    expect(BASE_CSS).toContain(":focus-visible");
    expect(BASE_CSS).toContain("outline:");
  });

  it("defines prefers-reduced-motion behavior", () => {
    expect(BASE_CSS).toContain("prefers-reduced-motion");
  });

  it("defines forced-colours behavior", () => {
    expect(BASE_CSS).toContain("forced-colors");
  });
});

// ── Raw colour value boundary in base.css ────────────────────────────
//
// Components must consume semantic tokens rather than raw colour values
// (§6). tokens.css is the one authoritative definition site for raw
// values; base.css (component styles) must reference them only via
// var(--pg-*).

describe("Base CSS contains no raw colour literals", () => {
  const cssWithoutComments = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  it("has no hex colour literals", () => {
    expect(cssWithoutComments).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  it("has no rgb()/rgba() colour literals", () => {
    expect(cssWithoutComments).not.toMatch(/\brgba?\(/);
  });

  it("has no hsl()/hsla() colour literals", () => {
    expect(cssWithoutComments).not.toMatch(/\bhsla?\(/);
  });
});
