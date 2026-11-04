// What the Release tab shows and a release checks again (docs/product/10-l2-newsroom-plan.md §1 L2.5; packages/
// contracts/src/release.ts), from the rows src/db/release.ts reads. Pure: the caller reads the rows.
//   - An approval counts only while its (rev, pdfSha256) are the page's own (run_page.pdf_rev, pdf_sha256) and the page
//     has no unsaved edit and does not need saving.
//   - The preflight is exactly PREFLIGHT_CHECKS: every item but not_placed stops a release (nothing can be overridden).
//   - The candidate: every page for the first release; afterwards only the pages whose bytes differ from their newest
//     released file (a correction), each named for its n-th release (_v2, _v3, …).
import {
  type AdSlot,
  type EditionRelease,
  type PageApproval,
  type PreflightItem,
  type PressTest,
  type ReleaseCandidate,
  type ReleaseFile,
  type ReleasePage,
  pressFileName,
} from "@pageinator/contracts";
import type { ApprovalRow, BoardRun, ReleasePageRow, ReleasedRow } from "../../db/release.ts";
import { flagsOf } from "../editor/views.ts";

export type ReleaseState = {
  edition: { id: string; desk_key: string; issue: string; back_page_ads: boolean; folio_changed_at: Date | null };
  run: BoardRun | undefined;
  pages: readonly ReleasePageRow[];
  approvals: readonly ApprovalRow[];
  released: readonly ReleasedRow[];
  /** the plan's back-page ad slots, with the edition's artwork for each */
  slots: readonly AdSlot[];
  /** each slot's ready artwork now: its raster's SHA-256 (compared with the run's ad_rasters) */
  adRasters: Readonly<Record<string, string>>;
  /** a story placed on the run's pages has a photo */
  printsPhoto: boolean;
  /** the edition has ad slot artwork */
  hasArtwork: boolean;
  notPlaced: PreflightItem["stories"];
  pressTest: PressTest | null;
};

type ApprovalPage = Pick<ReleasePageRow, "page_no" | "pdf_rev" | "pdf_sha256" | "needs_save" | "edited_unsaved">;

/** The page's approval that counts now, or null. */
export function approvalOf(page: ApprovalPage, approvals: readonly ApprovalRow[]): PageApproval | null {
  if (page.pdf_sha256 === null || page.needs_save || page.edited_unsaved) return null;
  const found = approvals.find(
    (a) => a.page_no === page.page_no && a.rev === page.pdf_rev && a.pdf_sha256 === page.pdf_sha256,
  );
  return found
    ? {
        by: { id: found.approved_by, name: found.approved_name },
        at: found.approved_at.toISOString(),
        rev: found.rev,
        pdfSha256: found.pdf_sha256,
      }
    : null;
}

export function releasePage(state: ReleaseState, page: ReleasePageRow): ReleasePage {
  const released = state.released.find((r) => r.page_no === page.page_no);
  return {
    runId: state.run?.id ?? "",
    page: page.page_no,
    role: page.role,
    rev: page.pdf_rev,
    pdfSha256: page.pdf_sha256,
    check: page.check,
    needsSave: page.needs_save || page.edited_unsaved,
    approval: approvalOf(page, state.approvals),
    released: released
      ? { name: released.name, sha256: released.sha256, changed: released.sha256 !== page.pdf_sha256 }
      : null,
  };
}

export const needsPressTest = (state: ReleaseState) => state.printsPhoto || state.hasArtwork;

export function preflight(state: ReleaseState): EditionRelease["preflight"] {
  const { pages } = state;
  const none = pages.length === 0;
  const item = (
    check: PreflightItem["check"],
    failing: number[],
    failed = failing.length > 0,
    more: Partial<PreflightItem> = {},
  ): PreflightItem => ({
    check,
    state: failed ? "failed" : "passed",
    pages: [...new Set(failing)].sort((a, b) => a - b),
    slots: [],
    printsOld: false,
    stories: [],
    ...more,
  });
  const flags = flagsOf(state.run?.state ?? "failed", pages);
  // a slot fails without ready artwork, or when the run's pages print other artwork than it has now (set or replaced
  // after the run was made: only a new layout prints it)
  const printed = state.run?.ad_rasters ?? {};
  const slots = state.edition.back_page_ads
    ? state.slots.filter((slot) => slot.state !== "ready" || printed[slot.slot] !== state.adRasters[slot.slot])
    : [];
  const adsOld = slots.some((slot) => slot.state === "ready");
  // page 1 prints the folio its PDF was made with: the run's request (the run's creation) or its last save's live
  // edition; a folio changed after that is not printed until page 1 is saved again (after Update text) or laid out
  const front = pages.find((p) => p.page_no === 1);
  const frontAt = front?.saved_at ?? state.run?.created_at;
  const folioOld =
    state.edition.folio_changed_at !== null && frontAt !== undefined && state.edition.folio_changed_at > frontAt;
  const items: PreflightItem[] = [
    item(
      "laid_out",
      pages.filter((p) => p.state !== "done").map((p) => p.page_no),
      !state.run || none || pages.some((p) => p.state !== "done"),
    ),
    item(
      "pdf_check",
      pages.filter((p) => p.check?.passed !== true).map((p) => p.page_no),
      none || pages.some((p) => p.check?.passed !== true),
    ),
    item("saved", flags.pagesToSave),
    item("placement", [...flags.pagesWithRepeats, ...flags.pagesWithOverlaps]),
    item("folio", state.edition.issue.trim() === "" || folioOld ? [1] : [], undefined, { printsOld: folioOld }),
    item(
      "ad_artwork",
      slots.map((slot) => slot.page),
      slots.length > 0,
      { slots: slots.map((slot) => slot.slot), printsOld: adsOld },
    ),
    item(
      "approved",
      pages.filter((p) => approvalOf(p, state.approvals) === null).map((p) => p.page_no),
      none || pages.some((p) => approvalOf(p, state.approvals) === null),
    ),
    item("press_test", [], needsPressTest(state) && state.pressTest === null),
    {
      check: "not_placed",
      state: state.notPlaced.length > 0 ? "warning" : "passed",
      pages: [],
      slots: [],
      printsOld: false,
      stories: state.notPlaced.slice(0, 400),
    },
  ];
  return { items, passed: items.every((i) => i.state !== "failed") };
}

/** What a release would hold now, or null (no done run, or nothing changed since the last release). */
export function candidate(state: ReleaseState): ReleaseCandidate | null {
  if (!state.run) return null;
  const first = state.released.length === 0;
  const files: ReleaseFile[] = [];
  for (const page of state.pages) {
    if (!page.pdf || page.pdf_sha256 === null) continue;
    const released = state.released.find((r) => r.page_no === page.page_no);
    if (released?.sha256 === page.pdf_sha256) continue;
    files.push({
      page: page.page_no,
      name: pressFileName(state.edition.desk_key, page.page_no, (released?.times ?? 0) + 1),
      rev: page.pdf_rev,
      sha256: page.pdf_sha256,
      bytes: page.pdf.bytes,
      replaces: released?.name ?? null,
    });
  }
  return files.length > 0 ? { kind: first ? "release" : "correction", runId: state.run.id, files } : null;
}

/** The posted files are exactly the candidate's ({page, sha256} each). */
export function sameFiles(posted: readonly { page: number; sha256: string }[], want: ReleaseCandidate | null): boolean {
  if (!want || posted.length !== want.files.length) return false;
  return want.files.every((file) => posted.some((p) => p.page === file.page && p.sha256 === file.sha256));
}
