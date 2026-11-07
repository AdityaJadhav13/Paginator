// The ads desk and the edition plan (docs/product/10-l2-newsroom-plan.md §1 L2.6; doc 04 §7.3.1, §7.7; doc 07 §12
// rows "Ads desk" and "Editions: create, Plan tab"): advertisers, bookings, image artwork and its checks, placement
// into the engine's back-page ad slots, the missing-artwork alert at cut-off, and the flatplan.
//
// Only what really works is offered: ads go into the back-page slots of the engine profile in use (the Desk's setup
// rejects inside templates with ad slots), artwork is a picture (JPEG, PNG or WebP; a PDF is refused politely: it
// needs sandboxed PDF intake), and there is no colour/mono page map (it needs a colour check). A booking's colour is
// recorded and shown, never checked.
//
// A booking is for a size of the profile's real slots (wMm × hMm, exactly one of `AdSizes`), on one or more edition
// dates, at a position: one named back-page slot, or any back-page slot of its size (`slot` null). Its artwork is a
// picture of the media library (uploaded with purpose "library"), checked by `checkArtwork` below; artwork that fails
// a check is not placed. A placement puts a booking into one slot of one edition; when the booking's artwork passed,
// the slot's artwork is set to it (the L2.3 path: app.ad_slot_artwork, media.ad fits it into the slot at up to
// 200 ppi and converts it to the paper's CMYK), so the next layout prints it. Placements and artwork follow the
// booking only in editions not yet released.
//
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET  ads/sizes (ads.view) → AdSizes: the back-page slots of the profile in use (empty: no profile ready).
//   GET  ads/settings (ads.view) → AdSettings. PUT ads/settings AdSettingsInput (ads.manage or settings.edit).
//   GET  advertisers (ads.view) → AdvertiserList (archived last). POST advertisers AdvertiserInput (ads.manage) →
//        201 Advertiser; 409 advertiser_exists when one (not archived) has that name. PATCH advertisers/:id
//        AdvertiserPatch (ads.manage) → Advertiser.
//   GET  bookings?from&to&status (ads.view) → BookingList: bookings with a run date in [from, to] (both optional),
//        newest first, at most 400.
//   POST bookings BookingInput (ads.manage, Idempotency-Key) → 201 Booking. The size must be one of AdSizes, and the
//        slot (when named) a slot of that size: otherwise 400 invalid_request (details). The booking is placed at once
//        in each of its dates' editions that exist (placeBooked below).
//   PATCH bookings/:id BookingPatch (ads.manage) → Booking. Changing its size, slot or dates takes it out of the
//        unreleased editions it no longer fits and places it again; cancelling takes it out of every unreleased one.
//   PUT  bookings/:id/artwork BookingArtworkInput (ads.manage) → Booking: a picture of the media library (received or
//        ready; not rejected, failed or deleted) as its artwork, checked; placed into its slots when it passed.
//        DELETE bookings/:id/artwork (ads.manage) → Booking: the artwork taken off (and out of its slots).
//   GET  editions/:e/plan (edition.view) → EditionPlan.
//   POST editions/:e/plan/place (ads.manage or layout.generate) → EditionPlan: every booking of the edition's date
//        not yet placed is placed by its rule (placeBooked), in the order booked.
//   PUT  editions/:e/plan/slots/:slot PlacementInput (ads.manage or layout.generate) → EditionPlan: this booking in
//        this slot (it must run on the edition's date, be booked, and fit: its size and its slot rule; another
//        booking in the slot is taken out). 409 slot_taken never: the newer choice wins and is audited.
//        DELETE editions/:e/plan/slots/:slot → EditionPlan (the placement and the slot's artwork taken out).
//   PUT  editions/:e/plan/pages/:n PlanPageInput (edition.edit, the whole cell) → EditionPlan: the page's planned
//        section and its note to the designer.
//   POST editions/:e/plan/copy CopyPlanInput (edition.edit, the whole cell) → CopyPlanResult: from another edition of
//        the publication with the same number of pages, each page's section and note, and each slot's placement whose
//        booking also runs on this edition's date; then the rest placed by their rules.
// The editions not yet released: status not released or archived. A placement, or the artwork it sets, never changes a
// released edition (409 not_editable).
// The plain artwork slot route of L2.3 (PUT editions/:e/ads/:slot {assetId}) refuses a slot that holds a booking:
// 409 slot_booked (take the booking out first).
//
// The cut-off (ads/settings): each edition date's cut-off is `daysBefore` days before it at `cutoffTime`, in the
// publication's timezone. Once the cut-off has passed (and until the edition's date has ended), as soon as a pass finds
// bookings of that date that are booked and have no artwork, or artwork that failed a check (a booking made after the
// cut-off included), they are told of once: one notification
// (ad_artwork_missing) and one email to each active person holding Advertising, Chief Editor or Editor on the
// publication (and Owner and Admin, who hold every permission). The alert is recorded per publication and date, so it
// fires once even with two API instances, and not again when a booking changes after it. A pass that finds nothing missing records nothing.
//
// Audit: advertiser.create, advertiser.edit, ad_booking.create, ad_booking.edit, ad_booking.artwork,
// ad_placement.set, ad_placement.clear, plan.page, plan.copy, ad_settings.set, ad_cutoff.alert (actor: the system).
import { z } from "zod";

