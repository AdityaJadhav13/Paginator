// Stories in the database (docs/product/10-l2-newsroom-plan.md §3.3, §3.4, §5.1, §5.2), for src/modules/stories. Each
// function runs inside withTenant (a Tx), so the organisation and publication walls apply to every statement.
//   - A story's text lives in its revisions: every change of the text opens the next revision (the database numbers it
//     and refuses any other number) and closes the one before, which then never changes.
//   - Every change of a story (text, fields, state, assignee) bumps its version, sets updated_by, and stamps updated_at
//     with the database's clock (one clock: the list's cursor compares these to the microsecond).
//   - A change of state closes the open revision, and is recorded in story_status_change with its comment.
import { randomBytes } from "node:crypto";
import { BODY_FORMAT, bodyWords } from "@pageinator/desk-text";
import { type StoryStatus } from "@pageinator/contracts";
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

export const TEXT_KEYS = ["headline", "kicker", "deck", "byline", "body"] as const;
export type TextKey = (typeof TEXT_KEYS)[number];
export type Text = Record<TextKey, string>;

export type Who = { orgId: string; userId: string };

/** A story row with its current revision and the names it shows. */
export type StoryRow = {
  id: string;
  publication_id: string;
  status: StoryStatus;
  version: number;
  current_rev: number;
  reporter_id: string;
  reporter_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  due_at: Date | null;
  section_id: string | null;
  priority: number;
  page_pin: number | null;
  language: string;
  desk_note: string;
  edition_id: string | null;
  edition_date: string | null;
  updated_at: Date;
  /** updated_at to the microsecond, for the list's cursor */
  updated_cursor: string;
  updated_by: string;
  updated_by_name: string;
  comment_count: number;
  photo_asset_id: string | null;
  photo_caption: string | null;
  photo_credit: string | null;
  photo_status: "received" | "ready" | "rejected" | null;
  photo_width: number | null;
  photo_height: number | null;
} & Text & { words: number };

const STORY = sql`
  select s.id, s.publication_id, s.status, s.version, s.current_rev, s.reporter_id, rp.display_name as reporter_name,
    s.assignee_id, ap.display_name as assignee_name, s.due_at, s.section_id, s.priority, s.page_pin, s.language,
    s.desk_note, s.edition_id, to_char(e.edition_date, 'YYYY-MM-DD') as edition_date, s.updated_at,
    to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_cursor,
    s.updated_by, ub.display_name as updated_by_name,
    r.headline, r.kicker, r.deck, r.byline, r.body, r.words,
    sp.asset_id as photo_asset_id, sp.caption as photo_caption, sp.credit as photo_credit, pa.status as photo_status,
    pa.width_px as photo_width, pa.height_px as photo_height,
    (select count(*)::int from app.comment c
      where c.org_id = s.org_id and c.publication_id = s.publication_id and c.target_id = s.id
        and c.deleted_at is null) as comment_count
  from app.story s
  join app.story_revision r
    on r.org_id = s.org_id and r.publication_id = s.publication_id and r.story_id = s.id and r.rev = s.current_rev
  join app.person rp on rp.org_id = s.org_id and rp.user_id = s.reporter_id
  join app.person ub on ub.org_id = s.org_id and ub.user_id = s.updated_by
  left join app.person ap on ap.org_id = s.org_id and ap.user_id = s.assignee_id
  left join app.edition e on e.org_id = s.org_id and e.publication_id = s.publication_id and e.id = s.edition_id
  left join app.story_photo sp on sp.org_id = s.org_id and sp.publication_id = s.publication_id and sp.story_id = s.id
  left join app.asset pa on pa.org_id = sp.org_id and pa.publication_id = sp.publication_id and pa.id = sp.asset_id`;

/** One story of the publication that is not deleted, or null. */
export async function findStory(tx: Tx, publicationId: string, storyId: string): Promise<StoryRow | null> {
  const { rows } = await sql<StoryRow>`${STORY}
    where s.publication_id = ${publicationId} and s.id = ${storyId} and s.deleted_at is null`.execute(tx);
  return rows[0] ?? null;
}

export async function findStories(tx: Tx, publicationId: string, ids: readonly string[]): Promise<StoryRow[]> {
  const { rows } = await sql<StoryRow>`${STORY}
    where s.publication_id = ${publicationId} and s.id = any(${[...ids]}::uuid[]) and s.deleted_at is null`.execute(tx);
  return [...ids].flatMap((id) => rows.filter((row) => row.id === id));
}

