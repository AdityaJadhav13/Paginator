// Privacy guard: the repository is public, so pilot content, fonts, colour profiles and artwork must never be
// committed. Runs locally before every push and in CI.
//
// Fails on:
//   - font files whose SHA-256 is not in tools/ts/guard-allowlist.json (the OFL fonts used by the frozen oracle);
//   - ICC/ICM colour profiles;
//   - PDFs not in the allowlist;
//   - anything under Logos/ (brand artwork);
//   - files over 5 MB not in the allowlist;
//   - lines containing a private term. Terms come from PAGEINATOR_DENYLIST (newline-separated, a CI secret) or the
//     file named by PAGEINATOR_DENYLIST_FILE (default ~/PageinatorPrivate/denylist.txt). Without a denylist the term
//     scan is skipped with a warning, unless GUARD_REQUIRE_DENYLIST=1.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO, committableFiles, fail, sha256 } from "./lib.ts";

type Allowlist = { fonts: Record<string, string>; pdfs: Record<string, string>; large: Record<string, string> };
const allow = JSON.parse(readFileSync(join(REPO, "tools/ts/guard-allowlist.json"), "utf8")) as Allowlist;

const FONT = /\.(ttf|otf|ttc|woff2?|pfb|pfa|dfont)$/i;
const ICC = /\.(icc|icm)$/i;
const PDF = /\.pdf$/i;
const MAX_BYTES = 5 * 1024 * 1024;

function denylist(): string[] {
  const fromEnv = process.env["PAGEINATOR_DENYLIST"];
  const file = process.env["PAGEINATOR_DENYLIST_FILE"] ?? join(homedir(), "PageinatorPrivate", "denylist.txt");
  const text = fromEnv ?? (existsSync(file) ? readFileSync(file, "utf8") : "");
  return text
    .split("\n")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== "" && !t.startsWith("#"));
}

const problems: string[] = [];
const terms = denylist();
if (terms.length === 0) {
  if (process.env["GUARD_REQUIRE_DENYLIST"] === "1") problems.push("no denylist available (set PAGEINATOR_DENYLIST)");
  else console.warn("! privacy guard: no denylist available; private-term scan skipped");
}

for (const file of committableFiles()) {
  const abs = join(REPO, file);
  if (!existsSync(abs)) continue; // deleted in the working tree
  if (file.startsWith("Logos/")) problems.push(`${file}: brand artwork must stay private`);
  if (ICC.test(file)) problems.push(`${file}: colour profiles stay private (licence)`);
  if (FONT.test(file) && allow.fonts[file] !== sha256(abs)) problems.push(`${file}: font not in the allowlist`);
  if (PDF.test(file) && allow.pdfs[file] !== sha256(abs)) problems.push(`${file}: PDF not in the allowlist`);
  const size = statSync(abs).size;
  if (size > MAX_BYTES && allow.large[file] !== sha256(abs)) problems.push(`${file}: ${size} bytes (over 5 MB)`);
  if (terms.length > 0 && size <= MAX_BYTES) {
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) continue; // binary
    const lines = bytes.toString("utf8").toLowerCase().split("\n");
    lines.forEach((line, i) => {
      for (const term of terms) if (line.includes(term)) problems.push(`${file}:${i + 1}: private term`);
    });
  }
}

fail(problems, "privacy guard failed");
console.log(
  `✓ privacy guard: ${committableFiles().length} files checked${terms.length ? `, ${terms.length} terms` : ""}`,
);
