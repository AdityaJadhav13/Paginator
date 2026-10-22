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
  TeamService,
  UserQueryService,
  WorkspaceAccessService,
  WorkspaceQueryService,
} from "../services/index.ts";
import type { MockScenarioController } from "./scenarios.ts";

/** The whole app on test doubles: the placeholder workspace's fictional data and the session double. */
export interface MockApplicationEnvironment extends ServiceEnvironment {
  readonly users: UserQueryService;
  readonly workspace: WorkspaceQueryService;
  readonly session: SessionService;
  readonly account: AccountService;
  readonly security: SecurityService;
  readonly team: TeamService;
  readonly stories: StoryService;
  readonly access: WorkspaceAccessService;
  readonly scenarios: MockScenarioController;
  readonly sessionController: MockSessionController;
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
  return {
    users,
    workspace,
    scenarios,
    ...sessionEnvironment,
    reset() {
      scenarios.reset();
      sessionEnvironment.sessionController.reset();
    },
  };
}
