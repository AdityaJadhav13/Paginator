// Privacy guard: the repository is public, so pilot content, fonts, colour profiles and artwork must never be
// committed. Runs in CI and before every push (.githooks/pre-push; `pnpm install` points git at .githooks).
//
// It checks everything that is, or could become, part of a commit:
//   - the working tree as git would commit it: tracked files, plus untracked files that are not ignored;
//   - staged content that differs from the working tree (`git commit` takes the index, not the file);
//   - every blob added or changed by the commits BASE..HEAD, so a private file committed in one commit and deleted in
//     the next is still caught. BASE is GUARD_BASE, else the branch's upstream, else origin/main (CI always sets it);
//     HEAD is GUARD_HEAD (the pre-push hook passes the commit being pushed), else HEAD.
// Ignored files (Logos/, node_modules/ …) cannot be committed without `git add -f`; a force-added file is tracked and
// therefore checked.
//
// It fails on:
//   - fonts (ttf otf ttc otc woff woff2 eot pfb pfa dfont), raster images (png jpg jpeg webp gif tif tiff bmp heic
//     avif) and PDFs whose SHA-256 is not allowlisted for that path in tools/ts/guard-allowlist.json;
//   - colour profiles (icc icm), design files (indd idml psd ai eps), archives (zip 7z rar tar) and office documents
//     (doc docx xls xlsx ppt pptx), always;
//   - a path with a "logos" segment, in any case (brand artwork);
//   - files over 5 MB that are not allowlisted;
//   - a private term in a path or in content. Content is read as UTF-8 (NFC-normalised, case-insensitive) and searched
//     for each term's UTF-16 encodings (both byte orders, NFC and NFD forms); gzip data is decompressed and read the
//     same way.
// Terms come from PAGEINATOR_DENYLIST (newline-separated: a CI secret), else from the file PAGEINATOR_DENYLIST_FILE
// (default ~/PageinatorPrivate/denylist.txt); an empty value counts as unset. Without terms the term scan is skipped
// with a warning, or fails when GUARD_REQUIRE_DENYLIST=1 (CI, except pull requests from forks, which get no secrets).
import { type Stats, existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { REPO, committableFiles, fail, gitRaw, gitZ, isCommit, readBlobs, sha256Bytes } from "./lib.ts";

type Approved = Record<string, string | string[]>; // path → SHA-256 (or several: earlier versions in the history)
export type Allowlist = { fonts: Approved; images: Approved; pdfs: Approved; large: Approved };

const ALLOWLISTED: [RegExp, "fonts" | "images" | "pdfs", string][] = [
  [/\.(ttf|otf|ttc|otc|woff2?|eot|pfb|pfa|dfont)$/i, "fonts", "font"],
  [/\.(png|jpe?g|webp|gif|tiff?|bmp|heic|avif)$/i, "images", "image"],
  [/\.pdf$/i, "pdfs", "PDF"],
];
const NEVER: [RegExp, string][] = [
  [/\.(icc|icm)$/i, "colour profiles stay private (licence)"],
  [/\.(indd|idml|psd|ai|eps)$/i, "design files stay private"],
  [/\.(zip|7z|rar|tar)$/i, "archives cannot be checked: commit their contents instead"],
  [/\.(docx?|xlsx?|pptx?)$/i, "office documents stay private"],
];
const LOGOS = /(^|\/)logos(\/|$)/i;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_INFLATED = 512 * 1024 * 1024;

export function denylistTerms(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = env["PAGEINATOR_DENYLIST"]?.trim() || undefined; // an unset CI secret arrives as ""
  const file = env["PAGEINATOR_DENYLIST_FILE"]?.trim() || join(homedir(), "PageinatorPrivate", "denylist.txt");
  const text = fromEnv ?? (existsSync(file) ? readFileSync(file, "utf8") : "");
  const terms = text
    .split("\n")
    .map((t) => t.trim().normalize("NFC").toLowerCase())
    .filter((t) => t !== "" && !t.startsWith("#"));
  return [...new Set(terms)];
}

function asciiLower(bytes: Buffer): Buffer {
  const out = Buffer.from(bytes);
  for (let i = 0; i < out.length; i += 1) {
    const c = out[i] ?? 0;
    if (c >= 0x41 && c <= 0x5a) out[i] = c + 0x20;
  }
  return out;
}

/** Each term's UTF-16 byte patterns (LE and BE, NFC and NFD), ASCII-lowered like the haystack. */
function utf16Needles(term: string): Buffer[] {
  const forms = new Set([term.normalize("NFC"), term.normalize("NFD")]);
  return [...forms].flatMap((f) => [Buffer.from(f, "utf16le"), Buffer.from(f, "utf16le").swap16()]).map(asciiLower);
}

type Context = {
  allow: Allowlist;
  terms: string[];
  needles: Buffer[][];
  problems: Set<string>;
  cache: Map<string, string[]>; // content SHA-256 → findings
};

function contentFindings(bytes: Buffer, ctx: Context, depth: number): string[] {
  if (ctx.terms.length === 0) return [];
  const found: string[] = [];
  const text = bytes.toString("utf8").normalize("NFC").toLowerCase();
  for (const term of ctx.terms) {
    const at = text.indexOf(term);
    if (at >= 0) found.push(`line ${text.slice(0, at).split("\n").length}: private term`);
  }
  const lowered = asciiLower(bytes);
  ctx.needles.forEach((needles) => {
    if (needles.some((n) => lowered.includes(n))) found.push("private term (UTF-16 text)");
  });
  if (depth < 2 && bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    let inflated: Buffer | undefined;
    try {
      inflated = gunzipSync(bytes, { maxOutputLength: MAX_INFLATED });
    } catch {
      found.push("gzip data that cannot be read, so it cannot be checked");
    }
    if (inflated) found.push(...contentFindings(inflated, ctx, depth + 1).map((f) => `in the gzip content, ${f}`));
  }
  return found;
}

function approved(list: Approved | undefined, path: string, digest: string): boolean {
  const entry = list?.[path];
  return entry === digest || (Array.isArray(entry) && entry.includes(digest));
}

function check(where: string, path: string, bytes: Buffer, ctx: Context): void {
  const add = (why: string) => ctx.problems.add(`${where}: ${why}`);
  if (LOGOS.test(path)) add("brand artwork must stay private");
  for (const [re, why] of NEVER) if (re.test(path)) add(why);
  const digest = sha256Bytes(bytes);
  for (const [re, kind, label] of ALLOWLISTED) {
    if (re.test(path) && !approved(ctx.allow[kind], path, digest)) add(`${label} not in tools/ts/guard-allowlist.json`);
  }
  if (bytes.length > MAX_BYTES && !approved(ctx.allow.large, path, digest)) add(`${bytes.length} bytes (over 5 MB)`);
  const lowPath = path.normalize("NFC").toLowerCase();
  if (ctx.terms.some((t) => lowPath.includes(t))) add("private term in the path");
  let found = ctx.cache.get(digest);
  if (!found) {
    found = contentFindings(bytes, ctx, 0);
    ctx.cache.set(digest, found);
  }
  for (const f of found) add(f);
}

type Entry = { path: string; id: string; mode: string };

/** Index entries whose content differs from the working tree (modified or deleted there). */
function stagedEntries(repo: string): Entry[] {
  const differs = new Set(gitZ(repo, "diff", "--name-only", "-z", "--no-renames"));
  if (differs.size === 0) return [];
  return gitZ(repo, "ls-files", "-s", "-z")
    .map((rec) => {
      const tab = rec.indexOf("\t");
      const [mode = "", id = ""] = rec.slice(0, tab).split(" ");
      return { path: rec.slice(tab + 1), id, mode };
    })
    .filter((e) => differs.has(e.path));
}

/** Blobs added or changed by each commit of base..head (merges against every parent). */
function historyEntries(repo: string, base: string, head: string): (Entry & { commit: string })[] {
  const commits = gitRaw(repo, ["rev-list", `${base}..${head}`])
    .toString("utf8")
    .split("\n")
    .filter((c) => c !== "");
  const out: (Entry & { commit: string })[] = [];
  for (const commit of commits) {
    const raw = gitZ(
      repo,
      "diff-tree",
      "-r",
      "-z",
      "-m",
      "--root",
      "--no-renames",
      "--no-commit-id",
      "--diff-filter=AMT",
      commit,
    );
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const [, mode = "", , id = ""] = (raw[i] ?? "").split(" "); // ":<old mode> <new mode> <old id> <new id> <status>"
      out.push({ path: raw[i + 1] ?? "", id, mode, commit });
    }
  }
  return out;
}

