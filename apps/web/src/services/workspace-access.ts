import type { Me } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceError, ServiceResult } from "./result.ts";

/**
 * Which organisations and publications the signed-in person may open, which ones are active, and what they may do in
 * each: the API's `/me` (docs/product/10-l2-newsroom-plan.md §5.2) in the app, the test double in component tests.
 */

/** One organisation of the person, as /me gives it: its name, their organisation role, whether its two-step rule
 * is met, and their roles and grants on each publication. */
export type OrgAccessDto = Me["memberships"][number];

/** The organisations and publications a route may open (derived from `organizations`). */
export interface WorkspaceGrantDto {
  readonly organizationId: string;
  readonly publicationIds: readonly string[];
}

export interface WorkspaceAccessDto {
  readonly access: readonly WorkspaceGrantDto[];
  readonly activeOrganizationId: string;
  /** "" when the active organisation has no publication this person reaches. */
  readonly activePublicationId: string;
  readonly organizations: readonly OrgAccessDto[];
}

/** The placeholder workspace's own errors, or the API's. */
export type WorkspaceAccessError = ServiceError | ApiProblem;

export interface WorkspaceAccessService {
  /** The person's workspace, or null when they belong to no organisation. */
  getAccess(input: { readonly userId: string }): Promise<ServiceResult<WorkspaceAccessDto | null, WorkspaceAccessError>>;
  selectOrganization(input: {
    readonly userId: string;
    readonly organizationId: string;
  }): Promise<ServiceResult<WorkspaceAccessDto, WorkspaceAccessError>>;
  selectPublication(input: {
    readonly userId: string;
    readonly organizationId: string;
    readonly publicationId: string;
  }): Promise<ServiceResult<WorkspaceAccessDto, WorkspaceAccessError>>;
}

/** The grants a route may open, from /me's organisations. */
export function grantsOf(organizations: readonly OrgAccessDto[]): WorkspaceGrantDto[] {
  return organizations.map((org) => ({
    organizationId: org.org.id,
    publicationIds: org.publications.map((publication) => publication.id),
  }));
}
