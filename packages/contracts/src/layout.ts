// Editions and layout, hosted (docs/product/10-l2-newsroom-plan.md §1 L2.3, §2.2, §2.3, §3.3): the engine profile,
// an edition's readiness and back-page ad slots, layout runs and their pages. The steps are the Desk's
// (tools/desk/CONTRACT.md §3): measure → plan → generate → previews → the independent PDF/X-1a check on every page →
// edition PDF → press ZIP. Three parts:
//   1. the engine's jobs (payloads: ids and the facts that pin exact bytes only) and events (snake case, as the Python
//      runner writes them; engine.ts adds them to EngineEvent, WorkerJob and WorkerResult);
//   2. the progress lines a long job writes before its result (WorkerProgress);
//   3. the HTTP shapes the API answers and the web reads (camel case).
// Wording (plan §2.3): the check is "the independent PDF/X-1a check"; nothing here or on screen says "PDF/X-valid"
// or "press-ready".
import { z } from "zod";

import { OrgId, Uuid7 } from "./ids.ts";
import { OnboardProgress } from "./onboard.ts";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const VersionId = z.string().min(1).max(1024);
const Key = z.string().min(1).max(1024);
const Count = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31 - 1);
const Seconds = z.number().min(0).max(1_000_000);
const Moment = z.iso.datetime({ offset: true });
const Id = z.uuid();

/** The Desk's edition id (YYYY-MM-DD[-n], ASCII digits), story id (a- + 10 hex), photo id (p- + 10 hex), run id
 * (r-YYYYMMDD-HHMMSS) and ad slot id, as tools/desk/deskserver/util.py checks them. */
export const DeskEditionKey = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[1-9][0-9]{0,2})?$/);
export const DeskArticleKey = z.string().regex(/^a-[0-9a-f]{10}$/);
export const DeskPhotoKey = z.string().regex(/^p-[0-9a-f]{10}$/);
export const DeskRunKey = z.string().regex(/^r-[0-9]{8}-[0-9]{6}$/);
export const DeskSlot = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
export const PAGE_ROLES = ["front", "inside", "back"] as const;
export const PageRole = z.enum(PAGE_ROLES);
/** The engine's template roles (tools/desk/engine/desk_engine.py ROLES): page 2 is an inside page with the imprint. */
export const TEMPLATE_ROLES = ["front", "inside_imprint", "inside", "back"] as const;
export const TemplateRole = z.enum(TEMPLATE_ROLES);
export type TemplateRole = z.infer<typeof TemplateRole>;

/** A millimetre size as job text (job arguments are text): a positive decimal, at most two places. */
const MmText = z.string().regex(/^(?:[1-9][0-9]{0,3}|0)(?:\.[0-9]{1,2})?$/);

// ------------------------------------------------------------------------------------------------ the Desk's words

/** One of the Desk's messages (tools/desk/engine/messages.json): its English text as the Desk says it, and its code and
 * parameters when it is one of the Desk's messages (the web says a code it knows in the reader's language, and the
 * English text otherwise). A parameter is flattened to text or a number (a nested message to its English text). */
export const DeskText = z.strictObject({
  text: z.string().min(1).max(2000),
  code: z
    .string()
    .regex(/^m\.[A-Za-z0-9.]{1,120}$/)
    .nullable(),
  params: z.record(z.string().max(40), z.union([z.string().max(2000), z.number()])).nullable(),
});
export type DeskText = z.infer<typeof DeskText>;

// ------------------------------------------------------------------------------------------------ the engine's jobs

/** A stored file the worker wrote, pinned by version and SHA-256. Its key is always under the job's organisation and
 * publication (the key guard), and under the target's own folder (the API checks the folder). */
export const StoredFile = z.strictObject({ key: Key, version_id: VersionId, sha256: Sha256, bytes: Count });
export type StoredFile = z.infer<typeof StoredFile>;

/** engine.setup (queue engine-cpu): a publication's engine profile from its dataset bundle, a ZIP pinned by version and
 * SHA-256 at orgs/<org>/pubs/<pub>/profiles/<profile>/dataset.zip (the key is made from the ids). The ZIP holds the
 * dataset folder (report/page1/pages …) and, optionally, the Desk's own config.json at its root (then its choice of
 * templates is kept, as the Desk made it; otherwise the engine's `setup` chooses). */
