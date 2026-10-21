// Better Auth 1.7.8 (docs/product/10-l2-newsroom-plan.md §4.1–4.6): email and password only; sign-up closed to the
// public until invitations open it (PR 10); no session before the email is verified; argon2id passwords; sessions,
// rate limits and verification tokens (hashed) in the database; every sign-in recorded. routes.ts mounts its routes.
// The organization and two-step plugins arrive with PR 9 and PR 11.
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Config } from "../../config.ts";
import { type AuthEventKind, identityDatabase } from "../../db/identity.ts";
import type { Database } from "../../db/pools.ts";
import { type Mailer, PLAIN_ADDRESS, RecipientError } from "../notifications/mailer.ts";
import { resetEmail, verificationEmail } from "./emails.ts";
import { authEvents } from "./events.ts";
import { CLIENT_IP_HEADER } from "./headers.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { rateLimitStorage } from "./rate-limit.ts";
import { signInGuard } from "./sign-in-guard.ts";

/** Better Auth's own endpoints we do not offer: no social or linked accounts, no email change or account deletion
 * (the erasure process comes later), profile changes go through our own /me (PR 9), and no password check outside
 * sign-in (/verify-password would let any session holder test passwords with no per-email lock). Social sign-in's
 * callback has a path parameter, which disabledPaths cannot name: routes.ts refuses it. */
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
];

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
      sendVerificationEmail: async ({ user, url }: { user: { name: string; email: string }; url: string }) => {
        send(mailer, log, { ...verificationEmail({ name: user.name, url, origin }), to: user.email });
      },
      // called only when an email really becomes verified: a forged link, or one opened again, records nothing
      afterEmailVerification: async (user: { id: string }, request?: Request) => {
        await events.record({ userId: user.id, kind: "email_verified", ...client(request?.headers) });
      },
    },
    verification: { storeIdentifier: "hashed" }, // a database read cannot reveal a usable reset token
    user: {
      // Every new account passes here, whatever the way in. Over HTTP, sign-up is closed until invitations open it
      // (PR 10); a call from the server itself (the first owner's bootstrap, the tests) may create one. An address
      // the mailer would refuse is refused here, with the same answer.
      validateUserInfo: async (
        { user, source }: { user: { email?: unknown }; source: { action: string } },
        context: { request?: Request | undefined },
      ) => {
        if (source.action !== "create-user") return;
        if (context.request !== undefined) return { error: "SIGN_UP_BY_INVITATION_ONLY" };
        if (typeof user.email !== "string" || !PLAIN_ADDRESS.test(user.email)) return { error: "UNSUPPORTED_EMAIL" };
      },
    },
    session: { expiresIn: IDLE_MS / 1000, updateAge: 3600, cookieCache: { enabled: false } }, // 12 h, sliding
    rateLimit: {
      enabled: true,
      storage: "database", // the table Better Auth's schema makes; customStorage writes it (rate-limit.ts)
      customStorage: rateLimitStorage(database.identity),
      customRules: {
        "/sign-in/email": { window: 300, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/send-verification-email": { window: 3600, max: 3 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // changing the password always ends the other sessions, whatever the client asks
        if (ctx.path === "/change-password" && ctx.body && typeof ctx.body === "object") {
          ctx.body.revokeOtherSessions = true;
        }
        // each sign-in attempt is reserved before its password is checked (sign-in-guard.ts)
        if (
          ctx.path === "/sign-in/email" &&
          typeof ctx.body?.email === "string" &&
          !(await guard.reserve(ctx.body.email))
        ) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many tries. Wait a few minutes and try again." });
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
          after: async (session, context) => {
            // a password change replaces the caller's session with a new one: not a sign-in
            if (context?.path === "/change-password") return;
            const user = await context?.context.internalAdapter.findUserById(session.userId);
            if (!user) return;
            await events.signedIn({
              userId: session.userId,
              sessionId: session.id,
              ip: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
              name: user.name,
              email: user.email,
              at: session.createdAt,
            });
          },
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
  } satisfies BetterAuthOptions;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth(authOptions(deps));
}
export type Auth = ReturnType<typeof createAuth>;
