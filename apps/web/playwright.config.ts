// The L2.1 phone smoke (e2e/smoke.e2e.ts; docs/DEVELOPMENT.md "The phone smoke"): one run, Chromium, on a stack of
// its own that e2e/stack.ts starts and removes. Run on a developer's machine: `pnpm --filter @pageinator/web e2e`.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { WEB } from "./e2e/stack.ts";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts", // not *.test.ts or *.spec.ts, which Vitest would take
  globalSetup: "./e2e/stack.ts",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: join(tmpdir(), "pgn-e2e-results"), // outside apps/web: Vite reloads the pages on a new file there
  use: { baseURL: WEB, actionTimeout: 30_000, browserName: "chromium", locale: "en-IN", timezoneId: "Asia/Kolkata", trace: "retain-on-failure" },
});
