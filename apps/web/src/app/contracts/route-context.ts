import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router";
import type { EditionDto, OrganizationDto, PublicationDto, ServiceError, WorkspaceQueryService } from "../../services/index.ts";
import { useSession } from "../../features/auth/SessionProvider.tsx";

export interface ReleaseFixtureLike {
  readonly id: string;
  readonly publicationId: string;
  readonly label: string;
}

export interface ResolvedContext {
  readonly status: "ok";
  readonly organization: OrganizationDto;
  readonly publication?: PublicationDto;
  readonly edition?: EditionDto;
  readonly release?: ReleaseFixtureLike;
  readonly organizations: readonly OrganizationDto[];
  readonly publications: readonly PublicationDto[];
}

export interface InvalidContext {
  readonly status: "invalid";
  readonly level: "organization" | "publication" | "edition" | "release";
  readonly organization?: OrganizationDto;
  readonly publication?: PublicationDto;
}

export type WorkspaceRouteState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out"; readonly returnTo: string }
  /** The session itself could not be read (offline, or the API failed). */
  | { readonly status: "session-unavailable" }
  | { readonly status: "allowed"; readonly context: ResolvedContext }
  | { readonly status: "inaccessible" }
  | { readonly status: "invalid-context"; readonly invalid: InvalidContext }
  | { readonly status: "denied"; readonly error: Extract<ServiceError, { code: "denied" }> }
  | {
      readonly status: "temporary-failure";
      readonly error: Extract<ServiceError, { code: "temporary-failure" }>;
      readonly assertive: boolean;
    };

interface WorkspaceRouteContextValue {
  readonly state: WorkspaceRouteState;
  retry(): void;
}

const WorkspaceRouteContext = createContext<WorkspaceRouteContextValue | null>(null);

function serviceErrorState(error: ServiceError, assertive: boolean): WorkspaceRouteState {
  if (error.code === "temporary-failure") {
    return { status: "temporary-failure", error, assertive };
  }
  if (error.code === "denied") return { status: "denied", error };
  return { status: "invalid-context", invalid: {
    status: "invalid",
    level: error.resource === "user" ? "organization" : error.resource,
  } };
}

export function fallbackPath(invalid: InvalidContext): string {
  if (!invalid.organization) return "/";
  if (invalid.publication) return `/org/${invalid.organization.id}/pub/${invalid.publication.id}/overview`;
  return `/org/${invalid.organization.id}/settings`;
}

export interface WorkspaceRouteProviderProps {
  readonly workspace: WorkspaceQueryService;
  readonly releases: readonly ReleaseFixtureLike[];
  readonly getSessionMutationGeneration?: () => number;
  readonly children: ReactNode;
}

const INITIAL_SESSION_GENERATION = () => 0;

