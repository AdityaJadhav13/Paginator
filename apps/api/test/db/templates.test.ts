// The Templates screen's routes (packages/contracts/src/templates.ts; src/modules/layout/templates.ts) on a migrated
// clone and the run's bucket: the profile in use's templates and candidates, a choice making a new profile version
// from it (its dataset copied server side, engine.setup enqueued with the base config and the choice, audited), one at
// a time, the inbox settling it (candidates and the colour profile kept), a refused one leaving the old in use, and
// who may do what. The worker is not run here: its events are written as the queue writes them. Fictional data only.
import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainInbox } from "../../src/modules/media/engine-inbox.ts";
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
let ownerId: string;
let designer: Person;
let editor: Person;
let reporter: Person;
const quiet = { error: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;
const store = () => s3Store(it_.config.storage!);
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const base = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}`;
const drain = () => drainInbox(it_.database, quiet, store());
const DATASET = "PK fictional dataset bundle";

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  engine = await db.connect("engine");
  a = await n.organisation();
  b = await n.organisation();
  ownerId = await n.userId(a.owner);
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  designer = await n.member(a, as("page_designer"), "member", "designer");
  editor = await n.member(a, as("editor"), "member", "editor");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const PLAN = (pages: 4 | 8 | 16, ads: boolean) => ({
  pages,
  back_page_ads: ads,
  page_plan: Array.from({ length: pages }, (_, i) => ({
    page: i + 1,
    role: i === 0 ? "front" : i === pages - 1 ? "back" : "inside",
    template_role: i === 0 ? "front" : "inside",
    news_mm2: 60000,
    ad_slots: [],
  })),
  needs: { stories: 20, briefs: 4, photos: 6, words: 9000, per_role: {}, spare_share: 0.1 },
});
const PLANS = [4, 8, 16].flatMap((p) => [PLAN(p as 4 | 8 | 16, true), PLAN(p as 4 | 8 | 16, false)]);
const GRID = { columns: 8, column_width_mm: 32, gutter_mm: 4 };
const OUTLINE = {
  page_w_mm: 330,
  page_h_mm: 520,
  news: [[12, 70, 318, 500]],
  kept: [{ kind: "furniture", box: [12, 10, 318, 60] }],
  ad_slots: [],
};
const CANDIDATES = Object.fromEntries(
  ["front", "inside_imprint", "inside", "back"].map((role) => [
    role,
    [
      { name: `${role}-new`, date: "2026-10-20", page: 1, outline: OUTLINE },
      { name: `${role}-old`, date: "", page: 1, outline: OUTLINE },
    ],
  ]),
);
const TEMPLATES = { front: "front-new", inside_imprint: "inside_imprint-new", inside: "inside-new", back: "back-new" };

/** A ready profile of org a's publication (in use), its dataset stored at its own key, as the inbox would leave it. */
async function readyProfile(candidates: unknown = CANDIDATES) {
  const upload = await su.query<{ id: string }>(
    `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
     values ($1, $2, $3, 'engine_dataset', 'application/zip', 10, now()) returning id`,
    [a.orgId, a.pubId, ownerId],
  );
  const { rows } = await su.query<{ id: string; dataset_key: string }>(
    `insert into app.engine_profile (org_id, publication_id, version, state, upload_id, dataset_sha256, dataset_bytes,
       config_version_id, config_sha256, engine_version, templates, grid, plans, candidates, created_by)
     values ($1, $2, (select coalesce(max(version), 0) + 1 from app.engine_profile where publication_id = $2),
       'ready', $3, $4, $5, 'v-config', $6, 'fictional-engine 1', $7, $8, $9, $10, $11)
     returning id, dataset_key`,
    [
      a.orgId,
      a.pubId,
      upload.rows[0]?.id,
      sha(DATASET),
      DATASET.length,
      "e".repeat(64),
      JSON.stringify(TEMPLATES),
      JSON.stringify(GRID),
      JSON.stringify(PLANS),
      candidates === null ? null : JSON.stringify(candidates),
      ownerId,
    ],
  );
  const row = rows[0]!;
  const put = await s3Client(it_.config.storage!).send(
    new PutObjectCommand({ Bucket: it_.config.storage!.workBucket, Key: row.dataset_key, Body: DATASET }),
  );
  await su.query("update app.engine_profile set dataset_version_id = $1 where id = $2", [put.VersionId, row.id]);
  return row.id;
}

async function report(event: Record<string, unknown>, target: string) {
  const jobId = randomUUID();
  await engine.query(
    `insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, $3, $4, $5)`,
    [event["org_id"], jobId, event["kind"], target, JSON.stringify(event)],
  );
  await drain();
  return (await su.query("select outcome from app.engine_event where job_id = $1", [jobId])).rows[0]?.outcome;
}
const ready = (profileId: string, templates: Record<string, string>) => ({
  kind: "profile.ready",
  org_id: a.orgId,
  pub_id: a.pubId,
  profile_id: profileId,
  sha256: sha(DATASET),
  config: {
    key: `orgs/${a.orgId}/pubs/${a.pubId}/profiles/${profileId}/config.json`,
    version_id: "v-config-2",
    sha256: "f".repeat(64),
    bytes: 10,
  },
  engine_version: "fictional-engine 1",
  templates,
  grid: GRID,
  plans: PLANS,
  candidates: CANDIDATES,
  icc_sha256: "c".repeat(64),
});
const jobPayload = async (profileId: string) =>
  (await su.query("select payload from queue._private_jobs where key = $1", [`profile:${profileId}`])).rows[0]
    ?.payload as Record<string, string> | undefined;

describe("Templates", () => {
  let first: string;

  it("has none in use before a profile is ready, and refuses a choice then", async () => {
    const view = await call("GET", `${base()}/templates`, a.ownerCookie);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({ inUse: null, roles: [], history: [], settingUp: null });
    const refused = await change("POST", `${base()}/templates`, a.ownerCookie, {});
    expect([refused.statusCode, refused.json().error.code]).toEqual([409, "no_profile"]);
  });

  it("shows the profile in use's templates and candidates per role, its grid and the versions", async () => {
    first = await readyProfile();
    const view = (await call("GET", `${base()}/templates`, editor.cookie)).json();
    expect(view.inUse).toMatchObject({ id: first, version: 1 });
    expect(view.roles.map((r: { role: string }) => r.role)).toEqual(["front", "inside_imprint", "inside", "back"]);
    expect(view.roles[3]).toMatchObject({
      chosen: "back-new",
      candidates: [
        { name: "back-new", date: "2026-10-20", page: 1, outline: { pageWMm: 330, adSlots: [] } },
        { name: "back-old", date: null },
      ],
    });
    expect(view).toMatchObject({ candidatesKnown: true, grid: { columns: 8, columnMm: 32, gutterMm: 4 } });
    expect(view.history[0]).toMatchObject({ id: first, basedOn: null, templateChoice: null });
    expect((await call("GET", `${base()}/templates`, reporter.cookie)).statusCode).toBe(403);
  });

  it("makes a new version from the one in use: dataset copied, setup enqueued with the choice, audited", async () => {
    // templates.view is not templates.edit
    expect(
      (await change("POST", `${base()}/templates`, editor.cookie, { role: "back", page: "back-old" })).statusCode,
    ).toBe(403);
    const notCandidate = await change("POST", `${base()}/templates`, designer.cookie, {
      role: "back",
      page: "front-old",
    });
    expect([notCandidate.statusCode, notCandidate.json().error.code]).toEqual([400, "invalid_request"]);
    expect((await change("POST", `${base()}/templates`, designer.cookie, { role: "back" })).statusCode).toBe(400);
    const key = randomUUID();
    const res = await change("POST", `${base()}/templates`, designer.cookie, { role: "back", page: "back-old" }, key);
    expect(res.statusCode, res.body).toBe(202);
    const made = res.json();
    expect(made).toMatchObject({
      version: 2,
      state: "setting_up",
      basedOn: { id: first, version: 1 },
      templateChoice: { back: "back-old" },
      datasetSha256: sha(DATASET),
    });
    const again = await change("POST", `${base()}/templates`, designer.cookie, { role: "back", page: "back-old" }, key);
    expect([again.statusCode, again.json().id]).toEqual([202, made.id]);
    const { rows } = await su.query(
      "select upload_id, based_on, dataset_key, dataset_version_id from app.engine_profile where id = $1",
      [made.id],
    );
    expect(rows[0]).toMatchObject({ upload_id: null, based_on: first });
    const chunks: Uint8Array[] = [];
    for await (const c of await store().read(rows[0].dataset_key, rows[0].dataset_version_id)) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe(DATASET);
    expect(await jobPayload(made.id)).toEqual({
      org_id: a.orgId,
      pub_id: a.pubId,
      profile_id: made.id,
      version_id: rows[0].dataset_version_id,
      sha256: sha(DATASET),
      base_profile_id: first,
      base_config_version_id: "v-config",
      base_config_sha256: "e".repeat(64),
      template_role: "back",
      template_page: "back-old",
    });
    const audit = await su.query(
      "select actor_id, data from app.audit_event where action = 'engine_profile.retemplate' and target_id = $1",
      [made.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].data).toMatchObject({ basedOn: first, version: 2, role: "back", page: "back-old" });
    // one at a time
    const busy = await change("POST", `${base()}/templates`, a.ownerCookie, {});
    expect([busy.statusCode, busy.json().error.code]).toEqual([409, "profile_setting_up"]);
    expect((await call("GET", `${base()}/templates`, a.ownerCookie)).json()).toMatchObject({
      inUse: { id: first },
      settingUp: { id: made.id, version: 2 },
    });
    // the engine sets it up: in use, with its candidates and the worker's colour profile
    expect(await report(ready(made.id, { ...TEMPLATES, back: "back-old" }), made.id)).toBe("applied");
    const view = (await call("GET", `${base()}/templates`, a.ownerCookie)).json();
    expect(view).toMatchObject({ inUse: { id: made.id, version: 2 }, settingUp: null });
    expect(view.roles[3].chosen).toBe("back-old");
    const stored = await su.query("select candidates, icc_sha256 from app.engine_profile where id = $1", [made.id]);
    expect(stored.rows[0]).toEqual({ candidates: CANDIDATES, icc_sha256: "c".repeat(64) });
  });

  it("leaves the one in use when the engine refuses a new version", async () => {
    const res = await change("POST", `${base()}/templates`, a.ownerCookie, { role: "front", page: "front-old" });
    expect(res.statusCode, res.body).toBe(202);
    const message = { text: "the page front-old cannot serve as the front template", code: null, params: null };
    const outcome = await report(
      {
        kind: "profile.rejected",
        org_id: a.orgId,
        pub_id: a.pubId,
        profile_id: res.json().id,
        sha256: sha(DATASET),
        code: "profile.setup",
        message,
      },
      res.json().id,
    );
    expect(outcome).toBe("applied");
    const view = (await call("GET", `${base()}/templates`, a.ownerCookie)).json();
    expect(view.inUse.version).toBe(2);
    expect(view.history[0]).toMatchObject({ version: 3, state: "failed", error: { code: "profile.setup", message } });
  });

  it("checks the dataset again for a profile that recorded no candidates", async () => {
    await readyProfile(null);
    const view = (await call("GET", `${base()}/templates`, a.ownerCookie)).json();
    expect(view).toMatchObject({ inUse: { version: 4 }, candidatesKnown: false });
    expect(view.roles[0]).toMatchObject({ chosen: "front-new", candidates: [] });
    expect(
      (await change("POST", `${base()}/templates`, a.ownerCookie, { role: "front", page: "front-new" })).statusCode,
    ).toBe(400);
    const res = await change("POST", `${base()}/templates`, a.ownerCookie, {});
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ version: 5, templateChoice: {} });
    const payload = await jobPayload(res.json().id);
    expect(payload).not.toHaveProperty("template_role");
    expect(payload).toHaveProperty("base_profile_id");
  });

  it("is walled: another organisation finds nothing of it", async () => {
    expect((await call("GET", `${base(b)}/templates`, a.ownerCookie)).statusCode).toBe(404);
    const theirs = (await call("GET", `${base(b)}/templates`, b.ownerCookie)).json();
    expect(theirs).toMatchObject({ inUse: null, history: [] });
  });
});
