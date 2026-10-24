// Licence check for every npm package of the workspace (the launch plan, docs/product/09-launch-plan.md §1):
// permissive licences only. Other licences pass only for listed packages after review (MPL-2.0, file-level copyleft,
// for build and test tools; two more permissive licences used by common tools). It fails closed:
// - every package in pnpm-lock.yaml must be installed and checked here, except builds of a reviewed package for
//   other platforms;
// - pnpm-lock.yaml is read only in the shapes pnpm writes it, and a folder dependency (link:, file:) only as an
//   importer's version pointing at a workspace package; any other line, or a lockfile it cannot read, is a problem;
// - every link pnpm installed must be an installed package of the workspace's store or a workspace project, as
//   pnpm itself records the workspace; patches, a .pnpmfile and links left out of the lockfile are refused;
// - a licence expression or a package.json it cannot read is a problem too.
// Not covered: packages bundled inside another package's tarball (bundledDependencies) are not seen separately.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { REPO, fail } from "./lib.ts";
import { INVENTORY, pythonProblems, readPython } from "./python-licences.ts";

export const ALLOWED = new Set(["MIT", "MIT-0", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"]);
/** "<licence> WITH <exception>" forms that keep the licence permissive. */
export const EXCEPTIONS = new Set(["Apache-2.0 WITH LLVM-exception"]);
/** Reviewed exceptions: package name → the licence it was reviewed under, and why it is acceptable. */
export const REVIEWED: Record<string, { licence: string; why: string }> = {
  lightningcss: { licence: "MPL-2.0", why: "build tool only (CSS); never shipped modified" },
  "axe-core": { licence: "MPL-2.0", why: "test tool only (accessibility checks); never shipped" },
  "lru-cache": { licence: "BlueOak-1.0.0", why: "permissive (like MIT, with a patent grant); a tool dependency" },
  minimatch: { licence: "BlueOak-1.0.0", why: "permissive (like MIT, with a patent grant); a tool dependency" },
  "mdn-data": { licence: "CC0-1.0", why: "public-domain data for the CSS tools" },
};
/** A build's platform in its package name: operating system, processor, and an optional C library or ABI. */
const PLATFORM =
  "(?:aix|android|darwin|freebsd|linux|netbsd|openbsd|openharmony|sunos|win32)-" +
  "(?:arm|arm64|ia32|loong64|mips64el|ppc64|riscv64|s390x|x64)(?:-(?:eabi|gnu|gnueabihf|msvc|musl))?";
/** Packages built for each platform (only this platform's builds are installed), each family under the licence it
 * was reviewed under: a build installed here must have exactly that licence; a build for another platform passes.
 * Matched by the whole name, so a package only named like a family is checked as any other. */
export const PLATFORM_FAMILIES: { name: RegExp; licence: string }[] = [
  { name: new RegExp(`^@rolldown/binding-${PLATFORM}$`), licence: "MIT" },
  { name: new RegExp(`^@typescript/typescript-${PLATFORM}$`), licence: "Apache-2.0" },
  { name: new RegExp(`^lightningcss-${PLATFORM}$`), licence: "MPL-2.0" }, // as lightningcss itself (REVIEWED)
  { name: /^fsevents$/, licence: "MIT" },
];

/** An SPDX licence expression (AND before OR, brackets, WITH) made only of allowed licences: true. A choice
 * ("A OR B") needs one allowed side; anything it cannot read is false. */
export function licenceOk(expr: string): boolean {
  const tokens = expr.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const atom = (): boolean | null => {
    const t = tokens[i++];
    if (t === undefined || t === ")" || t === "AND" || t === "OR" || t === "WITH") return null;
    if (t === "(") {
      const v = either();
      return tokens[i++] === ")" ? v : null;
    }
    if (tokens[i] === "WITH") {
      const exception = tokens[i + 1];
      i += 2;
      return exception && exception !== "(" && exception !== ")" ? EXCEPTIONS.has(`${t} WITH ${exception}`) : null;
    }
    return ALLOWED.has(t);
  };
  const both = (): boolean | null => {
    let v = atom();
    while (v !== null && tokens[i] === "AND") {
      i += 1;
      const r = atom();
      v = r === null ? null : v && r;
    }
    return v;
  };
  const either = (): boolean | null => {
    let v = both();
    while (v !== null && tokens[i] === "OR") {
      i += 1;
      const r = both();
      v = r === null ? null : v || r;
    }
    return v;
  };
  return either() === true && i === tokens.length;
}

export type Pkg = { name: string; version: string; licence: string };

/** The licence a package.json states: `license` (a string, or an old { type } object) or an old `licenses` list,
 * which must hold for all its entries (read as AND). A list entry must be one licence id: anything else ("" here,
 * which fails) could smuggle an operator or a bracket into the expression. */
export function licenceOf(m: { license?: unknown; licenses?: unknown }): string {
  if (typeof m.license === "string") return m.license;
  if (typeof m.license === "object" && m.license !== null) return String((m.license as { type?: unknown }).type ?? "");
  if (Array.isArray(m.licenses)) {
    const ids = m.licenses.map((l) =>
      typeof l === "string" ? l : String((l as { type?: unknown } | null)?.type ?? ""),
    );
    return ids.length && ids.every((id) => /^[A-Za-z0-9.+-]+$/.test(id)) ? ids.join(" AND ") : "";
  }
  return "";
}

/** Every package in node_modules/.pnpm (each name@version once), and the package.json files it could not read. */
export function installed(repo: string): { pkgs: Pkg[]; unreadable: string[] } {
  const store = join(repo, "node_modules", ".pnpm");
  const found = new Map<string, Pkg>();
  const unreadable: string[] = [];
  if (!existsSync(store)) return { pkgs: [], unreadable };
  for (const entry of readdirSync(store)) {
    const nm = join(store, entry, "node_modules");
    if (!existsSync(nm)) continue;
    for (const first of readdirSync(nm)) {
      const dirs = first.startsWith("@") ? readdirSync(join(nm, first)).map((s) => join(first, s)) : [first];
      for (const d of dirs) {
        if (!entry.startsWith(d.replace("/", "+") + "@")) continue; // the entry's own package, not a link to another
        const file = join(nm, d, "package.json");
        let m: { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown };
        try {
          m = JSON.parse(readFileSync(file, "utf8")) as typeof m;
        } catch {
          unreadable.push(`${entry}/${d}`);
          continue;
        }
        if (typeof m.name !== "string" || typeof m.version !== "string") {
          unreadable.push(`${entry}/${d}`);
          continue;
        }
        found.set(`${m.name}@${m.version}`, { name: m.name, version: m.version, licence: licenceOf(m) });
      }
    }
  }
  return { pkgs: [...found.values()], unreadable };
}

export type Locked = { key: string; platform: boolean };
export type Lockfile = {
  version: string;
  documents?: number; // YAML documents in the file (pnpm writes one)
  packages: Locked[];
  importers: string[];
  links: { from: string; to: string }[];
  unread?: string[]; // lines of the importers section in a form this check does not read (never silently skipped)
  settings?: Record<string, string>; // the lockfile's own settings (excludeLinksFromLockfile …)
  sections?: string[]; // its top-level keys
};

/** A plain or single-quoted YAML key or value, as pnpm writes them (never double quotes, block styles, tags,
 * anchors or comments: a lockfile written another way is not read, so it fails rather than being skipped). */
const QUOTED = "'(?:[^']|'')*'";
const KEY = `(${QUOTED}|[^\\s'"#&*!|>%@\`{}\\[\\],?:-](?:[^:#]*[^\\s:#])?)`;
const VALUE = `(${QUOTED}|[^\\s'"#&*!|>%@\`{}\\[\\],?][^#]*?)`;
const unquote = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);
const IMPORTER = {
  importer: new RegExp(`^ {2}${KEY}:( \\{\\})?$`), // "  dir:", "  'dir':" or "  dir: {}" (no dependencies)
  group: /^ {4}(dependencies|devDependencies|optionalDependencies|dependenciesMeta):( \{\})?$/,
  publish: new RegExp(`^ {4}publishDirectory: ${VALUE}$`),
  dependency: new RegExp(`^ {6}${KEY}:$`),
  field: new RegExp(`^ {8}(specifier|version): ${VALUE}$`),
  injected: /^ {8}injected: (true|false)$/,
};

/** pnpm-lock.yaml (lockfile 9): its packages (name@version; `platform` when it is built for some platforms only)
 * and its workspace links ({ from: importer folder, to: the folder linked }). Every line of the importers section
 * must have one of pnpm's own shapes, a line at column 0 must be a top-level key, and a folder dependency (link:,
 * file:) may appear only as an importer's version: anything else is listed in `unread` and fails. */
export function lockfile(raw: string): Lockfile {
  const text = raw.replace(/\r\n?/g, "\n");
  const version = /^lockfileVersion: '?([^'\n]+)'?$/m.exec(text)?.[1] ?? "";
  const unread: string[] = [];
  const sections = new Map<string, string[]>(); // top-level key → its lines
  let current = "";
  for (const line of text.split("\n")) {
    const top = /^([A-Za-z][A-Za-z0-9]*):( .*)?$/.exec(line);
    if (top) {
      current = top[1] ?? "";
      sections.set(current, []);
    } else if (line !== "" && !line.startsWith(" ") && line !== "---") unread.push(line);
    else sections.get(current)?.push(line);
  }
  const keyOf = (block: string) => /^ {2}('?)(.+?)\1:\s*$/m.exec(block)?.[2]; // "  name@1.0.0:" or "  '@s/n@1.0.0':"
  const packages: Locked[] = [];
  for (const block of (sections.get("packages") ?? []).join("\n").split(/\n(?= {2}\S)/)) {
    const key = keyOf(block);
    if (key) packages.push({ key, platform: /\n {4}(os|cpu|libc):/.test(block) });
  }
  const importers: string[] = [];
  const links: { from: string; to: string }[] = [];
  let from: string | null = null;
  for (const line of sections.get("importers") ?? []) {
    if (line === "") continue;
    const importer = IMPORTER.importer.exec(line);
    if (importer) {
      from = unquote(importer[1] ?? "");
      importers.push(from);
      continue;
    }
    if (
      from !== null &&
      [IMPORTER.group, IMPORTER.publish, IMPORTER.dependency, IMPORTER.injected].some((r) => r.test(line))
    )
      continue;
    const field = from !== null ? IMPORTER.field.exec(line) : null;
    if (field && from !== null) {
      // a folder link is relative to its importer; an absolute one is kept as it is (it is never a workspace package)
      // pnpm may write the folder with the package's name before it: version: foo@file:../x, @a/b@link:../y
      const folder =
        field[1] === "version" ? /^(?:(?:@[^@/\s]+\/)?[^@\s]+@)?(link|file):(.*)$/.exec(unquote(field[2] ?? "")) : null;
      if (folder) {
        const t = (folder[2] ?? "").trim();
        links.push({
          from,
          to: folder[1] === "file" ? `file:${t}` : t.startsWith("/") ? t : posix.normalize(posix.join(from, t)),
        });
      }
      continue;
    }
    unread.push(line.trim());
  }
  // a folder dependency anywhere else (an override, a snapshot) would be installed without this check seeing it: link:
  // or file: not inside a name (get-caller-file: 2.0.5, some-link: 1.0.0), so foo@file:…, [link:… and ,file:… count
  for (const [name, lines] of sections)
    if (name !== "importers")
      for (const line of lines) if (/(?<![\w.~-])(link|file):/.test(line)) unread.push(`${name}: ${line.trim()}`);
  const settings: Record<string, string> = {};
  for (const line of sections.get("settings") ?? []) {
    const m = /^ {2}([A-Za-z]+): (\S+)$/.exec(line);
    if (m) settings[m[1] ?? ""] = m[2] ?? "";
  }
  const documents = text.split(/^---\s*$/m).filter((part) => part.trim()).length || 1;
  return { version, documents, packages, importers, links, unread, settings, sections: [...sections.keys()] };
}

