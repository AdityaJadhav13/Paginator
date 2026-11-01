// Checks a deployed Pageinator from outside, as a browser sees it (docs/product/10-l2-newsroom-plan.md §4.5–4.7;
// docs/runbooks/deploy.md runs it after every deploy):
//   node tools/ts/check-headers.ts https://app.<domain>
// Options:
//   --connect <address>   connect to this IP address instead of the origin's (DNS not set up yet; pilot-local)
//   --ca <file>           also trust this CA certificate (pilot-local: Caddy's local CA)
// With PGN_CHECK_EMAIL and PGN_CHECK_PASSWORD set (a fictional account of the stack), it signs in once and checks the
// cookies the API sets; without them the cookie check is skipped, and says so.
// It checks:
//   - the web app (/ and one of its routes): a CSP whose script-src is 'self' (or hashes and nonces) and that allows
//     nothing unsafe-*, no wildcard and no bare scheme anywhere, with object-src 'none', base-uri 'none' or 'self' and
//     frame-ancestors 'none'; HSTS of at least 180 days, nosniff, X-Frame-Options DENY, Cross-Origin-Opener-Policy
//     and Cross-Origin-Resource-Policy same-origin, a Referrer-Policy that sends no path to other sites;
//   - a missing file under /assets/: a 404 (not the app's page), never cached for long, with the same headers;
//   - the API (/api/…): Cache-Control no-store, its own CSP (every directive 'none'), nosniff,
//     HSTS; each cookie __Secure- (or __Host-), HttpOnly, Secure and SameSite Lax or Strict;
//   - /healthz and /readyz (and spellings that try to slip past the route) never give the API's answer (a 404 or the
//     app's page is right);
//   - TLS 1.2 or later: the connection's version, and a TLS 1.1 hello refused by the server.
// It prints one line per check (PASS, FAIL or SKIP) and exits 1 when any check fails.
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { parseArgs } from "node:util";

export type Answer = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
export type Transport = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Answer>;
/** The TLS version negotiated by default, and whether a hello offering at most TLS 1.1 was refused by the server
 * ("refused"), accepted ("accepted"), or could not be sent by this machine's TLS library ("untested"). */
export type TlsProbe = (url: string) => Promise<{ version: string; legacy: "refused" | "accepted" | "untested" }>;
export type Result = { status: "PASS" | "FAIL" | "SKIP"; check: string; detail: string };
export type Options = { transport: Transport; tls: TlsProbe; credentials?: { email: string; password: string } };

const MIN_HSTS_SECONDS = 180 * 24 * 3600;
const PRIVATE_REFERRER = new Set(["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]);
/** Paths that must not reach the API's health answers through the public site. */
export const HEALTH_PATHS = [
  "/healthz",
  "/readyz",
  "/healthz/",
  "/readyz?full=1",
  "/HEALTHZ",
  "/api/../healthz",
  "/api/%2e%2e/healthz",
  "/api/..%2freadyz",
  "//healthz",
  "/%68ealthz",
];

function header(answer: Answer, name: string): string {
  const value = answer.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

/** The directives of a Content-Security-Policy, by name. */
export function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), values);
  }
  return map;
}

function hstsProblem(answer: Answer): string | undefined {
  const value = header(answer, "strict-transport-security");
  const age = /(?:^|;)\s*max-age=(\d+)/i.exec(value)?.[1];
  if (age === undefined) return "no Strict-Transport-Security";
  return Number(age) < MIN_HSTS_SECONDS ? `HSTS max-age ${age} is under 180 days` : undefined;
}

function baseline(answer: Answer, where: string): Result[] {
  const results: Result[] = [];
  const hsts = hstsProblem(answer);
  results.push(
    hsts
      ? { status: "FAIL", check: `${where}: HSTS`, detail: hsts }
      : { status: "PASS", check: `${where}: HSTS`, detail: header(answer, "strict-transport-security") },
  );
  const sniff = header(answer, "x-content-type-options").toLowerCase();
  results.push({
    status: sniff === "nosniff" ? "PASS" : "FAIL",
    check: `${where}: X-Content-Type-Options`,
    detail: sniff || "missing",
  });
  const frames = directives(header(answer, "content-security-policy")).get("frame-ancestors") ?? [];
  results.push({
    status: frames.length === 1 && frames[0] === "'none'" ? "PASS" : "FAIL",
    check: `${where}: frame-ancestors`,
    detail: frames.join(" ") || "missing",
  });
  return results;
}

