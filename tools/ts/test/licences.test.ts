import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installed, installedLinks, licenceOf, licenceOk, licenceProblems, lockfile } from "../check-licences.ts";

describe("licence expressions", () => {
  it("allows permissive licences, and choices with an allowed side", () => {
    for (const l of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "(MIT OR GPL-3.0)", "MIT AND ISC", "(MIT) AND (ISC)"])
      expect(licenceOk(l), l).toBe(true);
    expect(licenceOk("MIT AND (GPL-3.0 OR ISC)")).toBe(true);
    expect(licenceOk("Apache-2.0 WITH LLVM-exception")).toBe(true);
  });
  it("reads AND before OR and keeps brackets, so a copyleft part cannot hide behind a choice", () => {
    for (const l of ["GPL-3.0 AND (MIT OR ISC)", "(MIT OR Apache-2.0) AND GPL-3.0", "LGPL-3.0 AND (MIT OR Apache-2.0)"])
      expect(licenceOk(l), l).toBe(false);
    expect(licenceOk("MIT OR GPL-3.0 AND AGPL-3.0")).toBe(true); // MIT, or both copyleft licences
    expect(licenceOk("GPL-3.0 OR MIT AND AGPL-3.0")).toBe(false);
  });
  it("refuses copyleft, source-available, missing and unreadable licences, without crashing", () => {
    for (const l of [
      "GPL-3.0",
      "AGPL-3.0-only",
      "LGPL-2.1",
      "SSPL-1.0",
      "BUSL-1.1",
      "UNLICENSED",
      "",
      "MIT AND GPL-2.0",
    ])
      expect(licenceOk(l), l).toBe(false);
    for (const l of ["MIT OR", "MIT AND", "OR", "(MIT", "MIT)", "MIT WITH", "GPL-2.0 WITH Classpath-exception-2.0"])
      expect(licenceOk(l), l).toBe(false);
    for (const l of ["SEE LICENSE IN LICENSE.md", "mit", "BlueOak-1.0.0", "CC0-1.0"])
      expect(licenceOk(l), l).toBe(false);
  });
  it("reads an old licenses list as all of its entries", () => {
    expect(licenceOk(licenceOf({ licenses: ["MIT", { type: "Apache-2.0" }] }))).toBe(true);
    expect(licenceOk(licenceOf({ licenses: ["MIT", { type: "GPL-2.0" }] }))).toBe(false);
    expect(licenceOk(licenceOf({ licenses: [{ type: "MIT" }, {}] }))).toBe(false);
    expect(licenceOk(licenceOf({ licenses: ["MIT) OR (MIT", "GPL-2.0"] }))).toBe(false); // no smuggled brackets
    expect(licenceOf({ license: { type: "ISC" } })).toBe("ISC");
  });
});

