/**
 * The live updates double: what the API's event stream would bring this browser, by ids only. The other doubles call
 * `emit` when something changes that the person would hear of (the API's src/modules/notifications/events.ts decides
 * that from their access; the doubles ask the same rules). Tests may also emit an event themselves, or a `resync`.
 * One "stream" per organisation however many screens listen, as the real service holds one per browser.
 */
import type { LiveEventDto, LiveService } from "../services/index.ts";

export interface MockLiveController {
  /** Sends the event to everyone listening to the organisation in this "browser". */
  emit(orgId: string, event: LiveEventDto): void;
  /** How many streams are open: one per organisation listened to. */
  streams(): number;
  /** How many listeners an organisation has. */
  listeners(orgId: string): number;
  /** How many times every stream was ended (signing out). */
  stops(): number;
  /** The connection drops (true) or comes back (false): while dropped, what changes is never heard. */
  drop(dropped: boolean): void;
}

export function createMockLive(): { live: LiveService; controller: MockLiveController; reset(): void } {
  let byOrg = new Map<string, Set<(event: LiveEventDto) => void>>();
  let stopped = 0;
  let dropped = false;
  const live: LiveService = {
    listen(orgId, listener) {
      const listeners = byOrg.get(orgId) ?? new Set();
      listeners.add(listener);
      byOrg.set(orgId, listeners);
      const mine = byOrg;
      return () => {
        if (mine !== byOrg) return; // ended since (signed out)
        listeners.delete(listener);
        if (listeners.size === 0) byOrg.delete(orgId);
      };
    },
    stopAll() {
      stopped += 1;
      byOrg = new Map();
    },
  };
  return {
    live,
    controller: {
      emit(orgId, event) {
        if (dropped) return;
        for (const listener of [...(byOrg.get(orgId) ?? [])]) listener({ ...event });
      },
      streams: () => byOrg.size,
      listeners: (orgId) => byOrg.get(orgId)?.size ?? 0,
      stops: () => stopped,
      drop(value) {
        dropped = value;
      },
    },
    reset() {
      byOrg = new Map();
      stopped = 0;
      dropped = false;
    },
  };
}
