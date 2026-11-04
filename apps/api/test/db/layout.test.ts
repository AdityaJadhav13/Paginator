// Hosted layout on the API's side (docs/product/10-l2-newsroom-plan.md §1 L2.3, §2.2; migration 2026_12_02_0001), on a
// migrated clone and the run's bucket: engine profiles (upload, setup job, the inbox settling them), an edition's
// readiness and ad slots, layout runs (the frozen request, one active run, cancel, files), the inbox applying the
// engine's events (progress, pages, the end, Placed written back), the sweep and the stalled-run reconciler, the measure
// scheduler, and who may do what. The worker is not run here: its events are written as the queue writes them. Every
// story, picture and file is fictional, made here.
import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import { strToU8, zipSync } from "fflate";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measurePass } from "../../src/modules/layout/measure.ts";
import { drainInbox, sweep } from "../../src/modules/media/engine-inbox.ts";
import { s3Client, s3Store } from "../../src/storage/s3.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

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
let ownerId: string;
let chief: Person;
let designer: Person;
let editor: Person;
let viewer: Person;
let advertising: Person;
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
  app = await db.connect("app");
  a = await n.organisation();
  b = await n.organisation();
  ownerId = await n.userId(a.owner);
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  designer = await n.member(a, as("page_designer"), "member", "designer");
  editor = await n.member(a, as("editor"), "member", "editor");
  viewer = await n.member(a, as("viewer"), "member", "viewer");
  advertising = await n.member(a, as("advertising"), "member", "advertising");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

// ------------------------------------------------------------------------------------------------ fictional data

const PLAN = (pages: 4 | 8 | 16, ads: boolean) => ({
  pages,
  back_page_ads: ads,
  page_plan: Array.from({ length: pages }, (_, i) => ({
    page: i + 1,
    role: i === 0 ? "front" : i === pages - 1 ? "back" : "inside",
    template_role: i === 0 ? "front" : "inside",
    news_mm2: 60000,
    ad_slots: ads && i === pages - 1 ? [{ slot: "back-1", w_mm: 120, h_mm: 80.5 }] : [],
  })),
  needs: { stories: 20, briefs: 4, photos: 6, words: 9000, per_role: {}, spare_share: 0.1 },
});
const PLANS = [4, 8, 16].flatMap((p) => [PLAN(p as 4 | 8 | 16, true), PLAN(p as 4 | 8 | 16, false)]);
const GRID = { columns: 8, column_width_mm: 32, gutter_mm: 4 };

/** What the queue's report writes (apps/engine-queue/src/inbox.ts), as pgn_engine. */
async function report(event: Record<string, unknown>, target: string, jobId: string = randomUUID()) {
  await engine.query(
    `with added as (
       insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, $3, $4, $5)
       on conflict do nothing
     ) select pg_notify('engine_events', $2)`,
    [event["org_id"], jobId, event["kind"], target, JSON.stringify(event)],
  );
  return jobId;
}
const outcomeOf = async (jobId: string) =>
  (await su.query("select outcome from app.engine_event where job_id = $1", [jobId])).rows[0]?.outcome as string;

type Job = { id: string; payload: Record<string, unknown>; key: string; max_attempts: number; task: string };
async function job(key: string): Promise<Job | undefined> {
  const { rows } = await su.query<Job>(
    `select j.id::text, j.payload, j.key, j.max_attempts, t.identifier as task, q.queue_name, j.priority
     from queue._private_jobs j join queue._private_tasks t on t.id = j.task_id
     left join queue._private_job_queues q on q.id = j.job_queue_id where j.key = $1`,
    [key],
  );
  return rows[0];
}

async function put(key: string, body: string | Uint8Array) {
  const out = await s3Client(it_.config.storage!).send(
    new PutObjectCommand({ Bucket: it_.config.storage!.workBucket, Key: key, Body: body }),
  );
  return { key, version_id: out.VersionId as string, sha256: sha(body), bytes: Buffer.byteLength(body) };
}

let editions = 0;
/** An edition of org a (8 pages, back-page ads), made as the superuser. */
async function edition(pages = 8): Promise<string> {
  const day = String(++editions).padStart(2, "0");
  const { rows } = await su.query<{ id: string }>(
    `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
     values ($1, $2, $3::date, $3::text, $4) returning id`,
    [a.orgId, a.pubId, `2027-01-${day}`, pages],
  );
  return rows[0]?.id ?? "";
}

