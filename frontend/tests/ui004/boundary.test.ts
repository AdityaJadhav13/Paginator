import { describe, expect, it } from "vitest";

function imports(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]!);
}

const serviceModules = import.meta.glob("/src/services/**/*.{ts,tsx}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const appFeatureModules = import.meta.glob(["/src/app/**/*.{ts,tsx}", "/src/features/**/*.{ts,tsx}"], { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const ui002Modules = import.meta.glob("/src/demo/ui002/**/*.{ts,tsx}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

describe("UI004 dependency and fixture boundaries", () => {
  it("service contracts import neither React nor mocks", () => {
    for (const source of Object.values(serviceModules)) {
      expect(imports(source).filter((path) => path === "react" || path.includes("/mocks"))).toEqual([]);
    }
  });

  it("durable app/feature code imports no mock seed or controller", () => {
    for (const source of Object.values(appFeatureModules)) {
      expect(imports(source).filter((path) => /mocks\/(seed|session-seed)|MockSessionController/.test(path))).toEqual([]);
    }
  });

  it("UI002 owns only the release route-context literal", () => {
    const source = Object.values(ui002Modules).join("\n");
    expect(source).toContain("release-demo-001");
    expect(source).not.toContain("org-demo-sahyadri");
    expect(source).not.toContain("pub-demo-urdu-evening");
    expect(source).not.toContain("edition-demo-001");
    expect(source).not.toContain("UI002_FIXTURES");
  });

  it("session seed stores only IDs, roles, and grant relationships", () => {
    const modules = import.meta.glob("/src/mocks/session-seed.ts", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    const source = Object.values(modules)[0] ?? "";
    expect(source).toContain("user-demo-sahyadri-editor");
    expect(source).not.toMatch(/Media Cooperative|Daily Ledger|Evening Record|Ratnagiri Tide|en-IN|ur-IN|edition-demo/);
  });
});
