// Shared helpers for the repository guard scripts (run directly by Node 24 with type stripping).
// Every git helper takes the repository directory, so the guards can be tested on throwaway repositories.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

/** Runs git in `repo` and returns its raw output (stderr is kept off the terminal; a failure throws). */
export function gitRaw(repo: string, args: string[], input?: string): Buffer {
  return execFileSync("git", args, {
    cwd: repo,
    input,
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function git(...args: string[]): string {
  return gitRaw(REPO, args).toString("utf8");
}

/** A NUL-separated git listing (`-z`): paths exactly as stored, never quoted, whatever characters they contain. */
export function gitZ(repo: string, ...args: string[]): string[] {
  return gitRaw(repo, args)
    .toString("utf8")
    .split("\0")
    .filter((s) => s !== "");
}

/** True when `rev` names a commit in `repo`. */
export function isCommit(repo: string, rev: string): boolean {
  try {
    gitRaw(repo, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Files that would be committed: tracked files plus untracked files that are not ignored. */
export function committableFiles(repo: string = REPO): string[] {
  const tracked = gitZ(repo, "ls-files", "-z");
  const untracked = gitZ(repo, "ls-files", "-z", "--others", "--exclude-standard");
  return [...new Set([...tracked, ...untracked])].sort();
}

/** Blob contents by object id, read with one `git cat-file --batch`. */
export function readBlobs(repo: string, ids: string[]): Map<string, Buffer> {
  const unique = [...new Set(ids)];
  const out = new Map<string, Buffer>();
  if (unique.length === 0) return out;
  const raw = gitRaw(repo, ["cat-file", "--batch"], `${unique.join("\n")}\n`);
  let at = 0;
  for (const id of unique) {
    const eol = raw.indexOf(10, at);
    const header = raw.subarray(at, eol).toString("utf8").split(" "); // "<id> <type> <size>" or "<id> missing"
    if (header.length !== 3) throw new Error(`git object ${id}: ${header.join(" ")}`);
    const size = Number(header[2]);
    out.set(id, raw.subarray(eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
  return out;
}

export function sha256Bytes(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256(path: string): string {
  return sha256Bytes(readFileSync(path));
}

export function fail(problems: string[], title: string): never | void {
  if (problems.length === 0) return;
  console.error(`✗ ${title}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
