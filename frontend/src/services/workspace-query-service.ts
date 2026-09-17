import type { EditionDto, OrganizationDto, PublicationDto } from "./dtos.ts";
import type { ServiceResult } from "./result.ts";

/** Hierarchically scoped read boundary for current workspace context. */
export interface WorkspaceQueryService {
  listOrganizations(): Promise<ServiceResult<readonly OrganizationDto[]>>;

  getOrganization(input: {
    readonly organizationId: string;
  }): Promise<ServiceResult<OrganizationDto>>;

  listPublications(input: {
    readonly organizationId: string;
  }): Promise<ServiceResult<readonly PublicationDto[]>>;

  getPublication(input: {
    readonly organizationId: string;
    readonly publicationId: string;
  }): Promise<ServiceResult<PublicationDto>>;

  getEdition(input: {
    readonly organizationId: string;
    readonly publicationId: string;
    readonly editionId: string;
  }): Promise<ServiceResult<EditionDto>>;
}
