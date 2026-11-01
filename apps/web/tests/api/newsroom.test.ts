/**
 * The real comment and notification services over a recording fetch: the paths, query strings, bodies and
 * Idempotency-Keys the API's routes expect (plan §5.2, as built in PR 19), and answers read with the API's own schema.
 * Fictional ids only.
 */
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiCommentService } from "../../src/api/comment-service.ts";
import { createApiNotificationService } from "../../src/api/notification-service.ts";
import { fakeFetch, json, type RecordedCall } from "./fake-fetch.ts";

const ORG = "0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const STORY = "7c1d2e3f-4051-4b62-9c73-8d94ea5fb601";
const COMMENT = "8d2e3f40-5162-4c73-8d84-9ea5fb6c0719";
const PERSON = { id: "9e3f4051-6273-4d84-9e95-afb60c7d182a", name: "Fictional Editor" };
const AT = "2026-10-22T09:00:00.000Z";
const COMMENT_DTO = {
  id: COMMENT,
  storyId: STORY,
  parentId: null,
  author: PERSON,
  body: "तारीख तपासा.",
  createdAt: AT,
  updatedAt: AT,
  edited: false,
  resolved: null,
  can: { edit: true, resolve: true },
};
const PAGE = {
  items: [
    { id: COMMENT, kind: "comment", publicationId: PUB, storyId: STORY, commentId: COMMENT, invitationId: null, actor: PERSON, story: { headline: "पाणी", status: "draft" }, invitee: null, createdAt: AT, readAt: null },
  ],
  unread: 1,
  nextCursor: null,
};

function services(route: (call: RecordedCall) => Response) {
  const { fetch, calls } = fakeFetch(route);
  const client = createApiClient({ fetch });
  return { comments: createApiCommentService(client), notifications: createApiNotificationService(client), calls };
}

describe("Comments over the API", () => {
  it("lists, posts with an Idempotency-Key, and changes a comment on its own path", async () => {
    const { comments, calls } = services((call) => json(200, call.method === "GET" ? { items: [COMMENT_DTO] } : COMMENT_DTO));
    const listed = await comments.list({ orgId: ORG, pubId: PUB, storyId: STORY });
    expect(listed).toEqual({ ok: true, value: [COMMENT_DTO] });
    await comments.create({ orgId: ORG, pubId: PUB, storyId: STORY, body: "उत्तर", parentId: COMMENT, idempotencyKey: "k-1" });
    await comments.update({ orgId: ORG, pubId: PUB, commentId: COMMENT, patch: { resolved: true } });
    const story = `/api/v1/orgs/${ORG}/pubs/${PUB}/stories/${STORY}/comments`;
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${story}`,
      `POST ${story}`,
      `PATCH /api/v1/orgs/${ORG}/pubs/${PUB}/comments/${COMMENT}`,
    ]);
    expect(calls[1]!.headers.get("Idempotency-Key")).toBe("k-1");
    expect(calls[1]!.body).toEqual({ body: "उत्तर", parentId: COMMENT });
    expect(calls[2]!.body).toEqual({ resolved: true });
  });

  it("calls an answer of another shape an error, never a wrong screen", async () => {
    const { comments } = services(() => json(200, { items: [{ ...COMMENT_DTO, body: 7 }] }));
    const listed = await comments.list({ orgId: ORG, pubId: PUB, storyId: STORY });
    expect(listed.ok).toBe(false);
  });
});

describe("Notifications over the API", () => {
  it("lists under the organisation with the unread filter, cursor and limit, and marks some or all read", async () => {
    const { notifications, calls } = services((call) => (call.method === "GET" ? json(200, PAGE) : new Response(null, { status: 204 })));
    expect(await notifications.list({ orgId: ORG, unread: true, cursor: "c1", limit: 20 })).toEqual({ ok: true, value: PAGE });
    expect(await notifications.markRead({ orgId: ORG, ids: [COMMENT] })).toEqual({ ok: true, value: undefined });
    await notifications.markRead({ orgId: ORG, all: true });
    expect(calls[0]!.url).toBe(`/api/v1/orgs/${ORG}/notifications?unread=1&cursor=c1&limit=20`);
    expect(calls.slice(1).map((call) => [call.method, call.url, call.body])).toEqual([
      ["POST", `/api/v1/orgs/${ORG}/notifications/read`, { ids: [COMMENT] }],
      ["POST", `/api/v1/orgs/${ORG}/notifications/read`, { all: true }],
    ]);
  });
});
