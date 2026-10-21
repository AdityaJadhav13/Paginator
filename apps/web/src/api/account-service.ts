/**
 * The real account service (docs/product/10-l2-newsroom-plan.md §4.1, §4.3): Better Auth's reset, confirmation and
 * sign-up endpoints under /api/auth, and the invitation endpoints under /api/v1 (PR 10).
 *
 * The emailed links come back to this app: a reset link to /reset-password (Better Auth adds `?token=` or
 * `?error=INVALID_TOKEN`), a confirmation link to the `returnPath` the caller gives (Better Auth adds `?error=` when
 * the link is bad). Paths are relative, which Better Auth accepts as its own origin's.
 */
import type { AccountService, ApiProblem, InvitationDto } from "../services/index.ts";
import { isObject, type ApiClient, type RequestOptions } from "./client.ts";

/**
 * The header that carries the invitation id on sign-up (plan §4.3 step 4: "with the invitation id in a header"). Its
 * name is this app's proposal: the invite-only sign-up hook (PR 10) must read the same one.
 */
export const INVITATION_HEADER = "X-Pageinator-Invitation";

/** Where a reset link brings the browser back. */
export const RESET_PASSWORD_PATH = "/reset-password";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

/** Better Auth's invitation statuses, and ours, as the four the screens tell apart. */
const STATES: Readonly<Record<string, InvitationDto["state"]>> = {
  pending: "pending",
  accepted: "accepted",
  expired: "expired",
  revoked: "revoked",
  canceled: "revoked",
  cancelled: "revoked",
  rejected: "revoked",
};

/** `GET /api/v1/invitations/{id}`'s answer, or undefined if it is not one. */
export function invitationFromAnswer(value: unknown): InvitationDto | undefined {
  if (!isObject(value)) return undefined;
  const { organization, inviter, roles, expiresAt, state } = value;
  if (!isObject(organization) || typeof organization["name"] !== "string") return undefined;
  if (!isObject(inviter) || typeof inviter["name"] !== "string") return undefined;
  if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string")) return undefined;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) return undefined;
  const known = typeof state === "string" ? STATES[state] : undefined;
  if (!known) return undefined;
  return {
    organizationName: organization["name"],
    inviterName: inviter["name"],
    roles: roles as string[],
    expiresAt,
    state: known,
  };
}

function invitationPath(invitationId: string): string {
  return `/api/v1/invitations/${encodeURIComponent(invitationId)}`;
}

export function createApiAccountService(client: ApiClient): AccountService {
  async function send(path: string, body: unknown, options: RequestOptions = {}) {
    const answer = await client.post(path, body, options);
    return answer.ok ? { ok: true as const, value: undefined } : { ok: false as const, error: answer.problem };
  }

  return {
    requestPasswordReset: ({ email }) =>
      send("/api/auth/request-password-reset", { email, redirectTo: RESET_PASSWORD_PATH }),

    resetPassword: ({ token, newPassword }) => send("/api/auth/reset-password", { newPassword, token }),

    sendVerificationEmail: ({ email, returnPath }) =>
      send("/api/auth/send-verification-email", { email, callbackURL: returnPath }),

    async getInvitation({ invitationId }) {
      const answer = await client.get(invitationPath(invitationId));
      if (!answer.ok) return { ok: false, error: answer.problem };
      const invitation = invitationFromAnswer(answer.value);
      return invitation ? { ok: true, value: invitation } : { ok: false, error: UNEXPECTED };
    },

    signUp: ({ invitationId, name, email, password, returnPath }) =>
      send(
        "/api/auth/sign-up/email",
        { name, email, password, callbackURL: returnPath },
        { headers: { [INVITATION_HEADER]: invitationId } },
      ),

    acceptInvitation: ({ invitationId, idempotencyKey }) =>
      send(`${invitationPath(invitationId)}/accept`, {}, { idempotencyKey }),
  };
}
