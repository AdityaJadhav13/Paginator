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

/** A Word file's type, and the most bytes of one (10 MiB) an import takes (L2.2, Stories → Import Word file). */
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_DOCX_BYTES = 10_485_760;

export const UploadRequest = z
  .strictObject({
    /** story_photo: for a story's photo; library: straight into the media library (L2.2); docx: a Word file to import
     * as stories (POST …/imports/docx) */
    purpose: z.enum(["story_photo", "library", "docx"]),
    filename: z.string().min(1).max(255),
    contentType: z.enum([...PICTURE_TYPES, DOCX_TYPE]),
    bytes: z.number().int().min(1),
  })
  .refine((u) => (u.purpose === "docx") === (u.contentType === DOCX_TYPE), {
    path: ["contentType"],
    message: "A Word file is uploaded as docx, and a picture as a picture.",
  });
export type UploadRequest = z.infer<typeof UploadRequest>;

/** A presigned POST: the browser sends `fields`, then the file, to `url`, before `expiresAt`. */
export const PresignedUpload = z.strictObject({
  uploadId: Id,
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  expiresAt: Moment,
});

/** A picture's state: received (its print versions are being made), ready, rejected (the Desk's rules refuse it), or
 * failed (the engine could not make them; the same picture sent again is tried afresh). */
export const AssetStatus = z.enum(["received", "ready", "rejected", "failed"]);
export type AssetStatus = z.infer<typeof AssetStatus>;

export const Asset = z.strictObject({
  id: Id,
  kind: z.literal("photo"),
  status: AssetStatus,
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
  status: AssetStatus,
  /** why it is rejected or failed: the Desk's message code (m.img.…), the engine's (worker.…), or null */
  problem: z.string().nullable(),
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

// The media library (docs/product/10-l2-newsroom-plan.md §5.3, L2.2): the publication's pictures, their facts, and
// where they are used.
const Fact = z.string().max(4000); // cleaned to the Desk's 2,000 characters by the API

/** A story that uses the picture as its photo (only the ones the person may see). */
export const AssetUse = z.strictObject({ storyId: Id, headline: z.string() });
export type AssetUse = z.infer<typeof AssetUse>;

/** One picture in the library. */
export const MediaItem = z.strictObject({
  id: Id,
  status: AssetStatus,
  /** why it is rejected or failed (as StoryPhoto.problem), or null */
  problem: z.string().nullable(),
  mime: PictureType,
  bytes: z.number().int().min(1),
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  sha256: z.string(),
  caption: z.string(),
  credit: z.string(),
  photographer: z.string(),
  /** the widest the picture prints sharp (150 ppi): columns of the publication's grid; null when the grid is not
   * known; 0 when not even one column */
  sharpUpToCols: z.number().int().min(0).nullable(),
  uploadedBy: z.strictObject({ id: Id, name: z.string() }),
  usedBy: z.array(AssetUse),
  /** whether any story (not deleted) has it as its photo, whoever may see that story: no picture in use is deleted */
  inUse: z.boolean(),
  /** whether this person may change its caption, credit and photographer (PATCH's own rule) */
  mayEdit: z.boolean(),
  /** the change counter: PATCH sends it back (409 asset_changed when someone changed it first) */
  revision: z.number().int().min(1),
  createdAt: Moment,
  updatedAt: Moment,
  /** a preview link once ready (as StoryPhoto.previewUrl), else null */
  previewUrl: z.string().nullable(),
});
export type MediaItem = z.infer<typeof MediaItem>;

/** GET …/media: newest first, at most 60 a page; `cursor` from the last answer's `next`. */
export const MediaQuery = z.strictObject({
  story: Id.optional(),
  missing: z.enum(["caption", "credit"]).optional(),
  tooSmallForCols: z.coerce.number().int().min(1).max(20).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
});
export type MediaQuery = z.infer<typeof MediaQuery>;
export const MediaList = z.strictObject({ items: z.array(MediaItem), next: z.string().nullable() });
export type MediaList = z.infer<typeof MediaList>;

/** PATCH …/assets/:a — the picture's own facts (a story's photo keeps its own caption and credit). */
export const MediaPatch = z.strictObject({
  baseRevision: z.number().int().min(1),
  caption: Fact.optional(),
  credit: Fact.optional(),
  photographer: Fact.optional(),
});
export type MediaPatch = z.infer<typeof MediaPatch>;
