/**
 * The real two-step, security, team and workspace services, over a recording fetch: the paths and bodies Better
 * Auth 1.7's twoFactor plugin and the API's people endpoints (plan §4.4–4.5, §5.2) take, and what each answer becomes.
 * Every answer the web reads is checked with the API's own schema (@pageinator/contracts). Fictional data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiSecurityService } from "../../src/api/security-service.ts";
import { createApiSessionService } from "../../src/api/session-service.ts";
import { createApiTeamService } from "../../src/api/team-service.ts";
import { WORKSPACE_STORAGE_KEY, createApiWorkspace } from "../../src/api/workspace.ts";
import { createApiEnvironment } from "../../src/api/environment.ts";
import { fakeFetch, json, type RecordedCall } from "./fake-fetch.ts";

const USER = { id: "u-1", name: "Asha Patil", email: "asha@example.test", emailVerified: true, twoFactorEnabled: true };
const SESSION = { session: { id: "s-here", token: "SECRET", userId: "u-1", expiresAt: "2026-10-22T12:00:00.000Z" }, user: USER };
const ORG = "0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const OTHER_ORG = "1c7d2e3f-4051-4b62-9c73-8d94ea5fb607";
const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const PUB_2 = "3e9f4051-6273-4d84-9e95-afb6c0d71829";
const MEMBER_ID = "4fa05162-7384-4e95-afa6-b0c7d1e8293a";
const INVITATION_ID = "5ab16273-8495-4fa6-b0b7-c1d8e2f93a4b";

function client(route: (call: RecordedCall) => Response) {
  const { fetch, calls } = fakeFetch(route);
  return { api: createApiClient({ fetch }), calls };
}

describe("Two-step sign-in", () => {
  it("answers two-step when the password was right and a code comes next, without reading a session", async () => {
    const { api, calls } = client(() => json(200, { twoFactorRedirect: true, twoFactorMethods: ["totp"] }));
    const result = await createApiSessionService(api).signIn({ email: USER.email, password: "a long password", rememberMe: false });
    expect(result).toEqual({ ok: true, value: { status: "two-step" } });
    expect(calls.map((call) => call.url)).toEqual(["/api/auth/sign-in/email"]);
  });

  it("sends the app's code to verify-totp and a backup code to verify-backup-code, then reads the session", async () => {
    const answers = [json(200, { token: "SECRET", user: USER }), json(200, SESSION), json(200, { token: "SECRET", user: USER }), json(200, SESSION)];
    const { api, calls } = client(() => answers.shift()!);
    const session = createApiSessionService(api);
    expect(await session.verifyTwoStep({ code: " 123456 ", kind: "totp", trustDevice: true })).toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { user: { id: "u-1", twoFactorEnabled: true } } },
    });
    await session.verifyTwoStep({ code: "FICTA-11111", kind: "backup", trustDevice: false });
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ["POST", "/api/auth/two-factor/verify-totp", { code: "123456", trustDevice: true }],
      ["GET", "/api/auth/get-session", undefined],
      ["POST", "/api/auth/two-factor/verify-backup-code", { code: "FICTA-11111", trustDevice: false }],
      ["GET", "/api/auth/get-session", undefined],
    ]);
  });

  it("gives Better Auth's code for a wrong code", async () => {
    const { api } = client(() => json(401, { code: "INVALID_CODE", message: "Invalid code" }));
    expect(await createApiSessionService(api).verifyTwoStep({ code: "000000", kind: "totp", trustDevice: false })).toMatchObject({
      ok: false,
      error: { kind: "answer", status: 401, code: "INVALID_CODE" },
    });
  });
});

describe("The real security service", () => {
  const URI = "otpauth://totp/Pageinator:asha%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Pageinator";

  it("starts two-step with the password, and reads the QR link and the backup codes", async () => {
    const { api, calls } = client(() => json(200, { totpURI: URI, backupCodes: ["FICTA-11111", "FICTB-22222"] }));
    expect(await createApiSecurityService(api).startTwoStep({ password: "a long password" })).toEqual({
      ok: true,
      value: { totpUri: URI, backupCodes: ["FICTA-11111", "FICTB-22222"] },
    });
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/auth/two-factor/enable", body: { password: "a long password" } });
    expect(calls[0]!.headers.get("X-Pageinator")).toBe("1");
  });

  it("refuses a link that is not an otpauth TOTP link, or an answer without codes", async () => {
    for (const body of [
      { totpURI: "https://example.test/", backupCodes: ["FICTA-11111"] },
      { totpURI: URI, backupCodes: [] },
      { totpURI: URI },
    ]) {
      const { api } = client(() => json(200, body));
      expect(await createApiSecurityService(api).startTwoStep({ password: "p" })).toMatchObject({
        ok: false,
        error: { code: "unexpected_answer" },
      });
    }
  });

  it("confirms with the app's first code, turns off and makes new codes with the password", async () => {
    const answers = [json(200, { token: "T", user: USER }), json(200, { status: true }), json(200, { status: true, backupCodes: ["FICTC-33333"] })];
    const { api, calls } = client(() => answers.shift()!);
    const security = createApiSecurityService(api);
    expect(await security.confirmTwoStep({ code: " 123456" })).toEqual({ ok: true, value: undefined });
    expect(await security.turnOffTwoStep({ password: "p" })).toEqual({ ok: true, value: undefined });
    expect(await security.newBackupCodes({ password: "p" })).toEqual({ ok: true, value: ["FICTC-33333"] });
    expect(calls.map((call) => [call.url, call.body])).toEqual([
      ["/api/auth/two-factor/verify-totp", { code: "123456" }],
      ["/api/auth/two-factor/disable", { password: "p" }],
      ["/api/auth/two-factor/generate-backup-codes", { password: "p" }],
    ]);
  });

  it("lists the sessions as devices, marks this browser's, and signs one or the others out", async () => {
    const sessions = [
      { id: "s-here", token: "tok-here", createdAt: "2026-10-20T04:00:00.000Z", updatedAt: "2026-10-22T04:00:00.000Z", userAgent: "Firefox/140.0 (X11; Linux x86_64)", ipAddress: "192.0.2.10", userId: "u-1", expiresAt: "2026-10-29T04:00:00.000Z" },
      { id: "s-phone", token: "tok-phone", createdAt: "2026-10-18T04:00:00.000Z", updatedAt: "2026-10-21T04:00:00.000Z", userAgent: "", ipAddress: null, userId: "u-1", expiresAt: "2026-10-25T04:00:00.000Z" },
    ];
    const { api, calls } = client((call) =>
      call.url === "/api/auth/list-sessions" ? json(200, sessions) : call.url === "/api/auth/get-session" ? json(200, SESSION) : json(200, { status: true }),
    );
    const security = createApiSecurityService(api);
    const listed = await security.listDevices();
    expect(listed).toEqual({
      ok: true,
      value: [
        { token: "tok-here", id: "s-here", userAgent: "Firefox/140.0 (X11; Linux x86_64)", ipAddress: "192.0.2.10", signedInAt: "2026-10-20T04:00:00.000Z", lastActiveAt: "2026-10-22T04:00:00.000Z", current: true },
        { token: "tok-phone", id: "s-phone", userAgent: null, ipAddress: null, signedInAt: "2026-10-18T04:00:00.000Z", lastActiveAt: "2026-10-21T04:00:00.000Z", current: false },
      ],
    });
    await security.signOutDevice({ token: "tok-phone" });
    await security.signOutOtherDevices();
    expect(calls.slice(2).map((call) => [call.url, call.body])).toEqual([
      ["/api/auth/revoke-session", { token: "tok-phone" }],
      ["/api/auth/revoke-other-sessions", {}],
    ]);
  });

  it("refuses a session list it cannot read", async () => {
    const { api } = client(() => json(200, [{ id: 1 }]));
    expect(await createApiSecurityService(api).listDevices()).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
  });
});

const MEMBER = {
  userId: MEMBER_ID,
  name: "Fictional Reporter",
  email: "reporter@sahyadri.example",
  orgRole: "member",
  publications: [{ publicationId: PUB, roles: ["editor"], grants: ["page_approve"] }],
  status: "active",
  lastActiveAt: null,
};
const INVITATION = {
  id: INVITATION_ID,
  email: "new.reporter@sahyadri.example",
  orgRole: "member",
  publications: [{ publicationId: PUB, roles: ["reporter"], grants: [] }],
  expiresAt: "2026-10-29T12:00:00.000Z",
  state: "pending",
};

describe("The real team service", () => {
  it("reads the members and the invitations with the API's own schemas", async () => {
    const { api, calls } = client((call) => json(200, { items: call.url.endsWith("/members") ? [MEMBER] : [INVITATION] }));
    const team = createApiTeamService(api);
    expect(await team.listMembers({ orgId: ORG })).toEqual({ ok: true, value: [MEMBER] });
    expect(await team.listInvitations({ orgId: ORG })).toEqual({ ok: true, value: [INVITATION] });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET /api/v1/orgs/${ORG}/members`,
      `GET /api/v1/orgs/${ORG}/invitations`,
    ]);
  });

  it("refuses a member it cannot read (an unknown role, a missing field)", async () => {
    for (const item of [{ ...MEMBER, orgRole: "boss" }, { ...MEMBER, email: undefined }, { ...MEMBER, extra: 1 }]) {
      const { api } = client(() => json(200, { items: [item] }));
      expect(await createApiTeamService(api).listMembers({ orgId: ORG })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
    }
  });

  it("invites with an Idempotency-Key, and changes, removes, resends and cancels on the right paths", async () => {
    const { api, calls } = client((call) =>
      call.method === "DELETE" ? new Response(null, { status: 204 }) : call.method === "PATCH" ? json(200, MEMBER) : json(201, INVITATION),
    );
    const team = createApiTeamService(api);
    const invitation = { email: INVITATION.email, orgRole: "member" as const, publications: [{ publicationId: PUB, roles: ["reporter" as const], grants: [] }] };
    expect(await team.invite({ orgId: ORG, invitation, idempotencyKey: "key-1" })).toEqual({ ok: true, value: INVITATION });
    expect(calls[0]).toMatchObject({ method: "POST", url: `/api/v1/orgs/${ORG}/invitations`, body: invitation });
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("key-1");
    await team.updateMember({ orgId: ORG, userId: MEMBER_ID, patch: { orgRole: "admin" } });
    await team.removeMember({ orgId: ORG, userId: MEMBER_ID });
    await team.resendInvitation({ orgId: ORG, id: INVITATION_ID });
    await team.cancelInvitation({ orgId: ORG, id: INVITATION_ID });
    expect(calls.slice(1).map((call) => [call.method, call.url, call.body])).toEqual([
      ["PATCH", `/api/v1/orgs/${ORG}/members/${MEMBER_ID}`, { orgRole: "admin" }],
      ["DELETE", `/api/v1/orgs/${ORG}/members/${MEMBER_ID}`, undefined],
      ["POST", `/api/v1/orgs/${ORG}/invitations/${INVITATION_ID}/resend`, {}],
      ["DELETE", `/api/v1/orgs/${ORG}/invitations/${INVITATION_ID}`, undefined],
    ]);
  });

  it("gives the API's refusal as it is (two-step needed, not allowed, the field that is wrong)", async () => {
    for (const code of ["two_step_required", "not_allowed"]) {
      const refused = client(() => json(403, { error: { code, message: "Refused.", requestId: "r" } }));
      const team = createApiTeamService(refused.api);
      expect(await team.listMembers({ orgId: ORG })).toMatchObject({ ok: false, error: { kind: "answer", status: 403, code } });
      expect(await team.removeMember({ orgId: ORG, userId: MEMBER_ID })).toMatchObject({ ok: false, error: { status: 403, code } });
    }
    const { api } = client(() =>
      json(400, { error: { code: "invalid_request", message: "Invalid.", requestId: "r", details: [{ field: "body.email", message: "is already a member" }] } }),
    );
    expect(await createApiTeamService(api).invite({ orgId: ORG, invitation: { ...INVITATION, orgRole: "member" } as never, idempotencyKey: "k" })).toMatchObject({
      ok: false,
      error: { code: "invalid_request", details: [{ field: "body.email", message: "is already a member" }] },
    });
  });
});

const ME = {
  user: { id: "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b", name: "Asha Patil", email: "asha@example.test", emailVerified: true, twoFactorEnabled: false, locale: "en", uiDigits: "latin" },
  memberships: [
    {
      org: { id: ORG, name: "Fictional Daily Group" },
      orgRole: "admin",
      twoStep: { required: false, satisfied: false },
      publications: [
        { id: PUB, name: "Fictional Morning", roles: ["editor"], grants: [] },
        { id: PUB_2, name: "Fictional Evening", roles: [], grants: [] },
      ],
    },
    {
      org: { id: OTHER_ORG, name: "Fictional Coast Media" },
      orgRole: "member",
      twoStep: { required: true, satisfied: false },
      publications: [],
    },
  ],
};

describe("The workspace from /me", () => {
  afterEach(() => window.localStorage.clear());

  it("makes the first organisation and publication active, and lists the grants", async () => {
    const { api } = client(() => json(200, ME));
    const { access } = createApiWorkspace(api);
    expect(await access.getAccess({ userId: "ignored" })).toEqual({
      ok: true,
      value: {
        access: [
          { organizationId: ORG, publicationIds: [PUB, PUB_2] },
          { organizationId: OTHER_ORG, publicationIds: [] },
        ],
        activeOrganizationId: ORG,
        activePublicationId: PUB,
        organizations: ME.memberships,
      },
    });
  });

  it("remembers the choice in this browser for its person, and refuses one /me does not list", async () => {
    const { api } = client(() => json(200, ME));
    const { access } = createApiWorkspace(api);
    const userId = ME.user.id;
    await access.getAccess({ userId });
    expect(await access.selectPublication({ userId, organizationId: ORG, publicationId: PUB_2 })).toMatchObject({ ok: true, value: { activePublicationId: PUB_2 } });
    expect(JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)!)).toEqual({ userId, organizationId: ORG, publicationId: PUB_2 });
    expect(await createApiWorkspace(api).access.getAccess({ userId })).toMatchObject({ ok: true, value: { activePublicationId: PUB_2 } });
    expect(await access.selectOrganization({ userId, organizationId: "not-mine" })).toMatchObject({ ok: false, error: { status: 404, code: "not_found" } });
    // a choice for someone else than the /me last read is refused too
    expect(await access.selectOrganization({ userId: "someone-else", organizationId: ORG })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await access.selectOrganization({ userId, organizationId: OTHER_ORG })).toMatchObject({
      ok: true,
      value: { activeOrganizationId: OTHER_ORG, activePublicationId: "" },
    });
  });

  it("does not steer the next person on a shared browser to the previous person's paper", async () => {
    const OTHER_USER = { ...ME.user, id: "6bc27384-95a6-4b07-8c18-d2e9f3a04b5c", email: "second@example.test" };
    let person: "first" | "second" = "first";
    const { fetch } = fakeFetch((call) =>
      call.url === "/api/v1/me"
        ? json(200, person === "first" ? ME : { user: OTHER_USER, memberships: ME.memberships })
        : json(200, { success: true }),
    );
    const environment = createApiEnvironment({ fetch });
    // the first person chooses the second organisation, then signs out
    await environment.access!.getAccess({ userId: ME.user.id });
    await environment.access!.selectOrganization({ userId: ME.user.id, organizationId: OTHER_ORG });
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toContain(OTHER_ORG);
    await environment.session.signOut();
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    // the second person, signed in on the same browser, starts from their own /me
    person = "second";
    expect(await environment.access!.getAccess({ userId: OTHER_USER.id })).toMatchObject({ ok: true, value: { activeOrganizationId: ORG } });
  });

  it("ignores a choice another person left, even without a sign-out (the session expired)", async () => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ userId: "someone-before", organizationId: OTHER_ORG }));
    const { api } = client(() => json(200, ME));
    expect(await createApiWorkspace(api).access.getAccess({ userId: ME.user.id })).toMatchObject({ ok: true, value: { activeOrganizationId: ORG } });
  });

  it("forgets the cached /me when the API says the session ended", async () => {
    let signedIn = true;
    const { fetch, calls } = fakeFetch((call) =>
      call.url === "/api/v1/me" && !signedIn
        ? json(401, { error: { code: "signed_out", message: "Signed out.", requestId: "r" } })
        : json(200, ME),
    );
    const environment = createApiEnvironment({ fetch });
    await environment.access!.getAccess({ userId: ME.user.id });
    await environment.access!.selectOrganization({ userId: ME.user.id, organizationId: OTHER_ORG });
    signedIn = false;
    await environment.access!.getAccess({ userId: ME.user.id });
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    signedIn = true;
    const before = calls.length;
    expect(await environment.workspace.listOrganizations()).toMatchObject({ ok: true });
    expect(calls.length).toBe(before + 1); // read again, not served from the ended session's cache
  });

  it("refuses an answer that is not /me, and gives the API's problem as it is", async () => {
    const { api } = client(() => json(200, { user: ME.user }));
    expect(await createApiWorkspace(api).access.getAccess({ userId: "u" })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
    const offline = client(() => json(503, { error: { code: "server_error", message: "Down.", requestId: "r" } }));
    expect(await createApiWorkspace(offline.api).access.getAccess({ userId: "u" })).toMatchObject({ ok: false, error: { kind: "answer", status: 503 } });
  });

  it("serves the shell's organisations and publications from the same /me, with no edition yet", async () => {
    const { api, calls } = client(() => json(200, ME));
    const { workspace } = createApiWorkspace(api);
    expect(await workspace.listOrganizations()).toEqual({
      ok: true,
      value: [
        { id: ORG, name: "Fictional Daily Group" },
        { id: OTHER_ORG, name: "Fictional Coast Media" },
      ],
    });
    expect(await workspace.getPublication({ organizationId: ORG, publicationId: PUB })).toEqual({
      ok: true,
      value: { id: PUB, orgId: ORG, name: "Fictional Morning", locale: "", direction: "ltr" },
    });
    expect(await workspace.getPublication({ organizationId: OTHER_ORG, publicationId: PUB })).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await workspace.getEdition({ organizationId: ORG, publicationId: PUB, editionId: "e" })).toMatchObject({ ok: false, error: { resource: "edition" } });
    expect(calls).toHaveLength(1);
  });
});
