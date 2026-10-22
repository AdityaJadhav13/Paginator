import { createContext, useContext, type ReactNode } from "react";
import type { StoryService } from "../../services/index.ts";

const StoriesContext = createContext<StoryService | null>(null);

/** The story service for the Stories list and the story editor. */
export function StoriesProvider({ stories, children }: { readonly stories: StoryService; readonly children: ReactNode }) {
  return <StoriesContext.Provider value={stories}>{children}</StoriesContext.Provider>;
}

export function useStories(): StoryService {
  const stories = useContext(StoriesContext);
  if (!stories) throw new Error("useStories() called outside StoriesProvider.");
  return stories;
}
