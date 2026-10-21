// Every error leaves the API as the contract's envelope, with the request id, and without internals.
import type { IncomingMessage } from "node:http";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ErrorEnvelope } from "@pageinator/contracts";
import type { App } from "../../src/app.ts";
import { childLoggerFactory } from "../../src/http/context.ts";
import { ApiError } from "../../src/http/errors.ts";
import { FROM_APP, UUID, testApp } from "./helpers.ts";

let app: App;
afterEach(async () => {
  await app.close();
});

async function stories(): Promise<App> {
  const a = await testApp();
  const Story = z.strictObject({ headline: z.string().min(1), priority: z.number().int().min(1).max(4) });
  a.post("/test/stories", { schema: { body: Story } }, async (request) => ({ headline: request.body.headline }));
  return a;
}

describe("error envelope", () => {
  it("answers an unknown path with 404 not_found", async () => {
    app = await testApp();
    const res = await app.inject({ url: "/no/such/page" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    // every error answer carries the baseline headers, before any security plugin is added
    expect(res.headers["content-security-policy"]).toBe("default-src 'none';frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(ErrorEnvelope.parse(res.json())).toEqual({
      error: {
        code: "not_found",
        message: "There is nothing here, or you do not have access to it.",
        requestId: res.headers["x-request-id"],
      },
    });
  });

  it("answers a body that fails its schema with 400 invalid_request and each wrong field", async () => {
    app = await stories();
    const payload = { headline: "", priority: 9, extra: true };
    const res = await app.inject({ method: "POST", url: "/test/stories", headers: FROM_APP, payload });
    expect(res.statusCode).toBe(400);
    const { error } = ErrorEnvelope.parse(res.json());
    expect(error.code).toBe("invalid_request");
    expect(error.message).toBe("Some fields are not right.");
    expect(error.details?.map((d) => d.field).sort()).toEqual(["body", "body.headline", "body.priority"]);
    const ok = await app.inject({
      method: "POST",
      url: "/test/stories",
      headers: FROM_APP,
      payload: { headline: "काल्पनिकनगर", priority: 1 },
    });
    expect(ok.json()).toEqual({ headline: "काल्पनिकनगर" });
  });

  it("answers JSON it cannot read with 400, without the parser's words", async () => {
    app = await stories();
    const headers = { ...FROM_APP, "content-type": "application/json" };
    const res = await app.inject({ method: "POST", url: "/test/stories", headers, payload: '{"headline": ' });
    expect(res.statusCode).toBe(400);
    const { error } = ErrorEnvelope.parse(res.json());
    expect(error).toEqual({
      code: "invalid_request",
      message: "This request could not be read.",
      requestId: error.requestId,
    });
  });

  it("refuses a body that is not JSON (415) or is too large (413)", async () => {
    app = await stories();
    const text = await app.inject({
      method: "POST",
      url: "/test/stories",
      headers: { ...FROM_APP, "content-type": "text/plain" },
      payload: "headline=Kalpaniknagar",
    });
    expect(text.statusCode).toBe(415);
    expect(ErrorEnvelope.parse(text.json()).error.code).toBe("not_json");
    const huge = { headline: "x".repeat(1024 * 1024), priority: 1 };
    const large = await app.inject({ method: "POST", url: "/test/stories", headers: FROM_APP, payload: huge });
    expect(large.statusCode).toBe(413);
    expect(ErrorEnvelope.parse(large.json()).error.code).toBe("request_too_large");
  });

  it("answers an unexpected failure with 500 server_error and a reference, never the internals", async () => {
    app = await testApp();
    app.get("/test/crash", async () => {
      throw new Error("pool password=hunter2 at /srv/pageinator/db.ts:12");
    });
    const Count = z.object({ count: z.number() });
    app.get("/test/bad-answer", { schema: { response: { 200: Count } } }, async () => ({ count: "secret" }) as never);
    for (const url of ["/test/crash", "/test/bad-answer"]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(500);
      const { error } = ErrorEnvelope.parse(res.json());
      expect(error).toEqual({
        code: "server_error",
        message: `Something went wrong on our side. Try again. Reference: ${error.requestId}`,
        requestId: res.headers["x-request-id"],
      });
      for (const leak of ["hunter2", "/srv", "db.ts", "secret", "stack", "Response doesn't match"]) {
        expect(res.body, url).not.toContain(leak);
      }
    }
  });

  it("answers a handler that throws or rejects with null or undefined with the 500 envelope too", async () => {
    app = await testApp();
    app.get("/test/throw-null", () => {
      throw null;
    });
    app.get("/test/throw-undefined", () => {
      throw undefined;
    });
    app.get("/test/reject-null", async () => Promise.reject(null));
    app.get("/test/reject-undefined", async () => {
      throw undefined;
    });
    for (const url of ["/test/throw-null", "/test/throw-undefined", "/test/reject-null", "/test/reject-undefined"]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(500);
      expect(ErrorEnvelope.parse(res.json()).error, url).toEqual({
        code: "server_error",
        message: `Something went wrong on our side. Try again. Reference: ${res.headers["x-request-id"]}`,
        requestId: res.headers["x-request-id"],
      });
      expect(res.body, url).not.toContain("Cannot read properties");
    }
  });

  it("trusts a status only from Fastify's own refusals: any other failure is a 500 server_error", async () => {
    app = await testApp();
    const failures: Record<string, object> = {
      "status-401": { statusCode: 401 },
      "status-404": { statusCode: 404 },
      "status-418": { statusCode: 418 },
      "plugin-fst-400": { statusCode: 400, code: "FST_SOME_PLUGIN_REFUSAL" },
      "core-fst-not-a-refusal": { statusCode: 400, code: "FST_ERR_CTP_INSTANCE_ALREADY_STARTED" },
    };
    for (const [name, props] of Object.entries(failures)) {
      app.get(`/test/${name}`, async () => {
        throw Object.assign(new Error("the upstream service said no"), props);
      });
    }
    // a 400 raised after the body was read is not a body problem either
    app.post("/test/after-body", async () => {
      throw Object.assign(new Error("the upstream service said no"), { statusCode: 400 });
    });
    const answers = [
      ...Object.keys(failures).map((name) => app.inject({ url: `/test/${name}` })),
      app.inject({ method: "POST", url: "/test/after-body", headers: FROM_APP, payload: { headline: "x" } }),
    ];
    for (const res of await Promise.all(answers)) {
      expect(res.statusCode).toBe(500);
      expect(ErrorEnvelope.parse(res.json()).error.code).toBe("server_error");
      expect(res.body).not.toContain("upstream");
    }
  });

  it("trusts no 400 raised before the body is read: a hook's error on a request with a body is a 500", async () => {
    app = await testApp();
    const raised = [{ statusCode: 400, code: "FST_SOME_PLUGIN_REFUSAL" }, { statusCode: 400 }];
    raised.forEach((props, i) => {
      app.post(`/test/hook-${i}`, {
        // the phase of a plugin's or a library's hook (a session lookup, an idempotency check)
        onRequest: async () => {
          throw Object.assign(new Error("a fault on our side"), props);
        },
        handler: async () => ({ ok: true }),
      });
    });
    for (const i of raised.keys()) {
      const res = await app.inject({
        method: "POST",
        url: `/test/hook-${i}`,
        headers: FROM_APP,
        payload: { headline: "x" },
      });
      expect(res.statusCode, String(i)).toBe(500);
      expect(ErrorEnvelope.parse(res.json()).error.code).toBe("server_error");
    }
  });

  it.each([
    ["an empty JSON body", { method: "POST", headers: { "content-type": "application/json" }, payload: "" }],
    [
      "a body shorter than its Content-Length",
      { method: "POST", headers: { "content-type": "application/json", "content-length": "100" }, payload: "{}" },
    ],
    ["a QUERY without a Content-Type", { method: "QUERY", headers: {}, payload: "x" }],
  ] as const)("answers %s with 400 invalid_request (one of Fastify's own refusals)", async (_name, request) => {
    app = await testApp();
    app.post("/test/body", async () => ({ ok: true }));
    app.route({ method: "QUERY", url: "/test/body", handler: async () => ({ ok: true }) });
    const res = await app.inject({
      method: request.method as "POST",
      url: "/test/body",
      headers: { ...FROM_APP, ...request.headers },
      payload: request.payload,
    });
    expect(res.statusCode).toBe(400);
    expect(ErrorEnvelope.parse(res.json()).error).toEqual({
      code: "invalid_request",
      message: "This request could not be read.",
      requestId: res.headers["x-request-id"],
    });
  });

  it("answers what Fastify refuses before routing (a malformed URL, an over-long parameter) with the envelope", async () => {
    app = await testApp();
    app.get("/test/stories/:storyId", async () => ({ found: true }));
    for (const url of ["/%zz", "/%", "/test/%E0%A4", `/test/stories/${"x".repeat(101)}`]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(400);
      expect(res.headers["x-request-id"], url).toMatch(UUID);
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
      expect(res.headers["content-security-policy"], url).toBe("default-src 'none';frame-ancestors 'none'");
      expect(res.headers["x-frame-options"], url).toBe("DENY");
      expect(ErrorEnvelope.parse(res.json()).error, url).toEqual({
        code: "invalid_request",
        message: "This request could not be read.",
        requestId: res.headers["x-request-id"],
      });
    }
    expect((await app.inject({ url: `/test/stories/${"x".repeat(100)}` })).statusCode).toBe(200);
  });

  it("sends details only when there are some", async () => {
    app = await testApp();
    app.get("/test/refused", async () => {
      throw new ApiError("invalid_request", []);
    });
    const res = await app.inject({ url: "/test/refused" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: "invalid_request", message: "Some fields are not right.", requestId: res.headers["x-request-id"] },
    });
  });
});

