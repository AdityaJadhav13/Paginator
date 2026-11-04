// What the audit log records (plan §3.4; AUDIT_ACTIONS in packages/contracts/src/audit.ts; recordAudit in
// src/db/audit.ts), on a migrated clone and the run's bucket, through the API's own routes: one workflow across the
// story desk and its photos writes one event per change, each with its actor, publication, target, address and
// browser, in the change's own transaction; no event's data holds any text a person typed (headline, body, comment,
// caption, credit, desk note, file name); a refused or failed change, and a replayed idempotent one, add no event;
// and the people and invitation events record the address and browser too, are written with their change, and the
// people routes' refusals are audited. Every person and story is fictional.
import { createHmac, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordAudit } from "../../src/db/audit.ts";
import { heic, jpeg } from "../support/pictures.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { PASSWORD, type Org, type Person, newsroom } from "./newsroom.ts";

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
/** Every person the run makes (their emails and directory names must never be in an event's data). */
const everyone: { email: string; name: string }[] = [];
async function join(org: Org, publications: unknown[], orgRole: string, who: string): Promise<Person> {
  const person = await n.member(org, publications, orgRole, who);
  everyone.push({ email: person.email, name: `${who} (fictional)` });
  return person;
}

/** Text a person types, each distinctive, so that a search of the log finds any of it. */
const TEXT = {
  headline: "Monsoon secrets of Kalpaniknagar (fictional)",
  body: "The council met behind closed doors (fictional body).",
  revised: "A second, revised body nobody should log (fictional).",
  deskEdit: "The desk's own rewrite (fictional).",
  sendBack: "Please check the councillor's quote (fictional).",
  comment: "Is the second source named? (fictional comment)",
  caption: "Rain over the old market (fictional caption)",
  caption2: "The old market in the rain (fictional caption)",
  credit: "Lens of Kalpaniknagar (fictional credit)",
  credit2: "Second lens (fictional credit)",
  deskNote: "Hold for the late page (fictional note)",
  filename: "kalpaniknagar-secret-photo.jpg",
  pasted: "Pasted headline (fictional)",
};

type Row = {
  action: string;
  actor_id: string | null;
  publication_id: string | null;
  target_type: string;
  target_id: string | null;
  data: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
};

const stories = () => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories`;
const uploads = () => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/uploads`;

async function events(where: string, params: unknown[] = []): Promise<Row[]> {
  const { rows } = await su.query<Row>(
    `select action, actor_id, publication_id, target_type, target_id, data, host(ip) as ip, user_agent
     from app.audit_event where org_id = $1 and ${where} order by at, id`,
    [a.orgId, ...params],
  );
  return rows;
}
const ofStory = (id: string) => events("target_type = 'story' and target_id = $2", [id]);
const count = async (action: string, target: string) =>
  (await events("action = $2 and target_id = $3", [action, target])).length;

async function move(cookie: string, s: { id: string; revision: number }, to: string, comment?: string) {
  const res = await change("POST", `${stories()}/${s.id}/transitions`, cookie, {
    to,
    baseRevision: s.revision,
    ...(comment ? { comment } : {}),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; revision: number };
}

async function picture(cookie: string, file: Uint8Array) {
  const presigned = await change("POST", uploads(), cookie, {
    purpose: "story_photo",
    filename: TEXT.filename,
    contentType: "image/jpeg",
    bytes: file.length,
  });
  expect(presigned.statusCode, presigned.body).toBe(201);
  const policy = presigned.json() as { uploadId: string; url: string; fields: Record<string, string> };
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields)) form.append(name, value);
  form.append("file", new Blob([file]), TEXT.filename);
  expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
  const done = await call("POST", `${uploads()}/${policy.uploadId}/complete`, cookie);
  return { uploadId: policy.uploadId, bytes: file.length, done };
}

