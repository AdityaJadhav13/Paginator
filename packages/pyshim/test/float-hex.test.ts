import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectStrings, readJsonl, repoPath } from "@pageinator/testkit";
import { floatFromHex, floatToHex } from "../src/index.ts";

const FIXTURE_DIR = repoPath("fixtures/typeset/v1/behavior");

function fixtureHexValues(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => readJsonl(`${FIXTURE_DIR}/${name}`))
    .flatMap((record) => collectStrings(record, (key) => key.endsWith("_hex")));
}

describe("float.hex round trip", () => {
  it("reproduces every hex float in the oracle fixtures exactly", () => {
    const values = fixtureHexValues();
    expect(values.length).toBeGreaterThan(100_000);
    const mismatches = values.filter((text) => floatToHex(floatFromHex(text)) !== text);
    expect(mismatches).toEqual([]);
  });

  it("matches CPython on known values", () => {
    expect(floatToHex(1)).toBe("0x1.0000000000000p+0");
    expect(floatToHex(0.1)).toBe("0x1.999999999999ap-4");
    expect(floatToHex(-2.5)).toBe("-0x1.4000000000000p+1");
    expect(floatToHex(0)).toBe("0x0.0p+0");
    expect(floatToHex(-0)).toBe("-0x0.0p+0");
    expect(floatToHex(5e-324)).toBe("0x0.0000000000001p-1022");
    expect(floatToHex(Number.MAX_VALUE)).toBe("0x1.fffffffffffffp+1023");
    expect(floatToHex(Infinity)).toBe("inf");
    expect(floatToHex(Number.NaN)).toBe("nan");
  });

  it("parses short and canonical forms to the same number", () => {
    expect(floatFromHex("0x1.8p1")).toBe(3);
    expect(floatFromHex("0x1.999999999999ap-4")).toBe(0.1);
    expect(Object.is(floatFromHex("-0x0.0p+0"), -0)).toBe(true);
    expect(() => floatFromHex("0x1.0000000000000000p0")).not.toThrow();
    expect(() => floatFromHex("not a float")).toThrow();
  });

  it("accepts the spellings CPython's float.fromhex accepts", () => {
    const cases: [string, number][] = [
      ["0x.8p1", 1],
      ["0X1P-2", 0.25],
      ["1.", 1],
      ["1p3", 8],
      ["+0x1p0", 1],
      ["0x1.8", 1.5],
      ["0x10p-4", 1],
      ["0x1", 1],
      [" \t0x1p0\n", 1],
      ["0x0.0000000000001p-1022", 5e-324],
      ["0x1.fffffffffffffp+1023", Number.MAX_VALUE],
      [`0x1${"0".repeat(100_000)}p-400000`, 1],
    ];
    for (const [text, value] of cases) expect(floatFromHex(text)).toBe(value);
    for (const text of ["inf", "+inf", "INF", "Infinity", "+infinity"]) expect(floatFromHex(text)).toBe(Infinity);
    for (const text of ["-inf", "-Infinity"]) expect(floatFromHex(text)).toBe(-Infinity);
    for (const text of ["nan", "-nan", "+NaN"]) expect(Number.isNaN(floatFromHex(text))).toBe(true);
  });

  it("rejects what CPython rejects", () => {
    const bad = ["", " ", "0x", ".", "0x.p1", "0x1p", "0x1p+-1", "0x-1p0", "nan(1)", "1 p3", "0x1g", "0x1p1.5"];
    // CPython strips ASCII whitespace only; other spaces and non-ASCII digits are not part of the grammar
    bad.push(" 0x1p0", "0x1p0　", "﻿0x1p0", "0x１p0");
    for (const text of bad) expect(() => floatFromHex(text), JSON.stringify(text)).toThrow();
  });

  it("rejects, rather than rounds, what needs more than 53 bits or falls off the subnormal grid", () => {
    expect(() => floatFromHex("0x1.00000000000001p0")).toThrow(/53 bits/);
    expect(() => floatFromHex("0x1p-1075")).toThrow(/subnormal/);
    expect(() => floatFromHex("0x1p1024")).toThrow(/range/);
  });
});
