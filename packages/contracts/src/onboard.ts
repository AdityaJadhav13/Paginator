// Onboard a new paper (docs/product/09-launch-plan.md §L4; docs/runbooks/onboard-a-new-paper.md): a publication's
// past edition PDFs → its engine dataset bundle, made deterministically (tools/onboard: no AI), then the existing
// engine.setup. Three parts, as layout.ts:
//   1. the job (engine.onboard, queue engine-cpu) and its events, snake case as the Python runner writes them;
//   2. the frozen inputs file the API writes and the worker reads (onboarding/<id>/inputs.json);
//   3. the HTTP shapes the API answers and the web reads (camel case).
//
// Keys (made from ids, never from a name): under orgs/<org>/pubs/<pub>/onboarding/<onboarding>/
//   pdfs/NN.pdf      the uploaded PDFs, copied out of quarantine (NN = 01 … 40, the inputs file's `n`)
//   inputs.json      OnboardInputs, written by the API, pinned by version and SHA-256 in the job's payload
//   dataset.zip      the bundle the worker made (the Desk's dataset folder, as engine.setup reads it)
//
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET  onboarding (settings.view) → OnboardingView.
//   POST onboarding OnboardingInput (settings.edit, Idempotency-Key) → 202 Onboarding (queued). 409 onboarding_active
//        (one active a publication), 404 not_found (an upload not the person's own onboard_pdf: as none at all), 400
//        invalid_request (a file not a PDF, named as body.uploadIds.<i>; too few or too many files; the permission not
//        confirmed).
//   POST onboarding/:id/cancel (settings.edit) → Onboarding (cancelled); 409 onboarding_finished once it ended.
//   POST onboarding/:id/use (settings.edit, Idempotency-Key) → 202 EngineProfile (setting_up): the bundle copied to a
//        new profile (profiles/<new>/dataset.zip) and the existing engine.setup enqueued. 409 onboarding_not_ready,
//        409 profile_setting_up.
//   POST onboarding/test-edition (layout.generate, Idempotency-Key) → 201 TestEditionMade: an edition holding the
//        fictional sample stories (en or mr: the publication's primary language), Ready, for "Make a test layout".
//        409 no_profile without a ready profile.
// Audit: onboarding.start, onboarding.cancel, onboarding.use, onboarding.test_edition; the system's onboarding.ready,
// onboarding.fail.
// Wording: nothing here or on screen says "press-ready" or "PDF/X-valid"; the bundle is "your paper's design as we read
// it from your past editions".
import { z } from "zod";

import { OrgId, Uuid7 } from "./ids.ts";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const VersionId = z.string().min(1).max(1024);
const Key = z.string().min(1).max(1024);
const Count = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31 - 1);
const Moment = z.iso.datetime({ offset: true });
const Id = z.uuid();

// ------------------------------------------------------------------------------------------------ limits

export const ONBOARD_PDF_TYPE = "application/pdf";
/** The most bytes of one past edition's PDF (200 MiB: a 16-page press PDF with its pictures). */
export const MAX_ONBOARD_PDF_BYTES = 200 * 1024 ** 2;
/** Files a set may hold: at least 3 editions (the paper's furniture must recur in 3), at most 40. */
export const MIN_ONBOARD_FILES = 3;
export const MAX_ONBOARD_FILES = 40;
/** What we recommend (and the screen says): 12–20 whole editions over at least 3 weeks, in the current design. */
export const RECOMMENDED_ONBOARD_FILES = [12, 20] as const;

// ------------------------------------------------------------------------------------------------ checks

/** One file's check, before the heavy steps (tools/onboard intake: deterministic; the web says each code in the
 * reader's language, en and mr). refused: the file is left out; warning: it is used, with a note. */