export const EngineSetupPayload = z
  .strictObject({
    org_id: OrgId,
    pub_id: Uuid7,
    profile_id: Uuid7,
    version_id: VersionId,
    sha256: Sha256,
    /** A profile made from another one (Templates, templates.ts): that profile's config, pinned; the dataset above is
     * the same bundle copied to this profile's own key. All three or none. */
    base_profile_id: Uuid7.optional(),
    base_config_version_id: VersionId.optional(),
    base_config_sha256: Sha256.optional(),
    /** With a base: this page of the dataset as this role's template (the engine's `retemplate` refuses a page that is
     * not one of the role's candidates); none: the candidates found again (`candidates`). Both or neither. */
    template_role: z.enum(TEMPLATE_ROLES).optional(),
    template_page: z.string().min(1).max(400).optional(),
  })
  .refine(
    (p) => {
      const base = [p.base_profile_id, p.base_config_version_id, p.base_config_sha256].filter((v) => v !== undefined);
      const chosen = [p.template_role, p.template_page].filter((v) => v !== undefined);
      return (
        (base.length === 0 || base.length === 3) && (chosen.length === 0 || (chosen.length === 2 && base.length === 3))
      );
    },
    { message: "base_ fields all or none; template_role and template_page both or neither, and only with a base" },
  );
export type EngineSetupPayload = z.infer<typeof EngineSetupPayload>;

/** What a layout or measure needs of the profile: the dataset (by version and SHA-256, unpacked once per worker home
 * into datasets/<sha256>/) and the config the setup wrote (profiles/<profile>/config.json). */
const ProfileFacts = {
  profile_id: Uuid7,
  dataset_version_id: VersionId,
  dataset_sha256: Sha256,
  config_version_id: VersionId,
  config_sha256: Sha256,
};

/** engine.measure (queue engine-cpu, job key measure:<edition>, 8 s after the last change; never retried): measures an
 * edition's stories ahead of a layout so that a run finds them measured (the engine's cache in the worker's home).
 * The snapshot (the frozen request's shape, plan §2.2) is at orgs/<org>/pubs/<pub>/editions/<edition>/measure.json. */
export const EngineMeasurePayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  edition_id: Uuid7,
  edition_key: DeskEditionKey,
  version_id: VersionId,
  sha256: Sha256,
  ...ProfileFacts,
});
export type EngineMeasurePayload = z.infer<typeof EngineMeasurePayload>;

/** engine.layout (queue engine-cpu, job key run:<run>, one attempt, never retried): one layout run. The frozen
 * request is at orgs/<org>/pubs/<pub>/runs/<run>/request.json (pageinator.layout-request/1 below), pinned here; the
 * worker checks its SHA-256 before anything else (home.py materialise). */
export const EngineLayoutPayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  run_id: Uuid7,
  edition_key: DeskEditionKey,
  run_key: DeskRunKey,
  version_id: VersionId,
  sha256: Sha256,
  ...ProfileFacts,
});
export type EngineLayoutPayload = z.infer<typeof EngineLayoutPayload>;

/** media.ad (queue media): an ad's artwork fitted into its slot at up to 200 ppi (the Desk's images.convert_ad), from
 * the asset's original (orgs/<org>/pubs/<pub>/assets/<asset>/original, pinned). artwork_id is the slot's row
 * (app.ad_slot_artwork.id), the job's target. */
export const MediaAdPayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  artwork_id: Uuid7,
  asset_id: Uuid7,
  version_id: VersionId,
  sha256: Sha256,
  w_mm: MmText,
  h_mm: MmText,
});
export type MediaAdPayload = z.infer<typeof MediaAdPayload>;

// ------------------------------------------------------------------------------------- the frozen request (S3, JSON)

/** A CMYK raster the run places: the rendition's facts from media.ready (or ad.ready). */
export const RasterRef = z.strictObject({
  key: Key,
  version_id: VersionId,
  sha256: Sha256,
  width_px: z.number().int().min(1).max(100_000),
  height_px: z.number().int().min(1).max(100_000),
});
export type RasterRef = z.infer<typeof RasterRef>;

/** request.json / measure.json: the Desk's own snapshot (Store.snapshot: {edition, articles, ads}, CONTRACT.md §1),
 * with each photo's and ad's raster named (apps/engine-worker/pgn_worker/home.py checks it). Articles are the Desk's
 * shape: id (story.desk_key), headline, kicker, deck, byline, body (desk-text/1), priority, page (page pin), photo
 * {id (asset.desk_key), caption, credit, width_px, height_px (the raster's), raster}, source, created, updated. */
