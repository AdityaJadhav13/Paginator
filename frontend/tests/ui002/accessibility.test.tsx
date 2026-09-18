/**
 * Accessibility and RTL tests (UI002 §11, §14; AC-17, AC-18, AC-19).
 *
 * axe-core structural checks run in jsdom; the same checks were also
 * run against the real production build in a real browser during
 * implementation (see the implementation report) — jsdom's axe run
 * cannot see resolved CSS custom properties, so `color-contrast` is
 * disabled here exactly as UI001's own accessibility tests do.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { screen } from "../../src/test/render.tsx";
import axe from "axe-core";
import { renderAt } from "./renderRoutes.tsx";

async function checkAxe(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

describe("axe — one representative route per shell", () => {
  it("PublicShell: zero serious/critical violations", async () => {
    const { container } = renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(await checkAxe(container)).toHaveLength(0);
  });

  it("WorkspaceShell (org-scoped): zero serious/critical violations", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/settings");
    await screen.findByRole("heading", { level: 1, name: "Organization settings" });
    expect(await checkAxe(container)).toHaveLength(0);
  });

  it("WorkspaceShell (publication-scoped): zero serious/critical violations", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(await checkAxe(container)).toHaveLength(0);
  });

  it("WorkspaceShell (edition workspace): zero serious/critical violations", async () => {
    const { container } = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/generate"
    );
    await screen.findByRole("heading", { level: 1, name: "Generate" });
    expect(await checkAxe(container)).toHaveLength(0);
  });

  it("EditorShell: zero serious/critical violations", async () => {
    const { container } = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor"
    );
    await screen.findByRole("heading", { level: 1, name: "Editor" });
    expect(await checkAxe(container)).toHaveLength(0);
  });

  it("NotFoundPage: zero serious/critical violations", async () => {
    const { container } = renderAt("/nowhere");
    await screen.findByRole("heading", { level: 1, name: "Page not found" });
    expect(await checkAxe(container)).toHaveLength(0);
  });

  it("AccessUnavailablePage: zero serious/critical violations", async () => {
    const { container } = renderAt("/org/nonexistent-org/settings");
    await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
    expect(await checkAxe(container)).toHaveLength(0);
  });
});

describe("Landmarks (§7.6)", () => {
  it("exactly one h1 per rendered route", async () => {
    for (const path of [
      "/",
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview",
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor",
      "/nowhere",
    ]) {
      const { container, unmount } = renderAt(path);
      await screen.findByRole("heading", { level: 1 });
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      unmount();
    }
  });

  it("every nav landmark has a distinct aria-label", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    const labels = Array.from(container.querySelectorAll("nav[aria-label]")).map((n) =>
      n.getAttribute("aria-label")
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("each shell has exactly one <main> landmark", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });
});

describe("RTL (§7.2, AC-18)", () => {
  it("sets dir=rtl/lang=ur-IN for the Urdu-evening publication", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    const shell = container.querySelector(".pg-shell--workspace");
    expect(shell).toHaveAttribute("dir", "rtl");
    expect(shell).toHaveAttribute("lang", "ur-IN");
  });

  it("defaults to dir=ltr for the Pune Daily publication", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    const shell = container.querySelector(".pg-shell--workspace");
    expect(shell).toHaveAttribute("dir", "ltr");
    expect(shell).toHaveAttribute("lang", "en-IN");
  });

  it("defaults to dir=ltr when no publication is resolved (org-admin routes)", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/settings");
    await screen.findByRole("heading", { level: 1, name: "Organization settings" });
    const shell = container.querySelector(".pg-shell--workspace");
    expect(shell).toHaveAttribute("dir", "ltr");
  });

  it("RTL publication overview still has zero serious/critical axe violations", async () => {
    const { container } = renderAt("/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(await checkAxe(container)).toHaveLength(0);
  });

  it("RTL: organization and publication switchers remain labelled and reachable", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(screen.getByRole("combobox", { name: "Organization" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Publication" })).toBeInTheDocument();
  });
});

describe("No physical-direction CSS in durable shell chrome (UI001's own pattern, applied here)", () => {
  const SHELL_CSS = readFileSync(resolve(__dirname, "../../src/app/shell.css"), "utf-8");
  const withoutComments = SHELL_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  const physicalPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bmargin-left\s*:/, name: "margin-left" },
    { pattern: /\bmargin-right\s*:/, name: "margin-right" },
    { pattern: /\bpadding-left\s*:/, name: "padding-left" },
    { pattern: /\bpadding-right\s*:/, name: "padding-right" },
    { pattern: /\bborder-left\s*:/, name: "border-left" },
    { pattern: /\bborder-right\s*:/, name: "border-right" },
    { pattern: /\bleft\s*:/, name: "left" },
    { pattern: /\bright\s*:/, name: "right" },
  ];

  for (const { pattern, name } of physicalPatterns) {
    it(`does not use physical ${name}`, () => {
      expect(withoutComments).not.toMatch(pattern);
    });
  }
});
