/**
 * The real news finder service over a recording fetch: the paths, bodies and Idempotency-Key the API's news routes take
 * (L2.7), and every answer read with the API's own schema (a wrong shape is unexpected_answer, never a wrong screen).
 * Fictional data only.
 */
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiMediaService } from "../../src/api/media-service.ts";
import { createApiNewsService } from "../../src/api/news-service.ts";
import { fakeFetch, json } from "./fake-fetch.ts";

const ORG = "0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const ID = "7c1d2e3f-4051-4b62-9c73-8d94ea5fb601";
const BASE = `/api/v1/orgs/${ORG}/pubs/${PUB}/news`;
const AT = "2026-10-22T08:00:00.000Z";

const DRAFT = {
  id: ID,
  topicId: ID,
  state: "done",
  language: "mr",
  length: "standard",
  findPhoto: false,
  storyId: ID,
  flagged: [],
  photos: [],
  chosenAssetId: null,
  error: null,
  createdAt: AT,
  updatedAt: AT,
};

describe("The news service", () => {
  it("picks with the Idempotency-Key, reads drafts and topics by their schemas, filters topics by language", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/pick")) return json(202, { draftId: ID });
      if (call.url.includes("/drafts/")) return json(200, DRAFT);
      if (call.url.includes("/topics")) return json(200, { items: [] });
      return json(202, { runId: ID });
    });
    const news = createApiNewsService(createApiClient({ fetch }));
    const where = { orgId: ORG, pubId: PUB };
    const picked = await news.pick({ ...where, topicId: ID, pick: { language: "mr", length: "short", findPhoto: true }, idempotencyKey: "key-1" });
    expect(picked).toEqual({ ok: true, value: { draftId: ID } });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/topics/${ID}/pick`, body: { language: "mr", length: "short", findPhoto: true } });
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("key-1");
    expect(await news.getDraft({ ...where, draftId: ID })).toEqual({ ok: true, value: DRAFT });
    expect(await news.listTopics({ ...where, language: "en" })).toEqual({ ok: true, value: [] });
    expect(calls[2]!.url).toBe(`${BASE}/topics?language=en`);
    expect(await news.collect(where)).toEqual({ ok: true, value: undefined });
    expect(calls[3]).toMatchObject({ method: "POST", url: `${BASE}/collect` });
  });

  it("sends the photo choice and answers a wrong shape as unexpected", async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { assetId: "not-an-id" }));
    const news = createApiNewsService(createApiClient({ fetch }));
    const chosen = await news.choosePhoto({ orgId: ORG, pubId: PUB, draftId: ID, index: 2, rightsConfirmed: true });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/drafts/${ID}/photo`, body: { index: 2, rightsConfirmed: true } });
    expect(chosen).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
  });

  it("passes the API's 422 rights_needed through", async () => {
    const { fetch } = fakeFetch(() =>
      json(422, { error: { code: "rights_needed", message: "This photo needs permission.", requestId: "r-1" } }),
    );
    const media = createApiMediaService(createApiClient({ fetch }));
    const ticked = await media.confirmRights({ orgId: ORG, pubId: PUB, assetId: ID });
    expect(ticked).toMatchObject({ ok: false, error: { kind: "answer", status: 422, code: "rights_needed" } });
  });
});
