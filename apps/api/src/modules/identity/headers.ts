// The headers a request hands Better Auth, on /api/auth/* (routes.ts) and on /api/v1 (plugin.ts) alike: the client's
// own, except any address it claims, and our CLIENT_IP_HEADER set from Fastify's request.ip, which follows
// PGN_TRUST_PROXY. Better Auth rate-limits by that address and records it with sessions and sign-in events.
import type { FastifyRequest } from "fastify";

/** The client address for Better Auth (advanced.ipAddress.ipAddressHeaders in auth.ts). */
export const CLIENT_IP_HEADER = "x-pgn-client-ip";

const CLAIMED_ADDRESS = new Set([CLIENT_IP_HEADER, "x-forwarded-for", "x-real-ip"]);

export function authHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || CLAIMED_ADDRESS.has(name)) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}
