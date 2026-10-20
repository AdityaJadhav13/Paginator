// The determinism rules of eslint.config.js, checked on planted snippets: each banned construct is reported in a
// kernel package, the allowed spellings are not, and browser packages, tests and tools are free of the kernel rules.
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { REPO } from "../lib.ts";

const eslint = new ESLint({ cwd: REPO });
const RESTRICTED = new Set([
  "no-restricted-globals",
  "no-restricted-properties",
  "no-restricted-syntax",
  "no-restricted-imports",
]);

async function restricted(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(REPO, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId && RESTRICTED.has(m.ruleId)).map((m) => m.ruleId ?? "");
}

const KERNEL = "packages/pyshim/src/__lint_fixture__.ts";

const BANNED: [string, string][] = [
  ["Math.pow(2, 3);", "no-restricted-properties"],
  ["Math.random();", "no-restricted-properties"],
  ["JSON.stringify({});", "no-restricted-properties"],
  ["Date.now();", "no-restricted-properties"],
  ["globalThis.x = 1;", "no-restricted-globals"],
  ["performance.now();", "no-restricted-globals"],
  ["2 ** 3;", "no-restricted-syntax"],
  ["let x = 2;\nx **= 2;", "no-restricted-syntax"],
  ["for (const k in {}) void k;", "no-restricted-syntax"],
  ["[3, 1].sort();", "no-restricted-syntax"],
  ["[3, 1].toSorted();", "no-restricted-syntax"],
  ["[3, 1].sort(undefined);", "no-restricted-syntax"],
  ["const f = [3, 1].sort;\nvoid f;", "no-restricted-syntax"],
  ['[3, 1]["sort"]();', "no-restricted-syntax"],
  ["[3, 1][`sort`]();", "no-restricted-syntax"],
  ['"a".localeCompare("b");', "no-restricted-syntax"],
  ['"a".normalize.call("b");', "no-restricted-syntax"],
  ['"A".toLowerCase();', "no-restricted-syntax"],
  ['" a ".trim();', "no-restricted-syntax"],
  ["(1.5).toFixed(2);", "no-restricted-syntax"],
  ['new RegExp("a");', "no-restricted-syntax"],
  ['RegExp("a");', "no-restricted-syntax"],
  ['/\\p{L}/u.test("a");', "no-restricted-syntax"],
  ['/\\s+/.test(" ");', "no-restricted-syntax"],
  ["new Date();", "no-restricted-syntax"],
  ["type T = { [k: number]: string };\nexport type { T };", "no-restricted-syntax"],
  ["type T = Record<number, string>;\nexport type { T };", "no-restricted-syntax"],
  ['import { readFileSync } from "node:fs";\nvoid readFileSync;', "no-restricted-imports"],
  ['import web from "@pageinator/web";\nvoid web;', "no-restricted-imports"],
];

const ALLOWED = [
  "type T = { [k: string]: number };\nexport type { T };",
  "[3, 1].sort((a, b) => a - b);",
  "[3, 1].toSorted((a, b) => a - b);",
  "const r = /a+[ \\t]/;\nvoid r;",
  "export const v = Math.floor(1.5) + Math.sqrt(4) + Math.abs(-1) + Math.max(1, 2);",
  "const m = new Map<number, string>();\nvoid m;",
  'const s = "a b".split(" ");\nvoid s;',
];

describe("kernel determinism rules", () => {
  it.each(BANNED)("reports %j", async (code, rule) => {
    expect(await restricted(code, KERNEL)).toContain(rule);
  });

  it.each(ALLOWED)("allows %j", async (code) => {
    expect(await restricted(code, KERNEL)).toEqual([]);
  });

  it("does not apply to browser packages, tests or tools", async () => {
    const code = 'Math.pow(2, 3);\n[1].sort();\n"A".toLowerCase();';
    for (const file of ["packages/ui/src/x.ts", "packages/pyshim/test/x.test.ts", "tools/ts/x.ts"]) {
      expect(await restricted(code, file), file).toEqual([]);
    }
  });
});