export const LAYOUT_REQUEST_FORMAT = "pageinator.layout-request/1";

// ------------------------------------------------------------------------------------------------ the engine's events

const Plan = z.strictObject({
  pages: z.union([z.literal(4), z.literal(8), z.literal(16)]),
  back_page_ads: z.boolean(),
  /** the engine's `plan`: each page's role and its ad slots */
  page_plan: z
    .array(
      z.strictObject({
        page: z.number().int().min(1).max(16),
        role: PageRole,
        template_role: z.string().max(40),
        news_mm2: z.number().min(0),
        ad_slots: z.array(z.strictObject({ slot: DeskSlot, w_mm: z.number().positive(), h_mm: z.number().positive() })),
      }),
    )
    .min(4)
    .max(16),
  /** the engine's `needs` (CONTRACT.md "needs"): medians measured on the paper's own pages */
  needs: z.strictObject({
    stories: Count,
    briefs: Count,
    photos: Count,
    words: Count,
    per_role: z.record(
      z.string().max(40),
      z.strictObject({ stories: Count, briefs: Count, photos: Count, words: Count }),
    ),
    spare_share: z.number().min(0).max(1),
  }),
});

const Mm = z.number().min(-10_000).max(10_000);
const MmBox = z.tuple([Mm, Mm, Mm, Mm]);

/** A template page as the engine reads it (desk_engine.py `outline`), in mm rounded to 0.1: the page, its news area,
 * what it keeps every day (masthead, folio, rules, panels: at most 80) and its ad slots. Not the printed page. */
export const TemplateOutline = z.strictObject({
  page_w_mm: z.number().positive().max(10_000),
  page_h_mm: z.number().positive().max(10_000),
  news: z.array(MmBox).max(20),
  kept: z.array(z.strictObject({ kind: z.string().min(1).max(40), box: MmBox })).max(80),
  ad_slots: z.array(MmBox).max(40),
});
export type TemplateOutline = z.infer<typeof TemplateOutline>;

/** The pages of the dataset able to serve each role (the engine's setup test), newest design first, at most 12 a role
 * and always the chosen one (the config's `candidates`; stored on app.engine_profile.candidates as it is). */
export const TemplateCandidates = z.record(
  z.string().regex(/^[a-z_]{1,40}$/),
  z
    .array(
      z.strictObject({
        name: z.string().min(1).max(400),
        date: z.union([z.literal(""), z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)]),
        page: z.number().int().min(1).max(9999),
        outline: TemplateOutline,
      }),
    )
    .max(40),
);
export type TemplateCandidates = z.infer<typeof TemplateCandidates>;

const ProfileBase = { org_id: OrgId, pub_id: Uuid7, profile_id: Uuid7, sha256: Sha256 };

/** The profile is set up: the config the engine wrote (dataset path taken out), the six plans (4, 8 and 16 pages,
 * with and without back-page ads), and the paper's column grid (the house profile's, which the engine reads). */
export const ProfileReady = z.strictObject({
  kind: z.literal("profile.ready"),
  ...ProfileBase,
  config: StoredFile,
  engine_version: z.string().min(1).max(200),
  templates: z.record(z.string().max(40), z.string().max(400)),
  grid: z.strictObject({
    columns: z.number().int().min(1).max(20),
    column_width_mm: z.number().positive().max(1000),
    gutter_mm: z.number().min(0).max(100),
  }),
  plans: z.array(Plan).length(6),
  /** null: the config names none (it cannot have: the worker finds them when it does not) */
  candidates: TemplateCandidates.nullable(),
  /** the colour profile the worker had (PGN_ICC_SHA256) */
  icc_sha256: Sha256.nullable(),
});

/** The dataset bundle cannot be used: not a ZIP the Desk's limits take (profile.not_zip, profile.too_large,
 * profile.unsafe_path), no page models in it (profile.no_pages), or the engine's setup refused it (profile.setup, with
 * the engine's own words). A finished job, not a failure. */
export const ProfileRejected = z.strictObject({
  kind: z.literal("profile.rejected"),
  ...ProfileBase,
  code: z.string().regex(/^profile\.[a-z_]{1,60}$/),
  message: DeskText,
});

const EditionBase = { org_id: OrgId, pub_id: Uuid7, edition_id: Uuid7, sha256: Sha256 };