let stories = 0;
/** A story of the edition, with a photo in the given state (ready: with its CMYK rendition). */
async function story(
  editionId: string,
  o: { status?: string; words?: number; photo?: "ready" | "received" | "rejected"; pin?: number } = {},
) {
  const k = ++stories;
  const desk = `a-${k.toString(16).padStart(10, "0")}`;
  const { rows } = await su.query<{ id: string }>(
    `insert into app.story (org_id, publication_id, edition_id, desk_key, status, reporter_id, language, page_pin)
     values ($1, $2, $3, $4, $5, $6, 'mr', $7) returning id`,
    [a.orgId, a.pubId, editionId, desk, o.status ?? "ready", ownerId, o.pin ?? null],
  );
  const id = rows[0]?.id ?? "";
  const words = o.words ?? 120;
  await su.query(
    `insert into app.story_revision (org_id, publication_id, story_id, rev, headline, body, words, author_id)
     values ($1, $2, $3, 1, $4, $5, $6, $7)`,
    [a.orgId, a.pubId, id, `काल्पनिक बातमी ${k} (fictional)`, "शब्द ".repeat(words).trim(), words, ownerId],
  );
  let asset: string | null = null;
  if (o.photo) {
    asset = await picture(o.photo);
    await su.query(
      `insert into app.story_photo (org_id, publication_id, story_id, asset_id, caption, credit)
       values ($1, $2, $3, $4, 'A fictional caption', 'Fictional credit')`,
      [a.orgId, a.pubId, id, asset],
    );
  }
  return { id, desk, asset };
}

let pictures = 0;
/** A picture of the library in a state (ready: with its CMYK rendition, 400×300). */
async function picture(state: "ready" | "received" | "rejected" = "ready", org = a) {
  const k = ++pictures;
  const { rows } = await su.query<{ id: string }>(
    `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, status,
       uploaded_by, version_id)
     values ($1, $2, $3, $4, 1000, 'image/jpeg', 2000, 1500, $5, $6, 'v-original') returning id`,
    [org.orgId, org.pubId, `p-${k.toString(16).padStart(10, "0")}`, sha(`picture ${k}`), state, ownerId],
  );
  const id = rows[0]?.id ?? "";
  if (state === "ready") {
    const hash = "c".repeat(32);
    await su.query(
      `insert into app.rendition (org_id, publication_id, asset_id, purpose, params_hash, key, version_id, sha256, bytes,
         mime, width_px, height_px)
       values ($1, $2, $3, 'cmyk', $4, $5, 'v-cmyk', $6, 100, 'application/gzip', 400, 300)`,
      [
        org.orgId,
        org.pubId,
        id,
        hash,
        `orgs/${org.orgId}/pubs/${org.pubId}/assets/${id}/r/cmyk-${hash}.cmyk.gz`,
        sha(`cmyk ${k}`),
      ],
    );
  }
  return id;
}

/** A ready profile of org a's publication (newest: in use), as the inbox would leave it. */
async function readyProfile(org = a) {
  const user = org === a ? ownerId : await n.userId(org.owner);
  const upload = await su.query<{ id: string }>(
    `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
     values ($1, $2, $3, 'engine_dataset', 'application/zip', 10, now()) returning id`,
    [org.orgId, org.pubId, user],
  );
  const { rows } = await su.query<{ id: string }>(
    `insert into app.engine_profile (org_id, publication_id, version, state, upload_id, dataset_version_id,
       dataset_sha256, dataset_bytes, config_version_id, config_sha256, engine_version, templates, grid, plans,
       created_by)
     values ($1, $2, (select coalesce(max(version), 0) + 1 from app.engine_profile where publication_id = $2),
       'ready', $3, 'v-dataset', $4, 10, 'v-config', $5, 'fictional-engine 1', '{"front": "page1"}', $6, $7, $8)
     returning id`,
    [
      org.orgId,
      org.pubId,
      upload.rows[0]?.id,
      "d".repeat(64),
      "e".repeat(64),
      JSON.stringify(GRID),
      JSON.stringify(PLANS),
      user,
    ],
  );
  return rows[0]?.id ?? "";
}

// ------------------------------------------------------------------------------------------------ engine profiles

async function datasetUpload(cookie: string, file: Uint8Array, org = a): Promise<string> {
  const presigned = await change("POST", `${base(org)}/uploads`, cookie, {
    purpose: "engine_dataset",
    filename: "dataset.zip",
    contentType: "application/zip",
    bytes: file.length,
  });
  expect(presigned.statusCode, presigned.body).toBe(201);
  const policy = presigned.json();
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields as Record<string, string>)) form.append(name, value);
  form.append("file", new Blob([file]));
  expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
  return policy.uploadId as string;
}

