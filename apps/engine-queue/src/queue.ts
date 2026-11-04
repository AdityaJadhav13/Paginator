// The engine's queue: Graphile Worker in schema `queue` (plan §2.2), run as `pgn_engine`, which may only take and finish
// jobs there (ENGINE_GRANTS). The schema is installed and upgraded by the migrator (the API's migrations), never by the
// worker: Graphile Worker installs only when its tables are missing, and `pgn_engine` cannot create them.
import { run, type Runner } from "graphile-worker";
import pg from "pg";
import { healthy, type RunnerSettings } from "./runner.ts";
import type { Query } from "./schema.ts";
import type { NewsDeps } from "./news/group.ts";
import { QUEUE_SCHEMA, taskList, type Report } from "./tasks.ts";

export { QUEUE_SCHEMA };

/** Attempts per job. Graphile Worker waits exp(attempts) seconds (attempts capped at 10) after each failure, so ten
 * attempts spread over about 3.6 hours (e¹ + … + e⁹ s): a store or a profile outage of that long is ridden out. */
export const MAX_ATTEMPTS = 10;

/** What `pgn_engine` needs to run jobs (Graphile Worker 0.18.0's own statements, read in its source), granted by the
 * migration that installs Graphile Worker, after it. Table by table, never "all tables": a Graphile Worker upgrade
 * that adds or renames a table must be read again and re-granted here. known_crontabs is only read (Graphile
 * Worker's cron reads it at start even with no cron item, cron.js; with none it writes nothing), no
 * INSERT on jobs (only the API enqueues, through APP_ENQUEUE), no function, no sequence (identity columns). Graphile Worker turns row-level security
 * on for its private tables with no policy (only their owner sees rows), and `pgn_engine` is NOBYPASSRLS: a policy
 * per command for `pgn_engine` alone opens them to it. The database's TEMP and CONNECT for PUBLIC (and CONNECT to the
 * `postgres` database) are revoked by the role setup (infra/docker/postgres-init.sql; the same on the pilot's server).
 */
export const ENGINE_GRANTS = `
grant usage on schema queue to pgn_engine;
grant select on queue.migrations to pgn_engine;
grant select, update, delete on queue._private_jobs to pgn_engine;
grant select, update on queue._private_job_queues to pgn_engine;
grant select, insert on queue._private_tasks to pgn_engine;
grant select on queue._private_known_crontabs to pgn_engine;
create policy engine_takes_jobs on queue._private_jobs for select to pgn_engine using (true);
create policy engine_locks_jobs on queue._private_jobs for update to pgn_engine using (true) with check (true);
create policy engine_finishes_jobs on queue._private_jobs for delete to pgn_engine using (true);
create policy engine_takes_queues on queue._private_job_queues for select to pgn_engine using (true);
create policy engine_locks_queues on queue._private_job_queues for update to pgn_engine using (true) with check (true);
create policy engine_reads_tasks on queue._private_tasks for select to pgn_engine using (true);
create policy engine_names_tasks on queue._private_tasks for insert to pgn_engine with check (true);
create policy engine_reads_crontabs on queue._private_known_crontabs for select to pgn_engine using (true);
`;

/** The API's only way to enqueue (plan §2.2 step 1): queue.add_job is not SECURITY DEFINER, and a new function is
 * PUBLIC's to execute, so the migrator (as the owner of `queue`) makes this wrapper in `app`, which only `pgn_app` may
 * run, with its search_path pinned, and takes EXECUTE on every function in `queue` from PUBLIC. It builds the ids-only
 * payload itself, and only for the organisation of the caller's transaction (app.current_org(), which withTenant
 * sets): another organisation's job is refused (42501), as is a call outside withTenant. */
export const APP_ENQUEUE = `
create function app.enqueue_media_ingest(org_id uuid, pub_id uuid, asset_id uuid, version_id text, sha256 text)
returns bigint language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if org_id is null or org_id is distinct from app.current_org() then
    raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
  end if;
  return (queue.add_job('media.ingest',
    json_build_object('org_id', org_id, 'pub_id', pub_id, 'asset_id', asset_id, 'version_id', version_id,
                      'sha256', sha256),
    max_attempts => ${MAX_ATTEMPTS}, job_key => 'asset:' || asset_id)).id;
end
$$;
revoke execute on function app.enqueue_media_ingest(uuid, uuid, uuid, text, text) from public;
grant execute on function app.enqueue_media_ingest(uuid, uuid, uuid, text, text) to pgn_app;
revoke execute on all functions in schema queue from public;
`;

