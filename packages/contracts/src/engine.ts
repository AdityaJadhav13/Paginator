// The engine worker's jobs and events (docs/product/10-l2-newsroom-plan.md §2.2): what the API enqueues for the queue
// (apps/engine-queue, Graphile Worker), what the Python runner answers (apps/engine-worker/pgn_worker/jobs.py), and the
// events the queue writes to the API's inbox (app.engine_event). Snake case, as the runner writes them.
import { z } from "zod";

/** The database's ids: uuidv7, as PostgreSQL writes them (lowercase, the RFC 9562 variant). */
export const Uuid7 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const VersionId = z.string().min(1).max(1024);
const Count = z.number().int().min(0);
const Pixels = z.number().int().min(1).max(100_000);

/** media.ingest's payload in the queue: ids, and the facts that pin the exact bytes (never a name, a text or a key:
 * the original's key is made from the ids, as the database makes it). */
export const MediaIngestPayload = z.strictObject({
  org_id: Uuid7,
  pub_id: Uuid7,
  asset_id: Uuid7,
  version_id: VersionId,
  sha256: Sha256,
});
export type MediaIngestPayload = z.infer<typeof MediaIngestPayload>;

const EventBase = { org_id: Uuid7, pub_id: Uuid7, asset_id: Uuid7, sha256: Sha256 };

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
  code: z
    .string()
    .regex(/^m\.[A-Za-z0-9.]+$/)
    .nullable(),
  message: z.string().min(1).max(2000),
  status: z.number().int().min(400).max(499),
});

/** A job that cannot finish (the queue writes it: a final failure, or a retry out of attempts). */
export const JobFailed = z.strictObject({
  kind: z.literal("job.failed"),
  org_id: Uuid7,
  pub_id: Uuid7,
  job_kind: z.literal("media.ingest"),
  target_id: Uuid7,
  code: z.string().regex(/^worker\.[a-z]+$/),
  message: z.string().max(2000),
});

export const EngineEvent = z.discriminatedUnion("kind", [MediaReady, MediaRejected, JobFailed]);
export type EngineEvent = z.infer<typeof EngineEvent>;

export const WORKER_JOB_FORMAT = "pageinator.worker-job/1";
export const WORKER_RESULT_FORMAT = "pageinator.worker-result/1";
/** One job for the Python runner (`python -m pgn_worker.run` on stdin; pgn_worker/jobs.py checks the same): the queue's
 * job id, the kind, and its payload (ids only). */
export const WorkerJob = z.strictObject({
  format: z.literal(WORKER_JOB_FORMAT),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  kind: z.literal("media.ingest"),
  args: MediaIngestPayload,
});
export type WorkerJob = z.infer<typeof WorkerJob>;
const ErrorPart = z.strictObject({ code: z.string().regex(/^worker\.[a-z]+$/), message: z.string().max(2000) });
const ResultBase = {
  format: z.literal(WORKER_RESULT_FORMAT),
  job: z.string().nullable(),
  kind: z.literal("media.ingest").nullable(),
};

/** The Python runner's one line (`python -m pgn_worker.run`). */
export const WorkerResult = z.discriminatedUnion("outcome", [
  z.strictObject({
    ...ResultBase,
    outcome: z.literal("done"),
    event: z.discriminatedUnion("kind", [MediaReady, MediaRejected]),
  }),
  z.strictObject({ ...ResultBase, outcome: z.literal("retry"), error: ErrorPart }),
  z.strictObject({ ...ResultBase, outcome: z.literal("failed"), error: ErrorPart }),
]);
export type WorkerResult = z.infer<typeof WorkerResult>;
