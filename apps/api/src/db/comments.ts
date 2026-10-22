// A story's comments in the database (docs/product/10-l2-newsroom-plan.md §3.3, §5.2; the content schema's
// app.comment), for src/modules/stories/comments.ts. Each function runs inside withTenant: the organisation and
// publication walls apply. A comment is on one story; a reply is on its parent's story (a foreign key), one level deep.
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

export type CommentRow = {
  id: string;
  target_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  created_at: Date;
  updated_at: Date;
};

const COMMENT = sql`
  select c.id, c.target_id, c.parent_id, c.author_id, a.display_name as author_name, c.body, c.resolved_at,
    c.resolved_by, r.display_name as resolved_by_name, c.created_at, c.updated_at
  from app.comment c
  join app.person a on a.org_id = c.org_id and a.user_id = c.author_id
  left join app.person r on r.org_id = c.org_id and r.user_id = c.resolved_by`;

/** The story's comments, oldest first (replies after their parent in time). */
export async function listComments(tx: Tx, publicationId: string, storyId: string): Promise<CommentRow[]> {
  const { rows } = await sql<CommentRow>`${COMMENT}
    where c.publication_id = ${publicationId} and c.target_id = ${storyId} and c.deleted_at is null
    order by c.created_at, c.id`.execute(tx);
  return rows;
}

export async function findComment(
  tx: Tx,
  publicationId: string,
  commentId: string,
  lock = false,
): Promise<CommentRow | undefined> {
  const { rows } = await sql<CommentRow>`${COMMENT}
    where c.publication_id = ${publicationId} and c.id = ${commentId} and c.deleted_at is null
    ${lock ? sql`for update of c` : sql``}`.execute(tx);
  return rows[0];
}

export async function createComment(
  tx: Tx,
  who: { orgId: string; userId: string },
  publicationId: string,
  input: { storyId: string; parentId: string | null; body: string },
): Promise<string> {
  const made = await tx
    .insertInto("app.comment")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      target_id: input.storyId,
      parent_id: input.parentId,
      author_id: who.userId,
      body: input.body,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return made.id;
}

export async function updateComment(
  tx: Tx,
  publicationId: string,
  commentId: string,
  change: { body?: string; resolvedBy?: string | null },
): Promise<void> {
  await tx
    .updateTable("app.comment")
    .set({
      // updated_at says when the body last changed (the Comment's edited), so resolving leaves it
      ...(change.body !== undefined ? { body: change.body, updated_at: sql`now()` } : {}),
      ...(change.resolvedBy !== undefined
        ? change.resolvedBy === null
          ? { resolved_at: null, resolved_by: null }
          : { resolved_at: sql`now()`, resolved_by: change.resolvedBy }
        : {}),
    })
    .where("publication_id", "=", publicationId)
    .where("id", "=", commentId)
    .execute();
}

/** Who has written in the thread (the parent's author and each reply's), to tell them of a reply. */
export async function threadAuthors(tx: Tx, publicationId: string, parentId: string): Promise<string[]> {
  const rows = await tx
    .selectFrom("app.comment")
    .select("author_id")
    .distinct()
    .where("publication_id", "=", publicationId)
    .where((eb) => eb.or([eb("id", "=", parentId), eb("parent_id", "=", parentId)]))
    .where("deleted_at", "is", null)
    .execute();
  return rows.map((row) => row.author_id);
}