/** docx.import's enqueue (L2.2), made by migration 2026_11_30_0001 as APP_ENQUEUE is: SECURITY DEFINER, pgn_app's
 * only, ids-only payload, only for app.current_org(); job key import:<id>, so an import has one job. */
export const APP_ENQUEUE_DOCX = `
create function app.enqueue_docx_import(org_id uuid, pub_id uuid, import_id uuid, version_id text, sha256 text)
returns bigint language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if org_id is null or org_id is distinct from app.current_org() then
    raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
  end if;
  return (queue.add_job('docx.import',
    json_build_object('org_id', org_id, 'pub_id', pub_id, 'import_id', import_id, 'version_id', version_id,
                      'sha256', sha256),
    max_attempts => ${MAX_ATTEMPTS}, job_key => 'import:' || import_id)).id;
end
$$;
revoke execute on function app.enqueue_docx_import(uuid, uuid, uuid, text, text) from public;
grant execute on function app.enqueue_docx_import(uuid, uuid, uuid, text, text) to pgn_app;
`;

/** The news finder's enqueues (L2.7), made by migration 2026_12_01_0001 as APP_ENQUEUE is: SECURITY DEFINER, pgn_app's
 * only, only for app.current_org(). Unlike the photo and Word jobs their payload carries what the job needs (the
 * feeds' links, the known links' hashes, the articles' links and the house style: no secret, nothing a person wrote
 * but the house style), built and checked by the API (NewsCollectPayload, NewsDraftPayload) and checked again by the
 * task. Job keys news-collect:<pub> (one waiting collection per publication: a newer one replaces it) and
 * news-draft:<draft>. Fewer attempts than the engine's jobs: a collection runs again on its schedule, and a draft the
 * editor asks for again. */
export const NEWS_MAX_ATTEMPTS = 3;
export const APP_ENQUEUE_NEWS = `
create function app.enqueue_news_collect(org_id uuid, payload jsonb)
returns bigint language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if org_id is null or org_id is distinct from app.current_org() or payload->>'org_id' is distinct from org_id::text then
    raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
  end if;
  return (queue.add_job('news.collect', payload::json, max_attempts => ${NEWS_MAX_ATTEMPTS},
    job_key => 'news-collect:' || (payload->>'pub_id'))).id;
end
$$;
revoke execute on function app.enqueue_news_collect(uuid, jsonb) from public;
grant execute on function app.enqueue_news_collect(uuid, jsonb) to pgn_app;
create function app.enqueue_news_draft(org_id uuid, payload jsonb)
returns bigint language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if org_id is null or org_id is distinct from app.current_org() or payload->>'org_id' is distinct from org_id::text then
    raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
  end if;
  return (queue.add_job('news.draft', payload::json, max_attempts => ${NEWS_MAX_ATTEMPTS},
    job_key => 'news-draft:' || (payload->>'draft_id'))).id;
end
$$;
revoke execute on function app.enqueue_news_draft(uuid, jsonb) from public;
grant execute on function app.enqueue_news_draft(uuid, jsonb) to pgn_app;
`;

export type ExhaustedJob = {
  id: string;
  task_identifier: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_at: Date | null;
};

/** The jobs Graphile Worker will never run again and nobody settled (for the API's sweep, plan §2.2): attempts used
 * up, and not locked, or locked longer ago than `staleMs` (the process died on the last attempt; staleMs must exceed
 * the runner's time limit and the report's retries). Read through `query` (the API's sweep, as pgn_app under its
 * flag); the sweep reports job.failed for each (the inbox drops it when the job had reported) and then removes it. */
export async function exhaustedJobs(query: Query, staleMs: number): Promise<ExhaustedJob[]> {
  const { rows } = await query(
    `select j.id::text, t.identifier as task_identifier, j.payload, j.attempts, j.max_attempts, j.last_error, j.locked_at
     from ${QUEUE_SCHEMA}._private_jobs as j join ${QUEUE_SCHEMA}._private_tasks as t on t.id = j.task_id
     where j.attempts >= j.max_attempts
       and (j.locked_at is null or j.locked_at < now() - $1 * interval '1 millisecond')
     order by j.id`,
    [staleMs],
  );
  return rows as ExhaustedJob[];
}

/** How long past the runner's time limit a lock may last before its process counts as dead: the runner's group is
 * killed at the limit, its answer waited for at most 2 s, and its report tried 3 times (0.5 s and 2 s apart). */
export const LOCK_MARGIN_MS = 5 * 60_000;
/** How often the queue looks for such locks (and once at start-up). */
export const LOCK_CHECK_MS = 60_000;

