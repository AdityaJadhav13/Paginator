// Editions (docs/product/10-l2-newsroom-plan.md §1 L2.1 "minimal editions", §5.2): one a publication and date, made
// by the desk (edition.create), listed for whoever has edition.view, its folio changed and its date and pages corrected
// before release (edition.edit). A story is put in an edition, or taken out, by the story's own PATCH (editionId).
// Objects are strict, and responses are sent through these schemas.
import { z } from "zod";

/** A calendar date, YYYY-MM-DD, in the years the database takes. */
const EditionDate = z.iso
  .date()
  .refine((date) => date >= "2000-01-01" && date <= "2999-12-31", { error: "is not between 2000 and 2999" });
const Short = z.string().max(200);

export const EDITION_PAGES = [4, 8, 16] as const;
const Pages = z.union([z.literal(4), z.literal(8), z.literal(16)]);

/** POST …/editions: one a date (409 edition_exists, that edition as `current`). */
export const EditionInput = z.strictObject({
  date: EditionDate,
  pages: Pages,
  backPageAds: z.boolean().optional(),
  volume: Short.optional(),
  issue: Short.optional(),
  price: Short.optional(),
});
export type EditionInput = z.infer<typeof EditionInput>;

/** PATCH …/editions/:e (edition.edit, the whole cell only): a field left out stays, a field sent as it is changes
 * nothing. Audited (edition.edit) when one changes.
 * - The folio's volume, issue and price, each kept as the Desk keeps a short line. Page 1 prints the folio its PDF was
 *   made with: a change fails the release's folio check until page 1 prints it (Update text and save page 1, or lay
 *   out again).
 * - The date, pages and back-page ads, corrected: refused once the edition is released or archived (409
 *   edition_released), while a layout run is active (409 run_active, the run as `current`), and for a date another
 *   edition has (409 edition_exists, that edition as `current`). Every done layout of the edition is set aside
 *   (cancelled, its message m.run.editionChanged): lay it out again. Its ads follow: a placement no longer booked for
 *   the new date or no longer fitting the new plan's slots is taken out, slot artwork the new plan has no such slot for
 *   is cleared, and the new date's bookings are placed. The plan's pages past the new page count are emptied. */
export const EditionPatch = z.strictObject({
  date: EditionDate.optional(),
  pages: Pages.optional(),
  backPageAds: z.boolean().optional(),
  volume: Short.optional(),
  issue: Short.optional(),
  price: Short.optional(),
});
export type EditionPatch = z.infer<typeof EditionPatch>;

export const Edition = z.strictObject({
  id: z.uuid(),
  date: z.iso.date(),
  pages: z.number().int(),
  backPageAds: z.boolean(),
  volume: z.string(),
  issue: z.string(),
  price: z.string(),
  status: z.enum(["planning", "in_production", "preflight", "released", "archived"]),
  /** Its stories (not deleted): all, Ready (what "Send to the Desk" sends), and Spiked (never sent); null for a role
   * that sees none of the publication's stories (Advertising). */
  counts: z
    .strictObject({
      stories: z.number().int().min(0),
      ready: z.number().int().min(0),
      spiked: z.number().int().min(0),
    })
    .nullable(),
});
export type Edition = z.infer<typeof Edition>;

/** GET …/editions?from&to (both inclusive): newest first, at most 400. */
export const EditionQuery = z.strictObject({ from: EditionDate.optional(), to: EditionDate.optional() });
export const EditionList = z.strictObject({ items: z.array(Edition) });
export type EditionList = z.infer<typeof EditionList>;
