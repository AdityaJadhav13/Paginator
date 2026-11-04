// The media library, the photo desk (docs/product/10-l2-newsroom-plan.md §5.3, L2.2), under /api/v1/orgs/:o/pubs/:p.
//   - GET …/media: the publication's pictures, newest first, 60 a page (an opaque cursor). A full media.view lists
//     every one, refused and failed ones too (with their problem), so the desk sees what failed; a Reporter's ◐ the
//     ones they uploaded and those that are the photo of one of their stories (not refused or failed). A deleted one
//     never. `usedBy` names only the stories the person may see; `inUse` says whether any story uses it. `?story=` a
//     story the person may not see answers none (not which picture is its photo).
//   - GET …/assets/:a: one of them; 404 when it is not theirs to see (the same answer as none).
//   - PATCH …/assets/:a (media.upload): the picture's own caption, credit and photographer, on its revision (409
//     asset_changed with the picture as it is now), cleaned as the Desk cleans text; a Reporter's only on the ones
//     they uploaded (first, or again). At least one field; a change to nothing changes nothing (no new revision, no
//     audit). Audited (asset.edit: which fields, never what they say). Each item says `mayEdit` by this same rule.
//   - POST …/assets/:a/rights (story.assign: the desk, who picks found photos): "We have the right to print this" on a
//     found photo (the news finder's), recorded once with who and when, and audited (asset.rights_confirm); a picture
//     that is not a found photo is not found. Answers the picture.
//   - DELETE …/assets/:a?baseRevision= (a full media.upload): deleted (deleted_at; the original stays in the store),
//     409 asset_in_use while a story has it as its photo. Audited (asset.delete).
import { MediaItem, MediaList, MediaPatch, MediaQuery } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import { findStory } from "../../db/stories.ts";
import {
  type LibraryRow,
  confirmRights,
  deleteAsset,
  editAsset,
  findAsset,
  inUse,
  listLibrary,
  uploadedByOf,
  usesOf,
} from "../../db/media.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf, actorOf, auditRefusals, refused } from "../access/access.ts";
import { decodeCursor, factsOf } from "../stories/routes.ts";
import { mediaScope, sees, uploadScope } from "../stories/rules.ts";
import { cleaned } from "../stories/store.ts";
import type { MediaOptions } from "./uploads.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneAsset = z.strictObject({ o: z.string(), p: z.string(), a: z.string() });
const Base = z.strictObject({ baseRevision: z.coerce.number().int().min(1).max(2147483647) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 60;

/** The Desk's sharpness rule (tools/desk/engine/desk_engine.py; experiments/phase0/gen1/generate.py MIN_PPI): a picture
 * prints sharp at a width of W mm when widthPx / (W / 25.4) ≥ 150. */
export const MIN_PPI = 150;
export type Grid = { columns: number; columnMm: number; gutterMm: number };

/** The most columns of the grid (N columns: N·column + (N−1)·gutter mm) the picture prints sharp across: 0 when not
 * even one; null when the grid is not known. */
export function sharpColumns(widthPx: number, grid: Grid | null): number | null {
  if (!grid) return null;
  let n = 0;
  // widthPx · 25.4 ≥ 150 · W, multiplied out so no division rounds the edge
  while (n < grid.columns && widthPx * 25.4 >= MIN_PPI * ((n + 1) * grid.columnMm + n * grid.gutterMm)) n += 1;
  return n;
}

// shortcut: the hosted product stores no publication grid yet (only the Desk's private house profile has one), so
// sharpUpToCols is null and no picture is known too small; read the grid here once publication settings hold it.
const GRID: Grid | null = null;

function encodeCursor(row: LibraryRow): string {
  return Buffer.from(JSON.stringify([row.created_cursor, row.id])).toString("base64url");
}

/** The rows the person may see, with the stories they may see that use each. */
async function items(tx: Tx, access: Access, o: string, p: string, userId: string, rows: LibraryRow[]) {
  const ids = rows.map((row) => row.id);
  const uses = await usesOf(tx, p, ids);
  const editScope = uploadScope(access, p);
  const mine = editScope === "own" ? await uploadedByOf(tx, p, ids, userId) : new Set<string>();
  return rows.map((row): MediaItem => ({
    id: row.id,
    status: row.status,
    problem: row.problem,
    mime: row.mime,
    bytes: row.bytes,
    widthPx: row.width_px,
    heightPx: row.height_px,
    sha256: row.sha256,
    caption: row.caption,
    credit: row.credit,
    photographer: row.photographer,
    sharpUpToCols: sharpColumns(row.width_px, GRID),
    uploadedBy: { id: row.uploaded_by, name: row.uploaded_by_name },
    usedBy: uses
      .filter((use) => use.asset_id === row.id && sees(access, p, factsOf(use), userId))
      .map((use) => ({ storyId: use.story_id, headline: use.headline })),
    inUse: uses.some((use) => use.asset_id === row.id),
    mayEdit: editScope === "all" || (editScope === "own" && (row.uploaded_by === userId || mine.has(row.id))),
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    // the API's own preview download (a 302 to a 5-minute link), once the engine has made it
    previewUrl: row.status === "ready" ? `/api/v1/orgs/${o}/pubs/${p}/assets/${row.id}/file?variant=preview` : null,
    ...(row.licence_label && row.source_url
      ? {
          licence: {
            name: row.licence_name ?? "",
            url: row.licence_url,
            sourceUrl: row.source_url,
            label: row.licence_label,
            rightsConfirmed:
              row.rights_confirmed_by && row.rights_confirmed_at
                ? {
                    by: { id: row.rights_confirmed_by, name: row.rights_confirmed_by_name ?? "" },
                    at: row.rights_confirmed_at.toISOString(),
                  }
                : null,
          },
        }
      : {}),
  }));
}

/** The picture if the person may see it in the library, else undefined. */
async function visible(tx: Tx, access: Access, p: string, a: string, userId: string) {
  const scope = mediaScope(access, p);
  if (scope === "none" || !UUID.test(a)) return undefined;
  const [row] = await listLibrary(tx, {
    publicationId: p,
    id: a,
    ...(scope === "own" ? { mine: userId } : {}),
    limit: 1,
  });
  return row;
}

export const libraryRoutes: FastifyPluginAsyncZod<MediaOptions> = async (app, { database }) => {
  auditRefusals(app, database);

  app.get(
    "/api/v1/orgs/:o/pubs/:p/media",
    {
      config: { permission: "media.view" },
      schema: { params: Pub, querystring: MediaQuery, response: { 200: MediaList } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { o, p } = request.params;
      const q = request.query;
      const scope = mediaScope(access, p);
      // with no grid, no picture is known too small for any number of columns
      if (scope === "none" || (q.tooSmallForCols !== undefined && GRID === null)) return { items: [], next: null };
      const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor);
      return database.withTenant(access.tenant, async (tx) => {
        if (q.story !== undefined) {
          const story = UUID.test(q.story) ? await findStory(tx, p, q.story) : null;
          if (!story || !sees(access, p, factsOf(story), userId)) return { items: [], next: null };
        }
        const rows = await listLibrary(tx, {
          publicationId: p,
          ...(scope === "own" ? { mine: userId } : {}),
          ...(q.story !== undefined ? { story: q.story } : {}),
          ...(q.missing !== undefined ? { missing: q.missing } : {}),
          ...(q.q ? { q: q.q } : {}),
          ...(after ? { after: { createdAt: after.updatedAt, id: after.id } } : {}),
          limit: PAGE + 1,
        });
        const page = rows.slice(0, PAGE);
        const last = page.at(-1);
        return {
          items: await items(tx, access, o, p, userId, page),
          next: rows.length > PAGE && last ? encodeCursor(last) : null,
        };
      });
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/assets/:a",
    { config: { permission: "media.view" }, schema: { params: OneAsset, response: { 200: MediaItem } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { o, p, a } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const row = await visible(tx, access, p, a, userId);
        if (!row) throw new ApiError("not_found");
        return (await items(tx, access, o, p, userId, [row]))[0] as MediaItem;
      });
    },
  );

  app.patch(
    "/api/v1/orgs/:o/pubs/:p/assets/:a",
    {
      config: { permission: "media.upload" },
      schema: { params: OneAsset, body: MediaPatch, response: { 200: MediaItem } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { o, p, a } = request.params;
      const input = request.body;
      if (input.caption === undefined && input.credit === undefined && input.photographer === undefined) {
        throw new ApiError("invalid_request", [
          { field: "caption", message: "Send a caption, credit or photographer." },
        ]);
      }
      const facts = {
        ...(input.caption !== undefined ? { caption: cleaned(input.caption, "caption") } : {}),
        ...(input.credit !== undefined ? { credit: cleaned(input.credit, "credit") } : {}),
        ...(input.photographer !== undefined ? { photographer: cleaned(input.photographer, "photographer") } : {}),
      };
      return database.withTenant(access.tenant, async (tx) => {
        const row = await visible(tx, access, p, a, userId);
        if (!row) throw new ApiError("not_found");
        const before = (await items(tx, access, o, p, userId, [row]))[0] as MediaItem;
        if (!before.mayEdit) throw refused("this picture is not theirs to change");
        if (Object.entries(facts).every(([field, value]) => row[field as keyof typeof facts] === value)) {
          if (row.revision !== input.baseRevision) throw new ApiError("asset_changed", undefined, before);
          return before; // nothing changes: no new revision, no audit row
        }
        if (!(await editAsset(tx, p, a, input.baseRevision, facts))) {
          const now = await visible(tx, access, p, a, userId);
          if (!now) throw new ApiError("not_found");
          throw new ApiError("asset_changed", undefined, (await items(tx, access, o, p, userId, [now]))[0]);
        }
        await recordAudit(tx, access.tenant, {
          action: "asset.edit",
          targetType: "asset",
          targetId: a,
          publicationId: p,
          data: { revision: input.baseRevision + 1, fields: Object.keys(facts) },
        });
        const changed = (await visible(tx, access, p, a, userId)) as LibraryRow;
        return (await items(tx, access, o, p, userId, [changed]))[0] as MediaItem;
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/assets/:a/rights",
    { config: { permission: "story.assign" }, schema: { params: OneAsset, response: { 200: MediaItem } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { o, p, a } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const row = await visible(tx, access, p, a, userId);
        if (!row?.licence_label) throw new ApiError("not_found");
        if (await confirmRights(tx, p, a, userId)) {
          await recordAudit(tx, access.tenant, {
            action: "asset.rights_confirm",
            targetType: "asset",
            targetId: a,
            publicationId: p,
            data: { label: row.licence_label },
          });
        }
        const now = (await visible(tx, access, p, a, userId)) as LibraryRow;
        return (await items(tx, access, o, p, userId, [now]))[0] as MediaItem;
      });
    },
  );

  app.delete(
    "/api/v1/orgs/:o/pubs/:p/assets/:a",
    { config: { permission: "media.upload" }, schema: { params: OneAsset, querystring: Base } },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { o, p, a } = request.params;
      await database.withTenant(access.tenant, async (tx) => {
        const row = await visible(tx, access, p, a, userId);
        if (!row) throw new ApiError("not_found");
        if (uploadScope(access, p) !== "all") throw refused("only the desk deletes a picture");
        // locked: a story's photo is attached under a share lock (photos.ts), so the check below sees it, or it waits
        const locked = await findAsset(tx, p, a, "update");
        if (!locked) throw new ApiError("not_found");
        if (locked.revision !== request.query.baseRevision) {
          const now = (await visible(tx, access, p, a, userId)) as LibraryRow;
          throw new ApiError("asset_changed", undefined, (await items(tx, access, o, p, userId, [now]))[0]);
        }
        if (await inUse(tx, p, a)) throw new ApiError("asset_in_use");
        await deleteAsset(tx, p, a);
        await recordAudit(tx, access.tenant, {
          action: "asset.delete",
          targetType: "asset",
          targetId: a,
          publicationId: p,
          data: { revision: locked.revision },
        });
      });
      return reply.status(204).send();
    },
  );
};