export type GuardOptions = { repo: string; allow: Allowlist; terms: string[]; base: string | null; head: string };
export type GuardResult = { problems: string[]; files: number; staged: number; history: number };

export function runGuard(o: GuardOptions): GuardResult {
  const ctx: Context = {
    allow: o.allow,
    terms: o.terms,
    needles: o.terms.map(utf16Needles),
    problems: new Set(),
    cache: new Map(),
  };
  const files = committableFiles(o.repo);
  for (const path of files) {
    const abs = join(o.repo, path);
    const st = lstatOrNull(abs);
    if (!st) continue; // deleted in the working tree: the staged-content check below reads the index
    if (st.isSymbolicLink())
      check(path, path, Buffer.from(readlinkSync(abs)), ctx); // git stores the link text
    else if (st.isDirectory()) ctx.problems.add(`${path}: a submodule or nested repository cannot be checked`);
    else check(path, path, readFileSync(abs), ctx);
  }
  const staged = stagedEntries(o.repo);
  checkEntries(o.repo, staged, (e) => `${e.path} (staged)`, ctx);
  const history = o.base ? historyEntries(o.repo, o.base, o.head) : [];
  checkEntries(o.repo, history, (e) => `${e.path} (commit ${e.commit.slice(0, 12)})`, ctx);
  return { problems: [...ctx.problems].sort(), files: files.length, staged: staged.length, history: history.length };
}

