/**
 * The test double for the real session, account, security and team services, and for the person's workspace (/me),
 * used by component tests (the app itself runs on src/api).
 *
 * It answers like the API: Better Auth's codes for sign-in, two-step, reset and confirmation (INVALID_EMAIL_OR_PASSWORD,
 * EMAIL_NOT_VERIFIED, INVALID_CODE, INVALID_PASSWORD, INVALID_TOKEN, PASSWORD_TOO_SHORT, …), the same answer for every
 * email address on the generic steps, and the API's own for Team (signed_out, not_found for another organisation,
 * two_step_required, not_allowed, invalid_request). It is deterministic: no clock, randomness, network or storage.
 * Latency, failure and denial come from the shared scenario controller; any specific answer from `setProblem`.
 */
import type {
  AccountService,
  ApiProblem,
  DeviceDto,
  InvitationDetailDto,
  InvitationDto,
  MemberDto,
  OrgAccessDto,
  SecurityService,
  ServiceResult,
  SessionService,
  SessionSnapshot,
  TeamService,
  WorkspaceAccessDto,
  WorkspaceAccessService,
} from "../services/index.ts";
import { grantsOf } from "../services/index.ts";
import type { MockOperation } from "./scenarios.ts";
import { createCanonicalSeed } from "./seed.ts";
import {
  createAccounts,
  createInvitations,
  createOrgRoles,
  presetForUser,
  resetTokenFixture,
  twoStepFixtures,
  twoStepRolesOf,
  userForPreset,
  type MockAccount,
  type MockInvitation,
  type MockOrgRole,
} from "./session-seed.ts";

export type MockSessionPreset = "sahyadri-editor" | "konkan-reviewer" | "sahyadri-owner" | "signed-out";

export type MockAuthOperation =
  | "session.get"
  | "session.signIn"
  | "session.verifyTwoStep"
  | "session.signOut"
  | "account.requestPasswordReset"
  | "account.resetPassword"
  | "account.sendVerificationEmail"
  | "account.getInvitation"
  | "account.signUp"
  | "account.acceptInvitation"
  | "security.startTwoStep"
  | "security.confirmTwoStep"
  | "security.turnOffTwoStep"
  | "security.newBackupCodes"
  | "security.listDevices"
  | "security.signOutDevice"
  | "team.listMembers"
  | "team.updateMember"
  | "team.removeMember"
  | "team.listInvitations"
  | "team.invite"
  | "team.resendInvitation"
  | "team.cancelInvitation";

/** An email the double "sent". */
export interface MockMail {
  readonly kind: "verify" | "reset" | "invite";
  readonly to: string;
  /** Where a confirmation link would bring the browser back. */
  readonly returnPath?: string;
}

