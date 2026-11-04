// The queue's tasks (Graphile Worker): each takes its ids-only payload, runs the Python runner once, and reports the
// event for the API's inbox. A retry outcome throws, so Graphile Worker runs the job again with its backoff; on the
// job's last attempt it is reported as a final failure instead. A cancel (the queue shutting down) and a misconfigured
// worker (`worker.config`: the operator's fault, not the photo's) give the attempt back, are never reported as a
// failure, and the latter stops the queue (startQueue). What still cannot settle here (the process dies on the last
// attempt, or the inbox refuses every report) the API's sweep settles (plan §2.2, exhaustedJobs).
import {
  DocxImportPayload,
  MediaIngestPayload,
  OrgId,
  Uuid7,
  WORKER_JOB_FORMAT,
  type EngineEvent,
  type WorkerJob,
} from "@pageinator/contracts";
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

/** Each kind: its ids-only payload, and the payload's field that names its target (an asset, an import). */
const KINDS = {
  "media.ingest": { payload: MediaIngestPayload, target: "asset_id", events: ["media.ready", "media.rejected"] },
  "docx.import": { payload: DocxImportPayload, target: "import_id", events: ["import.parsed", "import.rejected"] },
} as const;
type Kind = keyof typeof KINDS;

/** What a payload that is not ids-only must still name for its target to settle. */
const Target = z.object({ org_id: OrgId, pub_id: Uuid7, target_id: Uuid7 });
type Target = z.infer<typeof Target>;

/** The target an event names (its asset, or its import). */
export const targetOf = (event: EngineEvent): string =>
  event.kind === "job.failed" ? event.target_id : "asset_id" in event ? event.asset_id : event.import_id;

export function engineTask(
  kind: Kind,
  settings: RunnerSettings,
  report: Report,
  misconfigured: () => void = () => {},
  run: Run = runJob,
): Task {
  const { payload: Payload, target: field, events } = KINDS[kind];
  return async (payload, helpers) => {
    const settle = (event: EngineEvent) => reportWithRetries(report, event, helpers);
    const args = Payload.safeParse(payload);
    if (!args.success) {
      const named = payload as Record<string, unknown> | null;
      const target = Target.safeParse({ ...named, target_id: named?.[field] });
      // the API enqueues only through its wrapper; a payload that drifted from it still settles its target
      if (target.success)
        return settle(failed(kind, target.data, "worker.job", "the job's payload is not the queue's ids-only payload"));
      helpers.logger.error(`${kind}: a payload that names no ${field}; the job is dropped`);
      return;
    }
    const data = args.data as Record<string, string>;
    const target = { org_id: data["org_id"] ?? "", pub_id: data["pub_id"] ?? "", target_id: data[field] ?? "" };
    const job = { format: WORKER_JOB_FORMAT, id: helpers.job.id, kind, args: args.data } as WorkerJob;
    const out: RunOutcome = await run(job, settings, helpers.abortSignal);
    if (out.outcome === "done") {
      const event = out.result.event;
      if (
        !(events as readonly string[]).includes(event.kind) ||
        event.org_id !== target.org_id ||
        event.pub_id !== target.pub_id ||
        targetOf(event) !== target.target_id ||
        event.sha256 !== data["sha256"]
      )
        return settle(failed(kind, target, "worker.output", `the runner's event is for another ${field.slice(0, -3)}`));
      return settle(event);
    }
    const notThePhotos = out.code === "worker.cancelled" || out.code === "worker.config";
    if (out.code === "worker.config") misconfigured();
    if (notThePhotos && (await giveBack(helpers))) throw new RetryLater(out.code);
    if ((out.outcome === "retry" || notThePhotos) && helpers.job.attempts < helpers.job.max_attempts)
      throw new RetryLater(out.code);
    return settle(failed(kind, target, out.code, out.message));
  };
}

/** media.ingest: an uploaded photo's print versions. */
export const mediaIngest = (settings: RunnerSettings, report: Report, misconfigured?: () => void, run: Run = runJob) =>
  engineTask("media.ingest", settings, report, misconfigured, run);

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
      helpers.logger.warn(`${helpers.job.task_identifier}: the report failed; trying again in ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function failed(kind: Kind, target: Target, code: string, message: string): EngineEvent {
  return {
    kind: "job.failed",
    org_id: target.org_id,
    pub_id: target.pub_id,
    job_kind: kind,
    target_id: target.target_id,
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
  return {
    "media.ingest": engineTask("media.ingest", settings, report, misconfigured, run),
    "docx.import": engineTask("docx.import", settings, report, misconfigured, run),
  };
}
