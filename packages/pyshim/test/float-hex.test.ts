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
});
