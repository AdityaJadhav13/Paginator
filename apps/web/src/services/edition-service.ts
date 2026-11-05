import type { Brand, BrandInput, Edition, EditionInput, EditionPatch } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";

/** The issue number a text is (Latin or Devanagari digits), as the API counts the next one (the test double uses it). */
export { issueNumber } from "@pageinator/contracts";
import type { ServiceResult } from "./result.ts";

/** A publication's edition as the API sends it (@pageinator/contracts), with its stories counted. */
export type PubEditionDto = Edition;
export type EditionInputDto = EditionInput;
/** PATCH …/editions/:e (edition.edit): the folio's volume, issue number and price; a field left out is kept. */
export type EditionPatchDto = EditionPatch;

/** Brand & masthead (packages/contracts/src/brand.ts): the publication's name, the edition defaults "Create edition"
 * fills in, and the newest laid-out front page (its masthead). */
export type BrandDto = Brand;
export type BrandInputDto = BrandInput;

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
  create(
    input: Where & { readonly input: EditionInputDto; readonly idempotencyKey: string },
  ): Promise<ServiceResult<PubEditionDto, ApiProblem>>;
  update(
    input: Where & { readonly editionId: string; readonly patch: EditionPatchDto },
  ): Promise<ServiceResult<PubEditionDto, ApiProblem>>;
  deskBundle(input: Where & { readonly editionId: string }): Promise<ServiceResult<DeskBundleDto, ApiProblem>>;
  /** GET …/brand (anyone on the publication). */
  brand(input: Where): Promise<ServiceResult<BrandDto, ApiProblem>>;
  /** PUT …/brand (brand.edit): a field left out stays. */
  setBrand(input: Where & { readonly input: BrandInputDto }): Promise<ServiceResult<BrandDto, ApiProblem>>;
}
