// @vitest-environment node
/**
 * Live updates over the API's event stream (src/api/live.ts; plan §10 PR 23), with Node's own BroadcastChannel and
 * Web Locks standing in for a browser's tabs: one stream for all the tabs of an organisation (a leader chosen by the
 * lock, its events relayed to the others), a new leader when it goes (with `resync`), 429 waited out, `resync` after a
 * reconnection, a sign-out that ends the stream in every tab, and a 401/403 never retried. Fictional ids only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiLiveService, liveEventOf, SLOW_DOWN_MS } from "../../src/api/live.ts";
import type { LiveEventDto, LiveService } from "../../src/services/index.ts";

const PUB = "2d8e3f40-5162-4c73-8d84-9ea5fb6c0718";
const STORY = "7c1d2e3f-4051-4b62-9c73-8d94ea5fb601";
const STORY_EVENT = `event: story\ndata: ${JSON.stringify({ publicationId: PUB, storyId: STORY })}\n\n`;
/** Each test its own organisation: its own lock and channel. */
let orgCount = 0;
const newOrg = () => `0b6c1d2e-3f40-4a51-8b62-${String(++orgCount).padStart(12, "0")}`;

interface StreamCall {
  readonly url: string;
  readonly headers: Headers;
  readonly signal: AbortSignal;
  push(text: string): void;
  end(): void;
}