describe("licence problems", () => {
  const lock = (packages: { key: string; platform: boolean }[], links: { from: string; to: string }[] = []) => ({
    version: "9.0",
    packages,
    importers: [".", "tools/testkit"],
    links,
  });
  it("lets a reviewed package through only under the licence it was reviewed under", () => {
    expect(licenceProblems([{ name: "axe-core", version: "4.13.0", licence: "MPL-2.0" }])).toEqual([]);
    expect(licenceProblems([{ name: "axe-core", version: "5.0.0", licence: "AGPL-3.0" }])).toEqual([
      "axe-core@5.0.0: licence AGPL-3.0 is not allowed",
    ]);
    expect(licenceProblems([{ name: "some-editor", version: "1.0.0", licence: "MPL-2.0" }])).toHaveLength(1);
    expect(licenceProblems([{ name: "toString", version: "1.0.0", licence: "MPL-2.0" }])).toHaveLength(1);
  });
  it("lets argparse through under its PSF licence (owner decision 2026-10-24), and nothing else under it", () => {
    expect(licenceProblems([{ name: "argparse", version: "2.0.1", licence: "Python-2.0" }])).toEqual([]);
    for (const [name, licence] of [
      ["argparse", "CNRI-Python"], // the older Python licences of the same family are not reviewed
      ["argparse", "CNRI-Python-GPL-Compatible"],
      ["argparse", "PSF-2.0 AND GPL-3.0"],
      ["argparse", "GPL-3.0"],
      ["another-parser", "Python-2.0"], // narrowly argparse: no other package under it
      ["another-parser", "CNRI-Python"],
    ] as const)
      expect(licenceProblems([{ name, version: "2.0.1", licence }]), `${name} ${licence}`).toEqual([
        `${name}@2.0.1: licence ${licence} is not allowed`,
      ]);
    // the version reviewed only: another argparse under the same licence is reviewed again first
    expect(licenceProblems([{ name: "argparse", version: "2.0.2", licence: "Python-2.0" }])).toEqual([
      "argparse@2.0.2: licence Python-2.0 is not allowed",
    ]);
    expect(licenceOk("Python-2.0")).toBe(false); // not on the allowlist itself
  });
  it("fails when nothing is installed, or a locked package was not installed and checked", () => {
    expect(licenceProblems([], lock([]))).toEqual([
      "no installed packages were found: run pnpm install first",
      "pnpm-lock.yaml lists no packages or importers",
    ]);
    const a = { name: "a", version: "1.0.0", licence: "MIT" };
    expect(
      licenceProblems(
        [a],
        lock([
          { key: "a@1.0.0", platform: false },
          { key: "b@2.0.0", platform: false },
        ]),
      ),
    ).toEqual(["b@2.0.0: in pnpm-lock.yaml but not installed here, so its licence was not checked"]);
  });
  it("passes another platform's build only for a reviewed family whose installed builds have its licence", () => {
    const here = { name: "@rolldown/binding-darwin-arm64", version: "1.2.14", licence: "MIT" };
    const other = { key: "@rolldown/binding-win32-x64-msvc@1.2.14", platform: true };
    expect(licenceProblems([here], lock([{ key: `${here.name}@1.2.14`, platform: true }, other]))).toEqual([]);
    const both = lock([{ key: `${here.name}@1.2.14`, platform: true }, other]);
    expect(licenceProblems([{ ...here, licence: "GPL-3.0" }], both)).toEqual([
      "@rolldown/binding-darwin-arm64@1.2.14: licence GPL-3.0 is not the MIT its family was reviewed under",
    ]);
    const css = { name: "lightningcss-linux-arm64-gnu", version: "1.33.0", licence: "MPL-2.0" }; // any platform's build
    expect(licenceProblems([css], lock([{ key: "lightningcss-linux-arm64-gnu@1.33.0", platform: true }]))).toEqual([]);
    const cli = { name: "lightningcss-cli", version: "1.33.0", licence: "MPL-2.0" }; // named like one, not a build
    expect(licenceProblems([cli], lock([{ key: "lightningcss-cli@1.33.0", platform: false }]))).toEqual([
      "lightningcss-cli@1.33.0: licence MPL-2.0 is not allowed",
    ]);
    expect(licenceProblems([here], lock([{ key: "@evil/binding-win32@1.0.0", platform: true }]))).toHaveLength(1);
  });
  it("refuses links to folders outside the workspace", () => {
    const a = { name: "a", version: "1.0.0", licence: "MIT" };
    const locked = [{ key: "a@1.0.0", platform: false }];
    expect(licenceProblems([a], lock(locked, [{ from: "apps/web", to: "tools/testkit" }]))).toEqual([]);
    expect(licenceProblems([a], lock(locked, [{ from: ".", to: "../elsewhere" }]))).toEqual([
      ".: links ../elsewhere, which is not a package of this workspace",
    ]);
  });
  it("matches a family by the whole name, and only for builds the lockfile marks as platform builds", () => {
    const pkg = (name: string) => ({ key: `${name}@1.0.0`, platform: true });
    for (const name of ["fsevents-evil", "@rolldown/binding-linux-x64-gnu-evil", "lightningcss-linux-x64"])
      expect(
        licenceProblems(
          [{ name: "a", version: "1.0.0", licence: "MIT" }],
          lock([{ key: "a@1.0.0", platform: false }, pkg(name)]),
        ),
        name,
      ).toHaveLength(name === "lightningcss-linux-x64" ? 0 : 1);
    const css = { name: "lightningcss-linux-x64-gnu", version: "1.33.0", licence: "MPL-2.0" };
    expect(licenceProblems([css], lock([{ key: "lightningcss-linux-x64-gnu@1.33.0", platform: false }]))).toEqual([
      "lightningcss-linux-x64-gnu@1.33.0: licence MPL-2.0 is not allowed",
    ]);
  });
  it("treats only real platform builds as a family's, by their whole name", () => {
    const fake = { key: "lightningcss-evil@1.0.0", platform: true }; // named like the family, marked for a platform
    expect(
      licenceProblems(
        [{ name: "a", version: "1.0.0", licence: "MIT" }],
        lock([{ key: "a@1.0.0", platform: false }, fake]),
      ),
    ).toEqual(["lightningcss-evil@1.0.0: in pnpm-lock.yaml but not installed here, so its licence was not checked"]);
  });
  it("refuses a lockfile with two documents, or an importer outside the repository", () => {
    const a = { name: "a", version: "1.0.0", licence: "MIT" };
    const one = lock([{ key: "a@1.0.0", platform: false }]);
    expect(licenceProblems([a], { ...one, documents: 2 })).toEqual([
      "pnpm-lock.yaml holds more than one YAML document: this check reads one",
    ]);
    expect(licenceProblems([a], { ...one, importers: [".", "../outside"] })).toEqual([
      "pnpm-lock.yaml: the importer ../outside is outside this repository",
    ]);
    expect(lockfile("lockfileVersion: '9.0'\n---\nother: 1\n").documents).toBe(2);
    for (const i of ["/abs", "apps/../../outside", "./../outside"])
      expect(licenceProblems([a], { ...one, importers: [".", i] }), i).toEqual([
        `pnpm-lock.yaml: the importer ${i} is outside this repository`,
      ]);
    expect(
      licenceProblems([a], lock([{ key: "a@1.0.0", platform: false }], [{ from: "apps/web", to: "/abs" }])),
    ).toEqual(["apps/web: links /abs, which is not a package of this workspace"]);
  });
  it("refuses a lockfile it cannot read, and dependencies from folders", () => {
    const a = { name: "a", version: "1.0.0", licence: "MIT" };
    expect(licenceProblems([a], { ...lock([{ key: "a@1.0.0", platform: false }]), version: "10.0" })).toEqual([
      "pnpm-lock.yaml is format 10.0: this check reads 9.0",
    ]);
    expect(
      licenceProblems(
        [a],
        lock([
          { key: "a@1.0.0", platform: false },
          { key: "b@file:../b", platform: false },
        ]),
      ),
    ).toEqual(["b@file:../b: a dependency from a folder, not from the registry: its licence is not checked"]);
  });
  it("reports package.json files it cannot read", () => {
    expect(licenceProblems([], undefined, ["x@1.0.0/x"])).toEqual(["x@1.0.0/x: its package.json cannot be read"]);
  });
});

