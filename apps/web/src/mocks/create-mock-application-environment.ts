import type { CreateMockServiceEnvironmentOptions } from "./create-mock-service-environment.ts";
import { createMockServiceEnvironment } from "./create-mock-service-environment.ts";
import {
  createMockSessionEnvironment,
  type MockSessionController,
} from "./create-mock-session-environment.ts";
import type {
  AccountService,
  SecurityService,
  ServiceEnvironment,
  SessionService,
  StoryService,
  MediaService,
  TeamService,
  UserQueryService,
  WorkspaceAccessService,
  WorkspaceQueryService,
} from "../services/index.ts";
import type { MockScenarioController } from "./scenarios.ts";
import { createMockContact, type MockContactController } from "./create-mock-contact.ts";

/** The whole app on test doubles: the placeholder workspace's fictional data and the session double. */
export interface MockApplicationEnvironment extends ServiceEnvironment {
  readonly users: UserQueryService;
  readonly workspace: WorkspaceQueryService;
  readonly session: SessionService;
  readonly account: AccountService;
  readonly security: SecurityService;
  readonly team: TeamService;
  readonly stories: StoryService;
  readonly media: MediaService;
  readonly access: WorkspaceAccessService;
  readonly scenarios: MockScenarioController;
  readonly sessionController: MockSessionController;
  readonly contactController: MockContactController;
  readonly invalidatePendingSessionMutations: () => void;
  readonly getSessionMutationGeneration: () => number;
  readonly onSignedOut: (listener: () => void) => () => void;
  reset(): void;
}

export function createMockApplicationEnvironment(
  options: CreateMockServiceEnvironmentOptions = {}
): MockApplicationEnvironment {
  const { users, workspace, scenarios, intercept } = createMockServiceEnvironment(options);
  const sessionEnvironment = createMockSessionEnvironment({ intercept });
  const { contact, contactController } = createMockContact();
  return {
    users,
    workspace,
    scenarios,
    ...sessionEnvironment,
    contact,
    contactController,
    reset() {
      scenarios.reset();
      sessionEnvironment.sessionController.reset();
      contactController.reset();
    },
  };
}
