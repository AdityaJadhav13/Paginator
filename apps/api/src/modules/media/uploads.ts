// Photo uploads (docs/product/10-l2-newsroom-plan.md §5.2, §6.2): the browser uploads straight to the object store
// with a presigned POST, then asks the API to complete it.
//   - Presign: JPEG, PNG or WebP, at most 40 MiB; 60 uploads an hour per person and 2 GB a day per organisation;
//     a POST valid 15 minutes for exactly the upload's key (uploads/orgs/<org>/pubs/<pub>/<upload>, the database's),
//     1 byte to 40 MiB, its Content-Type and its upload id pinned (SeaweedFS and S3 enforce each: tested).
//   - Complete (the uploader only): one read of the whole object gives its SHA-256, its type from its bytes and its
//     size from its header (picture.ts); a file that is not a picture is refused (422 not_a_picture) and deleted.
//     A picture becomes an asset, copied out of quarantine to orgs/<org>/pubs/<pub>/assets/<asset>/original (versioned,
//     the SHA-256 in its metadata), or, when the publication has those very bytes already, the asset it has.
import { createHash } from "node:crypto";
import { Asset, CompletedUpload, MAX_PICTURE_BYTES, PresignedUpload, UploadRequest } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type AssetRow,
  addToQuota,
  assetWithBytes,
  completeUpload,
  createAsset,
  createUpload,
  findAsset,
  findUpload,
  rejectUpload,
  setAssetVersion,
  uploadsLastHour,
} from "../../db/media.ts";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { accessOf, actorOf } from "../access/access.ts";
import { idempotent } from "../requests/idempotency.ts";
import { HEADER_BYTES, NotAPicture, picture } from "./picture.ts";

export const UPLOADS_PER_HOUR = 60;
export const ORG_BYTES_PER_DAY = 2 * 1024 ** 3;
const POST_SECONDS = 15 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneUpload = z.strictObject({ o: z.string(), p: z.string(), u: z.string() });

export type MediaOptions = { database: Database; store: ObjectStore };

export function assetView(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: "photo",
    status: row.status,
    mime: row.mime,
    bytes: row.bytes,
    widthPx: row.width_px,
    heightPx: row.height_px,
    sha256: row.sha256,
    createdAt: row.created_at.toISOString(),
  };
}

/** Reads the whole object once: its SHA-256, its length, and its first HEADER_BYTES. */
async function readAll(store: ObjectStore, key: string, versionId: string | undefined) {
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let kept = 0;
  let bytes = 0;
  for await (const chunk of await store.read(key, versionId)) {
    bytes += chunk.length;
    if (bytes > MAX_PICTURE_BYTES) throw new ApiError("file_too_large");
    hash.update(chunk);
    if (kept < HEADER_BYTES) {
      const part = chunk.subarray(0, HEADER_BYTES - kept);
      head.push(part);
      kept += part.length;
    }
  }
  return { sha256: hash.digest("hex"), bytes, head: Buffer.concat(head) };
}

export const uploadRoutes: FastifyPluginAsyncZod<MediaOptions> = async (app, { database, store }) => {
  app.post(
    "/api/v1/orgs/:o/pubs/:p/uploads",
    {
      config: { permission: "media.upload" },
      schema: { params: Pub, body: UploadRequest, response: { 201: PresignedUpload } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const input = request.body;
      if (input.bytes > MAX_PICTURE_BYTES) throw new ApiError("file_too_large");
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          if ((await uploadsLastHour(tx, access.tenant.userId)) >= UPLOADS_PER_HOUR) throw new ApiError("slow_down");
          if ((await addToQuota(tx, access.tenant.orgId, input.bytes)) > ORG_BYTES_PER_DAY) {
            throw new ApiError("slow_down");
          }
          const upload = await createUpload(tx, access.tenant, pub, {
            type: input.contentType,
            bytes: input.bytes,
            expiresSeconds: POST_SECONDS,
          });
          const post = await store.presignPost({
            key: upload.key,
            contentType: input.contentType,
            maxBytes: MAX_PICTURE_BYTES,
            expiresSeconds: POST_SECONDS,
            metadata: { "upload-id": upload.id },
          });
          return {
            status: 201,
            body: {
              uploadId: upload.id,
              url: post.url,
              fields: post.fields,
              expiresAt: upload.expires_at.toISOString(),
            },
          };
        },
        // a replay answers the same policy again (it is valid until it expires): the person still reaches the route
        async (stored) => stored,
      );
      return reply.status(201).send(answer.body as z.infer<typeof PresignedUpload>);
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/uploads/:u/complete",
    { config: { permission: "media.upload" }, schema: { params: OneUpload, response: { 200: CompletedUpload } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p: pub, u } = request.params;
      const upload = UUID.test(u)
        ? await database.withTenant(access.tenant, (tx) => findUpload(tx, pub, u))
        : undefined;
      // someone else's upload is not theirs to complete: the same answer as none at all
      if (!upload || upload.user_id !== userId) throw new ApiError("not_found");
      if (upload.status === "completed" && upload.asset_id) {
        const assetId = upload.asset_id;
        const asset = await database.withTenant(access.tenant, (tx) => findAsset(tx, pub, assetId));
        if (asset) return { asset: assetView(asset) };
      }
      if (upload.status !== "presigned") throw new ApiError("not_a_picture");
      const arrived = await store.head(upload.key);
      if (!arrived) {
        throw new ApiError("invalid_request", [{ field: "params.u", message: "The file has not arrived yet." }]);
      }
      // the version read is the version copied: a second upload under the same policy changes neither
      const read = await readAll(store, upload.key, arrived.versionId);
      let found;
      try {
        found = picture(read.head);
      } catch (error) {
        if (!(error instanceof NotAPicture)) throw error;
        await database.withTenant(access.tenant, (tx) => rejectUpload(tx, pub, u));
        await store.remove(upload.key).catch(() => undefined);
        throw new ApiError("not_a_picture", [{ field: "file", message: `The file was refused: ${error.message}.` }]);
      }
      const asset = await database.withTenant(access.tenant, async (tx) => {
        const locked = await findUpload(tx, pub, u, true);
        if (locked?.status === "completed" && locked.asset_id) return findAsset(tx, pub, locked.asset_id);
        const same = await assetWithBytes(tx, pub, read.sha256);
        if (same) {
          await completeUpload(tx, pub, u, same.id);
          return same;
        }
        const made = await createAsset(tx, access.tenant, pub, {
          sha256: read.sha256,
          bytes: read.bytes,
          mime: found.mime,
          width: found.width,
          height: found.height,
        });
        const copied = await store.copy({
          from: upload.key,
          fromVersion: arrived.versionId,
          to: made.original_key,
          contentType: found.mime,
          metadata: { sha256: read.sha256 },
        });
        await setAssetVersion(tx, pub, made.id, copied.versionId);
        await completeUpload(tx, pub, u, made.id);
        return { ...made, version_id: copied.versionId ?? null };
      });
      if (!asset) throw new ApiError("not_found");
      await store.remove(upload.key).catch(() => undefined); // the lifecycle rule would, within a day
      return { asset: assetView(asset) };
    },
  );
};
