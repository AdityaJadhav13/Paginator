/**
 * Accessibility of the five public surfaces (UI005 §22.1, §28
 * "Accessibility" row; AC-53, AC-54).
 *
 * `color-contrast` is disabled here for the same reason UI001 and UI002
 * disable it: jsdom cannot resolve CSS custom properties, so every colour
 * reads as a default. Contrast is verified numerically in a real browser
 * instead (RB-08).
 *
 * UI005 targets zero violations of ANY impact, not merely zero
 * serious/critical: these surfaces are static content with no complex
 * widget, so there is no legitimate minor violation to tolerate.
 */
import { describe, it, expect } from "vitest";
import axe from "axe-core";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { PUBLIC_ROUTES, renderPublic } from "./renderPublic.tsx";

async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map((violation) => `${violation.id} (${violation.impact})`);
}

describe("axe — every public surface (AC-54)", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" has zero violations of any impact`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });
      expect(await violations(container)).toEqual([]);
    });
  }

  it("/contact has zero violations in its acknowledgement state", async () => {
    const { container } = renderPublic("/contact");
    await screen.findByRole("heading", { level: 1, name: "Contact" });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^Message/), "Checked after submission.");
    await user.click(screen.getByRole("button", { name: "Preview the acknowledgement" }));
    await screen.findByText("Nothing was sent");

    expect(await violations(container)).toEqual([]);
  });
});

describe("Landmarks and navigation labels", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" labels Primary and Secondary navigation distinctly`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });

      const navs = Array.from(container.querySelectorAll("nav"));
      const labels = navs.map((nav) => nav.getAttribute("aria-label"));

      expect(labels).toContain("Primary");
      expect(labels).toContain("Secondary");
      expect(new Set(labels).size).toBe(labels.length);
      expect(within(container).getAllByRole("main")).toHaveLength(1);
    });
  }
});

describe("Focus and tabindex discipline (AC-53, AC-58)", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" uses no positive tabindex and no aria-hidden focusable`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });

      for (const node of container.querySelectorAll("[tabindex]")) {
        expect(Number(node.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
      }
      for (const hidden of container.querySelectorAll('[aria-hidden="true"]')) {
        expect(hidden.querySelector("a, button, input, textarea, select")).toBeNull();
      }
    });
  }

  it("keeps the skip link as the first Tab stop on a public surface", async () => {
    renderPublic("/");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });

    await userEvent.setup().tab();
    expect(document.activeElement).toHaveClass("pg-skip-link");
  });
});

describe("The page geometry figure is exposed correctly (AC-08)", () => {
  it("uses figure/figcaption with an accessible description and no content glyph", async () => {
    const { container } = renderPublic("/");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });

    const figure = container.querySelector("figure");
    expect(figure).not.toBeNull();

    const svg = figure!.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg!.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(20);

    const caption = figure!.querySelector("figcaption");
    expect(caption).toHaveTextContent(
      "Illustration of newspaper page structure. This is a diagram, not output produced by Pageinator."
    );

    // The only glyphs permitted inside the diagram are the three legend
    // labels — no headline, byline, dateline, greeking or measurement.
    const svgText = Array.from(svg!.querySelectorAll("text")).map((node) =>
      node.textContent?.trim()
    );
    expect(svgText).toEqual(["Column grid", "Reserved ad", "Linked flow"]);
    expect(svgText.join(" ")).not.toMatch(/\d/);
  });

  it("renders no raster image, photograph or logo on any surface (AC-09)", async () => {
    for (const { path, heading } of PUBLIC_ROUTES) {
      const { container, unmount } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });

      expect(container.querySelector("img"), `"${path}" renders an image`).toBeNull();
      expect(container.querySelector("picture")).toBeNull();
      expect(container.querySelector("video")).toBeNull();
      expect(container.querySelector("canvas")).toBeNull();
      unmount();
    }
  });
});
