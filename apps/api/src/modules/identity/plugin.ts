// Sign-in on the app (docs/product/10-l2-newsroom-plan.md §4): Better Auth on /api/auth/*, and the signed-in person
// on every /api/v1 request as request.actor (null when signed out). A route that needs a person adds the signedIn
// preHandler, which answers 401 signed_out (the web keeps any unsaved text, plan §4.5). Registered on the root
// instance, as the security baseline is, so that request.actor and its hook reach every route.
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../../config.ts";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import type { Mailer } from "../notifications/mailer.ts";
import { createAuth } from "./auth.ts";
import { authEvents } from "./events.ts";
import { authHeaders } from "./headers.ts";
import { identityRoutes } from "./routes.ts";
import { type Actor, sessionResolver } from "./session.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in person on /api/v1 requests (src/modules/identity/plugin.ts); null when signed out. */
    actor: Actor | null;
  }
}

export type IdentityOptions = { config: Config; database: Database; mailer: Mailer };

/** A preHandler for routes that need a person: 401 signed_out without one. */
export async function signedIn(request: FastifyRequest): Promise<void> {
  if (request.actor === null) throw new ApiError("signed_out");
}

export async function registerIdentity(app: FastifyInstance, { config, database, mailer }: IdentityOptions) {
  const auth = createAuth({ config, database, mailer, log: app.log });
  const sessions = sessionResolver(auth.api, authEvents(database.identity, mailer));
  app.decorateRequest("actor", null);
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/")) return;
    const found = await sessions.actor(authHeaders(request));
    request.actor = found?.actor ?? null;
    if (found && found.setCookie.length > 0) reply.header("set-cookie", found.setCookie); // the sliding 12 h
  });
  await app.register(identityRoutes, { auth, origin: config.publicOrigin, sessions });
  app.addHook("onClose", () => mailer.close());
}
