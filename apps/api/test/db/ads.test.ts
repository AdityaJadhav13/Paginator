// The ads desk and the edition plan on the API's side (docs/product/10-l2-newsroom-plan.md §1 L2.6; migration
// 2026_12_05_0001; packages/contracts/src/ads.ts): advertisers, bookings checked against the profile's back-page slots,
// their artwork checks, placement by rule and by hand (the slot's artwork following through media.ad), released
// editions left alone, the L2.3 slot route refusing a booked slot, the plan's pages, copying a plan, an edition made
// with its bookings placed, who may do what, and the walls. Every advertiser, picture and date is fictional.
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainInbox } from "../../src/modules/media/engine-inbox.ts";
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
let ownerId: string;
let chief: Person;
let editor: Person;
let advertising: Person;
let reporter: Person;
let sub: Person;
const base = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}`;

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  ownerId = await n.userId(a.owner);
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  editor = await n.member(a, as("editor"), "member", "editor");
  advertising = await n.member(a, as("advertising"), "member", "advertising");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
  sub = await n.member(a, as("sub_editor"), "member", "sub");
  await readyProfile(a);
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

// ------------------------------------------------------------------------------------------------ fictional data

const BACK = [
  { slot: "back-1", w_mm: 120, h_mm: 80.5 },
  { slot: "back-2", w_mm: 120, h_mm: 80.5 },
  { slot: "back-3", w_mm: 60, h_mm: 40 },
];
const PLAN = (pages: 4 | 8 | 16, ads: boolean) => ({
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
const PLANS = [4, 8, 16].flatMap((p) => [PLAN(p as 4 | 8 | 16, true), PLAN(p as 4 | 8 | 16, false)]);

async function readyProfile(org: Org) {
  const user = await n.userId(org.owner);
  const upload = await su.query<{ id: string }>(
    `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
     values ($1, $2, $3, 'engine_dataset', 'application/zip', 10, now()) returning id`,
    [org.orgId, org.pubId, user],
  );
  await su.query(
    `insert into app.engine_profile (org_id, publication_id, version, state, upload_id, dataset_version_id,
       dataset_sha256, dataset_bytes, config_version_id, config_sha256, engine_version, templates, grid, plans,
       created_by)
     values ($1, $2, 1, 'ready', $3, 'v-dataset', $4, 10, 'v-config', $5, 'fictional-engine 1', '{"front": "page1"}',
       $6, $7, $8)`,
    [
      org.orgId,
      org.pubId,
      upload.rows[0]?.id,
      "d".repeat(64),
      "e".repeat(64),
      JSON.stringify({ columns: 8, column_width_mm: 32, gutter_mm: 4 }),
      JSON.stringify(PLANS),
      user,
    ],
  );
}

let days = 0;
/** A new fictional date: each test its own. */
const day = () => `2027-03-${String(++days).padStart(2, "0")}`;

/** An edition of org a on the date, made as the superuser. */
async function edition(date: string, o: { pages?: number; ads?: boolean; status?: string } = {}): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages, back_page_ads, status)
     values ($1, $2, $3::date, $3::text, $4, $5, $6) returning id`,
    [a.orgId, a.pubId, date, o.pages ?? 8, o.ads ?? true, o.status ?? "planning"],
  );
  return rows[0]?.id ?? "";
}

let pictures = 0;
/** A picture of the library (its pixel size as stored for the asset). */
async function picture(w: number, h: number, org = a, status = "ready") {
  const k = ++pictures;
  const { rows } = await su.query<{ id: string }>(
    `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, status,
       uploaded_by, version_id)
     values ($1, $2, $3, $4, 1000, 'image/jpeg', $5, $6, $7, $8, 'v-original') returning id`,
    [
      org.orgId,
      org.pubId,
      `p-${k.toString(16).padStart(10, "0")}`,
      `${k}`.padStart(64, "0"),
      w,
      h,
      status,
      org === a ? ownerId : await n.userId(org.owner),
    ],
  );
  return rows[0]?.id ?? "";
}
/** Fits 120 × 80.5 mm at more than 200 ppi. */
const goodPicture = () => picture(1000, 671);

