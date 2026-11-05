// Onboarding a new paper on the API's side (packages/contracts/src/onboard.ts; migration 2026_12_07_0001), on a migrated
// clone and the run's bucket: past editions sent (each PDF read, copied and pinned, inputs.json written, engine.onboard
// enqueued, the uploads completed), its limits and refusals, one active a publication, cancel, the inbox applying the
// worker's events (progress, ready, rejected, a failed job; another inputs file's ignored), the sweep's lost and stalled
// onboardings, a ready one used for a new engine profile (engine.setup's payload unchanged), the test edition of
// fictional stories, the walls and the audit. The worker is not run here: its events are written as the queue writes
// them. Every file is fictional, made here.
import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { OnboardInputs } from "@pageinator/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainInbox, sweep } from "../../src/modules/media/engine-inbox.ts";
import { s3Client, s3Store } from "../../src/storage/s3.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
let engine: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let b: Org;
let chief: Person;
let editor: Person;
let designer: Person;
let reporter: Person;
const quiet = { error: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;
const store = () => s3Store(it_.config.storage!);
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const base = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}`;
const drain = () => drainInbox(it_.database, quiet, store());

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  engine = await db.connect("engine");
  a = await n.organisation();
  b = await n.organisation();
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  editor = await n.member(a, as("editor"), "member", "editor");
  designer = await n.member(a, as("page_designer"), "member", "designer");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

// ------------------------------------------------------------------------------------------------ fictional data

const pdf = (i: number) => `%PDF-1.4 fictional edition ${i} of Kalpaniknagar Varta`;

async function pdfUpload(cookie: string, body: string, org = a, name = "Edition 2026-01-05.pdf"): Promise<string> {
  const presigned = await change("POST", `${base(org)}/uploads`, cookie, {
    purpose: "onboard_pdf",
    filename: name,
    contentType: "application/pdf",
    bytes: Buffer.byteLength(body),
  });
  expect(presigned.statusCode, presigned.body).toBe(201);
  const policy = presigned.json();
  const form = new FormData();
  for (const [key, value] of Object.entries(policy.fields as Record<string, string>)) form.append(key, value);
  form.append("file", new Blob([body]));
  expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
  return policy.uploadId as string;
}
const three = (cookie = a.ownerCookie, org = a) =>
  Promise.all([1, 2, 3].map((i) => pdfUpload(cookie, pdf(i), org, `Edition 2026-01-0${i}.pdf`)));

/** What the queue's report writes (apps/engine-queue/src/inbox.ts), as pgn_engine; the event's outcome once drained. */
async function report(event: Record<string, unknown>, target: string) {
  const jobId = randomUUID();
  await engine.query(
    `insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, $3, $4, $5)`,
    [event["org_id"], jobId, event["kind"], target, JSON.stringify(event)],
  );
  await drain();
  return (await su.query("select outcome from app.engine_event where job_id = $1", [jobId])).rows[0]?.outcome;
}
const job = async (key: string) =>
  (
    await su.query(
      `select j.payload, j.max_attempts, t.identifier as task, q.queue_name from queue._private_jobs j
       join queue._private_tasks t on t.id = j.task_id left join queue._private_job_queues q on q.id = j.job_queue_id
       where j.key = $1`,
      [key],
    )
  ).rows[0];
const row = async (id: string) => (await su.query("select * from app.paper_onboarding where id = $1", [id])).rows[0];
const audits = async (action: string, target: string) =>
  (
    await su.query("select actor_kind, data from app.audit_event where action = $1 and target_id = $2", [
      action,
      target,
    ])
  ).rows;

const CHECK = (n: number) => ({ n, status: "ok", date: `2026-01-0${n}`, pages: 4, notes: [] });
const REPORT = {
  editions: 3,
  pages: 12,
  calibration_editions: 2,
  page_w_mm: 330,
  page_h_mm: 520,
  grid: { columns: 8, column_width_mm: 32, gutter_mm: 4 },
  grids_seen: 1,
  script: "deva",
  excluded_share: 0,
  roles: { front: 3, inside_imprint: 3, inside: 3, back: 3 },
};
const start = async (cookie = a.ownerCookie) => {
  const res = await change("POST", `${base()}/onboarding`, cookie, {
    uploadIds: await three(cookie),
    permission: true,
  });
  expect(res.statusCode, res.body).toBe(202);
  return res.json() as { id: string; state: string };
};
const sent = (id: string, inputs: string, kind: string, more: Record<string, unknown>) => ({
  kind,
  org_id: a.orgId,
  pub_id: a.pubId,
  onboarding_id: id,
  sha256: inputs,
  ...more,
});
/** The worker's bundle stored at the onboarding's own key, and onboard.ready for it. */
async function makeReady(id: string) {
  const r = await row(id);
  const bundle = `PK fictional bundle of ${id}`;
  const put = await s3Client(it_.config.storage!).send(
    new PutObjectCommand({ Bucket: it_.config.storage!.workBucket, Key: r.dataset_key, Body: bundle }),
  );
  const dataset = { key: r.dataset_key, version_id: put.VersionId, sha256: sha(bundle), bytes: bundle.length };
  const out = await report(
    sent(id, r.inputs_sha256, "onboard.ready", { files: [1, 2, 3].map(CHECK), report: REPORT, dataset }),
    id,
  );
  return { out, bundle };
}

// ------------------------------------------------------------------------------------------------ starting

describe("an onboarding", () => {
  let first: string;

  it("is started from the person's own past editions: each copied and pinned, inputs.json written, the job enqueued", async () => {
    const uploads = await three();
    const key = randomUUID();
    const res = await change(
      "POST",
      `${base()}/onboarding`,
      a.ownerCookie,
      { uploadIds: uploads, permission: true },
      key,
    );
    expect(res.statusCode, res.body).toBe(202);
    const made = res.json();
    first = made.id;
    expect(made).toMatchObject({ state: "queued", progress: null, report: null, problem: null, profileId: null });
    expect(made.files).toEqual(
      [1, 2, 3].map((i) => ({ n: i, name: `Edition 2026-01-0${i}.pdf`, bytes: pdf(i).length, check: null })),
    );
    const queued = await job(`onboard:${made.id}`);
    expect(queued).toMatchObject({ task: "engine.onboard", max_attempts: 1, queue_name: "engine-cpu" });
    expect(Object.keys(queued.payload).sort()).toEqual(["onboarding_id", "org_id", "pub_id", "sha256", "version_id"]);
    const r = await row(made.id);
    expect(r.inputs_key).toBe(`orgs/${a.orgId}/pubs/${a.pubId}/onboarding/${made.id}/inputs.json`);
    const read = async (k: string, v: string) => {
      const chunks: Uint8Array[] = [];
      for await (const c of await store().read(k, v)) chunks.push(c);
      return Buffer.concat(chunks);
    };
    const inputsBytes = await read(r.inputs_key, queued.payload.version_id);
    expect(sha(inputsBytes)).toBe(queued.payload.sha256);
    expect(r.inputs_sha256).toBe(queued.payload.sha256);
    const inputs = OnboardInputs.parse(JSON.parse(inputsBytes.toString("utf8")));
    for (const f of inputs.files) {
      const key2 = `orgs/${a.orgId}/pubs/${a.pubId}/onboarding/${made.id}/pdfs/0${f.n}.pdf`;
      expect(sha(await read(key2, f.version_id))).toBe(sha(pdf(f.n)));
      expect(f.sha256).toBe(sha(pdf(f.n)));
    }
    const ups = await su.query("select status, onboarding_id from app.upload where id = any ($1::uuid[])", [uploads]);
    expect(ups.rows.every((u) => u.status === "completed" && u.onboarding_id === made.id)).toBe(true);
    expect(await audits("onboarding.start", made.id)).toMatchObject([
      { actor_kind: "user", data: { files: 3, bytes: pdf(1).length * 3 } },
    ]);
    // a replay answers the same
    const again = await change(
      "POST",
      `${base()}/onboarding`,
      a.ownerCookie,
      { uploadIds: uploads, permission: true },
      key,
    );
    expect([again.statusCode, again.json().id]).toEqual([202, made.id]);
    const view = (await call("GET", `${base()}/onboarding`, editor.cookie)).json();
    expect(view.current).toMatchObject({ id: made.id, state: "queued" });
  });

  it("is one at a time a publication, and cancelled at once; a finished one is not cancelled again", async () => {
    const busy = await change("POST", `${base()}/onboarding`, a.ownerCookie, {
      uploadIds: await three(),
      permission: true,
    });
    expect([busy.statusCode, busy.json().error.code, busy.json().error.current.id]).toEqual([
      409,
      "onboarding_active",
      first,
    ]);
    expect((await change("POST", `${base()}/onboarding/${first}/cancel`, editor.cookie, {})).statusCode).toBe(403);
    // another organisation cannot name it
    expect((await change("POST", `${base(b)}/onboarding/${first}/cancel`, b.ownerCookie, {})).statusCode).toBe(404);
    const cancelled = await change("POST", `${base()}/onboarding/${first}/cancel`, chief.cookie, {});
    expect([cancelled.statusCode, cancelled.json().state]).toEqual([200, "cancelled"]);
    expect(await job(`onboard:${first}`)).toBeUndefined();
    expect(await audits("onboarding.cancel", first)).toMatchObject([{ data: { from: "queued" } }]);
    const again = await change("POST", `${base()}/onboarding/${first}/cancel`, chief.cookie, {});
    expect([again.statusCode, again.json().error.code]).toEqual([409, "onboarding_finished"]);
    // and a late event changes nothing
    const r = await row(first);
    expect(
      await report(sent(first, r.inputs_sha256, "onboard.progress", { step: "reading", done: 1, total: 3 }), first),
    ).toBe("ignored");
  });

  it("refuses another's upload, a file not a PDF, too few files, one named twice, no permission, and the wrong roles", async () => {
    const mine = await three();
    const theirs = await pdfUpload(chief.cookie, pdf(9));
    const post = (cookie: string, body: unknown, org = a) => change("POST", `${base(org)}/onboarding`, cookie, body);
    expect((await post(a.ownerCookie, { uploadIds: [...mine.slice(0, 2), theirs], permission: true })).statusCode).toBe(
      404,
    );
    const notPdf = await pdfUpload(a.ownerCookie, "not a PDF at all (fictional)");
    const refused = await post(a.ownerCookie, { uploadIds: [...mine.slice(0, 2), notPdf], permission: true });
    expect([refused.statusCode, refused.json().error.details[0].field]).toEqual([400, "body.uploadIds.2"]);
    expect((await post(a.ownerCookie, { uploadIds: mine.slice(0, 2), permission: true })).statusCode).toBe(400);
    expect((await post(a.ownerCookie, { uploadIds: [mine[0], mine[0], mine[1]], permission: true })).statusCode).toBe(
      400,
    );
    expect((await post(a.ownerCookie, { uploadIds: mine, permission: false })).statusCode).toBe(400);
    expect((await post(editor.cookie, { uploadIds: mine, permission: true })).statusCode).toBe(403);
    expect((await post(b.ownerCookie, { uploadIds: mine, permission: true }, b)).statusCode).toBe(404);
    // the upload itself: settings.edit, at most 200 MB, never completed as a picture
    const presign = (cookie: string, bytes: number) =>
      change("POST", `${base()}/uploads`, cookie, {
        purpose: "onboard_pdf",
        filename: "Edition.pdf",
        contentType: "application/pdf",
        bytes,
      });
    expect((await presign(editor.cookie, 100)).statusCode).toBe(403);
    expect((await presign(chief.cookie, 200 * 1024 ** 2 + 1)).statusCode).toBe(413);
    expect((await call("POST", `${base()}/uploads/${mine[0]}/complete`, a.ownerCookie)).statusCode).toBe(422);
    expect((await call("GET", `${base()}/onboarding`, reporter.cookie)).statusCode).toBe(403);
    // the refusals are audited
    const denied = await su.query(
      "select count(*)::int as n from app.audit_event where action = 'access.denied' and publication_id = $1",
      [a.pubId],
    );
    expect(denied.rows[0].n).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------ the inbox

describe("the engine's events", () => {
  it("move it on: progress (not for another inputs file), then ready; a forged bundle key refused", async () => {
    const { id } = await start();
    const r = await row(id);
    const progress = (sha256: string) =>
      report(sent(id, sha256, "onboard.progress", { step: "measuring", done: 2, total: 3 }), id);
    expect(await progress("0".repeat(64))).toBe("ignored");
    expect((await row(id)).state).toBe("queued");
    expect(await progress(r.inputs_sha256)).toBe("applied");
    const working = (await call("GET", `${base()}/onboarding`, a.ownerCookie)).json().current;
    expect(working).toMatchObject({ state: "working", progress: { step: "measuring", done: 2, total: 3 } });
    expect((await row(id)).heartbeat_at).not.toBeNull();
    const forged = await report(
      sent(id, r.inputs_sha256, "onboard.ready", {
        files: [],
        report: REPORT,
        dataset: {
          key: `orgs/${a.orgId}/pubs/${a.pubId}/onboarding/${randomUUID()}/dataset.zip`,
          version_id: "v",
          sha256: "a".repeat(64),
          bytes: 1,
        },
      }),
      id,
    );
    expect(forged).toBe("refused");
    expect((await makeReady(id)).out).toBe("applied");
    const ready = (await call("GET", `${base()}/onboarding`, a.ownerCookie)).json().current;
    expect(ready).toMatchObject({ state: "ready", progress: null, report: { editions: 3, grid: { columns: 8 } } });
    expect(ready.files[0].check).toEqual(CHECK(1));
    expect(await audits("onboarding.ready", id)).toMatchObject([{ actor_kind: "system", data: { editions: 3 } }]);
  });

  it("is rejected with the set's reason, or failed when its job failed", async () => {
    await su.query("update app.paper_onboarding set state = 'cancelled' where state in ('queued', 'working')");
    const rejected = await start();
    const r = await row(rejected.id);
    expect(
      await report(
        sent(rejected.id, r.inputs_sha256, "onboard.rejected", {
          code: "onboard.no_template",
          params: { role: "back" },
          files: [1, 2, 3].map(CHECK),
          message: "No page was found for the back page.",
        }),
        rejected.id,
      ),
    ).toBe("applied");
    const view = (await call("GET", `${base()}/onboarding`, a.ownerCookie)).json();
    expect(view.current).toMatchObject({
      state: "rejected",
      problem: {
        code: "onboard.no_template",
        params: { role: "back" },
        message: "No page was found for the back page.",
      },
    });
    const failed = await start();
    const out = await report(
      {
        kind: "job.failed",
        org_id: a.orgId,
        pub_id: a.pubId,
        job_kind: "engine.onboard",
        target_id: failed.id,
        code: "worker.crashed",
        message: "the onboarding tool stopped",
      },
      failed.id,
    );
    expect(out).toBe("applied");
    expect(await row(failed.id)).toMatchObject({ state: "failed", problem: "worker.crashed" });
    expect(await audits("onboarding.fail", failed.id)).toMatchObject([
      { actor_kind: "system", data: { code: "worker.crashed" } },
    ]);
    // another organisation's event for it is refused
    const other = await start();
    const o = await row(other.id);
    expect(
      await report(
        {
          ...sent(other.id, o.inputs_sha256, "onboard.progress", { step: "reading", done: 0, total: 3 }),
          org_id: b.orgId,
          pub_id: b.pubId,
        },
        other.id,
      ),
    ).toBe("refused");
    await change("POST", `${base()}/onboarding/${other.id}/cancel`, a.ownerCookie, {});
  });

  it("is failed by the sweep when its job is gone (lost) or its worker stopped reporting (stalled)", async () => {
    const lost = await start();
    await su.query("delete from queue._private_jobs where key = $1", [`onboard:${lost.id}`]);
    await su.query("update app.paper_onboarding set created_at = now() - interval '2 hours' where id = $1", [lost.id]);
    await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 });
    await drain();
    expect(await row(lost.id)).toMatchObject({ state: "failed", problem: "worker.lost" });
    const stalled = await start();
    await su.query(
      "update app.paper_onboarding set state = 'working', heartbeat_at = now() - interval '11 minutes' where id = $1",
      [stalled.id],
    );
    await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60 * 60_000 });
    await drain();
    expect(await row(stalled.id)).toMatchObject({ state: "failed", problem: "worker.stalled" });
    await su.query("delete from queue._private_jobs where key = $1", [`onboard:${stalled.id}`]);
  });
});

// ------------------------------------------------------------------------------------------------ using it

describe("a ready onboarding", () => {
  let profileId: string;

  it("is used for a new engine profile: its bundle copied, engine.setup enqueued as from an upload", async () => {
    const { id } = await start();
    const { bundle } = await makeReady(id);
    expect((await change("POST", `${base()}/onboarding/${id}/use`, editor.cookie, {})).statusCode).toBe(403);
    const res = await change("POST", `${base()}/onboarding/${id}/use`, chief.cookie, {});
    expect(res.statusCode, res.body).toBe(202);
    const profile = res.json();
    profileId = profile.id;
    expect(profile).toMatchObject({ state: "setting_up", datasetSha256: sha(bundle), datasetBytes: bundle.length });
    const queued = await job(`profile:${profile.id}`);
    expect(queued).toMatchObject({ task: "engine.setup", max_attempts: 2, queue_name: "engine-cpu" });
    expect(Object.keys(queued.payload).sort()).toEqual(["org_id", "profile_id", "pub_id", "sha256", "version_id"]);
    const p = (
      await su.query(
        "select dataset_key, dataset_version_id, onboarding_id, upload_id from app.engine_profile where id = $1",
        [profile.id],
      )
    ).rows[0];
    expect(p).toMatchObject({ onboarding_id: id, upload_id: null });
    expect(p.dataset_key).toBe(`orgs/${a.orgId}/pubs/${a.pubId}/profiles/${profile.id}/dataset.zip`);
    const chunks: Uint8Array[] = [];
    for await (const c of await store().read(p.dataset_key, p.dataset_version_id)) chunks.push(c);
    expect(sha(Buffer.concat(chunks))).toBe(sha(bundle));
    expect(await row(id)).toMatchObject({ state: "used", profile_id: profile.id });
    expect(await audits("onboarding.use", id)).toMatchObject([{ data: { profile: profile.id, version: 1 } }]);
    const twice = await change("POST", `${base()}/onboarding/${id}/use`, chief.cookie, {});
    expect([twice.statusCode, twice.json().error.code]).toEqual([409, "onboarding_not_ready"]);
    // one profile setting up at a time
    const next = await start();
    await makeReady(next.id);
    const busy = await change("POST", `${base()}/onboarding/${next.id}/use`, chief.cookie, {});
    expect([busy.statusCode, busy.json().error.code]).toEqual([409, "profile_setting_up"]);
  });

  it("then gives a test edition of fictional stories, Ready, in the publication's language", async () => {
    const none = await change("POST", `${base()}/onboarding/test-edition`, designer.cookie, {});
    expect([none.statusCode, none.json().error.code]).toEqual([409, "no_profile"]);
    await su.query(
      `update app.engine_profile set state = 'ready', config_version_id = 'v', config_sha256 = $2,
         engine_version = 'fictional-engine 1', templates = '{}', grid = '{}', plans = '[]' where id = $1`,
      [profileId, "f".repeat(64)],
    );
    expect((await change("POST", `${base()}/onboarding/test-edition`, reporter.cookie, {})).statusCode).toBe(403);
    const key = randomUUID();
    const res = await change("POST", `${base()}/onboarding/test-edition`, designer.cookie, {}, key);
    expect(res.statusCode, res.body).toBe(201);
    const made = res.json();
    expect(made.stories).toBeGreaterThanOrEqual(12);
    const again = await change("POST", `${base()}/onboarding/test-edition`, designer.cookie, {}, key);
    expect(again.json()).toEqual(made);
    const edition = (
      await su.query(
        "select to_char(edition_date, 'YYYY-MM-DD') as date, pages, back_page_ads from app.edition where id = $1",
        [made.editionId],
      )
    ).rows[0];
    expect(edition).toEqual({ date: "2099-12-31", pages: 4, back_page_ads: false });
    const stories = await su.query(
      `select s.status, s.language, r.headline from app.story s join app.story_revision r
         on r.story_id = s.id and r.rev = s.current_rev where s.edition_id = $1`,
      [made.editionId],
    );
    expect(stories.rows).toHaveLength(made.stories);
    expect(stories.rows.every((s) => s.status === "ready" && s.language === "mr")).toBe(true);
    expect(stories.rows.some((s) => /नीलगाव/.test(s.headline))).toBe(true);
    expect(await audits("onboarding.test_edition", made.editionId)).toMatchObject([
      { data: { stories: made.stories, language: "mr", date: "2099-12-31" } },
    ]);
    // an English paper's are English, on the next free date
    await su.query("update app.publication set primary_language = 'en' where id = $1", [a.pubId]);
    const en = (await change("POST", `${base()}/onboarding/test-edition`, designer.cookie, {})).json();
    const first = (
      await su.query(
        `select r.headline, to_char(e.edition_date, 'YYYY-MM-DD') as date from app.story s
         join app.story_revision r on r.story_id = s.id and r.rev = s.current_rev
         join app.edition e on e.id = s.edition_id where s.edition_id = $1 limit 1`,
        [en.editionId],
      )
    ).rows[0];
    expect(first.date).toBe("2099-12-30");
    expect(first.headline).toMatch(/[A-Za-z]/);
    await su.query("update app.publication set primary_language = 'mr' where id = $1", [a.pubId]);
  });
});

// ------------------------------------------------------------------------------------------------ the walls

describe("the walls", () => {
  it("keep another organisation's onboardings out of sight", async () => {
    const view = (await call("GET", `${base(b)}/onboarding`, b.ownerCookie)).json();
    expect(view).toEqual({ current: null, history: [] });
    const mine = (await call("GET", `${base()}/onboarding`, a.ownerCookie)).json();
    expect(mine.history.length).toBeLessThanOrEqual(10);
    expect((await call("GET", `${base(b)}/onboarding`, a.ownerCookie)).statusCode).toBe(404);
    const app = await db.connect("app");
    await expect(
      app.query("select app.enqueue_engine_onboard($1, $2)", [b.orgId, JSON.stringify({ org_id: b.orgId })]),
    ).rejects.toMatchObject({ code: "42501" });
    await app.end();
  });
});