/** A fake server: answers from `answers` while it has some, else with an open event stream the test writes to. */
function sseServer(answers: Array<() => Response> = []) {
  const calls: StreamCall[] = [];
  const encoder = new TextEncoder();
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const signal = init.signal ?? new AbortController().signal;
    const call: StreamCall = {
      url: String(input),
      headers: new Headers(init.headers),
      signal,
      push: (text) => controller?.enqueue(encoder.encode(text)),
      end: () => controller?.close(),
    };
    calls.push(call);
    const answer = answers.shift();
    if (answer) return answer();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    signal.addEventListener("abort", () => {
      try {
        controller?.error(new DOMException("The connection was dropped.", "AbortError"));
      } catch {
        // already closed
      }
    });
    call.push("retry: 5000\n\n");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const problem = (status: number, code: string, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ error: { code, message: "", requestId: "r" } }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A tab: its live service and what it heard. */
function tab(fetch: typeof globalThis.fetch, orgId: string, options: Parameters<typeof createApiLiveService>[0] = {}) {
  const heard: LiveEventDto[] = [];
  const live = createApiLiveService({ fetch, random: () => 0.5, ...options });
  const stop = live.listen(orgId, (event) => heard.push(event));
  return { live, heard, stop };
}

const opened: LiveService[] = [];
afterEach(() => {
  for (const live of opened.splice(0)) live.stopAll();
  vi.useRealTimers();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("One stream for all the tabs of a browser", () => {
  it("opens one stream for three tabs; the leader relays every event to the others", async () => {
    const org = newOrg();
    const server = sseServer();
    const tabs = [tab(server.fetch, org), tab(server.fetch, org), tab(server.fetch, org)];
    opened.push(...tabs.map((one) => one.live));
    await vi.waitFor(() => expect(server.calls).toHaveLength(1));
    await settle();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]!.url).toBe(`/api/v1/orgs/${org}/events`);
    expect(server.calls[0]!.headers.get("Accept")).toBe("text/event-stream");

    server.calls[0]!.push(`id: 1\n${STORY_EVENT}`);
    const story = { type: "story", publicationId: PUB, storyId: STORY };
    await vi.waitFor(() => {
      for (const one of tabs) expect(one.heard).toEqual([story]);
    });
  });

  it("hands the stream to another tab when the leader closes, and every tab fetches afresh (resync)", async () => {
    const org = newOrg();
    const server = sseServer();
    const [first, second, third] = [tab(server.fetch, org), tab(server.fetch, org), tab(server.fetch, org)];
    opened.push(first.live, second.live, third.live);
    await vi.waitFor(() => expect(server.calls).toHaveLength(1));

    first.stop(); // the leading tab is closed
    await vi.waitFor(() => expect(server.calls[0]!.signal.aborted).toBe(true));
    await vi.waitFor(() => expect(server.calls).toHaveLength(2));
    await settle();
    expect(server.calls).toHaveLength(2); // one new leader, not two
    expect(server.calls[1]!.headers.has("Last-Event-ID")).toBe(false);
    await vi.waitFor(() => {
      expect(second.heard).toEqual([{ type: "resync" }]);
      expect(third.heard).toEqual([{ type: "resync" }]);
    });
  });

  it("without Web Locks or BroadcastChannel, each tab holds its own stream", async () => {
    const org = newOrg();
    const server = sseServer();
    const tabs = [tab(server.fetch, org, { locks: null, channel: null }), tab(server.fetch, org, { locks: null, channel: null })];
    opened.push(...tabs.map((one) => one.live));
    await vi.waitFor(() => expect(server.calls).toHaveLength(2));
  });
});

describe("Signing out ends the stream in every tab", () => {
  it("stopAll in one tab aborts the leader's stream in another, and no tab opens a new one", async () => {
    const org = newOrg();
    const server = sseServer();
    const leader = tab(server.fetch, org);
    await vi.waitFor(() => expect(server.calls).toHaveLength(1));
    const other = tab(server.fetch, org);
    opened.push(leader.live, other.live);
    await settle();

    other.live.stopAll(); // signed out in the other tab
    await vi.waitFor(() => expect(server.calls[0]!.signal.aborted).toBe(true));
    await settle();
    expect(server.calls).toHaveLength(1);
    expect(leader.heard).toEqual([]);
    expect(other.heard).toEqual([]);
  });

  it("stopAll in the leading tab: a waiting tab that takes the lock never opens a stream", async () => {
    const org = newOrg();
    const server = sseServer();
    // a BroadcastChannel whose messages arrive 20 ms late, as seen in a browser: the lock comes first
    const ports = new Set<{ name: string; onmessage: ((event: MessageEvent) => void) | null }>();
    const channel = (name: string) => {
      const port = {
        name,
        onmessage: null as ((event: MessageEvent) => void) | null,
        postMessage(data: unknown) {
          for (const other of ports)
            if (other !== port && other.name === name) setTimeout(() => other.onmessage?.({ data } as MessageEvent), 20);
        },
        close: () => ports.delete(port),
      };
      ports.add(port);
      return port;
    };
    const leader = tab(server.fetch, org, { channel });
    await vi.waitFor(() => expect(server.calls).toHaveLength(1));
    const waiting = [tab(server.fetch, org, { channel }), tab(server.fetch, org, { channel })];
    opened.push(leader.live, ...waiting.map((one) => one.live));
    await settle();

    leader.live.stopAll(); // signed out in the leading tab
    await vi.waitFor(() => expect(server.calls[0]!.signal.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(server.calls).toHaveLength(1);
  });

  it("a 401 signed_out tells the app and is never retried; a 403 is never retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onSignedOut = vi.fn();
    const signedOut = sseServer([problem(401, "signed_out")]);
    opened.push(tab(signedOut.fetch, newOrg(), { locks: null, channel: null, onSignedOut }).live);
    const refused = sseServer([problem(403, "two_step_required")]);
    opened.push(tab(refused.fetch, newOrg(), { locks: null, channel: null }).live);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(signedOut.calls).toHaveLength(1);
    expect(refused.calls).toHaveLength(1);
  });
});

describe("Backing off", () => {
  it("waits out a 429: Retry-After when it says more, at least a minute otherwise", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = sseServer([problem(429, "slow_down", { "Retry-After": "120" }), problem(429, "slow_down")]);
    opened.push(tab(server.fetch, newOrg(), { locks: null, channel: null }).live);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(server.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.calls).toHaveLength(2);

    // no Retry-After: a minute at least, never the stream's 5 s
    await vi.advanceTimersByTimeAsync(SLOW_DOWN_MS - 2_000);
    expect(server.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(server.calls).toHaveLength(3);
  });

  it("waits at least a minute after the server's own 429 (no Retry-After), then fetches afresh (resync)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = sseServer([problem(429, "slow_down")]);
    const one = tab(server.fetch, newOrg(), { locks: null, channel: null });
    opened.push(one.live);
    await vi.advanceTimersByTimeAsync(SLOW_DOWN_MS - 1_000);
    expect(server.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SLOW_DOWN_MS);
    expect(server.calls).toHaveLength(2);
    expect(one.heard).toEqual([{ type: "resync" }]); // whatever changed while refused is fetched again
  });

  it("fetches afresh (resync) once a refused first connection (500) opens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = sseServer([problem(500, "server_error")]);
    const one = tab(server.fetch, newOrg(), { locks: null, channel: null });
    opened.push(one.live);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(2);
    expect(one.heard).toEqual([{ type: "resync" }]);
  });

  it("doubles the wait after each failure (server errors), never a tight loop", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = sseServer([problem(500, "server_error"), problem(500, "server_error"), problem(500, "server_error")]);
    opened.push(tab(server.fetch, newOrg(), { locks: null, channel: null }).live);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000); // 5 s
    expect(server.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9_000); // then 10 s
    expect(server.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(19_000); // then 20 s
    expect(server.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.calls).toHaveLength(4);
  });
});

