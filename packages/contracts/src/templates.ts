// Templates (docs/product/04 §7.8; docs/product/10-l2-newsroom-plan.md §1 "As built (screens)"): the page templates
// the engine profile in use lays pages out with, one per role (front, inside_imprint = page 2 with the imprint,
// inside, back), each chosen from the dataset's own pages that can serve that role (the engine's setup test). Choosing
// another makes a NEW profile version from the one in use (same dataset bundle, copied server side), set up again by
// the engine (engine.setup with a base and the choice: its `retemplate` re-checks the page), so the next layout uses
// it. Editions keep the profile version their run pinned (layout_run.profile_id). Only the template choice is
// editable in this engine: the grid is shown read-only; styles, swatches, a grid editor and house rules are not.
//
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET  templates (templates.view) → TemplatesView.
//   POST templates TemplateChoiceInput (templates.edit, Idempotency-Key) → 202 EngineProfile (setting_up). {role, page}
//        uses that page for that role; {} checks the dataset again (the candidates found anew, the choice kept).
//        409 no_profile (none ready), 409 profile_setting_up (one is being set up already: one at a time), 400
//        invalid_request when the page is not one of the role's candidates (the engine re-checks it as well).
// Audit: engine_profile.retemplate ({profile, basedOn, version, role, page}).
import { z } from "zod";

import { EngineProfile, TemplateRole } from "./layout.ts";

// the engine's side of templates (layout.ts), exported from here: index.ts names layout.ts's exports one by one
export { TEMPLATE_ROLES, TemplateCandidates, TemplateOutline, TemplateRole } from "./layout.ts";

const Id = z.uuid();
const Box = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** A template page's outline as the engine reads it (layout.ts TemplateOutline), in mm. Never the printed page. */
export const Outline = z.strictObject({
  pageWMm: z.number(),
  pageHMm: z.number(),
  news: z.array(Box),
  kept: z.array(z.strictObject({ kind: z.string(), box: Box })),
  adSlots: z.array(Box),
});
export type Outline = z.infer<typeof Outline>;

export const TemplateCandidate = z.strictObject({
  name: z.string(),
  /** the printed day of the page (null: the dataset does not say) */
  date: z.iso.date().nullable(),
  page: z.number().int(),
  outline: Outline,
});
export type TemplateCandidate = z.infer<typeof TemplateCandidate>;

export const RoleTemplates = z.strictObject({
  role: TemplateRole,
  /** the page model the profile in use lays this role out with */
  chosen: z.string().nullable(),
  /** the pages of the dataset able to serve this role, newest design first (the chosen one among them) */
  candidates: z.array(TemplateCandidate),
});
export type RoleTemplates = z.infer<typeof RoleTemplates>;

export const TemplatesView = z.strictObject({
  /** the profile in use (the newest ready one); null: none ready */
  inUse: z.strictObject({ id: Id, version: z.number().int() }).nullable(),
  /** per role, in TEMPLATE_ROLES order; empty without a profile in use */
  roles: z.array(RoleTemplates),
  /** false: the profile in use was set up before candidates were recorded (POST {} finds them) */
  candidatesKnown: z.boolean(),
  grid: z.strictObject({ columns: z.number().int(), columnMm: z.number(), gutterMm: z.number() }).nullable(),
  /** a profile being set up now (a new choice waits for it) */
  settingUp: z.strictObject({ id: Id, version: z.number().int() }).nullable(),
  /** the profile versions, newest first (at most 20) */
  history: z.array(EngineProfile),
});
export type TemplatesView = z.infer<typeof TemplatesView>;

export const TemplateChoiceInput = z
  .strictObject({ role: TemplateRole.optional(), page: z.string().min(1).max(400).optional() })
  .refine((c) => (c.role === undefined) === (c.page === undefined), {
    message: "role and page go together ({} checks the dataset again)",
  });
export type TemplateChoiceInput = z.infer<typeof TemplateChoiceInput>;
