/**
 * Narrow Vitest 5 type integration for @testing-library/jest-dom.
 *
 * jest-dom's own `@testing-library/jest-dom/vitest` entry point augments
 * `vitest`'s `Assertion<T>` interface, which conflicts with Vitest 5's
 * `Assertion<R, T>` signature (TS2428: "All declarations of 'Assertion'
 * must have identical type parameters"). That conflict is real and is
 * not solved by importing that entry point under Vitest 5.
 *
 * Vitest 5 exposes `Matchers<R, T>` as its intended matcher-extension
 * point instead of `Assertion`. This augmentation wires jest-dom's
 * matcher signatures onto `Matchers` so `skipLibCheck` is not needed
 * to silence the conflict. `T` (Vitest's received-value generic) maps
 * to jest-dom's second `TestingLibraryMatchers` parameter, which is the
 * received-value type in its own declarations; the first parameter is
 * an unused "expected" slot and is left as `unknown`.
 */
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<unknown, T> {}
}

export {};
