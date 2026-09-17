/**
 * Pageinator workspace route-context contract.
 *
 * This is a UI resolution contract, not a backend enum or production
 * DTO. It resolves opaque URL path segments against an injected
 * fixture set and reports only whether the context is valid — never
 * why an invalid case failed, so a caller cannot construct a
 * distinguishable response for "does not exist" vs. "exists under a
 * different organization/publication" (UI002 §8.1).
 *
 * `resolveWorkspaceContext` is pure and fixture-set-agnostic: it takes
 * the fixture arrays as an argument rather than importing them, so
 * durable `src/app/**` code never imports `src/demo/**` (UI001's same
 * replaceability boundary, applied to UI002).
 */
import { createContext, useContext } from "react";

export interface OrgFixtureLike {
  readonly id: string;
  readonly name: string;
}

export interface PublicationFixtureLike {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly locale: string;
  readonly direction: "ltr" | "rtl";
}

export interface EditionFixtureLike {
  readonly id: string;
  readonly publicationId: string;
  readonly label: string;
}

export interface ReleaseFixtureLike {
  readonly id: string;
  readonly publicationId: string;
  readonly label: string;
}

export interface WorkspaceFixtureSet {
  readonly organizations: readonly OrgFixtureLike[];
  readonly publications: readonly PublicationFixtureLike[];
  readonly editions: readonly EditionFixtureLike[];
  readonly releases: readonly ReleaseFixtureLike[];
}

export interface ResolveParams {
  orgId?: string;
  pubId?: string;
  editionId?: string;
  releaseId?: string;
}

/**
 * A successfully resolved context. Deeper fields (`publication`,
 * `edition`, `release`) are present only when the corresponding URL
 * segment was present and resolved.
 */
export interface ResolvedContext {
  status: "ok";
  organization: OrgFixtureLike;
  publication?: PublicationFixtureLike;
  edition?: EditionFixtureLike;
  release?: ReleaseFixtureLike;
}

/**
 * An invalid context. `level` says *which* segment failed to resolve
 * — needed to phrase a message ("this publication...") and to pick a
 * fallback link — but deliberately carries no reason *within* that
 * level: whether `:pubId` did not match anything at all, or matched a
 * publication that belongs to a *different* organization, both
 * produce the exact same `{ status: "invalid", level: "publication",
 * organization }` value and so must render identically (§8.1 rule 2).
 * `organization` is included only when it did resolve, so a caller can
 * build a "return to a valid entry point" link (§8.1 rule 4) without
 * a second lookup — it is never the *cause* of a deeper-level failure.
 */
export interface InvalidContext {
  status: "invalid";
  level: "organization" | "publication" | "edition" | "release";
  organization?: OrgFixtureLike;
  publication?: PublicationFixtureLike;
}

export type ContextResolution = ResolvedContext | InvalidContext;

/**
 * Resolves org/publication/edition/release path params against a
 * caller-supplied fixture set. A param that is absent from `params`
 * (the route did not declare that segment) is not checked; a param
 * that is present but does not resolve — including resolving to a
 * record that exists under a *different* parent — makes the whole
 * result `{ status: "invalid" }`.
 */
export function resolveWorkspaceContext(
  fixtures: WorkspaceFixtureSet,
  params: ResolveParams
): ContextResolution {
  if (!params.orgId) {
    return { status: "invalid", level: "organization" };
  }
  const organization = fixtures.organizations.find((o) => o.id === params.orgId);
  if (!organization) {
    return { status: "invalid", level: "organization" };
  }

  if (!params.pubId) {
    return { status: "ok", organization };
  }
  const publication = fixtures.publications.find(
    (p) => p.id === params.pubId && p.orgId === organization.id
  );
  if (!publication) {
    return { status: "invalid", level: "publication", organization };
  }

  let edition: EditionFixtureLike | undefined;
  if (params.editionId) {
    edition = fixtures.editions.find(
      (e) => e.id === params.editionId && e.publicationId === publication.id
    );
    if (!edition) {
      return { status: "invalid", level: "edition", organization, publication };
    }
  }

  let release: ReleaseFixtureLike | undefined;
  if (params.releaseId) {
    release = fixtures.releases.find(
      (r) => r.id === params.releaseId && r.publicationId === publication.id
    );
    if (!release) {
      return { status: "invalid", level: "release", organization, publication };
    }
  }

  return { status: "ok", organization, publication, edition, release };
}

/**
 * Picks a safe, always-resolvable "return to a valid entry point"
 * link for an invalid context (§8.1 rule 4): the current publication's
 * overview when that publication resolved, else the current
 * organization's settings page when that organization resolved, else
 * the public home page. It never selects a different fixture record to
 * construct a fallback.
 */
export function fallbackPath(
  _fixtures: WorkspaceFixtureSet,
  invalid: InvalidContext
): string {
  if (!invalid.organization) {
    return "/";
  }
  if (invalid.publication) {
    return `/org/${invalid.organization.id}/pub/${invalid.publication.id}/overview`;
  }
  return `/org/${invalid.organization.id}/settings`;
}

/**
 * Dependency-injection seam: `WorkspaceShell` (durable) consumes this
 * context; the disposable route assembly provides the real fixture
 * set. No default value — using the hook outside a provider is a
 * programming error, not a valid empty state.
 */
const WorkspaceFixturesContext = createContext<WorkspaceFixtureSet | null>(null);

export const WorkspaceFixturesProvider = WorkspaceFixturesContext.Provider;

export function useWorkspaceFixtures(): WorkspaceFixtureSet {
  const fixtures = useContext(WorkspaceFixturesContext);
  if (!fixtures) {
    throw new Error(
      "useWorkspaceFixtures() called outside a WorkspaceFixturesProvider. " +
        "The disposable route assembly must wrap the app in one."
    );
  }
  return fixtures;
}
