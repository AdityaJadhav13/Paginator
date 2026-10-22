import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** What an invitation link shows (plan §4.3, `GET /api/v1/invitations/{id}`): never the invited email address. */
export interface InvitationDto {
  readonly organizationName: string;
  readonly inviterName: string;
  /** Role codes, organisation role first ("admin", "page_designer", …). */
  readonly roles: readonly string[];
  /** ISO-8601. */
  readonly expiresAt: string;
  readonly state: "pending" | "accepted" | "expired" | "revoked";
}

export interface SignUpInput {
  readonly invitationId: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/**
 * The account steps around signing in (plan §4.1, §4.3): password reset, email confirmation, and an invitation's
 * sign-up and acceptance. Every answer about an email address is the same whether or not it has an account.
 */
export interface AccountService {
  /** Emails a reset link if the address has an account; the answer is the same either way. */
  requestPasswordReset(input: { readonly email: string }): Promise<ServiceResult<void, ApiProblem>>;
  /** Sets the new password with the emailed token; every session of that account ends. */
  resetPassword(input: { readonly token: string; readonly newPassword: string }): Promise<ServiceResult<void, ApiProblem>>;
  /**
   * Sends a new confirmation link if the address still needs one; the answer is the same either way. The link brings
   * the browser back to `returnPath` (a path of this app).
   */
  sendVerificationEmail(input: {
    readonly email: string;
    readonly returnPath: string;
  }): Promise<ServiceResult<void, ApiProblem>>;
  getInvitation(input: { readonly invitationId: string }): Promise<ServiceResult<InvitationDto, ApiProblem>>;
  /**
   * Creates the account an invitation allows, then the API emails a confirmation link that brings the browser back to
   * `returnPath`. The answer is the same whether or not the address could sign up.
   */
  signUp(input: SignUpInput & { readonly returnPath: string }): Promise<ServiceResult<void, ApiProblem>>;
  /** Joins the invitation's organisation (signed in, email confirmed): the organisation's id. The key makes a retry
   * safe (plan §5.1). */
  acceptInvitation(input: {
    readonly invitationId: string;
    readonly idempotencyKey: string;
  }): Promise<ServiceResult<{ readonly orgId: string }, ApiProblem>>;
}
