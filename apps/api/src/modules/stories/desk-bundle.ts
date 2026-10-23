// "Send to the Desk" (docs/product/10-l2-newsroom-plan.md §5.2, §10 PR 24): POST
// /api/v1/orgs/:o/pubs/:p/editions/:e/desk-bundle (desk.export) answers the edition's stories as a Pageinator stories
// file, pageinator.story-bundle/1, exactly as tools/desk/CONTRACT.md §6 defines it (the Desk refuses anything else):
//   - a ZIP of bundle.json and one photos/<sha256>.<ext> per distinct photo original, every file stored (photos are
//     packed already, and a deflated bundle.json of a repetitive story could pack more than the Desk's 100:1 limit),
//     made with fflate as it is sent (reply.send(stream)), so neither the API nor the stop handling holds it whole.
//     fflate writes no ZIP64; the limits below keep every bundle far from needing it;
//   - every key present, none other; `revision` is the story's version, which every change of the story makes the
//     next, its photo and the photo's caption and credit included; the body is desk-text/1, the engine's own blocks
//     (@pageinator/desk-text blocks) joined by exactly "\n\n", a subheading as "## " and its text;
//   - at most 200 stories (so at most 201 files), bundle.json at most 32 MiB, and the ZIP at most 200 MB, checked
//     before anything is sent (413 file_too_large, 400 invalid_request for too many stories). Spiked stories are never
//     sent (400): a story killed at the desk is not one request from the Desk;
//   - a story the Desk could not take as it is refuses the bundle (409 bundle_refused, naming each story): a photo that
//     was rejected or deleted (sending the story without it, at the same revision, would leave the Desk printing the
//     old one), or a subheading that starts with "#" (desk-text/1 has no way to write it). Nothing is dropped silently.
//     ANY FUTURE PATH THAT REJECTS OR DELETES AN ASSET MUST BUMP story.version ON EVERY STORY WHOSE story_photo NAMES IT
//     (11-fix-before-launch), so the stories' next bundle carries a higher revision;
//   - each photo is read from the version the asset is pinned to, and its SHA-256 checked as it streams: a mismatch
//     cuts the ZIP off, which the Desk then refuses as damaged.
// The bundle is recorded with each story's text revision and the revision it was sent at (desk_bundle,
// desk_bundle_revision), and audited, before its first byte is sent.
// A photo's `filename` is its Desk id and type (`p-….jpg`), not the name it was uploaded with, which the API does not
// keep. A retry makes another bundle of the same stories (a new id): the Desk replaces an article only for a higher
// revision, so importing either changes nothing more.
import { createHash } from "node:crypto";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { BUNDLE_FORMAT, DeskBundleRequest } from "@pageinator/contracts";
import { BODY_FORMAT, blocks, isSpace, skipSpace, strip } from "@pageinator/desk-text";
import { Zip, ZipPassThrough } from "fflate";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type BundleStory, bundleStories, editionOf, recordBundle } from "../../db/desk-bundles.ts";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { accessOf } from "../access/access.ts";
import { EXTENSION, type Mime } from "../media/picture.ts";

