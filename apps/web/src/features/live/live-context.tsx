/**
 * The newsroom's live services for the screens: comments, notifications and live updates (plan §5.2).
 *
 * `OrgLive` hears the organisation's live updates while the person may (signed in, two-step done where it is asked,
 * publication.view somewhere in it), and hands each event to the screens that listen (`useLiveEvents`). The stream
 * itself is the live service's: one per organisation for all of the browser's tabs. It ends when the person signs out
 * (the session is then no longer ready, here and in every other tab) or leaves the organisation.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { CommentService, LiveEventDto, LiveService, NotificationService } from "../../services/index.ts";

interface Newsroom {
  readonly comments: CommentService;
  readonly notifications: NotificationService;
  readonly live: LiveService;
}

const NewsroomContext = createContext<Newsroom | null>(null);

export function NewsroomProvider({ children, ...services }: Newsroom & { readonly children: ReactNode }) {
  const { comments, notifications, live } = services;
  const value = useMemo(() => ({ comments, notifications, live }), [comments, live, notifications]);
  return <NewsroomContext.Provider value={value}>{children}</NewsroomContext.Provider>;
}

function useNewsroom(): Newsroom {
  const value = useContext(NewsroomContext);
  if (!value) throw new Error("The newsroom services are used outside NewsroomProvider.");
  return value;
}

export const useComments = (): CommentService => useNewsroom().comments;
export const useNotifications = (): NotificationService => useNewsroom().notifications;

type Listener = (event: LiveEventDto) => void;
const OrgLiveContext = createContext<{ subscribe(listener: Listener): () => void } | null>(null);

/** `orgId`: the organisation to hear, or null for nothing (the person may not hear it, or no workspace is open). */
export function OrgLive({ orgId, children }: { readonly orgId: string | null; readonly children: ReactNode }) {
  const { live } = useNewsroom();
  const listeners = useRef(new Set<Listener>());
  useEffect(() => {
    if (orgId === null) return;
    return live.listen(orgId, (event) => {
      for (const listener of [...listeners.current]) listener(event);
    });
  }, [live, orgId]);
  const value = useMemo(
    () => ({
      subscribe(listener: Listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [],
  );
  return <OrgLiveContext.Provider value={value}>{children}</OrgLiveContext.Provider>;
}

/** Calls `listener` with each live update of the organisation on screen (none outside a workspace). */
export function useLiveEvents(listener: Listener): void {
  const context = useContext(OrgLiveContext);
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => context?.subscribe((event) => latest.current(event)), [context]);
}
