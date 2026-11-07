// @vitest-environment node
/**
 * Review F3: the built page itself sends no Referer, so reset links (/reset-password?token=…) and invitation links
 * (/invite/<id>) never leave in one. Builds the app in memory with the project's own Vite config.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { build } from "vite";
import { OWNING_UNIT } from "../../src/app/routes.ts";

describe("The built page", () => {
  it("carries the no-referrer policy in its head", async () => {
    // as `vite build` runs it: Vitest sets NODE_ENV=test, which would make a development build
    const environment = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    const result = await build({
      root: resolve(__dirname, "../.."),
      configFile: resolve(__dirname, "../../vite.config.ts"),
      logLevel: "silent",
      mode: "production",
      build: { write: false },
    }).finally(() => {
      process.env["NODE_ENV"] = environment;
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => ("output" in entry ? entry.output : []));
    const page = outputs.find((file) => file.fileName === "index.html");
    const html = page && "source" in page ? String(page.source) : "";
    expect(html).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
    expect(html.indexOf('name="referrer"')).toBeLessThan(html.indexOf("<script"));

    // plan §2.6: the placeholder screens and the reserved status surface stay out of the deployed app
    const scripts = outputs
      .filter((file) => file.fileName.endsWith(".js"))
      .map((file) => ("code" in file ? file.code : ""))
      .join("\n");
    expect(scripts).toContain("Account security");
    expect(scripts).not.toContain("This surface is not yet implemented");
    expect(scripts).not.toContain("Reserved workspace status surface");
    // nor the test double's demonstration notes, nor the internal build-unit labels (OWNING_UNIT)
    for (const note of [
      "This demonstration action is not available",
      "Demonstration only",
      "The demonstration service is temporarily unavailable",
    ]) {
      expect(scripts).not.toContain(note);
    }
    for (const unit of new Set(Object.values(OWNING_UNIT))) {
      expect(scripts, unit).not.toMatch(new RegExp(`[\`"']${unit.replace(/[()]/g, "\\$&")}[\`"']`));
    }
  }, 60_000);
});
