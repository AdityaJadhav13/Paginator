/**
 * The primary call to action (03 §4.1): Book a demo, to /contact?intent=demo (on /pricing first "Talk to us about a
 * pilot", to /contact?intent=pilot), only once the API says the contact form is connected; "Open your workspace" for
 * a signed-in person with a workspace. And the links a public page may have.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "../../src/test/render.tsx";
import { text } from "../../src/features/public/content.ts";
import { CATALOGUES } from "../../src/i18n/index.ts";
import { LANGUAGES, PUBLIC_PAGES, PUBLIC_ROUTES, contactAnswered, renderPublic } from "./renderPublic.tsx";

const SIGNED_IN_DESTINATION = "/org/org-demo-sahyadri";

function ctaLinks(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(within(container).getByRole("main").querySelectorAll<HTMLAnchorElement>("a.pg-public__cta"));
}

const EXPECTED: Record<string, Array<[string, string]>> = {
  "/": [["cta-book-demo", "/contact?intent=demo"], ["cta-book-demo", "/contact?intent=demo"]],
  "/features": [["cta-book-demo", "/contact?intent=demo"], ["cta-book-demo", "/contact?intent=demo"]],
  "/pricing": [["cta-pilot", "/contact?intent=pilot"], ["cta-book-demo", "/contact?intent=demo"]],
  "/security": [["cta-book-demo", "/contact?intent=demo"], ["cta-book-demo", "/contact?intent=demo"]],
  "/contact": [],
};

describe("Primary call to action, signed out, once the contact form is connected", () => {
  for (const language of LANGUAGES) {
    for (const { path, headingId } of PUBLIC_PAGES) {
      it(`"${path}" in ${language}: at the top and in the closing band, as a link`, async () => {
        const { container, environment } = renderPublic(path, "signed-out", language);
        await screen.findByRole("heading", { level: 1, name: text(headingId, language) });
        await contactAnswered(environment);
        const links = ctaLinks(container);
        expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual(
          (EXPECTED[path] ?? []).map(([id, href]) => [text(id, language), href]),
        );
        for (const link of links) expect(link.tagName).toBe("A");
      });
    }

    it(`is also in the header in ${language}: Sign in and Book a demo`, async () => {
      const { container, environment } = renderPublic("/", "signed-out", language);
      await screen.findByRole("heading", { level: 1, name: text("home-hero-title", language) });
      await contactAnswered(environment);
      const header = container.querySelector("header") as HTMLElement;
      expect(within(header).getByRole("link", { name: CATALOGUES[language]["public.signIn"] })).toHaveAttribute("href", "/login");
      expect(within(header).getByRole("link", { name: CATALOGUES[language]["public.bookDemo"] })).toHaveAttribute(
        "href",
        "/contact?intent=demo",
      );
      expect(within(header).queryByRole("link", { name: /sign up/i })).toBeNull();
    });
  }

  it("is there at once on the next page: the answer is asked once per page load and kept", async () => {
    const { container, environment } = renderPublic("/", "signed-out");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });
    await contactAnswered(environment);
    const asked = vi.spyOn(environment.contact, "connection");
    fireEvent.click(within(container.querySelector("header") as HTMLElement).getByRole("link", { name: "Pricing" }));
    // checked before any promise settles
    expect(screen.getByRole("heading", { level: 1, name: text("pricing-title", "en") })).toBeInTheDocument();
    expect(ctaLinks(container).map((link) => link.getAttribute("href"))).toEqual(["/contact?intent=pilot", "/contact?intent=demo"]);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("No call to action to a form that cannot send", () => {
  /** Every link to the form with an intent: Book a demo, Talk to us about a pilot, and how to report a problem. */
  const formLinks = (container: HTMLElement) => Array.from(container.querySelectorAll("a[href^='/contact?']"));

  for (const language of LANGUAGES) {
    for (const connection of ["notConnected", "unknown"] as const) {
      it(`${connection}, in ${language}: none in the header or on any page; Sign in stays`, async () => {
        for (const { path, headingId } of PUBLIC_PAGES) {
          const view = renderPublic(path, "signed-out", language);
          view.environment.contactController.setConnection(connection);
          await screen.findByRole("heading", { level: 1, name: text(headingId, language) });
          await contactAnswered(view.environment);
          expect(formLinks(view.container), path).toEqual([]);
          const header = view.container.querySelector("header") as HTMLElement;
          expect(within(header).getByRole("link", { name: CATALOGUES[language]["public.signIn"] })).toBeInTheDocument();
          view.unmount();
        }
      });
    }

    it(`none while the API has not answered yet, in ${language}`, () => {
      for (const { path, headingId } of PUBLIC_PAGES) {
        // checked at once: the test double answers on a later turn
        const view = renderPublic(path, "signed-out", language);
        expect(screen.getByRole("heading", { level: 1, name: text(headingId, language) })).toBeInTheDocument();
        expect(formLinks(view.container), path).toEqual([]);
        view.unmount();
      }
    });
  }
});

describe("Primary call to action, signed in", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    if (path === "/contact") continue;
    it(`"${path}" opens the workspace instead`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });
      await screen.findAllByText("Open your workspace");
      const links = ctaLinks(container);
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toHaveTextContent("Open your workspace");
        expect(link).toHaveAttribute("href", SIGNED_IN_DESTINATION);
      }
    });
  }
});

describe("Permitted link destinations", () => {
  const ALLOWED = new Set([
    "/",
    "/features",
    "/pricing",
    "/security",
    "/contact",
    "/contact?intent=demo",
    "/contact?intent=pilot",
    "/contact?intent=other",
    "/login",
    SIGNED_IN_DESTINATION,
  ]);

  for (const { path, heading } of PUBLIC_ROUTES) {
    for (const preset of ["signed-out", undefined] as const) {
      it(`"${path}" (${preset ?? "signed in"}) links only inside the site, never to an external, mail or empty link`, async () => {
        const { container } = renderPublic(path, preset);
        await screen.findByRole("heading", { level: 1, name: heading });
        const anchors = Array.from(container.querySelectorAll("a"));
        expect(anchors.length).toBeGreaterThan(0);
        for (const anchor of anchors) {
          const href = anchor.getAttribute("href") ?? "";
          if (anchor.classList.contains("pg-skip-link")) {
            expect(href).toBe("#pg-main");
            continue;
          }
          expect(anchor).not.toHaveAttribute("target");
          expect(href.startsWith("mailto:")).toBe(false);
          expect(href.startsWith("http")).toBe(false);
          expect(ALLOWED.has(href), `${path}: ${href}`).toBe(true);
        }
      });
    }
  }
});

describe("Page content does not repeat the header's session controls", () => {
  it("renders no sign-in, sign-up or sign-out control inside <main>", async () => {
    for (const { path, heading } of PUBLIC_ROUTES) {
      const { container, unmount } = renderPublic(path, "signed-out");
      await screen.findByRole("heading", { level: 1, name: heading });
      const main = within(container).getByRole("main");
      expect(main.querySelector('a[href="/signup"]')).toBeNull();
      expect(main.querySelector('a[href="/login"]')).toBeNull();
      expect(main.textContent?.match(/\bSign out\b/) ?? null).toBeNull();
      unmount();
    }
  });
});
