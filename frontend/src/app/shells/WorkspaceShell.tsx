/**
 * WorkspaceShell (UI002 §7.2). Wraps every route under `/org/:orgId`
 * (§6 rows 11–32). This is the single gate that resolves org/
 * publication/edition/release context (§8): it renders
 * `InvalidContextPage` in `<main>` instead of `<Outlet />` whenever
 * resolution fails, so nested layouts (`EditionWorkspaceLayout`) never
 * need to re-check validity themselves.
 */
import { Outlet, Link, useParams, useNavigate, useLocation } from "react-router";
import { Container, Inline, Cluster, Stack, Field, Select } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { CollapsibleNav } from "../CollapsibleNav.tsx";
import { Breadcrumbs, type BreadcrumbItem } from "../Breadcrumbs.tsx";
import { StatusSurface } from "../StatusSurface.tsx";
import { InvalidContextPage } from "../InvalidContextPage.tsx";
import { NotFoundPage } from "../NotFoundPage.tsx";
import { MAIN_LANDMARK_ID, paths, ROUTE_LABELS } from "../routes.ts";
import { resolveWorkspaceContext, useWorkspaceFixtures } from "../contracts/route-context.ts";

interface WorkspaceParams {
  orgId?: string;
  pubId?: string;
  editionId?: string;
  releaseId?: string;
}

/**
 * Maps a route's final URL segment to its `ROUTE_LABELS` key, so the
 * breadcrumb trail's trailing "current section" item can be derived
 * from `location.pathname` directly. This project uses the plain
 * `<BrowserRouter>`/`<Routes>` API (not the data router), so
 * `useMatches()` — which needs a data router — is not available; this
 * is the alternative that works with either.
 */
const SEGMENT_LABEL_KEY: Record<string, keyof typeof ROUTE_LABELS> = {
  settings: "orgSettings",
  billing: "orgBilling",
  storage: "orgStorage",
  overview: "pubOverview",
  editions: "pubEditions",
  stories: "pubStories",
  media: "pubMedia",
  ads: "pubAds",
  templates: "pubTemplates",
  newsroom: "pubNewsroom",
  sources: "pubSources",
  archive: "pubArchive",
  brand: "pubBrand",
  "print-profiles": "pubPrintProfiles",
  team: "pubTeam",
  content: "editionContent",
  generate: "editionGenerate",
  preflight: "editionPreflight",
  export: "editionExport",
};

export interface WorkspaceShellProps {
  notFound?: boolean;
}

