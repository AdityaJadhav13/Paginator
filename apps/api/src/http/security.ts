// The security baseline (docs/product/10-l2-newsroom-plan.md §4.5–4.7), registered right after the request id:
// Helmet's headers, then the request limit, then the Origin and header guard, so a refused request still counts.
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.ts";
import { originGuard } from "./origin-guard.ts";
import { limitEveryRequest, rateLimitOptions } from "./rate-limit.ts";

export async function registerSecurity(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(helmet, {
    // the API serves JSON only: no content of any kind, and never inside a frame
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    frameguard: { action: "deny" },
  });
  await app.register(rateLimit, rateLimitOptions(config.rateLimitPerMinute));
  app.addHook("onRequest", limitEveryRequest(app.createRateLimit()));
  app.addHook("onRequest", originGuard(config.allowedOrigins));
}
