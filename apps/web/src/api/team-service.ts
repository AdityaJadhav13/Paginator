/**
 * Team over the API's own endpoints (docs/product/10-l2-newsroom-plan.md §5.2), every answer read with the API's own
 * schema (@pageinator/contracts), so a change of shape shows as an error, never as a wrong screen.
 */
import { Invitation, Member } from "@pageinator/contracts";
import type { ApiProblem, ServiceResult, TeamService } from "../services/index.ts";
import { isObject, type ApiClient } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, value: unknown): ServiceResult<T, ApiProblem> {
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

/** `{items: [...]}`, every item read with the schema. */
function items<T>(schema: Schema<T>, value: unknown): ServiceResult<T[], ApiProblem> {
  if (!isObject(value) || !Array.isArray(value["items"])) return { ok: false, error: UNEXPECTED };
  const out: T[] = [];
  for (const item of value["items"]) {
    const parsed = schema.safeParse(item);
    if (!parsed.success) return { ok: false, error: UNEXPECTED };
    out.push(parsed.data);
  }
  return { ok: true, value: out };
}

const org = (orgId: string) => `/api/v1/orgs/${encodeURIComponent(orgId)}`;

export function createApiTeamService(client: ApiClient): TeamService {
  return {
    async listMembers({ orgId }) {
      const answer = await client.get(`${org(orgId)}/members`);
      if (!answer.ok) return { ok: false, error: answer.problem };
      return items(Member, answer.value);
    },
    async updateMember({ orgId, userId, patch }) {
      const answer = await client.patch(`${org(orgId)}/members/${encodeURIComponent(userId)}`, patch);
      return answer.ok ? read(Member, answer.value) : { ok: false, error: answer.problem };
    },
    async removeMember({ orgId, userId }) {
      const answer = await client.delete(`${org(orgId)}/members/${encodeURIComponent(userId)}`);
      return answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };
    },
    async listInvitations({ orgId }) {
      const answer = await client.get(`${org(orgId)}/invitations`);
      if (!answer.ok) return { ok: false, error: answer.problem };
      return items(Invitation, answer.value);
    },
    async invite({ orgId, invitation, idempotencyKey }) {
      const answer = await client.post(`${org(orgId)}/invitations`, invitation, { idempotencyKey });
      return answer.ok ? read(Invitation, answer.value) : { ok: false, error: answer.problem };
    },
    async resendInvitation({ orgId, id }) {
      const answer = await client.post(`${org(orgId)}/invitations/${encodeURIComponent(id)}/resend`, {});
      return answer.ok ? read(Invitation, answer.value) : { ok: false, error: answer.problem };
    },
    async cancelInvitation({ orgId, id }) {
      const answer = await client.delete(`${org(orgId)}/invitations/${encodeURIComponent(id)}`);
      return answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };
    },
  };
}
