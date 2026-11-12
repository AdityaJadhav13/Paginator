// The origin guard's log (src/http/origin-guard.ts): a flood of refused requests writes one line a minute, with how
// many were refused, not a line each.
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { LOG_WINDOW_MS, originGuard } from "../../src/http/origin-guard.ts";

describe("originGuard's log", () => {
  it("writes one line a window, however many requests it refuses", async () => {
    let now = 1_000_000;
    const lines: object[] = [];
    const guard = originGuard(["https://app.example.test"], () => now);
    const request = {
      method: "POST",
      headers: { origin: "https://elsewhere.test" },
      log: { warn: (fields: object) => void lines.push(fields) },
    } as unknown as FastifyRequest;
    for (let i = 0; i < 1000; i += 1) await expect(guard(request)).rejects.toMatchObject({ code: "bad_origin" });
    expect(lines).toEqual([{ origin: "https://elsewhere.test", method: "POST", refused: 1 }]);
    now += LOG_WINDOW_MS;
    await expect(guard(request)).rejects.toMatchObject({ code: "bad_origin" });
    expect(lines.at(-1)).toMatchObject({ refused: 1000 }); // the 999 not written, and this one
    expect(lines).toHaveLength(2);
  });
});
