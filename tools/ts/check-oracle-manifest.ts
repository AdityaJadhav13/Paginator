// Verifies that every file of the frozen Python oracle still has the SHA-256 recorded in ORACLE_MANIFEST.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, fail, sha256 } from "./lib.ts";

const dir = join(REPO, "tools/oracle/v0");
const manifest = JSON.parse(readFileSync(join(dir, "ORACLE_MANIFEST.json"), "utf8")) as {
  files: { path: string; sha256: string }[];
};
const problems = manifest.files
  .filter((f) => sha256(join(dir, f.path)) !== f.sha256)
  .map((f) => `${f.path}: SHA-256 differs from ORACLE_MANIFEST.json`);
fail(problems, "oracle manifest check failed");
console.log(`✓ oracle manifest: ${manifest.files.length} files unchanged`);
