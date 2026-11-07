/**
 * The legal pages (03 §4.2 `/legal/*`; doc 11 L2-230): the owner's text from `/legal-text/<doc>.<lang>.txt` (served by
 * Caddy from a host folder), the other language's with a note when only that exists, and otherwise a line saying the
 * text is to be supplied by the owner. The footer links to all three. Every text here is fictional.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { CATALOGUES } from "../../src/i18n/index.ts";
import { LANGUAGES, renderPublic } from "./renderPublic.tsx";

const PAGES = [
  { path: "/legal/privacy", doc: "privacy" },
  { path: "/legal/terms", doc: "terms" },
  { path: "/legal/grievance", doc: "grievance" },
] as const;

const FICTIONAL = "## A fictional heading\n\nA fictional first line.\nIts second line.\n\r\n<b>Not bold</b> & not HTML.\n";

/** Serves `files` at /legal-text/<name>; anything else as `otherwise` (Caddy's 404, or the Vite dev server's page). */
function serve(files: Record<string, string>, otherwise: "404" | "html" | "500" | "offline" = "404") {
  const fetchSpy = vi.fn(async (url: string) => {
    const name = url.replace(/^\/legal-text\//, "");
    if (name in files) return new Response(files[name], { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (otherwise === "offline") throw new TypeError("Failed to fetch");
    if (otherwise === "html") return new Response("<!doctype html><title>x</title>", { headers: { "Content-Type": "text/html" } });
    return new Response(otherwise, { status: Number(otherwise), headers: { "Content-Type": "text/plain; charset=utf-8" } });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

async function violations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((violation) => `${violation.id} (${violation.impact})`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Each legal page", () => {
  for (const language of LANGUAGES) {
    for (const { path, doc } of PAGES) {
      it(`"${path}" in ${language}, with no file, has its <h1> and says the text is to be supplied`, async () => {
        const fetchSpy = serve({});
        const { container } = renderPublic(path, "signed-out", language);
        const h1 = await screen.findByRole("heading", { level: 1, name: CATALOGUES[language][`public.legal.${doc}`] });
        expect(h1).toHaveAttribute("id", "pg-route-heading");
        expect(await screen.findByText(CATALOGUES[language][`public.legal.${doc}.pending`])).toBeInTheDocument();
        const other = language === "en" ? "mr" : "en";
        expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([`/legal-text/${doc}.${language}.txt`, `/legal-text/${doc}.${other}.txt`]);
        expect(container.querySelectorAll("h1")).toHaveLength(1);
        expect(await violations(container)).toEqual([]);
      });
    }
  }

  it("says in English that the text is the owner's to supply, and invents none", () => {
    for (const { doc } of PAGES) expect(CATALOGUES.en[`public.legal.${doc}.pending`]).toMatch(/to be supplied by the owner/);
  });
});

describe("The owner's file", () => {
  it("is shown as text: a '## ' block is a subheading, a paragraph keeps its line breaks, nothing is HTML", async () => {
    serve({ "privacy.en.txt": FICTIONAL });
    const { container } = renderPublic("/legal/privacy", "signed-out");
    const heading = await screen.findByRole("heading", { level: 2, name: "A fictional heading" });
    const text = heading.parentElement as HTMLElement;
    expect(text).toHaveAttribute("lang", "en");
    const paragraphs = [...text.querySelectorAll("p")].map((p) => p.textContent);
    expect(paragraphs).toEqual(["A fictional first line.\nIts second line.", "<b>Not bold</b> & not HTML."]);
    expect(text.querySelector("b")).toBeNull();
    expect(container).not.toHaveTextContent(CATALOGUES.en["public.legal.privacy.pending"]);
    expect(container).not.toHaveTextContent(CATALOGUES.en["public.legal.otherLanguage"]);
    expect(await violations(container)).toEqual([]);
  });

  it("in the other language only: that text, marked with its language, and a one-line note", async () => {
    serve({ "terms.mr.txt": "काल्पनिक मजकूर." });
    const { container } = renderPublic("/legal/terms", "signed-out", "en");
    const paragraph = await screen.findByText("काल्पनिक मजकूर.");
    expect(paragraph.closest("[lang]")).toHaveAttribute("lang", "mr");
    expect(screen.getByText("This text is published in Marathi only.")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(CATALOGUES.en["public.legal.terms.pending"]);
    expect(await violations(container)).toEqual([]);
  });

  it("on the Marathi page, falls back to the English text with the Marathi note", async () => {
    serve({ "grievance.en.txt": "A fictional line." });
    renderPublic("/legal/grievance", "signed-out", "mr");
    expect((await screen.findByText("A fictional line.")).closest("[lang]")).toHaveAttribute("lang", "en");
    expect(screen.getByText(CATALOGUES.mr["public.legal.otherLanguage"])).toBeInTheDocument();
  });

  it("is not taken from an HTML answer (the dev server's page) or an empty file: the placeholder instead", async () => {
    serve({ "privacy.en.txt": " \n\n " }, "html");
    const { container } = renderPublic("/legal/privacy", "signed-out");
    await screen.findByText(CATALOGUES.en["public.legal.privacy.pending"]);
    expect(container.querySelector(".pg-public__legal")).toBeNull();
  });

  for (const failure of ["500", "offline"] as const) {
    it(`when the server cannot answer (${failure}), says so, and never that the text is still to come`, async () => {
      serve({}, failure);
      const { container } = renderPublic("/legal/privacy", "signed-out");
      await screen.findByText(CATALOGUES.en["public.legal.failed"]);
      expect(container).not.toHaveTextContent(CATALOGUES.en["public.legal.privacy.pending"]);
    });
  }
});

describe("The footer's Legal group", () => {
  for (const language of LANGUAGES) {
    it(`links to the three legal pages, in ${language}`, async () => {
      serve({});
      const { container } = renderPublic("/", "signed-out", language);
      const footer = container.querySelector("footer") as HTMLElement;
      const group = within(footer).getByRole("group", { name: CATALOGUES[language]["public.legal.group"] });
      expect(within(group).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
        [CATALOGUES[language]["public.legal.privacy"], "/legal/privacy"],
        [CATALOGUES[language]["public.legal.terms"], "/legal/terms"],
        [CATALOGUES[language]["public.legal.grievance"], "/legal/grievance"],
      ]);
    });
  }

  it("moves from one legal page to another without showing the first one's text", async () => {
    serve({ "privacy.en.txt": "A fictional privacy line." });
    const { container } = renderPublic("/legal/privacy", "signed-out");
    await screen.findByText("A fictional privacy line.");
    const group = within(container.querySelector("footer") as HTMLElement).getByRole("group", { name: "Legal" });
    await userEvent.setup().click(within(group).getByRole("link", { name: "Terms of use" }));
    await screen.findByText(CATALOGUES.en["public.legal.terms.pending"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms of use");
    expect(container).not.toHaveTextContent("A fictional privacy line.");
  });
});
