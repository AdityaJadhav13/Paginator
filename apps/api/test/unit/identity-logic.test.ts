// The identity module's own logic, without a database: the 30-day absolute session limit (session.ts) and the per-email
// sign-in lock's keys (sign-in-guard.ts) and the rate-limit keys (rate-limit.ts), on fakes of Better Auth's session API
// and of our identity store. The lock's counting itself is SQL, tested on a database (test/db/identity.test.ts).
import { describe, expect, it } from "vitest";
import type { AuthEvent, IdentityStore } from "../../src/db/identity.ts";
import type { AuthEvents } from "../../src/modules/identity/events.ts";
import { ABSOLUTE_MS, type SessionApi, sessionResolver } from "../../src/modules/identity/session.ts";
import { storedKey } from "../../src/modules/identity/rate-limit.ts";
import { LOCK_AFTER, WINDOW_MS, emailKey, signInGuard } from "../../src/modules/identity/sign-in-guard.ts";

const COOKIE = new Headers({ cookie: "__Secure-pgn.session_token=t0k3n.signature" });
const NOW = Date.parse("2026-10-21T12:00:00Z");

function fakeApi(createdAt: Date) {
  const revoked: string[] = [];
  const api: SessionApi = {
    getSession: async () => ({
      headers: new Headers([["set-cookie", "__Secure-pgn.session_token=refreshed; Path=/"]]),
      response: {
        session: { id: "s1", token: "t0k3n", createdAt, userId: "u1" },
        user: { id: "u1", name: "Reporter A (fictional)", email: "reporter.a@example.test", emailVerified: true },
      },
    }),
    revokeSession: async ({ body }) => void revoked.push(body.token),
  };
  return { api, revoked };
}

function fakeEvents() {
  const recorded: AuthEvent[] = [];
  const events: AuthEvents = { record: async (event) => void recorded.push(event), signedIn: async () => undefined };
  return { events, recorded };
}

describe("sessionResolver", () => {
  it("gives the person, and the cookie Better Auth refreshed, for a session younger than 30 days", async () => {
    const { api } = fakeApi(new Date(NOW - ABSOLUTE_MS + 60_000));
    const found = await sessionResolver(api, fakeEvents().events, () => NOW).actor(COOKIE);
    expect(found).toEqual({
      actor: {
        userId: "u1",
        sessionId: "s1",
        name: "Reporter A (fictional)",
        email: "reporter.a@example.test",
        emailVerified: true,
        twoFactorEnabled: false,
        twoStep: false,
        locale: "en",
        uiDigits: "latin",
        signedInAt: new Date(NOW - ABSOLUTE_MS + 60_000),
      },
      setCookie: ["__Secure-pgn.session_token=refreshed; Path=/"],
    });
  });

  it("ends a session older than 30 days, records it, and treats the request as signed out", async () => {
    const { api, revoked } = fakeApi(new Date(NOW - ABSOLUTE_MS - 1));
    const { events, recorded } = fakeEvents();
    expect(await sessionResolver(api, events, () => NOW).actor(COOKIE)).toBeNull();
    expect(revoked).toEqual(["t0k3n"]);
    expect(recorded).toEqual([{ userId: "u1", kind: "session_expired", sessionId: "s1", ip: null, userAgent: null }]);
  });

  it("asks Better Auth whatever the cookie header looks like: a name followed by a space is still checked", async () => {
    const { api, revoked } = fakeApi(new Date(NOW - ABSOLUTE_MS - 1));
    const spaced = new Headers({ cookie: "__Secure-pgn.session_token =t0k3n.signature" });
    expect(await sessionResolver(api, fakeEvents().events, () => NOW).actor(spaced)).toBeNull();
    expect(revoked).toEqual(["t0k3n"]);
  });

  it("records the address and browser the request came with when it ends a session", async () => {
    const { api } = fakeApi(new Date(NOW - ABSOLUTE_MS - 1));
    const { events, recorded } = fakeEvents();
    const headers = new Headers({ cookie: "x=1", "x-pgn-client-ip": "198.51.100.14", "user-agent": "Fictional/1.0" });
    await sessionResolver(api, events, () => NOW).endIfTooOld(headers);
    expect(recorded).toEqual([
      { userId: "u1", kind: "session_expired", sessionId: "s1", ip: "198.51.100.14", userAgent: "Fictional/1.0" },
    ]);
  });
});

