// The one-time import of the owner's Desk home (docs/product/10-l2-newsroom-plan.md §3.7, §3.8), for
// scripts/import-desk.ts: the ZIP tools/desk/export-home.sh makes (editions/, config.json, manifest.json) into one
// publication. No endpoint reaches it.
//   1. The ZIP is streamed into a private temporary folder, each file hashed as it arrives; every file must be the
//      manifest's (path, bytes and SHA-256), and every file of the manifest must be there, or nothing is imported.
//   2. Each edition is one transaction under withTenant, as the person running the import (audited with actor kind
//      "import"): the edition by desk_key; its stories by (publication, desk_key), each with revision 1, its text
//      cleaned as the API cleans typed text (desk-text), samples ("sample:<name>") left out unless asked; its photos'
//      originals as assets (one per SHA-256 in the publication, the Desk's photo id kept as desk_key when free; stored,
//      then media.ingest enqueued for the hosted renditions) and story_photo; its ads' originals as assets with
//      ad_slot_artwork (media.ad enqueued) when the profile in use names the slot; and its newest done run (or every
//      finished run): layout_run, run_page and pdf_check rows, and the run's files under runs/<run>/.
//   3. What exists already is left as it is, so a second import changes nothing and says so. A dry run does the same
//      work in transactions that are rolled back, and stores nothing.
//   4. The report: counts per kind, and every file stored, read back from the store by its version, against the
//      manifest's SHA-256 (the L2.3 import check).
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AuditAction,
  DeskArticleKey,
  DeskEditionKey,
  DeskPhotoKey,
  DeskRunKey,
  DeskSlot,
  type DeskText,
  MediaAdPayload,
  type StoredFile,
} from "@pageinator/contracts";
import { BODY_FORMAT, BODY_LIMIT, DeskTextError, LINE_LIMIT, bodyWords, cleanText } from "@pageinator/desk-text";
import { Unzip, UnzipInflate } from "fflate";
import { sql } from "kysely";
import { z } from "zod";
import { articleLanguage } from "../modules/media/imports.ts";
import { JpegScan, NotAPicture, picture } from "../modules/media/picture.ts";
import type { ObjectStore } from "../storage/object-store.ts";
import { recordAudit } from "./audit.ts";
import { assetWithBytes, enqueueMediaIngest, setAssetVersion } from "./media.ts";
import type { Database } from "./pools.ts";
import { publicationOf } from "./stories.ts";
import type { Tenant, Tx } from "./tenant.ts";

export const EXPORT_FORMAT = "pageinator.desk-export/1";
/** Far above a Desk home (a year of 16-page editions with photos is some GB), far below a full disk. */
const MAX_FILES = 500_000;
const MAX_TOTAL_BYTES = 200 * 1024 ** 3;
/** The asset table's limit (and the Desk's upload limit): a larger original is not the Desk's. */
const MAX_PICTURE_BYTES = 40 * 1024 * 1024;
/** A path the export writes: manifest.json, config.json, or under editions/, each part a plain name (no dot first). */
const PART = /^[A-Za-z0-9_][A-Za-z0-9._+-]{0,200}$/;
/** The independent PDF/X-1a checker the Desk runs (its SHA-256 keys pdf_check). */
const CHECKER = fileURLToPath(
  new URL("../../../../experiments/phase0/pdfx1/check_pdfx1a_independent.py", import.meta.url),
);

/** The bundle cannot be imported (nothing was written). */
export class ImportRefused extends Error {}

export const KINDS = ["editions", "stories", "photos", "ads", "runs", "pages"] as const;
export type Kind = (typeof KINDS)[number];
/** Per kind: in the bundle, made now, there already, left out (each with why, in `notes`). */
export type Counts = Record<Kind, { found: number; added: number; existing: number; skipped: number }>;
export type FileCheck = { path: string; key: string; manifest: string; stored: string };
export type ImportReport = {
  bundleSha256: string;
  dryRun: boolean;
  counts: Counts;
  /** the sample articles left out (or imported, with includeSamples) */
  samples: number;
  notes: string[];
  /** every file stored by this import, read back by its version */
  files: FileCheck[];
};

export type ImportOptions = {
  database: Database;
  store: ObjectStore;
  orgId: string;
  pubId: string;
  /** the person the import is recorded as (stories' reporter, assets' uploader, runs' maker) */
  actorId: string;
  /** the bundle's bytes, read once */
  source: AsyncIterable<Uint8Array>;
  dryRun?: boolean;
  allRuns?: boolean;
  includeSamples?: boolean;
};

