// Dependency-graph check for the workspace (reads package.json files; independent of any generated graph).
//   - every external version is exact (no ^ ~ * ranges, tags, URLs or file: paths); catalog and override entries too;
//   - kernel packages never depend on apps or server modules (every package under packages/ is a kernel package
//     unless tools/ts/workspace.json lists it as a browser package);
//   - no dependency cycles between @pageinator packages.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO, fail } from "./lib.ts";

type Manifest = { name: string; [field: string]: unknown };
type Workspace = { browserPackages: string[]; apps: string[] };
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const VERSION_BLOCKS = new Set(["catalog:", "overrides:"]);

function manifests(repo: string): [string, Manifest][] {
  const dirs = ["."];
  for (const group of ["apps", "packages", "modules"]) {
    const abs = join(repo, group);
    if (existsSync(abs)) for (const d of readdirSync(abs)) dirs.push(`${group}/${d}`);
  }
  dirs.push("tools/testkit");
  return dirs
    .filter((d) => existsSync(join(repo, d, "package.json")))
    .map((d) => [d, JSON.parse(readFileSync(join(repo, d, "package.json"), "utf8")) as Manifest]);
}

export function specOk(spec: string): boolean {
  if (spec === "workspace:*" || spec === "catalog:") return true;
  if (spec.startsWith("npm:")) return EXACT.test(spec.slice(spec.lastIndexOf("@") + 1));
  return EXACT.test(spec);
}

/** Problems in the catalog: and overrides: blocks of pnpm-workspace.yaml (one `name: version` per line). */
export function versionBlockProblems(yamlText: string): string[] {
  const problems: string[] = [];
  let inBlock = false;
  for (const [i, raw] of yamlText.split("\n").entries()) {
    const line = raw.replace(/(^|[ \t])#.*$/, "").trimEnd(); // a YAML comment starts at column 0 or after a blank
    if (line === "") continue;
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      inBlock = VERSION_BLOCKS.has(line);
      continue;
    }
    if (!inBlock) continue;
    const m = /^[ \t]+(?:"([^"]+)"|'([^']+)'|([^ \t"':]+)):[ \t]*(?:"([^"]*)"|'([^']*)'|([^ \t"']+))$/.exec(line);
    if (!m) {
      problems.push(`pnpm-workspace.yaml:${i + 1}: cannot read this line as "name: version": ${raw.trim()}`);
      continue;
    }
    const name = m[1] ?? m[2] ?? m[3] ?? "";
    const spec = m[4] ?? m[5] ?? m[6] ?? "";
    if (!specOk(spec)) problems.push(`pnpm-workspace.yaml:${i + 1}: ${name}: "${spec}" is not an exact version`);
  }
  return problems;
}

export function graphProblems(repo: string): { problems: string[]; packages: number } {
  const workspace = JSON.parse(readFileSync(join(repo, "tools/ts/workspace.json"), "utf8")) as Workspace;
  const apps = new Set(workspace.apps);
  const all = manifests(repo);
  const kernel = new Set(
    all
      .filter(
        ([dir]) => dir.startsWith("packages/") && !workspace.browserPackages.includes(dir.slice("packages/".length)),
      )
      .map(([, m]) => m.name),
  );
  const problems: string[] = [];
  const edges = new Map<string, string[]>();
  for (const [dir, m] of all) {
    const deps: string[] = [];
    for (const field of FIELDS) {
      const entries = (m[field] ?? {}) as Record<string, string>;
      for (const [name, spec] of Object.entries(entries)) {
        if (!specOk(spec)) problems.push(`${dir}/package.json ${field}.${name}: "${spec}" is not an exact version`);
        if (name.startsWith("@pageinator/")) deps.push(name);
        if (kernel.has(m.name) && (apps.has(name) || name.startsWith("@pageinator/module-"))) {
          problems.push(`${m.name} must not depend on ${name} (kernel packages never depend on apps or modules)`);
        }
      }
    }
    edges.set(m.name, deps);
  }
  problems.push(...versionBlockProblems(readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8")));
  const state = new Map<string, number>();
  const visit = (n: string, path: string[]): void => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) {
      problems.push(`dependency cycle: ${[...path, n].join(" → ")}`);
      return;
    }
    state.set(n, 1);
    for (const d of edges.get(n) ?? []) visit(d, [...path, n]);
    state.set(n, 2);
  };
  for (const n of edges.keys()) visit(n, []);
  return { problems, packages: edges.size };
}

if (import.meta.main) {
  const { problems, packages } = graphProblems(REPO);
  fail(problems, "dependency-graph check failed");
  console.log(`✓ dependency graph: ${packages} workspace packages, exact versions, no cycles`);
}
