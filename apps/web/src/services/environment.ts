import type { AccountService } from "./account-service.ts";
import type { AuditService } from "./audit-service.ts";
import type { ContactService } from "./contact-service.ts";
import type { SecurityService } from "./security-service.ts";
import type { SessionService } from "./session-service.ts";
import type { CommentService } from "./comment-service.ts";
import type { LiveService } from "./live-service.ts";
import type { MediaService } from "./media-service.ts";
import type { LayoutService } from "./layout-service.ts";
import type { NewsService } from "./news-service.ts";
import type { NotificationService } from "./notification-service.ts";
import type { StoryService } from "./story-service.ts";
import type { EditionService } from "./edition-service.ts";
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
  /** The organisation's audit log. */
  readonly audit: AuditService;
  readonly stories: StoryService;
  readonly editions: EditionService;
  readonly media: MediaService;
  /** The news finder (L2.7): the Sources screen. */
  readonly news: NewsService;
  /** Editions and layout, hosted (L2.3): the engine profile, an edition's readiness, ads, runs and pages. */
  readonly layout: LayoutService;
  /** The public website's contact form. */
  readonly contact: ContactService;
  readonly comments: CommentService;
  readonly notifications: NotificationService;
  readonly live: LiveService;
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
