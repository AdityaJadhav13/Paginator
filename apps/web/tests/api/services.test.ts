/**
 * The real session and account services, over a recording fetch: the paths, bodies and headers Better Auth 1.7 and
 * the plan's invitation endpoints expect (plan §4.1, §4.3, §5.2), and what each answer becomes.
 */
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiSessionService } from "../../src/api/session-service.ts";
import { INVITATION_HEADER, createApiAccountService } from "../../src/api/account-service.ts";
import { createApiEnvironment } from "../../src/api/environment.ts";
import { fakeFetch, json, type RecordedCall } from "./fake-fetch.ts";

const SESSION = {
  session: { id: "s-1", token: "SECRET", userId: "u-1", expiresAt: "2026-10-22T12:00:00.000Z" },
  user: { id: "u-1", name: "Asha Patil", email: "asha@example.test", emailVerified: true },
};
const INVITATION_ID = "6f1c2e3a-4b5d-4e6f-8a7b-9c0d1e2f3a4b";

function services(route: (call: RecordedCall) => Response) {
  const { fetch, calls } = fakeFetch(route);
  const client = createApiClient({ fetch });
  return { session: createApiSessionService(client), account: createApiAccountService(client), calls };
}

describe("The real session service", () => {
  it("reads the session from get-session, signed out on null", async () => {
    const answers = [json(200, SESSION), json(200, null)];
    const { session, calls } = services(() => answers.shift()!);
    expect(await session.getSession()).toEqual({
      ok: true,
      value: { status: "signed-in", session: { user: { id: "u-1", name: "Asha Patil", email: "asha@example.test", emailVerified: true } } },
    });
    expect(await session.getSession()).toEqual({ ok: true, value: { status: "signed-out" } });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/auth/get-session",
      "GET /api/auth/get-session",
    ]);
  });

  it("signs in with sign-in/email, then reads the session the browser now holds", async () => {
    const answers = [json(200, { redirect: false, token: "SECRET", user: SESSION.user }), json(200, SESSION)];
    const { session, calls } = services(() => answers.shift()!);
    const result = await session.signIn({ email: "asha@example.test", password: "a long password", rememberMe: false });
    expect(result).toMatchObject({ ok: true, value: { status: "signed-in", session: { user: { id: "u-1" } } } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      body: { email: "asha@example.test", password: "a long password", rememberMe: false },
    });
    expect(calls[1]).toMatchObject({ method: "GET", url: "/api/auth/get-session" });
  });

  it("says so when the browser did not keep the session cookie", async () => {
    const answers = [json(200, { redirect: false, token: "SECRET", user: SESSION.user }), json(200, null)];
    const { session } = services(() => answers.shift()!);
    expect(await session.signIn({ email: "asha@example.test", password: "a long password", rememberMe: true })).toEqual({
      ok: false,
      error: { kind: "answer", status: 200, code: "cookie_refused", message: "" },
    });
  });

  it("passes a refused sign-in on unchanged, without reading the session", async () => {
    const { session, calls } = services(() => json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }));
    expect(await session.signIn({ email: "x@example.test", password: "wrong", rememberMe: true })).toMatchObject({
      ok: false,
      error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    expect(calls).toHaveLength(1);
  });

  it("signs out with sign-out", async () => {
    const { session, calls } = services(() => json(200, { success: true }));
    expect(await session.signOut()).toEqual({ ok: true, value: { status: "signed-out" } });
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/auth/sign-out", body: {} });
    expect(calls[0]!.headers.get("X-Pageinator")).toBe("1");
  });

  it("refuses a get-session answer it cannot read", async () => {
    const { session } = services(() => json(200, { user: "nobody" }));
    expect(await session.getSession()).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
  });
});

