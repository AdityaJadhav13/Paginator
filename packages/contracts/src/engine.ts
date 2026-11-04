// The engine worker's jobs and events (docs/product/10-l2-newsroom-plan.md §2.2): what the API enqueues for the queue
// (apps/engine-queue, Graphile Worker), what the Python runner answers (apps/engine-worker/pgn_worker/jobs.py), and the
// events the queue writes to the API's inbox (app.engine_event). Snake case, as the runner writes them.
import { z } from "zod";

import { OrgId, Uuid7 } from "./ids.ts";
import {
  AdReady,
  AdRejected,
  EngineLayoutPayload,
  EngineMeasurePayload,
  EngineSetupPayload,
  MeasureStatus,
  MediaAdPayload,
  ProfileReady,
  ProfileRejected,
  RunFinished,
  RunPage,
  RunProgress,
} from "./layout.ts";
import { NewsCollected, NewsDrafted, NewsDraftFailed } from "./news.ts";

export { OrgId, Uuid7 };
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const VersionId = z.string().min(1).max(1024);
/** A count the database keeps as an integer (app.rendition.bytes): a larger one is refused as the contract's. */
const Count = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31 - 1);
const Pixels = z.number().int().min(1).max(100_000);

/** media.ingest's payload in the queue: ids, and the facts that pin the exact bytes (never a name, a text or a key:
 * the original's key is made from the ids, as the database makes it). */
export const MediaIngestPayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  asset_id: Uuid7,
  version_id: VersionId,
  sha256: Sha256,
});
export type MediaIngestPayload = z.infer<typeof MediaIngestPayload>;

/** docx.import's payload: the import's ids and the facts that pin the Word file's exact bytes (its key is made from the
 * ids: orgs/<org>/pubs/<pub>/imports/<import>/original, as the database makes it). */
export const DocxImportPayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  import_id: Uuid7,
  version_id: VersionId,
  sha256: Sha256,
});
export type DocxImportPayload = z.infer<typeof DocxImportPayload>;

const EventBase = { org_id: OrgId, pub_id: Uuid7, asset_id: Uuid7, sha256: Sha256 };

export const Rendition = z.strictObject({
  purpose: z.enum(["preview", "thumb", "cmyk"]),
  key: z.string().min(1).max(1024),
  version_id: VersionId,
  sha256: Sha256,
  bytes: Count,
  mime: z.enum(["image/jpeg", "application/gzip"]),
  width_px: Pixels,
  height_px: Pixels,
});

export const MediaReady = z.strictObject({
  kind: z.literal("media.ready"),
  ...EventBase,
  bytes: Count,
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width_px: Pixels,
  height_px: Pixels,
  raster: z.strictObject({ width_px: Pixels, height_px: Pixels }),
  params_hash: z.string().regex(/^[0-9a-f]{32}$/),
  renditions: z.array(Rendition).length(3),
});

/** A photo the Desk refuses (its words, and its code where the Desk has one): a finished job, not a failure. */
export const MediaRejected = z.strictObject({
  kind: z.literal("media.rejected"),
  ...EventBase,
  // as app.asset.problem takes it: at most 120 characters after "m."
  code: z
    .string()
    .regex(/^m\.[A-Za-z0-9.]{1,120}$/)
    .nullable(),
  message: z.string().min(1).max(2000),
  status: z.number().int().min(400).max(499),
});

const ImportBase = { org_id: OrgId, pub_id: Uuid7, import_id: Uuid7, sha256: Sha256 };

/** A Word file read: its articles and the Desk's notes are in the result file the worker wrote beside it
 * (imports/<import>/result-<sha256 of the file>.json, DocxResult), pinned by version and SHA-256; never text in the
 * event. */
export const ImportParsed = z.strictObject({
  kind: z.literal("import.parsed"),
  ...ImportBase,
  result_key: z.string().min(1).max(1024),
  result_version_id: VersionId,
  result_sha256: Sha256,
  articles: Count,
});

/** A Word file the Desk refuses (its plain message, and a code for the web's own words): a finished job. */
export const ImportRejected = z.strictObject({
  kind: z.literal("import.rejected"),
  ...ImportBase,
  code: z.string().regex(/^docx\.[a-z_]{1,60}$/),
  message: z.string().min(1).max(2000),
  status: z.number().int().min(400).max(499),
});

