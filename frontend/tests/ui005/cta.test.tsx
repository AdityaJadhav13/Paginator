/**
 * Primary CTA labels, destinations and count, plus the permitted-link
 * scan (UI005 §28 rows "CTA destinations" and "Permitted links";
 * AC-16 – AC-21).
 */
import { describe, it, expect } from "vitest";
import { screen, within } from "../../src/test/render.tsx";
import { PUBLIC_ROUTES, renderPublic } from "./renderPublic.tsx";

const SIGNED_OUT_LABEL = "Enter the demonstration";
const SIGNED_IN_LABEL = "Open your demonstration workspace";
const SIGNED_IN_DESTINATION = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview";

function ctaLinks(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a.pg-public__cta"));
}

describe("Primary CTA, signed out (AC-17, AC-19)", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" renders exactly two CTAs to /login`, async () => {
      const { container } = renderPublic(path, "signed-out");
      await screen.findByRole("heading", { level: 1, name: heading });

      const links = ctaLinks(container);
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toHaveTextContent(SIGNED_OUT_LABEL);
        expect(link).toHaveAttribute("href", "/login");
      }
    });
  }
});

describe("Primary CTA, signed in (AC-18, AC-19)", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" renders exactly two CTAs to the active publication`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });
      // The CTA only changes once the session resolves.
      await screen.findAllByText(SIGNED_IN_LABEL);

      const links = ctaLinks(container);
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toHaveTextContent(SIGNED_IN_LABEL);
        expect(link).toHaveAttribute("href", SIGNED_IN_DESTINATION);
      }
    });
  }
});

describe("The CTA is a link, not a button (AC-20)", () => {
  it("renders an anchor element", async () => {
    const { container } = renderPublic("/", "signed-out");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });

    for (const link of ctaLinks(container)) {
      expect(link.tagName).toBe("A");
    }
    expect(container.querySelector("button.pg-public__cta")).toBeNull();
  });
});

describe("Permitted link destinations (AC-21)", () => {
  const ALLOWED = new Set([
    "/",
    "/features",
    "/pricing",
    "/security",
    "/contact",
    "/login",
    "/signup",
    SIGNED_IN_DESTINATION,
  ]);

  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" emits only allowed destinations, with no external or empty link`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });

      const anchors = Array.from(container.querySelectorAll("a"));
      expect(anchors.length).toBeGreaterThan(0);

      for (const anchor of anchors) {
        const href = anchor.getAttribute("href") ?? "";
        // The skip link is shell chrome and targets the main landmark.
        if (anchor.classList.contains("pg-skip-link")) {
          expect(href).toBe("#pg-main");
          continue;
        }
        expect(anchor).not.toHaveAttribute("target");
        expect(href.startsWith("mailto:")).toBe(false);
        expect(href.startsWith("http")).toBe(false);
        expect(href).not.toBe("#");
        expect(ALLOWED.has(href)).toBe(true);
      }
    });
  }
});

describe("Page content does not duplicate the shell's session controls", () => {
  it("renders no sign-in, sign-up or sign-out control inside <main>", async () => {
    for (const { path, heading } of PUBLIC_ROUTES) {
      const { container, unmount } = renderPublic(path, "signed-out");
      await screen.findByRole("heading", { level: 1, name: heading });

      const main = within(container).getByRole("main");
      expect(main.querySelector('a[href="/signup"]')).toBeNull();
      expect(
        main.textContent?.match(/\bSign out\b/) ?? null,
        `"${path}" must not render a sign-out control in page content`
      ).toBeNull();
      unmount();
    }
  });
});
