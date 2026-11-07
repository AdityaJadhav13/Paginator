// Onboarding a new paper in the database (packages/contracts/src/onboard.ts; migration 2026_12_07_0001), for
// src/modules/onboarding. Every function runs under withTenant, so the organisation and publication walls apply: an id
// of another organisation or publication finds nothing. The enqueue goes through app.enqueue_engine_onboard, in the
// caller's transaction (a rollback leaves no job), its payload checked with its contract first.
import { EngineOnboardPayload, type FileCheck, type OnboardReport, type OnboardingState } from "@pageinator/contracts";
import { sql } from "kysely";
import type { Tenant, Tx } from "./tenant.ts";

export const ONBOARDING_ACTIVE: readonly OnboardingState[] = ["queued", "working"];

export type OnboardFile = { n: number; name: string; bytes: number; version_id?: string; sha256: string };
export type OnboardProgressValue = { step: string; done: number; total: number };

export type OnboardingRow = {
  id: string;
  state: OnboardingState;
  inputs_key: string;
  inputs_sha256: string | null;
  files: OnboardFile[];
  progress: OnboardProgressValue | null;
  checks: FileCheck[] | null;
  report: OnboardReport | null;
  dataset_key: string;
  dataset_version_id: string | null;
  dataset_sha256: string | null;
  dataset_bytes: string | null;
  problem: string | null;
  params: Record<string, string | number> | null;
  message: string | null;
  profile_id: string | null;
  heartbeat_at: Date | null;
  created_by: string;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
};

const ONBOARDING = sql`
  select o.id, o.state, o.inputs_key, o.inputs_sha256, o.files, o.progress, o.checks, o.report, o.dataset_key,
    o.dataset_version_id, o.dataset_sha256, o.dataset_bytes, o.problem, o.params, o.message, o.profile_id,
    o.heartbeat_at, o.created_by, cb.display_name as created_by_name, o.created_at, o.updated_at
  from app.paper_onboarding o
  left join app.person cb on cb.org_id = o.org_id and cb.user_id = o.created_by`;

/** The publication's active onboarding (queued or working), if any. `lock`: the publication's row is locked first, so a
 * check and a new onboarding that follows it take turns with another. */
export async function activeOnboarding(tx: Tx, publicationId: string, lock = false) {
  if (lock) await sql`select 1 from app.publication where id = ${publicationId} for update`.execute(tx);
  const { rows } = await sql<OnboardingRow>`${ONBOARDING}
    where o.publication_id = ${publicationId} and o.state in ('queued', 'working')`.execute(tx);
  return rows[0];
}

export async function findOnboarding(tx: Tx, publicationId: string, id: string, lock = false) {
  const { rows } = await sql<OnboardingRow>`${ONBOARDING}
    where o.publication_id = ${publicationId} and o.id = ${id} ${lock ? sql`for update of o` : sql``}`.execute(tx);
  return rows[0];
}

/** The publication's onboardings, newest first. */
export async function listOnboardings(tx: Tx, publicationId: string, limit: number): Promise<OnboardingRow[]> {
  const { rows } = await sql<OnboardingRow>`${ONBOARDING}
    where o.publication_id = ${publicationId} order by o.created_at desc, o.id desc limit ${limit}`.execute(tx);
  return rows;
}

/** A new onboarding (queued), its files as sent; the person confirmed the paper's permission. */
export async function createOnboarding(tx: Tx, who: Tenant, publicationId: string, files: OnboardFile[]) {
  const { rows } = await sql<{ id: string; inputs_key: string }>`
    insert into app.paper_onboarding (org_id, publication_id, files, permission_confirmed_by, created_by)
    values (${who.orgId}, ${publicationId}, ${JSON.stringify(files)}::jsonb, ${who.userId}, ${who.userId})
    returning id, inputs_key`.execute(tx);
  const made = rows[0];
  if (!made) throw new Error("the onboarding was not made");
  return made;
}

/** Its files as copied (each with its version) and its inputs file, pinned. */
export async function setOnboardingInputs(
  tx: Tx,
  publicationId: string,
  id: string,
  inputs: { files: OnboardFile[]; versionId: string; sha256: string },
) {
  await sql`update app.paper_onboarding set files = ${JSON.stringify(inputs.files)}::jsonb,
      inputs_version_id = ${inputs.versionId}, inputs_sha256 = ${inputs.sha256}
    where publication_id = ${publicationId} and id = ${id}`.execute(tx);
}

