// Tenancy test (f), live updates (docs/product/10-l2-newsroom-plan.md §4.8; src/modules/notifications/events.ts): over
// real HTTP, server-sent events reach only the people authorised for their organisation and publication (a Reporter:
// their own stories only, confirmed in the database), carry ids only, and treat Postgres's hints as untrusted; a stream
// ends when its person's membership, session or two-step ends, when its browser leaves (even while its access is being
// checked) or reads nothing, and every stream ends at once when the app stops. Every person and story is fictional.
import { get } from "node:http";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// liveReady, which src/modules/notifications/routes.ts declares
import type {} from "../../src/modules/notifications/routes.ts";
import { freshDatabase } from "../db/helpers.ts";
import { type IdentityApp, identityApp } from "../db/identity-app.ts";
import { type Org, type Person, newsroom } from "../db/newsroom.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
let closed = false;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let base = "";
let a: Org;
let b: Org;
let p2: string;
let c: Org; // an organisation whose Owner's two-step is turned off while their stream is open
let d: Org; // an organisation whose Owner's browser reads nothing (a flood of events would overflow any stream)
const people: Record<string, Person> = {};
const P = (who: string) => people[who] as Person;

type Event = { id?: string | undefined; event: string; data: unknown };
type Open = { status: number; headers: Headers; events: Event[]; ended: () => boolean; close: () => void };

/** A stream as a browser's EventSource would read it: one connection of its own (node:http, no pooling). */
function open(cookie: string, orgId = a.orgId, headers: Record<string, string> = {}): Promise<Open> {
  return new Promise((resolve, reject) => {
    const events: Event[] = [];
    let ended = false;
    const request = get(
      `${base}/api/v1/orgs/${orgId}/events`,
      { agent: false, headers: { ...(cookie ? { cookie } : {}), ...headers } },
      (res) => {
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let cut = buffer.indexOf("\n\n");
          while (cut >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const fields = Object.fromEntries(
              block
                .split("\n")
                .filter((line) => !line.startsWith(":") && line.includes(": "))
                .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]),
            );
            if (fields.event)
              events.push({ id: fields.id, event: fields.event, data: JSON.parse(fields.data ?? "{}") });
            cut = buffer.indexOf("\n\n");
          }
        });
        const done = () => {
          ended = true;
        };
        res.on("end", done);
        res.on("close", done);
        resolve({
          status: res.statusCode ?? 0,
          headers: new Headers(Object.entries(res.headers).map(([k, v]) => [k, String(v)])),
          events,
          ended: () => ended,
          close: () => request.destroy(),
        });
      },
    );
    request.on("error", (error) => {
      ended = true;
      if ((error as { code?: string }).code !== "ECONNRESET") reject(error);
    });
  });
}

