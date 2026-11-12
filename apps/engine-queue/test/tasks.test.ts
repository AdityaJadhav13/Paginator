import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EngineEvent, WorkerResult } from "@pageinator/contracts";
import type { JobHelpers } from "graphile-worker";
import type { RunOutcome } from "../src/runner.ts";
import { engineTask, MAX_GIVEN_BACK, mediaIngest, RetryLater, type Report } from "../src/tasks.ts";

const results = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/test/fixtures/worker-results.json", import.meta.url), "utf8"),
) as unknown[];
const ready = WorkerResult.parse(results[0]);
if (ready.outcome !== "done" || ready.event.kind !== "media.ready")
  throw new Error("the fixture's first result is a ready photo");
const payload = {
  org_id: ready.event.org_id,
  pub_id: ready.event.pub_id,
  asset_id: ready.event.asset_id,
  version_id: "v1",
  sha256: ready.event.sha256,
};
const settings = { command: "unused", args: [], health: [], cwd: ".", env: {}, timeoutMs: 1 };

/** Graphile Worker's helpers for job 7, its lock held by "pool-1"; `givenBack` is how many rows the give-back
 * UPDATE changes (1: this queue holds the lock; 0: it does not, or the ceiling is reached; "error": no database). */
function helpers(attempts = 1, max = 3, givenBack: 0 | 1 | "error" = 1) {
  const logged: string[] = [];
  const queries: unknown[][] = [];
  const h = {
    job: { id: "7", attempts, max_attempts: max, locked_by: "pool-1" },
    abortSignal: new AbortController().signal,
    logger: { error: (m: string) => logged.push(m), warn: (m: string) => logged.push(m) },
    withPgClient: async (fn: (c: unknown) => unknown) =>
      fn({
        query: async (text: string, values: unknown[]) => {
          queries.push([text, values]);
          if (givenBack === "error") throw new Error("the pool has ended");
          return { rowCount: givenBack };
        },
      }),
  } as unknown as JobHelpers;
  return { h, logged, queries };
}

type Options = { attempts?: number; max?: number; givenBack?: 0 | 1 | "error"; report?: Report };

async function task(
  out: RunOutcome,
  payloadGiven: unknown = payload,
  options: Options = {},
  kind: "media.ingest" | "docx.import" = "media.ingest",
) {
  const reported: EngineEvent[] = [];
  const ids: string[] = [];
  const jobs: unknown[] = [];
  let stops = 0;
  const run = async (job: unknown) => (jobs.push(job), out);
  const { h, logged, queries } = helpers(options.attempts ?? 1, options.max ?? 3, options.givenBack ?? 1);
  const report: Report =
    options.report ??
    (async (e, id) => {
      reported.push(EngineEvent.parse(e));
      ids.push(id);
    });
  const t =
    kind === "media.ingest"
      ? mediaIngest(settings, report, () => (stops += 1), run)
      : engineTask(kind, settings, report, () => (stops += 1), run);
  const thrown = await Promise.resolve(t(payloadGiven as never, h)).then(
    () => null,
    (e: unknown) => e,
  );
  return { reported, ids, jobs, logged, thrown, queries, stops, job: h.job };
}

