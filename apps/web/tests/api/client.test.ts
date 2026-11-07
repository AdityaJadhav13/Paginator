/**
 * The API client (docs/product/10-l2-newsroom-plan.md §4.5, §5.1): same origin with credentials, `X-Pageinator: 1` on
 * every request, JSON bodies, an Idempotency-Key only on a change that asks for one, every failure as a problem, and
 * a 401 `signed_out` told to the app.
 */
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { fakeFetch, json } from "./fake-fetch.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("Every request", () => {
  it("goes to this origin with its cookies, says X-Pageinator: 1, and asks for JSON", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { ok: true }));
    const client = createApiClient({ fetch });
    await client.get("/api/auth/get-session");
    await client.post("/api/auth/sign-out", {});
    await client.put("/api/v1/thing", { a: 1 });
    await client.patch("/api/v1/thing", { a: 2 });
    await client.delete("/api/v1/thing");
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "/api/auth/get-session"],
      ["POST", "/api/auth/sign-out"],
      ["PUT", "/api/v1/thing"],
      ["PATCH", "/api/v1/thing"],
      ["DELETE", "/api/v1/thing"],
    ]);
    for (const call of calls) {
      expect(call.headers.get("X-Pageinator")).toBe("1");
      expect(call.headers.get("Accept")).toBe("application/json");
      expect(call.credentials).toBe("same-origin");
    }
  });

  it("cannot be pointed at another origin", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    const client = createApiClient({ fetch });
    for (const path of ["https://evil.example/api/auth/sign-in/email", "//evil.example/api/x", "/login", "api/x"]) {
      await expect(client.post(path, {})).rejects.toThrow(/only calls this app's own \/api\/ paths/);
    }
    expect(calls).toEqual([]);
  });

  it("keeps X-Pageinator even when a caller passes its own headers", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    await createApiClient({ fetch }).post("/api/x", {}, { headers: { "X-Pageinator": "0", "X-Extra": "yes" } });
    expect(calls[0]!.headers.get("X-Pageinator")).toBe("1");
    expect(calls[0]!.headers.get("X-Extra")).toBe("yes");
  });

  it("sends a body as JSON, and a GET with none", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    const client = createApiClient({ fetch });
    await client.post("/api/auth/sign-in/email", { email: "asha@example.test", password: "a password", rememberMe: false });
    await client.get("/api/auth/get-session");
    expect(calls[0]!.headers.get("Content-Type")).toBe("application/json");
    expect(calls[0]!.body).toEqual({ email: "asha@example.test", password: "a password", rememberMe: false });
    expect(calls[1]!.headers.get("Content-Type")).toBeNull();
    expect(calls[1]!.body).toBeUndefined();
  });
});

describe("Idempotency-Key", () => {
  it("goes with a change that carries one, and never with a GET", async () => {
    const { fetch, calls } = fakeFetch(() => json(201, {}));
    const client = createApiClient({ fetch });
    await client.post("/api/v1/x", {}, { idempotencyKey: "key-post" });
    await client.put("/api/v1/x", {}, { idempotencyKey: "key-put" });
    await client.patch("/api/v1/x", {}, { idempotencyKey: "key-patch" });
    await client.delete("/api/v1/x", { idempotencyKey: "key-delete" });
    await client.get("/api/v1/x", { idempotencyKey: "key-get" });
    await client.post("/api/v1/x", {});
    expect(calls.map((call) => call.headers.get("Idempotency-Key"))).toEqual([
      "key-post",
      "key-put",
      "key-patch",
      "key-delete",
      null,
      null,
    ]);
  });

  it("is a new random UUID each time it is asked for", () => {
    const client = createApiClient({ fetch: fakeFetch(() => json(200, {})).fetch });
    const first = client.newIdempotencyKey();
    const second = client.newIdempotencyKey();
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });
});