function spaChecks(answer: Answer, where: string, page = true): Result[] {
  const csp = header(answer, "content-security-policy");
  const parsed = directives(csp);
  const scripts = parsed.get("script-src") ?? parsed.get("default-src") ?? [];
  // unsafe-*, a wildcard (* or *.host), or a bare scheme (https:, data:, blob:…) anywhere but img-src's blob:; and in
  // script-src anything but 'self', hashes and nonces
  const loose = [...parsed.entries()].flatMap(([name, values]) =>
    values.filter(
      (value) =>
        /^'unsafe-|\*|^[a-z][a-z0-9+.-]*:$/i.test(value) && !(name === "img-src" && value.toLowerCase() === "blob:"),
    ),
  );
  const looseScripts = scripts.filter((value) => !/^'self'$|^'(sha256|sha384|sha512|nonce)-[^']+'$/i.test(value));
  const objects = parsed.get("object-src") ?? parsed.get("default-src") ?? [];
  const base = parsed.get("base-uri") ?? [];
  const allowed = [...loose, ...looseScripts.filter((value) => !loose.includes(value))];
  const results: Result[] = [
    ...(page
      ? [
          {
            status: answer.status === 200 && /text\/html/.test(header(answer, "content-type")) ? "PASS" : "FAIL",
            check: `${where}: the app's page`,
            detail: `${answer.status} ${header(answer, "content-type")}`,
          } satisfies Result,
        ]
      : []),
    {
      status: csp && scripts.includes("'self'") && allowed.length === 0 && parsed.has("default-src") ? "PASS" : "FAIL",
      check: `${where}: Content-Security-Policy`,
      detail: allowed.length > 0 ? `allows ${allowed.join(" ")}` : csp || "missing",
    },
    {
      status: objects.length === 1 && objects[0] === "'none'" ? "PASS" : "FAIL",
      check: `${where}: object-src`,
      detail: objects.join(" ") || "missing",
    },
    {
      status: base.length === 1 && (base[0] === "'none'" || base[0] === "'self'") ? "PASS" : "FAIL",
      check: `${where}: base-uri`,
      detail: base.join(" ") || "missing",
    },
    ...baseline(answer, where),
  ];
  const exact = (name: string, title: string, value: string) => {
    const got = header(answer, name).toLowerCase();
    results.push({ status: got === value ? "PASS" : "FAIL", check: `${where}: ${title}`, detail: got || "missing" });
  };
  exact("x-frame-options", "X-Frame-Options", "deny");
  exact("cross-origin-opener-policy", "Cross-Origin-Opener-Policy", "same-origin");
  exact("cross-origin-resource-policy", "Cross-Origin-Resource-Policy", "same-origin");
  const referrer = header(answer, "referrer-policy").toLowerCase();
  results.push({
    status: PRIVATE_REFERRER.has(referrer) ? "PASS" : "FAIL",
    check: `${where}: Referrer-Policy`,
    detail: referrer || "missing",
  });
  return results;
}

/** A missing hashed file: a plain 404 that is never kept for long (once a release adds it, it must be fetched). */
function missingAssetChecks(answer: Answer, where: string): Result[] {
  const cache = header(answer, "cache-control").toLowerCase();
  const age = Number(/max-age=(\d+)/.exec(cache)?.[1] ?? 0);
  return [
    { status: answer.status === 404 ? "PASS" : "FAIL", check: `${where}: 404`, detail: String(answer.status) },
    {
      status: !cache.includes("immutable") && age <= 60 ? "PASS" : "FAIL",
      check: `${where}: not cached`,
      detail: cache || "no Cache-Control",
    },
    ...spaChecks(answer, where, false),
  ];
}

