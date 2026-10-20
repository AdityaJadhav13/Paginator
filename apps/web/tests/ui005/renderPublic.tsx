/**
 * Shared UI005 test helper.
 *
 * Renders the real route tree under a real `BrowserRouter`, the same way
 * UI002's helper does, so the public surfaces are exercised through the
 * actual shell, session provider and router rather than in isolation.
 */
import { BrowserRouter } from "react-router";
import { render } from "../../src/test/render.tsx";
import { AppRoutes as Ui004Routes } from "../../src/root/AppRoot.tsx";
import {
  createMockApplicationEnvironment,
  type MockSessionPreset,
} from "../../src/mocks/index.ts";

/** The five routes UI005 owns, with the exact `<h1>` each must render. */
export const PUBLIC_ROUTES = [
  { path: "/", heading: "Newspaper production, end to end" },
  { path: "/features", heading: "What Pageinator is being built to do" },
  { path: "/pricing", heading: "Illustrative packaging" },
  { path: "/security", heading: "Security posture and current limits" },
  { path: "/contact", heading: "Contact" },
] as const;

/**
 * Renders the app at `path`. `preset` selects the session state: the
 * canonical default is signed in, so signed-out cases must ask for it.
 */
export function renderPublic(path: string, preset?: MockSessionPreset) {
  const environment = createMockApplicationEnvironment();
  if (preset) environment.sessionController.setPreset(preset);
  window.history.pushState(null, "", path);
  return {
    environment,
    ...render(
      <BrowserRouter>
        <Ui004Routes environment={environment} />
      </BrowserRouter>
    ),
  };
}