describe("Answers", () => {
  it("returns a success's JSON, and null for an empty one", async () => {
    const answers = [json(200, { user: { id: "u" } }), new Response(null, { status: 204 })];
    const client = createApiClient({ fetch: fakeFetch(() => answers.shift()!).fetch });
    expect(await client.get("/api/x")).toEqual({ ok: true, status: 200, value: { user: { id: "u" } } });
    expect(await client.post("/api/x", {})).toEqual({ ok: true, status: 204, value: null });
  });

  it("reads the API's error envelope", async () => {
    const client = createApiClient({
      fetch: fakeFetch(() =>
        json(400, {
          error: {
            code: "invalid_request",
            message: "Some fields are not right.",
            details: [{ field: "body.email", message: "must be an email address" }],
            requestId: "req-1",
          },
        })
      ).fetch,
    });
    expect(await client.post("/api/v1/x", {})).toEqual({
      ok: false,
      problem: {
        kind: "answer",
        status: 400,
        code: "invalid_request",
        message: "Some fields are not right.",
        requestId: "req-1",
        details: [{ field: "body.email", message: "must be an email address" }],
      },
    });
  });

  it("reads Better Auth's own answers, with the request id from the header", async () => {
    const client = createApiClient({
      fetch: fakeFetch(() =>
        json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, { "X-Request-Id": "req-2" })
      ).fetch,
    });
    expect(await client.post("/api/auth/sign-in/email", {})).toEqual({
      ok: false,
      problem: { kind: "answer", status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password", requestId: "req-2" },
    });
  });

  it("names an answer without a code from its status, keeping Retry-After", async () => {
    const answers = [
      json(429, { message: "Too many requests. Please try again later." }, { "X-Retry-After": "120" }),
      new Response("Bad gateway", { status: 502 }),
      new Response(null, { status: 404 }),
      json(418, {}),
    ];
    const client = createApiClient({ fetch: fakeFetch(() => answers.shift()!).fetch });
    expect(await client.post("/api/auth/sign-in/email", {})).toMatchObject({
      problem: { status: 429, code: "slow_down", retryAfterSeconds: 120 },
    });
    expect(await client.get("/api/x")).toMatchObject({ problem: { status: 502, code: "server_error", message: "" } });
    expect(await client.get("/api/x")).toMatchObject({ problem: { status: 404, code: "not_found" } });
    expect(await client.get("/api/x")).toMatchObject({ problem: { status: 418, code: "http_418" } });
  });

  it("does not take a web page for an answer (a missing proxy serving the app's index.html)", async () => {
    const page = new Response("<!doctype html><html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    const client = createApiClient({ fetch: fakeFetch(() => page).fetch });
    expect(await client.get("/api/auth/get-session")).toEqual({
      ok: false,
      problem: { kind: "answer", status: 200, code: "unexpected_answer", message: "" },
    });
  });

  it("tells offline from a server that does not answer", async () => {
    let online = true;
    const client = createApiClient({ fetch: fakeFetch(() => new TypeError("Failed to fetch")).fetch, isOnline: () => online });
    expect(await client.get("/api/x")).toEqual({ ok: false, problem: { kind: "network" } });
    online = false;
    expect(await client.get("/api/x")).toEqual({ ok: false, problem: { kind: "offline" } });
  });

  it("gives up on a request without an answer, as if the network were down", async () => {
    vi.useFakeTimers();
    try {
      const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      const client = createApiClient({ fetch: hanging as typeof fetch, timeoutMs: 5_000 });
      const pending = client.get("/api/x");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toEqual({ ok: false, problem: { kind: "network" } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("A 401 signed_out", () => {
  it("tells the app, and only for signed_out", async () => {
    const answers = [
      json(401, { error: { code: "signed_out", message: "You are signed out.", requestId: "r" } }),
      json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }),
      json(403, { error: { code: "not_allowed", message: "No.", requestId: "r" } }),
    ];
    const onSignedOut = vi.fn();
    const client = createApiClient({ fetch: fakeFetch(() => answers.shift()!).fetch, onSignedOut });
    expect(await client.post("/api/v1/invitations/x/accept", {})).toMatchObject({ problem: { code: "signed_out" } });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    await client.post("/api/auth/sign-in/email", {});
    await client.post("/api/v1/x", {});
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });
});
