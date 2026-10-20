/**
 * Shared UI002 test helper. Renders the real route tree under a real
 * `BrowserRouter` (not `MemoryRouter`) so back/forward tests exercise
 * the actual `window.history` API `BrowserRouter` uses in production —
 * confirmed against a real browser build during implementation (a
 * plain CDP `Page.goBack` proved unreliable in headless Chrome, while
 * `history.back()`/`history.forward()` — the same calls a real back
 * button triggers — worked correctly; this helper uses that same,
 * verified-correct mechanism).
 */
import { BrowserRouter } from "react-router";
import { render } from "../../src/test/render.tsx";
import { Ui004Routes } from "../../src/demo/ui004/routeTree.tsx";

/** Renders the app with the browser at `path`, as a fresh deep link would. */
export function renderAt(path: string) {
  window.history.pushState(null, "", path);
  return render(
    <BrowserRouter>
      <Ui004Routes />
    </BrowserRouter>
  );
}
