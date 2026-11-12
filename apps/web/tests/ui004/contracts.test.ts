/**
 * The session and account contracts, rewritten against the real API (doc 15 §11: "REWRITE against the real API schemas
 * when they exist"). The shapes the web reads are Better Auth's `get-session` answer (its OpenAPI: `{session, user}`
 * or null) and the API's error envelope (`ErrorEnvelope` in @pageinator/contracts), checked here with the real
 * schema, not a copy of it.
 */
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ErrorEnvelope } from "@pageinator/contracts";
import type {
  AccountService,
  ApiProblem,
  InvitationDto,
  SecurityService,
  SessionDto,
  SessionService,
  SessionSnapshot,
  SessionUserDto,
  SignInInput,
  TeamService,
  WorkspaceAccessDto,
  WorkspaceAccessService,
} from "../../src/services/index.ts";
import { problemFromAnswer } from "../../src/api/client.ts";
import { sessionFromAnswer } from "../../src/api/session-service.ts";
import { invitationFromAnswer } from "../../src/api/account-service.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Value extends true> = Value;

type UserContract = Assert<Equal<SessionUserDto, {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
}>>;
type SessionContract = Assert<Equal<SessionDto, { readonly user: SessionUserDto }>>;
type SnapshotContract = Assert<Equal<SessionSnapshot,
  | { readonly status: "signed-out" }
  | { readonly status: "two-step" }
  | { readonly status: "signed-in"; readonly session: SessionDto }
>>;
type SignInContract = Assert<Equal<SignInInput, {
  readonly email: string;
  readonly password: string;
  readonly rememberMe: boolean;
}>>;
type SessionMethods = Assert<Equal<keyof SessionService, "getSession" | "signIn" | "verifyTwoStep" | "signOut">>;
type SecurityMethods = Assert<Equal<keyof SecurityService,
  | "startTwoStep"
  | "confirmTwoStep"
  | "turnOffTwoStep"
  | "newBackupCodes"
  | "listDevices"
  | "signOutDevice"
  | "signOutOtherDevices"
>>;
type TeamMethods = Assert<Equal<keyof TeamService,
  | "listMembers"
  | "updateMember"
  | "removeMember"
  | "listInvitations"
  | "invite"
  | "resendInvitation"
  | "cancelInvitation"
>>;
type AccountMethods = Assert<Equal<keyof AccountService,
  | "requestPasswordReset"
  | "resetPassword"
  | "sendVerificationEmail"
  | "getInvitation"
  | "listMyInvitations"
  | "signUp"
  | "acceptInvitation"
>>;
type InvitationContract = Assert<Equal<InvitationDto, {
  readonly organizationName: string;
  readonly inviterName: string;
  readonly roles: readonly string[];
  readonly expiresAt: string;
  readonly state: "pending" | "accepted" | "expired" | "revoked";
}>>;
type AccessMethods = Assert<Equal<keyof WorkspaceAccessService, "getAccess" | "selectOrganization" | "selectPublication">>;
type AccessContract = Assert<Equal<keyof WorkspaceAccessDto, "access" | "activeOrganizationId" | "activePublicationId" | "organizations">>;

