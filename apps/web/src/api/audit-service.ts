/**
 * The audit log over the API (docs/product/10-l2-newsroom-plan.md §5.2, as built): GET /api/v1/orgs/:o/audit with its
 * filters, cursor and limit. Answers are read with the API's own schema (@pageinator/contracts).
 */
import { AuditList } from "@pageinator/contracts";
import type { ApiProblem, AuditService } from "../services/index.ts";
import type { ApiClient } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

export function createApiAuditService(client: ApiClient): AuditService {
  return {
    async list({ orgId, action, publication, from, to, cursor, limit }) {
      const query = new URLSearchParams();
      if (action) query.set("action", action);
      if (publication) query.set("publication", publication);
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      const search = query.toString();
      const answer = await client.get(`/api/v1/orgs/${encodeURIComponent(orgId)}/audit${search ? `?${search}` : ""}`);
      if (!answer.ok) return { ok: false, error: answer.problem };
      const parsed = AuditList.safeParse(answer.value);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
    },
  };
}