function apiChecks(answer: Answer, where: string, expected: (status: number) => boolean): Result[] {
  const cache = header(answer, "cache-control").toLowerCase();
  const csp = directives(header(answer, "content-security-policy"));
  const defaults = csp.get("default-src") ?? [];
  return [
    {
      status: expected(answer.status) && /json/.test(header(answer, "content-type")) ? "PASS" : "FAIL",
      check: `${where}: answered by the API`,
      detail: `${answer.status} ${header(answer, "content-type")}`,
    },
    {
      status: cache.split(/\s*,\s*/).includes("no-store") ? "PASS" : "FAIL",
      check: `${where}: Cache-Control`,
      detail: cache || "missing",
    },
    {
      // default-src 'none', and nothing allowed by any other directive either: the API serves JSON only
      status:
        defaults.length === 1 && [...csp.values()].every((values) => values.length === 1 && values[0] === "'none'")
          ? "PASS"
          : "FAIL",
      check: `${where}: Content-Security-Policy`,
      detail: header(answer, "content-security-policy") || "missing",
    },
    ...baseline(answer, where),
  ];
}

function setCookies(answer: Answer): string[] {
  const value = answer.headers["set-cookie"];
  return Array.isArray(value) ? value : value ? [value] : [];
}

/** A cookie's problems: its name, HttpOnly, Secure and SameSite. */
export function cookieProblems(cookie: string): string[] {
  const [pair = "", ...attributes] = cookie.split(";").map((part) => part.trim());
  const name = pair.split("=")[0] ?? "";
  const flags = new Map(
    attributes.map((attribute) => {
      const [key = "", value = ""] = attribute.split("=");
      return [key.toLowerCase(), value.toLowerCase()];
    }),
  );
  const problems: string[] = [];
  if (!name.startsWith("__Secure-") && !name.startsWith("__Host-")) problems.push(`${name}: not __Secure- or __Host-`);
  if (!flags.has("httponly")) problems.push(`${name}: not HttpOnly`);
  if (!flags.has("secure")) problems.push(`${name}: not Secure`);
  const site = flags.get("samesite");
  if (site !== "lax" && site !== "strict") problems.push(`${name}: SameSite ${site || "missing"}`);
  return problems;
}

export async function checkHeaders(origin: string, options: Options): Promise<Result[]> {
  const url = new URL(origin);
  if (url.origin !== origin) throw new Error(`${origin} is not an origin (scheme, host and port only)`);
  const { transport } = options;
  const results: Result[] = [];

  results.push(...spaChecks(await transport(`${origin}/`), "app /"));
  results.push(...spaChecks(await transport(`${origin}/stories`), "app /stories"));
  const missing = "/assets/pageinator-check-missing.js";
  results.push(...missingAssetChecks(await transport(`${origin}${missing}`), `app ${missing}`));

  const api = await transport(`${origin}/api/v1/me`, { headers: { "x-pageinator": "1" } });
  results.push(...apiChecks(api, "api /api/v1/me", (status) => status === 401));

  if (options.credentials) {
    const signIn = await transport(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin, "x-pageinator": "1", "content-type": "application/json" },
      body: JSON.stringify(options.credentials),
    });
    results.push(...apiChecks(signIn, "api sign-in", (status) => status === 200));
    const cookies = setCookies(signIn);
    const problems = cookies.flatMap(cookieProblems);
    results.push({
      status: signIn.status === 200 && cookies.length > 0 && problems.length === 0 ? "PASS" : "FAIL",
      check: "api sign-in: cookies",
      detail:
        signIn.status !== 200
          ? `sign-in answered ${signIn.status}`
          : problems.join("; ") || cookies.map((cookie) => cookie.replace(/=[^;]*/, "=…")).join(" | "),
    });
  } else {
    results.push({
      status: "SKIP",
      check: "api sign-in: cookies",
      detail: "set PGN_CHECK_EMAIL and PGN_CHECK_PASSWORD",
    });
  }

  for (const path of HEALTH_PATHS) {
    const answer = await transport(`${origin}${path}`);
    // a 404, the app's page (a route of the app) or the API's own 404 are right; the health answers never
    const theApis = /"status"\s*:\s*"(ok|ready|not_ready)"|"dependencies"/.test(answer.body);
    results.push({
      status: !theApis ? "PASS" : "FAIL",
      check: `not routed: ${path}`,
      detail: theApis
        ? `the API's health answer, ${answer.status}`
        : `${answer.status} ${header(answer, "content-type")}`.trim(),
    });
  }

  if (url.protocol !== "https:") {
    results.push({ status: "FAIL", check: "TLS", detail: `${origin} is not https` });
  } else {
    const tls = await options.tls(origin);
    results.push({
      status: tls.version === "TLSv1.2" || tls.version === "TLSv1.3" ? "PASS" : "FAIL",
      check: "TLS: version",
      detail: tls.version,
    });
    results.push({
      status: tls.legacy === "refused" ? "PASS" : tls.legacy === "accepted" ? "FAIL" : "SKIP",
      check: "TLS: 1.1 refused",
      detail:
        tls.legacy === "untested" ? "this machine's TLS library cannot offer TLS 1.1, so it was not tried" : tls.legacy,
    });
  }
  return results;
}

