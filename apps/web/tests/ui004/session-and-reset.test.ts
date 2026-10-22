/**
 * The session test double (src/mocks): the stand-in for the real session and account services in component tests.
 * It must answer as the API does (Better Auth's codes, generic answers), stay deterministic, and reset cleanly.
 */
import { describe, expect, it, vi } from "vitest";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";

const PUNE = { organizationId: "org-demo-sahyadri", publicationId: "pub-demo-pune-daily" };

describe("The session double's contract", () => {
  it("exposes exactly the real services' methods, each returning a promise", async () => {
    const { session, account, access, security, team } = createMockApplicationEnvironment();
    expect(Object.keys(session).sort()).toEqual(["getSession", "signIn", "signOut", "verifyTwoStep"]);
    expect(Object.keys(security).sort()).toEqual([
      "confirmTwoStep",
      "listDevices",
      "newBackupCodes",
      "signOutDevice",
      "signOutOtherDevices",
      "startTwoStep",
      "turnOffTwoStep",
    ]);
    expect(Object.keys(team).sort()).toEqual([
      "cancelInvitation",
      "invite",
      "listInvitations",
      "listMembers",
      "removeMember",
      "resendInvitation",
      "updateMember",
    ]);
    expect(Object.keys(account).sort()).toEqual([
      "acceptInvitation",
      "getInvitation",
      "requestPasswordReset",
      "resetPassword",
      "sendVerificationEmail",
      "signUp",
    ]);
    expect(Object.keys(access).sort()).toEqual(["getAccess", "selectOrganization", "selectPublication"]);
    await expect(session.getSession()).resolves.toMatchObject({ ok: true });
  });

  it("starts signed in as the fictional Sahyadri editor, with that person's placeholder workspace", async () => {
    const environment = createMockApplicationEnvironment();
    expect(await environment.session.getSession()).toEqual({
      ok: true,
      value: {
        status: "signed-in",
        session: {
          user: {
            id: "user-demo-sahyadri-editor",
            name: "Sahyadri Demo Editor",
            email: "editor@sahyadri.example",
            emailVerified: true,
            twoFactorEnabled: false,
          },
        },
      },
    });
    const access = await environment.access.getAccess({ userId: "user-demo-sahyadri-editor" });
    expect(access).toMatchObject({
      ok: true,
      value: {
        access: [
          { organizationId: "org-demo-sahyadri", publicationIds: ["pub-demo-pune-daily", "pub-demo-urdu-evening"] },
          { organizationId: "org-demo-konkan", publicationIds: ["pub-demo-ratnagiri-tide"] },
        ],
        activeOrganizationId: "org-demo-sahyadri",
        activePublicationId: "pub-demo-pune-daily",
      },
    });
    // the organisations as the API's /me gives them: names, organisation role, roles and grants per publication
    expect(access.ok && access.value?.organizations.map((org) => [org.org.name, org.orgRole, org.publications.map((p) => [p.name, p.roles, p.grants])])).toEqual([
      ["Sahyadri Media Cooperative", "admin", [["Pune Daily Ledger", ["editor"], ["page_approve"]], ["Deccan Evening Record", ["editor"], []]]],
      ["Konkan Coastal Press", "member", [["Ratnagiri Tide", ["viewer"], []]]],
    ]);
  });
});