describe("server settings", () => {
  it("limits a request to 120 s and its body to 1 MiB", async () => {
    app = await testApp();
    expect(app.server.requestTimeout).toBe(120_000);
    expect(app.initialConfig.bodyLimit).toBe(1_048_576);
  });
});

describe("request ids", () => {
  it("always uses the server's own id, in the header and the envelope, even when the caller sends one", async () => {
    app = await testApp();
    const res = await app.inject({ url: "/no/such/page", headers: { "x-request-id": "desk-phone.42:retry-1" } });
    expect(res.headers["x-request-id"]).toMatch(UUID);
    expect(res.json().error.requestId).toBe(res.headers["x-request-id"]);
    expect(app.childLoggerFactory).toBe(childLoggerFactory); // which logs the caller's id (next test)
  });

  it("logs a caller's plain id beside the server's as clientRequestId, and ignores one that is not plain", () => {
    const bound: object[] = [];
    const logger = { child: (bindings: object) => (bound.push(bindings), logger) } as unknown as FastifyBaseLogger;
    const raw = (id?: string) => ({ headers: id === undefined ? {} : { "x-request-id": id } }) as IncomingMessage;
    const fakeApp = {} as FastifyInstance;
    for (const id of ["desk-phone.42:retry-1", "has space", "<script>", "a,b", "x".repeat(129), "", undefined]) {
      childLoggerFactory.call(fakeApp, logger, { reqId: "server-id" }, {}, raw(id));
    }
    expect(bound).toEqual([
      { reqId: "server-id", clientRequestId: "desk-phone.42:retry-1" },
      ...Array.from({ length: 6 }, () => ({ reqId: "server-id" })),
    ]);
  });

  it("makes a new id for every request that brings none", async () => {
    app = await testApp();
    const [a, b] = [await app.inject({ url: "/healthz" }), await app.inject({ url: "/healthz" })];
    expect(a.headers["x-request-id"]).toMatch(UUID);
    expect(b.headers["x-request-id"]).toMatch(UUID);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });
});
