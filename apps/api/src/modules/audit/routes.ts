// The audit log over HTTP (docs/product/10-l2-newsroom-plan.md §3.4, §5.2; 07 §12's "Audit log" row):
//   GET /api/v1/orgs/:o/audit?actor&action&target&publication&from&to&cursor&limit → {items, nextCursor}
// permission audit.view. Owner and Admin see every event of the organisation, with the client's address and browser;
// a Chief Editor (audit.view "scoped") sees only the events of the publications they are Chief Editor of, never an
// organisation-level one (people, invitations, the organisation: only actions of AUDIT_ACTIONS' scope "publication"
// are shown, so an uncatalogued one never is), and never the address or browser. Anyone else is refused by the access
// check, which audits the refusal. Newest first; the cursor is the last event's (at, id), checked to be one the reader
// may see, so another organisation's cursor is refused. Sign-in events are not here: they stay in identity.auth_event.
import { AuditList, AuditQuery, PUBLICATION_AUDIT_ACTIONS } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuditView, isAuditCursor, listAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf } from "../access/access.ts";

const Org = z.strictObject({ o: z.string() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DEFAULT_LIMIT = 50;

const badCursor = () =>
  new ApiError("invalid_request", [{ field: "querystring.cursor", message: "is not a cursor this API gave" }]);

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString("base64url");
}
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [unknown, unknown];
    if (typeof at === "string" && CURSOR_TIME.test(at) && typeof id === "string" && UUID.test(id)) return { at, id };
  } catch {
    // not one of ours
  }
  throw badCursor();
}

/** What the reader sees: everything for a full audit.view (Owner, Admin), else their Chief Editor publications. */
function viewOf(access: Access): AuditView {
  if (access.reach === "full") return { all: true };
  const publications = [...access.publications]
    .filter(([, here]) => here.roles.includes("chief_editor"))
    .map(([id]) => id);
  return { all: false, publications, actions: PUBLICATION_AUDIT_ACTIONS };
}

export const auditRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  app.get(
    "/api/v1/orgs/:o/audit",
    {
      config: { permission: "audit.view" },
      schema: { params: Org, querystring: AuditQuery, response: { 200: AuditList } },
    },
    async (request) => {
      const access = accessOf(request);
      const q = request.query;
      const limit = q.limit ?? DEFAULT_LIMIT;
      const before = q.cursor === undefined ? undefined : decodeCursor(q.cursor);
      const view = viewOf(access);
      const [targetType, targetId] = q.target === undefined ? [] : q.target.split(":");
      return database.withTenant(access.tenant, async (tx) => {
        if (before && !(await isAuditCursor(tx, view, before))) throw badCursor();
        const rows = await listAudit(tx, view, {
          limit: limit + 1,
          ...(q.actor !== undefined ? { actor: q.actor } : {}),
          ...(q.action !== undefined ? { action: q.action } : {}),
          ...(targetType !== undefined ? { targetType } : {}),
          ...(targetId !== undefined ? { targetId } : {}),
          ...(q.publication !== undefined ? { publication: q.publication } : {}),
          ...(q.from !== undefined ? { from: q.from } : {}),
          ...(q.to !== undefined ? { to: q.to } : {}),
          ...(before ? { before } : {}),
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const showClient = view.all; // the client's address and browser: Owner and Admin only
        return {
          items: page.map((row) => ({
            id: row.id,
            at: row.at.toISOString(),
            actor: row.actor_id !== null ? { kind: row.actor_kind, id: row.actor_id, name: row.actor_name } : null,
            action: row.action,
            target: { type: row.target_type, id: row.target_id },
            publicationId: row.publication_id,
            requestId: row.request_id,
            data: row.data,
            ip: showClient ? row.ip : null,
            userAgent: showClient ? row.user_agent : null,
          })),
          nextCursor: rows.length > limit && last ? encodeCursor(last.at_cursor, last.id) : null,
        };
      });
    },
  );
};
