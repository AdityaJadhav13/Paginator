/**
 * Live updates over the API's event stream, GET /api/v1/orgs/:o/events (text/event-stream; plan §2, §5.2).
 *
 * One stream per organisation per browser, not per tab (the API allows a person five at once, and answers 429 beyond):
 *   - the tabs of an organisation ask for one Web Lock, `pageinator.live.<org>`; the tab that holds it leads: it holds
 *     the stream and relays each event to the other tabs over a BroadcastChannel of the same name;
 *   - when the leading tab closes (or stops listening), the browser gives the lock to the next tab, which opens the
 *     stream and tells every tab to fetch afresh (`resync`): events may have been missed in between;
 *   - without Web Locks or BroadcastChannel (an old browser), each tab holds its own stream.
 * The stream is read with fetch, not EventSource, so its answer can be told apart:
 *   - 401 signed_out: the session ended; the app is told (onSignedOut), and nothing is retried;
 *   - 403 or 404 (two-step needed, no longer a member, no publication): nothing is retried;
 *   - 429 slow_down: wait (Retry-After, at least a minute) and try again, saying nothing on the screen;
 *   - an error, a dropped connection or a server that ended the stream: try again after the server's `retry` (5 s),
 *     doubling on each failure up to 5 minutes, with jitter; never a loop. Offline: wait until the browser is online.
 *   - a stream that brings nothing for a minute (its comment line comes every 25 s) is dropped and opened again.
 * After any gap (a reconnection, a takeover), every tab hears `resync`: the API sends it itself when the stream is
 * opened again with Last-Event-ID; otherwise this module does (also after a refused or 429-answered connection).
 * Signing out ends every stream, in every tab (`stopAll`); the leading tab keeps the lock a moment so no tab takes over.
 */
import type { LiveEventDto, LiveService } from "../services/index.ts";
import { API_HEADER, problemFromAnswer } from "./client.ts";

type Listener = (event: LiveEventDto) => void;

