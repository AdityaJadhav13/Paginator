/**
 * Who is signed in on this browser, as the web app keeps it. Built from Better Auth's session answer
 * (`GET /api/auth/get-session`, docs/product/10-l2-newsroom-plan.md §5.2), keeping only what the screens show: the
 * session's own token and ids stay in the HttpOnly cookie and the server, never in the app.
 */

export interface SessionUserDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface SessionDto {
  readonly user: SessionUserDto;
}

export type SessionSnapshot =
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly session: SessionDto };
