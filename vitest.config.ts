import { readFileSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";

// Projects: the web app (its own config: jsdom), the kernel packages, test kit and repository tools (node), the API
// with the shared packages it uses (node), and a private project that runs only via `pnpm test:private` because it
// needs the private pilot goldens on this machine.
const privateRun = process.env["PAGEINATOR_PRIVATE_RUN"] === "1";
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
        },
      },
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
