// The ads desk's and the edition plan's routes (docs/product/10-l2-newsroom-plan.md §1 L2.6; packages/contracts/src/
// ads.ts, whose header lists every route and rule), under /api/v1/orgs/:o/pubs/:p: ads/sizes, advertisers, bookings
// (their artwork), and editions/:e/plan (placing, a slot's placement, a page's section and note, copying a plan). The
// cut-off settings and alert are src/modules/ads/cutoff.ts's. Placement itself is ./place.ts.
import {
  AdSizes,
  Advertiser,
  AdvertiserInput,
  AdvertiserList,
  AdvertiserPatch,
  Booking,
  BookingArtworkInput,
  BookingInput,
  BookingList,
  BookingPatch,
  BookingQuery,
  CopyPlanInput,
  CopyPlanResult,
  EditionPlan,
  type Permission,
  PlacementInput,
  type PlanPage,
  PlanPageInput,
  reach,
} from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { cutoffOf } from "../../db/ad-cutoff.ts";
import {
  type AdvertiserRow,
  type BookingRow,
  activeSections,
  advertiserNamed,
  bookingsOfDate,
  createAdvertiser,
  createBooking,
  editionPlacements,
  findAdvertiser,
  findBooking,
  findSection,
  flatplanPages,
  listAdvertisers,
  listBookings,
  placedSections,
  setBookingArtwork,
  setFlatplanPage,
  updateAdvertiser,
  updateBooking,
} from "../../db/ads.ts";
import { recordAudit } from "../../db/audit.ts";
import { editionArtwork, profileInUse } from "../../db/layout.ts";
import { findAsset } from "../../db/media.ts";
import type { Database } from "../../db/pools.ts";
import { boardRun } from "../../db/release.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf, auditRefusals, refused } from "../access/access.ts";
import { idempotent } from "../requests/idempotency.ts";
import {
  adSizes,
  artworkOf,
  artworkState,
  editionSlots,
  fits,
  placeBooked,
  putPlacement,
  reasonOf,
  rule,
  sameSize,
  syncBooking,
  takeOut,
} from "./place.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE = "/api/v1/orgs/:o/pubs/:p";
/** At most this many bookings a list (a year of a daily's bookings, about). */
export const BOOKINGS_SHOWN = 400;

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneId = z.strictObject({ o: z.string(), p: z.string(), id: z.string() });
const OneEdition = z.strictObject({ o: z.string(), p: z.string(), e: z.string() });
const OneSlot = z.strictObject({ o: z.string(), p: z.string(), e: z.string(), slot: z.string() });
const OnePage = z.strictObject({ o: z.string(), p: z.string(), e: z.string(), n: z.string() });

export type AdsOptions = { database: Database };

const may = (access: Access, pub: string, permission: Permission) =>
  reach(permission, access.orgRole, access.publications.get(pub) ?? { roles: [], grants: [] }) !== null;

const iso = (moment: Date) => moment.toISOString();

function advertiserView(row: AdvertiserRow): Advertiser {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    note: row.note,
    archived: row.archived_at !== null,
    bookings: row.bookings,
    createdAt: iso(row.created_at),
  };
}

