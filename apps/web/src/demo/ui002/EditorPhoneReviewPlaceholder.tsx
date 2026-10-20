/**
 * The phone-width variant of the editor route (UI002 §10.2). Renders
 * at the exact same URL as the desktop `PlaceholderScreen`, but is a
 * genuinely different component — it never attempts to render, scale,
 * or simulate the desktop editor chrome (AC-26).
 */
import { Stack } from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";

export function EditorPhoneReviewPlaceholder() {
  return (
    <Stack gap="4">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
        Edition review
      </h1>
      <p className="pg-type-body">
        Full editing requires a larger screen. This device shows edition review only.
      </p>
      <p className="pg-type-body-small">
        The full editing surface will be built in UI015–018 and, per Phase 15, remains
        desktop-first even then.
      </p>
    </Stack>
  );
}
