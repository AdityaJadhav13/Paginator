// The Desk's story bundle (tools/desk/CONTRACT.md §6, pageinator.story-bundle/1; docs/product/10-l2-newsroom-plan.md
// §5.2, §10 PR 24): what the desk asks for. The answer is the ZIP itself (application/zip, streamed).
import { z } from "zod";
import { StoryStatus } from "./stories.ts";

export const BUNDLE_FORMAT = "pageinator.story-bundle/1";

/** The stories of the edition to send: those in these states (Ready by default). */
export const DeskBundleRequest = z.strictObject({
  statuses: z.array(StoryStatus).min(1).max(7).optional(),
});
export type DeskBundleRequest = z.infer<typeof DeskBundleRequest>;
