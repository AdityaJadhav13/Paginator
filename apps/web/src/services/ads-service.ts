import type {
  AdSettings,
  AdSizes,
  Advertiser,
  AdvertiserInput,
  AdvertiserPatch,
  ArtworkCheck,
  Booking,
  BookingInput,
  BookingPatch,
  CopyPlanResult,
  EditionPlan,
  PlanPage,
  PlanSlot,
} from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The contract's one artwork check, for the test double: it answers as the API decides. */
export { checkArtwork } from "@pageinator/contracts";

/** The API's own shapes (@pageinator/contracts ads.ts): the ads desk and the edition plan (L2.6). */
export type AdSizesDto = AdSizes;
export type AdSettingsDto = AdSettings;
export type AdvertiserDto = Advertiser;
export type AdvertiserInputDto = AdvertiserInput;
export type AdvertiserPatchDto = AdvertiserPatch;
export type BookingDto = Booking;
export type BookingInputDto = BookingInput;
export type BookingPatchDto = BookingPatch;
export type ArtworkCheckDto = ArtworkCheck;
export type EditionPlanDto = EditionPlan;
export type PlanPageDto = PlanPage;
export type PlanSlotDto = PlanSlot;
export type CopyPlanResultDto = CopyPlanResult;

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}
type Result<T> = Promise<ServiceResult<T, ApiProblem>>;
type Edition = Where & { readonly editionId: string };

/**
 * The ads desk and the edition plan (plan §1 L2.6), under /api/v1/orgs/:o/pubs/:p, as the header of
 * @pageinator/contracts ads.ts lists the routes: sizes, cut-off settings, advertisers, bookings and their artwork, and
 * an edition's plan (pages, placements, copy).
 */
export interface AdsService {
  sizes(input: Where): Result<AdSizesDto>;
  settings(input: Where): Result<AdSettingsDto>;
  saveSettings(input: Where & { readonly settings: AdSettingsDto }): Result<AdSettingsDto>;
  advertisers(input: Where): Result<readonly AdvertiserDto[]>;
  addAdvertiser(input: Where & { readonly input: AdvertiserInputDto }): Result<AdvertiserDto>;
  editAdvertiser(input: Where & { readonly id: string; readonly patch: AdvertiserPatchDto }): Result<AdvertiserDto>;
  bookings(input: Where & { readonly from?: string; readonly to?: string }): Result<readonly BookingDto[]>;
  book(input: Where & { readonly input: BookingInputDto; readonly idempotencyKey: string }): Result<BookingDto>;
  editBooking(input: Where & { readonly id: string; readonly patch: BookingPatchDto }): Result<BookingDto>;
  setArtwork(input: Where & { readonly id: string; readonly assetId: string }): Result<BookingDto>;
  clearArtwork(input: Where & { readonly id: string }): Result<BookingDto>;
  plan(input: Edition): Result<EditionPlanDto>;
  placeBooked(input: Edition): Result<EditionPlanDto>;
  place(input: Edition & { readonly slot: string; readonly bookingId: string }): Result<EditionPlanDto>;
  unplace(input: Edition & { readonly slot: string }): Result<EditionPlanDto>;
  planPage(
    input: Edition & { readonly page: number; readonly sectionId: string | null; readonly note: string },
  ): Result<EditionPlanDto>;
  copyPlan(input: Edition & { readonly fromEditionId: string }): Result<CopyPlanResultDto>;
}
