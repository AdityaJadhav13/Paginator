/**
 * Live updates (plan §2, §5.2): what changed, by ids only; the screens fetch it again through the routes that check
 * access. `resync`: updates may have been missed (a reconnection, another tab taking over the stream): everything on
 * the screen is fetched afresh.
 */
export type LiveEventDto =
  | { readonly type: "story"; readonly publicationId: string; readonly storyId: string }
  | { readonly type: "comment"; readonly publicationId: string; readonly storyId: string; readonly commentId: string }
  | { readonly type: "notification"; readonly id: string }
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
