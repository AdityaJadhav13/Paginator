// Better Auth's telemetry stays off (docs/product/10-l2-newsroom-plan.md §4.1). Better Auth never sends it under a test
// runner, nor without an endpoint, so this starts our auth in a plain Node process with an endpoint set, where it would
// send were it on, and counts every outgoing request. (The API itself refuses to start with that variable: config.ts.)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PASSWORDS } from "./helpers.ts";

const src = (path: string) => JSON.stringify(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)));

describe("telemetry", () => {
  it("sends nothing when our sign-in starts, outside a test runner", () => {
    const script = `
      const calls = [];
      globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("{}"); };
      const { loadConfig } = await import(${src("config.ts")});
      const { openDatabase } = await import(${src("db/pools.ts")});
      const { createAuth } = await import(${src("modules/identity/auth.ts")});
      const { openMailer } = await import(${src("modules/notifications/mailer.ts")});
      const config = loadConfig({ ...${JSON.stringify(PASSWORDS)}, PGN_DB_PORT: "1" });
      const database = openDatabase(config.database);
      const mailer = openMailer(config.mail, { sendMail: async () => undefined, close: () => undefined }, () => undefined);
      const auth = createAuth({ config, database, mailer, log: { warn: () => undefined, error: () => undefined } });
      await auth.$context;
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(JSON.stringify(calls));
      await database.close();`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      // no NODE_ENV=test: as in production; and an endpoint, so that telemetry turned on would send
      env: {
        PATH: process.env["PATH"] ?? "",
        BETTER_AUTH_TELEMETRY_ENDPOINT: "https://telemetry.example.test/collect",
      },
    });
    expect(child.stderr).toBe("");
    expect(child.stdout.trim()).toBe("[]");
  });
});