const OneEdition = z.strictObject({ o: z.string(), p: z.string(), e: z.string() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_STORIES = 200;
export const MAX_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_PACKED_BYTES = 200 * 1024 * 1024;
/** What the ZIP adds to its files: headers, data descriptors and the central directory, for 201 files, generously. */
const ZIP_OVERHEAD = 256 * 1024;
const HIGH_WATER = 1024 * 1024;

export type BundlePhoto = {
  file: string;
  sha256: string;
  filename: string;
  caption: string;
  credit: string;
};

export type BundleDoc = {
  format: typeof BUNDLE_FORMAT;
  bundle: { id: string; created: string };
  source: { organisation_id: string; publication_id: string };
  edition: { date: string; pages: number };
  stories: {
    id: string;
    revision: number;
    headline: string;
    kicker: string;
    deck: string;
    byline: string;
    body: string;
    body_format: typeof BODY_FORMAT;
    section: string | null;
    priority: number;
    page: number | null;
    language: string;
    photo: BundlePhoto | null;
  }[];
};

/** A body as desk-text/1: the engine's own blocks, one a line, joined by exactly one empty line. A subheading whose
 * text starts with "#" cannot be written in desk-text/1 ("## " then text that does not start with "#"): it is returned
 * in `hashed`, for the caller to refuse, never with its "#" dropped. */
export function deskText(body: string): { text: string; hashed: string[] } {
  const all = blocks(body);
  const hashed = all.filter((block) => block.kind === "crosshead" && block.text.startsWith("#")).map((b) => b.text);
  const text = all.map((block) => (block.kind === "crosshead" ? `## ${block.text}` : block.text)).join("\n\n");
  return { text, hashed };
}

/** Whether a body is desk-text/1, as tools/desk/deskserver/bundle.py desk_text decides it, with Python's own whitespace
 * (str.strip, and `\s` in its re, which is str.isspace: U+FEFF is not a space there, U+001C is), so the API never
 * refuses what the Desk takes, nor sends what it refuses. */
export function isDeskText(body: string): boolean {
  if (body === "") return true;
  if (body.includes("\r")) return false;
  return body.split("\n\n").every((block) => {
    if (strip(block) === "" || block.includes("\n")) return false;
    if (!block.slice(skipSpace(block, 0)).startsWith("##")) return true;
    // "## " then a first character that is neither a space nor "#" (re: "## [^\s#][^\n]*", whole block)
    const first = block.charCodeAt(3);
    return block.startsWith("## ") && block.length > 3 && !isSpace(first) && block[3] !== "#";
  });
}

/** Why a story cannot go into the bundle as it is, in plain words; null when it can. */
type Refusal = { story: string; message: string };

const named = (headline: string) => {
  const flat = headline.replace(/\s+/g, " ").trim() || "(no headline)";
  return `“${flat.length > 120 ? `${flat.slice(0, 119)}…` : flat}”`;
};

function storyOf(row: BundleStory): { story: BundleDoc["stories"][number] } | { refused: Refusal } {
  const { text: body, hashed } = deskText(row.body);
  if (hashed.length > 0) {
    const head = hashed[0] ?? "";
    return {
      refused: {
        story: row.id,
        message: `The subheading “## ${head.length > 80 ? `${head.slice(0, 79)}…` : head}” in ${named(row.headline)} starts with #, which the Desk cannot print as a subheading: change it in the story.`,
      },
    };
  }
  if (!isDeskText(body)) throw new Error(`The body of story ${row.id} could not be made desk-text/1.`);
  const mime = row.photo_mime as Mime | null;
  const usable = row.photo_asset_id && row.photo_sha256 && mime && row.photo_desk_key;
  if (row.photo_attached && !usable) {
    return {
      refused: {
        story: row.id,
        message: `${named(row.headline)} has a photo that was rejected or deleted: take it off the story, or give it another, then send again.`,
      },
    };
  }
  const photo =
    usable && mime
      ? {
          file: `photos/${row.photo_sha256}.${EXTENSION[mime]}`,
          sha256: row.photo_sha256 as string,
          filename: `${row.photo_desk_key}.${EXTENSION[mime]}`,
          caption: row.photo_caption ?? "",
          credit: row.photo_credit ?? "",
        }
      : null;
  return {
    story: {
      id: row.id,
      revision: row.version,
      headline: row.headline,
      kicker: row.kicker,
      deck: row.deck,
      byline: row.byline,
      body,
      body_format: BODY_FORMAT,
      section: row.section,
      priority: row.priority,
      page: row.page_pin,
      language: row.language,
      photo,
    },
  };
}

export type Original = { name: string; sha256: string; bytes: number; key: string; version: string };

/** Until `out` drains or closes, with neither listener left behind (an AbortSignal removes the loser). */
async function drained(out: PassThrough): Promise<void> {
  const stop = new AbortController();
  try {
    await Promise.race([once(out, "drain", { signal: stop.signal }), once(out, "close", { signal: stop.signal })]);
  } finally {
    stop.abort();
  }
}

/** Writes the ZIP into out: bundle.json first, then each photo as it is read from the store, every file stored. A
 * photo whose bytes are not its SHA-256 throws before its entry is finished, so the ZIP never gets its central
 * directory: the Desk refuses what was sent as damaged. */
export async function writeZip(
  out: PassThrough,
  json: Uint8Array,
  originals: readonly Original[],
  store: Pick<ObjectStore, "read">,
  when: Date,
): Promise<void> {
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      out.destroy(error);
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });
  const doc = new ZipPassThrough("bundle.json");
  doc.mtime = when;
  zip.add(doc);
  doc.push(json, true);
  for (const original of originals) {
    if (out.destroyed) return; // the person went away
    const file = new ZipPassThrough(original.name);
    file.mtime = when;
    zip.add(file);
    const hash = createHash("sha256");
    for await (const chunk of await store.read(original.key, original.version)) {
      if (out.destroyed) return;
      hash.update(chunk);
      file.push(chunk);
      if (out.writableLength > HIGH_WATER) await drained(out);
    }
    if (hash.digest("hex") !== original.sha256) throw new ShaMismatch(original.name);
    file.push(new Uint8Array(0), true);
  }
  zip.end();
}

/** A photo's bytes are not the ones its asset names. */
export class ShaMismatch extends Error {
  constructor(name: string) {
    super(`The original ${name} is not the bytes its asset names: the bundle was cut off.`);
  }
}

