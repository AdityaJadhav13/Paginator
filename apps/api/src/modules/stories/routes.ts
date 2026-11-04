// The stories API (docs/product/10-l2-newsroom-plan.md §5.2, §5.4), under /api/v1/orgs/:o/pubs/:p/stories. Each
// route declares one permission (the access check); rules.ts decides what the person reaches on it, and every statement
// runs under withTenant. A story the person may not see answers 404, as one that does not exist; an action their role
// lacks on a story they see answers 403, recorded in the audit log as authorize() records its own refusals. Every
// change names the story's version it was based on (baseRevision): 409 story_changed when the story has moved on.
// Creates, paste and transitions need an Idempotency-Key.
import {
  DESK_FIELDS,
  PASTE_MAX_ARTICLES,
  PasteInput,
  PasteResult,
  RevisionSummary,
  Story,
  StoryAssignment,
  StoryInput,
  StoryList,
  type StoryListItem,
  StoryPatch,
  StoryQuery,
  StoryRevision,
  type StoryStatus,
  StoryTransition,
  type TransitionTarget,
} from "@pageinator/contracts";
import { BODY_FORMAT, DeskTextError, isBrief, pasteArticles } from "@pageinator/desk-text";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../../db/pools.ts";
import {
  type StoryFields,
  type StoryRow,
  TEXT_KEYS,
  type Text,
  changeStatus,
  createStory,
  deleteStory,
  findStories,
  findStory,
  listStories,
  lockStory,
  restoreTarget,
  revision,
  revisions,
  saveChange,
  standing,
} from "../../db/stories.ts";
import { auditStory } from "../../db/audit.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf, actorOf, auditRefusals, orgRoleOf, refused } from "../access/access.ts";
import { type Notifier, type Outbox } from "../notifications/notify.ts";
import { idempotent } from "../requests/idempotency.ts";
import {
  type StoryFacts,
  canAssign,
  canComment,
  canDelete,
  canEdit,
  isDesk,
  sees,
  spikes,
  storyScope,
  transitionsFor,
} from "./rules.ts";
import { checkPlacement, cleaned, languageFor } from "./store.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const One = z.strictObject({ o: z.string(), p: z.string(), s: z.string() });
const OneRevision = z.strictObject({
  o: z.string(),
  p: z.string(),
  s: z.string(),
  rev: z.coerce.number().int().min(1).max(2147483647),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A cursor's time: updated_at to the microsecond, in UTC, as the database writes it (src/db/stories.ts). */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const BASE = "/api/v1/orgs/:o/pubs/:p/stories";

export type StoryOptions = {
  database: Database;
  notify: Notifier;
  /** Sends the emails of a change once it has committed. */
  mail: (outbox: Outbox) => void;
};

export const factsOf = (row: { status: string; reporter_id: string; assignee_id: string | null }): StoryFacts => ({
  status: row.status as StoryStatus,
  reporterId: row.reporter_id,
  assigneeId: row.assignee_id,
});

export function view(row: StoryRow, access: Access, userId: string): Story {
  const facts = factsOf(row);
  const pub = row.publication_id;
  return {
    id: row.id,
    publicationId: pub,
    status: row.status,
    revision: row.version,
    textRevision: row.current_rev,
    headline: row.headline,
    kicker: row.kicker,
    deck: row.deck,
    byline: row.byline,
    body: row.body,
    bodyFormat: BODY_FORMAT,
    words: row.words,
    isBrief: isBrief({ body: row.body, photo: row.photo_asset_id }),
    language: row.language,
    sectionId: row.section_id,
    priority: row.priority,
    pagePin: row.page_pin,
    edition: row.edition_id && row.edition_date ? { id: row.edition_id, date: row.edition_date } : null,
    reporter: { id: row.reporter_id, name: row.reporter_name },
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name ?? "" } : null,
    dueAt: row.due_at ? row.due_at.toISOString() : null,
    deskNote: row.desk_note,
    photo:
      row.photo_asset_id && row.photo_status && row.photo_width && row.photo_height
        ? {
            assetId: row.photo_asset_id,
            caption: row.photo_caption ?? "",
            credit: row.photo_credit ?? "",
            status: row.photo_status,
            problem: row.photo_problem,
            widthPx: row.photo_width,
            heightPx: row.photo_height,
            previewUrl: null, // previews come with renditions (L2.2)
          }
        : null,
    commentCount: row.comment_count,
    ...(row.origin === "news" ? { madeWithClaude: row.made_with_claude, newsSources: row.news_sources ?? [] } : {}),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: { id: row.updated_by, name: row.updated_by_name },
    can: {
      edit: canEdit(access, pub, facts, userId),
      transitions: transitionsFor(access, pub, facts, userId),
      comment: canComment(access, pub, facts, userId),
      assign: canAssign(access, pub),
    },
  };
}

function listItem(story: Story): StoryListItem {
  return {
    id: story.id,
    status: story.status,
    revision: story.revision,
    headline: story.headline,
    byline: story.byline,
    words: story.words,
    isBrief: story.isBrief,
    language: story.language,
    sectionId: story.sectionId,
    priority: story.priority,
    pagePin: story.pagePin,
    edition: story.edition,
    reporter: story.reporter,
    assignee: story.assignee,
    dueAt: story.dueAt,
    updatedAt: story.updatedAt,
  };
}

/** The story, when the person sees it; 404 otherwise. */
async function visible(tx: Tx, access: Access, pub: string, id: string, userId: string): Promise<StoryRow> {
  const row = UUID.test(id) ? await findStory(tx, pub, id) : null;
  if (!row || !sees(access, pub, factsOf(row), userId)) throw new ApiError("not_found");
  return row;
}

/** The story locked for a change on the given base; 404 when unseen, 409 story_changed when it moved on. */
export async function forChange(tx: Tx, access: Access, pub: string, id: string, userId: string, base: number) {
  const locked = UUID.test(id) ? await lockStory(tx, pub, id) : undefined;
  if (!locked || !sees(access, pub, factsOf(locked), userId)) throw new ApiError("not_found");
  if (base !== locked.version) {
    throw new ApiError("story_changed", undefined, view((await findStory(tx, pub, id)) as StoryRow, access, userId));
  }
  return { ...locked, facts: factsOf(locked) };
}

function encodeCursor(row: StoryRow): string {
  return Buffer.from(JSON.stringify([row.updated_cursor, row.id])).toString("base64url");
}
export function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  try {
    const [updatedAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [unknown, unknown];
    const real = (t: string) =>
      !Number.isNaN(Date.parse(t)) && new Date(Date.parse(t)).toISOString().slice(0, 19) === t.slice(0, 19);
    if (
      typeof updatedAt === "string" &&
      CURSOR_TIME.test(updatedAt) &&
      real(updatedAt) &&
      typeof id === "string" &&
      UUID.test(id)
    ) {
      return { updatedAt, id };
    }
  } catch {
    // not one of ours
  }
  throw new ApiError("invalid_request", [{ field: "querystring.cursor", message: "is not a cursor this API gave" }]);
}

/** Audits each of a story's fields that a change moved (from and to: ids, numbers and language codes; the desk note
 * only that it changed). The text's revisions are audited by saveChange. */
async function auditFields(tx: Tx, tenant: Tenant, before: StoryRow, fields: StoryFields): Promise<void> {
  const p = before.publication_id;
  const s = before.id;
  const moved = <T>(to: T | undefined, from: T) => to !== undefined && to !== from;
  if (moved(fields.edition_id, before.edition_id)) {
    await auditStory(tx, tenant, p, s, "story.edition_change", {
      from: before.edition_id,
      to: fields.edition_id ?? null,
    });
  }
  if (moved(fields.section_id, before.section_id)) {
    await auditStory(tx, tenant, p, s, "story.section_change", {
      from: before.section_id,
      to: fields.section_id ?? null,
    });
  }
  if (moved(fields.priority, before.priority)) {
    await auditStory(tx, tenant, p, s, "story.priority_change", { from: before.priority, to: fields.priority ?? null });
  }
  if (moved(fields.page_pin, before.page_pin)) {
    await auditStory(tx, tenant, p, s, "story.page_pin_change", { from: before.page_pin, to: fields.page_pin ?? null });
  }
  if (moved(fields.language, before.language)) {
    await auditStory(tx, tenant, p, s, "story.language_change", { from: before.language, to: fields.language ?? null });
  }
  if (moved(fields.desk_note, before.desk_note)) await auditStory(tx, tenant, p, s, "story.desk_note_change");
}

/** Refuses the desk's own fields to anyone but the desk. */
function deskOnly(access: Access, pub: string, input: Record<string, unknown>): void {
  if (!isDesk(access, pub) && DESK_FIELDS.some((field) => input[field] !== undefined)) {
    throw refused("placement and the desk note are the desk's");
  }
}

/** Whether the role ever makes this move, so that a state the story is not in answers 409, and a role 403. */
function everAllowed(access: Access, pub: string, from: StoryStatus, to: TransitionTarget): boolean {
  if (to === "filed") return true; // any author may, if the story is theirs
  if (to === "spiked" || (to === "restore" && from === "spiked")) return spikes(access, pub);
  return isDesk(access, pub);
}

export const storyRoutes: FastifyPluginAsyncZod<StoryOptions> = async (app, { database, notify, mail }) => {
  auditRefusals(app, database);

  /** A stored story shown again, if the person still sees it. */
  const again = (access: Access, pub: string, userId: string) => async (stored: unknown, tx: Tx) => {
    const id = (stored as Story | null)?.id;
    const row = typeof id === "string" ? await findStory(tx, pub, id) : null;
    return row && sees(access, pub, factsOf(row), userId) ? stored : null;
  };

  app.get(
    BASE,
    {
      config: { permission: "story.view" },
      schema: { params: Pub, querystring: StoryQuery, response: { 200: StoryList } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const pub = request.params.p;
      const scope = storyScope(access, pub);
      if (scope === "none") return { items: [], nextCursor: null };
      const q = request.query;
      const limit = q.limit ?? 50;
      const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor);
      const rows = await database.withTenant(access.tenant, (tx) =>
        listStories(tx, {
          publicationId: pub,
          ...(scope === "own" ? { mine: userId } : {}),
          ...(q.edition ? { edition: q.edition } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.assignee === "me" ? { assignee: userId } : {}),
          ...(q.reporter ? { reporter: q.reporter } : {}),
          ...(q.q ? { q: q.q } : {}),
          ...(after ? { after } : {}),
          limit: limit + 1,
        }),
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => listItem(view(row, access, userId))),
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    },
  );

  app.post(
    BASE,
    { config: { permission: "story.create" }, schema: { params: Pub, body: StoryInput, response: { 201: Story } } },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const pub = request.params.p;
      const input = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          deskOnly(access, pub, input);
          const text = Object.fromEntries(TEXT_KEYS.map((key) => [key, cleaned(input[key], key)])) as Text;
          if (text.headline === "") {
            throw new ApiError("invalid_request", [
              { field: "body.headline", message: "Every story needs a headline." },
            ]);
          }
          const language = await languageFor(tx, pub, input.language);
          const editionId = input.editionId ?? null;
          const pagePin = input.pagePin ?? null;
          await checkPlacement(tx, pub, { sectionId: input.sectionId, editionId, pagePin });
          const id = await createStory(tx, access.tenant, pub, {
            ...text,
            language,
            sectionId: input.sectionId ?? null,
            priority: input.priority ?? 3,
            pagePin,
            editionId,
            deskNote: cleaned(input.deskNote, "deskNote"),
            origin: "typed",
          });
          return { status: 201, body: view((await findStory(tx, pub, id)) as StoryRow, access, userId) };
        },
        again(access, pub, userId),
      );
      return reply.status(201).send(answer.body as Story);
    },
  );

  app.post(
    `${BASE}/paste`,
    {
      config: { permission: "story.create" },
      schema: { params: Pub, body: PasteInput, response: { 201: PasteResult } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const pub = request.params.p;
      const input = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          deskOnly(access, pub, input);
          let pasted: ReturnType<typeof pasteArticles>;
          try {
            pasted = pasteArticles(input.text);
          } catch (error) {
            if (!(error instanceof DeskTextError)) throw error;
            throw new ApiError("invalid_request", [{ field: "body.text", message: error.message }]);
          }
          if (pasted.created.length > PASTE_MAX_ARTICLES) {
            throw new ApiError("invalid_request", [
              {
                field: "body.text",
                message: `Paste at most ${PASTE_MAX_ARTICLES} articles at a time (this has ${pasted.created.length}).`,
              },
            ]);
          }
          const language = await languageFor(tx, pub, undefined);
          const editionId = input.editionId ?? null;
          await checkPlacement(tx, pub, { editionId, pagePin: null });
          const ids: string[] = [];
          for (const article of pasted.created) {
            ids.push(
              await createStory(tx, access.tenant, pub, {
                headline: article.headline,
                kicker: "",
                deck: "",
                byline: article.byline,
                body: article.body,
                language,
                sectionId: null,
                priority: 3,
                pagePin: null,
                editionId,
                deskNote: "",
                origin: "pasted",
              }),
            );
          }
          const created = (await findStories(tx, pub, ids)).map((row) => view(row, access, userId));
          // a replay rebuilds the stories from their ids (a compact answer to keep)
          return { status: 201, body: { created, skipped: pasted.skipped }, stored: { ids, skipped: pasted.skipped } };
        },
        async (stored, tx) => {
          const { ids, skipped } = stored as { ids: string[]; skipped: unknown };
          const rows = await findStories(tx, pub, ids);
          if (rows.length !== ids.length || !rows.every((row) => sees(access, pub, factsOf(row), userId))) return null;
          return { created: rows.map((row) => view(row, access, userId)), skipped };
        },
      );
      return reply.status(201).send(answer.body as z.infer<typeof PasteResult>);
    },
  );

  app.get(
    `${BASE}/:s`,
    { config: { permission: "story.view" }, schema: { params: One, response: { 200: Story } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      return database.withTenant(access.tenant, async (tx) =>
        view(await visible(tx, access, p, s, userId), access, userId),
      );
    },
  );

  app.patch(
    `${BASE}/:s`,
    { config: { permission: "story.edit_own" }, schema: { params: One, body: StoryPatch, response: { 200: Story } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      const patch = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const story = await forChange(tx, access, p, s, userId, patch.baseRevision);
        if (!canEdit(access, p, story.facts, userId)) throw refused("this story is not theirs to edit now");
        deskOnly(access, p, patch);
        const current = (await findStory(tx, p, s)) as StoryRow;
        const text = Object.fromEntries(
          TEXT_KEYS.map((key) => [key, patch[key] === undefined ? current[key] : cleaned(patch[key], key)]),
        ) as Text;
        if (text.headline === "") {
          throw new ApiError("invalid_request", [{ field: "body.headline", message: "Every story needs a headline." }]);
        }
        if (patch.language !== undefined) await languageFor(tx, p, patch.language);
        await checkPlacement(tx, p, {
          sectionId: patch.sectionId,
          editionId: patch.editionId === undefined ? story.edition_id : patch.editionId,
          pagePin: patch.pagePin === undefined ? story.page_pin : patch.pagePin,
        });
        const textChanged = TEXT_KEYS.some((key) => text[key] !== current[key]);
        // the desk's first edit of a filed story picks it up (plan §5.4)
        if (textChanged && story.facts.status === "filed" && isDesk(access, p)) {
          await changeStatus(tx, access.tenant, p, s, "filed", "editing", null, false); // saveChange bumps the version
        }
        const fields: StoryFields = {
          ...(patch.language !== undefined ? { language: patch.language } : {}),
          ...(patch.sectionId !== undefined ? { section_id: patch.sectionId } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.pagePin !== undefined ? { page_pin: patch.pagePin } : {}),
          ...(patch.editionId !== undefined ? { edition_id: patch.editionId } : {}),
          ...(patch.deskNote !== undefined ? { desk_note: cleaned(patch.deskNote, "deskNote") } : {}),
        };
        if (!textChanged && Object.keys(fields).length === 0) return view(current, access, userId); // nothing changed
        await saveChange(tx, access.tenant, p, s, story.current_rev, textChanged ? text : null, fields);
        await auditFields(tx, access.tenant, current, fields);
        return view((await findStory(tx, p, s)) as StoryRow, access, userId);
      });
    },
  );

  app.post(
    `${BASE}/:s/transitions`,
    {
      config: { permission: "story.edit_own" },
      schema: { params: One, body: StoryTransition, response: { 200: Story } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      const { to, baseRevision, comment } = request.body;
      const outbox: Outbox = [];
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const story = await forChange(tx, access, p, s, userId, baseRevision);
          if (!transitionsFor(access, p, story.facts, userId).includes(to)) {
            if (everAllowed(access, p, story.facts.status, to)) throw new ApiError("invalid_transition");
            throw refused(`their role does not move a story to ${to}`);
          }
          const target: StoryStatus = to === "restore" ? await restoreTarget(tx, p, s) : to;
          // a restore never takes a story somewhere the person could not move it themselves
          if (target === "spiked" && !spikes(access, p)) throw refused("their role does not spike a story");
          const note = comment === undefined ? "" : cleaned(comment, "comment");
          if (to === "draft" && note === "") {
            throw new ApiError("invalid_request", [
              { field: "body.comment", message: "Say why the story goes back to its reporter." },
            ]);
          }
          if (target === story.facts.status) throw new ApiError("invalid_transition");
          const { commentId } = await changeStatus(
            tx,
            access.tenant,
            p,
            s,
            story.facts.status,
            target,
            note === "" ? null : note,
          );
          const after = (await findStory(tx, p, s)) as StoryRow;
          // the desk is told of a filed story, and the reporter of one sent back (06 §11)
          if (to === "filed") await notify.storyFiled(tx, access.tenant, p, s, factsOf(after));
          if (to === "draft" && commentId) {
            await notify.storySentBack(
              tx,
              access.tenant,
              p,
              { ...factsOf(after), id: s, headline: after.headline },
              { id: commentId, body: note },
              outbox,
            );
          }
          return { status: 200, body: view(after, access, userId) };
        },
        again(access, p, userId),
      );
      mail(outbox); // only once the move has committed (a replay sends nothing again)
      return reply.status(200).send(answer.body as Story);
    },
  );

  app.post(
    `${BASE}/:s/assignee`,
    {
      config: { permission: "story.assign" },
      schema: { params: One, body: StoryAssignment, response: { 200: Story } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      const { baseRevision, userId: assignee, dueAt } = request.body;
      const membership = assignee ? await database.identity.membership(access.tenant.orgId, assignee) : null;
      return database.withTenant(access.tenant, async (tx) => {
        const story = await forChange(tx, access, p, s, userId, baseRevision);
        if (assignee) {
          const role = membership ? orgRoleOf(membership.role) : null;
          const them = await standing(tx, p, assignee);
          const reaches =
            them.active && (role === "owner" || role === "admin" || (role !== null && them.roles !== null));
          if (!reaches) {
            throw new ApiError("invalid_request", [
              { field: "body.userId", message: "is not a member who reaches this publication" },
            ]);
          }
        }
        await saveChange(tx, access.tenant, p, s, story.current_rev, null, {
          assignee_id: assignee,
          ...(dueAt !== undefined ? { due_at: dueAt === null ? null : new Date(dueAt) } : {}),
        });
        const after = (await findStory(tx, p, s)) as StoryRow;
        const due = (at: Date | null) => (at ? at.toISOString() : null);
        const was = { assignee: story.facts.assigneeId, dueAt: due(story.due_at) };
        const now = { assignee: after.assignee_id, dueAt: due(after.due_at) };
        if (now.assignee !== was.assignee) {
          await auditStory(tx, access.tenant, p, s, now.assignee ? "story.assign" : "story.unassign", {
            from: was.assignee,
            to: now.assignee,
            dueAt: now.dueAt,
          });
        }
        // a due time moved, with or without the assignee: its own event, so the old time is kept
        if (now.dueAt !== was.dueAt) {
          await auditStory(tx, access.tenant, p, s, "story.due_change", { from: was.dueAt, to: now.dueAt });
        }
        // the person given the story is told (not again when only its due time changes)
        if (assignee && assignee !== story.facts.assigneeId) {
          await notify.storyAssigned(tx, access.tenant, p, s, factsOf(after));
        }
        return view(after, access, userId);
      });
    },
  );

  app.get(
    `${BASE}/:s/revisions`,
    {
      config: { permission: "story.view" },
      schema: { params: One, response: { 200: z.strictObject({ items: z.array(RevisionSummary) }) } },
    },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        await visible(tx, access, p, s, userId);
        const rows = await revisions(tx, p, s);
        return {
          items: rows.map((row) => ({
            rev: row.rev,
            author: { id: row.author_id, name: row.author_name },
            at: row.opened_at.toISOString(),
            words: row.words,
          })),
        };
      });
    },
  );

  app.get(
    `${BASE}/:s/revisions/:rev`,
    { config: { permission: "story.view" }, schema: { params: OneRevision, response: { 200: StoryRevision } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s, rev } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        await visible(tx, access, p, s, userId);
        const row = await revision(tx, p, s, rev);
        if (!row) throw new ApiError("not_found");
        return {
          rev: row.rev,
          headline: row.headline,
          kicker: row.kicker,
          deck: row.deck,
          byline: row.byline,
          body: row.body,
          bodyFormat: BODY_FORMAT,
          words: row.words,
          author: { id: row.author_id, name: row.author_name },
          openedAt: row.opened_at.toISOString(),
          closedAt: row.closed_at ? row.closed_at.toISOString() : null,
        };
      });
    },
  );

  app.delete(
    `${BASE}/:s`,
    { config: { permission: "story.edit_own" }, schema: { params: One } },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p, s } = request.params;
      await database.withTenant(access.tenant, async (tx) => {
        const locked = UUID.test(s) ? await lockStory(tx, p, s) : undefined;
        if (!locked || !sees(access, p, factsOf(locked), userId)) throw new ApiError("not_found");
        if (!canDelete(access, p, factsOf(locked), userId)) throw refused("this story is not theirs to delete now");
        await deleteStory(tx, access.tenant, p, s); // with its audit row, in this transaction
      });
      return reply.status(204).send();
    },
  );
};
