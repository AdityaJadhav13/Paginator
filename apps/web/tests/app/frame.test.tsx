/**
 * The signed-in app's frame (src/app/AppFrame.tsx): the sidebar's groups, icons and current entry, its collapse
 * remembered on this device (and a browser that refuses storage), the account menu, the phone's sheet, the account
 * page in the same frame, and axe on each.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { SIDEBAR_STORAGE_KEY } from "../../src/app/AppFrame.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const STORIES = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/stories";
const ORG = "/org/org-demo-sahyadri";

beforeEach(resetBrowserState);
afterEach(() => vi.restoreAllMocks());

describe("Sidebar", () => {
  it("groups a publication's entries and the organisation's, each with its icon, the current one marked", async () => {
    const { container } = renderAuth(STORIES, { preset: "sahyadri-editor" });
    const nav = await screen.findByRole("navigation", { name: "Publication" });
    expect(within(nav).getByText("Publication")).toBeInTheDocument();
    expect(within(nav).getByText("Organization")).toBeInTheDocument();
    const stories = within(nav).getByRole("link", { name: "Stories" });
    expect(stories).toHaveAttribute("aria-current", "page");
    expect(stories.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(nav).getByRole("link", { name: "Editions" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Team" })).toHaveAttribute("href", "/org/org-demo-sahyadri/team");
    expect(container.querySelector(".pg-app")).not.toBeNull();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("marks Home only on the organisation's own page", async () => {
    renderAuth(ORG, { preset: "sahyadri-editor" });
    const nav = await screen.findByRole("navigation", { name: "Organization" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await userEvent.setup().click(within(nav).getByRole("link", { name: "Team" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
  });

  it("collapses to an icon rail, keeps each link's name, and remembers it on this device", async () => {
    const user = userEvent.setup();
    const first = renderAuth(STORIES, { preset: "sahyadri-editor" });
    await user.click(await screen.findByRole("button", { name: "Collapse navigation" }));
    expect(first.container.querySelector(".pg-app")).toHaveClass("pg-app--collapsed");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("1");
    const nav = screen.getByRole("navigation", { name: "Publication" });
    // the label stays the link's name; the tooltip says it too
    expect(within(nav).getByRole("link", { name: "Stories" })).toHaveAttribute("title", "Stories");
    first.unmount();

    const again = renderAuth(STORIES, { preset: "sahyadri-editor" });
    await screen.findByRole("button", { name: "Expand navigation" });
    expect(again.container.querySelector(".pg-app")).toHaveClass("pg-app--collapsed");
    await user.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(again.container.querySelector(".pg-app")).not.toHaveClass("pg-app--collapsed");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("0");
  });

  it("still collapses when the browser refuses storage", async () => {
    const user = userEvent.setup();
    const { container } = renderAuth(STORIES, { preset: "sahyadri-editor" });
    await screen.findByRole("button", { name: "Collapse navigation" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    await user.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(container.querySelector(".pg-app")).toHaveClass("pg-app--collapsed");
  });
});

describe("Account menu", () => {
  it("names the person, opens with their name, email and role, and its links", async () => {
    const user = userEvent.setup();
    const { container } = renderAuth(STORIES, { preset: "sahyadri-editor" });
    const button = await screen.findByRole("button", { name: /^Account: / });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Account security" })).not.toBeInTheDocument();
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(within(panel).getByRole("link", { name: "Account security" })).toHaveAttribute("href", "/account/security");
    expect(within(panel).getByRole("link", { name: "Back to public site" })).toHaveAttribute("href", "/");
    expect(within(panel).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("closes on Esc, returning focus to its button, and on a click outside", async () => {
    const user = userEvent.setup();
    renderAuth(STORIES, { preset: "sahyadri-editor" });
    const button = await screen.findByRole("button", { name: /^Account: / });
    await user.click(button);
    await user.tab();
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole("heading", { level: 1, name: "Stories" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when Tab moves focus out of it, not when focus moves within it", async () => {
    const user = userEvent.setup();
    renderAuth(STORIES, { preset: "sahyadri-editor" });
    const button = await screen.findByRole("button", { name: /^Account: / });
    await user.click(button);
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    const signOut = within(panel).getByRole("button", { name: "Sign out" });
    signOut.focus();
    await user.tab();
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    within(panel).getByRole("link", { name: "Account security" }).focus();
    await user.tab();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("goes to Account security, which opens in the same frame", async () => {
    const user = userEvent.setup();
    renderAuth(STORIES, { preset: "sahyadri-editor" });
    await user.click(await screen.findByRole("button", { name: /^Account: / }));
    await user.click(screen.getByRole("link", { name: "Account security" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Account security" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Organization" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Account: / })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("The phone's sheet", () => {
  it("opens from the menu button, moves focus in, and Esc or its close button returns focus", async () => {
    const user = userEvent.setup();
    renderAuth(STORIES, { preset: "sahyadri-editor" });
    const toggle = await screen.findByRole("button", { name: "Show Publication navigation" });
    const nav = screen.getByRole("navigation", { name: "Publication" });
    expect(toggle).toHaveAttribute("aria-controls", nav.id);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide Publication navigation");
    expect(nav).toHaveClass("pg-app__sidebar--open");
    expect(within(nav).getAllByRole("link")[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();

    await user.click(toggle);
    // modal: the top bar and the page behind the scrim are inert while the sheet is open
    expect(document.querySelector(".pg-app__topbar")).toHaveAttribute("inert");
    expect(screen.getByRole("main", { hidden: true })).toHaveAttribute("inert");
    await user.click(within(nav).getByRole("button", { name: "Close navigation" }));
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("closes when a page is chosen", async () => {
    const user = userEvent.setup();
    renderAuth(STORIES, { preset: "sahyadri-editor" });
    await user.click(await screen.findByRole("button", { name: "Show Publication navigation" }));
    const nav = screen.getByRole("navigation", { name: "Publication" });
    await user.click(within(nav).getByRole("link", { name: "Editions" }));
    expect(await screen.findByRole("button", { name: "Show Publication navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("In Marathi", () => {
  it("names the frame's own controls in Marathi", async () => {
    renderAuth(STORIES, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("button", { name: "मेनू लहान करा" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^खाते: / })).toBeInTheDocument();
  });
});
