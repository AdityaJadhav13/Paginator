/**
 * The ads desk's double (docs/product/10-l2-newsroom-plan.md §1 L2.6), answered as the routes of
 * @pageinator/contracts ads.ts: the back-page sizes (the layout double's fictional slots), the cut-off settings,
 * advertisers (409 advertiser_exists), bookings placed at once in their dates' editions by their rule, picture artwork
 * checked by the contract's own `checkArtwork`, and an edition's plan (pages, slots, unplaced with the reason, place,
 * unplace, copy; 409 not_editable on a released edition). Permissions are not modelled: the screens hide what the API
 * would refuse. Fictional data only; deterministic.
 */
import { checkArtwork } from "../services/ads-service.ts";
import type {
  AdSettingsDto,
  AdsService,
  AdvertiserDto,
  ApiProblem,
  BookingDto,
  EditionPlanDto,
  PubEditionDto,
  ServiceResult,
} from "../services/index.ts";

export interface MockAdsDeps {
  person(): { readonly userId: string; readonly name: string } | undefined;
  edition(orgId: string, pubId: string, editionId: string): PubEditionLike | undefined;
  editions(orgId: string, pubId: string): readonly PubEditionLike[];
  pictureOf(
    orgId: string,
    pubId: string,
    assetId: string,
  ): { readonly widthPx: number; readonly heightPx: number; readonly status: string } | undefined;
}
type PubEditionLike = Pick<PubEditionDto, "id" | "date" | "pages" | "backPageAds" | "status">;

const NOW = "2026-10-24T10:00:00.000+05:30";
const PROFILE = { id: "01900000-0000-7000-8000-00000000f001", version: 1 };
/** The layout double's back-page slots (create-mock-layout.ts BACK_SLOTS). */
const SIZES = [
  { slot: "back-1", wMm: 330, hMm: 170 },
  { slot: "back-2", wMm: 162, hMm: 100 },
] as const;
/** The publication's sections (fictional), in their order. */
const SECTIONS = [
  { id: "01900000-0000-7000-8000-00000000c001", name: "City" },
  { id: "01900000-0000-7000-8000-00000000c002", name: "Sport" },
  { id: "01900000-0000-7000-8000-00000000c003", name: "Business" },
] as const;
const DEFAULTS: AdSettingsDto = { cutoffTime: "18:00", daysBefore: 1 };

const fail = <T,>(status: number, code: string): ServiceResult<T, ApiProblem> => ({
  ok: false,
  error: { kind: "answer", status, code, message: code },
});
const ok = <T,>(value: T): ServiceResult<T, ApiProblem> => ({ ok: true, value });
const copy = <T,>(value: T): T => structuredClone(value);

type BookingRow = Omit<BookingDto, "placements">;