describe("Fetching afresh after a reconnection", () => {
  it("reconnects with Last-Event-ID; the API's own resync is passed on, and the client adds none", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = sseServer();
    const one = tab(server.fetch, newOrg(), { locks: null, channel: null });
    opened.push(one.live);
    await vi.advanceTimersByTimeAsync(0);
    server.calls[0]!.push(`id: 7\n${STORY_EVENT}`);
    server.calls[0]!.end(); // the server ended the stream
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]!.headers.get("Last-Event-ID")).toBe("7");
    server.calls[1]!.push("id: 1\nevent: resync\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(one.heard).toEqual([{ type: "story", publicationId: PUB, storyId: STORY }, { type: "resync" }]);
  });

  it("says resync itself when the dropped stream had brought no event id", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = sseServer();
    const one = tab(server.fetch, newOrg(), { locks: null, channel: null });
    opened.push(one.live);
    await vi.advanceTimersByTimeAsync(0);
    expect(one.heard).toEqual([]); // the first stream owes no resync
    server.calls[0]!.end();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls[1]!.headers.has("Last-Event-ID")).toBe(false);
    expect(one.heard).toEqual([{ type: "resync" }]);
  });

  it("drops a stream silent for a minute (no heartbeat) and opens it again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = sseServer();
    opened.push(tab(server.fetch, newOrg(), { locks: null, channel: null }).live);
    await vi.advanceTimersByTimeAsync(50_000);
    server.calls[0]!.push(": heartbeat\n\n"); // a heartbeat keeps it
    await vi.advanceTimersByTimeAsync(50_000);
    expect(server.calls[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(server.calls[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls).toHaveLength(2);
  });
});

describe("What an event may carry", () => {
  it("passes on ids only, and drops anything else", () => {
    expect(liveEventOf("story", { publicationId: PUB, storyId: STORY })).toEqual({ type: "story", publicationId: PUB, storyId: STORY });
    expect(liveEventOf("story", { publicationId: PUB, storyId: "<script>" })).toBeNull();
    expect(liveEventOf("notification", { id: STORY })).toEqual({ type: "notification", id: STORY });
    expect(liveEventOf("audit", { id: STORY })).toBeNull();
    expect(liveEventOf("import", { publicationId: PUB, importId: STORY })).toEqual({ type: "import", publicationId: PUB, importId: STORY });
    expect(liveEventOf("import", { publicationId: PUB, importId: "import-1" })).toBeNull();
    expect(liveEventOf("edition", { publicationId: PUB, editionId: STORY })).toEqual({ type: "edition", publicationId: PUB, editionId: STORY });
    expect(liveEventOf("edition", { publicationId: PUB })).toBeNull();
    expect(liveEventOf("resync", {})).toEqual({ type: "resync" });
  });
});
