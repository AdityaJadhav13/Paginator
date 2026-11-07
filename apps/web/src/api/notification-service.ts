/**
 * The person's notifications over the API (docs/product/10-l2-newsroom-plan.md §5.2; 06 §11), under the organisation:
 * GET …/notifications (newest first, with the unread count) and POST …/notifications/read. Answers are read with the
 * API's own schema (@pageinator/contracts).
 */
import { NotificationList } from "@pageinator/contracts";
import type { ApiProblem, NotificationService } from "../services/index.ts";
import type { ApiClient } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

const org = (orgId: string) => `/api/v1/orgs/${encodeURIComponent(orgId)}/notifications`;

export function createApiNotificationService(client: ApiClient): NotificationService {
  return {
    async list({ orgId, unread, cursor, limit }) {
      const query = new URLSearchParams();
      if (unread) query.set("unread", "1");
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      const search = query.toString();
      const answer = await client.get(`${org(orgId)}${search ? `?${search}` : ""}`);
      if (!answer.ok) return { ok: false, error: answer.problem };
      const parsed = NotificationList.safeParse(answer.value);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
    },
    async markRead(input) {
      const body = "all" in input ? { all: true } : { ids: [...input.ids] };
      const answer = await client.post(`${org(input.orgId)}/read`, body);
      return answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };
    },
  };
}
