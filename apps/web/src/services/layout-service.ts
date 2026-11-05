import type {
  AdSlot,
  DeskText,
  EditionLayout,
  EngineProfile,
  EngineProfileList,
  FileLink,
  LayoutRun,
  SectionList,
  SectionPatch,
  TemplateChoiceInput,
  TemplatesView,
} from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts layout.ts): editions and layout, hosted (L2.3). */
export type EngineProfileDto = EngineProfile;
export type EngineProfileListDto = EngineProfileList;
export type EditionLayoutDto = EditionLayout;
export type AdSlotDto = AdSlot;
export type LayoutRunDto = LayoutRun;
export type LayoutPageDto = LayoutRun["pages"][number];
export type FileLinkDto = FileLink;
export type DeskTextDto = DeskText;
export type SectionListDto = SectionList;
export type SectionDto = SectionList["items"][number];
export type TemplatesViewDto = TemplatesView;
export type TemplateCandidateDto = TemplatesView["roles"][number]["candidates"][number];
export type TemplateOutlineDto = TemplateCandidateDto["outline"];

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

/**
 * An edition's layout (plan §1 L2.3) under /api/v1/orgs/:o/pubs/:p: the engine profile (settings.view to see,
 * settings.edit to make one from an uploaded dataset bundle), the edition's readiness, ad slots and runs (pages.view),
 * a run started or cancelled (layout.generate; 409 run_active, layout_refused, run_finished), and a run's files by a
 * 5-minute link (previews pages.view, page and edition PDFs proof.view, the press ZIP export.press).
 */
export interface LayoutService {
  listProfiles(input: Where): Promise<ServiceResult<EngineProfileListDto, ApiProblem>>;
  /** A dataset bundle uploaded (POST …/uploads, purpose engine_dataset) made into a profile: 202, setting up. */
  createProfile(
    input: Where & { readonly uploadId: string; readonly idempotencyKey: string },
  ): Promise<ServiceResult<EngineProfileDto, ApiProblem>>;
  getLayout(input: Where & { readonly editionId: string }): Promise<ServiceResult<EditionLayoutDto, ApiProblem>>;
  setAd(
    input: Where & { readonly editionId: string; readonly slot: string; readonly assetId: string },
  ): Promise<ServiceResult<AdSlotDto, ApiProblem>>;
  clearAd(
    input: Where & { readonly editionId: string; readonly slot: string },
  ): Promise<ServiceResult<void, ApiProblem>>;
  startRun(
    input: Where & { readonly editionId: string; readonly idempotencyKey: string },
  ): Promise<ServiceResult<LayoutRunDto, ApiProblem>>;
  getRun(input: Where & { readonly runId: string }): Promise<ServiceResult<LayoutRunDto, ApiProblem>>;
  cancelRun(input: Where & { readonly runId: string }): Promise<ServiceResult<LayoutRunDto, ApiProblem>>;
  /** A link to one of a run's files (RUN_FILE) that works for 5 minutes. */
  fileLink(
    input: Where & { readonly runId: string; readonly name: string },
  ): Promise<ServiceResult<FileLinkDto, ApiProblem>>;
  /** A run's picture (a page's preview or thumbnail), fetched by a fresh link at once and held in memory only. */
  loadFile(
    input: Where & { readonly runId: string; readonly name: string; readonly signal?: AbortSignal },
  ): Promise<ServiceResult<Blob, ApiProblem>>;
  /** The Templates screen (templates.ts): the profile in use's template per role, its candidates and the versions
   * (templates.view). */
  getTemplates(input: Where): Promise<ServiceResult<TemplatesViewDto, ApiProblem>>;
  /** {role, page}: that page as that role's template; {}: the dataset checked again (templates.edit). A new profile
   * version, 202 setting up; 409 profile_setting_up or no_profile, 400 when the page is not a candidate. */
  chooseTemplate(
    input: Where & { readonly choice: TemplateChoiceInput; readonly idempotencyKey: string },
  ): Promise<ServiceResult<EngineProfileDto, ApiProblem>>;
  /** The publication's sections (publication.view); made, renamed, moved, archived or brought back (settings.edit;
   * 409 section_exists). Each change answers the whole list. */
  listSections(input: Where): Promise<ServiceResult<SectionListDto, ApiProblem>>;
  addSection(input: Where & { readonly name: string }): Promise<ServiceResult<SectionListDto, ApiProblem>>;
  changeSection(
    input: Where & { readonly id: string; readonly change: SectionPatch },
  ): Promise<ServiceResult<SectionListDto, ApiProblem>>;
}
