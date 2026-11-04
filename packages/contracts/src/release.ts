// Release (docs/product/10-l2-newsroom-plan.md §1 L2.5, §2.3, §3.3; doc 06 §9; doc 07 §12): the preflight list, page
// approval and unlocking, release approval bound to the exact SHA-256 of every press file, the minimal archive (the
// released files copied to the archive bucket under S3 Object Lock, governance mode, and read back by SHA-256), "Mark as
// sent", the press's confirmation, receipts, and the late correction (`_v2`).
//
// What is released is the page PDFs of the edition's Pages board run (its newest done run), each one's current bytes
// (app.run_page.pdf: the layout's, or the editor's last save). The independent PDF/X-1a check (plan §2.3) is read from
// app.pdf_check for exactly those bytes and the run's checker, and the archive copy is read back and hashed, so the
// bytes released are the bytes checked. Nothing here says "press-ready" or "PDF/X-valid" (CONTRACT.md §5).
//
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET  editions/:e/release (pages.view) → EditionRelease: the preflight list, each page's approval, what a release
//        would hold now (candidate), the releases with their receipts, the G2 press test on record.
//   POST runs/:r/pages/:n/approve PageApprovalInput (page.approve) → ReleasePage. Only the board run's page, and only
//        its current revision and bytes (rev = run_page.pdf_rev, pdfSha256 = run_page.pdf_sha256, no unsaved edit, not
//        "needs saving"): otherwise 409 approval_stale (current: ReleasePage). Approving it again changes nothing.
//        An approved page is locked: the editor refuses a change, a save or a move to it, and a save of another page
//        that takes a story off it (409 page_approved) until it is unlocked; approvals and unlocks take turns with the
//        editor's saves, moves and changes. Anything else that changes its bytes or revision (a layout run) ends the
//        approval: an approval counts only while its (rev, pdfSha256) are the page's own. A release holds the run's
//        pages: an approval, an unlock or a save waits for it.
//   POST runs/:r/pages/:n/unlock (page.unlock) → ReleasePage: the approval withdrawn (kept, marked unlocked);
//        409 not_approved when it has none.
//   POST editions/:e/releases ReleaseInput (release.approve; a correction also needs release.correct; Idempotency-Key)
//        → 201 Release. The files must be exactly the candidate's ({page, sha256} each): otherwise 409 approval_stale
//        (current: ReleaseCandidate | null). 409 release_refused when a preflight item failed (details name them) or
//        nothing changed since the last release (nothing_to_release). The files are copied to the archive under Object
//        Lock and read back; their SHA-256 must match, or 502 archive_failed and nothing is released.
//   GET  releases/:id/files/:name (export.press) → FileLink: the archived file (5 minutes), exactly the released version.
//   POST releases/:id/deliveries DeliveryInput (export.press) → Release: "Mark as sent" (time, person, files, hashes).
//        Each delivery and confirmation writes receipts.json to the archive again: when that fails, 502 receipt_failed
//        and nothing is recorded (the release itself stands).
//   POST releases/:id/deliveries/:d/confirm ConfirmInput (export.press) → Release: the press's confirmation, once
//        (409 already_confirmed).
//   POST releases/:id/verify (archive.view) → ArchiveCheck: every archived file (and the manifest) read back and hashed.
//   PUT  press-test PressTestInput (settings.edit) → PressTest: the G2 evidence (a photo + ad page the press accepted).
// Audit: page.approve, page.unlock, release.create, release.send, release.confirm, release.verify, press_test.set.
import { z } from "zod";

import { DeskSlot, DeskText } from "./layout.ts";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Moment = z.iso.datetime({ offset: true });
const Id = z.uuid();
const PageNo = z.number().int().min(1).max(16);
const Rev = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31 - 1);
const Person = z.strictObject({ id: Id, name: z.string() });
const Note = z.string().trim().max(2000);
const StoryRef = z.strictObject({ storyId: Id.nullable(), deskKey: z.string(), headline: z.string().nullable() });

/** A press file's name: `<edition date key>_P<NN>.pdf`, and `_v<n>` for a page's n-th release (a late correction):
 * 2026-12-01_P03.pdf, then 2026-12-01_P03_v2.pdf. */
export const PRESS_FILE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[1-9][0-9]{0,2})?_P(0[1-9]|1[0-6])(_v[1-9][0-9]{0,3})?\.pdf$/;
export function pressFileName(editionKey: string, page: number, version: number): string {
  return `${editionKey}_P${String(page).padStart(2, "0")}${version > 1 ? `_v${version}` : ""}.pdf`;
}

