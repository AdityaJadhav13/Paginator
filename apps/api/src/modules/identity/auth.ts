// Better Auth 1.7.8 (docs/product/10-l2-newsroom-plan.md §4.1–4.6): email and password only; sign-up over HTTP only by
// invitation; no session before the email is verified; argon2id passwords; sessions, rate limits and verification
// tokens (hashed) in the database; every sign-in recorded. Two plugins: organization (organisations, members and
// invitations, used only through our /api/v1 endpoints: its HTTP routes are all off) and twoFactor (TOTP, backup
// codes, trusted devices). routes.ts mounts the routes.
import { INVITATION_HEADER as CONTRACT_INVITATION_HEADER } from "@pageinator/contracts";
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization, twoFactor } from "better-auth/plugins";
import type { Config } from "../../config.ts";
import { type AuthEventKind, identityDatabase } from "../../db/identity.ts";
import type { Database } from "../../db/pools.ts";
import { type Mailer, PLAIN_ADDRESS, RecipientError } from "../notifications/mailer.ts";
import { resetEmail, verificationEmail } from "./emails.ts";
import { authEvents } from "./events.ts";
import { CLIENT_IP_HEADER } from "./headers.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { rateLimitStorage } from "./rate-limit.ts";
import { emailKey, signInGuard, WINDOW_MS as SIGN_IN_WINDOW_MS } from "./sign-in-guard.ts";

/** Sign-ins one client address may try in 5 minutes. */
export const SIGN_INS_PER_ADDRESS = 100;
/** The callback of the first Owner's account, made on the server (people/bootstrap.ts): its sign-up sends no
 * confirmation email, as the welcome's link confirms the address (onPasswordReset). Over HTTP it means nothing. */
export const WELCOMED = "/reset-password?welcome=1";
/** Confirmation links one email address may be sent in an hour, from all addresses together. */
export const VERIFICATION_EMAILS_PER_EMAIL = 3;

/** The header that carries an invitation's id with a sign-up (plan §4.3). */
export const INVITATION_HEADER = CONTRACT_INVITATION_HEADER.toLowerCase(); // as Fetch headers read it

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The organization plugin's settings. Organisations, members and invitations change only through our /api/v1
 * endpoints, which check our permissions and write the audit log, and call Better Auth from the server. */
function organizations() {
  return organization({
    allowUserToCreateOrganization: false, // only scripts/bootstrap-org.ts, from the server
    requireEmailVerificationOnInvitation: true, // CVE-2026-53514's second condition
    invitationExpiresIn: 7 * 24 * 3600,
    cancelPendingInvitationsOnReInvite: true,
    organizationHooks: {
      // our endpoints invite as admin or member only; anything else is refused here too
      beforeCreateInvitation: async ({ invitation }: { invitation: { role: string } }) => {
        if (invitation.role !== "admin" && invitation.role !== "member") {
          throw new APIError("FORBIDDEN", { message: "An invitation is for an admin or a member." });
        }
      },
    },
  });
}

/** Better Auth's own endpoints we do not offer: no social or linked accounts, no email change or account deletion
 * (the erasure process comes later), profile changes go through our own /me, no password check outside sign-in
 * (/verify-password would let any session holder test passwords with no per-email lock), no two-step codes by email
 * (only an authenticator app and backup codes), and none of the organization plugin's routes. Social sign-in's
 * callback has a path parameter, which disabledPaths cannot name: routes.ts refuses it, and every
 * /api/auth/organization/* path besides. */
export const ORGANIZATION_PATHS: readonly string[] = Object.values(
  organizations().endpoints as Record<string, { path: string }>,
)
  .map((endpoint) => endpoint.path)
  .filter((path) => path?.startsWith("/organization/")); // server-only endpoints have no path

export const DISABLED_PATHS = [
  "/sign-in/social",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/refresh-token",
  "/get-access-token",
  "/change-email",
  "/update-user",
  "/delete-user",
  "/delete-user/callback",
  "/verify-password",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  ...ORGANIZATION_PATHS,
];

