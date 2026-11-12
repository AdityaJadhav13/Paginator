// Editions (src/modules/stories/editions.ts, src/db/editions.ts) on a migrated clone: making one (who may, the defaults,
// the Desk key, one a date, idempotency, the audit row), listing them with their stories counted, putting a story in an
// edition and taking it out (the story's PATCH), the live hint (migration 2026_11_28_0001), another tenant's ids, and
// correcting an edition's date and pages (its runs set aside, its ads and plan following). Every organisation, person,
// advertiser and story is fictional.
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

describe("correcting an edition's date and pages (PATCH /:e)", () => {
  const BACK = [
    { slot: "back-1", w_mm: 120, h_mm: 80.5 },
    { slot: "back-3", w_mm: 60, h_mm: 40 },
  ];
  const PLAN = (pages: number, ads: boolean) => ({
    pages,
    back_page_ads: ads,
    page_plan: Array.from({ length: pages }, (_, i) => ({
      page: i + 1,
      role: i === 0 ? "front" : i === pages - 1 ? "back" : "inside",
      template_role: i === 0 ? "front" : "inside",
      news_mm2: 60000,
      ad_slots: ads && i === pages - 1 ? BACK : [],
    })),
    needs: { stories: 20, briefs: 4, photos: 6, words: 9000, per_role: {}, spare_share: 0.1 },
  });
  let ownerId: string;

  beforeAll(async () => {
    ownerId = await n.userId(a.owner);
    const upload = await su.query<{ id: string }>(
      `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
       values ($1, $2, $3, 'engine_dataset', 'application/zip', 10, now()) returning id`,
      [a.orgId, a.pubId, ownerId],
    );
    await su.query(
      `insert into app.engine_profile (org_id, publication_id, version, state, upload_id, dataset_version_id,
         dataset_sha256, dataset_bytes, config_version_id, config_sha256, engine_version, templates, grid, plans,
         created_by)
       values ($1, $2, 1, 'ready', $3, 'v-dataset', $4, 10, 'v-config', $5, 'fictional-engine 1', '{"front": "page1"}',
         $6, $7, $8)`,
      [
        a.orgId,
        a.pubId,
        upload.rows[0]?.id,
        "d".repeat(64),
        "e".repeat(64),
        JSON.stringify({ columns: 8, column_width_mm: 32, gutter_mm: 4 }),
        JSON.stringify([4, 8, 16].flatMap((p) => [PLAN(p, true), PLAN(p, false)])),
        ownerId,
      ],
    );
  }, 60_000);

  let fixed = 0;
  /** A date of its own for each edition here. */
  const fixDay = () => `2027-07-${String(++fixed).padStart(2, "0")}`;
  const make = async (date: string, pages = 8) => {
    const made = await change("POST", editions(), people.editor!.cookie, { date, pages });
    expect(made.statusCode, made.body).toBe(201);
    return made.json() as { id: string; date: string; pages: number };
  };
  const correct = (id: string, body: unknown, cookie = people.editor!.cookie) =>
    call("PATCH", `${editions()}/${id}`, cookie, body);
  let runs = 0;
  /** A run of the edition, made as the superuser: done (finished), or another state. */
  const run = async (editionId: string, state = "done") => {
    const key = `r-20270701-${String(++runs).padStart(6, "0")}`;
    const ended = state === "done" || state === "failed" || state === "cancelled";
    const { rows } = await su.query<{ id: string }>(
      `insert into app.layout_run (org_id, publication_id, edition_id, desk_key, state, finished_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [a.orgId, a.pubId, editionId, key, state, ended ? new Date("2027-01-02T03:04:05Z") : null, ownerId],
    );
    return rows[0]?.id ?? "";
  };
  const edits = async (id: string) =>
    (
      await su.query("select actor_id, data from app.audit_event where action = 'edition.edit' and target_id = $1", [
        id,
      ])
    ).rows;
  const placements = async (e: string) =>
    (
      await su.query<{ slot: string; booking_id: string }>(
        "select slot, booking_id from app.ad_placement where edition_id = $1 order by slot",
        [e],
      )
    ).rows.map((r) => [r.slot, r.booking_id]);

  it("moves the date and pages, sets the done runs aside, empties the plan past the new count, audited with was", async () => {
    const [from, to] = [fixDay(), fixDay()];
    const edition = await make(from);
    const [done1, done2, failed] = [await run(edition.id), await run(edition.id), await run(edition.id, "failed")];
    const section = await su.query<{ id: string }>(
      "insert into app.section (org_id, publication_id, name) values ($1, $2, 'Fictional city') returning id",
      [a.orgId, a.pubId],
    );
    for (const [page, sectionId, note] of [
      [3, section.rows[0]?.id, "keep me"],
      [7, section.rows[0]?.id, "from the old plan"],
    ] as const) {
      await su.query(
        `insert into app.flatplan_page (org_id, publication_id, edition_id, page_no, section_id, note, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [a.orgId, a.pubId, edition.id, page, sectionId, note, ownerId],
      );
    }

    const res = await correct(edition.id, { date: to, pages: 4 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ...edition, date: to, pages: 4 });
    const row = await su.query("select desk_key, pages, back_page_ads from app.edition where id = $1", [edition.id]);
    expect(row.rows[0]).toEqual({ desk_key: to, pages: 4, back_page_ads: true });
    const states = await su.query<{ id: string; state: string; message: unknown; finished_at: Date }>(
      "select id, state, message, finished_at from app.layout_run where edition_id = $1 order by desk_key",
      [edition.id],
    );
    const SET_ASIDE = {
      code: "m.run.editionChanged",
      text: "Set aside: the edition's date or pages changed after this layout. Lay it out again.",
      params: null,
    };
    expect(states.rows).toEqual([
      { id: done1, state: "cancelled", message: SET_ASIDE, finished_at: new Date("2027-01-02T03:04:05Z") },
      { id: done2, state: "cancelled", message: SET_ASIDE, finished_at: new Date("2027-01-02T03:04:05Z") },
      { id: failed, state: "failed", message: null, finished_at: new Date("2027-01-02T03:04:05Z") },
    ]);
    // the Pages board (the newest done run) has none now; the run that ended last says why
    const layout = await call("GET", `${editions()}/${edition.id}/layout`, people.editor!.cookie);
    expect(layout.statusCode, layout.body).toBe(200);
    expect(layout.json()).toMatchObject({ board: null, active: null });
    const plan = await su.query(
      "select page_no, section_id, note from app.flatplan_page where edition_id = $1 order by page_no",
      [edition.id],
    );
    expect(plan.rows).toEqual([
      { page_no: 3, section_id: section.rows[0]?.id, note: "keep me" },
      { page_no: 7, section_id: null, note: "" },
    ]);
    expect(await edits(edition.id)).toEqual([
      {
        actor_id: people.editor!.id,
        data: {
          date: to,
          pages: 4,
          was: { date: from, pages: 8 },
          setAside: 2,
          // what it emptied, as it was
          planCleared: [{ page: 7, section: section.rows[0]?.id, note: "from the old plan" }],
        },
      },
    ]);
  });

  it("keeps what followed the date in the Desk key, and turns back-page ads off alone", async () => {
    const [from, to] = [fixDay(), fixDay()];
    const { rows } = await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
       values ($1, $2, $3::date, $3 || '-2', 8) returning id`,
      [a.orgId, a.pubId, from],
    );
    const id = rows[0]?.id ?? "";
    const res = await correct(id, { date: to, backPageAds: false, pages: 8 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id, date: to, pages: 8, backPageAds: false });
    const row = await su.query("select desk_key from app.edition where id = $1", [id]);
    expect(row.rows[0]).toEqual({ desk_key: `${to}-2` });
    expect(await edits(id)).toEqual([
      {
        actor_id: people.editor!.id,
        data: { date: to, backPageAds: false, was: { date: from, backPageAds: true }, setAside: 0 },
      },
    ]);
  });

  it("refuses while a layout run is active (409 run_active, the run), and changes nothing", async () => {
    const edition = await make(fixDay());
    const done = await run(edition.id);
    const active = await run(edition.id, "queued");
    const res = await correct(edition.id, { pages: 16, issue: "77" });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toMatchObject({ code: "run_active", current: { id: active, state: "queued" } });
    const row = await su.query("select pages, issue from app.edition where id = $1", [edition.id]);
    expect(row.rows[0]).toEqual({ pages: 8, issue: "" });
    const state = await su.query("select state from app.layout_run where id = $1", [done]);
    expect(state.rows[0]).toEqual({ state: "done" });
    expect(await edits(edition.id)).toEqual([]);
  });

  it("refuses once released or archived (409 edition_released); its folio still changes as before", async () => {
    for (const status of ["released", "archived"]) {
      const edition = await make(fixDay());
      await su.query("update app.edition set status = $2 where id = $1", [edition.id, status]);
      const res = await correct(edition.id, { date: fixDay() });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().error).toMatchObject({
        code: "edition_released",
        message: "This edition has been released: its date and pages can no longer change.",
      });
      expect((await correct(edition.id, { pages: edition.pages, price: "₹ 6" })).statusCode).toBe(200);
      expect(await edits(edition.id)).toEqual([{ actor_id: people.editor!.id, data: { price: "₹ 6" } }]);
    }
  });

  it("refuses a date another edition has (409 edition_exists, that edition)", async () => {
    const [mine, theirs] = [await make(fixDay()), await make(fixDay())];
    const res = await correct(mine.id, { date: theirs.date });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toMatchObject({ code: "edition_exists", current: { id: theirs.id, date: theirs.date } });
    expect((await su.query("select desk_key from app.edition where id = $1", [mine.id])).rows[0]).toEqual({
      desk_key: mine.date,
    });
  });

  it("makes the ads follow: the old date's booking taken out, the new date's placed, artwork without a slot cleared", async () => {
    const [from, to] = [fixDay(), fixDay()];
    const advertiser = await call(
      "POST",
      `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/advertisers`,
      people.advertising!.cookie,
      {
        name: "Example Fictional Jewellers",
      },
    );
    expect(advertiser.statusCode, advertiser.body).toBe(201);
    const book = async (date: string) => {
      const res = await change("POST", `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/bookings`, people.advertising!.cookie, {
        advertiserId: advertiser.json().id,
        wMm: 120,
        hMm: 80.5,
        colour: "colour",
        slot: null,
        dates: [date],
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().id as string;
    };
    const [old, fresh] = [await book(from), await book(to)];
    const edition = await make(from);
    expect(await placements(edition.id)).toEqual([["back-1", old]]);

    const moved = await correct(edition.id, { date: to });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await placements(edition.id)).toEqual([["back-1", fresh]]);
    const audit = await su.query(
      `select action, data->>'booking' as booking from app.audit_event
       where target_id = $1 and action like 'ad_placement.%' order by at, id`,
      [edition.id],
    );
    expect(audit.rows).toEqual([
      { action: "ad_placement.set", booking: old },
      { action: "ad_placement.clear", booking: old },
      { action: "ad_placement.set", booking: fresh },
    ]);

    // a picture set in a slot by hand (the L2.3 path): cleared once the plan has no back-page ads
    const asset = await su.query<{ id: string }>(
      `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, status,
         uploaded_by, version_id)
       values ($1, $2, 'p-00000a1201', $3, 1000, 'image/jpeg', 500, 334, 'ready', $4, 'v-original') returning id`,
      [a.orgId, a.pubId, "a12".padStart(64, "0"), ownerId],
    );
    await su.query(
      `insert into app.ad_slot_artwork (org_id, publication_id, edition_id, slot, asset_id, w_mm, h_mm, set_by)
       values ($1, $2, $3, 'back-3', $4, 60, 40, $5)`,
      [a.orgId, a.pubId, edition.id, asset.rows[0]?.id, ownerId],
    );
    const off = await correct(edition.id, { backPageAds: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(await placements(edition.id)).toEqual([]);
    const art = await su.query("select slot from app.ad_slot_artwork where edition_id = $1", [edition.id]);
    expect(art.rows).toEqual([]);
    expect((await edits(edition.id)).at(-1)?.data).toMatchObject({ backPageAds: false, artworkCleared: ["back-3"] });
  });

  it("locks the new date's bookings before the edition: a booking changed meanwhile is waited for, never deadlocked", async () => {
    const [from, to] = [fixDay(), fixDay()];
    const advertiser = await call(
      "POST",
      `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/advertisers`,
      people.advertising!.cookie,
      {
        name: "Example Fictional Opticians",
      },
    );
    expect(advertiser.statusCode, advertiser.body).toBe(201);
    const booked = await change(
      "POST",
      `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/bookings`,
      people.advertising!.cookie,
      {
        advertiserId: advertiser.json().id,
        wMm: 120,
        hMm: 80.5,
        colour: "colour",
        slot: null,
        dates: [to],
      },
    );
    expect(booked.statusCode, booked.body).toBe(201);
    const booking = booked.json().id as string;
    const edition = await make(from);
    // a change of that booking in progress (place.ts's order: the booking, then the editions it runs in)
    const other = await db.connect("postgres");
    try {
      await other.query("begin");
      await other.query("select id from app.ad_booking where id = $1 for update", [booking]);
      const pending = correct(edition.id, { date: to });
      // the correction waits for the booking, holding no lock on the edition yet
      for (let i = 0; i < 600; i += 1) {
        const waiting = await su.query(
          "select 1 from pg_locks where locktype in ('transactionid', 'tuple') and not granted",
        );
        if (waiting.rowCount) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await other.query("select id from app.edition where id = $1 for update nowait", [edition.id]);
      await other.query("update app.ad_booking set status = 'cancelled' where id = $1", [booking]);
      await other.query("commit");
      const res = await pending;
      expect(res.statusCode, res.body).toBe(200);
      // the booking was cancelled before the correction read it: it is not placed
      expect(await placements(edition.id)).toEqual([]);
    } finally {
      await other.end();
    }
  });

  it.each([
    ["Advertising (◐: ad positions only)", "advertising"],
    ["Prepress (◐: colour map only)", "prepress"],
    ["Sub-editor", "sub_editor"],
    ["Reporter", "reporter"],
  ])("refuses %s (403), and changes nothing", async (_who, role) => {
    const edition = await make(fixDay());
    const res = await correct(edition.id, { pages: 4 }, people[role]!.cookie);
    expect(res.statusCode, res.body).toBe(403);
    expect((await su.query("select pages from app.edition where id = $1", [edition.id])).rows[0]).toEqual({ pages: 8 });
  });

  it("a PATCH that changes nothing writes nothing", async () => {
    const edition = await make(fixDay());
    const done = await run(edition.id);
    const before = await su.query("select updated_at from app.edition where id = $1", [edition.id]);
    const res = await correct(edition.id, { date: edition.date, pages: 8, backPageAds: true, issue: "" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual(edition);
    const after = await su.query("select updated_at from app.edition where id = $1", [edition.id]);
    expect(after.rows).toEqual(before.rows);
    expect((await su.query("select state from app.layout_run where id = $1", [done])).rows[0]).toEqual({
      state: "done",
    });
    expect(await edits(edition.id)).toEqual([]);
  });
});
