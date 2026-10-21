/**
 * The test double for the real session and account services (component tests; the app itself runs on src/api), and
 * the placeholder workspace's access.
 *
 * It answers like the API: Better Auth's codes for sign-in, reset and confirmation (INVALID_EMAIL_OR_PASSWORD,
 * EMAIL_NOT_VERIFIED, INVALID_TOKEN, PASSWORD_TOO_SHORT), the same answer for every email address on the generic
 * steps, and `signed_out` for a change made without a session. It is deterministic: no clock, randomness, network or
 * storage. Latency, failure and denial come from the shared scenario controller; any specific answer from
 * `setProblem`.
 */
import type {
  AccountService,
  ApiProblem,
  InvitationDto,
  ServiceResult,
  SessionService,
  SessionSnapshot,
  WorkspaceAccessDto,
  WorkspaceAccessService,
} from "../services/index.ts";
import type { MockOperation } from "./scenarios.ts";
import {
  createAccounts,
  createInvitations,
  presetForUser,
  resetTokenFixture,
  userForPreset,
  workspaceFor,
  type MockAccount,
  type MockInvitation,
} from "./session-seed.ts";

export type MockSessionPreset = "sahyadri-editor" | "konkan-reviewer" | "signed-out";

export type MockAuthOperation =
  | "session.get"
  | "session.signIn"
  | "session.signOut"
  | "account.requestPasswordReset"
  | "account.resetPassword"
  | "account.sendVerificationEmail"
  | "account.getInvitation"
  | "account.signUp"
  | "account.acceptInvitation";

/** An email the double "sent". */
export interface MockMail {
  readonly kind: "verify" | "reset";
  readonly to: string;
  /** Where a confirmation link would bring the browser back. */
  readonly returnPath?: string;
}

export interface MockSessionFixtures {
  readonly accounts: {
    readonly editor: { readonly email: string; readonly password: string; readonly name: string };
    readonly reviewer: { readonly email: string; readonly password: string; readonly name: string };
    /** An account whose email address is not confirmed yet. */
    readonly unconfirmed: { readonly email: string; readonly password: string; readonly name: string };
  };
  readonly invitations: {
    readonly pending: { readonly id: string; readonly email: string };
    readonly expired: { readonly id: string };
    readonly accepted: { readonly id: string };
    readonly revoked: { readonly id: string };
  };
  readonly resetToken: string;
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
  readonly fixtures: MockSessionFixtures;
}

