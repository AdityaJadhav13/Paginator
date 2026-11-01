import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKER_JOB_FORMAT, type WorkerJob } from "@pageinator/contracts";
import { healthy, read, runJob, runnerEnv, type RunnerSettings } from "../src/runner.ts";
import { startQueue } from "../src/queue.ts";

// the Python runner's real results (packages/contracts' fixture, written by apps/engine-worker's ContractTests)
const results = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/test/fixtures/worker-results.json", import.meta.url), "utf8"),
) as Array<Record<string, unknown>>;
const ORG = "01890a5d-ac96-774b-bcce-b302099a8057";
const job: WorkerJob = {
  format: WORKER_JOB_FORMAT,
  id: "1",
  kind: "media.ingest",
  args: { org_id: ORG, pub_id: ORG, asset_id: ORG, version_id: "v1", sha256: "a".repeat(64) },
};
const line = (i: number, id: string | null = "1") => JSON.stringify({ ...results[i], job: id }) + "\n";

/** A stand-in runner: a Node script that reads the job and does what `script` says. */
function stub(script: string, timeoutMs = 10_000): RunnerSettings {
  const read = "let job='';process.stdin.on('data',c=>job+=c);process.stdin.on('end',()=>{" + script + "});";
  return { command: process.execPath, args: ["-e", read], health: ["-e", ""], cwd: process.cwd(), env: {}, timeoutMs };
}
/** A process that is alive (a zombie aside: `ps` shows it as Z). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return true;
}
/** The stub starts `sleep 30` (in its process group, its stdout the runner's), writes its pid to a file, then does
 * what `then` says. */
function withSleep(then: string, timeoutMs = 10_000) {
  const pidFile = join(mkdtempSync(join(tmpdir(), "pgn-queue-")), "sleep.pid");
  const script =
    "const s=require('child_process').spawn('sleep',['30'],{stdio:['ignore','inherit','ignore']});" +
    `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(s.pid));` +
    then;
  return { settings: stub(script, timeoutMs), pid: () => Number(readFileSync(pidFile, "utf8")) };
}
const write = (text: string, code: number) =>
  `process.stdout.write(${JSON.stringify(text)},()=>process.exit(${code}));`;

