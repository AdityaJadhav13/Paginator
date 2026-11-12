/**
 * One picture's upload (plan §5.2, §6.2), shared by the story's Photo panel and the media library: checked before
 * anything is sent (only JPEG, PNG and WebP up to 40 MB; an iPhone's HEIC explained), then presign (with an
 * Idempotency-Key kept with its exact body, so a retry asks for the same thing), the file straight to the store with
 * the policy's fields (progress, cancellable), then complete. A retry goes on from where it stopped: the same presign,
 * or the same upload's complete (never the file again once it arrived). A policy whose time is over is asked for
 * afresh, with a new key, once; a policy the store refuses for another reason is not retried.
 */
import { InlineMessage } from "../../ui/index.ts";
import { randomUuid } from "../../api/client.ts";
import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type { ApiProblem, AssetDto, MediaService, PictureTypeDto, PresignedUploadDto, UploadPurposeDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";

export const ACCEPT = "image/jpeg,image/png,image/webp";
const TYPES: readonly PictureTypeDto[] = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 41_943_040;
/** The API counts a file name's length in UTF-16 units (at most 255). */
const NAME_UNITS = 255;

export type UploadStage = "presign" | "send" | "complete";

export type UploadFailure =
  | "heic"
  | "type"
  | "size"
  | "cancelled"
  | "expired"
  | "denied"
  | { readonly problem: ApiProblem; readonly stage: UploadStage | "attach" };

export type UploadStep = { readonly step: "presigning" } | { readonly step: "sending"; readonly fraction: number } | { readonly step: "completing" };

/** A picture being uploaded, and how far it went: each step done is not done again. */
export interface UploadJob {
  readonly file: File;
  key: string;
  readonly request: {
    readonly filename: string;
    readonly contentType: PictureTypeDto;
    readonly bytes: number;
    readonly purpose: UploadPurposeDto;
  };
  /** The policy the key gave. */
  presigned?: PresignedUploadDto;
  /** The file arrived in the store under this upload: only complete is left. */
  arrived?: string;
  /** A fresh policy was already asked for once after one ran out. */
  renewed?: boolean;
  /** Done: the picture it made. */
  asset?: AssetDto;
}

const isHeic = (file: File) => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/** A name cut to the API's 255 UTF-16 units, at a whole character (never half of a surrogate pair). */
export function fileName(name: string): string {
  let out = "";
  for (const character of name) {
    if (out.length + character.length > NAME_UNITS) break;
    out += character;
  }
  return out || "photo";
}

/** Why the file is not sent at all, or null: nothing is sent for a file the API would refuse. */
export function refuseFile(file: File): UploadFailure | null {
  if (isHeic(file)) return "heic";
  if (!(TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > MAX_BYTES) return "size";
  return null;
}

export function uploadJob(file: File, purpose: UploadPurposeDto): UploadJob {
  return {
    file,
    key: randomUuid(),
    request: { filename: fileName(file.name), contentType: file.type as PictureTypeDto, bytes: file.size, purpose },
  };
}

/** A refusal the person can do nothing about but choose another file. */
export const final = (problem: ApiProblem) =>
  problem.kind === "answer" &&
  (problem.code === "not_a_picture" || problem.code === "file_too_large" || problem.code === "upload_size_mismatch");

export type UploadResult =
  | { readonly ok: true; readonly asset: AssetDto }
  | { readonly ok: false; readonly why: UploadFailure; readonly retry: boolean };

/** Runs the job from where it stopped, to its picture. `onStep` hears each step (never after `signal` stops it). */
export async function runUpload(
  media: MediaService,
  where: { readonly orgId: string; readonly pubId: string },
  job: UploadJob,
  signal: AbortSignal,
  onStep: (step: UploadStep) => void,
): Promise<UploadResult> {
  const cancelled: UploadResult = { ok: false, why: "cancelled", retry: true };
  const failed = (why: UploadFailure, retry: boolean): UploadResult => ({ ok: false, why, retry });
  if (job.asset) return { ok: true, asset: job.asset };
  if (!job.arrived) {
    // a policy whose time is over is not sent: a new one, with a new key
    if (job.presigned && Date.parse(job.presigned.expiresAt) <= Date.now()) {
      job.presigned = undefined;
      job.key = randomUuid();
    }
    if (!job.presigned) {
      onStep({ step: "presigning" });
      const presigned = await media.presign({ ...where, ...job.request, idempotencyKey: job.key });
      if (signal.aborted) return cancelled;
      if (!presigned.ok) return failed({ problem: presigned.error, stage: "presign" }, !final(presigned.error));
      job.presigned = presigned.value;
    }
    onStep({ step: "sending", fraction: 0 });
    const sent = await media.send({
      upload: job.presigned,
      file: job.file,
      signal,
      onProgress: (fraction) => {
        if (!signal.aborted) onStep({ step: "sending", fraction });
      },
    });
    if (signal.aborted) return cancelled;
    if (!sent.ok) {
      const code = sent.error.kind === "answer" ? sent.error.code : "";
      if (code === "upload_cancelled") return cancelled;
      if (code === "upload_denied") {
        // ran out: a fresh policy, once; refused while still valid: a condition failed, and trying again cannot help
        const ranOut = Date.parse(job.presigned.expiresAt) <= Date.now();
        if (ranOut && !job.renewed) {
          job.renewed = true;
          job.presigned = undefined;
          job.key = randomUuid();
          return failed("expired", true);
        }
        return failed("denied", false);
      }
      return failed({ problem: sent.error, stage: "send" }, !final(sent.error));
    }
    job.arrived = job.presigned.uploadId;
  }
  onStep({ step: "completing" });
  const completed = await media.complete({ ...where, uploadId: job.arrived });
  if (signal.aborted) return cancelled;
  if (!completed.ok) return failed({ problem: completed.error, stage: "complete" }, !final(completed.error));
  job.asset = completed.value;
  return { ok: true, asset: completed.value };
}

/** The Desk's own words for a photo it refused (media.rejected's code), when the Desk's message has a code we carry. */
const DESK_WORDS: Readonly<Record<string, PlainKey>> = {
  "m.img.tooManyPixels": "photo.rejected.m.img.tooManyPixels",
  "m.img.notAPicture": "photo.rejected.m.img.notAPicture",
  "m.img.format": "photo.rejected.m.img.format",
  "m.img.damaged": "photo.rejected.m.img.damaged",
  "m.img.tooLarge": "photo.rejected.m.img.tooLarge",
};
export const deskWords = (code: string | null): PlainKey | undefined => (code ? DESK_WORDS[code] : undefined);

const WORDED: Readonly<Record<string, PlainKey>> = {
  upload_refused: "photo.refused",
  upload_size_mismatch: "photo.sizeChanged",
};

/** An upload's failure in plain words. */
export function UploadFailureMessage({ why }: { readonly why: UploadFailure }) {
  const { t } = useI18n();
  if (why === "heic") return <InlineMessage variant="warning" heading={t("photo.heic")} live iconLabel={t("message.warning")} />;
  if (why === "type") return <InlineMessage variant="error" heading={t("photo.wrongType")} live iconLabel={t("message.error")} />;
  if (why === "size") return <InlineMessage variant="error" heading={t("error.file_too_large")} live iconLabel={t("message.error")} />;
  if (why === "cancelled") return <p role="status">{t("photo.cancelled")}</p>;
  if (why === "expired") return <InlineMessage variant="error" heading={t("photo.expired")} live iconLabel={t("message.error")} />;
  if (why === "denied") return <InlineMessage variant="error" heading={t("photo.denied")} live iconLabel={t("message.error")} />;
  const { problem, stage } = why;
  const code = problem.kind === "answer" ? problem.code : "";
  // the quotas are the presign's: a 429 anywhere else is only "too many tries"
  if (stage === "presign" && problem.kind === "answer" && (problem.status === 429 || code === "slow_down")) {
    return <InlineMessage variant="error" heading={t("photo.slowDown")} live iconLabel={t("message.error")} />;
  }
  const worded = WORDED[code];
  if (worded) return <InlineMessage variant="error" heading={t(worded)} live iconLabel={t("message.error")} />;
  return <ProblemMessage problem={problem} />;
}
