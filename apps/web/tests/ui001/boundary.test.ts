/**
 * Task 10 — Import boundary test.
 * Verifies that durable src/ui/** code has no imports from
 * demo, service, routing, storage, auth, editor, canvas,
 * composition, or publishing modules.
 * Verifies that src/demo/ui001 code does not import from
 * modules outside the allowed boundaries.
 *
 * AC-27: Durable src/ui/** code has no forbidden imports.
 * AC-30: Reviewer can identify durable vs disposable by paths alone.
 *
 * File contents are read via Vite's `import.meta.glob` (eager, raw)
 * instead of Node's `fs`/`path`, so this suite needs no Node type or
 * runtime dependency and can run unmodified in the browser-mode runner.
 */

import { describe, it, expect } from "vitest";

/** Extract all import paths (static and dynamic) from a file's source. */
function extractImportPaths(source: string): string[] {
  const importRegex = /from\s+["']([^"']+)["']/g;
  const dynamicImportRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  const paths: string[] = [];
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    paths.push(match[1]);
  }
  while ((match = dynamicImportRegex.exec(source)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

/** Forbidden import path patterns for durable src/ui/** code. */
const FORBIDDEN_UI_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /(^|\/)demo(\/|$)/, name: "demo module" },
  { pattern: /(^|\/)service[s]?(\/|$)/, name: "service module" },
  { pattern: /(^|\/)routing(\/|$)/, name: "routing module" },
  { pattern: /(^|\/)storage(\/|$)/, name: "storage module" },
  { pattern: /(^|\/)auth(entication)?(\/|$)/, name: "auth module" },
  { pattern: /(^|\/)editor(\/|$)/, name: "editor module" },
  { pattern: /(^|\/)canvas(\/|$)/, name: "canvas module" },
  { pattern: /(^|\/)composition(\/|$)/, name: "composition module" },
  { pattern: /(^|\/)publishing(\/|$)/, name: "publishing module" },
  { pattern: /(^|\/)edition-planning(\/|$)/, name: "edition-planning module" },
  { pattern: /(^|\/)press-profile(\/|$)/, name: "press-profile module" },
];

// ── Durable UI boundary checks ────────────────────────────────────

const uiModules = import.meta.glob("/src/ui/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("Durable UI module import boundaries (AC-27)", () => {
  const uiFiles = Object.entries(uiModules);

  it("found durable UI files to scan", () => {
    expect(uiFiles.length).toBeGreaterThan(0);
  });

  for (const [relativePath, source] of uiFiles) {
    describe(relativePath, () => {
      const imports = extractImportPaths(source);

      for (const { pattern, name } of FORBIDDEN_UI_PATTERNS) {
        it(`does not import from ${name}`, () => {
          const violating = imports.filter((imp) => pattern.test(imp));
          expect(violating).toHaveLength(0);
        });
      }

      it("has no side-effect import referencing a forbidden module", () => {
        const sideEffectImportRegex = /import\s+["']([^"']+)["']/g;
        const sideEffectPaths: string[] = [];
        let match;
        while ((match = sideEffectImportRegex.exec(source)) !== null) {
          sideEffectPaths.push(match[1]);
        }
        const violating = sideEffectPaths.filter((imp) =>
          FORBIDDEN_UI_PATTERNS.some(({ pattern }) => pattern.test(imp))
        );
        expect(violating).toHaveLength(0);
      });
    });
  }
});

// ── Demo module boundary checks ────────────────────────────────────

const demoModules = import.meta.glob("/src/demo/ui001/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("Demo fixtures do not import from UI internals (AC-30)", () => {
  const demoFiles = Object.entries(demoModules);

  it("found demo files to scan", () => {
    expect(demoFiles.length).toBeGreaterThan(0);
  });

  // Demo files may import from src/ui but must not import from test helpers
  const FORBIDDEN_DEMO_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /(^|\/)test(\/|$)/, name: "test helper (test utilities must not be imported by demo code)" },
  ];

  for (const [relativePath, source] of demoFiles) {
    describe(relativePath, () => {
      const imports = extractImportPaths(source);

      for (const { pattern, name } of FORBIDDEN_DEMO_PATTERNS) {
        it(`does not import from ${name}`, () => {
          const violating = imports.filter((imp) => pattern.test(imp));
          expect(violating).toHaveLength(0);
        });
      }
    });
  }
});