/** A measure ended: how many of the snapshot's items the engine measured (the rest wait for the layout). */
export const MeasureStatus = z.strictObject({
  kind: z.literal("measure.status"),
  ...EditionBase,
  state: z.enum(["measuring", "done", "stopped", "failed"]),
  measured: Count,
  total: Count,
  failed: Count,
});

const RunBase = { org_id: OrgId, pub_id: Uuid7, run_id: Uuid7, sha256: Sha256 };
export const RUN_STATES = ["queued", "planning", "layout", "finishing", "done", "failed", "cancelled"] as const;
export const RunState = z.enum(RUN_STATES);
export type RunState = z.infer<typeof RunState>;
export const PAGE_STATES = ["waiting", "working", "done", "failed", "cancelled"] as const;
export const PageState = z.enum(PAGE_STATES);

/** A run's heartbeat (at least every 30 s while it runs) and its state, the Desk's status.json in brief. */
export const RunProgress = z.strictObject({
  kind: z.literal("run.progress"),
  ...RunBase,
  state: z.enum(["planning", "layout", "finishing"]),
  message: DeskText.nullable(),
  pages: z.array(z.strictObject({ page: z.number().int().min(1).max(16), role: PageRole, state: PageState })).max(16),
  elapsed_s: Seconds,
});

const PageCheck = z.strictObject({
  passed: z.boolean(),
  fails: Count.nullable(),
  warnings: Count.nullable(),
  /** the checker's full report, kept beside the PDF (page-NN.pdfx-check.txt); null when the checker could not run */
  report: StoredFile.nullable(),
});

const PageFiles = {
  page: z.number().int().min(1).max(16),
  role: PageRole,
  /** the Desk's article ids on the page */
  articles: z.array(DeskArticleKey).max(200),
  /** runs/<run>/pages/NN/page.pdf, preview.png (long side ~1800 px), thumb.png (~360 px) */
  pdf: StoredFile,
  png: StoredFile.nullable(),
  thumb: StoredFile.nullable(),
  seconds: Seconds.nullable(),
  warnings: z.array(DeskText).max(50),
};

/** A page laid out (its PDF and previews stored) while the run goes on. */
export const RunPage = z.strictObject({ kind: z.literal("run.page"), ...RunBase, ...PageFiles });

/** The run ended. done: the engine made at least one page, then the previews, the check of every page, edition.pdf and
 * press-files.zip (JobManager._complete's steps); failed: the engine's own words (its error, or the Desk's
 * m.run.noPages …); cancelled: stopped on request. A page not laid out has no files. */
export const RunFinished = z.strictObject({
  kind: z.literal("run.finished"),
  ...RunBase,
  state: z.enum(["done", "failed", "cancelled"]),
  message: DeskText.nullable(),
  error: DeskText.nullable(),
  pages: z
    .array(
      z.union([
        z.strictObject({ ...PageFiles, state: z.literal("done"), check: PageCheck }),
        z.strictObject({
          page: z.number().int().min(1).max(16),
          role: PageRole,
          state: z.enum(["waiting", "working", "failed", "cancelled"]),
          message: DeskText.nullable(),
        }),
      ]),
    )
    .max(16),
  not_placed: z.array(z.strictObject({ article: DeskArticleKey, reason: DeskText })).max(400),
  edition_pdf: StoredFile.nullable(),
  press_zip: StoredFile.nullable(),
  /** the independent checker's SHA-256 (experiments/phase0/pdfx1/check_pdfx1a_independent.py) */
  checker_sha256: Sha256,
  engine_version: z.string().min(1).max(200),
  timings: z.record(z.string().max(40), Seconds),
  elapsed_s: Seconds,
});

const SizedFile = z.strictObject({
  ...StoredFile.shape,
  width_px: z.number().int().min(1).max(100_000),
  height_px: z.number().int().min(1).max(100_000),
});
const AdBase = { org_id: OrgId, pub_id: Uuid7, artwork_id: Uuid7, asset_id: Uuid7, sha256: Sha256 };

/** An ad fitted into its slot: its CMYK raster and preview (the asset's renditions, purposes ad-cmyk and ad-preview,
 * under orgs/<org>/pubs/<pub>/assets/<asset>/r/). */
export const AdReady = z.strictObject({
  kind: z.literal("ad.ready"),
  ...AdBase,
  raster: SizedFile,
  preview: SizedFile,
  params_hash: z.string().regex(/^[0-9a-f]{32}$/),
});

