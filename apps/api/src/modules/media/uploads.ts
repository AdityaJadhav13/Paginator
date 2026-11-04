// Photo uploads (docs/product/10-l2-newsroom-plan.md §5.2, §6.2): the browser uploads straight to the object store
// with a presigned POST, then asks the API to complete it.
//   - Presign: JPEG, PNG or WebP, at most 40 MiB (a Word file, purpose docx: 10 MiB; a dataset bundle, purpose
//     engine_dataset: a ZIP of at most 4 GiB, settings.edit, not charged to the daily quota); 60 uploads an hour per person and 2 GB a day per organisation,
//     both counted under the organisation's quota row lock, so requests at once cannot pass the limits together. The
//     quota is charged the declared size, and the POST policy (valid 15 minutes) takes exactly that many bytes, for
//     exactly the upload's key (uploads/orgs/<org>/pubs/<pub>/<upload>, the database's), its Content-Type and its
//     upload id. SeaweedFS enforces each condition (test/db/media.test.ts); S3 is checked in staging
//     (11-fix-before-launch).
//   - Who: media.upload; a library picture also ads.manage (Advertising uploads a booking's artwork, L2.6). The routes
//     declare pages.view and check this themselves (uploaderOf).
//   - Complete (the uploader only): one read of the version the store names gives the file's SHA-256, its size, its
//     type from its bytes and its width and height (picture.ts). A file of another size than declared, or that is not
//     a picture, is refused (422 not_a_picture). A picture becomes an asset, copied out of quarantine to
//     orgs/<org>/pubs/<pub>/assets/<asset>/original (its version kept, the SHA-256 in its metadata), or, when the
//     publication has those very bytes already, the asset it has. A new asset's print versions are enqueued in the
//     same transaction (media.ingest; src/modules/media/engine-inbox.ts settles the asset). Then, completed or
//     refused, every version of the quarantine key is deleted by its version id (a file sent twice under one policy
//     leaves two); the bucket's lifecycle rule removes whatever is sent after that (scripts/dev-buckets.ts).
import { createHash } from "node:crypto";
import {
  Asset,
  CompletedUpload,
  MAX_DATASET_BYTES,
  MAX_DOCX_BYTES,
  MAX_PICTURE_BYTES,
  PresignedUpload,
  UploadRequest,
  reach,
} from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type AssetRow,
  addToQuota,
  assetWithBytes,
  completeUpload,
  createAsset,
  createUpload,
  enqueueMediaIngest,
  findAsset,
  findUpload,
  rejectUpload,
  setAssetVersion,
  uploadsLastHour,
} from "../../db/media.ts";
import { recordAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { accessOf, actorOf, auditRefusals, refused } from "../access/access.ts";
import { idempotent } from "../requests/idempotency.ts";
import { HEADER_BYTES, JpegScan, NotAPicture, picture } from "./picture.ts";

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

/** Reads one version of the object once: its SHA-256, its length, its first HEADER_BYTES, and a JPEG's marker scan. */
async function readAll(store: ObjectStore, key: string, versionId: string) {
  const hash = createHash("sha256");
  const scan = new JpegScan();
  const head: Uint8Array[] = [];
  let kept = 0;
  let bytes = 0;
  for await (const chunk of await store.read(key, versionId)) {
    bytes += chunk.length;
    if (bytes > MAX_PICTURE_BYTES) throw new ApiError("file_too_large");
    hash.update(chunk);
    scan.feed(chunk);
    if (kept < HEADER_BYTES) {
      const part = chunk.subarray(0, HEADER_BYTES - kept);
      head.push(part);
      kept += part.length;
    }
  }
  return { sha256: hash.digest("hex"), bytes, head: Buffer.concat(head), scan };
}

/** A Word file refused: the reason, when there is one, is the answer's message too (not the general "not a Word
 * file"). */
export function docxRefused(field: string, message?: string): ApiError {
  const error = new ApiError("docx_refused", message ? [{ field, message }] : undefined);
  if (message) error.message = message;
  return error;
}

/** media.upload, or (a library picture only) ads.manage: Advertising's booking artwork (L2.6). */
function uploaderOf(access: ReturnType<typeof accessOf>, pub: string, purpose: string): void {
  const here = access.publications.get(pub) ?? { roles: [], grants: [] };
  if (reach("media.upload", access.orgRole, here) !== null) return;
  if (purpose === "library" && reach("ads.manage", access.orgRole, here) !== null) return;
  throw refused("an upload needs media.upload (a library picture: or ads.manage)");
}

export const uploadRoutes: FastifyPluginAsyncZod<MediaOptions> = async (app, { database, store }) => {
  auditRefusals(app, database);
  app.post(
    "/api/v1/orgs/:o/pubs/:p/uploads",
    {
      config: { permission: "pages.view" },
      schema: { params: Pub, body: UploadRequest, response: { 201: PresignedUpload } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const input = request.body;
      uploaderOf(access, pub, input.purpose);
      if (input.purpose === "docx") {
        // a Word file is for stories (POST …/imports/docx): story.create, at most 10 MiB
        if (reach("story.create", access.orgRole, access.publications.get(pub) ?? { roles: [], grants: [] }) === null)
          throw refused("a Word file is imported as stories: story.create");
        if (input.bytes > MAX_DOCX_BYTES) throw docxRefused("body.bytes", "This Word file is larger than 10 MB.");
      } else if (input.purpose === "engine_dataset") {
        // an engine profile's dataset bundle (POST …/engine-profiles): settings.edit, at most 4 GiB
        if (reach("settings.edit", access.orgRole, access.publications.get(pub) ?? { roles: [], grants: [] }) === null)
          throw refused("a dataset bundle is an engine profile's: settings.edit");
        if (input.bytes > MAX_DATASET_BYTES) {
          throw new ApiError("file_too_large", [
            {
              field: "body.bytes",
              message: "A dataset bundle is at most 4 GB: leave out what the engine does not read.",
            },
          ]);
        }
      } else if (input.bytes > MAX_PICTURE_BYTES) throw new ApiError("file_too_large");
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          // the quota row's lock first: the hour's count then sees every upload committed before it (a refusal rolls
          // the quota back with the rest)
          // a dataset bundle (settings.edit only, a few a year) is larger than a day's quota, and is not charged to it
          const charged = input.purpose === "engine_dataset" ? 0 : input.bytes;
          if ((await addToQuota(tx, access.tenant.orgId, charged)) > ORG_BYTES_PER_DAY) {
            throw new ApiError("slow_down");
          }
          if ((await uploadsLastHour(tx, access.tenant.userId)) >= UPLOADS_PER_HOUR) throw new ApiError("slow_down");
          const upload = await createUpload(tx, access.tenant, pub, {
            purpose: input.purpose,
            type: input.contentType,
            bytes: input.bytes,
            expiresSeconds: POST_SECONDS,
          });
          // the size charged to the quota, never the file's name
          await recordAudit(tx, access.tenant, {
            action: "upload.presign",
            targetType: "upload",
            targetId: upload.id,
            publicationId: pub,
            data: { bytes: input.bytes, purpose: input.purpose },
          });
          const post = await store.presignPost({
            key: upload.key,
            contentType: input.contentType,
            bytes: input.bytes,
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
    { config: { permission: "pages.view" }, schema: { params: OneUpload, response: { 200: CompletedUpload } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p: pub, u } = request.params;
      const upload = UUID.test(u)
        ? await database.withTenant(access.tenant, (tx) => findUpload(tx, pub, u))
        : undefined;
      // someone else's upload is not theirs to complete: the same answer as none at all
      if (!upload || upload.user_id !== userId) throw new ApiError("not_found");
      uploaderOf(access, pub, upload.purpose);
      // a Word file is completed by its import (POST …/imports/docx), never as a picture
      // and a dataset bundle by its engine profile (POST …/engine-profiles)
      if (upload.purpose === "docx" || upload.purpose === "engine_dataset") throw new ApiError("not_a_picture");
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
      // every asset is pinned to its version (plan §6.2): a store that names none is misconfigured (/readyz says so)
      const version = arrived.versionId;
      if (!version) throw new Error("The work bucket gave the upload no version: its versioning must be Enabled.");
      const refuse = async (message: string): Promise<never> => {
        await database.withTenant(access.tenant, async (tx) => {
          if (!(await rejectUpload(tx, pub, u))) return;
          await recordAudit(tx, access.tenant, {
            action: "upload.reject",
            targetType: "upload",
            targetId: u,
            publicationId: pub,
          });
        });
        await store.removeAll(upload.key).catch(() => undefined); // the lifecycle rule would, within two days
        throw new ApiError("not_a_picture", [{ field: "file", message }]);
      };
      const wrongSize = (bytes: number) =>
        `The file is ${bytes} bytes, not the ${upload.declared_bytes} the upload said.`;
      if (arrived.bytes !== upload.declared_bytes) await refuse(wrongSize(arrived.bytes));
      // the version read is the version copied: a second upload under the same policy changes neither
      const read = await readAll(store, upload.key, version);
      if (read.bytes !== upload.declared_bytes) await refuse(wrongSize(read.bytes));
      let found;
      try {
        found = picture(read.head, read.scan);
      } catch (error) {
        if (!(error instanceof NotAPicture)) throw error;
        return refuse(`The file was refused: ${error.message}.`);
      }
      const picked = found;
      const settle = () =>
        database.withTenant(access.tenant, async (tx) => {
          const locked = await findUpload(tx, pub, u, true);
          if (locked?.status === "completed" && locked.asset_id) return findAsset(tx, pub, locked.asset_id);
          if (locked?.status !== "presigned") throw new ApiError("not_a_picture");
          const completed = (assetId: string, existing: boolean) =>
            recordAudit(tx, access.tenant, {
              action: "upload.complete",
              targetType: "asset",
              targetId: assetId,
              publicationId: pub,
              data: {
                upload: u,
                existing,
                bytes: read.bytes,
                mime: picked.mime,
                widthPx: picked.width,
                heightPx: picked.height,
              },
            });
          const same = await assetWithBytes(tx, pub, read.sha256);
          if (same) {
            await completeUpload(tx, pub, u, same.id);
            await completed(same.id, true);
            return same;
          }
          const made = await createAsset(tx, access.tenant, pub, {
            sha256: read.sha256,
            bytes: read.bytes, // the bytes stored: the quota was charged the same (the declared size, checked above)
            mime: picked.mime,
            width: picked.width,
            height: picked.height,
          });
          const copied = await store.copy({
            from: upload.key,
            fromVersion: version,
            to: made.original_key,
            contentType: picked.mime,
            metadata: { sha256: read.sha256 },
          });
          await setAssetVersion(tx, pub, made.id, copied.versionId);
          // its print versions (L2.2): the job commits with the asset, or neither does
          await enqueueMediaIngest(tx, {
            orgId: access.tenant.orgId,
            publicationId: pub,
            assetId: made.id,
            versionId: copied.versionId,
            sha256: read.sha256,
          });
          await completeUpload(tx, pub, u, made.id);
          await completed(made.id, false);
          return { ...made, version_id: copied.versionId };
        });
      let asset;
      try {
        asset = await settle();
      } catch (error) {
        // two completes of the same new bytes at once: the other made the asset first (asset_one_per_bytes), and
        // this one, run again, finds it
        if ((error as { code?: unknown }).code !== "23505") throw error;
        asset = await settle();
      }
      if (!asset) throw new ApiError("not_found");
      await store.removeAll(upload.key).catch(() => undefined); // the lifecycle rule would, within two days
      return { asset: assetView(asset) };
    },
  );
};
