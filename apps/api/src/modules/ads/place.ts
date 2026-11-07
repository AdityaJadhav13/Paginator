// Placing bookings into an edition's back-page ad slots (packages/contracts/src/ads.ts; plan §1 L2.6). The pure rules
// first (sizes, fit, the order of placing, why a booking is not placed), then what writes them: a placement made or
// taken out, and the slot's artwork made to follow its booking through the L2.3 path (app.ad_slot_artwork + media.ad,
// as PUT editions/:e/ads/:slot does). An edition released or archived is never changed here.
// Lock order (no deadlock between two changes): a change of bookings locks them first (by id), then the editions (by
// date, then id). Nothing locks a booking after an edition.
import { type AdSize, UNPLACED_REASONS, checkArtwork } from "@pageinator/contracts";
import {
  type BookingRow,
  addPlacement,
  bookingsOfDate,
  editionPlacements,
  editionStatus,
  editionsToSync,
  findBooking,
  removePlacement,
} from "../../db/ads.ts";
import { recordAudit } from "../../db/audit.ts";
import {
  type LayoutEdition,
  type Plan,
  clearArtwork,
  editionArtwork,
  enqueueMediaAd,
  layoutEdition,
  profileInUse,
  setArtwork,
} from "../../db/layout.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { planFor, slotsOf } from "../layout/request.ts";

/** A booked size equals a slot's within this (mm): the size is stored to two places. */
export const SIZE_TOLERANCE_MM = 0.01;
export const MAX_SIZES = 40;

type Rule = { wMm: number; hMm: number; slot: string | null };

/** The back-page ad slots of the profile's plans (each slot once, as first met): what a booking may book. */
export function adSizes(plans: readonly Plan[] | null): AdSize[] {
  const seen = new Map<string, AdSize>();
  for (const plan of plans ?? []) {
    if (!plan.back_page_ads) continue;
    for (const page of plan.page_plan)
      for (const s of page.ad_slots)
        if (!seen.has(s.slot)) seen.set(s.slot, { slot: s.slot, wMm: s.w_mm, hMm: s.h_mm });
  }
  return [...seen.values()].slice(0, MAX_SIZES);
}

export const sameSize = (a: { wMm: number; hMm: number }, b: { wMm: number; hMm: number }) =>
  Math.abs(a.wMm - b.wMm) <= SIZE_TOLERANCE_MM + 1e-9 && Math.abs(a.hMm - b.hMm) <= SIZE_TOLERANCE_MM + 1e-9;

/** Whether a booking may go in the slot: its size, and its slot rule (that slot, or any of its size). */
export const fits = (booking: Rule, slot: AdSize) =>
  sameSize(booking, slot) && (booking.slot === null || booking.slot === slot.slot);

/** The bookings (in the order booked) each put in the first free slot (plan order) it fits. */
export function choose(
  bookings: readonly (Rule & { id: string })[],
  slots: readonly AdSize[],
  taken: ReadonlyMap<string, string>,
): { bookingId: string; slot: AdSize }[] {
  const busy = new Set(taken.keys());
  const placed = new Set(taken.values());
  const picks: { bookingId: string; slot: AdSize }[] = [];
  for (const booking of bookings) {
    if (placed.has(booking.id)) continue;
    const slot = slots.find((s) => !busy.has(s.slot) && fits(booking, s));
    if (!slot) continue;
    busy.add(slot.slot);
    placed.add(booking.id);
    picks.push({ bookingId: booking.id, slot });
  }
  return picks;
}

/** Why a booking of the edition's date is not in it. */
export function reasonOf(
  booking: Rule,
  slots: readonly AdSize[],
  taken: ReadonlyMap<string, string>,
  edition: { profile: boolean; backPageAds: boolean },
): (typeof UNPLACED_REASONS)[number] {
  if (!edition.profile) return "no_profile";
  if (!edition.backPageAds) return "no_ad_pages";
  const fitting = slots.filter((s) => fits(booking, s));
  if (fitting.length === 0) return "no_slot";
  return fitting.every((s) => taken.has(s.slot)) ? "slots_taken" : "taken_out";
}

export const rule = (row: BookingRow): Rule => ({ wMm: Number(row.w_mm), hMm: Number(row.h_mm), slot: row.slot });

/** The booking's artwork: none, failed (a check, or the picture refused, failed or deleted), or passed. */
export function artworkOf(row: BookingRow) {
  if (!row.artwork_asset_id) return null;
  const asset = row.asset;
  if (!asset) return null;
  const { checks, passed } = checkArtwork({ widthPx: asset.width_px, heightPx: asset.height_px }, rule(row));
  const usable =
    !asset.deleted && asset.version_id !== null && (asset.status === "received" || asset.status === "ready");
  return { asset, checks, passed: passed && usable };
}

export const artworkState = (row: BookingRow): "none" | "failed" | "passed" => {
  const art = artworkOf(row);
  return art === null ? "none" : art.passed ? "passed" : "failed";
};

// ------------------------------------------------------------------------------------------------ writes

export const isReleased = (status: string | undefined) => status === "released" || status === "archived";

/** The edition (locked unless asked not to: one placement change at a time), its status and the slots of the profile
 * in use's plan. */
export async function editionSlots(tx: Tx, pub: string, editionId: string, lock = true) {
  const edition = await layoutEdition(tx, pub, editionId, lock);
  if (!edition) return undefined;
  const status = await editionStatus(tx, pub, editionId);
  const profile = await profileInUse(tx, pub);
  const plan = planFor(profile?.plans ?? null, edition);
  return { edition, released: isReleased(status), profile, plan, slots: slotsOf(plan, []) };
}