export function createMockAds(deps: MockAdsDeps): { readonly ads: AdsService; reset(): void } {
  let advertisers: AdvertiserDto[] = [];
  let bookings: BookingRow[] = [];
  /** editionId → slot → bookingId */
  let placed = new Map<string, Map<string, string>>();
  /** `${editionId}:${page}` → the planned section and note */
  let pages = new Map<string, { section: { id: string; name: string } | null; note: string }>();
  let settings = { ...DEFAULTS };
  let counter = 0;
  const nextId = () => `01900000-0000-7000-8000-${String(++counter).padStart(12, "0")}`;
  const me = () => {
    const person = deps.person();
    return { id: person?.userId ?? "user-demo", name: person?.name ?? "Fictional Person" };
  };
  const slotsOf = (editionId: string) => {
    let slots = placed.get(editionId);
    if (!slots) placed.set(editionId, (slots = new Map()));
    return slots;
  };
  const released = (edition: PubEditionLike) => edition.status === "released" || edition.status === "archived";

  const dto = (orgId: string, pubId: string, row: BookingRow): BookingDto => ({
    ...copy(row),
    placements: deps
      .editions(orgId, pubId)
      .flatMap((edition) =>
        [...slotsOf(edition.id)]
          .filter(([, id]) => id === row.id)
          .map(([slot]) => ({ editionId: edition.id, date: edition.date, slot })),
      ),
  });

  /** The slots a booking fits in an edition, free ones first. */
  const fits = (edition: PubEditionLike, booking: BookingRow) =>
    edition.backPageAds
      ? SIZES.filter(
          (size) =>
            size.wMm === booking.wMm && size.hMm === booking.hMm && (booking.slot === null || booking.slot === size.slot),
        )
      : [];

  function placeBooked(edition: PubEditionLike) {
    if (released(edition)) return;
    const slots = slotsOf(edition.id);
    for (const booking of bookings) {
      if (booking.status !== "booked" || !booking.dates.includes(edition.date)) continue;
      if ([...slots.values()].includes(booking.id)) continue;
      const free = fits(edition, booking).find((size) => !slots.has(size.slot));
      if (free) slots.set(free.slot, booking.id);
    }
  }

  /** Takes a booking out of the unreleased editions it no longer fits, and places it again. */
  function replace(orgId: string, pubId: string, booking: BookingRow) {
    for (const edition of deps.editions(orgId, pubId)) {
      if (released(edition)) continue;
      const slots = slotsOf(edition.id);
      for (const [slot, id] of slots) {
        const still =
          booking.status === "booked" &&
          booking.dates.includes(edition.date) &&
          fits(edition, booking).some((size) => size.slot === slot);
        if (id === booking.id && !still) slots.delete(slot);
      }
      placeBooked(edition);
    }
  }

  const ref = (row: BookingRow) => ({
    id: row.id,
    advertiser: row.advertiser.name,
    campaign: row.campaign,
    wMm: row.wMm,
    hMm: row.hMm,
    colour: row.colour,
    slot: row.slot,
    artwork: !row.artwork ? ("none" as const) : row.artwork.passed ? ("passed" as const) : ("failed" as const),
  });

  function plan(edition: PubEditionLike): EditionPlanDto {
    const slots = slotsOf(edition.id);
    const byId = new Map(bookings.map((row) => [row.id, row]));
    const tiles = Array.from({ length: edition.pages }, (_, index) => {
      const page = index + 1;
      const role = page === 1 ? ("front" as const) : page === edition.pages ? ("back" as const) : ("inside" as const);
      const planned = pages.get(`${edition.id}:${page}`);
      return {
        page,
        role,
        templateRole: role === "front" ? "front" : role === "back" ? "back-ads" : "inside-news",
        section: planned?.section ? { ...planned.section } : null,
        note: planned?.note ?? "",
        placed: null,
        slots:
          role === "back" && edition.backPageAds
            ? SIZES.map((size) => {
                const booking = byId.get(slots.get(size.slot) ?? "");
                return {
                  ...size,
                  booking: booking ? ref(booking) : null,
                  artwork: booking?.artwork?.passed ? ("ready" as const) : ("empty" as const),
                };
              })
            : [],
      };
    });
    const placedIds = new Set(slots.values());
    const unplaced = bookings
      .filter((row) => row.status === "booked" && row.dates.includes(edition.date) && !placedIds.has(row.id))
      .map((row) => ({
        booking: ref(row),
        reason: !edition.backPageAds
          ? ("no_ad_pages" as const)
          : fits(edition, row).length === 0
            ? ("no_slot" as const)
            : fits(edition, row).every((size) => slots.has(size.slot))
              ? ("slots_taken" as const)
              : ("taken_out" as const),
      }));
    const day = new Date(`${edition.date}T18:00:00+05:30`);
    day.setUTCDate(day.getUTCDate() - settings.daysBefore);
    return {
      editionId: edition.id,
      date: edition.date,
      pages: edition.pages,
      backPageAds: edition.backPageAds,
      released: released(edition),
      profile: { ...PROFILE },
      tiles,
      sections: SECTIONS.map((section) => ({ ...section })),
      unplaced,
      cutoff: { at: day.toISOString(), alertedAt: null },
    };
  }

  const ads: AdsService = {
    async sizes() {
      return ok({ profile: { ...PROFILE }, slots: SIZES.map((size) => ({ ...size })) });
    },
    async settings() {
      return ok({ ...settings });
    },
    async saveSettings({ settings: next }) {
      settings = { ...next };
      return ok({ ...settings });
    },
    async advertisers() {
      return ok(copy([...advertisers].sort((a, b) => Number(a.archived) - Number(b.archived))));
    },
    async addAdvertiser({ input }) {
      const name = input.name.trim();
      if (advertisers.some((one) => !one.archived && one.name.toLowerCase() === name.toLowerCase())) {
        return fail(409, "advertiser_exists");
      }
      const row: AdvertiserDto = {
        id: nextId(),
        name,
        contactName: input.contactName ?? "",
        phone: input.phone ?? "",
        email: input.email ?? "",
        note: input.note ?? "",
        archived: false,
        bookings: 0,
        createdAt: NOW,
      };
      advertisers = [...advertisers, row];
      return ok(copy(row));
    },
    async editAdvertiser({ id, patch }) {
      const row = advertisers.find((one) => one.id === id);
      if (!row) return fail(404, "not_found");
      const name = patch.name?.trim();
      if (name && advertisers.some((one) => one.id !== id && !one.archived && one.name.toLowerCase() === name.toLowerCase())) {
        return fail(409, "advertiser_exists");
      }
      Object.assign(row, patch, name ? { name } : {});
      for (const booking of bookings) if (booking.advertiser.id === id) booking.advertiser.name = row.name;
      return ok(copy(row));
    },
    async bookings({ orgId, pubId, from, to }) {
      const within = (row: BookingRow) => row.dates.some((date) => (!from || date >= from) && (!to || date <= to));
      return ok([...bookings.filter(within)].reverse().map((row) => dto(orgId, pubId, row)));
    },
    async book({ orgId, pubId, input }) {
      const advertiser = advertisers.find((one) => one.id === input.advertiserId);
      if (!advertiser) return fail(404, "not_found");
      const size = SIZES.some((one) => one.wMm === input.wMm && one.hMm === input.hMm && (!input.slot || one.slot === input.slot));
      if (!size) return fail(400, "invalid_request");
      const row: BookingRow = {
        id: nextId(),
        advertiser: { id: advertiser.id, name: advertiser.name },
        campaign: input.campaign ?? "",
        wMm: input.wMm,
        hMm: input.hMm,
        colour: input.colour,
        slot: input.slot,
        dates: [...input.dates].sort(),
        status: "booked",
        note: input.note ?? "",
        artwork: null,
        createdBy: me(),
        createdAt: NOW,
        updatedAt: NOW,
      };
      bookings = [...bookings, row];
      advertiser.bookings += 1;
      replace(orgId, pubId, row);
      return ok(dto(orgId, pubId, row));
    },
    async editBooking({ orgId, pubId, id, patch }) {
      const row = bookings.find((one) => one.id === id);
      if (!row) return fail(404, "not_found");
      Object.assign(row, patch, patch.dates ? { dates: [...patch.dates].sort() } : {}, { updatedAt: NOW });
      replace(orgId, pubId, row);
      return ok(dto(orgId, pubId, row));
    },
    async setArtwork({ orgId, pubId, id, assetId }) {
      const row = bookings.find((one) => one.id === id);
      const picture = deps.pictureOf(orgId, pubId, assetId);
      if (!row || !picture) return fail(404, "not_found");
      const { passed, checks } = checkArtwork(picture, row);
      row.artwork = {
        assetId,
        widthPx: picture.widthPx,
        heightPx: picture.heightPx,
        status: picture.status === "ready" ? "ready" : "received",
        passed,
        checks,
        setBy: me(),
        setAt: NOW,
      };
      return ok(dto(orgId, pubId, row));
    },
    async clearArtwork({ orgId, pubId, id }) {
      const row = bookings.find((one) => one.id === id);
      if (!row) return fail(404, "not_found");
      row.artwork = null;
      return ok(dto(orgId, pubId, row));
    },
    async plan({ orgId, pubId, editionId }) {
      const edition = deps.edition(orgId, pubId, editionId);
      return edition ? ok(plan(edition)) : fail(404, "not_found");
    },
    async placeBooked({ orgId, pubId, editionId }) {
      const edition = deps.edition(orgId, pubId, editionId);
      if (!edition) return fail(404, "not_found");
      if (released(edition)) return fail(409, "not_editable");
      placeBooked(edition);
      return ok(plan(edition));
    },
    async place({ orgId, pubId, editionId, slot, bookingId }) {
      const edition = deps.edition(orgId, pubId, editionId);
      const booking = bookings.find((one) => one.id === bookingId);
      if (!edition || !booking) return fail(404, "not_found");
      if (released(edition)) return fail(409, "not_editable");
      if (!booking.dates.includes(edition.date) || !fits(edition, booking).some((size) => size.slot === slot)) {
        return fail(400, "invalid_request");
      }
      const slots = slotsOf(editionId);
      for (const [at, id] of slots) if (id === bookingId) slots.delete(at);
      slots.set(slot, bookingId);
      return ok(plan(edition));
    },
    async unplace({ orgId, pubId, editionId, slot }) {
      const edition = deps.edition(orgId, pubId, editionId);
      if (!edition) return fail(404, "not_found");
      if (released(edition)) return fail(409, "not_editable");
      slotsOf(editionId).delete(slot);
      return ok(plan(edition));
    },
    async planPage({ orgId, pubId, editionId, page, sectionId, note }) {
      const edition = deps.edition(orgId, pubId, editionId);
      if (!edition) return fail(404, "not_found");
      if (released(edition)) return fail(409, "not_editable");
      const section = SECTIONS.find((one) => one.id === sectionId);
      if (sectionId && !section) return fail(400, "invalid_request");
      pages.set(`${editionId}:${page}`, { section: section ? { ...section } : null, note });
      return ok(plan(edition));
    },
    async copyPlan({ orgId, pubId, editionId, fromEditionId }) {
      const edition = deps.edition(orgId, pubId, editionId);
      const from = deps.edition(orgId, pubId, fromEditionId);
      if (!edition || !from) return fail(404, "not_found");
      if (released(edition)) return fail(409, "not_editable");
      if (from.pages !== edition.pages) return fail(400, "invalid_request");
      let copiedPages = 0;
      for (let page = 1; page <= from.pages; page += 1) {
        const planned = pages.get(`${fromEditionId}:${page}`);
        if (planned) {
          pages.set(`${editionId}:${page}`, copy(planned));
          copiedPages += 1;
        }
      }
      let placements = 0;
      const target = slotsOf(editionId);
      for (const [slot, id] of slotsOf(fromEditionId)) {
        if (bookings.find((one) => one.id === id)?.dates.includes(edition.date)) {
          target.set(slot, id);
          placements += 1;
        }
      }
      placeBooked(edition);
      return ok({ plan: plan(edition), copied: { pages: copiedPages, placements } });
    },
  };

  return {
    ads,
    reset() {
      advertisers = [];
      bookings = [];
      placed = new Map();
      pages = new Map();
      settings = { ...DEFAULTS };
      counter = 0;
    },
  };
}