function bookingView(row: BookingRow): Booking {
  const art = artworkOf(row);
  return {
    id: row.id,
    advertiser: { id: row.advertiser_id, name: row.advertiser_name },
    campaign: row.campaign,
    wMm: Number(row.w_mm),
    hMm: Number(row.h_mm),
    colour: row.colour,
    slot: row.slot,
    dates: row.dates,
    status: row.status,
    note: row.note,
    artwork:
      art && row.artwork_asset_id && row.artwork_set_at
        ? {
            assetId: row.artwork_asset_id,
            widthPx: art.asset.width_px,
            heightPx: art.asset.height_px,
            status: art.asset.status,
            passed: art.passed,
            checks: art.checks,
            setBy:
              row.artwork_set_by && row.artwork_set_by_name !== null
                ? { id: row.artwork_set_by, name: row.artwork_set_by_name }
                : null,
            setAt: iso(row.artwork_set_at),
          }
        : null,
    placements: row.placements,
    createdBy: row.created_by_name !== null ? { id: row.created_by, name: row.created_by_name } : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const bookingRef = (row: BookingRow) => ({
  id: row.id,
  advertiser: row.advertiser_name,
  campaign: row.campaign,
  wMm: Number(row.w_mm),
  hMm: Number(row.h_mm),
  colour: row.colour,
  slot: row.slot,
  artwork: artworkState(row),
});

const invalid = (field: string, message: string) => new ApiError("invalid_request", [{ field, message }]);

/** The booking's size and slot rule, checked against the profile in use's back-page slots (400 otherwise). */
async function checkSize(tx: Tx, pub: string, size: { wMm: number; hMm: number; slot: string | null }) {
  const profile = await profileInUse(tx, pub);
  const sizes = adSizes(profile?.plans ?? null);
  if (sizes.length === 0) throw invalid("body.wMm", "This paper has no back-page ad slots ready yet.");
  if (!sizes.some((s) => sameSize(size, s)))
    throw invalid("body.wMm", "This size is not the size of any back-page ad slot.");
  if (size.slot !== null && !sizes.some((s) => s.slot === size.slot && fits(size, s)))
    throw invalid("body.slot", "This slot is not one of the back-page ad slots of this size.");
}

/** The edition's plan as the routes answer it; the bookings (advertisers, campaigns, artwork) only to ads.view. */
async function planView(tx: Tx, pub: string, editionId: string, ads: boolean): Promise<EditionPlan> {
  const found = await editionSlots(tx, pub, editionId, false);
  if (!found) throw new ApiError("not_found");
  const { edition, plan, profile, slots, released } = found;
  const placements = await editionPlacements(tx, pub, editionId);
  const ofDate = await bookingsOfDate(tx, pub, edition.date);
  const bookings = new Map(ofDate.map((b) => [b.id, b]));
  // a placement's booking no longer of the date (a released edition keeps what it printed)
  for (const p of placements) {
    if (bookings.has(p.booking_id)) continue;
    const row = await findBooking(tx, pub, p.booking_id);
    if (row) bookings.set(row.id, row);
  }
  const taken = new Map(placements.map((p) => [p.slot, p.booking_id]));
  const artwork = await editionArtwork(tx, pub, editionId);
  const flat = new Map((await flatplanPages(tx, pub, editionId)).map((row) => [row.page_no, row]));
  const run = await boardRun(tx, pub, editionId);
  const placed = new Map(run ? (await placedSections(tx, pub, run.id)).map((row) => [row.page_no, row]) : []);
  const tiles: PlanPage[] = (plan?.page_plan ?? []).map((page) => {
    const f = flat.get(page.page);
    const p = placed.get(page.page);
    return {
      page: page.page,
      role: page.role,
      templateRole: page.template_role,
      section: f?.section_id && f.section_name !== null ? { id: f.section_id, name: f.section_name } : null,
      note: f?.note ?? "",
      placed: run ? { stories: p?.stories ?? 0, sections: p?.sections ?? [] } : null,
      slots: page.ad_slots.map((s) => {
        const held = taken.get(s.slot);
        const booking = held ? bookings.get(held) : undefined;
        return {
          slot: s.slot,
          wMm: s.w_mm,
          hMm: s.h_mm,
          booking: booking && ads ? bookingRef(booking) : null,
          artwork: artwork.find((a) => a.slot === s.slot)?.state ?? "empty",
        };
      }),
    };
  });
  const inEdition = new Set(taken.values());
  return {
    editionId,
    date: edition.date,
    pages: edition.pages,
    backPageAds: edition.back_page_ads,
    released,
    profile: profile ? { id: profile.id, version: profile.version } : null,
    tiles,
    sections: await activeSections(tx, pub),
    unplaced: (ads ? ofDate : [])
      .filter((b) => !inEdition.has(b.id))
      .map((b) => ({
        booking: bookingRef(b),
        reason: reasonOf(rule(b), slots, taken, { profile: profile !== undefined, backPageAds: edition.back_page_ads }),
      })),
    cutoff: await cutoffOf(tx, pub, edition.date),
  };
}

export const adsRoutes: FastifyPluginAsyncZod<AdsOptions> = async (app, { database }) => {
  auditRefusals(app, database);

  /** Placing in a plan: ads.manage or layout.generate. */
  const placer = (access: Access, pub: string) => {
    if (!may(access, pub, "ads.manage") && !may(access, pub, "layout.generate"))
      throw refused("a plan's ads are placed by ads.manage or layout.generate");
  };
  /** The edition's plan cells (07 §12 "Editions: create, Plan tab"): the whole cell only. */
  const planner = (access: Access) => {
    if (access.reach !== "full") throw refused("their role sets ad positions or the colour map, not the plan");
  };

  app.get(
    `${BASE}/ads/sizes`,
    { config: { permission: "ads.view" }, schema: { params: Pub, response: { 200: AdSizes } } },
    async (request) => {
      const access = accessOf(request);
      return database.withTenant(access.tenant, async (tx) => {
        const profile = await profileInUse(tx, request.params.p);
        return {
          profile: profile ? { id: profile.id, version: profile.version } : null,
          slots: adSizes(profile?.plans ?? null),
        };
      });
    },
  );

  // ------------------------------------------------------------------------------------------ advertisers

  app.get(
    `${BASE}/advertisers`,
    { config: { permission: "ads.view" }, schema: { params: Pub, response: { 200: AdvertiserList } } },
    async (request) => {
      const access = accessOf(request);
      const rows = await database.withTenant(access.tenant, (tx) => listAdvertisers(tx, request.params.p));
      return { items: rows.map(advertiserView) };
    },
  );

  app.post(
    `${BASE}/advertisers`,
    {
      config: { permission: "ads.manage" },
      schema: { params: Pub, body: AdvertiserInput, response: { 201: Advertiser } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const input = request.body;
      const view = await database.withTenant(access.tenant, async (tx) => {
        const fields = {
          name: input.name,
          contact_name: input.contactName ?? "",
          phone: input.phone ?? "",
          email: input.email ?? "",
          note: input.note ?? "",
        };
        const id = await createAdvertiser(tx, access.tenant, pub, fields);
        if (id === null) throw new ApiError("advertiser_exists");
        await recordAudit(tx, access.tenant, {
          action: "advertiser.create",
          targetType: "advertiser",
          targetId: id,
          publicationId: pub,
          data: { fields: Object.keys(input) },
        });
        const row = await findAdvertiser(tx, pub, id);
        if (!row) throw new Error("the advertiser just made is not found");
        return advertiserView(row);
      });
      return reply.status(201).send(view);
    },
  );

  app.patch(
    `${BASE}/advertisers/:id`,
    {
      config: { permission: "ads.manage" },
      schema: { params: OneId, body: AdvertiserPatch, response: { 200: Advertiser } },
    },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      const input = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const row = UUID.test(id) ? await findAdvertiser(tx, pub, id, true) : undefined;
        if (!row) throw new ApiError("not_found");
        const next = {
          name: input.name ?? row.name,
          contact_name: input.contactName ?? row.contact_name,
          phone: input.phone ?? row.phone,
          email: input.email ?? row.email,
          note: input.note ?? row.note,
          archived: input.archived ?? row.archived_at !== null,
        };
        if (!next.archived && (await advertiserNamed(tx, pub, next.name, id))) throw new ApiError("advertiser_exists");
        await updateAdvertiser(tx, pub, id, next);
        await recordAudit(tx, access.tenant, {
          action: "advertiser.edit",
          targetType: "advertiser",
          targetId: id,
          publicationId: pub,
          data: { fields: Object.keys(input) },
        });
        const now = await findAdvertiser(tx, pub, id);
        if (!now) throw new Error("the advertiser just changed is not found");
        return advertiserView(now);
      });
    },
  );

  // ------------------------------------------------------------------------------------------ bookings

  app.get(
    `${BASE}/bookings`,
    {
      config: { permission: "ads.view" },
      schema: { params: Pub, querystring: BookingQuery, response: { 200: BookingList } },
    },
    async (request) => {
      const access = accessOf(request);
      const rows = await database.withTenant(access.tenant, (tx) =>
        listBookings(tx, request.params.p, request.query, BOOKINGS_SHOWN),
      );
      return { items: rows.map(bookingView) };
    },
  );

  app.post(
    `${BASE}/bookings`,
    { config: { permission: "ads.manage" }, schema: { params: Pub, body: BookingInput, response: { 201: Booking } } },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const input = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const advertiser = await findAdvertiser(tx, pub, input.advertiserId);
          if (!advertiser || advertiser.archived_at !== null)
            throw invalid("body.advertiserId", "This advertiser is not one of this paper's, or is archived.");
          await checkSize(tx, pub, input);
          const id = await createBooking(tx, access.tenant, pub, input.advertiserId, {
            campaign: input.campaign ?? "",
            w_mm: input.wMm.toFixed(2),
            h_mm: input.hMm.toFixed(2),
            colour: input.colour,
            slot: input.slot,
            dates: [...input.dates].sort(),
            note: input.note ?? "",
          });
          await recordAudit(tx, access.tenant, {
            action: "ad_booking.create",
            targetType: "ad_booking",
            targetId: id,
            publicationId: pub,
            data: { advertiser: input.advertiserId, dates: input.dates.length, slot: input.slot },
          });
          await syncBooking(tx, access.tenant, pub, id);
          const row = await findBooking(tx, pub, id);
          if (!row) throw new Error("the booking just made is not found");
          return { status: 201, body: bookingView(row), stored: { id } };
        },
        async (stored, tx) => {
          const row = await findBooking(tx, pub, (stored as { id: string }).id);
          return row ? bookingView(row) : null;
        },
      );
      return reply.status(201).send(answer.body as Booking);
    },
  );

  /** The booking, locked (one change of it at a time), or 404. */
  async function lockedBooking(tx: Tx, pub: string, id: string) {
    const row = UUID.test(id) ? await findBooking(tx, pub, id, true) : undefined;
    if (!row) throw new ApiError("not_found");
    return row;
  }

  app.patch(
    `${BASE}/bookings/:id`,
    {
      config: { permission: "ads.manage" },
      schema: { params: OneId, body: BookingPatch, response: { 200: Booking } },
    },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      const input = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const row = await lockedBooking(tx, pub, id);
        const next = {
          campaign: input.campaign ?? row.campaign,
          w_mm: input.wMm?.toFixed(2) ?? row.w_mm,
          h_mm: input.hMm?.toFixed(2) ?? row.h_mm,
          colour: input.colour ?? row.colour,
          slot: input.slot === undefined ? row.slot : input.slot,
          dates: input.dates ? [...input.dates].sort() : row.dates,
          note: input.note ?? row.note,
          status: input.status ?? row.status,
        };
        if (input.wMm !== undefined || input.slot !== undefined)
          await checkSize(tx, pub, { wMm: Number(next.w_mm), hMm: Number(next.h_mm), slot: next.slot });
        await updateBooking(tx, pub, id, next);
        await recordAudit(tx, access.tenant, {
          action: "ad_booking.edit",
          targetType: "ad_booking",
          targetId: id,
          publicationId: pub,
          data: { fields: Object.keys(input) },
        });
        await syncBooking(tx, access.tenant, pub, id);
        const now = await findBooking(tx, pub, id);
        if (!now) throw new Error("the booking just changed is not found");
        return bookingView(now);
      });
    },
  );

  app.put(
    `${BASE}/bookings/:id/artwork`,
    {
      config: { permission: "ads.manage" },
      schema: { params: OneId, body: BookingArtworkInput, response: { 200: Booking } },
    },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      const { assetId } = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        await lockedBooking(tx, pub, id);
        const asset = await findAsset(tx, pub, assetId, "share");
        if (!asset) throw new ApiError("not_found");
        if ((asset.status !== "received" && asset.status !== "ready") || !asset.version_id)
          throw invalid("body.assetId", "This picture was refused, or could not be read.");
        await setBookingArtwork(tx, access.tenant, pub, id, assetId);
        const row = await findBooking(tx, pub, id);
        if (!row) throw new Error("the booking just changed is not found");
        await recordAudit(tx, access.tenant, {
          action: "ad_booking.artwork",
          targetType: "ad_booking",
          targetId: id,
          publicationId: pub,
          data: { asset: assetId, passed: artworkState(row) === "passed" },
        });
        await syncBooking(tx, access.tenant, pub, id);
        const now = await findBooking(tx, pub, id);
        if (!now) throw new Error("the booking just changed is not found");
        return bookingView(now);
      });
    },
  );

  app.delete(
    `${BASE}/bookings/:id/artwork`,
    { config: { permission: "ads.manage" }, schema: { params: OneId, response: { 200: Booking } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const before = await lockedBooking(tx, pub, id);
        if (before.artwork_asset_id !== null) {
          await setBookingArtwork(tx, access.tenant, pub, id, null);
          await recordAudit(tx, access.tenant, {
            action: "ad_booking.artwork",
            targetType: "ad_booking",
            targetId: id,
            publicationId: pub,
            data: { asset: null },
          });
          await syncBooking(tx, access.tenant, pub, id);
        }
        const row = await findBooking(tx, pub, id);
        if (!row) throw new Error("the booking just changed is not found");
        return bookingView(row);
      });
    },
  );

  // ------------------------------------------------------------------------------------------ the edition plan

  app.get(
    `${BASE}/editions/:e/plan`,
    { config: { permission: "edition.view" }, schema: { params: OneEdition, response: { 200: EditionPlan } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, e } = request.params;
      if (!UUID.test(e)) throw new ApiError("not_found");
      return database.withTenant(access.tenant, (tx) => planView(tx, pub, e, may(access, pub, "ads.view")));
    },
  );

  /** The edition (locked) and its plan's slots; 404, or 409 not_editable once released. */
  async function editable(tx: Tx, pub: string, e: string) {
    const found = UUID.test(e) ? await editionSlots(tx, pub, e) : undefined;
    if (!found) throw new ApiError("not_found");
    if (found.released) throw new ApiError("not_editable");
    return found;
  }

  app.post(
    `${BASE}/editions/:e/plan/place`,
    { config: { permission: "pages.view" }, schema: { params: OneEdition, response: { 200: EditionPlan } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, e } = request.params;
      placer(access, pub);
      return database.withTenant(access.tenant, async (tx) => {
        await editable(tx, pub, e);
        await placeBooked(tx, access.tenant, pub, e);
        return planView(tx, pub, e, may(access, pub, "ads.view"));
      });
    },
  );

  app.put(
    `${BASE}/editions/:e/plan/slots/:slot`,
    {
      config: { permission: "pages.view" },
      schema: { params: OneSlot, body: PlacementInput, response: { 200: EditionPlan } },
    },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, e, slot } = request.params;
      const { bookingId } = request.body;
      placer(access, pub);
      return database.withTenant(access.tenant, async (tx) => {
        const booking = await findBooking(tx, pub, bookingId, true); // the booking before the edition (place.ts)
        const { edition, slots } = await editable(tx, pub, e);
        const target = slots.find((s) => s.slot === slot);
        if (!target || !booking) throw new ApiError("not_found");
        if (booking.status !== "booked" || !booking.dates.includes(edition.date))
          throw invalid("body.bookingId", "This booking does not run on this edition's date.");
        if (!fits(rule(booking), target))
          throw invalid("body.bookingId", "This booking's size or position does not fit this slot.");
        // the booking it replaced waits for Place, as one taken out by hand
        await putPlacement(tx, access.tenant, pub, edition, target, booking);
        return planView(tx, pub, e, may(access, pub, "ads.view"));
      });
    },
  );

  app.delete(
    `${BASE}/editions/:e/plan/slots/:slot`,
    { config: { permission: "pages.view" }, schema: { params: OneSlot, response: { 200: EditionPlan } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, e, slot } = request.params;
      placer(access, pub);
      return database.withTenant(access.tenant, async (tx) => {
        const { slots } = await editable(tx, pub, e);
        if (!slots.some((s) => s.slot === slot)) throw new ApiError("not_found");
        await takeOut(tx, access.tenant, pub, e, slot);
        return planView(tx, pub, e, may(access, pub, "ads.view"));
      });
    },
  );

  app.put(
    `${BASE}/editions/:e/plan/pages/:n`,
    {
      config: { permission: "edition.edit" },
      schema: { params: OnePage, body: PlanPageInput, response: { 200: EditionPlan } },
    },
    async (request) => {
      const access = accessOf(request);
      planner(access);
      const { p: pub, e, n } = request.params;
      const { sectionId, note } = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const found = UUID.test(e) ? await editionSlots(tx, pub, e) : undefined;
        const page = Number(n);
        if (!found || !/^[0-9]{1,2}$/.test(n) || page < 1 || page > found.edition.pages)
          throw new ApiError("not_found");
        if (sectionId !== null && !(await findSection(tx, pub, sectionId)))
          throw invalid("body.sectionId", "This section is not one of this paper's.");
        await setFlatplanPage(tx, access.tenant, pub, e, { page_no: page, section_id: sectionId, note });
        await recordAudit(tx, access.tenant, {
          action: "plan.page",
          targetType: "edition",
          targetId: e,
          publicationId: pub,
          data: { edition: e, page },
        });
        return planView(tx, pub, e, may(access, pub, "ads.view"));
      });
    },
  );

  app.post(
    `${BASE}/editions/:e/plan/copy`,
    {
      config: { permission: "edition.edit" },
      schema: { params: OneEdition, body: CopyPlanInput, response: { 200: CopyPlanResult } },
    },
    async (request) => {
      const access = accessOf(request);
      planner(access);
      const { p: pub, e } = request.params;
      const { fromEditionId: from } = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        // the source's bookings locked before the edition (place.ts), by id
        const fromPlacements = from === e ? [] : await editionPlacements(tx, pub, from);
        const held = new Map<string, BookingRow | undefined>();
        for (const id of [...new Set(fromPlacements.map((p) => p.booking_id))].sort())
          held.set(id, await findBooking(tx, pub, id, true));
        const target = await editable(tx, pub, e);
        const source = from === e ? undefined : await editionSlots(tx, pub, from, false);
        if (!source) throw invalid("body.fromEditionId", "Choose another edition of this paper.");
        if (source.edition.pages !== target.edition.pages)
          throw invalid("body.fromEditionId", "That edition has another number of pages.");
        const pages = (await flatplanPages(tx, pub, from)).filter((row) => row.page_no <= target.edition.pages);
        for (const row of pages)
          await setFlatplanPage(tx, access.tenant, pub, e, {
            page_no: row.page_no,
            section_id: row.section_id,
            note: row.note,
          });
        let placements = 0;
        for (const p of fromPlacements) {
          const slot = target.slots.find((s) => s.slot === p.slot);
          const booking = held.get(p.booking_id);
          if (!slot || !booking || booking.status !== "booked" || !booking.dates.includes(target.edition.date))
            continue;
          if (!fits(rule(booking), slot)) continue;
          if (await putPlacement(tx, access.tenant, pub, target.edition, slot, booking)) placements += 1;
        }
        await placeBooked(tx, access.tenant, pub, e);
        await recordAudit(tx, access.tenant, {
          action: "plan.copy",
          targetType: "edition",
          targetId: e,
          publicationId: pub,
          data: { edition: e, from, pages: pages.length, placements },
        });
        return {
          plan: await planView(tx, pub, e, may(access, pub, "ads.view")),
          copied: { pages: pages.length, placements },
        };
      });
    },
  );
};
