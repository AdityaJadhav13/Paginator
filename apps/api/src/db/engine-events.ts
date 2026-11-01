// The engine's event inbox and the queue's sweep in the database (docs/product/10-l2-newsroom-plan.md §2.2; migration
// 2026_11_27_0001), for src/modules/media/engine-inbox.ts.
// - waitingEvents runs as the system reader 'engine-consumer' (every organisation's unprocessed rows, ids only); every
//   other inbox function runs under withTenant of the event's organisation, so the asset it names must be that
//   organisation's and publication's to be found at all.
// - The sweep reads and removes jobs as the system reader 'engine-sweep' (exhaustedJobs, removeSpentJob, jobAssets),
//   and writes each failure to the inbox under the job's organisation.
import { exhaustedJobs, type ExhaustedJob } from "@pageinator/engine-queue";
import { CompiledQuery, sql } from "kysely";
import type { Pool } from "pg";
import type { SystemTx, Tx } from "./tenant.ts";

/** The inbox's rows waiting to be applied, oldest first: their organisation, and the publication their payload names
 * (an untrusted hint, used only to open that publication's wall; null when it is not an id). */
export async function waitingEvents(tx: SystemTx, limit: number) {
  const { rows } = await sql<{ id: string; org_id: string; pub_id: string | null }>`
    select id, org_id,
      case when payload->>'pub_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then payload->>'pub_id' end as pub_id
    from app.engine_event where processed_at is null and (retry_at is null or retry_at <= now())
    order by id limit ${limit}`.execute(tx);
  return rows;
}

/** An event that could not be applied (an error, not a refusal) waits before it is tried again: 5 s, doubled each try,
 * at most 10 minutes. Kept in its row, so every API instance and a restart see it. Returns its tries so far. */
export async function deferEvent(tx: Tx, id: string): Promise<number> {
  const { rows } = await sql<{ tries: number }>`
    update app.engine_event set tries = tries + 1,
      retry_at = now() + least(5 * power(2, tries), 600) * interval '1 second'
    where id = ${id} and processed_at is null returning tries`.execute(tx);
  return rows[0]?.tries ?? 0;
}

/** The event, locked for this transaction, while it is still waiting; undefined when another consumer has it or had it. */
export async function takeEvent(tx: Tx, id: string) {
  const { rows } = await sql<{ id: string; job_id: string; kind: string; asset_id: string; payload: unknown }>`
    select id, job_id, kind, asset_id, payload from app.engine_event
    where id = ${id} and processed_at is null for update skip locked`.execute(tx);
  return rows[0];
}

export type Outcome = "applied" | "ignored" | "refused";

export async function settleEvent(tx: Tx, id: string, outcome: Outcome): Promise<void> {
  await sql`update app.engine_event set processed_at = now(), outcome = ${outcome} where id = ${id}`.execute(tx);
}

/** The asset an event names, locked: in the publication the tenant reaches, deleted or not (a deleted one ignores it). */
export async function assetForEvent(tx: Tx, publicationId: string, assetId: string) {
  const { rows } = await sql<{ id: string; status: string; sha256: string; original_key: string; deleted: boolean }>`
    select id, status, sha256, original_key, deleted_at is not null as deleted from app.asset
    where publication_id = ${publicationId} and id = ${assetId} for update`.execute(tx);
  return rows[0];
}

export async function settleAsset(
  tx: Tx,
  publicationId: string,
  assetId: string,
  status: "ready" | "rejected" | "failed",
  problem: string | null,
): Promise<void> {
  await sql`update app.asset set status = ${status}, problem = ${problem}, updated_at = now()
    where publication_id = ${publicationId} and id = ${assetId}`.execute(tx);
}

export type RenditionRow = {
  purpose: string;
  params_hash: string;
  key: string;
  version_id: string;
  sha256: string;
  bytes: number;
  mime: string;
  width_px: number;
  height_px: number;
};