let advertisers = 0;
async function advertiser(): Promise<string> {
  const res = await call("POST", `${base()}/advertisers`, advertising.cookie, {
    name: `Example Jewellers ${++advertisers}`,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

type BookingBody = { wMm?: number; hMm?: number; slot?: string | null; dates: string[] };
async function book(advertiserId: string, o: BookingBody) {
  const res = await change("POST", `${base()}/bookings`, advertising.cookie, {
    advertiserId,
    wMm: o.wMm ?? 120,
    hMm: o.hMm ?? 80.5,
    colour: "colour",
    slot: o.slot ?? null,
    dates: o.dates,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; placements: { editionId: string; slot: string }[] };
}

const plan = async (e: string, cookie = advertising.cookie) => {
  const res = await call("GET", `${base()}/editions/${e}/plan`, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
type Tile = { page: number; slots: { slot: string; booking: { id: string } | null; artwork: string }[] };
const slotOf = (p: { tiles: Tile[] }, slot: string) => p.tiles.flatMap((t) => t.slots).find((s) => s.slot === slot);
const placements = async (e: string) =>
  (
    await su.query<{ slot: string; booking_id: string }>(
      "select slot, booking_id from app.ad_placement where edition_id = $1 order by slot",
      [e],
    )
  ).rows.map((r) => [r.slot, r.booking_id]);
const artworkOf = async (e: string, slot: string) =>
  (
    await su.query<{ id: string; asset_id: string; state: string }>(
      "select id, asset_id, state from app.ad_slot_artwork where edition_id = $1 and slot = $2",
      [e, slot],
    )
  ).rows[0];
const jobOf = async (artworkId: string) =>
  (
    await su.query<{ payload: Record<string, unknown> }>("select payload from queue._private_jobs where key = $1", [
      `ad:${artworkId}`,
    ])
  ).rows[0];

// ------------------------------------------------------------------------------------------------ the tests

describe("advertisers and sizes", () => {
  it("lists the profile's back-page slots, to those who see the ads desk", async () => {
    const res = await call("GET", `${base()}/ads/sizes`, editor.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().slots).toEqual([
      { slot: "back-1", wMm: 120, hMm: 80.5 },
      { slot: "back-2", wMm: 120, hMm: 80.5 },
      { slot: "back-3", wMm: 60, hMm: 40 },
    ]);
    expect((await call("GET", `${base()}/ads/sizes`, reporter.cookie)).statusCode).toBe(403);
    // another paper without a profile has no sizes
    expect((await call("GET", `${base(b)}/ads/sizes`, b.ownerCookie)).json()).toEqual({ profile: null, slots: [] });
  });

  it("are made by Advertising, one name each, archived to free it; never seen by another organisation", async () => {
    const made = await call("POST", `${base()}/advertisers`, advertising.cookie, {
      name: "Example Sweets",
      phone: "000 0000",
    });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ name: "Example Sweets", phone: "000 0000", archived: false, bookings: 0 });
    const id = made.json().id;
    const twice = await call("POST", `${base()}/advertisers`, advertising.cookie, { name: "example SWEETS" });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe("advertiser_exists");
    expect((await call("POST", `${base()}/advertisers`, editor.cookie, { name: "Example Other" })).statusCode).toBe(
      403,
    );
    const archived = await call("PATCH", `${base()}/advertisers/${id}`, advertising.cookie, { archived: true });
    expect(archived.json()).toMatchObject({ archived: true });
    expect(
      (await call("POST", `${base()}/advertisers`, advertising.cookie, { name: "Example Sweets" })).statusCode,
    ).toBe(201);
    // unarchiving now meets the new one's name
    expect(
      (await call("PATCH", `${base()}/advertisers/${id}`, advertising.cookie, { archived: false })).statusCode,
    ).toBe(409);
    const list = (await call("GET", `${base()}/advertisers`, editor.cookie)).json().items;
    expect(list.at(-1)).toMatchObject({ id, archived: true });
    expect((await call("GET", `${base()}/advertisers`, reporter.cookie)).statusCode).toBe(403);
    expect((await call("GET", `${base(b)}/advertisers`, b.ownerCookie)).json().items).toEqual([]);
    expect(
      (await call("PATCH", `${base(b)}/advertisers/${id}`, b.ownerCookie, { name: "Example Taken" })).statusCode,
    ).toBe(404);
    expect((await call("PATCH", `${base()}/advertisers/${id}`, b.ownerCookie, { note: "x" })).statusCode).toBe(404);
  });
});

describe("a booking", () => {
  it("is for a size of the profile's slots, and a named slot of that size; Advertising books, the editor views", async () => {
    const v = await advertiser();
    const body = (o: Partial<BookingBody & { advertiserId: string }>) => ({
      advertiserId: v,
      wMm: 120,
      hMm: 80.5,
      colour: "mono",
      slot: null,
      dates: [day()],
      ...o,
    });
    const odd = await change("POST", `${base()}/bookings`, advertising.cookie, body({ wMm: 100 }));
    expect(odd.statusCode).toBe(400);
    expect(odd.json().error.details[0].field).toBe("body.wMm");
    const wrongSlot = await change("POST", `${base()}/bookings`, advertising.cookie, body({ slot: "back-3" }));
    expect(wrongSlot.statusCode).toBe(400);
    expect(wrongSlot.json().error.details[0].field).toBe("body.slot");
    expect((await change("POST", `${base()}/bookings`, editor.cookie, body({}))).statusCode).toBe(403);
    // within 0.01 mm
    const key = randomUUID();
    const close = body({ wMm: 120.01 });
    const ok = await change("POST", `${base()}/bookings`, advertising.cookie, close, key);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ wMm: 120.01, colour: "mono", status: "booked", artwork: null, placements: [] });
    const again = await change("POST", `${base()}/bookings`, advertising.cookie, close, key);
    expect(again.json().id).toBe(ok.json().id);
    const list = await call("GET", `${base()}/bookings`, editor.cookie);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((x: { id: string }) => x.id)).toContain(ok.json().id);
    expect((await call("GET", `${base()}/bookings`, reporter.cookie)).statusCode).toBe(403);
    expect((await call("GET", `${base(b)}/bookings`, b.ownerCookie)).json().items).toEqual([]);
    // another organisation's advertiser is not this paper's
    const theirs = await change("POST", `${base()}/bookings`, advertising.cookie, body({ advertiserId: randomUUID() }));
    expect(theirs.statusCode).toBe(400);
  });

  it("is placed by its rule in the order booked: a named slot, any slot, slots taken, no ad pages", async () => {
    const date = day();
    const e = await edition(date);
    const v = await advertiser();
    const any1 = await book(v, { dates: [date] });
    expect(any1.placements).toEqual([{ editionId: e, date, slot: "back-1" }]);
    const named1 = await book(v, { dates: [date], slot: "back-1" });
    const any2 = await book(v, { dates: [date] });
    const small = await book(v, { dates: [date], wMm: 60, hMm: 40 });
    const any3 = await book(v, { dates: [date] });
    expect(await placements(e)).toEqual([
      ["back-1", any1.id],
      ["back-2", any2.id],
      ["back-3", small.id],
    ]);
    const p = await plan(e, editor.cookie);
    expect(p).toMatchObject({ pages: 8, backPageAds: true, released: false });
    expect(p.tiles).toHaveLength(8);
    expect(slotOf(p, "back-1")).toMatchObject({
      booking: { id: any1.id, slot: null, artwork: "none" },
      artwork: "empty",
    });
    // without ads.view (a Sub Editor): the plan without its bookings
    const bare = await plan(e, sub.cookie);
    expect(bare.tiles).toHaveLength(8);
    expect(slotOf(bare, "back-1")).toMatchObject({ booking: null, artwork: "empty" });
    expect(bare.unplaced).toEqual([]);
    expect(p.unplaced.map((u: { booking: { id: string }; reason: string }) => [u.booking.id, u.reason])).toEqual([
      [named1.id, "slots_taken"],
      [any3.id, "slots_taken"],
    ]);
    expect(p.cutoff.at).toMatch(/^2027-03-/);
    // an edition without back-page ads
    const date2 = day();
    const plain = await edition(date2, { ads: false });
    await book(v, { dates: [date2] });
    expect((await plan(plain)).unplaced[0].reason).toBe("no_ad_pages");
    expect(await placements(plain)).toEqual([]);
    // cancelling the first frees back-1 for the one named for it
    const cancelled = await call("PATCH", `${base()}/bookings/${any1.id}`, advertising.cookie, { status: "cancelled" });
    expect(cancelled.json()).toMatchObject({ status: "cancelled", placements: [] });
    // the slot it frees waits for Place (a change of one booking never places the others)
    expect(await placements(e)).toEqual([
      ["back-2", any2.id],
      ["back-3", small.id],
    ]);
    await call("POST", `${base()}/editions/${e}/plan/place`, advertising.cookie);
    expect(await placements(e)).toEqual([
      ["back-1", named1.id],
      ["back-2", any2.id],
      ["back-3", small.id],
    ]);
    // a date moved: out of this edition, into the other date's
    const date3 = day();
    const other = await edition(date3);
    const moved = await call("PATCH", `${base()}/bookings/${any2.id}`, advertising.cookie, { dates: [date3] });
    expect(moved.json().placements).toEqual([{ editionId: other, date: date3, slot: "back-1" }]);
    expect(await placements(e)).toEqual([
      ["back-1", named1.id],
      ["back-3", small.id],
    ]);
    await call("POST", `${base()}/editions/${e}/plan/place`, advertising.cookie);
    expect((await placements(e)).map(([slot, id]) => [slot, id])).toEqual([
      ["back-1", named1.id],
      ["back-2", any3.id],
      ["back-3", small.id],
    ]);
    // the plan is refused to a reporter, and found by nobody else
    expect((await call("GET", `${base()}/editions/${e}/plan`, reporter.cookie)).statusCode).toBe(403);
    expect((await call("GET", `${base(b)}/editions/${e}/plan`, b.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", `${base()}/editions/${e}/plan`, b.ownerCookie)).statusCode).toBe(404);
  });
});

describe("a booking's artwork", () => {
  it("is checked: a picture of the wrong shape is flagged and not placed; a good one fills its slot", async () => {
    const date = day();
    const e = await edition(date);
    const v = await advertiser();
    const booking = await book(v, { dates: [date] });
    const wrong = await picture(2000, 1500);
    const flagged = await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, {
      assetId: wrong,
    });
    expect(flagged.statusCode, flagged.body).toBe(200);
    expect(flagged.json().artwork).toMatchObject({ assetId: wrong, passed: false });
    expect(flagged.json().artwork.checks[0]).toMatchObject({ check: "shape", state: "failed" });
    expect(await artworkOf(e, "back-1")).toBeUndefined();
    expect(slotOf(await plan(e), "back-1")?.booking).toMatchObject({ artwork: "failed" });

    const good = await goodPicture();
    const set = await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, { assetId: good });
    expect(set.json().artwork).toMatchObject({ assetId: good, passed: true, status: "ready" });
    const art = await artworkOf(e, "back-1");
    expect(art).toMatchObject({ asset_id: good, state: "preparing" });
    expect((await jobOf(art?.id ?? ""))?.payload).toMatchObject({ asset_id: good, w_mm: "120.00", h_mm: "80.50" });
    // the same picture again: nothing new
    await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, { assetId: good });
    expect((await artworkOf(e, "back-1"))?.id).toBe(art?.id);
    expect(slotOf(await plan(e), "back-1")).toMatchObject({ booking: { artwork: "passed" }, artwork: "preparing" });

    // the L2.3 slot route refuses a booked slot
    const plainPut = await call("PUT", `${base()}/editions/${e}/ads/back-1`, a.ownerCookie, { assetId: good });
    expect(plainPut.statusCode).toBe(409);
    expect(plainPut.json().error.code).toBe("slot_booked");
    expect((await call("DELETE", `${base()}/editions/${e}/ads/back-1`, a.ownerCookie)).statusCode).toBe(409);
    expect((await call("PUT", `${base()}/editions/${e}/ads/back-2`, a.ownerCookie, { assetId: good })).statusCode).toBe(
      200,
    );
    // a picture set by the L2.3 route shows its state though no booking holds the slot
    expect(slotOf(await plan(e), "back-2")).toMatchObject({ booking: null, artwork: "preparing" });

    // taken off: out of the slot
    const off = await call("DELETE", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie);
    expect(off.json().artwork).toBeNull();
    expect(await artworkOf(e, "back-1")).toBeUndefined();
    // a refused picture, or another paper's, is not taken
    const refused = await picture(1000, 671, a, "rejected");
    expect(
      (await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, { assetId: refused }))
        .statusCode,
    ).toBe(400);
    const theirs = await picture(1000, 671, b);
    expect(
      (await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, { assetId: theirs }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call("PUT", `${base(b)}/bookings/${booking.id}/artwork`, b.ownerCookie, { assetId: theirs })).statusCode,
    ).toBe(404);
  });

  it("never changes a released edition", async () => {
    const date = day();
    const e = await edition(date);
    const v = await advertiser();
    const booking = await book(v, { dates: [date] });
    await su.query("update app.edition set status = 'released' where id = $1", [e]);
    const good = await goodPicture();
    await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, { assetId: good });
    expect(await artworkOf(e, "back-1")).toBeUndefined();
    await call("PATCH", `${base()}/bookings/${booking.id}`, advertising.cookie, { status: "cancelled" });
    expect(await placements(e)).toEqual([["back-1", booking.id]]);
    const later = await edition(day(), { status: "released" });
    const p = await plan(e);
    expect(p.released).toBe(true);
    expect(slotOf(p, "back-1")?.booking?.id).toBe(booking.id);
    for (const [method, url, payload] of [
      ["POST", `editions/${e}/plan/place`, undefined],
      ["PUT", `editions/${e}/plan/slots/back-2`, { bookingId: booking.id }],
      ["DELETE", `editions/${e}/plan/slots/back-1`, undefined],
    ] as const) {
      const res = await call(method, `${base()}/${url}`, editor.cookie, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(409);
      expect(res.json().error.code).toBe("not_editable");
    }
    const copy = await call("POST", `${base()}/editions/${later}/plan/copy`, chief.cookie, { fromEditionId: e });
    expect(copy.statusCode).toBe(409);
  });
});

