/** Shared helpers for the sign-in screens' tests: render on the test double, in a chosen language, and run axe. */
import axe from "axe-core";
import { MemoryRouter, useLocation } from "react-router";
import { render } from "../../src/test/render.tsx";
import { AppRoutes } from "../../src/root/AppRoot.tsx";
import { LANGUAGE_STORAGE_KEY, type Language } from "../../src/i18n/index.ts";
import {
  createMockApplicationEnvironment,
  type MockApplicationEnvironment,
  type MockSessionPreset,
} from "../../src/mocks/index.ts";

export interface RenderAuthOptions {
  readonly preset?: MockSessionPreset;
  readonly language?: Language;
  readonly environment?: MockApplicationEnvironment;
  /** React Router's state for the first entry (what a screen passes when it sends a person here). */
  readonly state?: unknown;
}

/** The current location, written into the page so tests can read where the app went. */
function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location" hidden>
      {JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state ?? null })}
    </output>
  );
}

export function renderAuth(path: string, options: RenderAuthOptions = {}) {
  const environment = options.environment ?? createMockApplicationEnvironment();
  if (options.preset) environment.sessionController.setPreset(options.preset);
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, options.language ?? "en");
  const [rest, hash = ""] = path.split("#");
  const [pathname, search = ""] = rest!.split("?");
  const view = render(
    <MemoryRouter useTransitions={false} initialEntries={[{ pathname: pathname!, search: search ? `?${search}` : "", hash: hash ? `#${hash}` : "", state: options.state ?? null }]}>
      <AppRoutes environment={environment} />
      <LocationProbe />
    </MemoryRouter>
  );
  return { environment, ...view };
}

export function currentLocation(container: HTMLElement): { pathname: string; search: string; state: unknown } {
  const probe = container.ownerDocument.querySelector('[data-testid="location"]');
  return JSON.parse(probe?.textContent ?? "{}") as { pathname: string; search: string; state: unknown };
}

export async function seriousViolations(container: HTMLElement) {
  // jsdom cannot compute colours; contrast is the tokens' own tested pairs (tests/ui001)
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(" | ")}`);
}

export function resetBrowserState() {
  window.localStorage.clear();
  document.documentElement.lang = "en";
}
