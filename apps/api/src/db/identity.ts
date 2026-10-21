// Better Auth's database (docs/product/10-l2-newsroom-plan.md §4.1), and our own identity tables beside its own.
// - Better Auth uses its Kysely adapter on the auth pool (pgn_auth), every statement qualified with schema identity,
//   and transactions, so that a password reset writes the new password and revokes the old sessions together, or not
//   at all (better-auth 1.7.8, #11626; the adapter's default is no transactions). The pool reads int8 as a number
//   (src/db/pools.ts).
// - identity.auth_event records sign-ins and the like (append-only); identity.sign_in_failure counts sign-in attempts
//   per email key (src/modules/identity/sign-in-guard.ts); identity."rateLimit" holds Better Auth's per-address limits,
//   written here so that no key holds a token (src/modules/identity/rate-limit.ts).
import { isIP } from "node:net";
import { PostgresDialect } from "kysely";
import type { Pool } from "pg";

export const IDENTITY_SCHEMA = "identity";

export function identityDatabase(pool: Pool) {
  return {
    dialect: new PostgresDialect({ pool }),
    type: "postgres" as const,
    schemaName: IDENTITY_SCHEMA,
    transaction: true,
  };
}

export const AUTH_EVENT_KINDS = [
  "sign_in",
  "sign_in_failed",
  "sign_in_locked",
  "sign_out",
  "email_verified",
  "password_reset",
  "password_changed",
  "session_revoked",
  "session_expired",
] as const;
export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number];
export type AuthEvent = {
  userId: string | null;
  kind: AuthEventKind;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type IdentityStore = {
  recordEvent(event: AuthEvent): Promise<void>;
  /** Whether the user signed in before, and whether with this same browser, within the last 90 days. */
  signInHistory(userId: string, userAgent: string | null): Promise<{ before: boolean; sameBrowser: boolean }>;
  /** Takes one of a key's sign-in attempts, in one statement, before its password is checked: false while the key is
   * locked, or while its wrong passwords and the attempts still being checked come to `limit`. A window older than
   * `windowMs` starts again. */
  reserveAttempt(key: string, limit: number, windowMs: number): Promise<boolean>;
  /** Hands back an attempt that turned out not to be a wrong password (a refused or invalid request). */
  returnAttempt(key: string): Promise<void>;
  /** Counts a reserved attempt as a wrong password, and locks the key for `forMs` at `limit` of them; true when this
   * one locked it. */
  countWrongPassword(key: string, limit: number, forMs: number): Promise<boolean>;
  /** Forgets the attempts of a key that is not locked. */
  clearAttempts(key: string): Promise<void>;
  /** One step of a rate limit on identity."rateLimit", in one statement: true and counted while fewer than `max`
   * requests came within `windowMs` of the last one let through; otherwise false, with the seconds to wait. */
  consumeRateLimit(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
  /** Deletes the rate-limit rows whose last request is older than `ms`. */
  pruneRateLimits(ms: number): Promise<void>;
};

export function identityStore(pool: Pool): IdentityStore {
  const interval = (ms: number) => `${Math.trunc(ms)} milliseconds`;
  return {
    async recordEvent(event) {
      const ip = event.ip && isIP(event.ip) !== 0 ? event.ip : null; // never a value inet would refuse
      await pool.query(
        `insert into identity.auth_event (user_id, kind, session_id, ip, user_agent)
         values ($1, $2, $3, $4::inet, left($5, 512))`,
        [event.userId, event.kind, event.sessionId ?? null, ip, event.userAgent ?? null],
      );
    },
    async signInHistory(userId, userAgent) {
      const { rows } = await pool.query<{ before: boolean; sameBrowser: boolean }>(
        `select count(*) > 0 as before,
           count(*) filter (where user_agent is not distinct from left($2, 512)) > 0 as "sameBrowser"
         from identity.auth_event where user_id = $1 and kind = 'sign_in' and at > now() - interval '90 days'`,
        [userId, userAgent],
      );
      return rows[0] ?? { before: false, sameBrowser: false };
    },
    async reserveAttempt(key, limit, windowMs) {
      // one statement: attempts arriving together each see the others' reservations
      const { rowCount } = await pool.query(
        `insert into identity.sign_in_failure as f (email_key, failures, checking, window_started_at)
           values ($1, 0, 1, now())
         on conflict (email_key) do update set
           failures = case when f.window_started_at <= now() - $3::interval then 0 else f.failures end,
           checking = case when f.window_started_at <= now() - $3::interval then 1 else f.checking + 1 end,
           window_started_at = case when f.window_started_at <= now() - $3::interval then now()
                                    else f.window_started_at end,
           locked_until = case when f.window_started_at <= now() - $3::interval then null else f.locked_until end
         where (f.locked_until is null or f.locked_until <= now())
           and (f.window_started_at <= now() - $3::interval or f.failures + f.checking < $2)`,
        [key, limit, interval(windowMs)],
      );
      return rowCount === 1;
    },
    async returnAttempt(key) {
      await pool.query(
        "update identity.sign_in_failure set checking = greatest(checking - 1, 0) where email_key = $1",
        [key],
      );
    },
    async countWrongPassword(key, limit, forMs) {
      // now() is the statement's own time: a lock set by an earlier statement never equals it
      const { rows } = await pool.query<{ locked: boolean }>(
        `update identity.sign_in_failure set failures = failures + 1, checking = greatest(checking - 1, 0),
           locked_until = case when failures + 1 >= $2 and (locked_until is null or locked_until <= now())
                               then now() + $3::interval else locked_until end
         where email_key = $1
         returning locked_until is not distinct from now() + $3::interval as locked`,
        [key, limit, interval(forMs)],
      );
      return rows[0]?.locked === true;
    },
    async clearAttempts(key) {
      await pool.query(
        "delete from identity.sign_in_failure where email_key = $1 and (locked_until is null or locked_until <= now())",
        [key],
      );
    },
    async consumeRateLimit(key, max, windowMs) {
      // Better Auth's own rule (src/api/rate-limiter): the window runs from the last request let through. A refused
      // request changes nothing, so no row comes back.
      const now = Date.now();
      const { rowCount } = await pool.query(
        `insert into identity."rateLimit" as r (key, count, "lastRequest") values ($1, 1, $2)
         on conflict (key) do update set
           count = case when r."lastRequest" <= $2 - $4 then 1 else r.count + 1 end,
           "lastRequest" = $2
         where r."lastRequest" <= $2 - $4 or r.count < $3`,
        [key, now, max, Math.trunc(windowMs)],
      );
      if (rowCount === 1) return { allowed: true, retryAfter: null };
      const { rows } = await pool.query<{ lastRequest: number }>(
        `select "lastRequest" from identity."rateLimit" where key = $1`,
        [key],
      );
      const last = rows[0]?.lastRequest ?? now;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((last + windowMs - now) / 1000)) };
    },
    async pruneRateLimits(ms) {
      await pool.query(`delete from identity."rateLimit" where "lastRequest" < $1`, [Date.now() - Math.trunc(ms)]);
    },
  };
}