import { DeskSlot, PageRole } from "./layout.ts";

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });
const Person = z.strictObject({ id: Id, name: z.string() });
const EditionDate = z.iso
  .date()
  .refine((date) => date >= "2000-01-01" && date <= "2999-12-31", { error: "is not between 2000 and 2999" });
const Name = z.string().trim().min(1).max(200);
const Line = z.string().trim().max(200);
const Note = z.string().trim().max(2000);
const Mm = z.number().positive().max(2000);
const PageNo = z.number().int().min(1).max(16);

/** The most dates one booking runs on (a year of dailies). */
export const MAX_BOOKING_DATES = 366;
/** The artwork checks' limits (doc 04 §7.7, plan §1 L2.6): its shape within 0.5 mm of the slot's, at 200 ppi. */
export const ARTWORK_SHAPE_TOLERANCE_MM = 0.5;
export const ARTWORK_MIN_PPI = 200;

// ------------------------------------------------------------------------------------------------ sizes and settings

/** One back-page ad slot of the profile in use, with its size: what a booking may book. */
export const AdSize = z.strictObject({ slot: DeskSlot, wMm: Mm, hMm: Mm });
export type AdSize = z.infer<typeof AdSize>;
export const AdSizes = z.strictObject({
  profile: z.strictObject({ id: Id, version: z.number().int() }).nullable(),
  slots: z.array(AdSize).max(40),
});
export type AdSizes = z.infer<typeof AdSizes>;

const Clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
/** The cut-off: `daysBefore` days before the edition's date, at `cutoffTime` (HH:MM, the publication's timezone).
 * 18:00 the day before, until the owner decides. */
export const AdSettings = z.strictObject({ cutoffTime: Clock, daysBefore: z.number().int().min(0).max(7) });
export type AdSettings = z.infer<typeof AdSettings>;
export const AdSettingsInput = AdSettings;

// ------------------------------------------------------------------------------------------------ advertisers

export const Advertiser = z.strictObject({
  id: Id,
  name: z.string(),
  contactName: z.string(),
  phone: z.string(),
  email: z.string(),
  note: z.string(),
  archived: z.boolean(),
  /** bookings not cancelled */
  bookings: z.number().int().min(0),
  createdAt: Moment,
});
export type Advertiser = z.infer<typeof Advertiser>;
export const AdvertiserList = z.strictObject({ items: z.array(Advertiser) });
export type AdvertiserList = z.infer<typeof AdvertiserList>;

