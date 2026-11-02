/**
 * The real photo services over a recording fetch and a fake XMLHttpRequest: presign with its Idempotency-Key, the
 * form to the store with the policy's fields first and the file last, progress and cancel, the store's XML refusals,
 * complete, the original fetched without the HTTP cache, and the story's photo on its version. Fictional data only.
 */
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiMediaService } from "../../src/api/media-service.ts";
import { createApiStoryService } from "../../src/api/story-service.ts";
import { fakeFetch, json, type RecordedCall } from "./fake-fetch.ts";

const ORG = "0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const UPLOAD = "5ab16273-8495-4fa6-b0b7-c1d8e2f93a4b";
const ASSET = "6bc27384-95a6-4b07-8c18-d2e9f3a04b5c";
const STORY_ID = "7c1d2e3f-4051-4b62-9c73-8d94ea5fb601";
const PRESIGNED = {
  uploadId: UPLOAD,
  url: "http://127.0.0.1:58333/pgn-fictional-work",
  fields: { key: `uploads/orgs/${ORG}/pubs/${PUB}/${UPLOAD}`, "Content-Type": "image/png", "x-amz-meta-upload-id": UPLOAD, Policy: "e30=" },
  expiresAt: "2026-10-22T11:00:00.000Z",
};
const ASSET_DTO = {
  id: ASSET,
  kind: "photo",
  status: "received",
  mime: "image/png",
  bytes: 24,
  widthPx: 800,
  heightPx: 600,
  sha256: "0".repeat(64),
  createdAt: "2026-10-22T10:00:00.000Z",
};