interface Credentials {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

export interface MockSessionFixtures {
  readonly accounts: {
    readonly editor: Credentials;
    readonly reviewer: Credentials;
    /** An account whose email address is not confirmed yet. */
    readonly unconfirmed: Credentials;
    /** The Sahyadri owner: two-step on, and required for owners there. */
    readonly owner: Credentials;
    readonly subeditor: Credentials & { readonly userId: string };
  };
  readonly invitations: {
    readonly pending: { readonly id: string; readonly email: string };
    readonly expired: { readonly id: string };
    readonly accepted: { readonly id: string };
    readonly revoked: { readonly id: string };
    /** The pending invitation Sahyadri's Team lists. */
    readonly team: { readonly id: string; readonly email: string };
  };
  readonly resetToken: string;
  /** What the fictional authenticator app shows, and the owner's backup codes. */
  readonly totpCode: string;
  readonly backupCodes: readonly string[];
}

export interface MockSessionController {
  setPreset(preset: MockSessionPreset): void;
  getPreset(): MockSessionPreset;
  reset(): void;
  /** Answers the given operations (every one when none are named) with `problem`, until cleared with null. */
  setProblem(problem: ApiProblem | null, operations?: readonly MockAuthOperation[]): void;
  /** Emails "sent" since the last reset, oldest first. */
  outbox(): readonly MockMail[];
  /** Confirms an address, as opening its emailed link would. */
  confirmEmail(email: string): void;
  /** Ends the session on the "server" (an expiry or a revocation); the app learns of it from its next request. */
  endSession(): void;
  /** Whether the current session was made with two-step, and whether a device was trusted at the last code. */
  twoStepState(): { readonly sessionTwoStep: boolean; readonly trustedDevice: boolean };
  readonly fixtures: MockSessionFixtures;
}

export interface MockSessionEnvironment {
  readonly session: SessionService;
  readonly account: AccountService;
  readonly security: SecurityService;
  readonly team: TeamService;
  readonly access: WorkspaceAccessService;
  readonly sessionController: MockSessionController;
  readonly invalidatePendingSessionMutations: () => void;
  readonly getSessionMutationGeneration: () => number;
  readonly onSignedOut: (listener: () => void) => () => void;
}

export interface CreateMockSessionEnvironmentOptions {
  /** The shared scenario gate (create-mock-service-environment.ts). */
  readonly intercept?: (operation: MockOperation) => Promise<"failure" | "denial" | undefined>;
}

const PRESETS: readonly MockSessionPreset[] = ["sahyadri-editor", "konkan-reviewer", "sahyadri-owner", "signed-out"];
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;
const TEAM_INVITATION_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const LAST_ACTIVE = "2026-10-21T09:00:00.000Z";

function answer(status: number, code: string, message = ""): ApiProblem {
  return { kind: "answer", status, code, message, ...(status >= 400 && !/^[A-Z]/.test(code) ? { requestId: "mock-request" } : {}) };
}

const ANSWERS = {
  wrongCredentials: answer(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password"),
  unverified: answer(403, "EMAIL_NOT_VERIFIED", "Email not verified"),
  invalidToken: answer(400, "INVALID_TOKEN", "Invalid token"),
  tooShort: answer(400, "PASSWORD_TOO_SHORT", "Password too short"),
  tooLong: answer(400, "PASSWORD_TOO_LONG", "Password too long"),
  wrongPassword: answer(400, "INVALID_PASSWORD", "Invalid password"),
  invalidCode: answer(401, "INVALID_CODE", "Invalid code"),
  invalidBackupCode: answer(401, "INVALID_BACKUP_CODE", "Invalid backup code"),
  noPendingTwoStep: answer(401, "INVALID_TWO_FACTOR_COOKIE", "Invalid two factor cookie"),
  locked: answer(403, "ACCOUNT_TEMPORARILY_LOCKED", "Too many failed verification attempts."),
  totpAlreadyOn: answer(400, "TOTP_ALREADY_ENABLED", "TOTP is already enabled"),
  totpNotOn: answer(400, "TOTP_NOT_ENABLED", "TOTP not enabled"),
  twoStepNotOn: answer(400, "TWO_FACTOR_NOT_ENABLED", "Two factor isn't enabled"),
  signedOut: answer(401, "signed_out", "You are signed out. Sign in again; what you typed is kept on this device."),
  notFound: answer(404, "not_found", "There is nothing here, or you do not have access to it."),
  notAllowed: answer(403, "not_allowed", "Your role cannot do this. Ask an editor or the owner."),
  twoStepRequired: answer(403, "two_step_required", "Your role needs two-step sign-in. Set it up in Account → Security."),
  serverError: answer(500, "server_error", "Something went wrong on our side. Try again."),
} as const satisfies Readonly<Record<string, ApiProblem>>;

function invalidRequest(field: string, message: string): ApiProblem {
  return {
    kind: "answer",
    status: 400,
    code: "invalid_request",
    message: "Some fields are not right.",
    requestId: "mock-request",
    details: [{ field, message }],
  };
}

const DENIED = {
  code: "denied" as const,
  displayMessage: "This demonstration action is not available in the current context." as const,
  qualification: "Demonstration only — production authorization is not evaluated here" as const,
};
const TEMPORARY_FAILURE = {
  code: "temporary-failure" as const,
  displayMessage: "The demonstration service is temporarily unavailable. Try again." as const,
};

function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

function failure<T>(problem: ApiProblem): ServiceResult<T, ApiProblem> {
  return { ok: false, error: { ...problem } };
}

function publicInvitation(invitation: MockInvitation): InvitationDto {
  return {
    organizationName: invitation.organizationName,
    inviterName: invitation.inviterName,
    roles: [...invitation.roles],
    expiresAt: invitation.expiresAt,
    state: invitation.state,
  };
}

function teamInvitationFixture(): InvitationDetailDto {
  return {
    id: TEAM_INVITATION_ID,
    email: "new.reporter@sahyadri.example",
    orgRole: "member",
    publications: [{ publicationId: "pub-demo-pune-daily", roles: ["reporter"], grants: [] }],
    expiresAt: "2026-10-28T12:00:00.000Z",
    state: "pending",
  };
}

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** §12: "Can approve pages" and "Can approve release" go only with the Editor role (GRANT_HOLDERS). */
function grantsFit(roles: readonly string[], grants: readonly string[]): boolean {
  return grants.every((grant) => (grant === "page_approve" || grant === "release_approve") && roles.includes("editor"));
}

export function createMockSessionEnvironment(
  options: CreateMockSessionEnvironmentOptions = {},
): MockSessionEnvironment {
  const intercept = options.intercept ?? (async () => undefined);
  const names = createCanonicalSeed();
  const orgNames = new Map<string, string>([
    ...names.organizations.map((org): [string, string] => [org.id, org.name]),
    ["org-demo-daily", "The Sahyadri Daily"],
  ]);
  const pubNames = new Map<string, string>([
    ...names.publications.map((pub): [string, string] => [pub.id, pub.name]),
    ["pub-demo-daily", "The Sahyadri Daily"],
  ]);
  const twoStep = twoStepFixtures();

  let preset: MockSessionPreset = "sahyadri-editor";
  let signedInUserId: string | undefined = userForPreset("sahyadri-editor");
  let sessionTwoStep = false;
  let trustedDevice = false;
  let pendingTwoStepUserId: string | undefined;
  let twoStepFailures = 0;
  let enrolling = false;
  let accounts: MockAccount[] = createAccounts();
  let orgRoles = createOrgRoles();
  let invitations: MockInvitation[] = createInvitations();
  let teamInvitations = new Map<string, InvitationDetailDto[]>([["org-demo-sahyadri", [teamInvitationFixture()]]]);
  let inviteKeys = new Map<string, InvitationDetailDto>();
  let invitationCounter = 1;
  let backupCodes = new Map<string, string[]>([["user-demo-sahyadri-owner", [...twoStep.backupCodes]]]);
  let otherDevices = new Map<string, DeviceDto[]>();
  let resetToken: { token: string; email: string } | undefined = resetTokenFixture();
  let mail: MockMail[] = [];
  /** The active organisation and publication each person chose. */
  let active = new Map<string, { organizationId: string; publicationId: string }>();
  /** Idempotency keys already used to accept an invitation. */
  let acceptedKeys = new Set<string>();
  let problems = new Map<MockAuthOperation | "*", ApiProblem>();
  let mutationGeneration = 0;
  const signedOutListeners = new Set<() => void>();

  function beginMutation(): number {
    mutationGeneration += 1;
    return mutationGeneration;
  }

  function accountByEmail(email: string): MockAccount | undefined {
    const wanted = email.trim().toLowerCase();
    return accounts.find((account) => account.email === wanted);
  }

  function current(): MockAccount | undefined {
    return accounts.find((candidate) => candidate.userId === signedInUserId);
  }

  function snapshot(): SessionSnapshot {
    const account = current();
    if (!account) return { status: "signed-out" };
    return {
      status: "signed-in",
      session: {
        user: {
          id: account.userId,
          name: account.name,
          email: account.email,
          emailVerified: account.emailVerified,
          twoFactorEnabled: account.twoFactorEnabled,
        },
      },
    };
  }

  /** The person's organisations, shaped as /me gives them. */
  function organizationsOf(userId: string): OrgAccessDto[] {
    return (orgRoles.get(userId) ?? []).map((org) => ({
      org: { id: org.organizationId, name: orgNames.get(org.organizationId) ?? org.organizationId },
      orgRole: org.orgRole,
      twoStep: {
        required: twoStepRolesOf(org.organizationId).includes(org.orgRole),
        satisfied: userId === signedInUserId && sessionTwoStep,
      },
      publications: org.publications.map((publication) => ({
        id: publication.publicationId,
        name: pubNames.get(publication.publicationId) ?? publication.publicationId,
        roles: [...publication.roles] as OrgAccessDto["publications"][number]["roles"],
        grants: [...publication.grants] as OrgAccessDto["publications"][number]["grants"],
      })),
    }));
  }

  function workspace(userId: string): WorkspaceAccessDto | undefined {
    const organizations = organizationsOf(userId);
    const chosen = active.get(userId);
    const org = organizations.find((candidate) => candidate.org.id === chosen?.organizationId) ?? organizations[0];
    if (!org) return undefined;
    const publicationId =
      chosen && chosen.organizationId === org.org.id ? chosen.publicationId : (org.publications[0]?.id ?? "");
    return { access: grantsOf(organizations), activeOrganizationId: org.org.id, activePublicationId: publicationId, organizations };
  }

  /** The scenario's latency, failure or denial, then any problem set for this operation. */
  async function gate(operation: MockAuthOperation): Promise<ApiProblem | undefined> {
    const scenarioOperation = (
      ["session.get", "session.signIn", "session.signOut"].includes(operation) ? operation : undefined
    ) as MockOperation | undefined;
    const outcome = scenarioOperation ? await intercept(scenarioOperation) : undefined;
    if (outcome === "failure") return ANSWERS.serverError;
    if (outcome === "denial") return ANSWERS.notAllowed;
    return problems.get(operation) ?? problems.get("*");
  }

  function signedOutAnswer<T>(): ServiceResult<T, ApiProblem> {
    // the real client calls this for every 401 signed_out answer
    for (const listener of [...signedOutListeners]) listener();
    return failure(ANSWERS.signedOut);
  }

  function signInAs(userId: string, withTwoStep: boolean): void {
    signedInUserId = userId;
    sessionTwoStep = withTwoStep;
    preset = presetForUser(userId) ?? "signed-out";
  }

  function setPreset(nextPreset: MockSessionPreset): void {
    if (!PRESETS.includes(nextPreset)) {
      throw new RangeError(`Unsupported mock session preset: ${String(nextPreset)}`);
    }
    beginMutation();
    preset = nextPreset;
    pendingTwoStepUserId = undefined;
    signedInUserId = nextPreset === "signed-out" ? undefined : userForPreset(nextPreset);
    // a preset session of a two-step account was made with its code
    sessionTwoStep = Boolean(current()?.twoFactorEnabled);
  }

  const session: SessionService = {
    async getSession() {
      const problem = await gate("session.get");
      if (problem) return failure(problem);
      return success(snapshot());
    },

    async signIn({ email, password }) {
      const mutation = beginMutation();
      const problem = await gate("session.signIn");
      if (problem) return failure(problem);
      // a newer sign-in, a sign-out or a reset came first: this one no longer applies
      if (mutation !== mutationGeneration) return success(snapshot());
      const account = accountByEmail(email);
      if (!account || account.password !== password) return failure(ANSWERS.wrongCredentials);
      if (!account.emailVerified) return failure(ANSWERS.unverified);
      if (account.twoFactorEnabled && !trustedDevice) {
        pendingTwoStepUserId = account.userId;
        twoStepFailures = 0;
        return success({ status: "two-step" });
      }
      signInAs(account.userId, account.twoFactorEnabled);
      return success(snapshot());
    },

    async verifyTwoStep({ code, kind, trustDevice }) {
      beginMutation();
      const problem = await gate("session.verifyTwoStep");
      if (problem) return failure(problem);
      if (!pendingTwoStepUserId) return failure(ANSWERS.noPendingTwoStep);
      if (twoStepFailures >= 5) return failure(ANSWERS.locked);
      const userId = pendingTwoStepUserId;
      const trimmed = code.trim();
      const codes = backupCodes.get(userId) ?? [];
      const right = kind === "totp" ? trimmed === twoStep.totpCode : codes.includes(trimmed);
      if (!right) {
        twoStepFailures += 1;
        return failure(kind === "totp" ? ANSWERS.invalidCode : ANSWERS.invalidBackupCode);
      }
      if (kind === "backup") backupCodes.set(userId, codes.filter((candidate) => candidate !== trimmed));
      pendingTwoStepUserId = undefined;
      trustedDevice = trustDevice;
      signInAs(userId, true);
      return success(snapshot());
    },

    async signOut() {
      beginMutation();
      const problem = await gate("session.signOut");
      if (problem) return failure(problem);
      signedInUserId = undefined;
      sessionTwoStep = false;
      preset = "signed-out";
      return success({ status: "signed-out" });
    },
  };

  async function accessGate(operation: "access.get" | "access.select") {
    const outcome = await intercept(operation);
    if (outcome === "failure") return { ok: false as const, error: { ...TEMPORARY_FAILURE } };
    if (outcome === "denial") return { ok: false as const, error: { ...DENIED } };
    return undefined;
  }

  const access: WorkspaceAccessService = {
    async getAccess({ userId }) {
      const intercepted = await accessGate("access.get");
      if (intercepted) return intercepted;
      return success(workspace(userId) ?? null);
    },

    async selectOrganization({ userId, organizationId }) {
      const mutation = beginMutation();
      const intercepted = await accessGate("access.select");
      if (intercepted) return intercepted;
      const now = userId === signedInUserId ? workspace(userId) : undefined;
      if (!now) return { ok: false, error: { ...DENIED } };
      const org = now.organizations.find((candidate) => candidate.org.id === organizationId);
      const publicationId = org?.publications[0]?.id;
      if (!org) return { ok: false, error: { ...DENIED } };
      // a newer change (a sign-in, a sign-out, a reset, another choice) came first: this one no longer applies
      if (mutation !== mutationGeneration) return { ok: false, error: { ...TEMPORARY_FAILURE } };
      active.set(userId, { organizationId, publicationId: publicationId ?? "" });
      return success(workspace(userId) as WorkspaceAccessDto);
    },

    async selectPublication({ userId, organizationId, publicationId }) {
      const mutation = beginMutation();
      const intercepted = await accessGate("access.select");
      if (intercepted) return intercepted;
      const now = userId === signedInUserId ? workspace(userId) : undefined;
      if (!now) return { ok: false, error: { ...DENIED } };
      const org = now.organizations.find((candidate) => candidate.org.id === organizationId);
      if (!org?.publications.some((publication) => publication.id === publicationId)) {
        return { ok: false, error: { ...DENIED } };
      }
      if (mutation !== mutationGeneration) return { ok: false, error: { ...TEMPORARY_FAILURE } };
      active.set(userId, { organizationId, publicationId });
      return success(workspace(userId) as WorkspaceAccessDto);
    },
  };

  function passwordProblem(password: string): ApiProblem | undefined {
    if (password.length < MIN_PASSWORD) return ANSWERS.tooShort;
    if (password.length > MAX_PASSWORD) return ANSWERS.tooLong;
    return undefined;
  }

  const account: AccountService = {
    async requestPasswordReset({ email }) {
      const problem = await gate("account.requestPasswordReset");
      if (problem) return failure(problem);
      if (accountByEmail(email)) mail.push({ kind: "reset", to: email.trim().toLowerCase() });
      return success(undefined);
    },

    async resetPassword({ token, newPassword }) {
      const problem = await gate("account.resetPassword");
      if (problem) return failure(problem);
      const tooWeak = passwordProblem(newPassword);
      if (tooWeak) return failure(tooWeak);
      if (!resetToken || resetToken.token !== token) return failure(ANSWERS.invalidToken);
      const owner = resetToken.email;
      accounts = accounts.map((candidate) =>
        candidate.email === owner ? { ...candidate, password: newPassword } : candidate,
      );
      resetToken = undefined;
      // every session of that account ends (revokeSessionsOnPasswordReset)
      if (accounts.find((candidate) => candidate.email === owner)?.userId === signedInUserId) {
        beginMutation();
        signedInUserId = undefined;
        preset = "signed-out";
      }
      return success(undefined);
    },

    async sendVerificationEmail({ email, returnPath }) {
      const problem = await gate("account.sendVerificationEmail");
      if (problem) return failure(problem);
      const found = accountByEmail(email);
      if (found && !found.emailVerified) mail.push({ kind: "verify", to: found.email, returnPath });
      return success(undefined);
    },

    async getInvitation({ invitationId }) {
      const problem = await gate("account.getInvitation");
      if (problem) return failure(problem);
      const invitation = invitations.find((candidate) => candidate.id === invitationId);
      return invitation ? success(publicInvitation(invitation)) : failure(ANSWERS.notFound);
    },

    async signUp({ invitationId, name, email, password, returnPath }) {
      const problem = await gate("account.signUp");
      if (problem) return failure(problem);
      const tooWeak = passwordProblem(password);
      if (tooWeak) return failure(tooWeak);
      const address = email.trim().toLowerCase();
      const invitation = invitations.find((candidate) => candidate.id === invitationId);
      // only a pending invitation's own address may sign up; every other case gets the same answer
      if (invitation?.state === "pending" && invitation.email === address && !accountByEmail(address)) {
        accounts = [
          ...accounts,
          {
            userId: `user-invited-${invitation.id}`,
            name: name.trim(),
            email: address,
            password,
            emailVerified: false,
            twoFactorEnabled: false,
          },
        ];
        mail.push({ kind: "verify", to: address, returnPath });
      }
      return success(undefined);
    },

    async acceptInvitation({ invitationId, idempotencyKey }) {
      const problem = await gate("account.acceptInvitation");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      const invitation = invitations.find((candidate) => candidate.id === invitationId);
      if (acceptedKeys.has(idempotencyKey) && invitation) return success({ orgId: invitation.organizationId });
      if (!invitation || invitation.state !== "pending") return failure(ANSWERS.notFound);
      if (invitation.email !== person.email) return failure(ANSWERS.notFound);
      invitations = invitations.map((candidate) =>
        candidate.id === invitationId ? { ...candidate, state: "accepted" } : candidate,
      );
      const role: MockOrgRole = {
        organizationId: invitation.organizationId,
        orgRole: invitation.roles.includes("admin") ? "admin" : "member",
        publications: [
          {
            publicationId: invitation.publicationId,
            roles: invitation.roles.filter((role) => role !== "member" && role !== "admin"),
            grants: [],
          },
        ],
      };
      orgRoles.set(person.userId, [...(orgRoles.get(person.userId) ?? []), role]);
      acceptedKeys.add(idempotencyKey);
      return success({ orgId: invitation.organizationId });
    },
  };

  function devicesOf(userId: string): DeviceDto[] {
    const here: DeviceDto = {
      token: `token-current-${userId}`,
      id: `session-current-${userId}`,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36",
      ipAddress: "127.0.0.1",
      signedInAt: "2026-10-22T03:30:00.000Z",
      lastActiveAt: "2026-10-22T04:00:00.000Z",
      current: true,
    };
    const others =
      otherDevices.get(userId) ??
      [
        {
          token: `token-phone-${userId}`,
          id: `session-phone-${userId}`,
          userAgent:
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Mobile Safari/537.36",
          ipAddress: "192.0.2.15",
          signedInAt: "2026-10-20T05:00:00.000Z",
          lastActiveAt: "2026-10-21T13:00:00.000Z",
          current: false,
        },
      ];
    if (!otherDevices.has(userId)) otherDevices.set(userId, others);
    return [here, ...others];
  }

  const security: SecurityService = {
    async startTwoStep({ password }) {
      const problem = await gate("security.startTwoStep");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      if (person.password !== password) return failure(ANSWERS.wrongPassword);
      if (person.twoFactorEnabled) return failure(ANSWERS.totpAlreadyOn);
      enrolling = true;
      backupCodes.set(person.userId, ["FICTD-44444", "FICTE-55555", "FICTF-66666"]);
      return success({
        totpUri: twoStep.totpUri.replace("{email}", encodeURIComponent(person.email)),
        backupCodes: backupCodes.get(person.userId) ?? [],
      });
    },

    async confirmTwoStep({ code }) {
      const problem = await gate("security.confirmTwoStep");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      if (!enrolling) return failure(ANSWERS.totpNotOn);
      if (code.trim() !== twoStep.totpCode) return failure(ANSWERS.invalidCode);
      enrolling = false;
      accounts = accounts.map((candidate) =>
        candidate.userId === person.userId ? { ...candidate, twoFactorEnabled: true } : candidate,
      );
      sessionTwoStep = true;
      otherDevices.set(person.userId, []); // turning two-step on ends every other session
      return success(undefined);
    },

    async turnOffTwoStep({ password }) {
      const problem = await gate("security.turnOffTwoStep");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      if (person.password !== password) return failure(ANSWERS.wrongPassword);
      if (!person.twoFactorEnabled) return failure(ANSWERS.twoStepNotOn);
      accounts = accounts.map((candidate) =>
        candidate.userId === person.userId ? { ...candidate, twoFactorEnabled: false } : candidate,
      );
      sessionTwoStep = false;
      trustedDevice = false;
      return success(undefined);
    },

    async newBackupCodes({ password }) {
      const problem = await gate("security.newBackupCodes");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      if (!person.twoFactorEnabled) return failure(ANSWERS.twoStepNotOn);
      if (person.password !== password) return failure(ANSWERS.wrongPassword);
      const fresh = ["FICTG-77777", "FICTH-88888", "FICTI-99999"];
      backupCodes.set(person.userId, fresh);
      return success(fresh);
    },

    async listDevices() {
      const problem = await gate("security.listDevices");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      return success(devicesOf(person.userId).map((device) => ({ ...device })));
    },

    async signOutDevice({ token }) {
      const problem = await gate("security.signOutDevice");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      otherDevices.set(person.userId, devicesOf(person.userId).slice(1).filter((device) => device.token !== token));
      return success(undefined);
    },

    async signOutOtherDevices() {
      const problem = await gate("security.signOutDevice");
      if (problem) return failure(problem);
      const person = current();
      if (!person) return signedOutAnswer();
      otherDevices.set(person.userId, []);
      return success(undefined);
    },
  };

  /** Who may use Team here (07 §12): the members' list for Owner, Admin and Chief Editor; changes for Owner and Admin. */
  function teamCheck<T>(orgId: string, need: "view" | "manage"): ServiceResult<T, ApiProblem> | MockOrgRole {
    const person = current();
    if (!person) return signedOutAnswer();
    const mine = orgRoles.get(person.userId)?.find((org) => org.organizationId === orgId);
    if (!mine) return failure(ANSWERS.notFound);
    if (twoStepRolesOf(orgId).includes(mine.orgRole) && !sessionTwoStep) return failure(ANSWERS.twoStepRequired);
    const admin = mine.orgRole === "owner" || mine.orgRole === "admin";
    const chief = mine.publications.some((publication) => publication.roles.includes("chief_editor"));
    if (need === "manage" ? !admin : !admin && !chief) return failure(ANSWERS.notAllowed);
    return mine;
  }

  function membersOf(orgId: string): MemberDto[] {
    return accounts.flatMap((person) => {
      const role = orgRoles.get(person.userId)?.find((org) => org.organizationId === orgId);
      if (!role) return [];
      return [
        {
          userId: person.userId,
          name: person.name,
          email: person.email,
          orgRole: role.orgRole,
          publications: role.publications.map((publication) => ({
            publicationId: publication.publicationId,
            roles: [...publication.roles] as MemberDto["publications"][number]["roles"],
            grants: [...publication.grants] as MemberDto["publications"][number]["grants"],
          })),
          status: "active" as const,
          lastActiveAt: person.userId === signedInUserId ? LAST_ACTIVE : null,
        },
      ];
    });
  }

  function publicationsProblem(orgId: string, publications: MemberDto["publications"]): ApiProblem | undefined {
    const known = new Set(names.publications.filter((pub) => pub.orgId === orgId).map((pub) => pub.id));
    const ids = publications.map((publication) => publication.publicationId);
    if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      return invalidRequest("body.publications", "names a publication this organisation does not have");
    }
    if (publications.some((publication) => publication.roles.length === 0 || !grantsFit(publication.roles, publication.grants))) {
      return invalidRequest("body.publications.grants", "a grant goes only with a role allowed to hold it");
    }
    return undefined;
  }

  const team: TeamService = {
    async listMembers({ orgId }) {
      const problem = await gate("team.listMembers");
      if (problem) return failure(problem);
      const allowed = teamCheck<readonly MemberDto[]>(orgId, "view");
      if ("ok" in allowed) return allowed;
      return success(membersOf(orgId));
    },

    async updateMember({ orgId, userId, patch }) {
      const problem = await gate("team.updateMember");
      if (problem) return failure(problem);
      const allowed = teamCheck<MemberDto>(orgId, "manage");
      if ("ok" in allowed) return allowed;
      const target = orgRoles.get(userId)?.find((org) => org.organizationId === orgId);
      if (!target) return failure(ANSWERS.notFound);
      if (target.orgRole === "owner") return failure(ANSWERS.notAllowed);
      if (patch.publications) {
        const invalid = publicationsProblem(orgId, patch.publications);
        if (invalid) return failure(invalid);
      }
      const changed: MockOrgRole = {
        ...target,
        ...(patch.orgRole ? { orgRole: patch.orgRole } : {}),
        ...(patch.publications ? { publications: patch.publications.map((p) => ({ ...p })) } : {}),
      };
      orgRoles.set(userId, (orgRoles.get(userId) ?? []).map((org) => (org.organizationId === orgId ? changed : org)));
      const member = membersOf(orgId).find((candidate) => candidate.userId === userId);
      return member ? success(member) : failure(ANSWERS.notFound);
    },

    async removeMember({ orgId, userId }) {
      const problem = await gate("team.removeMember");
      if (problem) return failure(problem);
      const allowed = teamCheck<void>(orgId, "manage");
      if ("ok" in allowed) return allowed;
      const target = orgRoles.get(userId)?.find((org) => org.organizationId === orgId);
      if (!target) return failure(ANSWERS.notFound);
      if (target.orgRole === "owner") return failure(ANSWERS.notAllowed);
      orgRoles.set(userId, (orgRoles.get(userId) ?? []).filter((org) => org.organizationId !== orgId));
      return success(undefined);
    },

    async listInvitations({ orgId }) {
      const problem = await gate("team.listInvitations");
      if (problem) return failure(problem);
      const allowed = teamCheck<readonly InvitationDetailDto[]>(orgId, "manage");
      if ("ok" in allowed) return allowed;
      return success((teamInvitations.get(orgId) ?? []).map((invitation) => ({ ...invitation })));
    },

    async invite({ orgId, invitation, idempotencyKey }) {
      const problem = await gate("team.invite");
      if (problem) return failure(problem);
      const allowed = teamCheck<InvitationDetailDto>(orgId, "manage");
      if ("ok" in allowed) return allowed;
      const replay = inviteKeys.get(idempotencyKey);
      if (replay) return success({ ...replay });
      const email = invitation.email.trim().toLowerCase();
      if (!looksLikeEmail(email)) return failure(invalidRequest("body.email", "must be an email address"));
      if (membersOf(orgId).some((member) => member.email === email)) {
        return failure(invalidRequest("body.email", "is already a member"));
      }
      const invalid = publicationsProblem(orgId, invitation.publications);
      if (invalid) return failure(invalid);
      invitationCounter += 1;
      const made: InvitationDetailDto = {
        id: `a1b2c3d4-0000-4000-8000-${String(invitationCounter).padStart(12, "0")}`,
        email,
        orgRole: invitation.orgRole,
        publications: invitation.publications.map((publication) => ({ ...publication })),
        expiresAt: "2026-10-29T12:00:00.000Z",
        state: "pending",
      };
      teamInvitations.set(orgId, [...(teamInvitations.get(orgId) ?? []), made]);
      inviteKeys.set(idempotencyKey, made);
      mail.push({ kind: "invite", to: email });
      return success({ ...made });
    },

    async resendInvitation({ orgId, id }) {
      const problem = await gate("team.resendInvitation");
      if (problem) return failure(problem);
      const allowed = teamCheck<InvitationDetailDto>(orgId, "manage");
      if ("ok" in allowed) return allowed;
      const found = teamInvitations.get(orgId)?.find((invitation) => invitation.id === id);
      if (!found) return failure(ANSWERS.notFound);
      mail.push({ kind: "invite", to: found.email });
      return success({ ...found });
    },

    async cancelInvitation({ orgId, id }) {
      const problem = await gate("team.cancelInvitation");
      if (problem) return failure(problem);
      const allowed = teamCheck<void>(orgId, "manage");
      if ("ok" in allowed) return allowed;
      const list = teamInvitations.get(orgId) ?? [];
      if (!list.some((invitation) => invitation.id === id)) return failure(ANSWERS.notFound);
      teamInvitations.set(orgId, list.filter((invitation) => invitation.id !== id));
      return success(undefined);
    },
  };

  const pendingInvitation = createInvitations()[0] as MockInvitation;
  const [expired, accepted, revoked] = createInvitations().slice(1) as [MockInvitation, MockInvitation, MockInvitation];
  const seeded = createAccounts();
  const fixture = (email: string) => {
    const found = seeded.find((candidate) => candidate.email === email) as MockAccount;
    return { email: found.email, password: found.password, name: found.name };
  };

  const sessionController: MockSessionController = {
    setPreset,
    getPreset: () => preset,
    reset() {
      beginMutation();
      preset = "sahyadri-editor";
      signedInUserId = userForPreset("sahyadri-editor");
      sessionTwoStep = false;
      trustedDevice = false;
      pendingTwoStepUserId = undefined;
      twoStepFailures = 0;
      enrolling = false;
      accounts = createAccounts();
      orgRoles = createOrgRoles();
      invitations = createInvitations();
      teamInvitations = new Map([["org-demo-sahyadri", [teamInvitationFixture()]]]);
      inviteKeys = new Map();
      invitationCounter = 1;
      backupCodes = new Map([["user-demo-sahyadri-owner", [...twoStep.backupCodes]]]);
      otherDevices = new Map();
      resetToken = resetTokenFixture();
      mail = [];
      active = new Map();
      acceptedKeys = new Set();
      problems = new Map();
    },
    setProblem(problem, operations) {
      for (const operation of operations ?? ["*" as const]) {
        if (problem) problems.set(operation, { ...problem });
        else problems.delete(operation);
      }
    },
    outbox: () => mail.map((item) => ({ ...item })),
    confirmEmail(email) {
      const address = email.trim().toLowerCase();
      accounts = accounts.map((candidate) =>
        candidate.email === address ? { ...candidate, emailVerified: true } : candidate,
      );
    },
    endSession() {
      signedInUserId = undefined;
      sessionTwoStep = false;
      preset = "signed-out";
    },
    twoStepState: () => ({ sessionTwoStep, trustedDevice }),
    fixtures: {
      accounts: {
        editor: fixture("editor@sahyadri.example"),
        reviewer: fixture("reviewer@konkan.example"),
        unconfirmed: fixture("reporter@sahyadri.example"),
        owner: fixture("owner@sahyadri.example"),
        subeditor: { ...fixture("subeditor@sahyadri.example"), userId: "user-demo-sahyadri-subeditor" },
      },
      invitations: {
        pending: { id: pendingInvitation.id, email: pendingInvitation.email },
        expired: { id: expired.id },
        accepted: { id: accepted.id },
        revoked: { id: revoked.id },
        team: { id: TEAM_INVITATION_ID, email: "new.reporter@sahyadri.example" },
      },
      resetToken: resetTokenFixture().token,
      totpCode: twoStep.totpCode,
      backupCodes: [...twoStep.backupCodes],
    },
  };

  return {
    session,
    account,
    security,
    team,
    access,
    sessionController,
    invalidatePendingSessionMutations: () => {
      beginMutation();
    },
    getSessionMutationGeneration: () => mutationGeneration,
    onSignedOut(listener) {
      signedOutListeners.add(listener);
      return () => {
        signedOutListeners.delete(listener);
      };
    },
  };
}
