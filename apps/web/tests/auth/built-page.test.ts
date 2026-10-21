// @vitest-environment node
/**
 * Review F3: the built page itself sends no Referer, so reset links (/reset-password?token=…) and invitation links
 * (/invite/<id>) never leave in one. Builds the app in memory with the project's own Vite config.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { build } from "vite";

describe("The built page", () => {
  it("carries the no-referrer policy in its head", async () => {
    const result = await build({
      root: resolve(__dirname, "../.."),
      configFile: resolve(__dirname, "../../vite.config.ts"),
      logLevel: "silent",
      build: { write: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => ("output" in entry ? entry.output : []));
    const page = outputs.find((file) => file.fileName === "index.html");
    const html = page && "source" in page ? String(page.source) : "";
    expect(html).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
    expect(html.indexOf('name="referrer"')).toBeLessThan(html.indexOf("<script"));
  }, 60_000);
});
