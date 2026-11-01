/**
 * Shared UI005 test helper.
 *
 * Renders the real route tree under a real `BrowserRouter`, so the public pages are exercised through the actual
 * shell, session provider, language and router. `language` chooses English or Marathi the way the language switch
 * does (the browser's remembered choice).
 */
import { BrowserRouter } from "react-router";
import { act, render } from "../../src/test/render.tsx";
import { AppRoutes as Ui004Routes } from "../../src/root/AppRoot.tsx";
import {
  createMockApplicationEnvironment,
  type MockApplicationEnvironment,
  type MockSessionPreset,
} from "../../src/mocks/index.ts";
import { LANGUAGE_STORAGE_KEY } from "../../src/i18n/index.ts";
import { text, type PublicLanguage } from "../../src/features/public/content.ts";

/** The five public pages, with the record holding each page's one `<h1>`. */
export const PUBLIC_PAGES = [
  { path: "/", headingId: "home-hero-title" },
  { path: "/features", headingId: "features-title" },
  { path: "/pricing", headingId: "pricing-title" },
  { path: "/security", headingId: "security-title" },
  { path: "/contact", headingId: "contact-title" },
] as const;

/** The pages with their English `<h1>`. */
export const PUBLIC_ROUTES = PUBLIC_PAGES.map((page) => ({ path: page.path, heading: text(page.headingId, "en") }));

export const LANGUAGES: readonly PublicLanguage[] = ["en", "mr"];

/**
 * Renders the app at `path`. `preset` selects the session state: the canonical default is signed in, so signed-out
 * cases must ask for it.
 */
export function renderPublic(path: string, preset?: MockSessionPreset, language: PublicLanguage = "en") {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  const environment = createMockApplicationEnvironment();
  if (preset) environment.sessionController.setPreset(preset);
  window.history.pushState(null, "", path);
  return {
    environment,
    ...render(
      <BrowserRouter>
        <Ui004Routes environment={environment} />
      </BrowserRouter>,
    ),
  };
}

/**
 * Waits until the rendered page has the contact form's answer (GET /api/v1/contact; the test double answers on a
 * later turn): the page asked first, so its answer is in once this second question's is.
 */
export async function contactAnswered(environment: MockApplicationEnvironment): Promise<void> {
  await act(async () => {
    await environment.contact.connection();
  });
}
