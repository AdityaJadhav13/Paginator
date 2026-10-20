// Frozen-evidence guard. The Python reference oracle (tools/oracle/v0) never changes. The Phase-0 experiments and
// fixtures are the evidence the TypeScript engine is checked against; they change only with an explicit approval
// (CI: the "evidence-change" pull-request label sets EVIDENCE_CHANGE_APPROVED=1).
//
// Compares this branch (plus uncommitted changes) with GUARD_BASE, else origin/<GITHUB_BASE_REF>, else origin/main.
import { REPO, fail, git } from "./lib.ts";

const base =
  process.env["GUARD_BASE"] ??
  (process.env["GITHUB_BASE_REF"] ? `origin/${process.env["GITHUB_BASE_REF"]}` : "origin/main");
const changed = new Set(
  [
    ...git("diff", "--name-only", `${base}...HEAD`).split("\n"),
    ...git("diff", "--name-only", "HEAD").split("\n"),
  ].filter((f) => f !== ""),
);

const problems: string[] = [];
const approved = process.env["EVIDENCE_CHANGE_APPROVED"] === "1";
for (const file of changed) {
  if (file.startsWith("tools/oracle/v0/")) problems.push(`${file}: the oracle is frozen`);
  else if ((file.startsWith("experiments/phase0/") || file.startsWith("fixtures/typeset/v1/")) && !approved) {
    problems.push(`${file}: evidence changes need the evidence-change approval`);
  }
}
fail(problems, `frozen-evidence guard failed (base ${base}, repo ${REPO})`);
console.log(`✓ frozen-evidence guard: ${changed.size} changed files since ${base}`);
