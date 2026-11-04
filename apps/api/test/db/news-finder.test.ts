// The news finder on the API's side (docs/product/13-news-finder.md, L2.7; migration 2026_12_01_0001), on a migrated
// clone and the run's bucket: who may see and change what, the collections and drafts asked of the queue, the inbox
// applying the queue's events (once, however often they come), the story a draft makes, a found photo chosen (through a
// fake download: no test reaches the network) and the rights tick, and the AI spend. The queue's tasks are not run
// here (apps/engine-queue's tests run them): their events are written as the queue writes them. Every feed, item,
// photo and name is fictional.
import { createHash, randomUUID } from "node:crypto";
import { FetchRefused } from "@pageinator/engine-queue";
import type { FastifyBaseLogger } from "fastify";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainInbox, sweep } from "../../src/modules/media/engine-inbox.ts";
import { collectDue } from "../../src/modules/news/schedule.ts";
import { s3Store } from "../../src/storage/s3.ts";
import { jpeg } from "../support/pictures.ts";
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
let sub: Person;
let reporter: Person;
let leaver: Person;
const quiet = { error: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;
const store = () => s3Store(it_.config.storage!);
/** What the fake download was asked for, and what it answers. */
const fetched: string[] = [];
let answer: () => Promise<{ contentType: string; body: Buffer }> = async () => ({
  contentType: "image/jpeg",
  body: Buffer.from(jpeg(2400, 1600, 0, 1)),
});

beforeAll(async () => {
  it_ = await identityApp(db, {}, undefined, undefined, async (url) => {
    fetched.push(url);
    return answer();
  });
  su = await db.connect("postgres");
  engine = await db.connect("engine");
  a = await n.organisation();
  b = await n.organisation();
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  editor = await n.member(a, as("editor"), "member", "editor");
  sub = await n.member(a, as("sub_editor"), "member", "sub");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
  leaver = await n.member(a, as("sub_editor"), "member", "leaver");
}, 60_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const news = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/news`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

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
const drain = () => drainInbox(it_.database, quiet, store());
const jobs = async (key: string) =>
  (
    await su.query<{ payload: Record<string, unknown> }>("select payload from queue._private_jobs where key = $1", [
      key,
    ])
  ).rows;

async function source(name: string, language: "mr" | "en", cookie = chief.cookie, org = a) {
  const res = await call("POST", `${news(org)}/sources`, cookie, {
    name,
    url: `https://news.example.test/${encodeURIComponent(name)}.xml`,
    language,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const usage = (cost: number) => ({
  purpose: "group",
  model: "claude-opus-5-5",
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost_inr: cost,
});
const item = (sourceId: string, link: string, title: string) => ({
  source_id: sourceId,
  title,
  summary: `${title} (fictional summary).`,
  link,
  published_at: new Date().toISOString(),
  hash: sha(link),
});

describe("the sources and settings", () => {
  it("are the Chief Editor's to change, the desk's to read, and nobody else's", async () => {
    const id = await source("Kalpaniknagar Times", "en");
    // an Editor and a Sub-editor read them; an Editor may not change them; a Reporter may not even read them
    expect((await call("GET", `${news()}/sources`, editor.cookie)).json().items).toContainEqual(
      expect.objectContaining({ id, name: "Kalpaniknagar Times", enabled: true, lastFetchAt: null, lastError: null }),
    );
    expect((await call("GET", `${news()}/sources`, sub.cookie)).statusCode).toBe(200);
    expect((await call("GET", `${news()}/sources`, reporter.cookie)).statusCode).toBe(403);
    const byEditor = await call("POST", `${news()}/sources`, editor.cookie, {
      name: "x",
      url: "https://news.example.test/x.xml",
      language: "en",
    });
    expect(byEditor.statusCode).toBe(403);
    expect((await call("PATCH", `${news()}/sources/${id}`, editor.cookie, { enabled: false })).statusCode).toBe(403);
    expect((await call("DELETE", `${news()}/sources/${id}`, editor.cookie)).statusCode).toBe(403);
    // only feeds over http(s)
    const bad = await call("POST", `${news()}/sources`, chief.cookie, {
      name: "x",
      url: "file:///etc",
      language: "en",
    });
    expect(bad.statusCode).toBe(400);

    const patched = await call("PATCH", `${news()}/sources/${id}`, chief.cookie, { name: "Kalpaniknagar Times 2" });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ id, name: "Kalpaniknagar Times 2" });
    const gone = await source("Short-lived", "mr");
    expect((await call("DELETE", `${news()}/sources/${gone}`, chief.cookie)).statusCode).toBe(204);
    expect((await call("DELETE", `${news()}/sources/${gone}`, chief.cookie)).statusCode).toBe(404);

    // another organisation sees none of it, and cannot change it
    expect((await call("GET", `${news(b)}/sources`, b.ownerCookie)).json().items).toEqual([]);
    expect((await call("GET", `${news()}/sources`, b.ownerCookie)).statusCode).toBe(404);
    expect(
      (await call("PATCH", `/api/v1/orgs/${b.orgId}/pubs/${b.pubId}/news/sources/${id}`, b.ownerCookie, { name: "y" }))
        .statusCode,
    ).toBe(404);

    const audit = await su.query(
      "select action, data from app.audit_event where action like 'news.source_%' and target_id = any ($1::uuid[]) order by at",
      [[id, gone]],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "news.source_create",
      "news.source_edit",
      "news.source_create",
      "news.source_delete",
    ]);
    expect(audit.rows[1].data).toEqual({ fields: ["name"] });
  });

  it("say what the AI part costs, and are changed by the Chief Editor only", async () => {
    const before = await call("GET", `${news()}/settings`, editor.cookie);
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json()).toMatchObject({
      houseStyle: "",
      collectEveryHours: 3,
      ai: { state: null, spentTodayInr: 0, spentMonthInr: 0, capDayInr: 300 },
      mayManage: false,
    });
    expect((await call("GET", `${news()}/settings`, chief.cookie)).json().mayManage).toBe(true);
    expect((await call("PATCH", `${news()}/settings`, editor.cookie, { collectEveryHours: 6 })).statusCode).toBe(403);
    const changed = await call("PATCH", `${news()}/settings`, chief.cookie, {
      houseStyle: "Short sentences. Fictional style.",
      collectEveryHours: 6,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ houseStyle: "Short sentences. Fictional style.", collectEveryHours: 6 });
    expect((await call("PATCH", `${news()}/settings`, chief.cookie, {})).statusCode).toBe(400);
    const audit = await su.query("select data from app.audit_event where action = 'news.settings_edit'");
    expect(audit.rows).toEqual([{ data: { fields: ["houseStyle", "collectEveryHours"] } }]);
    expect((await call("GET", `${news()}/settings`, reporter.cookie)).statusCode).toBe(403);
  });
});

