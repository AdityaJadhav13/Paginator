import type { ServiceResult } from "./result.ts";

/**
 * Which organisations and publications the signed-in person may open in the workspace, and which ones are active.
 *
 * Only the placeholder workspace uses this today, through the test double in src/mocks, so the deployed app has no
 * source for it: a signed-in person there has no workspace yet. The API's `/me` (docs/product/10-l2-newsroom-plan.md
 * §5.2, PR 9) replaces it with the person's real organisations, roles and publications.
 */
export type WorkspaceRole = "editor" | "reviewer";

export interface WorkspaceGrantDto {
  readonly organizationId: string;
  readonly role: WorkspaceRole;
  readonly publicationIds: readonly string[];
}

export interface WorkspaceAccessDto {
  readonly access: readonly WorkspaceGrantDto[];
  readonly activeOrganizationId: string;
  readonly activePublicationId: string;
}

export interface WorkspaceAccessService {
  /** The person's workspace, or null when they have none. */
  getAccess(input: { readonly userId: string }): Promise<ServiceResult<WorkspaceAccessDto | null>>;
  selectOrganization(input: {
    readonly userId: string;
    readonly organizationId: string;
  }): Promise<ServiceResult<WorkspaceAccessDto>>;
  selectPublication(input: {
    readonly userId: string;
    readonly organizationId: string;
    readonly publicationId: string;
  }): Promise<ServiceResult<WorkspaceAccessDto>>;
}
