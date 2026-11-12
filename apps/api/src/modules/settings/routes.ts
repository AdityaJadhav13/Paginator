// Organization and publication settings (packages/contracts/src/settings.ts, whose header lists the routes and rules).
// The organisation's name is Better Auth's (identity.organization, which pgn_app cannot read): it is read and written
// through Better Auth's adapter, with the audit row written first in the tenant's transaction, so a failed rename
// rolls its audit row back. Publications are app.publication rows under the organisation wall; adding one locks the
// organisation's settings row, so two adds take turns (the name check and the slug pick hold).
import {
  NewPublication,
  OrgSettings,
  OrgSettingsInput,
  PublicationSettings,
  PublicationSettingsInput,
} from "@pageinator/contracts";
import { DeskTextError, cleanText } from "@pageinator/desk-text";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import { publicationNamed, timezoneKnown } from "../../db/settings.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf } from "../access/access.ts";
import type { Auth } from "../identity/auth.ts";

const Org = z.strictObject({ o: z.string() });
const Pub = z.strictObject({ o: z.string(), p: z.string() });
const COLUMNS = ["id", "name", "languages", "primary_language", "timezone"] as const;

const invalid = (field: string, message: string) =>
  new ApiError("invalid_request", [{ field: `body.${field}`, message }]);

/** A name as the Desk keeps it (NFC, no control characters, trimmed), one line of 1 to 200 characters, or 400. */
function nameOf(value: string, field = "name"): string {
  let name: string;
  try {
    name = cleanText(value, field, 200);
  } catch (error) {
    if (!(error instanceof DeskTextError)) throw error;
    throw invalid(field, error.message);
  }
  if (name === "" || name.includes("\n")) throw invalid(field, "must be one line, not empty");
  return name;
}

/** The languages without repeats, with the primary among them (400 otherwise). */
function languagesOf(languages: readonly string[], primary: string): string[] {
  const unique = [...new Set(languages)];
  if (!unique.includes(primary)) throw invalid("primaryLanguage", "must be one of the languages");
  return unique;
}

async function checkTimezone(tx: Tx, timezone: string): Promise<void> {
  if (!(await timezoneKnown(tx, timezone))) throw invalid("timezone", "is not a timezone the database knows");
}

type PubRow = { id: string; name: string; languages: string[]; primary_language: string; timezone: string };
const view = (row: PubRow): PublicationSettings => ({
  id: row.id,
  name: row.name,
  languages: row.languages,
  primaryLanguage: row.primary_language,
  timezone: row.timezone,
});

const publications = async (tx: Tx) =>
  (await tx.selectFrom("app.publication").select(COLUMNS).orderBy("name").orderBy("id").execute()).map(view);

