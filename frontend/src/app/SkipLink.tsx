/**
 * "Skip to main content" link — the first focusable element in every
 * shell (UI002 §7.6, AC-15). Visually hidden until focused, unlike
 * UI001's `VisuallyHidden` (which hides unconditionally): a skip link
 * must become visible for a sighted keyboard user tabbing through it.
 * See `.pg-skip-link` in `shell.css`.
 */
import { MAIN_LANDMARK_ID } from "./routes.ts";

export function SkipLink() {
  return (
    <a href={`#${MAIN_LANDMARK_ID}`} className="pg-skip-link">
      Skip to main content
    </a>
  );
}
