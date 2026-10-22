// Better Auth's HTTP routes under /api/auth/* (docs/product/10-l2-newsroom-plan.md §4.1, §5.2), handed to its own
// handler as a Fetch request. Our security baseline still runs first: the Origin and X-Pageinator guard on every
// change, the request limit, JSON bodies only, the request id and the headers. Better Auth answers in its own JSON
// format, which its client reads (ADR-025 lists these answers). The client address it rate-limits by is Fastify's
// request.ip, which follows PGN_TRUST_PROXY: a forwarded header a client sends cannot change it (headers.ts).
import type { FastifyPluginAsync } from "fastify";
import { ApiError } from "../../http/errors.ts";
import type { Auth } from "./auth.ts";
import { authHeaders } from "./headers.ts";
import type { SessionResolver } from "./session.ts";

/** Path prefixes under /api/auth that we do not offer, on top of Better Auth's disabledPaths (auth.ts): social
 * sign-in's callback (/callback/:id, whose path parameter disabledPaths cannot name), and every organization route
 * (our /api/v1 endpoints check our permissions, then call Better Auth from the server). */
const NOT_OFFERED = ["/api/auth/callback", "/api/auth/organization"];

/** The path is read loosely (decoded, repeated and trailing slashes dropped), so that no spelling of it reaches
 * Better Auth's router. */
function notOffered(url: string, origin: string): boolean {
  let path = new URL(url, origin).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // a malformed escape: read as it is
  }
  path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return NOT_OFFERED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export const identityRoutes: FastifyPluginAsync<{ auth: Auth; origin: string; sessions: SessionResolver }> = async (
  app,
  { auth, origin, sessions },
) => {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      if (notOffered(request.url, origin)) throw new ApiError("not_found");
      const headers = authHeaders(request);
      // the 30-day absolute limit holds for Better Auth's own endpoints too: an older session is ended first
      await sessions.endIfTooOld(headers);
      const body = request.method === "POST" && request.body !== undefined ? JSON.stringify(request.body) : undefined;
      const answer = await auth.handler(
        new Request(new URL(request.url, origin), { method: request.method, headers, ...(body ? { body } : {}) }),
      );
      reply.status(answer.status);
      for (const [name, value] of answer.headers) {
        if (name !== "set-cookie" && name !== "content-length" && name !== "transfer-encoding")
          reply.header(name, value);
      }
      const cookies = answer.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.send(answer.body ? Buffer.from(await answer.arrayBuffer()) : undefined);
    },
  });
};