export type ListFilter = {
  publicationId: string;
  mine?: string; // the scope "own": reported by, or given to, this person
  edition?: string;
  status?: StoryStatus;
  assignee?: string;
  reporter?: string;
  q?: string;
  /** a cursor: updated_at to the microsecond (UTC, as updated_cursor) and the id */
  after?: { updatedAt: string; id: string };
  limit: number;
};

export async function listStories(tx: Tx, f: ListFilter): Promise<StoryRow[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await sql<StoryRow>`${STORY}
    where s.publication_id = ${f.publicationId} and s.deleted_at is null
      and (${f.mine ?? null}::uuid is null or s.reporter_id = ${f.mine ?? null}::uuid
        or s.assignee_id = ${f.mine ?? null}::uuid)
      and (${f.edition ?? null}::uuid is null or s.edition_id = ${f.edition ?? null}::uuid)
      and (${f.status ?? null}::text is null or s.status = ${f.status ?? null}::text)
      and (${f.assignee ?? null}::uuid is null or s.assignee_id = ${f.assignee ?? null}::uuid)
      and (${f.reporter ?? null}::uuid is null or s.reporter_id = ${f.reporter ?? null}::uuid)
      and (${like}::text is null or r.headline ilike ${like} or r.body ilike ${like} or r.byline ilike ${like})
      and (${f.after?.updatedAt ?? null}::timestamptz is null
        or (s.updated_at, s.id) < (${f.after?.updatedAt ?? null}::timestamptz, ${f.after?.id ?? null}::uuid))
    order by s.updated_at desc, s.id desc
    limit ${f.limit}`.execute(tx);
  return rows;
}

/** The story's state, version and people, locked until the transaction ends (a change decides on these). */
export async function lockStory(tx: Tx, publicationId: string, storyId: string) {
  return tx
    .selectFrom("app.story")
    .select(["status", "version", "current_rev", "reporter_id", "assignee_id", "edition_id", "page_pin"])
    .where("publication_id", "=", publicationId)
    .where("id", "=", storyId)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
}

export type StoryFields = {
  language?: string;
  section_id?: string | null;
  priority?: number;
  page_pin?: number | null;
  edition_id?: string | null;
  desk_note?: string;
  assignee_id?: string | null;
  due_at?: Date | null;
};

/** A change of the story: its fields, a new version, who made it, and the database's time. */
async function touch(
  tx: Tx,
  who: Who,
  publicationId: string,
  storyId: string,
  set: StoryFields & { status?: StoryStatus; current_rev?: number },
) {
  await tx
    .updateTable("app.story")
    .set({
      ...set,
      version: sql`version + 1`,
      updated_by: who.userId,
      updated_at: sql`now()`,
    })
    .where("publication_id", "=", publicationId)
    .where("id", "=", storyId)
    .execute();
}

export type NewStory = Text & {
  language: string;
  sectionId: string | null;
  priority: number;
  pagePin: number | null;
  editionId: string | null;
  deskNote: string;
  origin: "typed" | "pasted";
};

async function openRevision(tx: Tx, who: Who, publicationId: string, storyId: string, rev: number, text: Text) {
  await tx
    .insertInto("app.story_revision")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      story_id: storyId,
      rev,
      headline: text.headline,
      kicker: text.kicker,
      deck: text.deck,
      byline: text.byline,
      body: text.body,
      body_format: BODY_FORMAT,
      words: bodyWords(text.body),
      author_id: who.userId,
    })
    .execute();
}

async function closeRevision(tx: Tx, publicationId: string, storyId: string): Promise<void> {
  await tx
    .updateTable("app.story_revision")
    .set({ closed_at: sql`greatest(now(), opened_at)` })
    .where("publication_id", "=", publicationId)
    .where("story_id", "=", storyId)
    .where("closed_at", "is", null)
    .execute();
}

/** A new Draft and its first revision; returns its id. */
export async function createStory(tx: Tx, who: Who, publicationId: string, story: NewStory): Promise<string> {
  let made: { id: string } | undefined;
  for (let attempt = 0; !made && attempt < 5; attempt += 1) {
    // the Desk's article id, a- and 10 hex digits (deskserver/util.py ARTICLE_ID), unique in the publication
    made = await tx
      .insertInto("app.story")
      .values({
        org_id: who.orgId,
        publication_id: publicationId,
        desk_key: `a-${randomBytes(5).toString("hex")}`,
        reporter_id: who.userId,
        updated_by: who.userId,
        language: story.language,
        section_id: story.sectionId,
        priority: story.priority,
        page_pin: story.pagePin,
        edition_id: story.editionId,
        desk_note: story.deskNote,
        origin: story.origin,
      })
      .onConflict((conflict) => conflict.columns(["org_id", "publication_id", "desk_key"]).doNothing())
      .returning("id")
      .executeTakeFirst();
  }
  if (!made) throw new Error("No free Desk article id after 5 tries.");
  await openRevision(tx, who, publicationId, made.id, 1, story);
  return made.id;
}

