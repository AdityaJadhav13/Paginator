// A story's comments (src/modules/stories/comments.ts; docs/product/10-l2-newsroom-plan.md §5.2) on a migrated clone,
// through the API's own routes: write, list, reply, edit, resolve and reopen, with an Idempotency-Key, every role
// against every comment endpoint (07 §12), the audit rows, and the endpoint tenancy walk (test (c)) for the comment
// routes. Every person, organisation, story and comment is fictional.
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

let a: Org;
let b: Org;
let p2: string;
const people: Record<string, Person> = {};

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  p2 = await n.addPublication(a, "Kalpaniknagar Express");
  const on = (role: string, pub = a.pubId) => [{ publicationId: pub, roles: [role], grants: [] }];
  for (const [who, role] of [
    ["chief", "chief_editor"],
    ["editor", "editor"],
    ["sub", "sub_editor"],
    ["reporter", "reporter"],
    ["reporter2", "reporter"],
    ["designer", "page_designer"],
    ["photo", "photo_editor"],
    ["ads", "advertising"],
    ["prepress", "prepress"],
    ["viewer", "viewer"],
  ] as const) {
    people[who] = await n.member(a, on(role), "member", who);
  }
  people.admin = await n.member(a, [], "admin", "admin");
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const P = (who: string) => people[who] as Person;
const stories = (org: Org = a, pub = org.pubId) => `/api/v1/orgs/${org.orgId}/pubs/${pub}/stories`;
const commentUrl = (id: string, org: Org = a, pub = org.pubId) =>
  `/api/v1/orgs/${org.orgId}/pubs/${pub}/comments/${id}`;

async function story(cookie: string, org: Org = a, pub = org.pubId) {
  const res = await change("POST", stories(org, pub), cookie, { headline: "A fictional story", body: "Text." });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; revision: number };
}

async function comment(cookie: string, storyId: string, body: Record<string, unknown> = { body: "Check the date." }) {
  return change("POST", `${stories()}/${storyId}/comments`, cookie, body);
}

