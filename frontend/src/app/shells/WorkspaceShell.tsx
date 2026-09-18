import { Outlet, Link, useNavigate, useLocation } from "react-router";
import { Container, Inline, Cluster, Stack, Field, Select } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { CollapsibleNav } from "../CollapsibleNav.tsx";
import { Breadcrumbs, type BreadcrumbItem } from "../Breadcrumbs.tsx";
import { StatusSurface } from "../StatusSurface.tsx";
import { MAIN_LANDMARK_ID, paths, ROUTE_LABELS } from "../routes.ts";
import { useWorkspaceRouteContext } from "../contracts/route-context.ts";
import { ProtectedRouteState } from "../../features/auth/ProtectedRouteState.tsx";
import { SignedInSessionControls } from "../../features/auth/SessionStatus.tsx";
import { useSession } from "../../features/auth/SessionProvider.tsx";

const SEGMENT_LABEL_KEY: Record<string, keyof typeof ROUTE_LABELS> = {
  settings: "orgSettings", billing: "orgBilling", storage: "orgStorage",
  overview: "pubOverview", editions: "pubEditions", stories: "pubStories",
  media: "pubMedia", ads: "pubAds", templates: "pubTemplates",
  newsroom: "pubNewsroom", sources: "pubSources", archive: "pubArchive",
  brand: "pubBrand", "print-profiles": "pubPrintProfiles", team: "pubTeam",
  content: "editionContent", generate: "editionGenerate", preflight: "editionPreflight", export: "editionExport",
};

export function WorkspaceShell() {
  const { state, retry } = useWorkspaceRouteContext();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  if (state.status !== "allowed") {
    const invalidPublication = state.status === "invalid-context" ? state.invalid.publication : undefined;
    return (
      <div className="pg-shell pg-shell--workspace" dir={invalidPublication?.direction ?? "ltr"} lang={invalidPublication?.locale ?? "en-IN"}>
        <SkipLink />
        <main id={MAIN_LANDMARK_ID} tabIndex={-1}><Container><ProtectedRouteState state={state} retry={retry} /></Container></main>
      </div>
    );
  }

  const resolution = state.context;
  const { organization, publication } = resolution;
  const pubNavItems = publication ? [
    [ROUTE_LABELS.pubOverview, paths.pubOverview(organization.id, publication.id)],
    [ROUTE_LABELS.pubEditions, paths.pubEditions(organization.id, publication.id)],
    [ROUTE_LABELS.pubStories, paths.pubStories(organization.id, publication.id)],
    [ROUTE_LABELS.pubMedia, paths.pubMedia(organization.id, publication.id)],
    [ROUTE_LABELS.pubAds, paths.pubAds(organization.id, publication.id)],
    [ROUTE_LABELS.pubTemplates, paths.pubTemplates(organization.id, publication.id)],
    [ROUTE_LABELS.pubNewsroom, paths.pubNewsroom(organization.id, publication.id)],
    [ROUTE_LABELS.pubSources, paths.pubSources(organization.id, publication.id)],
    [ROUTE_LABELS.pubArchive, paths.pubArchive(organization.id, publication.id)],
    [ROUTE_LABELS.pubBrand, paths.pubBrand(organization.id, publication.id)],
    [ROUTE_LABELS.pubPrintProfiles, paths.pubPrintProfiles(organization.id, publication.id)],
    [ROUTE_LABELS.pubTeam, paths.pubTeam(organization.id, publication.id)],
  ] as const : [];
  const orgNavItems = [
    [ROUTE_LABELS.orgSettings, paths.orgSettings(organization.id)],
    [ROUTE_LABELS.orgBilling, paths.orgBilling(organization.id)],
    [ROUTE_LABELS.orgStorage, paths.orgStorage(organization.id)],
  ] as const;

  const breadcrumbItems: BreadcrumbItem[] = [{ label: organization.name, to: paths.orgSettings(organization.id) }];
  if (publication) breadcrumbItems.push({ label: publication.name, to: paths.pubOverview(organization.id, publication.id) });
  if (resolution.edition && publication) breadcrumbItems.push({ label: resolution.edition.label, to: paths.editionContent(organization.id, publication.id, resolution.edition.id) });
  if (resolution.release) breadcrumbItems.push({ label: ROUTE_LABELS.pubArchiveRelease, to: location.pathname });
  else {
    const segment = location.pathname.split("/").filter(Boolean).pop();
    const key = segment ? SEGMENT_LABEL_KEY[segment] : undefined;
    if (key) breadcrumbItems.push({ label: ROUTE_LABELS[key], to: location.pathname });
  }

  return (
    <div className="pg-shell pg-shell--workspace" dir={publication?.direction ?? "ltr"} lang={publication?.locale ?? "en-IN"}>
      <SkipLink />
      <header className="pg-shell__header"><Container><Stack gap="3">
        <Inline gap="4" wrap="wrap" align="center">
          <Link to={paths.home()} className="pg-shell__brand pg-type-section-title">Pageinator</Link>
          <Link to={paths.home()}>Back to public site</Link>
          <Cluster gap="3" justify="end"><StatusSurface subject={resolution.edition?.label ?? publication?.name ?? organization.name} /></Cluster>
        </Inline>
        <CollapsibleNav ariaLabel={publication ? "Publication" : "Organization"}><Stack gap="3"><Cluster gap="4"><Field label="Organization"><Select value={organization.id} onChange={async (event) => {
          const result = await session.selectOrganization(event.target.value);
          if (result.ok && result.value.status === "signed-in") navigate(paths.pubOverview(result.value.session.activeOrganizationId, result.value.session.activePublicationId));
        }}>{resolution.organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</Select></Field>
        {publication && <Field label="Publication"><Select value={publication.id} onChange={(event) => navigate(paths.pubOverview(organization.id, event.target.value))}>{resolution.publications.map((pub) => <option key={pub.id} value={pub.id}>{pub.name}</option>)}</Select></Field>}<SignedInSessionControls /></Cluster><Cluster gap="4">{(publication ? pubNavItems : orgNavItems).map(([label, to]) => <Link key={to} to={to}>{label}</Link>)}</Cluster></Stack></CollapsibleNav>
        <Breadcrumbs items={breadcrumbItems} />
      </Stack></Container></header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}><Container><Outlet /></Container></main>
    </div>
  );
}
