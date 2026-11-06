import type {
  ApprovedPage,
  ArchiveCheck,
  ArchiveList,
  ArchiveRelease,
  PrintProfile,
  PrintProfiles,
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
/** The page editor's 409 page_approved's `current`: the approval and the page it is on. */
export type ApprovedPageDto = ApprovedPage;
export type PressTestDto = PressTest;
export type ArchiveCheckDto = ArchiveCheck;
export type ArchiveListDto = ArchiveList;
export type ArchiveEntryDto = ArchiveList["items"][number];
export type ArchiveReleaseDto = ArchiveRelease;
export type PrintProfileDto = PrintProfile;
export type PrintProfilesDto = PrintProfiles;
export type PreflightItemDto = EditionRelease["preflight"]["items"][number];

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}
type Result<T> = Promise<ServiceResult<T, ApiProblem>>;

/**
 * An edition's release (plan §1 L2.5), under /api/v1/orgs/:o/pubs/:p: the preflight list, the pages' approval, the
 * release bound to its files' SHA-256 (409 approval_stale, release_refused; 502 archive_failed), the released files by
 * a 5-minute link or all in one ZIP, "Mark as sent", the press's confirmation, the archive copy's check and the G2 press
 * test.
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
  /** "Download all": the release's files and their SHA256SUMS in one ZIP, with the file name the API gives it. */
  downloadAll(input: Where & { readonly releaseId: string }): Result<{ readonly file: Blob; readonly filename: string }>;
  /** The same key on a retry of one click records one delivery. */
  markSent(
    input: Where & { readonly releaseId: string; readonly note?: string; readonly idempotencyKey: string },
  ): Result<ReleaseItemDto>;
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
  /** The archive (archive.view): the releases by edition date, filtered and searched; one release with its edition's
   * other releases (404 not_found: none in this publication). */
  archive(
    input: Where & {
      readonly year?: number;
      readonly month?: number;
      readonly kind?: "release" | "correction";
      readonly q?: string;
    },
  ): Result<ArchiveListDto>;
  archiveRelease(input: Where & { readonly releaseId: string }): Result<ArchiveReleaseDto>;
  /** Print profiles (print_profiles.view) and a new version (print_profiles.edit; an Idempotency-Key). */
  printProfiles(input: Where): Result<PrintProfilesDto>;
  addPrintProfile(
    input: Where & {
      readonly pressName: string;
      readonly contact?: string;
      readonly note?: string;
      readonly idempotencyKey: string;
    },
  ): Result<PrintProfileDto>;
}
