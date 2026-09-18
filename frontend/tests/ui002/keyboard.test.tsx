/**
 * Keyboard navigation and focus-after-navigation tests (UI002 §7.6,
 * §14; AC-15, AC-16, AC-29).
 */
import { describe, it, expect } from "vitest";
import { StrictMode } from "react";
import { BrowserRouter } from "react-router";
import { render, screen } from "../../src/test/render.tsx";
import userEvent from "@testing-library/user-event";
import { Ui004Routes } from "../../src/demo/ui004/routeTree.tsx";
import { renderAt } from "./renderRoutes.tsx";

describe("Skip link (AC-15)", () => {
  it("is the first Tab stop and targets a focusable <main>", async () => {
    // jsdom does not implement the browser's fragment-navigation focus
    // algorithm for `href="#id"` links (activating one does not move
    // focus the way a real browser does), so the full "activation
    // moves focus into <main>" behavior was verified directly against
    // a real Chrome build during implementation. What jsdom *can*
    // verify — and what makes that browser behavior possible at all —
    // is checked here: the skip link is the first Tab stop, its href
    // targets the main landmark's id, and that landmark carries
    // `tabIndex={-1}` so a browser's fragment navigation can focus it.
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toHaveClass("pg-skip-link");
    expect(document.activeElement).toHaveTextContent("Skip to main content");

    const targetId = (document.activeElement as HTMLAnchorElement).getAttribute("href")?.slice(1);
    expect(targetId).toBeTruthy();
    const main = document.getElementById(targetId!);
    expect(main?.tagName).toBe("MAIN");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("is present and first in every shell", async () => {
    for (const path of [
      "/",
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview",
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor",
    ]) {
      const { unmount } = renderAt(path);
      const user = userEvent.setup();
      await user.tab();
      expect(document.activeElement).toHaveClass("pg-skip-link");
      unmount();
    }
  });
});

describe("Tab order (AC-29)", () => {
  it("has no positive tabindex anywhere in a workspace page", () => {
    const { container } = renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    const positiveTabIndex = Array.from(container.querySelectorAll("[tabindex]")).filter(
      (el) => Number(el.getAttribute("tabindex")) > 0
    );
    expect(positiveTabIndex).toHaveLength(0);
  });

  it("places the skip link first and the breadcrumb after the rest of the header", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    const user = userEvent.setup();

    // jsdom does not apply shell.css (CSS is not resolved in this test
    // environment — the same limitation noted in UI001's own tests),
    // so the phone-width nav-disclosure toggle and its collapsed nav
    // are both tabbable here even though a real browser hides them at
    // desktop width. Budget enough Tab presses to clear the full
    // publication nav (12 links) plus the header controls before it.
    const order: Element[] = [];
    for (let i = 0; i < 28; i++) {
      await user.tab();
      const active = document.activeElement;
      if (!active) break;
      order.push(active);
    }

    const breadcrumbNav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const firstBreadcrumbLink = breadcrumbNav.querySelector("a")!;

    const skipLinkIndex = order.findIndex((el) => el.classList.contains("pg-skip-link"));
    const breadcrumbIndex = order.indexOf(firstBreadcrumbLink);

    // Skip link is the very first stop; the breadcrumb (last item in
    // the header, per §7.2's header/nav/breadcrumb structure) comes
    // later — position is verified rather than the exact set of
    // elements in between, since the header's exact control layout is
    // an implementation detail.
    expect(skipLinkIndex).toBe(0);
    expect(breadcrumbIndex).toBeGreaterThan(skipLinkIndex);
  });
});

describe("Focus after navigation (AC-16)", () => {
  it("moves focus to the new page heading and announces its title", async () => {
    renderAt("/");
    const user = userEvent.setup();

    await user.click(screen.getByRole("link", { name: "Pricing" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "Pricing" });
    expect(document.activeElement).toBe(heading);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("Pricing");
  });

  it("stays silent on initial load under the application's StrictMode root, then announces navigation", async () => {
    window.history.pushState(null, "", "/security");
    render(
      <StrictMode>
        <BrowserRouter>
          <Ui004Routes />
        </BrowserRouter>
      </StrictMode>
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("");
    expect(document.activeElement).not.toBe(
      screen.getByRole("heading", { level: 1, name: "Security" })
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Pricing" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Pricing" });
    expect(document.activeElement).toBe(heading);
    expect(liveRegion).toHaveTextContent("Pricing");
  });
});

describe("Workspace exit navigation (§7.2)", () => {
  it("exposes a keyboard-operable Back to public site link to the public home route", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    const user = userEvent.setup();
    const link = await screen.findByRole("link", { name: "Back to public site" });
    expect(link).toHaveAttribute("href", "/");

    link.focus();
    await user.keyboard("{Enter}");

    expect(window.location.pathname).toBe("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toHaveFocus();
  });
});

describe("Organization/publication switchers are keyboard-operable (§7.2)", () => {
  it("changing the publication select navigates via keyboard interaction alone", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    const user = userEvent.setup();

    // getByLabelText would also match the <nav aria-label="Publication">
    // landmark, not just the <select>'s <label> — disambiguate via role.
    const publicationSelect = await screen.findByRole("combobox", { name: "Publication" });
    publicationSelect.focus();
    await user.selectOptions(publicationSelect, "Deccan Evening Record");

    expect(window.location.pathname).toBe(
      "/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/overview"
    );
  });
});