describe("an engine profile", () => {
  const bundle = zipSync({ "dataset/report/fictional.json": strToU8("{}") });

  it("is made from the owner's dataset bundle: setup enqueued with it, the bundle pinned, a replay the same", async () => {
    const uploadId = await datasetUpload(a.ownerCookie, bundle);
    const key = randomUUID();
    const res = await change("POST", `${base()}/engine-profiles`, a.ownerCookie, { uploadId }, key);
    expect(res.statusCode, res.body).toBe(202);
    const profile = res.json();
    expect(profile).toMatchObject({ state: "setting_up", datasetSha256: sha(bundle), datasetBytes: bundle.length });
    const queued = await job(`profile:${profile.id}`);
    expect(queued).toMatchObject({ task: "engine.setup", max_attempts: 2, queue_name: "engine-cpu" });
    expect(Object.keys(queued?.payload ?? {}).sort()).toEqual([
      "org_id",
      "profile_id",
      "pub_id",
      "sha256",
      "version_id",
    ]);
    const { rows } = await su.query("select dataset_key, dataset_version_id from app.engine_profile where id = $1", [
      profile.id,
    ]);
    expect(rows[0].dataset_key).toBe(`orgs/${a.orgId}/pubs/${a.pubId}/profiles/${profile.id}/dataset.zip`);
    const chunks: Uint8Array[] = [];
    for await (const c of await store().read(rows[0].dataset_key, rows[0].dataset_version_id)) chunks.push(c);
    expect(sha(Buffer.concat(chunks))).toBe(sha(bundle));
    const again = await change("POST", `${base()}/engine-profiles`, a.ownerCookie, { uploadId }, key);
    expect(again.statusCode).toBe(202);
    expect(again.json().id).toBe(profile.id);
    const list = await call("GET", `${base()}/engine-profiles`, editor.cookie);
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0]).toMatchObject({ id: profile.id, version: 1 });
  });

  it("is refused to a role without settings.edit, for a file not a ZIP, and for another's upload", async () => {
    const presign = await change("POST", `${base()}/uploads`, editor.cookie, {
      purpose: "engine_dataset",
      filename: "dataset.zip",
      contentType: "application/zip",
      bytes: 100,
    });
    expect(presign.statusCode).toBe(403);
    const notZip = await datasetUpload(chief.cookie, strToU8("not a zip at all (fictional)"));
    const refused = await change("POST", `${base()}/engine-profiles`, chief.cookie, { uploadId: notZip });
    expect(refused.statusCode).toBe(400);
    const theirs = await datasetUpload(a.ownerCookie, bundle);
    expect((await change("POST", `${base()}/engine-profiles`, chief.cookie, { uploadId: theirs })).statusCode).toBe(
      404,
    );
    expect((await change("POST", `${base()}/engine-profiles`, editor.cookie, { uploadId: theirs })).statusCode).toBe(
      403,
    );
    expect((await call("GET", `${base()}/engine-profiles`, viewer.cookie)).statusCode).toBe(403);
    // another organisation's owner cannot name it
    expect((await change("POST", `${base(b)}/engine-profiles`, b.ownerCookie, { uploadId: theirs })).statusCode).toBe(
      404,
    );
    // a dataset bundle is never completed as a picture
    expect((await call("POST", `${base()}/uploads/${theirs}/complete`, a.ownerCookie)).statusCode).toBe(422);
  });

  it("is settled by the engine: ready (in use), rejected, or its job failed; a forged config refused", async () => {
    const make = async () => {
      const id = await datasetUpload(a.ownerCookie, bundle);
      return (await change("POST", `${base()}/engine-profiles`, a.ownerCookie, { uploadId: id })).json().id as string;
    };
    const ready = await make();
    const event = (
      profileId: string,
      config = `orgs/${a.orgId}/pubs/${a.pubId}/profiles/${profileId}/config.json`,
    ) => ({
      kind: "profile.ready",
      org_id: a.orgId,
      pub_id: a.pubId,
      profile_id: profileId,
      sha256: sha(bundle),
      config: { key: config, version_id: "v-config", sha256: "f".repeat(64), bytes: 10 },
      engine_version: "fictional-engine 2",
      templates: { front: "page1" },
      grid: GRID,
      plans: PLANS,
    });
    const forged = await report(
      event(ready, `orgs/${a.orgId}/pubs/${a.pubId}/profiles/${randomUUID()}/config.json`),
      ready,
    );
    const real = await report(event(ready), ready);
    await drain();
    expect(await outcomeOf(forged)).toBe("refused");
    expect(await outcomeOf(real)).toBe("applied");
    const list = (await call("GET", `${base()}/engine-profiles`, a.ownerCookie)).json();
    expect(list.inUse).toBe(ready);
    expect(list.items.find((p: { id: string }) => p.id === ready)).toMatchObject({
      state: "ready",
      grid: { columns: 8, columnMm: 32, gutterMm: 4 },
      engineVersion: "fictional-engine 2",
    });
    const rejected = await make();
    const message = { text: "There are no page models in this bundle.", code: null, params: null };
    const no = await report(
      {
        kind: "profile.rejected",
        org_id: a.orgId,
        pub_id: a.pubId,
        profile_id: rejected,
        sha256: sha(bundle),
        code: "profile.no_pages",
        message,
      },
      rejected,
    );
    const lost = await make();
    const failed = await report(
      {
        kind: "job.failed",
        org_id: a.orgId,
        pub_id: a.pubId,
        job_kind: "engine.setup",
        target_id: lost,
        code: "worker.lost",
        message: "lost",
      },
      lost,
    );
    // org b cannot settle org a's profile
    const cross = await report({ ...event(rejected), org_id: b.orgId, pub_id: b.pubId }, rejected);
    await drain();
    expect([await outcomeOf(no), await outcomeOf(failed), await outcomeOf(cross)]).toEqual([
      "applied",
      "applied",
      "refused",
    ]);
    const items = (await call("GET", `${base()}/engine-profiles`, a.ownerCookie)).json().items;
    expect(items.find((p: { id: string }) => p.id === rejected).error).toEqual({ code: "profile.no_pages", message });
    expect(items.find((p: { id: string }) => p.id === lost).error.code).toBe("worker.lost");
  });
});

