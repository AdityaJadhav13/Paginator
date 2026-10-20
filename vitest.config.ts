import { defineConfig } from "vitest/config";

// Projects: the web app (its own config: jsdom), the kernel packages and test kit (node), and a private
// project that runs only via `pnpm test:private` because it needs the private pilot goldens on this machine.
const privateRun = process.env["PAGEINATOR_PRIVATE_RUN"] === "1";

export default defineConfig({
  test: {
    projects: [
      "apps/web",
      {
        test: {
          name: "kernel",
          environment: "node",
          include: ["packages/*/test/**/*.test.ts", "tools/testkit/test/**/*.test.ts"],
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