/** The part of the Web Locks API this uses (navigator.locks). */
export interface LockManagerLike {
  request(
    name: string,
    options: { readonly signal?: AbortSignal; readonly ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

/** The part of BroadcastChannel this uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export interface LiveOptions {
  readonly fetch?: typeof fetch;
  /** null: no Web Locks (each tab its own stream). */
  readonly locks?: LockManagerLike | null;
  /** null: no BroadcastChannel (each tab its own stream). */
  readonly channel?: ((name: string) => ChannelLike) | null;
  readonly onSignedOut?: () => void;
  readonly isOnline?: () => boolean;
  /** 0…1, for the jitter. */
  readonly random?: () => number;
}

/** The server's own `retry`, until it says otherwise. */
export const RETRY_MS = 5_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
/** After a 429: at least this long. */
export const SLOW_DOWN_MS = 60_000;
/** Nothing at all for this long (the comment line comes every 25 s): the connection is dead. */
export const SILENCE_MS = 60_000;
/** A stream open this long was healthy: the next failure starts the backoff again. */
export const HEALTHY_MS = 30_000;
/** After a sign-out, the leading tab keeps the lock this long, so the other tabs hear "stop" before they could take it. */
export const STOP_HOLD_MS = 1_000;

const STOP_CHANNEL = "pageinator.live";
const lockName = (orgId: string) => `pageinator.live.${orgId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stream event as the contract names it (ids only), or null for anything else. */
export function liveEventOf(type: string, data: unknown): LiveEventDto | null {
  if (!isRecord(data)) return null;
  switch (type) {
    case "story":
      return isId(data["publicationId"]) && isId(data["storyId"])
        ? { type, publicationId: data["publicationId"], storyId: data["storyId"] }
        : null;
    case "comment":
      return isId(data["publicationId"]) && isId(data["storyId"]) && isId(data["commentId"])
        ? { type, publicationId: data["publicationId"], storyId: data["storyId"], commentId: data["commentId"] }
        : null;
    case "notification":
      return isId(data["id"]) ? { type, id: data["id"] } : null;
    case "edition":
      return isId(data["publicationId"]) && isId(data["editionId"])
        ? { type, publicationId: data["publicationId"], editionId: data["editionId"] }
        : null;
    case "import":
      return isId(data["publicationId"]) && isId(data["importId"])
        ? { type, publicationId: data["publicationId"], importId: data["importId"] }
        : null;
    case "layout": {
      const runId = data["runId"];
      return isId(data["publicationId"]) && isId(data["editionId"]) && (runId === null || isId(runId))
        ? { type, publicationId: data["publicationId"], editionId: data["editionId"], runId }
        : null;
    }
    case "profile":
      return isId(data["publicationId"]) && isId(data["profileId"])
        ? { type, publicationId: data["publicationId"], profileId: data["profileId"] }
        : null;
    case "onboarding":
      return isId(data["publicationId"]) && isId(data["onboardingId"])
        ? { type, publicationId: data["publicationId"], onboardingId: data["onboardingId"] }
        : null;
    case "resync":
      return { type };
    default:
      return null;
  }
}

/** One block of the stream: its fields (a comment line is a block with none). */
interface Frame {
  readonly id?: string;
  readonly event?: string;
  readonly data?: string;
  readonly retry?: number;
}

function frameOf(block: string): Frame {
  let id: string | undefined;
  let event: string | undefined;
  let retry: number | undefined;
  const data: string[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "retry" && /^\d{1,7}$/.test(value)) retry = Number(value);
  }
  return {
    ...(id !== undefined ? { id } : {}),
    ...(event !== undefined ? { event } : {}),
    ...(data.length > 0 ? { data: data.join("\n") } : {}),
    ...(retry !== undefined ? { retry } : {}),
  };
}

/** Reads the stream's blocks until it ends. */
async function readFrames(body: ReadableStream<Uint8Array>, onFrame: (frame: Frame) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let at = buffer.indexOf("\n\n");
      while (at >= 0) {
        onFrame(frameOf(buffer.slice(0, at)));
        buffer = buffer.slice(at + 2);
        at = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Waits `ms`, or until stopped. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/** Waits until the browser is online again, or until stopped. */
function untilOnline(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || typeof window === "undefined") return resolve();
    function done() {
      window.removeEventListener("online", done);
      signal.removeEventListener("abort", done);
      resolve();
    }
    window.addEventListener("online", done);
    signal.addEventListener("abort", done);
  });
}

interface Entry {
  readonly orgId: string;
  readonly listeners: Set<Listener>;
  readonly stop: AbortController;
  channel: ChannelLike | null;
  leading: boolean;
}

function defaultLocks(): LockManagerLike | null {
  const locks = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManagerLike }).locks;
  return locks && typeof locks.request === "function" ? locks : null;
}

function defaultChannel(): ((name: string) => ChannelLike) | null {
  return typeof BroadcastChannel === "function" ? (name) => new BroadcastChannel(name) : null;
}

export function createApiLiveService(options: LiveOptions = {}): LiveService {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  const channels = options.channel === undefined ? defaultChannel() : options.channel;
  const online = options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const random = options.random ?? Math.random;
  const entries = new Map<string, Entry>();
  let stopChannel: ChannelLike | null = null;
  /** Set once told to stop (signed out): a lock this tab holds is kept a while, never handed on at once. */
  let stopping: Promise<void> | null = null;

  function deliverHere(entry: Entry, event: LiveEventDto) {
    for (const listener of [...entry.listeners]) {
      try {
        listener(event);
      } catch {
        // one screen's failure does not stop the others hearing it
      }
    }
  }

  /** The leading tab: to its own screens, and to the other tabs. */
  function deliver(entry: Entry, event: LiveEventDto) {
    if (entry.stop.signal.aborted) return;
    deliverHere(entry, event);
    entry.channel?.postMessage({ v: 1, kind: "event", orgId: entry.orgId, event });
  }

  function stopHere() {
    // shortcut: a "stop" message slower than STOP_HOLD_MS would still let a waiting tab open one stream (401 if signed out)
    stopping = new Promise((resolve) => setTimeout(resolve, STOP_HOLD_MS));
    for (const entry of entries.values()) {
      entry.stop.abort();
      entry.channel?.close();
    }
    entries.clear();
  }

  function listenForStop() {
    if (stopChannel || !channels) return;
    stopChannel = channels(STOP_CHANNEL);
    stopChannel.onmessage = (message) => {
      if (isRecord(message.data) && message.data["v"] === 1 && message.data["kind"] === "stop") stopHere();
    };
  }

  const backoff = (failures: number, retryMs: number) =>
    Math.min(MAX_BACKOFF_MS, retryMs * 2 ** Math.min(failures, 10)) * (0.75 + random() * 0.5);

  /** Holds the stream while this tab leads, until it stops listening. */
  async function run(entry: Entry, takeover: boolean): Promise<void> {
    const signal = entry.stop.signal;
    const url = `/api/v1/orgs/${encodeURIComponent(entry.orgId)}/events`;
    let failures = 0;
    let retryMs = RETRY_MS;
    /** A resync is owed once the stream opens: events may have been missed. */
    let gap = takeover;
    let lastId: string | undefined;
    while (!signal.aborted) {
      if (!online()) {
        await untilOnline(signal);
        continue;
      }
      const connection = new AbortController();
      const drop = () => connection.abort();
      signal.addEventListener("abort", drop);
      let silence: ReturnType<typeof setTimeout> | undefined;
      let healthy: ReturnType<typeof setTimeout> | undefined;
      const heard = () => {
        clearTimeout(silence);
        silence = setTimeout(drop, SILENCE_MS);
      };
      let wait: number;
      try {
        heard();
        const response = await fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            [API_HEADER]: "1",
            ...(lastId !== undefined ? { "Last-Event-ID": lastId } : {}),
          },
          credentials: "same-origin",
          cache: "no-store",
          signal: connection.signal,
        });
        if (response.status === 401) {
          const text = await response.text().catch(() => "");
          let body: unknown;
          try {
            body = text === "" ? undefined : JSON.parse(text);
          } catch {
            body = undefined;
          }
          const problem = problemFromAnswer(401, body, response.headers);
          if (problem.kind === "answer" && problem.code === "signed_out") options.onSignedOut?.();
          return;
        }
        // two-step needed, not a member, nothing to hear: asking again would be refused again
        if (response.status === 403 || response.status === 404) return;
        if (response.status === 429) {
          const raw = response.headers.get("Retry-After");
          const after = raw !== null && /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) * 1000 : 0;
          wait = Math.max(after, SLOW_DOWN_MS, backoff(failures, retryMs));
          failures += 1;
          gap = true;
        } else if (
          !response.ok ||
          !response.body ||
          !(response.headers.get("Content-Type") ?? "").includes("text/event-stream")
        ) {
          wait = backoff(failures, retryMs);
          failures += 1;
          gap = true;
        } else {
          // the API sends resync itself to a stream opened again with Last-Event-ID
          if (gap && lastId === undefined) deliver(entry, { type: "resync" });
          gap = false;
          healthy = setTimeout(() => {
            failures = 0;
          }, HEALTHY_MS);
          await readFrames(response.body, (frame) => {
            heard();
            if (frame.retry !== undefined) retryMs = Math.max(1_000, frame.retry);
            if (frame.id !== undefined) lastId = frame.id;
            if (frame.event === undefined || frame.data === undefined) return;
            let data: unknown;
            try {
              data = JSON.parse(frame.data);
            } catch {
              return;
            }
            const event = liveEventOf(frame.event, data);
            if (event) deliver(entry, event);
          });
          // the server ended the stream, or the connection was dropped
          gap = true;
          wait = backoff(failures, retryMs);
          failures += 1;
        }
      } catch {
        if (signal.aborted) return;
        gap = true;
        wait = backoff(failures, retryMs);
        failures += 1;
      } finally {
        clearTimeout(silence);
        clearTimeout(healthy);
        signal.removeEventListener("abort", drop);
      }
      await sleep(wait, signal);
    }
  }

  async function lead(entry: Entry, takeover: boolean): Promise<void> {
    entry.leading = true;
    try {
      await run(entry, takeover);
    } finally {
      entry.leading = false;
    }
    // signed out: the lock is released only after the other tabs have heard "stop"
    if (stopping) await stopping;
  }

  function start(entry: Entry) {
    const name = lockName(entry.orgId);
    entry.channel = channels ? channels(name) : null;
    if (entry.channel) {
      entry.channel.onmessage = (message) => {
        const data: unknown = message.data;
        if (entry.leading || !isRecord(data) || data["v"] !== 1 || data["kind"] !== "event" || data["orgId"] !== entry.orgId) return;
        const sent = data["event"];
        const event = isRecord(sent) && typeof sent["type"] === "string" ? liveEventOf(sent["type"], sent) : null;
        if (event) deliverHere(entry, event);
      };
    }
    if (!locks || !entry.channel) {
      void lead(entry, false);
      return;
    }
    void (async () => {
      try {
        const led = await locks.request(name, { ifAvailable: true }, async (lock) => {
          if (!lock || entry.stop.signal.aborted) return lock !== null;
          await lead(entry, false);
          return true;
        });
        if (led || entry.stop.signal.aborted) return;
        // another tab leads: this one hears its relays, and takes over when it goes
        await locks.request(name, { signal: entry.stop.signal }, async () => {
          if (!entry.stop.signal.aborted) await lead(entry, true);
        });
      } catch {
        // stopped while waiting for the lock
      }
    })();
  }

  return {
    listen(orgId, listener) {
      listenForStop();
      let entry = entries.get(orgId);
      if (!entry) {
        entry = { orgId, listeners: new Set(), stop: new AbortController(), channel: null, leading: false };
        entries.set(orgId, entry);
        start(entry);
      }
      const mine = entry;
      mine.listeners.add(listener);
      return () => {
        mine.listeners.delete(listener);
        if (mine.listeners.size > 0 || entries.get(orgId) !== mine) return;
        entries.delete(orgId);
        mine.stop.abort();
        mine.channel?.close();
      };
    },
    stopAll() {
      listenForStop();
      stopChannel?.postMessage({ v: 1, kind: "stop" });
      stopHere();
    },
  };
}
