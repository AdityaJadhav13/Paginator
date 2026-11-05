// Print profiles' routes (packages/contracts/src/print-profiles.ts, whose header lists them), under
// /api/v1/orgs/:o/pubs/:p, registered inside releaseRoutes (a release pins the version in use: db/release.ts).
import { ARTWORK_MIN_PPI, PrintProfile, PrintProfileInput, PrintProfiles } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import {
  type PrintProfileRow,
  addPrintProfile,
  pressFactsOf,
  printProfile,
  printProfiles,
} from "../../db/print-profiles.ts";
import type { Tx } from "../../db/tenant.ts";
import { accessOf } from "../access/access.ts";
import { MIN_PPI } from "../media/library.ts";
import { idempotent } from "../requests/idempotency.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });

const view = (row: PrintProfileRow): PrintProfile => ({
  id: row.id,
  version: row.version,
  pressName: row.press_name,
  contact: row.contact,
  note: row.note,
  createdBy: { id: row.created_by, name: row.created_name },
  createdAt: row.created_at.toISOString(),
});

async function viewOf(tx: Tx, pub: string, id: string): Promise<PrintProfile | null> {
  const row = await printProfile(tx, pub, id);
  return row ? view(row) : null;
}

export const printProfileRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  app.get(
    "/api/v1/orgs/:o/pubs/:p/print-profiles",
    { config: { permission: "print_profiles.view" }, schema: { params: Pub, response: { 200: PrintProfiles } } },
    async (request) => {
      const pub = request.params.p;
      return database.withTenant(accessOf(request).tenant, async (tx) => {
        const facts = await pressFactsOf(tx, pub);
        return {
          items: (await printProfiles(tx, pub)).map(view),
          facts: {
            engineProfileVersion: facts.version,
            trim:
              facts.page_w_mm !== null && facts.page_h_mm !== null && facts.page_w_mm > 0 && facts.page_h_mm > 0
                ? { wMm: facts.page_w_mm, hMm: facts.page_h_mm }
                : null,
            pdfStandard: "PDF/X-1a" as const,
            checkerSha256: facts.checker_sha256,
            iccSha256: facts.icc_sha256,
            adMinPpi: ARTWORK_MIN_PPI,
            photoSharpPpi: MIN_PPI,
            delivery: "download" as const,
          },
        };
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/print-profiles",
    {
      config: { permission: "print_profiles.edit" },
      schema: { params: Pub, body: PrintProfileInput, response: { 201: PrintProfile } },
    },
    async (request, reply) => {
      const tenant = accessOf(request).tenant;
      const pub = request.params.p;
      const { pressName, contact, note } = request.body;
      const answer = await idempotent(
        database,
        request,
        tenant,
        async (tx) => {
          const id = await addPrintProfile(tx, tenant, pub, {
            pressName,
            contact: contact || null,
            note: note || null,
          });
          const made = await viewOf(tx, pub, id);
          if (!made) throw new Error("the print profile just made is not found");
          await recordAudit(tx, tenant, {
            action: "print_profile.create",
            targetType: "print_profile",
            targetId: id,
            publicationId: pub,
            data: { version: made.version },
          });
          return { status: 201, body: made, stored: { id } };
        },
        (stored, tx) => viewOf(tx, pub, (stored as { id: string }).id),
      );
      return reply.status(201).send(answer.body as PrintProfile);
    },
  );
};
