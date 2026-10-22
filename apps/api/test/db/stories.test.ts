// The stories API (src/modules/stories; docs/product/10-l2-newsroom-plan.md §5.1, §5.2, §5.4) on a migrated clone,
// through the API's own routes: create, read, list, update with revisions and baseRevision, the state machine,
// assignment, paste in the Desk's format, Idempotency-Key, every role against every endpoint (07 §12), and the
// endpoint tenancy generator (test (c) of plan §4.8). Every person, organisation and story is fictional.
import { randomUUID } from "node:crypto";
import { bodyWords, pasteArticles } from "@pageinator/desk-text";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;

type Desk = {
  a: Org;
  p2: string;
  b: Org;
  admin: Person;
  chief: Person;
  editor: Person;
  sub: Person;
  reporter: Person;
  reporter2: Person;
  designer: Person;
  photo: Person;
  ads: Person;
  prepress: Person;
  viewer: Person;
  elsewhere: Person; // a reporter of the second publication only
};
let d: Desk;

beforeAll(async () => {
  it_ = await identityApp(db, { PGN_LOG_LEVEL: process.env.STORIES_LOG ?? "silent" });
  su = await db.connect("postgres");
  const a = await n.organisation();
  const p2 = await n.addPublication(a, "Kalpaniknagar Express");
  const on = (role: string, pub = a.pubId) => [{ publicationId: pub, roles: [role], grants: [] }];
  d = {
    a,
    p2,
    b: await n.organisation(),
    admin: await n.member(a, [], "admin", "admin"),
    chief: await n.member(a, on("chief_editor"), "member", "chief"),
    editor: await n.member(a, on("editor"), "member", "editor"),
    sub: await n.member(a, on("sub_editor"), "member", "sub"),
    reporter: await n.member(a, on("reporter"), "member", "reporter"),
    reporter2: await n.member(a, on("reporter"), "member", "reporter2"),
    designer: await n.member(a, on("page_designer"), "member", "designer"),
    photo: await n.member(a, on("photo_editor"), "member", "photo"),
    ads: await n.member(a, on("advertising"), "member", "ads"),
    prepress: await n.member(a, on("prepress"), "member", "prepress"),
    viewer: await n.member(a, on("viewer"), "member", "viewer"),
    elsewhere: await n.member(a, on("reporter", p2), "member", "elsewhere"),
  };
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const stories = (org: Org, pub = org.pubId) => `/api/v1/orgs/${org.orgId}/pubs/${pub}/stories`;

async function draft(cookie: string, extra: Record<string, unknown> = {}, org: Org = d.a, pub = org.pubId) {
  const res = await change("POST", stories(org, pub), cookie, {
    headline: "Monsoon reaches Kalpaniknagar",
    body: "First paragraph.\n\nSecond paragraph.",
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

/** The story's version now (the base of the next change). */
const versionOf = async (id: string) => (await call("GET", `${stories(d.a)}/${id}`, d.chief.cookie)).json().revision;

/** Gives the story to someone, on the story's current version. */
const assign = async (id: string, cookie: string, body: Record<string, unknown>) =>
  call("POST", `${stories(d.a)}/${id}/assignee`, cookie, { baseRevision: await versionOf(id), ...body });

const move = (story: { id: string; revision: number }, cookie: string, to: string, comment?: string) =>
  change("POST", `${stories(d.a)}/${story.id}/transitions`, cookie, {
    to,
    baseRevision: story.revision,
    ...(comment ? { comment } : {}),
  });

describe("creating and reading stories", () => {
  it("makes a Draft cleaned as the Desk cleans it, in the publication's language, with its first revision", async () => {
    const story = await draft(d.reporter.cookie, {
      headline: "  Monsoon\u0007 reaches   ",
      body: "First line.   \r\nSecond line.\r\n\r\n## A subheading\n\nMore.\u0000",
      byline: "Reporter (fictional)",
    });
    expect(story).toMatchObject({
      status: "draft",
      revision: 1,
      headline: "Monsoon reaches",
      body: "First line.\nSecond line.\n\n## A subheading\n\nMore.",
      bodyFormat: "desk-text/1",
      language: "mr",
      priority: 3,
      edition: null,
      photo: null,
      reporter: { id: d.reporter.id },
      updatedBy: { id: d.reporter.id },
      can: { edit: true, transitions: ["filed"], assign: false },
    });
    expect(story.words).toBe(bodyWords(story.body));
    const { rows } = await su.query("select desk_key, origin, current_rev from app.story where id = $1", [story.id]);
    expect(rows[0]).toMatchObject({ origin: "typed", current_rev: 1 });
    expect(rows[0].desk_key).toMatch(/^a-[0-9a-f]{10}$/);
    const read = await call("GET", `${stories(d.a)}/${story.id}`, d.reporter.cookie);
    expect(read.json()).toEqual(story);
  });

  it("refuses a missing headline, a language the publication lacks, and placement from a reporter", async () => {
    expect((await change("POST", stories(d.a), d.reporter.cookie, { headline: "   " })).statusCode).toBe(400);
    const fr = await change("POST", stories(d.a), d.reporter.cookie, { headline: "Bonjour", language: "fr" });
    expect(fr.statusCode).toBe(400);
    expect(fr.json().error.details).toEqual([
      { field: "body.language", message: "is not a language of this publication" },
    ]);
    const placed = await change("POST", stories(d.a), d.reporter.cookie, {
      headline: "Front page please",
      priority: 1,
    });
    expect(placed.statusCode).toBe(403);
    const desk = await change("POST", stories(d.a), d.editor.cookie, {
      headline: "Lead story",
      priority: 1,
      language: "en",
    });
    expect(desk.json()).toMatchObject({ priority: 1, language: "en" });
  });

  it("needs an Idempotency-Key to create", async () => {
    const res = await call("POST", stories(d.a), d.reporter.cookie, { headline: "No key" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].field).toBe("headers.idempotency-key");
  });

  it("lists a reporter's own stories only, the desk's all, with filters and a cursor", async () => {
    const mine = await draft(d.reporter2.cookie, { headline: "Reporter two's own story" });
    await draft(d.reporter.cookie, { headline: "Someone else's story" });
    const own = await call("GET", stories(d.a), d.reporter2.cookie);
    expect(own.json().items.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    const desk = await call("GET", `${stories(d.a)}?reporter=${d.reporter2.id}`, d.editor.cookie);
    expect(desk.json().items.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    const searched = await call("GET", `${stories(d.a)}?q=${encodeURIComponent("two's own")}`, d.chief.cookie);
    expect(searched.json().items.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    const first = (await call("GET", `${stories(d.a)}?limit=2`, d.chief.cookie)).json();
    expect(first.items).toHaveLength(2);
    const second = (await call("GET", `${stories(d.a)}?limit=2&cursor=${first.nextCursor}`, d.chief.cookie)).json();
    expect(second.items.map((s: { id: string }) => s.id)).not.toContain(first.items[0].id);
    expect((await call("GET", `${stories(d.a)}?cursor=not-ours`, d.chief.cookie)).statusCode).toBe(400);
    expect((await call("GET", stories(d.a), d.ads.cookie)).json().items).toEqual([]);
    expect((await call("GET", `${stories(d.a)}/${mine.id}`, d.reporter.cookie)).statusCode).toBe(404);
  });
});

describe("editing", () => {
  it("saves each change as the next revision, and answers 409 story_changed, with the story, to an older base", async () => {
    const story = await draft(d.reporter.cookie);
    const one = await call("PATCH", `${stories(d.a)}/${story.id}`, d.reporter.cookie, {
      baseRevision: 1,
      body: "Rewritten.",
    });
    expect(one.json()).toMatchObject({ revision: 2, body: "Rewritten.", headline: story.headline });
    const stale = await call("PATCH", `${stories(d.a)}/${story.id}`, d.editor.cookie, {
      baseRevision: 1,
      body: "Mine.",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "story_changed", current: { revision: 2, body: "Rewritten." } });
    const revs = await call("GET", `${stories(d.a)}/${story.id}/revisions`, d.reporter.cookie);
    expect(revs.json().items.map((r: { rev: number }) => r.rev)).toEqual([2, 1]);
    const first = await call("GET", `${stories(d.a)}/${story.id}/revisions/1`, d.reporter.cookie);
    expect(first.json()).toMatchObject({ rev: 1, body: story.body });
    expect(first.json().closedAt).not.toBeNull();
    expect((await call("GET", `${stories(d.a)}/${story.id}/revisions/9`, d.reporter.cookie)).statusCode).toBe(404);
    // the closed revision is the database's: nobody may change it
    await expect(
      su.query("update app.story_revision set body = 'x' where story_id = $1 and rev = 1", [story.id]),
    ).rejects.toThrow("is closed");
  });

  it("lets the desk's first edit pick a filed story up, and keeps the reporter out once it is Ready", async () => {
    const story = await draft(d.reporter.cookie);
    const filed = (await move(story, d.reporter.cookie, "filed")).json();
    expect(filed.status).toBe("filed");
    const edited = await call("PATCH", `${stories(d.a)}/${story.id}`, d.sub.cookie, {
      baseRevision: filed.revision,
      headline: "Sub's better headline",
    });
    expect(edited.json()).toMatchObject({ status: "editing", headline: "Sub's better headline" });
    const ready = (await move(edited.json(), d.editor.cookie, "ready")).json();
    expect(ready.status).toBe("ready");
    const late = await call("PATCH", `${stories(d.a)}/${story.id}`, d.reporter.cookie, {
      baseRevision: ready.revision,
      body: "Too late.",
    });
    expect(late.statusCode).toBe(403);
    expect((await call("GET", `${stories(d.a)}/${story.id}`, d.reporter.cookie)).json().can.edit).toBe(false);
  });

  it("lets no one but the desk set placement, and refuses a section or edition of another publication", async () => {
    const story = await draft(d.reporter.cookie);
    const placed = await call("PATCH", `${stories(d.a)}/${story.id}`, d.reporter.cookie, {
      baseRevision: 1,
      pagePin: 1,
    });
    expect(placed.statusCode).toBe(403);
    const { rows } = await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
       values ($1, $2, '2026-11-01', '2026-11-01', 8) returning id`,
      [d.a.orgId, d.p2],
    );
    const other = await call("PATCH", `${stories(d.a)}/${story.id}`, d.editor.cookie, {
      baseRevision: 1,
      editionId: rows[0]?.id,
    });
    expect(other.statusCode).toBe(400);
    expect(other.json().error.details[0].field).toBe("body.editionId");
  });
});

describe("the state machine (plan §5.4, proposed)", () => {
  it("runs Draft → Filed → Editing → Ready, recorded, with the text kept as it was at each step", async () => {
    let story = await draft(d.reporter.cookie);
    for (const [cookie, to] of [
      [d.reporter.cookie, "filed"],
      [d.sub.cookie, "editing"],
      [d.editor.cookie, "ready"],
    ] as const) {
      const res = await move(story, cookie, to);
      expect(res.statusCode, `${to}: ${res.body}`).toBe(200);
      story = res.json();
      expect(story.status).toBe(to);
    }
    const { rows } = await su.query(
      "select from_status, to_status from app.story_status_change where story_id = $1 order by changed_at, id",
      [story.id],
    );
    expect(rows).toEqual([
      { from_status: "draft", to_status: "filed" },
      { from_status: "filed", to_status: "editing" },
      { from_status: "editing", to_status: "ready" },
    ]);
  });

  it("sends a story back only with a comment, which is kept", async () => {
    const story = (await move(await draft(d.reporter.cookie), d.reporter.cookie, "filed")).json();
    const bare = await move(story, d.editor.cookie, "draft");
    expect(bare.statusCode).toBe(400);
    const back = await move(story, d.editor.cookie, "draft", "Please add the minister's quote.");
    expect(back.json()).toMatchObject({ status: "draft", commentCount: 1 });
    const { rows } = await su.query(
      `select c.body from app.story_status_change sc join app.comment c on c.id = sc.comment_id where sc.story_id = $1`,
      [story.id],
    );
    expect(rows).toEqual([{ body: "Please add the minister's quote." }]);
  });

  it("holds and restores to where the story was; the Chief Editor and the Editor spike and restore", async () => {
    let story = (await move(await draft(d.reporter.cookie), d.reporter.cookie, "filed")).json();
    story = (await move(story, d.sub.cookie, "held")).json();
    expect(story.status).toBe("held");
    story = (await move(story, d.sub.cookie, "restore")).json();
    expect(story.status).toBe("filed");
    expect((await move(story, d.sub.cookie, "spiked")).statusCode).toBe(403);
    expect((await move(story, d.reporter.cookie, "spiked")).statusCode).toBe(403);
    story = (await move(story, d.chief.cookie, "spiked")).json();
    expect(story.status).toBe("spiked");
    expect((await move(story, d.reporter.cookie, "filed")).statusCode).toBe(409); // the author, but it is spiked
    expect(
      (await call("PATCH", `${stories(d.a)}/${story.id}`, d.editor.cookie, { baseRevision: story.revision, body: "x" }))
        .statusCode,
    ).toBe(403);
    story = (await move(story, d.editor.cookie, "restore")).json();
    expect(story.status).toBe("filed");
  });

  it("refuses a move from the wrong state (409), a role that cannot make it (403), an old base (409), Placed (400)", async () => {
    const story = await draft(d.reporter.cookie);
    const ready = await move(story, d.editor.cookie, "ready");
    expect([ready.statusCode, ready.json().error.code]).toEqual([409, "invalid_transition"]);
    const other = await move(story, d.reporter2.cookie, "filed");
    expect(other.statusCode).toBe(404); // not theirs to see
    const viewer = await move(story, d.viewer.cookie, "held");
    expect(viewer.statusCode).toBe(403);
    expect((await move({ ...story, revision: 7 }, d.reporter.cookie, "filed")).json().error.code).toBe("story_changed");
    expect((await move(story, d.editor.cookie, "placed")).statusCode).toBe(400);
  });
});

describe("assignment", () => {
  it("gives a story to someone who reaches the publication, with a due time, and takes it back", async () => {
    const story = await draft(d.editor.cookie);
    const due = "2026-11-02T10:30:00.000Z";
    const given = await assign(story.id, d.editor.cookie, { userId: d.reporter.id, dueAt: due });
    expect(given.json()).toMatchObject({ assignee: { id: d.reporter.id }, dueAt: due });
    const mine = await call("GET", `${stories(d.a)}?assignee=me`, d.reporter.cookie);
    expect(mine.json().items.map((s: { id: string }) => s.id)).toContain(story.id);
    expect(given.json().updatedBy.id).toBe(d.editor.id);
    expect((await assign(story.id, d.editor.cookie, { userId: d.elsewhere.id })).statusCode).toBe(400);
    expect((await assign(story.id, d.admin.cookie, { userId: d.admin.id })).json().updatedBy.id).toBe(d.admin.id);
    expect((await assign(story.id, d.reporter.cookie, { userId: null })).statusCode).toBe(403);
    expect(
      (await call("POST", `${stories(d.a)}/${story.id}/assignee`, d.editor.cookie, { baseRevision: 1, userId: null }))
        .statusCode,
    ).toBe(409);
    expect((await assign(story.id, d.editor.cookie, { userId: null })).json()).toMatchObject({
      assignee: null,
      dueAt: due,
    });
  });
});

describe("paste (the Desk's format)", () => {
  const text = [
    "Water cut announced",
    "Byline: Reporter (fictional)",
    "The municipal corporation said on Monday...\r\n\r\nResidents were told to store water.",
    "---",
    "Headline with no text",
    "---",
    "  ",
    "---",
    "पाणीकपात जाहीर",
    "वार्ताहर: वार्ताहर (काल्पनिक)",
    "महापालिकेने सोमवारी सांगितले.",
  ].join("\n");

  it("stores exactly what the Desk would store, and says what it skipped", async () => {
    const res = await change("POST", `${stories(d.a)}/paste`, d.reporter.cookie, { text });
    expect(res.statusCode, res.body).toBe(201);
    const expected = pasteArticles(text);
    const body = res.json();
    expect(body.skipped).toEqual(expected.skipped);
    expect(
      body.created.map((s: { headline: string; byline: string; body: string }) => [s.headline, s.byline, s.body]),
    ).toEqual(expected.created.map((a) => [a.headline, a.byline, a.body]));
    const { rows } = await su.query("select origin from app.story where id = any($1)", [
      body.created.map((s: { id: string }) => s.id),
    ]);
    expect(rows).toEqual([{ origin: "pasted" }, { origin: "pasted" }]);
    const none = await change("POST", `${stories(d.a)}/paste`, d.reporter.cookie, { text: "---\n---" });
    expect(none.statusCode).toBe(400);
    expect(none.json().error.details[0].message).toContain("No articles were found");
  });
});

describe("Idempotency-Key", () => {
  it("replays the same request's answer, and makes nothing twice", async () => {
    const key = randomUUID();
    const input = { headline: "Only once, however often it is sent" };
    const first = await change("POST", stories(d.a), d.reporter.cookie, input, key);
    const again = await change("POST", stories(d.a), d.reporter.cookie, input, key);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    const { rows } = await su.query("select count(*)::int as n from app.story_revision where headline = $1", [
      input.headline,
    ]);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("answers 422 to the same key with another request, and 409 request_in_progress while the first runs", async () => {
    const key = randomUUID();
    await change("POST", stories(d.a), d.reporter.cookie, { headline: "First body" }, key);
    const other = await change("POST", stories(d.a), d.reporter.cookie, { headline: "Another body" }, key);
    expect([other.statusCode, other.json().error.code]).toEqual([422, "idempotency_key_reused"]);
    const running = randomUUID();
    await su.query(
      `insert into app.idempotency_key (org_id, user_id, key, route, request_sha256) values ($1, $2, $3, $4, $5)`,
      [d.a.orgId, d.reporter.id, running, "POST /api/v1/orgs/:o/pubs/:p/stories", "0".repeat(64)],
    );
    const busy = await change("POST", stories(d.a), d.reporter.cookie, { headline: "x" }, running);
    expect(busy.statusCode).toBe(422); // a different request under that key
    const { rows } = await su.query("select request_sha256 from app.idempotency_key where key = $1", [key]);
    await su.query(
      "update app.idempotency_key set status = 'running', response_status = null, response = null where key = $1",
      [key],
    );
    const inProgress = await change("POST", stories(d.a), d.reporter.cookie, { headline: "First body" }, key);
    expect([inProgress.statusCode, inProgress.json().error.code]).toEqual([409, "request_in_progress"]);
    expect(rows).toHaveLength(1);
  });

  it("keeps each user's keys their own, and checks access again on a replay", async () => {
    const key = randomUUID();
    const input = { headline: "A key of the reporter's" };
    const mine = await change("POST", stories(d.a), d.reporter.cookie, input, key);
    // another person's same key and body is their own request
    const theirs = await change("POST", stories(d.a), d.editor.cookie, input, key);
    expect(theirs.json().id).not.toBe(mine.json().id);
    // the reporter loses the story (reassigned to another reporter): the replay no longer shows it
    await su.query("update app.story set reporter_id = $1 where id = $2", [d.reporter2.id, mine.json().id]);
    expect((await change("POST", stories(d.a), d.reporter.cookie, input, key)).statusCode).toBe(404);
    // and loses the publication: the route itself refuses
    const lost = await n.member(
      d.a,
      [{ publicationId: d.a.pubId, roles: ["reporter"], grants: [] }],
      "member",
      "leaver",
    );
    const k2 = randomUUID();
    expect((await change("POST", stories(d.a), lost.cookie, { headline: "Before" }, k2)).statusCode).toBe(201);
    await su.query("delete from app.publication_grant where user_id = $1", [lost.id]);
    expect((await change("POST", stories(d.a), lost.cookie, { headline: "Before" }, k2)).statusCode).toBe(404);
  });
});

describe("deleting", () => {
  it("lets the author delete a Draft and the desk any story; audited; the story is gone", async () => {
    const story = await draft(d.reporter.cookie);
    const filed = (await move(await draft(d.reporter.cookie), d.reporter.cookie, "filed")).json();
    expect((await call("DELETE", `${stories(d.a)}/${filed.id}`, d.reporter.cookie)).statusCode).toBe(403);
    expect((await call("DELETE", `${stories(d.a)}/${story.id}`, d.reporter.cookie)).statusCode).toBe(204);
    expect((await call("DELETE", `${stories(d.a)}/${filed.id}`, d.sub.cookie)).statusCode).toBe(204);
    expect((await call("GET", `${stories(d.a)}/${story.id}`, d.reporter.cookie)).statusCode).toBe(404);
    const { rows } = await su.query(
      "select count(*)::int as n from app.audit_event where action = 'story.delete' and target_id = any($1)",
      [[story.id, filed.id]],
    );
    expect(rows).toEqual([{ n: 2 }]);
  });
});

describe("every role against every endpoint and move (07 §12, plan §5.4)", () => {
  // the status each role gets on each endpoint, for a reporter's Draft (theirs: "reporter")
  type Who = keyof Omit<Desk, "a" | "p2" | "b"> | "owner";
  const ROLES: Who[] = [
    "owner",
    "admin",
    "chief",
    "editor",
    "sub",
    "reporter",
    "reporter2",
    "designer",
    "photo",
    "ads",
    "prepress",
    "viewer",
    "elsewhere",
  ];
  const desk = { owner: 200, admin: 200, chief: 200, editor: 200, sub: 200 } as const;
  const notTheirs = { designer: 403, photo: 403, ads: 403, prepress: 403, viewer: 403, default: 404 } as const;
  const EXPECT: Record<string, Partial<Record<Who, number>> & { default: number }> = {
    list: { elsewhere: 404, default: 200 },
    paste: {
      owner: 201,
      admin: 201,
      chief: 201,
      editor: 201,
      sub: 201,
      reporter: 201,
      reporter2: 201,
      elsewhere: 404,
      default: 403,
    },
    revision: { ...desk, reporter: 200, designer: 200, photo: 200, prepress: 200, viewer: 200, default: 404 },
    // only its reporter sends a draft to the desk; the desk never does (409: plan §5.4's text, minor M6)
    file: { owner: 409, admin: 409, chief: 409, editor: 409, sub: 409, reporter: 200, ...notTheirs },
    ready: { ...desk, reporter: 403, ...notTheirs },
    create: {
      owner: 201,
      admin: 201,
      chief: 201,
      editor: 201,
      sub: 201,
      reporter: 201,
      reporter2: 201,
      elsewhere: 404,
      default: 403,
    },
    read: {
      owner: 200,
      admin: 200,
      chief: 200,
      editor: 200,
      sub: 200,
      reporter: 200,
      designer: 200,
      photo: 200,
      prepress: 200,
      viewer: 200,
      default: 404,
    },
    edit: {
      owner: 200,
      admin: 200,
      chief: 200,
      editor: 200,
      sub: 200,
      reporter: 200,
      designer: 403,
      photo: 403,
      ads: 403,
      prepress: 403,
      viewer: 403,
      default: 404,
    },
    revisions: {
      owner: 200,
      admin: 200,
      chief: 200,
      editor: 200,
      sub: 200,
      reporter: 200,
      designer: 200,
      photo: 200,
      prepress: 200,
      viewer: 200,
      default: 404,
    },
    hold: {
      owner: 200,
      admin: 200,
      chief: 200,
      editor: 200,
      sub: 200,
      reporter: 403,
      designer: 403,
      photo: 403,
      ads: 403,
      prepress: 403,
      viewer: 403,
      default: 404,
    },
    assign: { owner: 200, admin: 200, chief: 200, editor: 200, sub: 200, elsewhere: 404, default: 403 },
    remove: {
      owner: 204,
      admin: 204,
      chief: 204,
      editor: 204,
      sub: 204,
      reporter: 204,
      designer: 403,
      photo: 403,
      ads: 403,
      prepress: 403,
      viewer: 403,
      default: 404,
    },
  };

  it("matches the expected table, every cell", async () => {
    const cookie = (who: Who) => (who === "owner" ? d.a.ownerCookie : d[who].cookie);
    const mismatches: string[] = [];
    for (const who of ROLES) {
      const story = await draft(d.reporter.cookie);
      const url = `${stories(d.a)}/${story.id}`;
      const answers: Record<string, number> = {
        list: (await call("GET", stories(d.a), cookie(who))).statusCode,
        create: (await change("POST", stories(d.a), cookie(who), { headline: `By ${who}` })).statusCode,
        read: (await call("GET", url, cookie(who))).statusCode,
        revisions: (await call("GET", `${url}/revisions`, cookie(who))).statusCode,
        revision: (await call("GET", `${url}/revisions/1`, cookie(who))).statusCode,
        assign: (await assign(story.id, cookie(who), { userId: d.reporter.id })).statusCode,
        paste: (await change("POST", `${stories(d.a)}/paste`, cookie(who), { text: `Pasted by ${who}\nIts text.` }))
          .statusCode,
      };
      answers.edit = (
        await call("PATCH", url, cookie(who), { baseRevision: await versionOf(story.id), body: `Edited by ${who}` })
      ).statusCode;
      // the reporter's draft sent to the desk by each role (only its reporter may), then marked ready by each
      const own = await draft(d.reporter.cookie);
      answers.file = (await move(own, cookie(who), "filed")).statusCode;
      const filed = (await move(own, d.reporter.cookie, "filed")).json();
      const toReady =
        filed.status === "filed" ? filed : (await call("GET", `${stories(d.a)}/${own.id}`, d.chief.cookie)).json();
      answers.ready = (await move(toReady, cookie(who), "ready")).statusCode;
      const now = (await call("GET", url, d.chief.cookie)).json();
      answers.hold = (await move(now, cookie(who), "held")).statusCode;
      answers.remove = (await call("DELETE", url, cookie(who))).statusCode;
      for (const [endpoint, status] of Object.entries(answers)) {
        const expected = EXPECT[endpoint]?.[who] ?? EXPECT[endpoint]?.default;
        if (status !== expected) mismatches.push(`${who} ${endpoint}: ${status}, expected ${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});

describe("tenancy (c): every stories endpoint with another tenant's ids answers 404", () => {
  it("walks the route table: another organisation, another publication, another publication's story", async () => {
    const routes = it_.app.apiRoutes.filter(
      (route) => route.url.includes("/pubs/:p/stories") && route.method !== "HEAD",
    );
    expect(routes.length).toBeGreaterThanOrEqual(10);
    const ownStory = await draft(d.reporter.cookie);
    const bStory = await draft(d.b.ownerCookie, {}, d.b);
    const p2Story = await draft(d.elsewhere.cookie, {}, d.a, d.p2);
    /** Fixture factories for every path parameter; a route with a parameter missing here fails the test. */
    const cases = [
      { label: "B's organisation and publication", o: d.b.orgId, p: d.b.pubId, s: bStory.id },
      { label: "B's publication under A", o: d.a.orgId, p: d.b.pubId, s: bStory.id },
      { label: "B's story under A's publication", o: d.a.orgId, p: d.a.pubId, s: bStory.id },
      { label: "A's other publication's story under A's publication", o: d.a.orgId, p: d.a.pubId, s: p2Story.id },
    ];
    const failures: string[] = [];
    for (const route of routes) {
      for (const c of cases) {
        const params: Record<string, string> = { o: c.o, p: c.p, s: c.s, rev: "1" };
        const url = route.url.replace(/:([a-z]+)/g, (_, name: string) => {
          if (!(name in params)) failures.push(`${route.url} has a parameter :${name} with no fixture`);
          return params[name] ?? "";
        });
        const payload =
          route.method === "PATCH"
            ? { baseRevision: 1, body: "intruder" }
            : url.endsWith("/transitions")
              ? { to: "held", baseRevision: 1 }
              : url.endsWith("/assignee")
                ? { baseRevision: 1, userId: null }
                : url.endsWith("/paste")
                  ? { text: "Headline\nBody" }
                  : route.method === "POST"
                    ? { headline: "Intruder" }
                    : undefined;
        // the Owner of A reaches all of A: only another tenant's ids stand in the way
        const res = await change(route.method as "GET", url, d.a.ownerCookie, payload);
        const isCollection = !route.url.includes(":s");
        const sameTenant = c.o === d.a.orgId && c.p === d.a.pubId;
        if (isCollection && sameTenant) continue; // A's own collection: the story id plays no part
        if (res.statusCode !== 404) failures.push(`${route.method} ${route.url} with ${c.label}: ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
    // and the stories are untouched
    const { rows } = await su.query("select current_rev, status from app.story where id = any($1)", [
      [bStory.id, p2Story.id],
    ]);
    expect(rows).toEqual([
      { current_rev: 1, status: "draft" },
      { current_rev: 1, status: "draft" },
    ]);
    void ownStory;
  }, 60_000);
});

describe("changes sent together", () => {
  it("lets one of five edits on the same base through, and answers the others 409 story_changed", async () => {
    const story = await draft(d.reporter.cookie);
    const url = `${stories(d.a)}/${story.id}`;
    const people = [d.reporter, d.editor, d.sub, d.chief, d.admin];
    const answers = await Promise.all(
      people.map((who, i) => call("PATCH", url, who.cookie, { baseRevision: 1, body: `Text number ${i}.` })),
    );
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409, 409, 409, 409]);
    const { rows } = await su.query("select count(*)::int as n from app.story_revision where story_id = $1", [
      story.id,
    ]);
    expect(rows).toEqual([{ n: 2 }]);
  });

  it("runs a create once for one key sent three times at once", async () => {
    const key = randomUUID();
    const input = { headline: `Sent three times ${key}` };
    const answers = await Promise.all([1, 2, 3].map(() => change("POST", stories(d.a), d.reporter.cookie, input, key)));
    expect(answers.filter((a) => a.statusCode === 201).length).toBeGreaterThanOrEqual(1);
    for (const a of answers) expect([201, 409]).toContain(a.statusCode);
    const { rows } = await su.query("select count(*)::int as n from app.story_revision where headline = $1", [
      input.headline,
    ]);
    expect(rows).toEqual([{ n: 1 }]);
  });
});

describe("a story given to a reporter", () => {
  it("is theirs to see, edit and send to the desk; a page pin stays within its edition", async () => {
    const story = await draft(d.editor.cookie);
    const url = `${stories(d.a)}/${story.id}`;
    expect((await call("GET", url, d.reporter2.cookie)).statusCode).toBe(404);
    await assign(story.id, d.editor.cookie, { userId: d.reporter2.id });
    const seen = await call("GET", url, d.reporter2.cookie);
    expect(seen.json().can).toMatchObject({ edit: true, transitions: ["filed"] });
    const edited = await call("PATCH", url, d.reporter2.cookie, {
      baseRevision: await versionOf(story.id),
      body: "Reported by the assignee.",
    });
    expect(edited.statusCode).toBe(200);
    expect((await move(edited.json(), d.reporter2.cookie, "filed")).json().status).toBe("filed");
    const { rows } = await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
       values ($1, $2, '2026-11-03', '2026-11-03', 4) returning id`,
      [d.a.orgId, d.a.pubId],
    );
    const now = (await call("GET", url, d.editor.cookie)).json();
    const past = await call("PATCH", url, d.editor.cookie, {
      baseRevision: now.revision,
      editionId: rows[0]?.id,
      pagePin: 8,
    });
    expect(past.statusCode).toBe(400);
    const within = await call("PATCH", url, d.editor.cookie, {
      baseRevision: now.revision,
      editionId: rows[0]?.id,
      pagePin: 4,
    });
    expect(within.json()).toMatchObject({ pagePin: 4, edition: { id: rows[0]?.id, date: "2026-11-03" } });
  });
});

describe("review fixes (L2-F)", () => {
  it("B1: pages through stories saved in the same millisecond, each exactly once", async () => {
    const pub = await n.addPublication(d.a, "Paging test");
    const text = Array.from({ length: 7 }, (_, i) => `Story ${i}\nIts text ${i}.`).join("\n---\n");
    const pasted = await change("POST", `${stories(d.a, pub)}/paste`, d.a.ownerCookie, { text });
    expect(pasted.statusCode, pasted.body).toBe(201);
    const made: string[] = pasted.json().created.map((s: { id: string }) => s.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const res = await call(
        "GET",
        `${stories(d.a, pub)}?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
        d.a.ownerCookie,
      );
      const body = res.json();
      seen.push(...body.items.map((s: { id: string }) => s.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect([...seen].sort()).toEqual([...made].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("B2: a request that waits on another holding its key answers 409 request_in_progress; nothing runs twice", async () => {
    const key = randomUUID();
    const holder = await db.connect("postgres");
    await holder.query("begin");
    await holder.query(
      `insert into app.idempotency_key (org_id, user_id, key, route, request_sha256) values ($1, $2, $3, $4, $5)`,
      [d.a.orgId, d.reporter.id, key, `POST ${"/api/v1/orgs/:o/pubs/:p/stories"}`, "0".repeat(64)],
    );
    const started = Date.now();
    const waiting = await change("POST", stories(d.a), d.reporter.cookie, { headline: "Waits on its key" }, key);
    expect([waiting.statusCode, waiting.json().error.code]).toEqual([409, "request_in_progress"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
    await holder.query("rollback");
    await holder.end();
    // the work and its answer commit together: a failure leaves no key, so the same key can be sent again
    const failing = randomUUID();
    const bad = await change("POST", stories(d.a), d.reporter.cookie, { headline: "Bonjour", language: "fr" }, failing);
    expect(bad.statusCode).toBe(400);
    const { rows } = await su.query("select count(*)::int as n from app.idempotency_key where key = $1", [failing]);
    expect(rows).toEqual([{ n: 0 }]);
    const ok = await change("POST", stories(d.a), d.reporter.cookie, { headline: "Waits on its key" }, key);
    expect(ok.statusCode).toBe(201);
    const stored = await su.query("select status, response_status from app.idempotency_key where key = $1", [key]);
    expect(stored.rows).toEqual([{ status: "done", response_status: 201 }]);
  });

  it(`B4: a paste makes at most 200 stories, and keeps a compact answer for its replay`, async () => {
    const many = Array.from({ length: 201 }, (_, i) => `H${i}\nB${i}`).join("\n---\n");
    const refusedPaste = await change("POST", `${stories(d.a)}/paste`, d.editor.cookie, { text: many });
    expect(refusedPaste.statusCode).toBe(400);
    expect(refusedPaste.json().error.details[0].message).toContain("at most 200");
    const key = randomUUID();
    const two = await change("POST", `${stories(d.a)}/paste`, d.editor.cookie, { text: "A\nOne.\n---\nB\nTwo." }, key);
    const { rows } = await su.query<{ response: unknown }>("select response from app.idempotency_key where key = $1", [
      key,
    ]);
    expect(rows[0]?.response).toEqual({ ids: two.json().created.map((s: { id: string }) => s.id), skipped: [] });
    const again = await change(
      "POST",
      `${stories(d.a)}/paste`,
      d.editor.cookie,
      { text: "A\nOne.\n---\nB\nTwo." },
      key,
    );
    expect(again.json().created.map((s: { id: string }) => s.id)).toEqual(
      two.json().created.map((s: { id: string }) => s.id),
    );
  });

  it("B5: restore goes back to where the story was before its run of Held and Spiked; a Sub-editor never spikes", async () => {
    let story = (await move(await draft(d.reporter.cookie), d.reporter.cookie, "filed")).json();
    story = (await move(story, d.sub.cookie, "held")).json();
    story = (await move(story, d.chief.cookie, "spiked")).json();
    expect((await move(story, d.sub.cookie, "restore")).statusCode).toBe(403);
    story = (await move(story, d.chief.cookie, "restore")).json();
    expect(story.status).toBe("filed");
    for (let round = 0; round < 3; round += 1) {
      story = (await move(story, d.sub.cookie, "held")).json();
      expect(story.status).toBe("held");
      story = (await move(story, d.sub.cookie, "restore")).json();
      expect(story.status).toBe("filed");
    }
    const { rows } = await su.query(
      "select count(*)::int as n from app.story_status_change where story_id = $1 and to_status = 'spiked' and changed_by = $2",
      [story.id, d.sub.id],
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("B6: two field-only changes on one base: one is saved, the other 409; one of two moves on one base", async () => {
    const story = await draft(d.editor.cookie);
    const url = `${stories(d.a)}/${story.id}`;
    const fields = await Promise.all([
      call("PATCH", url, d.editor.cookie, { baseRevision: story.revision, priority: 1 }),
      call("PATCH", url, d.sub.cookie, { baseRevision: story.revision, deskNote: "Check the figures." }),
    ]);
    expect(fields.map((a) => a.statusCode).sort()).toEqual([200, 409]);
    const saved = fields.find((a) => a.statusCode === 200)?.json();
    expect(saved.revision).toBe(story.revision + 1);
    expect(saved.textRevision).toBe(1);
    expect(saved.updatedBy.id).toBe(fields[0]?.statusCode === 200 ? d.editor.id : d.sub.id);
    const filed = (await move(await draft(d.reporter.cookie), d.reporter.cookie, "filed")).json();
    const moves = await Promise.all([
      move(filed, d.editor.cookie, "ready"),
      move(filed, d.sub.cookie, "draft", "Needs a second source."),
    ]);
    expect(moves.map((a) => a.statusCode).sort()).toEqual([200, 409]);
  });

  it("B7: a refusal by the story rules is audited, with why", async () => {
    const story = (await move(await draft(d.reporter.cookie), d.reporter.cookie, "filed")).json();
    const ready = (await move(story, d.editor.cookie, "ready")).json();
    const late = await call("PATCH", `${stories(d.a)}/${story.id}`, d.reporter.cookie, {
      baseRevision: ready.revision,
      body: "x",
    });
    expect(late.statusCode).toBe(403);
    const { rows } = await su.query(
      `select data->>'permission' as permission, data->>'reason' as reason from app.audit_event
       where actor_id = $1 and action = 'access.denied' and request_id = $2`,
      [d.reporter.id, late.headers["x-request-id"]],
    );
    expect(rows).toEqual([{ permission: "story.edit_own", reason: "this story is not theirs to edit now" }]);
  });

  it("checks access before the body: a refused person learns nothing of the schema (was L2-90)", async () => {
    const story = await draft(d.reporter.cookie);
    const assignee = `${stories(d.a)}/${story.id}/assignee`;
    expect((await call("POST", assignee, d.viewer.cookie, { nonsense: true })).statusCode).toBe(403);
    expect((await call("POST", assignee, d.b.ownerCookie, { nonsense: true })).statusCode).toBe(404);
    expect((await call("POST", assignee, "", { nonsense: true })).statusCode).toBe(401);
    expect((await call("POST", assignee, d.editor.cookie, { nonsense: true })).statusCode).toBe(400);
  });

  it("B9: a tampered cursor or a huge revision number is a 400", async () => {
    const tampered = Buffer.from(JSON.stringify(["1", randomUUID()])).toString("base64url");
    expect((await call("GET", `${stories(d.a)}?cursor=${tampered}`, d.chief.cookie)).statusCode).toBe(400);
    const odd = Buffer.from(JSON.stringify(["2026-13-45T99:99:99.000000Z", randomUUID()])).toString("base64url");
    expect([400]).toContain((await call("GET", `${stories(d.a)}?cursor=${odd}`, d.chief.cookie)).statusCode);
    const story = await draft(d.reporter.cookie);
    expect((await call("GET", `${stories(d.a)}/${story.id}/revisions/99999999999`, d.chief.cookie)).statusCode).toBe(
      400,
    );
  });
});
