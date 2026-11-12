// Word (.docx) imports (docs/product/10-l2-newsroom-plan.md §5.3, L2.2): the file is uploaded (POST …/uploads,
// purpose docx), then imported (POST …/imports/docx → 202 {importId}). The engine worker reads it with the Desk's own
// code (deskserver/docx.py articles_from_docx), and the API makes each article a new story by the importer. The web
// hears the end over the live stream (event import) and reads GET …/imports/:id (or polls it).
import { z } from "zod";

const Id = z.uuid();

export const DocxImportRequest = z.strictObject({ uploadId: Id, editionId: Id.optional() });
export type DocxImportRequest = z.infer<typeof DocxImportRequest>;
export const ImportAccepted = z.strictObject({ importId: Id });

/** queued: waiting for or being read by the engine (the API cannot tell the two apart yet: "running" is reserved for
 * when it can); done: its stories are made; failed: the file was refused, or the job could not finish. */
export const IMPORT_STATES = ["queued", "running", "done", "failed"] as const;
export const ImportState = z.enum(IMPORT_STATES);
export type ImportState = z.infer<typeof ImportState>;

/** One of the Desk's notes on what the file held that was not imported. `code` names it for the web's own words (en,
 * mr): docx.too_many_stories, docx.empty_headings, docx.tables, docx.text_boxes, docx.pictures, docx.formatting, and
 * import.skipped (articles the stories' own rules refused); `count` is its number (or null); `text` is the Desk's
 * English, for a code the web does not know. */
export const ImportNote = z.strictObject({
  code: z.string().regex(/^(docx|import)\.[a-z_]{1,60}$/),
  count: z.number().int().min(0).nullable(),
  text: z.string().max(2000),
});
export type ImportNote = z.infer<typeof ImportNote>;

export const DocxImport = z.strictObject({
  id: Id,
  state: ImportState,
  editionId: Id.nullable(),
  /** the stories made, in the file's order */
  created: z.array(z.strictObject({ storyId: Id, headline: z.string() })),
  /** articles the file held that could not become stories (their text broke the stories' rules) */
  skipped: z.number().int().min(0),
  notes: z.array(ImportNote),
  /** why it failed: the Desk's code and plain message (docx.not_word, docx.damaged, docx.too_large,
   * docx.protected, docx.no_story…), or the engine's (worker.…, with a general message); null otherwise */
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type DocxImport = z.infer<typeof DocxImport>;
