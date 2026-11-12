import { Navigate, useNavigate } from "react-router";
import { Button, InlineMessage, ProgressIndicator, Stack } from "../../ui/index.ts";
import { InvalidContextPage } from "../../app/InvalidContextPage.tsx";
import { AccessUnavailable, SessionFailure } from "./SessionStatus.tsx";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { SignOutButton } from "./SignOutButton.tsx";
import { useSession } from "./SessionProvider.tsx";
import type { WorkspaceRouteState } from "../../app/contracts/route-context.ts";
import { useI18n } from "../../i18n/index.ts";

export function ProtectedRouteState({
  state,
  retry,
}: {
  readonly state: Exclude<WorkspaceRouteState, { status: "allowed" }>;
  readonly retry: () => void;
}) {
  const navigate = useNavigate();
  const session = useSession();
  const { t } = useI18n();
  if (state.status === "loading") return <Stack gap="4"><h1 id={ROUTE_HEADING_ID} data-pg-transient-route-heading className="pg-type-page-title" tabIndex={-1}>{t("shell.loadingWorkspace")}</h1><ProgressIndicator role="status" aria-live="polite" label={t("shell.loadingWorkspaceContext")} /></Stack>;
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
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>{t("shell.workspaceUnavailable")}</h1>
      <InlineMessage
        variant="error"
        heading={t("shell.workspaceUnavailable")}
        live={state.assertive}
        iconLabel={t("message.error")}
      >
        {t("shell.workspaceUnavailable.body")}
      </InlineMessage>
      <div><Button onClick={retry}>{t("shell.retry")}</Button></div>
      <div><SignOutButton beforeSignOut={() => navigate(paths.login(), { replace: true, flushSync: true })} /></div>
    </Stack>
  );
}