describe("comments", () => {
  it("are written, listed oldest first, replied to one level deep, and counted on the story", async () => {
    const s = await story(P("reporter").cookie);
    const first = await comment(P("editor").cookie, s.id, { body: "  Check the date\u0007 (fictional). " });
    expect(first.statusCode, first.body).toBe(201);
    const made = first.json();
    expect(made).toMatchObject({
      storyId: s.id,
      parentId: null,
      author: { id: P("editor").id },
      body: "Check the date (fictional).",
      edited: false,
      resolved: null,
      can: { edit: true, resolve: true },
    });
    const reply = await comment(P("reporter").cookie, s.id, { body: "Fixed.", parentId: made.id });
    expect(reply.statusCode, reply.body).toBe(201);
    expect(reply.json()).toMatchObject({ parentId: made.id, can: { edit: true, resolve: false } });
    // a reply to a reply, or to another story's comment, is refused
    const deeper = await comment(P("editor").cookie, s.id, { body: "x", parentId: reply.json().id });
    expect([deeper.statusCode, deeper.json().error.details[0].field]).toEqual([400, "body.parentId"]);
    const other = await story(P("reporter").cookie);
    const astray = await comment(P("editor").cookie, other.id, { body: "x", parentId: made.id });
    expect(astray.statusCode).toBe(400);
    const blank = await comment(P("editor").cookie, s.id, { body: " \u0007 " });
    expect([blank.statusCode, blank.json().error.details[0].field]).toEqual([400, "body.body"]);
    const list = await call("GET", `${stories()}/${s.id}/comments`, P("reporter").cookie);
    expect(list.json().items.map((c: { body: string }) => c.body)).toEqual(["Check the date (fictional).", "Fixed."]);
    expect((await call("GET", `${stories()}/${s.id}`, P("reporter").cookie)).json().commentCount).toBe(2);
  });

  it("need an Idempotency-Key, and a retry with it writes one comment", async () => {
    const s = await story(P("reporter").cookie);
    const url = `${stories()}/${s.id}/comments`;
    expect((await call("POST", url, P("editor").cookie, { body: "No key." })).statusCode).toBe(400);
    const key = crypto.randomUUID();
    const once = await change("POST", url, P("editor").cookie, { body: "Once." }, key);
    const again = await change("POST", url, P("editor").cookie, { body: "Once." }, key);
    expect([once.statusCode, again.statusCode, again.json().id]).toEqual([201, 201, once.json().id]);
    const { rows } = await su.query("select count(*)::int as n from app.comment where target_id = $1", [s.id]);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("are edited by their author only; a thread is resolved and reopened by its author, the desk or the story's reporter, each audited", async () => {
    const s = await story(P("reporter").cookie);
    const made = (await comment(P("sub").cookie, s.id)).json();
    const reply = (await comment(P("reporter").cookie, s.id, { body: "On it.", parentId: made.id })).json();
    const edited = await call("PATCH", commentUrl(made.id), P("sub").cookie, { body: "Check the date again." });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ body: "Check the date again.", edited: true });
    const notTheirs = await call("PATCH", commentUrl(made.id), P("editor").cookie, { body: "Mine now." });
    expect([notTheirs.statusCode, notTheirs.json().error.code]).toEqual([403, "not_allowed"]);
    // the story's reporter resolves the desk's thread; a reply cannot be resolved on its own
    const resolved = await call("PATCH", commentUrl(made.id), P("reporter").cookie, { resolved: true });
    expect(resolved.json()).toMatchObject({ resolved: { by: { id: P("reporter").id } }, edited: true });
    const onReply = await call("PATCH", commentUrl(reply.id), P("reporter").cookie, { resolved: true });
    expect([onReply.statusCode, onReply.json().error.details[0].field]).toEqual([400, "body.resolved"]);
    // another reporter does not even see the story; a Viewer may not write
    expect((await call("PATCH", commentUrl(made.id), P("reporter2").cookie, { resolved: false })).statusCode).toBe(404);
    expect((await call("PATCH", commentUrl(made.id), P("viewer").cookie, { resolved: false })).statusCode).toBe(403);
    // a Page Designer may comment, but this thread is neither theirs nor their story's
    expect((await call("PATCH", commentUrl(made.id), P("designer").cookie, { resolved: false })).statusCode).toBe(403);
    const reopened = await call("PATCH", commentUrl(made.id), P("editor").cookie, { resolved: false });
    expect(reopened.json().resolved).toBeNull();
    const { rows } = await su.query(
      `select action, actor_id, target_id, data from app.audit_event
       where target_id = $1 and action like 'comment.%' order by at, id`,
      [made.id],
    );
    expect(rows.map((row) => [row.action, row.actor_id])).toEqual([
      ["comment.edit", P("sub").id],
      ["comment.resolve", P("reporter").id],
      ["comment.reopen", P("editor").id],
    ]);
    expect(rows[0].data).toEqual({ story: s.id }); // ids only
    const denied = await su.query(
      `select data->>'reason' as reason from app.audit_event
       where actor_id = $1 and action = 'access.denied' and data->>'route' = '/api/v1/orgs/:o/pubs/:p/comments/:c'`,
      [P("editor").id],
    );
    expect(denied.rows).toEqual([{ reason: "only its author changes a comment" }]);
  });
});

