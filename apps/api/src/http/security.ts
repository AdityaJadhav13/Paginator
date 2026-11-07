// The security baseline (docs/product/10-l2-newsroom-plan.md §4.5–4.7), registered right after the request id:
// Helmet's headers, then the request limits, then the Origin and header guard, so a refused request still counts. The
// signed-in budget is counted once the session is read: the caller registers `afterSession` right after identity's
// hook (src/http/rate-limit.ts).
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.ts";
import { originGuard } from "./origin-guard.ts";
import { rateLimitOptions, requestLimits } from "./rate-limit.ts";

export async function registerSecurity(
  app: FastifyInstance,
  config: Config,
): Promise<{ afterSession: ReturnType<typeof requestLimits>["afterSession"] }> {
  await app.register(helmet, {
    // the API serves JSON only: no content of any kind, and never inside a frame
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    frameguard: { action: "deny" },
  });
  await app.register(rateLimit, rateLimitOptions(config.rateLimitPerMinute));
  const limits = requestLimits(app, {
    perMinute: config.rateLimitPerMinute,
    perPerson: config.rateLimitPerPersonPerMinute,
    signedInPerAddress: config.rateLimitSignedInPerAddressPerMinute,
    secret: config.authSecret,
  });
  app.addHook("onRequest", limits.first);
  app.addHook("onRequest", originGuard(config.allowedOrigins));
  return { afterSession: limits.afterSession };
}