/** Better Auth 1.7's get-session answer, as its OpenAPI describes it (fictional values). */
const GET_SESSION_ANSWER = {
  session: {
    id: "4b1f0e2a-9c3d-4e5f-8a6b-7c8d9e0f1a2b",
    token: "SECRET-SESSION-TOKEN",
    userId: "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b",
    expiresAt: "2026-10-22T12:00:00.000Z",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ipAddress: "127.0.0.1",
    userAgent: "Fictional Browser",
  },
  user: {
    id: "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b",
    name: "Asha Patil",
    email: "asha@example.test",
    emailVerified: true,
    image: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
};

describe("The web's session and account contracts", () => {
  it("compile with the exact DTO fields, unions and methods", () => {
    const assertions: [
      UserContract, SessionContract, SnapshotContract, SignInContract, SessionMethods,
      AccountMethods, InvitationContract, AccessMethods, AccessContract, SecurityMethods, TeamMethods,
    ] = [true, true, true, true, true, true, true, true, true, true, true];
    expect(assertions.every(Boolean)).toBe(true);
  });

  it("keeps no token, password, secret or session id in the session DTO", () => {
    const modules = import.meta.glob("/src/services/session-dtos.ts", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;
    const code = (Object.values(modules)[0] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("SessionUserDto");
    expect(code).not.toMatch(/token|password|secret|cookie|sessionId/i);
  });
});

describe("Better Auth's get-session answer", () => {
  it("is signed out when the answer is null", () => {
    expect(sessionFromAnswer(null)).toEqual({ status: "signed-out" });
  });

  it("keeps only the person, and drops the session token", () => {
    const snapshot = sessionFromAnswer(GET_SESSION_ANSWER);
    expect(snapshot).toEqual({
      status: "signed-in",
      session: {
        user: {
          id: "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b",
          name: "Asha Patil",
          email: "asha@example.test",
          emailVerified: true,
          twoFactorEnabled: false,
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("SECRET-SESSION-TOKEN");
  });

  it("reads whether two-step is on from the twoFactor plugin's user field", () => {
    const snapshot = sessionFromAnswer({ ...GET_SESSION_ANSWER, user: { ...GET_SESSION_ANSWER.user, twoFactorEnabled: true } });
    expect(snapshot).toMatchObject({ status: "signed-in", session: { user: { twoFactorEnabled: true } } });
  });

  it("refuses an answer that is not a session", () => {
    for (const answer of [
      undefined,
      {},
      "<!doctype html>",
      { user: GET_SESSION_ANSWER.user },
      { session: GET_SESSION_ANSWER.session, user: { ...GET_SESSION_ANSWER.user, emailVerified: "yes" } },
      { session: GET_SESSION_ANSWER.session, user: { ...GET_SESSION_ANSWER.user, email: 7 } },
    ]) {
      expect(sessionFromAnswer(answer)).toBeUndefined();
    }
  });
});

describe("The API's error envelope (@pageinator/contracts)", () => {
  it("reads every error code the API answers with, as the schema allows it", () => {
    for (const code of ERROR_CODES) {
      const body = ErrorEnvelope.parse({
        error: { code, message: "A message.", requestId: "0b9a8c7d-1e2f-4a3b-9c4d-5e6f7a8b9c0d" },
      });
      const problem: ApiProblem = problemFromAnswer(400, body, new Headers());
      expect(problem).toEqual({
        kind: "answer",
        status: 400,
        code,
        message: "A message.",
        requestId: "0b9a8c7d-1e2f-4a3b-9c4d-5e6f7a8b9c0d",
      });
    }
  });

  it("keeps the field problems of invalid_request", () => {
    const body = ErrorEnvelope.parse({
      error: {
        code: "invalid_request",
        message: "Some fields are not right.",
        details: [{ field: "body.email", message: "must be an email address" }],
        requestId: "r-1",
      },
    });
    expect(problemFromAnswer(400, body, new Headers())).toMatchObject({
      code: "invalid_request",
      details: [{ field: "body.email", message: "must be an email address" }],
    });
  });
});

describe("The invitation answer (plan §5.2: GET /invitations/{id})", () => {
  const ANSWER = {
    organization: { name: "The Sahyadri Daily" },
    inviter: { name: "Ravi Kulkarni" },
    roles: ["member", "page_designer"],
    expiresAt: "2026-10-28T12:00:00.000Z",
    state: "pending",
  };

  it("reads the plan's shape", () => {
    expect(invitationFromAnswer(ANSWER)).toEqual({
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["member", "page_designer"],
      expiresAt: "2026-10-28T12:00:00.000Z",
      state: "pending",
    });
  });

  it("maps Better Auth's withdrawn statuses to one state, and refuses unknown ones", () => {
    for (const state of ["canceled", "cancelled", "rejected", "revoked"]) {
      expect(invitationFromAnswer({ ...ANSWER, state })?.state).toBe("revoked");
    }
    expect(invitationFromAnswer({ ...ANSWER, state: "maybe" })).toBeUndefined();
    expect(invitationFromAnswer({ ...ANSWER, expiresAt: "not a date" })).toBeUndefined();
    expect(invitationFromAnswer({ ...ANSWER, roles: [1] })).toBeUndefined();
  });
});