export async function completeUploadsAsOnboarding(tx: Tx, publicationId: string, uploadIds: string[], id: string) {
  await sql`update app.upload set status = 'completed', onboarding_id = ${id}, completed_at = now()
    where publication_id = ${publicationId} and id = any (${uploadIds}::uuid[])`.execute(tx);
}

export type OnboardingUpdate =
  | { state: "working"; progress: OnboardProgressValue }
  | {
      state: "ready";
      checks: FileCheck[];
      report: OnboardReport;
      dataset: { version_id: string; sha256: string; bytes: number };
    }
  | {
      state: "rejected" | "failed";
      checks?: FileCheck[];
      problem: string;
      params: Record<string, string | number> | null;
      message: string;
    }
  | { state: "cancelled" }
  | { state: "used"; profileId: string };

export async function updateOnboarding(tx: Tx, publicationId: string, id: string, u: OnboardingUpdate) {
  const json = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));
  const p = u as Partial<{
    progress: unknown;
    checks: unknown;
    report: unknown;
    dataset: { version_id: string; sha256: string; bytes: number };
    problem: string;
    params: unknown;
    message: string;
    profileId: string;
  }>;
  await sql`update app.paper_onboarding set state = ${u.state},
      progress = coalesce(${json(p.progress)}::jsonb, progress),
      heartbeat_at = case when ${u.state === "working"} then now() else heartbeat_at end,
      checks = coalesce(${json(p.checks)}::jsonb, checks),
      report = coalesce(${json(p.report)}::jsonb, report),
      dataset_version_id = coalesce(${p.dataset?.version_id ?? null}, dataset_version_id),
      dataset_sha256 = coalesce(${p.dataset?.sha256 ?? null}, dataset_sha256),
      dataset_bytes = coalesce(${p.dataset?.bytes ?? null}::bigint, dataset_bytes),
      problem = coalesce(${p.problem ?? null}, problem),
      params = coalesce(${json(p.params)}::jsonb, params),
      message = coalesce(${p.message ?? null}, message),
      profile_id = coalesce(${p.profileId ?? null}::uuid, profile_id),
      updated_at = now()
    where publication_id = ${publicationId} and id = ${id}`.execute(tx);
}

export async function enqueueEngineOnboard(tx: Tx, payload: EngineOnboardPayload): Promise<void> {
  const checked = EngineOnboardPayload.parse(payload);
  await sql`select app.enqueue_engine_onboard(${checked.org_id}::uuid, ${JSON.stringify(checked)}::jsonb)`.execute(tx);
}

/** The first date counting back from 2099-12-31 the publication has no edition on: a test edition's, far from any real
 * one (an edition has no name, only its date). */
export async function freeTestDate(tx: Tx, publicationId: string): Promise<string> {
  const { rows } = await sql<{ date: string }>`
    select to_char(d, 'YYYY-MM-DD') as date from generate_series('2099-12-31'::date, '2090-01-01'::date, '-1 day') d
    where not exists (select 1 from app.edition e where e.publication_id = ${publicationId} and e.edition_date = d)
    order by d desc limit 1`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("no free date for a test edition");
  return row.date;
}

/** For the sweep: queued onboardings past the deadline with no job left (`withJobs`) and no event waiting (lost), and
 * working ones whose worker has not reported for `staleMs` with none of its events waiting (stalled). */
export async function strandedOnboardings(tx: Tx, deadlineMs: number, staleMs: number, withJobs: ReadonlySet<string>) {
  const noEvent = sql`not exists (select 1 from app.engine_event ev
    where ev.org_id = o.org_id and ev.asset_id = o.id and ev.processed_at is null)`;
  const { rows } = await sql<{ id: string; publication_id: string; stalled: boolean }>`
    select o.id, o.publication_id, o.state = 'working' as stalled from app.paper_onboarding o
    where ${noEvent} and (
      (o.state = 'queued' and o.created_at < now() - ${deadlineMs} * interval '1 millisecond'
       and not (o.id = any (${[...withJobs]}::uuid[])))
      or (o.state = 'working'
          and coalesce(o.heartbeat_at, o.created_at) < now() - ${staleMs} * interval '1 millisecond'))
    limit 100`.execute(tx);
  return rows;
}