describe("reading the workspace", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  it("reads each installed package once, scoped ones too, and lists a damaged package.json", () => {
    dir = mkdtempSync(join(tmpdir(), "licences-"));
    const put = (entry: string, name: string, body: string) => {
      const d = join(dir, "node_modules", ".pnpm", entry, "node_modules", name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "package.json"), body);
    };
    put("a@1.0.0", "a", JSON.stringify({ name: "a", version: "1.0.0", license: "MIT" }));
    put("a@1.0.0_peer@2.0.0", "a", JSON.stringify({ name: "a", version: "1.0.0", license: "MIT" }));
    put("@s+b@2.0.0", "@s/b", JSON.stringify({ name: "@s/b", version: "2.0.0", license: "ISC" }));
    put("c@3.0.0", "c", "{damaged");
    const { pkgs, unreadable } = installed(dir);
    expect(pkgs.map((p) => `${p.name}@${p.version}`).sort()).toEqual(["@s/b@2.0.0", "a@1.0.0"]);
    expect(unreadable).toEqual(["c@3.0.0/c"]);
    expect(installed(join(dir, "nowhere")).pkgs).toEqual([]);
  });
  it("reads only pnpm's own shapes, and fails on any other spelling of a folder link", () => {
    const head = ["lockfileVersion: '9.0'", "", "importers:", "", "  .:", "    dependencies:", "      outside-pkg:"];
    const tail = ["", "packages:", "", "  a@1.0.0:", "    resolution: {}", ""];
    const read = (lines: string[]) => lockfile([...head, ...lines, ...tail].join("\n"));
    // each of these makes pnpm 11 link the folder, but is not how pnpm writes it: never read, so it fails
    const spellings: string[][] = [
      ["        specifier: link:../outside", '        version: "\\x6Cink:../outside"'],
      ["        specifier: link:../outside", '        version: "link:../outside"'],
      ["        specifier: link:../outside", "        version: >-", "          link:../outside"],
      ["        specifier: link:../outside", "        version: |-", "          link:../outside"],
      ["        specifier: link:../outside", "        version:", "          link:../outside"],
      ["        specifier: &s link:../outside", "        version: *s"],
      ["        specifier: link:../outside", "        ? version", "        : link:../outside"],
      ["        specifier: link:../outside", "        version: !!str", "          link:../outside"],
      ["        {specifier: link:../outside, version: link:../outside}"],
      ["# a comment at column 0", "        specifier: link:../outside", "        version: link:../outside"],
    ];
    for (const lines of spellings) expect(read(lines).unread?.length ?? 0, lines.join(" | ")).toBeGreaterThan(0);
    // pnpm's own single quotes are read, and the link is then refused for pointing outside the workspace
    const quoted = read(["        specifier: link:../outside", "        version: 'link:../outside'"]);
    expect(quoted.links).toEqual([{ from: ".", to: "../outside" }]);
    expect(quoted.unread).toEqual([]);
    const a = { name: "a", version: "1.0.0", licence: "MIT" };
    expect(licenceProblems([a], quoted)).toEqual([".: links ../outside, which is not a package of this workspace"]);
    // a folder dependency anywhere but an importer's version (here an override) fails too
    const override = lockfile(
      ["lockfileVersion: '9.0'", "", "overrides:", "  child-pkg: link:../outside", ""].join("\n"),
    );
    expect(override.unread).toEqual(["overrides: child-pkg: link:../outside"]);
    // …in any of its spellings, while a package whose name ends in -file or -link is no folder at all
    const snapshots = lockfile(
      [
        "lockfileVersion: '9.0'",
        "",
        "snapshots:",
        "  yargs@15.4.1:",
        "    dependencies:",
        "      get-caller-file: 2.0.5",
        "      some-link: 1.0.0",
        "      quoted: 'file:../outside'",
        "      plain:",
        "        link:../outside",
        "      named: foo@file:../outside",
        "      named-link: foo@link:../outside",
        "      listed: [link:../outside]",
        "      several: [a,file:../outside]",
        "",
      ].join("\n"),
    );
    expect(snapshots.unread).toEqual([
      "snapshots: quoted: 'file:../outside'",
      "snapshots: link:../outside",
      "snapshots: named: foo@file:../outside",
      "snapshots: named-link: foo@link:../outside",
      "snapshots: listed: [link:../outside]",
      "snapshots: several: [a,file:../outside]",
    ]);
    // the names alone are not folders
    const names = lockfile(
      [
        "lockfileVersion: '9.0'",
        "",
        "snapshots:",
        "  a@1.0.0:",
        "    dependencies:",
        "      get-caller-file: 2.0.5",
        "      some-link: 1.0.0",
        "",
      ].join("\n"),
    );
    expect(names.unread).toEqual([]);
  });
  it("reads every importer shape pnpm writes", () => {
    const lock = lockfile(
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .: {}",
        "",
        "  '1.0':",
        "    dependencies:",
        "      '@x/y':",
        "        specifier: link:../my dir",
        "        version: link:../my dir",
        "",
        "  it's:",
        "    devDependencies: {}",
        "",
        "  my pkg: {}",
        "",
        "  tools/empty: {}",
        "",
        "  named:",
        "    dependencies:",
        "      foo:",
        "        specifier: file:../x",
        "        version: foo@file:../x",
        "      '@a/b':",
        "        specifier: link:../y",
        "        version: '@a/b@link:../y'",
        "",
        "  मराठी:",
        "    dependenciesMeta:",
        "      '@x/y':",
        "        injected: true",
        "",
      ].join("\n"),
    );
    expect(lock.unread).toEqual([]);
    expect(lock.importers).toEqual([".", "1.0", "it's", "my pkg", "tools/empty", "named", "मराठी"]);
    expect(lock.links).toEqual([
      { from: "1.0", to: "my dir" },
      { from: "named", to: "file:../x" },
      { from: "named", to: "y" },
    ]);
  });
  it("checks every installed link against pnpm's own record of the workspace", () => {
    dir = mkdtempSync(join(tmpdir(), "licences-"));
    const repo = realpathSync(mkdtempSync(join(dir, "repo-")));
    const nm = join(repo, "node_modules");
    const store = join(nm, ".pnpm");
    const pkg = (entry: string, name: string) =>
      mkdirSync(join(store, entry, "node_modules", name), { recursive: true });
    pkg("parent@1.0.0", "parent");
    pkg("child@1.0.0", "child");
    mkdirSync(join(repo, "tools", "testkit"), { recursive: true });
    mkdirSync(join(repo, "vendor", "gpl"), { recursive: true });
    mkdirSync(join(dir, "outside"));
    const state = (projects: string[]) =>
      writeFileSync(
        join(nm, ".pnpm-workspace-state-v1.json"),
        JSON.stringify({ projects: Object.fromEntries(projects.map((p) => [p, { name: p }])) }),
      );
    state([repo, join(repo, "tools", "testkit")]);
    mkdirSync(join(nm, "@pageinator"), { recursive: true });
    symlinkSync(join(repo, "tools", "testkit"), join(nm, "@pageinator", "testkit")); // a workspace project: fine
    symlinkSync(join(store, "parent@1.0.0", "node_modules", "parent"), join(nm, "parent")); // an installed package: fine
    symlinkSync(
      join(store, "child@1.0.0", "node_modules", "child"),
      join(store, "parent@1.0.0", "node_modules", "child"),
    );
    expect(installedLinks(repo, [".", "tools/testkit"])).toEqual([]);
    symlinkSync(join(dir, "outside"), join(nm, "outside-pkg")); // outside the repository
    symlinkSync(join(repo, "vendor", "gpl"), join(store, "parent@1.0.0", "node_modules", "gpl")); // a folder, not a package
    symlinkSync(join(repo, "gone"), join(nm, "dangling")); // a folder that is not there
    const why = "which is neither an installed package nor a workspace project";
    expect(installedLinks(repo, [".", "tools/testkit"])).toEqual([
      `node_modules/.pnpm/parent@1.0.0/node_modules/gpl: links vendor/gpl, ${why}`,
      "node_modules/dangling: a link to a folder that is not there",
      `node_modules/outside-pkg: links a folder outside this repository, ${why}`,
    ]);
  });
  it("refuses a workspace whose projects and lockfile disagree, or that installs apart", () => {
    dir = mkdtempSync(join(tmpdir(), "licences-"));
    const repo = realpathSync(mkdtempSync(join(dir, "repo-")));
    mkdirSync(join(repo, "apps", "web", "node_modules", ".pnpm"), { recursive: true }); // its own store …
    writeFileSync(join(repo, "apps", "web", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"); // … and lockfile
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    writeFileSync(
      join(repo, "node_modules", ".pnpm-workspace-state-v1.json"),
      JSON.stringify({ projects: { [repo]: {}, [join(repo, "apps", "web")]: {} } }),
    );
    expect(installedLinks(repo, [".", "vendor/gpl"])).toEqual([
      "apps/web/node_modules/.pnpm: packages installed apart from the workspace's",
      "apps/web/pnpm-lock.yaml: packages installed apart from the workspace's",
      "apps/web: a workspace project pnpm-lock.yaml does not list",
      "pnpm-lock.yaml lists vendor/gpl, which is not a workspace project",
    ]);
    expect(installedLinks(join(dir, "nowhere-" + "x").replace("nowhere-x", ""), [])).toHaveLength(1); // no record
  });
  it("refuses lockfile settings that let packages in unchecked", () => {
    const a = { name: "a", version: "1.0.0", licence: "MIT" };
    const base = [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      a:",
      "        specifier: 1.0.0",
      "        version: 1.0.0",
      "",
      "packages:",
      "",
      "  a@1.0.0:",
      "    resolution: {}",
      "",
    ];
    const with_ = (extra: string[]) => licenceProblems([a], lockfile([...extra, ...base].join("\n")));
    expect(with_(["settings:", "  excludeLinksFromLockfile: true", ""])).toEqual([
      "pnpm-lock.yaml leaves links out (excludeLinksFromLockfile): this check needs them in it",
    ]);
    expect(with_(["patchedDependencies:", "  a: patches/a.patch", ""])).toEqual([
      "pnpm-lock.yaml patches packages: a patch can change what this check reads; review it first",
    ]);
    expect(with_(["pnpmfileChecksum: sha256-x", ""])).toEqual([
      "a .pnpmfile changes packages at install time: review it first",
    ]);
    expect(with_(["settings:", "  excludeLinksFromLockfile: false", ""])).toEqual([]);
    // a key that ends in a space is not one pnpm writes ("  x :" would read as "x")
    expect(
      lockfile(["lockfileVersion: '9.0'", "", "importers:", "", "  x :", "    dependencies: {}", ""].join("\n")).unread,
    ).toEqual(["x :", "dependencies: {}"]);
  });
  it("reads pnpm-lock.yaml's packages, platform builds and workspace links", () => {
    const text = [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    devDependencies:",
      "      a:",
      "        specifier: 1.0.0",
      "        version: 1.0.0",
      "",
      "  apps/web:",
      "    dependencies:",
      "      '@pageinator/testkit':",
      "        specifier: workspace:*",
      "        version: link:../../tools/testkit",
      "",
      "packages:",
      "",
      "  a@1.0.0:",
      "    resolution: {integrity: sha512-x}",
      "",
      "  '@rolldown/binding-linux-x64-gnu@1.2.14':",
      "    resolution: {integrity: sha512-y}",
      "    cpu: [x64]",
      "    os: [linux]",
      "",
      "snapshots:",
      "",
      "  a@1.0.0: {}",
      "",
    ].join("\n");
    const read = lockfile(text);
    expect(lockfile(text.replace(/\n/g, "\r\n"))).toEqual(read); // Windows line endings read the same
    expect(read).toEqual({
      version: "9.0",
      documents: 1,
      packages: [
        { key: "a@1.0.0", platform: false },
        { key: "@rolldown/binding-linux-x64-gnu@1.2.14", platform: true },
      ],
      importers: [".", "apps/web"],
      links: [{ from: "apps/web", to: "tools/testkit" }],
      unread: [],
      settings: {},
      sections: ["lockfileVersion", "importers", "packages", "snapshots"],
    });
  });
});
