// Notifications and live updates over HTTP (docs/product/10-l2-newsroom-plan.md §5.2; PR 19). As built, under the
// organisation (/api/v1/orgs/:o/…, not the plan's /notifications and /events?org=), so the access check is the one
// every organisation route has: a non-member gets 404, and two-step sign-in is required where the organisation asks
// for it. The permission is publication.view (any role on any publication: a member with none has nothing to hear).
//   - GET …/notifications?unread=1&cursor=&limit= → {items, unread, nextCursor}: the person's own, newest first, only
//     those of publications they still reach (and of none, as an invitation's). Each carries the text to show it by,
//     read in the list's one query: its story's headline and state while the reader still sees the story (the story
//     rules, as GET …/stories/:s applies them; null once they do not), and an accepted invitation's invitee;
//   - POST …/notifications/read {ids} | {all: true} → 204;
//   - GET …/events → text/event-stream (src/modules/notifications/events.ts): story, comment, notification, resync;
//     a comment line every 25 s; `resync` first when the browser reconnects (Last-Event-ID), and to everyone after the
//     LISTEN connection was lost. At most STREAMS_PER_PERSON at once (429 slow_down beyond). The streams end in a
//     preClose hook, so a stop does not wait the grace period for them.
import { PassThrough } from "node:stream";
import {
  type Notification,
  NotificationList,
  NotificationQuery,
  NotificationsRead,
  type StoryStatus,
  reach,
} from "@pageinator/contracts";
import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { listenAppEvents } from "../../db/events.ts";
import { type NotificationRow, cursorOf, listNotifications, markRead, unreadCount } from "../../db/notifications.ts";
import { isStoryOfTheirs } from "../../db/stories.ts";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf, actorOf, needsTwoStep, orgView } from "../access/access.ts";
import { ABSOLUTE_MS } from "../identity/session.ts";
import { sees } from "../stories/rules.ts";
import { type Hub, type Stream, eventHub } from "./events.ts";

const Org = z.strictObject({ o: z.string() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export const HEARTBEAT_MS = 25_000;
export const STREAMS_PER_PERSON = 5;
/** A stream whose client reads nothing is ended once this much waits unsent. */
const MAX_BUFFERED = 256 * 1024;

export type LiveOptions = {
  database: Database;
  hub: Hub;
  /** How often a stream re-checks its person and sends a comment line (tests make it short). */
  heartbeatMs?: number;
};

/** A notification's story as the reader may see it now (the story rules on top of the publication wall), or null. */
function storyShown(access: Access, userId: string, row: NotificationRow): Notification["story"] {
  const pub = row.data.publicationId;
  if (!pub || row.story_headline === null || row.story_status === null || row.story_reporter_id === null) return null;
  const status = row.story_status as StoryStatus;
  const facts = { status, reporterId: row.story_reporter_id, assigneeId: row.story_assignee_id };
  return sees(access, pub, facts, userId) ? { headline: row.story_headline, status } : null;
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString("base64url");
}
function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [unknown, unknown];
    if (typeof createdAt === "string" && CURSOR_TIME.test(createdAt) && typeof id === "string" && UUID.test(id)) {
      return { createdAt, id };
    }
  } catch {
    // not one of ours
  }
  throw new ApiError("invalid_request", [{ field: "querystring.cursor", message: "is not a cursor this API gave" }]);
}

/** The live updates' hub and its LISTEN connection, on the root instance: the streams end in its preClose hook, before
 * the server waits for its connections, and then the LISTEN connection closes. */
export function startLive(app: FastifyInstance, database: Database): Hub {
  const hub = eventHub((reason) => app.log.warn({ reason }, "a live-update message was dropped"));
  const listening = listenAppEvents(database, {
    onMessage: (text) => hub.deliver(text),
    onGap: () => hub.resync(),
    onError: (error) => app.log.warn({ code: (error as { code?: string }).code }, `LISTEN failed: ${error.message}`),
  });
  app.addHook("preClose", async () => {
    hub.endAll();
  });
  app.addHook("onClose", async () => {
    await listening.close();
  });
  app.decorate("liveReady", () => listening.ready);
  app.decorate("liveStreams", () => hub.size());
  return hub;
}

