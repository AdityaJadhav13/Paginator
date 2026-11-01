// Runs one job through the Python runner (apps/engine-worker, `python -B -m pgn_worker.run`): the job on stdin, one
// result line on stdout, the exit code beside it (pgn_worker/run.py). Anything else (no line, a line the contract
// refuses, a line that disagrees with its exit code, an unknown code, a death by a signal such as the kernel's
// out-of-memory killer, the time limit, a cancel) decides nothing: the job is run again. The runner runs in a process
// group of its own, and the whole group is killed at the time limit, on a cancel, and once the runner has exited, so
// nothing it started outlives it.
import { spawn } from "node:child_process";
import { WorkerResult, type WorkerJob } from "@pageinator/contracts";

/** What the queue does with a run: report the event, report a final failure, or run the job again. */
export type RunOutcome =
  | { outcome: "done"; result: Extract<WorkerResult, { outcome: "done" }> }
  | { outcome: "failed"; code: string; message: string }
  | { outcome: "retry"; code: string; message: string };

export type RunnerSettings = {
  command: string; // the worker's Python (the image's venv)
  args: readonly string[]; // ["-B", "-m", "pgn_worker.run"]
  health: readonly string[]; // ["-B", "-m", "pgn_worker.health"]: run before the queue takes any job
  cwd: string;
  env: NodeJS.ProcessEnv; // filtered by runnerEnv before any runner sees it: never the queue's database
  timeoutMs: number;
};

/** The exit codes pgn_worker/run.py documents, and the outcome each must come with. */
const EXIT: Record<number, WorkerResult["outcome"]> = {
  0: "done",
  65: "failed",
  70: "failed",
  75: "retry",
  78: "failed",
};
const MAX_STDOUT = 1024 * 1024; // a result line is a few kilobytes; more is not a result
const DRAIN_MS = 2_000; // after the runner exits, how long its output may take to arrive
/** The runner's settings, copied from the queue's environment: nothing else reaches Python (no database URL). */
const PASSED =
  /^(PATH|HOME|LANG|LC_[A-Z]+|TMPDIR|PYTHONPATH|PYTHONDONTWRITEBYTECODE|PAGEINATOR_ICC|PGN_ICC_SHA256|PGN_S3_[A-Z_]+|PGN_WORKER_HOMES)$/;

export function runnerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => PASSED.test(name)));
}

const retry = (code: string, message: string): RunOutcome => ({ outcome: "retry", code, message });

export function runJob(job: WorkerJob, settings: RunnerSettings, signal?: AbortSignal): Promise<RunOutcome> {
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
    let stopped: RunOutcome | null = null;
    let exited = false;
    const killGroup = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // the group is gone already
      }
    };
    const stop = (why: RunOutcome) => {
      if (exited) return; // a finished run keeps its own outcome
      stopped ??= why;
      killGroup();
    };
    const timer = setTimeout(
      () => stop(retry("worker.timeout", `the runner took longer than ${settings.timeoutMs} ms`)),
      settings.timeoutMs,
    );
    const onAbort = () => stop(retry("worker.cancelled", "the queue stopped while the job ran"));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_STDOUT) stop(retry("worker.output", "the runner wrote more than a result"));
      else chunks.push(chunk);
    });
    child.stdin.on("error", () => {}); // a runner that exits before reading: its exit says what happened
    child.stdin.end(JSON.stringify(job));
    const finish = (out: RunOutcome) => {
      clearTimeout(timer);
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
        if (stopped) return stopped;
        if (code === null) return retry("worker.signal", `the runner was ended by ${killedBy ?? "a signal"}`);
        return read(Buffer.concat(chunks).toString("utf8"), code, job.id);
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
