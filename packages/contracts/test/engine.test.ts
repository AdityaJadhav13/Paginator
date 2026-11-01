import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EngineEvent, MediaIngestPayload, WorkerResult } from "../src/index.ts";

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
      (r: typeof ready) => (r.event["org_id"] = "01890a5d-ac96-474b-bcce-b302099a8057"), // version 4
      (r: typeof ready) => (r.event["renditions"] = []),
      (r: typeof ready) => (r["outcome"] = "retry"),
      (r: typeof ready) => (r["format"] = "pageinator.worker-result/2"),
    ]) {
      const bad = structuredClone(ready);
      change(bad);
      expect(WorkerResult.safeParse(bad).success).toBe(false);
    }
  });

  it("keep a job's payload to ids and the exact bytes' facts", () => {
    const good = { org_id: ORG, pub_id: ORG, asset_id: ORG, version_id: "v1", sha256: "a".repeat(64) };
    expect(MediaIngestPayload.parse(good)).toEqual(good);
    for (const extra of [{ original_key: "orgs/x" }, { filename: "fictional.jpg" }, { headline: "x" }])
      expect(MediaIngestPayload.safeParse({ ...good, ...extra }).success).toBe(false);
    expect(MediaIngestPayload.safeParse({ ...good, sha256: "A".repeat(64) }).success).toBe(false);
  });
});
