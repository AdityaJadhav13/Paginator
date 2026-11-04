// The API's error envelope (docs/product/10-l2-newsroom-plan.md §5.1): {"error": {code, message, details?, requestId}}.
// The web shows its own English or Marathi text for `code` and falls back to `message`.
import { z } from "zod";

/** The codes the API answers with today; later PRs add theirs from §5.1. */
export const ERROR_CODES = [
  "invalid_request",
  "signed_out",
  "not_allowed",
  "two_step_required",
  "bad_origin",
  "not_found",
  "story_changed",
  "asset_changed",
  "asset_in_use",
  "invalid_transition",
  "edition_exists",
  "request_in_progress",
  "idempotency_key_reused",
  "file_too_large",
  "not_a_picture",
  "docx_refused",
  "bundle_refused",
  "request_too_large",
  "not_json",
  "slow_down",
  "contact_unavailable",
  "contact_send_failed",
  "contact_limit",
  "server_error",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** One problem with one part of a request, e.g. {field: "body.headline", message: "…"}. */
export const FieldProblem = z.strictObject({ field: z.string().min(1), message: z.string().min(1) });
export type FieldProblem = z.infer<typeof FieldProblem>;

export const ErrorEnvelope = z.strictObject({
  error: z.strictObject({
    code: ErrorCode,
    message: z.string().min(1),
    details: z.array(FieldProblem).min(1).optional(),
    /** With story_changed: the story as it is now, so the web can show theirs beside the text it keeps; with
     * edition_exists: the edition that has that date; with asset_changed: the picture (MediaItem) as it is now. */
    current: z.unknown().optional(),
    requestId: z.string().min(1),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
