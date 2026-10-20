// Shared helpers for the repository guard scripts (run directly by Node 24 with type stripping).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

export function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** Files that would be committed: tracked files plus untracked files that are not ignored. */
export function committableFiles(): string[] {
  const tracked = git("ls-files", "-z").split("\0");
  const untracked = git("ls-files", "-z", "--others", "--exclude-standard").split("\0");
  return [...new Set([...tracked, ...untracked].filter((f) => f !== ""))].sort();
}

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function fail(problems: string[], title: string): never | void {
  if (problems.length === 0) return;
  console.error(`✗ ${title}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