export function WorkspaceRouteProvider({
  workspace,
  releases,
  getSessionMutationGeneration = INITIAL_SESSION_GENERATION,
  children,
}: WorkspaceRouteProviderProps) {
  const params = useParams<{ orgId?: string; pubId?: string; editionId?: string; releaseId?: string }>();
  const location = useLocation();
  const session = useSession();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<WorkspaceRouteState>({ status: "loading" });
  const requestRef = useRef(0);
  const lastResolutionPathRef = useRef<string | undefined>(undefined);
  // the context is resolved again only when what it names changes: moving between two pages of the same publication
  // (a story's list and the story, a new story taking its own address) keeps the screen mounted
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
  const contextKey = [params.orgId, params.pubId, params.editionId, params.releaseId].join("|");

  useEffect(() => {
    const request = ++requestRef.current;
    let active = true;
    const currentSession = session.state;
    if (currentSession.status === "loading") { setState({ status: "loading" }); return; }
    if (currentSession.status === "signed-out") {
      setState({
        status: "signed-out",
        returnTo: session.intentionalSignOut ? "" : pathnameRef.current,
      });
      return;
    }
    if (currentSession.status === "unavailable") {
      const { reason } = currentSession;
      if (reason.source === "session") setState({ status: "session-unavailable" });
      else if (reason.error.code === "temporary-failure") setState({ status: "temporary-failure", error: reason.error, assertive: currentSession.assertive });
      else if (reason.error.code === "denied") setState({ status: "denied", error: reason.error });
      else setState({ status: "inaccessible" });
      return;
    }

    const workspaceAccess = currentSession.workspace;
    const organizationId = params.orgId;
    const publicationId = params.pubId;
    const grant = workspaceAccess?.access.find((candidate) => candidate.organizationId === organizationId);
    if (!workspaceAccess || !organizationId || !grant) { setState({ status: "inaccessible" }); return; }
    if (publicationId && !grant.publicationIds.includes(publicationId)) { setState({ status: "inaccessible" }); return; }

    const assertiveFailure = revision > 0 || (
      lastResolutionPathRef.current !== undefined &&
      lastResolutionPathRef.current !== pathnameRef.current
    );
    lastResolutionPathRef.current = pathnameRef.current;
    const expectedSessionGeneration = getSessionMutationGeneration();
    const isCurrent = () =>
      active &&
      request === requestRef.current &&
      expectedSessionGeneration === getSessionMutationGeneration();

    setState({ status: "loading" });
    void (async () => {
      const organizationsResult = await workspace.listOrganizations();
      if (!organizationsResult.ok) { if (isCurrent()) setState(serviceErrorState(organizationsResult.error, assertiveFailure)); return; }
      if (!isCurrent()) return;
      const organizationResult = await workspace.getOrganization({ organizationId });
      if (!organizationResult.ok) {
        if (isCurrent()) setState(organizationResult.error.code === "unavailable" ? { status: "invalid-context", invalid: { status: "invalid", level: "organization" } } : serviceErrorState(organizationResult.error, assertiveFailure));
        return;
      }
      if (!isCurrent()) return;
      const organization = organizationResult.value;
      const organizations = organizationsResult.value.filter((candidate) => workspaceAccess.access.some((candidateGrant) => candidateGrant.organizationId === candidate.id));

      if (!publicationId) {
        if (workspaceAccess.activeOrganizationId !== organizationId) {
          if (!isCurrent()) return;
          await session.selectOrganization(organizationId);
          return;
        }
        if (isCurrent()) setState({ status: "allowed", context: { status: "ok", organization, organizations, publications: [] } });
        return;
      }

      const publicationsResult = await workspace.listPublications({ organizationId });
      if (!publicationsResult.ok) { if (isCurrent()) setState(serviceErrorState(publicationsResult.error, assertiveFailure)); return; }
      if (!isCurrent()) return;
      const publicationResult = await workspace.getPublication({ organizationId, publicationId });
      if (!publicationResult.ok) {
        if (isCurrent()) setState(publicationResult.error.code === "unavailable" ? { status: "invalid-context", invalid: { status: "invalid", level: "publication", organization } } : serviceErrorState(publicationResult.error, assertiveFailure));
        return;
      }
      if (!isCurrent()) return;
      const publication = publicationResult.value;
      const publications = publicationsResult.value.filter((candidate) => grant.publicationIds.includes(candidate.id));

      let edition: EditionDto | undefined;
      if (params.editionId) {
        const editionResult = await workspace.getEdition({ organizationId, publicationId, editionId: params.editionId });
        if (!editionResult.ok) {
          if (isCurrent()) setState(editionResult.error.code === "unavailable" ? { status: "invalid-context", invalid: { status: "invalid", level: "edition", organization, publication } } : serviceErrorState(editionResult.error, assertiveFailure));
          return;
        }
        if (!isCurrent()) return;
        edition = editionResult.value;
      }

      let release: ReleaseFixtureLike | undefined;
      if (params.releaseId) {
        release = releases.find((candidate) => candidate.id === params.releaseId && candidate.publicationId === publicationId);
        if (!release) { if (isCurrent()) setState({ status: "invalid-context", invalid: { status: "invalid", level: "release", organization, publication } }); return; }
      }

      if (workspaceAccess.activeOrganizationId !== organizationId || workspaceAccess.activePublicationId !== publicationId) {
        // One atomic mutation: selectPublication sets both the active
        // organization and publication. Splitting it into an organization
        // step followed by a publication step would open an await window
        // in which a logout, reset, or newer navigation could land and
        // then be overwritten by this now-stale publication step.
        if (!isCurrent()) return;
        await session.selectPublication(organizationId, publicationId);
        return;
      }

      if (isCurrent()) setState({ status: "allowed", context: { status: "ok", organization, publication, edition, release, organizations, publications } });
    })();
    return () => {
      active = false;
    };
  }, [contextKey, getSessionMutationGeneration, params.editionId, params.orgId, params.pubId, params.releaseId, releases, revision, session, workspace]);

  return createElement(
    WorkspaceRouteContext.Provider,
    { value: { state, retry: () => setRevision((current) => current + 1) } },
    children
  );
}

export function useWorkspaceRouteContext(): WorkspaceRouteContextValue {
  const value = useContext(WorkspaceRouteContext);
  if (!value) throw new Error("useWorkspaceRouteContext() called outside WorkspaceRouteProvider.");
  return value;
}