describe("a plan", () => {
  it("takes a booking in a slot by hand (the newer choice wins), and out again", async () => {
    const date = day();
    const e = await edition(date);
    const v = await advertiser();
    const first = await book(v, { dates: [date], slot: "back-1" });
    const second = await book(v, { dates: [date] });
    const small = await book(v, { dates: [date], wMm: 60, hMm: 40 });
    expect(await placements(e)).toEqual([
      ["back-1", first.id],
      ["back-2", second.id],
      ["back-3", small.id],
    ]);
    // the size and the named slot must fit
    const unfit = await call("PUT", `${base()}/editions/${e}/plan/slots/back-2`, editor.cookie, {
      bookingId: small.id,
    });
    expect(unfit.statusCode).toBe(400);
    expect(
      (await call("PUT", `${base()}/editions/${e}/plan/slots/back-2`, editor.cookie, { bookingId: first.id }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call("PUT", `${base()}/editions/${e}/plan/slots/back-9`, editor.cookie, { bookingId: first.id }))
        .statusCode,
    ).toBe(404);
    // the editor (layout.generate) moves the second into back-1: the first, named for it, has nowhere to go
    const put = await call("PUT", `${base()}/editions/${e}/plan/slots/back-1`, editor.cookie, {
      bookingId: second.id,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(await placements(e)).toEqual([
      ["back-1", second.id],
      ["back-3", small.id],
    ]);
    expect(put.json().unplaced).toEqual([expect.objectContaining({ reason: "slots_taken" })]);
    const { rows } = await su.query(
      "select placed_by from app.ad_placement where edition_id = $1 and slot = 'back-1'",
      [e],
    );
    expect(rows[0].placed_by).not.toBeNull();
    // taken out: free to be placed again
    const out = await call("DELETE", `${base()}/editions/${e}/plan/slots/back-3`, advertising.cookie);
    expect(out.json().unplaced.map((u: { reason: string }) => u.reason)).toEqual(["slots_taken", "taken_out"]);
    expect((await call("DELETE", `${base()}/editions/${e}/plan/slots/back-3`, reporter.cookie)).statusCode).toBe(403);
    expect((await call("DELETE", `${base()}/editions/${e}/plan/slots/back-9`, editor.cookie)).statusCode).toBe(404);
    expect((await call("POST", `${base()}/editions/${e}/plan/place`, reporter.cookie)).statusCode).toBe(403);
    const placed = await call("POST", `${base()}/editions/${e}/plan/place`, advertising.cookie);
    expect(placed.statusCode).toBe(200);
    expect(await placements(e)).toEqual([
      ["back-1", second.id],
      ["back-3", small.id],
    ]);
    const actions = await su.query<{ action: string }>(
      "select action from app.audit_event where target_id = $1 order by at",
      [e],
    );
    expect(new Set(actions.rows.map((r) => r.action))).toEqual(new Set(["ad_placement.set", "ad_placement.clear"]));
  });

  it("keeps each page's section and note, copies them and the placements to another edition", async () => {
    const date = day();
    const e = await edition(date);
    const section = (
      await su.query<{ id: string }>(
        "insert into app.section (org_id, publication_id, name) values ($1, $2, 'Example City') returning id",
        [a.orgId, a.pubId],
      )
    ).rows[0]?.id;
    const set = await call("PUT", `${base()}/editions/${e}/plan/pages/2`, editor.cookie, {
      sectionId: section,
      note: "Lead with the fictional fair",
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().sections).toContainEqual({ id: section, name: "Example City" });
    expect(set.json().tiles[1]).toMatchObject({
      page: 2,
      role: "inside",
      section: { id: section, name: "Example City" },
      note: "Lead with the fictional fair",
      placed: null,
    });
    // Advertising's cell is scoped: not the plan's pages
    expect(
      (await call("PUT", `${base()}/editions/${e}/plan/pages/2`, advertising.cookie, { sectionId: null, note: "" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call("PUT", `${base()}/editions/${e}/plan/pages/9`, editor.cookie, { sectionId: null, note: "" }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call("PUT", `${base()}/editions/${e}/plan/pages/2`, editor.cookie, {
          sectionId: randomUUID(),
          note: "",
        })
      ).statusCode,
    ).toBe(400);
    // a booking on both dates, placed by hand in back-2 here; a booking only on this date
    const date2 = day();
    const v = await advertiser();
    const both = await book(v, { dates: [date, date2] });
    const onlyHere = await book(v, { dates: [date] });
    await call("PUT", `${base()}/editions/${e}/plan/slots/back-2`, editor.cookie, { bookingId: both.id });
    // the booking it replaced is not put elsewhere: it waits for Place
    expect(await placements(e)).toEqual([["back-2", both.id]]);
    expect((await plan(e)).unplaced).toEqual([
      expect.objectContaining({ booking: expect.objectContaining({ id: onlyHere.id }), reason: "taken_out" }),
    ]);
    const target = await edition(date2);
    expect((await call("POST", `${base()}/editions/${target}/plan/place`, editor.cookie)).statusCode).toBe(200);
    expect(await placements(target)).toEqual([["back-1", both.id]]);
    const copied = await call("POST", `${base()}/editions/${target}/plan/copy`, chief.cookie, { fromEditionId: e });
    expect(copied.statusCode, copied.body).toBe(200);
    expect(copied.json().copied).toEqual({ pages: 1, placements: 1 });
    expect(copied.json().plan.tiles[1].section).toEqual({ id: section, name: "Example City" });
    expect(await placements(target)).toEqual([["back-2", both.id]]);
    // another number of pages, or itself, is refused; Advertising may not copy
    const four = await edition(day(), { pages: 4 });
    expect(
      (await call("POST", `${base()}/editions/${four}/plan/copy`, chief.cookie, { fromEditionId: e })).statusCode,
    ).toBe(400);
    expect(
      (await call("POST", `${base()}/editions/${e}/plan/copy`, chief.cookie, { fromEditionId: e })).statusCode,
    ).toBe(400);
    expect(
      (await call("POST", `${base()}/editions/${target}/plan/copy`, advertising.cookie, { fromEditionId: e }))
        .statusCode,
    ).toBe(403);
    const audit = await su.query("select data from app.audit_event where action = 'plan.copy' and target_id = $1", [
      target,
    ]);
    expect(audit.rows[0].data).toMatchObject({ from: e, pages: 1, placements: 1 });
  });

  it("is filled at once when an edition is made for a booked date", async () => {
    const date = day();
    const v = await advertiser();
    const booking = await book(v, { dates: [date] });
    const good = await goodPicture();
    await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, { assetId: good });
    const made = await change("POST", `${base()}/editions`, chief.cookie, { date, pages: 8 });
    expect(made.statusCode, made.body).toBe(201);
    const e = made.json().id;
    expect(await placements(e)).toEqual([["back-1", booking.id]]);
    expect(await artworkOf(e, "back-1")).toMatchObject({ asset_id: good, state: "preparing" });
    const list = (await call("GET", `${base()}/bookings`, editor.cookie)).json().items;
    expect(list.find((x: { id: string }) => x.id === booking.id).placements).toEqual([
      { editionId: e, date, slot: "back-1" },
    ]);
  });
});

describe("a booking's picture refused later", () => {
  it("leaves the slots the booking holds; the booking shows its artwork failed", async () => {
    const date = day();
    const e = await edition(date);
    const booking = await book(await advertiser(), { dates: [date] });
    const received = await picture(1000, 671, a, "received");
    await call("PUT", `${base()}/bookings/${booking.id}/artwork`, advertising.cookie, { assetId: received });
    expect(await artworkOf(e, "back-1")).toMatchObject({ asset_id: received });
    // the engine refuses the picture (as the queue reports it)
    const engine = await db.connect("engine");
    try {
      const { rows } = await su.query<{ sha256: string }>("select sha256 from app.asset where id = $1", [received]);
      const event = {
        kind: "media.rejected",
        org_id: a.orgId,
        pub_id: a.pubId,
        asset_id: received,
        sha256: rows[0]?.sha256,
        code: "m.img.damaged",
        message: "The picture file is damaged or incomplete. Try saving it again.",
        status: 400,
      };
      await engine.query(
        "insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, $3, $4, $5)",
        [a.orgId, randomUUID(), event.kind, received, JSON.stringify(event)],
      );
    } finally {
      await engine.end();
    }
    const log = {
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
    } as unknown as FastifyBaseLogger;
    await drainInbox(it_.database, log);
    expect(await artworkOf(e, "back-1")).toBeUndefined();
    expect(await placements(e)).toEqual([["back-1", booking.id]]);
    expect(slotOf(await plan(e), "back-1")).toMatchObject({ booking: { artwork: "failed" }, artwork: "empty" });
  });
});

describe("two changes at once", () => {
  it("a booking changed while it is put in a slot: both answered, no deadlock", async () => {
    const v = await advertiser();
    for (let k = 0; k < 6; k += 1) {
      const date = day();
      const e = await edition(date);
      const booking = await book(v, { dates: [date] });
      const [patched, put] = await Promise.all([
        call("PATCH", `${base()}/bookings/${booking.id}`, advertising.cookie, { note: `Fictional note ${k}` }),
        call("PUT", `${base()}/editions/${e}/plan/slots/back-2`, advertising.cookie, { bookingId: booking.id }),
      ]);
      expect([patched.statusCode, put.statusCode], `${patched.body} ${put.body}`).toEqual([200, 200]);
    }
  });
});
