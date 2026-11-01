// Comments, notifications and live updates (docs/product/10-l2-newsroom-plan.md §5.2; 06 §11; PR 19). Objects are
// strict, and responses are sent through these schemas. Comment text is cleaned as the Desk cleans text by the API;
// these schemas bound the shapes only.
import { z } from "zod";
import { StoryStatus } from "./stories.ts";

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });
const Person = z.strictObject({ id: Id, name: z.string() });
const Text = z.string().min(1).max(20_000); // cleaned to 10,000 characters by the API

export const Comment = z.strictObject({
  id: Id,
  storyId: Id,
  /** The thread's first comment, for a reply (one level deep). */
  parentId: Id.nullable(),
  author: Person,
  body: z.string(),
  createdAt: Moment,
  updatedAt: Moment,
  /** The body was changed after it was written. */
  edited: z.boolean(),
  /** A thread's first comment, once someone marks the thread resolved. */
  resolved: z.strictObject({ at: Moment, by: Person }).nullable(),
  can: z.strictObject({ edit: z.boolean(), resolve: z.boolean() }),
});
export type Comment = z.infer<typeof Comment>;

export const CommentList = z.strictObject({ items: z.array(Comment) });

export const CommentInput = z.strictObject({ body: Text, parentId: Id.optional() });
export type CommentInput = z.infer<typeof CommentInput>;

export const CommentPatch = z
  .strictObject({ body: Text.optional(), resolved: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, { error: "change the body, or resolve or reopen the thread" });
export type CommentPatch = z.infer<typeof CommentPatch>;

/** 06 §11's notifications of L2.1. */
export const NOTIFICATION_KINDS = [
  "story_filed",
  "story_sent_back",
  "story_assigned",
  "comment",
  "invitation_accepted",
] as const;
export const NotificationKind = z.enum(NOTIFICATION_KINDS);

/** A notification names what happened by ids, with the text to show it by (the story's headline and status, the
 * invitee's name) resolved under the reader's access when listed; the web fetches more through the routes that check
 * access. */
export const Notification = z.strictObject({
  id: Id,
  kind: NotificationKind,
  publicationId: Id.nullable(),
  storyId: Id.nullable(),
  commentId: Id.nullable(),
  invitationId: Id.nullable(),
  actor: Person.nullable(),
  /** The story it is about, as the reader may see it now: null when it is gone or out of their reach (and for an
   * invitation). */
  story: z.strictObject({ headline: z.string(), status: StoryStatus }).nullable(),
  /** For invitation_accepted: who joined, by their directory name. */
  invitee: Person.nullable(),
  createdAt: Moment,
  readAt: Moment.nullable(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationQuery = z.strictObject({
  unread: z.enum(["0", "1"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const NotificationList = z.strictObject({
  items: z.array(Notification),
  /** Unread notifications in all (not only on this page). */
  unread: z.number().int().min(0),
  nextCursor: z.string().nullable(),
});

export const NotificationsRead = z.union([
  z.strictObject({ ids: z.array(Id).min(1).max(100) }),
  z.strictObject({ all: z.literal(true) }),
]);

/** The live-update stream's events (GET /api/v1/orgs/:o/events, text/event-stream). Each carries ids only:
 *   - story {publicationId, storyId}: the story changed (fetch it again; 404 means it is gone, or out of reach);
 *   - comment {publicationId, storyId, commentId}: a comment on it was written or changed;
 *   - notification {id}: a new notification (fetch the list);
 *   - edition {publicationId, editionId}: an edition was made or changed (fetch the editions again);
 *   - resync {}: updates may have been missed (after a reconnect): fetch what is on the screen afresh.
 * A comment line comes every 25 s to keep the connection open. */
export const LIVE_EVENTS = ["story", "comment", "notification", "edition", "resync"] as const;
