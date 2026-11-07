/**
 * The language switch (03 §5.1; plan §10 PR 12): English or Marathi, remembered by this browser, with `<html lang>`
 * following the choice. The public pages exist in English only, so they keep `lang="en"` whatever the choice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { LANGUAGE_STORAGE_KEY, initialLanguage } from "../../src/i18n/index.ts";
import { renderUi004 } from "../ui004/renderUi004.tsx";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "en";
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "en";
  vi.restoreAllMocks();
});

describe("The interface language", () => {
  it("starts in English for an English browser, and says so on <html>", async () => {
    renderUi004("/login", "signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("starts in Marathi when the browser prefers it", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["mr-IN", "en"]);
    expect(initialLanguage()).toBe("mr");
  });

  it("switches to Marathi from the sign-in screen, remembers it, and sets <html lang>", async () => {
    const view = renderUi004("/login", "signed-out");
    const group = await screen.findByRole("group", { name: "Language" });
    const english = within(group).getByRole("button", { name: "English" });
    const marathi = within(group).getByRole("button", { name: "मराठी" });
    expect(english).toHaveAttribute("lang", "en");
    expect(marathi).toHaveAttribute("lang", "mr");
    expect(english).toHaveAttribute("aria-pressed", "true");
    expect(marathi).toHaveAttribute("aria-pressed", "false");

    await userEvent.setup().click(marathi);
    expect(await screen.findByRole("heading", { level: 1, name: "प्रवेश" })).toBeInTheDocument();
    expect(screen.getByLabelText("ईमेल पत्ता")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "प्रवेश करा" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "भाषा" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("mr");
    expect(view.container.querySelector(".pg-shell--auth")).toHaveAttribute("lang", "mr");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("mr");
  });

  it("opens in the remembered language on the next visit", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "mr");
    renderUi004("/forgot-password", "signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "पासवर्ड विसरलात?" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("mr");
  });

  it("switches back to English", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "mr");
    renderUi004("/login", "signed-out");
    await userEvent.setup().click(await screen.findByRole("button", { name: "English" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
  });

  it("shows the public pages in Marathi, marked Marathi, when Marathi is chosen", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "mr");
    const view = renderUi004("/security", "signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "सुरक्षा, गोपनीयता आणि सध्याच्या मर्यादा" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("mr");
    expect(view.container.querySelector(".pg-shell--public")).toHaveAttribute("lang", "mr");
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "प्रवेश करा" })).toHaveAttribute("href", "/login");
  });

  it("switches a public page to English from its header, and remembers it", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "mr");
    const view = renderUi004("/", "signed-out");
    await screen.findByRole("heading", { level: 1, name: "अंकनिर्मिती, सर्वप्रथम मराठी वृत्तपत्रांसाठी घडवलेली" });
    await userEvent.setup().click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Newspaper production, built first for Marathi papers" })).toBeInTheDocument();
    expect(view.container.querySelector(".pg-shell--public")).toHaveAttribute("lang", "en");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
  });

  it("ignores a stored value that is not a language", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    expect(initialLanguage()).toBe("en");
  });

  it("still works when the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    renderUi004("/login", "signed-out");
    await userEvent.setup().click(await screen.findByRole("button", { name: "मराठी" }));
    expect(await screen.findByRole("heading", { level: 1, name: "प्रवेश" })).toBeInTheDocument();
  });
});
