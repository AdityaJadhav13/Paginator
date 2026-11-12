// The request log's URL (src/http/log.ts): no query string, and no secret path segment. The real process's own log
// lines are checked in test/process/main.test.ts.
import { describe, expect, it } from "vitest";
import { loggedUrl } from "../../src/http/log.ts";

describe("loggedUrl", () => {
  it.each([
    ["/api/auth/verify-email?token=eyJhbGciOi.secret&callbackURL=%2F", "/api/auth/verify-email"],
    ["/api/auth/reset-password/aBcD1234secretToken?callbackURL=%2Freset", "/api/auth/reset-password/:secret"],
    ["/api/v1/invitations/0195f3a0-0000-4000-8000-00000000000a", "/api/v1/invitations/:secret"],
    ["/api/v1/invitations/0195f3a0-0000-4000-8000-00000000000a/accept", "/api/v1/invitations/:secret/accept"],
    ["/api/v1/orgs/o1/invitations/i1/resend", "/api/v1/orgs/o1/invitations/:secret/resend"],
    ["//api/auth/reset-password/aBcD1234secretToken", "//api/auth/reset-password/:secret"],
    ["/api/v1/orgs/o1/invitations", "/api/v1/orgs/o1/invitations"],
    ["/healthz", "/healthz"],
    ["/readyz#fragment", "/readyz"],
  ])("logs %s as %s", (url, logged) => {
    expect(loggedUrl(url)).toBe(logged);
  });
});
