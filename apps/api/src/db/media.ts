// Uploads and assets in the database (docs/product/10-l2-newsroom-plan.md §3.3, §6; migration 2026_11_23_0001), for
// src/modules/media. Each function runs inside withTenant (a Tx): the organisation and publication walls apply.
import { randomBytes } from "node:crypto";
import { MediaIngestPayload } from "@pageinator/contracts";
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
  upload: {
    purpose: "story_photo" | "library" | "docx" | "engine_dataset" | "onboard_pdf";
    type: string;
    bytes: number;
    expiresSeconds: number;
    /** kept for a past edition's PDF only (its edition's date may be read from it) */
    filename?: string;
  },
) {
  return tx
    .insertInto("app.upload")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      user_id: who.userId,
      purpose: upload.purpose,
      declared_type: upload.type,
      declared_bytes: String(upload.bytes), // bigint: a dataset bundle may be up to 4 GiB
      filename: upload.purpose === "onboard_pdf" ? (upload.filename ?? null) : null,
      expires_at: sql`now() + make_interval(secs => ${upload.expiresSeconds})`,
    })
    .returning(["id", "key", "expires_at"])
    .executeTakeFirstOrThrow();
}

export async function findUpload(tx: Tx, publicationId: string, uploadId: string, lock = false) {
  const query = tx
    .selectFrom("app.upload")
    .select([
      "id",
      "user_id",
      "purpose",
      "key",
      "status",
      "asset_id",
      "import_id",
      "engine_profile_id",
      "onboarding_id",
      "filename",
      "declared_type",
      "declared_bytes",
    ])
    .where("publication_id", "=", publicationId)
    .where("id", "=", uploadId);
  const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
  // at most 4 GiB (the table's check): exact as a number
  return row && { ...row, declared_bytes: Number(row.declared_bytes) };
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
  status: "received" | "ready" | "rejected" | "failed";
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  width_px: number;
  height_px: number;
  sha256: string;
  desk_key: string;
  original_key: string;
  version_id: string | null;
  uploaded_by: string;
  revision: number;
  created_at: Date;
  /** a found photo's label (the news finder), else null; a needs_permission one is attached only once ticked */
  licence_label: "safe" | "needs_permission" | null;
  rights_confirmed_at: Date | null;
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
  "revision",
  "created_at",
  "licence_label",
  "rights_confirmed_at",
] as const;

/** The asset, not deleted; lock "share" holds it against a delete until the transaction ends (a story's photo is
 * attached under it, so the library's delete, which locks it "update", sees the attachment or the attach sees the
 * delete). */
export async function findAsset(
  tx: Tx,
  publicationId: string,
  assetId: string,
  lock?: "share" | "update",
): Promise<AssetRow | undefined> {
  const query = tx
    .selectFrom("app.asset")
    .select(ASSET)
    .where("publication_id", "=", publicationId)
    .where("id", "=", assetId)
    .where("deleted_at", "is", null);
  const locked = lock === "share" ? query.forShare() : lock === "update" ? query.forUpdate() : query;
  return (await locked.executeTakeFirst()) as AssetRow | undefined;
}

/** The publication's asset with these bytes, if any (one asset per picture and publication; a rejected or failed one is
 * not found, and the same bytes sent again make a new asset, tried afresh). */
