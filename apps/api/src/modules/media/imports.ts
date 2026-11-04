// Word (.docx) imports (docs/product/10-l2-newsroom-plan.md §5.3, L2.2), under /api/v1/orgs/:o/pubs/:p:
//   - POST …/imports/docx {uploadId, editionId?} (story.create; Idempotency-Key): the person's own docx upload (POST
//     …/uploads, purpose docx) is read once: its size as declared and a ZIP's first bytes, nothing more (the engine
//     reads it with the Desk's own code). It is copied out of quarantine to orgs/<org>/pubs/<pub>/imports/<id>/original
//     (its version kept), and its reading enqueued (docx.import) with the import, in one transaction → 202 {importId}.
//     A file that is not a ZIP (or a password-protected or old .doc file) is refused (422 docx_refused, the Desk's
//     words). An edition is the desk's to name (as paste's).
//   - GET …/imports/:id (story.view): the import, to its importer and to the desk (story.assign); to anyone else, 404.
//   - applyImportEvent, for the engine's inbox (engine-inbox.ts): import.parsed → the result file read by its version
//     and SHA-256 (it must be the import's own, beside its original), each article cleaned as typed text is and made a
//     new story by the importer (origin word, the import's edition if it still exists), all in the inbox's one
//     transaction, which settles the import too: a repeat finds it settled and makes nothing. An article the stories'
//     rules refuse is counted as skipped. import.rejected and job.failed → failed, with the code and plain message; so
//     does a result the inbox refuses (worker.bad_result), and an importer who may no longer make stories
//     (import.not_allowed). Each story's language is its own (articleLanguage).
//     Audited as the system (import.done, import.fail); each story as story.create by the importer. The import's change
//     of state tells its importer (migration 2026_11_30_0001's trigger: the live event import).
import { createHash } from "node:crypto";
import {
  DOCX_TYPE,
  DocxImport,
  DocxImportRequest,
  DocxResult,
  type EngineEvent,
  ImportAccepted,
  MAX_DOCX_BYTES,
  reach,
} from "@pageinator/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import {
  type ImportRow,
  completeUploadAsImport,
  createImport,
  enqueueDocxImport,
  findImport,
  setImportVersion,
  settleImport,
} from "../../db/imports.ts";
import { findUpload } from "../../db/media.ts";
import type { Database } from "../../db/pools.ts";
import { createStory, editionOf, publicationOf } from "../../db/stories.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { accessOf, actorOf, auditRefusals, orgView, refused } from "../access/access.ts";
import { idempotent } from "../requests/idempotency.ts";
import { canAssign, isDesk } from "../stories/rules.ts";
import { checkPlacement, cleaned } from "../stories/store.ts";
import { type MediaOptions, docxRefused } from "./uploads.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZIP = Buffer.from("PK\x03\x04", "latin1");
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // the Desk's: protected, or an old .doc
const PROTECTED =
  "This Word file is protected with a password, or is an old .doc file: save it as .docx without a password and " +
  "try again.";
/** The most of a result file the API reads (200 stories of the Desk's 16 MB of text, as JSON, are far less). */
const MAX_RESULT_BYTES = 64 * 1024 * 1024;

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const One = z.strictObject({ o: z.string(), p: z.string(), i: z.string() });

