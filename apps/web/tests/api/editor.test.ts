/**
 * The real page editor service over a recording fetch (L2.4 review): the engine's calls wait as long as the API waits
 * for the engine (900 s, not the client's 30 s), glyph outlines may come from the browser's cache, and a refusal keeps
 * the engine's own words. Fictional.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiEditorService, EDIT_TIMEOUT_MS } from "../../src/api/editor-service.ts";
import { fakeFetch, json } from "./fake-fetch.ts";

const WHERE = { orgId: "o", pubId: "p", runId: "r", page: 1 };

afterEach(() => vi.useRealTimers());

describe("the page editor service", () => {
  it("waits for the engine past the client's own time limit, and gives up after 900 s", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const editor = createApiEditorService(createApiClient({ fetch: hanging as typeof fetch, timeoutMs: 30_000 }));
    const pending = editor.change({ ...WHERE, change: { kind: "refresh", rev: 0 } });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(EDIT_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("lets the browser cache glyph outlines, never the page", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { upem: 1000, glyphs: { "3": "M0 0Z" } }));
    const editor = createApiEditorService(createApiClient({ fetch }));
    await editor.glyphs({ ...WHERE, face: "a".repeat(24), ids: [3] });
    await editor.get(WHERE);
    expect(calls.map((c) => c.cache)).toEqual(["default", "no-store"]);
  });

  it("keeps a refusal's words (DeskText) and drops a current that is not one", async () => {
    const words = { text: "Fictional refusal.", code: null, params: null };
    const answers = [
      json(400, { error: { code: "edit_refused", message: "Refused.", current: words, requestId: "q" } }),
      json(400, { error: { code: "edit_refused", message: "Refused.", current: { nope: 1 }, requestId: "q" } }),
    ];
    const editor = createApiEditorService(createApiClient({ fetch: fakeFetch(() => answers.shift()!).fetch }));
    const change = { kind: "refresh", rev: 0 } as const;
    expect(await editor.change({ ...WHERE, change })).toMatchObject({
      error: { code: "edit_refused", current: words },
    });
    const second = await editor.change({ ...WHERE, change });
    expect(second.ok ? null : second.error).not.toHaveProperty("current");
  });
});
