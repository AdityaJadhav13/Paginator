// Editions (src/modules/stories/editions.ts, src/db/editions.ts) on a migrated clone: making one (who may, the defaults,
// the Desk key, one a date, idempotency, the audit row), listing them with their stories counted, putting a story in an
// edition and taking it out (the story's PATCH), the live hint (migration 2026_11_28_0001), and another tenant's ids.
// Every organisation, person and story is fictional.
import { randomUUID } from "node:crypto";
import type { Client, Notification } from "pg";
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
const people: Record<string, Person> = {};
const hints: unknown[] = [];

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  for (const role of ["chief_editor", "editor", "sub_editor", "reporter", "advertising", "prepress", "viewer"]) {
    people[role] = await n.member(a, [{ publicationId: a.pubId, roles: [role], grants: [] }], "member", role);
  }
  people.admin = await n.member(a, [], "admin", "admin");
  su.on("notification", (message: Notification) => {
    if (message.channel === "app_events" && message.payload) hints.push(JSON.parse(message.payload));
  });
  await su.query("listen app_events");
}, 180_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const editions = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/editions`;
const stories = () => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories`;
let day = 0;
/** A date of its own for each new edition. */
const nextDay = () => `2027-03-${String(++day).padStart(2, "0")}`;

describe("making an edition", () => {
  it("the desk makes one with the plan's fields; the Desk key is its date; audited with ids and numbers only", async () => {
    const date = nextDay();
    const made = await change("POST", editions(), people.editor!.cookie, {
      date,
      pages: 16,
      backPageAds: false,
      volume: " खंड ५ ",
      issue: "अंक १२\u0007",
      price: "₹ 5",
    });
    expect(made.statusCode, made.body).toBe(201);
    const edition = made.json();
    expect(edition).toEqual({
      id: expect.any(String),
      date,
      pages: 16,
      backPageAds: false,
      volume: "खंड ५",
      issue: "अंक १२",
      price: "₹ 5",
      status: "planning",
      counts: { stories: 0, ready: 0, spiked: 0 },
    });
    const row = await su.query("select desk_key, produced_in from app.edition where id = $1", [edition.id]);
    expect(row.rows[0]).toEqual({ desk_key: date, produced_in: "hosted" });
    const audit = await su.query(
      "select actor_id, publication_id, target_type, data from app.audit_event where action = 'edition.create' and target_id = $1",
      [edition.id],
    );
    expect(audit.rows).toEqual([
      { actor_id: people.editor!.id, publication_id: a.pubId, target_type: "edition", data: { date, pages: 16 } },
    ]);
  });

  it("back-page ads are on by default, the other lines empty", async () => {
    const made = await change("POST", editions(), people.chief_editor!.cookie, { date: nextDay(), pages: 4 });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ pages: 4, backPageAds: true, volume: "", issue: "", price: "" });
  });

  it("a date with an edition already answers 409 edition_exists with that edition, and writes nothing", async () => {
    const date = nextDay();
    const first = await change("POST", editions(), a.ownerCookie, { date, pages: 8 });
    expect(first.statusCode, first.body).toBe(201);
    const again = await change("POST", editions(), people.admin!.cookie, { date, pages: 4 });
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().error).toMatchObject({
      code: "edition_exists",
      current: { id: first.json().id, date, pages: 8 },
    });
    const count = await su.query(
      "select count(*)::int as n from app.audit_event where action = 'edition.create' and data->>'date' = $1",
      [date],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("needs an Idempotency-Key; a retry answers the same edition once, and the same key with another body 422", async () => {
    const date = nextDay();
    const none = await call("POST", editions(), people.editor!.cookie, { date, pages: 8 });
    expect(none.statusCode).toBe(400);
    const key = randomUUID();
    const first = await change("POST", editions(), people.editor!.cookie, { date, pages: 8 }, key);
    const retry = await change("POST", editions(), people.editor!.cookie, { date, pages: 8 }, key);
    expect([first.statusCode, retry.statusCode]).toEqual([201, 201]);
    expect(retry.json()).toEqual(first.json());
    const audit = await su.query("select count(*)::int as n from app.audit_event where target_id = $1", [
      first.json().id,
    ]);
    expect(audit.rows[0].n).toBe(1);
    const other = await change("POST", editions(), people.editor!.cookie, { date, pages: 16 }, key);
    expect(other.statusCode).toBe(422);
  });

  it.each([
    ["a day that does not exist", { date: "2027-02-30", pages: 8 }],
    ["a year the Desk does not take", { date: "1999-12-31", pages: 8 }],
    ["a page count other than 4, 8 or 16", { date: "2027-04-01", pages: 12 }],
    ["an unknown field", { date: "2027-04-01", pages: 8, zone: "city" }],
    ["a volume over 200 characters", { date: "2027-04-01", pages: 8, volume: "x".repeat(201) }],
  ])("refuses %s (400)", async (_what, body) => {
    const made = await change("POST", editions(), people.editor!.cookie, body);
    expect(made.statusCode, made.body).toBe(400);
  });

  it.each([
    ["Owner", () => a.ownerCookie, 201],
    ["Admin", () => people.admin!.cookie, 201],
    ["Chief Editor", () => people.chief_editor!.cookie, 201],
    ["Editor", () => people.editor!.cookie, 201],
    ["Sub-editor", () => people.sub_editor!.cookie, 403],
    ["Reporter", () => people.reporter!.cookie, 403],
    ["Advertising (◐: ad positions only)", () => people.advertising!.cookie, 403],
    ["Prepress (◐: colour map only)", () => people.prepress!.cookie, 403],
    ["Viewer", () => people.viewer!.cookie, 403],
  ])("role matrix: %s makes one: %i", async (_who, cookie, status) => {
    const made = await change("POST", editions(), cookie(), { date: nextDay(), pages: 8 });
    expect(made.statusCode, made.body).toBe(status);
  });

  it("a refusal is audited as access.denied on the publication", async () => {
    const before = await su.query("select count(*)::int as n from app.audit_event where action = 'access.denied'");
    const made = await change("POST", editions(), people.advertising!.cookie, { date: nextDay(), pages: 8 });
    expect(made.statusCode).toBe(403);
    const after = await su.query(
      "select publication_id, data from app.audit_event where action = 'access.denied' order by at desc limit 1",
    );
    expect(after.rowCount).toBe(1);
    expect(after.rows[0]).toMatchObject({ publication_id: a.pubId, data: { permission: "edition.create" } });
    const total = await su.query("select count(*)::int as n from app.audit_event where action = 'access.denied'");
    expect(total.rows[0].n).toBe(before.rows[0].n + 1);
  });

  it("tells the live updates once it is made: ids only", async () => {
    hints.length = 0;
    const made = await change("POST", editions(), people.editor!.cookie, { date: nextDay(), pages: 8 });
    expect(made.statusCode).toBe(201);
    await expect.poll(() => hints.length).toBeGreaterThan(0);
    expect(hints).toContainEqual({ v: 1, type: "edition", org: a.orgId, pub: a.pubId, edition: made.json().id });
  });
});

