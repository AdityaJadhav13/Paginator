// The engine's jobs in the queue (L2.3): the done event checked against its target, engine.layout run once, a user's
// cancel (engine_cancel) and the queue stopping told apart, progress lines reported under `<job>:<seq>`, and long jobs
// keeping their lock fresh. The runner is stood in for (runner.ts has its own tests).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineEvent, WorkerJob, WorkerProgress } from "@pageinator/contracts";
import type { JobHelpers } from "graphile-worker";
import { Cancels } from "../src/cancel.ts";
import type { RunOutcome, RunnerSettings } from "../src/runner.ts";
import { engineTask, HEARTBEAT_MS, RetryLater, targetOf, taskList, type Report } from "../src/tasks.ts";
import {
  adRejected,
  ARTWORK,
  doneResult,
  EDITION,
  finished,
  measured,
  PAYLOADS,
  PROFILE,
  profileRejected,
  progressLine,
  RUN,
  runProgress,
  type EngineKind,
} from "./engine-fixtures.ts";

const settings = { command: "unused", args: [], health: [], cwd: ".", env: {}, timeoutMs: 1 };
const KEYS: Record<EngineKind, string> = {
  "engine.setup": `profile:${PROFILE}`,
  "engine.measure": `measure:${EDITION}`,
  "engine.layout": `run:${RUN}`,
  "media.ad": `ad:${ARTWORK}`,
};
const TARGETS: Record<EngineKind, string> = {
  "engine.setup": PROFILE,
  "engine.measure": EDITION,
  "engine.layout": RUN,
  "media.ad": ARTWORK,
};

type Fake = (
  job: WorkerJob,
  s: RunnerSettings,
  signal: AbortSignal | undefined,
  onProgress?: (p: WorkerProgress) => void,
) => Promise<RunOutcome>;

/** Runs one engine job (Graphile Worker's job 7, attempt `attempts` of `max`) with the fake runner `fake`. */
async function task(
  kind: EngineKind,
  fake: Fake,
  options: { attempts?: number; max?: number; cancels?: Cancels; shutdown?: AbortController; report?: Report } = {},
) {
  const reported: Array<[EngineEvent, string]> = [];
  const logged: string[] = [];
  const queries: unknown[][] = [];
  let stops = 0;
  const h = {
    job: {
      id: "7",
      key: KEYS[kind],
      attempts: options.attempts ?? 1,
      max_attempts: options.max ?? 1,
      locked_by: "pool-1",
      job_queue_id: 3,
      task_identifier: kind,
    },
    abortSignal: (options.shutdown ?? new AbortController()).signal,
    logger: { error: (m: string) => logged.push(m), warn: (m: string) => logged.push(m) },
    withPgClient: async (fn: (c: unknown) => unknown) =>
      fn({ query: async (text: string, values: unknown[]) => (queries.push([text, values]), { rowCount: 1 }) }),
  } as unknown as JobHelpers;
  const report: Report = options.report ?? (async (e, id) => void reported.push([e, id]));
  const t = engineTask(kind, settings, report, () => (stops += 1), fake as never, options.cancels);
  const thrown = await Promise.resolve(t(PAYLOADS[kind] as never, h)).then(
    () => null,
    (e: unknown) => e,
  );
  return { reported, logged, queries, stops, thrown, job: h.job };
}

const answer =
  (event: EngineEvent, extra: { stoppedBy: string } | object = {}): Fake =>
  async () => ({ outcome: "done", result: doneResult(event, "7"), ...extra });
const failedWith = (r: Array<[EngineEvent, string]>) => r.map(([e]) => (e.kind === "job.failed" ? e.code : e.kind));

afterEach(() => vi.useRealTimers());