describe("Signing in on the double", () => {
  it("signs in with a fictional account's email and password", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("signed-out");
    const { reviewer } = environment.sessionController.fixtures.accounts;
    const result = await environment.session.signIn({ email: reviewer.email, password: reviewer.password, rememberMe: false });
    expect(result).toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { user: { id: "user-demo-konkan-reviewer", name: "Konkan Demo Reviewer" } } },
    });
    expect(environment.sessionController.getPreset()).toBe("konkan-reviewer");
  });

  it("answers a wrong email address and a wrong password identically", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("signed-out");
    const { editor } = environment.sessionController.fixtures.accounts;
    const unknownEmail = await environment.session.signIn({ email: "nobody@sahyadri.example", password: editor.password, rememberMe: true });
    const wrongPassword = await environment.session.signIn({ email: editor.email, password: "not the password", rememberMe: true });
    expect(unknownEmail).toEqual(wrongPassword);
    expect(unknownEmail).toEqual({
      ok: false,
      error: { kind: "answer", status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });
    expect(await environment.session.getSession()).toEqual({ ok: true, value: { status: "signed-out" } });
  });

  it("refuses an unconfirmed address only after the right password", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("signed-out");
    const { unconfirmed } = environment.sessionController.fixtures.accounts;
    expect(await environment.session.signIn({ email: unconfirmed.email, password: unconfirmed.password, rememberMe: true }))
      .toMatchObject({ ok: false, error: { status: 403, code: "EMAIL_NOT_VERIFIED" } });
    expect(await environment.session.signIn({ email: unconfirmed.email, password: "wrong", rememberMe: true }))
      .toMatchObject({ ok: false, error: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    environment.sessionController.confirmEmail(unconfirmed.email);
    expect(await environment.session.signIn({ email: unconfirmed.email, password: unconfirmed.password, rememberMe: true }))
      .toMatchObject({ ok: true, value: { status: "signed-in" } });
  });

  it("validates controller presets", () => {
    const environment = createMockApplicationEnvironment();
    expect(() => environment.sessionController.setPreset("invalid" as never)).toThrow(RangeError);
  });
});