export function importView(row: ImportRow): DocxImport {
  return {
    id: row.id,
    state: row.state,
    editionId: row.edition_id,
    created: row.created,
    skipped: row.skipped,
    notes: row.notes,
    error: row.problem ? { code: row.problem, message: row.message ?? "" } : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The upload's one version, read once: its SHA-256 and its first bytes (at most MAX_DOCX_BYTES). */
async function readDocx(store: ObjectStore, key: string, versionId: string) {
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of await store.read(key, versionId)) {
    bytes += chunk.length;
    if (bytes > MAX_DOCX_BYTES) break;
    hash.update(chunk);
    if (bytes - chunk.length < OLE.length) head.push(chunk);
  }
  return { sha256: hash.digest("hex"), bytes, head: Buffer.concat(head).subarray(0, OLE.length) };
}

async function readAll(store: ObjectStore, key: string, versionId: string): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of await store.read(key, versionId)) {
    bytes += chunk.length;
    if (bytes > MAX_RESULT_BYTES) throw new Error("an import's result file is larger than the API reads");
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export const importRoutes: FastifyPluginAsyncZod<MediaOptions> = async (app, { database, store }) => {
  auditRefusals(app, database);

  app.post(
    "/api/v1/orgs/:o/pubs/:p/imports/docx",
    {
      config: { permission: "story.create" },
      schema: { params: Pub, body: DocxImportRequest, response: { 202: ImportAccepted } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const pub = request.params.p;
      const { uploadId, editionId } = request.body;
      if (editionId !== undefined && !isDesk(access, pub)) throw refused("placement is the desk's");
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const upload = await findUpload(tx, pub, uploadId, true);
          // someone else's upload, or a picture's, is not theirs to import: the same answer as none at all
          if (!upload || upload.user_id !== userId || upload.purpose !== "docx") throw new ApiError("not_found");
          // imported already (another request for the same upload): the same import
          if (upload.status === "completed" && upload.import_id)
            return { status: 202, body: { importId: upload.import_id } };
          if (upload.status !== "presigned") throw new ApiError("docx_refused");
          await checkPlacement(tx, pub, { editionId: editionId ?? null, pagePin: null });
          const arrived = await store.head(upload.key);
          if (!arrived) {
            throw new ApiError("invalid_request", [
              { field: "body.uploadId", message: "The file has not arrived yet." },
            ]);
          }
          const version = arrived.versionId;
          if (!version) throw new Error("The work bucket gave the upload no version: its versioning must be Enabled.");
          const read = await readDocx(store, upload.key, version);
          const refuse = (message?: string): never => {
            void store.removeAll(upload.key).catch(() => undefined); // the lifecycle rule would, within two days
            throw docxRefused("file", message);
          };
          if (read.bytes !== upload.declared_bytes || arrived.bytes !== upload.declared_bytes)
            refuse(`The file is not the ${upload.declared_bytes} bytes the upload said.`);
          if (read.head.equals(OLE)) refuse(PROTECTED);
          if (!read.head.subarray(0, ZIP.length).equals(ZIP)) refuse();
          const made = await createImport(tx, access.tenant, pub, {
            uploadId,
            editionId: editionId ?? null,
            sha256: read.sha256,
            bytes: read.bytes,
          });
          const copied = await store.copy({
            from: upload.key,
            fromVersion: version,
            to: made.original_key,
            contentType: DOCX_TYPE,
            metadata: { sha256: read.sha256 },
          });
          await setImportVersion(tx, pub, made.id, copied.versionId);
          // the reading commits with the import, or neither does
          await enqueueDocxImport(tx, {
            orgId: access.tenant.orgId,
            publicationId: pub,
            importId: made.id,
            versionId: copied.versionId,
            sha256: read.sha256,
          });
          await completeUploadAsImport(tx, pub, uploadId, made.id);
          await recordAudit(tx, access.tenant, {
            action: "import.create",
            targetType: "import",
            targetId: made.id,
            publicationId: pub,
            data: { upload: uploadId, bytes: read.bytes, edition: editionId ?? null },
          });
          return { status: 202, body: { importId: made.id } };
        },
        async (stored) => stored,
      );
      const body = answer.body as z.infer<typeof ImportAccepted>;
      // the quarantine copy is done with (a replay finds it gone already)
      await store.removeAll(`uploads/orgs/${access.tenant.orgId}/pubs/${pub}/${uploadId}`).catch(() => undefined);
      return reply.status(202).send(body);
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/imports/:i",
    // story.view, not story.create: the desk reads it (and an importer who has since lost story.create, their own)
    { config: { permission: "story.view" }, schema: { params: One, response: { 200: DocxImport } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p: pub, i } = request.params;
      const row = UUID.test(i) ? await database.withTenant(access.tenant, (tx) => findImport(tx, pub, i)) : undefined;
      if (!row || (row.user_id !== userId && !canAssign(access, pub))) throw new ApiError("not_found");
      return importView(row);
    },
  );
};

/** The language of an imported article, as the Desk would see it: Marathi when more than half its letters are
 * Devanagari, English otherwise; a language the paper does not have falls to its primary one, as a typed story's
 * default does (languageFor). */
export function articleLanguage(text: string, languages: readonly string[], primary: string): string {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const devanagari = text.match(/(?=\p{L})\p{Script=Devanagari}/gu)?.length ?? 0;
  const guessed = letters > 0 && devanagari / letters > 0.5 ? "mr" : "en";
  return languages.includes(guessed) ? guessed : primary;
}

/** A result the inbox refuses settles the import at once (as the sweep would, later), in plain words. */
const BAD_RESULT = { problem: "worker.bad_result", message: "the engine's reading of the file could not be used" };
const NOT_ALLOWED = {
  problem: "import.not_allowed",
  message: "the person who imported the file may no longer make stories in this publication",
};

type ImportEvent = Extract<EngineEvent, { kind: "import.parsed" | "import.rejected" | "job.failed" }>;
export type Applied = "applied" | "ignored" | { refuse: string };

/** Applies one docx.import event in the inbox's transaction (the tenant: the system, of the event's organisation and
 * publication). */
export async function applyImportEvent(
  database: Database,
  tx: Tx,
  tenant: Tenant,
  event: ImportEvent,
  job: string,
  store: ObjectStore | undefined,
  log: FastifyBaseLogger,
): Promise<Applied> {
  const importId = event.kind === "job.failed" ? event.target_id : event.import_id;
  const row = await findImport(tx, event.pub_id, importId, true);
  if (!row) return { refuse: "not_found" };
  if (row.state !== "queued" && row.state !== "running") return "ignored"; // settled already: a repeat
  if (event.kind !== "job.failed" && event.sha256 !== row.sha256) {
    log.warn({ job, kind: event.kind }, "an engine event for another Word file was ignored");
    await recordAudit(tx, tenant, {
      action: "engine.event_ignore",
      actorKind: "system",
      targetType: "engine_event",
      targetId: importId,
      data: { job, kind: event.kind, reason: "other_bytes" },
    });
    return "ignored";
  }
  const audit = (action: "import.done" | "import.fail", data: Record<string, unknown>) =>
    recordAudit(tx, tenant, {
      action,
      actorKind: "system",
      targetType: "import",
      targetId: importId,
      publicationId: event.pub_id,
      data: { job, ...data },
    });
  const fail = async (outcome: { problem: string; message: string }) => {
    await settleImport(tx, event.pub_id, importId, { state: "failed", ...outcome });
    await audit("import.fail", { code: outcome.problem });
  };
  const badResult = async (reason: string): Promise<Applied> => {
    await fail(BAD_RESULT);
    return { refuse: reason };
  };
  if (event.kind !== "import.parsed") {
    await settleImport(tx, event.pub_id, importId, { state: "failed", problem: event.code, message: event.message });
    await audit("import.fail", { code: event.code });
    return "applied";
  }
  // the import's own result file, beside its original, as the worker names it
  const expected = `${row.original_key.slice(0, -"original".length)}result-${row.sha256}.json`;
  if (event.result_key !== expected) return badResult("result_key");
  if (!store) throw new Error("the engine inbox has no object store to read an import's result from");
  const bytes = await readAll(store, event.result_key, event.result_version_id);
  if (createHash("sha256").update(bytes).digest("hex") !== event.result_sha256) return badResult("result_sha256");
  let parsed;
  try {
    parsed = DocxResult.safeParse(JSON.parse(bytes.toString("utf8")));
  } catch {
    return badResult("contract");
  }
  if (!parsed.success || parsed.data.articles.length !== event.articles) return badResult("contract");
  // the importer may have lost story.create (or left) since: their stories are made only while they may make them
  const view = await orgView(database, { userId: row.user_id }, tenant.orgId, `import:${importId}`);
  const here = view?.publications.get(event.pub_id);
  if (!view || !here || !reach("story.create", view.orgRole, here)) {
    await fail(NOT_ALLOWED);
    return "applied";
  }
  const who: Tenant = { ...tenant, userId: row.user_id };
  const publication = await publicationOf(tx, event.pub_id);
  const editionId = row.edition_id && (await editionOf(tx, event.pub_id, row.edition_id)) ? row.edition_id : null;
  const created: ImportRow["created"] = [];
  let skipped = 0;
  for (const article of parsed.data.articles) {
    let text;
    try {
      text = {
        headline: cleaned(article.headline, "headline"),
        byline: cleaned(article.byline, "byline"),
        body: cleaned(article.body, "body"),
      };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      skipped += 1;
      continue;
    }
    if (text.headline === "") {
      skipped += 1;
      continue;
    }
    const storyId = await createStory(tx, who, event.pub_id, {
      ...text,
      kicker: "",
      deck: "",
      language: articleLanguage(`${text.headline}\n${text.body}`, publication.languages, publication.primary_language),
      sectionId: null,
      priority: 3,
      pagePin: null,
      editionId,
      deskNote: "",
      origin: "word",
    });
    created.push({ storyId, headline: text.headline });
  }
  const notes = [
    ...parsed.data.notes,
    ...(skipped > 0
      ? [
          {
            code: "import.skipped",
            count: skipped,
            text: `${skipped} of the file's stories could not be made: their text breaks the stories' rules.`,
          },
        ]
      : []),
  ];
  await settleImport(tx, event.pub_id, importId, { state: "done", created, skipped, notes });
  await audit("import.done", { created: created.length, skipped });
  return "applied";
}
