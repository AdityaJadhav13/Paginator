import type {
  ServiceResult,
  SessionSnapshot,
  SimulatedProfileDto,
  SimulatedSessionDto,
  SimulatedSessionService,
  UserQueryService,
} from "../services/index.ts";
import {
  presetForUser,
  createProfileDtos,
  sessionForPreset,
} from "./session-seed.ts";

export type MockSessionPreset = "sahyadri-editor" | "konkan-reviewer" | "signed-out";

export interface MockSessionController {
  setPreset(preset: MockSessionPreset): void;
  getPreset(): MockSessionPreset;
  reset(): void;
}

export interface MockSessionEnvironment {
  readonly session: SimulatedSessionService;
  readonly sessionController: MockSessionController;
  readonly invalidatePendingSessionMutations: () => void;
  readonly getSessionMutationGeneration: () => number;
}

const DENIED = {
  code: "denied" as const,
  displayMessage: "This demonstration action is not available in the current context." as const,
  qualification: "Demonstration only — production authorization is not evaluated here" as const,
};

function success<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

function denied<T>(): ServiceResult<T> {
  return { ok: false, error: { ...DENIED } };
}

function copySession(session: SimulatedSessionDto): SimulatedSessionDto {
  return {
    ...session,
    access: session.access.map((grant) => ({
      ...grant,
      publicationIds: [...grant.publicationIds],
    })),
  };
}

export function createMockSessionEnvironment(
  users: UserQueryService
): MockSessionEnvironment {
  let preset: MockSessionPreset = "sahyadri-editor";
  let activeSession: SimulatedSessionDto | undefined = sessionForPreset("sahyadri-editor");
  let mutationGeneration = 0;

  function beginMutation(): number {
    mutationGeneration += 1;
    return mutationGeneration;
  }

  function snapshot(): SessionSnapshot {
    return activeSession
      ? { status: "signed-in", session: copySession(activeSession) }
      : { status: "signed-out" };
  }

  const session: SimulatedSessionService = {
    async listProfiles() {
      const profiles: SimulatedProfileDto[] = createProfileDtos();
      return success(profiles.map((profile) => ({ ...profile })));
    },

    async getSession() {
      return success(snapshot());
    },

    async signIn({ userId }) {
      const mutation = beginMutation();
      const profilePreset = presetForUser(userId);
      if (!profilePreset) return denied();
      const user = await users.getUser({ userId });
      if (!user.ok) return user;
      if (mutation !== mutationGeneration) return success(snapshot());
      preset = profilePreset;
      activeSession = sessionForPreset(profilePreset);
      return success(snapshot());
    },

    async signOut() {
      beginMutation();
      preset = "signed-out";
      activeSession = undefined;
      return success(snapshot());
    },

    async selectOrganization({ organizationId }) {
      beginMutation();
      if (!activeSession) return denied();
      const grant = activeSession.access.find(
        (candidate) => candidate.organizationId === organizationId
      );
      if (!grant || !grant.publicationIds[0]) return denied();
      activeSession = {
        ...activeSession,
        activeOrganizationId: organizationId,
        activePublicationId: grant.publicationIds[0],
      };
      return success(snapshot());
    },

    async selectPublication({ organizationId, publicationId }) {
      beginMutation();
      if (!activeSession) return denied();
      const grant = activeSession.access.find(
        (candidate) => candidate.organizationId === organizationId
      );
      if (!grant?.publicationIds.includes(publicationId)) return denied();
      activeSession = {
        ...activeSession,
        activeOrganizationId: organizationId,
        activePublicationId: publicationId,
      };
      return success(snapshot());
    },
  };

  const sessionController: MockSessionController = {
    setPreset(nextPreset) {
      if (!["sahyadri-editor", "konkan-reviewer", "signed-out"].includes(nextPreset)) {
        throw new RangeError(`Unsupported mock session preset: ${String(nextPreset)}`);
      }
      beginMutation();
      preset = nextPreset;
      activeSession =
        nextPreset === "signed-out" ? undefined : sessionForPreset(nextPreset);
    },
    getPreset() {
      return preset;
    },
    reset() {
      beginMutation();
      preset = "sahyadri-editor";
      activeSession = sessionForPreset("sahyadri-editor");
    },
  };

  return {
    session,
    sessionController,
    invalidatePendingSessionMutations: () => {
      beginMutation();
    },
    getSessionMutationGeneration: () => mutationGeneration,
  };
}