// ------------------------------------------------------------------------------------------------ editions and runs

describe("an edition's layout", () => {
  let profileId: string;
  beforeAll(async () => {
    profileId = await readyProfile();
  });

  it("shows readiness against the plan: counts, what is not Ready, blockers, and the plan's ad slots", async () => {
    const e = await edition();
    await story(e, { words: 40 }); // a brief
    await story(e, { photo: "ready" });
    const preparing = await story(e, { photo: "received" });
    const pinned = await story(e, { pin: 12 });
    await story(e, { status: "editing" });
    await story(e, { status: "spiked" });
    const res = await call("GET", `${base()}/editions/${e}/layout`, viewer.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const got = res.json();
    expect(got.profile.id).toBe(profileId);
    expect(got.readiness.needs).toEqual({ stories: 20, briefs: 4, photos: 6, words: 9000 });
    expect(got.readiness.have).toEqual({ stories: 4, briefs: 1, photos: 2, words: 400 });
    expect(got.readiness.notReady.map((s: { status: string }) => s.status)).toEqual(["editing"]);
    expect(got.readiness.blockers.map((s: { storyId: string; code: string }) => [s.storyId, s.code])).toEqual([
      [preparing.id, "photo_preparing"],
      [pinned.id, "page_pin"],
    ]);
    expect(got.slots).toEqual([
      { slot: "back-1", page: 8, wMm: 120, hMm: 80.5, state: "empty", assetId: null, problem: null },
    ]);
    expect(got).toMatchObject({ active: null, last: null, board: null });
    // another organisation finds nothing
    expect((await call("GET", `${base(b)}/editions/${e}/layout`, b.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", `${base()}/editions/${e}/layout`, b.ownerCookie)).statusCode).toBe(404);
  });

  it("takes an ad in a slot of the plan: the media.ad job, the engine's raster, and a cleared slot", async () => {
    const e = await edition();
    const ad = await picture();
    expect((await call("PUT", `${base()}/editions/${e}/ads/back-1`, viewer.cookie, { assetId: ad })).statusCode).toBe(
      403,
    );
    expect((await call("PUT", `${base()}/editions/${e}/ads/front-9`, a.ownerCookie, { assetId: ad })).statusCode).toBe(
      404,
    );
    const waiting = await picture("received");
    expect(
      (await call("PUT", `${base()}/editions/${e}/ads/back-1`, a.ownerCookie, { assetId: waiting })).statusCode,
    ).toBe(400);
    // Advertising has no media.view: its picker lists the ready pictures only, and their previews, never an original
    const listed = await call("GET", `${base()}/media`, advertising.cookie);
    expect(listed.statusCode, listed.body).toBe(200);
    const ids = listed.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(ad);
    expect(ids).not.toContain(waiting);
    expect(listed.json().items.every((i: { status: string }) => i.status === "ready")).toBe(true);
    await su.query(
      `insert into app.rendition (org_id, publication_id, asset_id, purpose, params_hash, key, version_id, sha256, bytes,
         mime, width_px, height_px)
       values ($1, $2, $3, 'preview', $4, $5, 'v-preview', $6, 100, 'image/jpeg', 400, 300)`,
      [
        a.orgId,
        a.pubId,
        ad,
        "d".repeat(32),
        `orgs/${a.orgId}/pubs/${a.pubId}/assets/${ad}/r/preview.jpg`,
        "e".repeat(64),
      ],
    );
    expect((await call("GET", `${base()}/assets/${ad}/file?variant=preview`, advertising.cookie)).statusCode).toBe(302);
    expect((await call("GET", `${base()}/assets/${ad}/file`, advertising.cookie)).statusCode).toBe(403);
    expect((await call("GET", `${base()}/assets/${waiting}/file?variant=preview`, advertising.cookie)).statusCode).toBe(
      404,
    );
    const set = await call("PUT", `${base()}/editions/${e}/ads/back-1`, advertising.cookie, { assetId: ad });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject({ slot: "back-1", state: "preparing", assetId: ad });
    const { rows } = await su.query<{ id: string }>("select id from app.ad_slot_artwork where edition_id = $1", [e]);
    const artwork = rows[0]?.id ?? "";
    const queued = await job(`ad:${artwork}`);
    expect(queued).toMatchObject({ task: "media.ad", max_attempts: 10 });
    expect(queued?.payload).toMatchObject({ artwork_id: artwork, asset_id: ad, w_mm: "120.00", h_mm: "80.50" });
    const folder = `orgs/${a.orgId}/pubs/${a.pubId}/assets/${ad}/r/`;
    const file = (name: string) => ({
      key: folder + name,
      version_id: "v1",
      sha256: "a".repeat(64),
      bytes: 9,
      width_px: 945,
      height_px: 634,
    });
    const ready = await report(
      {
        kind: "ad.ready",
        org_id: a.orgId,
        pub_id: a.pubId,
        artwork_id: artwork,
        asset_id: ad,
        sha256: queued?.payload["sha256"],
        raster: file(`ad-${"b".repeat(32)}-x.cmyk.gz`),
        preview: file(`ad-${"b".repeat(32)}-x.jpg`),
        params_hash: "b".repeat(32),
      },
      artwork,
    );
    await drain();
    expect(await outcomeOf(ready)).toBe("applied");
    expect((await call("GET", `${base()}/editions/${e}/layout`, a.ownerCookie)).json().slots[0].state).toBe("ready");
    // replaced by another picture: a new artwork id, so the old picture's job cannot settle the new one
    const other = await picture();
    expect(
      (await call("PUT", `${base()}/editions/${e}/ads/back-1`, advertising.cookie, { assetId: other })).statusCode,
    ).toBe(200);
    const now = await su.query<{ id: string }>("select id from app.ad_slot_artwork where edition_id = $1", [e]);
    expect(now.rows[0]?.id).not.toBe(artwork);
    const late = await report(
      {
        kind: "job.failed",
        org_id: a.orgId,
        pub_id: a.pubId,
        job_kind: "media.ad",
        target_id: artwork,
        code: "worker.lost",
        message: "the job was lost",
      },
      artwork,
    );
    await drain();
    expect(await outcomeOf(late)).toBe("ignored");
    expect((await call("GET", `${base()}/editions/${e}/layout`, a.ownerCookie)).json().slots[0]).toMatchObject({
      state: "preparing",
      assetId: other,
    });
    expect((await call("DELETE", `${base()}/editions/${e}/ads/back-1`, designer.cookie)).statusCode).toBe(204);
    expect((await call("GET", `${base()}/editions/${e}/layout`, a.ownerCookie)).json().slots[0].state).toBe("empty");
  });
});

describe("a layout run", () => {
  let e: string;
  let placed: Awaited<ReturnType<typeof story>>;
  let left: Awaited<ReturnType<typeof story>>;
  let unplaced: Awaited<ReturnType<typeof story>>;
  let runId: string;
  let requestSha: string;

  beforeAll(async () => {
    await readyProfile();
    e = await edition();
    placed = await story(e, { photo: "ready" });
    left = await story(e);
    unplaced = await story(e, { status: "placed" });
  });

  it("is refused while a story blocks it, and to a role without layout.generate", async () => {
    const preparing = await story(e, { photo: "received" });
    const res = await change("POST", `${base()}/editions/${e}/runs`, designer.cookie, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("layout_refused");
    expect(res.json().error.current.blockers[0]).toMatchObject({ storyId: preparing.id, code: "photo_preparing" });
    await su.query("update app.story set status = 'held' where id = $1", [preparing.id]);
    expect((await change("POST", `${base()}/editions/${e}/runs`, editor.cookie, {})).statusCode).toBe(202);
    // the editor's run is the edition's active one now: cancel it for the tests below
    const active = (await call("GET", `${base()}/editions/${e}/layout`, a.ownerCookie)).json().active;
    expect((await call("POST", `${base()}/runs/${active.id}/cancel`, editor.cookie)).statusCode).toBe(200);
    expect((await change("POST", `${base()}/editions/${e}/runs`, viewer.cookie, {})).statusCode).toBe(403);
    expect((await change("POST", `${base()}/editions/${e}/runs`, reporter.cookie, {})).statusCode).toBe(403);
  });

  it("freezes the request in the Desk's shape, pinned by SHA-256, with its job; one active run an edition", async () => {
    const key = randomUUID();
    const res = await change("POST", `${base()}/editions/${e}/runs`, designer.cookie, {}, key);
    expect(res.statusCode, res.body).toBe(202);
    const run = res.json();
    runId = run.id;
    expect(run).toMatchObject({ state: "queued", editionId: e, message: { code: "m.run.starting" } });
    expect(run.deskKey).toMatch(/^r-[0-9]{8}-[0-9]{6}$/);
    const { rows } = await su.query(
      "select request_key, request_version_id, request_sha256, ad_rasters from app.layout_run where id = $1",
      [runId],
    );
    requestSha = rows[0].request_sha256;
    const chunks: Uint8Array[] = [];
    for await (const c of await store().read(rows[0].request_key, rows[0].request_version_id)) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    expect(sha(bytes)).toBe(requestSha);
    const doc = JSON.parse(bytes.toString("utf8"));
    expect(Object.keys(doc).sort()).toEqual(["ads", "articles", "edition"]);
    expect(doc.edition).toMatchObject({ schema: "pageinator.desk.edition/1", pages: 8, back_page_ads: true });
    // the run keeps the ad rasters its request holds (the release's ad_artwork check compares them)
    expect(rows[0].ad_rasters).toEqual(
      Object.fromEntries(
        Object.entries(doc.ads).map(([slot, ad]) => [slot, (ad as { raster: { sha256: string } }).raster.sha256]),
      ),
    );
    expect(doc.articles.map((x: { id: string }) => x.id).sort()).toEqual(
      [placed.desk, left.desk, unplaced.desk].sort(),
    );
    const withPhoto = doc.articles.find((x: { id: string }) => x.id === placed.desk);
    expect(Object.keys(withPhoto).sort()).toEqual(
      [
        "body",
        "byline",
        "created",
        "deck",
        "headline",
        "id",
        "kicker",
        "page",
        "photo",
        "priority",
        "source",
        "updated",
      ].sort(),
    );
    expect(withPhoto.photo).toMatchObject({ caption: "A fictional caption", width_px: 400, height_px: 300 });
    expect(Object.keys(withPhoto.photo.raster).sort()).toEqual([
      "height_px",
      "key",
      "sha256",
      "version_id",
      "width_px",
    ]);
    const queued = await job(`run:${runId}`);
    expect(queued).toMatchObject({ task: "engine.layout", max_attempts: 1, queue_name: "engine-cpu" });
    expect(queued?.payload).toMatchObject({
      run_id: runId,
      sha256: requestSha,
      run_key: run.deskKey,
      edition_key: doc.edition.id,
    });
    // a replay is the same run; another is refused while it is active
    const again = await change("POST", `${base()}/editions/${e}/runs`, designer.cookie, {}, key);
    expect(again.json().id).toBe(runId);
    const second = await change("POST", `${base()}/editions/${e}/runs`, designer.cookie, {});
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: "run_active", current: { id: runId } });
    // another organisation finds nothing
    expect((await call("GET", `${base(b)}/runs/${runId}`, b.ownerCookie)).statusCode).toBe(404);
    expect((await call("POST", `${base(b)}/runs/${runId}/cancel`, b.ownerCookie)).statusCode).toBe(404);
  });

  it("takes the engine's progress and pages only for its own request, and its files only in its folder", async () => {
    const ev = { org_id: a.orgId, pub_id: a.pubId, run_id: runId, sha256: requestSha };
    const progress = await report(
      {
        ...ev,
        kind: "run.progress",
        state: "layout",
        message: null,
        pages: [{ page: 1, role: "front", state: "working" }],
        elapsed_s: 3,
      },
      runId,
    );
    const other = await report(
      { ...ev, sha256: "0".repeat(64), kind: "run.progress", state: "layout", message: null, pages: [], elapsed_s: 4 },
      runId,
    );
    const folder = `orgs/${a.orgId}/pubs/${a.pubId}/runs/${runId}/`;
    const page = {
      ...ev,
      kind: "run.page",
      page: 1,
      role: "front",
      articles: [placed.desk],
      pdf: await put(`${folder}pages/01/page.pdf`, "%PDF fictional 1"),
      png: await put(`${folder}pages/01/preview.png`, "png 1"),
      thumb: null,
      seconds: 2,
      warnings: [],
    };
    const outside = await report(
      { ...page, pdf: { ...page.pdf, key: `orgs/${a.orgId}/pubs/${a.pubId}/runs/${randomUUID()}/x.pdf` } },
      runId,
    );
    const good = await report(page, runId);
    await drain();
    const outcomes: string[] = [];
    for (const one of [progress, other, outside, good]) outcomes.push(await outcomeOf(one));
    expect(outcomes).toEqual(["applied", "ignored", "refused", "applied"]);
    const got = (await call("GET", `${base()}/runs/${runId}`, viewer.cookie)).json();
    expect(got).toMatchObject({ state: "layout", pages: [{ page: 1, state: "done", pdf: true, preview: true }] });
    expect(got.pages[0].stories[0]).toMatchObject({ storyId: placed.id, deskKey: placed.desk });
    // a page's preview while the run goes on, never its PDF
    expect((await call("GET", `${base()}/runs/${runId}/files/page-01.png`, viewer.cookie)).statusCode).toBe(200);
    expect((await call("GET", `${base()}/runs/${runId}/files/page-01.pdf`, viewer.cookie)).statusCode).toBe(404);
  });

  it("ends done: its pages checked, the stories not placed, and Placed written back", async () => {
    const folder = `orgs/${a.orgId}/pubs/${a.pubId}/runs/${runId}/`;
    const pdf = await put(`${folder}pages/01/page.pdf`, "%PDF fictional 1");
    const report_ = await put(`${folder}pages/01/pdfx-check.txt`, "fictional report");
    const finished = {
      kind: "run.finished",
      org_id: a.orgId,
      pub_id: a.pubId,
      run_id: runId,
      sha256: requestSha,
      state: "done",
      message: { text: "1 page made.", code: "m.run.made1", params: null },
      error: null,
      pages: [
        {
          page: 1,
          role: "front",
          articles: [placed.desk],
          pdf,
          png: null,
          thumb: null,
          seconds: 2,
          warnings: [],
          state: "done",
          check: { passed: true, fails: 0, warnings: 2, report: report_ },
        },
        {
          page: 2,
          role: "inside",
          state: "failed",
          message: { text: "layout failed", code: "m.run.pageFailed", params: null },
        },
      ],
      not_placed: [
        {
          article: left.desk,
          reason: { text: "these stories do not fill the page exactly", code: "m.run.notFillExactly", params: null },
        },
      ],
      edition_pdf: await put(`${folder}edition.pdf`, "%PDF edition"),
      press_zip: await put(`${folder}press-files.zip`, "zip"),
      checker_sha256: "9".repeat(64),
      engine_version: "fictional-engine 1",
      timings: { generate: 10 },
      elapsed_s: 12,
    };
    const done = await report(finished, runId);
    await drain();
    expect(await outcomeOf(done)).toBe("applied");
    const got = (await call("GET", `${base()}/runs/${runId}`, viewer.cookie)).json();
    expect(got).toMatchObject({ state: "done", files: { editionPdf: true, pressZip: true }, elapsedS: 12 });
    expect(got.pages[0]).toMatchObject({ check: { passed: true, fails: 0, warnings: 2 } });
    expect(got.pages[1]).toMatchObject({ state: "failed", pdf: false });
    expect(got.notPlaced).toEqual([
      { storyId: left.id, deskKey: left.desk, headline: expect.any(String), reason: finished.not_placed[0]?.reason },
    ]);
    const statuses = await su.query<{ id: string; status: string }>(
      "select id, status from app.story where id = any ($1)",
      [[placed.id, left.id, unplaced.id]],
    );
    expect(Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]))).toEqual({
      [placed.id]: "placed",
      [left.id]: "ready",
      [unplaced.id]: "ready",
    });
    const changes = await su.query("select changed_by from app.story_status_change where story_id = $1", [placed.id]);
    expect(changes.rows).toEqual([{ changed_by: null }]);
    const verdict = await su.query("select passed, warnings from app.pdf_check where org_id = $1 and sha256 = $2", [
      a.orgId,
      pdf.sha256,
    ]);
    expect(verdict.rows).toEqual([{ passed: true, warnings: 2 }]);
    // a later event of the run changes nothing
    const late = await report({ ...finished, state: "failed" }, runId);
    await drain();
    expect(await outcomeOf(late)).toBe("ignored");
    const board = (await call("GET", `${base()}/editions/${e}/layout`, viewer.cookie)).json();
    expect(board).toMatchObject({ active: null, last: { id: runId }, board: { id: runId } });
    // cancelling an ended run is refused
    expect((await call("POST", `${base()}/runs/${runId}/cancel`, designer.cookie)).json().error.code).toBe(
      "run_finished",
    );
  });

  it("gives its files by 5-minute links, each to the roles that may have it", async () => {
    const file = (name: string, cookie: string) => call("GET", `${base()}/runs/${runId}/files/${name}`, cookie);
    const link = await file("page-01.pdfx-check.txt", viewer.cookie);
    expect(link.statusCode, link.body).toBe(200);
    expect(Date.parse(link.json().expiresAt) - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    expect((await fetch(link.json().url)).status).toBe(200);
    expect((await file("edition.pdf", viewer.cookie)).statusCode).toBe(200);
    expect((await file("page-01.pdf", reporter.cookie)).statusCode).toBe(200);
    expect((await file("press-files.zip", viewer.cookie)).statusCode).toBe(403);
    expect((await file("press-files.zip", designer.cookie)).statusCode).toBe(403);
    expect((await file("press-files.zip", chief.cookie)).statusCode).toBe(200);
    expect((await file("page-02.pdf", chief.cookie)).statusCode).toBe(404);
    expect((await file("../request.json", chief.cookie)).statusCode).toBe(404);
  });

  it("is cancelled at once: its waiting job removed, its later events ignored", async () => {
    const run = (await change("POST", `${base()}/editions/${e}/runs`, designer.cookie, {})).json();
    expect(await job(`run:${run.id}`)).toBeDefined();
    const cancelled = await call("POST", `${base()}/runs/${run.id}/cancel`, designer.cookie);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({ state: "cancelled", message: { code: "m.run.cancelledBefore" } });
    expect(await job(`run:${run.id}`)).toBeUndefined();
    const { rows } = await su.query("select request_sha256 from app.layout_run where id = $1", [run.id]);
    const late = await report(
      {
        kind: "run.progress",
        org_id: a.orgId,
        pub_id: a.pubId,
        run_id: run.id,
        sha256: rows[0].request_sha256,
        state: "layout",
        message: null,
        pages: [],
        elapsed_s: 1,
      },
      run.id,
    );
    await drain();
    expect(await outcomeOf(late)).toBe("ignored");
  });

  it("is failed in the Desk's words when its worker is lost: a spent job, or a heartbeat that stopped", async () => {
    const lost = (await change("POST", `${base()}/editions/${e}/runs`, designer.cookie, {})).json();
    await su.query("update queue._private_jobs set attempts = max_attempts where key = $1", [`run:${lost.id}`]);
    await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 });
    await drain();
    const one = (await call("GET", `${base()}/runs/${lost.id}`, viewer.cookie)).json();
    expect(one).toMatchObject({ state: "failed", error: { code: "m.run.restarted" } });
    const stalled = (await change("POST", `${base()}/editions/${e}/runs`, designer.cookie, {})).json();
    await su.query(
      "update app.layout_run set state = 'layout', heartbeat_at = now() - interval '11 minutes' where id = $1",
      [stalled.id],
    );
    // a report still waiting in the inbox is not a silent worker: not stalled until it is applied
    const waiting = await report({ kind: "run.progress", org_id: a.orgId }, stalled.id);
    await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 });
    expect(await outcomeOf(`lost:${stalled.id}`)).toBeUndefined();
    await su.query("delete from app.engine_event where job_id = $1", [waiting]);
    await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 });
    await drain();
    const two = (await call("GET", `${base()}/runs/${stalled.id}`, viewer.cookie)).json();
    expect(two).toMatchObject({
      state: "failed",
      message: {
        text: "The server was restarted while this run was in progress. Start it again.",
        code: "m.run.restarted",
      },
    });
    // stranded a second time: a new lost event, not taken for the first one
    await su.query(
      "update app.layout_run set state = 'layout', finished_at = null, heartbeat_at = now() - interval '11 minutes' where id = $1",
      [stalled.id],
    );
    await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 });
    await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 });
    const lostIds = await su.query("select job_id from app.engine_event where asset_id = $1 and job_id like 'lost:%'", [
      stalled.id,
    ]);
    expect(lostIds.rows.map((r) => r.job_id).sort()).toEqual([`lost:${stalled.id}`, `lost:${stalled.id}:1`]);
    await drain();
    await su.query("delete from queue._private_jobs where key = $1", [`run:${stalled.id}`]);
  });

  it("refuses another organisation's job and cancel, and a call outside withTenant", async () => {
    const payload = JSON.stringify({ org_id: b.orgId });
    await expect(app.query("select app.enqueue_engine_layout($1, $2)", [b.orgId, payload])).rejects.toMatchObject({
      code: "42501",
    });
    await app.query("begin");
    try {
      await app.query("select set_config('app.org_id', $1, true)", [a.orgId]);
      for (const fn of [
        "enqueue_engine_setup",
        "enqueue_engine_measure",
        "enqueue_engine_layout",
        "enqueue_media_ad",
      ]) {
        await app.query("savepoint s");
        await expect(app.query(`select app.${fn}($1, $2)`, [a.orgId, payload])).rejects.toMatchObject({
          code: "42501",
        });
        await app.query("rollback to savepoint s");
      }
    } finally {
      await app.query("rollback");
    }
    await expect(
      app.query("select app.cancel_engine_job($1, $2)", [b.orgId, `run:${randomUUID()}`]),
    ).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("refuses a job or a cancel naming another organisation's edition or run, even under the caller's own org", async () => {
    const e = await edition();
    const run = await su.query<{ id: string }>("select id from app.layout_run where org_id = $1 limit 1", [a.orgId]);
    const tries: [string, unknown[]][] = [
      ["select app.enqueue_engine_measure($1, $2)", [b.orgId, JSON.stringify({ org_id: b.orgId, edition_id: e })]],
      ["select app.cancel_engine_job($1, $2)", [b.orgId, `measure:${e}`]],
    ];
    if (run.rows[0]) tries.push(["select app.cancel_engine_job($1, $2)", [b.orgId, `run:${run.rows[0].id}`]]);
    await app.query("begin");
    try {
      await app.query("select set_config('app.org_id', $1, true)", [b.orgId]);
      for (const [q, args] of tries) {
        await app.query("savepoint s");
        await expect(app.query(q, args)).rejects.toMatchObject({ code: "42501" });
        await app.query("rollback to savepoint s");
      }
    } finally {
      await app.query("rollback");
    }
    expect(await job(`measure:${e}`)).toBeUndefined();
  });
});

