// The security baseline of docs/product/10-l2-newsroom-plan.md §4.5–4.7: the Origin and header guard, Helmet's
// headers and the request limit.
import { afterEach, describe, expect, it } from "vitest";
import { ErrorEnvelope } from "@pageinator/contracts";
import type { App } from "../../src/app.ts";
import { FROM_APP, ORIGIN, testApp } from "./helpers.ts";

const CHANGES = ["POST", "PUT", "PATCH", "DELETE"] as const;

let app: App;
afterEach(async () => {
  await app.close();
});

/** An app with a route that changes something, for the guard to protect. */
async function withChange(env: Record<string, string> = {}): Promise<App> {
  const a = await testApp(env);
  for (const method of CHANGES) a.route({ method, url: "/test/change", handler: async () => ({ changed: true }) });
  return a;
}

async function expectBadOrigin(headers: Record<string, string>, method: (typeof CHANGES)[number] = "POST") {
  const res = await app.inject({ method, url: "/test/change", headers });
  expect(res.statusCode, JSON.stringify(headers)).toBe(403);
  expect(ErrorEnvelope.parse(res.json()).error).toEqual({
    code: "bad_origin",
    message: "This request did not come from Pageinator.",
    requestId: res.headers["x-request-id"],
  });
}

describe("origin guard", () => {
  it("lets the app's own requests through, for every method that changes something", async () => {
    app = await withChange();
    for (const method of CHANGES) {
      const res = await app.inject({ method, url: "/test/change", headers: FROM_APP });
      expect(res.statusCode, method).toBe(200);
    }
  });

  it("refuses a request without X-Pageinator: 1", async () => {
    app = await withChange();
    for (const method of CHANGES) await expectBadOrigin({ origin: ORIGIN }, method);
    await expectBadOrigin({ origin: ORIGIN, "x-pageinator": "0" });
    await expectBadOrigin({ origin: ORIGIN, "x-pageinator": "true" });
  });

  it("refuses an origin that is not allowed, or none at all", async () => {
    app = await withChange();
    for (const origin of [
      "https://other.example.test",
      "https://app.example.test.other.example.test",
      "https://app.example.test:8443",
      "http://app.example.test",
      "null",
    ]) {
      await expectBadOrigin({ origin, "x-pageinator": "1" });
    }
    await expectBadOrigin({ "x-pageinator": "1" });
  });

  it("refuses Sec-Fetch-Site: cross-site (in any case), an unknown value or a repeated header", async () => {
    app = await withChange();
    for (const site of [
      "cross-site",
      "CROSS-SITE",
      "Cross-Site",
      "bogus",
      "same-origin, cross-site",
      "same-origin, same-origin",
    ]) {
      await expectBadOrigin({ ...FROM_APP, "sec-fetch-site": site });
    }
    for (const site of ["same-origin", "Same-Origin", "same-site", "none"]) {
      const res = await app.inject({
        method: "POST",
        url: "/test/change",
        headers: { ...FROM_APP, "sec-fetch-site": site },
      });
      expect(res.statusCode, site).toBe(200);
    }
  });

  it("refuses before reading the body", async () => {
    app = await withChange();
    const headers = { origin: "https://other.example.test", "content-type": "application/json" };
    const res = await app.inject({ method: "POST", url: "/test/change", headers, payload: "{not json" });
    expect(res.statusCode).toBe(403);
  });

  it("accepts each configured origin", async () => {
    app = await withChange({ PGN_ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:5180` });
    for (const origin of [ORIGIN, "http://127.0.0.1:5180"]) {
      const res = await app.inject({ method: "POST", url: "/test/change", headers: { origin, "x-pageinator": "1" } });
      expect(res.statusCode, origin).toBe(200);
    }
  });

  it("never stops GET, HEAD or OPTIONS", async () => {
    app = await withChange();
    const foreign = { origin: "https://other.example.test", "sec-fetch-site": "cross-site" };
    expect((await app.inject({ method: "GET", url: "/healthz", headers: foreign })).statusCode).toBe(200);
    expect((await app.inject({ method: "HEAD", url: "/healthz", headers: foreign })).statusCode).toBe(200);
    // no route answers OPTIONS (the API grants no CORS preflight): not found, not refused
    expect((await app.inject({ method: "OPTIONS", url: "/test/change", headers: foreign })).statusCode).toBe(404);
  });
});

describe("helmet", () => {
  it("sends the security headers on answers and on errors", async () => {
    app = await testApp();
    for (const url of ["/healthz", "/no/such/page"]) {
      const { headers } = await app.inject({ url });
      expect(headers["content-security-policy"], url).toBe("default-src 'none';frame-ancestors 'none'");
      expect(headers["x-frame-options"], url).toBe("DENY");
      expect(headers["x-content-type-options"], url).toBe("nosniff");
      expect(headers["strict-transport-security"], url).toMatch(/^max-age=\d+/);
      expect(headers["referrer-policy"], url).toBe("no-referrer");
      expect(headers["cross-origin-resource-policy"], url).toBe("same-origin");
      expect(headers["x-powered-by"], url).toBeUndefined();
    }
  });
});

describe("rate limit", () => {
  const AWAY = "203.0.113.9"; // a client that is not this machine (a documentation address)

  it("answers a request over the limit with 429 slow_down and Retry-After, one budget for all paths", async () => {
    app = await testApp({ PGN_RATE_LIMIT_PER_MINUTE: "2" });
    const first = await app.inject({ url: "/readyz", remoteAddress: AWAY });
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");
    expect((await app.inject({ url: "/no/such/page", remoteAddress: AWAY })).statusCode).toBe(404);
    const res = await app.inject({ url: "/readyz", remoteAddress: AWAY });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(ErrorEnvelope.parse(res.json()).error).toEqual({
      code: "slow_down",
      message: "Too many tries. Wait a minute and try again.",
      requestId: res.headers["x-request-id"],
    });
  });

  it("counts unknown paths and refused requests too", async () => {
    app = await withChange({ PGN_RATE_LIMIT_PER_MINUTE: "2" });
    expect((await app.inject({ url: "/no/such/page" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/test/change" })).statusCode).toBe(403);
    expect((await app.inject({ url: "/no/such/page" })).statusCode).toBe(429);
  });

  it("counts per client address, and believes X-Forwarded-For only from a configured proxy", async () => {
    const twoClients = async () => [
      (await app.inject({ url: "/no/such/page", headers: { "x-forwarded-for": "203.0.113.1" } })).statusCode,
      (await app.inject({ url: "/no/such/page", headers: { "x-forwarded-for": "203.0.113.2" } })).statusCode,
    ];
    app = await testApp({ PGN_RATE_LIMIT_PER_MINUTE: "1" });
    expect(await twoClients()).toEqual([404, 429]);
    await app.close();
    app = await testApp({ PGN_RATE_LIMIT_PER_MINUTE: "1", PGN_TRUST_PROXY: "127.0.0.1" });
    expect(await twoClients()).toEqual([404, 404]);
  });

  it("never counts /healthz, nor /readyz asked on this machine directly", async () => {
    app = await testApp({ PGN_RATE_LIMIT_PER_MINUTE: "1" });
    for (let i = 0; i < 3; i += 1) {
      expect((await app.inject({ url: "/healthz", remoteAddress: AWAY })).statusCode).toBe(200);
      expect((await app.inject({ url: "/readyz" })).statusCode).toBe(200);
    }
    expect((await app.inject({ url: "/readyz", remoteAddress: AWAY })).statusCode).toBe(200);
    expect((await app.inject({ url: "/readyz", remoteAddress: AWAY })).statusCode).toBe(429);
  });

  it("counts /readyz that a proxy on this machine forwards, trusted or not", async () => {
    for (const env of [{}, { PGN_TRUST_PROXY: "127.0.0.1" }]) {
      app = await testApp({ PGN_RATE_LIMIT_PER_MINUTE: "1", ...env });
      const forwarded = { "x-forwarded-for": "203.0.113.7" };
      expect((await app.inject({ url: "/readyz", headers: forwarded })).statusCode).toBe(200);
      expect((await app.inject({ url: "/readyz", headers: forwarded })).statusCode).toBe(429);
      await app.close();
    }
    app = await testApp();
  });
});

describe("ADR-025's conditions for the Origin and header defence", () => {
  it("ADR-025: a CORS preflight from another origin gets no access-control-* header", async () => {
    app = await withChange();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/test/change",
      headers: {
        origin: "https://other.example.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-pageinator, content-type",
      },
    });
    expect(Object.keys(res.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
  });

  it("ADR-025: form, multipart and plain-text bodies are refused (415), even with the right origin and header", async () => {
    app = await withChange();
    const bodies: [string, string][] = [
      ["application/x-www-form-urlencoded", "headline=Kalpaniknagar"],
      [
        "multipart/form-data; boundary=pgn",
        '--pgn\r\nContent-Disposition: form-data; name="headline"\r\n\r\nx\r\n--pgn--\r\n',
      ],
      ["text/plain", "headline=Kalpaniknagar"],
    ];
    for (const [type, payload] of bodies) {
      const res = await app.inject({
        method: "POST",
        url: "/test/change",
        headers: { ...FROM_APP, "content-type": type },
        payload,
      });
      expect(res.statusCode, type).toBe(415);
      expect(ErrorEnvelope.parse(res.json()).error.code, type).toBe("not_json");
    }
  });
});
