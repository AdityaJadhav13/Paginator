/**
 * The product's router shows the new screen as soon as the address changes. Wrapped in a React transition (React
 * Router's default), the old screen stayed on screen and took input for a moment after a link click: an email typed
 * then went into the sign-in form's field, and the forgot-password form that replaced it was empty.
 */
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../../src/test/render.tsx";
import { AppRoot } from "../../src/root/AppRoot.tsx";
import { resetBrowserState } from "./helpers.tsx";
import { LANGUAGE_STORAGE_KEY } from "../../src/i18n/index.ts";

vi.mock("../../src/api/environment.ts", async () => {
  const { createMockApplicationEnvironment } = await import("../../src/mocks/index.ts");
  return {
    createApiEnvironment: () => {
      const environment = createMockApplicationEnvironment();
      environment.sessionController.setPreset("signed-out");
      return environment;
    },
  };
});

afterEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/");
  resetBrowserState();
});

it("shows the forgot-password screen in the same task as the link click", async () => {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
  window.history.replaceState(null, "", "/login");
  render(<AppRoot />);
  const link = await screen.findByRole("link", { name: "Forgot your password?" });

  // a real click, outside act(): what a person (or autofill) meets right after it
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  link.click();
  await Promise.resolve();
  expect(window.location.pathname).toBe("/forgot-password");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Forgot your password?");
  await waitFor(() => expect(screen.getByRole("button", { name: "Send link" })).toBeInTheDocument());
});
