/**
 * Vitest setup — extends `expect` with jest-dom's DOM matchers.
 *
 * This uses `@testing-library/jest-dom/matchers` directly (not the
 * `@testing-library/jest-dom/vitest` entry point) because that entry
 * point's own type augmentation conflicts with Vitest 5's `Assertion`
 * signature. The corresponding types are supplied narrowly by
 * `./jest-dom-matchers.d.ts`, which augments Vitest 5's `Matchers`
 * extension point instead.
 */
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

/**
 * jsdom 30 does not implement `HTMLDialogElement.showModal`/`close`
 * (verified directly: both are `undefined` on the prototype). This
 * polyfill is installed globally, once, so every test that renders the
 * durable `Dialog` control — including tests that mount the full
 * showcase — gets consistent native-`<dialog>`-like behavior.
 *
 * `close()` dispatches a real `close` event, matching real browsers,
 * because `src/ui/controls/Dialog.tsx` listens for `close` to
 * resynchronize state if the dialog is ever closed by the user agent
 * without the component's own involvement (see its H-04 fix).
 */
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
