// Request ids. The server makes its own id for every request (a UUID): the X-Request-Id it sends back, the id in error
// envelopes and references, every log line, and later the audit log. A caller's own X-Request-Id never replaces it;
// when it is a short plain token it is logged beside the server's id as `clientRequestId`, so a client can still find
// its request.
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { FastifyServerOptions } from "fastify";

export const REQUEST_ID_HEADER = "x-request-id";
const PLAIN_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(): string {
  return randomUUID();
}

export function clientRequestId(raw: IncomingMessage): string | undefined {
  const given = raw.headers[REQUEST_ID_HEADER];
  return typeof given === "string" && PLAIN_TOKEN.test(given) ? given : undefined;
}

/** Fastify's childLoggerFactory: each request's logger also carries the caller's own id, when it gave a usable one. */
export const childLoggerFactory: NonNullable<FastifyServerOptions["childLoggerFactory"]> = function (
  logger,
  bindings,
  options,
  raw,
) {
  const client = clientRequestId(raw);
  return logger.child(client === undefined ? bindings : { ...bindings, clientRequestId: client }, options);
};
