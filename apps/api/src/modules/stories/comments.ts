// A story's comments (docs/product/10-l2-newsroom-plan.md §5.2; PR 19):
//   - GET …/stories/:s/comments (comment.read): whoever sees the story reads its comments, oldest first;
//   - POST …/stories/:s/comments (comment.write, with an Idempotency-Key): whoever may comment on it writes one, or a
//     reply to a thread's first comment (one level deep); the story's reporter and assignee and the thread's writers
//     are told (src/modules/notifications/notify.ts);
//   - PATCH /orgs/:o/pubs/:p/comments/:c (comment.write): its author changes its text; the author, the desk or the
//     story's reporter or assignee resolves or reopens a thread. Each change is in the audit log (ids only).
// A story the person does not see answers 404, as do its comments; an action their role lacks answers 403, audited.
// Mentions come with L2.2 (plan §1): a body is text only.
import { Comment, CommentInput, CommentList, CommentPatch } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type CommentRow,
  createComment,
  findComment,
  listComments,
  threadAuthors,
  updateComment,
} from "../../db/comments.ts";
import type { Database } from "../../db/pools.ts";
import { findStory } from "../../db/stories.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf, actorOf } from "../access/access.ts";
import type { Notifier } from "../notifications/notify.ts";
import { idempotent } from "../requests/idempotency.ts";
import { auditRefusals, factsOf, refused } from "./routes.ts";
import { type StoryFacts, canComment, canEditComment, canReadComments, canResolve } from "./rules.ts";
import { cleaned } from "./store.ts";