describe("media.ingest in the queue", () => {
  it("gives the runner the queue's job id and the ids-only payload, and reports its event", async () => {
    const { reported, ids, jobs, thrown } = await task({ outcome: "done", result: ready });
    expect(thrown).toBeNull();
    expect(jobs).toEqual([{ format: "pageinator.worker-job/1", id: "7", kind: "media.ingest", args: payload }]);
    expect(reported).toEqual([ready.event]);
    expect(ids).toEqual(["7"]); // the inbox's key for one event per job
  });

  it("reports a final failure as job.failed for the asset", async () => {
    const { reported, thrown } = await task({ outcome: "failed", code: "worker.checksum", message: "x" });
    expect(thrown).toBeNull();
    expect(reported).toEqual([
      {
        kind: "job.failed",
        org_id: payload.org_id,
        pub_id: payload.pub_id,
        job_kind: "media.ingest",
        target_id: payload.asset_id,
        code: "worker.checksum",
        message: "x",
      },
    ]);
  });

  it("runs a retry again, and settles it on the last attempt", async () => {
    const retry = { outcome: "retry", code: "worker.store", message: "the store failed" } as const;
    const first = await task(retry, payload, { attempts: 1 });
    expect(first.thrown).toBeInstanceOf(RetryLater);
    expect(first.reported).toEqual([]);
    expect((first.thrown as Error).message).not.toContain("the store failed");
    const last = await task(retry, payload, { attempts: 3 });
    expect(last.thrown).toBeNull();
    expect(last.reported.map((e) => e.kind === "job.failed" && e.code)).toEqual(["worker.store"]);
  });

  it("never reports an event for another asset", async () => {
    const other = structuredClone(ready);
    if (other.outcome === "done" && other.event.kind === "media.ready")
      other.event.asset_id = "01890a5d-ac96-774b-bcce-b302099a8060";
    const { reported } = await task({ outcome: "done", result: other as typeof ready });
    expect(reported.map((e) => e.kind === "job.failed" && [e.code, e.target_id])).toEqual([
      ["worker.output", payload.asset_id],
    ]);
  });

  it("settles a payload that drifted from ids only as job.failed for its asset, without running it", async () => {
    for (const bad of [
      { ...payload, original_key: "orgs/x" },
      { ...payload, filename: "fictional.jpg" },
      { ...payload, sha256: "x" },
    ]) {
      const { reported, jobs, thrown } = await task({ outcome: "done", result: ready }, bad);
      expect([jobs, thrown]).toEqual([[], null]);
      expect(reported.map((e) => e.kind === "job.failed" && [e.code, e.target_id])).toEqual([
        ["worker.job", payload.asset_id],
      ]);
    }
  });

  it("drops a payload that names no asset, without running it", async () => {
    for (const bad of [{ ...payload, asset_id: "x" }, { org_id: payload.org_id }, null, []]) {
      const { reported, jobs, logged, thrown } = await task({ outcome: "done", result: ready }, bad);
      expect([reported, jobs, thrown]).toEqual([[], [], null]);
      expect(logged).toHaveLength(1);
    }
  });

  it("gives a cancelled attempt back, even the last, and never reports it", async () => {
    const cancel = {
      outcome: "retry",
      code: "worker.cancelled",
      message: "the queue stopped while the job ran",
    } as const;
    const { reported, thrown, queries, job, stops } = await task(cancel, payload, { attempts: 3, max: 3 });
    expect(thrown).toBeInstanceOf(RetryLater);
    expect(reported).toEqual([]);
    expect(stops).toBe(0);
    expect(queries).toEqual([
      [expect.stringContaining("max_attempts = max_attempts + 1"), ["7", "pool-1", MAX_GIVEN_BACK]],
    ]);
    expect(job.max_attempts).toBe(4);
  });

  it("stops the queue on a misconfigured worker and gives the attempt back", async () => {
    const config = { outcome: "failed", code: "worker.config", message: "PGN_ICC_SHA256 is not set" } as const;
    const last = await task(config, payload, { attempts: 3, max: 3 });
    expect([last.thrown instanceof RetryLater, last.reported, last.stops, last.queries.length]).toEqual([
      true,
      [],
      1,
      1,
    ]);
  });

  it("spends a cancel or a misconfigured worker as any attempt once nothing can be given back", async () => {
    const config = { outcome: "failed", code: "worker.config", message: "PGN_ICC_SHA256 is not set" } as const;
    const cancel = { outcome: "retry", code: "worker.cancelled", message: "the queue stopped" } as const;
    for (const givenBack of [0, "error"] as const) {
      const early = await task(config, payload, { attempts: 1, max: 3, givenBack });
      expect([early.thrown instanceof RetryLater, early.reported]).toEqual([true, []]);
      const last = await task(config, payload, { attempts: 3, max: 3, givenBack }); // the last resort: final
      expect(last.thrown).toBeNull();
      expect(last.reported.map((e) => e.kind === "job.failed" && e.code)).toEqual(["worker.config"]);
      const cancelled = await task(cancel, payload, { attempts: 3, max: 3, givenBack });
      expect(cancelled.reported.map((e) => e.kind === "job.failed" && e.code)).toEqual(["worker.cancelled"]);
    }
  });

  it("tries the report again when the inbox fails, and fails the job when it keeps failing", async () => {
    let calls = 0;
    const flaky: Report = async () => {
      calls += 1;
      if (calls < 3) throw new Error("the inbox is down");
    };
    const recovered = await task({ outcome: "done", result: ready }, payload, { report: flaky });
    expect([recovered.thrown, calls]).toEqual([null, 3]);
    calls = 0;
    const down: Report = async () => {
      calls += 1;
      throw new Error("the inbox is down");
    };
    const lost = await task({ outcome: "failed", code: "worker.checksum", message: "x" }, payload, {
      attempts: 3,
      report: down,
    });
    expect([(lost.thrown as Error).message, calls]).toEqual(["the inbox is down", 3]);
  }, 20_000);
});

const docxResults = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/test/fixtures/docx-results.json", import.meta.url), "utf8"),
) as unknown[];
const docxParsed = WorkerResult.parse(docxResults[0]);
if (docxParsed.outcome !== "done" || docxParsed.event.kind !== "import.parsed")
  throw new Error("the docx fixture's first result is a parsed file");
const docxPayload = {
  org_id: docxParsed.event.org_id,
  pub_id: docxParsed.event.pub_id,
  import_id: docxParsed.event.import_id,
  version_id: "v1",
  sha256: docxParsed.event.sha256,
};

describe("docx.import in the queue", () => {
  it("gives the runner a docx.import job and reports its event", async () => {
    const { reported, jobs } = await task({ outcome: "done", result: docxParsed }, docxPayload, {}, "docx.import");
    expect(jobs).toEqual([{ format: "pageinator.worker-job/1", id: "7", kind: "docx.import", args: docxPayload }]);
    expect(reported).toEqual([docxParsed.event]);
  });

  it("never reports an event for another import, nor a photo's event", async () => {
    const other = { ...docxPayload, import_id: "01890a5d-ac96-774b-bcce-b302099a8060" };
    const wrong = await task({ outcome: "done", result: docxParsed }, other, {}, "docx.import");
    expect(wrong.reported.map((e) => e.kind === "job.failed" && [e.code, e.job_kind, e.target_id])).toEqual([
      ["worker.output", "docx.import", other.import_id],
    ]);
    const photo = await task({ outcome: "done", result: ready }, docxPayload, {}, "docx.import");
    expect(photo.reported.map((e) => e.kind === "job.failed" && e.code)).toEqual(["worker.output"]);
  });

  it("settles a payload that drifted as a failed import", async () => {
    const { reported } = await task(
      { outcome: "done", result: docxParsed },
      { ...docxPayload, extra: 1 },
      {},
      "docx.import",
    );
    expect(reported.map((e) => e.kind === "job.failed" && [e.code, e.target_id])).toEqual([
      ["worker.job", docxPayload.import_id],
    ]);
  });
});
