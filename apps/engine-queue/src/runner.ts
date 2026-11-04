// Runs one job through the Python runner (apps/engine-worker, `python -B -m pgn_worker.run`): the job on stdin, one
// result line on stdout, the exit code beside it (pgn_worker/run.py). Anything else (no line, a line the contract
// refuses, a line that disagrees with its exit code, an unknown code, a death by a signal such as the kernel's
// out-of-memory killer, the time limit, a cancel) decides nothing: the job is run again. The runner runs in a process
// group of its own, and the whole group is killed at the time limit, on a cancel, and once the runner has exited, so
// nothing it started outlives it. The engine's kinds (L2.3) differ in three ways: a time limit of their own
// (`limitsMs`); engine.layout and engine.measure write progress lines (WorkerProgress) before their result, each
// passed to `onProgress` as it comes (one the contract refuses is dropped, never the job's failure); and a stop is
// graceful: SIGTERM to the group, SIGKILL 10 s later, and the result the runner still answers is read
// (`stoppedBy` then says why it was stopped: the task decides whether that answer counts).
import { spawn } from "node:child_process";
import { WORKER_PROGRESS_FORMAT, WorkerProgress, WorkerResult, type WorkerJob } from "@pageinator/contracts";

/** What the queue does with a run: report the event, report a final failure, or run the job again. */
export type RunOutcome =
  | { outcome: "done"; result: Extract<WorkerResult, { outcome: "done" }>; stoppedBy?: string }
  | { outcome: "failed"; code: string; message: string }
  | { outcome: "retry"; code: string; message: string };

export type RunnerSettings = {
  command: string; // the worker's Python (the image's venv)
  args: readonly string[]; // ["-B", "-m", "pgn_worker.run"]
  health: readonly string[]; // ["-B", "-m", "pgn_worker.health"]: run before the queue takes any job
  cwd: string;
  env: NodeJS.ProcessEnv; // filtered by runnerEnv before any runner sees it: never the queue's database
  timeoutMs: number;
  /** a kind's own time limit (the engine's: main.ts); any other kind has timeoutMs */
  limitsMs?: Partial<Record<WorkerJob["kind"], number>>;
};

/** The kinds that write progress lines before their result, and the kinds stopped gracefully (the Python launcher
 * stops the engine's own process group on SIGTERM and answers what it did). */
const STREAMING: ReadonlySet<string> = new Set(["engine.layout", "engine.measure"]);
const GRACEFUL: ReadonlySet<string> = new Set(["engine.setup", "engine.measure", "engine.layout"]);
/** How long a graceful stop waits after SIGTERM before SIGKILL. */
export const STOP_GRACE_MS = 10_000;

/** The exit codes pgn_worker/run.py documents, and the outcome each must come with. */
const EXIT: Record<number, WorkerResult["outcome"]> = {
  0: "done",
  65: "failed",
  70: "failed",
  75: "retry",
  78: "failed",
};
const MAX_STDOUT = 1024 * 1024; // a result line is a few kilobytes; more is not a result
// progress lines are handed on as they come, never kept: a long run may write many (seq up to 100 000)
const MAX_STREAMED = 256 * MAX_STDOUT;
const DRAIN_MS = 2_000; // after the runner exits, how long its output may take to arrive
/** The runner's settings, copied from the queue's environment: nothing else reaches Python (no database URL).
 * AWS_CA_BUNDLE: a store behind a private CA (pilot-local's Caddy), which boto3 then trusts. PGN_ENGINE_PYTHON and
 * PGN_ENGINE_STALL_S: the layout engine's Python and how long an engine may show no progress (L2.3). */
const PASSED =
  /^(PATH|HOME|LANG|LC_[A-Z]+|TMPDIR|PYTHONPATH|PYTHONDONTWRITEBYTECODE|PAGEINATOR_ICC|PGN_ICC_SHA256|PGN_S3_[A-Z_]+|PGN_WORKER_HOMES|AWS_CA_BUNDLE|PGN_ENGINE_PYTHON|PGN_ENGINE_STALL_S)$/;

export function runnerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => PASSED.test(name)));
}

const retry = (code: string, message: string) => ({ outcome: "retry", code, message }) as const;

