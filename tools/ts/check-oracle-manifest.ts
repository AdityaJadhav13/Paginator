// Verifies the frozen Python oracle (tools/oracle/v0):
//   - every file ORACLE_MANIFEST.json lists still has the SHA-256 recorded there;
//   - the tracked files under tools/oracle/v0 are exactly those in tools/ts/oracle-files.json, with the same SHA-256.
//     This also covers the files the oracle's own manifest does not list (README.md, KNOWN_LIMITATIONS.md, freeze.py,
//     the manifest itself …), independently of git history.
// `node tools/ts/check-oracle-manifest.ts --record` writes oracle-files.json. It was recorded once, from the frozen
// oracle; re-recording it is a change to the frozen oracle and needs the same review.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, fail, gitZ, sha256 } from "./lib.ts";

const DIR = "tools/oracle/v0";
const RECORD = join(REPO, "tools/ts/oracle-files.json");

type Recorded = { _comment: string; files: Record<string, string> };

function trackedFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of gitZ(REPO, "ls-files", "-z", "--", DIR)) {
    out[path] = existsSync(join(REPO, path)) ? sha256(join(REPO, path)) : "(missing in the working tree)";
  }
  return out;
}

if (process.argv.includes("--record")) {
  const record: Recorded = {
    _comment:
      "Every tracked file of the frozen oracle with its SHA-256 (tools/ts/check-oracle-manifest.ts). Recorded once; a change here is a change to the frozen oracle.",
    files: trackedFiles(),
  };
  writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`recorded ${Object.keys(record.files).length} files in tools/ts/oracle-files.json`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(join(REPO, DIR, "ORACLE_MANIFEST.json"), "utf8")) as {
  files: { path: string; sha256: string }[];
};
const problems = manifest.files
  .filter((f) => !existsSync(join(REPO, DIR, f.path)) || sha256(join(REPO, DIR, f.path)) !== f.sha256)
  .map((f) => `${f.path}: missing or SHA-256 differs from ORACLE_MANIFEST.json`);
const recorded = (JSON.parse(readFileSync(RECORD, "utf8")) as Recorded).files;
const now = trackedFiles();
for (const path of Object.keys(recorded)) {
  if (!(path in now)) problems.push(`${path}: recorded in tools/ts/oracle-files.json but no longer tracked`);
  else if (now[path] !== recorded[path]) problems.push(`${path}: SHA-256 differs from tools/ts/oracle-files.json`);
}
for (const path of Object.keys(now)) if (!(path in recorded)) problems.push(`${path}: new file in the frozen oracle`);
fail(problems, "oracle check failed");
console.log(
  `✓ oracle: ${manifest.files.length} manifest files and all ${Object.keys(now).length} tracked files unchanged`,
);