describe("the engine's events and their targets", () => {
  it("names each event's target: the profile, the edition, the run, the ad slot's row (not its asset)", () => {
    expect(targetOf(profileRejected())).toBe(PROFILE);
    expect(targetOf(measured())).toBe(EDITION);
    expect(targetOf(finished())).toBe(RUN);
    expect(targetOf(runProgress())).toBe(RUN);
    expect(targetOf(adRejected())).toBe(ARTWORK);
  });

  it("reports each kind's done event, and anything else as job.failed for its target", async () => {
    const cases: Array<[EngineKind, EngineEvent]> = [
      ["engine.setup", profileRejected()],
      ["engine.measure", measured()],
      ["engine.layout", finished("done")],
      ["media.ad", adRejected()],
    ];
    for (const [kind, event] of cases) {
      const ok = await task(kind, answer(event));
      expect(ok.reported, kind).toEqual([[event, "7"]]);
      // another kind's event, or one for another target or bytes
      const wrong = await task(kind, answer(cases.find(([k]) => k !== kind)?.[1] ?? event));
      const other = await task(kind, answer({ ...event, sha256: "f".repeat(64) } as EngineEvent));
      for (const r of [wrong, other])
        expect(r.reported.map(([e]) => e.kind === "job.failed" && [e.code, e.job_kind, e.target_id])).toEqual([
          ["worker.output", kind, TARGETS[kind]],
        ]);
    }
  });

  it("gives the runner the job and settles a final failure with its kind and target", async () => {
    const jobs: WorkerJob[] = [];
    const r = await task(
      "media.ad",
      async (job) => (jobs.push(job), { outcome: "failed", code: "worker.job", message: "x" }),
    );
    expect(jobs).toEqual([
      { format: "pageinator.worker-job/1", id: "7", kind: "media.ad", args: PAYLOADS["media.ad"] },
    ]);
    expect(r.reported.map(([e]) => e)).toEqual([
      {
        kind: "job.failed",
        org_id: PAYLOADS["media.ad"].org_id,
        pub_id: PAYLOADS["media.ad"].pub_id,
        job_kind: "media.ad",
        target_id: ARTWORK,
        code: "worker.job",
        message: "x",
      },
    ]);
  });

  it("runs the queue's six kinds", () => {
    expect(Object.keys(taskList(settings, async () => {})).sort()).toEqual(
      [
        "docx.import",
        "engine.layout",
        "engine.measure",
        "engine.setup",
        "media.ad",
        "media.ingest",
        "news.collect",
        "news.draft",
      ].sort(),
    );
  });
});

describe("engine.layout runs once", () => {
  it("settles a retry outcome as job.failed though attempts remain", async () => {
    const r = await task("engine.layout", async () => ({ outcome: "retry", code: "worker.store", message: "x" }), {
      max: 3,
    });
    expect(r.thrown).toBeNull();
    expect(failedWith(r.reported)).toEqual(["worker.store"]);
  });

  it("settles a misconfigured worker as job.failed, stopping the queue, never giving the attempt back", async () => {
    const r = await task("engine.layout", async () => ({ outcome: "failed", code: "worker.config", message: "x" }));
    expect([r.thrown, r.stops, r.queries.filter(([t]) => String(t).includes("max_attempts"))]).toEqual([null, 1, []]);
    expect(failedWith(r.reported)).toEqual(["worker.config"]);
  });

  it("reports the queue stopping during a run as worker.restarted, not the launcher's 'cancelled'", async () => {
    const shutdown = new AbortController();
    const stopped: Fake = async (_job, _s, signal) => {
      shutdown.abort();
      expect(signal?.aborted).toBe(true);
      return { outcome: "done", result: doneResult(finished("cancelled"), "7"), stoppedBy: "worker.cancelled" };
    };
    const r = await task("engine.layout", stopped, { shutdown });
    expect(r.reported.map(([e]) => e.kind === "job.failed" && [e.code, e.target_id])).toEqual([
      ["worker.restarted", RUN],
    ]);
    const silent = await task(
      "engine.layout",
      async () => (shutdown.abort(), { outcome: "retry", code: "worker.cancelled", message: "x" }),
      {
        shutdown: new AbortController(),
      },
    );
    expect(failedWith(silent.reported)).toEqual(["worker.cancelled"]); // its own signal: not a shutdown of this queue
  });

  it("does not report a runner's answer after its time limit as what happened", async () => {
    const r = await task("engine.layout", answer(finished("cancelled"), { stoppedBy: "worker.timeout" }));
    expect(failedWith(r.reported)).toEqual(["worker.timeout"]);
  });
});

