import { Outlet, Link } from "react-router";
import { Container, Inline, Cluster } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { StatusSurface } from "../StatusSurface.tsx";
import { MAIN_LANDMARK_ID, paths } from "../routes.ts";
import { useWorkspaceRouteContext } from "../contracts/route-context.ts";
import { ProtectedRouteState } from "../../features/auth/ProtectedRouteState.tsx";
import { SignedInSessionControls } from "../../features/auth/SessionStatus.tsx";

export function EditorShell() {
  const { state, retry } = useWorkspaceRouteContext();
  if (state.status !== "allowed") {
    return <div className="pg-shell pg-shell--editor"><SkipLink /><main id={MAIN_LANDMARK_ID} tabIndex={-1}><Container><ProtectedRouteState state={state} retry={retry} /></Container></main></div>;
  }
  const { organization, publication, edition } = state.context;
  if (!publication || !edition) return null;
  return (
    <div className="pg-shell pg-shell--editor" dir={publication.direction} lang={publication.locale}>
      <SkipLink />
      <header className="pg-shell__header pg-shell__header--editor"><Container><Inline gap="4" wrap="wrap" align="center">
        <span className="pg-type-label">Edition <code className="pg-type-code">{edition.id}</code></span>
        <Cluster gap="3" justify="end"><StatusSurface subject={edition.label} /><SignedInSessionControls compact /><Link to={paths.editionContent(organization.id, publication.id, edition.id)}>Exit editor</Link></Cluster>
      </Inline></Container></header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}><Container><Outlet /></Container></main>
    </div>
  );
}