describe("every role against the comment endpoints (07 §12)", () => {
  it("matches the expected table, on the Owner's story and on a reporter's own", async () => {
    const roles = ["chief", "editor", "sub", "reporter", "designer", "photo", "ads", "prepress", "viewer", "admin"];
    // read: comment.read on a story they see (a Reporter: their own; Advertising sees no story: 404)
    // write: comment.write (Viewer: none, 403) on a story they see
    const EXPECT = {
      ownerStory: {
        read: {
          chief: 200,
          editor: 200,
          sub: 200,
          reporter: 404,
          designer: 200,
          photo: 200,
          ads: 404,
          prepress: 200,
          viewer: 200,
          admin: 200,
        },
        write: {
          chief: 201,
          editor: 201,
          sub: 201,
          reporter: 404,
          designer: 201,
          photo: 201,
          ads: 404,
          prepress: 201,
          viewer: 403,
          admin: 201,
        },
      },
      reporterStory: {
        read: {
          chief: 200,
          editor: 200,
          sub: 200,
          reporter: 200,
          designer: 200,
          photo: 200,
          ads: 404,
          prepress: 200,
          viewer: 200,
          admin: 200,
        },
        write: {
          chief: 201,
          editor: 201,
          sub: 201,
          reporter: 201,
          designer: 201,
          photo: 201,
          ads: 404,
          prepress: 201,
          viewer: 403,
          admin: 201,
        },
      },
    } as const;
    const targets = { ownerStory: await story(a.ownerCookie), reporterStory: await story(P("reporter").cookie) };
    const mismatches: string[] = [];
    for (const [where, s] of Object.entries(targets)) {
      for (const who of roles) {
        const cookie = P(who).cookie;
        const read = (await call("GET", `${stories()}/${s.id}/comments`, cookie)).statusCode;
        const write = (await comment(cookie, s.id, { body: `From ${who}.` })).statusCode;
        const want = EXPECT[where as keyof typeof EXPECT];
        if (read !== want.read[who as keyof typeof want.read]) mismatches.push(`${where} ${who} read: ${read}`);
        if (write !== want.write[who as keyof typeof want.write]) mismatches.push(`${where} ${who} write: ${write}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 60_000);
});

describe("tenancy (c): the comment endpoints with another tenant's ids answer 404", () => {
  it("walks the route table: another organisation, another publication, another publication's comment", async () => {
    const routes = it_.app.apiRoutes.filter((route) => route.url.includes("comments") && route.method !== "HEAD");
    expect(routes.length).toBeGreaterThanOrEqual(3);
    const bStory = await story(b.ownerCookie, b);
    const bComment = (
      await change("POST", `${stories(b)}/${bStory.id}/comments`, b.ownerCookie, { body: "B." })
    ).json();
    const p2Story = await story(a.ownerCookie, a, p2);
    const p2Comment = (
      await change("POST", `${stories(a, p2)}/${p2Story.id}/comments`, a.ownerCookie, { body: "P2." })
    ).json();
    const cases = [
      { label: "B's organisation", o: b.orgId, p: b.pubId, s: bStory.id, c: bComment.id },
      { label: "B's publication under A", o: a.orgId, p: b.pubId, s: bStory.id, c: bComment.id },
      { label: "B's ids under A's publication", o: a.orgId, p: a.pubId, s: bStory.id, c: bComment.id },
      { label: "A's second publication's ids under the first", o: a.orgId, p: a.pubId, s: p2Story.id, c: p2Comment.id },
    ];
    const failures: string[] = [];
    for (const route of routes) {
      for (const c of cases) {
        const params: Record<string, string> = { o: c.o, p: c.p, s: c.s, c: c.c };
        const url = route.url.replace(/:([a-z]+)/g, (_, name: string) => {
          if (!(name in params)) failures.push(`${route.url} has a parameter :${name} with no fixture`);
          return params[name] ?? "";
        });
        const payload =
          route.method === "PATCH" ? { resolved: true } : route.method === "POST" ? { body: "intruder" } : undefined;
        const res = await change(route.method as "GET", url, a.ownerCookie, payload);
        if (res.statusCode !== 404) failures.push(`${route.method} ${route.url} with ${c.label}: ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
    const { rows } = await su.query("select resolved_at from app.comment where id = any($1)", [[bComment.id]]);
    expect(rows).toEqual([{ resolved_at: null }]);
  });
});
