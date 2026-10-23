import type { AccountService } from "./account-service.ts";
import type { SecurityService } from "./security-service.ts";
import type { SessionService } from "./session-service.ts";
import type { MediaService } from "./media-service.ts";
import type { StoryService } from "./story-service.ts";
import type { TeamService } from "./team-service.ts";
import type { WorkspaceAccessService } from "./workspace-access.ts";
import type { WorkspaceQueryService } from "./workspace-query-service.ts";

/**
 * The services the app runs on: the real ones over the API (src/api/environment.ts) or the test double
 * (src/mocks).
 */
export interface ServiceEnvironment {
  readonly session: SessionService;
  readonly account: AccountService;
  readonly security: SecurityService;
  readonly team: TeamService;
  readonly stories: StoryService;
  readonly media: MediaService;
  /** The placeholder workspace's access; absent where nothing provides one (the deployed app, until `/me`). */
  readonly access?: WorkspaceAccessService;
  readonly workspace: WorkspaceQueryService;
  /** Ends every session change still in flight: a late answer must not overwrite a newer state. */
  readonly invalidatePendingSessionMutations: () => void;
  readonly getSessionMutationGeneration: () => number;
  /**
   * Calls `listener` when the API answers 401 `signed_out` (plan §5.1), so the app can send the person to sign in
   * again, keeping their place. Returns the unsubscribe function.
   */
  readonly onSignedOut?: (listener: () => void) => () => void;
}
