// Word imports in the database (docs/product/10-l2-newsroom-plan.md §5.3; migration 2026_11_30_0001), for
// src/modules/media/imports.ts. Every function runs under withTenant, so the organisation and publication walls apply.
import { DocxImportPayload } from "@pageinator/contracts";
import { sql } from "kysely";
import type { Tenant, Tx } from "./tenant.ts";

export type ImportRow = {
  id: string;
  user_id: string;
  edition_id: string | null;
  original_key: string;
  version_id: string | null;
  sha256: string;
  state: "queued" | "running" | "done" | "failed";
  created: { storyId: string; headline: string }[];
  skipped: number;
  notes: { code: string; count: number | null; text: string }[];
  problem: string | null;
  message: string | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = [
  "id",
  "user_id",
  "edition_id",
  "original_key",
  "version_id",
  "sha256",
  "state",
  "created",
  "skipped",
  "notes",
  "problem",
  "message",
  "created_at",
  "updated_at",
] as const;

export async function createImport(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  input: { uploadId: string; editionId: string | null; sha256: string; bytes: number },
) {
  return tx
    .insertInto("app.import_job")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      user_id: who.userId,
      upload_id: input.uploadId,
      edition_id: input.editionId,
      sha256: input.sha256,
      bytes: input.bytes,
    })
    .returning(["id", "original_key"])
    .executeTakeFirstOrThrow();
}

export async function setImportVersion(tx: Tx, publicationId: string, importId: string, versionId: string) {
  await tx
    .updateTable("app.import_job")
    .set({ version_id: versionId })
    .where("publication_id", "=", publicationId)
    .where("id", "=", importId)
    .execute();
}

export async function completeUploadAsImport(tx: Tx, publicationId: string, uploadId: string, importId: string) {
  await tx
    .updateTable("app.upload")
    .set({ status: "completed", import_id: importId, completed_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", uploadId)
    .execute();
}

/** The import, locked for this transaction when asked (the inbox settles it once). */
export async function findImport(tx: Tx, publicationId: string, importId: string, lock = false) {
  const query = tx
    .selectFrom("app.import_job")
    .select(COLUMNS)
    .where("publication_id", "=", publicationId)
    .where("id", "=", importId);
  return (await (lock ? query.forUpdate() : query).executeTakeFirst()) as ImportRow | undefined;
}

export async function settleImport(
  tx: Tx,
  publicationId: string,
  importId: string,
  outcome:
    | { state: "done"; created: ImportRow["created"]; skipped: number; notes: ImportRow["notes"] }
    | { state: "failed"; problem: string; message: string },
): Promise<void> {
  const set =
    outcome.state === "done"
      ? {
          state: "done",
          created: JSON.stringify(outcome.created),
          skipped: outcome.skipped,
          notes: JSON.stringify(outcome.notes),
        }
      : { state: "failed", problem: outcome.problem, message: outcome.message.slice(0, 2000) };
  await tx
    .updateTable("app.import_job")
    .set({ ...set, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", importId)
    .execute();
}

/** Enqueues the import's reading (docx.import: ids only, job_key import:<id>) in the caller's transaction, through
 * app.enqueue_docx_import, which refuses another organisation's: a rollback leaves no job. */
export async function enqueueDocxImport(
  tx: Tx,
  job: { orgId: string; publicationId: string; importId: string; versionId: string; sha256: string },
): Promise<void> {
  const payload = DocxImportPayload.parse({
    org_id: job.orgId,
    pub_id: job.publicationId,
    import_id: job.importId,
    version_id: job.versionId,
    sha256: job.sha256,
  });
  await sql`select app.enqueue_docx_import(${payload.org_id}::uuid, ${payload.pub_id}::uuid,
    ${payload.import_id}::uuid, ${payload.version_id}, ${payload.sha256})`.execute(tx);
}

/** Imports still queued past the deadline with no job left in the queue (`withJobs`, read by the sweep's system
 * reader) and no event waiting in the inbox: nothing will ever settle them. */
export async function strandedImports(tx: Tx, deadlineMs: number, withJobs: ReadonlySet<string>) {
  const { rows } = await sql<{ id: string; publication_id: string }>`
    select i.id, i.publication_id from app.import_job i
    where i.state = 'queued' and i.updated_at < now() - ${deadlineMs} * interval '1 millisecond'
      and not (i.id = any (${[...withJobs]}::uuid[]))
      and not exists (select 1 from app.engine_event e
                      where e.org_id = i.org_id and e.asset_id = i.id and e.processed_at is null)
    order by i.updated_at limit 100`.execute(tx);
  return rows;
}
