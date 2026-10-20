/**
 * The one reusable "not yet implemented" leaf (UI002 §7.4, §6.1).
 * Disposable: every future unit deletes its own call site and wires
 * real content into the same durable route instead of replacing this
 * component itself.
 *
 * A placeholder must never render a fabricated list, count, or status
 * value; present a disabled control that looks operable; claim data
 * was loaded/saved/generated/validated; or omit the "not yet
 * implemented" label.
 */
import { Stack } from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";

export interface PlaceholderScreenProps {
  title: string;
  owningUnit: string;
  description?: string;
}

export function PlaceholderScreen({ title, owningUnit, description }: PlaceholderScreenProps) {
  return (
    <Stack gap="4">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
        {title}
      </h1>
      <p className="pg-type-body">
        This surface is not yet implemented. It will be built in {owningUnit}.
      </p>
      {description && <p className="pg-type-body-small">{description}</p>}
    </Stack>
  );
}