describe("the queue's runner", () => {
  it("takes a line the contract accepts with its exit code", async () => {
    expect(await runJob(job, stub(write(line(0), 0)))).toMatchObject({ outcome: "done" });
    expect(await runJob(job, stub(write(line(1), 0)))).toMatchObject({ outcome: "done" });
    expect(await runJob(job, stub(write(line(2), 65)))).toEqual({
      outcome: "failed",
      code: "worker.job",
      message: (results[2]?.["error"] as { message: string }).message,
    });
    expect(await runJob(job, stub(write(line(3), 78)))).toMatchObject({ outcome: "failed", code: "worker.config" });
    expect(await runJob(job, stub(write(line(8), 75)))).toMatchObject({ outcome: "retry", code: "worker.memory" });
    expect(await runJob(job, stub(write(line(10, null), 70)))).toMatchObject({
      outcome: "failed",
      code: "worker.internal",
    });
  });

  it("gives the runner the job on stdin", async () => {
    const echo =
      "const j=JSON.parse(job);" + "if(j.args.version_id!=='v1'||j.id!=='1')process.exit(3);" + write(line(0), 0);
    expect(await runJob(job, stub(echo))).toMatchObject({ outcome: "done" });
  });

  it("runs the job again when nothing was decided", async () => {
    const cases: Array<[string, string]> = [
      [write("", 0), "worker.output"], // no line
      [write(line(0) + line(0), 0), "worker.output"], // two lines
      [write(line(0).trim(), 0), "worker.output"], // no newline
      [write("{not json\n", 0), "worker.output"],
      [write(line(0), 65), "worker.output"], // the line disagrees with the exit code
      [write(line(2), 75), "worker.output"],
      [write(line(0, "2"), 0), "worker.output"], // another job's line
      [write(line(0, null), 0), "worker.output"],
      [write(JSON.stringify({ ...results[0], extra: 1 }) + "\n", 0), "worker.output"], // the contract refuses it
      [write(line(2), 74), "worker.exit"], // a closed stdout
      [write(line(2), 2), "worker.exit"], // an unknown option (argparse)
      [write(line(2), 1), "worker.exit"], // a Python traceback
      ["process.kill(process.pid,'SIGKILL');", "worker.signal"], // the out-of-memory killer
      ["process.stdout.write('x'.repeat(2*1024*1024),()=>process.exit(0));", "worker.output"], // not a result
    ];
    for (const [script, code] of cases)
      expect(await runJob(job, stub(script)), script).toMatchObject({ outcome: "retry", code });
    const missing = { ...stub(""), command: "/nonexistent/python" };
    expect(await runJob(job, missing)).toMatchObject({ outcome: "retry", code: "worker.spawn" });
  });

  it("kills a runner that takes too long, or when the queue cancels", async () => {
    const forever = "setInterval(()=>{},1000);";
    const started = Date.now();
    expect(await runJob(job, stub(forever, 300))).toMatchObject({ outcome: "retry", code: "worker.timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    const cancel = new AbortController();
    setTimeout(() => cancel.abort(), 300);
    expect(await runJob(job, stub(forever), cancel.signal)).toMatchObject({
      outcome: "retry",
      code: "worker.cancelled",
    });
    expect(await runJob(job, stub(forever), AbortSignal.abort())).toMatchObject({
      outcome: "retry",
      code: "worker.cancelled",
    });
  });

  it("kills the runner's whole process group at the time limit: nothing it started outlives it", async () => {
    const { settings, pid } = withSleep("setInterval(()=>{},1000);", 500);
    const started = Date.now();
    expect(await runJob(job, settings)).toMatchObject({ outcome: "retry", code: "worker.timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(pid())).toBe(false);
  });

  it("answers when the runner exits, though a process it left behind holds its output open", async () => {
    const { settings, pid } = withSleep(write(line(0), 0));
    const started = Date.now();
    expect(await runJob(job, settings)).toMatchObject({ outcome: "done" });
    expect(Date.now() - started).toBeLessThan(5_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(pid())).toBe(false);
  });

  it("gives the runner only its own settings, whatever it is handed", async () => {
    const check =
      "if(process.env.DATABASE_URL||process.env.PGN_QUEUE_DATABASE_URL||process.env.PGN_ICC_SHA256!=='x')process.exit(3);" +
      write(line(0), 0);
    const leaky = {
      ...stub(check),
      env: { DATABASE_URL: "postgres://x", PGN_QUEUE_DATABASE_URL: "postgres://y", PGN_ICC_SHA256: "x" },
    };
    expect(await runJob(job, leaky)).toMatchObject({ outcome: "done" });
  });

  it("runs the health command with the runner's settings", async () => {
    expect(await healthy({ ...stub(""), health: ["-e", "process.exit(0)"] })).toBe(true);
    expect(await healthy({ ...stub(""), health: ["-e", "process.exit(1)"] })).toBe(false);
    expect(
      await healthy({
        ...stub(""),
        health: ["-e", "process.exit(process.env.DATABASE_URL?1:0)"],
        env: { DATABASE_URL: "x" },
      }),
    ).toBe(true);
    expect(await healthy({ ...stub(""), command: "/nonexistent/python" })).toBe(false);
  });

  it("does not start the queue with an unhealthy worker or a time limit that is not one", async () => {
    const base = { connectionString: "postgres://nobody@127.0.0.1:1/none", concurrency: 1, report: async () => {} };
    await expect(startQueue({ ...base, runner: { ...stub(""), health: ["-e", "process.exit(1)"] } })).rejects.toThrow(
      /not healthy/,
    );
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      await expect(startQueue({ ...base, runner: stub("", timeoutMs) })).rejects.toThrow(/time limit/);
  });

  it("reads exactly one line", () => {
    expect(read(line(0), 0, "1").outcome).toBe("done");
    expect(read(line(0), 0, "2").outcome).toBe("retry");
    expect(read(line(0) + "\n", 0, "1").outcome).toBe("retry");
  });

  it("passes the runner its own settings only, never the queue's database", () => {
    const env = runnerEnv({
      PATH: "/usr/bin",
      PGN_ICC_SHA256: "a".repeat(64),
      PAGEINATOR_ICC: "/run/pageinator/newsprint.icc",
      PGN_S3_WORK_BUCKET: "work",
      PGN_S3_SECRET_ACCESS_KEY: "fictional",
      PGN_QUEUE_DATABASE_URL: "postgres://pgn_engine:fictional@db/pageinator",
      DATABASE_URL: "postgres://x",
      PGN_ENGINE_PASSWORD: "fictional",
      NODE_OPTIONS: "--require x",
    });
    expect(Object.keys(env).sort()).toEqual(
      ["PAGEINATOR_ICC", "PATH", "PGN_ICC_SHA256", "PGN_S3_SECRET_ACCESS_KEY", "PGN_S3_WORK_BUCKET"].sort(),
    );
  });
});
