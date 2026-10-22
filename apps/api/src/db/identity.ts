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

  // Organisations, members and invitations: Better Auth's organization tables, read here for /api/v1 (they change
  // through Better Auth's server calls, src/modules/people).
  /** True when id is a pending, unexpired invitation for exactly this email. */
  invitationIsFor(id: string, email: string): Promise<boolean>;
  /** The person's membership of one organisation, or null. */
  membership(orgId: string, userId: string): Promise<Membership | null>;
  /** Every organisation the person is a member of. */
  memberships(userId: string): Promise<(Membership & { orgName: string })[]>;
  /** An organisation's members, with when each was last active (their latest session). */
  members(orgId: string): Promise<Member[]>;
  /** One invitation with its organisation's and inviter's names, or null. */
  invitation(id: string): Promise<Invitation | null>;
  /** An organisation's pending invitations, newest first. */
  pendingInvitations(orgId: string): Promise<Invitation[]>;
  /** The accepted invitations of this email, in every organisation. */
  acceptedInvitations(email: string): Promise<Invitation[]>;
  /** Makes the person a member, unless they are one already; true when this call did (src/modules/people/grants.ts,
   * the repair of an accepted invitation whose membership was never made). */
  addMember(orgId: string, userId: string, role: string): Promise<boolean>;
  /** Changes a member's organisation role; false when they are not a member. */
  setMemberRole(orgId: string, userId: string, role: string): Promise<boolean>;
  /** Ends a membership, and marks the person's accepted invitations of the organisation canceled, in one statement,
   * so that no repair (src/modules/people/grants.ts) can make the membership again; false when there was none. */
  removeMember(orgId: string, userId: string, email: string): Promise<boolean>;
  /** Undoes an accept whose grants could not be written: the membership goes, and the invitation is pending again,
   * in one statement, so a member never exists without their directory row. */
  undoAccept(orgId: string, userId: string, invitationId: string): Promise<void>;

  // Two-step sign-in (src/modules/identity/auth.ts sessionEvents)
  /** Records that a session was made with two-step. */
  markTwoStep(sessionId: string): Promise<void>;
  /** Ends every session of the person but one. */
  endOtherSessions(userId: string, keepSessionId: string): Promise<void>;
  /** Takes a TOTP code for the person; false when it was taken in the last 90 seconds (a replay). */
  useTotpCode(userId: string, code: string): Promise<boolean>;
  /** Gives back a code that was wrong. */
  releaseTotpCode(userId: string, code: string): Promise<void>;
};

export type Membership = { orgId: string; memberId: string; userId: string; role: string };
export type Member = Membership & { name: string; email: string; lastActiveAt: Date | null };
export type Invitation = {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
  inviterName: string;
};

