// The queue's tasks (Graphile Worker): each takes its ids-only payload, runs the Python runner once, and reports the
// event for the API's inbox. A retry outcome throws, so Graphile Worker runs the job again with its backoff; on the
// job's last attempt it is reported as a final failure instead. A cancel (the queue shutting down) and a misconfigured
// worker (`worker.config`: the operator's fault, not the photo's) give the attempt back, are never reported as a
// failure, and the latter stops the queue (startQueue). What still cannot settle here (the process dies on the last
// attempt, or the inbox refuses every report) the API's sweep settles (plan §2.2, exhaustedJobs).
// The engine's jobs (L2.3) add: engine.layout runs once (a retry outcome, and a misconfigured worker, are its final
// failure); engine.layout and engine.measure report each progress line as it comes (job id `<job>:<seq>`); a user's
// cancel (cancel.ts) stops the runner, and its answer (run.finished cancelled) is reported as usual, or nothing when it
// gave none (the API has recorded the cancel); setup, measure and layout keep their locks fresh while they run. The
// queue stopping during a layout is reported as job.failed worker.restarted: the run cannot go on in a later attempt,
// so the API fails it with the Desk's RESTARTED words at once rather than after its sweep. (The launcher's answer then,
// run.finished cancelled, would say a person cancelled it.) Setup, measure and media.ad give the attempt back as today.
import {
  DocxImportPayload,
  EngineLayoutPayload,
  EngineMeasurePayload,
  EngineSetupPayload,
  MediaAdPayload,
  EngineEvent,
  MediaIngestPayload,
  NewsCollectPayload,
  NewsDraftPayload,
  OrgId,
  Uuid7,
  WORKER_JOB_FORMAT,
  type JOB_KINDS,
  type WorkerJob,
  type WorkerProgress,
} from "@pageinator/contracts";
import type { JobHelpers, Task, TaskList } from "graphile-worker";
import { z } from "zod";
import { Cancels } from "./cancel.ts";
import { draft } from "./news/draft.ts";
import { collect, type NewsDeps } from "./news/group.ts";
import { runJob, type RunOutcome, type RunnerSettings } from "./runner.ts";

export const QUEUE_SCHEMA = "queue";
/** A job given back this often (cancels, a misconfigured worker) is spent like any other attempt from then on: the
 * API enqueues with max_attempts MAX_ATTEMPTS (queue.ts), so at most 20 attempts are given back. */
export const MAX_GIVEN_BACK = 30;
/** report() is tried this many times, waiting this long before each retry; then the job fails (and is run again). */
export const REPORT_WAITS_MS = [500, 2_000] as const;
/** How often a long engine job refreshes its lock (releaseStaleLocks and the API's sweep take a lock older than the
 * runner's limit plus 5 minutes). */
export const HEARTBEAT_MS = 60_000;

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

/** Each kind: its ids-only payload, the payload's field that names its target (an asset, an import, a profile …), its
 * done events and the events its progress lines may carry. */
const KINDS = {
  "media.ingest": { payload: MediaIngestPayload, target: "asset_id", events: ["media.ready", "media.rejected"] },
  "docx.import": { payload: DocxImportPayload, target: "import_id", events: ["import.parsed", "import.rejected"] },
  "engine.setup": { payload: EngineSetupPayload, target: "profile_id", events: ["profile.ready", "profile.rejected"] },
  "engine.measure": {
    payload: EngineMeasurePayload,
    target: "edition_id",
    events: ["measure.status"],
    progress: ["measure.status"],
  },
  "engine.layout": {
    payload: EngineLayoutPayload,
    target: "run_id",
    events: ["run.finished"],
    progress: ["run.progress", "run.page"],
  },
  "media.ad": { payload: MediaAdPayload, target: "artwork_id", events: ["ad.ready", "ad.rejected"] },
} as const;
/** The kinds whose lock is refreshed while they run (they may outlast the runner's default limit). */
const LONG: ReadonlySet<string> = new Set(["engine.setup", "engine.measure", "engine.layout"]);
type Kind = keyof typeof KINDS;