export const notificationRoutes: FastifyPluginAsyncZod<LiveOptions> = async (app, { database, hub, heartbeatMs }) => {
  app.get(
    "/api/v1/orgs/:o/notifications",
    {
      config: { permission: "publication.view" },
      schema: { params: Org, querystring: NotificationQuery, response: { 200: NotificationList } },
    },
    async (request) => {
      const access = accessOf(request);
      const actor = actorOf(request);
      const q = request.query;
      const limit = q.limit ?? 30;
      const before = q.cursor === undefined ? undefined : decodeCursor(q.cursor);
      return database.withTenant(access.tenant, async (tx) => {
        const rows = await listNotifications(tx, {
          unread: q.unread === "1",
          limit: limit + 1,
          ...(before ? { before } : {}),
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const at = rows.length > limit && last ? await cursorOf(tx, last.id) : null;
        return {
          items: page.map((row) => ({
            id: row.id,
            kind: row.kind,
            publicationId: row.data.publicationId ?? null,
            storyId: row.data.storyId ?? null,
            commentId: row.data.commentId ?? null,
            invitationId: row.data.invitationId ?? null,
            actor: row.actor_name !== null ? { id: row.data.actorId, name: row.actor_name } : null,
            story: storyShown(access, actor.userId, row),
            invitee:
              row.kind === "invitation_accepted" && row.actor_name !== null
                ? { id: row.data.actorId, name: row.actor_name }
                : null,
            createdAt: row.created_at.toISOString(),
            readAt: row.read_at ? row.read_at.toISOString() : null,
          })),
          unread: await unreadCount(tx),
          nextCursor: at && last ? encodeCursor(at, last.id) : null,
        };
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/notifications/read",
    { config: { permission: "publication.view" }, schema: { params: Org, body: NotificationsRead } },
    async (request, reply) => {
      const access = accessOf(request);
      const which = request.body;
      await database.withTenant(access.tenant, (tx) => markRead(tx, "ids" in which ? { ids: which.ids } : which));
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/v1/orgs/:o/events",
    { config: { permission: "publication.view" }, schema: { params: Org } },
    async (request, reply) => {
      const access = accessOf(request);
      const actor = actorOf(request);
      if (hub.count(actor.userId) >= STREAMS_PER_PERSON) throw new ApiError("slow_down");
      const out = new PassThrough();
      let id = 0;
      let ended = false;
      const write = (text: string) => {
        if (ended) return;
        out.write(text);
        if (out.writableLength > MAX_BUFFERED) {
          // a client that reads nothing: its connection goes too, so its buffers and its slot are freed
          stream.end();
          reply.raw.destroy();
        }
      };
      const stream: Stream = {
        orgId: access.tenant.orgId,
        userId: actor.userId,
        access: { orgRole: access.orgRole, publications: access.publications },
        async confirm(publicationId, storyId) {
          const tenant = {
            orgId: stream.orgId,
            userId: actor.userId,
            pubIds: [...stream.access.publications.keys()],
            requestId: request.id,
          };
          return database.withTenant(tenant, (tx) => isStoryOfTheirs(tx, publicationId, storyId, actor.userId));
        },
        send(event, data) {
          id += 1;
          write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
        end() {
          if (ended) return;
          ended = true;
          clearInterval(timer);
          hub.remove(stream);
          out.end();
        },
      };
      /** The person still holds the session and the membership (and two-step, when asked): else the stream ends. */
      const check = async () => {
        try {
          // the session as it is now: ended, expired, or no longer made with two-step (two-step turned off)
          const session = await database.identity.sessionNow(actor.sessionId, ABSOLUTE_MS);
          if (!session) return stream.end();
          const view = await orgView(database, actor, stream.orgId, request.id);
          const roles = view ? [...view.publications.values()].flatMap((here) => here.roles) : [];
          if (!view || (needsTwoStep(view.mfaRequiredRoles, view.orgRole, roles) && !session.twoStep)) {
            return stream.end();
          }
          const union = { roles, grants: [...view.publications.values()].flatMap((here) => here.grants) };
          if (reach("publication.view", view.orgRole, union) === null) return stream.end();
          stream.access = { orgRole: view.orgRole, publications: view.publications };
        } catch {
          stream.end(); // what cannot be checked is not sent
        }
      };
      const timer = setInterval(() => {
        write(": heartbeat\n\n");
        void check();
      }, heartbeatMs ?? HEARTBEAT_MS);
      // the browser went away: now, or while the access hooks ran (its close event has then passed already)
      reply.raw.on("close", () => stream.end());
      out.on("close", () => stream.end());
      if (request.raw.destroyed || reply.raw.destroyed || request.raw.socket.destroyed) {
        stream.end();
        reply.hijack(); // nobody to answer
        return;
      }
      hub.add(stream);
      write("retry: 5000\n\n");
      if (request.headers["last-event-id"] !== undefined) stream.send("resync", {});
      return (
        reply
          .header("content-type", "text/event-stream; charset=utf-8")
          .header("cache-control", "no-store")
          .header("x-accel-buffering", "no")
          // the connection ends with the stream: one left open to idle after it would keep a stop waiting
          .header("connection", "close")
          .send(out)
      );
    },
  );
};

declare module "fastify" {
  interface FastifyInstance {
    /** Resolves once the live updates' LISTEN connection listens (tests wait for it). */
    liveReady: () => Promise<void>;
    /** How many live-update streams are open. */
    liveStreams: () => number;
  }
}