export interface MockSessionEnvironment {
  readonly session: SessionService;
  readonly account: AccountService;
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

const PRESETS: readonly MockSessionPreset[] = ["sahyadri-editor", "konkan-reviewer", "signed-out"];
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

const ANSWERS = {
  wrongCredentials: { kind: "answer", status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
  unverified: { kind: "answer", status: 403, code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
  invalidToken: { kind: "answer", status: 400, code: "INVALID_TOKEN", message: "Invalid token" },
  tooShort: { kind: "answer", status: 400, code: "PASSWORD_TOO_SHORT", message: "Password too short" },
  tooLong: { kind: "answer", status: 400, code: "PASSWORD_TOO_LONG", message: "Password too long" },
  signedOut: {
    kind: "answer",
    status: 401,
    code: "signed_out",
    message: "You are signed out. Sign in again; what you typed is kept on this device.",
    requestId: "mock-request",
  },
  notFound: {
    kind: "answer",
    status: 404,
    code: "not_found",
    message: "There is nothing here, or you do not have access to it.",
    requestId: "mock-request",
  },
  notAllowed: {
    kind: "answer",
    status: 403,
    code: "not_allowed",
    message: "Your role cannot do this. Ask an editor or the owner.",
    requestId: "mock-request",
  },
  serverError: {
    kind: "answer",
    status: 500,
    code: "server_error",
    message: "Something went wrong on our side. Try again.",
    requestId: "mock-request",
  },
} as const satisfies Readonly<Record<string, ApiProblem>>;

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

export function createMockSessionEnvironment(
  options: CreateMockSessionEnvironmentOptions = {},
): MockSessionEnvironment {
  const intercept = options.intercept ?? (async () => undefined);
  let preset: MockSessionPreset = "sahyadri-editor";
  let signedInUserId: string | undefined = userForPreset("sahyadri-editor");
  let accounts: MockAccount[] = createAccounts();
  let invitations: MockInvitation[] = createInvitations();
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

  function snapshot(): SessionSnapshot {
    const account = accounts.find((candidate) => candidate.userId === signedInUserId);
    if (!account) return { status: "signed-out" };
    return {
      status: "signed-in",
      session: {
        user: { id: account.userId, name: account.name, email: account.email, emailVerified: account.emailVerified },
      },
    };
  }

  function workspace(userId: string): WorkspaceAccessDto | undefined {
    const base = workspaceFor(userId);
    const chosen = active.get(userId);
    return base && chosen
      ? { ...base, activeOrganizationId: chosen.organizationId, activePublicationId: chosen.publicationId }
      : base;
  }

  /** The scenario's latency, failure or denial, then any problem set for this operation. */
  async function gate(operation: MockAuthOperation): Promise<ApiProblem | undefined> {
    const scenarioOperation = (operation.startsWith("session.") ? operation : undefined) as MockOperation | undefined;
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

  function setPreset(nextPreset: MockSessionPreset): void {
    if (!PRESETS.includes(nextPreset)) {
      throw new RangeError(`Unsupported mock session preset: ${String(nextPreset)}`);
    }
    beginMutation();
    preset = nextPreset;
    signedInUserId = nextPreset === "signed-out" ? undefined : userForPreset(nextPreset);
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
      signedInUserId = account.userId;
      preset = presetForUser(account.userId) ?? "signed-out";
      return success(snapshot());
    },

    async signOut() {
      beginMutation();
      const problem = await gate("session.signOut");
      if (problem) return failure(problem);
      signedInUserId = undefined;
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
      const current = userId === signedInUserId ? workspace(userId) : undefined;
      if (!current) return { ok: false, error: { ...DENIED } };
      const grant = current.access.find((candidate) => candidate.organizationId === organizationId);
      const publicationId = grant?.publicationIds[0];
      if (!publicationId) return { ok: false, error: { ...DENIED } };
      // a newer change (a sign-in, a sign-out, a reset, another choice) came first: this one no longer applies
      if (mutation !== mutationGeneration) return { ok: false, error: { ...TEMPORARY_FAILURE } };
      active.set(userId, { organizationId, publicationId });
      return success(workspace(userId) as WorkspaceAccessDto);
    },

    async selectPublication({ userId, organizationId, publicationId }) {
      const mutation = beginMutation();
      const intercepted = await accessGate("access.select");
      if (intercepted) return intercepted;
      const current = userId === signedInUserId ? workspace(userId) : undefined;
      if (!current) return { ok: false, error: { ...DENIED } };
      const grant = current.access.find((candidate) => candidate.organizationId === organizationId);
      if (!grant?.publicationIds.includes(publicationId)) return { ok: false, error: { ...DENIED } };
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
          { userId: `user-invited-${invitation.id}`, name: name.trim(), email: address, password, emailVerified: false },
        ];
        mail.push({ kind: "verify", to: address, returnPath });
      }
      return success(undefined);
    },

    async acceptInvitation({ invitationId, idempotencyKey }) {
      const problem = await gate("account.acceptInvitation");
      if (problem) return failure(problem);
      const current = snapshot();
      if (current.status === "signed-out") return signedOutAnswer();
      if (acceptedKeys.has(idempotencyKey)) return success(undefined); // a replay answers as the first time
      const invitation = invitations.find((candidate) => candidate.id === invitationId);
      if (!invitation || invitation.state !== "pending") return failure(ANSWERS.notFound);
      if (invitation.email !== current.session.user.email) return failure(ANSWERS.notAllowed);
      invitations = invitations.map((candidate) =>
        candidate.id === invitationId ? { ...candidate, state: "accepted" } : candidate,
      );
      acceptedKeys.add(idempotencyKey);
      return success(undefined);
    },
  };

  const pendingInvitation = createInvitations()[0] as MockInvitation;
  const [expired, accepted, revoked] = createInvitations().slice(1) as [MockInvitation, MockInvitation, MockInvitation];
  const seeded = createAccounts();
  const fixture = (index: number) => {
    const found = seeded[index] as MockAccount;
    return { email: found.email, password: found.password, name: found.name };
  };

  const sessionController: MockSessionController = {
    setPreset,
    getPreset: () => preset,
    reset() {
      beginMutation();
      preset = "sahyadri-editor";
      signedInUserId = userForPreset("sahyadri-editor");
      accounts = createAccounts();
      invitations = createInvitations();
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
      preset = "signed-out";
    },
    fixtures: {
      accounts: { editor: fixture(0), reviewer: fixture(1), unconfirmed: fixture(2) },
      invitations: {
        pending: { id: pendingInvitation.id, email: pendingInvitation.email },
        expired: { id: expired.id },
        accepted: { id: accepted.id },
        revoked: { id: revoked.id },
      },
      resetToken: resetTokenFixture().token,
    },
  };

  return {
    session,
    account,
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
