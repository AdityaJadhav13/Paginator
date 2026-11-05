/**
 * The real story service over a recording fetch: the paths, query strings, bodies and Idempotency-Keys the API's
 * stories routes take (plan §5.2, §5.4), every answer read with the API's own schema, and a 409 story_changed keeping
 * the story as it is now only when it is one. Fictional data only.
 */
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiStoryService } from "../../src/api/story-service.ts";
import { fakeFetch, json, type RecordedCall } from "./fake-fetch.ts";

const ORG = "0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const STORY_ID = "7c1d2e3f-4051-4b62-9c73-8d94ea5fb601";
const PERSON = { id: "4fa05162-7384-4e95-afa6-b0c7d1e8293a", name: "Fictional Reporter" };
const BASE = `/api/v1/orgs/${ORG}/pubs/${PUB}/stories`;

const STORY = {
  id: STORY_ID,
  publicationId: PUB,
  status: "draft",
  revision: 3,
  textRevision: 2,
  headline: "Fictional fair opens",
  kicker: "",
  deck: "",
  byline: "Fictional Reporter",
  body: "The fair opens on Friday.",
  bodyFormat: "desk-text/1",
  words: 5,
  isBrief: true,
  language: "en",
  sectionId: null,
  priority: 3,
  pagePin: null,
  edition: null,
  reporter: PERSON,
  assignee: null,
  dueAt: null,
  deskNote: "",
  photo: null,
  commentCount: 0,
  updatedAt: "2026-10-22T04:00:00.000Z",
  updatedBy: PERSON,
  can: { edit: true, transitions: ["filed"], comment: true, assign: false },
};
const ITEM = Object.fromEntries(
  ["id", "status", "revision", "headline", "byline", "words", "isBrief", "language", "sectionId", "priority", "pagePin", "edition", "reporter", "assignee", "dueAt", "updatedAt", "photo", "can"].map(
    (key) => [key, STORY[key as keyof typeof STORY]],
  ),
);

function service(route: (call: RecordedCall) => Response) {
  const { fetch, calls } = fakeFetch(route);
  return { stories: createApiStoryService(createApiClient({ fetch })), calls };
}