export function WorkspaceShell({ notFound = false }: WorkspaceShellProps) {
  const params = useParams() as WorkspaceParams;
  const fixtures = useWorkspaceFixtures();
  const navigate = useNavigate();
  const location = useLocation();
  const resolution = resolveWorkspaceContext(fixtures, params);

  const organization = resolution.organization;
  const publication = resolution.publication;
  const dir = publication?.direction ?? "ltr";
  const lang = publication?.locale ?? "en-IN";
  const statusSubject =
    resolution.status === "ok"
      ? (resolution.edition?.label ?? resolution.publication?.name ?? resolution.organization.name)
      : (publication?.name ?? organization?.name ?? "Workspace");

  const pubNavItems =
    organization && publication
      ? [
          { label: ROUTE_LABELS.pubOverview, to: paths.pubOverview(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubEditions, to: paths.pubEditions(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubStories, to: paths.pubStories(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubMedia, to: paths.pubMedia(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubAds, to: paths.pubAds(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubTemplates, to: paths.pubTemplates(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubNewsroom, to: paths.pubNewsroom(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubSources, to: paths.pubSources(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubArchive, to: paths.pubArchive(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubBrand, to: paths.pubBrand(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubPrintProfiles, to: paths.pubPrintProfiles(organization.id, publication.id) },
          { label: ROUTE_LABELS.pubTeam, to: paths.pubTeam(organization.id, publication.id) },
        ]
      : [];

  const orgNavItems =
    organization
      ? [
          { label: ROUTE_LABELS.orgSettings, to: paths.orgSettings(organization.id) },
          { label: ROUTE_LABELS.orgBilling, to: paths.orgBilling(organization.id) },
          { label: ROUTE_LABELS.orgStorage, to: paths.orgStorage(organization.id) },
        ]
      : [];

  // Breadcrumbs (§7.5): organization → publication → edition (each only
  // when resolved) → the current section's static label. Dynamic
  // fixture names come from the resolved context above; the trailing
  // section label is derived from the URL's final segment via
  // SEGMENT_LABEL_KEY.
  const breadcrumbItems: BreadcrumbItem[] = [];
  if (organization) {
    breadcrumbItems.push({
      label: organization.name,
      to: paths.orgSettings(organization.id),
    });
    if (publication) {
      breadcrumbItems.push({
        label: publication.name,
        to: paths.pubOverview(organization.id, publication.id),
      });
    }
    if (resolution.status === "ok" && resolution.edition && publication) {
      breadcrumbItems.push({
        label: resolution.edition.label,
        to: paths.editionContent(
          organization.id,
          publication.id,
          resolution.edition.id
        ),
      });
    }

    if (resolution.status === "ok" && resolution.release) {
      breadcrumbItems.push({ label: ROUTE_LABELS.pubArchiveRelease, to: location.pathname });
    } else if (resolution.status === "ok") {
      const lastSegment = location.pathname.split("/").filter(Boolean).pop();
      const labelKey = lastSegment ? SEGMENT_LABEL_KEY[lastSegment] : undefined;
      if (labelKey) {
        breadcrumbItems.push({ label: ROUTE_LABELS[labelKey], to: location.pathname });
      }
    } else if (notFound) {
      breadcrumbItems.push({ label: "Page not found", to: location.pathname });
    } else {
      breadcrumbItems.push({ label: "Not available", to: location.pathname });
    }
  }

  return (
    <div className="pg-shell pg-shell--workspace" dir={dir} lang={lang}>
      <SkipLink />
      <header className="pg-shell__header">
        <Container>
          <Stack gap="3">
            <Inline gap="4" wrap="wrap" align="center">
              <Link to={paths.home()} className="pg-shell__brand pg-type-section-title">
                Pageinator
              </Link>

              <Link to={paths.home()}>Back to public site</Link>

              {resolution.status === "ok" && (
                <>
                  <Field label="Organization">
                    <Select
                      value={resolution.organization.id}
                      onChange={(event) => {
                        const nextOrgId = event.target.value;
                        const nextPub = fixtures.publications.find((p) => p.orgId === nextOrgId);
                        navigate(
                          nextPub
                            ? paths.pubOverview(nextOrgId, nextPub.id)
                            : paths.orgSettings(nextOrgId)
                        );
                      }}
                    >
                      {fixtures.organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {resolution.publication && (
                    <Field label="Publication">
                      <Select
                        value={resolution.publication.id}
                        onChange={(event) =>
                          navigate(paths.pubOverview(resolution.organization.id, event.target.value))
                        }
                      >
                        {fixtures.publications
                          .filter((p) => p.orgId === resolution.organization.id)
                          .map((pub) => (
                            <option key={pub.id} value={pub.id}>
                              {pub.name}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  )}
                </>
              )}

              <Cluster gap="3" justify="end">
                <StatusSurface subject={statusSubject} />
              </Cluster>
            </Inline>

            {organization && (
              <CollapsibleNav ariaLabel={publication ? "Publication" : "Organization"}>
                <Cluster gap="4">
                  {(publication ? pubNavItems : orgNavItems).map((item) => (
                    <Link key={item.to} to={item.to}>
                      {item.label}
                    </Link>
                  ))}
                </Cluster>
              </CollapsibleNav>
            )}

            <Breadcrumbs items={breadcrumbItems} />
          </Stack>
        </Container>
      </header>

      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Container>
          {notFound ? (
            <NotFoundPage />
          ) : resolution.status === "ok" ? (
            <Outlet />
          ) : (
            <InvalidContextPage invalid={resolution} fixtures={fixtures} />
          )}
        </Container>
      </main>
    </div>
  );
}
