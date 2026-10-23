import type { Asset, PICTURE_TYPES } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts media.ts). */
export type AssetDto = Asset;
export type PictureTypeDto = (typeof PICTURE_TYPES)[number];

/** A presigned POST (plan §6.2): the browser sends `fields`, then the file, to `url`, before `expiresAt`. */
export interface PresignedUploadDto {
  readonly uploadId: string;
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

/**
 * Photo uploads (plan §5.2, §6.2): presign (with an Idempotency-Key: a retry with the same key and body gets the
 * same policy while it lasts), the file straight to the object store with the policy's exact fields, then complete,
 * which makes the asset. The web's own problem codes: `upload_cancelled` (the person stopped it), `upload_denied`
 * (the store refused the policy, 403: its 15 minutes are over, or one of its conditions failed: the screen tells
 * which by the policy's `expiresAt`), `upload_size_mismatch` (the file is not the size the policy names: it changed
 * while being sent), `upload_refused` (any other refusal of the store).
 */
export interface MediaService {
  presign(
    input: Where & {
      readonly filename: string;
      readonly contentType: PictureTypeDto;
      readonly bytes: number;
      readonly idempotencyKey: string;
    },
  ): Promise<ServiceResult<PresignedUploadDto, ApiProblem>>;
  /** The file to the store; `onProgress` gets 0…1; `signal` cancels. */
  send(input: {
    readonly upload: PresignedUploadDto;
    readonly file: Blob;
    readonly onProgress?: (fraction: number) => void;
    readonly signal?: AbortSignal;
  }): Promise<ServiceResult<void, ApiProblem>>;
  complete(input: Where & { readonly uploadId: string }): Promise<ServiceResult<AssetDto, ApiProblem>>;
  /** The original's address at the API, for "Download the original" (a 302 to a fresh 5-minute link, no-store). */
  fileUrl(input: Where & { readonly assetId: string }): string;
  /**
   * The original itself, to show in the page: asked of the API each time (a fresh 5-minute link is followed at once),
   * never kept in the HTTP cache, and held only in memory by the screen that shows it.
   */
  loadOriginal(input: Where & { readonly assetId: string; readonly signal?: AbortSignal }): Promise<ServiceResult<Blob, ApiProblem>>;
}
