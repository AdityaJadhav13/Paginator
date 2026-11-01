/**
 * The audit log double, answered as the API answers GET /api/v1/orgs/:o/audit (src/modules/audit/routes.ts): Owner and
 * Admin see every event of the organisation, with the client's address and browser; a Chief Editor (audit.view
 * "scoped") only the events of the publications they are Chief Editor of whose action is of AUDIT_ACTIONS' scope
 * "publication", without the address or browser; anyone else is refused (403). Filters as AuditQuery checks them (an
 * action not of the catalogue, nor a prefix of some ending in ".", is 400); newest first; cursor pages (50 by default,
 * at most 200). Fictional data only; deterministic.
 */
import type { ApiProblem, AuditEventDto, AuditService, ServiceResult } from "../services/index.ts";
import { reach } from "../services/permissions.ts";
import { AuditQuery, PUBLICATION_AUDIT_ACTIONS } from "../services/audit-service.ts";
import type { MockOrgStanding } from "./create-mock-notifications.ts";

export type MockAuditOperation = "audit.list";

export interface MockAuditDeps {
  person(): { readonly userId: string } | undefined;
  orgStanding(userId: string, orgId: string): MockOrgStanding | undefined;
  /** The publications of this organisation the person is Chief Editor of. */
  chiefOf(userId: string, orgId: string): readonly string[];
  gate(operation: MockAuditOperation): Promise<ApiProblem | undefined>;
  signedOut<T>(): ServiceResult<T, ApiProblem>;
}

type Answer = Extract<ApiProblem, { kind: "answer" }>;
const answer = (status: number, code: string, message: string): Answer => ({ kind: "answer", status, code, message, requestId: "mock-request" });
const NOT_FOUND = answer(404, "not_found", "There is nothing here, or you do not have access to it.");
const NOT_ALLOWED = answer(403, "not_allowed", "Your role cannot do this. Ask an editor or the owner.");
const TWO_STEP = answer(403, "two_step_required", "Your role needs two-step sign-in. Set it up in Account → Security.");
const invalid = (field: string, message: string): Answer => ({ ...answer(400, "invalid_request", "Some fields are not right."), details: [{ field, message }] });

const DEMO_ID = /^pub-demo-[a-z]+(-[a-z]+)*$/;
const SAHYADRI = "org-demo-sahyadri";
const PUNE = "pub-demo-pune-daily";
const URDU = "pub-demo-urdu-evening";
const OWNER = { kind: "user" as const, id: "user-demo-sahyadri-owner", name: "Sahyadri Demo Owner" };
const EDITOR = { kind: "user" as const, id: "user-demo-sahyadri-editor", name: "Sahyadri Demo Editor" };
const SUBEDITOR = { kind: "user" as const, id: "user-demo-sahyadri-subeditor", name: "Sahyadri Demo Sub-editor" };
const REPORTER = { kind: "user" as const, id: "user-demo-sahyadri-reporter", name: "Sahyadri Demo Reporter" };
const BROWSER = "Mozilla/5.0 (Fictional Phone) FictionalBrowser/1.0";

type Row = AuditEventDto & { readonly orgId: string };

function event(n: number, at: string, fields: Partial<Row> & Pick<Row, "action" | "target">): Row {
  return {
    id: `audit-demo-${String(n).padStart(3, "0")}`,
    orgId: SAHYADRI,
    at,
    actor: EDITOR,
    publicationId: PUNE,
    requestId: `request-demo-${n}`,
    data: {},
    ip: "192.0.2.10", // TEST-NET-1: a documentation address
    userAgent: BROWSER,
    ...fields,
  };
}

/** Fictional events of the Sahyadri organisation: one of each kind the screen shows, then a day of saves (so there is
 * more than one page). */
