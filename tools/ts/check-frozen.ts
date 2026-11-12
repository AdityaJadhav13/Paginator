// Frozen-evidence guard. The Python reference oracle (tools/oracle/v0) never changes. The Phase-0 experiments and
// fixtures are the evidence the TypeScript engine is checked against; they change only with an explicit approval
// (CI: the "evidence-change" pull-request label sets EVIDENCE_CHANGE_APPROVED=1).
//
// Compares GUARD_BASE (else origin/<GITHUB_BASE_REF>, else origin/main) with HEAD, plus uncommitted and untracked
// files. Rename detection is off, so moving a file out of a frozen directory counts as a change there, and paths are
// read NUL-separated, so no quoting hides a non-ASCII name. FROZEN_SCOPE=oracle checks tools/oracle/v0 only: CI uses
// it on pushes to main, where the evidence approval was given on the pull request.
import { REPO, fail, gitZ, isCommit } from "./lib.ts";

export const ORACLE_DIR = "tools/oracle/v0/";
export const EVIDENCE_DIRS = ["experiments/phase0/", "fixtures/typeset/v1/"];
export type Scope = "all" | "oracle";

/** Paths changed between base and HEAD, in the index or working tree, or untracked (and not ignored). */
export function changedPaths(repo: string, base: string): string[] {
  const diff = (...args: string[]) => gitZ(repo, "diff", "--name-only", "-z", "--no-renames", ...args);
  return [
    ...new Set([
      ...diff(`${base}...HEAD`),
      ...diff("HEAD"),
      ...gitZ(repo, "ls-files", "-z", "--others", "--exclude-standard"),
    ]),
  ].sort();
}

export function frozenProblems(paths: string[], approved: boolean, scope: Scope): string[] {
  const problems: string[] = [];
  for (const path of paths) {
    if (path.startsWith(ORACLE_DIR)) problems.push(`${path}: the oracle is frozen`);
    else if (scope === "all" && !approved && EVIDENCE_DIRS.some((d) => path.startsWith(d))) {
      problems.push(`${path}: evidence changes need the evidence-change approval`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const ref = process.env["GITHUB_BASE_REF"];
  const base = process.env["GUARD_BASE"]?.trim() || (ref ? `origin/${ref}` : "origin/main");
  const scope = (process.env["FROZEN_SCOPE"]?.trim() || "all") as Scope;
  if (scope !== "all" && scope !== "oracle")
    fail([`FROZEN_SCOPE must be "all" or "oracle", not "${scope}"`], "frozen-evidence guard failed");
  if (!isCommit(REPO, base))
    fail([`base ${base} is not a commit here (fetch it first)`], "frozen-evidence guard failed");
  const changed = changedPaths(REPO, base);
  fail(
    frozenProblems(changed, process.env["EVIDENCE_CHANGE_APPROVED"] === "1", scope),
    `frozen-evidence guard failed (base ${base})`,
  );
  console.log(
    `✓ frozen-evidence guard: ${changed.length} changed files since ${base}${scope === "oracle" ? " (oracle only)" : ""}`,
  );
}
