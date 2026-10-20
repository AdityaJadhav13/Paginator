import { Link, useLocation, useNavigate } from "react-router";
import { Button, Field, InlineMessage, ProgressIndicator, Select, Stack } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { activeRole, useSession } from "./SessionProvider.tsx";

export function SessionLoading() {
  return <Stack gap="4"><h1 id={ROUTE_HEADING_ID} data-pg-transient-route-heading className="pg-type-page-title" tabIndex={-1}>Loading simulated session</h1><ProgressIndicator role="status" aria-live="polite" label="Loading simulated session" /></Stack>;
}

export function SessionFailure() {
  const { state, retry, signOut } = useSession();
  const navigate = useNavigate();
  if (state.status === "temporary-failure") {
    return (
      <Stack gap="4">
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>Session temporarily unavailable</h1>
        <InlineMessage
          variant="error"
          heading="Session temporarily unavailable"
          live={state.assertive}
        >
          {state.error.displayMessage}
        </InlineMessage>
        <div><Button onClick={() => void retry()}>Retry</Button></div>
        <div><Button variant="secondary" onClick={async () => { await signOut(); navigate(paths.login(), { replace: true }); }}>Sign out</Button></div>
      </Stack>
    );
  }
  if (state.status === "denied") {
    return <AccessUnavailable />;
  }
  return null;
}

export function SignedInSessionControls({ compact = false }: { readonly compact?: boolean }) {
  const { state, signIn, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  if (state.status !== "ready") return null;
  const role = activeRole(state.session);
  const workspace = paths.pubOverview(
    state.session.activeOrganizationId,
    state.session.activePublicationId
  );
  return (
    <div className={compact ? "pg-session-controls pg-session-controls--compact" : "pg-session-controls"}>
      <span><bdi>{state.user.displayName}</bdi> · {role}</span>
      {!compact && <Field label="Demonstration identity and role"><Select value={state.user.id} onChange={async (event) => {
        const result = await signIn(event.target.value);
        if (result.ok && result.value.status === "signed-in") {
          navigate(paths.pubOverview(result.value.session.activeOrganizationId, result.value.session.activePublicationId), { replace: true });
        }
      }}>{state.profiles.map(({ user }) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</Select></Field>}
      {!location.pathname.startsWith("/org/") && (
        <Button variant="secondary" size="sm" onClick={() => navigate(workspace)}>
          Open workspace
        </Button>
      )}
      <Button
        variant="quiet"
        size="sm"
        onClick={async () => {
          if (location.pathname.startsWith("/org/")) {
            navigate(paths.login(), { replace: true, flushSync: true });
          }
          await signOut();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

export function AccessUnavailable() {
  const { state, signOut } = useSession();
  const navigate = useNavigate();
  const activePath = state.status === "ready"
    ? paths.pubOverview(state.session.activeOrganizationId, state.session.activePublicationId)
    : paths.home();
  return (
    <Stack gap="4">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>Access unavailable</h1>
      <p>This workspace context is not available for this simulated session.</p>
      <p>Demonstration only — production authorization is not evaluated here</p>
      <p><Link to={activePath}>Open active workspace</Link> · <Link to={paths.home()}>Return to public home</Link></p>
      <div><Button variant="secondary" onClick={async () => { navigate(paths.login(), { replace: true, flushSync: true }); await signOut(); }}>Sign out</Button></div>
    </Stack>
  );
}
