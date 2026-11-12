// tools/ts/check-headers.ts against a fake of the pilot on 127.0.0.1 (plain HTTP: the TLS probe is a fake too). The
// fake answers as Caddy and the API do (infra/caddy/Caddyfile, apps/api/src/http/security.ts); each test breaks one
// thing and expects exactly that check to fail.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  HEALTH_PATHS,
  type Result,
  type TlsProbe,
  checkHeaders,
  cookieProblems,
  directives,
  nodeTransport,
} from "../check-headers.ts";

const ORIGIN = "https://app.example.test";
const SPA_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self' https://pgn-pilot-work.s3.ap-south-1.amazonaws.com; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";
const API_CSP = "default-src 'none';frame-ancestors 'none'";
const HSTS = "max-age=31536000; includeSubDomains";
const COOKIE = "__Secure-pgn.session_token=abc.def; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax";

type Fake = {
  spa: Record<string, string>;
  api: Record<string, string>;
  cookie: string;
  healthRouted: string | undefined; // a path for which the fake passes the API's health answer through
  missingAsset: { status: number; cache: string }; // how a missing /assets/ file is answered
};
let fake: Fake;
let server: Server;
let base = "";

function reset(): void {
  fake = {
    spa: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SPA_CSP,
      "strict-transport-security": HSTS,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
    },
    api: {
      "content-type": "application/json; charset=utf-8",
      "content-security-policy": API_CSP,
      "strict-transport-security": HSTS,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
    cookie: COOKIE,
    healthRouted: undefined,
    missingAsset: { status: 404, cache: "no-store" },
  };
}

function answer(request: IncomingMessage, response: ServerResponse): void {
  const path = request.url ?? "/";
  const send = (status: number, headers: Record<string, string>, body: string) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.statusCode = status;
    response.end(body);
  };
  if (path === fake.healthRouted) return send(200, fake.api, '{"status":"ok"}');
  if (/^\/(healthz|readyz)(\/|\?|$)/.test(path)) return send(404, {}, "");
  if (path.startsWith("/assets/")) {
    const { status, cache } = fake.missingAsset;
    return send(status, { ...fake.spa, "cache-control": cache }, status === 404 ? "" : "<!doctype html>");
  }
  if (path.startsWith("/api/")) {
    if (path === "/api/auth/sign-in/email" && request.method === "POST") {
      response.setHeader("set-cookie", [
        fake.cookie,
        "__Secure-pgn.session_data=x; Path=/; HttpOnly; Secure; SameSite=Lax",
      ]);
      return send(200, fake.api, '{"token":"…"}');
    }
    return send(401, fake.api, '{"error":{"code":"signed_out"}}');
  }
  return send(200, fake.spa, "<!doctype html><title>Pageinator</title>");
}

const goodTls: TlsProbe = async () => ({ version: "TLSv1.3", legacy: "refused" });
/** The real node:http transport, sent to the fake instead of app.example.test. */
const transport = nodeTransport();
const toFake: typeof transport = (url, init) => transport(url.replace(ORIGIN, base), init);

async function run(tls: TlsProbe = goodTls, credentials = true): Promise<Result[]> {
  return checkHeaders(ORIGIN, {
    transport: toFake,
    tls,
    ...(credentials ? { credentials: { email: "owner@example.test", password: "fictional" } } : {}),
  });
}
const MISSING = (check: string) => `app /assets/pageinator-check-missing.js: ${check}`;
const failed = (results: Result[]) => results.filter((r) => r.status === "FAIL").map((r) => r.check);