// ------------------------------------------------------------------------------------------------ the bundle

type Entry = { bytes: number; sha256: string };

function safePath(name: string): boolean {
  if (name === "manifest.json" || name === "config.json") return true;
  const parts = name.split("/");
  return parts[0] === "editions" && parts.length >= 3 && parts.every((part) => PART.test(part));
}

/** Streams the ZIP into dir: each file's size and SHA-256, and the whole bundle's SHA-256. */
async function unpack(source: AsyncIterable<Uint8Array>, dir: string) {
  const files = new Map<string, Entry>();
  const seen = new Set<string>();
  const whole = createHash("sha256");
  const open = new Set<number>();
  let total = 0;
  let problem: string | undefined;
  const unzip = new Unzip((file) => {
    if (problem || file.name.endsWith("/")) return; // a folder entry: the files make their folders
    if (!safePath(file.name)) problem = `${JSON.stringify(file.name.slice(0, 200))} is not a file the export writes`;
    else if (seen.has(file.name)) problem = `${file.name} is in it twice`;
    else if (seen.size >= MAX_FILES) problem = `it has more than ${MAX_FILES} files`;
    if (problem) return;
    seen.add(file.name);
    const path = join(dir, file.name);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, "wx", 0o600);
    open.add(fd);
    const hash = createHash("sha256");
    let bytes = 0;
    file.ondata = (error, chunk, final) => {
      if (problem) return;
      if (error) {
        problem = `${file.name} cannot be read (${error.message})`;
        return;
      }
      bytes += chunk.length;
      total += chunk.length;
      if (total > MAX_TOTAL_BYTES) {
        problem = "it unpacks to more than 200 GB";
        return;
      }
      hash.update(chunk);
      writeSync(fd, chunk);
      if (final) {
        closeSync(fd);
        open.delete(fd);
        files.set(file.name, { bytes, sha256: hash.digest("hex") });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of source) {
      whole.update(chunk);
      unzip.push(chunk);
      if (problem) break;
    }
    if (!problem) unzip.push(new Uint8Array(0), true);
  } catch (error) {
    problem ??= `it is not a ZIP the export writes (${(error as Error).message})`;
  } finally {
    for (const fd of open) closeSync(fd);
  }
  if (problem) throw new ImportRefused(`The bundle was refused: ${problem}. Nothing was imported.`);
  return { files, sha256: whole.digest("hex") };
}

const Manifest = z.object({
  format: z.literal(EXPORT_FORMAT),
  files: z
    .array(z.object({ path: z.string(), bytes: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) }))
    .max(MAX_FILES),
});

