// Dependency-graph check for the workspace (reads package.json files; independent of any generated graph).
//   - every external version is exact (no ^ ~ * ranges, tags, URLs or file: paths); catalog entries too;
//   - kernel packages never depend on apps or server modules;
//   - no dependency cycles between @pageinator packages.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO, fail } from "./lib.ts";

type Manifest = { name: string; [field: string]: unknown };
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const KERNEL = new Set(
  [
    "pyshim",
    "harfbuzz",
    "fonts",
    "shape",
    "hyphenate",
    "compose",
    "headline",
    "document",
    "pdf",
    "kernel",
    "layout-gen",
    "preflight",
    "color",
  ].map((n) => `@pageinator/${n}`),
);
const APPS = new Set(["@pageinator/web", "@pageinator/api", "@pageinator/worker", "@pageinator/kernel-cli"]);
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function manifests(): [string, Manifest][] {
  const dirs = ["."];
  for (const group of ["apps", "packages", "modules"]) {
    const abs = join(REPO, group);
    if (existsSync(abs)) for (const d of readdirSync(abs)) dirs.push(`${group}/${d}`);
  }
  dirs.push("tools/testkit");
  return dirs
    .filter((d) => existsSync(join(REPO, d, "package.json")))
    .map((d) => [d, JSON.parse(readFileSync(join(REPO, d, "package.json"), "utf8")) as Manifest]);
}

function specOk(spec: string): boolean {
  if (spec === "workspace:*" || spec === "catalog:") return true;
  if (spec.startsWith("npm:")) return EXACT.test(spec.slice(spec.lastIndexOf("@") + 1));
  return EXACT.test(spec);
}

const problems: string[] = [];
const edges = new Map<string, string[]>();
for (const [dir, m] of manifests()) {
  const deps: string[] = [];
  for (const field of FIELDS) {
    const entries = (m[field] ?? {}) as Record<string, string>;
    for (const [name, spec] of Object.entries(entries)) {
      if (!specOk(spec)) problems.push(`${dir}/package.json ${field}.${name}: "${spec}" is not an exact version`);
      if (name.startsWith("@pageinator/")) deps.push(name);
      if (KERNEL.has(m.name) && (APPS.has(name) || name.startsWith("@pageinator/module-"))) {
        problems.push(`${m.name} must not depend on ${name} (kernel packages never depend on apps or modules)`);
      }
    }
  }
  edges.set(m.name, deps);
}

// catalog entries in pnpm-workspace.yaml (simple "name: version" lines under catalog:)
const yaml = readFileSync(join(REPO, "pnpm-workspace.yaml"), "utf8").split("\n");
let inCatalog = false;
for (const line of yaml) {
  if (/^\S/.test(line)) inCatalog = line.startsWith("catalog:");
  else if (inCatalog) {
    const m = /^\s+("?[^":]+"?):\s*"?([^"#]+?)"?\s*(#.*)?$/.exec(line);
    if (m && !specOk((m[2] ?? "").trim())) problems.push(`catalog ${m[1]}: "${m[2]}" is not an exact version`);
  }
}

// cycles
const state = new Map<string, number>();
function visit(n: string, path: string[]): void {
  if (state.get(n) === 2) return;
  if (state.get(n) === 1) {
    problems.push(`dependency cycle: ${[...path, n].join(" → ")}`);
    return;
  }
  state.set(n, 1);
  for (const d of edges.get(n) ?? []) visit(d, [...path, n]);
  state.set(n, 2);
}
for (const n of edges.keys()) visit(n, []);

fail(problems, "dependency-graph check failed");
console.log(`✓ dependency graph: ${edges.size} workspace packages, exact versions, no cycles`);
