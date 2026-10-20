/**
 * Import boundary test (UI002 §16, §14's boundary row).
 * Verifies that durable `src/app/**` code never imports
 * `src/demo/**` or any of the forbidden module patterns.
 *
 * File contents are read via Vite's `import.meta.glob` (eager, raw)
 * rather than Node `fs`, following the pattern UI001's own
 * `boundary.test.ts` established (see `frontend/DEPENDENCIES.md`'s
 * `@types/node` record for why this works for `.ts`/`.tsx` sources
 * specifically).
 */
import { describe, it, expect } from "vitest";

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

/**
 * Forbidden import path patterns for durable `src/app/**` code.
 * "routing" here means a future service-routing concept, not the
 * `react-router` package itself, which durable shell code legitimately
 * imports — the pattern matches a `/routing/` path *segment*, which
 * the bare specifier `"react-router"` never contains.
 */
const FORBIDDEN_APP_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /(^|\/)demo(\/|$)/, name: "demo module" },
  { pattern: /(^|\/)routing(\/|$)/, name: "routing module" },
  { pattern: /(^|\/)storage(\/|$)/, name: "storage module" },
  { pattern: /(^|\/)editor(\/|$)/, name: "editor module" },
  { pattern: /(^|\/)canvas(\/|$)/, name: "canvas module" },
  { pattern: /(^|\/)composition(\/|$)/, name: "composition module" },
  { pattern: /(^|\/)publishing(\/|$)/, name: "publishing module" },
];

const appModules = import.meta.glob("/src/app/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("Durable src/app module import boundaries", () => {
  const appFiles = Object.entries(appModules);

  it("found durable app files to scan", () => {
    expect(appFiles.length).toBeGreaterThan(0);
  });

  for (const [relativePath, source] of appFiles) {
    describe(relativePath, () => {
      const imports = extractImportPaths(source);

      for (const { pattern, name } of FORBIDDEN_APP_PATTERNS) {
        it(`does not import from ${name}`, () => {
          const violating = imports.filter((imp) => pattern.test(imp));
          expect(violating).toHaveLength(0);
        });
      }
    });
  }
});

// ── Demo layer boundary ─────────────────────────────────────────────

const demoModules = import.meta.glob("/src/demo/ui002/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("Demo layer (src/demo/ui002) does not import test helpers", () => {
  const demoFiles = Object.entries(demoModules);

  it("found demo files to scan", () => {
    expect(demoFiles.length).toBeGreaterThan(0);
  });

  for (const [relativePath, source] of demoFiles) {
    it(`${relativePath} does not import from a test helper`, () => {
      const imports = extractImportPaths(source);
      const violating = imports.filter((imp) => /(^|\/)test(\/|$)/.test(imp));
      expect(violating).toHaveLength(0);
    });
  }
});

// ── Canonical UI003 data backs UI002 route resolution ─────────────

describe("Fixture set supports the no-leakage tests", () => {
  it("has two organizations, each with at least one publication", async () => {
    const { createMockServiceEnvironment } = await import("../../src/mocks/index.ts");
    const { workspace } = createMockServiceEnvironment();
    const organizations = await workspace.listOrganizations();
    expect(organizations.ok).toBe(true);
    if (!organizations.ok) return;
    const orgIds = new Set(organizations.value.map((o) => o.id));
    expect(orgIds.size).toBeGreaterThanOrEqual(2);
    for (const orgId of orgIds) {
      const publications = await workspace.listPublications({ organizationId: orgId });
      expect(publications.ok && publications.value.length > 0).toBe(true);
    }
  });

  it("has an edition and a release, each scoped to a specific publication", async () => {
    const { createMockServiceEnvironment } = await import("../../src/mocks/index.ts");
    const { RELEASE_FIXTURES } = await import("../../src/demo/ui002/release-fixtures.ts");
    const { workspace } = createMockServiceEnvironment();
    const edition = await workspace.getEdition({ organizationId: "org-demo-sahyadri", publicationId: "pub-demo-pune-daily", editionId: "edition-demo-001" });
    expect(edition.ok).toBe(true);
    expect(RELEASE_FIXTURES).toHaveLength(1);
  });
});

// ── No forbidden production/backend scaffolding ────────────────────

describe("No forbidden directory scaffold", () => {
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
