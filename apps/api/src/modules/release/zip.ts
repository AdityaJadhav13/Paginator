// "Download all" (docs/product/10-l2-newsroom-plan.md §1 L2.5; packages/contracts/src/release.ts, whose header lists the
// route), registered inside releaseRoutes: POST /api/v1/orgs/:o/pubs/:p/releases/:id/zip (export.press) answers the
// release's files as one ZIP, made with fflate as it is sent (as stories/desk-bundle.ts sends the Desk's bundle), every
// file stored (PDFs are packed already):
//   - SHA256SUMS first: one `sha256sum` line per file ("<hex>  <name>\n"), so `sha256sum -c SHA256SUMS` checks them;
//   - then each released file, read from exactly its archived version (as its download link and the archive check read
//     it), its SHA-256 checked as it streams: bytes that are not the ones released cut the ZIP off before its central
//     directory (logged), so it never opens whole.
// The rows are read in one short transaction and the archive after it, so a slow store holds no transaction. fflate
// writes no ZIP64: a release is at most 16 page PDFs, far from its 4 GiB limit.
import { createHash } from "node:crypto";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { Zip, ZipPassThrough } from "fflate";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { layoutEdition } from "../../db/layout.ts";
import type { Database } from "../../db/pools.ts";
import { findRelease, releaseFiles } from "../../db/release.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { accessOf } from "../access/access.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OneRelease = z.strictObject({ o: z.string(), p: z.string(), id: z.string() });
const HIGH_WATER = 1024 * 1024;

export type ZipFile = { name: string; sha256: string; key: string; version: string };

/** A `sha256sum` line for each file. */
export const sha256sums = (files: readonly Pick<ZipFile, "name" | "sha256">[]) =>
  files.map((file) => `${file.sha256}  ${file.name}\n`).join("");

/** An archived file's bytes are not the ones released. */
export class ArchiveMismatch extends Error {
  constructor(name: string) {
    super(`The archived ${name} is not the bytes released: the ZIP was cut off.`);
  }
}

/** Until `out` drains or closes, with neither listener left behind (an AbortSignal removes the loser). */
async function drained(out: PassThrough): Promise<void> {
  const stop = new AbortController();
  try {
    await Promise.race([once(out, "drain", { signal: stop.signal }), once(out, "close", { signal: stop.signal })]);
  } finally {
    stop.abort();
  }
}

/** Writes the release's ZIP into out: SHA256SUMS, then each file as it is read, every file stored. A file whose bytes
 * are not its SHA-256 throws before its entry is finished, so the ZIP never gets its central directory. */
export async function writeReleaseZip(
  out: PassThrough,
  files: readonly ZipFile[],
  read: (key: string, version: string) => Promise<AsyncIterable<Uint8Array>>,
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
  const sums = new ZipPassThrough("SHA256SUMS");
  sums.mtime = when;
  zip.add(sums);
  sums.push(new TextEncoder().encode(sha256sums(files)), true);
  for (const file of files) {
    if (out.destroyed) return; // the person went away
    const entry = new ZipPassThrough(file.name);
    entry.mtime = when;
    zip.add(entry);
    const hash = createHash("sha256");
    for await (const chunk of await read(file.key, file.version)) {
      if (out.destroyed) return;
      hash.update(chunk);
      entry.push(chunk);
      if (out.writableLength > HIGH_WATER) await drained(out);
    }
    if (hash.digest("hex") !== file.sha256) throw new ArchiveMismatch(file.name);
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
}

export const releaseZipRoutes: FastifyPluginAsyncZod<{ database: Database; store: ObjectStore }> = async (
  app,
  { database, store },
) => {
  app.post(
    "/api/v1/orgs/:o/pubs/:p/releases/:id/zip",
    { config: { permission: "export.press" }, schema: { params: OneRelease } },
    async (request, reply) => {
      const { p: pub, id } = request.params;
      const made = await database.withTenant(accessOf(request).tenant, async (tx) => {
        const release = UUID.test(id) ? await findRelease(tx, pub, id) : undefined;
        if (!release) throw new ApiError("not_found");
        const edition = await layoutEdition(tx, pub, release.edition_id);
        if (!edition) throw new Error("a release's edition is not found");
        const files = (await releaseFiles(tx, pub, [id])).map((f) => ({
          name: f.name,
          sha256: f.sha256,
          key: f.archive_key,
          version: f.archive_version_id,
        }));
        return { release, edition, files };
      });
      const out = new PassThrough();
      const read = (key: string, version: string) => store.archiveRead(key, version);
      writeReleaseZip(out, made.files, read, made.release.approved_at).catch((error) => {
        request.log.error({ release: id, err: error }, "the release ZIP was cut off");
        out.destroy(error instanceof Error ? error : new Error(String(error)));
      });
      return reply
        .header("content-type", "application/zip")
        .header(
          "content-disposition",
          `attachment; filename="${made.edition.desk_key}_release-${made.release.number}.zip"`,
        )
        .send(out);
    },
  );
};
