import type { DocxImport, PasteResult, Story, StoryInput, StoryListItem, StoryPatch, StoryStatus, TransitionTarget } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts), as the stories endpoints send and take them (plan §5.2, §5.4). */
export type StoryDto = Story;
export type StoryListItemDto = StoryListItem;
export type StoryInputDto = StoryInput;
/** A change of a story's fields, named against the version it was made on (`baseRevision`). */
export type StoryPatchDto = StoryPatch;
export type StoryStatusDto = StoryStatus;
export type TransitionTargetDto = TransitionTarget;
export type PasteResultDto = ReturnType<typeof PasteResult.parse>;
/** A Word import (L2.2): its state, the stories it made, what it skipped and why it failed. */
export type DocxImportDto = DocxImport;

/** The list's filters (GET …/stories): every one optional; `cursor` is the API's, from the previous page. */
export interface StoryFilterDto {
  /** an edition's id, or "none": the stories in no edition */
  readonly edition?: string;
  readonly status?: StoryStatus;
  readonly assignee?: "me";
  readonly reporter?: string;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface StoryPageDto {
  readonly items: readonly StoryListItemDto[];
  readonly nextCursor: string | null;
}

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

/**
 * A publication's stories (plan §5.2, §5.4). Every change names the story's version it was made on; when the story has
 * moved on, the answer is 409 `story_changed` and the problem's `current` is the story as it is now (checked with the
 * API's own schema, else left out). Create, paste and transitions carry an Idempotency-Key, the same on every retry.
 */
export interface StoryService {
  list(input: Where & { readonly filter: StoryFilterDto }): Promise<ServiceResult<StoryPageDto, ApiProblem>>;
  get(input: Where & { readonly storyId: string }): Promise<ServiceResult<StoryDto, ApiProblem>>;
  create(input: Where & { readonly input: StoryInputDto; readonly idempotencyKey: string }): Promise<ServiceResult<StoryDto, ApiProblem>>;
  /** `keepalive`: a save sent as the page is left, which must outlive it. */
  update(
    input: Where & { readonly storyId: string; readonly patch: StoryPatchDto; readonly keepalive?: boolean },
  ): Promise<ServiceResult<StoryDto, ApiProblem>>;
  transition(
    input: Where & {
      readonly storyId: string;
      readonly to: TransitionTargetDto;
      readonly baseRevision: number;
      readonly comment?: string;
      readonly idempotencyKey: string;
    },
  ): Promise<ServiceResult<StoryDto, ApiProblem>>;
  assign(
    input: Where & { readonly storyId: string; readonly baseRevision: number; readonly userId: string | null },
  ): Promise<ServiceResult<StoryDto, ApiProblem>>;
  paste(
    input: Where & { readonly text: string; readonly editionId?: string; readonly idempotencyKey: string },
  ): Promise<ServiceResult<PasteResultDto, ApiProblem>>;
  /** A Word file already uploaded (purpose docx) read as stories (POST …/imports/docx, 202): the engine reads it later. */
  importDocx(
    input: Where & { readonly uploadId: string; readonly editionId?: string; readonly idempotencyKey: string },
  ): Promise<ServiceResult<{ readonly importId: string }, ApiProblem>>;
  /** How the import stands (GET …/imports/:id). */
  getImport(input: Where & { readonly importId: string }): Promise<ServiceResult<DocxImportDto, ApiProblem>>;
  /** The story's photo (plan §5.2): set or replace it, change its caption or credit, take it off; each on the story's
   * version, as a change of the story (409 story_changed with `current`). */
  attachPhoto(
    input: Where & {
      readonly storyId: string;
      readonly baseRevision: number;
      readonly assetId: string;
      readonly caption: string;
      readonly credit: string;
    },
  ): Promise<ServiceResult<StoryDto, ApiProblem>>;
  /** `keepalive`: sent as the page is left, so it outlives it (as the story's own PATCH does). */
  updatePhoto(
    input: Where & {
      readonly storyId: string;
      readonly baseRevision: number;
      readonly caption?: string;
      readonly credit?: string;
      readonly keepalive?: boolean;
    },
  ): Promise<ServiceResult<StoryDto, ApiProblem>>;
  removePhoto(input: Where & { readonly storyId: string; readonly baseRevision: number }): Promise<ServiceResult<StoryDto, ApiProblem>>;
}
