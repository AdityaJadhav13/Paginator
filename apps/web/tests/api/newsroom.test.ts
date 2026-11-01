/**
 * The real comment and notification services over a recording fetch: the paths, query strings, bodies and
 * Idempotency-Keys the API's routes expect (plan §5.2, as built in PR 19), and answers read with the API's own schema.
 * Fictional ids only.
 */
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiCommentService } from "../../src/api/comment-service.ts";
import { createApiNotificationService } from "../../src/api/notification-service.ts";
import { createApiAuditService } from "../../src/api/audit-service.ts";
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

describe("The audit log over the API", () => {
  const EVENT = {
    id: COMMENT,
    at: AT,
    actor: { kind: "user", id: PERSON.id, name: PERSON.name },
    action: "story.status_change",
    target: { type: "story", id: STORY },
    publicationId: PUB,
    requestId: "req-1",
    data: { from: "draft", to: "filed" },
    ip: null,
    userAgent: null,
  };

  it("asks under the organisation with its filters, cursor and limit, and reads the page with the API's schema", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { items: [EVENT], nextCursor: "c2" }));
    const audit = createApiAuditService(createApiClient({ fetch }));
    const page = await audit.list({
      orgId: ORG,
      action: "story.status_change",
      publication: PUB,
      from: "2026-10-21T00:00:00+05:30",
      to: "2026-10-22T00:00:00+05:30",
      cursor: "c1",
      limit: 50,
    });
    expect(page).toEqual({ ok: true, value: { items: [EVENT], nextCursor: "c2" } });
    expect(calls[0]!.url).toBe(
      `/api/v1/orgs/${ORG}/audit?action=story.status_change&publication=${PUB}&from=2026-10-21T00%3A00%3A00%2B05%3A30&to=2026-10-22T00%3A00%3A00%2B05%3A30&cursor=c1&limit=50`,
    );
    await audit.list({ orgId: ORG });
    expect(calls[1]!.url).toBe(`/api/v1/orgs/${ORG}/audit`);
  });

  it("passes the API's refusal on, and calls an answer of another shape an error", async () => {
    const refused = createApiAuditService(
      createApiClient({ fetch: fakeFetch(() => json(400, { error: { code: "invalid_request", message: "Some fields are not right." } })).fetch }),
    );
    const result = await refused.list({ orgId: ORG, action: "story.explode" });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "answer") expect(result.error.status).toBe(400);
    const odd = createApiAuditService(createApiClient({ fetch: fakeFetch(() => json(200, { items: [{ ...EVENT, ip: 7 }], nextCursor: null })).fetch }));
    expect((await odd.list({ orgId: ORG })).ok).toBe(false);
  });
});
