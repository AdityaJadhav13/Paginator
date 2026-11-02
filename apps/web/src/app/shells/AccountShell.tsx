/**
 * The chrome of the account's own pages (/account/security): the app frame, with the navigation of the active
 * organization's pages when the person has a workspace (the same entries, by the same rules, as WorkspaceShell's).
 */
import { Outlet } from "react-router";
import { AppFrame } from "../AppFrame.tsx";
import { paths } from "../routes.ts";
import { useSession } from "../../features/auth/SessionProvider.tsx";
import { navigation } from "../../features/people/navigation.ts";
import { useI18n } from "../../i18n/index.ts";

const DEVELOPMENT = import.meta.env.DEV;

export function AccountShell() {
  const { state } = useSession();
  const { t, language } = useI18n();
  const workspace = state.status === "ready" ? state.workspace : null;
  const access = workspace?.organizations.find((org) => org.org.id === workspace.activeOrganizationId);
  return (
    <AppFrame
      dir="ltr"
      lang={language}
      nav={
        access
          ? {
              label: t("shell.organization"),
              entries: navigation(access, undefined, DEVELOPMENT),
              homeTo: paths.orgHome(access.org.id),
            }
          : undefined
      }
    >
      <Outlet />
    </AppFrame>
  );
}