/** A recording XMLHttpRequest: what was sent, and the answer to give. */
class FakeXhr {
  static last: FakeXhr | undefined;
  method = "";
  url = "";
  body: FormData | undefined;
  status = 0;
  responseText = "";
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  answer(status: number, text = "") {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

function media(route: (call: RecordedCall) => Response = () => json(200, {})) {
  const { fetch, calls } = fakeFetch(route);
  const client = createApiClient({ fetch });
  return { service: createApiMediaService(client, { fetch, xhr: () => new FakeXhr() as unknown as XMLHttpRequest, isOnline: () => true }), calls };
}

describe("The real media service", () => {
  it("presigns with the Idempotency-Key, and reads the policy with the API's schema", async () => {
    const { service, calls } = media(() => json(201, PRESIGNED));
    const result = await service.presign({ orgId: ORG, pubId: PUB, filename: "fair.png", contentType: "image/png", bytes: 24, idempotencyKey: "k-1" });
    expect(result).toEqual({ ok: true, value: PRESIGNED });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/orgs/${ORG}/pubs/${PUB}/uploads`,
      body: { purpose: "story_photo", filename: "fair.png", contentType: "image/png", bytes: 24 },
    });
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("k-1");
  });

  it("sends the policy's fields first and the file last, with progress", async () => {
    const { service } = media();
    const progress = vi.fn();
    const file = new File(["fictional"], "fair.png", { type: "image/png" });
    const sent = service.send({ upload: PRESIGNED, file, onProgress: progress });
    const xhr = FakeXhr.last!;
    expect([xhr.method, xhr.url]).toEqual(["POST", PRESIGNED.url]);
    expect([...xhr.body!.keys()]).toEqual(["key", "Content-Type", "x-amz-meta-upload-id", "Policy", "file"]);
    expect(xhr.body!.get("key")).toBe(PRESIGNED.fields.key);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 4 });
    xhr.answer(204);
    expect(await sent).toEqual({ ok: true, value: undefined });
    expect(progress.mock.calls.map(([fraction]) => fraction)).toEqual([0.75, 1]);
  });

  it("cancels, and words the store's refusals", async () => {
    const { service } = media();
    const file = new File(["x"], "fair.png", { type: "image/png" });
    const controller = new AbortController();
    const cancelled = service.send({ upload: PRESIGNED, file, signal: controller.signal });
    controller.abort();
    expect(await cancelled).toMatchObject({ ok: false, error: { code: "upload_cancelled" } });
    for (const [status, xml, code] of [
      [403, "<Error><Code>AccessDenied</Code><Message>Policy expired.</Message></Error>", "upload_denied"],
      [400, "<Error><Code>EntityTooLarge</Code></Error>", "upload_size_mismatch"],
      [400, "<Error><Code>EntityTooSmall</Code></Error>", "upload_size_mismatch"],
      [400, "<Error><Code>InvalidArgument</Code></Error>", "upload_refused"],
      [503, "", "server_error"],
    ] as const) {
      const sent = service.send({ upload: PRESIGNED, file });
      FakeXhr.last!.answer(status, xml);
      expect(await sent, code).toMatchObject({ ok: false, error: { status, code } });
    }
    const lost = service.send({ upload: PRESIGNED, file });
    FakeXhr.last!.onerror?.();
    expect(await lost).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("completes the upload into an asset, read with the API's schema", async () => {
    const { service, calls } = media(() => json(200, { asset: ASSET_DTO }));
    expect(await service.complete({ orgId: ORG, pubId: PUB, uploadId: UPLOAD })).toEqual({ ok: true, value: ASSET_DTO });
    expect(calls[0]).toMatchObject({ method: "POST", url: `/api/v1/orgs/${ORG}/pubs/${PUB}/uploads/${UPLOAD}/complete` });
    const odd = media(() => json(200, { asset: { ...ASSET_DTO, mime: "image/heic" } }));
    expect(await odd.service.complete({ orgId: ORG, pubId: PUB, uploadId: UPLOAD })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
    const refused = media(() =>
      json(422, { error: { code: "not_a_picture", message: "Not a picture.", requestId: "r", details: [{ field: "file", message: "The file was refused: it is HEIC." }] } }),
    );
    expect(await refused.service.complete({ orgId: ORG, pubId: PUB, uploadId: UPLOAD })).toMatchObject({ ok: false, error: { status: 422, code: "not_a_picture" } });
  });

  it("fetches the original afresh each time, with no HTTP cache, and gives the address to download it", async () => {
    const { service, calls } = media(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } }));
    const first = await service.loadOriginal({ orgId: ORG, pubId: PUB, assetId: ASSET });
    await service.loadOriginal({ orgId: ORG, pubId: PUB, assetId: ASSET });
    expect(first.ok && first.value.size).toBe(3);
    // a GET needs no X-Pageinator (the API's guard is for changes)
    expect(calls.every((call) => call.headers.get("X-Pageinator") === null)).toBe(true);
    expect(calls.map((call) => [call.url, call.cache, call.credentials])).toEqual([
      [`/api/v1/orgs/${ORG}/pubs/${PUB}/assets/${ASSET}/file`, "no-store", "same-origin"],
      [`/api/v1/orgs/${ORG}/pubs/${PUB}/assets/${ASSET}/file`, "no-store", "same-origin"],
    ]);
    expect(service.fileUrl({ orgId: ORG, pubId: PUB, assetId: ASSET })).toBe(`/api/v1/orgs/${ORG}/pubs/${PUB}/assets/${ASSET}/file`);
    const missing = media(() => json(404, { error: { code: "not_found", message: "Nothing here.", requestId: "r" } }));
    expect(await missing.service.loadOriginal({ orgId: ORG, pubId: PUB, assetId: ASSET })).toMatchObject({ ok: false, error: { status: 404, code: "not_found" } });
  });
});

describe("The story's photo over the real story service", () => {
  it("puts, patches and deletes the photo on the story's version", async () => {
    const { fetch, calls } = fakeFetch(() => json(409, { error: { code: "story_changed", message: "Changed.", requestId: "r" } }));
    const stories = createApiStoryService(createApiClient({ fetch }));
    const where = { orgId: ORG, pubId: PUB, storyId: STORY_ID };
    await stories.attachPhoto({ ...where, baseRevision: 3, assetId: ASSET, caption: "A caption", credit: "A credit" });
    await stories.updatePhoto({ ...where, baseRevision: 4, caption: "New caption" });
    await stories.removePhoto({ ...where, baseRevision: 5 });
    const base = `/api/v1/orgs/${ORG}/pubs/${PUB}/stories/${STORY_ID}/photo`;
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ["PUT", base, { baseRevision: 3, assetId: ASSET, caption: "A caption", credit: "A credit" }],
      ["PATCH", base, { baseRevision: 4, caption: "New caption" }],
      ["DELETE", `${base}?baseRevision=5`, undefined],
    ]);
  });
});

describe("The real media library service (L2.2)", () => {
  const ITEM = {
    id: ASSET,
    status: "ready",
    problem: null,
    mime: "image/png",
    bytes: 24,
    widthPx: 800,
    heightPx: 600,
    sha256: "0".repeat(64),
    caption: "",
    credit: "",
    photographer: "",
    sharpUpToCols: null,
    uploadedBy: { id: STORY_ID, name: "Fictional Reporter" },
    usedBy: [],
    inUse: false,
    mayEdit: true,
    revision: 2,
    createdAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
    previewUrl: `/api/v1/orgs/${ORG}/pubs/${PUB}/assets/${ASSET}/file?variant=preview`,
  };
  const base = `/api/v1/orgs/${ORG}/pubs/${PUB}`;

  it("lists with the filters as the query, reads each answer with the schema, and deletes on the revision", async () => {
    const { service, calls } = media((call) =>
      call.method === "DELETE" ? new Response(null, { status: 204 }) : call.method === "PATCH" ? json(200, ITEM) : json(200, { items: [ITEM], next: "c2" }),
    );
    const where = { orgId: ORG, pubId: PUB };
    const listed = await service.list({ ...where, query: { missing: "caption", q: "fair", cursor: "c1" } });
    expect(listed).toEqual({ ok: true, value: { items: [ITEM], next: "c2" } });
    expect((await service.update({ ...where, assetId: ASSET, patch: { baseRevision: 1, caption: "A caption" } })).ok).toBe(true);
    expect(await service.remove({ ...where, assetId: ASSET, baseRevision: 2 })).toEqual({ ok: true, value: undefined });
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ["GET", `${base}/media?missing=caption&q=fair&cursor=c1`, undefined],
      ["PATCH", `${base}/assets/${ASSET}`, { baseRevision: 1, caption: "A caption" }],
      ["DELETE", `${base}/assets/${ASSET}?baseRevision=2`, undefined],
    ]);
  });

  it("keeps asset_changed's picture now, and nothing it cannot read", async () => {
    let current: unknown = ITEM;
    const { service } = media(() => json(409, { error: { code: "asset_changed", message: "Changed.", requestId: "r", current } }));
    const patch = { orgId: ORG, pubId: PUB, assetId: ASSET, patch: { baseRevision: 1, credit: "Mine" } };
    const first = await service.update(patch);
    expect(!first.ok && first.error).toMatchObject({ code: "asset_changed", current: ITEM });
    current = { id: "not a picture" };
    const second = await service.update(patch);
    expect(!second.ok && second.error.kind === "answer" && "current" in second.error).toBe(false);
  });

  it("presigns a library upload with its purpose", async () => {
    const { service, calls } = media(() => json(201, PRESIGNED));
    await service.presign({ orgId: ORG, pubId: PUB, filename: "a.png", contentType: "image/png", bytes: 24, idempotencyKey: "k", purpose: "library" });
    expect(calls[0]!.body).toEqual({ purpose: "library", filename: "a.png", contentType: "image/png", bytes: 24 });
  });
});
