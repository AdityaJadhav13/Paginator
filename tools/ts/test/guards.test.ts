// The repository guards on throwaway git repositories: every case a reviewer or verifier found, planted.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { versionBlockProblems } from "../check-graph.ts";
import { changedPaths, frozenProblems } from "../check-frozen.ts";
import { type Allowlist, denylistTerms, runGuard } from "../guard-private.ts";
import { sha256Bytes } from "../lib.ts";

const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
  const config = ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"];
  return execFileSync("git", [...config, "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pageinator-guard-"));
  repos.push(dir);
  git(dir, "init", "-q", "-b", "main");
  write(dir, "README.md", "a public file\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");
  return dir;
}

function write(dir: string, path: string, data: string | Buffer): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), data);
}

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const EMPTY: Allowlist = { fonts: {}, images: {}, pdfs: {}, large: {} };
const TERMS = ["secretpaper", "कल्पितनाव", "ज़रा"]; // the last is NFC "ज़रा" (U+095B decomposes)

function guard(dir: string, allow: Allowlist = EMPTY, base: string | null = null): string[] {
  return runGuard({ repo: dir, allow, terms: TERMS, base, head: "HEAD" }).problems;
}

describe("privacy guard", () => {
  it("passes a clean repository", () => {
    expect(guard(repo())).toEqual([]);
  });

  it("finds a term in any case, with its line", () => {
    const dir = repo();
    write(dir, "notes.txt", "one\ntwo SecretPaper three\n");
    expect(guard(dir)).toEqual(["notes.txt: line 2: private term"]);
  });

  it("compares NFC forms, so a precomposed nukta letter matches the decomposed term", () => {
    const dir = repo();
    write(dir, "deva.txt", "ज़रा\n");
    expect(guard(dir)).toEqual(["deva.txt: line 1: private term"]);
  });

  it("reads UTF-16 with and without a byte-order mark", () => {
    const dir = repo();
    write(dir, "le.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("x secretpaper", "utf16le")]));
    write(dir, "be.txt", Buffer.from("कल्पितनाव", "utf16le").swap16());
    expect(guard(dir)).toEqual(["be.txt: private term (UTF-16 text)", "le.txt: private term (UTF-16 text)"]);
  });

  it("reads gzip-compressed content", () => {
    const dir = repo();
    write(dir, "data.jsonl.gz", gzipSync(Buffer.from('{"t":"secretpaper"}\n')));
    expect(guard(dir)).toEqual(["data.jsonl.gz: in the gzip content, line 1: private term"]);
  });

  it("checks paths for terms", () => {
    const dir = repo();
    write(dir, "notes/secretpaper.md", "x\n");
    expect(guard(dir)).toEqual(["notes/secretpaper.md: private term in the path"]);
  });

  it("checks a symlink's text, as git stores it", () => {
    const dir = repo();
    symlinkSync("/nowhere/secretpaper", join(dir, "link"));
    expect(guard(dir)).toEqual(["link: line 1: private term"]);
  });

  it("allows binaries only with their exact SHA-256", () => {
    const dir = repo();
    const font = Buffer.from("not really a font");
    write(dir, "a.ttf", font);
    write(dir, "b.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write(dir, "c.pdf", Buffer.from("%PDF-1.4"));
    expect(guard(dir)).toEqual([
      "a.ttf: font not in tools/ts/guard-allowlist.json",
      "b.png: image not in tools/ts/guard-allowlist.json",
      "c.pdf: PDF not in tools/ts/guard-allowlist.json",
    ]);
    const allow: Allowlist = { ...EMPTY, fonts: { "a.ttf": [sha256Bytes(Buffer.from("old")), sha256Bytes(font)] } };
    expect(guard(dir, allow)).not.toContain("a.ttf: font not in tools/ts/guard-allowlist.json");
  });

  it("never allows colour profiles, design files, archives or office documents", () => {
    const dir = repo();
    for (const f of ["p.icc", "d.psd", "z.zip", "w.docx"]) write(dir, f, "x");
    expect(guard(dir)).toEqual([
      "d.psd: design files stay private",
      "p.icc: colour profiles stay private (licence)",
      "w.docx: office documents stay private",
      "z.zip: archives cannot be checked: commit their contents instead",
    ]);
  });

  it("blocks brand artwork in any logos/ directory; an ignored Logos/ only after a force-add", () => {
    const dir = repo();
    write(dir, ".gitignore", "/Logos/\n"); // anchored: git ignores case on macOS, so "Logos/" would cover logos/ too
    write(dir, "Logos/mark.txt", "artwork\n");
    write(dir, "brand/logos/mark.txt", "artwork\n");
    expect(guard(dir)).toEqual(["brand/logos/mark.txt: brand artwork must stay private"]);
    git(dir, "add", "-f", "Logos/mark.txt");
    expect(guard(dir)).toContain("Logos/mark.txt: brand artwork must stay private");
  });

  it("flags files over 5 MB unless allowlisted", () => {
    const dir = repo();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
    write(dir, "big.txt", big);
    expect(guard(dir)).toEqual([`big.txt: ${big.length} bytes (over 5 MB)`]);
    expect(guard(dir, { ...EMPTY, large: { "big.txt": sha256Bytes(big) } })).toEqual([]);
  });

  it("finds a private file committed and then deleted again, in the commits since the base", () => {
    const dir = repo();
    const base = git(dir, "rev-parse", "HEAD").trim();
    write(dir, "leak.txt", "secretpaper\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "oops");
    const leak = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "rm", "-q", "leak.txt");
    git(dir, "commit", "-q", "-m", "remove it");
    expect(guard(dir)).toEqual([]);
    expect(guard(dir, EMPTY, base)).toEqual([`leak.txt (commit ${leak.slice(0, 12)}): line 1: private term`]);
  });

  it("checks what the index holds: staged and then deleted, or staged and then edited", () => {
    const dir = repo();
    write(dir, "gone.txt", "secretpaper\n");
    write(dir, "edited.txt", "secretpaper\n");
    git(dir, "add", "gone.txt", "edited.txt");
    rmSync(join(dir, "gone.txt"));
    write(dir, "edited.txt", "clean now\n");
    expect(guard(dir)).toEqual([
      "edited.txt (staged): line 1: private term",
      "gone.txt (staged): line 1: private term",
    ]);
  });

  it("treats an empty denylist value as unset", () => {
    const none = join(tmpdir(), "pageinator-no-such-denylist.txt");
    expect(denylistTerms({ PAGEINATOR_DENYLIST: "", PAGEINATOR_DENYLIST_FILE: none })).toEqual([]);
    expect(denylistTerms({ PAGEINATOR_DENYLIST: " One \n# comment\n\ntwo\none" })).toEqual(["one", "two"]);
  });
});

describe("frozen-evidence guard", () => {
  function frozenRepo(): string {
    const dir = repo();
    write(dir, "tools/oracle/v0/README.md", "frozen\n");
    write(dir, "experiments/phase0/a.txt", "evidence\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "evidence");
    git(dir, "branch", "base");
    return dir;
  }

  it("sees a file moved out of the oracle (renames count at the source)", () => {
    const dir = frozenRepo();
    mkdirSync(join(dir, "docs"));
    git(dir, "mv", "tools/oracle/v0/README.md", "docs/README.md");
    git(dir, "commit", "-q", "-m", "move");
    expect(frozenProblems(changedPaths(dir, "base"), true, "oracle")).toEqual([
      "tools/oracle/v0/README.md: the oracle is frozen",
    ]);
  });

  it("reads non-ASCII paths unquoted, and untracked files too", () => {
    const dir = frozenRepo();
    write(dir, "experiments/phase0/मराठी.txt", "x\n");
    expect(changedPaths(dir, "base")).toEqual(["experiments/phase0/मराठी.txt"]);
    expect(frozenProblems(["experiments/phase0/मराठी.txt"], false, "all")).toEqual([
      "experiments/phase0/मराठी.txt: evidence changes need the evidence-change approval",
    ]);
    expect(frozenProblems(["experiments/phase0/मराठी.txt"], true, "all")).toEqual([]);
    expect(frozenProblems(["experiments/phase0/मराठी.txt"], false, "oracle")).toEqual([]);
  });
});

describe("catalog check", () => {
  it("reads quoted and unquoted entries, skips comments, flags ranges and unreadable lines", () => {
    const yaml = [
      "packages:",
      "  - apps/*",
      "catalog:",
      "  # note: comments may contain colons",
      "  a: 1.2.3",
      "  'b': '2.0.0'",
      '  "c": "npm:x@1.0.0" # trailing: comment',
      "  d: ^1.0.0",
      "  just words",
      "overrides:",
      "  e: latest",
      "engineStrict: true",
    ].join("\n");
    expect(versionBlockProblems(yaml)).toEqual([
      'pnpm-workspace.yaml:8: d: "^1.0.0" is not an exact version',
      'pnpm-workspace.yaml:9: cannot read this line as "name: version": just words',
      'pnpm-workspace.yaml:11: e: "latest" is not an exact version',
    ]);
  });
});
