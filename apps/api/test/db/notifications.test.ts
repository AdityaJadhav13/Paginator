// Notifications (src/modules/notifications; 06 §11's L2.1 defaults; docs/product/10-l2-newsroom-plan.md §5.2) on a
// migrated clone, through the API's own routes: who is told of a story filed, sent back or given, of a comment and of
// an accepted invitation; the two emails, in Marathi and English; the list, its unread count and cursor, marking
// read; and the walls: a person reads and marks only their own, and only for publications they still reach. Every
// person, organisation and story is fictional.
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
const people: Record<string, Person> = {};
const P = (who: string) => people[who] as Person;

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  const on = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  for (const [who, role] of [
    ["chief", "chief_editor"],
    ["editor", "editor"],
    ["sub", "sub_editor"],
    ["sub2", "sub_editor"],
    ["reporter", "reporter"],
    ["reporter2", "reporter"],
    ["photo", "photo_editor"],
    ["ads", "advertising"],
  ] as const) {
    people[who] = await n.member(a, on(role), "member", who);
  }
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const storiesUrl = () => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories`;
const notificationsUrl = (query = "") => `/api/v1/orgs/${a.orgId}/notifications${query}`;

async function story(cookie: string) {
  const res = await change("POST", storiesUrl(), cookie, {
    headline: "Rain in Kalpaniknagar (fictional)",
    body: "Text.",
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; revision: number };
}

async function move(cookie: string, s: { id: string; revision: number }, to: string, comment?: string) {
  const res = await change("POST", `${storiesUrl()}/${s.id}/transitions`, cookie, {
    to,
    baseRevision: s.revision,
    ...(comment ? { comment } : {}),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; revision: number };
}

/** The kinds of notification each person has about this story, from the table (as the superuser). */
async function toldOf(storyId: string): Promise<Record<string, string[]>> {
  const { rows } = await su.query<{ user_id: string; kind: string }>(
    "select user_id, kind from app.notification where target_id = $1 order by created_at, id",
    [storyId],
  );
  const byName = Object.fromEntries(Object.entries(people).map(([who, person]) => [person.id, who]));
  const told: Record<string, string[]> = {};
  for (const row of rows) {
    const who = byName[row.user_id] ?? (row.user_id === (await n.userId(a.owner)) ? "owner" : row.user_id);
    (told[who] ??= []).push(row.kind);
  }
  return told;
}

describe("who is told", () => {
  it("of a story filed: the publication's Editors and Sub-editors, in app", async () => {
    const s = await story(P("reporter").cookie);
    await move(P("reporter").cookie, s, "filed");
    expect(await toldOf(s.id)).toEqual({ editor: ["story_filed"], sub: ["story_filed"], sub2: ["story_filed"] });
  });

  it("of a story sent back: its reporter, in app and by email in their language first; nobody of their own act", async () => {
    await su.query(`update identity."user" set locale = 'mr' where id = $1`, [P("reporter").id]);
    const s = await story(P("reporter").cookie);
    const filed = await move(P("reporter").cookie, s, "filed");
    const before = it_.sent.length;
    await move(P("sub").cookie, filed, "draft", "Add the <b>date</b>, please.");
    const told = await toldOf(s.id);
    expect(told.reporter).toEqual(["story_sent_back"]);
    // the Sub-editor who sent it back was told of the filing, not of their own send-back
    expect([told.sub, told.sub2]).toEqual([["story_filed"], ["story_filed"]]);
    const { rows } = await su.query(
      "select data, emailed_at from app.notification where target_id = $1 and kind = 'story_sent_back'",
      [s.id],
    );
    expect(Object.keys(rows[0].data).sort()).toEqual(["actorId", "commentId", "publicationId", "storyId"]);
    expect(rows[0].emailed_at).not.toBeNull();
    const mail = it_.sent.slice(before).find((m) => m.to === P("reporter").email);
    expect(mail?.subject).toContain("Story sent back");
    expect(mail?.text.indexOf("बातमी")).toBeLessThan(mail?.text.indexOf("sent your story") ?? 0); // Marathi first
    expect(mail?.text).toContain("Add the <b>date</b>, please.");
    expect(mail?.html).toContain("Add the &lt;b&gt;date&lt;/b&gt;, please.");
    expect(mail?.text).toContain(`/org/${a.orgId}/pub/${a.pubId}/stories`);
  });

  it("of a story given to someone: that person, in app, not again when only its due time changes", async () => {
    const s = await story(P("editor").cookie);
    const url = `${storiesUrl()}/${s.id}/assignee`;
    const given = await call("POST", url, P("editor").cookie, { baseRevision: s.revision, userId: P("reporter2").id });
    expect(given.statusCode, given.body).toBe(200);
    const due = await call("POST", url, P("editor").cookie, {
      baseRevision: given.json().revision,
      userId: P("reporter2").id,
      dueAt: "2026-11-30T12:00:00+05:30",
    });
    expect(due.statusCode).toBe(200);
    await call("POST", url, P("editor").cookie, { baseRevision: due.json().revision, userId: P("editor").id });
    expect(await toldOf(s.id)).toEqual({ reporter2: ["story_assigned"] });
  });

  it("of a comment: the story's reporter and assignee and the thread's writers who see it, not the writer", async () => {
    const s = await story(P("reporter").cookie);
    const given = await call("POST", `${storiesUrl()}/${s.id}/assignee`, P("editor").cookie, {
      baseRevision: s.revision,
      userId: P("photo").id,
    });
    expect(given.statusCode).toBe(200);
    const first = await change("POST", `${storiesUrl()}/${s.id}/comments`, P("chief").cookie, { body: "Shorter?" });
    expect(first.statusCode, first.body).toBe(201);
    const reply = await change("POST", `${storiesUrl()}/${s.id}/comments`, P("reporter").cookie, {
      body: "Done.",
      parentId: first.json().id,
    });
    expect(reply.statusCode).toBe(201);
    expect(await toldOf(s.id)).toEqual({
      photo: ["story_assigned", "comment", "comment"],
      reporter: ["comment"],
      chief: ["comment"], // a writer in the thread
    });
  });
});

describe("who is not told", () => {
  it("a writer in the thread who no longer sees the story (moved to Advertising)", async () => {
    const mover = await n.member(a, [{ publicationId: a.pubId, roles: ["editor"], grants: [] }], "member", "mover");
    const s = await story(P("reporter").cookie);
    const first = await change("POST", `${storiesUrl()}/${s.id}/comments`, mover.cookie, { body: "Shorter?" });
    expect(first.statusCode).toBe(201);
    const moved = await call("PATCH", `/api/v1/orgs/${a.orgId}/members/${mover.id}`, a.ownerCookie, {
      publications: [{ publicationId: a.pubId, roles: ["advertising"], grants: [] }],
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const reply = await change("POST", `${storiesUrl()}/${s.id}/comments`, P("reporter").cookie, {
      body: "Shortened.",
      parentId: first.json().id,
    });
    expect(reply.statusCode).toBe(201);
    const { rows } = await su.query("select user_id from app.notification where target_id = $1", [s.id]);
    // the reporter was told of the first comment; of the reply, nobody: they wrote it, and the mover no longer sees it
    expect(rows).toEqual([{ user_id: P("reporter").id }]);
  });
});

describe("an invitation accepted", () => {
  it("tells the person who sent it, in app and by email", async () => {
    const before = it_.sent.length;
    const joined = await n.member(a, [{ publicationId: a.pubId, roles: ["viewer"], grants: [] }], "member", "joiner");
    const owner = await n.userId(a.owner);
    const { rows } = await su.query(
      `select user_id, kind, target_type, data from app.notification
       where kind = 'invitation_accepted' and data->>'actorId' = $1`,
      [joined.id],
    );
    expect(rows).toEqual([
      {
        user_id: owner,
        kind: "invitation_accepted",
        target_type: "invitation",
        data: { invitationId: expect.any(String), actorId: joined.id },
      },
    ]);
    // written in the transaction that made the person's directory row and grants (one now() for both)
    const together = await su.query(
      `select n.created_at = p.joined_at as together from app.notification n
       join app.person p on p.org_id = n.org_id and p.user_id = (n.data->>'actorId')::uuid
       where n.kind = 'invitation_accepted' and p.user_id = $1`,
      [joined.id],
    );
    expect(together.rows).toEqual([{ together: true }]);
    const mail = it_.sent.slice(before).find((m) => m.to === a.owner && m.subject.includes("Invitation accepted"));
    expect(mail?.text).toContain("joiner (fictional) accepted your invitation");
    expect(mail?.text).toContain(`/org/${a.orgId}/team`);
  });
});

describe("the list", () => {
  it("shows the person's own, newest first, with the unread count and a cursor; marks some or all read", async () => {
    const editor = P("editor");
    for (let i = 0; i < 3; i += 1) await move(P("reporter").cookie, await story(P("reporter").cookie), "filed");
    const all = await call("GET", notificationsUrl(), editor.cookie);
    expect(all.statusCode, all.body).toBe(200);
    const list = all.json();
    expect(list.unread).toBeGreaterThanOrEqual(3);
    expect(list.items[0]).toMatchObject({
      kind: "story_filed",
      publicationId: a.pubId,
      actor: { id: P("reporter").id, name: "reporter (fictional)" },
      readAt: null,
    });
    const page = await call("GET", notificationsUrl("?limit=2"), editor.cookie);
    expect(page.json().items).toHaveLength(2);
    const next = await call("GET", notificationsUrl(`?limit=2&cursor=${page.json().nextCursor}`), editor.cookie);
    expect(next.json().items[0].id).toBe(list.items[2].id);
    const read = await call("POST", notificationsUrl("/read"), editor.cookie, { ids: [list.items[0].id] });
    expect(read.statusCode).toBe(204);
    expect((await call("GET", notificationsUrl(), editor.cookie)).json().unread).toBe(list.unread - 1);
    // someone else's id is not theirs to mark
    await call("POST", notificationsUrl("/read"), P("sub").cookie, { all: true });
    const unread = await call("GET", notificationsUrl("?unread=1"), editor.cookie);
    expect(unread.json().items.length).toBe(list.unread - 1);
    await call("POST", notificationsUrl("/read"), editor.cookie, { all: true });
    expect((await call("GET", notificationsUrl(), editor.cookie)).json().unread).toBe(0);
    expect((await call("GET", notificationsUrl("?cursor=nope"), editor.cookie)).statusCode).toBe(400);
  });

  it("never shows another person's notifications, nor those of a publication the person no longer reaches", async () => {
    const sub2 = P("sub2");
    const mine = (await call("GET", notificationsUrl(), sub2.cookie)).json();
    expect(mine.items.length).toBeGreaterThan(0);
    const others = (await call("GET", notificationsUrl(), P("reporter2").cookie)).json();
    expect(others.items.map((item: { id: string }) => item.id)).not.toContain(mine.items[0].id);
    await call("POST", notificationsUrl("/read"), P("reporter2").cookie, { ids: [mine.items[0].id] });
    const { rows } = await su.query("select read_at from app.notification where id = $1", [mine.items[0].id]);
    expect(rows).toEqual([{ read_at: null }]);
    // moved to another publication: the old notices are out of reach
    const p2 = await n.addPublication(a, "Kalpaniknagar Express");
    const moved = await call("PATCH", `/api/v1/orgs/${a.orgId}/members/${sub2.id}`, a.ownerCookie, {
      publications: [{ publicationId: p2, roles: ["sub_editor"], grants: [] }],
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const after = (await call("GET", notificationsUrl(), sub2.cookie)).json();
    expect([after.items, after.unread]).toEqual([[], 0]);
  });
});

describe("the walls", () => {
  it("let pgn_app read and mark only the person's own notifications, though anyone of the organisation writes one", async () => {
    const app = await db.connect("app");
    try {
      await app.query("begin");
      await app.query(
        "select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.pub_ids', $3, true)",
        [a.orgId, P("editor").id, `{${a.pubId}}`],
      );
      const seen = await app.query(
        "select count(*)::int as n, count(*) filter (where user_id <> $1)::int as others from app.notification",
        [P("editor").id],
      );
      expect(seen.rows[0].n).toBeGreaterThan(0);
      expect(seen.rows[0].others).toBe(0);
      const marked = await app.query("update app.notification set read_at = now() where user_id <> $1", [
        P("editor").id,
      ]);
      expect(marked.rowCount).toBe(0);
      // and of their own, only read_at and emailed_at (column grants): never what it says
      await app.query("savepoint kind");
      const rewritten = await app
        .query("update app.notification set kind = 'comment' where user_id = $1", [P("editor").id])
        .then(
          () => "allowed",
          (error: { code?: string }) => error.code,
        );
      expect(rewritten).toBe("42501");
      await app.query("rollback to savepoint kind");
      const written = await app.query(
        `insert into app.notification (org_id, user_id, kind, target_type, target_id, data)
         values ($1, $2, 'comment', 'story', $3, '{}')`, // (no RETURNING: the new row is not theirs to read)
        [a.orgId, P("sub").id, crypto.randomUUID()],
      );
      expect(written.rowCount).toBe(1);
    } finally {
      await app.query("rollback");
      await app.end();
    }
  });
});

describe("the photo rules' refusals", () => {
  it("are audited, as the stories' are (a reporter's own story once it is Ready)", async () => {
    const s = await story(P("reporter").cookie);
    const ready = await move(P("sub").cookie, await move(P("reporter").cookie, s, "filed"), "ready");
    const res = await call("PUT", `${storiesUrl()}/${s.id}/photo`, P("reporter").cookie, {
      baseRevision: ready.revision,
      assetId: crypto.randomUUID(),
    });
    expect(res.statusCode).toBe(403);
    const { rows } = await su.query(
      `select data->>'reason' as reason from app.audit_event
       where actor_id = $1 and action = 'access.denied' and data->>'route' like '%/photo'`,
      [P("reporter").id],
    );
    expect(rows).toEqual([{ reason: "this story's photo is not theirs to set" }]);
  });
});
