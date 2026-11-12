/**
 * The real edition service over a recording fetch: the paths, bodies and Idempotency-Key the API's editions routes
 * take (plan §1 L2.1, §5.2), every answer read with the API's own schema, edition_exists keeping the edition of that
 * date, and "Send to the Desk" taking the ZIP as a Blob with its file name and story count. Fictional data only.
 */
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiEditionService } from "../../src/api/edition-service.ts";
import { fakeFetch, json, type RecordedCall } from "./fake-fetch.ts";

const ORG = "0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const EDITION_ID = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
const BASE = `/api/v1/orgs/${ORG}/pubs/${PUB}/editions`;
const EDITION = {
  id: EDITION_ID,
  date: "2026-11-05",
  pages: 8,
  backPageAds: true,
  volume: "12",
  issue: "303",
  price: "₹5",
  status: "planning",
  counts: { stories: 3, ready: 2, spiked: 1 },
};

function service(route: (call: RecordedCall) => Response) {
  const { fetch, calls } = fakeFetch(route);
  return { editions: createApiEditionService(createApiClient({ fetch })), calls };
}

describe("The real edition service", () => {
  it("lists a publication's editions with the API's schema", async () => {
    const { editions, calls } = service(() => json(200, { items: [EDITION] }));
    expect(await editions.list({ orgId: ORG, pubId: PUB })).toEqual({ ok: true, value: [EDITION] });
    expect(calls[0]).toMatchObject({ url: BASE, method: "GET" });
    const odd = service(() => json(200, { items: [{ ...EDITION, pages: "8" }] }));
    expect(await odd.editions.list({ orgId: ORG, pubId: PUB })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
  });

  it("creates with the body and the Idempotency-Key, and keeps the edition of that date on edition_exists", async () => {
    const { editions, calls } = service(() =>
      calls.length === 1
        ? json(201, EDITION)
        : json(409, { error: { code: "edition_exists", message: "There is already an edition for that date.", current: EDITION, requestId: "r" } }),
    );
    const input = { date: "2026-11-05", pages: 8 as const, issue: "303" };
    expect(await editions.create({ orgId: ORG, pubId: PUB, input, idempotencyKey: "key-1" })).toEqual({ ok: true, value: EDITION });
    expect(calls[0]).toMatchObject({ url: BASE, method: "POST", body: input });
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("key-1");
    const again = await editions.create({ orgId: ORG, pubId: PUB, input, idempotencyKey: "key-2" });
    expect(again).toMatchObject({ ok: false, error: { status: 409, code: "edition_exists", current: EDITION } });
  });

  it("sends to the Desk: POST {} and the ZIP as a Blob, with its file name and story count", async () => {
    const { editions, calls } = service(
      () =>
        new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="pageinator-stories-2026-11-05.zip"',
            "X-Pageinator-Bundle": "b-1",
            "X-Pageinator-Stories": "2",
          },
        }),
    );
    const result = await editions.deskBundle({ orgId: ORG, pubId: PUB, editionId: EDITION_ID });
    expect(calls[0]).toMatchObject({ url: `${BASE}/${EDITION_ID}/desk-bundle`, method: "POST", body: {} });
    expect(calls[0]!.headers.get("X-Pageinator")).toBe("1");
    expect(calls[0]!.headers.get("Idempotency-Key")).toBeNull();
    if (!result.ok) throw new Error("not sent");
    expect(result.value).toMatchObject({ filename: "pageinator-stories-2026-11-05.zip", stories: 2 });
    expect(result.value.file.size).toBe(4);
  });

  it("reads a refusal's envelope with each story named, and a ZIP without its count as unexpected", async () => {
    const refused = service(() =>
      json(409, {
        error: {
          code: "bundle_refused",
          message: "Some stories cannot be sent.",
          details: [{ field: "stories.s1", message: "The story “Fictional fair” has no text." }],
          requestId: "r",
        },
      }),
    );
    expect(await refused.editions.deskBundle({ orgId: ORG, pubId: PUB, editionId: EDITION_ID })).toMatchObject({
      ok: false,
      error: { code: "bundle_refused", details: [{ field: "stories.s1", message: "The story “Fictional fair” has no text." }] },
    });
    const bare = service(() => new Response("PK", { status: 200, headers: { "Content-Type": "application/zip" } }));
    expect(await bare.editions.deskBundle({ orgId: ORG, pubId: PUB, editionId: EDITION_ID })).toMatchObject({
      ok: false,
      error: { code: "unexpected_answer" },
    });
  });
});
