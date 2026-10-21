import { Navigate, useNavigate } from "react-router";
import { Button, InlineMessage, ProgressIndicator, Stack } from "../../ui/index.ts";
import { InvalidContextPage } from "../../app/InvalidContextPage.tsx";
import { AccessUnavailable, SessionFailure } from "./SessionStatus.tsx";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { SignOutButton } from "./SignOutButton.tsx";
import { useSession } from "./SessionProvider.tsx";
import type { WorkspaceRouteState } from "../../app/contracts/route-context.ts";

export function ProtectedRouteState({
  state,
  retry,
}: {
  readonly state: Exclude<WorkspaceRouteState, { status: "allowed" }>;
  readonly retry: () => void;
}) {
  const navigate = useNavigate();
  const session = useSession();
  if (state.status === "loading") return <Stack gap="4"><h1 id={ROUTE_HEADING_ID} data-pg-transient-route-heading className="pg-type-page-title" tabIndex={-1}>Loading workspace</h1><ProgressIndicator role="status" aria-live="polite" label="Loading workspace context" /></Stack>;
  if (state.status === "signed-out") {
    return (
      <Navigate
        replace
        to={state.returnTo ? `/login?returnTo=${encodeURIComponent(state.returnTo)}` : paths.login()}
        state={{ expired: session.state.status === "signed-out" && session.state.expired }}
      />
    );
  }
  if (state.status === "session-unavailable") return <SessionFailure />;
  if (state.status === "inaccessible" || state.status === "denied") return <AccessUnavailable />;
  if (state.status === "invalid-context") return <InvalidContextPage invalid={state.invalid} />;
  return (
    <Stack gap="4">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>Workspace temporarily unavailable</h1>
      <InlineMessage
        variant="error"
        heading="Workspace temporarily unavailable"
        live={state.assertive}
      >
        {state.error.displayMessage}
      </InlineMessage>
      <div><Button onClick={retry}>Retry</Button></div>
      <div><SignOutButton beforeSignOut={() => navigate(paths.login(), { replace: true, flushSync: true })} /></div>
    </Stack>
  );
}