/** The result file of import.parsed (JSON, UTF-8). */
export const DOCX_RESULT_FORMAT = "pageinator.docx-result/1";
export const DocxResult = z.strictObject({
  format: z.literal(DOCX_RESULT_FORMAT),
  articles: z.array(z.strictObject({ headline: z.string(), byline: z.string(), body: z.string() })).max(200),
  notes: z
    .array(
      z.strictObject({
        code: z.string().regex(/^docx\.[a-z_]{1,60}$/),
        count: z.number().int().min(0).nullable(),
        text: z.string().max(2000),
      }),
    )
    .max(20),
});
export type DocxResult = z.infer<typeof DocxResult>;

export const JOB_KINDS = [
  "media.ingest",
  "docx.import",
  "news.collect",
  "news.draft",
  "engine.setup",
  "engine.measure",
  "engine.layout",
  "media.ad",
] as const;

/** A job that cannot finish (the queue writes it: a final failure, or a retry out of attempts). */
export const JobFailed = z.strictObject({
  kind: z.literal("job.failed"),
  org_id: OrgId,
  pub_id: Uuid7,
  job_kind: z.enum(JOB_KINDS),
  /** the asset (media.ingest), the import (docx.import), the run (news.collect), the draft (news.draft), the profile
   * (engine.setup), the edition (engine.measure), the layout run (engine.layout) or the ad slot's row (media.ad) */
  target_id: Uuid7,
  code: z.string().regex(/^worker\.[a-z]{1,120}$/),
  message: z.string().max(2000),
});

export const EngineEvent = z.discriminatedUnion("kind", [
  MediaReady,
  MediaRejected,
  ImportParsed,
  ImportRejected,
  NewsCollected,
  NewsDrafted,
  NewsDraftFailed,
  ProfileReady,
  ProfileRejected,
  MeasureStatus,
  RunProgress,
  RunPage,
  RunFinished,
  AdReady,
  AdRejected,
  JobFailed,
]);
export type EngineEvent = z.infer<typeof EngineEvent>;

export const WORKER_JOB_FORMAT = "pageinator.worker-job/1";
export const WORKER_RESULT_FORMAT = "pageinator.worker-result/1";
/** One job for the Python runner (`python -m pgn_worker.run` on stdin; pgn_worker/jobs.py checks the same): the queue's
 * job id, the kind, and its payload (ids only). */
const JobBase = { format: z.literal(WORKER_JOB_FORMAT), id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) };
export const WorkerJob = z.discriminatedUnion("kind", [
  z.strictObject({ ...JobBase, kind: z.literal("media.ingest"), args: MediaIngestPayload }),
  z.strictObject({ ...JobBase, kind: z.literal("docx.import"), args: DocxImportPayload }),
  z.strictObject({ ...JobBase, kind: z.literal("engine.setup"), args: EngineSetupPayload }),
  z.strictObject({ ...JobBase, kind: z.literal("engine.measure"), args: EngineMeasurePayload }),
  z.strictObject({ ...JobBase, kind: z.literal("engine.layout"), args: EngineLayoutPayload }),
  z.strictObject({ ...JobBase, kind: z.literal("media.ad"), args: MediaAdPayload }),
]);
export type WorkerJob = z.infer<typeof WorkerJob>;
const ErrorPart = z.strictObject({ code: z.string().regex(/^worker\.[a-z]+$/), message: z.string().max(2000) });
const ResultBase = {
  format: z.literal(WORKER_RESULT_FORMAT),
  job: z.string().nullable(),
  kind: z.enum(JOB_KINDS).nullable(),
};

/** The Python runner's one line (`python -m pgn_worker.run`). */
export const WorkerResult = z.discriminatedUnion("outcome", [
  z.strictObject({
    ...ResultBase,
    outcome: z.literal("done"),
    event: z.discriminatedUnion("kind", [
      MediaReady,
      MediaRejected,
      ImportParsed,
      ImportRejected,
      ProfileReady,
      ProfileRejected,
      MeasureStatus,
      RunFinished,
      AdReady,
      AdRejected,
    ]),
  }),
  z.strictObject({ ...ResultBase, outcome: z.literal("retry"), error: ErrorPart }),
  z.strictObject({ ...ResultBase, outcome: z.literal("failed"), error: ErrorPart }),
]);
export type WorkerResult = z.infer<typeof WorkerResult>;
