import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectStrings, parsePythonJson, readJsonl, repoPath } from "../src/index.ts";

describe("testkit", () => {
  it("finds the repository root", () => {
    expect(existsSync(repoPath("pnpm-workspace.yaml"))).toBe(true);
  });

  it("reads the oracle fixtures as JSONL", () => {
    const records = readJsonl(repoPath("fixtures/typeset/v1/behavior/body.jsonl"));
    expect(records.length).toBe(150);
  });

  it("parses Python's non-standard JSON numbers, but not inside strings", () => {
    expect(parsePythonJson('[Infinity, -Infinity, 1.5, "Infinity", "a\\"NaN"]')).toEqual([
      Infinity,
      -Infinity,
      1.5,
      "Infinity",
      'a"NaN',
    ]);
    expect(Number.isNaN((parsePythonJson("[NaN]") as number[])[0])).toBe(true);
  });

  it("collects strings under matching keys at any depth", () => {
    const found = collectStrings({ a_hex: ["x", "y"], b: { c_hex: "z", d: "no" } }, (k) => k.endsWith("_hex"));
    expect(found).toEqual(["x", "y", "z"]);
  });
});
