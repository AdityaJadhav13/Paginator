// Points git at the tracked hooks in .githooks, so the privacy guard runs before every push. Run by `pnpm install`
// (the root "prepare" script). Does nothing in CI or outside a git work tree, and leaves a developer's own
// core.hooksPath alone (with a warning).
import { REPO, git, gitRaw } from "./lib.ts";

function hooksPath(): string {
  try {
    return git("config", "--get", "core.hooksPath").trim();
  } catch {
    return ""; // unset
  }
}

function insideWorkTree(): boolean {
  try {
    return gitRaw(REPO, ["rev-parse", "--is-inside-work-tree"]).toString("utf8").trim() === "true";
  } catch {
    return false;
  }
}

if (!process.env["CI"] && insideWorkTree()) {
  const current = hooksPath();
  if (current === "") {
    git("config", "core.hooksPath", ".githooks");
    console.log("✓ git hooks: .githooks (the privacy guard runs before every push)");
  } else if (current !== ".githooks") {
    console.warn(`! core.hooksPath is "${current}": .githooks/pre-push (privacy guard) is not active`);
  }
}