/** The slot's artwork made to follow its booking: its passed artwork set (the same picture again: nothing), or the slot
 * cleared (no booking, or no artwork that passed). */
export async function followBooking(
  tx: Tx,
  who: Tenant,
  pub: string,
  editionId: string,
  slot: AdSize,
  booking: BookingRow | null,
) {
  const art = booking ? artworkOf(booking) : null;
  const current = (await editionArtwork(tx, pub, editionId)).find((row) => row.slot === slot.slot);
  if (!booking || !art?.passed || !booking.artwork_asset_id || !art.asset.version_id) {
    if (current) await clearArtwork(tx, pub, editionId, slot.slot);
    return;
  }
  const assetId = booking.artwork_asset_id;
  if (current?.asset_id === assetId && current.state !== "failed") return;
  const wMm = slot.wMm.toFixed(2);
  const hMm = slot.hMm.toFixed(2);
  const artworkId = await setArtwork(tx, who, pub, { editionId, slot: slot.slot, assetId, wMm, hMm });
  await enqueueMediaAd(tx, {
    org_id: who.orgId,
    pub_id: pub,
    artwork_id: artworkId,
    asset_id: assetId,
    version_id: art.asset.version_id,
    sha256: art.asset.sha256,
    w_mm: wMm,
    h_mm: hMm,
  });
}

/** Every booked booking of the edition's date not yet in it (or only the booking `only`), placed by its rule in the
 * order booked (an edition released or archived: nothing). Returns how many were placed. */
export async function placeBooked(
  tx: Tx,
  who: Tenant,
  pub: string,
  editionId: string,
  only: string | null = null,
): Promise<number> {
  const found = await editionSlots(tx, pub, editionId);
  if (!found || found.released) return 0;
  const placements = await editionPlacements(tx, pub, editionId);
  const taken = new Map(placements.map((p) => [p.slot, p.booking_id]));
  const bookings = (await bookingsOfDate(tx, pub, found.edition.date)).filter((b) => only === null || b.id === only);
  const picks = choose(
    bookings.map((b) => ({ id: b.id, ...rule(b) })),
    found.slots,
    taken,
  );
  for (const pick of picks) {
    await addPlacement(tx, who, pub, { editionId, slot: pick.slot.slot, bookingId: pick.bookingId, placedBy: null });
    await followBooking(tx, who, pub, editionId, pick.slot, bookings.find((b) => b.id === pick.bookingId) ?? null);
    await recordAudit(tx, who, {
      action: "ad_placement.set",
      targetType: "edition",
      targetId: editionId,
      publicationId: pub,
      data: { edition: editionId, slot: pick.slot.slot, booking: pick.bookingId, replaced: null, by: "rule" },
    });
  }
  return picks.length;
}

/** The booking put in the slot (the newer choice wins: the slot's other booking, and this booking's other slot in the
 * edition, taken out). False when it is there already. */
export async function putPlacement(
  tx: Tx,
  who: Tenant,
  pub: string,
  edition: LayoutEdition,
  slot: AdSize,
  booking: BookingRow,
): Promise<boolean> {
  const placements = await editionPlacements(tx, pub, edition.id);
  if (placements.some((p) => p.slot === slot.slot && p.booking_id === booking.id)) return false;
  const before = placements.find((p) => p.booking_id === booking.id);
  if (before) await takeOut(tx, who, pub, edition.id, before.slot);
  const replaced = await removePlacement(tx, pub, edition.id, slot.slot);
  await addPlacement(tx, who, pub, {
    editionId: edition.id,
    slot: slot.slot,
    bookingId: booking.id,
    placedBy: who.userId,
  });
  await followBooking(tx, who, pub, edition.id, slot, booking);
  await recordAudit(tx, who, {
    action: "ad_placement.set",
    targetType: "edition",
    targetId: edition.id,
    publicationId: pub,
    data: { edition: edition.id, slot: slot.slot, booking: booking.id, replaced },
  });
  return true;
}

/** The slot's placement taken out, with the slot's artwork; the booking taken out, or null (none was there). */
export async function takeOut(tx: Tx, who: Tenant, pub: string, editionId: string, slot: string) {
  const booking = await removePlacement(tx, pub, editionId, slot);
  if (!booking) return null;
  await clearArtwork(tx, pub, editionId, slot);
  await recordAudit(tx, who, {
    action: "ad_placement.clear",
    targetType: "edition",
    targetId: editionId,
    publicationId: pub,
    data: { edition: editionId, slot, booking },
  });
  return booking;
}

/** The booking followed in every edition not yet released that runs on one of its dates or holds it: taken out where
 * it no longer fits (cancelled, another date, size or slot), its artwork kept up to date where it stays, and placed by
 * its rule where it is not (only this booking: a slot freed, or another booking taken out by hand, waits for Place).
 * The caller holds the booking's lock; the editions are locked here, in date order. */
export async function syncBooking(tx: Tx, who: Tenant, pub: string, bookingId: string): Promise<void> {
  const booking = await findBooking(tx, pub, bookingId);
  if (!booking) return;
  for (const editionId of await editionsToSync(tx, pub, booking.id, booking.dates)) {
    const found = await editionSlots(tx, pub, editionId);
    if (!found || found.released) continue;
    const placed = (await editionPlacements(tx, pub, editionId)).find((p) => p.booking_id === booking.id);
    if (placed) {
      const slot = found.slots.find((s) => s.slot === placed.slot);
      const stays = booking.status === "booked" && booking.dates.includes(found.edition.date);
      if (stays && slot && fits(rule(booking), slot)) await followBooking(tx, who, pub, editionId, slot, booking);
      else await takeOut(tx, who, pub, editionId, placed.slot);
    }
    await placeBooked(tx, who, pub, editionId, booking.id);
  }
}
