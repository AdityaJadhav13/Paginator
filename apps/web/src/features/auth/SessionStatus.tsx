import { Link, useLocation, useNavigate } from "react-router";
import { Button, InlineMessage, Stack } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import { ProblemMessage } from "./ProblemMessage.tsx";
import { activeRole, useSession } from "./SessionProvider.tsx";
import { SignOutButton } from "./SignOutButton.tsx";
import { roleName } from "../people/roles.ts";

/** The session could not be read: why, and the ways on. */
export function SessionFailure() {
  const { state, retry } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  if (state.status !== "unavailable") return null;
  return (
    <Stack gap="4">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>{t("signIn.checkFailed.heading")}</h1>
      <SessionProblemMessage />
      <div><Button onClick={() => void retry()}>{t("form.retry")}</Button></div>
      <div><SignOutButton beforeSignOut={() => navigate(paths.login(), { replace: true, flushSync: true })} /></div>
    </Stack>
  );
}

/** Why the session could not be read, announced only when a person's own action led to it. */
export function SessionProblemMessage() {
  const { state } = useSession();
  const { t } = useI18n();
  if (state.status !== "unavailable") return null;
  if (state.reason.source === "session") return <ProblemMessage problem={state.reason.problem} live={state.assertive} />;
  // the workspace service's own note is never shown: the catalogue's text for its code is
  const { error } = state.reason;
  return (
    <InlineMessage variant="error" heading={t("shell.workspaceUnavailable")} live={state.assertive} iconLabel={t("message.error")}>
      {error.code === "temporary-failure" ? t("shell.workspaceUnavailable.body") : t("access.body")}
    </InlineMessage>
  );
}

/** The signed-in person in a shell's header: their name, their workspace role, and Sign out. */
export function SignedInSessionControls({ compact = false }: { readonly compact?: boolean }) {
  const { state } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  if (state.status !== "ready") return null;
  const { workspace } = state;
  const inWorkspace = location.pathname.startsWith("/org/");
  return (
    <div className={compact ? "pg-session-controls pg-session-controls--compact" : "pg-session-controls"}>
      <span>
        <bdi>{state.session.user.name}</bdi>
        {workspace && <> · {roleName(activeRole(workspace), t)}</>}
      </span>
      {workspace && !inWorkspace && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate(paths.orgHome(workspace.activeOrganizationId))}
        >
          {t("signedIn.openWorkspace")}
        </Button>
      )}
      <SignOutButton
        variant="quiet"
        size="sm"
        beforeSignOut={() => {
          if (inWorkspace) navigate(paths.login(), { replace: true, flushSync: true });
        }}
      />
    </div>
  );
}

/** A workspace route this session may not open; identical for an unknown and an inaccessible one. */
export function AccessUnavailable() {
  const { state } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const workspace = state.status === "ready" ? state.workspace : null;
  const activePath = workspace ? paths.orgHome(workspace.activeOrganizationId) : paths.home();
  return (
    <Stack gap="4">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>{t("access.title")}</h1>
      <p>{t("access.body")}</p>
      <p>
        {workspace && <><Link to={activePath}>{t("access.openActive")}</Link> · </>}
        <Link to={paths.home()}>{t("access.publicHome")}</Link>
      </p>
      <div><SignOutButton beforeSignOut={() => navigate(paths.login(), { replace: true, flushSync: true })} /></div>
    </Stack>
  );
}
