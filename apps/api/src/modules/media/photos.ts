// A story's photo and picture downloads (docs/product/10-l2-newsroom-plan.md §5.2, §6.4).
//   - PUT/PATCH/DELETE …/stories/:s/photo: whoever edits the story, or a Photo Editor of the publication, gives it a
//     picture of the same publication that they may download (or changes the caption or credit, or takes it off): a
//     Reporter attaches only a picture of theirs, never one they could not see. Each is a change of the
//     story, on its version (baseRevision; 409 story_changed), and the caption and credit are cleaned as the Desk
//     cleans text.
//   - GET …/assets/:a/file: a 302 to a 5-minute download link tied to the picture's version, with its type from its
//     bytes and a file name from its Desk id (never the uploader's). ?variant=preview gives the engine's preview (a JPEG
//     of at most 2000 px, media.ready's rendition) the same way, inline; 404 until the picture is ready. A rejected or
//     failed picture no longer holds its bytes (the same bytes sent again make a new asset): it is neither attached nor
//     downloaded (404).
import { FileQuery, Story, StoryPhotoInput, StoryPhotoPatch } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { renditionOf } from "../../db/engine-events.ts";
import { type AssetRow, findAsset, uploadedBy } from "../../db/media.ts";
import { findStory, isPhotoOfTheirs, removePhoto, setPhoto, updatePhoto } from "../../db/stories.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf, actorOf, auditRefusals, refused } from "../access/access.ts";
import { forChange, view } from "../stories/routes.ts";
import { canAttachPhoto, mediaScope } from "../stories/rules.ts";
import { cleaned } from "../stories/store.ts";
import { EXTENSION } from "./picture.ts";
import type { MediaOptions } from "./uploads.ts";

const One = z.strictObject({ o: z.string(), p: z.string(), s: z.string() });
const OneAsset = z.strictObject({ o: z.string(), p: z.string(), a: z.string() });
const Base = z.strictObject({ baseRevision: z.coerce.number().int().min(1).max(2147483647) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO = "/api/v1/orgs/:o/pubs/:p/stories/:s/photo";
export const DOWNLOAD_SECONDS = 5 * 60;
/** A picture the engine refused or could not prepare: no longer one to attach or download. */
const settledBad = (asset: AssetRow) => asset.status === "rejected" || asset.status === "failed";

/** Whether the person may download this picture (and so attach it): all of the publication's with a full media.view;
 * with a Reporter's ◐, the ones theirs: uploaded by them (first, or again: the same bytes are one asset), or the photo
 * of one of their stories. */
export async function maySee(tx: Tx, access: Access, publicationId: string, asset: AssetRow, userId: string) {
  if (settledBad(asset)) return false;
  const scope = mediaScope(access, publicationId);
  if (scope === "all") return true;
  if (scope !== "own") return false;
  return (
    asset.uploaded_by === userId ||
    (await uploadedBy(tx, publicationId, asset.id, userId)) ||
    (await isPhotoOfTheirs(tx, publicationId, asset.id, userId))
  );
}

export const photoRoutes: FastifyPluginAsyncZod<MediaOptions> = async (app, { database, store }) => {
  auditRefusals(app, database); // the photo rules' 403s are audited as the stories' are

  app.put(
    PHOTO,
    {
      config: { permission: "media.upload" },
      schema: { params: One, body: StoryPhotoInput, response: { 200: Story } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      const input = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const story = await forChange(tx, access, p, s, userId, input.baseRevision);
        if (!canAttachPhoto(access, p, story.facts, userId)) throw refused("this story's photo is not theirs to set");
        const asset = await findAsset(tx, p, input.assetId);
        // a picture they may not download is not theirs to attach either: the same answer as none (F4)
        if (asset && !settledBad(asset) && !(await maySee(tx, access, p, asset, userId))) {
          throw new ApiError("not_found");
        }
        if (!asset || settledBad(asset)) {
          throw new ApiError("invalid_request", [
            { field: "body.assetId", message: "is not a picture of this publication" },
          ]);
        }
        await setPhoto(tx, access.tenant, p, s, {
          assetId: asset.id,
          caption: cleaned(input.caption, "caption"),
          credit: cleaned(input.credit, "credit"),
        });
        return view((await findStory(tx, p, s)) as NonNullable<Awaited<ReturnType<typeof findStory>>>, access, userId);
      });
    },
  );

  app.patch(
    PHOTO,
    {
      config: { permission: "media.upload" },
      schema: { params: One, body: StoryPhotoPatch, response: { 200: Story } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      const input = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const story = await forChange(tx, access, p, s, userId, input.baseRevision);
        if (!canAttachPhoto(access, p, story.facts, userId))
          throw refused("this story's photo is not theirs to change");
        const changed = await updatePhoto(tx, access.tenant, p, s, {
          ...(input.caption !== undefined ? { caption: cleaned(input.caption, "caption") } : {}),
          ...(input.credit !== undefined ? { credit: cleaned(input.credit, "credit") } : {}),
        });
        if (!changed) throw new ApiError("not_found");
        return view((await findStory(tx, p, s)) as NonNullable<Awaited<ReturnType<typeof findStory>>>, access, userId);
      });
    },
  );

  app.delete(
    PHOTO,
    { config: { permission: "media.upload" }, schema: { params: One, querystring: Base, response: { 200: Story } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const story = await forChange(tx, access, p, s, userId, request.query.baseRevision);
        if (!canAttachPhoto(access, p, story.facts, userId))
          throw refused("this story's photo is not theirs to remove");
        if (!(await removePhoto(tx, access.tenant, p, s))) throw new ApiError("not_found");
        return view((await findStory(tx, p, s)) as NonNullable<Awaited<ReturnType<typeof findStory>>>, access, userId);
      });
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/assets/:a/file",
    { config: { permission: "media.view" }, schema: { params: OneAsset, querystring: FileQuery } },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, a } = request.params;
      const preview = request.query.variant === "preview";
      const { asset, rendition } = await database.withTenant(access.tenant, async (tx) => {
        const found = UUID.test(a) ? await findAsset(tx, p, a) : undefined;
        if (!found || !(await maySee(tx, access, p, found, userId))) return { asset: undefined, rendition: undefined };
        return { asset: found, rendition: preview ? await renditionOf(tx, p, found.id, "preview") : undefined };
      });
      // version_id is set in the transaction that makes the asset: an asset without one has no file to give
      if (!asset?.version_id) throw new ApiError("not_found");
      if (preview) {
        if (!rendition) throw new ApiError("not_found");
        const link = await store.presignGet({
          key: rendition.key,
          versionId: rendition.version_id,
          contentType: rendition.mime,
          disposition: `inline; filename="${asset.desk_key}-preview.jpg"`,
          expiresSeconds: DOWNLOAD_SECONDS,
        });
        return reply.header("cache-control", "no-store").redirect(link, 302);
      }
      const url = await store.presignGet({
        key: asset.original_key,
        versionId: asset.version_id,
        contentType: asset.mime,
        disposition: `attachment; filename="${asset.desk_key}.${EXTENSION[asset.mime]}"`,
        expiresSeconds: DOWNLOAD_SECONDS,
      });
      return reply.header("cache-control", "no-store").redirect(url, 302);
    },
  );
};
