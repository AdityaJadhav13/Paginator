/**
 * The sign-in screens' stylesheet keeps UI001's rules (tokens only, logical properties only), stays fluid down to
 * 320 CSS pixels, and gives Marathi its line heights (02 §3.1). jsdom has no layout engine, so the 320 px reflow itself
 * (no sideways scrolling) is checked in a real browser against the production build; this file checks the rules that
 * make it hold. It also covers where sign-in may send a person back to.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAuthPath, safeReturnTo } from "../../src/features/auth/return-to.ts";

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const authCss = stripComments(readFileSync(resolve(__dirname, "../../src/features/auth/auth.css"), "utf8"));
const tokensCss = readFileSync(resolve(__dirname, "../../src/ui/tokens.css"), "utf8");

describe("auth.css", () => {
  it("uses no raw colour, and only --pg-* custom properties", () => {
    expect(authCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(authCss).not.toMatch(/\b(rgba?|hsla?|oklch)\(/);
    for (const match of authCss.matchAll(/var\(\s*(--[\w-]+)/g)) expect(match[1]).toMatch(/^--pg-/);
  });

  it("uses logical properties only, and no fixed width or height", () => {
    for (const pattern of [
      /(^|[\s;{])margin-(left|right|top|bottom)\s*:/,
      /(^|[\s;{])padding-(left|right|top|bottom)\s*:/,
      /(^|[\s;{])border-(left|right|top|bottom)(-\w+)?\s*:/,
      /(^|[\s;{])(left|right|top|bottom)\s*:/,
      /(^|[\s;{])float\s*:/,
      /(^|[\s;{])text-align\s*:\s*(left|right)/,
      /(^|[\s;{])(width|height|min-width|max-width)\s*:/,
    ]) {
      expect(authCss, String(pattern)).not.toMatch(pattern);
    }
    expect(authCss).not.toContain("!important");
    expect(authCss).not.toMatch(/font-size\s*:/);
  });

  it("keeps the card fluid below its 400 px measure, and wraps a long address", () => {
    const card = /\.pg-auth__card\s*\{([^}]*)\}/.exec(authCss)?.[1] ?? "";
    expect(card).toMatch(/inline-size:\s*100%/);
    expect(card).toMatch(/max-inline-size:\s*var\(--pg-auth-measure\)/);
    expect(card).toMatch(/min-inline-size:\s*0/);
    expect(card).toMatch(/overflow-wrap:\s*anywhere/);
    expect(tokensCss).toContain("--pg-auth-measure: 25rem;");
  });

  it("gives Marathi text the next line-height step", () => {
    expect(authCss).toMatch(/\.pg-shell--auth:lang\(mr\)/);
    for (const role of ["p", ".pg-field__label", ".pg-field__error", ".pg-inline-message__text"]) {
      expect(authCss).toContain(`.pg-shell--auth:lang(mr) ${role}`);
    }
  });

  it("names the system's Devanagari faces after the Latin ones, downloading nothing", () => {
    const sans = /--pg-font-sans:([^;]*);/.exec(tokensCss)?.[1] ?? "";
    expect(sans.indexOf('"Nirmala UI"')).toBeGreaterThan(sans.indexOf('"Segoe UI"'));
    expect(sans).toContain('"Kohinoor Devanagari"');
    expect(sans).toContain('"Noto Sans Devanagari"');
    expect(tokensCss).not.toMatch(/@font-face|url\(/);
  });
});

describe("Where sign-in sends a person back to", () => {
  const INVITE = "/invite/6f1c2e3a-4b5d-4e6f-8a7b-9c0d1e2f3a4b";

  it("accepts workspace routes and an invitation's page", () => {
    for (const path of [
      "/org/o/settings",
      "/org/o/pub/p/overview",
      "/org/o/pub/p/archive/r",
      "/org/o/pub/p/editions/e",
      "/org/o/pub/p/editions/e/editor",
      INVITE,
    ]) {
      expect(safeReturnTo(path, "fallback"), path).toBe(path);
    }
  });

  it("refuses everything else", () => {
    for (const path of [
      null,
      "",
      "https://evil.example/",
      "//evil.example/org/o/settings",
      "/login",
      "/",
      "/invite/not-an-id",
      `${INVITE}/extra`,
      "/org/o/settings?next=//evil.example",
      "/org/o/unknown",
      "org/o/settings",
    ]) {
      expect(safeReturnTo(path, "fallback"), String(path)).toBe("fallback");
    }
  });

  it("knows the sign-in screens", () => {
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password", "/verify", INVITE]) {
      expect(isAuthPath(path), path).toBe(true);
    }
    for (const path of ["/", "/security", "/invite", "/invite/a/b", "/org/o/settings"]) {
      expect(isAuthPath(path), path).toBe(false);
    }
  });
});
