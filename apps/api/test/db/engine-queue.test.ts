// The engine's queue on the API's side (docs/product/10-l2-newsroom-plan.md §2.2 "The API part"; migration
// 2026_11_27_0001), on a migrated clone and the run's bucket: the job enqueued with the upload's completion (or not at
// all), the wrapper's tenancy check, the inbox's rights and its one row per job, the consumer for each event and for
// events it must not apply, the live hint, the preview, and the sweep. The queue's runner is not run here (the
// end-to-end test, engine-e2e.test.ts, runs it); its events are written as pgn_engine writes them.
import { createHash, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueMediaIngest } from "../../src/db/media.ts";
import {
  DEADLINE_MS,
  MAX_TRIES,
  STALE_MS,
  drainInbox,
  startEngineInbox,
  sweep,
} from "../../src/modules/media/engine-inbox.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";
import { jpeg } from "../support/pictures.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
let engine: Client;
let app: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let b: Org;
let reporter: Person;
const logged: { level: string; what: unknown; msg: string }[] = [];
const log = {
  error: (what: unknown, msg: string) => void logged.push({ level: "error", what, msg }),
  warn: (what: unknown, msg: string) => void logged.push({ level: "warn", what, msg }),
} as unknown as FastifyBaseLogger;

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  engine = await db.connect("engine");
  app = await db.connect("app");
  a = await n.organisation();
  b = await n.organisation();
  reporter = await n.member(a, [{ publicationId: a.pubId, roles: ["reporter"], grants: [] }], "member", "reporter");
}, 60_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const base = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}`;

async function uploaded(cookie: string, seed: number, org = a) {
  const file = jpeg(1200, 800, 0, seed);
  const presigned = await change("POST", `${base(org)}/uploads`, cookie, {
    purpose: "story_photo",
    filename: "photo.jpg",
    contentType: "image/jpeg",
    bytes: file.length,
  });
  expect(presigned.statusCode, presigned.body).toBe(201);
  const policy = presigned.json();
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields as Record<string, string>)) form.append(name, value);
  form.append("file", new Blob([file]));
  expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
  const done = await call("POST", `${base(org)}/uploads/${policy.uploadId}/complete`, cookie);
  expect(done.statusCode, done.body).toBe(200);
  return done.json().asset as { id: string; sha256: string };
}

type Job = { id: string; payload: Record<string, unknown>; key: string; max_attempts: number; task: string };
async function jobsFor(assetId: string): Promise<Job[]> {
  const { rows } = await su.query<Job>(
    `select j.id::text, j.payload, j.key, j.max_attempts, t.identifier as task
     from queue._private_jobs j join queue._private_tasks t on t.id = j.task_id where j.key = $1`,
    [`asset:${assetId}`],
  );
  return rows;
}

const assetRow = async (id: string) =>
  (await su.query("select status, problem from app.asset where id = $1", [id])).rows[0] as {
    status: string;
    problem: string | null;
  };

/** What the queue's report writes (apps/engine-queue/src/inbox.ts), as pgn_engine. */
async function report(event: Record<string, unknown>, jobId: string = randomUUID()) {
  const asset = (event["kind"] === "job.failed" ? event["target_id"] : event["asset_id"]) as string;
  await engine.query(
    `with added as (
       insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, $3, $4, $5)
       on conflict do nothing
     ) select pg_notify('engine_events', $2)`,
    [event["org_id"], jobId, event["kind"], asset, JSON.stringify(event)],
  );
  return jobId;
}

const hex = (s: string) => createHash("sha256").update(s).digest("hex");
const PARAMS = "0123456789abcdef0123456789abcdef";
function ready(
  org: Org,
  asset: { id: string; sha256: string },
  key = (purpose: string, ext: string) =>
    `orgs/${org.orgId}/pubs/${org.pubId}/assets/${asset.id}/r/${purpose}-${PARAMS}.${ext}`,
) {
  const rendition = (purpose: "preview" | "thumb" | "cmyk", ext: string, mime: string) => ({
    purpose,
    key: key(purpose, ext),
    version_id: `v-${purpose}`,
    sha256: hex(purpose),
    bytes: 100,
    mime,
    width_px: 1200,
    height_px: 800,
  });
  return {
    kind: "media.ready",
    org_id: org.orgId,
    pub_id: org.pubId,
    asset_id: asset.id,
    sha256: asset.sha256,
    bytes: 1000,
    mime: "image/jpeg",
    width_px: 1200,
    height_px: 800,
    raster: { width_px: 1200, height_px: 800 },
    params_hash: PARAMS,
    renditions: [
      rendition("preview", "jpg", "image/jpeg"),
      rendition("thumb", "jpg", "image/jpeg"),
      rendition("cmyk", "cmyk.gz", "application/gzip"),
    ],
  };
}
const rejected = (org: Org, asset: { id: string; sha256: string }) => ({
  kind: "media.rejected",
  org_id: org.orgId,
  pub_id: org.pubId,
  asset_id: asset.id,
  sha256: asset.sha256,
  code: "m.img.damaged",
  message: "The picture file is damaged or incomplete. Try saving it again.",
  status: 400,
});
const failed = (org: Org, assetId: string, code = "worker.missing") => ({
  kind: "job.failed",
  org_id: org.orgId,
  pub_id: org.pubId,
  job_kind: "media.ingest",
  target_id: assetId,
  code,
  message: "the original's version is not in the store",
});

const outcomeOf = async (jobId: string) =>
  (await su.query("select outcome from app.engine_event where job_id = $1", [jobId])).rows[0]?.outcome as string;
const audits = async (action: string, target: string) =>
  (
    await su.query(
      "select actor_kind, actor_id, data, publication_id from app.audit_event where action = $1 and target_id = $2",
      [action, target],
    )
  ).rows;

describe("enqueueing", () => {
  it("adds the asset's job with its completion: ids only, 10 attempts, keyed by the asset", async () => {
    const asset = await uploaded(a.ownerCookie, 1);
    const { rows } = await su.query("select version_id from app.asset where id = $1", [asset.id]);
    expect(await assetRow(asset.id)).toEqual({ status: "received", problem: null });
    expect(await jobsFor(asset.id)).toEqual([
      {
        id: expect.any(String),
        task: "media.ingest",
        key: `asset:${asset.id}`,
        max_attempts: 10,
        payload: {
          org_id: a.orgId,
          pub_id: a.pubId,
          asset_id: asset.id,
          version_id: rows[0].version_id,
          sha256: asset.sha256,
        },
      },
    ]);
    // the same bytes again are the same asset: no second job
    const again = await uploaded(a.ownerCookie, 1);
    expect(again.id).toBe(asset.id);
    expect(await jobsFor(asset.id)).toHaveLength(1);
  });

  it("leaves no job when the transaction rolls back", async () => {
    const assetId = "01890a5d-ac96-774b-bcce-b302099a8059";
    const tenant = { orgId: a.orgId, userId: reporter.id, pubIds: [a.pubId], requestId: "rollback-test" };
    await expect(
      it_.database.withTenant(tenant, async (tx) => {
        await enqueueMediaIngest(tx, {
          orgId: a.orgId,
          publicationId: a.pubId,
          assetId,
          versionId: "v1",
          sha256: "a".repeat(64),
        });
        expect(await jobsFor(assetId)).toEqual([]); // not committed: the superuser sees nothing yet
        throw new Error("the completion failed after the enqueue");
      }),
    ).rejects.toThrow(/completion failed/);
    expect(await jobsFor(assetId)).toEqual([]);
  });

  it("refuses another organisation's job, and a call outside withTenant", async () => {
    const args = [b.orgId, b.pubId, "01890a5d-ac96-774b-bcce-b302099a805a", "v1", "a".repeat(64)];
    const enqueue = "select app.enqueue_media_ingest($1, $2, $3, $4, $5)";
    await expect(app.query(enqueue, args)).rejects.toMatchObject({ code: "42501" });
    await app.query("begin");
    try {
      await app.query("select set_config('app.org_id', $1, true)", [a.orgId]);
      await expect(app.query(enqueue, args)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.query("rollback");
    }
    // nor may pgn_app (or pgn_engine) reach Graphile Worker's own functions or tables beyond its grants
    await expect(app.query("select queue.add_job('media.ingest', '{}')")).rejects.toThrow(/permission denied/);
    await expect(app.query("insert into queue._private_jobs (task_id, payload) values (1, '{}')")).rejects.toThrow(
      /permission denied/,
    );
    await expect(engine.query(enqueue, args)).rejects.toThrow(/permission denied/);
  });
});

describe("the inbox", () => {
  it("takes one row per job: a second report of a job is dropped", async () => {
    const asset = await uploaded(a.ownerCookie, 2);
    const jobId = await report(failed(a, asset.id));
    await report(ready(a, asset), jobId);
    const { rows } = await su.query("select kind, processed_at from app.engine_event where job_id = $1", [jobId]);
    expect(rows).toEqual([{ kind: "job.failed", processed_at: null }]);
  });

  it("lets pgn_engine only add waiting rows: never read, change or remove one, nor any other app table", async () => {
    const asset = await uploaded(a.ownerCookie, 3);
    for (const sql of [
      "select * from app.engine_event",
      "update app.engine_event set outcome = 'applied'",
      "delete from app.engine_event",
      "select * from app.asset",
      "update app.asset set status = 'ready'",
      "insert into app.rendition (org_id) values (gen_random_uuid())",
    ])
      await expect(engine.query(sql), sql).rejects.toThrow(/permission denied/);
    await expect(
      engine.query(
        `insert into app.engine_event (org_id, job_id, kind, asset_id, payload, processed_at, outcome)
         values ($1, 'planted', 'job.failed', $2, '{}', now(), 'applied')`,
        [a.orgId, asset.id],
      ),
    ).rejects.toThrow(/row-level security/);
    // nor with an organisation's wall open (org_wall alone would let it plant a processed row, dropping a real report)
    for (const columns of [
      "processed_at, outcome) values ($1, 'planted', 'job.failed', $2, '{}', now(), 'applied'",
      "tries) values ($1, 'planted', 'job.failed', $2, '{}', 5",
    ]) {
      await engine.query("begin");
      try {
        await engine.query("select set_config('app.org_id', $1, true)", [a.orgId]);
        await expect(
          engine.query(`insert into app.engine_event (org_id, job_id, kind, asset_id, payload, ${columns})`, [
            a.orgId,
            asset.id,
          ]),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await engine.query("rollback");
      }
    }
  });

  it("lets pgn_app add only a waiting job.failed (the sweep's), under its organisation's wall", async () => {
    const asset = await uploaded(a.ownerCookie, 30);
    const insert = async (kind: string, extra = "") => {
      await app.query("begin");
      try {
        await app.query("select set_config('app.org_id', $1, true)", [a.orgId]);
        const columns = extra ? ", processed_at, outcome" : "";
        const values = extra ? ", now(), 'applied'" : "";
        await app.query(
          `insert into app.engine_event (org_id, job_id, kind, asset_id, payload${columns})
           values ($1, $2, $3, $4, '{}'${values})`,
          [a.orgId, randomUUID(), kind, asset.id],
        );
        return "added";
      } catch (error) {
        return String(error);
      } finally {
        await app.query("rollback");
      }
    };
    expect(await insert("job.failed")).toBe("added");
    expect(await insert("media.ready")).toMatch(/row-level security/);
    expect(await insert("media.rejected")).toMatch(/row-level security/);
    expect(await insert("job.failed", "processed")).toMatch(/row-level security/);
  });

  it("is read by pgn_app only under its organisation's wall, or as the consumer", async () => {
    const asset = await uploaded(a.ownerCookie, 4);
    const jobId = await report(failed(a, asset.id));
    const count = async (setup: string, values: unknown[]) => {
      await app.query("begin");
      try {
        await app.query(setup, values);
        return (await app.query("select count(*)::int as n from app.engine_event where job_id = $1", [jobId])).rows[0]
          .n;
      } finally {
        await app.query("rollback");
      }
    };
    expect(await count("select 1", [])).toBe(0);
    expect(await count("select set_config('app.org_id', $1, true)", [b.orgId])).toBe(0);
    expect(await count("select set_config('app.org_id', $1, true)", [a.orgId])).toBe(1);
    expect(await count("select set_config('app.system', $1, true)", ["engine-consumer"])).toBe(1);
    expect(await count("select set_config('app.system', $1, true)", ["engine-sweep"])).toBe(0);
  });
});

describe("the queue, to pgn_app", () => {
  it("shows no job but to the sweep's flag, which removes only a spent job no live worker may hold", async () => {
    const one = await uploaded(a.ownerCookie, 31);
    const two = await uploaded(a.ownerCookie, 32);
    const [held] = await jobsFor(one.id);
    const [free] = await jobsFor(two.id);
    await su.query(
      "update queue._private_jobs set attempts = max_attempts, locked_at = now() - interval '10 minutes' where id = $1",
      [held?.id],
    );
    await su.query("update queue._private_jobs set attempts = max_attempts where id = $1", [free?.id]);
    const as = async (setup: string, values: unknown[], sql: string) => {
      await app.query("begin");
      try {
        await app.query(setup, values);
        return (await app.query(sql)).rowCount;
      } finally {
        await app.query("rollback");
      }
    };
    const jobs = "select 1 from queue._private_jobs";
    const tasks = "select 1 from queue._private_tasks";
    expect(await as("select 1", [], jobs)).toBe(0);
    expect(await as("select 1", [], tasks)).toBe(0);
    expect(await as("select set_config('app.org_id', $1, true)", [a.orgId], jobs)).toBe(0);
    expect(await as("select set_config('app.system', $1, true)", ["engine-consumer"], jobs)).toBe(0);
    const sweepFlag = "select set_config('app.system', $1, true)";
    expect(await as(sweepFlag, ["engine-sweep"], jobs)).toBeGreaterThanOrEqual(2);
    expect(await as(sweepFlag, ["engine-sweep"], tasks)).toBeGreaterThanOrEqual(1);
    // without the flag nothing is removed; with it, the unlocked spent job, never one locked ten minutes ago
    expect(await as("select 1", [], `delete from queue._private_jobs where id = ${free?.id}`)).toBe(0);
    expect(await as(sweepFlag, ["engine-sweep"], `delete from queue._private_jobs where id = ${held?.id}`)).toBe(0);
    expect(await as(sweepFlag, ["engine-sweep"], `delete from queue._private_jobs where id = ${free?.id}`)).toBe(1);
    await su.query("delete from queue._private_jobs where id = any ($1::bigint[])", [[held?.id, free?.id]]);
    await su.query("update app.asset set status = 'failed', problem = 'worker.lost' where id = any ($1)", [
      [one.id, two.id],
    ]);
  });
});

describe("the consumer", () => {
  it("records a ready picture's renditions, audits it as the system, and tells the story it is the photo of", async () => {
    const asset = await uploaded(reporter.cookie, 5);
    const made = await change("POST", `${base()}/stories`, reporter.cookie, {
      headline: "With a photo",
      body: "Short.",
    });
    const story = made.json();
    const set = await call("PUT", `${base()}/stories/${story.id}/photo`, reporter.cookie, {
      baseRevision: story.revision,
      assetId: asset.id,
    });
    expect(set.statusCode, set.body).toBe(200);
    const hints: string[] = [];
    const listener = await db.connect("postgres");
    listener.on("notification", (m) => hints.push(m.payload ?? ""));
    await listener.query("listen app_events");

    const jobId = await report(ready(a, asset));
    await drainInbox(it_.database, log);
    expect(await outcomeOf(jobId)).toBe("applied");
    expect(await assetRow(asset.id)).toEqual({ status: "ready", problem: null });
    const { rows } = await su.query(
      "select purpose, key, params_hash from app.rendition where asset_id = $1 order by purpose",
      [asset.id],
    );
    expect(rows.map((r) => r.purpose)).toEqual(["cmyk", "preview", "thumb"]);
    expect(await audits("asset.ready", asset.id)).toEqual([
      { actor_kind: "system", actor_id: null, publication_id: a.pubId, data: { job: jobId, paramsHash: PARAMS } },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    const hinted = hints.map((h) => JSON.parse(h)).filter((h) => h.type === "story" && h.story === story.id);
    expect(hinted).toEqual([
      expect.objectContaining({ v: 1, org: a.orgId, pub: a.pubId, people: expect.arrayContaining([reporter.id]) }),
    ]);
    // the story's photo says so, and its preview is the rendition's
    const read = await call("GET", `${base()}/stories/${story.id}`, reporter.cookie);
    expect(read.json().photo).toMatchObject({ status: "ready", problem: null });
    const preview = await call("GET", `${base()}/assets/${asset.id}/file?variant=preview`, reporter.cookie);
    expect(preview.statusCode).toBe(302);
    expect(preview.headers.location).toContain(`assets/${asset.id}/r/preview-${PARAMS}.jpg`);
    expect(preview.headers.location).toContain("versionId=v-preview");

    // applied once: the same event again (another job id) finds it settled
    const later = await report(rejected(a, asset));
    await drainInbox(it_.database, log);
    expect(await outcomeOf(later)).toBe("ignored");
    expect(await assetRow(asset.id)).toEqual({ status: "ready", problem: null });
    await listener.end();
  });

  it("marks a picture the Desk refuses rejected with its code, and a failed job failed with the engine's", async () => {
    const one = await uploaded(a.ownerCookie, 6);
    const two = await uploaded(a.ownerCookie, 7);
    const r = await report(rejected(a, one));
    const f = await report(failed(a, two.id, "worker.internal"));
    await drainInbox(it_.database, log);
    expect([await outcomeOf(r), await outcomeOf(f)]).toEqual(["applied", "applied"]);
    expect(await assetRow(one.id)).toEqual({ status: "rejected", problem: "m.img.damaged" });
    expect(await assetRow(two.id)).toEqual({ status: "failed", problem: "worker.internal" });
    expect((await audits("asset.reject", one.id))[0]?.data).toEqual({ job: r, code: "m.img.damaged", status: 400 });
    expect((await audits("asset.fail", two.id))[0]?.data).toEqual({ job: f, code: "worker.internal" });
    // a failed picture no longer holds its bytes: sent again, it is a new asset with a new job
    const again = await uploaded(a.ownerCookie, 7);
    expect(again.id).not.toBe(two.id);
    expect(await jobsFor(again.id)).toHaveLength(1);
    // like a rejected one, a failed picture is neither downloaded nor attached
    for (const gone of [one.id, two.id]) {
      expect((await call("GET", `${base()}/assets/${gone}/file`, a.ownerCookie)).statusCode).toBe(404);
      const made = (await change("POST", `${base()}/stories`, a.ownerCookie, { headline: "Gone", body: "x" })).json();
      const set = await call("PUT", `${base()}/stories/${made.id}/photo`, a.ownerCookie, {
        baseRevision: made.revision,
        assetId: gone,
      });
      expect(set.statusCode, set.body).toBe(400);
    }
  });

  it("ignores an event for a deleted photo, without refusing it", async () => {
    const asset = await uploaded(a.ownerCookie, 33);
    await su.query("update app.asset set deleted_at = now() where id = $1", [asset.id]);
    const jobId = await report(ready(a, asset));
    logged.length = 0;
    await drainInbox(it_.database, log);
    expect(await outcomeOf(jobId)).toBe("ignored");
    expect(logged.filter((l) => l.level === "error")).toEqual([]);
    const { rows } = await su.query("select 1 from app.audit_event where data->>'job' = $1", [jobId]);
    expect(rows).toEqual([]);
  });

  it("tries an event that fails to apply again later, never refusing it for that, and applies it once it can", async () => {
    const asset = await uploaded(a.ownerCookie, 34);
    // a few seconds of errors inserting renditions (counted by a sequence: its count survives each rollback)
    await su.query(`create sequence public.fail_count;
      create function public.fail_three() returns trigger language plpgsql security definer as $$
      begin
        if nextval('public.fail_count') <= 3 then raise exception 'injected: the rendition insert failed'; end if;
        return new;
      end $$;
      create trigger fail_three before insert on app.rendition for each row execute function public.fail_three();`);
    const inbox = startEngineInbox(
      it_.database,
      log,
      undefined,
      { staleMs: STALE_MS, deadlineMs: DEADLINE_MS },
      {
        pollMs: 100,
        sweepMs: 3_600_000,
      },
    );
    try {
      const jobId = await report(ready(a, asset));
      // time passes: each backoff is over as soon as it is set
      const deadline = Date.now() + 15_000;
      while ((await outcomeOf(jobId)) == null && Date.now() < deadline) {
        await su.query("update app.engine_event set retry_at = null where job_id = $1 and processed_at is null", [
          jobId,
        ]);
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await outcomeOf(jobId)).toBe("applied");
      expect(await assetRow(asset.id)).toEqual({ status: "ready", problem: null });
      const { rows } = await su.query("select tries from app.engine_event where job_id = $1", [jobId]);
      expect(rows).toEqual([{ tries: 3 }]);
      expect(await audits("asset.ready", asset.id)).toHaveLength(1);
    } finally {
      await inbox.close();
      await su.query(
        "drop trigger fail_three on app.rendition; drop function public.fail_three(); drop sequence public.fail_count",
      );
    }
  });

  it("waits between tries, and refuses (audited, reason error) only after MAX_TRIES", async () => {
    const asset = await uploaded(a.ownerCookie, 35);
    await su.query(`create function public.fail_always() returns trigger language plpgsql as $$
      begin raise exception 'injected: the rendition insert failed'; end $$;
      create trigger fail_always before insert on app.rendition for each row execute function public.fail_always();`);
    try {
      const jobId = await report(ready(a, asset));
      await drainInbox(it_.database, log);
      const row = async () =>
        (
          await su.query("select tries, retry_at > now() as waiting, outcome from app.engine_event where job_id = $1", [
            jobId,
          ])
        ).rows[0];
      expect(await row()).toEqual({ tries: 1, waiting: true, outcome: null });
      await drainInbox(it_.database, log); // not due yet: untouched
      expect(await row()).toEqual({ tries: 1, waiting: true, outcome: null });
      await su.query("update app.engine_event set tries = $2, retry_at = null where job_id = $1", [
        jobId,
        MAX_TRIES - 1,
      ]);
      await drainInbox(it_.database, log);
      expect(await row()).toMatchObject({ tries: MAX_TRIES, outcome: "refused" });
      const { rows } = await su.query(
        "select data->>'reason' as reason from app.audit_event where action = 'engine.event_refuse' and data->>'job' = $1",
        [jobId],
      );
      expect(rows).toEqual([{ reason: "error" }]);
      expect(await assetRow(asset.id)).toEqual({ status: "received", problem: null });
    } finally {
      await su.query("drop trigger fail_always on app.rendition; drop function public.fail_always()");
      await su.query("delete from queue._private_jobs where key = $1", [`asset:${asset.id}`]);
      await su.query("update app.asset set status = 'failed', problem = 'worker.lost' where id = $1", [asset.id]);
    }
  });

  it("ignores an event for other bytes, and refuses one for an asset that is not the organisation's or publication's", async () => {
    const asset = await uploaded(a.ownerCookie, 8);
    const second = await n.addPublication(a, "Kalpaniknagar Express (fictional)");
    const stale = await report({ ...ready(a, asset), sha256: "f".repeat(64) });
    // organisation B names A's asset: under B's wall it is not there
    const foreign = await report({ ...failed(a, asset.id), org_id: b.orgId, pub_id: b.pubId });
    // the right organisation, another of its publications
    const otherPub = await report({ ...failed(a, asset.id), pub_id: second });
    const notContract = await report({ ...failed(a, asset.id), code: "not a code" });
    const badKey = await report(
      ready(a, asset, (purpose, ext) => `orgs/${a.orgId}/pubs/${a.pubId}/assets/other/r/${purpose}-${PARAMS}.${ext}`),
    );
    // a row whose asset is not the one its payload names
    const mismatch = randomUUID();
    await engine.query(
      `insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, 'job.failed', $3, $4)`,
      [a.orgId, mismatch, randomUUID(), JSON.stringify(failed(a, asset.id))],
    );
    logged.length = 0;
    await drainInbox(it_.database, log);
    expect(await outcomeOf(stale)).toBe("ignored");
    // late or forged: recorded, though never applied
    const ignoredAudit = await su.query(
      "select data->>'reason' as reason from app.audit_event where action = 'engine.event_ignore' and data->>'job' = $1",
      [stale],
    );
    expect(ignoredAudit.rows).toEqual([{ reason: "other_bytes" }]);
    const refused = {
      [foreign]: "not_found",
      [otherPub]: "not_found",
      [notContract]: "contract",
      [badKey]: "rendition_key",
      [mismatch]: "mismatch",
    };
    for (const job of Object.keys(refused)) expect(await outcomeOf(job), job).toBe("refused");
    expect(await assetRow(asset.id)).toEqual({ status: "received", problem: null });
    const { rows } = await su.query<{ org_id: string; job: string; reason: string }>(
      `select org_id, data->>'job' as job, data->>'reason' as reason from app.audit_event
       where action = 'engine.event_refuse' and data->>'job' = any ($1)`,
      [Object.keys(refused)],
    );
    expect(Object.fromEntries(rows.map((r) => [r.job, r.reason]))).toEqual(refused);
    expect(rows.find((r) => r.job === foreign)?.org_id).toBe(b.orgId); // recorded where the event said it came from
    expect(logged.filter((l) => l.level === "error")).toHaveLength(5);
    expect(await su.query("select 1 from app.rendition where asset_id = $1", [asset.id])).toMatchObject({
      rowCount: 0,
    });
  });
});

describe("the sweep", () => {
  it("settles a spent job as lost and removes it, unless it had reported; and an asset left with no job", async () => {
    const spent = await uploaded(a.ownerCookie, 9);
    const reported = await uploaded(a.ownerCookie, 10);
    const stranded = await uploaded(a.ownerCookie, 11);
    const running = await uploaded(a.ownerCookie, 12);
    const backingOff = await uploaded(a.ownerCookie, 13);
    const [spentJob] = await jobsFor(spent.id);
    const [reportedJob] = await jobsFor(reported.id);
    const [runningJob] = await jobsFor(running.id);
    await su.query("update queue._private_jobs set attempts = max_attempts where id = any ($1::bigint[])", [
      [spentJob?.id, reportedJob?.id],
    ]);
    // a job on its last attempt, held by a live worker: not the sweep's
    await su.query(
      "update queue._private_jobs set attempts = max_attempts, locked_at = now(), locked_by = 'alive' where id = $1",
      [runningJob?.id],
    );
    await report(rejected(a, reported), reportedJob?.id ?? "");
    await su.query("delete from queue._private_jobs where key = $1", [`asset:${stranded.id}`]);
    await su.query("update app.asset set updated_at = now() - interval '1 hour' where id = any ($1)", [
      [stranded.id, backingOff.id],
    ]);
    // a job waiting out its backoff, on an asset past the deadline: it will run again, so it is not lost
    await su.query(
      "update queue._private_jobs set attempts = 3, run_at = now() + interval '1 hour', last_error = 'x' where key = $1",
      [`asset:${backingOff.id}`],
    );

    // two API instances at once: the second's writes are no-ops
    const settled = await Promise.all([sweep(it_.database, log), sweep(it_.database, log)]);
    // only what was written: the spent job and the stranded asset (the reported job's write was dropped)
    expect(settled[0] + settled[1]).toBe(2);
    expect(await jobsFor(spent.id)).toEqual([]);
    expect(await jobsFor(reported.id)).toEqual([]);
    expect(await jobsFor(running.id)).toHaveLength(1);
    const { rows } = await su.query(
      "select job_id, payload->>'code' as code from app.engine_event where asset_id = any ($1) order by job_id",
      [[spent.id, reported.id, stranded.id]],
    );
    expect(rows).toEqual(
      [
        { job_id: spentJob?.id, code: "worker.lost" },
        { job_id: reportedJob?.id, code: "m.img.damaged" },
        { job_id: `lost:${stranded.id}`, code: "worker.lost" },
      ].sort((x, y) => (String(x.job_id) < String(y.job_id) ? -1 : 1)),
    );
    await drainInbox(it_.database, log);
    expect(await assetRow(spent.id)).toEqual({ status: "failed", problem: "worker.lost" });
    expect(await assetRow(reported.id)).toEqual({ status: "rejected", problem: "m.img.damaged" });
    expect(await assetRow(stranded.id)).toEqual({ status: "failed", problem: "worker.lost" });
    expect(await assetRow(running.id)).toEqual({ status: "received", problem: null });
    expect(await assetRow(backingOff.id)).toEqual({ status: "received", problem: null });
    expect(await jobsFor(backingOff.id)).toHaveLength(1);
    // a pass with nothing left to do writes nothing
    expect(await sweep(it_.database, log)).toBe(0);
  });

  it("waits longer than the runner's time limit and the deadline before calling anything lost", () => {
    expect(STALE_MS).toBeGreaterThan(3600_000 + 5_000);
    expect(DEADLINE_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });
});
