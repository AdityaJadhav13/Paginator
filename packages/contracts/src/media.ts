// Photo originals (docs/product/10-l2-newsroom-plan.md §5.2, §6): uploads straight to the object store, the assets
// made from them, and a story's photo.
import { z } from "zod";

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });
const Line = z.string().max(4000); // cleaned to the Desk's 2,000 characters by the API

/** The most bytes of one picture (40 MiB). */
export const MAX_PICTURE_BYTES = 41_943_040;
export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PictureType = z.enum(PICTURE_TYPES);

export const UploadRequest = z.strictObject({
  purpose: z.literal("story_photo"),
  filename: z.string().min(1).max(255),
  contentType: PictureType,
  bytes: z.number().int().min(1),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

/** A presigned POST: the browser sends `fields`, then the file, to `url`, before `expiresAt`. */
export const PresignedUpload = z.strictObject({
  uploadId: Id,
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  expiresAt: Moment,
});

export const Asset = z.strictObject({
  id: Id,
  kind: z.literal("photo"),
  status: z.enum(["received", "ready", "rejected"]),
  mime: PictureType,
  bytes: z.number().int().min(1),
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  sha256: z.string(),
  createdAt: Moment,
});
export type Asset = z.infer<typeof Asset>;

export const CompletedUpload = z.strictObject({ asset: Asset });

export const StoryPhoto = z.strictObject({
  assetId: Id,
  caption: z.string(),
  credit: z.string(),
  status: z.enum(["received", "ready", "rejected"]),
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  /** a preview comes with renditions (L2.2): null until then */
  previewUrl: z.string().nullable(),
});
export type StoryPhoto = z.infer<typeof StoryPhoto>;

export const StoryPhotoInput = z.strictObject({
  baseRevision: z.number().int().min(1),
  assetId: Id,
  caption: Line.optional(),
  credit: Line.optional(),
});
export const StoryPhotoPatch = z.strictObject({
  baseRevision: z.number().int().min(1),
  caption: Line.optional(),
  credit: Line.optional(),
});
export const FileQuery = z.strictObject({ variant: z.enum(["original", "preview"]).default("original") });
