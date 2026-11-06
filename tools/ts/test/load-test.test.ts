// tools/ts/load-test.ts: its sums (the percentiles, the summary per kind, the baseline scaled, docker stats' peaks).
import { describe, expect, it } from "vitest";
import {
  ASSUMED_BASELINE,
  type Peak,
  foldStats,
  parseBytes,
  percentile,
  scaled,
  stats,
  summarise,
} from "../load-test.ts";

describe("the load test's sums", () => {
  it("takes nearest-rank percentiles of sorted values", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
    expect(stats([3, 1, 2])).toEqual({ n: 3, p50: 2, p95: 3, max: 3 });
  });

  it("counts errors by status and times only the answers that succeeded", () => {
    const summary = summarise([
      { ms: 10, status: 200 },
      { ms: 30, status: 202 },
      { ms: 5, status: 409, code: "stale" },
      { ms: 900, status: 502 },
      { ms: 120_000, status: "timeout" },
      { ms: 1, status: 409 },
    ]);
    expect(summary.count).toBe(6);
    expect(summary.errors).toEqual({ "409 stale": 1, "409": 1, "502": 1, timeout: 1 });
    expect(summary.latencyMs).toEqual({ n: 2, p50: 10, p95: 30, max: 30 });
  });

  it("scales the assumed baseline: three times the layouts, editors and screens, each editor as often", () => {
    expect(scaled(ASSUMED_BASELINE, 3)).toEqual({ layouts: 3, editors: 12, moveEveryS: 5, screens: 45 });
    expect(scaled({ layouts: 1, editors: 3, moveEveryS: 5, screens: 5 }, 1.5)).toEqual({
      layouts: 2,
      editors: 5,
      moveEveryS: 5,
      screens: 8,
    });
  });

  it("keeps each container's peak CPU and memory from docker stats", () => {
    expect(parseBytes("512KiB")).toBe(512 * 1024);
    expect(parseBytes("1.5GiB")).toBe(1.5 * 1024 ** 3);
    expect(parseBytes("300MB")).toBe(300e6);
    expect(parseBytes("--")).toBe(0);
    const peaks = new Map<string, Peak>();
    foldStats(peaks, JSON.stringify({ Name: "engine", CPUPerc: "150.25%", MemUsage: "1GiB / 4GiB" }));
    foldStats(peaks, JSON.stringify({ Name: "engine", CPUPerc: "20.00%", MemUsage: "2GiB / 4GiB" }));
    expect(peaks.get("engine")).toEqual({ cpuPct: 150.25, memBytes: 2 * 1024 ** 3, memLimitBytes: 4 * 1024 ** 3 });
  });
});