/** What a payload that is not ids-only must still name for its target to settle. */
const Target = z.object({ org_id: OrgId, pub_id: Uuid7, target_id: Uuid7 });
type Target = z.infer<typeof Target>;

/** The target an event names (its asset, its import, the profile, the edition, the ad slot's row, the layout or news
 * run or the news draft). An ad's event names its asset too: its target is the slot's row. */
export function targetOf(event: EngineEvent): string {
  if (event.kind === "job.failed") return event.target_id;
  if ("artwork_id" in event) return event.artwork_id;
  if ("asset_id" in event) return event.asset_id;
  if ("import_id" in event) return event.import_id;
  if ("profile_id" in event) return event.profile_id;
  if ("edition_id" in event) return event.edition_id;
  return "run_id" in event ? event.run_id : event.draft_id;
}

export function engineTask(
  kind: Kind,
  settings: RunnerSettings,
  report: Report,
  misconfigured: () => void = () => {},
  run: Run = runJob,
  cancels: Cancels = new Cancels(),
): Task {
  const { payload: Payload, target: field, events } = KINDS[kind];
  const progressKinds = (KINDS[kind] as { progress?: readonly string[] }).progress ?? [];
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
    const ours = (event: EngineEvent, kinds: readonly string[]) =>
      kinds.includes(event.kind) &&
      event.org_id === target.org_id &&
      event.pub_id === target.pub_id &&
      targetOf(event) === target.target_id &&
      "sha256" in event &&
      event.sha256 === data["sha256"];
    // progress goes to the inbox in order, each once (`<job>:<seq>`); a lost one is only a missed update
    let progressed = Promise.resolve();
    const onProgress = (line: WorkerProgress) => {
      if (!ours(line.event, progressKinds))
        return helpers.logger.warn(`${kind}: a progress line for another ${field.slice(0, -3)} was dropped`);
      progressed = progressed.then(() =>
        report(line.event, `${helpers.job.id}:${line.seq}`, helpers).catch(() =>
          helpers.logger.warn(`${kind}: a progress report failed; it is not sent again`),
        ),
      );
    };
    const cancel = cancels.watch(helpers.job.key);
    const beat = LONG.has(kind) ? setInterval(() => void refreshLock(helpers), HEARTBEAT_MS) : undefined;
    let out: RunOutcome;
    try {
      const signal = helpers.abortSignal ? AbortSignal.any([helpers.abortSignal, cancel.signal]) : cancel.signal;
      out = await run(job, settings, signal, onProgress);
    } finally {
      clearInterval(beat);
      cancel.done();
    }
    await progressed;
    const cancelled = cancel.signal.aborted;
    const shutdown = !cancelled && (helpers.abortSignal?.aborted ?? false);
    // stopped by a user's cancel: its answer is reported as any other; none, nothing (the API recorded the cancel)
    if (cancelled && out.outcome !== "done") return;
    // stopped by anything else, the runner's answer is not what happened (it would say cancelled): the stop counts
    if (out.outcome === "done" && out.stoppedBy !== undefined && !cancelled)
      out = { outcome: "retry", code: out.stoppedBy, message: "the job was stopped" };
    if (out.outcome === "done") {
      if (!ours(out.result.event, events))
        return settle(failed(kind, target, "worker.output", `the runner's event is for another ${field.slice(0, -3)}`));
      return settle(out.result.event);
    }
    if (out.code === "worker.config") misconfigured();
    if (kind === "engine.layout") {
      // never run twice: a later attempt would lay the edition out again from a run the API may have shown as going
      if (shutdown) return settle(failed(kind, target, "worker.restarted", "the queue stopped while the run ran"));
      return settle(failed(kind, target, out.code, out.message));
    }
    const notThePhotos = out.code === "worker.cancelled" || out.code === "worker.config";
    if (notThePhotos && (await giveBack(helpers))) throw new RetryLater(out.code);
    if ((out.outcome === "retry" || notThePhotos) && helpers.job.attempts < helpers.job.max_attempts)
      throw new RetryLater(out.code);
    return settle(failed(kind, target, out.code, out.message));
  };
}

