/**
 * Picks the phone-vs-desktop editor content at render time (UI002
 * §10.2, AC-25). Both variants are reached by the identical URL —
 * only the rendered component differs by viewport, using the durable
 * `useIsPhoneViewport` hook.
 */
import { useIsPhoneViewport } from "../../app/useViewport.ts";
import { OWNING_UNIT, ROUTE_LABELS } from "../../app/routes.ts";
import { PlaceholderScreen } from "./PlaceholderScreen.tsx";
import { EditorPhoneReviewPlaceholder } from "./EditorPhoneReviewPlaceholder.tsx";

export function EditorRouteContent() {
  const isPhone = useIsPhoneViewport();
  if (isPhone) {
    return <EditorPhoneReviewPlaceholder />;
  }
  return (
    <PlaceholderScreen title={ROUTE_LABELS.editionEditor} owningUnit={OWNING_UNIT.editionEditor} />
  );
}