// ------------------------------------------------------------------------------------------------ the preflight list

/** Only checks that really run:
 *  laid_out: the edition has a done run and every page of it is done;
 *  pdf_check: each page's current PDF passed the independent PDF/X-1a check (app.pdf_check for its SHA-256 and the
 *    run's checker; a page never checked fails);
 *  saved: no page needs saving, has unsaved edits, or prints older text than the edition holds (pressFlags);
 *  placement: no story on two pages, no overlap or story outside its page (pressFlags);
 *  folio: the edition's issue number is set (the front page prints it), and page 1 prints the folio as it is now (a
 *    volume, issue or price changed after page 1's PDF was made fails it: printsOld);
 *  ad_artwork: every back-page ad slot of the plan has its artwork ready, and the run's pages print that artwork
 *    (artwork set or replaced after the run was made fails it: printsOld; only when the edition has back-page ads);
 *  approved: every page approved on its current revision and bytes;
 *  press_test: the G2 evidence is on record (only when the edition prints a photo or an ad);
 *  not_placed: Ready stories the run left out (a warning: it never stops a release). */
export const PREFLIGHT_CHECKS = [
  "laid_out",
  "pdf_check",
  "saved",
  "placement",
  "folio",
  "ad_artwork",
  "approved",
  "press_test",
  "not_placed",
] as const;
export const PreflightCheck = z.enum(PREFLIGHT_CHECKS);
export type PreflightCheck = z.infer<typeof PreflightCheck>;

export const PreflightItem = z.strictObject({
  check: PreflightCheck,
  /** warning: shown, never stops a release (not_placed only) */
  state: z.enum(["passed", "failed", "warning"]),
  /** the pages it concerns (those failing it) */
  pages: z.array(PageNo).max(16),
  /** ad_artwork: the slots without ready artwork, or whose artwork the pages do not print */
  slots: z.array(DeskSlot).max(40),
  /** folio, ad_artwork: the pages print an older folio or older artwork than the edition has now. The fix is to lay
   * out again (the folio: or Update text on page 1, then save it) */
  printsOld: z.boolean(),
  /** not_placed: the stories left out, with the engine's reason */
  stories: z.array(z.strictObject({ ...StoryRef.shape, reason: DeskText.nullable() })).max(400),
});
export type PreflightItem = z.infer<typeof PreflightItem>;

// ------------------------------------------------------------------------------------------------ pages

export const PageApproval = z.strictObject({
  by: Person,
  at: Moment,
  rev: Rev,
  pdfSha256: Sha256,
});
export type PageApproval = z.infer<typeof PageApproval>;
/** The page editor's 409 page_approved: the approval that refused the change, and the page it is on (the page edited,
 * the page a move goes to, or another page a save would take a story off). */
export const ApprovedPage = z.strictObject({ ...PageApproval.shape, page: PageNo });
export type ApprovedPage = z.infer<typeof ApprovedPage>;

export const ReleasePage = z.strictObject({
  runId: Id,
  page: PageNo,
  role: z.string(),
  /** the revision its PDF was made from (0: the layout's own) and that PDF's SHA-256 (null: no PDF) */
  rev: Rev,
  pdfSha256: Sha256.nullable(),
  /** the independent PDF/X-1a check of exactly those bytes (null: never checked) */
  check: z
    .strictObject({ passed: z.boolean(), fails: z.number().nullable(), warnings: z.number().nullable() })
    .nullable(),
  /** changed and not saved, or needs saving: it cannot be approved until it is saved */
  needsSave: z.boolean(),
  /** the approval that counts now (null: not approved, or its approval no longer matches the page) */
  approval: PageApproval.nullable(),
  /** the newest release of this page: its file and the SHA-256 released; changed: its bytes differ now */
  released: z.strictObject({ name: z.string(), sha256: Sha256, changed: z.boolean() }).nullable(),
});
export type ReleasePage = z.infer<typeof ReleasePage>;

export const PageApprovalInput = z.strictObject({ rev: Rev, pdfSha256: Sha256 });

// ------------------------------------------------------------------------------------------------ releases

export const ReleaseFileRef = z.strictObject({ page: PageNo, sha256: Sha256 });