async function until(what: string, ok: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!ok()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const of = (stream: Open, kind: string) => stream.events.filter((e) => e.event === kind);

const streams: Record<string, Open> = {};

beforeAll(async () => {
  it_ = await identityApp(db, {}, undefined, 300);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  p2 = await n.addPublication(a, "Kalpaniknagar Express");
  const on = (role: string, pub = a.pubId) => [{ publicationId: pub, roles: [role], grants: [] }];
  people.rep1 = await n.member(a, on("reporter"), "member", "rep1");
  people.rep2 = await n.member(a, on("reporter"), "member", "rep2");
  people.viewer = await n.member(a, on("viewer"), "member", "viewer");
  people.p2only = await n.member(a, on("editor", p2), "member", "p2only");
  people.ads = await n.member(a, on("advertising"), "member", "ads");
  people.many = await n.member(a, on("viewer"), "member", "many");
  people.leaver = await n.member(a, on("viewer"), "member", "leaver");
  c = await n.organisation();
  d = await n.organisation();
  await it_.app.listen({ host: "127.0.0.1", port: 0 });
  const address = it_.app.server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  await it_.app.liveReady();
  for (const who of ["rep1", "rep2", "viewer", "p2only", "ads"]) streams[who] = await open(P(who).cookie);
  streams.ownerA = await open(a.ownerCookie);
  streams.ownerB = await open(b.ownerCookie, b.orgId);
  for (const stream of Object.values(streams)) expect(stream.status).toBe(200);
}, 120_000);
afterAll(async () => {
  for (const stream of Object.values(streams)) stream.close();
  if (!closed) await it_.close();
  await db.drop();
});

const storiesOf = (pub = a.pubId) => `/api/v1/orgs/${a.orgId}/pubs/${pub}/stories`;
const everyone = () => Object.keys(streams);
/** Who has heard of this story, by the stream's name. */
const heard = (kind: string, storyId: string) =>
  everyone()
    .filter((who) => of(streams[who] as Open, kind).some((e) => (e.data as { storyId?: string }).storyId === storyId))
    .sort();

describe("live updates (f)", () => {
  it("answers text/event-stream, never cached, to members only", async () => {
    const s = streams.rep1 as Open;
    expect(s.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(s.headers.get("cache-control")).toBe("no-store");
    expect((await open(P("rep1").cookie, b.orgId)).status).toBe(404); // not a member of B
    expect((await open("")).status).toBe(401);
  });

  it("tells of a story only those who see it: its organisation, its publication, a Reporter's own", async () => {
    const made = await change("POST", storiesOf(), P("rep1").cookie, { headline: "Live (fictional)", body: "Text." });
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;
    await until("the story event", () => heard("story", id).length >= 3);
    await pause(400);
    expect(heard("story", id)).toEqual(["ownerA", "rep1", "viewer"]);
    // ids only
    const event = of(streams.viewer as Open, "story").find((e) => (e.data as { storyId: string }).storyId === id);
    expect(event?.data).toEqual({ publicationId: a.pubId, storyId: id });
    // given to the second reporter: now they hear of it too
    const given = await call("POST", `${storiesOf()}/${id}/assignee`, a.ownerCookie, {
      baseRevision: made.json().revision,
      userId: P("rep2").id,
    });
    expect(given.statusCode).toBe(200);
    await until("the assignee's event", () => heard("story", id).includes("rep2"));
    // a comment: the same people, and the reporter and assignee are told by a notification of their own
    const comment = await change("POST", `${storiesOf()}/${id}/comments`, a.ownerCookie, { body: "Lovely." });
    expect(comment.statusCode).toBe(201);
    await until("the comment events", () => heard("comment", id).length >= 4);
    await until("the notifications", () =>
      ["rep1", "rep2"].every((w) => of(streams[w] as Open, "notification").length > 0),
    );
    await pause(400);
    expect(heard("comment", id)).toEqual(["ownerA", "rep1", "rep2", "viewer"]);
    const told = everyone()
      .filter((who) => of(streams[who] as Open, "notification").length > 0)
      .sort();
    expect(told).toEqual(["rep1", "rep2"]);
    const notice = of(streams.rep2 as Open, "notification")[0];
    expect(Object.keys(notice?.data as object)).toEqual(["id"]);
    const { rows } = await su.query("select user_id from app.notification where id = $1", [
      (notice?.data as { id: string }).id,
    ]);
    expect(rows).toEqual([{ user_id: P("rep2").id }]);
  });

  it("treats Postgres's hints as untrusted: anything not exactly ours is dropped, each stream decides by its own access, and a Reporter's stories are confirmed in the database", async () => {
    const before = everyone().map((who) => (streams[who] as Open).events.length);
    const fake = crypto.randomUUID();
    const hint = (value: object | string) =>
      su.query("select pg_notify('app_events', $1)", [typeof value === "string" ? value : JSON.stringify(value)]);
    await hint("not json");
    await hint({ v: 1, type: "story", org: a.orgId, pub: a.pubId, story: fake, people: [], text: "a headline" });
    await hint({ v: 2, type: "story", org: a.orgId, pub: a.pubId, story: fake, people: [] });
    await hint({ v: 1, type: "notification", org: a.orgId, user: "not-an-id", notification: fake });
    await pause(500);
    expect(everyone().map((who) => (streams[who] as Open).events.length)).toEqual(before);
    // a well-formed hint of the second publication reaches only those who reach it there
    await hint({ v: 1, type: "story", org: a.orgId, pub: p2, story: fake, people: [P("rep1").id] });
    await until("the second publication's event", () => heard("story", fake).length >= 2);
    await pause(300);
    expect(heard("story", fake)).toEqual(["ownerA", "p2only"].sort());
    // a forged hint of the first publication naming the Reporter, for a story that is not theirs (the Owner's): they
    // reach the publication, but the story is read under their own tenant first, and it is not theirs
    const owners = await change("POST", storiesOf(), a.ownerCookie, {
      headline: "Not rep1's (fictional)",
      body: "Text.",
    });
    const notTheirs = owners.json().id as string;
    await until("the Owner's own event", () => heard("story", notTheirs).includes("ownerA"));
    await hint({ v: 1, type: "story", org: a.orgId, pub: a.pubId, story: notTheirs, people: [P("rep1").id] });
    await hint({
      v: 1,
      type: "comment",
      org: a.orgId,
      pub: a.pubId,
      story: notTheirs,
      comment: crypto.randomUUID(),
      people: [P("rep1").id],
    });
    await until("the forged comment to reach the Owner", () => heard("comment", notTheirs).includes("ownerA"));
    await pause(400);
    expect([heard("story", notTheirs).includes("rep1"), heard("comment", notTheirs).includes("rep1")]).toEqual([
      false,
      false,
    ]);
  });

  it("says resync first when the browser reconnects", async () => {
    const again = await open(P("rep1").cookie, a.orgId, { "last-event-id": "7" });
    await until("resync", () => again.events.length > 0);
    expect(again.events[0]).toMatchObject({ event: "resync", data: {} });
    again.close();
  });

  it("listens again after the LISTEN connection is lost, and tells every stream to resync", async () => {
    const rep1 = streams.rep1 as Open;
    const before = of(rep1, "resync").length;
    const { rows } = await su.query(
      `select pg_terminate_backend(pid) as ended from pg_stat_activity
       where usename = 'pgn_listen' and datname = current_database()`,
    );
    expect(rows).toEqual([{ ended: true }]);
    await until("resync after the lost connection", () => of(rep1, "resync").length > before, 8000);
    const made = await change("POST", storiesOf(), P("rep1").cookie, { headline: "After (fictional)", body: "Text." });
    await until("events again", () => heard("story", made.json().id).includes("rep1"));
  }, 15_000);

  it("never counts a stream whose browser left while its access was being checked", async () => {
    const before = it_.app.liveStreams();
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => {
        const request = get(`${base}/api/v1/orgs/${a.orgId}/events`, {
          agent: false,
          headers: { cookie: P("leaver").cookie },
        });
        request.on("socket", (socket) => socket.once("connect", () => setImmediate(() => request.destroy())));
        request.on("error", () => resolve());
        request.on("close", () => resolve());
      });
    }
    await pause(500);
    expect(it_.app.liveStreams()).toBe(before);
    // so the person is not locked out by streams that are gone
    const opened: Open[] = [];
    for (let i = 0; i < 5; i += 1) opened.push(await open(P("leaver").cookie));
    expect(opened.map((s) => s.status)).toEqual([200, 200, 200, 200, 200]);
    for (const s of opened) s.close();
    await until("the leaver's streams to go", () => it_.app.liveStreams() === before);
  });

  it("closes the connection of a browser that reads nothing, once 256 KiB wait unsent", async () => {
    const before = it_.app.liveStreams();
    const connections = () =>
      new Promise<number>((resolve) => it_.app.server.getConnections((_error, count) => resolve(count)));
    const idle = await connections();
    let request: ReturnType<typeof get> | undefined;
    const status = await new Promise<number>((resolve) => {
      request = get(`${base}/api/v1/orgs/${d.orgId}/events`, { agent: false, headers: { cookie: d.ownerCookie } });
      request.on("response", (res) => {
        res.pause(); // reads nothing, ever
        resolve(res.statusCode ?? 0);
      });
      request.on("error", () => undefined);
    });
    expect(status).toBe(200);
    await until("the stream to open", () => it_.app.liveStreams() === before + 1);
    expect(await connections()).toBe(idle + 1);
    // ids only, each a new story's: about 15 MB of events for the Owner of D
    await su.query(
      `select pg_notify('app_events', json_build_object('v', 1, 'type', 'story', 'org', $1::uuid, 'pub', $2::uuid,
         'story', gen_random_uuid(), 'people', '[]'::json)::text) from generate_series(1, 100000)`,
      [d.orgId, d.pubId],
    );
    await until("its slot to be freed", () => it_.app.liveStreams() === before, 15_000);
    let open = idle + 1;
    await until("its connection to be closed by the server", () => {
      void connections().then((count) => {
        open = count;
      });
      return open === idle;
    });
    request?.destroy();
  }, 30_000);

  it("re-reads two-step at each check: a stream ends once two-step is turned off where the organisation requires it", async () => {
    const owner = await n.userId(c.owner);
    await su.query("update app.org_settings set mfa_required_roles = '{owner}' where org_id = $1", [c.orgId]);
    await su.query(`update identity."user" set "twoFactorEnabled" = true where id = $1`, [owner]);
    await su.query(`update identity.session set "twoStepAt" = now() where "userId" = $1`, [owner]);
    const stream = await open(c.ownerCookie, c.orgId);
    expect(stream.status).toBe(200);
    await pause(700);
    expect(stream.ended()).toBe(false);
    await su.query(`update identity."user" set "twoFactorEnabled" = false where id = $1`, [owner]);
    await until("the stream to end", () => stream.ended(), 3000);
  });

  it(`takes at most 5 streams a person`, async () => {
    const opened: Open[] = [];
    for (let i = 0; i < 5; i += 1) opened.push(await open(P("many").cookie));
    expect(opened.map((s) => s.status)).toEqual([200, 200, 200, 200, 200]);
    const sixth = await open(P("many").cookie);
    expect(sixth.status).toBe(429);
    for (const s of opened) s.close();
  });

  it("ends a stream once its person leaves the organisation or ends the session", async () => {
    const removed = await call("DELETE", `/api/v1/orgs/${a.orgId}/members/${P("viewer").id}`, a.ownerCookie);
    expect(removed.statusCode, removed.body).toBe(204);
    await until("the removed member's stream to end", () => (streams.viewer as Open).ended(), 3000);
    const out = await n.call("POST", "/api/auth/sign-out", P("ads").cookie, {});
    expect(out.statusCode, out.body).toBe(200);
    await until("the signed-out stream to end", () => (streams.ads as Open).ended(), 3000);
    expect((streams.rep1 as Open).ended()).toBe(false);
  });

  it("ends every stream at once when the app stops (preClose), well within the grace period", async () => {
    const open = everyone().filter((who) => !(streams[who] as Open).ended());
    expect(open.length).toBeGreaterThan(2);
    const start = Date.now();
    await it_.close();
    closed = true;
    expect(Date.now() - start).toBeLessThan(2000);
    await until("every stream to end", () => open.every((who) => (streams[who] as Open).ended()), 2000);
  });
});