describe("a user's cancel (engine_cancel)", () => {
  it("stops the matching run and reports the runner's answer as usual", async () => {
    const cancels = new Cancels();
    const fake: Fake = async (_job, _s, signal) => {
      expect(cancels.cancel(`run:${RUN}`)).toBe(1);
      expect(signal?.aborted).toBe(true);
      return { outcome: "done", result: doneResult(finished("cancelled"), "7"), stoppedBy: "worker.cancelled" };
    };
    const r = await task("engine.layout", fake, { cancels });
    expect(r.reported.map(([e]) => e.kind === "run.finished" && e.state)).toEqual(["cancelled"]);
    expect(cancels.cancel(`run:${RUN}`)).toBe(0); // the finished job is no longer watched
  });

  it("reports nothing when the runner gave no answer, and never runs it again", async () => {
    const cancels = new Cancels();
    const fake: Fake = async () => (
      cancels.cancel(`run:${RUN}`),
      { outcome: "retry", code: "worker.cancelled", message: "x" }
    );
    const r = await task("engine.layout", fake, { cancels });
    expect([r.reported, r.thrown]).toEqual([[], null]);
    const m = await task(
      "engine.measure",
      async () => (cancels.cancel("measure:*"), { outcome: "retry", code: "worker.cancelled", message: "x" }),
      { cancels },
    );
    expect([m.reported, m.thrown, m.queries.filter(([t]) => String(t).includes("max_attempts"))]).toEqual([
      [],
      null,
      [],
    ]);
  });

  it("reaches only the job named: measure:* every measure, never a run", async () => {
    const cancels = new Cancels();
    const run = cancels.watch(`run:${RUN}`);
    const a = cancels.watch(`measure:${EDITION}`);
    const b = cancels.watch(`measure:${PROFILE}`);
    expect(cancels.cancel(`run:${PROFILE}`)).toBe(0);
    expect(cancels.cancel("measure:*")).toBe(2);
    expect([run.signal.aborted, a.signal.aborted, b.signal.aborted]).toEqual([false, true, true]);
    run.done();
    expect(cancels.cancel(`run:${RUN}`)).toBe(0);
    expect(cancels.watch(null).signal.aborted).toBe(false);
  });
});

describe("the queue stopping during the other engine jobs", () => {
  it("gives the attempt back (thrown, nothing reported), the runner's answer ignored", async () => {
    for (const kind of ["engine.setup", "engine.measure", "media.ad"] as const) {
      const shutdown = new AbortController();
      const event =
        kind === "engine.setup" ? profileRejected() : kind === "engine.measure" ? measured("stopped") : adRejected();
      const r = await task(
        kind,
        async () => (
          shutdown.abort(),
          { outcome: "done", result: doneResult(event, "7"), stoppedBy: "worker.cancelled" }
        ),
        {
          shutdown,
        },
      );
      expect(r.thrown, kind).toBeInstanceOf(RetryLater);
      expect(r.reported, kind).toEqual([]);
      expect(
        r.queries.some(([t]) => String(t).includes("max_attempts + 1")),
        kind,
      ).toBe(true);
    }
  });
});

describe("progress lines", () => {
  it("are reported in order under <job>:<seq> before the result", async () => {
    const fake: Fake = async (_job, _s, _signal, onProgress) => {
      onProgress?.(progressLine(runProgress(1), 1, "7"));
      onProgress?.(progressLine(runProgress(2), 2, "7"));
      return { outcome: "done", result: doneResult(finished("done"), "7") };
    };
    const r = await task("engine.layout", fake);
    expect(r.reported.map(([e, id]) => [e.kind, id])).toEqual([
      ["run.progress", "7:1"],
      ["run.progress", "7:2"],
      ["run.finished", "7"],
    ]);
  });

  it("drop a line for another target or of a kind the job does not write; a failed report is not retried", async () => {
    const fake: Fake = async (_job, _s, _signal, onProgress) => {
      onProgress?.(progressLine({ ...runProgress(), run_id: EDITION } as EngineEvent, 1, "7"));
      onProgress?.(progressLine(measured("measuring"), 2, "7")); // a measure's line in a layout
      onProgress?.(progressLine(runProgress(), 3, "7"));
      return { outcome: "done", result: doneResult(finished("done"), "7") };
    };
    const r = await task("engine.layout", fake);
    expect(r.reported.map(([, id]) => id)).toEqual(["7:3", "7"]);
    expect(r.logged.filter((m) => m.includes("dropped"))).toHaveLength(2);
    let calls = 0;
    const flaky: Report = async (_e, id) => {
      calls += 1;
      if (id.includes(":")) throw new Error("the inbox is down");
    };
    const f = await task(
      "engine.measure",
      async (_j, _s, _sig, onProgress) => {
        onProgress?.(progressLine(measured("measuring"), 1, "7"));
        return { outcome: "done", result: doneResult(measured("done"), "7") };
      },
      { report: flaky },
    );
    expect([f.thrown, calls]).toEqual([null, 2]);
  });
});

describe("long jobs keep their lock fresh", () => {
  it("refresh their job's and their named queue's lock every minute while they run, and stop after", async () => {
    vi.useFakeTimers();
    for (const kind of ["engine.setup", "engine.measure", "engine.layout", "media.ad"] as const) {
      let end: (o: RunOutcome) => void = () => {};
      const running = task(kind, () => new Promise((r) => (end = r)));
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 10);
      end({ outcome: "failed", code: "worker.job", message: "x" });
      const r = await running;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
      const beats = r.queries.filter(([t]) => String(t).includes("locked_at = now()"));
      expect(beats.length, kind).toBe(kind === "media.ad" ? 0 : 2);
      if (beats[0]) expect(beats[0][1]).toEqual(["7", "pool-1", 3]);
    }
  });
});