describe("The real story service", () => {
  it("lists with the filters as the query string, and reads the page with the API's schema", async () => {
    const { stories, calls } = service(() => json(200, { items: [ITEM], nextCursor: "c2" }));
    const result = await stories.list({ orgId: ORG, pubId: PUB, filter: { status: "ready", assignee: "me", q: "fair", cursor: "c1" } });
    expect(result).toEqual({ ok: true, value: { items: [ITEM], nextCursor: "c2" } });
    expect(calls[0]!.url).toBe(`${BASE}?status=ready&assignee=me&q=fair&cursor=c1`);
    const bare = service(() => json(200, { items: [], nextCursor: null }));
    await bare.stories.list({ orgId: ORG, pubId: PUB, filter: {} });
    expect(bare.calls[0]!.url).toBe(BASE);
  });

  it("refuses a list or a story it cannot read", async () => {
    const { stories } = service(() => json(200, { items: [{ ...ITEM, status: "lost" }], nextCursor: null }));
    expect(await stories.list({ orgId: ORG, pubId: PUB, filter: {} })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
    const other = service(() => json(200, { ...STORY, extra: true }));
    expect(await other.stories.get({ orgId: ORG, pubId: PUB, storyId: STORY_ID })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
  });

  it("creates, pastes and moves with an Idempotency-Key; changes and assigns against the version", async () => {
    const { stories, calls } = service((call) =>
      call.url.endsWith("/paste") ? json(201, { created: [STORY], skipped: [{ headline: "Alone", reason: "Every article needs some text." }] }) : json(200, STORY),
    );
    await stories.create({ orgId: ORG, pubId: PUB, input: { headline: "Fictional fair opens", body: "Text." }, idempotencyKey: "k-create" });
    await stories.update({ orgId: ORG, pubId: PUB, storyId: STORY_ID, patch: { baseRevision: 3, body: "New text." } });
    await stories.transition({ orgId: ORG, pubId: PUB, storyId: STORY_ID, to: "draft", baseRevision: 3, comment: "Add the date.", idempotencyKey: "k-move" });
    await stories.transition({ orgId: ORG, pubId: PUB, storyId: STORY_ID, to: "filed", baseRevision: 4, idempotencyKey: "k-file" });
    await stories.assign({ orgId: ORG, pubId: PUB, storyId: STORY_ID, baseRevision: 5, userId: null });
    const pasted = await stories.paste({ orgId: ORG, pubId: PUB, text: "A\nB\n---\nAlone", idempotencyKey: "k-paste" });
    expect(pasted).toMatchObject({ ok: true, value: { created: [{ id: STORY_ID }], skipped: [{ headline: "Alone" }] } });
    expect(calls.map((call) => [call.method, call.url, call.body, call.headers.get("Idempotency-Key")])).toEqual([
      ["POST", BASE, { headline: "Fictional fair opens", body: "Text." }, "k-create"],
      ["PATCH", `${BASE}/${STORY_ID}`, { baseRevision: 3, body: "New text." }, null],
      ["POST", `${BASE}/${STORY_ID}/transitions`, { to: "draft", baseRevision: 3, comment: "Add the date." }, "k-move"],
      ["POST", `${BASE}/${STORY_ID}/transitions`, { to: "filed", baseRevision: 4 }, "k-file"],
      ["POST", `${BASE}/${STORY_ID}/assignee`, { baseRevision: 5, userId: null }, null],
      ["POST", `${BASE}/paste`, { text: "A\nB\n---\nAlone" }, "k-paste"],
    ]);
  });

  it("imports a Word file with an Idempotency-Key, and reads the import with the API's schema", async () => {
    const IMPORT = "9a1b2c3d-4e5f-4061-8a72-b3c4d5e6f708";
    const UPLOAD = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
    const done = {
      id: IMPORT,
      state: "done",
      editionId: null,
      created: [{ storyId: STORY_ID, headline: "Fictional fair opens" }],
      skipped: 0,
      notes: [{ code: "docx.tables", count: 1, text: "1 table was left out." }],
      error: null,
      createdAt: "2026-10-22T04:00:00.000Z",
      updatedAt: "2026-10-22T04:01:00.000Z",
    };
    const { stories, calls } = service((call) => (call.method === "POST" ? json(202, { importId: IMPORT }) : json(200, done)));
    expect(await stories.importDocx({ orgId: ORG, pubId: PUB, uploadId: UPLOAD, idempotencyKey: "k-import" })).toEqual({ ok: true, value: { importId: IMPORT } });
    expect(await stories.getImport({ orgId: ORG, pubId: PUB, importId: IMPORT })).toEqual({ ok: true, value: done });
    expect(calls.map((call) => [call.method, call.url, call.body, call.headers.get("Idempotency-Key")])).toEqual([
      ["POST", `/api/v1/orgs/${ORG}/pubs/${PUB}/imports/docx`, { uploadId: UPLOAD }, "k-import"],
      ["GET", `/api/v1/orgs/${ORG}/pubs/${PUB}/imports/${IMPORT}`, undefined, null],
    ]);
    const odd = service(() => json(200, { ...done, state: "lost" }));
    expect(await odd.stories.getImport({ orgId: ORG, pubId: PUB, importId: IMPORT })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
  });

  it("keeps no answer in the browser's HTTP cache, and lets a save outlive the page when asked", async () => {
    const { stories, calls } = service(() => json(200, STORY));
    await stories.get({ orgId: ORG, pubId: PUB, storyId: STORY_ID });
    await stories.update({ orgId: ORG, pubId: PUB, storyId: STORY_ID, patch: { baseRevision: 3, body: "x" }, keepalive: true });
    expect(calls.map((call) => [call.cache, call.keepalive])).toEqual([
      ["no-store", undefined],
      ["no-store", true],
    ]);
  });

  it("keeps the story as it is now with a 409 story_changed, and only when it is one", async () => {
    const changed = (current: unknown) =>
      json(409, { error: { code: "story_changed", message: "Changed.", requestId: "r", current } });
    const { stories } = service(() => changed({ ...STORY, revision: 4, body: "Their text." }));
    const result = await stories.update({ orgId: ORG, pubId: PUB, storyId: STORY_ID, patch: { baseRevision: 3, body: "Mine." } });
    expect(result).toMatchObject({ ok: false, error: { status: 409, code: "story_changed", current: { revision: 4, body: "Their text." } } });

    const odd = service(() => changed({ not: "a story" }));
    const refused = await odd.stories.update({ orgId: ORG, pubId: PUB, storyId: STORY_ID, patch: { baseRevision: 3, body: "Mine." } });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.kind === "answer" && "current" in refused.error).toBe(false);
  });

  it("gives the API's refusals as they are", async () => {
    for (const [status, code] of [
      [403, "not_allowed"],
      [403, "two_step_required"],
      [404, "not_found"],
      [409, "invalid_transition"],
    ] as const) {
      const { stories } = service(() => json(status, { error: { code, message: "Refused.", requestId: "r" } }));
      expect(await stories.transition({ orgId: ORG, pubId: PUB, storyId: STORY_ID, to: "ready", baseRevision: 3, idempotencyKey: "k" })).toMatchObject({
        ok: false,
        error: { status, code },
      });
    }
  });
});