export function runJob(
  job: WorkerJob,
  settings: RunnerSettings,
  signal?: AbortSignal,
  onProgress?: (progress: WorkerProgress) => void,
): Promise<RunOutcome> {
  const limitMs = settings.limitsMs?.[job.kind] ?? settings.timeoutMs;
  const streaming = STREAMING.has(job.kind);
  const graceful = GRACEFUL.has(job.kind);
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(retry("worker.cancelled", "the queue stopped before the job ran"));
    const child = spawn(settings.command, settings.args, {
      cwd: settings.cwd,
      env: runnerEnv(settings.env),
      stdio: ["pipe", "pipe", "ignore"], // the runner writes nothing to stderr (run.py)
      detached: true, // its own process group, killed as one
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let partial = ""; // a streaming kind's line not yet ended
    let stopped: Extract<RunOutcome, { outcome: "retry" }> | null = null;
    let exited = false;
    let killing: NodeJS.Timeout | undefined;
    const killGroup = (signal: NodeJS.Signals = "SIGKILL") => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // the group is gone already
      }
    };
    const stop = (why: Extract<RunOutcome, { outcome: "retry" }>) => {
      if (exited || stopped) return; // a finished run keeps its own outcome; a stop is made once
      stopped = why;
      if (!graceful) return killGroup();
      killGroup("SIGTERM");
      killing = setTimeout(() => killGroup(), STOP_GRACE_MS);
    };
    const timer = setTimeout(() => stop(retry("worker.timeout", `the runner took longer than ${limitMs} ms`)), limitMs);
    const onAbort = () => stop(retry("worker.cancelled", "the queue stopped while the job ran"));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (streaming ? MAX_STREAMED : MAX_STDOUT))
        return stop(retry("worker.output", "the runner wrote more than a result"));
      if (!streaming) return void chunks.push(chunk);
      const lines = (partial + chunk.toString("utf8")).split("\n");
      partial = lines.pop() ?? "";
      if (partial.length > MAX_STDOUT) return stop(retry("worker.output", "the runner wrote more than a result"));
      for (const text of lines) if (!progress(text)) chunks.push(Buffer.from(text + "\n"));
    });
    /** A progress line: handed on when the contract takes it, else dropped. False: not a progress line (kept). */
    const progress = (text: string): boolean => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return false;
      }
      if ((parsed as { format?: unknown } | null)?.format !== WORKER_PROGRESS_FORMAT) return false;
      const line = WorkerProgress.safeParse(parsed);
      // the line's words go to no log (they may name a story): only that it was dropped
      if (!line.success || line.data.job !== job.id) console.warn(`${job.kind} ${job.id}: a progress line was dropped`);
      else onProgress?.(line.data);
      return true;
    };
    child.stdin.on("error", () => {}); // a runner that exits before reading: its exit says what happened
    child.stdin.end(JSON.stringify(job));
    const finish = (out: RunOutcome) => {
      clearTimeout(timer);
      clearTimeout(killing);
      signal?.removeEventListener("abort", onAbort);
      resolve(out);
    };
    // no process (a missing command): no exit follows. Any later error (a failed kill) leaves the exit to decide
    child.on("error", () => {
      if (child.pid === undefined) finish(retry("worker.spawn", "the runner could not be started"));
    });
    child.on("exit", (code, killedBy) => {
      exited = true;
      killGroup(); // anything the runner left behind; its output pipe then closes
      const outcome = (): RunOutcome => {
        const output = Buffer.concat([...chunks, Buffer.from(partial)]).toString("utf8");
        if (stopped) {
          // a graceful stop's answer, when the runner gave one (engine.layout: run.finished cancelled)
          const answer = graceful && code !== null ? read(output, code, job.id) : null;
          return answer?.outcome === "done" ? { ...answer, stoppedBy: stopped.code } : stopped;
        }
        if (code === null) return retry("worker.signal", `the runner was ended by ${killedBy ?? "a signal"}`);
        return read(output, code, job.id);
      };
      if (child.stdout.readableEnded || child.stdout.destroyed) return finish(outcome());
      const drained = setTimeout(() => finish(outcome()), DRAIN_MS);
      child.stdout.once("close", () => {
        clearTimeout(drained);
        finish(outcome());
      });
    });
  });
}

/** Runs the worker's health command (pgn_worker.health) with the runner's settings: true when it exits 0. */
export function healthy(settings: RunnerSettings): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(settings.command, settings.health, {
      cwd: settings.cwd,
      env: runnerEnv(settings.env),
      stdio: ["ignore", "ignore", "inherit"], // its reasons (never a value or a secret: health.py) go to the log
      timeout: settings.timeoutMs,
      killSignal: "SIGKILL",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** The runner's line and exit code → the outcome; any disagreement is a retry. */
export function read(stdout: string, code: number, jobId: string): RunOutcome {
  const expected = EXIT[code];
  if (expected === undefined) return retry("worker.exit", `the runner exited with ${code}`);
  const lines = stdout.split("\n");
  if (lines.length !== 2 || lines[1] !== "") return retry("worker.output", "the runner did not write one line");
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0] ?? "");
  } catch {
    return retry("worker.output", "the runner's line is not JSON");
  }
  const result = WorkerResult.safeParse(parsed);
  if (!result.success) return retry("worker.output", "the runner's line is not a result the contract takes");
  if (result.data.outcome !== expected) return retry("worker.output", `the runner's line disagrees with exit ${code}`);
  if (result.data.job !== jobId && !(result.data.job === null && result.data.outcome !== "done"))
    return retry("worker.output", "the runner's line is for another job");
  if (result.data.outcome === "done") return { outcome: "done", result: result.data };
  return { outcome: result.data.outcome, code: result.data.error.code, message: result.data.error.message };
}
