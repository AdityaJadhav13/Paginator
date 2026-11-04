import type {
  ArchiveCheck,
  EditionRelease,
  PageApproval,
  PressTest,
  Release,
  ReleasePage,
} from "@pageinator/contracts";
import type { FileLinkDto } from "./layout-service.ts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts release.ts): the release (L2.5). */
export type EditionReleaseDto = EditionRelease;
export type ReleasePageDto = ReleasePage;
export type ReleaseItemDto = Release;
export type PageApprovalDto = PageApproval;
export type PressTestDto = PressTest;
export type ArchiveCheckDto = ArchiveCheck;
export type PreflightItemDto = EditionRelease["preflight"]["items"][number];

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}
type Result<T> = Promise<ServiceResult<T, ApiProblem>>;

/**
 * An edition's release (plan §1 L2.5), under /api/v1/orgs/:o/pubs/:p: the preflight list, the pages' approval, the
 * release bound to its files' SHA-256 (409 approval_stale, release_refused; 502 archive_failed), the released files by
 * a 5-minute link, "Mark as sent", the press's confirmation, the archive copy's check and the G2 press test.
 */
export interface ReleaseService {
  get(input: Where & { readonly editionId: string }): Result<EditionReleaseDto>;
  approvePage(
    input: Where & { readonly runId: string; readonly page: number; readonly rev: number; readonly pdfSha256: string },
  ): Result<ReleasePageDto>;
  unlockPage(input: Where & { readonly runId: string; readonly page: number }): Result<ReleasePageDto>;
  create(
    input: Where & {
      readonly editionId: string;
      readonly files: readonly { readonly page: number; readonly sha256: string }[];
      readonly note?: string;
      readonly idempotencyKey: string;
    },
  ): Result<ReleaseItemDto>;
  fileLink(input: Where & { readonly releaseId: string; readonly name: string }): Result<FileLinkDto>;
  markSent(input: Where & { readonly releaseId: string; readonly note?: string }): Result<ReleaseItemDto>;
  confirm(
    input: Where & {
      readonly releaseId: string;
      readonly deliveryId: string;
      readonly pressPerson: string;
      readonly at?: string;
      readonly note?: string;
    },
  ): Result<ReleaseItemDto>;
  verify(input: Where & { readonly releaseId: string }): Result<ArchiveCheckDto>;
  setPressTest(
    input: Where & { readonly pageSha256: string; readonly acceptedOn: string; readonly note?: string },
  ): Result<PressTestDto>;
}