/** pnpm's own record of the workspace's projects (their folders), or null when it cannot be read. */
export function workspaceProjects(repo: string): string[] | null {
  try {
    const state = JSON.parse(readFileSync(join(repo, "node_modules", ".pnpm-workspace-state-v1.json"), "utf8")) as {
      projects?: Record<string, unknown>;
    };
    return Object.keys(state.projects ?? {}).map((p) => realpathSync(p));
  } catch {
    return null;
  }
}

/** What pnpm installed, checked against pnpm's own record of the workspace and never the lockfile's text: every link
 * in node_modules (the projects', the store's and each installed package's own) must be an installed package of the
 * root's store, or a workspace project (or the folder it is published from); every project must be the lockfile's,
 * and the other way round; and no project keeps packages of its own (one shared lockfile and store). */
export function installedLinks(repo: string, importers: string[]): string[] {
  const root = realpathSync(repo);
  const projects = workspaceProjects(repo);
  if (!projects) return ["node_modules/.pnpm-workspace-state-v1.json cannot be read: run pnpm install first"];
  const rel = (p: string) => relative(root, p).split(sep).join("/") || ".";
  const out: string[] = [];
  const listed = new Set(importers.map((i) => posix.normalize(i)));
  for (const p of projects)
    if (!listed.has(rel(p))) out.push(`${rel(p)}: a workspace project pnpm-lock.yaml does not list`);
  for (const i of listed)
    if (!projects.some((p) => rel(p) === i)) out.push(`pnpm-lock.yaml lists ${i}, which is not a workspace project`);
  const targets = new Set(projects);
  for (const p of projects) {
    if (p !== root)
      for (const f of ["node_modules/.pnpm", "pnpm-lock.yaml"])
        if (existsSync(join(p, f))) out.push(`${rel(p)}/${f}: packages installed apart from the workspace's`);
    try {
      const dir = (
        JSON.parse(readFileSync(join(p, "package.json"), "utf8")) as { publishConfig?: { directory?: unknown } }
      ).publishConfig?.directory;
      if (typeof dir === "string") {
        const at = realpathSync(join(p, dir));
        if (at.startsWith(p + sep)) targets.add(at); // a project published from a folder of its own is linked there
      }
    } catch {
      // no package.json, or no such folder: nothing more is linked
    }
  }
  const store = join(root, "node_modules", ".pnpm");
  const inStore = (t: string) => {
    const parts = relative(store, t).split(sep);
    if (parts[0] === undefined || parts[0] === ".." || parts[0] === "node_modules" || parts[1] !== "node_modules")
      return false;
    return parts.length === 3 || (parts.length === 4 && (parts[2] ?? "").startsWith("@"));
  };
  const dirs = new Set(projects.map((p) => join(p, "node_modules")));
  if (existsSync(store))
    for (const e of readdirSync(store))
      dirs.add(e === "node_modules" ? join(store, e) : join(store, e, "node_modules"));
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const first of readdirSync(dir)) {
      if (first.startsWith(".")) continue; // .pnpm (walked above), .bin, .modules.yaml …
      const names = first.startsWith("@") ? readdirSync(join(dir, first)).map((s) => join(first, s)) : [first];
      for (const name of names) {
        const at = join(dir, name);
        if (!lstatSync(at).isSymbolicLink()) continue;
        let target: string;
        try {
          target = realpathSync(at);
        } catch {
          out.push(`${rel(at)}: a link to a folder that is not there`);
          continue;
        }
        if (!inStore(target) && !targets.has(target))
          out.push(
            `${rel(at)}: links ${target === root || target.startsWith(root + sep) ? rel(target) : "a folder outside this repository"}, ` +
              "which is neither an installed package nor a workspace project",
          );
      }
    }
  }
  return out.sort();
}

