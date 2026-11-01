// Writing and reading the audit log (docs/product/10-l2-newsroom-plan.md §3.4, §5.2; migrations 2026_11_01_0002 and
// 2026_11_26_0001). recordAudit is the log's one writer (test/unit/audit-actions.test.ts holds every module to it): it
// writes in the caller's transaction, so an event is saved with its change or not at all, and a replayed request,
// which runs nothing again, writes nothing again. The reading is for src/modules/audit. Each function runs inside
// withTenant, so the organisation wall applies, and the read wall (the events of the publications the tenant reaches
// and the organisation's own; migration 2026_11_26_0001); the role's view (every event, or a Chief Editor's publications' events of the publication-level actions) is the caller's
// to give, and is applied here to the list and to the cursor alike. Filters arrive checked by the route's schema, and
// reach the database as parameters only: an action prefix is compared with starts_with(), never with LIKE.
import type { AuditAction } from "@pageinator/contracts";
import { type RawBuilder, sql } from "kysely";
import type { Client } from "pg";
import type { Tenant, Tx } from "./tenant.ts";

/** What the reader may see: every event of the organisation, or those of some publications with some actions. */
export type AuditView = { all: true } | { all: false; publications: readonly string[]; actions: readonly string[] };

export type AuditFilter = {
  actor?: string;
  /** one action, or (ending in ".") a prefix of actions */
  action?: string;
  targetType?: string;
  targetId?: string;
  publication?: string;
  from?: string;
  to?: string;
  /** a cursor: at to the microsecond (UTC) and the id, of the last event of the page before */
  before?: { at: string; id: string };
  limit: number;
};

export type AuditRow = {
  id: string;
  at: Date;
  /** at to the microsecond, in UTC, for the next page's cursor */
  at_cursor: string;
  actor_kind: "user" | "system" | "import";
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  publication_id: string | null;
  request_id: string | null;
  data: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
};

const AT_CURSOR = sql<string>`to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function seen(view: AuditView): RawBuilder<unknown> {
  if (view.all) return sql`true`;
  return sql`e.publication_id = any (${[...view.publications]}::uuid[])
    and e.action = any (${[...view.actions]}::text[])`;
}

/** The events the reader may see that match the filter, newest first. */
export async function listAudit(tx: Tx, view: AuditView, f: AuditFilter): Promise<AuditRow[]> {
  const conditions: RawBuilder<unknown>[] = [seen(view)];
  if (f.actor !== undefined) conditions.push(sql`e.actor_id = ${f.actor}::uuid`);
  if (f.action !== undefined) {
    conditions.push(f.action.endsWith(".") ? sql`starts_with(e.action, ${f.action})` : sql`e.action = ${f.action}`);
  }
  if (f.targetType !== undefined) conditions.push(sql`e.target_type = ${f.targetType}`);
  if (f.targetId !== undefined) conditions.push(sql`e.target_id = ${f.targetId}::uuid`);
  if (f.publication !== undefined) conditions.push(sql`e.publication_id = ${f.publication}::uuid`);
  if (f.from !== undefined) conditions.push(sql`e.at >= ${f.from}::timestamptz`);
  if (f.to !== undefined) conditions.push(sql`e.at < ${f.to}::timestamptz`);
  if (f.before !== undefined) {
    conditions.push(sql`(e.at, e.id) < (${f.before.at}::timestamptz, ${f.before.id}::uuid)`);
  }
  const { rows } = await sql<AuditRow>`
    select e.id, e.at, ${AT_CURSOR} as at_cursor, e.actor_kind, e.actor_id, p.display_name as actor_name, e.action,
      e.target_type, e.target_id, e.publication_id, e.request_id, e.data, host(e.ip) as ip, e.user_agent
    from app.audit_event e
    left join app.person p on p.org_id = e.org_id and p.user_id = e.actor_id
    where ${sql.join(conditions, sql` and `)}
    order by e.at desc, e.id desc
    limit ${f.limit}`.execute(tx);
  return rows;
}

/** Whether a cursor names an event the reader may see, at the time it says: a cursor of another organisation, or of
 * an event out of the reader's view, does not. */
export async function isAuditCursor(tx: Tx, view: AuditView, before: { at: string; id: string }): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`
    select true as ok from app.audit_event e
    where e.id = ${before.id}::uuid and ${AT_CURSOR} = ${before.at} and ${seen(view)}`.execute(tx);
  return rows.length > 0;
}

/** One audit event to write. `data` holds ids, numbers and state names only: never a headline, body, caption, credit,
 * file name or any other text a person typed (the log is long-lived, and a person's text is not its to keep). */
export type AuditEntry = {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  publicationId?: string | null;
  data?: Record<string, unknown>;
  /** "user" by default: the tenant's person */
  actorKind?: "user" | "system" | "import";
};

/** Writes an audit event in the caller's transaction, so it is saved with the change it records, or not at all. The
 * actor, request id and client come from the tenant. */
export async function recordAudit(tx: Tx, tenant: Tenant, entry: AuditEntry): Promise<void> {
  const kind = entry.actorKind ?? "user";
  await tx
    .insertInto("app.audit_event")
    .values({
      org_id: tenant.orgId,
      publication_id: entry.publicationId ?? null,
      actor_kind: kind,
      actor_id: kind === "system" ? null : tenant.userId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      data: JSON.stringify(entry.data ?? {}),
      ip: tenant.client?.ip ?? null,
      user_agent: tenant.client?.userAgent?.slice(0, 512) ?? null,
      request_id: tenant.requestId,
    })
    .execute();
}

/** An event of one story (its photo's included), on its publication. */
export function auditStory(
  tx: Tx,
  tenant: Tenant,
  publicationId: string,
  storyId: string,
  action: AuditAction,
  data: AuditEntry["data"] = {},
): Promise<void> {
  return recordAudit(tx, tenant, { action, targetType: "story", targetId: storyId, publicationId, data });
}

/** The restore drill's marker (src/db/restore-drill.ts): one event's id and the md5 of its whole row, the newest or the
 * one named. It runs outside withTenant, as pgn_backup, which reads every row (BYPASSRLS) and writes none. */
export async function auditMarker(
  client: Pick<Client, "query">,
  id?: string,
): Promise<{ id: string; hash: string } | undefined> {
  const { rows } = await client.query<{ id: string; hash: string }>(
    id === undefined
      ? "select id, md5(a::text) as hash from app.audit_event a order by at desc, id desc limit 1"
      : "select id, md5(a::text) as hash from app.audit_event a where id = $1",
    id === undefined ? [] : [id],
  );
  return rows[0];
}
