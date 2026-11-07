import type { Comment, CommentPatch } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts notifications.ts). */
export type CommentDto = Comment;
export type CommentPatchDto = CommentPatch;

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

/**
 * A story's comments (plan §5.2): threads one level deep, oldest first. Whoever sees the story reads them; whoever may
 * comment on it writes one, or a reply to a thread's first comment (with an Idempotency-Key, the same on every retry of
 * the same text); its author changes its text; the author, the desk or the story's reporter or assignee resolves or
 * reopens a thread. Each comment says what the person may do to it (`can`). A body is cleaned by the API as the Desk
 * cleans text, to 10,000 characters at most.
 */
export interface CommentService {
  list(input: Where & { readonly storyId: string }): Promise<ServiceResult<readonly CommentDto[], ApiProblem>>;
  create(
    input: Where & {
      readonly storyId: string;
      readonly body: string;
      readonly parentId?: string;
      readonly idempotencyKey: string;
    },
  ): Promise<ServiceResult<CommentDto, ApiProblem>>;
  update(input: Where & { readonly commentId: string; readonly patch: CommentPatchDto }): Promise<ServiceResult<CommentDto, ApiProblem>>;
}