const familyOf = (name: string) => PLATFORM_FAMILIES.find((f) => f.name.test(name));
const nameOf = (key: string) => key.slice(0, key.lastIndexOf("@"));

export function licenceProblems(pkgs: Pkg[], lock?: Lockfile, unreadable: string[] = []): string[] {
  const problems: string[] = unreadable.map((p) => `${p}: its package.json cannot be read`);
  // a family's rule is for its platform builds only (as the lockfile marks them), not for any package named like one
  const platform = lock ? new Set(lock.packages.filter((l) => l.platform).map((l) => l.key)) : null;
  for (const p of pkgs) {
    const family = !platform || platform.has(`${p.name}@${p.version}`) ? familyOf(p.name) : undefined;
    if (family) {
      if (p.licence !== family.licence)
        problems.push(
          `${p.name}@${p.version}: licence ${p.licence || "(none given)"} is not the ${family.licence} its ` +
            "family was reviewed under",
        );
      continue;
    }
    if (licenceOk(p.licence)) continue;
    const reviewed = Object.hasOwn(REVIEWED, p.name) ? REVIEWED[p.name] : undefined;
    if (reviewed && reviewed.licence === p.licence) continue;
    problems.push(`${p.name}@${p.version}: licence ${p.licence || "(none given)"} is not allowed`);
  }
  if (lock) {
    if (!pkgs.length) problems.push("no installed packages were found: run pnpm install first");
    if (lock.version !== "9.0")
      problems.push(`pnpm-lock.yaml is format ${lock.version || "(none)"}: this check reads 9.0`);
    if (!lock.packages.length || !lock.importers.length) problems.push("pnpm-lock.yaml lists no packages or importers");
    if ((lock.documents ?? 1) > 1)
      problems.push("pnpm-lock.yaml holds more than one YAML document: this check reads one");
    for (const line of lock.unread ?? []) problems.push(`pnpm-lock.yaml: a line this check cannot read: ${line}`);
    if (lock.settings?.excludeLinksFromLockfile === "true")
      problems.push("pnpm-lock.yaml leaves links out (excludeLinksFromLockfile): this check needs them in it");
    if (lock.sections?.includes("patchedDependencies"))
      problems.push("pnpm-lock.yaml patches packages: a patch can change what this check reads; review it first");
    if (lock.sections?.includes("pnpmfileChecksum"))
      problems.push("a .pnpmfile changes packages at install time: review it first");
    for (const i of lock.importers) {
      const at = posix.normalize(i);
      if (at === ".." || at.startsWith("../") || at.startsWith("/"))
        problems.push(`pnpm-lock.yaml: the importer ${i} is outside this repository`);
    }
    const have = new Set(pkgs.map((p) => `${p.name}@${p.version}`));
    for (const l of lock.packages) {
      if (have.has(l.key)) continue;
      if (/@(file|link):/.test(l.key)) {
        problems.push(`${l.key}: a dependency from a folder, not from the registry: its licence is not checked`);
        continue;
      }
      const family = familyOf(nameOf(l.key));
      if (l.platform && family) continue; // another platform's build of a reviewed family
      problems.push(`${l.key}: in pnpm-lock.yaml but not installed here, so its licence was not checked`);
    }
    const workspace = new Set(lock.importers.map((i) => posix.normalize(i)));
    for (const link of lock.links)
      if (!workspace.has(link.to))
        problems.push(`${link.from}: links ${link.to}, which is not a package of this workspace`);
  }
  return [...new Set(problems)].sort();
}

if (import.meta.main) {
  const { pkgs, unreadable } = installed(REPO);
  const lock = lockfile(readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8"));
  const python = readPython(REPO);
  const py = python.inv
    ? pythonProblems(python.inv, python.locks)
    : { problems: [`${INVENTORY} cannot be read: run tools/licences/python_inventory.py`], awaiting: [] };
  const problems = [
    ...licenceProblems(pkgs, lock, unreadable),
    ...installedLinks(REPO, lock.importers),
    ...py.problems,
  ];
  fail(problems, `licence check: ${problems.length} problem(s)`);
  console.log(`✓ licence check: ${pkgs.length} installed packages and pnpm-lock.yaml, all with allowed licences`);
  const pins = Object.keys(python.inv?.packages ?? {}).length;
  console.log(`✓ licence check: ${pins} Python pins of ${Object.keys(python.locks).length} locks (manylinux wheels)`);
  for (const a of py.awaiting) console.log(`  ⚑ ${a}`);
}