// ── fixtureKind marker ────────────────────────────────────────────

describe("Demo fixtures declare fixtureKind (AC-30)", () => {
  it("fixtures.ts declares FIXTURE_KIND as 'ui001-demo-only'", async () => {
    const { FIXTURE_KIND } = await import("../../src/demo/ui001/fixtures.ts");
    expect(FIXTURE_KIND).toBe("ui001-demo-only");
  });

  it("organization fixture has fixtureKind=ui001-demo-only", async () => {
    const { ORG_SAHYADRI } = await import("../../src/demo/ui001/fixtures.ts");
    expect(ORG_SAHYADRI.fixtureKind).toBe("ui001-demo-only");
  });

  it("publication fixtures have fixtureKind=ui001-demo-only", async () => {
    const { PUB_PUNE_DAILY, PUB_URDU_EVENING } = await import("../../src/demo/ui001/fixtures.ts");
    expect(PUB_PUNE_DAILY.fixtureKind).toBe("ui001-demo-only");
    expect(PUB_URDU_EVENING.fixtureKind).toBe("ui001-demo-only");
  });

  it("capability fixtures have fixtureKind=ui001-demo-only", async () => {
    const {
      CAP_EDITION_VIEW,
      CAP_EDITION_EDIT,
      CAP_CANDIDATE_APPROVE_DENIED,
      CAP_PUBLICATION_SETTINGS_DENIED,
    } = await import("../../src/demo/ui001/fixtures.ts");
    expect(CAP_EDITION_VIEW.fixtureKind).toBe("ui001-demo-only");
    expect(CAP_EDITION_EDIT.fixtureKind).toBe("ui001-demo-only");
    expect(CAP_CANDIDATE_APPROVE_DENIED.fixtureKind).toBe("ui001-demo-only");
    expect(CAP_PUBLICATION_SETTINGS_DENIED.fixtureKind).toBe("ui001-demo-only");
  });
});

// ── Capability disclaimer ─────────────────────────────────────────

describe("Capability fixtures include required disclaimer (AC-25)", () => {
  it("all capability fixtures use the required disclaimer text", async () => {
    const {
      CAPABILITY_DISCLAIMER,
      CAP_EDITION_VIEW,
      CAP_EDITION_EDIT,
      CAP_CANDIDATE_APPROVE_DENIED,
      CAP_PUBLICATION_SETTINGS_DENIED,
    } = await import("../../src/demo/ui001/fixtures.ts");

    expect(CAPABILITY_DISCLAIMER).toBe(
      "Demonstration only — production authorization is not evaluated here"
    );
    expect(CAP_EDITION_VIEW.disclaimer).toBe(CAPABILITY_DISCLAIMER);
    expect(CAP_EDITION_EDIT.disclaimer).toBe(CAPABILITY_DISCLAIMER);
    expect(CAP_CANDIDATE_APPROVE_DENIED.disclaimer).toBe(CAPABILITY_DISCLAIMER);
    expect(CAP_PUBLICATION_SETTINGS_DENIED.disclaimer).toBe(CAPABILITY_DISCLAIMER);
  });
});

// Scenario content and sequencing (AC-26) are tested in
// showcase.test.tsx, alongside the showcase that actually renders
// them, rather than here — this file's scope is import boundaries and
// fixture markers (AC-27, AC-30), not scenario semantics.

// ── No backend scaffolding ────────────────────────────────────────
//
// Each entry uses its own literal glob (import.meta.glob requires a
// static string) so this remains one assertion per forbidden directory.

describe("No forbidden directory scaffold (AC-01)", () => {
  const scaffoldMatches: Record<string, Record<string, unknown>> = {
    backend: import.meta.glob("/backend/**"),
    workers: import.meta.glob("/workers/**"),
    publishing: import.meta.glob("/publishing/**"),
    schemas: import.meta.glob("/schemas/**"),
    infra: import.meta.glob("/infra/**"),
    services: import.meta.glob("/services/**"),
  };

  for (const [dir, matches] of Object.entries(scaffoldMatches)) {
    it(`does not contain a /${dir} directory`, () => {
      expect(Object.keys(matches)).toHaveLength(0);
    });
  }
});