export async function addRenditions(
  tx: Tx,
  orgId: string,
  publicationId: string,
  assetId: string,
  renditions: readonly RenditionRow[],
): Promise<void> {
  await tx
    .insertInto("app.rendition")
    .values(renditions.map((r) => ({ ...r, org_id: orgId, publication_id: publicationId, asset_id: assetId })))
    .onConflict((conflict) => conflict.doNothing())
    .execute();
}

/** The asset's rendition for a purpose (the newest, should the profile have changed), or undefined. */
export async function renditionOf(tx: Tx, publicationId: string, assetId: string, purpose: "preview" | "thumb") {
  return tx
    .selectFrom("app.rendition")
    .select(["key", "version_id", "mime"])
    .where("publication_id", "=", publicationId)
    .where("asset_id", "=", assetId)
    .where("purpose", "=", purpose)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** Writes a failure to the inbox; false when it was dropped (the job id has an event already: the job had reported). */
export async function reportToInbox(
  tx: Tx,
  event: { orgId: string; jobId: string; assetId: string; payload: object },
): Promise<boolean> {
  const { numAffectedRows } = await sql`insert into app.engine_event (org_id, job_id, kind, asset_id, payload)
    values (${event.orgId}, ${event.jobId}, 'job.failed', ${event.assetId}, ${JSON.stringify(event.payload)})
    on conflict do nothing`.execute(tx);
  return (numAffectedRows ?? 0n) > 0n;
}

/** Removes a job that is still out of attempts and not held by a live worker (as exhaustedJobs found it; the
 * database's policy also waits an hour for a locked one). */
export async function removeSpentJob(tx: SystemTx, jobId: string, staleMs: number): Promise<void> {
  await sql`delete from queue._private_jobs where id = ${jobId}::bigint and attempts >= max_attempts
    and (locked_at is null or locked_at < now() - ${staleMs} * interval '1 millisecond')`.execute(tx);
}

/** Jobs out of attempts that nobody will settle (apps/engine-queue's exhaustedJobs). */
export function spentJobs(tx: SystemTx, staleMs: number): Promise<ExhaustedJob[]> {
  return exhaustedJobs(async (text, values = []) => {
    const { rows } = await tx.executeQuery<Record<string, unknown>>(CompiledQuery.raw(text, [...values]));
    return { rows };
  }, staleMs);
}

/** The assets that still have a job in the queue (job key asset:<id>), of every organisation: ids only. */
export async function jobAssets(tx: SystemTx): Promise<Set<string>> {
  const { rows } = await sql<{ id: string }>`
    select substr(key, 7) as id from queue._private_jobs where key ~ '^asset:[0-9a-f-]{36}$'`.execute(tx);
  return new Set(rows.map((row) => row.id));
}

/** Every organisation's id (Better Auth's table, on the auth pool): the sweep visits each under its own walls. */
export async function organisationIds(auth: Pool): Promise<string[]> {
  const { rows } = await auth.query<{ id: string }>(`select id from identity.organization order by id`);
  return rows.map((row) => row.id);
}

/** The organisation's publications (the organisation wall only). */
export async function publicationIds(tx: Tx): Promise<string[]> {
  return (await tx.selectFrom("app.publication").select("id").execute()).map((row) => row.id);
}

/** Assets still waiting for their print versions past the deadline, with no job left in the queue (`withJobs`, read
 * by the sweep's system reader) and no event waiting in the inbox: nothing will ever settle them. */
export async function strandedAssets(tx: Tx, deadlineMs: number, withJobs: ReadonlySet<string>) {
  const { rows } = await sql<{ id: string; publication_id: string }>`
    select a.id, a.publication_id from app.asset a
    where a.status = 'received' and a.deleted_at is null
      and a.updated_at < now() - ${deadlineMs} * interval '1 millisecond'
      and not (a.id = any (${[...withJobs]}::uuid[]))
      and not exists (select 1 from app.engine_event e
                      where e.org_id = a.org_id and e.asset_id = a.id and e.processed_at is null)
    order by a.updated_at limit 100`.execute(tx);
  return rows;
}