describe("The real account service", () => {
  it("asks for a reset link that comes back to /reset-password", async () => {
    const { account, calls } = services(() => json(200, { status: true, message: "If this email exists…" }));
    expect(await account.requestPasswordReset({ email: "asha@example.test" })).toEqual({ ok: true, value: undefined });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      body: { email: "asha@example.test", redirectTo: "/reset-password" },
    });
  });

  it("sets the new password with the emailed token", async () => {
    const answers = [json(200, { status: true }), json(400, { code: "INVALID_TOKEN", message: "Invalid token" })];
    const { account, calls } = services(() => answers.shift()!);
    expect(await account.resetPassword({ token: "t-1", newPassword: "a long password" })).toEqual({ ok: true, value: undefined });
    expect(calls[0]).toMatchObject({ url: "/api/auth/reset-password", body: { newPassword: "a long password", token: "t-1" } });
    expect(await account.resetPassword({ token: "t-1", newPassword: "a long password" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_TOKEN" },
    });
  });

  it("asks for a confirmation link that comes back to the given path", async () => {
    const { account, calls } = services(() => json(200, { status: true }));
    await account.sendVerificationEmail({ email: "asha@example.test", returnPath: "/verify?confirmed=1" });
    expect(calls[0]).toMatchObject({
      url: "/api/auth/send-verification-email",
      body: { email: "asha@example.test", callbackURL: "/verify?confirmed=1" },
    });
  });

  it("reads an invitation, and passes a 404 on", async () => {
    const answers = [
      json(200, {
        organization: { name: "The Sahyadri Daily" },
        inviter: { name: "Ravi Kulkarni" },
        roles: ["page_designer"],
        expiresAt: "2026-10-28T12:00:00.000Z",
        state: "pending",
      }),
      json(404, { error: { code: "not_found", message: "There is nothing here, or you do not have access to it.", requestId: "r" } }),
      json(200, { organization: "?" }),
    ];
    const { account, calls } = services(() => answers.shift()!);
    expect(await account.getInvitation({ invitationId: INVITATION_ID })).toMatchObject({
      ok: true,
      value: { organizationName: "The Sahyadri Daily", inviterName: "Ravi Kulkarni", state: "pending" },
    });
    expect(calls[0]).toMatchObject({ method: "GET", url: `/api/v1/invitations/${INVITATION_ID}` });
    expect(await account.getInvitation({ invitationId: INVITATION_ID })).toMatchObject({ ok: false, error: { status: 404 } });
    expect(await account.getInvitation({ invitationId: INVITATION_ID })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
  });

  it("escapes the invitation id in the path", async () => {
    const { account, calls } = services(() => json(404, {}));
    await account.getInvitation({ invitationId: "../me" });
    expect(calls[0]!.url).toBe("/api/v1/invitations/..%2Fme");
  });

  it("signs up with the invitation id in its header, coming back to the given path", async () => {
    const { account, calls } = services(() => json(200, { token: null, user: { id: "x" } }));
    await account.signUp({
      invitationId: INVITATION_ID,
      name: "Asha Patil",
      email: "asha@example.test",
      password: "a long password",
      returnPath: `/verify?confirmed=1&invitation=${INVITATION_ID}`,
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      body: {
        name: "Asha Patil",
        email: "asha@example.test",
        password: "a long password",
        callbackURL: `/verify?confirmed=1&invitation=${INVITATION_ID}`,
      },
    });
    expect(calls[0]!.headers.get(INVITATION_HEADER)).toBe(INVITATION_ID);
  });

  it("joins with an Idempotency-Key", async () => {
    const { account, calls } = services(() => json(200, { orgId: "o-1", publications: [] }));
    expect(await account.acceptInvitation({ invitationId: INVITATION_ID, idempotencyKey: "key-1" })).toEqual({ ok: true, value: undefined });
    expect(calls[0]).toMatchObject({ method: "POST", url: `/api/v1/invitations/${INVITATION_ID}/accept` });
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("key-1");
    expect(calls[0]!.headers.get("X-Pageinator")).toBe("1");
  });
});

describe("The app's real environment", () => {
  it("tells its listeners of a 401 signed_out, until they unsubscribe", async () => {
    const { fetch } = fakeFetch(() => json(401, { error: { code: "signed_out", message: "Signed out.", requestId: "r" } }));
    const environment = createApiEnvironment({ fetch });
    const listener = vi.fn();
    const unsubscribe = environment.onSignedOut!(listener);
    await environment.account.acceptInvitation({ invitationId: INVITATION_ID, idempotencyKey: "k" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await environment.account.acceptInvitation({ invitationId: INVITATION_ID, idempotencyKey: "k" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("has no workspace access source yet, and counts session changes", async () => {
    const { fetch } = fakeFetch(() => json(200, null));
    const environment = createApiEnvironment({ fetch });
    expect(environment.access).toBeUndefined();
    expect(await environment.workspace.listOrganizations()).toEqual({ ok: true, value: [] });
    const before = environment.getSessionMutationGeneration();
    await environment.session.signOut();
    environment.invalidatePendingSessionMutations();
    expect(environment.getSessionMutationGeneration()).toBe(before + 2);
  });
});