/** Saves new text as the story's next revision, and its fields, as one change. */
export async function saveChange(
  tx: Tx,
  who: Who,
  publicationId: string,
  storyId: string,
  currentRev: number,
  text: Text | null,
  fields: StoryFields,
): Promise<void> {
  if (text) {
    await closeRevision(tx, publicationId, storyId);
    await openRevision(tx, who, publicationId, storyId, currentRev + 1, text);
  }
  await touch(tx, who, publicationId, storyId, { ...fields, ...(text ? { current_rev: currentRev + 1 } : {}) });
}

/** Moves the story to a state, recorded with its comment's id; its open revision is closed. */
export async function changeStatus(
  tx: Tx,
  who: Who,
  publicationId: string,
  storyId: string,
  from: StoryStatus,
  to: StoryStatus,
  comment: string | null,
  /** false when the caller's own change of the story follows in the same request (one change, one version) */
  bump = true,
): Promise<void> {
  let commentId: string | null = null;
  if (comment !== null) {
    const made = await tx
      .insertInto("app.comment")
      .values({
        org_id: who.orgId,
        publication_id: publicationId,
        target_id: storyId,
        author_id: who.userId,
        body: comment,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    commentId = made.id;
  }
  await tx
    .insertInto("app.story_status_change")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      story_id: storyId,
      from_status: from,
      to_status: to,
      changed_by: who.userId,
      comment_id: commentId,
    })
    .execute();
  await closeRevision(tx, publicationId, storyId);
  if (bump) await touch(tx, who, publicationId, storyId, { status: to });
  else
    await tx
      .updateTable("app.story")
      .set({ status: to })
      .where("publication_id", "=", publicationId)
      .where("id", "=", storyId)
      .execute();
}

const ASIDE = new Set<string>(["held", "spiked"]);

/**
 * Where a held or spiked story goes back to: the state it was in before it entered its current run of Held and
 * Spiked (held → spiked → held is one run). Each move into the run is read from the history, newest first, until the
 * move that entered it; its from is the answer. A story with no such history goes back to Draft.
 */
export async function restoreTarget(tx: Tx, publicationId: string, storyId: string): Promise<StoryStatus> {
  const moves = await tx
    .selectFrom("app.story_status_change")
    .select(["from_status", "to_status"])
    .where("publication_id", "=", publicationId)
    .where("story_id", "=", storyId)
    .orderBy("changed_at", "desc")
    .orderBy("id", "desc")
    .execute();
  for (const move of moves) {
    if (!ASIDE.has(move.to_status)) break; // the run ended earlier: no entry found
    if (!ASIDE.has(move.from_status)) return move.from_status as StoryStatus;
  }
  return "draft";
}

/** Soft-deletes the story and records it in the audit log, in the caller's transaction. */
export async function deleteStory(tx: Tx, who: Who, publicationId: string, storyId: string, requestId: string) {
  await tx
    .updateTable("app.story")
    .set({ deleted_at: sql`now()`, updated_at: sql`now()`, updated_by: who.userId, version: sql`version + 1` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", storyId)
    .execute();
  await tx
    .insertInto("app.audit_event")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      actor_kind: "user",
      actor_id: who.userId,
      action: "story.delete",
      target_type: "story",
      target_id: storyId,
      data: JSON.stringify({}),
      request_id: requestId,
    })
    .execute();
}

export async function publicationOf(tx: Tx, publicationId: string) {
  return tx
    .selectFrom("app.publication")
    .select(["languages", "primary_language"])
    .where("id", "=", publicationId)
    .executeTakeFirstOrThrow();
}

export async function sectionOf(tx: Tx, publicationId: string, sectionId: string) {
  return tx
    .selectFrom("app.section")
    .select("archived_at")
    .where("publication_id", "=", publicationId)
    .where("id", "=", sectionId)
    .executeTakeFirst();
}

