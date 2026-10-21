// Request limits (docs/product/10-l2-newsroom-plan.md §4.6). Until sign-in exists every caller is signed out: one
// budget per client address, `perMinute` requests a minute (60 by default), counted in memory (one API instance in the
// pilot). Every request counts once, before anything can refuse it and on unknown paths too, so neither probing for
// paths nor sending refused requests is free. Health checks are exempt: /healthz always, and /readyz when it is asked
// on this machine directly (a loopback socket, no X-Forwarded-For). Behind a proxy, PGN_TRUST_PROXY must name it, or
// every client shares the proxy's budget. Note for the deploy PR (25): Caddy must not route /healthz or /readyz.
//
// The counting is a hook of our own because the plugin's per-route hooks run after every instance-level hook, so the
// requests that the origin guard refuses would not count. Two traps for later routes:
//   - a route's `config.rateLimit.groupId` is added to the key, so that route would get a budget of its own here too;
//   - `app.rateLimit()` without options uses this same budget, so a route that adds it counts each request twice.
import type { RateLimitPluginOptions } from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "./errors.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function healthCheck(request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  if (route === "/healthz") return true;
  const direct = LOOPBACK.has(request.socket.remoteAddress ?? "") && request.headers["x-forwarded-for"] === undefined;
  return route === "/readyz" && direct;
}

/** The plugin adds no hooks of its own (`global: false`); `limitEveryRequest` does the counting. */
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

/** An onRequest hook around the plugin's `createRateLimit()`, which uses its shared per-address store. */
export function limitEveryRequest(check: ReturnType<FastifyInstance["createRateLimit"]>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const limit = await check(request);
    if (limit.isAllowed) return;
    reply.header("x-ratelimit-limit", limit.max);
    reply.header("x-ratelimit-remaining", limit.remaining);
    reply.header("x-ratelimit-reset", limit.ttlInSeconds);
    if (!limit.isExceeded) return;
    reply.header("retry-after", limit.ttlInSeconds);
    throw new ApiError("slow_down");
  };
}
