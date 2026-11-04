/**
 * The app's real services: one API client, the session, account, security and team services over it, the person's
 * workspace from the API's /me, and the app's hearing of a 401 `signed_out`.
 */
import type { ServiceEnvironment } from "../services/index.ts";
import { createApiAccountService } from "./account-service.ts";
import { createApiAuditService } from "./audit-service.ts";
import { createApiContactService } from "./contact-service.ts";
import { createApiClient, type ApiClientOptions } from "./client.ts";
import { createApiCommentService } from "./comment-service.ts";
import { createApiLiveService, type LiveOptions } from "./live.ts";
import { createApiNotificationService } from "./notification-service.ts";
import { createApiSecurityService } from "./security-service.ts";
import { createApiSessionService } from "./session-service.ts";
import { createApiStoryService } from "./story-service.ts";
import { createApiEditionService } from "./edition-service.ts";
import { createApiMediaService } from "./media-service.ts";
import { createApiLayoutService } from "./layout-service.ts";
import { createApiEditorService } from "./editor-service.ts";
import { createApiReleaseService } from "./release-service.ts";
import { createApiNewsService } from "./news-service.ts";
import { createApiTeamService } from "./team-service.ts";
import { createApiWorkspace } from "./workspace.ts";

export function createApiEnvironment(
  options: Omit<ApiClientOptions, "onSignedOut"> & { readonly live?: Omit<LiveOptions, "onSignedOut" | "fetch"> } = {},
): ServiceEnvironment {
  const listeners = new Set<() => void>();
  const signedOut = () => {
    forget(); // the session ended on the server: the next person must not inherit this one's workspace
    live.stopAll(); // and its live updates end, in every tab
    for (const listener of [...listeners]) listener();
  };
  const live = createApiLiveService({
    ...options.live,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    onSignedOut: () => signedOut(),
  });
  const client = createApiClient({ ...options, onSignedOut: signedOut });
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
          const result = await inner.signOut();
          // signed out: the live updates end in every tab of this browser
          if (result.ok) live.stopAll();
          return result;
        }),
    },
    account: createApiAccountService(client),
    security: createApiSecurityService(client),
    team: createApiTeamService(client),
    audit: createApiAuditService(client),
    stories: createApiStoryService(client),
    editions: createApiEditionService(client),
    contact: createApiContactService(client),
    media: createApiMediaService(client, { ...(options.fetch ? { fetch: options.fetch } : {}), onSignedOut: signedOut }),
    news: createApiNewsService(client),
    layout: createApiLayoutService(client, options.fetch ? { fetch: options.fetch } : {}),
    editor: createApiEditorService(client),
    release: createApiReleaseService(client),
    comments: createApiCommentService(client),
    notifications: createApiNotificationService(client),
    live,
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