export async function editionOf(tx: Tx, publicationId: string, editionId: string) {
  return tx
    .selectFrom("app.edition")
    .select("pages")
    .where("publication_id", "=", publicationId)
    .where("id", "=", editionId)
    .executeTakeFirst();
}

/** The person's directory status and their grant's roles on the publication (null: no grant). */
export async function standing(tx: Tx, publicationId: string, userId: string) {
  const person = await tx.selectFrom("app.person").select("status").where("user_id", "=", userId).executeTakeFirst();
  const grant = await tx
    .selectFrom("app.publication_grant")
    .select("roles")
    .where("publication_id", "=", publicationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return { active: person?.status === "active", roles: (grant?.roles as string[] | undefined) ?? null };
}

export async function revisions(tx: Tx, publicationId: string, storyId: string) {
  const { rows } = await sql<{ rev: number; author_id: string; author_name: string; opened_at: Date; words: number }>`
    select r.rev, r.author_id, p.display_name as author_name, r.opened_at, r.words
    from app.story_revision r join app.person p on p.org_id = r.org_id and p.user_id = r.author_id
    where r.publication_id = ${publicationId} and r.story_id = ${storyId}
    order by r.rev desc`.execute(tx);
  return rows;
}

export async function revision(tx: Tx, publicationId: string, storyId: string, rev: number) {
  const { rows } = await sql<
    Text & {
      rev: number;
      words: number;
      author_id: string;
      author_name: string;
      opened_at: Date;
      closed_at: Date | null;
    }
  >`
    select r.rev, r.headline, r.kicker, r.deck, r.byline, r.body, r.words, r.author_id, p.display_name as author_name,
      r.opened_at, r.closed_at
    from app.story_revision r join app.person p on p.org_id = r.org_id and p.user_id = r.author_id
    where r.publication_id = ${publicationId} and r.story_id = ${storyId} and r.rev = ${rev}`.execute(tx);
  return rows[0] ?? null;
}

/** Gives the story its one photo (or replaces it), with its caption and credit: a change of the story. */
export async function setPhoto(
  tx: Tx,
  who: Who,
  publicationId: string,
  storyId: string,
  photo: { assetId: string; caption: string; credit: string },
): Promise<void> {
  await tx
    .insertInto("app.story_photo")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      story_id: storyId,
      asset_id: photo.assetId,
      caption: photo.caption,
      credit: photo.credit,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["org_id", "publication_id", "story_id"])
        .doUpdateSet({ asset_id: photo.assetId, caption: photo.caption, credit: photo.credit, updated_at: sql`now()` }),
    )
    .execute();
  await touch(tx, who, publicationId, storyId, {});
}

/** Changes the photo's caption or credit; false when the story has no photo. */
export async function updatePhoto(
  tx: Tx,
  who: Who,
  publicationId: string,
  storyId: string,
  change: { caption?: string; credit?: string },
): Promise<boolean> {
  const done = await tx
    .updateTable("app.story_photo")
    .set({ ...change, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("story_id", "=", storyId)
    .returning("story_id")
    .executeTakeFirst();
  if (done) await touch(tx, who, publicationId, storyId, {});
  return done !== undefined;
}

/** Takes the photo off the story (the asset stays); false when it had none. */
export async function removePhoto(tx: Tx, who: Who, publicationId: string, storyId: string): Promise<boolean> {
  const done = await tx
    .deleteFrom("app.story_photo")
    .where("publication_id", "=", publicationId)
    .where("story_id", "=", storyId)
    .returning("story_id")
    .executeTakeFirst();
  if (done) await touch(tx, who, publicationId, storyId, {});
  return done !== undefined;
}

/** Whether the asset is the photo of a story this person reports or is given (a Reporter's ◐ "own"). */
export async function isPhotoOfTheirs(tx: Tx, publicationId: string, assetId: string, userId: string) {
  const row = await tx
    .selectFrom("app.story_photo as sp")
    .innerJoin("app.story as s", (join) =>
      join
        .onRef("s.org_id", "=", "sp.org_id")
        .onRef("s.publication_id", "=", "sp.publication_id")
        .onRef("s.id", "=", "sp.story_id"),
    )
    .select("sp.story_id")
    .where("sp.publication_id", "=", publicationId)
    .where("sp.asset_id", "=", assetId)
    .where("s.deleted_at", "is", null)
    .where((eb) => eb.or([eb("s.reporter_id", "=", userId), eb("s.assignee_id", "=", userId)]))
    .executeTakeFirst();
  return row !== undefined;
}
