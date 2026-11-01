import type { Edition, EditionInput } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** A publication's edition as the API sends it (@pageinator/contracts), with its stories counted. */
export type PubEditionDto = Edition;
export type EditionInputDto = EditionInput;

/** "Send to the Desk": the story bundle's ZIP, its file name and how many stories went in. */
export interface DeskBundleDto {
  readonly file: Blob;
  readonly filename: string;
  readonly stories: number;
}

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

/**
 * A publication's editions (plan §1 L2.1, §5.2): listed newest first; made by the desk with an Idempotency-Key, the
 * same on every retry (409 edition_exists with the edition of that date as the problem's `current`); and an edition's
 * Ready stories sent to the Desk as a story bundle (409 bundle_refused names each story the Desk would refuse).
 */
export interface EditionService {
  list(input: Where): Promise<ServiceResult<readonly PubEditionDto[], ApiProblem>>;
  create(input: Where & { readonly input: EditionInputDto; readonly idempotencyKey: string }): Promise<ServiceResult<PubEditionDto, ApiProblem>>;
  deskBundle(input: Where & { readonly editionId: string }): Promise<ServiceResult<DeskBundleDto, ApiProblem>>;
}
