/**
 * WorkspaceShell (UI002 §7.2; plan §10 PR 20): the chrome of /org/:orgId/…, in the interface language, drawn by the
 * app frame (AppFrame.tsx: top bar, sidebar, content). Its navigation comes from the person's permissions in /me (07 §12, navigation.ts): an entry shows
 * only when they may use it, and, in the deployed app, only when its screen is built. The placeholder screens (and
 * the reserved status surface) show in a development build only (plan §2.6); they are English, marked `lang="en"`.
 */
import { Outlet, useNavigate, useLocation } from "react-router";
import { Icon, Select } from "../../ui/index.ts";
import { AppFrame } from "../AppFrame.tsx";
import { Breadcrumbs, type BreadcrumbItem } from "../Breadcrumbs.tsx";
import { paths } from "../routes.ts";
import { useWorkspaceRouteContext } from "../contracts/route-context.ts";
import { ProtectedRouteState } from "../../features/auth/ProtectedRouteState.tsx";
import { useSession } from "../../features/auth/SessionProvider.tsx";
import { may, navigation } from "../../features/people/navigation.ts";
import { OrgLive } from "../../features/live/live-context.tsx";
import { NotificationsButton } from "../../features/live/Notifications.tsx";
import { TwoStepNeeded } from "../../features/people/TwoStepNeeded.tsx";
import { useI18n, type PlainKey } from "../../i18n/index.ts";

const SEGMENT_LABEL: Readonly<Record<string, PlainKey>> = {
  team: "glossary.team",
  settings: "nav.orgSettings",
  billing: "nav.billing",
  storage: "nav.storage",
  overview: "glossary.overview",
  editions: "nav.editions",
  stories: "glossary.stories",
  media: "nav.media",
  ads: "nav.ads",
  templates: "nav.templates",
  newsroom: "nav.newsroom",
  sources: "nav.sources",
  archive: "glossary.archive",
  brand: "nav.brand",
  "print-profiles": "nav.printProfiles",
  content: "nav.content",
  generate: "glossary.generate",
  preflight: "glossary.preflight",
  export: "glossary.export",
};

const DEVELOPMENT = import.meta.env.DEV;

export function WorkspaceShell() {
  const { state, retry } = useWorkspaceRouteContext();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useI18n();

  if (state.status !== "allowed") {
    const invalidPublication = state.status === "invalid-context" ? state.invalid.publication : undefined;
    // the same frame as below, so the shell (and the skip link's focus) is not remounted once the route resolves
    return (
      <OrgLive orgId={null}>
        <AppFrame dir={invalidPublication?.direction ?? "ltr"} lang={invalidPublication?.locale || language}>
          <ProtectedRouteState state={state} retry={retry} />
        </AppFrame>
      </OrgLive>
    );
  }

  const resolution = state.context;
  const { organization, publication } = resolution;
  const access =
    session.state.status === "ready"
      ? session.state.workspace?.organizations.find((candidate) => candidate.org.id === organization.id)
      : undefined;
  const entries = access ? navigation(access, publication?.id, DEVELOPMENT) : [];
  const blocked = access ? access.twoStep.required && !access.twoStep.satisfied : false;
  const section = publication ? t("shell.publication") : t("shell.organization");
  /** Live updates and notifications: for whoever reaches a publication here (the API's publication.view). */
  const hears = Boolean(access && !blocked && may(access, "publication.view"));

  const breadcrumbItems: BreadcrumbItem[] = [{ label: organization.name, to: paths.orgHome(organization.id) }];
  // a publication's built page is its Stories; its overview is a development placeholder
  const publicationHome = (pubId: string) =>
    DEVELOPMENT ? paths.pubOverview(organization.id, pubId) : paths.pubStories(organization.id, pubId);
  if (publication) breadcrumbItems.push({ label: publication.name, to: publicationHome(publication.id) });
  if (resolution.edition && publication) {
    breadcrumbItems.push({
      label: resolution.edition.label,
      to: paths.editionContent(organization.id, publication.id, resolution.edition.id),
    });
  }
  if (resolution.release) breadcrumbItems.push({ label: t("nav.release"), to: location.pathname });
  else {
    const parts = location.pathname.split("/").filter(Boolean);
    const segment = parts[parts.length - 1];
    if (publication && parts[4] === "stories" && parts.length === 6) {
      breadcrumbItems.push({ label: t("glossary.stories"), to: paths.pubStories(organization.id, publication.id) });
      breadcrumbItems.push({ label: t("glossary.story"), to: location.pathname });
    } else {
      const key = segment ? SEGMENT_LABEL[segment] : undefined;
      if (key) breadcrumbItems.push({ label: t(key), to: location.pathname });
    }
  }

  const onPublicationChange = (next: string) => {
    // the same page of the other publication; a story belongs to one, so its list
    const parts = location.pathname.split("/").filter(Boolean);
    const leaf = parts[4];
    navigate(
      leaf === "stories"
        ? paths.pubStories(organization.id, next)
        : leaf && parts.length === 5
          ? `/org/${organization.id}/pub/${next}/${leaf}`
          : publicationHome(next),
    );
  };

  const context = (
    <>
      <span className="pg-app__switcher">
        <Icon name="building-2" size={16} />
        <Select
          aria-label={t("shell.organization")}
          value={organization.id}
          onChange={async (event) => {
            const result = await session.selectOrganization(event.target.value);
            if (result.ok) navigate(paths.orgHome(result.value.activeOrganizationId));
          }}
        >
          {resolution.organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      </span>
      {publication && (
        <span className="pg-app__switcher">
          <Icon name="newspaper" size={16} />
          <Select
            aria-label={t("shell.publication")}
            value={publication.id}
            onChange={(event) => onPublicationChange(event.target.value)}
          >
            {resolution.publications.map((pub) => (
              <option key={pub.id} value={pub.id}>
                {pub.name}
              </option>
            ))}
          </Select>
        </span>
      )}
    </>
  );

  return (
    <OrgLive orgId={hears ? organization.id : null}>
      <AppFrame
        dir={publication?.direction ?? "ltr"}
        lang={publication?.locale || language}
        nav={{ label: section, entries, homeTo: paths.orgHome(organization.id) }}
        context={context}
        notifications={
          hears && access ? (
            <NotificationsButton orgId={organization.id} mayViewTeam={may(access, "members.view")} />
          ) : undefined
        }
        breadcrumbs={<Breadcrumbs items={breadcrumbItems} label={t("shell.breadcrumb")} />}
      >
        {blocked && access && <TwoStepNeeded org={access} />}
        <Outlet />
      </AppFrame>
    </OrgLive>
  );
}
