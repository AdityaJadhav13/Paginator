// The queue's tasks (Graphile Worker): each takes its ids-only payload, runs the Python runner once, and reports the
// event for the API's inbox. A retry outcome throws, so Graphile Worker runs the job again with its backoff; on the
// job's last attempt it is reported as a final failure instead. A cancel (the queue shutting down) and a misconfigured
// worker (`worker.config`: the operator's fault, not the photo's) give the attempt back, are never reported as a
// failure, and the latter stops the queue (startQueue). What still cannot settle here (the process dies on the last
// attempt, or the inbox refuses every report) the API's sweep settles (plan §2.2, exhaustedJobs).
import { MediaIngestPayload, OrgId, Uuid7, WORKER_JOB_FORMAT, type EngineEvent } from "@pageinator/contracts";
import type { JobHelpers, Task, TaskList } from "graphile-worker";
import { z } from "zod";
import { runJob, type RunOutcome, type RunnerSettings } from "./runner.ts";

export const QUEUE_SCHEMA = "queue";
/** A job given back this often (cancels, a misconfigured worker) is spent like any other attempt from then on: the
 * API enqueues with max_attempts MAX_ATTEMPTS (queue.ts), so at most 20 attempts are given back. */
export const MAX_GIVEN_BACK = 30;
/** report() is tried this many times, waiting this long before each retry; then the job fails (and is run again). */
export const REPORT_WAITS_MS = [500, 2_000] as const;

/** Writes one event to the API's inbox (app.engine_event and its NOTIFY): the API part brings it (plan §2.2). The
 * queue's job id goes with it: a job reports one event, so the inbox keeps one row per job id and drops a repeat (a
 * job run again after its report, when finishing it in the queue was lost). */
export type Report = (event: EngineEvent, jobId: string, helpers: JobHelpers) => Promise<void>;
export type Run = typeof runJob;

export class RetryLater extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`the job will be run again (${code})`); // the code only: the runner's words go to no log
    this.code = code;
  }
}

/** What a payload that is not ids-only must still name for its asset to settle. */
const Target = z.object({ org_id: OrgId, pub_id: Uuid7, asset_id: Uuid7 });
type Target = z.infer<typeof Target>;

export function mediaIngest(
  settings: RunnerSettings,
  report: Report,
  misconfigured: () => void = () => {},
  run: Run = runJob,
): Task {
  return async (payload, helpers) => {
    const settle = (event: EngineEvent) => reportWithRetries(report, event, helpers);
    const args = MediaIngestPayload.safeParse(payload);
    if (!args.success) {
      const target = Target.safeParse(payload);
      // the API enqueues only through its wrapper; a payload that drifted from it still settles its asset
      if (target.success)
        return settle(failed(target.data, "worker.job", "the job's payload is not the queue's ids-only payload"));
      helpers.logger.error("media.ingest: a payload that names no asset; the job is dropped");
      return;
    }
    const job = { format: WORKER_JOB_FORMAT, id: helpers.job.id, kind: "media.ingest", args: args.data } as const;
    const out: RunOutcome = await run(job, settings, helpers.abortSignal);
    if (out.outcome === "done") {
      const event = out.result.event;
      if (
        event.org_id !== args.data.org_id ||
        event.pub_id !== args.data.pub_id ||
        event.asset_id !== args.data.asset_id ||
        event.sha256 !== args.data.sha256
      )
        return settle(failed(args.data, "worker.output", "the runner's event is for another asset"));
      return settle(event);
    }
    const notThePhotos = out.code === "worker.cancelled" || out.code === "worker.config";
    if (out.code === "worker.config") misconfigured();
    if (notThePhotos && (await giveBack(helpers))) throw new RetryLater(out.code);
    if ((out.outcome === "retry" || notThePhotos) && helpers.job.attempts < helpers.job.max_attempts)
      throw new RetryLater(out.code);
    return settle(failed(args.data, out.code, out.message));
  };
}

/** Gives the attempt back (one more allowed) while this queue still holds the job's lock: true when it did. */
async function giveBack(helpers: JobHelpers): Promise<boolean> {
  try {
    const { rowCount } = await helpers.withPgClient((client) =>
      client.query(
        `update ${QUEUE_SCHEMA}._private_jobs set max_attempts = max_attempts + 1
         where id = $1 and locked_by = $2 and max_attempts < $3`,
        [helpers.job.id, helpers.job.locked_by, MAX_GIVEN_BACK],
      ),
    );
    if (rowCount !== 1) return false;
    helpers.job.max_attempts += 1; // Graphile Worker's own log then counts as the database does
    return true;
  } catch {
    return false; // the attempt is spent as any other
  }
}

async function reportWithRetries(report: Report, event: EngineEvent, helpers: JobHelpers): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await report(event, helpers.job.id, helpers);
    } catch (e) {
      const wait = REPORT_WAITS_MS[i];
      if (wait === undefined) throw e; // the job fails: run again, or, out of attempts, left to the API's sweep
      helpers.logger.warn(`media.ingest: the report failed; trying again in ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function failed(target: Target, code: string, message: string): EngineEvent {
  return {
    kind: "job.failed",
    org_id: target.org_id,
    pub_id: target.pub_id,
    job_kind: "media.ingest",
    target_id: target.asset_id,
    code,
    message,
  };
}

export function taskList(
  settings: RunnerSettings,
  report: Report,
  misconfigured?: () => void,
  run: Run = runJob,
): TaskList {
  return { "media.ingest": mediaIngest(settings, report, misconfigured, run) };
}
