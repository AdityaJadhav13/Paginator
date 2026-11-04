/**
 * The real layout service over a recording fetch (L2.3): the paths, bodies and Idempotency-Key the API's layout routes
 * take, every answer read with the API's own schema (a wrong shape is unexpected_answer, never a wrong screen), a run's
 * picture fetched from its 5-minute link without the HTTP cache, and the `layout` and `profile` live events. Fictional.
 */
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiLayoutService } from "../../src/api/layout-service.ts";
import { liveEventOf } from "../../src/api/live.ts";
import { fakeFetch, json } from "./fake-fetch.ts";

const ORG = "0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const ID = "7c1d2e3f-4051-4b62-9c73-8d94ea5fb601";
const BASE = `/api/v1/orgs/${ORG}/pubs/${PUB}`;
const AT = "2026-10-24T08:00:00.000+05:30";

const RUN = {
  id: ID,
  editionId: ID,
  deskKey: "r-20261024-081500",
  state: "queued",
  message: null,
  error: null,
  profileVersion: 2,
  createdBy: null,
  createdAt: AT,
  startedAt: null,
  finishedAt: null,
  elapsedS: 0,
  pages: [],
  notPlaced: [],
  files: { editionPdf: false, pressZip: false },
  timings: null,
};

function service(route: Parameters<typeof fakeFetch>[0]) {
  const recorded = fakeFetch(route);
  const client = createApiClient({ fetch: recorded.fetch, newIdempotencyKey: () => "key-1" });
  return { layout: createApiLayoutService(client, { fetch: recorded.fetch }), calls: recorded.calls };
}

describe("The layout service", () => {
  it("starts and cancels a run on the API's paths, with the Idempotency-Key, and reads it by its schema", async () => {
    const { layout, calls } = service((call) =>
      call.url.endsWith("/cancel") ? json(200, { ...RUN, state: "cancelled" }) : json(202, RUN),
    );
    const started = await layout.startRun({ orgId: ORG, pubId: PUB, editionId: ID, idempotencyKey: "run-key" });
    expect(started).toEqual({ ok: true, value: RUN });
    expect(calls[0]).toMatchObject({ url: `${BASE}/editions/${ID}/runs`, method: "POST" });
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("run-key");
    const cancelled = await layout.cancelRun({ orgId: ORG, pubId: PUB, runId: ID });
    expect(cancelled.ok && cancelled.value.state).toBe("cancelled");
    expect(calls[1]).toMatchObject({ url: `${BASE}/runs/${ID}/cancel`, method: "POST" });
  });

  it("answers a shape the contract does not know as unexpected_answer, and keeps the API's refusals", async () => {
    const { layout } = service((call) =>
      call.url.endsWith("/layout")
        ? json(200, { editionId: ID, profile: null })
        : json(409, { error: { code: "run_active", message: "Running.", requestId: "r" } }),
    );
    expect(await layout.getLayout({ orgId: ORG, pubId: PUB, editionId: ID })).toEqual({
      ok: false,
      error: { kind: "answer", status: 200, code: "unexpected_answer", message: "" },
    });
    const refused = await layout.startRun({ orgId: ORG, pubId: PUB, editionId: ID, idempotencyKey: "k" });
    expect(!refused.ok && refused.error.kind === "answer" && refused.error.code).toBe("run_active");
  });

  it("sets and clears an ad slot, and lists and makes engine profiles", async () => {
    const slot = { slot: "back-1", page: 8, wMm: 330, hMm: 170, state: "preparing", assetId: ID, problem: null };
    const { layout, calls } = service((call) => {
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      if (call.url.endsWith("/ads/back-1")) return json(200, slot);
      if (call.method === "POST")
        return json(400, { error: { code: "invalid_request", message: "No.", requestId: "r" } });
      return json(200, { items: [], inUse: null });
    });
    expect(await layout.setAd({ orgId: ORG, pubId: PUB, editionId: ID, slot: "back-1", assetId: ID })).toEqual({
      ok: true,
      value: slot,
    });
    expect(calls[0]).toMatchObject({ method: "PUT", url: `${BASE}/editions/${ID}/ads/back-1`, body: { assetId: ID } });
    expect(await layout.clearAd({ orgId: ORG, pubId: PUB, editionId: ID, slot: "back-1" })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await layout.listProfiles({ orgId: ORG, pubId: PUB })).toEqual({
      ok: true,
      value: { items: [], inUse: null },
    });
    await layout.createProfile({ orgId: ORG, pubId: PUB, uploadId: ID, idempotencyKey: "profile-key" });
    expect(calls[3]).toMatchObject({ method: "POST", url: `${BASE}/engine-profiles`, body: { uploadId: ID } });
    expect(calls[3]!.headers.get("Idempotency-Key")).toBe("profile-key");
  });

  it("fetches a run's picture from its 5-minute link, never from the HTTP cache", async () => {
    const link = "https://store.example/runs/x/page-01.thumb.png?sig=1";
    const { layout, calls } = service((call) =>
      call.url === link
        ? new Response("png", { status: 200, headers: { "Content-Type": "image/png" } })
        : json(200, { url: link, expiresAt: AT }),
    );
    const picture = await layout.loadFile({ orgId: ORG, pubId: PUB, runId: ID, name: "page-01.thumb.png" });
    expect(picture.ok && picture.value.type).toBe("image/png");
    expect(calls[0]!.url).toBe(`${BASE}/runs/${ID}/files/page-01.thumb.png`);
    expect(calls[1]).toMatchObject({ url: link, cache: "no-store" });
    expect(calls[1]!.credentials).toBeUndefined();
  });
});

describe("The layout's live events", () => {
  it("reads layout and profile by their ids, and nothing else", () => {
    expect(liveEventOf("layout", { publicationId: PUB, editionId: ID, runId: null })).toEqual({
      type: "layout",
      publicationId: PUB,
      editionId: ID,
      runId: null,
    });
    expect(liveEventOf("layout", { publicationId: PUB, editionId: ID, runId: ID })).toMatchObject({ runId: ID });
    expect(liveEventOf("layout", { publicationId: PUB, editionId: ID, runId: "r-1" })).toBeNull();
    expect(liveEventOf("layout", { publicationId: PUB, editionId: ID })).toBeNull();
    expect(liveEventOf("profile", { publicationId: PUB, profileId: ID })).toEqual({
      type: "profile",
      publicationId: PUB,
      profileId: ID,
    });
    expect(liveEventOf("profile", { publicationId: PUB })).toBeNull();
  });
});
