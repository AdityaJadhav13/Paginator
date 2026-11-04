import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DocxResult,
  EngineEvent,
  MediaIngestPayload,
  UploadRequest,
  WORKER_JOB_FORMAT,
  WorkerJob,
  WorkerResult,
} from "../src/index.ts";

// What the Python runner really wrote (apps/engine-worker test_jobs.py ContractTests, on fictional pictures), one result
// of each kind: a ready photo, refused ones, and every error code (a long store message cut to the contract's length).
const results = JSON.parse(
  readFileSync(new URL("./fixtures/worker-results.json", import.meta.url), "utf8"),
) as unknown[];
const ORG = "01890a5d-ac96-774b-bcce-b302099a8057";

describe("the engine's contracts", () => {
  it("read the runner's own results", () => {
    expect(results.map((r) => WorkerResult.parse(r).outcome)).toEqual([
      ...["done", "done", "failed", "failed", "done", "failed", "failed", "retry", "retry"],
      ...["failed", "failed", "failed", "failed", "retry"],
    ]);
    const codes = results
      .map((r) => WorkerResult.parse(r))
      .map((r) => (r.outcome === "done" ? r.event.kind : r.error.code));
    expect(new Set(codes)).toEqual(
      new Set([
        "media.ready",
        "media.rejected",
        ...["job", "config", "key", "store", "memory", "internal", "missing", "checksum", "profile"].map(
          (c) => `worker.${c}`,
        ),
      ]),
    );
    const [ready, rejected] = results.map((r) => WorkerResult.parse(r));
    expect(ready?.outcome === "done" && ready.event.kind).toBe("media.ready");
    expect(rejected?.outcome === "done" && rejected.event.kind).toBe("media.rejected");
    for (const r of results.slice(0, 2)) EngineEvent.parse((r as { event: unknown }).event);
  });

  it("refuse anything else", () => {
    const ready = structuredClone(results[0]) as { event: Record<string, unknown> } & Record<string, unknown>;
    for (const change of [
      (r: typeof ready) => (r.event["extra"] = 1),
      (r: typeof ready) => (r.event["org_id"] = ORG.toUpperCase()),
      (r: typeof ready) => (r.event["pub_id"] = "01890a5d-ac96-474b-bcce-b302099a8057"), // version 4
      (r: typeof ready) => (r.event["org_id"] = "01890a5d-ac96-074b-bcce-b302099a8057"), // version 0
      (r: typeof ready) => (r.event["renditions"] = []),
      // what the database would refuse (app.rendition.bytes is an integer) is the contract's to refuse
      (r: typeof ready) => (r.event["bytes"] = 2 ** 31),
      (r: typeof ready) =>
        ((r.event["renditions"] as Record<string, unknown>[])[0] = {
          ...(r.event["renditions"] as Record<string, unknown>[])[0],
          bytes: 2 ** 31,
        }),
      (r: typeof ready) => (r["outcome"] = "retry"),
      (r: typeof ready) => (r["format"] = "pageinator.worker-result/2"),
    ]) {
      const bad = structuredClone(ready);
      change(bad);
      expect(WorkerResult.safeParse(bad).success).toBe(false);
    }
  });

  it("refuse a code longer than the database's 120 characters", () => {
    const rejected = (structuredClone(results[1]) as { event: Record<string, unknown> }).event;
    expect(EngineEvent.safeParse({ ...rejected, code: `m.${"a".repeat(120)}` }).success).toBe(true);
    expect(EngineEvent.safeParse({ ...rejected, code: `m.${"a".repeat(121)}` }).success).toBe(false);
    const failed = {
      kind: "job.failed",
      org_id: ORG,
      pub_id: ORG,
      job_kind: "media.ingest",
      target_id: ORG,
      message: "",
    };
    expect(EngineEvent.safeParse({ ...failed, code: `worker.${"a".repeat(120)}` }).success).toBe(true);
    expect(EngineEvent.safeParse({ ...failed, code: `worker.${"a".repeat(121)}` }).success).toBe(false);
  });

  it("keep a job's payload to ids and the exact bytes' facts", () => {
    const good = { org_id: ORG, pub_id: ORG, asset_id: ORG, version_id: "v1", sha256: "a".repeat(64) };
    expect(MediaIngestPayload.parse(good)).toEqual(good);
    for (const extra of [{ original_key: "orgs/x" }, { filename: "fictional.jpg" }, { headline: "x" }])
      expect(MediaIngestPayload.safeParse({ ...good, ...extra }).success).toBe(false);
    expect(MediaIngestPayload.safeParse({ ...good, sha256: "A".repeat(64) }).success).toBe(false);
    // an organisation's id is Better Auth's (version 4); the database's ids are version 7 only
    const v4 = "9b2f4c1e-5d3a-4f6b-8c7d-0e1f2a3b4c5d";
    expect(MediaIngestPayload.safeParse({ ...good, org_id: v4 }).success).toBe(true);
    expect(MediaIngestPayload.safeParse({ ...good, pub_id: v4 }).success).toBe(false);
  });

  it("give the runner a job it takes: the format, the queue's id, the kind and the payload, nothing more", () => {
    const args = { org_id: ORG, pub_id: ORG, asset_id: ORG, version_id: "v1", sha256: "a".repeat(64) };
    const job = { format: WORKER_JOB_FORMAT, id: "42", kind: "media.ingest", args };
    expect(WorkerJob.parse(job)).toEqual(job);
    for (const bad of [
      { ...job, extra: 1 },
      { ...job, id: "" },
      { ...job, id: "a b" },
      { ...job, id: "x".repeat(129) },
      { ...job, kind: "engine.layout" },
      { ...job, format: "pageinator.worker-job/2" },
      { ...job, args: { ...args, original_key: "orgs/x" } },
    ])
      expect(WorkerJob.safeParse(bad).success).toBe(false);
  });

  it("read docx.import's own results (apps/engine-worker test_docx_import.py ContractTests)", () => {
    const docx = JSON.parse(
      readFileSync(new URL("./fixtures/docx-results.json", import.meta.url), "utf8"),
    ) as unknown[];
    const kinds = docx.map((r) => WorkerResult.parse(r)).map((r) => (r.outcome === "done" ? r.event.kind : null));
    expect(kinds).toEqual(["import.parsed", "import.rejected"]);
    const parsed = structuredClone(docx[0]) as { event: Record<string, unknown> };
    parsed.event["headline"] = "story text never rides in the event";
    expect(WorkerResult.safeParse(parsed).success).toBe(false);
    const args = { org_id: ORG, pub_id: ORG, import_id: ORG, version_id: "v1", sha256: "a".repeat(64) };
    expect(WorkerJob.safeParse({ format: WORKER_JOB_FORMAT, id: "1", kind: "docx.import", args }).success).toBe(true);
    // a docx job never carries an asset's arguments, nor a photo's job a docx's
    expect(WorkerJob.safeParse({ format: WORKER_JOB_FORMAT, id: "1", kind: "media.ingest", args }).success).toBe(false);
    expect(
      DocxResult.safeParse({
        format: "pageinator.docx-result/1",
        articles: [{ headline: "H", byline: "", body: "B" }],
        notes: [{ code: "docx.tables", count: 1, text: "1 table was not imported." }],
      }).success,
    ).toBe(true);
  });

  it("take a Word file's upload only as docx, and a picture's never as docx", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const up = { filename: "fictional.docx", bytes: 10 };
    expect(UploadRequest.safeParse({ ...up, purpose: "docx", contentType: docx }).success).toBe(true);
    expect(UploadRequest.safeParse({ ...up, purpose: "docx", contentType: "image/jpeg" }).success).toBe(false);
    expect(UploadRequest.safeParse({ ...up, purpose: "library", contentType: docx }).success).toBe(false);
    expect(UploadRequest.safeParse({ ...up, purpose: "library", contentType: "image/png" }).success).toBe(true);
  });
});
