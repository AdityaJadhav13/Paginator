import type {
  NewPublication,
  OrgSettings,
  PublicationSettings,
  PublicationSettingsInput,
} from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts settings.ts). */
export type OrgSettingsDto = OrgSettings;
export type PublicationSettingsDto = PublicationSettings;
export type PublicationSettingsInputDto = PublicationSettingsInput;
export type NewPublicationDto = NewPublication;

/**
 * Organization settings (org.settings: Owner and Admin) and a publication's settings (settings.view to read,
 * settings.edit to change), doc 07 §13. Each change answers the whole of what it changed.
 */
export interface SettingsService {
  getOrg(input: { readonly orgId: string }): Promise<ServiceResult<OrgSettingsDto, ApiProblem>>;
  renameOrg(input: { readonly orgId: string; readonly name: string }): Promise<ServiceResult<OrgSettingsDto, ApiProblem>>;
  addPublication(
    input: { readonly orgId: string; readonly publication: NewPublicationDto },
  ): Promise<ServiceResult<OrgSettingsDto, ApiProblem>>;
  getPublication(
    input: { readonly orgId: string; readonly pubId: string },
  ): Promise<ServiceResult<PublicationSettingsDto, ApiProblem>>;
  setPublication(
    input: { readonly orgId: string; readonly pubId: string; readonly change: PublicationSettingsInputDto },
  ): Promise<ServiceResult<PublicationSettingsDto, ApiProblem>>;
}
