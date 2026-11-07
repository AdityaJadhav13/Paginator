// End to end (docs/product/10-l2-newsroom-plan.md §2.2): a photo uploaded through the API's routes is enqueued with its
// completion; the queue (apps/engine-queue, as pgn_engine) runs it through the real Python runner against the run's
// bucket, and reports to the inbox; the API's consumer applies the event; the asset is ready and its preview is the
// runner's JPEG. The newsprint conversion is stood in for (as in apps/engine-worker's tests: the real profile is
// private), with a fictional profile. Runs only when asked, and then fails, never skips:
//   PGN_QUEUE_PYTHON=apps/engine-worker/.venv/bin/python  (with pnpm test:db's database and object store; CI's worker
//   job runs it on a Postgres and a SeaweedFS of its own)
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportToInbox, runnerEnv, startQueue } from "@pageinator/engine-queue";
import type { FastifyBaseLogger } from "fastify";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { drainInbox } from "../../src/modules/media/engine-inbox.ts";
import { s3Store } from "../../src/storage/s3.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, newsroom } from "./newsroom.ts";
import { realPng } from "../support/pictures.ts";

const PYTHON = process.env["PGN_QUEUE_PYTHON"];
const WORKER = fileURLToPath(new URL("../../../engine-worker/", import.meta.url));
// the stand-in conversion (as test_jobs.py's), then the real command's main
const STAND_IN =
  "from pgn_worker.desk import images; images.rgb_to_cmyk = lambda img: img.convert('CMYK'); " +
  "from pgn_worker import run; raise SystemExit(run.main())";
const quiet = { error: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

describe.runIf(PYTHON)("a photo through the engine's queue, end to end", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let it_: IdentityApp;
  let su: Client;
  let a: Org;
  const n = newsroom(
    () => it_,
    () => su,
  );

  beforeAll(async () => {
    db = await freshDatabase();
    it_ = await identityApp(db);
    su = await db.connect("postgres");
    a = await n.organisation();
  }, 60_000);
  afterAll(async () => {
    await it_?.close();
    await db?.drop();
  });

  /** Runs the queue (as pgn_engine, the real runner) until the target's event reaches the inbox. */
  async function runQueueUntil(target: string) {
    const run = inject("database");
    const storage = inject("storage");
    const folder = mkdtempSync(join(tmpdir(), "pgn-e2e-"));
    const homes = join(folder, "homes");
    mkdirSync(homes);
    chmodSync(homes, 0o700);
    const profile = join(folder, "fictional.icc");
    writeFileSync(profile, "a fictional colour profile");
    const engineUrl = new URL("postgres://localhost");
    engineUrl.hostname = run.host;
    engineUrl.port = String(run.port);
    engineUrl.pathname = `/${db.name}`;
    engineUrl.username = "pgn_engine";
    engineUrl.password = encodeURIComponent(run.passwords.engine);
    const queue = await startQueue({
      connectionString: engineUrl.href,
      concurrency: 1,
      noHandleSignals: true,
      report: reportToInbox,
      runner: {
        command: PYTHON ?? "",
        args: ["-B", "-c", STAND_IN],
        health: ["-B", "-m", "pgn_worker.health"],
        cwd: WORKER,
        env: runnerEnv({
          ...process.env,
          PYTHONPATH: WORKER,
          PGN_S3_ENDPOINT: storage.endpoint,
          PGN_S3_ACCESS_KEY_ID: storage.accessKeyId,
          PGN_S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
          PGN_S3_WORK_BUCKET: storage.bucket,
          PGN_ICC_SHA256: createHash("sha256").update("a fictional colour profile").digest("hex"),
          PAGEINATOR_ICC: profile,
          PGN_WORKER_HOMES: homes,
        }),
        timeoutMs: 60_000,
      },
    });
    try {
      const end = Date.now() + 60_000;
      for (;;) {
        const { rowCount } = await su.query("select 1 from app.engine_event where asset_id = $1", [target]);
        if (rowCount) break;
        if (Date.now() > end) throw new Error("no event reached the inbox");
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      await queue.stop();
      await queue.promise;
    }
  }

  it("uploads, runs the runner, applies media.ready, and serves the preview", async () => {
    const base = `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}`;
    const file = realPng(300, 200);
    const presigned = await n.change("POST", `${base}/uploads`, a.ownerCookie, {
      purpose: "story_photo",
      filename: "photo.png",
      contentType: "image/png",
      bytes: file.length,
    });
    expect(presigned.statusCode, presigned.body).toBe(201);
    const policy = presigned.json();
    const form = new FormData();
    for (const [name, value] of Object.entries(policy.fields as Record<string, string>)) form.append(name, value);
    form.append("file", new Blob([file]));
    expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
    const done = await n.call("POST", `${base}/uploads/${policy.uploadId}/complete`, a.ownerCookie);
    expect(done.statusCode, done.body).toBe(200);
    const asset = done.json().asset as { id: string; status: string };
    expect(asset.status).toBe("received");

    await runQueueUntil(asset.id);
    expect((await su.query("select count(*)::int as n from queue._private_jobs")).rows).toEqual([{ n: 0 }]);
    await drainInbox(it_.database, quiet);
    const { rows } = await su.query("select status, problem from app.asset where id = $1", [asset.id]);
    expect(rows).toEqual([{ status: "ready", problem: null }]);
    const renditions = await su.query("select purpose, key from app.rendition where asset_id = $1 order by purpose", [
      asset.id,
    ]);
    expect(renditions.rows.map((r) => r.purpose)).toEqual(["cmyk", "preview", "thumb"]);
    const preview = await n.call("GET", `${base}/assets/${asset.id}/file?variant=preview`, a.ownerCookie);
    expect(preview.statusCode).toBe(302);
    const got = await fetch(preview.headers.location as string);
    expect(got.status).toBe(200);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // a JPEG
  }, 120_000);

  it("imports a Word file: the runner reads it with the Desk's code, and the API makes its stories", async () => {
    const base = `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}`;
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/' +
      '2006/main"><w:body><w:p><w:r><w:t>काल्पनिक मथळा</w:t></w:r></w:p><w:p><w:r><w:t>Byline: A. Writer</w:t></w:r>' +
      "</w:p><w:p><w:r><w:t>Fictional text.</w:t></w:r></w:p></w:body></w:document>";
    const file = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml) });
    const presigned = await n.change("POST", `${base}/uploads`, a.ownerCookie, {
      purpose: "docx",
      filename: "fictional.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: file.length,
    });
    expect(presigned.statusCode, presigned.body).toBe(201);
    const policy = presigned.json();
    const form = new FormData();
    for (const [name, value] of Object.entries(policy.fields as Record<string, string>)) form.append(name, value);
    form.append("file", new Blob([file]));
    expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
    const started = await n.change("POST", `${base}/imports/docx`, a.ownerCookie, { uploadId: policy.uploadId });
    expect(started.statusCode, started.body).toBe(202);
    const importId = started.json().importId as string;
    await runQueueUntil(importId);
    await drainInbox(it_.database, quiet, s3Store(it_.config.storage!));
    const got = (await n.call("GET", `${base}/imports/${importId}`, a.ownerCookie)).json();
    expect(got).toMatchObject({ state: "done", skipped: 0, notes: [], error: null });
    expect(got.created.map((c: { headline: string }) => c.headline)).toEqual(["काल्पनिक मथळा"]);
    const story = (await n.call("GET", `${base}/stories/${got.created[0].storyId}`, a.ownerCookie)).json();
    expect(story).toMatchObject({ byline: "A. Writer", body: "Fictional text.", status: "draft" });
  }, 120_000);
});