export const FILE_CHECK_CODES = [
  "onboard.not_pdf", // not a PDF the reader opens (damaged, encrypted)
  "onboard.scanned", // no text layer: a scan or an image export (refused)
  "onboard.fonts_missing", // fonts not embedded, or Type 3 fonts (refused)
  "onboard.no_unicode", // the words cannot be read: legacy non-Unicode fonts without ActualText (refused; a human case)
  "onboard.untested_program", // not made by InDesign / Adobe PDF Library (warning)
  "onboard.page_size_mix", // its pages are not the size most files have (refused)
  "onboard.duplicate", // the same edition as another file (same bytes or same date) (refused)
  "onboard.no_date", // no edition date in the file name (YYYY-MM-DD or YYYYMMDD) or the PDF's creation date (refused)
  "onboard.frames_excluded", // some text frames could not be read and were left out (warning, count = frames)
  "onboard.legacy_font", // an older non-Unicode font (e.g. Shree-Lipi): its design is learned, its text never used (warning)
] as const;
export const FileCheckCode = z.enum(FILE_CHECK_CODES);
export type FileCheckCode = z.infer<typeof FileCheckCode>;

export const FileCheck = z.strictObject({
  /** the inputs file's n (1 … 40) */
  n: z.number().int().min(1).max(MAX_ONBOARD_FILES),
  status: z.enum(["ok", "warning", "refused"]),
  /** the edition's date as read (null: none found) */
  date: z.iso.date().nullable(),
  pages: Count,
  notes: z.array(z.strictObject({ code: FileCheckCode, count: Count.nullable() })).max(20),
});
export type FileCheck = z.infer<typeof FileCheck>;

/** Why the whole set cannot make a bundle (a finished job, not a failure; the web says it in en and mr). */
export const ONBOARD_REJECT_CODES = [
  "onboard.too_few_editions", // fewer than 3 usable editions after the checks
  "onboard.no_grid", // no column grid found
  "onboard.no_template", // no page found for a role (params.role: front, inside_imprint, inside, back)
  "onboard.too_many_excluded", // more of the text than the limit could not be read: a person must look (O6)
  "onboard.failed", // the chain stopped on these files (a person must look; the message says the step)
  "onboard.script_unconfirmed", // older non-Unicode fonts: the paper's script must be confirmed by a person first
] as const;
export const OnboardRejectCode = z.enum(ONBOARD_REJECT_CODES);

/** What the bundle was made from, as the engine read it (aggregates only: never a story's text). */
export const OnboardReport = z.strictObject({
  editions: Count,
  pages: Count,
  /** the editions used to learn the design (the oldest two thirds); the rest test it */
  calibration_editions: Count,
  page_w_mm: z.number().positive().max(2000),
  page_h_mm: z.number().positive().max(2000),
  grid: z.strictObject({
    columns: z.number().int().min(1).max(20),
    column_width_mm: z.number().positive().max(1000),
    gutter_mm: z.number().min(0).max(100),
  }),
  /** column grids seen on the pages (more than 1: the most common one is used, and the screen says so) */
  grids_seen: z.number().int().min(1).max(50),
  /** the paper's main script: deva (Marathi, Hindi …) or latn (English …) */
  script: z.enum(["deva", "latn"]),
  /** the share of text frames left out because they could not be read (0 … 1) */
  excluded_share: z.number().min(0).max(1),
  /** pages found per template role (setup's test, before engine.setup chooses) */
  roles: z.record(z.enum(["front", "inside_imprint", "inside", "back"]), Count),
});
export type OnboardReport = z.infer<typeof OnboardReport>;

// ------------------------------------------------------------------------------------------------ the job

/** engine.onboard (queue engine-cpu, one attempt): the inputs file pinned by version and SHA-256 (its key is made from
 * the ids: onboarding/<onboarding>/inputs.json); each PDF it names is pinned there by version and SHA-256 too. */
export const EngineOnboardPayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  onboarding_id: Uuid7,
  version_id: VersionId,
  sha256: Sha256,
});
export type EngineOnboardPayload = z.infer<typeof EngineOnboardPayload>;

export const ONBOARD_INPUTS_FORMAT = "pageinator.onboard-inputs/1";
/** onboarding/<id>/inputs.json (JSON, UTF-8), written once by the API. `name` is shown only (the date may be read from
 * it); the file's key is pdfs/NN.pdf from `n`. */