function fixtures(): Row[] {
  const org = { publicationId: null };
  const story = (id: string) => ({ type: "story", id });
  const rows: Row[] = [
    event(1, "2026-10-01T04:30:00.000Z", { ...org, action: "org.bootstrap", actor: null, target: { type: "organization", id: null }, ip: null, userAgent: null, requestId: null }),
    event(2, "2026-10-02T05:00:00.000Z", { ...org, action: "invitation.create", actor: OWNER, target: { type: "invitation", id: "invitation-demo-photo" } }),
    event(3, "2026-10-02T07:15:00.000Z", { ...org, action: "invitation.accept", actor: { kind: "user", id: "user-demo-sahyadri-photo", name: "Sahyadri Demo Photo Editor" }, target: { type: "invitation", id: "invitation-demo-photo" } }),
    event(4, "2026-10-03T06:00:00.000Z", { ...org, action: "member.update", actor: OWNER, target: { type: "person", id: SUBEDITOR.id }, ip: "198.51.100.7" }),
    event(5, "2026-10-21T04:00:00.000Z", { action: "story.create", actor: REPORTER, target: story("story-demo-001"), data: { rev: 1, origin: "typed" } }),
    event(6, "2026-10-21T04:20:00.000Z", { action: "story.status_change", actor: REPORTER, target: story("story-demo-001"), data: { from: "draft", to: "filed" } }),
    event(7, "2026-10-21T05:00:00.000Z", { action: "comment.create", target: { type: "comment", id: "comment-demo-001" } }),
    event(8, "2026-10-21T05:30:00.000Z", { action: "story.create", actor: { kind: "import", id: "user-demo-sahyadri-editor", name: null }, target: story("story-demo-005") }),
    event(9, "2026-10-21T06:00:00.000Z", { action: "access.denied", actor: REPORTER, target: { type: "route", id: null }, data: { reason: "not_allowed" } }),
    event(10, "2026-10-21T06:30:00.000Z", { action: "story.assign", actor: EDITOR, target: story("story-demo-003"), publicationId: URDU }),
    event(11, "2026-10-21T07:00:00.000Z", { action: "photo.attach", actor: SUBEDITOR, target: story("story-demo-004"), data: { asset: "asset-demo-001" } }),
    // an action of a newer API than this screen knows: shown by its code
    event(12, "2026-10-21T07:30:00.000Z", { action: "edition.release", target: { type: "edition", id: "edition-demo-2026-10-24" } }),
    event(13, "2026-10-21T08:00:00.000Z", { action: "desk.export", target: { type: "edition", id: "edition-demo-2026-10-23" }, data: { stories: 2, photos: 1 } }),
  ];
  for (let n = 0; n < 48; n += 1) {
    const minute = String(n).padStart(2, "0");
    rows.push(event(100 + n, `2026-10-22T05:${minute}:00.000Z`, { action: "story.revise", actor: SUBEDITOR, target: story("story-demo-003"), data: { rev: n + 2 } }));
  }
  return rows;
}

const newestFirst = (a: Row, b: Row) => (a.at === b.at ? b.id.localeCompare(a.id) : b.at.localeCompare(a.at));

export function createMockAudit(deps: MockAuditDeps): { audit: AuditService } {
  const rows = fixtures().sort(newestFirst);
  const audit: AuditService = {
    async list({ orgId, action, publication, from, to, cursor, limit }) {
      const problem = await deps.gate("audit.list");
      if (problem) return { ok: false, error: { ...problem } };
      const person = deps.person();
      if (!person) return deps.signedOut();
      const standing = deps.orgStanding(person.userId, orgId);
      if (!standing) return { ok: false, error: { ...NOT_FOUND } };
      if (standing.twoStepBlocked) return { ok: false, error: { ...TWO_STEP } };
      const seen = reach("audit.view", standing.orgRole, standing.union);
      if (seen === null) return { ok: false, error: { ...NOT_ALLOWED } };
      // the API's own checks of the filters
      if (!AuditQuery.shape.action.safeParse(action).success) {
        return { ok: false, error: invalid("querystring.action", "is not an action of the catalogue, or a prefix of some ending in a dot") };
      }
      // the demo publications' ids ("pub-demo-…") stand in for the UUIDs the API is given; anything else is checked as the API checks it
      if (!DEMO_ID.test(publication ?? "") && !AuditQuery.shape.publication.safeParse(publication).success) {
        return { ok: false, error: invalid("querystring.publication", "is not a UUID") };
      }
      if (!AuditQuery.shape.from.safeParse(from).success) return { ok: false, error: invalid("querystring.from", "is not a time") };
      if (!AuditQuery.shape.to.safeParse(to).success) return { ok: false, error: invalid("querystring.to", "is not a time") };
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
        return { ok: false, error: invalid("querystring.limit", "must be between 1 and 200") };
      }
      const chief = seen === "full" ? [] : deps.chiefOf(person.userId, orgId);
      const visible = rows.filter(
        (row) =>
          row.orgId === orgId &&
          (seen === "full" ||
            (row.publicationId !== null &&
              chief.includes(row.publicationId) &&
              (PUBLICATION_AUDIT_ACTIONS as readonly string[]).includes(row.action))),
      );
      const fromMs = from ? Date.parse(from) : -Infinity;
      const toMs = to ? Date.parse(to) : Infinity;
      const matching = visible.filter(
        (row) =>
          (!action || (action.endsWith(".") ? row.action.startsWith(action) : row.action === action)) &&
          (!publication || row.publicationId === publication) &&
          Date.parse(row.at) >= fromMs &&
          Date.parse(row.at) < toMs,
      );
      let start = 0;
      if (cursor !== undefined) {
        // a cursor names an event the reader may see: the page after it is what is older
        const after = visible.findIndex((row) => `cursor-${row.id}` === cursor);
        if (after < 0) return { ok: false, error: invalid("querystring.cursor", "is not a cursor this API gave") };
        start = matching.filter((row) => newestFirst(row, visible[after]!) <= 0).length;
      }
      const size = limit ?? 50;
      const page = matching.slice(start, start + size);
      const last = page.at(-1);
      return {
        ok: true,
        value: {
          items: page.map(({ orgId: _org, ...row }) => ({
            ...row,
            actor: row.actor ? { ...row.actor } : null,
            target: { ...row.target },
            data: { ...row.data },
            ip: seen === "full" ? row.ip : null,
            userAgent: seen === "full" ? row.userAgent : null,
          })),
          nextCursor: start + size < matching.length && last ? `cursor-${last.id}` : null,
        },
      };
    },
  };
  return { audit };
}