describe("background measuring", () => {
  it("snapshots an edition that changed and enqueues its measure, once for the same bytes", async () => {
    const e = await edition(4);
    await story(e);
    await su.query("update app.story set updated_at = now() - interval '1 minute' where edition_id = $1", [e]);
    await su.query("update app.edition set updated_at = now() - interval '1 minute' where id = $1", [e]);
    expect(await measurePass(it_.database, store(), 8_000)).toBeGreaterThanOrEqual(1);
    const queued = await job(`measure:${e}`);
    expect(queued).toMatchObject({ task: "engine.measure", max_attempts: 1, queue_name: "engine-cpu" });
    const { rows } = await su.query("select sha256, state, total from app.edition_measure where edition_id = $1", [e]);
    expect(rows[0]).toMatchObject({ state: "waiting", total: 1, sha256: queued?.payload["sha256"] });
    const ev = {
      kind: "measure.status",
      org_id: a.orgId,
      pub_id: a.pubId,
      edition_id: e,
      state: "done",
      measured: 1,
      total: 1,
      failed: 0,
    };
    const old = await report({ ...ev, sha256: "0".repeat(64) }, e);
    const now = await report({ ...ev, sha256: rows[0].sha256 }, e);
    await drain();
    expect([await outcomeOf(old), await outcomeOf(now)]).toEqual(["ignored", "applied"]);
    const layout = (await call("GET", `${base()}/editions/${e}/layout`, viewer.cookie)).json();
    expect(layout.readiness.measure).toEqual({ state: "done", measured: 1, total: 1 });
    // a change that leaves the snapshot's bytes as they were (a story not Ready): no new measure
    await su.query("delete from queue._private_jobs where key = $1", [`measure:${e}`]);
    await story(e, { status: "editing" });
    await measurePass(it_.database, store(), 0);
    expect(await job(`measure:${e}`)).toBeUndefined();
  });
});
