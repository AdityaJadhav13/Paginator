/**
 * Responsive behavior tests (UI002 §10, §14; AC-25, AC-26, AC-27).
 *
 * `window.matchMedia` is not implemented by jsdom, so it is mocked
 * per test via a small helper that reports the given width against
 * `useIsPhoneViewport`'s actual query string — this exercises the
 * real hook logic, not a hand-simulated substitute for it.
 *
 * The 320 CSS pixel horizontal-scroll requirement (AC-27, AC-28) and
 * the phone-width nav-disclosure CSS itself (§10.1) cannot be verified
 * here: jsdom has no layout engine and does not apply `shell.css`'s
 * media queries (confirmed directly — see accessibility.test.tsx and
 * keyboard.test.tsx's Tab-order test). Both were verified against the
 * real production build in a real browser during implementation:
 * `document.documentElement.scrollWidth` equalled `clientWidth` at
 * 320px in both LTR and RTL, and the disclosure toggle correctly
 * showed/hid the publication nav.
 */
import { afterEach, describe, it, expect } from "vitest";
import { screen } from "../../src/test/render.tsx";
import userEvent from "@testing-library/user-event";
import { PHONE_MEDIA_QUERY } from "../../src/app/useViewport.ts";
import { renderAt } from "./renderRoutes.tsx";

const EDITOR_PATH =
  "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor";

function mockViewportWidth(width: number) {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query: string) => {
    const isPhoneQuery = query === PHONE_MEDIA_QUERY;
    return {
      matches: isPhoneQuery ? width <= 767 : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

let restoreMatchMedia: (() => void) | undefined;

afterEach(() => {
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
});

describe("Editor route: phone vs. desktop content (AC-25, AC-26)", () => {
  it("desktop width (>=768px) renders the desktop placeholder", () => {
    restoreMatchMedia = mockViewportWidth(1280);
    renderAt(EDITOR_PATH);
    expect(screen.getByRole("heading", { level: 1, name: "Editor" })).toBeInTheDocument();
    expect(screen.queryByText(/Full editing requires a larger screen/)).not.toBeInTheDocument();
  });

  it("phone width (<768px) renders the phone review placeholder — a different component", () => {
    restoreMatchMedia = mockViewportWidth(375);
    renderAt(EDITOR_PATH);
    expect(screen.getByRole("heading", { level: 1, name: "Edition review" })).toBeInTheDocument();
    expect(
      screen.getByText("Full editing requires a larger screen. This device shows edition review only.")
    ).toBeInTheDocument();
  });

  it("both variants are reached by the identical URL", () => {
    restoreMatchMedia = mockViewportWidth(1280);
    const desktop = renderAt(EDITOR_PATH);
    expect(window.location.pathname).toBe(EDITOR_PATH);
    desktop.unmount();
    restoreMatchMedia();

    restoreMatchMedia = mockViewportWidth(375);
    renderAt(EDITOR_PATH);
    expect(window.location.pathname).toBe(EDITOR_PATH);
  });

  it("the phone variant never renders desktop editor chrome (no editing affordance)", () => {
    restoreMatchMedia = mockViewportWidth(375);
    renderAt(EDITOR_PATH);
    expect(screen.queryByRole("button", { name: /move|resize|zoom|select/i })).not.toBeInTheDocument();
  });

  it("the desktop variant makes no editing claim either (still a placeholder)", () => {
    restoreMatchMedia = mockViewportWidth(1280);
    renderAt(EDITOR_PATH);
    expect(screen.getByText(/not yet implemented/i)).toHaveTextContent("UI015–018");
  });
});

describe("Phone-width nav disclosure exists (§10.1) — structural check", () => {
  it("a disclosure toggle button is present in WorkspaceShell", () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    expect(
      screen.getByRole("button", { name: /(Show|Hide) Publication navigation/ })
    ).toBeInTheDocument();
  });

  it("toggling it changes its accessible name and aria-expanded state", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Show Publication navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Hide Publication navigation" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
});
