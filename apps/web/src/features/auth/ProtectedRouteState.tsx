import { Navigate, useNavigate } from "react-router";
import { Button, InlineMessage, ProgressIndicator, Stack } from "../../ui/index.ts";
import { InvalidContextPage } from "../../app/InvalidContextPage.tsx";
import { AccessUnavailable } from "./SessionStatus.tsx";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useSession } from "./SessionProvider.tsx";
import type { WorkspaceRouteState } from "../../app/contracts/route-context.ts";

export function ProtectedRouteState({
  state,
  retry,
}: {
  readonly state: Exclude<WorkspaceRouteState, { status: "allowed" }>;
  readonly retry: () => void;
}) {
  const session = useSession();
  const navigate = useNavigate();
  if (state.status === "loading") return <Stack gap="4"><h1 id={ROUTE_HEADING_ID} data-pg-transient-route-heading className="pg-type-page-title" tabIndex={-1}>Loading workspace</h1><ProgressIndicator role="status" aria-live="polite" label="Loading workspace context" /></Stack>;
  if (state.status === "signed-out") {
    return (
      <Navigate
        replace
        to={state.returnTo ? `/login?returnTo=${encodeURIComponent(state.returnTo)}` : paths.login()}
      />
    );
  }
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
      <div><Button variant="secondary" onClick={async () => { navigate(paths.login(), { replace: true, flushSync: true }); await session.signOut(); }}>Sign out</Button></div>
    </Stack>
  );
}
