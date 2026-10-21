/**
 * When the API ends the session (401 signed_out, plan §4.5), the person goes to sign in again once, and comes back to
 * the same place afterwards (`?returnTo=`). The "Session expired" notice travels in the router state, so it shows on
 * that sign-in page only, and the person stays free to go anywhere else from there. Workspace routes send the person
 * to sign in themselves (ProtectedRouteState), with the same state.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { paths } from "../../app/routes.ts";
import { safeReturnTo } from "./return-to.ts";
import { useSession } from "./SessionProvider.tsx";

/** The router state a sign-in page reads to show "Session expired". */
export interface SignInRouteState {
  readonly expired?: boolean;
}

export function SignedOutRedirect() {
  const { state } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const expired = state.status === "signed-out" && state.expired;
  const wasExpired = useRef(expired);

  useEffect(() => {
    const justExpired = expired && !wasExpired.current;
    wasExpired.current = expired;
    if (!justExpired || location.pathname.startsWith("/org/")) return;
    const returnTo = safeReturnTo(location.pathname, "");
    navigate(returnTo ? `${paths.login()}?returnTo=${encodeURIComponent(returnTo)}` : paths.login(), {
      replace: true,
      state: { expired: true } satisfies SignInRouteState,
    });
  }, [expired, location.pathname, navigate]);

  return null;
}
