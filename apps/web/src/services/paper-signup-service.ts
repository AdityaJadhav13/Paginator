import type { PaperDetails, PaperSignupRequest } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** A new paper's application, as POST /api/v1/signup/paper takes it (@pageinator/contracts PaperSignupRequest). */
export type PaperSignupRequestDto = PaperSignupRequest;
export type PaperDetailsDto = PaperDetails;

/**
 * What became of an application (the API answers the same whether or not the email has one already):
 *   - sent: received; a confirmation link is on its way;
 *   - invalid: the API refused some fields (their names, such as "email");
 *   - busy: too many from this address (429 signup_limit or slow_down);
 *   - failed: no answer, or another refusal.
 */
export type PaperSignupOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "invalid"; readonly fields: readonly string[] }
  | { readonly kind: "busy" }
  | { readonly kind: "failed" };

/** What became of a confirmation link: waiting for approval, a link that is unknown, used or expired, or no answer. */
export type PaperConfirmOutcome = "waiting" | "invalid" | "failed";

export interface PaperSignupService {
  apply(request: PaperSignupRequestDto): Promise<PaperSignupOutcome>;
  confirm(token: string): Promise<PaperConfirmOutcome>;
  /** The publication's name and languages (GET /api/v1/orgs/:o/pubs/:p/paper), for the Owner's first screen. */
  paper(orgId: string, pubId: string): Promise<ServiceResult<PaperDetailsDto, ApiProblem>>;
}
