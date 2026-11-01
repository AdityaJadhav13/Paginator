// The engine's queue: Graphile Worker in schema `queue` (plan §2.2), run as `pgn_engine`, which may only take and finish
// jobs there (ENGINE_GRANTS). The schema is installed and upgraded by the migrator (the API's migrations), never by the
// worker: Graphile Worker installs only when its tables are missing, and `pgn_engine` cannot create them.
import { run, type Runner } from "graphile-worker";
import type pg from "pg";
import { healthy, type RunnerSettings } from "./runner.ts";
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
 * payload itself; the API's migration adds its tenancy check (the organisation is app.current_org()). */
export const APP_ENQUEUE = `
create function app.enqueue_media_ingest(org_id uuid, pub_id uuid, asset_id uuid, version_id text, sha256 text)
returns bigint language sql security definer set search_path = pg_catalog, pg_temp as $$
  select (queue.add_job('media.ingest',
    json_build_object('org_id', org_id, 'pub_id', pub_id, 'asset_id', asset_id, 'version_id', version_id,
                      'sha256', sha256),
    max_attempts => ${MAX_ATTEMPTS}, job_key => 'asset:' || asset_id)).id
$$;
revoke execute on function app.enqueue_media_ingest(uuid, uuid, uuid, text, text) from public;
grant execute on function app.enqueue_media_ingest(uuid, uuid, uuid, text, text) to pgn_app;
revoke execute on all functions in schema queue from public;
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
 * the runner's time limit and the report's retries). Read as the queue's owner; the sweep reports job.failed for
 * each (the inbox drops it when the job had reported) and then removes it. */
export async function exhaustedJobs(client: pg.ClientBase, staleMs: number): Promise<ExhaustedJob[]> {
  const { rows } = await client.query<ExhaustedJob>(
    `select j.id::text, t.identifier as task_identifier, j.payload, j.attempts, j.max_attempts, j.last_error, j.locked_at
     from ${QUEUE_SCHEMA}._private_jobs as j join ${QUEUE_SCHEMA}._private_tasks as t on t.id = j.task_id
     where j.attempts >= j.max_attempts
       and (j.locked_at is null or j.locked_at < now() - $1 * interval '1 millisecond')
     order by j.id`,
    [staleMs],
  );
  return rows;
}

export type QueueSettings = {
  connectionString: string; // as pgn_engine
  concurrency: number;
  runner: RunnerSettings;
  report: Report;
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
  let misconfigured = false;
  let runner: Runner | null = null;
  const stopForConfig = () => {
    if (misconfigured) return;
    misconfigured = true;
    void runner?.stop("a job found the worker misconfigured (worker.config)");
  };
  runner = await run({
    connectionString: settings.connectionString,
    schema: QUEUE_SCHEMA,
    concurrency: settings.concurrency,
    noHandleSignals: settings.noHandleSignals ?? false,
    taskList: taskList(settings.runner, settings.report, stopForConfig),
    // no cron item and no crontab file: `crontab: ""` is empty, so Graphile Worker would read ./crontab instead
    parsedCronItems: [],
    // running jobs end by themselves (the runner's own time limit) rather than by Graphile Worker's cancel
    gracefulShutdownAbortTimeout: timeoutMs + 5_000,
    // Graphile Worker 0.18 does not await an unbatched finish: a shutdown could close the pool first, leaving the job
    // locked for 4 hours. Batched (with no delay), the finishes are flushed and awaited before the pool closes.
    preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
  });
  const started = runner;
  return Object.assign(started, {
    promise: started.promise.then(() => {
      if (misconfigured) throw new Error("the queue stopped: the worker is misconfigured (worker.config)");
    }),
  });
}