describe("a collection", () => {
  it("is asked for on the schedule once it is due, and at once by the Chief Editor", async () => {
    await su.query("delete from queue._private_jobs where key = $1", [`news-collect:${a.pubId}`]);
    await su.query("update app.news_settings set collected_at = null where publication_id = $1", [a.pubId]);
    expect(await collectDue(it_.database, 300)).toBeGreaterThanOrEqual(1);
    const [job] = await jobs(`news-collect:${a.pubId}`);
    const settings = (await su.query("select run_id from app.news_settings where publication_id = $1", [a.pubId]))
      .rows[0];
    expect(job?.payload).toMatchObject({
      org_id: a.orgId,
      pub_id: a.pubId,
      run_id: settings.run_id,
      known: [],
      topics: [],
      ai_budget_inr: 300,
    });
    expect(job?.payload["sources"]).toEqual([
      expect.objectContaining({ url: "https://news.example.test/Kalpaniknagar%20Times.xml", language: "en" }),
    ]);
    // not due again for collect_every_h hours
    await collectDue(it_.database, 300);
    expect(
      (await su.query("select run_id from app.news_settings where publication_id = $1", [a.pubId])).rows[0],
    ).toEqual(settings);
    // now, by the Chief Editor; an Editor may not; a publication with no source on has nothing to collect
    expect((await call("POST", `${news()}/collect`, editor.cookie)).statusCode).toBe(403);
    const now = await call("POST", `${news()}/collect`, chief.cookie);
    expect(now.statusCode, now.body).toBe(202);
    expect(now.json().runId).not.toBe(settings.run_id);
    expect((await call("POST", `${news(b)}/collect`, b.ownerCookie)).statusCode).toBe(400);
  });

  it("is stored once from the queue's report: items, topics, the sources' state and the AI spend", async () => {
    const mr = await source("काल्पनिक वार्ता", "mr");
    const en = (await call("GET", `${news()}/sources`, chief.cookie))
      .json()
      .items.find((s: { language: string }) => s.language === "en").id as string;
    const runId = (await su.query("select run_id from app.news_settings where publication_id = $1", [a.pubId])).rows[0]
      .run_id as string;
    const links = ["https://news.example.test/en/bridge", "https://news.example.test/mr/bridge"];
    const event = {
      kind: "news.collected",
      org_id: a.orgId,
      pub_id: a.pubId,
      run_id: runId,
      sources: [
        { id: en, ok: true, error: null },
        { id: mr, ok: false, error: "fetch.status" },
      ],
      items: [
        item(en, links[0] as string, "A fictional bridge opens"),
        item(mr, links[1] as string, "काल्पनिक पूल खुला"),
        item(en, "https://news.example.test/en/fair", "A fictional fair"),
        // a hash that is not its link's: dropped
        { ...item(en, "https://news.example.test/en/forged", "Forged"), hash: "0".repeat(64) },
      ],
      groups: [{ topic_id: null, title_mr: "काल्पनिक पूल", title_en: "A fictional bridge", importance: 4, links }],
      ai: "on",
      usage: [usage(2.5)],
    };
    const jobId = await report(event, runId);
    await report(event, runId, jobId); // the job run again after its report: one row per job id
    await drain();
    expect(await outcomeOf(jobId)).toBe("applied");
    // the same report from another job stores nothing new (but its Claude call is logged: it was made)
    const again = await report({ ...event, usage: [] }, runId);
    await drain();
    expect(await outcomeOf(again)).toBe("applied");
    expect(
      (await su.query("select count(*)::int as n from app.news_item where publication_id = $1", [a.pubId])).rows[0].n,
    ).toBe(3);

    const list = await call("GET", `${news()}/topics`, sub.cookie);
    expect(list.statusCode, list.body).toBe(200);
    const topics = list.json().items;
    expect(topics).toHaveLength(2);
    // the bridge: two sources, Claude's importance 4: a big story, first
    expect(topics[0]).toMatchObject({
      titleEn: "A fictional bridge",
      titleMr: "काल्पनिक पूल",
      importance: 4,
      itemCount: 2,
      languages: ["en", "mr"],
      big: true,
      items: [],
    });
    expect(topics[0].sources.map((s: { id: string }) => s.id).sort()).toEqual([en, mr].sort());
    // an item Claude left out of every group is a topic of its own
    expect(topics[1]).toMatchObject({ titleEn: "A fictional fair", importance: 1, big: false, languages: ["en"] });
    const marathi = (await call("GET", `${news()}/topics?language=mr`, sub.cookie)).json().items;
    expect(marathi.map((t: { id: string }) => t.id)).toEqual([topics[0].id]);
    const one = await call("GET", `${news()}/topics/${topics[0].id}`, editor.cookie);
    expect(
      one
        .json()
        .items.map((i: { link: string }) => i.link)
        .sort(),
    ).toEqual([...links].sort());

    expect((await call("GET", `${news()}/topics`, reporter.cookie)).statusCode).toBe(403);
    expect((await call("GET", `${news()}/topics/${topics[0].id}`, b.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", `${news(b)}/topics`, b.ownerCookie)).json().items).toEqual([]);
    expect(
      (await call("GET", `/api/v1/orgs/${b.orgId}/pubs/${b.pubId}/news/topics/${topics[0].id}`, b.ownerCookie))
        .statusCode,
    ).toBe(404);

    const sources = (await call("GET", `${news()}/sources`, chief.cookie)).json().items;
    expect(sources.find((s: { id: string }) => s.id === mr)).toMatchObject({ lastError: "fetch.status" });
    expect(sources.find((s: { id: string }) => s.id === en).lastFetchAt).not.toBeNull();
    const settings = (await call("GET", `${news()}/settings`, chief.cookie)).json();
    expect(settings.ai).toMatchObject({ state: "on", spentTodayInr: 2.5, spentMonthInr: 2.5 });
    const audit = await su.query("select actor_kind, data from app.audit_event where action = 'news.collect'");
    expect(audit.rows).toContainEqual({ actor_kind: "system", data: { job: jobId, items: 3, topics: 2, ai: "on" } });

    // the next collection is sent what is stored, and the AI budget left today
    await call("POST", `${news()}/collect`, chief.cookie);
    const [next] = await jobs(`news-collect:${a.pubId}`);
    expect((next?.payload["known"] as string[]).sort()).toEqual(
      [links[0], links[1], "https://news.example.test/en/fair"].map((l) => sha(l as string)).sort(),
    );
    expect(next?.payload["topics"]).toHaveLength(2);
    expect(next?.payload["ai_budget_inr"]).toBe(297.5);
  });

  it("refuses another organisation's report naming this publication", async () => {
    const runId = randomUUID().replace(/^(.{14})./, "$17");
    const theirs = await report(
      {
        kind: "news.collected",
        org_id: b.orgId,
        pub_id: a.pubId,
        run_id: runId,
        sources: [],
        items: [],
        groups: [],
        ai: "off",
        usage: [],
      },
      runId,
    );
    await drain();
    expect(await outcomeOf(theirs)).toBe("refused");
  });
});

/** The bridge topic's id. */
const bridge = async () =>
  (
    await su.query("select id from app.news_topic where title_en = 'A fictional bridge' and publication_id = $1", [
      a.pubId,
    ])
  ).rows[0].id as string;

async function picked(cookie = sub.cookie, findPhoto = true) {
  const res = await change("POST", `${news()}/topics/${await bridge()}/pick`, cookie, {
    language: "mr",
    length: "standard",
    findPhoto,
  });
  expect(res.statusCode, res.body).toBe(202);
  return res.json().draftId as string;
}

const PHOTOS = [
  {
    url: "https://upload.example.test/bridge.jpg",
    thumbUrl: "https://upload.example.test/bridge-thumb.jpg",
    pageUrl: "https://commons.example.test/File:Bridge.jpg",
    widthPx: 2400,
    heightPx: 1600,
    title: "A fictional bridge at dawn",
    creator: "A. Photographer",
    site: "Wikimedia Commons",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    origin: "commons",
    label: "safe",
    credit: "A. Photographer / Wikimedia Commons, CC BY-SA 4.0",
  },
  {
    url: "https://news.example.test/lead.jpg",
    thumbUrl: "https://news.example.test/lead-thumb.jpg",
    pageUrl: "https://news.example.test/en/bridge",
    widthPx: 2400,
    heightPx: 1600,
    title: "The bridge (fictional)",
    creator: "",
    site: "news.example.test",
    licence: "unknown",
    licenceUrl: null,
    origin: "source",
    label: "needs_permission",
    credit: "news.example.test",
  },
  {
    // a source's picture an event wrongly calls safe: the API decides its label again
    url: "https://news.example.test/other.jpg",
    thumbUrl: "https://news.example.test/other-thumb.jpg",
    pageUrl: "https://news.example.test/en/other",
    widthPx: 2400,
    heightPx: 1600,
    title: "Another picture (fictional)",
    creator: "",
    site: "news.example.test",
    licence: "CC0",
    licenceUrl: null,
    origin: "source",
    label: "safe",
    credit: "news.example.test",
  },
];

function drafted(draftId: string) {
  return {
    kind: "news.drafted",
    org_id: a.orgId,
    pub_id: a.pubId,
    draft_id: draftId,
    headline: "काल्पनिक पूल खुला",
    byline: "Pageinator desk",
    body: "पहिला परिच्छेद.\n\nदुसरा परिच्छेद.",
    sources: [{ title: "A fictional bridge opens", url: "https://news.example.test/en/bridge", site: "Times" }],
    flagged: ["एक वाक्य."],
    photos: PHOTOS,
    usage: [{ ...usage(10), purpose: "draft" }],
  };
}

describe("a pick", () => {
  it("asks the queue for a draft once, with the topic's articles and the house style", async () => {
    const key = randomUUID();
    const url = `${news()}/topics/${await bridge()}/pick`;
    const body = { language: "mr", length: "short", findPhoto: true };
    const first = await change("POST", url, sub.cookie, body, key);
    expect(first.statusCode, first.body).toBe(202);
    const replay = await change("POST", url, sub.cookie, body, key);
    expect(replay.json()).toEqual(first.json());
    const draftId = first.json().draftId as string;
    const [job] = await jobs(`news-draft:${draftId}`);
    expect(job?.payload).toMatchObject({
      org_id: a.orgId,
      pub_id: a.pubId,
      draft_id: draftId,
      language: "mr",
      length: "short",
      find_photo: true,
      title: "काल्पनिक पूल",
      house_style: "Short sentences. Fictional style.",
    });
    expect((job?.payload["articles"] as { url: string }[]).map((x) => x.url).sort()).toEqual([
      "https://news.example.test/en/bridge",
      "https://news.example.test/mr/bridge",
    ]);
    const got = await call("GET", `${news()}/drafts/${draftId}`, sub.cookie);
    expect(got.statusCode, got.body).toBe(200);
    expect(got.json()).toMatchObject({ id: draftId, state: "queued", storyId: null, photos: [], error: null });
    expect((await call("GET", `${news()}/drafts/${draftId}`, editor.cookie)).statusCode).toBe(200);
    // a Reporter may not pick, nor read another's draft; another organisation finds nothing
    expect(
      (await change("POST", url, reporter.cookie, { language: "en", length: "short", findPhoto: false })).statusCode,
    ).toBe(403);
    expect((await call("GET", `${news()}/drafts/${draftId}`, reporter.cookie)).statusCode).toBe(404);
    expect((await call("GET", `${news()}/drafts/${draftId}`, b.ownerCookie)).statusCode).toBe(404);
    const audit = await su.query("select data from app.audit_event where action = 'news.pick' and target_id = $1", [
      draftId,
    ]);
    expect(audit.rows).toEqual([{ data: { topic: await bridge(), language: "mr", length: "short", findPhoto: true } }]);
  });

  it("makes a Draft story given to the picker, marked made with Claude until a person edits it, once", async () => {
    const draftId = await picked();
    const event = drafted(draftId);
    const jobId = await report(event, draftId);
    await drain();
    expect(await outcomeOf(jobId)).toBe("applied");
    const draft = (await call("GET", `${news()}/drafts/${draftId}`, sub.cookie)).json();
    expect(draft).toMatchObject({ state: "done", flagged: ["एक वाक्य."], photos: PHOTOS, chosenAssetId: null });
    const story = await call("GET", `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories/${draft.storyId}`, sub.cookie);
    expect(story.statusCode, story.body).toBe(200);
    expect(story.json()).toMatchObject({
      status: "draft",
      headline: "काल्पनिक पूल खुला",
      byline: "Pageinator desk",
      language: "mr",
      reporter: { id: sub.id },
      assignee: { id: sub.id },
      madeWithClaude: true,
      newsSources: event.sources,
    });
    const { rows } = await su.query("select origin from app.story where id = $1", [draft.storyId]);
    expect(rows[0].origin).toBe("news");
    // a repeat makes nothing more
    const again = await report(event, draftId);
    await drain();
    expect(await outcomeOf(again)).toBe("ignored");
    expect((await su.query("select count(*)::int as n from app.story where origin = 'news'")).rows[0].n).toBe(1);
    // a person's edit of the text: no longer as Claude drafted it
    const edited = await call("PATCH", `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories/${draft.storyId}`, sub.cookie, {
      baseRevision: story.json().revision,
      body: "संपादकाने लिहिलेला परिच्छेद.",
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ madeWithClaude: false, newsSources: event.sources });
    const audit = await su.query(
      "select data from app.audit_event where action = 'news.draft_done' and target_id = $1",
      [draftId],
    );
    expect(audit.rows).toEqual([{ data: { job: jobId, story: draft.storyId, flagged: 1, photos: 3 } }]);
    const settings = (await call("GET", `${news()}/settings`, chief.cookie)).json();
    expect(settings.ai.spentTodayInr).toBe(12.5);
  });

  it("fails with the queue's code, a lost job's, and for a picker who may no longer make stories", async () => {
    const one = await picked();
    await report(
      {
        kind: "news.draft_failed",
        org_id: a.orgId,
        pub_id: a.pubId,
        draft_id: one,
        code: "ai.refused",
        message: "Claude declined to write this one.",
        usage: [],
      },
      one,
    );
    const two = await picked();
    await report(
      {
        kind: "job.failed",
        org_id: a.orgId,
        pub_id: a.pubId,
        job_kind: "news.draft",
        target_id: two,
        code: "worker.lost",
        message: "the job was lost",
      },
      two,
    );
    const three = await picked(leaver.cookie);
    await su.query("update app.publication_grant set roles = '{viewer}' where user_id = $1 and publication_id = $2", [
      leaver.id,
      a.pubId,
    ]);
    await report(drafted(three), three);
    await drain();
    const state = async (id: string) =>
      (await su.query("select state, problem, story_id from app.news_draft_job where id = $1", [id])).rows[0];
    expect(await state(one)).toEqual({ state: "failed", problem: "ai.refused", story_id: null });
    expect(await state(two)).toEqual({ state: "failed", problem: "worker.lost", story_id: null });
    expect(await state(three)).toEqual({ state: "failed", problem: "news.not_allowed", story_id: null });
    const got = (await call("GET", `${news()}/drafts/${one}`, sub.cookie)).json();
    expect(got.error).toEqual({ code: "ai.refused", message: "Claude declined to write this one." });
  });

  it("is settled as lost by the sweep when its job is gone", async () => {
    const draftId = await picked();
    await su.query("delete from queue._private_jobs where key = $1", [`news-draft:${draftId}`]);
    await su.query("update app.news_draft_job set updated_at = now() - interval '1 hour' where id = $1", [draftId]);
    expect(await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 })).toBeGreaterThanOrEqual(1);
    await drain();
    expect((await call("GET", `${news()}/drafts/${draftId}`, sub.cookie)).json()).toMatchObject({
      state: "failed",
      error: { code: "worker.lost" },
    });
  });
});

describe("a found photo", () => {
  let draftId: string;
  let storyId: string;
  beforeAll(async () => {
    draftId = await picked();
    await report(drafted(draftId), draftId);
    await drain();
    storyId = (await call("GET", `${news()}/drafts/${draftId}`, sub.cookie)).json().storyId;
  });
  const photo = (body: unknown, cookie = sub.cookie) => call("POST", `${news()}/drafts/${draftId}/photo`, cookie, body);

  it("that needs permission is taken only with the rights tick, then stored, prepared and made the story's photo", async () => {
    fetched.length = 0;
    const refused = await photo({ index: 1 });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("rights_needed");
    expect(fetched).toEqual([]); // nothing downloaded for a refusal
    expect((await photo({ index: 2 })).json().error.code).toBe("rights_needed");
    expect((await photo({ index: 7, rightsConfirmed: true })).statusCode).toBe(400);
    expect((await photo({ index: 1, rightsConfirmed: true }, reporter.cookie)).statusCode).toBe(403);
    // another organisation's people, and this draft named under another organisation's publication, find nothing
    expect((await photo({ index: 0 }, b.ownerCookie)).statusCode).toBe(404);
    const elsewhere = `/api/v1/orgs/${b.orgId}/pubs/${b.pubId}/news/drafts/${draftId}/photo`;
    expect((await call("POST", elsewhere, b.ownerCookie, { index: 0 })).statusCode).toBe(404);

    answer = async () => ({ contentType: "image/jpeg", body: Buffer.from(jpeg(2400, 1600, 0, 2)) });
    const chosen = await photo({ index: 1, rightsConfirmed: true, caption: "The fictional bridge." });
    expect(chosen.statusCode, chosen.body).toBe(201);
    expect(fetched).toEqual(["https://news.example.test/lead.jpg"]);
    const assetId = chosen.json().assetId as string;
    const asset = (
      await su.query(
        `select caption, credit, photographer, licence_name, licence_url, source_url, licence_label, rights_confirmed_by,
           rights_confirmed_at is not null as ticked, uploaded_by, sha256, original_key, version_id, mime, width_px
         from app.asset where id = $1`,
        [assetId],
      )
    ).rows[0];
    expect(asset).toMatchObject({
      caption: "The fictional bridge.",
      credit: "news.example.test",
      photographer: "",
      licence_name: "unknown",
      licence_url: null,
      source_url: "https://news.example.test/en/bridge",
      licence_label: "needs_permission",
      rights_confirmed_by: sub.id,
      ticked: true,
      uploaded_by: sub.id,
      sha256: createHash("sha256")
        .update(jpeg(2400, 1600, 0, 2))
        .digest("hex"),
      mime: "image/jpeg",
      width_px: 2400,
    });
    // the original as the engine will read it, and its print versions asked for as an upload's are
    const chunks: Uint8Array[] = [];
    for await (const c of await store().read(asset.original_key, asset.version_id)) chunks.push(c);
    expect(Buffer.concat(chunks).equals(Buffer.from(jpeg(2400, 1600, 0, 2)))).toBe(true);
    const [ingest] = await jobs(`asset:${assetId}`);
    expect(ingest?.payload).toMatchObject({ asset_id: assetId, version_id: asset.version_id, sha256: asset.sha256 });
    const story = (await call("GET", `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories/${storyId}`, sub.cookie)).json();
    expect(story.photo).toMatchObject({ assetId, caption: "The fictional bridge.", credit: "news.example.test" });
    expect((await call("GET", `${news()}/drafts/${draftId}`, sub.cookie)).json().chosenAssetId).toBe(assetId);
    // the Media drawer shows where it came from, its licence, its label and the tick
    const item = (await call("GET", `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/assets/${assetId}`, sub.cookie)).json();
    expect(item.licence).toMatchObject({
      name: "unknown",
      url: null,
      sourceUrl: "https://news.example.test/en/bridge",
      label: "needs_permission",
      rightsConfirmed: { by: { id: sub.id } },
    });
    const audit = await su.query(
      "select action, data from app.audit_event where action in ('news.photo_choose', 'asset.rights_confirm') order by at",
    );
    expect(audit.rows).toEqual([
      { action: "asset.rights_confirm", data: { label: "needs_permission", draft: draftId } },
      { action: "news.photo_choose", data: { asset: assetId, index: 1, label: "needs_permission", origin: "source" } },
    ]);
  });

  it("that is safe needs no tick; one that cannot be downloaded or is no picture is refused", async () => {
    answer = async () => ({ contentType: "image/jpeg", body: Buffer.from(jpeg(2400, 1600, 0, 3)) });
    const safe = await photo({ index: 0 });
    expect(safe.statusCode, safe.body).toBe(201);
    const row = (
      await su.query("select licence_label, credit, rights_confirmed_at from app.asset where id = $1", [
        safe.json().assetId,
      ])
    ).rows[0];
    expect(row).toEqual({
      licence_label: "safe",
      credit: "A. Photographer / Wikimedia Commons, CC BY-SA 4.0",
      rights_confirmed_at: null,
    });
    answer = async () => {
      throw new FetchRefused("fetch.private_address", "the address is not public");
    };
    const blocked = await photo({ index: 0 });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.details[0].message).toContain("fetch.private_address");
    answer = async () => ({ contentType: "image/jpeg", body: Buffer.from("<html>not a picture</html>") });
    expect((await photo({ index: 0 })).statusCode).toBe(422);
  });

  it("that needs permission is never attached to a story unticked; the tick on the asset lets it", async () => {
    const { rows } = await su.query(
      `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, uploaded_by,
         licence_name, source_url, licence_label)
       values ($1, $2, 'p-00000000aa', $3, 1000, 'image/jpeg', 2400, 1600, $4, 'unknown',
         'https://news.example.test/x', 'needs_permission') returning id`,
      [a.orgId, a.pubId, "5".repeat(64), chief.id],
    );
    const assetId = rows[0].id as string;
    const storyUrl = `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories/${storyId}`;
    const attach = async () =>
      call("PUT", `${storyUrl}/photo`, chief.cookie, {
        baseRevision: (await call("GET", storyUrl, chief.cookie)).json().revision,
        assetId,
      });
    const refused = await attach();
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("rights_needed");
    const rights = `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/assets/${assetId}/rights`;
    expect((await call("POST", rights, reporter.cookie)).statusCode).toBe(403);
    expect((await call("POST", rights, b.ownerCookie)).statusCode).toBe(404);
    const ticked = await call("POST", rights, editor.cookie);
    expect(ticked.statusCode, ticked.body).toBe(200);
    expect(ticked.json().licence.rightsConfirmed.by.id).toBe(editor.id);
    // ticked once: a second tick changes nothing
    await call("POST", rights, chief.cookie);
    const audit = await su.query(
      "select actor_id from app.audit_event where action = 'asset.rights_confirm' and target_id = $1",
      [assetId],
    );
    expect(audit.rows).toEqual([{ actor_id: editor.id }]);
    expect((await attach()).statusCode).toBe(200);
  });
});

