// The archive's routes (doc 06 §10.1; packages/contracts/src/archive.ts, whose header lists them), under
// /api/v1/orgs/:o/pubs/:p, registered inside releaseRoutes. Read-only: downloads and the archive check are release's.
import { ARCHIVE_LIMIT, ArchiveList, ArchiveQuery, ArchiveRelease } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { archiveEdition, archiveReleases } from "../../db/archive.ts";
import type { Database } from "../../db/pools.ts";
import { findRelease } from "../../db/release.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf } from "../access/access.ts";
import { storyScope } from "../stories/rules.ts";
import { releaseView } from "./views.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneRelease = z.strictObject({ o: z.string(), p: z.string(), id: z.string() });

export const archiveRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  app.get(
    "/api/v1/orgs/:o/pubs/:p/archive",
    {
      config: { permission: "archive.view" },
      schema: { params: Pub, querystring: ArchiveQuery, response: { 200: ArchiveList } },
    },
    async (request) => {
      const { year, month, kind, q } = request.query;
      const access = accessOf(request);
      // the search names stories: only those the story rules let this person see (Advertising none, a Reporter theirs)
      const scope = storyScope(access, request.params.p);
      const stories = scope === "own" ? { scope, userId: access.tenant.userId } : { scope };
      const rows = await database.withTenant(access.tenant, (tx) =>
        archiveReleases(
          tx,
          request.params.p,
          {
            ...(year ? { year: Number(year) } : {}),
            ...(month ? { month: Number(month) } : {}),
            ...(kind ? { kind } : {}),
            ...(q ? { q, stories } : {}),
          },
          ARCHIVE_LIMIT + 1,
        ),
      );
      return {
        items: rows.slice(0, ARCHIVE_LIMIT).map((r) => ({
          releaseId: r.id,
          editionId: r.edition_id,
          editionDate: r.edition_date,
          number: r.number,
          kind: r.kind,
          approvedAt: r.approved_at.toISOString(),
          retainUntil: r.retain_until.toISOString(),
          files: r.files,
          runId: r.run_id,
          frontThumb: r.front_thumb,
          matches: r.matches,
        })),
        truncated: rows.length > ARCHIVE_LIMIT,
      };
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/archive/releases/:id",
    { config: { permission: "archive.view" }, schema: { params: OneRelease, response: { 200: ArchiveRelease } } },
    async (request) => {
      const { p: pub, id } = request.params;
      return database.withTenant(accessOf(request).tenant, async (tx) => {
        const row = UUID.test(id) ? await findRelease(tx, pub, id) : undefined;
        // a release still being written (no manifest yet) is not in the archive
        if (!row?.manifest_sha256) throw new ApiError("not_found");
        const release = await releaseView(tx, pub, id);
        const edition = await archiveEdition(tx, pub, row.edition_id);
        if (!release || !edition) throw new ApiError("not_found");
        return {
          release,
          edition: {
            id: row.edition_id,
            date: edition.date,
            releases: edition.releases.map((r) => ({
              id: r.id,
              number: r.number,
              kind: r.kind,
              approvedAt: new Date(r.approved_at).toISOString(),
            })),
          },
        };
      });
    },
  );
};
