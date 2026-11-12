// What a request log line says about its request (docs/product/10-l2-newsroom-plan.md §10 PR 7): Fastify's default
// fields, with the URL cut down. The query string is dropped, because Better Auth's emailed links carry their token
// there (/api/auth/verify-email?token=…), and the path segment after reset-password/ or invitations/ is replaced,
// because a password-reset token or an invitation id is a secret in the path itself.
import type { FastifyRequest } from "fastify";

const SECRET_SEGMENT = /\/(reset-password|invitations)\/[^/]+/g;

export function loggedUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  return path.replace(SECRET_SEGMENT, "/$1/:secret");
}

type LoggedRequest = {
  method: string;
  url: string;
  host: string;
  remoteAddress: string;
  version?: string;
  remotePort?: number;
};

export function requestSerializer(request: FastifyRequest): LoggedRequest {
  const version = request.headers["accept-version"];
  const port = request.socket?.remotePort;
  return {
    method: request.method,
    url: loggedUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    ...(typeof version === "string" ? { version } : {}),
    ...(port === undefined ? {} : { remotePort: port }),
  };
}
