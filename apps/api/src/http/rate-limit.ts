// Request limits (docs/product/10-l2-newsroom-plan.md §4.6), counted in memory (one API instance in the pilot), each
// in a minute:
//   - signed out: one budget per client address, `perMinute` (60 by default), for every request that carries no
//     session cookie, on unknown paths too, before anything can refuse it, so neither probing for paths nor sending
//     refused requests is free;
//   - signed in: an /api/v1 request with a session cookie counts against its person, `perPerson` (300 by default), once
//     the session is read: autosave every 1.5 s and the newsroom behind one shared address must not share one budget.
//     Only a cookie the API signed counts so (its HMAC is checked here, as Better Auth checks it, with the sign-in
//     secret): a made-up cookie is a signed-out request. A signed cookie that turns out to be no session (ended or
//     expired) counts against the address after all. Before the session is read, signed-cookie requests count against
//     a per-address ceiling, `signedInPerAddress` (6,000 by default); a request refused before then (a bad origin, bad
//     JSON) counts there only, which needs a cookie the API once signed.
// Health checks are exempt: /healthz always, and /readyz when it is asked on this machine directly (a loopback socket,
// no X-Forwarded-For). Behind a proxy, PGN_TRUST_PROXY must name it, or every client shares the proxy's budgets. Note
// for the deploy PR (25): Caddy must not route /healthz or /readyz.
//
// The counting is ours (hooks around the plugin's createRateLimit) because the plugin's per-route hooks run after every
// instance-level hook, so the requests that the origin guard refuses would not count. Two traps for later routes:
//   - a route's `config.rateLimit.groupId` is added to the key, so that route would get a budget of its own here too;
//   - `app.rateLimit()` without options uses the per-address budget, so a route that adds it counts twice.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RateLimitPluginOptions } from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "./errors.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
/** Better Auth's session cookie (auth.ts: prefix pgn, secure cookies): __Secure-pgn.session_token. */
const SESSION_COOKIE = /(?:^|;\s*)__Secure-pgn\.session_token=([^;]*)/;

/** Whether the request carries a session cookie the API signed: `<token>.<base64 HMAC-SHA256 of it>`, URL-encoded,
 * as better-call's signCookieValue makes it with the sign-in secret (and getSignedCookie checks it). */
export function signedSessionCookie(cookies: string | undefined, secret: string): boolean {
  const found = SESSION_COOKIE.exec(cookies ?? "");
  if (!found?.[1]) return false;
  let value: string;
  try {
    value = decodeURIComponent(found[1]);
  } catch {
    return false;
  }
  const at = value.lastIndexOf(".");
  const signature = value.slice(at + 1);
  if (at < 1 || signature.length !== 44 || !signature.endsWith("=")) return false;
  const expected = createHmac("sha256", secret).update(value.slice(0, at)).digest("base64");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

declare module "fastify" {
  interface FastifyRequest {
    /** The request carries a session cookie and is counted once its person is known (rate-limit.ts). */
    countedLater: boolean;
  }
}

function healthCheck(request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  if (route === "/healthz") return true;
  const direct = LOOPBACK.has(request.socket.remoteAddress ?? "") && request.headers["x-forwarded-for"] === undefined;
  return route === "/readyz" && direct;
}

/** The plugin adds no hooks of its own (`global: false`); the hooks below do the counting. */
export function rateLimitOptions(perMinute: number): RateLimitPluginOptions {
  return {
    global: false,
    max: perMinute,
    timeWindow: 60_000,
    allowList: healthCheck,
    // used by any route that sets its own limit (config.rateLimit), so its refusal is an envelope too
    errorResponseBuilder: () => new ApiError("slow_down"),
  };
}

type Check = ReturnType<FastifyInstance["createRateLimit"]>;

async function count(check: Check, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const limit = await check(request);
  if (limit.isAllowed) return;
  reply.header("x-ratelimit-limit", limit.max);
  reply.header("x-ratelimit-remaining", limit.remaining);
  reply.header("x-ratelimit-reset", limit.ttlInSeconds);
  if (!limit.isExceeded) return;
  reply.header("retry-after", limit.ttlInSeconds);
  throw new ApiError("slow_down");
}

export type Limits = { perMinute: number; perPerson: number; signedInPerAddress: number; secret: string };

/** The three budgets, on the plugin's createRateLimit (each its own store). Registered after the plugin. */
export function requestLimits(app: FastifyInstance, limits: Limits) {
  const byAddress = app.createRateLimit();
  const signedInByAddress = app.createRateLimit({ max: limits.signedInPerAddress });
  const byPerson = app.createRateLimit({
    max: limits.perPerson,
    keyGenerator: (request) => `person:${request.actor?.userId ?? ""}`,
  });
  app.decorateRequest("countedLater", false);
  return {
    /** onRequest, first: every request counts, by address, or against the signed-in ceiling. */
    async first(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const signedIn =
        !request.is404 &&
        request.routeOptions.url?.startsWith("/api/v1/") === true &&
        signedSessionCookie(request.headers.cookie, limits.secret);
      if (!signedIn) return count(byAddress, request, reply);
      request.countedLater = true;
      return count(signedInByAddress, request, reply);
    },
    /** preValidation, right after the session is read (identity's hook): against the person, or the address. */
    async afterSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      if (!request.countedLater) return;
      return count(request.actor ? byPerson : byAddress, request, reply);
    },
  };
}
