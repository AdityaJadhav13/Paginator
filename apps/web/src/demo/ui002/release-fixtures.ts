import type { ReleaseFixtureLike } from "../../app/contracts/route-context.ts";

/**
 * UI002's sole remaining disposable route-context record.
 * This release-only fixture is intentionally not user, organization,
 * publication, edition, session, or production service data. UI021
 * owns its eventual replacement.
 */
export const RELEASE_FIXTURES: readonly ReleaseFixtureLike[] = [
  {
    id: "release-demo-001",
    publicationId: "pub-demo-pune-daily",
    label: "release-demo-001",
  },
];
