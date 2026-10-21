// The signed-in person behind a request (docs/product/10-l2-newsroom-plan.md §4.5): Better Auth's session, with our
// 30-day absolute limit on top of its 12-hour sliding one. A session older than 30 days is ended, and recorded, the
// first time it is seen, so neither /api/v1 nor Better Auth's own routes accept it any more.
import type { AuthEvents } from "./events.ts";
import { CLIENT_IP_HEADER } from "./headers.ts";

export const ABSOLUTE_MS = 30 * 24 * 3600 * 1000;

export type Actor = { userId: string; sessionId: string; email: string; emailVerified: boolean; signedInAt: Date };

/** Better Auth's session lookup and revocation, as session.ts uses them. */
export type SessionApi = {
  getSession(input: { headers: Headers; returnHeaders: true; query?: { disableRefresh?: boolean } }): Promise<{
    headers: Headers;
    response: {
      session: { id: string; token: string; createdAt: Date; userId: string };
      user: { id: string; email: string; emailVerified: boolean };
    } | null;
  }>;
  revokeSession(input: { headers: Headers; body: { token: string } }): Promise<unknown>;
};

export type SessionResolver = {
  /** The person, and any cookie Better Auth refreshed (to send back), or null when signed out. */
  actor(headers: Headers): Promise<{ actor: Actor; setCookie: string[] } | null>;
  /** Ends the request's session if it is older than the absolute limit. The headers come from authHeaders. */
  endIfTooOld(headers: Headers): Promise<void>;
};

export function sessionResolver(api: SessionApi, events: AuthEvents, now = () => Date.now()): SessionResolver {
  /** refresh: let Better Auth slide the session on (only when its new cookie reaches the browser). Better Auth itself
   * reads the cookie, every time, so that this check and its endpoints see the same session: it answers null without
   * a database read when no signed session cookie is there. */
  async function current(headers: Headers, refresh: boolean) {
    const query = { disableRefresh: !refresh };
    const { headers: answer, response } = await api.getSession({ headers, returnHeaders: true, query });
    if (!response) return null;
    if (now() - response.session.createdAt.getTime() <= ABSOLUTE_MS)
      return { response, setCookie: answer.getSetCookie() };
    await api.revokeSession({ headers, body: { token: response.session.token } });
    await events.record({
      userId: response.user.id,
      kind: "session_expired",
      sessionId: response.session.id,
      ip: headers.get(CLIENT_IP_HEADER),
      userAgent: headers.get("user-agent"),
    });
    return null;
  }
  return {
    async actor(headers) {
      const found = await current(headers, true);
      if (!found) return null;
      const { session, user } = found.response;
      return {
        actor: {
          userId: user.id,
          sessionId: session.id,
          email: user.email,
          emailVerified: user.emailVerified,
          signedInAt: session.createdAt,
        },
        setCookie: found.setCookie,
      };
    },
    async endIfTooOld(headers) {
      await current(headers, false); // Better Auth's own endpoint slides the session, and sends the cookie
    },
  };
}