let sectionId: string;
let editionId: string;

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  everyone.push({ email: a.owner, name: "Owner (fictional)" });
  const on = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  for (const [who, role] of [
    ["editor", "editor"],
    ["reporter", "reporter"],
    ["reporter2", "reporter"],
    ["photo", "photo_editor"],
  ] as const) {
    people[who] = await join(a, on(role), "member", who);
  }
  sectionId = (
    await su.query<{ id: string }>(
      "insert into app.section (org_id, publication_id, name) values ($1, $2, 'City (fictional)') returning id",
      [a.orgId, a.pubId],
    )
  ).rows[0]?.id as string;
  editionId = (
    await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
       values ($1, $2, '2026-11-30', '2026-11-30', 8) returning id`,
      [a.orgId, a.pubId],
    )
  ).rows[0]?.id as string;
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

describe("a story's life, one event per change", () => {
  let s: { id: string; revision: number };

  it("create, revise, and every move, each with its actor, publication, target, address and browser", async () => {
    const made = await change("POST", stories(), P("reporter").cookie, { headline: TEXT.headline, body: TEXT.body });
    expect(made.statusCode, made.body).toBe(201);
    s = made.json();
    const revised = await call("PATCH", `${stories()}/${s.id}`, P("reporter").cookie, {
      baseRevision: s.revision,
      body: TEXT.revised,
    });
    expect(revised.statusCode, revised.body).toBe(200);
    s = await move(P("reporter").cookie, revised.json(), "filed");
    // the desk's first edit of a filed story picks it up: a move and a revision, in one change
    const picked = await call("PATCH", `${stories()}/${s.id}`, P("editor").cookie, {
      baseRevision: s.revision,
      body: TEXT.deskEdit,
    });
    expect(picked.statusCode, picked.body).toBe(200);
    s = await move(P("editor").cookie, picked.json(), "draft", TEXT.sendBack);
    s = await move(P("reporter").cookie, s, "filed");
    s = await move(P("editor").cookie, s, "ready");
    s = await move(P("editor").cookie, s, "held");
    s = await move(P("editor").cookie, s, "restore");
    s = await move(P("editor").cookie, s, "spiked");
    s = await move(P("editor").cookie, s, "restore");
    const rows = await ofStory(s.id);
    const R = P("reporter").id;
    const E = P("editor").id;
    expect(rows.map((row) => [row.action, row.actor_id, row.data])).toEqual([
      ["story.create", R, { rev: 1, origin: "typed", edition: null, section: null, priority: 3, pagePin: null }],
      ["story.revise", R, { rev: 2 }],
      ["story.status_change", R, { from: "draft", to: "filed", comment: null }],
      ["story.status_change", E, { from: "filed", to: "editing", comment: null }],
      ["story.revise", E, { rev: 3 }],
      ["story.status_change", E, { from: "editing", to: "draft", comment: expect.any(String) }],
      ["story.status_change", R, { from: "draft", to: "filed", comment: null }],
      ["story.status_change", E, { from: "filed", to: "ready", comment: null }],
      ["story.status_change", E, { from: "ready", to: "held", comment: null }],
      ["story.status_change", E, { from: "held", to: "ready", comment: null }],
      ["story.status_change", E, { from: "ready", to: "spiked", comment: null }],
      ["story.status_change", E, { from: "spiked", to: "ready", comment: null }],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ publication_id: a.pubId, target_type: "story", target_id: s.id });
      expect(row.ip).toMatch(/^198\.18\./);
      expect(row.user_agent).toBe("lightMyRequest");
    }
  });

  it("placement, language and the desk note: each field that moved, from and to", async () => {
    const before = (await ofStory(s.id)).length;
    const res = await call("PATCH", `${stories()}/${s.id}`, P("editor").cookie, {
      baseRevision: s.revision,
      editionId,
      sectionId,
      priority: 1,
      pagePin: 3,
      language: "en",
      deskNote: TEXT.deskNote,
    });
    expect(res.statusCode, res.body).toBe(200);
    s = res.json();
    // the same values again change nothing, and record nothing
    const again = await call("PATCH", `${stories()}/${s.id}`, P("editor").cookie, {
      baseRevision: s.revision,
      priority: 1,
      pagePin: 3,
    });
    expect(again.statusCode).toBe(200);
    s = again.json();
    const rows = (await ofStory(s.id)).slice(before);
    expect(rows.map((row) => [row.action, row.data])).toEqual([
      ["story.edition_change", { from: null, to: editionId }],
      ["story.section_change", { from: null, to: sectionId }],
      ["story.priority_change", { from: 3, to: 1 }],
      ["story.page_pin_change", { from: null, to: 3 }],
      ["story.language_change", { from: "mr", to: "en" }],
      ["story.desk_note_change", {}],
    ]);
  });

  it("assign, a due time, and unassign", async () => {
    const before = (await ofStory(s.id)).length;
    const url = `${stories()}/${s.id}/assignee`;
    let res = await call("POST", url, P("editor").cookie, { baseRevision: s.revision, userId: P("reporter2").id });
    expect(res.statusCode, res.body).toBe(200);
    res = await call("POST", url, P("editor").cookie, {
      baseRevision: res.json().revision,
      userId: P("reporter2").id,
      dueAt: "2026-11-30T12:00:00+05:30",
    });
    expect(res.statusCode).toBe(200);
    // given to someone else with another due time: both, the old time kept
    res = await call("POST", url, P("editor").cookie, {
      baseRevision: res.json().revision,
      userId: P("reporter").id,
      dueAt: "2026-12-01T12:00:00+05:30",
    });
    expect(res.statusCode, res.body).toBe(200);
    res = await call("POST", url, P("editor").cookie, { baseRevision: res.json().revision, userId: null });
    expect(res.statusCode).toBe(200);
    s = res.json();
    const rows = (await ofStory(s.id)).slice(before);
    const [due1, due2] = ["2026-11-30T06:30:00.000Z", "2026-12-01T06:30:00.000Z"];
    expect(rows.map((row) => [row.action, row.actor_id, row.data])).toEqual([
      ["story.assign", P("editor").id, { from: null, to: P("reporter2").id, dueAt: null }],
      ["story.due_change", P("editor").id, { from: null, to: due1 }],
      ["story.assign", P("editor").id, { from: P("reporter2").id, to: P("reporter").id, dueAt: due2 }],
      ["story.due_change", P("editor").id, { from: due1, to: due2 }],
      ["story.unassign", P("editor").id, { from: P("reporter").id, to: null, dueAt: due2 }],
    ]);
  });

  it("comments: written, edited, resolved and reopened, each on the comment with its story", async () => {
    const made = await change("POST", `${stories()}/${s.id}/comments`, P("editor").cookie, { body: TEXT.comment });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;
    const url = `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/comments/${id}`;
    expect((await call("PATCH", url, P("editor").cookie, { resolved: true })).statusCode).toBe(200);
    const rows = await events("target_type = 'comment' and target_id = $2", [id]);
    expect(rows.map((row) => [row.action, row.actor_id, row.publication_id, row.data])).toEqual([
      ["comment.create", P("editor").id, a.pubId, { story: s.id, parent: null }],
      ["comment.resolve", P("editor").id, a.pubId, { story: s.id, parent: null }],
    ]);
    expect(rows.every((row) => row.ip !== null && row.user_agent !== null)).toBe(true);
  });

  it("uploads asked for, completed and refused, and a photo attached, recaptioned, recredited, replaced and removed", async () => {
    const first = await picture(P("photo").cookie, jpeg(1200, 800, 0, 31));
    expect(first.done.statusCode, first.done.body).toBe(200);
    const assetId = first.done.json().asset.id as string;
    const second = await picture(P("photo").cookie, jpeg(1600, 900, 0, 32));
    const otherId = second.done.json().asset.id as string;
    const refused = await picture(P("photo").cookie, heic());
    expect(refused.done.statusCode).toBe(422);
    const uploadRows = await events("action like 'upload.%'");
    expect(uploadRows.map((row) => [row.action, row.target_type, row.target_id, row.data])).toEqual([
      ["upload.presign", "upload", first.uploadId, { bytes: first.bytes, purpose: "story_photo" }],
      [
        "upload.complete",
        "asset",
        assetId,
        {
          upload: first.uploadId,
          existing: false,
          bytes: expect.any(Number),
          mime: "image/jpeg",
          widthPx: 1200,
          heightPx: 800,
        },
      ],
      ["upload.presign", "upload", second.uploadId, { bytes: second.bytes, purpose: "story_photo" }],
      [
        "upload.complete",
        "asset",
        otherId,
        {
          upload: second.uploadId,
          existing: false,
          bytes: expect.any(Number),
          mime: "image/jpeg",
          widthPx: 1600,
          heightPx: 900,
        },
      ],
      ["upload.presign", "upload", refused.uploadId, { bytes: refused.bytes, purpose: "story_photo" }],
      ["upload.reject", "upload", refused.uploadId, {}],
    ]);
    expect(uploadRows.every((row) => row.publication_id === a.pubId && row.actor_id === P("photo").id)).toBe(true);

    const before = (await ofStory(s.id)).length;
    const url = `${stories()}/${s.id}/photo`;
    let res = await call("PUT", url, P("editor").cookie, {
      baseRevision: s.revision,
      assetId,
      caption: TEXT.caption,
      credit: TEXT.credit,
    });
    expect(res.statusCode, res.body).toBe(200);
    res = await call("PATCH", url, P("editor").cookie, { baseRevision: res.json().revision, caption: TEXT.caption2 });
    expect(res.statusCode, res.body).toBe(200);
    res = await call("PATCH", url, P("editor").cookie, { baseRevision: res.json().revision, credit: TEXT.credit2 });
    expect(res.statusCode).toBe(200);
    // the same picture again, with a new caption: the caption's change only
    res = await call("PUT", url, P("editor").cookie, {
      baseRevision: res.json().revision,
      assetId,
      caption: TEXT.caption,
      credit: TEXT.credit2,
    });
    expect(res.statusCode).toBe(200);
    // another picture, with a new caption and credit: the replacement and both changes
    res = await call("PUT", url, P("editor").cookie, {
      baseRevision: res.json().revision,
      assetId: otherId,
      caption: TEXT.caption2,
      credit: TEXT.credit,
    });
    expect(res.statusCode).toBe(200);
    res = await call("DELETE", `${url}?baseRevision=${res.json().revision}`, P("editor").cookie);
    expect(res.statusCode, res.body).toBe(200);
    s = res.json();
    const rows = (await ofStory(s.id)).slice(before);
    expect(rows.map((row) => [row.action, row.data])).toEqual([
      ["photo.attach", { asset: assetId }],
      ["photo.caption_change", { asset: assetId }],
      ["photo.credit_change", { asset: assetId }],
      ["photo.caption_change", { asset: assetId }],
      ["photo.replace", { asset: otherId, previous: assetId }],
      ["photo.caption_change", { asset: otherId }],
      ["photo.credit_change", { asset: otherId }],
      ["photo.remove", { asset: otherId }],
    ]);
  });

  it("paste and delete", async () => {
    const pasted = await change("POST", `${stories()}/paste`, P("reporter").cookie, {
      text: `${TEXT.pasted}\n${TEXT.body}\n---\nAnother pasted headline (fictional)\nMore text.`,
    });
    expect(pasted.statusCode, pasted.body).toBe(201);
    const ids = (pasted.json().created as { id: string }[]).map((story) => story.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect((await ofStory(id)).map((row) => [row.action, row.data.origin])).toEqual([["story.create", "pasted"]]);
    }
    expect((await call("DELETE", `${stories()}/${ids[0]}`, P("reporter").cookie)).statusCode).toBe(204);
    const deleted = await events("action = 'story.delete' and target_id = $2", [ids[0]]);
    expect(deleted).toMatchObject([
      { actor_id: P("reporter").id, publication_id: a.pubId, user_agent: "lightMyRequest" },
    ]);
  });
});

describe("no event without its change", () => {
  it("a refused change, a stale one, and a move the story cannot make write no success event", async () => {
    const made = await change("POST", stories(), P("reporter").cookie, {
      headline: "Refusals (fictional)",
      body: "T.",
    });
    const s = made.json() as { id: string; revision: number };
    const before = await ofStory(s.id);
    // the desk's fields, refused to a Reporter (403, audited as a refusal)
    const desk = await call("PATCH", `${stories()}/${s.id}`, P("reporter").cookie, {
      baseRevision: s.revision,
      body: "A change that never happens.",
      priority: 1,
    });
    expect(desk.statusCode).toBe(403);
    // a stale base (409), and a move from a state that does not allow it (409)
    const stale = await call("PATCH", `${stories()}/${s.id}`, P("reporter").cookie, { baseRevision: 99, body: "No." });
    expect(stale.statusCode).toBe(409);
    const bad = await change("POST", `${stories()}/${s.id}/transitions`, P("editor").cookie, {
      to: "ready",
      baseRevision: s.revision,
    });
    expect(bad.statusCode).toBe(409);
    // a photo that is not the publication's (400)
    const photo = await call("PUT", `${stories()}/${s.id}/photo`, P("reporter").cookie, {
      baseRevision: s.revision,
      assetId: randomUUID(),
    });
    expect(photo.statusCode).toBe(400);
    expect(await ofStory(s.id)).toEqual(before);
    const refusals = await events("action = 'access.denied' and actor_id = $2 and data->>'reason' = $3", [
      P("reporter").id,
      "placement and the desk note are the desk's",
    ]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      publication_id: a.pubId,
      ip: expect.any(String),
      user_agent: "lightMyRequest",
    });
  });

  it("a replayed request (the same Idempotency-Key) writes its events once", async () => {
    const key = randomUUID();
    const body = { headline: "Replayed (fictional)", body: "T." };
    const first = await change("POST", stories(), P("reporter").cookie, body, key);
    const second = await change("POST", stories(), P("reporter").cookie, body, key);
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    const s = first.json() as { id: string; revision: number };
    expect(second.json().id).toBe(s.id);
    expect(await count("story.create", s.id)).toBe(1);
    const moveKey = randomUUID();
    const moveBody = { to: "filed", baseRevision: s.revision };
    for (let i = 0; i < 2; i += 1) {
      const res = await change("POST", `${stories()}/${s.id}/transitions`, P("reporter").cookie, moveBody, moveKey);
      expect(res.statusCode).toBe(200);
    }
    expect(await count("story.status_change", s.id)).toBe(1);
    const commentKey = randomUUID();
    const ids = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      const res = await change(
        "POST",
        `${stories()}/${s.id}/comments`,
        P("editor").cookie,
        { body: "Once." },
        commentKey,
      );
      expect(res.statusCode).toBe(201);
      ids.add(res.json().id);
    }
    expect(ids.size).toBe(1);
    expect(await count("comment.create", [...ids][0] as string)).toBe(1);
  });
});

describe("the people's events", () => {
  it("record the address and browser: invitations made and accepted, members changed and removed", async () => {
    const joined = await join(a, [{ publicationId: a.pubId, roles: ["viewer"], grants: [] }], "member", "joiner");
    const changed = await call("PATCH", `/api/v1/orgs/${a.orgId}/members/${joined.id}`, a.ownerCookie, {
      publications: [{ publicationId: a.pubId, roles: ["reporter"], grants: [] }],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await call("DELETE", `/api/v1/orgs/${a.orgId}/members/${joined.id}`, a.ownerCookie)).statusCode).toBe(204);
    const owner = await n.userId(a.owner);
    const rows = await events(
      "(action like 'invitation.%' or action like 'member.%') and (actor_id = $2 or target_id = $2) and at > now() - interval '1 minute'",
      [joined.id],
    );
    const invitations = await events("action = 'invitation.create' and actor_id = $2", [owner]);
    const mine = [...invitations.slice(-1), ...rows];
    expect(mine.map((row) => [row.action, row.actor_id])).toEqual([
      ["invitation.create", owner],
      ["invitation.accept", joined.id],
      ["member.update", owner],
      ["member.remove", owner],
    ]);
    for (const row of mine) {
      expect(row.ip, row.action).toMatch(/^198\.18\./);
      expect(row.user_agent, row.action).toBe("lightMyRequest");
      expect(row.publication_id).toBeNull();
    }
    // the organisation's own making is the system's: no person, no client
    const bootstrap = await events("action = 'org.bootstrap'");
    expect(bootstrap).toMatchObject([{ actor_id: null, ip: null, user_agent: null }]);
  });
});

describe("the people routes' refusals", () => {
  it("an Admin's change or removal of the Owner: one access.denied each, with the organisation and the client", async () => {
    const admin = await join(a, [], "admin", "admin");
    const owner = await n.userId(a.owner);
    const url = `/api/v1/orgs/${a.orgId}/members/${owner}`;
    expect((await call("PATCH", url, admin.cookie, { orgRole: "member" })).statusCode).toBe(403);
    expect((await call("DELETE", url, admin.cookie)).statusCode).toBe(403);
    const rows = await events("action = 'access.denied' and actor_id = $2", [admin.id]);
    expect(rows.map((row) => [row.target_type, row.publication_id, row.data])).toEqual(
      ["PATCH", "DELETE"].map((method) => [
        "route",
        null,
        {
          permission: "members.manage",
          reason: "the Owner is not changed or removed here",
          method,
          route: "/api/v1/orgs/:o/members/:userId",
        },
      ]),
    );
    for (const row of rows) {
      expect(row.ip).toMatch(/^198\.18\./);
      expect(row.user_agent).toBe("lightMyRequest");
    }
  });

  it("a refused accept is audited in the invitation's organisation; a made-up invitation has none to audit in", async () => {
    const invited = await call("POST", `/api/v1/orgs/${a.orgId}/invitations`, a.ownerCookie, {
      email: n.someone("invitee"),
      orgRole: "member",
      publications: [],
    });
    expect(invited.statusCode).toBe(201);
    const id = invited.json().id as string;
    // someone else, verified and signed in
    const outsider = await n.organisation();
    everyone.push({ email: outsider.owner, name: "Owner (fictional)" });
    const outsiderId = await n.userId(outsider.owner);
    expect((await call("POST", `/api/v1/invitations/${id}/accept`, outsider.ownerCookie)).statusCode).toBe(404);
    // the invitee themself, with an address not confirmed (a session the server made, as in people.test.ts)
    const email = invited.json().email as string;
    const made = await it_.server.api.signUpEmail({
      body: { name: "Unverified (fictional)", email, password: PASSWORD },
    });
    everyone.push({ email, name: "Unverified (fictional)" });
    const context = await it_.server.$context;
    const session = await context.internalAdapter.createSession(made.user.id);
    const mac = createHmac("sha256", context.secret).update(session.token).digest("base64");
    const unverified = `__Secure-pgn.session_token=${encodeURIComponent(`${session.token}.${mac}`)}`;
    expect((await call("POST", `/api/v1/invitations/${id}/accept`, unverified)).statusCode).toBe(403);
    const rows = await events("action = 'access.denied' and target_id = $2", [id]);
    expect(rows.map((row) => [row.actor_id, row.target_type, row.publication_id, row.data.reason])).toEqual([
      [outsiderId, "invitation", null, expect.any(String)],
      [made.user.id, "invitation", null, "email_not_verified"],
    ]);
    expect(rows.every((row) => row.ip !== null && row.user_agent === "lightMyRequest")).toBe(true);
    // an id no invitation has: 404, and no organisation's log to write it in (docs/product/11-fix-before-launch.md)
    const madeUp = randomUUID();
    expect((await call("POST", `/api/v1/invitations/${madeUp}/accept`, outsider.ownerCookie)).statusCode).toBe(404);
    const { rows: none } = await su.query("select count(*)::int as n from app.audit_event where target_id = $1", [
      madeUp,
    ]);
    expect(none).toEqual([{ n: 0 }]);
  });
});

describe("a member's change and its event, together", () => {
  const role = async (userId: string) =>
    (
      await su.query<{ role: string }>(
        'select role from identity.member where "organizationId" = $1 and "userId" = $2',
        [a.orgId, userId],
      )
    ).rows.map((row) => row.role);
  const grants = async (userId: string) =>
    (await su.query("select roles from app.publication_grant where user_id = $1", [userId])).rows;
  const directory = async (userId: string) =>
    (await su.query("select status from app.person where org_id = $1 and user_id = $2", [a.orgId, userId])).rows;

  it("an event that cannot be written leaves the role, the grants, the directory and the membership as they were", async () => {
    const person = await join(a, [{ publicationId: a.pubId, roles: ["viewer"], grants: [] }], "member", "kept");
    await su.query(`create function app.test_refuse_event() returns trigger language plpgsql as $$
      begin if new.target_id = '${person.id}' and new.action like 'member.%' then raise exception 'planted'; end if;
      return new; end $$`);
    await su.query(
      "create trigger test_refuse_event before insert on app.audit_event for each row execute function app.test_refuse_event()",
    );
    try {
      const url = `/api/v1/orgs/${a.orgId}/members/${person.id}`;
      const changed = await call("PATCH", url, a.ownerCookie, {
        orgRole: "admin",
        publications: [{ publicationId: a.pubId, roles: ["editor"], grants: [] }],
      });
      expect(changed.statusCode).toBe(500);
      expect((await call("DELETE", url, a.ownerCookie)).statusCode).toBe(500);
    } finally {
      await su.query("drop trigger test_refuse_event on app.audit_event; drop function app.test_refuse_event()");
    }
    expect(await role(person.id)).toEqual(["member"]);
    expect(await grants(person.id)).toEqual([{ roles: ["viewer"] }]);
    expect(await directory(person.id)).toEqual([{ status: "active" }]);
    expect(await events("action like 'member.%' and target_id = $2", [person.id])).toEqual([]);
  });

  it("a member removed while their role changes (the race): 404, and no event, grant or role written", async () => {
    const person = await join(a, [{ publicationId: a.pubId, roles: ["viewer"], grants: [] }], "member", "raced");
    const identity = it_.database.identity;
    const setRole = identity.setMemberRole.bind(identity);
    // another Admin removes them between the route's check and the role change
    const spy = vi.spyOn(identity, "setMemberRole").mockImplementationOnce(async (orgId, userId, orgRole) => {
      await su.query('delete from identity.member where "organizationId" = $1 and "userId" = $2', [orgId, userId]);
      return setRole(orgId, userId, orgRole);
    });
    try {
      const res = await call("PATCH", `/api/v1/orgs/${a.orgId}/members/${person.id}`, a.ownerCookie, {
        orgRole: "admin",
        publications: [{ publicationId: a.pubId, roles: ["editor"], grants: [] }],
      });
      expect(res.statusCode).toBe(404);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(await events("action = 'member.update' and target_id = $2", [person.id])).toEqual([]);
    expect(await grants(person.id)).toEqual([{ roles: ["viewer"] }]);
  });

  it("a member removed by two Admins at once: one removal, one event", async () => {
    const person = await join(a, [], "member", "twice");
    const identity = it_.database.identity;
    const remove = identity.removeMember.bind(identity);
    // the other removal lands first
    const spy = vi.spyOn(identity, "removeMember").mockImplementationOnce(async (orgId, userId, email) => {
      await remove(orgId, userId, email);
      return remove(orgId, userId, email);
    });
    try {
      expect((await call("DELETE", `/api/v1/orgs/${a.orgId}/members/${person.id}`, a.ownerCookie)).statusCode).toBe(
        404,
      );
    } finally {
      spy.mockRestore();
    }
    expect(await events("action = 'member.remove' and target_id = $2", [person.id])).toEqual([]);
    expect(await directory(person.id)).toEqual([{ status: "active" }]); // the other removal's own writes would follow
  });

  it("an audit row written in a transaction that then fails is rolled back with it", async () => {
    const tenant = { orgId: a.orgId, userId: P("editor").id, pubIds: [a.pubId], requestId: "rolled-back-event" };
    const failed = it_.database.withTenant(tenant, async (tx) => {
      await recordAudit(tx, tenant, { action: "story.delete", targetType: "story", publicationId: a.pubId });
      const seen = await tx
        .selectFrom("app.audit_event")
        .select("id")
        .where("request_id", "=", "rolled-back-event")
        .execute();
      expect(seen).toHaveLength(1); // written, inside the transaction
      throw new Error("planted failure after the audit insert");
    });
    await expect(failed).rejects.toThrow("planted failure");
    const { rows } = await su.query("select count(*)::int as n from app.audit_event where request_id = $1", [
      "rolled-back-event",
    ]);
    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe("after every event above", () => {
  it("no event holds text a person typed, nor anyone's email or name", async () => {
    const { rows } = await su.query<{ data: string }>(
      "select data::text as data from app.audit_event where org_id = $1",
      [a.orgId],
    );
    expect(rows.length).toBeGreaterThan(50);
    const all = rows.map((row) => row.data).join("\n");
    for (const [what, text] of Object.entries(TEXT)) expect(all.includes(text), what).toBe(false);
    // nor any part of them (a cut-down copy would be text too)
    for (const word of ["Monsoon", "councillor", "market", "Lens", "secret-photo", "late page"]) {
      expect(all.includes(word), word).toBe(false);
    }
    expect(everyone.length).toBeGreaterThan(8);
    for (const { email, name } of everyone) {
      expect(all.toLowerCase().includes(email.toLowerCase()), email).toBe(false);
      expect(all.includes(name), name).toBe(false);
    }
  });
});