/** Where a person proves who they are and gets a session: a sign-in. */
const SIGN_IN_PATHS = new Set([
  "/sign-in/email",
  "/verify-email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);
const TWO_STEP_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

/** The event recorded for each session an HTTP call of these endpoints deleted (Better Auth deletes only the
 * caller's own sessions, so a token that is not theirs records nothing). */
const SESSION_ENDED: Partial<Record<string, AuthEventKind>> = {
  "/sign-out": "sign_out",
  "/revoke-session": "session_revoked",
  "/revoke-sessions": "session_revoked",
  "/revoke-other-sessions": "session_revoked",
};

/** The longest a session lives without being used (Better Auth's expiresIn; updateAge slides it on). */
export const IDLE_MS = 12 * 3600_000;

/** The client's address (set by headers.ts from request.ip) and browser, as Better Auth's headers carry them. */
function client(headers: Headers | undefined | null) {
  return { ip: headers?.get(CLIENT_IP_HEADER) ?? null, userAgent: headers?.get("user-agent") ?? null };
}

/**
 * Sign-ins and two-step, as a plugin listed after twoFactor, so that its after hook runs after twoFactor's: by then a
 * sign-in that still needs its second step has no session (twoFactor deleted it).
 * - A sign-in (identity.auth_event, and the new-browser email) is recorded only for a session the person really got.
 *   A session that replaces the caller's own (turning two-step on with a code, a password change, verifying an email
 *   while signed in) is not a sign-in.
 * - Two-step is recorded on the SESSION (session.twoStepAt): a session made by a code or a backup code, by a trusted
 *   device's sign-in, by the code that turns two-step on, or by a password change in a session that had it. The
 *   access check (src/modules/access) asks the session, not the person: a session made with the password only, before
 *   or after two-step was set up, never counts as two-step.
 * - Turning two-step on ends every other session of the person.
 * - A TOTP code is refused when it was used already within its 90-second window (RFC 6238 §5.2).
 */
function sessionEvents(events: ReturnType<typeof authEvents>, store: Database["identity"]): BetterAuthPlugin {
  return {
    id: "pgn-session-events",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (ctx) => {
            const code = typeof ctx.body?.code === "string" ? ctx.body.code : "";
            if (code === "") return;
            const userId = await twoStepUser(ctx);
            if (userId && !(await store.useTotpCode(userId, code))) {
              throw new APIError("UNAUTHORIZED", { message: "Invalid code", code: "INVALID_CODE" });
            }
          }),
        },
      ],
      after: [
        {
          // a wrong code is not "used": it counts towards twoFactor's lock instead
          matcher: (ctx) => ctx.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            const code = typeof ctx.body?.code === "string" ? ctx.body.code : "";
            if (!(returned instanceof APIError && returned.statusCode >= 400) || code === "") return;
            const userId = await twoStepUser(ctx);
            if (userId) await store.releaseTotpCode(userId, code);
          }),
        },
        {
          matcher: (ctx) => SIGN_IN_PATHS.has(ctx.path ?? "") || ctx.path === "/change-password",
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.request === undefined) return;
            const returned = ctx.context.returned;
            if (returned instanceof APIError && returned.statusCode >= 400) return;
            const made = ctx.context.newSession;
            if (!made) return;
            const before = ctx.context.session;
            const replaced = before !== null && before !== undefined;
            const twoStep =
              TWO_STEP_PATHS.has(ctx.path) ||
              (ctx.path === "/sign-in/email" && made.user.twoFactorEnabled === true) || // a trusted device
              (ctx.path === "/change-password" && Boolean(before?.session.twoStepAt));
            if (twoStep) await store.markTwoStep(made.session.id);
            if (ctx.path === "/two-factor/verify-totp" && replaced && before.session.id !== made.session.id) {
              await store.endOtherSessions(made.user.id, made.session.id); // two-step was just turned on
            }
            if (ctx.path === "/change-password") return;
            if (replaced && (TWO_STEP_PATHS.has(ctx.path) || before.session.id === made.session.id)) return;
            await events.signedIn({
              userId: made.user.id,
              sessionId: made.session.id,
              ip: made.session.ipAddress ?? null,
              userAgent: made.session.userAgent ?? null,
              name: made.user.name,
              email: made.user.email,
              at: made.session.createdAt,
            });
          }),
        },
      ],
    },
  };
}

/** Whose code a /two-factor/verify-totp request carries: the signed-in person (turning two-step on), or the person
 * of the pending sign-in its two_factor cookie names. */
async function twoStepUser(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]): Promise<string | null> {
  const signedIn = await getSessionFromCtx(ctx);
  if (signedIn) return signedIn.user.id;
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const pending = await ctx.context.internalAdapter.findVerificationValue(identifier);
  return pending?.value ?? null;
}

export type AuthLog = { warn(object: object, message: string): void; error(object: object, message: string): void };
export type AuthDeps = { config: Config; database: Database; mailer: Mailer; log: AuthLog };

function send(mailer: Mailer, log: AuthLog, mail: Parameters<Mailer["send"]>[0]): void {
  try {
    mailer.send(mail);
  } catch (error) {
    if (!(error instanceof RecipientError)) throw error;
    log.warn({ kind: mail.kind }, error.message);
  }
}

