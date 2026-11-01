// Uploads and assets in the database (docs/product/10-l2-newsroom-plan.md §3.3, §6; migration 2026_11_23_0001), for
// src/modules/media. Each function runs inside withTenant (a Tx): the organisation and publication walls apply.
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

export type Who = { orgId: string; userId: string };

/** How many uploads the person presigned in the last hour, in the publications they reach. */
export async function uploadsLastHour(tx: Tx, userId: string): Promise<number> {
  const row = await tx
    .selectFrom("app.upload")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("user_id", "=", userId)
    .where("created_at", ">", sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Adds bytes to the organisation's total for today, under a row lock; returns the new total. */
export async function addToQuota(tx: Tx, orgId: string, bytes: number): Promise<number> {
  const row = await tx
    .insertInto("app.upload_quota")
    .values({ org_id: orgId, day: sql`current_date`, bytes: String(bytes) })
    .onConflict((conflict) =>
      conflict.columns(["org_id", "day"]).doUpdateSet({ bytes: sql`app.upload_quota.bytes + excluded.bytes` }),
    )
    .returning("bytes")
    .executeTakeFirstOrThrow();
  return Number(row.bytes);
}

export async function createUpload(
  tx: Tx,
  who: Who,
  publicationId: string,
  upload: { type: string; bytes: number; expiresSeconds: number },
) {
  return tx
    .insertInto("app.upload")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      user_id: who.userId,
      purpose: "story_photo",
      declared_type: upload.type,
      declared_bytes: upload.bytes,
      expires_at: sql`now() + make_interval(secs => ${upload.expiresSeconds})`,
    })
    .returning(["id", "key", "expires_at"])
    .executeTakeFirstOrThrow();
}

export async function findUpload(tx: Tx, publicationId: string, uploadId: string, lock = false) {
  const query = tx
    .selectFrom("app.upload")
    .select(["id", "user_id", "key", "status", "asset_id", "declared_type", "declared_bytes"])
    .where("publication_id", "=", publicationId)
    .where("id", "=", uploadId);
  return (lock ? query.forUpdate() : query).executeTakeFirst();
}

/** Marks a presigned upload refused; false when it was not presigned (refused or completed already). */
export async function rejectUpload(tx: Tx, publicationId: string, uploadId: string): Promise<boolean> {
  const done = await tx
    .updateTable("app.upload")
    .set({ status: "rejected" })
    .where("publication_id", "=", publicationId)
    .where("id", "=", uploadId)
    .where("status", "=", "presigned")
    .returning("id")
    .executeTakeFirst();
  return done !== undefined;
}

export async function completeUpload(tx: Tx, publicationId: string, uploadId: string, assetId: string): Promise<void> {
  await tx
    .updateTable("app.upload")
    .set({ status: "completed", asset_id: assetId, completed_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", uploadId)
    .execute();
}

export type AssetRow = {
  id: string;
  publication_id: string;
  status: "received" | "ready" | "rejected";
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  width_px: number;
  height_px: number;
  sha256: string;
  desk_key: string;
  original_key: string;
  version_id: string | null;
  uploaded_by: string;
  created_at: Date;
};

const ASSET = [
  "id",
  "publication_id",
  "status",
  "mime",
  "bytes",
  "width_px",
  "height_px",
  "sha256",
  "desk_key",
  "original_key",
  "version_id",
  "uploaded_by",
  "created_at",
] as const;

export async function findAsset(tx: Tx, publicationId: string, assetId: string): Promise<AssetRow | undefined> {
  return (await tx
    .selectFrom("app.asset")
    .select(ASSET)
    .where("publication_id", "=", publicationId)
    .where("id", "=", assetId)
    .where("deleted_at", "is", null)
    .executeTakeFirst()) as AssetRow | undefined;
}

/** The publication's asset with these bytes, if any (one asset per picture and publication; a rejected one is not
 * found, and the same bytes sent again make a new asset). */
export async function assetWithBytes(tx: Tx, publicationId: string, sha256: string): Promise<AssetRow | undefined> {
  return (await tx
    .selectFrom("app.asset")
    .select(ASSET)
    .where("publication_id", "=", publicationId)
    .where("sha256", "=", sha256)
    .where("status", "!=", "rejected")
    .where("deleted_at", "is", null)
    .executeTakeFirst()) as AssetRow | undefined;
}

export async function createAsset(
  tx: Tx,
  who: Who,
  publicationId: string,
  asset: { sha256: string; bytes: number; mime: string; width: number; height: number },
): Promise<AssetRow> {
  return (await tx
    .insertInto("app.asset")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      // the Desk's photo id, p- and 10 hex digits (deskserver/util.py PHOTO_ID)
      desk_key: `p-${randomBytes(5).toString("hex")}`,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
      width_px: asset.width,
      height_px: asset.height,
      uploaded_by: who.userId,
    })
    .returning(ASSET)
    .executeTakeFirstOrThrow()) as AssetRow;
}

export async function setAssetVersion(tx: Tx, publicationId: string, assetId: string, versionId: string) {
  await tx
    .updateTable("app.asset")
    .set({ version_id: versionId, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", assetId)
    .execute();
}

/** Whether the person completed an upload that became this asset (theirs, though the bytes were someone else's
 * first: one asset per picture and publication). */
export async function uploadedBy(tx: Tx, publicationId: string, assetId: string, userId: string): Promise<boolean> {
  const row = await tx
    .selectFrom("app.upload")
    .select("id")
    .where("publication_id", "=", publicationId)
    .where("asset_id", "=", assetId)
    .where("user_id", "=", userId)
    .where("status", "=", "completed")
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
