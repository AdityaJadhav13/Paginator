/**
 * The real session service, over Better Auth's endpoints under /api/auth (docs/product/10-l2-newsroom-plan.md §4.1,
 * §5.2). Only the person's id, name, email address and whether it is confirmed reach the app; Better Auth's answers
 * also carry the session token, which the app drops (the HttpOnly cookie is what signs requests in).
 */
import type { ApiProblem, ServiceResult, SessionService, SessionSnapshot } from "../services/index.ts";
import { isObject, type ApiClient } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

/** Better Auth's `get-session` answer (null when signed out) as a snapshot, or undefined if it is not one. */
export function sessionFromAnswer(value: unknown): SessionSnapshot | undefined {
  if (value === null) return { status: "signed-out" };
  if (!isObject(value) || !isObject(value["session"])) return undefined;
  const user = value["user"];
  if (
    !isObject(user) ||
    typeof user["id"] !== "string" ||
    typeof user["name"] !== "string" ||
    typeof user["email"] !== "string" ||
    typeof user["emailVerified"] !== "boolean"
  ) {
    return undefined;
  }
  return {
    status: "signed-in",
    session: {
      user: {
        id: user["id"],
        name: user["name"],
        email: user["email"],
        emailVerified: user["emailVerified"],
        twoFactorEnabled: user["twoFactorEnabled"] === true,
      },
    },
  };
}

/** Better Auth's answer to a right password on an account with two-step: no session yet, a code next. */
function needsTwoStep(value: unknown): boolean {
  return isObject(value) && value["twoFactorRedirect"] === true;
}

export function createApiSessionService(client: ApiClient): SessionService {
  async function getSession(): Promise<ServiceResult<SessionSnapshot, ApiProblem>> {
    const answer = await client.get("/api/auth/get-session");
    if (!answer.ok) return { ok: false, error: answer.problem };
    const snapshot = sessionFromAnswer(answer.value);
    return snapshot ? { ok: true, value: snapshot } : { ok: false, error: UNEXPECTED };
  }

  /** The session is whatever the browser now sends back: a browser that refused the cookie is still signed out. */
  async function sessionAfterSignIn(): Promise<ServiceResult<SessionSnapshot, ApiProblem>> {
    const current = await getSession();
    if (current.ok && current.value.status === "signed-out") {
      return { ok: false, error: { kind: "answer", status: 200, code: "cookie_refused", message: "" } };
    }
    return current;
  }

  return {
    getSession,

    async signIn({ email, password, rememberMe }) {
      const answer = await client.post("/api/auth/sign-in/email", { email, password, rememberMe });
      if (!answer.ok) return { ok: false, error: answer.problem };
      if (needsTwoStep(answer.value)) return { ok: true, value: { status: "two-step" } };
      return sessionAfterSignIn();
    },

    async verifyTwoStep({ code, kind, trustDevice }) {
      const path = kind === "totp" ? "/api/auth/two-factor/verify-totp" : "/api/auth/two-factor/verify-backup-code";
      const answer = await client.post(path, { code: code.trim(), trustDevice });
      if (!answer.ok) return { ok: false, error: answer.problem };
      return sessionAfterSignIn();
    },

    async signOut() {
      const answer = await client.post("/api/auth/sign-out", {});
      if (!answer.ok) return { ok: false, error: answer.problem };
      return { ok: true, value: { status: "signed-out" } };
    },
  };
}