describe("the suggested sources", () => {
  it("are added by the Chief Editor once each, on, beside the paper's own", async () => {
    const url = `${news(b)}/sources/suggested`;
    expect((await call("POST", `${news()}/sources/suggested`, editor.cookie)).statusCode).toBe(403);
    const first = await call("POST", url, b.ownerCookie);
    expect(first.statusCode, first.body).toBe(200);
    const items = first.json().items as { name: string; url: string; language: string; enabled: boolean }[];
    expect(items.map((s) => [s.name, s.language, s.enabled]).sort()).toEqual(
      [
        ["ABP Majha", "mr", true],
        ["Hindustan Times", "en", true],
        ["NDTV", "en", true],
        ["Sakal", "mr", true],
        ["TV9 Marathi", "mr", true],
        ["The Hindu", "en", true],
        ["The Indian Express", "en", true],
      ].sort(),
    );
    // one deleted is added back; the others are not added twice
    const sakal = first.json().items.find((s: { name: string }) => s.name === "Sakal").id as string;
    expect((await call("DELETE", `${news(b)}/sources/${sakal}`, b.ownerCookie)).statusCode).toBe(204);
    const again = await call("POST", url, b.ownerCookie);
    expect(again.json().items).toHaveLength(7);
    const audit = await su.query(
      "select count(*)::int as n from app.audit_event where action = 'news.source_create' and publication_id = $1",
      [b.pubId],
    );
    expect(audit.rows[0].n).toBe(8);
  });
});

