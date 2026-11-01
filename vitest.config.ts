import { readFileSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";

// Projects: the web app (its own config: jsdom), the kernel packages, test kit and repository tools (node), the API
// with the shared packages it uses (node), and three that run only when asked: the API's database tests and its
// tenancy tests (`pnpm test:db`: they need the development database, and fail without it), and a private project
// (`pnpm test:private`: it needs the private pilot goldens on this machine).
const privateRun = process.env["PAGEINATOR_PRIVATE_RUN"] === "1";
const dbRun = process.env["PAGEINATOR_DB_RUN"] === "1";
const DB_TESTS = ["apps/api/test/db/**/*.test.ts", "apps/api/test/tenancy/**/*.test.ts"];
// shared packages (tools/ts/workspace.json, as eslint.config.js and tools/ts/check-graph.ts read it) are not kernel code
const workspace = JSON.parse(readFileSync(new URL("./tools/ts/workspace.json", import.meta.url), "utf8")) as {
  sharedPackages: string[];
};
const SHARED = workspace.sharedPackages.map((dir) => `packages/${dir}`);

export default defineConfig({
  test: {
    projects: [
      "apps/web",
      {
        test: {
          name: "kernel",
          environment: "node",
          include: ["packages/*/test/**/*.test.ts", "tools/testkit/test/**/*.test.ts", "tools/ts/test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...SHARED.map((dir) => `${dir}/**`)],
        },
      },
      {
        test: {
          name: "api",
          environment: "node",
          include: ["apps/api/test/**/*.test.ts", ...SHARED.map((dir) => `${dir}/test/**/*.test.ts`)],
          exclude: [...configDefaults.exclude, ...DB_TESTS],
        },
      },
      {
        // the engine's queue; its database test runs only with PGN_QUEUE_DB_URL (and then fails, never skips)
        test: { name: "engine-queue", environment: "node", include: ["apps/engine-queue/test/**/*.test.ts"] },
      },
      ...(dbRun
        ? [
            {
              test: {
                name: "api-db",
                environment: "node",
                include: ["apps/api/test/db/**/*.test.ts"],
                globalSetup: ["apps/api/test/db/global-setup.ts"],
              },
            },
            {
              test: {
                name: "tenancy",
                environment: "node",
                include: ["apps/api/test/tenancy/**/*.test.ts"],
                globalSetup: ["apps/api/test/db/global-setup.ts"],
              },
            },
          ]
        : []),
      ...(privateRun
        ? [
            {
              test: {
                name: "private",
                environment: "node",
                include: ["packages/*/test-private/**/*.test.ts"],
              },
            },
          ]
        : []),
    ],
  },
});