describe("The placeholder workspace's access on the double", () => {
  it("returns indistinguishable denials without change for invalid selections", async () => {
    const environment = createMockApplicationEnvironment();
    const userId = "user-demo-sahyadri-editor";
    const before = await environment.access.getAccess({ userId });
    const results = await Promise.all([
      environment.access.selectOrganization({ userId, organizationId: "org-unknown" }),
      environment.access.selectPublication({ userId, organizationId: "org-demo-sahyadri", publicationId: "pub-unknown" }),
      environment.access.selectPublication({ userId, organizationId: "org-demo-sahyadri", publicationId: "pub-demo-ratnagiri-tide" }),
      environment.access.selectPublication({ userId: "user-demo-konkan-reviewer", ...PUNE }),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[3]).toEqual(results[0]);
    expect(results[0]).toMatchObject({ ok: false, error: { code: "denied" } });
    expect(await environment.access.getAccess({ userId })).toEqual(before);
  });

  it("gives a person without a workspace none", async () => {
    const environment = createMockApplicationEnvironment();
    expect(await environment.access.getAccess({ userId: "user-demo-unconfirmed" })).toEqual({ ok: true, value: null });
  });

  it("returns detached copies", async () => {
    const environment = createMockApplicationEnvironment();
    const userId = "user-demo-sahyadri-editor";
    const snapshot = await environment.session.getSession();
    const first = await environment.access.getAccess({ userId });
    expect(snapshot.ok && first.ok && first.value).toBeTruthy();
    if (!snapshot.ok || snapshot.value.status !== "signed-in" || !first.ok || !first.value) return;
    (snapshot.value.session.user as { name: string }).name = "mutated";
    (first.value.access as unknown as { organizationId: string }[])[0]!.organizationId = "mutated";
    (first.value.access[0]!.publicationIds as string[])[0] = "mutated";
    expect(await environment.session.getSession()).toMatchObject({
      value: { session: { user: { name: "Sahyadri Demo Editor" } } },
    });
    const again = await environment.access.getAccess({ userId });
    expect(again.ok && again.value?.access[0]).toEqual({
      organizationId: "org-demo-sahyadri",
      publicationIds: ["pub-demo-pune-daily", "pub-demo-urdu-evening"],
    });
  });
});

describe("The account double", () => {
  it("answers reset and confirmation requests the same whether or not the address has an account", async () => {
    const environment = createMockApplicationEnvironment();
    const { editor, unconfirmed } = environment.sessionController.fixtures.accounts;
    const known = await environment.account.requestPasswordReset({ email: editor.email });
    const unknown = await environment.account.requestPasswordReset({ email: "nobody@sahyadri.example" });
    expect(known).toEqual(unknown);
    const pending = await environment.account.sendVerificationEmail({ email: unconfirmed.email, returnPath: "/verify?confirmed=1" });
    const confirmed = await environment.account.sendVerificationEmail({ email: editor.email, returnPath: "/verify?confirmed=1" });
    const nobody = await environment.account.sendVerificationEmail({ email: "nobody@sahyadri.example", returnPath: "/verify?confirmed=1" });
    expect(pending).toEqual(confirmed);
    expect(pending).toEqual(nobody);
    // only the real cases "sent" anything
    expect(environment.sessionController.outbox()).toEqual([
      { kind: "reset", to: editor.email },
      { kind: "verify", to: unconfirmed.email, returnPath: "/verify?confirmed=1" },
    ]);
  });

  it("accepts a reset token once, with a password of 12 characters or more, and ends the session", async () => {
    const environment = createMockApplicationEnvironment();
    const { resetToken, accounts } = environment.sessionController.fixtures;
    expect(await environment.account.resetPassword({ token: resetToken, newPassword: "too short" }))
      .toMatchObject({ ok: false, error: { code: "PASSWORD_TOO_SHORT" } });
    expect(await environment.account.resetPassword({ token: "not-the-token", newPassword: "a long enough password" }))
      .toMatchObject({ ok: false, error: { code: "INVALID_TOKEN" } });
    expect(await environment.account.resetPassword({ token: resetToken, newPassword: "a long enough password" }))
      .toEqual({ ok: true, value: undefined });
    expect(await environment.session.getSession()).toEqual({ ok: true, value: { status: "signed-out" } });
    expect(await environment.account.resetPassword({ token: resetToken, newPassword: "a long enough password" }))
      .toMatchObject({ ok: false, error: { code: "INVALID_TOKEN" } });
    expect(await environment.session.signIn({ email: accounts.editor.email, password: "a long enough password", rememberMe: true }))
      .toMatchObject({ ok: true });
  });

  it("shows an invitation without its address, and lets only that address sign up", async () => {
    const environment = createMockApplicationEnvironment();
    const { pending } = environment.sessionController.fixtures.invitations;
    const shown = await environment.account.getInvitation({ invitationId: pending.id });
    expect(shown).toEqual({
      ok: true,
      value: {
        organizationName: "The Sahyadri Daily",
        inviterName: "Ravi Kulkarni",
        roles: ["member", "page_designer"],
        expiresAt: "2026-10-28T12:00:00.000Z",
        state: "pending",
      },
    });
    expect(JSON.stringify(shown)).not.toContain(pending.email);
    expect(await environment.account.getInvitation({ invitationId: "00000000-0000-4000-8000-000000000000" }))
      .toMatchObject({ ok: false, error: { status: 404, code: "not_found" } });
    const input = { invitationId: pending.id, name: "New Designer", password: "a long enough password", returnPath: "/verify" };
    const other = await environment.account.signUp({ ...input, email: "someone.else@sahyadri.example" });
    const invited = await environment.account.signUp({ ...input, email: pending.email });
    expect(other).toEqual(invited);
    expect(environment.sessionController.outbox()).toEqual([{ kind: "verify", to: pending.email, returnPath: "/verify" }]);
  });

  it("joins only with a session for the invited address, and a replayed key joins once", async () => {
    const environment = createMockApplicationEnvironment();
    const { pending } = environment.sessionController.fixtures.invitations;
    const signedOut = vi.fn();
    environment.onSignedOut(signedOut);
    environment.sessionController.setPreset("signed-out");
    expect(await environment.account.acceptInvitation({ invitationId: pending.id, idempotencyKey: "key-1" }))
      .toMatchObject({ ok: false, error: { status: 401, code: "signed_out" } });
    expect(signedOut).toHaveBeenCalledTimes(1);
    environment.sessionController.setPreset("sahyadri-editor");
    expect(await environment.account.acceptInvitation({ invitationId: pending.id, idempotencyKey: "key-2" }))
      .toMatchObject({ ok: false, error: { status: 404, code: "not_found" } }); // another address: the API says nothing more

    await environment.account.signUp({ invitationId: pending.id, name: "New Designer", email: pending.email, password: "a long enough password", returnPath: "/verify" });
    environment.sessionController.confirmEmail(pending.email);
    await environment.session.signIn({ email: pending.email, password: "a long enough password", rememberMe: false });
    const joined = { ok: true, value: { orgId: "org-demo-daily" } };
    expect(await environment.account.acceptInvitation({ invitationId: pending.id, idempotencyKey: "key-3" })).toEqual(joined);
    expect(await environment.account.acceptInvitation({ invitationId: pending.id, idempotencyKey: "key-3" })).toEqual(joined);
    expect(await environment.account.acceptInvitation({ invitationId: pending.id, idempotencyKey: "key-4" }))
      .toMatchObject({ ok: false, error: { status: 404 } });
    expect(await environment.account.getInvitation({ invitationId: pending.id })).toMatchObject({ value: { state: "accepted" } });
  });
});

describe("The double's reset and determinism", () => {
  it("resets atomically, repeatedly, and independently", async () => {
    const first = createMockApplicationEnvironment();
    const second = createMockApplicationEnvironment();
    await first.session.signOut();
    await first.account.requestPasswordReset({ email: "editor@sahyadri.example" });
    first.sessionController.setProblem({ kind: "offline" });
    first.scenarios.setScenario({ mode: "denial", operations: ["organization.list"] });
    first.reset();
    first.reset();
    expect(await first.session.getSession()).toEqual(await second.session.getSession());
    expect(first.sessionController.outbox()).toEqual([]);
    expect(first.scenarios.getScenario()).toEqual({ mode: "normal" });
    expect(second.sessionController.getPreset()).toBe("sahyadri-editor");
  });

  it("answers with a set problem until it is cleared", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "offline" }, ["session.get"]);
    expect(await environment.session.getSession()).toEqual({ ok: false, error: { kind: "offline" } });
    environment.sessionController.setProblem(null, ["session.get"]);
    expect(await environment.session.getSession()).toMatchObject({ ok: true });
  });

  it("calls no network, storage, clock or randomness in normal operations", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const randomSpy = vi.spyOn(Math, "random");
    const nowSpy = vi.spyOn(Date, "now");
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    const storageReadSpy = vi.spyOn(Storage.prototype, "getItem");
    const cryptoSpy = vi.spyOn(crypto, "getRandomValues");
    const uuidSpy = vi.spyOn(crypto, "randomUUID");
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    try {
      const environment = createMockApplicationEnvironment();
      const { fixtures } = environment.sessionController;
      await environment.session.getSession();
      await environment.access.selectPublication({ userId: "user-demo-sahyadri-editor", organizationId: "org-demo-sahyadri", publicationId: "pub-demo-urdu-evening" });
      await environment.access.selectOrganization({ userId: "user-demo-sahyadri-editor", organizationId: "org-demo-konkan" });
      await environment.session.signOut();
      await environment.session.signIn({ email: fixtures.accounts.editor.email, password: fixtures.accounts.editor.password, rememberMe: true });
      await environment.account.requestPasswordReset({ email: fixtures.accounts.editor.email });
      await environment.account.getInvitation({ invitationId: fixtures.invitations.pending.id });
      for (const spy of [fetchSpy, randomSpy, nowSpy, localSpy, storageReadSpy, cryptoSpy, uuidSpy, xhrSpy]) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});
