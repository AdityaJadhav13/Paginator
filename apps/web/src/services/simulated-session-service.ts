import type { ServiceResult } from "./result.ts";
import type { SessionSnapshot, SimulatedProfileDto } from "./session-dtos.ts";

export interface SimulatedSessionService {
  listProfiles(): Promise<ServiceResult<readonly SimulatedProfileDto[]>>;
  getSession(): Promise<ServiceResult<SessionSnapshot>>;
  signIn(input: { readonly userId: string }): Promise<ServiceResult<SessionSnapshot>>;
  signOut(): Promise<ServiceResult<SessionSnapshot>>;
  selectOrganization(input: {
    readonly organizationId: string;
  }): Promise<ServiceResult<SessionSnapshot>>;
  selectPublication(input: {
    readonly organizationId: string;
    readonly publicationId: string;
  }): Promise<ServiceResult<SessionSnapshot>>;
}
