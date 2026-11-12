// Organization and publication settings (doc 07 §13): only the fields the product reads today. A publication's
// languages are what its stories may be written in (the story's language is checked against them; Word and news
// imports pick from them), and its timezone is the one ad cut-offs and layout run names are worked out in. Digit style
// and "approval before export" are not offered: nothing reads them yet. Billing is not here: the pilot is invoiced.
//
// Routes:
//   GET   /api/v1/orgs/:o/settings (org.settings: Owner, Admin) → OrgSettings
//   PATCH /api/v1/orgs/:o/settings OrgSettingsInput (org.settings) → OrgSettings; audited org.rename when it changed
//   POST  /api/v1/orgs/:o/publications NewPublication (org.settings) → 201 OrgSettings; audited org.publication_add.
//         400 when a publication of the organisation has that name (any case).
//   GET   /api/v1/orgs/:o/pubs/:p/settings (settings.view) → PublicationSettings
//   PATCH /api/v1/orgs/:o/pubs/:p/settings PublicationSettingsInput (settings.edit) → PublicationSettings; audited
//         publication.settings_edit ({fields}) when something changed.
// A name is one line of 1 to 200 characters (cleaned as the Desk cleans text); the primary language must be one of the
// languages; a timezone must be one the database knows (pg_timezone_names).
import { z } from "zod";

const Language = z.string().regex(/^[a-z]{2,3}$/);
const Languages = z.array(Language).min(1).max(8);
const Timezone = z.string().min(1).max(64);

export const PublicationSettings = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  languages: z.array(z.string()),
  primaryLanguage: z.string(),
  timezone: z.string(),
});
export type PublicationSettings = z.infer<typeof PublicationSettings>;

export const PublicationSettingsInput = z.strictObject({
  name: z.string().max(200).optional(),
  languages: Languages.optional(),
  primaryLanguage: Language.optional(),
  timezone: Timezone.optional(),
});
export type PublicationSettingsInput = z.infer<typeof PublicationSettingsInput>;

export const NewPublication = z.strictObject({
  name: z.string().max(200),
  languages: Languages,
  primaryLanguage: Language,
  timezone: Timezone.optional(),
});
export type NewPublication = z.infer<typeof NewPublication>;

export const OrgSettings = z.strictObject({
  name: z.string(),
  publications: z.array(PublicationSettings),
});
export type OrgSettings = z.infer<typeof OrgSettings>;

export const OrgSettingsInput = z.strictObject({ name: z.string().max(200) });
export type OrgSettingsInput = z.infer<typeof OrgSettingsInput>;