/** A slug from the name's Latin letters and digits ("publication" when it has none), made unique in the organisation. */
async function freeSlug(tx: Tx, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "publication";
  const taken = new Set((await tx.selectFrom("app.publication").select("slug").execute()).map((row) => row.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

export const settingsRoutes: FastifyPluginAsyncZod<{ auth: Auth; database: Database }> = async (
  app,
  { auth, database },
) => {
  const orgName = async (orgId: string): Promise<string> => {
    const context = await auth.$context;
    const org = await context.adapter.findOne<{ name: string }>({
      model: "organization",
      where: [{ field: "id", value: orgId }],
    });
    if (!org) throw new ApiError("not_found");
    return org.name;
  };
  const orgSettings = async (tx: Tx, orgId: string): Promise<OrgSettings> => ({
    name: await orgName(orgId),
    publications: await publications(tx),
  });

  app.get(
    "/api/v1/orgs/:o/settings",
    { config: { permission: "org.settings" }, schema: { params: Org, response: { 200: OrgSettings } } },
    async (request) => {
      const access = accessOf(request);
      return database.withTenant(access.tenant, (tx) => orgSettings(tx, access.tenant.orgId));
    },
  );

  app.patch(
    "/api/v1/orgs/:o/settings",
    {
      config: { permission: "org.settings" },
      schema: { params: Org, body: OrgSettingsInput, response: { 200: OrgSettings } },
    },
    async (request) => {
      const access = accessOf(request);
      const orgId = access.tenant.orgId;
      const name = nameOf(request.body.name);
      return database.withTenant(access.tenant, async (tx) => {
        // the settings row locked: two renames take turns
        await tx.selectFrom("app.org_settings").select("org_id").forUpdate().execute();
        if (name !== (await orgName(orgId))) {
          await recordAudit(tx, access.tenant, {
            action: "org.rename",
            targetType: "organization",
            targetId: orgId,
            data: { fields: ["name"] },
          });
          const context = await auth.$context;
          await context.adapter.update({
            model: "organization",
            where: [{ field: "id", value: orgId }],
            update: { name },
          });
        }
        return orgSettings(tx, orgId);
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/publications",
    {
      config: { permission: "org.settings" },
      schema: { params: Org, body: NewPublication, response: { 201: OrgSettings } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const input = request.body;
      const name = nameOf(input.name);
      const languages = languagesOf(input.languages, input.primaryLanguage);
      const answer = await database.withTenant(access.tenant, async (tx) => {
        await tx.selectFrom("app.org_settings").select("org_id").forUpdate().execute();
        if (await publicationNamed(tx, name)) throw invalid("name", "a publication of the organisation has this name");
        if (input.timezone !== undefined) await checkTimezone(tx, input.timezone);
        const { id } = await tx
          .insertInto("app.publication")
          .values({
            org_id: access.tenant.orgId,
            name,
            slug: await freeSlug(tx, name),
            languages,
            primary_language: input.primaryLanguage,
            // shortcut: digit style is not a setting yet (nothing reads it); upgrade when page numbers follow it
            digit_style: input.primaryLanguage === "en" ? "latin" : "devanagari",
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await recordAudit(tx, access.tenant, {
          action: "org.publication_add",
          targetType: "publication",
          targetId: id,
          publicationId: id,
          data: { publication: id },
        });
        return orgSettings(tx, access.tenant.orgId);
      });
      return reply.status(201).send(answer);
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/settings",
    { config: { permission: "settings.view" }, schema: { params: Pub, response: { 200: PublicationSettings } } },
    async (request) => {
      const access = accessOf(request);
      return database.withTenant(access.tenant, async (tx) => {
        const row = await tx
          .selectFrom("app.publication")
          .select(COLUMNS)
          .where("id", "=", request.params.p)
          .executeTakeFirst();
        if (!row) throw new ApiError("not_found");
        return view(row);
      });
    },
  );

  app.patch(
    "/api/v1/orgs/:o/pubs/:p/settings",
    {
      config: { permission: "settings.edit" },
      schema: { params: Pub, body: PublicationSettingsInput, response: { 200: PublicationSettings } },
    },
    async (request) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const input = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const now = await tx
          .selectFrom("app.publication")
          .select(COLUMNS)
          .where("id", "=", pub)
          .forUpdate()
          .executeTakeFirst();
        if (!now) throw new ApiError("not_found");
        const name = input.name === undefined ? now.name : nameOf(input.name);
        const primary = input.primaryLanguage ?? now.primary_language;
        const languages = languagesOf(input.languages ?? now.languages, primary);
        const timezone = input.timezone ?? now.timezone;
        if (timezone !== now.timezone) await checkTimezone(tx, timezone);
        if (name !== now.name) {
          if (await publicationNamed(tx, name, pub))
            throw invalid("name", "a publication of the organisation has this name");
        }
        const fields = [
          ...(name !== now.name ? ["name"] : []),
          ...(languages.join() !== now.languages.join() ? ["languages"] : []),
          ...(primary !== now.primary_language ? ["primaryLanguage"] : []),
          ...(timezone !== now.timezone ? ["timezone"] : []),
        ];
        if (fields.length === 0) return view(now);
        const row = await tx
          .updateTable("app.publication")
          .set({ name, languages, primary_language: primary, timezone })
          .where("id", "=", pub)
          .returning(COLUMNS)
          .executeTakeFirstOrThrow();
        await recordAudit(tx, access.tenant, {
          action: "publication.settings_edit",
          targetType: "publication",
          targetId: pub,
          publicationId: pub,
          data: { fields },
        });
        return view(row);
      });
    },
  );
};
