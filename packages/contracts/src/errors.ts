// The API's error envelope (docs/product/10-l2-newsroom-plan.md §5.1): {"error": {code, message, details?, requestId}}.
// The web shows its own English or Marathi text for `code` and falls back to `message`.
import { z } from "zod";

/** The codes the API answers with today; later PRs add theirs from §5.1 (signed_out, not_allowed, …). */
export const ERROR_CODES = [
  "invalid_request",
  "bad_origin",
  "not_found",
  "request_too_large",
  "not_json",
  "slow_down",
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
    requestId: z.string().min(1),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
