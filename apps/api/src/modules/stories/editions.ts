// Editions (docs/product/10-l2-newsroom-plan.md §1 L2.1 "minimal editions", §5.2), under /api/v1/orgs/:o/pubs/:p/editions:
//   - GET lists the publication's editions, newest first, with their stories counted (edition.view); counts are null
//     for a role that sees no stories (storyScope "none", such as Advertising);
//   - POST makes one (edition.create, the whole cell only: Advertising's and Prepress's ◐ are their ad positions and
//     colour map, 07 §12, not a new edition), with an Idempotency-Key; a date that has one already answers 409
//     edition_exists with that edition as `current`. Audited (edition.create) in the change's transaction; the database
//     tells other tabs (live event `edition`, migration 2026_11_28_0001).
// A story is put in an edition, or taken out, by the story's own PATCH (editionId; the desk's, story.edition_change).
import { Edition, EditionInput, EditionList, EditionQuery } from "@pageinator/contracts";
import { DeskTextError, cleanText } from "@pageinator/desk-text";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import { type EditionRow, createEdition, listEditions } from "../../db/editions.ts";
import type { Database } from "../../db/pools.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf, auditRefusals, refused } from "../access/access.ts";
import { idempotent } from "../requests/idempotency.ts";
import { storyScope } from "./rules.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const BASE = "/api/v1/orgs/:o/pubs/:p/editions";
/** More than a year of daily editions. */
const LIST_LIMIT = 400;

function view(row: EditionRow): Edition {
  return {
    id: row.id,
    date: row.date,
    pages: row.pages,
    backPageAds: row.back_page_ads,
    volume: row.volume,
    issue: row.issue,
    price: row.price,
    status: row.status,
    counts:
      row.stories === null || row.ready === null || row.spiked === null
        ? null
        : { stories: row.stories, ready: row.ready, spiked: row.spiked },
  };
}

async function one(tx: Tx, pub: string, id: string): Promise<Edition | null> {
  const [row] = await listEditions(tx, pub, { id }, 1);
  return row ? view(row) : null;
}

/** A short line as the Desk keeps it (NFC, no control characters, trimmed), or 400. */
function line(value: string | undefined, field: string): string {
  try {
    return cleanText(value ?? "", field, 200);
  } catch (error) {
    if (!(error instanceof DeskTextError)) throw error;
    throw new ApiError("invalid_request", [{ field: `body.${field}`, message: error.message }]);
  }
}

export const editionRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  auditRefusals(app, database);

  app.get(
    BASE,
    {
      config: { permission: "edition.view" },
      schema: { params: Pub, querystring: EditionQuery, response: { 200: EditionList } },
    },
    async (request) => {
      const access = accessOf(request);
      const { from, to } = request.query;
      // a role that sees none of the stories (Advertising) is not told how many there are
      const counted = storyScope(access, request.params.p) !== "none";
      const rows = await database.withTenant(access.tenant, (tx) =>
        listEditions(tx, request.params.p, { from, to }, LIST_LIMIT, counted),
      );
      return { items: rows.map(view) };
    },
  );

  app.post(
    BASE,
    {
      config: { permission: "edition.create" },
      schema: { params: Pub, body: EditionInput, response: { 201: Edition } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      if (access.reach !== "full") throw refused("their role sets ad positions or the colour map, not new editions");
      const pub = request.params.p;
      const input = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const edition = {
            date: input.date,
            pages: input.pages,
            backPageAds: input.backPageAds ?? true,
            volume: line(input.volume, "volume"),
            issue: line(input.issue, "issue"),
            price: line(input.price, "price"),
          };
          const id = await createEdition(tx, access.tenant, pub, edition);
          if (id === null) {
            const [existing] = await listEditions(tx, pub, { from: input.date, to: input.date }, 1);
            throw new ApiError("edition_exists", undefined, existing ? view(existing) : undefined);
          }
          await recordAudit(tx, access.tenant, {
            action: "edition.create",
            targetType: "edition",
            targetId: id,
            publicationId: pub,
            data: { date: edition.date, pages: edition.pages },
          });
          return { status: 201, body: await one(tx, pub, id), stored: { id } };
        },
        // a replay shows the edition as it is now
        async (stored, tx) => one(tx, pub, (stored as { id: string }).id),
      );
      return reply.status(201).send(answer.body as Edition);
    },
  );
};