describe("with the AI part off (PGN_NEWS_AI)", () => {
  let off: IdentityApp;
  let on: IdentityApp;
  beforeAll(async () => {
    on = it_;
    off = await identityApp(db, { PGN_NEWS_AI: "off" });
    it_ = off;
  });
  afterAll(async () => {
    it_ = on;
    await off.close();
  });

  it("says so before any collection, and refuses a pick without queueing a draft", async () => {
    expect((await call("GET", `${news(b)}/settings`, b.ownerCookie)).json().ai.state).toBe("off");
    const drafts = async () =>
      (await su.query("select count(*)::int as n from app.news_draft_job where publication_id = $1", [a.pubId])).rows[0]
        .n;
    const before = await drafts();
    const res = await change("POST", `${news()}/topics/${await bridge()}/pick`, sub.cookie, {
      language: "en",
      length: "short",
      findPhoto: false,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error.code).toBe("ai_off");
    expect(await drafts()).toBe(before);
  });

  it("stores a collection's items as headlines, newest first, and makes no topic of each", async () => {
    const sources = (await call("GET", `${news(b)}/sources`, b.ownerCookie)).json().items as {
      id: string;
      name: string;
    }[];
    const named = (name: string) => sources.find((s) => s.name === name)!.id;
    const [mr, en] = [named("Sakal"), named("Hindustan Times")];
    const runId = randomUUID().replace(/^(.{14})./, "$17");
    const older = {
      ...item(en, "https://news.example.test/b/older", "An older fictional report"),
      published_at: "2026-11-04T06:00:00Z",
    };
    const newer = {
      ...item(mr, "https://news.example.test/b/newer", "नवी काल्पनिक बातमी"),
      published_at: "2026-11-04T09:00:00Z",
    };
    const jobId = await report(
      {
        kind: "news.collected",
        org_id: b.orgId,
        pub_id: b.pubId,
        run_id: runId,
        sources: [],
        items: [older, newer],
        groups: [],
        ai: "off",
        usage: [],
      },
      runId,
    );
    await drain();
    expect(await outcomeOf(jobId)).toBe("applied");
    expect((await call("GET", `${news(b)}/topics`, b.ownerCookie)).json().items).toEqual([]);
    const all = await call("GET", `${news(b)}/headlines`, b.ownerCookie);
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json().items.map((i: { title: string; sourceName: string }) => [i.title, i.sourceName])).toEqual([
      ["नवी काल्पनिक बातमी", "Sakal"],
      ["An older fictional report", "Hindustan Times"],
    ]);
    const english = (await call("GET", `${news(b)}/headlines?language=en`, b.ownerCookie)).json().items;
    expect(english.map((i: { link: string }) => i.link)).toEqual(["https://news.example.test/b/older"]);
    expect((await call("GET", `${news(b)}/headlines`, a.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", `${news()}/headlines`, reporter.cookie)).statusCode).toBe(403);
  });
});
