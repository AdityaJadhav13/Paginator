// The queue process's settings (src/main.ts): the database as pgn_engine, the runner's limits, and a refusal for each
// setting missing or out of range (never its value).
import { describe, expect, it } from "vitest";
import { reportToInbox } from "../src/inbox.ts";
import { SettingsError, settingsFrom } from "../src/main.ts";

const ENV = { PGN_DB_HOST: "db.internal", PGN_DB_NAME: "pageinator", PGN_ENGINE_PASSWORD: "p@ss:w/rd%" };

describe("the queue's settings", () => {
  it("connect as pgn_engine with the password as given, and keep the runner's defaults", () => {
    const s = settingsFrom(ENV);
    const url = new URL(s.connectionString);
    expect([url.hostname, url.port, url.pathname, url.username]).toEqual([
      "db.internal",
      "5432",
      "/pageinator",
      "pgn_engine",
    ]);
    expect(decodeURIComponent(url.password)).toBe("p@ss:w/rd%");
    expect(s.concurrency).toBe(1);
    expect(s.noHandleSignals).toBe(true);
    expect(s.report).toBe(reportToInbox);
    expect(s.runner).toMatchObject({
      command: "python",
      args: ["-B", "-m", "pgn_worker.run"],
      health: ["-B", "-m", "pgn_worker.health"],
      cwd: "/opt/pageinator/apps/engine-worker",
      timeoutMs: 180_000,
    });
  });

  it("refuses a missing or malformed setting, naming it only", () => {
    for (const [name, value] of [
      ["PGN_DB_HOST", ""],
      ["PGN_ENGINE_PASSWORD", ""],
      ["PGN_DB_PORT", "70000"],
      ["PGN_QUEUE_CONCURRENCY", "0"],
      ["PGN_RUNNER_TIMEOUT_S", "1.5"],
      ["PGN_RUNNER_TIMEOUT_S", "3601"],
    ] as const) {
      expect(() => settingsFrom({ ...ENV, [name]: value }), name).toThrow(SettingsError);
      expect(() => settingsFrom({ ...ENV, [name]: value }), name).toThrow(name);
    }
  });
});