export function authOptions({ config, database, mailer, log }: AuthDeps) {
  const origin = config.publicOrigin;
  const events = authEvents(database.identity, mailer);
  const guard = signInGuard(database.identity, config.authSecret);
  return {
    appName: "Pageinator",
    baseURL: origin,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: config.allowedOrigins,
    database: identityDatabase(database.auth),
    telemetry: { enabled: false },
    // Better Auth logs email addresses at info level; only its warnings and errors reach our log, without their details
    logger: {
      level: "warn",
      log: (level: string, message: string) =>
        level === "error"
          ? log.error({ source: "better-auth" }, message)
          : log.warn({ source: "better-auth" }, message),
    },
    disabledPaths: DISABLED_PATHS,
    advanced: {
      database: { generateId: "uuid" }, // random UUIDs; an invitation's id is its link's secret (PR 10)
      useSecureCookies: true, // __Secure-pgn.session_token
      cookiePrefix: "pgn",
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true, // no session before the email is verified (CVE-2026-53514's first condition)
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      // a reset by emailed link has no session to say whose it is; Better Auth says it here
      onPasswordReset: async ({ user }: { user: { id: string } }, request?: Request) => {
        await events.record({ userId: user.id, kind: "password_reset", ...client(request?.headers) });
        // the link came by email, so opening it proves the address: the first Owner's welcome is their only email
        if (await database.identity.confirmEmail(user.id)) {
          await events.record({ userId: user.id, kind: "email_verified", ...client(request?.headers) });
        }
      },
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user, url }: { user: { name: string; email: string }; url: string }) => {
        send(mailer, log, { ...resetEmail({ name: user.name, url, origin }), to: user.email });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
      sendVerificationEmail: async (
        { user, url }: { user: { name: string; email: string }; url: string },
        request?: Request,
      ) => {
        const welcomed = new URL(url).searchParams.get("callbackURL") === WELCOMED;
        if (welcomed && request === undefined) return;
        send(mailer, log, { ...verificationEmail({ name: user.name, url, origin }), to: user.email });
      },
      // called only when an email really becomes verified: a forged link, or one opened again, records nothing
      afterEmailVerification: async (user: { id: string }, request?: Request) => {
        await events.record({ userId: user.id, kind: "email_verified", ...client(request?.headers) });
      },
    },
    verification: { storeIdentifier: "hashed" }, // a database read cannot reveal a usable reset token
    user: {
      // Every new account passes here, whatever the way in. Over HTTP, a sign-up needs the id of a pending, unexpired
      // invitation for exactly its email, in the X-Pageinator-Invitation header (plan §4.3): the id alone would let whoever
      // saw a link sign up with another address, and the email alone would let anyone who knows an invitee's address
      // take the account first. A call from the server itself (the first owner's bootstrap, the tests) may create
      // one. An address the mailer would refuse is refused too. Every refusal gets the same answer as a sign-up.
      validateUserInfo: async (
        { user, source }: { user: { email?: unknown; name?: unknown }; source: { action: string } },
        context: { request?: Request | undefined },
      ) => {
        if (source.action !== "create-user") return;
        if (typeof user.email !== "string" || !PLAIN_ADDRESS.test(user.email)) return { error: "UNSUPPORTED_EMAIL" };
        // the name every directory shows (app.person.display_name: 1 to 200 characters)
        const name = typeof user.name === "string" ? [...user.name.trim()].length : 0;
        if (name < 1 || name > 200) return { error: "UNSUPPORTED_NAME" };
        if (context.request === undefined) return;
        const invitation = context.request.headers.get(INVITATION_HEADER) ?? "";
        if (!UUID.test(invitation) || !(await database.identity.invitationIsFor(invitation, user.email))) {
          return { error: "SIGN_UP_BY_INVITATION_ONLY" };
        }
      },
      // set only through PATCH /me (src/modules/people), never by Better Auth's own routes
      additionalFields: {
        locale: { type: "string", required: false, defaultValue: "en", input: false },
        uiDigits: { type: "string", required: false, defaultValue: "latin", input: false },
      },
    },
    session: {
      expiresIn: IDLE_MS / 1000, // 12 h, sliding
      updateAge: 3600,
      cookieCache: { enabled: false },
      // when the session was made with two-step (sessionEvents); set by us only
      additionalFields: { twoStepAt: { type: "date", required: false, input: false } },
    },
    rateLimit: {
      enabled: true,
      storage: "database", // the table Better Auth's schema makes; customStorage writes it (rate-limit.ts)
      customStorage: rateLimitStorage(database.identity),
      customRules: {
        // per address: a newsroom of ~50 behind one NAT signs in at once; guessing is stopped per email (sign-in-guard.ts)
        "/sign-in/email": { window: 300, max: SIGN_INS_PER_ADDRESS },
        // a sign-up needs a pending invitation for exactly its email, so the per-address limit only has to leave room
        // for a newsroom of ~50 behind one NAT signing up on its first day, typos and retries included
        "/sign-up/email": { window: 3600, max: 100 },
        "/request-password-reset": { window: 3600, max: 3 },
        // a link goes only to an address that still needs one; the same newsroom asks again when a mail is slow
        "/send-verification-email": { window: 3600, max: 100 },
        // reading one's own session is no sign-in: every page load asks it, so it is never counted here
        "/get-session": false,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // changing the password always ends the other sessions, whatever the client asks
        if (ctx.path === "/change-password" && ctx.body && typeof ctx.body === "object") {
          ctx.body.revokeOtherSessions = true;
        }
        // the per-address limit leaves room for a newsroom, so each email gets its own few links an hour; beyond them
        // the same answer as a sent link, so the refusal says nothing about the address
        if (ctx.path === "/send-verification-email" && typeof ctx.body?.email === "string") {
          const key = `email:${emailKey(config.authSecret, `verify:${ctx.body.email}`)}|/send-verification-email`;
          const { allowed } = await database.identity.consumeRateLimit(key, VERIFICATION_EMAILS_PER_EMAIL, 3600_000);
          if (!allowed) return ctx.json({ status: true });
        }
        // each sign-in attempt is reserved before its password is checked (sign-in-guard.ts)
        if (
          ctx.path === "/sign-in/email" &&
          typeof ctx.body?.email === "string" &&
          !(await guard.reserve(ctx.body.email))
        ) {
          // the longest the lock can still run (sign-in-guard.ts), so the web says how long to wait
          throw new APIError(
            "TOO_MANY_REQUESTS",
            { message: `Too many tries. Wait ${SIGN_IN_WINDOW_MS / 60_000} minutes and try again.` },
            { "Retry-After": String(SIGN_IN_WINDOW_MS / 1000) },
          );
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        // a redirect is thrown as an APIError too (302, after verify-email): only a 4xx or 5xx is a failure
        const failed = returned instanceof APIError && returned.statusCode >= 400;
        // events come from HTTP calls only: a call from the server itself (session.ts ending an old session, the
        // tests) records its own
        const http = ctx.request !== undefined;
        const { ip, userAgent } = client(ctx.headers);
        if (ctx.path === "/sign-in/email" && typeof ctx.body?.email === "string") {
          const email: string = ctx.body.email;
          if (!failed) {
            await guard.succeeded(email);
            return;
          }
          if (!(returned instanceof APIError) || returned.status !== "UNAUTHORIZED") {
            await guard.notCounted(email); // not a wrong password: an unverified email, an invalid request
            return;
          }
          const locked = await guard.wrongPassword(email);
          if (!http) return;
          const known = await ctx.context.internalAdapter.findUserByEmail(email);
          const userId = known?.user.id ?? null;
          await events.record({ userId, kind: "sign_in_failed", ip, userAgent });
          if (locked) await events.record({ userId, kind: "sign_in_locked", ip, userAgent });
          return;
        }
        if (failed || !http) return;
        if (ctx.path === "/change-password") {
          const userId = ctx.context.session?.user.id ?? ctx.context.newSession?.user.id ?? null;
          await events.record({ userId, kind: "password_changed", ip, userAgent });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Better Auth gives a session not kept ("Keep me signed in" unticked) 24 hours, and never slides it on: no
          // session outlives the 12-hour idle limit at its start
          before: async (session) => ({
            data: { expiresAt: new Date(Math.min(session.expiresAt.getTime(), Date.now() + IDLE_MS)) },
          }),
          // sign-ins are recorded by signInEvents, which knows whether the session was a sign-in
        },
        delete: {
          // a sign-out or revocation is recorded for each session it really ended, with that session's id
          after: async (session, context) => {
            const kind = context?.request === undefined ? undefined : SESSION_ENDED[context.path ?? ""];
            if (!kind) return;
            await events.record({ userId: session.userId, kind, sessionId: session.id, ...client(context?.headers) });
          },
        },
      },
    },
    plugins: [
      organizations(),
      twoFactor({
        issuer: "Pageinator",
        trustDeviceMaxAge: 30 * 24 * 3600,
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
        // TOTP secrets and backup codes are stored encrypted with the sign-in secret (Better Auth's default)
      }),
      sessionEvents(events, database.identity),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth(authOptions(deps));
}
export type Auth = ReturnType<typeof createAuth>;
