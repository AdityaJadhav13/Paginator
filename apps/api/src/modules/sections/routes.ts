// A publication's sections (packages/contracts/src/sections.ts, whose header lists the routes and rules), under
// /api/v1/orgs/:o/pubs/:p/sections: listed with publication.view (stories and plans are filed under them), made, renamed, moved and archived with settings.edit
// (the Chief Editor; Owner and Admin hold every permission). Every change runs with the publication's sections locked,
// so two changes of the order take turns. Nothing is deleted.
import { SectionInput, SectionList, SectionPatch } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import {
  type SectionRow,
  createSection,
  listSections,
  lockSections,
  orderSections,
  sectionNamed,
  updateSection,
} from "../../db/sections.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf } from "../access/access.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE = "/api/v1/orgs/:o/pubs/:p/sections";
const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneId = z.strictObject({ o: z.string(), p: z.string(), id: z.string() });

const view = (row: SectionRow) => ({
  id: row.id,
  name: row.name,
  archived: row.archived_at !== null,
  stories: row.stories,
});
const list = async (tx: Tx, pub: string) => ({ items: (await listSections(tx, pub)).map(view) });

export const sectionRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  app.get(
    BASE,
    { config: { permission: "publication.view" }, schema: { params: Pub, response: { 200: SectionList } } },
    async (request) => database.withTenant(accessOf(request).tenant, (tx) => list(tx, request.params.p)),
  );

  app.post(
    BASE,
    {
      config: { permission: "settings.edit" },
      schema: { params: Pub, body: SectionInput, response: { 201: SectionList } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const { name } = request.body;
      const answer = await database.withTenant(access.tenant, async (tx) => {
        const rows = await lockSections(tx, pub);
        if (await sectionNamed(tx, pub, name)) throw new ApiError("section_exists");
        const inUse = rows.filter((row) => row.archived_at === null).length;
        const id = await createSection(tx, access.tenant, pub, name, inUse);
        await recordAudit(tx, access.tenant, {
          action: "section.create",
          targetType: "section",
          targetId: id,
          publicationId: pub,
          data: { name },
        });
        return list(tx, pub);
      });
      return reply.status(201).send(answer);
    },
  );

  app.patch(
    `${BASE}/:id`,
    {
      config: { permission: "settings.edit" },
      schema: { params: OneId, body: SectionPatch, response: { 200: SectionList } },
    },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      const input = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const rows = UUID.test(id) ? await lockSections(tx, pub) : [];
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new ApiError("not_found");
        const archived = input.archived ?? row.archived_at !== null;
        const name = input.name ?? row.name;
        if (!archived && (await sectionNamed(tx, pub, name, id))) throw new ApiError("section_exists");
        await updateSection(tx, pub, id, { name, archived });
        // the order of those in use: this one taken out, and put back at its place (brought back: last)
        const inUse = rows.filter((other) => other.archived_at === null && other.id !== id).map((other) => other.id);
        if (!archived) {
          const at =
            input.position ?? (row.archived_at === null ? rows.findIndex((other) => other.id === id) : inUse.length);
          inUse.splice(Math.min(at, inUse.length), 0, id);
        }
        await orderSections(tx, pub, inUse);
        await recordAudit(tx, access.tenant, {
          action: "section.edit",
          targetType: "section",
          targetId: id,
          publicationId: pub,
          data: { fields: Object.keys(input).filter((key) => !(archived && key === "position")) }, // an archived one has no place
        });
        return list(tx, pub);
      });
    },
  );
};
