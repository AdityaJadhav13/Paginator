import { createContext, useContext, type ReactNode } from "react";
import type { ReleaseService } from "../../services/index.ts";

const ReleaseContext = createContext<ReleaseService | null>(null);

/** The release (L2.5): the edition's Release tab, page approval on the Pages board and in the page editor. */
export function ReleaseProvider({ release, children }: { readonly release: ReleaseService; readonly children: ReactNode }) {
  return <ReleaseContext.Provider value={release}>{children}</ReleaseContext.Provider>;
}

export function useRelease(): ReleaseService {
  const release = useContext(ReleaseContext);
  if (!release) throw new Error("useRelease() called outside ReleaseProvider.");
  return release;
}
