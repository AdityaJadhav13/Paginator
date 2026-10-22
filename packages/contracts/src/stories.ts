// The stories API (docs/product/10-l2-newsroom-plan.md §5.2, §5.4): a story's shapes, its inputs, and its states. Text
// is cleaned as the Desk cleans it (@pageinator/desk-text cleanText) by the API; these schemas bound the shapes only.
// Objects are strict, and responses are sent through these schemas.
import { z } from "zod";

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });

/** A story's states (plan §5.4, proposed: question Q1). "placed" is set by hosted layout only (L2.3). */
export const STORY_STATUSES = ["draft", "filed", "editing", "ready", "held", "spiked", "placed"] as const;
export const StoryStatus = z.enum(STORY_STATUSES);
export type StoryStatus = z.infer<typeof StoryStatus>;

/** A transition's target: a state, or "restore" (back to where a held or spiked story was). */
export const TransitionTarget = z.enum(["filed", "editing", "ready", "draft", "held", "spiked", "restore"]);
export type TransitionTarget = z.infer<typeof TransitionTarget>;

const Person = z.strictObject({ id: Id, name: z.string() });
const Language = z.string().regex(/^[a-z]{2,3}$/);
const Line = z.string().max(4000); // cleaned to the Desk's 2,000 characters by the API
const Body = z.string().max(400_000); // cleaned to the Desk's 200,000 characters

export const StoryCan = z.strictObject({
  edit: z.boolean(),
  transitions: z.array(TransitionTarget),
  comment: z.boolean(),
  assign: z.boolean(),
});

export const Story = z.strictObject({
  id: Id,
  publicationId: Id,
  status: StoryStatus,
  /** The story's version: every change of it (text, fields, state, assignee) makes the next. A change names it as its
   * baseRevision, and gets 409 story_changed when the story has moved on. */
  revision: z.number().int().min(1),
  /** The number of the text's current revision (GET …/revisions). */
  textRevision: z.number().int().min(1),
  headline: z.string(),
  kicker: z.string(),
  deck: z.string(),
  byline: z.string(),
  body: z.string(),
  bodyFormat: z.literal("desk-text/1"),
  words: z.number().int().min(0),
  isBrief: z.boolean(),
  language: z.string(),
  sectionId: Id.nullable(),
  priority: z.number().int().min(1).max(4),
  pagePin: z.number().int().min(1).max(16).nullable(),
  edition: z.strictObject({ id: Id, date: z.iso.date() }).nullable(),
  reporter: Person,
  assignee: Person.nullable(),
  dueAt: Moment.nullable(),
  deskNote: z.string(),
  photo: z.null(), // the photo arrives with PR 18
  commentCount: z.number().int().min(0),
  updatedAt: Moment,
  updatedBy: Person,
  can: StoryCan,
});
export type Story = z.infer<typeof Story>;

export const StoryListItem = Story.pick({
  id: true,
  status: true,
  revision: true,
  headline: true,
  byline: true,
  words: true,
  isBrief: true,
  language: true,
  sectionId: true,
  priority: true,
  pagePin: true,
  edition: true,
  reporter: true,
  assignee: true,
  dueAt: true,
  updatedAt: true,
});
export type StoryListItem = z.infer<typeof StoryListItem>;

export const StoryList = z.strictObject({ items: z.array(StoryListItem), nextCursor: z.string().nullable() });

export const StoryQuery = z.strictObject({
  edition: Id.optional(),
  status: StoryStatus.optional(),
  assignee: z.literal("me").optional(),
  reporter: Id.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** The fields only the desk sets (Chief Editor, Editor, Sub-editor, Owner, Admin): placement and the desk's note. */
export const DESK_FIELDS = ["priority", "pagePin", "editionId", "deskNote"] as const;

const StoryFields = {
  headline: Line.optional(),
  kicker: Line.optional(),
  deck: Line.optional(),
  byline: Line.optional(),
  body: Body.optional(),
  language: Language.optional(),
  sectionId: Id.nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  pagePin: z.number().int().min(1).max(16).nullable().optional(),
  editionId: Id.nullable().optional(),
  deskNote: Line.optional(),
};

export const StoryInput = z.strictObject({ ...StoryFields, headline: Line });
export type StoryInput = z.infer<typeof StoryInput>;

export const StoryPatch = z
  .strictObject({ baseRevision: z.number().int().min(1), ...StoryFields })
  .refine((patch) => Object.keys(patch).length > 1, { error: "change at least one field" });
export type StoryPatch = z.infer<typeof StoryPatch>;

export const StoryTransition = z.strictObject({
  to: TransitionTarget,
  baseRevision: z.number().int().min(1),
  comment: z.string().max(10_000).optional(),
});
export type StoryTransition = z.infer<typeof StoryTransition>;

export const StoryAssignment = z.strictObject({
  baseRevision: z.number().int().min(1),
  userId: Id.nullable(),
  dueAt: Moment.nullable().optional(),
});

/** The most articles one paste may make. */
export const PASTE_MAX_ARTICLES = 200;

export const PasteInput = z.strictObject({ editionId: Id.optional(), text: z.string().max(1_000_000) });
export const PasteResult = z.strictObject({
  created: z.array(Story),
  skipped: z.array(z.strictObject({ headline: z.string(), reason: z.string() })),
});

export const RevisionSummary = z.strictObject({
  rev: z.number().int().min(1),
  author: Person,
  at: Moment,
  words: z.number().int().min(0),
});
export const StoryRevision = z.strictObject({
  rev: z.number().int().min(1),
  headline: z.string(),
  kicker: z.string(),
  deck: z.string(),
  byline: z.string(),
  body: z.string(),
  bodyFormat: z.literal("desk-text/1"),
  words: z.number().int().min(0),
  author: Person,
  openedAt: Moment,
  closedAt: Moment.nullable(),
});

/** The header that makes a create or a transition safe to retry (plan §5.1): a UUID, kept 24 hours. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
