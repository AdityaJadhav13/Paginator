import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { EditionService, PubEditionDto } from "../../services/index.ts";
import { useLiveEvents } from "../live/live-context.tsx";

const EditionsContext = createContext<EditionService | null>(null);

/** The edition service for the Editions screen, the Stories list's filter and the story editor. */
export function EditionsProvider({ editions, children }: { readonly editions: EditionService; readonly children: ReactNode }) {
  return <EditionsContext.Provider value={editions}>{children}</EditionsContext.Provider>;
}

export function useEditions(): EditionService {
  const editions = useContext(EditionsContext);
  if (!editions) throw new Error("useEditions() called outside EditionsProvider.");
  return editions;
}

/**
 * The publication's editions for a picker (the Stories filter, the story editor), fetched again when one is made or
 * changed; null while not fetched, not wanted (`enabled` false), or refused: the picker then offers what it has.
 */
export function usePublicationEditions(orgId: string, pubId: string, enabled: boolean): readonly PubEditionDto[] | null {
  const editions = useEditions();
  const [items, setItems] = useState<readonly PubEditionDto[] | null>(null);
  const [asked, setAsked] = useState(0);
  useLiveEvents((event) => {
    if (event.type === "resync" || (event.type === "edition" && event.publicationId === pubId)) setAsked((count) => count + 1);
  });
  useEffect(() => {
    if (!enabled) return setItems(null);
    let current = true;
    void editions.list({ orgId, pubId }).then((result) => {
      if (current) setItems(result.ok ? result.value : null);
    });
    return () => {
      current = false;
    };
  }, [editions, enabled, orgId, pubId, asked]);
  return items;
}
