// The per-email sign-in lock (docs/product/10-l2-newsroom-plan.md §4.6): five wrong passwords for one email within
// 15 minutes lock that email out of signing in for 15 minutes, whoever tries and from wherever. Better Auth's own
// limit counts per address and path; this one counts per account, unknown emails included, so a lock says nothing
// about whether an account exists. An email is kept only as an HMAC under the sign-in secret.
//
// Each attempt is reserved before its password is checked, in one statement, so attempts sent together cannot all
// pass a check made before any of them was counted: while the wrong passwords and the attempts still being checked
// come to five, the next is refused. A wrong password turns its reservation into a counted failure (the fifth locks);
// a right one clears the count; any other answer (an unverified email, an invalid request) hands it back.
import { createHmac } from "node:crypto";
import type { IdentityStore } from "../../db/identity.ts";

export const LOCK_AFTER = 5;
export const WINDOW_MS = 15 * 60_000;

export type SignInGuard = {
  /** Reserves an attempt for this email; false while it is locked or its attempts are used up. */
  reserve(email: string): Promise<boolean>;
  /** The attempt was a wrong password (its reservation stays counted); true when this one locked the email. */
  wrongPassword(email: string): Promise<boolean>;
  /** The attempt was refused for another reason: its reservation is handed back. */
  notCounted(email: string): Promise<void>;
  /** A right password: the count starts again (a lock still runs its course). */
  succeeded(email: string): Promise<void>;
};

export function emailKey(secret: string, email: string): string {
  return createHmac("sha256", secret).update(`sign-in:${email.trim().toLowerCase()}`).digest("base64url");
}

export function signInGuard(store: IdentityStore, secret: string): SignInGuard {
  const key = (email: string) => emailKey(secret, email);
  return {
    reserve: (email) => store.reserveAttempt(key(email), LOCK_AFTER, WINDOW_MS),
    wrongPassword: (email) => store.countWrongPassword(key(email), LOCK_AFTER, WINDOW_MS),
    notCounted: (email) => store.returnAttempt(key(email)),
    succeeded: (email) => store.clearAttempts(key(email)),
  };
}
