// The runner for the engine's kinds (L2.3): a time limit of each kind's own, progress lines handed on as they come
// (the result line still read strictly), and a graceful stop (SIGTERM, then SIGKILL 10 s later) whose answer is read.
import { describe, expect, it } from "vitest";
import type { WorkerProgress } from "@pageinator/contracts";
import { runJob, runnerEnv, STOP_GRACE_MS, type RunnerSettings } from "../src/runner.ts";
import {
  doneResult,
  engineJob,
  finished,
  measured,
  onboardProgress,
  onboardRejected,
  progressLine,
  runProgress,
} from "./engine-fixtures.ts";

/** A stand-in runner (Node) that reads the job and then does what `script` says. */
function stub(script: string, timeoutMs = 10_000, limitsMs: RunnerSettings["limitsMs"] = {}): RunnerSettings {
  const read = "let job='';process.stdin.on('data',c=>job+=c);process.stdin.on('end',()=>{" + script + "});";
  return {
    command: process.execPath,
    args: ["-e", read],
    health: [],
    cwd: process.cwd(),
    env: {},
    timeoutMs,
    limitsMs,
  };
}
const lines = (...items: unknown[]) =>
  items.map((i) => (typeof i === "string" ? i : JSON.stringify(i)) + "\n").join("");
const write = (text: string, code = 0) => `process.stdout.write(${JSON.stringify(text)},()=>process.exit(${code}));`;
const FOREVER = "setInterval(()=>{},1000);";
/** On SIGTERM it writes `text` and exits 0 (the launcher's answer). */
const answerOnTerm = (text: string) => `process.on('SIGTERM',()=>{${write(text)}});` + FOREVER;

describe("the runner for the engine's kinds", () => {
  it("gives each kind its own time limit", async () => {
    const started = Date.now();
    const out = await runJob(engineJob("engine.layout"), stub(FOREVER, 60_000, { "engine.layout": 300 }));
    expect(out).toMatchObject({ outcome: "retry", code: "worker.timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    // another kind keeps the runner's default
    const ad = await runJob(engineJob("media.ad"), stub(FOREVER, 300, { "engine.layout": 60_000 }));
    expect(ad).toMatchObject({ outcome: "retry", code: "worker.timeout" });
  });

  it("hands on each progress line as it comes, drops one the contract refuses, and reads the result", async () => {
    const seen: WorkerProgress[] = [];
    const output = lines(
      progressLine(runProgress(1), 1),
      { format: "pageinator.worker-progress/1", job: "1", seq: 2, event: { kind: "run.progress" } }, // refused
      progressLine(runProgress(2), 3, "2"), // another job's
      progressLine(runProgress(3), 4),
      doneResult(finished("done")),
    );
    const out = await runJob(engineJob("engine.layout"), stub(write(output)), undefined, (p) => seen.push(p));
    expect(out).toMatchObject({ outcome: "done", result: { event: { kind: "run.finished" } } });
    expect(seen.map((p) => p.seq)).toEqual([1, 4]);
    // a measure's lines too
    const m: WorkerProgress[] = [];
    const measure = lines(progressLine(measured("measuring"), 1), doneResult(measured("done")));
    expect(await runJob(engineJob("engine.measure"), stub(write(measure)), undefined, (p) => m.push(p))).toMatchObject({
      outcome: "done",
    });
    expect(m).toHaveLength(1);
    // and an onboarding's
    const o: WorkerProgress[] = [];
    const onboard = lines(progressLine(onboardProgress(), 1), doneResult(onboardRejected()));
    expect(await runJob(engineJob("engine.onboard"), stub(write(onboard)), undefined, (p) => o.push(p))).toMatchObject({
      outcome: "done",
    });
    expect(o.map((p) => p.event.kind)).toEqual(["onboard.progress"]);
  });

  it("still reads exactly one result line", async () => {
    const two = lines(doneResult(finished("done")), doneResult(finished("done")));
    const after = lines(doneResult(finished("done")), "not json");
    for (const output of [two, after, lines(progressLine(runProgress(), 1)), ""])
      expect(await runJob(engineJob("engine.layout"), stub(write(output)))).toMatchObject({
        outcome: "retry",
        code: "worker.output",
      });
    // a kind that writes no progress: a progress line is output that is not a result
    const ad = lines(progressLine(runProgress(), 1), doneResult(finished("done")));
    expect(await runJob(engineJob("media.ad"), stub(write(ad)))).toMatchObject({ code: "worker.output" });
  });

  it("stops an engine job gracefully and reads its answer, saying why it was stopped", async () => {
    const cancel = new AbortController();
    setTimeout(() => cancel.abort(), 300);
    const answer = lines(doneResult(finished("cancelled")));
    const out = await runJob(engineJob("engine.layout"), stub(answerOnTerm(answer)), cancel.signal);
    expect(out).toMatchObject({
      outcome: "done",
      stoppedBy: "worker.cancelled",
      result: { event: { state: "cancelled" } },
    });
    const timedOut = await runJob(
      engineJob("engine.layout"),
      stub(answerOnTerm(answer), 60_000, { "engine.layout": 300 }),
    );
    expect(timedOut).toMatchObject({ outcome: "done", stoppedBy: "worker.timeout" });
    // no answer: the stop's own outcome
    const silent = await runJob(
      engineJob("engine.measure"),
      stub("process.on('SIGTERM',()=>process.exit(75));" + FOREVER, 300),
    );
    expect(silent).toMatchObject({ outcome: "retry", code: "worker.timeout" });
  });

  it("kills an engine job that ignores SIGTERM after the grace, and any other kind at once", async () => {
    const ignore = "process.on('SIGTERM',()=>{});" + FOREVER;
    let started = Date.now();
    // the stop comes once node has started and set its handler (seconds on a busy machine); the grace is what counts
    expect(await runJob(engineJob("engine.setup"), stub(ignore, 5_000))).toMatchObject({ code: "worker.timeout" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(STOP_GRACE_MS);
    started = Date.now();
    const answer = lines(doneResult(finished("cancelled")));
    expect(await runJob(engineJob("media.ad"), stub(answerOnTerm(answer), 200))).toMatchObject({
      outcome: "retry",
      code: "worker.timeout",
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 30_000);

  it("passes the engine's own settings to the runner", () => {
    expect(
      Object.keys(runnerEnv({ PGN_ENGINE_PYTHON: "/x", PGN_ENGINE_STALL_S: "600", PGN_LAYOUT_TIMEOUT_S: "1" })),
    ).toEqual(["PGN_ENGINE_PYTHON", "PGN_ENGINE_STALL_S"]);
  });
});
