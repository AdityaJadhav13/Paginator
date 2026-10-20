import type { CreateMockServiceEnvironmentOptions } from "./create-mock-service-environment.ts";
import { createMockServiceEnvironment } from "./create-mock-service-environment.ts";
import {
  createMockSessionEnvironment,
  type MockSessionController,
} from "./create-mock-session-environment.ts";
import type {
  SimulatedSessionService,
  UserQueryService,
  WorkspaceQueryService,
} from "../services/index.ts";
import type { MockScenarioController } from "./scenarios.ts";

export interface MockApplicationEnvironment {
  readonly users: UserQueryService;
  readonly workspace: WorkspaceQueryService;
  readonly session: SimulatedSessionService;
  readonly scenarios: MockScenarioController;
  readonly sessionController: MockSessionController;
  readonly invalidatePendingSessionMutations: () => void;
  readonly getSessionMutationGeneration: () => number;
  reset(): void;
}

export function createMockApplicationEnvironment(
  options: CreateMockServiceEnvironmentOptions = {}
): MockApplicationEnvironment {
  const services = createMockServiceEnvironment(options);
  const sessionEnvironment = createMockSessionEnvironment(services.users);
  return {
    ...services,
    ...sessionEnvironment,
    reset() {
      services.scenarios.reset();
      sessionEnvironment.sessionController.reset();
    },
  };
}