const INVITATION = `select i.id, i."organizationId" as "orgId", o.name as "orgName", i.email, i.role, i.status,
    i."expiresAt", i."createdAt", i."inviterId", coalesce(u.name, '') as "inviterName"
  from identity.invitation i join identity.organization o on o.id = i."organizationId"
  left join identity."user" u on u.id = i."inviterId"`;

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
    async invitationIsFor(id, email) {
      const { rowCount } = await pool.query(
        `select 1 from identity.invitation
         where id = $1::uuid and lower(email) = lower($2) and status = 'pending' and "expiresAt" > now()`,
        [id, email],
      );
      return rowCount === 1;
    },
    async membership(orgId, userId) {
      const { rows } = await pool.query<Membership>(
        `select "organizationId" as "orgId", id as "memberId", "userId", role from identity.member
         where "organizationId" = $1::uuid and "userId" = $2::uuid`,
        [orgId, userId],
      );
      return rows[0] ?? null;
    },
    async memberships(userId) {
      const { rows } = await pool.query<Membership & { orgName: string }>(
        `select m."organizationId" as "orgId", m.id as "memberId", m."userId", m.role, o.name as "orgName"
         from identity.member m join identity.organization o on o.id = m."organizationId"
         where m."userId" = $1::uuid order by o.name, o.id`,
        [userId],
      );
      return rows;
    },
    async members(orgId) {
      const { rows } = await pool.query<Member>(
        `select m."organizationId" as "orgId", m.id as "memberId", m."userId", m.role, u.name, u.email,
           (select max(s."updatedAt") from identity.session s where s."userId" = m."userId") as "lastActiveAt"
         from identity.member m join identity."user" u on u.id = m."userId"
         where m."organizationId" = $1::uuid order by u.name, u.id`,
        [orgId],
      );
      return rows;
    },
    async invitation(id) {
      const { rows } = await pool.query<Invitation>(`${INVITATION} where i.id = $1::uuid`, [id]);
      return rows[0] ?? null;
    },
    async pendingInvitations(orgId) {
      const { rows } = await pool.query<Invitation>(
        `${INVITATION} where i."organizationId" = $1::uuid and i.status = 'pending' order by i."createdAt" desc, i.id`,
        [orgId],
      );
      return rows;
    },
    async acceptedInvitations(email) {
      const { rows } = await pool.query<Invitation>(
        `${INVITATION} where lower(i.email) = lower($1) and i.status = 'accepted' order by i."createdAt", i.id`,
        [email],
      );
      return rows;
    },
    async setMemberRole(orgId, userId, role) {
      const { rowCount } = await pool.query(
        `update identity.member set role = $3 where "organizationId" = $1::uuid and "userId" = $2::uuid`,
        [orgId, userId, role],
      );
      return rowCount === 1;
    },
    async removeMember(orgId, userId, email) {
      const { rows } = await pool.query<{ removed: number }>(
        `with gone as (
           delete from identity.member where "organizationId" = $1::uuid and "userId" = $2::uuid returning id
         ), closed as (
           update identity.invitation set status = 'canceled'
           where "organizationId" = $1::uuid and lower(email) = lower($3) and status = 'accepted'
         )
         select count(*)::int as removed from gone`,
        [orgId, userId, email],
      );
      return (rows[0]?.removed ?? 0) > 0;
    },
    async undoAccept(orgId, userId, invitationId) {
      await pool.query(
        `with gone as (delete from identity.member where "organizationId" = $1::uuid and "userId" = $2::uuid)
         update identity.invitation set status = 'pending' where id = $3::uuid and status = 'accepted'`,
        [orgId, userId, invitationId],
      );
    },
    async markTwoStep(sessionId) {
      await pool.query(`update identity.session set "twoStepAt" = now() where id = $1::uuid`, [sessionId]);
    },
    async endOtherSessions(userId, keepSessionId) {
      await pool.query(`delete from identity.session where "userId" = $1::uuid and id <> $2::uuid`, [
        userId,
        keepSessionId,
      ]);
    },
    async useTotpCode(userId, code) {
      const { rowCount } = await pool.query(
        `insert into identity.totp_used as t (user_id, code, used_at) values ($1::uuid, $2, now())
         on conflict (user_id, code) do update set used_at = now() where t.used_at <= now() - interval '90 seconds'`,
        [userId, code.slice(0, 16)],
      );
      await pool.query(
        "delete from identity.totp_used where user_id = $1::uuid and used_at < now() - interval '1 hour'",
        [userId],
      );
      return rowCount === 1;
    },
    async releaseTotpCode(userId, code) {
      await pool.query("delete from identity.totp_used where user_id = $1::uuid and code = $2", [
        userId,
        code.slice(0, 16),
      ]);
    },
    async addMember(orgId, userId, role) {
      const { rowCount } = await pool.query(
        `insert into identity.member ("organizationId", "userId", role, "createdAt") values ($1::uuid, $2::uuid, $3, now())
         on conflict ("organizationId", "userId") do nothing`,
        [orgId, userId, role],
      );
      return rowCount === 1;
    },
  };
}