const unused = () => Promise.reject(new Error("not used by the guard"));

function fakeStore() {
  const calls: unknown[][] = [];
  const store: IdentityStore = {
    recordEvent: async () => undefined,
    signInHistory: async () => ({ before: false, sameBrowser: false }),
    reserveAttempt: async (...args) => (calls.push(["reserveAttempt", ...args]), true),
    returnAttempt: async (...args) => void calls.push(["returnAttempt", ...args]),
    countWrongPassword: async (...args) => (calls.push(["countWrongPassword", ...args]), false),
    clearAttempts: async (...args) => void calls.push(["clearAttempts", ...args]),
    consumeRateLimit: async () => ({ allowed: true, retryAfter: null }),
    pruneRateLimits: async () => undefined,
    invitationIsFor: unused,
    membership: unused,
    memberships: unused,
    memberRoles: unused,
    languages: unused,
    sessionNow: unused,
    members: unused,
    invitation: unused,
    pendingInvitations: unused,
    acceptedInvitations: unused,
    addMember: unused,
    setMemberRole: unused,
    removeMember: unused,
    undoAccept: unused,
    markTwoStep: unused,
    endOtherSessions: unused,
    useTotpCode: unused,
    releaseTotpCode: unused,
  };
  return { store, calls };
}

describe("signInGuard", () => {
  it(`reserves, locks at ${LOCK_AFTER} in ${WINDOW_MS / 60_000} minutes, hands back and clears under one key per email`, async () => {
    const { store, calls } = fakeStore();
    const guard = signInGuard(store, "test-only-sign-in-secret-0123456789abcdef");
    await guard.reserve("Reporter.A@Example.test ");
    await guard.wrongPassword("reporter.a@example.test");
    await guard.notCounted("REPORTER.A@EXAMPLE.TEST");
    await guard.succeeded(" reporter.a@example.test");
    const key = emailKey("test-only-sign-in-secret-0123456789abcdef", "reporter.a@example.test");
    expect(calls).toEqual([
      ["reserveAttempt", key, LOCK_AFTER, WINDOW_MS],
      ["countWrongPassword", key, LOCK_AFTER, WINDOW_MS],
      ["returnAttempt", key],
      ["clearAttempts", key],
    ]);
    expect(key).not.toContain("reporter"); // the key is an HMAC, not the email
    expect(emailKey("test-only-sign-in-secret-0123456789abcdef", "reporter.b@example.test")).not.toBe(key);
    expect(emailKey("another-test-only-secret-0123456789abcdefgh", "reporter.a@example.test")).not.toBe(key);
  });
});

describe("the rate-limit key", () => {
  it.each([
    ["198.51.100.7|/reset-password/AbC123xYz789AbC123xYz789", "198.51.100.7|/reset-password/:param"],
    ["198.51.100.7|/reset-password/abcdefghijklmnop", "198.51.100.7|/reset-password/:param"],
    ["198.51.100.7|/callback/google", "198.51.100.7|/callback/:param"],
    ["2001:db8::1|/sign-in/email", "2001:db8::1|/sign-in/email"],
    ["198.51.100.7|/request-password-reset", "198.51.100.7|/request-password-reset"],
    ["198.51.100.7|/x/Secret123/y", "198.51.100.7|/x/:param/y"],
    ["no-trusted-ip|/get-session", "no-trusted-ip|/get-session"],
  ])("stores %s as %s", (key, stored) => {
    expect(storedKey(key)).toBe(stored);
  });
});
