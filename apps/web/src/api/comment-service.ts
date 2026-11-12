/**
 * A story's comments over the API (docs/product/10-l2-newsroom-plan.md §5.2), every answer read with the API's own
 * schema (@pageinator/contracts), so a change of shape shows as an error, never as a wrong screen.
 */
import { Comment, CommentList } from "@pageinator/contracts";
import type { ApiProblem, CommentService, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: answer.problem };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

const pub = (orgId: string, pubId: string) => `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}`;

export function createApiCommentService(client: ApiClient): CommentService {
  return {
    async list({ orgId, pubId, storyId }) {
      const result = read(CommentList, await client.get(`${pub(orgId, pubId)}/stories/${encodeURIComponent(storyId)}/comments`));
      return result.ok ? { ok: true, value: result.value.items } : result;
    },
    async create({ orgId, pubId, storyId, body, parentId, idempotencyKey }) {
      const input = { body, ...(parentId ? { parentId } : {}) };
      return read(
        Comment,
        await client.post(`${pub(orgId, pubId)}/stories/${encodeURIComponent(storyId)}/comments`, input, { idempotencyKey }),
      );
    },
    async update({ orgId, pubId, commentId, patch }) {
      return read(Comment, await client.patch(`${pub(orgId, pubId)}/comments/${encodeURIComponent(commentId)}`, patch));
    },
  };
}