/** A transport over node:http(s): no redirects followed, every Set-Cookie kept, and the path sent exactly as written
 * (a URL object would resolve /api/../healthz and %2e%2e to /healthz before sending). */
export function nodeTransport(connect?: string, ca?: string): Transport {
  const lookup: LookupFunction | undefined = connect
    ? (_hostname, options, callback) => {
        const family = connect.includes(":") ? 6 : 4;
        if ((options as { all?: boolean }).all)
          (callback as (e: null, a: unknown[]) => void)(null, [{ address: connect, family }]);
        else callback(null, connect, family);
      }
    : undefined;
  return (target, init = {}) =>
    new Promise((resolve, reject) => {
      const url = new URL(target);
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = send(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ""),
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: target.slice(url.origin.length) || "/",
          servername: url.hostname,
          method: init.method ?? "GET",
          headers: init.headers ?? {},
          ...(lookup ? { lookup } : {}),
          ...(ca && url.protocol === "https:" ? { ca: [readFileSync(ca, "utf8")] } : {}),
          timeout: 10_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          response.on("error", reject);
        },
      );
      request.on("timeout", () => request.destroy(new Error(`${target}: no answer within 10 s`)));
      request.on("error", reject);
      request.end(init.body);
    });
}

/** A TLS probe over node:tls. */
export function nodeTlsProbe(connect?: string, ca?: string): TlsProbe {
  function hello(origin: string, extra: object): Promise<{ version: string } | { error: NodeJS.ErrnoException }> {
    const url = new URL(origin);
    return new Promise((resolve) => {
      const socket = tlsConnect({
        host: connect ?? url.hostname,
        port: Number(url.port || 443),
        servername: url.hostname,
        ...(ca ? { ca: [readFileSync(ca, "utf8")] } : {}),
        ...extra,
      });
      socket.setTimeout(10_000, () => socket.destroy(new Error("no answer within 10 s")));
      socket.once("secureConnect", () => {
        resolve({ version: socket.getProtocol() ?? "unknown" });
        socket.end();
      });
      socket.once("error", (error: NodeJS.ErrnoException) => resolve({ error }));
    });
  }
  return async (origin) => {
    const modern = await hello(origin, {});
    if ("error" in modern) throw new Error(`TLS to ${origin} failed: ${modern.error.message}`);
    // TLS 1.0 and 1.1 need security level 0 in OpenSSL 3, on this side
    const legacy = await hello(origin, { minVersion: "TLSv1", maxVersion: "TLSv1.1", ciphers: "DEFAULT@SECLEVEL=0" });
    if (!("error" in legacy)) return { version: modern.version, legacy: "accepted" };
    // refused means the server said so (a TLS alert) or hung up; anything else (this side could not offer TLS 1.1,
    // a time-out) proves nothing
    const refused = /ALERT|ECONNRESET/.test(legacy.error.code ?? "");
    return { version: modern.version, legacy: refused ? "refused" : "untested" };
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    options: { connect: { type: "string" }, ca: { type: "string" } },
    allowPositionals: true,
  });
  const origin = positionals[0];
  if (!origin || positionals.length > 1) {
    console.error("usage: node tools/ts/check-headers.ts <origin> [--connect <address>] [--ca <file>]");
    process.exit(2);
  }
  const email = process.env["PGN_CHECK_EMAIL"];
  const password = process.env["PGN_CHECK_PASSWORD"];
  const results = await checkHeaders(origin, {
    transport: nodeTransport(values.connect, values.ca),
    tls: nodeTlsProbe(values.connect, values.ca),
    ...(email && password ? { credentials: { email, password } } : {}),
  });
  for (const result of results) console.log(`${result.status} ${result.check}: ${result.detail}`);
  const failed = results.filter((result) => result.status === "FAIL").length;
  console.log(failed === 0 ? `All ${results.length} checks passed or were skipped.` : `${failed} checks failed.`);
  process.exitCode = failed === 0 ? 0 : 1;
}
