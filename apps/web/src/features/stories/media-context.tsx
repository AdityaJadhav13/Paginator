import { createContext, useContext, type ReactNode } from "react";
import type { MediaService } from "../../services/index.ts";

const MediaContext = createContext<MediaService | null>(null);

/** The photo uploads and downloads of the story editor. */
export function MediaProvider({ media, children }: { readonly media: MediaService; readonly children: ReactNode }) {
  return <MediaContext.Provider value={media}>{children}</MediaContext.Provider>;
}

export function useMedia(): MediaService {
  const media = useContext(MediaContext);
  if (!media) throw new Error("useMedia() called outside MediaProvider.");
  return media;
}
