// A publication's sections (docs/product/10-l2-newsroom-plan.md §3.3; migration 2026_11_20_0001 app.section): the
// names a story, and an edition plan's page, are filed under, in the paper's order. A section is never deleted: one
// no longer used is archived (stories, plans and the Desk's bundles keep naming it), and can be brought back.
//
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET   sections (publication.view) → SectionList: the sections in use in their order, then the archived ones.
//   POST  sections SectionInput (settings.edit) → 201 SectionList: the new section last. 409 section_exists when one
//         in use has that name (any case).
//   PATCH sections/:id SectionPatch (settings.edit) → SectionList: renamed (409 section_exists as above), moved to
//         `position` among the sections in use (0 first; past the end is last), archived, or brought back (last).
// Audit: section.create ({name}), section.edit ({fields}: which changed).
import { z } from "zod";

export const Section = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  /** stories filed under it (any status) */
  stories: z.number().int().min(0),
});
export type Section = z.infer<typeof Section>;
export const SectionList = z.strictObject({ items: z.array(Section) });
export type SectionList = z.infer<typeof SectionList>;

const Name = z.string().trim().min(1).max(200);

export const SectionInput = z.strictObject({ name: Name });
export type SectionInput = z.infer<typeof SectionInput>;
export const SectionPatch = z
  .strictObject({
    name: Name.optional(),
    position: z.number().int().min(0).max(1000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { error: "change at least one field" });
export type SectionPatch = z.infer<typeof SectionPatch>;