/** An ad's artwork the Desk refuses (its words): a finished job. */
export const AdRejected = z.strictObject({
  kind: z.literal("ad.rejected"),
  ...AdBase,
  message: DeskText,
  status: z.number().int().min(400).max(499),
});

/** The progress lines engine.layout, engine.measure and engine.onboard write on stdout before their result (pgn_worker/run.py): one
 * JSON object a line, `seq` counting from 1. The queue reports each to the inbox under the job id `<job>:<seq>`. */
export const WORKER_PROGRESS_FORMAT = "pageinator.worker-progress/1";
export const WorkerProgress = z.strictObject({
  format: z.literal(WORKER_PROGRESS_FORMAT),
  job: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  seq: z.number().int().min(1).max(100_000),
  event: z.discriminatedUnion("kind", [RunProgress, RunPage, MeasureStatus, OnboardProgress]),
});
export type WorkerProgress = z.infer<typeof WorkerProgress>;

// ------------------------------------------------------------------------------------------------ HTTP: the profile

/** A dataset bundle's largest size (4 GiB: one presigned upload, one copy). */
export const MAX_DATASET_BYTES = 4 * 1024 ** 3;
export const DATASET_TYPE = "application/zip";

export const PROFILE_STATES = ["setting_up", "ready", "failed"] as const;
export const EngineProfile = z.strictObject({
  id: Id,
  version: z.number().int().min(1),
  state: z.enum(PROFILE_STATES),
  datasetSha256: Sha256,
  datasetBytes: z.number().int().min(1),
  configSha256: Sha256.nullable(),
  engineVersion: z.string().nullable(),
  templates: z.record(z.string(), z.string()).nullable(),
  grid: z.strictObject({ columns: z.number().int(), columnMm: z.number(), gutterMm: z.number() }).nullable(),
  /** why it failed: the Desk's or the engine's words (profile.… or worker.… code) */
  error: z.strictObject({ code: z.string(), message: DeskText }).nullable(),
  /** made from another profile (Templates) rather than an upload: that profile, and the roles chosen ({} = the
   * dataset checked again) */
  basedOn: z.strictObject({ id: Id, version: z.number().int().min(1) }).nullable(),
  templateChoice: z.record(z.string(), z.string()).nullable(),
  createdBy: z.strictObject({ id: Id, name: z.string() }).nullable(),
  createdAt: Moment,
  updatedAt: Moment,
});
export type EngineProfile = z.infer<typeof EngineProfile>;

/** GET …/engine-profiles (settings.view): newest first, at most 20. The one in use is the newest ready one. */
export const EngineProfileList = z.strictObject({ items: z.array(EngineProfile), inUse: Id.nullable() });
export type EngineProfileList = z.infer<typeof EngineProfileList>;

/** POST …/engine-profiles (settings.edit, Idempotency-Key): an uploaded dataset bundle (POST …/uploads, purpose
 * engine_dataset, application/zip, at most MAX_DATASET_BYTES) → 202 EngineProfile (setting_up). */
export const EngineProfileInput = z.strictObject({ uploadId: Id });

// ------------------------------------------------------------------------------------------- HTTP: an edition's layout

const StoryRef = z.strictObject({ storyId: Id.nullable(), deskKey: DeskArticleKey, headline: z.string().nullable() });

/** One back-page ad slot of the edition's plan, and its artwork. */
export const AdSlot = z.strictObject({
  slot: DeskSlot,
  page: z.number().int().min(1).max(16),
  wMm: z.number(),
  hMm: z.number(),
  /** empty: no artwork; preparing: being fitted (media.ad); ready; failed: refused or not made (problem says why) */
  state: z.enum(["empty", "preparing", "ready", "failed"]),
  assetId: Id.nullable(),
  problem: DeskText.nullable(),
});
export type AdSlot = z.infer<typeof AdSlot>;

/** PUT …/editions/:e/ads/:slot (layout.generate or ads.manage): an asset of the media library (ready) as the slot's
 * artwork → AdSlot (preparing). DELETE …/ads/:slot → 204. */
export const AdSlotInput = z.strictObject({ assetId: Id });

/** What the edition has against what the paper needs (the engine's `plan` of the profile in use), the Desk's needs
 * panel. Stories counted are the edition's Ready (and Placed) stories: those a run lays out. */
