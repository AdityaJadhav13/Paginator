// Notifications in the database (docs/product/10-l2-newsroom-plan.md §3.3; migration 2026_11_24_0001), for
// src/modules/notifications. Each function runs inside withTenant: the organisation wall applies, and a person reads and
// marks only their own notifications (the restrictive policies), though anyone of the organisation writes one for
// another member.
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

export type NotificationKind = "story_filed" | "story_sent_back" | "story_assigned" | "comment" | "invitation_accepted";

/** What a notification names: ids only (the web fetches each through the routes that check access). */
export type NotificationData = {
  publicationId?: string;
  storyId?: string;
  commentId?: string;
  invitationId?: string;
  /** who did it */
  actorId: string;
};

export type NewNotification = {
  userId: string;
  kind: NotificationKind;
  targetType: "story" | "invitation";
  targetId: string;
  data: NotificationData;
  /** true when an email goes with it (sent once this transaction has committed) */
  emailed: boolean;
};

export async function addNotifications(tx: Tx, orgId: string, rows: readonly NewNotification[]): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insertInto("app.notification")
    .values(
      rows.map((row) => ({
        org_id: orgId,
        user_id: row.userId,
        kind: row.kind,
        target_type: row.targetType,
        target_id: row.targetId,
        data: JSON.stringify(row.data),
        emailed_at: row.emailed ? sql<Date>`now()` : null,
      })),
    )
    .execute();
}

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  target_type: string;
  target_id: string;
  data: NotificationData;
  read_at: Date | null;
  created_at: Date;
  actor_name: string | null;
};

/** A notification counts for the person only while they reach its publication (one with none always counts). */
const reachable = sql<boolean>`(n.data->>'publicationId' is null
  or (n.data->>'publicationId')::uuid = any ((select app.current_pubs())::uuid[]))`;

/** The person's notifications, newest first, after the cursor (created_at, id). */
export async function listNotifications(
  tx: Tx,
  options: { unread: boolean; limit: number; before?: { createdAt: string; id: string } },
): Promise<NotificationRow[]> {
  const { rows } = await sql<NotificationRow>`
    select n.id, n.kind, n.target_type, n.target_id, n.data, n.read_at, n.created_at, p.display_name as actor_name
    from app.notification n
    left join app.person p on p.org_id = n.org_id and p.user_id = (n.data->>'actorId')::uuid
    where n.user_id = (select app.current_user()) and ${reachable}
      ${options.unread ? sql`and n.read_at is null` : sql``}
      ${options.before ? sql`and (n.created_at, n.id) < (${options.before.createdAt}::timestamptz, ${options.before.id}::uuid)` : sql``}
    order by n.created_at desc, n.id desc
    limit ${options.limit}`.execute(tx);
  return rows;
}

export async function unreadCount(tx: Tx): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from app.notification n
    where n.user_id = (select app.current_user()) and n.read_at is null and ${reachable}`.execute(tx);
  return rows[0]?.n ?? 0;
}

/** Marks the person's notifications read: these ids, or all of them. */
export async function markRead(tx: Tx, which: { ids: readonly string[] } | { all: true }): Promise<void> {
  let query = tx
    .updateTable("app.notification")
    .set({ read_at: sql`now()` })
    .where("user_id", "=", sql<string>`(select app.current_user())`)
    .where("read_at", "is", null);
  if ("ids" in which) query = query.where("id", "in", which.ids);
  await query.execute();
}

/** The cursor's time: created_at to the microsecond, in UTC. */
export async function cursorOf(tx: Tx, id: string): Promise<string | null> {
  const { rows } = await sql<{ at: string }>`
    select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
    from app.notification where id = ${id}`.execute(tx);
  return rows[0]?.at ?? null;
}

export type Recipient = { userId: string; name: string; email: string | null };

/** The active people of the organisation among these. */
export async function activePeople(tx: Tx, userIds: readonly string[]): Promise<Recipient[]> {
  if (userIds.length === 0) return [];
  const { rows } = await sql<Recipient>`
    select user_id as "userId", display_name as name, email from app.person
    where status = 'active' and user_id = any (${userIds as string[]}::uuid[])
    order by user_id`.execute(tx);
  return rows;
}

/** These people's roles and grants on the publication, for those who have any. */
export async function grantsOn(
  tx: Tx,
  publicationId: string,
  userIds: readonly string[],
): Promise<Map<string, { roles: string[]; grants: string[] }>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx
    .selectFrom("app.publication_grant")
    .select(["user_id", "roles", "grants"])
    .where("publication_id", "=", publicationId)
    .where("user_id", "in", userIds)
    .execute();
  return new Map(rows.map((row) => [row.user_id, { roles: row.roles as string[], grants: row.grants as string[] }]));
}

/** The people with any of these roles on the publication (the desk, told of a filed story). */
export async function withRoles(tx: Tx, publicationId: string, roles: readonly string[]): Promise<string[]> {
  const { rows } = await sql<{ userId: string }>`
    select user_id as "userId" from app.publication_grant
    where publication_id = ${publicationId} and roles && ${roles as string[]}::text[]
    order by user_id`.execute(tx);
  return rows.map((row) => row.userId);
}
