import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.ts";
import { CHECK_TIMEOUT_MS, type Check } from "../../src/http/health.ts";
import { testApp } from "./helpers.ts";

const answers: Check = async () => true;
const saysNo: Check = async () => false;
const throws: Check = async () => {
  throw new Error("connection refused at 10.0.0.9:5432");
};

let app: App;
afterEach(async () => {
  await app.close();
});

describe("health", () => {
  it("/healthz answers while the process is up", async () => {
    app = await testApp();
    const res = await app.inject({ url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("/readyz says the database is not configured (nothing uses one yet)", async () => {
    app = await testApp();
    const res = await app.inject({ url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready", dependencies: { database: "not_configured" } });
  });

  it.each([
    ["answers", answers, 200, { status: "ready", dependencies: { database: "ok" } }],
    ["says no", saysNo, 503, { status: "not_ready", dependencies: { database: "failing" } }],
    ["throws", throws, 503, { status: "not_ready", dependencies: { database: "failing" } }],
  ] as const)("/readyz when the database check %s", async (_name, database, status, body) => {
    app = await testApp({}, { database });
    const res = await app.inject({ url: "/readyz" });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual(body);
    expect(res.body).not.toContain("10.0.0.9");
  });

  it("/readyz counts a check that does not answer within 2 seconds as failing", async () => {
    app = await testApp({}, { database: () => new Promise<boolean>(() => {}) });
    await app.ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = app.inject({ url: "/readyz" });
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      const res = await pending;
      expect(CHECK_TIMEOUT_MS).toBe(2000);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "not_ready", dependencies: { database: "failing" } });
    } finally {
      vi.useRealTimers();
    }
  });
});
