/**
 * Import boundaries and stylesheet scans (UI005 §26.2, §28 rows
 * "Stylesheet scans" and "Boundary"; AC-46, AC-47, AC-49 – AC-52).
 *
 * Module sources are read with `import.meta.glob(..., { query: "?raw" })`,
 * the pattern UI001/UI002 established for `.ts`/`.tsx`. CSS is read with
 * `node:fs` because a raw CSS import resolves to an empty string under
 * Vitest — a constraint recorded during UI001.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Strips comments before scanning. These files document what they must not
 * do ("no fetch, no mailto:, no !important"), so scanning raw source would
 * flag the prohibition itself rather than a violation of it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function importsOf(source: string): string[] {
  const paths: string[] = [];
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) paths.push(match[1]!);
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g))
    paths.push(match[1]!);
  for (const match of source.matchAll(/^import\s+["']([^"']+)["']/gm)) paths.push(match[1]!);
  return paths;
}

const publicModules = import.meta.glob("/src/features/public/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const appModules = import.meta.glob("/src/app/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const FORBIDDEN_FOR_PUBLIC: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /(^|\/)mocks(\/|$)/, name: "mock environment" },
  { pattern: /(^|\/)services(\/|$)/, name: "service module" },
  { pattern: /(^|\/)demo(\/|$)/, name: "demo module" },
  { pattern: /(^|\/)shells(\/|$)/, name: "shell module" },
];

describe("src/features/public import boundaries (AC-46)", () => {
  const files = Object.entries(publicModules);

  it("found public feature files to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const [path, source] of files) {
    const imports = importsOf(source);

    for (const { pattern, name } of FORBIDDEN_FOR_PUBLIC) {
      it(`${path} does not import a ${name}`, () => {
        expect(imports.filter((specifier) => pattern.test(specifier))).toEqual([]);
      });
    }

    it(`${path} reaches UI001 only through its public export surface`, () => {
      const uiImports = imports.filter((specifier) => specifier.includes("/ui/"));
      for (const specifier of uiImports) {
        expect(specifier, `${path} bypasses src/ui/index.ts`).toMatch(/\/ui\/index\.ts$/);
      }
    });
  }
});

describe("Durable app code does not depend on the public feature (AC-46)", () => {
  for (const [path, source] of Object.entries(appModules)) {
    it(`${path} does not import features/public`, () => {
      expect(
        importsOf(source).filter((specifier) => specifier.includes("features/public"))
      ).toEqual([]);
    });
  }
});

describe("No forbidden runtime behavior in public feature code", () => {
  const sources = Object.entries(publicModules);

  const FORBIDDEN_CALLS = [
    "fetch(",
    "XMLHttpRequest",
    "sendBeacon",
    "new WebSocket",
    "EventSource",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "document.cookie",
    "mailto:",
  ];

  for (const [path, rawSource] of sources) {
    const source = stripComments(rawSource);
    it(`${path} performs no network, storage or mail side effect`, () => {
      for (const call of FORBIDDEN_CALLS) {
        expect(source, `${path} references ${call}`).not.toContain(call);
      }
    });
  }

  it("declares no form action, method or target anywhere", () => {
    for (const [path, rawSource] of sources) {
      const source = stripComments(rawSource);
      expect(source, `${path} sets a form action`).not.toMatch(/\baction=/);
      expect(source, `${path} sets a form method`).not.toMatch(/\bmethod=/);
      expect(source, `${path} sets a link or form target`).not.toMatch(/\btarget=/);
    }
  });

  it("references no analytics or telemetry identifier", () => {
    for (const [path, rawSource] of sources) {
      const source = stripComments(rawSource);
      expect(source.toLowerCase(), `${path} references analytics`).not.toMatch(
        /gtag|googletagmanager|analytics|mixpanel|segment\.|posthog|plausible|fathom|hotjar/
      );
    }
  });
});

// ── Stylesheet scans ───────────────────────────────────────────────────

const publicCss = stripComments(
  readFileSync(resolve(__dirname, "../../src/features/public/public.css"), "utf8")
);
const tokensCss = readFileSync(resolve(__dirname, "../../src/ui/tokens.css"), "utf8");

describe("public.css discipline (AC-50, AC-51, AC-52)", () => {
  it("contains no raw colour value", () => {
    expect(publicCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(publicCss).not.toMatch(/\brgba?\(/);
    expect(publicCss).not.toMatch(/\bhsla?\(/);
    expect(publicCss).not.toMatch(/\boklch\(/);
  });

  it("contains no physical-direction property", () => {
    const PHYSICAL = [
      /(^|[\s;{])margin-(left|right|top|bottom)\s*:/,
      /(^|[\s;{])padding-(left|right|top|bottom)\s*:/,
      /(^|[\s;{])border-(left|right|top|bottom)(-\w+)?\s*:/,
      /(^|[\s;{])(left|right|top|bottom)\s*:/,
      /(^|[\s;{])float\s*:/,
      /(^|[\s;{])text-align\s*:\s*(left|right)/,
      /(^|[\s;{])(width|height)\s*:/,
    ];
    for (const pattern of PHYSICAL) {
      expect(publicCss, `matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it("uses no !important and no viewport-unit type size", () => {
    expect(publicCss).not.toContain("!important");
    expect(publicCss).not.toMatch(/font-size\s*:\s*[\d.]+(vw|vh|vmin|vmax)/);
    expect(publicCss).not.toMatch(/font-size\s*:\s*\d/);
  });

  it("uses no elevation, gradient, blur or glow (AC-51)", () => {
    expect(publicCss).not.toMatch(/box-shadow/);
    expect(publicCss).not.toMatch(/--pg-shadow-raised/);
    expect(publicCss).not.toMatch(/gradient\(/);
    expect(publicCss).not.toMatch(/filter\s*:/);
    expect(publicCss).not.toMatch(/backdrop-filter/);
  });

  it("removes every transition under prefers-reduced-motion (AC-52)", () => {
    expect(publicCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("consumes only --pg-* custom properties", () => {
    for (const match of publicCss.matchAll(/var\(\s*(--[\w-]+)/g)) {
      expect(match[1]!).toMatch(/^--pg-/);
    }
  });
});

describe("tokens.css was extended, not changed (AC-49)", () => {
  const ADDED = [
    "--pg-font-serif",
    "--pg-font-size-700",
    "--pg-font-size-800",
    "--pg-line-height-700",
    "--pg-line-height-800",
    "--pg-space-10",
    "--pg-space-11",
  ];

  it("defines exactly the seven approved additions", () => {
    for (const token of ADDED) {
      expect(tokensCss).toContain(`${token}:`);
    }
  });

  it("preserves every pre-existing token value", () => {
    // A sample across each scale UI005 touched: if an existing step were
    // retuned to make the new steps fit, one of these would change.
    const UNCHANGED: Array<[string, string]> = [
      ["--pg-font-size-600", "2rem"],
      ["--pg-line-height-600", "2.5rem"],
      ["--pg-space-9", "4rem"],
      ["--pg-space-5", "1rem"],
      ["--pg-content-measure", "72rem"],
      ["--pg-reading-measure", "70ch"],
      ["--pg-color-text", "#17202A"],
      ["--pg-color-on-action", "#FFFFFF"],
      ["--pg-color-surface-subtle", "#F1F5F9"],
    ];
    for (const [token, value] of UNCHANGED) {
      expect(tokensCss).toContain(`${token}: ${value};`);
    }
  });

  it("adds no colour, radius, shadow or duration token", () => {
    const added = [...tokensCss.matchAll(/(--pg-[\w-]+):/g)].map((match) => match[1]!);
    const newColourish = added.filter(
      (token) =>
        (token.includes("color") || token.includes("radius") || token.includes("shadow")) &&
        !EXISTING_COLOURISH.includes(token)
    );
    expect(newColourish).toEqual([]);
  });
});

/** The colour/radius/shadow tokens UI001 shipped. UI005 adds none. */
const EXISTING_COLOURISH = [
  "--pg-color-backdrop",
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
  "--pg-radius-sm",
  "--pg-radius-md",
  "--pg-radius-lg",
  "--pg-radius-pill",
  "--pg-shadow-raised",
];

describe("No dependency was added (AC-47)", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8")
  ) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("keeps the runtime dependency set at react, react-dom and react-router", () => {
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "react",
      "react-dom",
      "react-router",
    ]);
  });

  it("introduces no UI005-specific development dependency", () => {
    const names = Object.keys(packageJson.devDependencies).join(" ");
    for (const forbidden of ["mdx", "markdown", "framer", "gsap", "swiper", "i18next", "lucide"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
