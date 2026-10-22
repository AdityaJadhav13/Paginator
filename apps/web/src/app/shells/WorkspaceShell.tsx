/**
 * WorkspaceShell (UI002 §7.2; plan §10 PR 20): the chrome of /org/:orgId/…, in the interface language, with the
 * language switch. Its navigation comes from the person's permissions in /me (07 §12, navigation.ts): an entry shows
 * only when they may use it, and, in the deployed app, only when its screen is built. The placeholder screens (and
 * the reserved status surface) show in a development build only (plan §2.6); they are English, marked `lang="en"`.
 */
import { Outlet, Link, useNavigate, useLocation } from "react-router";
import { Container, Inline, Cluster, Stack, Field, Select } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { CollapsibleNav } from "../CollapsibleNav.tsx";
import { Breadcrumbs, type BreadcrumbItem } from "../Breadcrumbs.tsx";
import { StatusSurface } from "../StatusSurface.tsx";
import { MAIN_LANDMARK_ID, paths } from "../routes.ts";
import { useWorkspaceRouteContext } from "../contracts/route-context.ts";
import { ProtectedRouteState } from "../../features/auth/ProtectedRouteState.tsx";
import { SignedInSessionControls } from "../../features/auth/SessionStatus.tsx";
import { useSession } from "../../features/auth/SessionProvider.tsx";
import { navigation } from "../../features/people/navigation.ts";
import { TwoStepNeeded } from "../../features/people/TwoStepNeeded.tsx";
import { LanguageSwitch, useI18n, type PlainKey } from "../../i18n/index.ts";

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
    return (
      <div
        className="pg-shell pg-shell--workspace"
        dir={invalidPublication?.direction ?? "ltr"}
        lang={invalidPublication?.locale || language}
      >
        <SkipLink label={t("shell.skipLink")} />
        <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
          <Container>
            <ProtectedRouteState state={state} retry={retry} />
          </Container>
        </main>
      </div>
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

  const breadcrumbItems: BreadcrumbItem[] = [{ label: organization.name, to: paths.orgHome(organization.id) }];
  if (publication) breadcrumbItems.push({ label: publication.name, to: paths.pubOverview(organization.id, publication.id) });
  if (resolution.edition && publication) {
    breadcrumbItems.push({
      label: resolution.edition.label,
      to: paths.editionContent(organization.id, publication.id, resolution.edition.id),
    });
  }
  if (resolution.release) breadcrumbItems.push({ label: t("nav.release"), to: location.pathname });
  else {
    const segment = location.pathname.split("/").filter(Boolean).pop();
    const key = segment ? SEGMENT_LABEL[segment] : undefined;
    if (key) breadcrumbItems.push({ label: t(key), to: location.pathname });
  }

  return (
    <div
      className="pg-shell pg-shell--workspace"
      dir={publication?.direction ?? "ltr"}
      lang={publication?.locale || language}
    >
      <SkipLink label={t("shell.skipLink")} />
      <header className="pg-shell__header">
        <Container>
          <Stack gap="3">
            <Inline gap="4" wrap="wrap" align="center">
              <Link to={paths.home()} className="pg-shell__brand pg-type-section-title" lang="en">
                Pageinator
              </Link>
              <Link to={paths.home()}>{t("shell.backToPublic")}</Link>
              <Link to={paths.accountSecurity()}>{t("shell.accountSecurity")}</Link>
              <Cluster gap="3" justify="end">
                <LanguageSwitch />
                {DEVELOPMENT && (
                  <span lang="en">
                    <StatusSurface subject={resolution.edition?.label ?? publication?.name ?? organization.name} />
                  </span>
                )}
              </Cluster>
            </Inline>
            <CollapsibleNav
              ariaLabel={section}
              showLabel={t("shell.showNav", { section })}
              hideLabel={t("shell.hideNav", { section })}
            >
              <Stack gap="3">
                <Cluster gap="4">
                  <Field label={t("shell.organization")}>
                    <Select
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
                  </Field>
                  {publication && (
                    <Field label={t("shell.publication")}>
                      <Select
                        value={publication.id}
                        onChange={(event) => navigate(paths.pubOverview(organization.id, event.target.value))}
                      >
                        {resolution.publications.map((pub) => (
                          <option key={pub.id} value={pub.id}>
                            {pub.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <SignedInSessionControls />
                </Cluster>
                <Cluster gap="4">
                  {entries.map((entry) => (
                    <Link key={entry.to} to={entry.to}>
                      {t(entry.label)}
                    </Link>
                  ))}
                </Cluster>
              </Stack>
            </CollapsibleNav>
            <Breadcrumbs items={breadcrumbItems} label={t("shell.breadcrumb")} />
          </Stack>
        </Container>
      </header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Container>
          <Stack gap="5">
            {blocked && access && <TwoStepNeeded org={access} />}
            <Outlet />
          </Stack>
        </Container>
      </main>
    </div>
  );
}