/** Every file is the manifest's, and every file of the manifest is there. */
function checkManifest(dir: string, files: Map<string, Entry>): Map<string, Entry> {
  const parsed = Manifest.safeParse(readJson(join(dir, "manifest.json")));
  if (!files.has("manifest.json") || !parsed.success) {
    throw new ImportRefused(
      `The bundle was refused: it has no manifest.json of ${EXPORT_FORMAT}. Nothing was imported.`,
    );
  }
  const listed = new Map<string, Entry>();
  const problems: string[] = [];
  for (const file of parsed.data.files) {
    if (listed.has(file.path)) problems.push(`${file.path}: listed twice`);
    listed.set(file.path, { bytes: file.bytes, sha256: file.sha256 });
  }
  for (const [path, want] of listed) {
    const got = files.get(path);
    if (!got) problems.push(`${path}: missing`);
    else if (got.sha256 !== want.sha256 || got.bytes !== want.bytes) problems.push(`${path}: its SHA-256 differs`);
  }
  for (const path of files.keys()) {
    if (path !== "manifest.json" && !listed.has(path)) problems.push(`${path}: not in the manifest`);
  }
  if (problems.length > 0) {
    const more = problems.length > 20 ? `, and ${problems.length - 20} more` : "";
    throw new ImportRefused(
      `The bundle does not match its manifest (${problems.slice(0, 20).join("; ")}${more}). Nothing was imported.`,
    );
  }
  return listed;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------------------------------- the Desk's files

const Text = z.string().max(1_000_000).optional();
const Moment = z.string().max(64).optional();
const EditionDoc = z.object({
  id: DeskEditionKey,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pages: z.union([z.literal(4), z.literal(8), z.literal(16)]),
  back_page_ads: z.boolean().optional(),
  volume: Text,
  issue: Text,
  price: Text,
  created: Moment,
  updated: Moment,
});
const Article = z.object({
  id: DeskArticleKey,
  headline: z.string().max(1_000_000),
  kicker: Text,
  deck: Text,
  byline: Text,
  body: z.string().max(1_000_000),
  priority: z.number().int().min(1).max(4).optional(),
  page: z.number().int().nullable().optional(),
  photo: z.object({ id: DeskPhotoKey, caption: Text, credit: Text }).nullable().optional(),
  source: z.string().max(200).optional(),
  created: Moment,
  updated: Moment,
});
const ArticlesDoc = z.object({ articles: z.array(z.unknown()).max(10_000) });
const IndexDoc = z.object({ elements: z.record(z.string(), z.unknown()) });
const Num = z.number().min(0).max(1_000_000);
const PageStatus = z.object({
  page: z.number().int().min(1).max(16),
  role: z.enum(["front", "inside", "back"]),
  state: z.enum(["waiting", "working", "done", "failed", "cancelled"]),
  articles: z.array(z.unknown()).max(200).optional(),
  pdf: z.string().nullable().optional(),
  png: z.string().nullable().optional(),
  thumb: z.string().nullable().optional(),
  seconds: Num.nullable().optional(),
  message: z.unknown(),
  warnings: z.array(z.unknown()).max(50).optional(),
  pdfx_check: z
    .object({
      passed: z.boolean(),
      fails: z.number().int().min(0).nullable(),
      warnings: z.number().int().min(0).nullable(),
    })
    .optional(),
});
const RunStatus = z.object({
  state: z.enum(["done", "failed", "cancelled"]),
  created: Moment,
  started: Moment.nullable(),
  finished: Moment.nullable(),
  elapsed_s: Num.optional(),
  message: z.unknown(),
  error: z.unknown(),
  pages: z.array(z.unknown()).max(16).optional(),
  not_placed: z.array(z.unknown()).max(400).optional(),
  timings: z.record(z.string(), z.unknown()).optional(),
  msgs: z.record(z.string(), z.unknown()).optional(),
});
type RunStatus = z.infer<typeof RunStatus>;

/** A Desk timestamp as the database takes it, or null (the database's own time then). */
function moment(value: string | null | undefined): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** The bundle path of a photo's or ad's original in a folder (<name>.orig.<ext>), or null. */
function original(c: Context, folder: string, name: string): string | null {
  const found = [...c.manifest.keys()].filter(
    (path) => path.startsWith(`${folder}/${name}.orig.`) && /\.orig\.(jpg|png|webp)$/.test(path),
  );
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** One of the Desk's messages: its English text, and its code and values when status.json's "msgs" has them and every
 * value is a number or plain text (a nested message keeps only its English text, which is always right). */
function deskText(text: unknown, msgs: Record<string, unknown>): DeskText | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const wire = msgs[text] as { code?: unknown; params?: unknown } | undefined;
  const plain: Record<string, string | number> = {};
  let ok = typeof wire?.code === "string" && /^m\.[A-Za-z0-9.]{1,120}$/.test(wire.code);
  for (const [name, value] of Object.entries((wire?.params as Record<string, unknown> | undefined) ?? {})) {
    const data = (value as { data?: unknown } | null)?.data;
    if (typeof value === "number" || typeof value === "string") plain[name.slice(0, 40)] = value;
    else if (typeof data === "string") plain[name.slice(0, 40)] = data.slice(0, 2000);
    else ok = false;
  }
  return { text: text.slice(0, 2000), code: ok ? (wire?.code as string) : null, params: ok ? plain : null };
}

// --------------------------------------------------------------------------------------------- the import

type Context = {
  tx: Tx;
  tenant: Tenant;
  pub: string;
  store: ObjectStore;
  report: ImportReport;
  stored: { path: string; key: string; versionId: string }[];
  manifest: Map<string, Entry>;
  dir: string;
  checker: string | null;
  engineVersion: string | null;
};

const audit = (c: Context, action: AuditAction, targetType: string, id: string, data: Record<string, unknown>) =>
  recordAudit(c.tx, c.tenant, { action, targetType, targetId: id, publicationId: c.pub, data, actorKind: "import" });

/** Stores a file of the bundle at key (a dry run stores nothing): it as a StoredFile. */
async function put(c: Context, path: string, key: string, contentType: string): Promise<StoredFile> {
  const entry = c.manifest.get(path) ?? { bytes: 0, sha256: "" };
  let versionId = "dry-run";
  if (!c.report.dryRun) {
    const body = readFileSync(join(c.dir, path));
    ({ versionId } = await c.store.put({ key, body, contentType, metadata: { sha256: entry.sha256 } }));
    c.stored.push({ path, key, versionId });
  }
  return { key, version_id: versionId, sha256: entry.sha256, bytes: entry.bytes };
}

type Picked = { id: string; added: boolean; versionId: string | null; sha256: string };

/** The publication's asset with the original's bytes, or a new one (stored, its renditions enqueued); null when the
 * file is not a picture the API takes. */
async function asset(c: Context, path: string, deskKey: string | null): Promise<Picked | null> {
  const sha256 = c.manifest.get(path)?.sha256 ?? "";
  const same = await assetWithBytes(c.tx, c.pub, sha256);
  if (same) return { id: same.id, added: false, versionId: same.version_id, sha256 };
  const bytes = readFileSync(join(c.dir, path));
  let found;
  try {
    if (bytes.length > MAX_PICTURE_BYTES) throw new NotAPicture("it is larger than 40 MB");
    const scan = new JpegScan();
    scan.feed(bytes);
    found = picture(bytes.subarray(0, 64 * 1024), scan);
  } catch (error) {
    if (!(error instanceof NotAPicture)) throw error;
    c.report.notes.push(`${path}: not imported (${error.message})`);
    return null;
  }
  // the Desk's own photo id when the publication has no asset with it yet (else one of its own, as an upload gets)
  const taken =
    deskKey === null ||
    (await c.tx
      .selectFrom("app.asset")
      .select("id")
      .where("publication_id", "=", c.pub)
      .where("desk_key", "=", deskKey)
      .executeTakeFirst()) !== undefined;
  const made = await c.tx
    .insertInto("app.asset")
    .values({
      org_id: c.tenant.orgId,
      publication_id: c.pub,
      desk_key: taken ? `p-${randomBytes(5).toString("hex")}` : deskKey,
      sha256,
      bytes: bytes.length,
      mime: found.mime,
      width_px: found.width,
      height_px: found.height,
      uploaded_by: c.tenant.userId,
    })
    .returning(["id", "original_key"])
    .executeTakeFirstOrThrow();
  const { version_id: versionId } = await put(c, path, made.original_key, found.mime);
  await setAssetVersion(c.tx, c.pub, made.id, versionId);
  if (!c.report.dryRun) {
    await enqueueMediaIngest(c.tx, {
      orgId: c.tenant.orgId,
      publicationId: c.pub,
      assetId: made.id,
      versionId,
      sha256,
    });
  }
  await audit(c, "desk_import.asset", "asset", made.id, { bytes: bytes.length, mime: found.mime });
  return { id: made.id, added: true, versionId, sha256 };
}

const ORIGINS: Record<string, "typed" | "pasted" | "word"> = { typed: "typed", pasted: "pasted", word: "word" };

/** The runs to import, with their status.json: the newest done run, or (allRuns) every finished one. */
function runsToImport(c: Context, edition: string, allRuns: boolean): { key: string; status: RunStatus }[] {
  const runsDir = join(c.dir, "editions", edition, "runs");
  if (!existsSync(runsDir)) return [];
  const runs = readdirSync(runsDir)
    .filter((key) => DeskRunKey.safeParse(key).success)
    .sort()
    .flatMap((key) => {
      const status = RunStatus.safeParse(readJson(join(runsDir, key, "status.json")));
      return status.success ? [{ key, status: status.data }] : []; // a run still going, or not the Desk's
    });
  return allRuns ? runs : runs.filter((run) => run.status.state === "done").slice(-1);
}

async function importEdition(c: Context, name: string, allRuns: boolean, includeSamples: boolean) {
  const { counts, notes } = c.report;
  const folder = `editions/${name}`;
  const parsed = EditionDoc.safeParse(readJson(join(c.dir, folder, "edition.json")));
  if (!parsed.success || parsed.data.id !== name || !name.startsWith(parsed.data.date)) {
    counts.editions.skipped += 1;
    notes.push(`${folder}: not imported (its edition.json is not the Desk's)`);
    return;
  }
  const e = parsed.data;
  let editionId = (
    await c.tx
      .selectFrom("app.edition")
      .select("id")
      .where("publication_id", "=", c.pub)
      .where("desk_key", "=", e.id)
      .executeTakeFirst()
  )?.id;
  if (editionId) counts.editions.existing += 1;
  else {
    const line = (value: string | undefined) => cleanText(value ?? "", "folio", 200);
    const { rows } = await sql<{ id: string }>`
      insert into app.edition (org_id, publication_id, edition_date, desk_key, pages, back_page_ads, volume, issue,
        price, produced_in, created_at, updated_at)
      values (${c.tenant.orgId}, ${c.pub}, ${e.date}::date, ${e.id}, ${e.pages}, ${e.back_page_ads ?? true},
        ${line(e.volume)}, ${line(e.issue)}, ${line(e.price)}, 'desk',
        coalesce(${moment(e.created)}::timestamptz, now()), coalesce(${moment(e.updated)}::timestamptz, now()))
      on conflict do nothing
      returning id`.execute(c.tx);
    editionId = rows[0]?.id;
    if (!editionId) {
      // the Desk's second edition of a day (YYYY-MM-DD-2): the publication has one edition a date
      counts.editions.skipped += 1;
      notes.push(`${folder}: not imported (the publication has another edition on ${e.date})`);
      return;
    }
    counts.editions.added += 1;
    await audit(c, "desk_import.edition", "edition", editionId, { deskKey: e.id, pages: e.pages });
  }

  const runs = runsToImport(c, name, allRuns);
  // the stories on a page of the newest done run were placed; the others are Ready (the Desk lays out every one)
  const placed = new Set(
    (runs.filter((run) => run.status.state === "done").at(-1)?.status.pages ?? []).flatMap((page) => {
      const p = PageStatus.safeParse(page);
      return p.success && p.data.state === "done" ? (p.data.articles ?? []) : [];
    }),
  );
  const publication = await publicationOf(c.tx, c.pub);
  const doc = ArticlesDoc.safeParse(readJson(join(c.dir, folder, "articles.json")));
  for (const raw of doc.success ? doc.data.articles : []) {
    const article = Article.safeParse(raw);
    if (article.success && article.data.source?.startsWith("sample:")) {
      c.report.samples += 1;
      if (!includeSamples) continue; // test material from the private dataset
    }
    counts.stories.found += 1;
    if (!article.success) {
      counts.stories.skipped += 1;
      notes.push(`${folder}/articles.json: an article not imported (not the Desk's shape)`);
      continue;
    }
    const a = article.data;
    const existing = await c.tx
      .selectFrom("app.story")
      .select("id")
      .where("publication_id", "=", c.pub)
      .where("desk_key", "=", a.id)
      .executeTakeFirst();
    if (existing) {
      counts.stories.existing += 1;
      continue;
    }
    let text;
    try {
      text = {
        headline: cleanText(a.headline, "headline", LINE_LIMIT),
        kicker: cleanText(a.kicker ?? "", "kicker", LINE_LIMIT),
        deck: cleanText(a.deck ?? "", "deck", LINE_LIMIT),
        byline: cleanText(a.byline ?? "", "byline", LINE_LIMIT),
        body: cleanText(a.body, "article text", BODY_LIMIT),
        caption: cleanText(a.photo?.caption ?? "", "caption", LINE_LIMIT),
        credit: cleanText(a.photo?.credit ?? "", "credit", LINE_LIMIT),
      };
    } catch (error) {
      if (!(error instanceof DeskTextError)) throw error;
      counts.stories.skipped += 1;
      notes.push(`${folder} ${a.id}: not imported (${error.message})`);
      continue;
    }
    const story = await c.tx
      .insertInto("app.story")
      .values({
        org_id: c.tenant.orgId,
        publication_id: c.pub,
        edition_id: editionId,
        desk_key: a.id,
        status: placed.has(a.id) ? "placed" : "ready",
        reporter_id: c.tenant.userId,
        updated_by: c.tenant.userId,
        priority: a.priority ?? 3,
        page_pin: a.page && a.page >= 1 && a.page <= e.pages ? a.page : null,
        language: articleLanguage(`${text.headline} ${text.body}`, publication.languages, publication.primary_language),
        origin: ORIGINS[a.source ?? ""] ?? "desk",
        created_at: sql<Date>`coalesce(${moment(a.created)}::timestamptz, now())`,
        updated_at: sql<Date>`coalesce(${moment(a.updated)}::timestamptz, now())`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await c.tx
      .insertInto("app.story_revision")
      .values({
        org_id: c.tenant.orgId,
        publication_id: c.pub,
        story_id: story.id,
        rev: 1,
        headline: text.headline,
        kicker: text.kicker,
        deck: text.deck,
        byline: text.byline,
        body: text.body,
        body_format: BODY_FORMAT,
        words: bodyWords(text.body),
        author_id: c.tenant.userId,
      })
      .execute();
    counts.stories.added += 1;
    await audit(c, "desk_import.story", "story", story.id, { deskKey: a.id, edition: editionId, rev: 1 });
    if (!a.photo) continue;
    counts.photos.found += 1;
    const file = original(c, `${folder}/photos`, a.photo.id);
    const made = file ? await asset(c, file, a.photo.id) : null;
    if (!made) {
      counts.photos.skipped += 1;
      if (!file) notes.push(`${folder} ${a.id}: its photo ${a.photo.id} has no original (not imported)`);
      continue;
    }
    counts.photos[made.added ? "added" : "existing"] += 1;
    await c.tx
      .insertInto("app.story_photo")
      .values({
        org_id: c.tenant.orgId,
        publication_id: c.pub,
        story_id: story.id,
        asset_id: made.id,
        caption: text.caption,
        credit: text.credit,
      })
      .execute();
  }

  await importAds(c, editionId, e, folder);
  for (const run of runs) await importRun(c, editionId, `${folder}/runs/${run.key}`, run.key, run.status);
}

/** The slot's size in the plan of the profile in use for this edition's pages and back-page ads, or null. */
async function slotSize(c: Context, e: z.infer<typeof EditionDoc>, slot: string) {
  const profile = await c.tx
    .selectFrom("app.engine_profile")
    .select("plans")
    .where("publication_id", "=", c.pub)
    .where("state", "=", "ready")
    .orderBy("version", "desc")
    .executeTakeFirst();
  type Plan = {
    pages: number;
    back_page_ads: boolean;
    page_plan: { ad_slots: { slot: string; w_mm: number; h_mm: number }[] }[];
  };
  const plan = ((profile?.plans ?? []) as Plan[]).find(
    (p) => p.pages === e.pages && p.back_page_ads === (e.back_page_ads ?? true),
  );
  return plan?.page_plan.flatMap((page) => page.ad_slots).find((s) => s.slot === slot) ?? null;
}

async function importAds(c: Context, editionId: string, e: z.infer<typeof EditionDoc>, folder: string) {
  const { counts, notes } = c.report;
  const index = IndexDoc.safeParse(readJson(join(c.dir, folder, "ads", "index.json")));
  for (const slot of Object.keys(index.success ? index.data.elements : {})) {
    if (!DeskSlot.safeParse(slot).success) continue;
    counts.ads.found += 1;
    const there = await c.tx
      .selectFrom("app.ad_slot_artwork")
      .select("id")
      .where("publication_id", "=", c.pub)
      .where("edition_id", "=", editionId)
      .where("slot", "=", slot)
      .executeTakeFirst();
    if (there) {
      counts.ads.existing += 1;
      continue;
    }
    const file = original(c, `${folder}/ads`, slot);
    const made = file ? await asset(c, file, null) : null;
    const size = made ? await slotSize(c, e, slot) : null;
    if (!made || !size || !made.versionId) {
      counts.ads.skipped += 1;
      if (!file) notes.push(`${folder} ad ${slot}: no original (not imported)`);
      else if (made && !size)
        notes.push(
          `${folder} ad ${slot}: the picture is in the media library; no engine profile in use names the slot`,
        );
      continue;
    }
    const artwork = await c.tx
      .insertInto("app.ad_slot_artwork")
      .values({
        org_id: c.tenant.orgId,
        publication_id: c.pub,
        edition_id: editionId,
        slot,
        asset_id: made.id,
        w_mm: size.w_mm.toFixed(2),
        h_mm: size.h_mm.toFixed(2),
        set_by: c.tenant.userId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (!c.report.dryRun) {
      const payload = MediaAdPayload.parse({
        org_id: c.tenant.orgId,
        pub_id: c.pub,
        artwork_id: artwork.id,
        asset_id: made.id,
        version_id: made.versionId,
        sha256: made.sha256,
        w_mm: size.w_mm.toFixed(2),
        h_mm: size.h_mm.toFixed(2),
      });
      await sql`select app.enqueue_media_ad(${payload.org_id}::uuid, ${JSON.stringify(payload)}::jsonb)`.execute(c.tx);
    }
    counts.ads.added += 1;
    await audit(c, "desk_import.ad_slot", "ad_slot_artwork", artwork.id, { slot, asset: made.id, edition: editionId });
  }
}

/** A jsonb value, or SQL null (never JSON's null, which the columns' object checks refuse). */
const json = (value: object | null) => (value === null ? null : JSON.stringify(value));

const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", txt: "text/plain; charset=utf-8" };

async function importRun(c: Context, editionId: string, folder: string, key: string, status: RunStatus) {
  const { counts, notes } = c.report;
  counts.runs.found += 1;
  const there = await c.tx
    .selectFrom("app.layout_run")
    .select("id")
    .where("publication_id", "=", c.pub)
    .where("edition_id", "=", editionId)
    .where("desk_key", "=", key)
    .executeTakeFirst();
  if (there) {
    counts.runs.existing += 1;
    return;
  }
  if (!c.manifest.has(`${folder}/request.json`)) {
    counts.runs.skipped += 1;
    notes.push(`${folder}: not imported (it has no request.json)`);
    return;
  }
  const msgs = status.msgs ?? {};
  const text = (value: unknown) => deskText(value, msgs);
  const notPlaced = (status.not_placed ?? []).flatMap((item) => {
    const { article, reason } = (item ?? {}) as { article?: unknown; reason?: unknown };
    const said = text(reason);
    return DeskArticleKey.safeParse(article).success && said ? [{ article, reason: said }] : [];
  });
  const timings = Object.fromEntries(
    Object.entries(status.timings ?? {}).filter(([, v]) => typeof v === "number" && v >= 0),
  );
  const finished = moment(status.finished) ?? moment(status.created);
  const run = await c.tx
    .insertInto("app.layout_run")
    .values({
      org_id: c.tenant.orgId,
      publication_id: c.pub,
      edition_id: editionId,
      desk_key: key,
      state: status.state,
      request_sha256: c.manifest.get(`${folder}/request.json`)?.sha256 ?? null,
      profile_id: null, // made by the Desk, before any hosted profile
      engine_version: c.engineVersion,
      checker_sha256: c.checker,
      timings: JSON.stringify(timings),
      not_placed: JSON.stringify(notPlaced),
      message: json(text(status.message)),
      error: json(text(status.error)),
      elapsed_s: status.elapsed_s ?? null,
      started_at: moment(status.started),
      finished_at: sql<Date>`coalesce(${finished}::timestamptz, now())`,
      created_by: c.tenant.userId,
      created_at: sql<Date>`coalesce(${moment(status.created)}::timestamptz, now())`,
    })
    .returning(["id", "request_key"])
    .executeTakeFirstOrThrow();
  const runPrefix = run.request_key.slice(0, -"request.json".length);
  const request = await put(c, `${folder}/request.json`, run.request_key, "application/json");
  /** A file of the run, stored under runs/<run>/<as>; null when the run has none. */
  const file = async (name: string | null | undefined, as: string): Promise<StoredFile | null> => {
    const path = `${folder}/${name}`;
    if (!name || !c.manifest.has(path)) return null;
    return put(c, path, `${runPrefix}${as}`, TYPES[as.split(".").at(-1) ?? ""] ?? "application/octet-stream");
  };
  for (const raw of status.pages ?? []) {
    const parsed = PageStatus.safeParse(raw);
    if (!parsed.success) {
      notes.push(`${folder}/status.json: a page not imported (not the Desk's shape)`);
      continue;
    }
    const page = parsed.data;
    counts.pages.found += 1;
    const nn = String(page.page).padStart(2, "0");
    const pdf = page.state === "done" ? await file(page.pdf, `pages/${nn}/page.pdf`) : null;
    const report = pdf ? await file(`page-${nn}.pdfx-check.txt`, `pages/${nn}/pdfx-check.txt`) : null;
    const check = pdf && page.pdfx_check ? page.pdfx_check : null;
    await c.tx
      .insertInto("app.run_page")
      .values({
        org_id: c.tenant.orgId,
        publication_id: c.pub,
        run_id: run.id,
        page_no: page.page,
        role: page.role,
        state: page.state,
        articles: JSON.stringify((page.articles ?? []).filter((id) => DeskArticleKey.safeParse(id).success)),
        pdf: json(pdf),
        png: json(pdf && (await file(page.png, `pages/${nn}/preview.png`))),
        thumb: json(pdf && (await file(page.thumb, `pages/${nn}/thumb.png`))),
        report: json(report),
        pdf_sha256: pdf?.sha256 ?? null,
        checked: json(check && { passed: check.passed, fails: check.fails, warnings: check.warnings }),
        warnings: JSON.stringify((page.warnings ?? []).flatMap((w) => text(w) ?? [])),
        message: json(text(page.message)),
        seconds: page.seconds ?? null,
      })
      .execute();
    if (pdf && check && c.checker) {
      // the verdict on these bytes by this checker (the same bytes are never checked twice)
      await c.tx
        .insertInto("app.pdf_check")
        .values({
          org_id: c.tenant.orgId,
          sha256: pdf.sha256,
          checker_sha256: c.checker,
          passed: check.passed,
          fails: check.fails,
          warnings: check.warnings,
          report_key: report?.key ?? null,
          report_version_id: report?.version_id ?? null,
        })
        .onConflict((conflict) => conflict.columns(["org_id", "sha256", "checker_sha256"]).doNothing())
        .execute();
    }
    counts.pages[pdf || page.state !== "done" ? "added" : "skipped"] += 1;
    if (page.state === "done" && !pdf) notes.push(`${folder} page ${page.page}: its PDF is missing`);
  }
  await c.tx
    .updateTable("app.layout_run")
    .set({
      request_version_id: request.version_id,
      edition_pdf: json(await file("edition.pdf", "edition.pdf")),
      press_zip: json(await file("press-files.zip", "press-files.zip")),
    })
    .where("publication_id", "=", c.pub)
    .where("id", "=", run.id)
    .execute();
  counts.runs.added += 1;
  await audit(c, "desk_import.run", "layout_run", run.id, { deskKey: key, edition: editionId, state: status.state });
}

// ------------------------------------------------------------------------------------------------ the whole

class DryRun extends Error {}

export async function importDesk(options: ImportOptions): Promise<ImportReport> {
  const dir = mkdtempSync(join(tmpdir(), "pgn-desk-import-"));
  try {
    const { files, sha256 } = await unpack(options.source, dir);
    const manifest = checkManifest(dir, files);
    const counts = Object.fromEntries(
      KINDS.map((kind) => [kind, { found: 0, added: 0, existing: 0, skipped: 0 }]),
    ) as Counts;
    const report: ImportReport = {
      bundleSha256: sha256,
      dryRun: options.dryRun ?? false,
      counts,
      samples: 0,
      notes: [],
      files: [],
    };
    const tenant: Tenant = {
      orgId: options.orgId,
      userId: options.actorId,
      pubIds: [options.pubId],
      requestId: `import-desk-${sha256.slice(0, 16)}`,
    };
    // the publication must be the organisation's (the walls hide another's), and the actor one of its people
    const known = await options.database.withTenant(tenant, async (tx) => ({
      pub: await tx.selectFrom("app.publication").select("id").where("id", "=", options.pubId).executeTakeFirst(),
      actor: await tx
        .selectFrom("app.person")
        .select("user_id")
        .where("user_id", "=", options.actorId)
        .where("status", "=", "active")
        .executeTakeFirst(),
    }));
    if (!known.pub)
      throw new ImportRefused("That publication is not one of this organisation's. Nothing was imported.");
    if (!known.actor) throw new ImportRefused("The actor is not an active person of this organisation.");
    const config = readJson(join(dir, "config.json")) as { engine?: unknown } | undefined;
    const engine = typeof config?.engine === "string" ? config.engine.slice(0, 200) : null;
    const checker = existsSync(CHECKER) ? createHash("sha256").update(readFileSync(CHECKER)).digest("hex") : null;
    if (!checker) report.notes.push("The PDF/X-1a checker is not on this machine: no check verdict was recorded.");
    const stored: Context["stored"] = [];
    const editions = existsSync(join(dir, "editions")) ? readdirSync(join(dir, "editions")).sort() : [];
    for (const name of editions) {
      counts.editions.found += 1;
      try {
        await options.database.withTenant(tenant, async (tx) => {
          const c: Context = {
            tx,
            tenant,
            pub: options.pubId,
            store: options.store,
            report,
            stored,
            manifest,
            dir,
            checker,
            engineVersion: engine,
          };
          await importEdition(c, name, options.allRuns ?? false, options.includeSamples ?? false);
          if (report.dryRun) throw new DryRun(); // every row rolled back
        });
      } catch (error) {
        if (!(error instanceof DryRun)) throw error;
      }
    }
    if (report.dryRun) return report;
    // the import check: each file stored, read back by its version
    for (const file of stored) {
      const hash = createHash("sha256");
      for await (const chunk of await options.store.read(file.key, file.versionId)) hash.update(chunk);
      const want = manifest.get(file.path)?.sha256 ?? "";
      report.files.push({ path: file.path, key: file.key, manifest: want, stored: hash.digest("hex") });
    }
    if (KINDS.some((kind) => counts[kind].added > 0)) {
      await options.database.withTenant(tenant, (tx) =>
        recordAudit(tx, tenant, {
          action: "desk_import.done",
          targetType: "publication",
          targetId: options.pubId,
          publicationId: options.pubId,
          actorKind: "import",
          data: {
            bundle: sha256,
            files: stored.length,
            ...Object.fromEntries(KINDS.map((kind) => [kind, counts[kind].added])),
          },
        }),
      );
    }
    return report;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
