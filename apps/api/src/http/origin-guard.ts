// The CSRF defence of a same-origin app (docs/product/10-l2-newsroom-plan.md §4.5; the Desk's X-Desk pattern): a
// request that can change something must come from an allowed origin and carry `X-Pageinator: 1`. A page on another
// site cannot add that header without a CORS preflight, and the API grants none. GET, HEAD and OPTIONS change nothing.
import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Sec-Fetch-Site values a request from the app may carry; "cross-site", an unknown value or a repeated header (which
// arrives joined by a comma) is refused. Browsers that send no Sec-Fetch-Site still face the two checks before it.
const SITES = new Set(["same-origin", "same-site", "none"]);

/** At most one log line per window about refused requests, with how many were refused since the last one. */
export const LOG_WINDOW_MS = 60_000;

export function originGuard(
  allowedOrigins: readonly string[],
  now: () => number = Date.now,
): (request: FastifyRequest) => Promise<void> {
  const allowed = new Set(allowedOrigins);
  let windowStart = Number.NEGATIVE_INFINITY;
  let refused = 0;
  return async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const { origin } = request.headers;
    const site = request.headers["sec-fetch-site"];
    const fromApp =
      request.headers["x-pageinator"] === "1" &&
      origin !== undefined &&
      allowed.has(origin) &&
      (site === undefined || (typeof site === "string" && SITES.has(site.toLowerCase())));
    if (fromApp) return;
    // one line a window, so that a flood of refused requests cannot flood the log
    refused += 1;
    if (now() - windowStart >= LOG_WINDOW_MS) {
      request.log.warn({ origin, method: request.method, refused }, "refused: not sent by the Pageinator app");
      windowStart = now();
      refused = 0;
    }
    throw new ApiError("bad_origin");
  };
}