/** Refreshes a running job's lock and its named queue's (only while this queue still holds them). A failure is only
 * logged: the next beat tries again, and a lock goes stale only after the runner's limit plus 5 minutes. */
export async function refreshLock(helpers: JobHelpers): Promise<void> {
  try {
    await helpers.withPgClient((client) =>
      client.query(
        `with queues as (
           update ${QUEUE_SCHEMA}._private_job_queues set locked_at = now() where id = $3 and locked_by = $2
         ) update ${QUEUE_SCHEMA}._private_jobs set locked_at = now() where id = $1 and locked_by = $2`,
        [helpers.job.id, helpers.job.locked_by, helpers.job.job_queue_id],
      ),
    );
  } catch {
    helpers.logger.warn(`${helpers.job.task_identifier}: its lock could not be refreshed`);
  }
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

function failed(kind: (typeof JOB_KINDS)[number], target: Target, code: string, message: string): EngineEvent {
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

/** The news finder's jobs (L2.7): run here in TypeScript, not by the Python runner. Their payload carries what they
 * need (checked by its contract; one that is not settles its run or draft as job.failed), and their event is checked
 * by its contract before it is reported. On the last attempt a failure the queue would retry (a rate limit, an
 * outage) is settled in the event instead (news.collect: its items without topics; news.draft: ai.error). A cancel
 * (the queue stopping) gives the attempt back and reports nothing. */
export function newsTask(kind: "news.collect" | "news.draft", deps: NewsDeps, report: Report): Task {
  const field = kind === "news.collect" ? "run_id" : "draft_id";
  return async (payload, helpers) => {
    const settle = (event: EngineEvent) => reportWithRetries(report, event, helpers);
    const named = payload as Record<string, unknown> | null;
    const target = Target.safeParse({ ...named, target_id: named?.[field] });
    if (!target.success) {
      helpers.logger.error(`${kind}: a payload that names no ${field}; the job is dropped`);
      return;
    }
    const final = helpers.job.attempts >= helpers.job.max_attempts;
    const news = { ...deps, signal: helpers.abortSignal };
    let event: EngineEvent | null = null;
    if (kind === "news.collect") {
      const args = NewsCollectPayload.safeParse(payload);
      if (args.success) event = await collect(args.data, news, final);
    } else {
      const args = NewsDraftPayload.safeParse(payload);
      if (args.success) event = await draft(args.data, news, final);
    }
    if (!event)
      return settle(failed(kind, target.data, "worker.job", "the job's payload is not the news finder's payload"));
    if (helpers.abortSignal?.aborted) {
      await giveBack(helpers);
      throw new RetryLater("worker.cancelled"); // what it found while stopping is not reported
    }
    const checked = EngineEvent.safeParse(event);
    if (!checked.success || targetOf(checked.data) !== target.data.target_id)
      return settle(failed(kind, target.data, "worker.output", "the job's event does not match its contract"));
    return settle(checked.data);
  };
}

export function taskList(
  settings: RunnerSettings,
  report: Report,
  misconfigured?: () => void,
  run: Run = runJob,
  news: NewsDeps = { ai: null },
  cancels: Cancels = new Cancels(),
): TaskList {
  const engine = (kind: Kind) => engineTask(kind, settings, report, misconfigured, run, cancels);
  return {
    "media.ingest": engine("media.ingest"),
    "docx.import": engine("docx.import"),
    "engine.setup": engine("engine.setup"),
    "engine.measure": engine("engine.measure"),
    "engine.layout": engine("engine.layout"),
    "media.ad": engine("media.ad"),
    "news.collect": newsTask("news.collect", news, report),
    "news.draft": newsTask("news.draft", news, report),
  };
}