export const ReleaseFile = z.strictObject({
  page: PageNo,
  name: z.string().regex(PRESS_FILE),
  /** the page's revision and its bytes */
  rev: Rev,
  sha256: Sha256,
  bytes: z.number().int().min(1),
  /** a correction: the file this one replaces (null in a first release) */
  replaces: z.string().regex(PRESS_FILE).nullable(),
});
export type ReleaseFile = z.infer<typeof ReleaseFile>;

/** What "Approve release" would release now: every page (the first release), or only the pages whose bytes changed
 * since their last release (a correction). null: nothing to release (no done run, or nothing changed). */
export const ReleaseCandidate = z.strictObject({
  kind: z.enum(["release", "correction"]),
  runId: Id,
  files: z.array(ReleaseFile).min(1).max(16),
});
export type ReleaseCandidate = z.infer<typeof ReleaseCandidate>;

export const ReleaseInput = z.strictObject({
  files: z.array(ReleaseFileRef).min(1).max(16),
  note: Note.optional(),
});

export const Delivery = z.strictObject({
  id: Id,
  /** "Download and send yourself" (the only method built) */
  method: z.literal("download"),
  sentBy: Person,
  sentAt: Moment,
  note: z.string().nullable(),
  /** the receipt: the files sent and their SHA-256, as recorded */
  files: z
    .array(z.strictObject({ name: z.string(), sha256: Sha256, bytes: z.number().int() }))
    .min(1)
    .max(16),
  /** the press's confirmation, as a staff member recorded it */
  confirmation: z
    .strictObject({ pressPerson: z.string(), at: Moment, note: z.string().nullable(), recordedBy: Person })
    .nullable(),
});
export type Delivery = z.infer<typeof Delivery>;

export const Release = z.strictObject({
  id: Id,
  editionId: Id,
  runId: Id,
  /** 1, 2, … in the edition */
  number: z.number().int().min(1),
  kind: z.enum(["release", "correction"]),
  approvedBy: Person,
  approvedAt: Moment,
  note: z.string().nullable(),
  files: z.array(ReleaseFile).min(1).max(16),
  /** the archive copy: written under Object Lock (governance) until retainUntil, read back and matched by SHA-256 */
  archive: z.strictObject({ verifiedAt: Moment, retainUntil: Moment, manifestSha256: Sha256 }),
  deliveries: z.array(Delivery),
});
export type Release = z.infer<typeof Release>;

export const DeliveryInput = z.strictObject({ note: Note.optional() });
export const ConfirmInput = z.strictObject({
  /** who at the press confirmed (a name, as told) */
  pressPerson: z.string().trim().min(1).max(200),
  /** when the press confirmed (default: now); not before it was sent nor in the future (400 invalid_request) */
  at: Moment.optional(),
  note: Note.optional(),
});

export const ArchiveCheck = z.strictObject({
  checkedAt: Moment,
  files: z.array(z.strictObject({ name: z.string(), sha256: Sha256, ok: z.boolean() })),
  ok: z.boolean(),
});
export type ArchiveCheck = z.infer<typeof ArchiveCheck>;

// ------------------------------------------------------------------------------------------------ the G2 press test

/** The G2 evidence (doc 13 G2; plan §1 L2.5 release check): the press accepted a test page with a photo and an ad,
 * named by its PDF's SHA-256. The owner fills it in; until then an edition with a photo or an ad cannot be released. */
export const PressTest = z.strictObject({
  pageSha256: Sha256,
  acceptedOn: z.iso.date(),
  note: z.string().nullable(),
  recordedBy: Person,
  recordedAt: Moment,
});
export type PressTest = z.infer<typeof PressTest>;
export const PressTestInput = z.strictObject({
  pageSha256: Sha256,
  acceptedOn: z.iso.date(),
  note: Note.optional(),
});

// ------------------------------------------------------------------------------------------------ the Release tab

export const EditionRelease = z.strictObject({
  editionId: Id,
  /** the Pages board run (null: no done run yet) */
  runId: Id.nullable(),
  preflight: z.strictObject({
    items: z.array(PreflightItem),
    /** no item failed */
    passed: z.boolean(),
  }),
  pages: z.array(ReleasePage).max(16),
  candidate: ReleaseCandidate.nullable(),
  /** newest first */
  releases: z.array(Release),
  /** the edition prints a photo or an ad: the G2 evidence is needed */
  needsPressTest: z.boolean(),
  pressTest: PressTest.nullable(),
});
export type EditionRelease = z.infer<typeof EditionRelease>;