const OneStory = z.strictObject({ o: z.string(), p: z.string(), s: z.string() });
const OneComment = z.strictObject({ o: z.string(), p: z.string(), c: z.string() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CommentOptions = { database: Database; notify: Notifier };

/** The comment, without what the person may do to it (shown adds that). */
function commentView(row: CommentRow): Omit<Comment, "can"> {
  return {
    id: row.id,
    storyId: row.target_id,
    parentId: row.parent_id,
    author: { id: row.author_id, name: row.author_name },
    body: row.body,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    edited: row.updated_at.getTime() > row.created_at.getTime(),
    resolved:
      row.resolved_at && row.resolved_by
        ? { at: row.resolved_at.toISOString(), by: { id: row.resolved_by, name: row.resolved_by_name ?? "" } }
        : null,
  };
}

/** The comment as the person sees it, with what they may do to it. */
function shown(row: CommentRow, access: Access, pub: string, story: StoryFacts, userId: string): Comment {
  const facts = { authorId: row.author_id, parentId: row.parent_id };
  return {
    ...commentView(row),
    can: {
      edit: canEditComment(access, pub, story, facts, userId),
      resolve: canResolve(access, pub, story, facts, userId),
    },
  };
}

/** The story, when the person may read its comments; 404 otherwise. */
async function storyFor(tx: Tx, access: Access, pub: string, storyId: string, userId: string) {
  const row = UUID.test(storyId) ? await findStory(tx, pub, storyId) : null;
  if (!row || !canReadComments(access, pub, factsOf(row), userId)) throw new ApiError("not_found");
  return { row, facts: factsOf(row) };
}

async function audit(tx: Tx, tenant: Tenant, pub: string, action: string, comment: CommentRow, ip: string) {
  await tx
    .insertInto("app.audit_event")
    .values({
      org_id: tenant.orgId,
      publication_id: pub,
      actor_kind: "user",
      actor_id: tenant.userId,
      action,
      target_type: "comment",
      target_id: comment.id,
      data: JSON.stringify({ story: comment.target_id }),
      ip,
      request_id: tenant.requestId,
    })
    .execute();
}

export const commentRoutes: FastifyPluginAsyncZod<CommentOptions> = async (app, { database, notify }) => {
  auditRefusals(app, database);

  app.get(
    "/api/v1/orgs/:o/pubs/:p/stories/:s/comments",
    { config: { permission: "comment.read" }, schema: { params: OneStory, response: { 200: CommentList } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const story = await storyFor(tx, access, p, s, userId);
        const rows = await listComments(tx, p, s);
        return { items: rows.map((row) => shown(row, access, p, story.facts, userId)) };
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/stories/:s/comments",
    {
      config: { permission: "comment.write" },
      schema: { params: OneStory, body: CommentInput, response: { 201: Comment } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      const input = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const story = await storyFor(tx, access, p, s, userId);
          if (!canComment(access, p, story.facts, userId)) throw refused("they may not comment on this story");
          let parentId: string | null = null;
          if (input.parentId !== undefined) {
            const parent = await findComment(tx, p, input.parentId);
            if (!parent || parent.target_id !== s || parent.parent_id !== null) {
              throw new ApiError("invalid_request", [
                { field: "body.parentId", message: "is not the first comment of a thread on this story" },
              ]);
            }
            parentId = parent.id;
          }
          const body = cleaned(input.body, "comment");
          if (body === "") {
            throw new ApiError("invalid_request", [{ field: "body.body", message: "A comment needs some text." }]);
          }
          const id = await createComment(tx, access.tenant, p, { storyId: s, parentId, body });
          const writers = parentId ? await threadAuthors(tx, p, parentId) : [];
          await notify.commented(tx, access.tenant, p, { ...story.facts, id: s }, { id }, writers);
          const row = (await findComment(tx, p, id)) as CommentRow;
          return { status: 201, body: shown(row, access, p, story.facts, userId) };
        },
        // a replay shows the comment again, if the person still reads the story's comments
        async (stored, tx) => {
          const id = (stored as Comment | null)?.id;
          const row = typeof id === "string" ? await findComment(tx, p, id) : undefined;
          if (!row) return null;
          const story = await findStory(tx, p, row.target_id);
          if (!story || !canReadComments(access, p, factsOf(story), userId)) return null;
          return shown(row, access, p, factsOf(story), userId);
        },
      );
      return reply.status(201).send(answer.body as Comment);
    },
  );

  app.patch(
    "/api/v1/orgs/:o/pubs/:p/comments/:c",
    {
      config: { permission: "comment.write" },
      schema: { params: OneComment, body: CommentPatch, response: { 200: Comment } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, c } = request.params;
      const patch = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const comment = UUID.test(c) ? await findComment(tx, p, c, true) : undefined;
        if (!comment) throw new ApiError("not_found");
        const story = await storyFor(tx, access, p, comment.target_id, userId);
        const facts = { authorId: comment.author_id, parentId: comment.parent_id };
        let body: string | undefined;
        if (patch.body !== undefined) {
          if (!canEditComment(access, p, story.facts, facts, userId))
            throw refused("only its author changes a comment");
          body = cleaned(patch.body, "comment");
          if (body === "") {
            throw new ApiError("invalid_request", [{ field: "body.body", message: "A comment needs some text." }]);
          }
          if (body === comment.body) body = undefined; // nothing changed
        }
        let resolvedBy: string | null | undefined;
        if (patch.resolved !== undefined) {
          if (comment.parent_id !== null) {
            throw new ApiError("invalid_request", [
              { field: "body.resolved", message: "A reply is resolved with its thread's first comment." },
            ]);
          }
          if (!canResolve(access, p, story.facts, facts, userId)) throw refused("they may not resolve this thread");
          if (patch.resolved !== (comment.resolved_at !== null)) resolvedBy = patch.resolved ? userId : null;
        }
        if (body !== undefined || resolvedBy !== undefined) {
          await updateComment(tx, p, c, {
            ...(body !== undefined ? { body } : {}),
            ...(resolvedBy !== undefined ? { resolvedBy } : {}),
          });
          if (body !== undefined) await audit(tx, access.tenant, p, "comment.edit", comment, request.ip);
          if (resolvedBy !== undefined) {
            await audit(tx, access.tenant, p, resolvedBy ? "comment.resolve" : "comment.reopen", comment, request.ip);
          }
        }
        return shown((await findComment(tx, p, c)) as CommentRow, access, p, story.facts, userId);
      });
    },
  );
};
