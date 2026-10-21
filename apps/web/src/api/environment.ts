/**
 * The app's real services: one API client, the session and account services over it, and the app's hearing of a
 * 401 `signed_out`. There is no workspace access source yet (the API's `/me`, plan PR 9), so a signed-in person has
 * no workspace here, and the placeholder workspace screens stay unreachable outside the tests (plan §2.6: they stay
 * dev-only; the deployed app shows only screens that work).
 */
import type { ServiceEnvironment, ServiceResult, WorkspaceQueryService } from "../services/index.ts";
import { createApiAccountService } from "./account-service.ts";
import { createApiClient, type ApiClientOptions } from "./client.ts";
import { createApiSessionService } from "./session-service.ts";

function nothing<T>(): Promise<ServiceResult<T>> {
  return Promise.resolve({
    ok: false,
    error: { code: "unavailable", resource: "organization", displayMessage: "This organization is not available." },
  });
}

/** No organisation, publication or edition exists here yet. */
const NO_WORKSPACE: WorkspaceQueryService = {
  listOrganizations: () => Promise.resolve({ ok: true, value: [] }),
  getOrganization: () => nothing(),
  listPublications: () => nothing(),
  getPublication: () => nothing(),
  getEdition: () => nothing(),
};

export function createApiEnvironment(options: Omit<ApiClientOptions, "onSignedOut"> = {}): ServiceEnvironment {
  const listeners = new Set<() => void>();
  const client = createApiClient({
    ...options,
    onSignedOut: () => {
      for (const listener of [...listeners]) listener();
    },
  });
  const inner = createApiSessionService(client);
  let generation = 0;
  return {
    session: {
      getSession: () => inner.getSession(),
      signIn: (input) => {
        generation += 1;
        return inner.signIn(input);
      },
      signOut: () => {
        generation += 1;
        return inner.signOut();
      },
    },
    account: createApiAccountService(client),
    workspace: NO_WORKSPACE,
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
