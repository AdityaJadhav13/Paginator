/**
 * The public pages render, keep their routes, and show the workflow and its states (UI005 §28 rows 1, 2, 5, 6; 03
 * §4.2), in English and Marathi.
 */
import { describe, it, expect } from "vitest";
import { screen, within } from "../../src/test/render.tsx";
import { text } from "../../src/features/public/content.ts";
import { stageIds, WORKFLOW_STAGES } from "../../src/features/public/workflow.ts";
import { LANGUAGES, PUBLIC_PAGES, PUBLIC_ROUTES, renderPublic } from "./renderPublic.tsx";

describe("The five public pages render", () => {
  for (const language of LANGUAGES) {
    for (const { path, headingId } of PUBLIC_PAGES) {
      it(`"${path}" in ${language} renders its own <h1>, marked with its language`, async () => {
        const { container } = renderPublic(path, undefined, language);
        const h1 = await screen.findByRole("heading", { level: 1, name: text(headingId, language) });
        expect(h1).toHaveAttribute("id", "pg-route-heading");
        expect(h1).toHaveAttribute("tabindex", "-1");
        expect(container.querySelectorAll("h1")).toHaveLength(1);
        expect(container.querySelector(".pg-shell--public")).toHaveAttribute("lang", language);
        expect(container).not.toHaveTextContent(/not yet implemented/i);
      });
    }
  }
});

describe("Route ownership is preserved", () => {
  const authRoutes: Array<[string, string]> = [
    ["/login", "Sign in"],
    ["/signup", "Create an account"],
    ["/forgot-password", "Forgot your password?"],
    ["/verify", "Confirm your email address"],
  ];
  for (const [path, title] of authRoutes) {
    it(`"${path}" renders its sign-in screen`, async () => {
      renderPublic(path, "signed-out");
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    });
  }

  it("/onboarding still renders the UI006 placeholder (development only)", async () => {
    const { container } = renderPublic("/onboarding");
    await screen.findByRole("heading", { level: 1, name: "Onboarding" });
    expect(container).toHaveTextContent("UI006");
  });
});

describe("The workflow", () => {
  for (const language of LANGUAGES) {
    it(`shows all seven stages on /features in ${language}, each with what it does, what is live today and its state`, async () => {
      const { container } = renderPublic("/features", undefined, language);
      await screen.findByRole("heading", { level: 1, name: text("features-title", language) });
      const main = within(container).getByRole("main");
      const articles = main.querySelectorAll(".pg-public__stage");
      expect(articles).toHaveLength(7);
      WORKFLOW_STAGES.forEach((stage, index) => {
        const ids = stageIds(stage);
        const article = articles[index] as HTMLElement;
        expect(article).toHaveTextContent(text(ids.name, language));
        expect(article).toHaveTextContent(text(ids.description, language));
        expect(article).toHaveTextContent(text(ids.today, language));
        const states = [...article.querySelectorAll(".pg-capability")].map((node) => node.textContent);
        expect(states).toEqual(ids.states.map((id) => text(id, language)));
      });
    });

    it(`shows the seven stages and their states on / in ${language}`, async () => {
      const { container } = renderPublic("/", undefined, language);
      await screen.findByRole("heading", { level: 1, name: text("home-hero-title", language) });
      const items = container.querySelectorAll(".pg-public__sequence-item");
      expect(items).toHaveLength(7);
      WORKFLOW_STAGES.forEach((stage, index) => {
        const ids = stageIds(stage);
        expect(items[index]).toHaveTextContent(text(ids.name, language));
        expect(items[index]).toHaveTextContent(text(ids.description, language));
      });
    });
  }

  it("marks six stages working in the Desk, Content also built for the pilot, and Archive planned", () => {
    expect(Object.fromEntries(WORKFLOW_STAGES.map((stage) => [stage.key, stage.states]))).toEqual({
      plan: ["desk"],
      content: ["desk", "pilot"],
      generate: ["desk"],
      edit: ["desk"],
      check: ["desk"],
      print: ["desk"],
      archive: ["planned"],
    });
  });
});

describe("Numbers on a page come only from sourced facts", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" shows no currency or percentage, and every number it shows is a sourced fact's`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });
      const readable = within(container).getByRole("main").cloneNode(true) as HTMLElement;
      for (const hidden of readable.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      const shown = readable.textContent ?? "";
      expect(shown).not.toMatch(/[$€£₹¥%]/);
      for (const element of readable.querySelectorAll("p, li, h1, h2, h3, span")) {
        if (element.children.length > 0 || !/\d/.test(element.textContent ?? "")) continue;
        const value = (element.textContent ?? "").trim();
        expect(value, `"${value}" on ${path}`).toMatch(/\d/);
        expect(
          ["proof-edition", "proof-edition-figure", "proof-gen1", "proof-gen1-figure", "proof-gen1-cite", "proof-press-cite", "proof-check-cite", "workflow-generate-today"].some(
            (id) => text(id, "en") === value,
          ),
          `"${value}" on ${path} is not a sourced fact`,
        ).toBe(true);
      }
    });
  }
});
