// Test-only helpers: locate repository files and read golden-vector files (JSONL, optionally gzipped).
// Kernel packages never import node modules themselves; their tests read goldens through this kit.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

/** Absolute path of the repository root. */
export const REPO_ROOT: string = fileURLToPath(new URL("../../../", import.meta.url));

/** Absolute path of a file under the repository root. */
export function repoPath(...segments: string[]): string {
  return resolve(REPO_ROOT, ...segments);
}

/** Read a UTF-8 text file; `.gz` files are decompressed. */
export function readText(path: string): string {
  const bytes = readFileSync(path);
  return (path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
}

const PY_INF = "\u0000py:Infinity";
const PY_NINF = "\u0000py:-Infinity";
const PY_NAN = "\u0000py:NaN";

/**
 * Parse JSON as Python's json module writes it: like JSON, plus the bare tokens Infinity, -Infinity and NaN
 * (allow_nan=True, the default). Tokens inside strings are left alone.
 */
export function parsePythonJson(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (text.startsWith("-Infinity", i)) {
      out += JSON.stringify(PY_NINF);
      i += 9;
    } else if (text.startsWith("Infinity", i)) {
      out += JSON.stringify(PY_INF);
      i += 8;
    } else if (text.startsWith("NaN", i)) {
      out += JSON.stringify(PY_NAN);
      i += 3;
    } else {
      out += ch;
      i += 1;
    }
  }
  return JSON.parse(out, (_key, value: unknown) =>
    value === PY_INF ? Infinity : value === PY_NINF ? -Infinity : value === PY_NAN ? Number.NaN : value,
  );
}

/** Parse a JSONL file written by Python (one value per non-empty line). */
export function readJsonl(path: string): unknown[] {
  return readText(path)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => parsePythonJson(line));
}

/** Every string value stored under a key accepted by `keyFilter`, at any depth (arrays inherit their key). */
export function collectStrings(value: unknown, keyFilter: (key: string) => boolean, key = ""): string[] {
  if (typeof value === "string") return keyFilter(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, keyFilter, key));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => collectStrings(v, keyFilter, k));
  }
  return [];
}

/**
 * Directory of the private (pilot) goldens. Private tests must FAIL, never skip, when it is missing, so a green
 * private run always means the private evidence was checked.
 */
export function privateGoldensDir(): string {
  const dir = process.env["PAGEINATOR_PRIVATE_GOLDENS"];
  if (!dir) throw new Error("PAGEINATOR_PRIVATE_GOLDENS is not set: private goldens were not checked.");
  if (!existsSync(dir)) throw new Error(`Private goldens directory not found: ${dir}`);
  return dir;
}