export const AdvertiserInput = z.strictObject({
  name: Name,
  contactName: Line.optional(),
  phone: Line.optional(),
  email: Line.optional(),
  note: Note.optional(),
});
export type AdvertiserInput = z.infer<typeof AdvertiserInput>;
export const AdvertiserPatch = z
  .strictObject({ ...AdvertiserInput.partial().shape, archived: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, { error: "change at least one field" });
export type AdvertiserPatch = z.infer<typeof AdvertiserPatch>;

// ------------------------------------------------------------------------------------------------ artwork checks

export const ARTWORK_CHECKS = ["shape", "resolution", "colour"] as const;
export const ArtworkCheckName = z.enum(ARTWORK_CHECKS);

/** One check of a picture against a slot size. The web words it (en, mr) from `check`, `state` and these numbers:
 *  shape: printWMm × printHMm is the picture fitted inside the slot (its shape kept, centred: the Desk's ad_canvas);
 *    failed when it leaves more than 0.5 mm of the slot empty across or down (shortWMm, shortHMm: how much);
 *  resolution: ppi is the picture's resolution at that printed size; failed below 200 (needWPx × needHPx: the
 *    pixels a picture of the slot's shape needs);
 *  colour: always a note: every picture is converted from RGB to the paper's CMYK for print (the Desk's convert_ad
 *    decodes it to RGB first, a CMYK JPEG included), so its colours may shift: look at the preview. */
export const ArtworkCheck = z.strictObject({
  check: ArtworkCheckName,
  state: z.enum(["passed", "failed", "note"]),
  printWMm: z.number(),
  printHMm: z.number(),
  shortWMm: z.number(),
  shortHMm: z.number(),
  ppi: z.number().int(),
  needWPx: z.number().int(),
  needHPx: z.number().int(),
});
export type ArtworkCheck = z.infer<typeof ArtworkCheck>;

const tenth = (n: number) => Math.round(n * 10) / 10;

/** The artwork checks of a picture (its pixel size, as stored for the asset) against a slot size. Deterministic,
 * shared by the API (which decides) and the web (which only shows the API's answer). */
// shortcut: the sizes are the file header's, before EXIF rotation (app.asset.width_px/height_px); a phone photo
// stored rotated is checked unrotated. Upgrade when artwork comes from cameras: have media.ad report the turned size.
export function checkArtwork(picture: { widthPx: number; heightPx: number }, size: { wMm: number; hMm: number }) {
  const mmPerPx = Math.min(size.wMm / picture.widthPx, size.hMm / picture.heightPx);
  const printW = picture.widthPx * mmPerPx;
  const printH = picture.heightPx * mmPerPx;
  const facts = {
    printWMm: tenth(printW),
    printHMm: tenth(printH),
    shortWMm: tenth(size.wMm - printW),
    shortHMm: tenth(size.hMm - printH),
    ppi: Math.floor(25.4 / mmPerPx + 1e-9),
    needWPx: Math.ceil((size.wMm / 25.4) * ARTWORK_MIN_PPI - 1e-9),
    needHPx: Math.ceil((size.hMm / 25.4) * ARTWORK_MIN_PPI - 1e-9),
  };
  const shapeOk =
    size.wMm - printW <= ARTWORK_SHAPE_TOLERANCE_MM + 1e-9 && size.hMm - printH <= ARTWORK_SHAPE_TOLERANCE_MM + 1e-9;
  const checks: ArtworkCheck[] = [
    { check: "shape", state: shapeOk ? "passed" : "failed", ...facts },
    { check: "resolution", state: facts.ppi >= ARTWORK_MIN_PPI ? "passed" : "failed", ...facts },
    { check: "colour", state: "note", ...facts },
  ];
  return { passed: checks.every((c) => c.state !== "failed"), checks };
}

export const BookingArtwork = z.strictObject({
  assetId: Id,
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  /** the picture's own state in the media library (received: its print versions are still being made) */
  status: z.enum(["received", "ready", "rejected", "failed"]),
  /** every check passed: it is placed into the booking's slots */
  passed: z.boolean(),
  checks: z.array(ArtworkCheck),
  setBy: Person.nullable(),
  setAt: Moment,
});
export type BookingArtwork = z.infer<typeof BookingArtwork>;

/** PUT …/bookings/:id/artwork. A PDF cannot be uploaded at all (UploadRequest takes pictures only): the web says
 * so before the upload, in plain words. */
export const BookingArtworkInput = z.strictObject({ assetId: Id });

// ------------------------------------------------------------------------------------------------ bookings

export const BOOKING_STATUSES = ["booked", "cancelled"] as const;
export const BookingStatus = z.enum(BOOKING_STATUSES);
export const AdColour = z.enum(["colour", "mono"]);

export const Booking = z.strictObject({
  id: Id,
  advertiser: z.strictObject({ id: Id, name: z.string() }),
  campaign: z.string(),
  wMm: z.number(),
  hMm: z.number(),
  colour: AdColour,
  /** the position rule: this back-page slot, or (null) any back-page slot of the booking's size */
  slot: DeskSlot.nullable(),
  /** the edition dates it runs on, sorted */
  dates: z.array(z.iso.date()).min(1).max(MAX_BOOKING_DATES),
  status: BookingStatus,
  note: z.string(),
  artwork: BookingArtwork.nullable(),
  /** where it is placed, in the editions that exist */
  placements: z.array(z.strictObject({ editionId: Id, date: z.iso.date(), slot: DeskSlot })),
  createdBy: Person.nullable(),
  createdAt: Moment,
  updatedAt: Moment,
});
export type Booking = z.infer<typeof Booking>;

export const BookingQuery = z.strictObject({
  from: EditionDate.optional(),
  to: EditionDate.optional(),
  status: BookingStatus.optional(),
});
export const BookingList = z.strictObject({ items: z.array(Booking) });
export type BookingList = z.infer<typeof BookingList>;

const Dates = z
  .array(EditionDate)
  .min(1)
  .max(MAX_BOOKING_DATES)
  .refine((dates) => new Set(dates).size === dates.length, { error: "names a date twice" });

export const BookingInput = z.strictObject({
  advertiserId: Id,
  campaign: Line.optional(),
  wMm: Mm,
  hMm: Mm,
  colour: AdColour,
  slot: DeskSlot.nullable(),
  dates: Dates,
  note: Note.optional(),
});
export type BookingInput = z.infer<typeof BookingInput>;

export const BookingPatch = z
  .strictObject({
    campaign: Line.optional(),
    wMm: Mm.optional(),
    hMm: Mm.optional(),
    colour: AdColour.optional(),
    slot: DeskSlot.nullable().optional(),
    dates: Dates.optional(),
    status: BookingStatus.optional(),
    note: Note.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { error: "change at least one field" })
  .refine((patch) => (patch.wMm === undefined) === (patch.hMm === undefined), {
    error: "a size is changed whole: width and height",
  });
export type BookingPatch = z.infer<typeof BookingPatch>;

// ------------------------------------------------------------------------------------------------ the edition plan

/** Why a booking of the edition's date is not placed:
 *  no_ad_pages: the edition has no back-page ads; no_slot: the plan has no slot of its size (and its named slot);
 *  slots_taken: every slot it fits holds another booking; no_profile: no engine profile is ready; taken_out: a slot
 *  it fits is free, but it is not placed (taken out by hand, or a slot freed since: "Place booked ads" places it). */
export const UNPLACED_REASONS = ["no_ad_pages", "no_slot", "slots_taken", "no_profile", "taken_out"] as const;
export const UnplacedReason = z.enum(UNPLACED_REASONS);

const BookingRef = z.strictObject({
  id: Id,
  advertiser: z.string(),
  campaign: z.string(),
  wMm: z.number(),
  hMm: z.number(),
  colour: AdColour,
  /** its position rule: this slot, or (null) any back-page slot of its size */
  slot: DeskSlot.nullable(),
  /** its artwork: none, failed a check, or passed */
  artwork: z.enum(["none", "failed", "passed"]),
});

export const PlanSlot = z.strictObject({
  slot: DeskSlot,
  wMm: z.number(),
  hMm: z.number(),
  booking: BookingRef.nullable(),
  /** the slot's artwork for the next layout (L2.3's AdSlot.state) */
  artwork: z.enum(["empty", "preparing", "ready", "failed"]),
});
export type PlanSlot = z.infer<typeof PlanSlot>;

export const PlanPage = z.strictObject({
  page: PageNo,
  role: PageRole,
  /** the profile's template role for the page (the Desk's page plan) */
  templateRole: z.string(),
  /** the planned section, and the note to the designer */
  section: z.strictObject({ id: Id, name: z.string() }).nullable(),
  note: z.string(),
  /** the sections of the stories the Pages board's run placed on it (null: no done run) */
  placed: z
    .strictObject({ stories: z.number().int().min(0), sections: z.array(z.strictObject({ id: Id, name: z.string() })) })
    .nullable(),
  slots: z.array(PlanSlot),
});
export type PlanPage = z.infer<typeof PlanPage>;

export const EditionPlan = z.strictObject({
  editionId: Id,
  date: z.iso.date(),
  pages: z.number().int(),
  backPageAds: z.boolean(),
  released: z.boolean(),
  profile: z.strictObject({ id: Id, version: z.number().int() }).nullable(),
  /** one tile a page (empty while no profile is ready: the roles come from its plan) */
  tiles: z.array(PlanPage),
  /** the publication's sections (not archived, in their order): what a page's planned section is chosen from */
  sections: z.array(z.strictObject({ id: Id, name: z.string() })),
  /** the bookings of the edition's date not placed in it, and why */
  unplaced: z.array(z.strictObject({ booking: BookingRef, reason: UnplacedReason })),
  /** the date's cut-off, and when its missing-artwork alert fired (null: not yet) */
  cutoff: z.strictObject({ at: Moment, alertedAt: Moment.nullable() }),
});
export type EditionPlan = z.infer<typeof EditionPlan>;

export const PlacementInput = z.strictObject({ bookingId: Id });
export const PlanPageInput = z.strictObject({ sectionId: Id.nullable(), note: Note });
export const CopyPlanInput = z.strictObject({ fromEditionId: Id });
export const CopyPlanResult = z.strictObject({
  plan: EditionPlan,
  copied: z.strictObject({ pages: z.number().int().min(0), placements: z.number().int().min(0) }),
});
export type CopyPlanResult = z.infer<typeof CopyPlanResult>;