export const OnboardInputs = z.strictObject({
  format: z.literal(ONBOARD_INPUTS_FORMAT),
  files: z
    .array(
      z.strictObject({
        n: z.number().int().min(1).max(MAX_ONBOARD_FILES),
        name: z.string().min(1).max(255),
        version_id: VersionId,
        sha256: Sha256,
        bytes: z.number().int().min(1).max(MAX_ONBOARD_PDF_BYTES),
      }),
    )
    .min(MIN_ONBOARD_FILES)
    .max(MAX_ONBOARD_FILES),
});
export type OnboardInputs = z.infer<typeof OnboardInputs>;

const OnboardBase = { org_id: OrgId, pub_id: Uuid7, onboarding_id: Uuid7, sha256: Sha256 };
export const ONBOARD_STEPS = ["checking", "reading", "measuring", "learning", "pictures", "packing"] as const;

/** A heartbeat (at least every 30 s while it runs: the reconciler stops one whose heartbeat stopped) and its step. */
export const OnboardProgress = z.strictObject({
  kind: z.literal("onboard.progress"),
  ...OnboardBase,
  step: z.enum(ONBOARD_STEPS),
  done: Count,
  total: Count,
});

/** The bundle is made (onboarding/<id>/dataset.zip, pinned), with each file's check and the report. */
export const OnboardReady = z.strictObject({
  kind: z.literal("onboard.ready"),
  ...OnboardBase,
  files: z.array(FileCheck).max(MAX_ONBOARD_FILES),
  report: OnboardReport,
  dataset: z.strictObject({ key: Key, version_id: VersionId, sha256: Sha256, bytes: Count }),
});

/** No bundle: the set's reason, and each file's check (a finished job, not a failure). */
export const OnboardRejected = z.strictObject({
  kind: z.literal("onboard.rejected"),
  ...OnboardBase,
  code: OnboardRejectCode,
  params: z.record(z.string().max(40), z.union([z.string().max(200), z.number()])).nullable(),
  files: z.array(FileCheck).max(MAX_ONBOARD_FILES),
  /** English, for the log and a reader whose language has no words for the code */
  message: z.string().min(1).max(2000),
});

// ------------------------------------------------------------------------------------------------ HTTP

export const ONBOARDING_STATES = ["queued", "working", "ready", "rejected", "failed", "cancelled", "used"] as const;
export const OnboardingState = z.enum(ONBOARDING_STATES);
export type OnboardingState = z.infer<typeof OnboardingState>;

export const Onboarding = z.strictObject({
  id: Id,
  state: OnboardingState,
  /** while working: the step and how far (null before the first heartbeat) */
  progress: z.strictObject({ step: z.enum(ONBOARD_STEPS), done: Count, total: Count }).nullable(),
  files: z.array(
    z.strictObject({
      n: z.number().int().min(1),
      name: z.string(),
      bytes: z.number().int().min(1),
      check: FileCheck.nullable(),
    }),
  ),
  report: OnboardReport.nullable(),
  /** rejected or failed: the code (onboard.… or worker.…) and its params, and the English words */
  problem: z
    .strictObject({
      code: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
      message: z.string(),
    })
    .nullable(),
  /** used: the engine profile made from it */
  profileId: Id.nullable(),
  createdBy: z.strictObject({ id: Id, name: z.string() }).nullable(),
  createdAt: Moment,
  updatedAt: Moment,
});
export type Onboarding = z.infer<typeof Onboarding>;

/** GET …/onboarding: the newest (null: never), and the earlier ones (at most 10, newest first). */
export const OnboardingView = z.strictObject({ current: Onboarding.nullable(), history: z.array(Onboarding) });
export type OnboardingView = z.infer<typeof OnboardingView>;

/** POST …/onboarding: the person's own uploads (purpose onboard_pdf), in the order shown; and their confirmation that
 * the paper owns these pages and lets Pageinator read them to learn its design (replaces the hand-written manifest). */
export const OnboardingInput = z.strictObject({
  uploadIds: z.array(Id).min(MIN_ONBOARD_FILES).max(MAX_ONBOARD_FILES),
  permission: z.literal(true),
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

/** POST …/onboarding/test-edition → the edition made (its id, to open its layout). */
export const TestEditionMade = z.strictObject({ editionId: Id, stories: Count });
export type TestEditionMade = z.infer<typeof TestEditionMade>;