describe("listing editions, and stories in them", () => {
  it("counts the edition's stories, Ready and Spiked, leaving deleted ones out; a story goes in and out by its PATCH", async () => {
    const date = nextDay();
    const edition = (await change("POST", editions(), people.editor!.cookie, { date, pages: 8 })).json();
    const make = async (to: string[]) => {
      const s = (
        await change("POST", stories(), people.editor!.cookie, { headline: "Fictional", body: "Text." })
      ).json();
      // put in the edition by the desk (before it is spiked: a spiked story is not edited)
      const placed = await call("PATCH", `${stories()}/${s.id}`, people.editor!.cookie, {
        baseRevision: s.revision,
        editionId: edition.id,
      });
      expect(placed.statusCode, placed.body).toBe(200);
      expect(placed.json().edition).toEqual({ id: edition.id, date });
      let now = placed.json();
      for (const target of to) {
        const moved = await change("POST", `${stories()}/${now.id}/transitions`, people.editor!.cookie, {
          to: target,
          baseRevision: now.revision,
        });
        expect(moved.statusCode, moved.body).toBe(200);
        now = moved.json();
      }
      return now;
    };
    const ready = await make(["filed", "ready"]);
    await make(["filed", "ready"]);
    await make(["spiked"]);
    const gone = await make([]);
    expect((await call("DELETE", `${stories()}/${gone.id}`, people.editor!.cookie)).statusCode).toBe(204);

    const listed = await call("GET", `${editions()}?from=${date}&to=${date}`, people.viewer!.cookie);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items).toEqual([
      expect.objectContaining({ id: edition.id, counts: { stories: 3, ready: 2, spiked: 1 } }),
    ]);
    // Advertising sees no stories, so it is not told how many there are (counts null), only the editions
    const ads = await call("GET", `${editions()}?from=${date}&to=${date}`, people.advertising!.cookie);
    expect(ads.statusCode, ads.body).toBe(200);
    expect(ads.json().items).toEqual([expect.objectContaining({ id: edition.id, pages: 8, counts: null })]);

    // taken out again: no longer counted, and audited as the story's edition change
    const out = await call("PATCH", `${stories()}/${ready.id}`, people.editor!.cookie, {
      baseRevision: ready.revision,
      editionId: null,
    });
    expect(out.statusCode, out.body).toBe(200);
    expect(out.json().edition).toBeNull();
    const after = (await call("GET", `${editions()}?from=${date}&to=${date}`, people.editor!.cookie)).json();
    expect(after.items[0].counts).toEqual({ stories: 2, ready: 1, spiked: 1 });
    const audit = await su.query(
      "select data from app.audit_event where action = 'story.edition_change' and target_id = $1 order by at",
      [ready.id],
    );
    expect(audit.rows.map((row) => row.data)).toEqual([
      { from: null, to: edition.id },
      { from: edition.id, to: null },
    ]);
  });

  it("a Reporter cannot place their own story in an edition (403), nor list editions (403)", async () => {
    const date = nextDay();
    const edition = (await change("POST", editions(), people.editor!.cookie, { date, pages: 8 })).json();
    const s = (await change("POST", stories(), people.reporter!.cookie, { headline: "Mine (fictional)" })).json();
    const placed = await call("PATCH", `${stories()}/${s.id}`, people.reporter!.cookie, {
      baseRevision: s.revision,
      editionId: edition.id,
    });
    expect(placed.statusCode).toBe(403);
    expect((await call("GET", editions(), people.reporter!.cookie)).statusCode).toBe(403);
  });

  it("lists newest first, within from and to (both inclusive); a bad date is 400", async () => {
    const list = (await call("GET", editions(), people.prepress!.cookie)).json().items as { date: string }[];
    expect(list.length).toBeGreaterThan(3);
    expect(list.map((e) => e.date)).toEqual([...list.map((e) => e.date)].sort().reverse());
    const [newest] = list;
    const one = (await call("GET", `${editions()}?from=${newest!.date}&to=${newest!.date}`, a.ownerCookie)).json();
    expect(one.items.map((e: { date: string }) => e.date)).toEqual([newest!.date]);
    expect((await call("GET", `${editions()}?from=2027-13-01`, a.ownerCookie)).statusCode).toBe(400);
  });
});