export const Readiness = z.strictObject({
  needs: z.strictObject({ stories: Count, briefs: Count, photos: Count, words: Count }),
  have: z.strictObject({ stories: Count, briefs: Count, photos: Count, words: Count }),
  /** the edition's stories that are not Ready (draft, filed, editing, held): not laid out */
  notReady: z.array(z.strictObject({ ...StoryRef.shape, status: z.string() })).max(400),
  /** what stops a run: a Ready story whose photo is still being prepared, or was refused or deleted; a story pinned
   * to a page the edition does not have */
  blockers: z.array(z.strictObject({ ...StoryRef.shape, code: z.string(), message: z.string() })).max(400),
  /** measuring ahead of the layout (null: never measured) */
  measure: z
    .strictObject({
      state: z.enum(["waiting", "measuring", "done", "stopped", "failed"]),
      measured: Count,
      total: Count,
    })
    .nullable(),
});
export type Readiness = z.infer<typeof Readiness>;

export const LayoutPage = z.strictObject({
  page: z.number().int().min(1).max(16),
  role: PageRole,
  state: PageState,
  stories: z.array(StoryRef).max(200),
  /** files of the page: download them by GET …/runs/:r/files/:name (page-NN.pdf, page-NN.png, page-NN.thumb.png,
   * page-NN.pdfx-check.txt) */
  pdf: z.boolean(),
  preview: z.boolean(),
  /** "Independent PDF/X-1a check: passed (2 warnings)"; null: not checked (yet) */
  check: z.strictObject({ passed: z.boolean(), fails: Count.nullable(), warnings: Count.nullable() }).nullable(),
  warnings: z.array(DeskText),
  message: DeskText.nullable(),
});
export type LayoutPage = z.infer<typeof LayoutPage>;

export const LayoutRun = z.strictObject({
  id: Id,
  editionId: Id,
  deskKey: DeskRunKey,
  state: RunState,
  message: DeskText.nullable(),
  error: DeskText.nullable(),
  profileVersion: z.number().int(),
  createdBy: z.strictObject({ id: Id, name: z.string() }).nullable(),
  createdAt: Moment,
  startedAt: Moment.nullable(),
  finishedAt: Moment.nullable(),
  elapsedS: z.number().min(0),
  pages: z.array(LayoutPage).max(16),
  /** the Ready stories the run did not place, with the engine's reason */
  notPlaced: z.array(z.strictObject({ ...StoryRef.shape, reason: DeskText })),
  /** edition.pdf and press-files.zip, once made (a done run) */
  files: z.strictObject({ editionPdf: z.boolean(), pressZip: z.boolean() }),
  timings: z.record(z.string(), z.number()).nullable(),
});
export type LayoutRun = z.infer<typeof LayoutRun>;

/** GET …/editions/:e/layout (pages.view): everything the edition screen's Readiness, Ads, Lay out and Pages tabs show.
 * profile: the one in use (null: none ready: nothing can be laid out yet). active: a run queued or running (one per
 * edition); last: the newest run that ended (done, failed or cancelled); board: the newest done run (the Pages board). */
export const EditionLayout = z.strictObject({
  editionId: Id,
  profile: z.strictObject({ id: Id, version: z.number().int() }).nullable(),
  readiness: Readiness.nullable(),
  slots: z.array(AdSlot),
  active: LayoutRun.nullable(),
  last: LayoutRun.nullable(),
  board: LayoutRun.nullable(),
});
export type EditionLayout = z.infer<typeof EditionLayout>;

/** POST …/editions/:e/runs (layout.generate, Idempotency-Key; no body) → 202 LayoutRun (queued). 409 run_active (one
 * active run an edition; its `current` is that run), 409 layout_refused (no profile ready, no Ready story, or the
 * readiness blockers: `details.blockers`). POST …/runs/:r/cancel (layout.generate) → LayoutRun; 409 run_finished. */
export const RUN_FILE = /^(edition\.pdf|press-files\.zip|page-(0[1-9]|1[0-6])\.(pdf|png|thumb\.png|pdfx-check\.txt))$/;

/** GET …/runs/:r/files/:name → a link that works for 5 minutes. Page previews and the check's report: pages.view; a
 * page PDF and edition.pdf: proof.view; press-files.zip: export.press. Only a done run's files (a page's while the run
 * goes on: its preview). */
export const FileLink = z.strictObject({ url: z.string(), expiresAt: Moment });
export type FileLink = z.infer<typeof FileLink>;
