/**
 * Live updates (plan §2, §5.2): what changed, by ids only; the screens fetch it again through the routes that check
 * access. `resync`: updates may have been missed (a reconnection, another tab taking over the stream): everything on
 * the screen is fetched afresh.
 */
export type LiveEventDto =
  | { readonly type: "story"; readonly publicationId: string; readonly storyId: string }
  | { readonly type: "comment"; readonly publicationId: string; readonly storyId: string; readonly commentId: string }
  | { readonly type: "notification"; readonly id: string }
  /** An edition of the publication was made or changed (its list and counts are fetched again). */
  | { readonly type: "edition"; readonly publicationId: string; readonly editionId: string }
  /** The person's own Word import finished (GET …/imports/:id tells how). */
  | { readonly type: "import"; readonly publicationId: string; readonly importId: string }
  /** An edition's layout changed: a run's state or page, an ad slot, its measuring (runId: the run, or null). */
  | {
      readonly type: "layout";
      readonly publicationId: string;
      readonly editionId: string;
      readonly runId: string | null;
    }
  /** An engine profile of the publication changed (setting up, ready or failed). */
  | { readonly type: "profile"; readonly publicationId: string; readonly profileId: string }
  /** The publication's onboarding moved on (a step, ready, rejected, failed, cancelled or used). */
  | { readonly type: "onboarding"; readonly publicationId: string; readonly onboardingId: string }
  | { readonly type: "resync" };

export interface LiveService {
  /**
   * Hears the organisation's live updates in this tab. The browser holds one stream per organisation for all its tabs
   * (the API allows a person five at once). Returns the function that stops hearing them.
   */
  listen(orgId: string, listener: (event: LiveEventDto) => void): () => void;
  /** Ends every stream of this browser (signing out), in this tab and in the others. */
  stopAll(): void;
}
