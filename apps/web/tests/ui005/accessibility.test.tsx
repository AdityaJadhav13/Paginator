/**
 * Accessibility of the public pages (UI005 §22.1), in English and Marathi.
 *
 * `color-contrast` is disabled here for the same reason UI001 and UI002 disable it: jsdom cannot resolve CSS custom
 * properties. Contrast, sideways scrolling at 320 px and the 13 px floor for Devanagari are checked in a real browser
 * (headless Chrome with axe, at 1440, 768, 390 and 320 px), as the report of this change records.
 *
 * The target is zero violations of any impact: these are static pages and one form.
 */
import { describe, it, expect } from "vitest";
import axe from "axe-core";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { text } from "../../src/features/public/content.ts";
import { LANGUAGES, PUBLIC_PAGES, PUBLIC_ROUTES, renderPublic } from "./renderPublic.tsx";

async function violations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((violation) => `${violation.id} (${violation.impact})`);
}

describe("axe — every public page, both languages", () => {
  for (const language of LANGUAGES) {
    for (const { path, headingId } of PUBLIC_PAGES) {
      for (const preset of ["signed-out", undefined] as const) {
        it(`"${path}" in ${language} (${preset ?? "signed in"}) has zero violations`, async () => {
          const { container } = renderPublic(path, preset, language);
          await screen.findByRole("heading", { level: 1, name: text(headingId, language) });
          expect(await violations(container)).toEqual([]);
        });
      }
    }
  }

  it("/contact has zero violations when the form is not connected", async () => {
    const { container, environment } = renderPublic("/contact", "signed-out", "mr");
    environment.contactController.setConnection("notConnected");
    await screen.findByText(text("contact-off-body", "mr"));
    expect(await violations(container)).toEqual([]);
  });

  for (const outcome of ["sent", "unavailable", "errors"] as const) {
    it(`/contact has zero violations when ${outcome}`, async () => {
      const { container, environment } = renderPublic("/contact", "signed-out");
      if (outcome === "unavailable") environment.contactController.setOutcome({ kind: "unavailable" });
      await screen.findByRole("heading", { level: 1, name: "Contact" });
      await screen.findByRole("button", { name: "Send" });
      const user = userEvent.setup();
      if (outcome !== "errors") {
        await user.type(screen.getByLabelText(/^Your name/), "Asha");
        await user.type(screen.getByLabelText("Email"), "asha@example.test");
      }
      await user.click(screen.getByRole("button", { name: "Send" }));
      await screen.findAllByText(outcome === "errors" ? "Enter your name." : outcome === "sent" ? "Thank you. Your message was sent." : "The contact form is not connected yet");
      expect(await violations(container)).toEqual([]);
    });
  }
});

describe("Landmarks, navigation and language", () => {
  for (const language of LANGUAGES) {
    for (const { path, headingId } of PUBLIC_PAGES) {
      it(`"${path}" in ${language} labels its two navigations distinctly, has one main and a remembered language switch`, async () => {
        const { container } = renderPublic(path, "signed-out", language);
        await screen.findByRole("heading", { level: 1, name: text(headingId, language) });
        const labels = Array.from(container.querySelectorAll("nav")).map((nav) => nav.getAttribute("aria-label"));
        expect(labels).toHaveLength(2);
        expect(new Set(labels).size).toBe(2);
        expect(within(container).getAllByRole("main")).toHaveLength(1);
        const header = container.querySelector("header") as HTMLElement;
        expect(within(header).getByRole("button", { name: "मराठी" })).toHaveAttribute("lang", "mr");
        expect(within(header).getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
        expect(within(header).getByRole("button", { name: language === "mr" ? "मराठी" : "English" })).toHaveAttribute("aria-pressed", "true");
      });
    }
  }

  it("marks the Marathi example Marathi on the English page", async () => {
    const { container } = renderPublic("/", "signed-out", "en");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });
    const story = container.querySelector(".pg-public__specimen-story");
    expect(story).toHaveAttribute("lang", "mr");
    expect(story?.closest("[lang]")).toBe(story);
  });
});

describe("Focus and tabindex discipline", () => {
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

  it("keeps the skip link as the first Tab stop on a public page", async () => {
    renderPublic("/");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });
    await userEvent.setup().tab();
    expect(document.activeElement).toHaveClass("pg-skip-link");
  });
});

describe("The page-structure diagram", () => {
  for (const language of LANGUAGES) {
    it(`is a figure with an accessible description, a caption and only its three labels, in ${language}`, async () => {
      const { container } = renderPublic("/", undefined, language);
      await screen.findByRole("heading", { level: 1, name: text("home-hero-title", language) });
      const figure = container.querySelector(".pg-public__hero-figure figure") as HTMLElement;
      const svg = figure.querySelector("svg");
      expect(svg).toHaveAttribute("role", "img");
      expect(svg).toHaveAttribute("aria-label", text("figure-alt", language));
      expect(figure.querySelector("figcaption")).toHaveTextContent(text("figure-caption", language));
      const labels = Array.from(svg?.querySelectorAll("text") ?? []).map((node) => node.textContent?.trim());
      expect(labels).toEqual(["figure-label-grid", "figure-label-ad", "figure-label-flow"].map((id) => text(id, language)));
    });
  }

  it("is the only graphic: no raster image, photograph or logo on any page", async () => {
    for (const { path, heading } of PUBLIC_ROUTES) {
      const { container, unmount } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });
      expect(container.querySelector("img, picture, video, canvas")).toBeNull();
      unmount();
    }
  });
});