/** Unlocks the jobs (and job queues) locked longer than `staleMs` ago: their process was killed (SIGKILL, a reboot, the
 * out-of-memory killer) without finishing them, which Graphile Worker would only notice after 4 hours. Graphile
 * Worker's own reset, sooner: the attempt stays spent, and the job runs again at once (or, out of attempts, is the
 * API's sweep's). Returns how many jobs it released. */
export async function releaseStaleLocks(query: Query, staleMs: number): Promise<number> {
  const { rows } = await query(
    `with jobs as (
       update ${QUEUE_SCHEMA}._private_jobs set locked_at = null, locked_by = null, run_at = greatest(run_at, now())
       where locked_at < now() - $1 * interval '1 millisecond' returning 1
     ), queues as ( -- run though unread: a data-modifying WITH always runs
       update ${QUEUE_SCHEMA}._private_job_queues set locked_at = null, locked_by = null
       where locked_at < now() - $1 * interval '1 millisecond' returning 1
     ) select (select count(*) from jobs)::int as n`,
    [staleMs],
  );
  return Number(rows[0]?.["n"] ?? 0);
}

export type QueueSettings = {
  connectionString: string; // as pgn_engine
  concurrency: number;
  runner: RunnerSettings;
  report: Report;
  /** the news finder's jobs: Claude (null: the AI part is off) */
  news?: NewsDeps;
  noHandleSignals?: boolean; // true when the process handles SIGTERM itself (then it calls stop())
};

/** Starts the queue once the worker's health command passes (else it rejects, and no job is taken). A job that finds
 * the worker misconfigured (`worker.config`) stops the queue, and the runner's promise then rejects: the process exits
 * non-zero for an operator to fix the worker, the job given back. Stopping waits for running jobs to finish (at most
 * the runner's time limit), and finishing or failing them in the database is awaited before the pool closes: the
 * deployment's stop grace period must be longer than `timeoutMs`. */
export async function startQueue(settings: QueueSettings): Promise<Runner> {
  const { timeoutMs } = settings.runner;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("the runner's time limit must be a positive number");
  if (!(await healthy(settings.runner)))
    throw new Error("the worker is not healthy (pgn_worker.health): the queue does not start");
  // a lock older than the runner's limit and its margin belongs to a process that is gone: released now and every minute
  const staleMs = timeoutMs + LOCK_MARGIN_MS;
  const locks = new pg.Pool({ connectionString: settings.connectionString, max: 1 });
  locks.on("error", () => {}); // an idle connection's error: the next check reconnects
  const release = async () => {
    const n = await releaseStaleLocks((text, values) => locks.query(text, values ? [...values] : undefined), staleMs);
    if (n > 0) console.warn(`The engine queue released ${n} job(s) locked by a process that is gone.`);
  };
  try {
    await release();
  } catch (error) {
    await locks.end();
    throw error;
  }
  const checking = setInterval(() => {
    release().catch((error: unknown) =>
      console.warn(
        `The engine queue could not check for stale locks: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }, LOCK_CHECK_MS);
  checking.unref();
  let misconfigured = false;
  let runner: Runner | null = null;
  const stopForConfig = () => {
    if (misconfigured) return;
    misconfigured = true;
    void runner?.stop("a job found the worker misconfigured (worker.config)");
  };
  try {
    runner = await run({
      connectionString: settings.connectionString,
      schema: QUEUE_SCHEMA,
      concurrency: settings.concurrency,
      noHandleSignals: settings.noHandleSignals ?? false,
      taskList: taskList(settings.runner, settings.report, stopForConfig, undefined, settings.news),
      // no cron item and no crontab file: `crontab: ""` is empty, so Graphile Worker would read ./crontab instead
      parsedCronItems: [],
      // running jobs end by themselves (the runner's own time limit) rather than by Graphile Worker's cancel
      gracefulShutdownAbortTimeout: timeoutMs + 5_000,
      // Graphile Worker 0.18 does not await an unbatched finish: a shutdown could close the pool first, leaving the job
      // locked for 4 hours. Batched (with no delay), the finishes are flushed and awaited before the pool closes.
      preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
    });
  } catch (error) {
    clearInterval(checking);
    await locks.end();
    throw error;
  }
  const started = runner;
  return Object.assign(started, {
    promise: started.promise
      .finally(async () => {
        clearInterval(checking);
        await locks.end();
      })
      .then(() => {
        if (misconfigured) throw new Error("the queue stopped: the worker is misconfigured (worker.config)");
      }),
  });
}
