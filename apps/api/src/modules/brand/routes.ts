// Brand & masthead's routes (packages/contracts/src/brand.ts, whose header lists them and their rules), under
// /api/v1/orgs/:o/pubs/:p/brand. GET for anyone on the publication ("Create edition" fills in its defaults); PUT for
// brand.edit's whole cell, the publication locked while it reads and writes, audited (brand.set {fields}).
import { Brand, BrandInput } from "@pageinator/contracts";
import { DeskTextError, cleanText } from "@pageinator/desk-text";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import { newestFrontPage, readBrand, setEditionDefaults, setPublicationName } from "../../db/brand.ts";
import type { Database } from "../../db/pools.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf, auditRefusals, refused } from "../access/access.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const BASE = "/api/v1/orgs/:o/pubs/:p/brand";

/** A short line as the Desk keeps it (NFC, no control characters, trimmed), or 400. */
function line(value: string, field: string, max: number): string {
  try {
    return cleanText(value, field, max);
  } catch (error) {
    if (!(error instanceof DeskTextError)) throw error;
    throw new ApiError("invalid_request", [{ field: `body.${field}`, message: error.message }]);
  }
}

async function brandOf(tx: Tx, pub: string): Promise<Brand> {
  const row = await readBrand(tx, pub);
  if (!row) throw new ApiError("not_found");
  const front = await newestFrontPage(tx, pub);
  return {
    name: row.name,
    defaults: { volume: row.volume, price: row.price, nextIssue: row.next_issue },
    masthead: front
      ? {
          runId: front.run_id,
          editionId: front.edition_id,
          editionDate: front.edition_date,
          finishedAt: front.finished_at.toISOString(),
        }
      : null,
  };
}

export const brandRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  auditRefusals(app, database);

  app.get(
    BASE,
    { config: { permission: "publication.view" }, schema: { params: Pub, response: { 200: Brand } } },
    async (request) => {
      const access = accessOf(request);
      return database.withTenant(access.tenant, (tx) => brandOf(tx, request.params.p));
    },
  );

  app.put(
    BASE,
    { config: { permission: "brand.edit" }, schema: { params: Pub, body: BrandInput, response: { 200: Brand } } },
    async (request) => {
      const access = accessOf(request);
      if (access.reach !== "full") throw refused("brand.edit is the whole cell only");
      const pub = request.params.p;
      const input = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const now = await readBrand(tx, pub, true);
        if (!now) throw new ApiError("not_found");
        const name = input.name === undefined ? now.name : line(input.name, "name", 200);
        if (name === "" || name.includes("\n"))
          throw new ApiError("invalid_request", [{ field: "body.name", message: "must be one line, not empty" }]);
        const given = input.defaults ?? {};
        const defaults = {
          volume: given.volume === undefined ? now.volume : line(given.volume, "defaults.volume", 40),
          price: given.price === undefined ? now.price : line(given.price, "defaults.price", 40),
          nextIssue: given.nextIssue === undefined ? now.next_issue : given.nextIssue,
        };
        const fields = [
          ...(name !== now.name ? ["name"] : []),
          ...(defaults.volume !== now.volume ? ["volume"] : []),
          ...(defaults.price !== now.price ? ["price"] : []),
          ...(defaults.nextIssue !== now.next_issue ? ["nextIssue"] : []),
        ];
        if (fields.includes("name")) await setPublicationName(tx, pub, name);
        if (fields.some((field) => field !== "name")) await setEditionDefaults(tx, access.tenant, pub, defaults);
        if (fields.length > 0) {
          await recordAudit(tx, access.tenant, {
            action: "brand.set",
            targetType: "publication",
            targetId: pub,
            publicationId: pub,
            data: { fields },
          });
        }
        return brandOf(tx, pub);
      });
    },
  );
};