export async function assetWithBytes(tx: Tx, publicationId: string, sha256: string): Promise<AssetRow | undefined> {
  return (await tx
    .selectFrom("app.asset")
    .select(ASSET)
    .where("publication_id", "=", publicationId)
    .where("sha256", "=", sha256)
    .where("status", "not in", ["rejected", "failed"])
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

/** Which of these assets the person uploaded (first, or again: their upload deduplicated to it). */
export async function uploadedByOf(tx: Tx, publicationId: string, assetIds: readonly string[], userId: string) {
  if (assetIds.length === 0) return new Set<string>();
  const rows = await tx
    .selectFrom("app.upload")
    .select("asset_id")
    .where("publication_id", "=", publicationId)
    .where("asset_id", "in", [...assetIds])
    .where("user_id", "=", userId)
    .where("status", "=", "completed")
    .execute();
  return new Set(rows.map((row) => row.asset_id as string));
}

/** Enqueues the asset's print versions (media.ingest: ids only, job_key asset:<id>) in the caller's transaction, through
 * app.enqueue_media_ingest, which refuses another organisation's (migration 2026_11_27_0001): a rollback leaves no job. */
export async function enqueueMediaIngest(
  tx: Tx,
  job: { orgId: string; publicationId: string; assetId: string; versionId: string; sha256: string },
): Promise<void> {
  const payload = MediaIngestPayload.parse({
    org_id: job.orgId,
    pub_id: job.publicationId,
    asset_id: job.assetId,
    version_id: job.versionId,
    sha256: job.sha256,
  });
  await sql`select app.enqueue_media_ingest(${payload.org_id}::uuid, ${payload.pub_id}::uuid, ${payload.asset_id}::uuid,
    ${payload.version_id}, ${payload.sha256})`.execute(tx);
}

// The media library (docs/product/10-l2-newsroom-plan.md §5.3; migration 2026_11_29_0001).

export type LibraryRow = AssetRow & {
  problem: string | null;
  caption: string;
  credit: string;
  photographer: string;
  updated_at: Date;
  uploaded_by_name: string;
  licence_name: string | null;
  licence_url: string | null;
  source_url: string | null;
  rights_confirmed_by: string | null;
  rights_confirmed_by_name: string | null;
  /** created_at to the microsecond (UTC), for the list's cursor */
  created_cursor: string;
};

export type LibraryFilter = {
  publicationId: string;
  /** one asset only (GET …/assets/:a) */
  id?: string;
  /** a Reporter's ◐: the pictures they uploaded (first, or again), and those that are the photo of one of their
   * stories while not refused or failed */
  mine?: string;
  /** the pictures that are this story's photo */
  story?: string;
  missing?: "caption" | "credit";
  q?: string;
  /** the pictures too narrow to print sharp across this many millimetres (MIN_PPI: width·25.4 < 150·mm) */
  tooNarrowForMm?: number;
  /** ready pictures only (an ad slot's picker without media.view) */
  readyOnly?: boolean;
  after?: { createdAt: string; id: string };
  limit: number;
};

/** The publication's pictures not deleted, newest first, as the filter narrows them. */
export async function listLibrary(tx: Tx, f: LibraryFilter): Promise<LibraryRow[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const mine = f.mine ?? null;
  const story = f.story ?? null;
  const { rows } = await sql<LibraryRow>`
    select a.id, a.publication_id, a.status, a.problem, a.mime, a.bytes, a.width_px, a.height_px, a.sha256,
      a.desk_key, a.original_key, a.version_id, a.uploaded_by, up.display_name as uploaded_by_name, a.caption,
      a.credit, a.photographer, a.revision, a.created_at, a.updated_at, a.licence_name, a.licence_url, a.source_url,
      a.licence_label, a.rights_confirmed_by, rp.display_name as rights_confirmed_by_name, a.rights_confirmed_at,
      to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_cursor
    from app.asset a
    join app.person up on up.org_id = a.org_id and up.user_id = a.uploaded_by
    left join app.person rp on rp.org_id = a.org_id and rp.user_id = a.rights_confirmed_by
    where a.publication_id = ${f.publicationId} and a.deleted_at is null
      and (${f.id ?? null}::uuid is null or a.id = ${f.id ?? null}::uuid)
      and (${mine}::uuid is null or a.uploaded_by = ${mine}::uuid
        or exists (select 1 from app.upload u
          where u.org_id = a.org_id and u.publication_id = a.publication_id and u.asset_id = a.id
            and u.user_id = ${mine}::uuid and u.status = 'completed')
        or (a.status not in ('rejected', 'failed') and exists (select 1 from app.story_photo sp
          join app.story s on s.org_id = sp.org_id and s.publication_id = sp.publication_id and s.id = sp.story_id
          where sp.org_id = a.org_id and sp.publication_id = a.publication_id and sp.asset_id = a.id
            and s.deleted_at is null and (s.reporter_id = ${mine}::uuid or s.assignee_id = ${mine}::uuid))))
      and (${story}::uuid is null or exists (select 1 from app.story_photo sp
        join app.story s on s.org_id = sp.org_id and s.publication_id = sp.publication_id and s.id = sp.story_id
        where sp.org_id = a.org_id and sp.publication_id = a.publication_id and sp.asset_id = a.id
          and sp.story_id = ${story}::uuid and s.deleted_at is null))
      and (not ${f.readyOnly ?? false}::boolean or (a.status = 'ready' and a.version_id is not null))
      and (${f.missing ?? null}::text is distinct from 'caption' or a.caption = '')
      and (${f.missing ?? null}::text is distinct from 'credit' or a.credit = '')
      and (${like}::text is null or a.caption ilike ${like} or a.credit ilike ${like} or a.photographer ilike ${like})
      and (${f.tooNarrowForMm ?? null}::double precision is null
        or a.width_px * 25.4 < 150 * ${f.tooNarrowForMm ?? null}::double precision)
      and (${f.after?.createdAt ?? null}::timestamptz is null
        or (a.created_at, a.id) < (${f.after?.createdAt ?? null}::timestamptz, ${f.after?.id ?? null}::uuid))
    order by a.created_at desc, a.id desc
    limit ${f.limit}`.execute(tx);
  return rows;
}

/** The stories (not deleted) whose photo each asset is, with what decides who may see them. */
export async function usesOf(tx: Tx, publicationId: string, assetIds: readonly string[]) {
  if (assetIds.length === 0) return [];
  const { rows } = await sql<{
    asset_id: string;
    story_id: string;
    headline: string;
    status: string;
    reporter_id: string;
    assignee_id: string | null;
  }>`
    select sp.asset_id, s.id as story_id, r.headline, s.status, s.reporter_id, s.assignee_id
    from app.story_photo sp
    join app.story s on s.org_id = sp.org_id and s.publication_id = sp.publication_id and s.id = sp.story_id
    join app.story_revision r
      on r.org_id = s.org_id and r.publication_id = s.publication_id and r.story_id = s.id and r.rev = s.current_rev
    where sp.publication_id = ${publicationId} and sp.asset_id = any(${[...assetIds]}::uuid[])
      and s.deleted_at is null
    order by s.updated_at desc, s.id`.execute(tx);
  return rows;
}

/** Changes the asset's own facts on its version; false when it is not at that version (or is gone). */
export async function editAsset(
  tx: Tx,
  publicationId: string,
  assetId: string,
  baseRevision: number,
  facts: { caption?: string; credit?: string; photographer?: string },
): Promise<boolean> {
  const done = await tx
    .updateTable("app.asset")
    .set({ ...facts, revision: sql`revision + 1`, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", assetId)
    .where("revision", "=", baseRevision)
    .where("deleted_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  return done !== undefined;
}

/** Whether a story (not deleted) has the asset as its photo. */
export async function inUse(tx: Tx, publicationId: string, assetId: string): Promise<boolean> {
  return (await usesOf(tx, publicationId, [assetId])).length > 0;
}

/** Deletes the asset (deleted_at; its bytes stay in the store). The caller holds it locked "update". */
export async function deleteAsset(tx: Tx, publicationId: string, assetId: string): Promise<void> {
  await tx
    .updateTable("app.asset")
    .set({ deleted_at: sql`now()`, updated_at: sql`now()`, revision: sql`revision + 1` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", assetId)
    .execute();
}

/** "We have the right to print this", ticked on a found photo by this person now; false when it was ticked already (or
 * is not a found photo). */
export async function confirmRights(tx: Tx, publicationId: string, assetId: string, userId: string): Promise<boolean> {
  const done = await tx
    .updateTable("app.asset")
    .set({ rights_confirmed_by: userId, rights_confirmed_at: sql`now()`, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", assetId)
    .where("deleted_at", "is", null)
    .where("licence_label", "is not", null)
    .where("rights_confirmed_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  return done !== undefined;
}

/** A found photo's own facts (the news finder): its caption, credit and photographer, where it came from, its licence
 * and the label code gave it. */
export async function setFoundPhoto(
  tx: Tx,
  publicationId: string,
  assetId: string,
  facts: {
    caption: string;
    credit: string;
    photographer: string;
    licence_name: string;
    licence_url: string | null;
    source_url: string;
    licence_label: "safe" | "needs_permission";
  },
): Promise<void> {
  await tx
    .updateTable("app.asset")
    .set({ ...facts, revision: sql`revision + 1`, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", assetId)
    .execute();
}