function lstatOrNull(abs: string): Stats | null {
  try {
    return lstatSync(abs);
  } catch {
    return null;
  }
}

function checkEntries<E extends Entry>(repo: string, entries: E[], where: (e: E) => string, ctx: Context): void {
  const gitlinks = entries.filter((e) => e.mode === "160000");
  for (const e of gitlinks) ctx.problems.add(`${where(e)}: a submodule cannot be checked`);
  const blobs = entries.filter((e) => e.mode !== "160000");
  const contents = readBlobs(
    repo,
    blobs.map((e) => e.id),
  );
  for (const e of blobs) check(where(e), e.path, contents.get(e.id) ?? Buffer.alloc(0), ctx);
}

function resolveBase(repo: string): { base: string | null; note?: string } {
  const given = process.env["GUARD_BASE"]?.trim();
  if (given) return { base: given };
  for (const candidate of ["@{upstream}", "origin/main"]) if (isCommit(repo, candidate)) return { base: candidate };
  return { base: null, note: "no upstream and no origin/main: the commits themselves were not scanned" };
}

if (import.meta.main) {
  const allow = JSON.parse(readFileSync(join(REPO, "tools/ts/guard-allowlist.json"), "utf8")) as Allowlist;
  const terms = denylistTerms();
  const problems: string[] = [];
  if (terms.length === 0) {
    if (process.env["GUARD_REQUIRE_DENYLIST"] === "1")
      problems.push("no denylist (PAGEINATOR_DENYLIST is empty or unset)");
    else console.warn("! privacy guard: no denylist available; private-term scan skipped");
  }
  const { base, note } = resolveBase(REPO);
  if (note) console.warn(`! privacy guard: ${note}`);
  const head = process.env["GUARD_HEAD"]?.trim() || "HEAD";
  if (base && !isCommit(REPO, base)) problems.push(`base ${base} is not a commit here (fetch it first)`);
  if (!isCommit(REPO, head)) problems.push(`head ${head} is not a commit here`);
  fail(problems, "privacy guard failed");
  const r = runGuard({ repo: REPO, allow, terms, base, head });
  fail(r.problems, "privacy guard failed");
  const range = base ? `, ${r.history} blobs in ${base}..${head}` : "";
  const index = r.staged ? `, ${r.staged} index versions that differ from the working tree` : "";
  console.log(`✓ privacy guard: ${r.files} files${index}${range}${terms.length ? `, ${terms.length} terms` : ""}`);
}