beforeAll(async () => {
  server = createServer(answer);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(reset);

describe("check-headers", () => {
  it("passes the pilot's headers", async () => {
    const results = await run();
    expect(failed(results)).toEqual([]);
    expect(results.filter((r) => r.status === "SKIP")).toEqual([]);
    expect(results.filter((r) => r.check.startsWith("not routed:"))).toHaveLength(HEALTH_PATHS.length);
  });

  it("fails an SPA CSP that allows inline script, or has no frame-ancestors", async () => {
    fake.spa["content-security-policy"] = SPA_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    expect(failed(await run())).toEqual([
      "app /: Content-Security-Policy",
      "app /stories: Content-Security-Policy",
      MISSING("Content-Security-Policy"),
    ]);
    fake.spa["content-security-policy"] = SPA_CSP.replace("frame-ancestors 'none'; ", "");
    expect(failed(await run())).toEqual([
      "app /: frame-ancestors",
      "app /stories: frame-ancestors",
      MISSING("frame-ancestors"),
    ]);
  });

  it("fails a script-src wider than 'self', a wildcard or bare scheme anywhere, and a missing object-src or base-uri", async () => {
    for (const loose of ["https:", "https://cdn.example.test", "'self' *.example.test"]) {
      fake.spa["content-security-policy"] = SPA_CSP.replace("script-src 'self'", `script-src 'self' ${loose}`);
      expect(failed(await run())).toEqual([
        "app /: Content-Security-Policy",
        "app /stories: Content-Security-Policy",
        MISSING("Content-Security-Policy"),
      ]);
    }
    fake.spa["content-security-policy"] = SPA_CSP.replace("img-src 'self' blob:", "img-src 'self' data:");
    expect(failed(await run())).toContain("app /: Content-Security-Policy");
    fake.spa["content-security-policy"] = SPA_CSP.replace("; object-src 'none'", "").replace(
      "default-src 'none'",
      "default-src 'self'",
    );
    expect(failed(await run())).toEqual(["app /: object-src", "app /stories: object-src", MISSING("object-src")]);
    fake.spa["content-security-policy"] = SPA_CSP.replace("base-uri 'none'; ", "");
    expect(failed(await run())).toEqual(["app /: base-uri", "app /stories: base-uri", MISSING("base-uri")]);
  });

  it("fails a page that may be framed or opened by another site, or loaded by one", async () => {
    fake.spa["x-frame-options"] = "SAMEORIGIN";
    delete fake.spa["cross-origin-opener-policy"];
    fake.spa["cross-origin-resource-policy"] = "cross-origin";
    expect(failed(await run()).filter((check) => check.startsWith("app /:"))).toEqual([
      "app /: X-Frame-Options",
      "app /: Cross-Origin-Opener-Policy",
      "app /: Cross-Origin-Resource-Policy",
    ]);
  });

  it("fails a missing asset that is cached for a year, or answered with the app's page", async () => {
    fake.missingAsset = { status: 404, cache: "public, max-age=31536000, immutable" };
    expect(failed(await run())).toEqual([MISSING("not cached")]);
    fake.missingAsset = { status: 200, cache: "no-cache" };
    expect(failed(await run())).toEqual([MISSING("404")]);
  });

  it("fails a short or missing HSTS, a missing nosniff and a leaky Referrer-Policy", async () => {
    fake.spa["strict-transport-security"] = "max-age=600";
    delete fake.spa["x-content-type-options"];
    fake.spa["referrer-policy"] = "unsafe-url";
    expect(failed(await run())).toEqual([
      "app /: HSTS",
      "app /: X-Content-Type-Options",
      "app /: Referrer-Policy",
      "app /stories: HSTS",
      "app /stories: X-Content-Type-Options",
      "app /stories: Referrer-Policy",
      MISSING("HSTS"),
      MISSING("X-Content-Type-Options"),
      MISSING("Referrer-Policy"),
    ]);
  });

  it("fails an API answer that may be cached, or that carries the SPA's CSP", async () => {
    fake.api["cache-control"] = "private, max-age=60";
    fake.api["content-security-policy"] = SPA_CSP;
    expect(failed(await run())).toEqual([
      "api /api/v1/me: Cache-Control",
      "api /api/v1/me: Content-Security-Policy",
      "api sign-in: Cache-Control",
      "api sign-in: Content-Security-Policy",
    ]);
  });

  it("fails a session cookie without its prefix, HttpOnly or SameSite", async () => {
    fake.cookie = "pgn.session_token=abc; Path=/; Secure";
    const results = await run();
    expect(failed(results)).toEqual(["api sign-in: cookies"]);
    expect(results.find((r) => r.check === "api sign-in: cookies")?.detail).toContain("not HttpOnly");
  });

  it("skips the cookie check without an account, and says so", async () => {
    const results = await run(goodTls, false);
    expect(failed(results)).toEqual([]);
    expect(results.filter((r) => r.status === "SKIP").map((r) => r.check)).toEqual(["api sign-in: cookies"]);
  });

  it("fails when a health path reaches the API", async () => {
    for (const path of ["/healthz", "/api/../healthz", "/%68ealthz"]) {
      fake.healthRouted = path;
      expect(failed(await run())).toEqual([`not routed: ${path}`]);
    }
  });

  it("fails TLS older than 1.2, or a server that takes a TLS 1.1 hello; says when 1.1 could not be tried", async () => {
    expect(failed(await run(async () => ({ version: "TLSv1.1", legacy: "accepted" })))).toEqual([
      "TLS: version",
      "TLS: 1.1 refused",
    ]);
    const untested = await run(async () => ({ version: "TLSv1.3", legacy: "untested" }));
    expect(failed(untested)).toEqual([]);
    expect(untested.find((r) => r.check === "TLS: 1.1 refused")?.status).toBe("SKIP");
  });

  it("fails a plain-HTTP origin's TLS, and refuses an address that is not an origin", async () => {
    const results = await checkHeaders(base, { transport, tls: goodTls });
    expect(failed(results)).toContain("TLS");
    await expect(checkHeaders(`${ORIGIN}/app`, { transport, tls: goodTls })).rejects.toThrow("not an origin");
  });
});

describe("its parsers", () => {
  it("reads CSP directives and cookie attributes", () => {
    expect(directives(API_CSP).get("frame-ancestors")).toEqual(["'none'"]);
    expect(cookieProblems(COOKIE)).toEqual([]);
    expect(cookieProblems("__Host-x=1; Path=/; HttpOnly; Secure; SameSite=None")).toEqual(["__Host-x: SameSite none"]);
  });
});
