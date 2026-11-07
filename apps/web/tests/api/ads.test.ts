/**
 * The real ads service over a recording fetch (L2.6): each call's method, path and body as the contract's header lists
 * them, the booking's Idempotency-Key, answers read with the contract's schemas (a wrong shape is unexpected_answer),
 * and a refusal passed on with its code. Fictional.
 */
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiAdsService } from "../../src/api/ads-service.ts";
import { fakeFetch, json } from "./fake-fetch.ts";

const O = { orgId: "o", pubId: "p" };
const BASE = "/api/v1/orgs/o/pubs/p";
const ID = "01900000-0000-7000-8000-000000000001";
const AT = "2026-10-24T10:00:00.000+05:30";
const ADVERTISER = {
  id: ID,
  name: "Example Jewellers",
  contactName: "",
  phone: "",
  email: "",
  note: "",
  archived: false,
  bookings: 0,
  createdAt: AT,
};
const BOOKING = {
  id: ID,
  advertiser: { id: ID, name: "Example Jewellers" },
  campaign: "",
  wMm: 162,
  hMm: 100,
  colour: "colour",
  slot: null,
  dates: ["2026-10-24"],
  status: "booked",
  note: "",
  artwork: null,
  placements: [],
  createdBy: null,
  createdAt: AT,
  updatedAt: AT,
};
const PLAN = {
  editionId: ID,
  date: "2026-10-24",
  pages: 8,
  backPageAds: true,
  released: false,
  profile: null,
  tiles: [],
  sections: [],
  unplaced: [],
  cutoff: { at: AT, alertedAt: null },
};
const INPUT = { advertiserId: ID, wMm: 162, hMm: 100, colour: "colour" as const, slot: null, dates: ["2026-10-24"] };

const path = (url: string) => {
  const parsed = new URL(url, "http://x");
  return parsed.pathname + parsed.search;
};

describe("the ads service", () => {
  it("calls each route with its method and body, and reads each answer", async () => {
    const answers = [
      { profile: null, slots: [{ slot: "back-2", wMm: 162, hMm: 100 }] },
      { cutoffTime: "18:00", daysBefore: 1 },
      { cutoffTime: "17:30", daysBefore: 2 },
      { items: [ADVERTISER] },
      ADVERTISER,
      { ...ADVERTISER, archived: true },
      { items: [BOOKING] },
      { items: [] },
      BOOKING,
      BOOKING,
      BOOKING,
      BOOKING,
      PLAN,
      PLAN,
      PLAN,
      PLAN,
      PLAN,
      { plan: PLAN, copied: { pages: 3, placements: 1 } },
    ];
    const { fetch, calls } = fakeFetch(() => json(200, answers.shift()));
    const ads = createApiAdsService(createApiClient({ fetch }));
    const E = { ...O, editionId: "e" };
    const results = [
      await ads.sizes(O),
      await ads.settings(O),
      await ads.saveSettings({ ...O, settings: { cutoffTime: "17:30", daysBefore: 2 } }),
      await ads.advertisers(O),
      await ads.addAdvertiser({ ...O, input: { name: "Example Jewellers" } }),
      await ads.editAdvertiser({ ...O, id: "a", patch: { archived: true } }),
      await ads.bookings({ ...O, from: "2026-10-24", to: "2026-10-24" }),
      await ads.bookings(O),
      await ads.book({ ...O, input: INPUT, idempotencyKey: "k" }),
      await ads.editBooking({ ...O, id: "b", patch: { status: "cancelled" } }),
      await ads.setArtwork({ ...O, id: "b", assetId: ID }),
      await ads.clearArtwork({ ...O, id: "b" }),
      await ads.plan(E),
      await ads.placeBooked(E),
      await ads.place({ ...E, slot: "back-2", bookingId: ID }),
      await ads.unplace({ ...E, slot: "back-2" }),
      await ads.planPage({ ...E, page: 3, sectionId: null, note: "Local news" }),
      await ads.copyPlan({ ...E, fromEditionId: ID }),
    ];
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[3]).toEqual({ ok: true, value: [ADVERTISER] });
    expect(calls.map((c) => [c.method, path(c.url), c.body])).toEqual([
      ["GET", `${BASE}/ads/sizes`, undefined],
      ["GET", `${BASE}/ads/settings`, undefined],
      ["PUT", `${BASE}/ads/settings`, { cutoffTime: "17:30", daysBefore: 2 }],
      ["GET", `${BASE}/advertisers`, undefined],
      ["POST", `${BASE}/advertisers`, { name: "Example Jewellers" }],
      ["PATCH", `${BASE}/advertisers/a`, { archived: true }],
      ["GET", `${BASE}/bookings?from=2026-10-24&to=2026-10-24`, undefined],
      ["GET", `${BASE}/bookings`, undefined],
      ["POST", `${BASE}/bookings`, INPUT],
      ["PATCH", `${BASE}/bookings/b`, { status: "cancelled" }],
      ["PUT", `${BASE}/bookings/b/artwork`, { assetId: ID }],
      ["DELETE", `${BASE}/bookings/b/artwork`, undefined],
      ["GET", `${BASE}/editions/e/plan`, undefined],
      ["POST", `${BASE}/editions/e/plan/place`, {}],
      ["PUT", `${BASE}/editions/e/plan/slots/back-2`, { bookingId: ID }],
      ["DELETE", `${BASE}/editions/e/plan/slots/back-2`, undefined],
      ["PUT", `${BASE}/editions/e/plan/pages/3`, { sectionId: null, note: "Local news" }],
      ["POST", `${BASE}/editions/e/plan/copy`, { fromEditionId: ID }],
    ]);
    expect(calls[8]!.headers.get("Idempotency-Key")).toBe("k");
  });

  it("calls a wrong shape unexpected, and passes a refusal on with its code", async () => {
    const answers = [
      json(200, { ...PLAN, unplaced: [{ booking: {}, reason: "inside_page" }] }),
      json(409, { error: { code: "advertiser_exists", message: "Exists.", requestId: "q" } }),
      json(409, { error: { code: "not_editable", message: "Released.", requestId: "q" } }),
    ];
    const ads = createApiAdsService(createApiClient({ fetch: fakeFetch(() => answers.shift()!).fetch }));
    expect(await ads.plan({ ...O, editionId: "e" })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
    expect(await ads.addAdvertiser({ ...O, input: { name: "Example Jewellers" } })).toMatchObject({
      ok: false,
      error: { status: 409, code: "advertiser_exists" },
    });
    expect(await ads.placeBooked({ ...O, editionId: "e" })).toMatchObject({
      ok: false,
      error: { status: 409, code: "not_editable" },
    });
  });
});