describe("tenancy", () => {
  it("another organisation's editions are neither listed nor reachable; its publication under A is 404", async () => {
    const theirs = (await change("POST", editions(b), b.ownerCookie, { date: "2027-05-01", pages: 8 })).json();
    const mine = (await call("GET", editions(), a.ownerCookie)).json().items as { id: string }[];
    expect(mine.map((e) => e.id)).not.toContain(theirs.id);
    const crossed = `/api/v1/orgs/${a.orgId}/pubs/${b.pubId}/editions`;
    expect((await call("GET", crossed, a.ownerCookie)).statusCode).toBe(404);
    expect((await change("POST", crossed, a.ownerCookie, { date: "2027-05-02", pages: 8 })).statusCode).toBe(404);
    expect((await change("POST", editions(b), a.ownerCookie, { date: "2027-05-03", pages: 8 })).statusCode).toBe(404);
    // B's edition named on A's story: not an edition of this publication (400), nothing written
    const s = (await change("POST", stories(), a.ownerCookie, { headline: "Fictional" })).json();
    const placed = await call("PATCH", `${stories()}/${s.id}`, a.ownerCookie, {
      baseRevision: s.revision,
      editionId: theirs.id,
    });
    expect(placed.statusCode).toBe(400);
    // the same date in another organisation is its own edition
    expect((await change("POST", editions(), a.ownerCookie, { date: "2027-05-01", pages: 8 })).statusCode).toBe(201);
  });
});
