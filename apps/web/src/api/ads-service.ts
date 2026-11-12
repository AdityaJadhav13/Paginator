/**
 * The ads desk and the edition plan over the API (docs/product/10-l2-newsroom-plan.md §1 L2.6), under
 * /api/v1/orgs/:o/pubs/:p: every answer read with the API's own schema (@pageinator/contracts ads.ts), so a change of
 * shape shows as an error, never as a wrong screen. A refusal (409 advertiser_exists, not_editable) comes back as the
 * problem.
 */
import {
  AdSettings,
  AdSizes,
  Advertiser,
  AdvertiserList,
  Booking,
  BookingList,
  CopyPlanResult,
  EditionPlan,
} from "@pageinator/contracts";
import type { AdsService, ApiProblem, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: answer.problem };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

const items = <T,>(result: ServiceResult<{ items: T[] }, ApiProblem>): ServiceResult<readonly T[], ApiProblem> =>
  result.ok ? { ok: true, value: result.value.items } : result;

const pub = (orgId: string, pubId: string) =>
  `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}`;
const plan = (o: string, p: string, e: string) => `${pub(o, p)}/editions/${encodeURIComponent(e)}/plan`;

export function createApiAdsService(client: ApiClient): AdsService {
  return {
    async sizes({ orgId, pubId }) {
      return read(AdSizes, await client.get(`${pub(orgId, pubId)}/ads/sizes`));
    },
    async settings({ orgId, pubId }) {
      return read(AdSettings, await client.get(`${pub(orgId, pubId)}/ads/settings`));
    },
    async saveSettings({ orgId, pubId, settings }) {
      return read(AdSettings, await client.put(`${pub(orgId, pubId)}/ads/settings`, settings));
    },
    async advertisers({ orgId, pubId }) {
      return items(read(AdvertiserList, await client.get(`${pub(orgId, pubId)}/advertisers`)));
    },
    async addAdvertiser({ orgId, pubId, input }) {
      return read(Advertiser, await client.post(`${pub(orgId, pubId)}/advertisers`, input));
    },
    async editAdvertiser({ orgId, pubId, id, patch }) {
      return read(Advertiser, await client.patch(`${pub(orgId, pubId)}/advertisers/${encodeURIComponent(id)}`, patch));
    },
    async bookings({ orgId, pubId, from, to }) {
      const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
      return items(read(BookingList, await client.get(`${pub(orgId, pubId)}/bookings${query ? `?${query}` : ""}`)));
    },
    async book({ orgId, pubId, input, idempotencyKey }) {
      return read(Booking, await client.post(`${pub(orgId, pubId)}/bookings`, input, { idempotencyKey }));
    },
    async editBooking({ orgId, pubId, id, patch }) {
      return read(Booking, await client.patch(`${pub(orgId, pubId)}/bookings/${encodeURIComponent(id)}`, patch));
    },
    async setArtwork({ orgId, pubId, id, assetId }) {
      return read(
        Booking,
        await client.put(`${pub(orgId, pubId)}/bookings/${encodeURIComponent(id)}/artwork`, { assetId }),
      );
    },
    async clearArtwork({ orgId, pubId, id }) {
      return read(Booking, await client.delete(`${pub(orgId, pubId)}/bookings/${encodeURIComponent(id)}/artwork`));
    },
    async plan({ orgId, pubId, editionId }) {
      return read(EditionPlan, await client.get(plan(orgId, pubId, editionId)));
    },
    async placeBooked({ orgId, pubId, editionId }) {
      return read(EditionPlan, await client.post(`${plan(orgId, pubId, editionId)}/place`, {}));
    },
    async place({ orgId, pubId, editionId, slot, bookingId }) {
      const path = `${plan(orgId, pubId, editionId)}/slots/${encodeURIComponent(slot)}`;
      return read(EditionPlan, await client.put(path, { bookingId }));
    },
    async unplace({ orgId, pubId, editionId, slot }) {
      return read(
        EditionPlan,
        await client.delete(`${plan(orgId, pubId, editionId)}/slots/${encodeURIComponent(slot)}`),
      );
    },
    async planPage({ orgId, pubId, editionId, page, sectionId, note }) {
      return read(EditionPlan, await client.put(`${plan(orgId, pubId, editionId)}/pages/${page}`, { sectionId, note }));
    },
    async copyPlan({ orgId, pubId, editionId, fromEditionId }) {
      return read(CopyPlanResult, await client.post(`${plan(orgId, pubId, editionId)}/copy`, { fromEditionId }));
    },
  };
}