export type DeskBundleOptions = { database: Database; store: ObjectStore };

export const deskBundleRoutes: FastifyPluginAsyncZod<DeskBundleOptions> = async (app, { database, store }) => {
  app.post(
    "/api/v1/orgs/:o/pubs/:p/editions/:e/desk-bundle",
    { config: { permission: "desk.export" }, schema: { params: OneEdition, body: DeskBundleRequest } },
    async (request, reply) => {
      const access = accessOf(request);
      const { p, e } = request.params;
      const statuses = [...new Set(request.body.statuses ?? ["ready"])];
      // an owner decision to confirm (11-fix-before-launch): Held and Draft may be asked for, Spiked never
      if (statuses.includes("spiked")) {
        throw new ApiError("invalid_request", [
          { field: "body.statuses", message: "Spiked stories are never sent to the Desk: restore a story first." },
        ]);
      }
      const made = await database.withTenant(access.tenant, async (tx) => {
        const edition = UUID.test(e) ? await editionOf(tx, p, e) : undefined;
        if (!edition) throw new ApiError("not_found");
        const rows = await bundleStories(tx, p, e, statuses, MAX_STORIES + 1);
        if (rows.length > MAX_STORIES) {
          throw new ApiError("invalid_request", [
            { field: "body.statuses", message: `A bundle holds at most ${MAX_STORIES} stories: send fewer at a time.` },
          ]);
        }
        const decided = rows.map(storyOf);
        const refusals = decided.flatMap((one) => ("refused" in one ? [one.refused] : []));
        if (refusals.length > 0) {
          request.log.warn({ stories: refusals.map((r) => r.story) }, "a story bundle was refused for its stories");
          throw new ApiError(
            "bundle_refused",
            refusals.slice(0, 20).map((r) => ({ field: `stories.${r.story}`, message: r.message })),
          );
        }
        const stories = decided.flatMap((one) => ("story" in one ? [one.story] : []));
        const originals = new Map<string, Original>();
        for (const [k, row] of rows.entries()) {
          const photo = stories[k]?.photo;
          if (photo && row.photo_key && row.photo_version && row.photo_bytes) {
            originals.set(photo.file, {
              name: photo.file,
              sha256: photo.sha256,
              bytes: row.photo_bytes,
              key: row.photo_key,
              version: row.photo_version,
            });
          }
        }
        const doc = (bundle: BundleDoc["bundle"]): BundleDoc => ({
          format: BUNDLE_FORMAT,
          bundle,
          source: { organisation_id: access.tenant.orgId, publication_id: p },
          edition: { date: edition.date, pages: edition.pages },
          stories,
        });
        // the sizes, before anything is recorded or sent (an id and a time of the same lengths as the real ones)
        const trial = Buffer.byteLength(
          JSON.stringify(doc({ id: "0".repeat(36), created: "0000-00-00T00:00:00+05:30" })),
        );
        const photoBytes = [...originals.values()].reduce((sum, original) => sum + original.bytes, 0);
        if (trial > MAX_JSON_BYTES || trial + photoBytes + ZIP_OVERHEAD > MAX_PACKED_BYTES) {
          throw new ApiError("file_too_large", [
            {
              field: "body.statuses",
              message: "These stories and their photos are over 200 MB: send fewer at a time.",
            },
          ]);
        }
        const bundle = await recordBundle(
          tx,
          access.tenant,
          p,
          e,
          rows.map((row) => ({ id: row.id, rev: row.current_rev, version: row.version })),
        );
        await tx
          .insertInto("app.audit_event")
          .values({
            org_id: access.tenant.orgId,
            publication_id: p,
            actor_kind: "user",
            actor_id: access.tenant.userId,
            action: "desk.export",
            target_type: "edition",
            target_id: e,
            data: JSON.stringify({ bundle: bundle.id, stories: rows.length, photos: originals.size }),
            ip: request.ip,
            request_id: access.tenant.requestId,
          })
          .execute();
        const json = new TextEncoder().encode(JSON.stringify(doc(bundle)));
        return { bundle, edition, json, originals: [...originals.values()], count: rows.length };
      });
      const out = new PassThrough();
      writeZip(out, made.json, made.originals, store, new Date(Date.parse(made.bundle.created))).catch((error) => {
        request.log.error({ bundle: made.bundle.id, err: error }, "the story bundle was cut off");
        out.destroy(error instanceof Error ? error : new Error(String(error)));
      });
      return reply
        .header("content-type", "application/zip")
        .header("content-disposition", `attachment; filename="pageinator-stories-${made.edition.date}.zip"`)
        .header("x-pageinator-bundle", made.bundle.id)
        .header("x-pageinator-stories", String(made.count))
        .send(out);
    },
  );
};
