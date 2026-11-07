// The archive (doc 06 §10.1; doc 07 §12 Archive rows; plan §1 L2.5 and "As built (screens)"): the publication's
// releases (each archived under Object Lock, release.ts), by edition date, with filters and a search over the stories
// the released run placed. Reprint, duplicate and legal hold are not built.
//
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET archive?year&month&kind&q (archive.view) → ArchiveList: newest edition first, at most ARCHIVE_LIMIT (truncated
//       says more matched). q: a story on the released run's pages whose headline (as it is now), reporter or section
//       contains it; each entry then lists those stories (at most 5, only those the person may see).
//   GET archive/releases/:id (archive.view) → ArchiveRelease: the release (files, SHA-256, bytes, receipts, the print
//       profile pinned, retention) and the edition's releases (late corrections).
// The files are downloaded by GET releases/:id/files/:name (export.press) and the archive copy checked by POST
// releases/:id/verify (archive.view), as release.ts says.
import { z } from "zod";
import { Release } from "./release.ts";

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });
const Kind = z.enum(["release", "correction"]);

export const ARCHIVE_LIMIT = 200;

export const ArchiveQuery = z.strictObject({
  year: z
    .string()
    .regex(/^[0-9]{4}$/)
    .optional(),
  month: z
    .string()
    .regex(/^(0?[1-9]|1[0-2])$/)
    .optional(),
  kind: Kind.optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type ArchiveQuery = z.infer<typeof ArchiveQuery>;

export const ArchiveStoryHit = z.strictObject({
  storyId: Id,
  headline: z.string(),
  reporter: z.string().nullable(),
  section: z.string().nullable(),
});
export type ArchiveStoryHit = z.infer<typeof ArchiveStoryHit>;

export const ArchiveEntry = z.strictObject({
  releaseId: Id,
  editionId: Id,
  editionDate: z.iso.date(),
  /** 1, 2, … in the edition */
  number: z.number().int().min(1),
  kind: Kind,
  approvedAt: Moment,
  retainUntil: Moment,
  files: z.number().int().min(0),
  /** the released run, and whether its page 1 has a thumbnail (GET runs/:r/files/page-01.thumb.png, pages.view) */
  runId: Id,
  frontThumb: z.boolean(),
  /** with q: the stories that matched */
  matches: z.array(ArchiveStoryHit).max(5),
});
export type ArchiveEntry = z.infer<typeof ArchiveEntry>;

export const ArchiveList = z.strictObject({ items: z.array(ArchiveEntry), truncated: z.boolean() });
export type ArchiveList = z.infer<typeof ArchiveList>;

export const ArchiveRelease = z.strictObject({
  release: Release,
  edition: z.strictObject({
    id: Id,
    date: z.iso.date(),
    /** every release of the edition, newest first (this one among them) */
    releases: z.array(z.strictObject({ id: Id, number: z.number().int().min(1), kind: Kind, approvedAt: Moment })),
  }),
});
export type ArchiveRelease = z.infer<typeof ArchiveRelease>;
