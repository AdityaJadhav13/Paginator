/**
 * The app's real services: one API client, the session, account, security and team services over it, the person's
 * workspace from the API's /me, and the app's hearing of a 401 `signed_out`.
 */
import type { ServiceEnvironment } from "../services/index.ts";
import { createApiAccountService } from "./account-service.ts";
import { createApiClient, type ApiClientOptions } from "./client.ts";
import { createApiSecurityService } from "./security-service.ts";
import { createApiSessionService } from "./session-service.ts";
import { createApiStoryService } from "./story-service.ts";
import { createApiTeamService } from "./team-service.ts";
import { createApiWorkspace } from "./workspace.ts";

export function createApiEnvironment(options: Omit<ApiClientOptions, "onSignedOut"> = {}): ServiceEnvironment {
  const listeners = new Set<() => void>();
  const client = createApiClient({
    ...options,
    onSignedOut: () => {
      forget(); // the session ended on the server: the next person must not inherit this one's workspace
      for (const listener of [...listeners]) listener();
    },
  });
  const inner = createApiSessionService(client);
  const { access, workspace, forget } = createApiWorkspace(client);
  let generation = 0;
  const changes = <T,>(run: () => T): T => {
    generation += 1;
    return run();
  };
  return {
    session: {
      getSession: () => inner.getSession(),
      signIn: (input) => changes(() => inner.signIn(input)),
      verifyTwoStep: (input) => changes(() => inner.verifyTwoStep(input)),
      signOut: () =>
        changes(async () => {
          // whatever the answer, this browser forgets the person's workspace (a shared computer)
          forget();
          return inner.signOut();
        }),
    },
    account: createApiAccountService(client),
    security: createApiSecurityService(client),
    team: createApiTeamService(client),
    stories: createApiStoryService(client),
    access: {
      getAccess: (input) => access.getAccess(input),
      selectOrganization: (input) => changes(() => access.selectOrganization(input)),
      selectPublication: (input) => changes(() => access.selectPublication(input)),
    },
    workspace,
    invalidatePendingSessionMutations: () => {
      generation += 1;
    },
    getSessionMutationGeneration: () => generation,
    onSignedOut: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
