import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";
import type { SessionSnapshot } from "./session-dtos.ts";

export interface SignInInput {
  readonly email: string;
  readonly password: string;
  /** Unticked "Keep me signed in": the session cookie lasts only until the browser closes (plan §4.5). */
  readonly rememberMe: boolean;
}

/**
 * The browser's session, through Better Auth's endpoints under /api/auth (plan §5.2). The real implementation is
 * src/api/session-service.ts; component tests use the double in src/mocks.
 */
export interface SessionService {
  /** Who is signed in on this browser. */
  getSession(): Promise<ServiceResult<SessionSnapshot, ApiProblem>>;
  /** Email and password. A wrong email and a wrong password get the same answer. */
  signIn(input: SignInInput): Promise<ServiceResult<SessionSnapshot, ApiProblem>>;
  signOut(): Promise<ServiceResult<SessionSnapshot, ApiProblem>>;
}
