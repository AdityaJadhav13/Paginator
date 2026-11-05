// Release's routes (docs/product/10-l2-newsroom-plan.md §1 L2.5; packages/contracts/src/release.ts, whose header lists
// them and their rules), under /api/v1/orgs/:o/pubs/:p. What is released is the page PDFs of the edition's Pages board
// run (its newest done run), each one's current bytes. A release, with the edition locked:
//   - the preflight and the candidate computed again (preflight.ts), the files posted equal to the candidate's;
//   - each page's pinned work-bucket version read, hashed (it must be the SHA-256 approved), written to the archive
//     bucket at orgs/<org>/pubs/<pub>/editions/<ed>/releases/<rel>/pages/<name> under Object Lock (governance, until
//     now + PGN_ARCHIVE_RETAIN_DAYS) with its ChecksumSHA256, then that version read back and hashed again;
//   - manifest.json (the edition, the release, the run, its approver, each file, the checker, the preflight) the same;
//   - any mismatch or store error: 502 archive_failed, and the transaction (the release's rows) rolls back.
// Each delivery and confirmation writes a new version of receipts.json beside them (the old versions stay, locked).
import { createHash } from "node:crypto";
import {
  ArchiveCheck,
  ConfirmInput,
  DeliveryInput,
  EditionRelease,
  FileLink,
  PageApprovalInput,
  type Permission,
  PressTest,
  PressTestInput,
  Release,
  ReleaseInput,
  ReleasePage,
  reach,
} from "@pageinator/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import { editRun, pageTurn, runTurn } from "../../db/editor.ts";
import { editionArtwork, layoutEdition, profileInUse, storiesByDeskKey } from "../../db/layout.ts";
import type { Database } from "../../db/pools.ts";
import {
  type ReleaseRow,
  addDelivery,
  addReleaseFile,
  approvePage,
  boardRun,
  confirmDelivery,
  createRelease,
  deliveries,
  editionReleases,
  findRelease,
  lockRunPage,
  markEditionReleased,
  markVerified,
  pressTestOf,
  printsPhoto,
  releaseFiles,
  releasePages,
  releasedPages,
  setManifest,
  setPressTest,
  standingApprovals,
  unlockPage,
} from "../../db/release.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { type Access, accessOf, auditRefusals, refused } from "../access/access.ts";
import { planFor, slotsOf } from "../layout/request.ts";
import { DOWNLOAD_SECONDS } from "../media/photos.ts";
import { idempotent } from "../requests/idempotency.ts";
import { archiveRoutes } from "./archive.ts";
import { type ReleaseState, candidate, needsPressTest, preflight, releasePage, sameFiles } from "./preflight.ts";
import { printProfileRoutes } from "./print-profiles.ts";
import { releaseNow, releaseView, releaseViews } from "./views.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = /^([1-9]|1[0-6])$/;
const DAY_MS = 86_400_000;
/** An archive or work-bucket call (with its body read) that takes longer fails: archive_failed, well inside the
 * transaction's idle limit (idle_in_transaction_session_timeout, 60 s). */
export const STORE_MS = 30_000;

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneEdition = z.strictObject({ o: z.string(), p: z.string(), e: z.string() });
const OnePage = z.strictObject({ o: z.string(), p: z.string(), r: z.string(), n: z.string() });
const OneRelease = z.strictObject({ o: z.string(), p: z.string(), id: z.string() });
const OneFile = z.strictObject({ o: z.string(), p: z.string(), id: z.string(), name: z.string() });
const OneDelivery = z.strictObject({ o: z.string(), p: z.string(), id: z.string(), d: z.string() });

export type ReleaseOptions = { database: Database; store: ObjectStore; retainDays: number };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function readAll(chunks: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return Buffer.concat(parts);
}

/** The work's answer, or an error once `ms` have passed (the call itself is left to end on its own). */
export function within<T>(work: Promise<T>, ms = STORE_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the object store took more than ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** An object's version read whole, within STORE_MS. */
const readWhole = (read: () => Promise<AsyncIterable<Uint8Array>>) => within(read().then(readAll));

const may = (access: Access, pub: string, permission: Permission) =>
  reach(permission, access.orgRole, access.publications.get(pub) ?? { roles: [], grants: [] }) !== null;

const folderOf = (orgId: string, release: Pick<ReleaseRow, "edition_id" | "id">, pub: string) =>
  `orgs/${orgId}/pubs/${pub}/editions/${release.edition_id}/releases/${release.id}/`;

/** Everything the Release tab and a release are computed from (the edition locked when asked); undefined: none. */
export async function stateOf(tx: Tx, pub: string, editionId: string, lock = false): Promise<ReleaseState | undefined> {
  const edition = UUID.test(editionId) ? await layoutEdition(tx, pub, editionId, lock) : undefined;
  if (!edition) return undefined;
  const run = await boardRun(tx, pub, editionId);
  const pages = run ? await releasePages(tx, pub, run, lock) : [];
  const artwork = await editionArtwork(tx, pub, editionId);
  const profile = await profileInUse(tx, pub);
  const left = run?.not_placed ?? [];
  const stories = await storiesByDeskKey(
    tx,
    pub,
    left.map((l) => l.article),
  );
  return {
    edition,
    run,
    pages,
    approvals: run ? await standingApprovals(tx, pub, run.id) : [],
    released: await releasedPages(tx, pub, editionId),
    slots: slotsOf(planFor(profile?.plans ?? null, edition), artwork),
    adRasters: Object.fromEntries(
      artwork.flatMap((art) => (art.state === "ready" && art.raster ? [[art.slot, art.raster.sha256]] : [])),
    ),
    printsPhoto: await printsPhoto(tx, pub, [...new Set(pages.flatMap((p) => p.articles))]),
    hasArtwork: artwork.length > 0,
    notPlaced: left.map((l) => ({
      storyId: stories.get(l.article)?.id ?? null,
      deskKey: l.article,
      headline: stories.get(l.article)?.headline ?? null,
      reason: l.reason,
    })),
    pressTest: await pressTestOf(tx, pub),
  };
}

export const releaseRoutes: FastifyPluginAsyncZod<ReleaseOptions> = async (app, { database, store, retainDays }) => {
  auditRefusals(app, database);
  await app.register(archiveRoutes, { database });
  await app.register(printProfileRoutes, { database });

  /** Writes bytes to the archive under Object Lock and reads that version back: its SHA-256 must be theirs. Any
   * failure (or a store slower than STORE_MS) is 502 `failed` (archive_failed: nothing released; receipt_failed: the
   * receipt not recorded), logged, and the caller's transaction rolls back. */
  async function archive(
    log: FastifyBaseLogger,
    key: string,
    body: Buffer,
    contentType: string,
    until: Date,
    failed: "archive_failed" | "receipt_failed" = "archive_failed",
  ) {
    try {
      const { versionId } = await within(store.archivePut({ key, body, contentType, retainUntil: until }));
      const back = sha256(await readWhole(() => store.archiveRead(key, versionId)));
      if (back !== sha256(body)) throw new Error(`the archived ${key} reads back as other bytes`);
      return { versionId, sha256: back };
    } catch (error) {
      log.error({ err: error, key }, "the archive copy failed");
      throw new ApiError(failed);
    }
  }

  /** A new version of the release's receipts.json: its deliveries and confirmations as they are now. */
  async function writeReceipts(log: FastifyBaseLogger, tx: Tx, tenant: Tenant, pub: string, release: ReleaseRow) {
    const view = await releaseView(tx, pub, release.id);
    const body = Buffer.from(
      JSON.stringify({
        format: "pageinator.receipts/1",
        release: { id: release.id, number: release.number, edition: release.edition_id },
        deliveries: view?.deliveries ?? [],
      }),
      "utf8",
    );
    const key = `${folderOf(tenant.orgId, release, pub)}receipts.json`;
    await archive(log, key, body, "application/json", release.retain_until, "receipt_failed");
  }

  /** An approval or unlock of run r's page n: in the run's turn and the page's (db/editor.ts), so it waits for an
   * editor save, move or change that is checking the page, and they for it. */
  const pageApproval = <T>(r: string, n: string, fn: () => Promise<T>) =>
    runTurn(database, r, () => pageTurn(database, r, n, fn));

  /** The run's page in the Release tab's terms: only the board run's pages are there. */
  async function boardPage(tx: Tx, pub: string, r: string, n: string) {
    // the caller holds the run's and the page's turns (pageApproval), so no editor save, move or change is mid-way
    const run = UUID.test(r) && PAGE.test(n) ? await editRun(tx, pub, r) : undefined;
    if (!run) throw new ApiError("not_found");
    const page = Number(n);
    await lockRunPage(tx, pub, r, page);
    const state = await stateOf(tx, pub, run.edition_id);
    const row = state?.run?.id === r ? state.pages.find((p) => p.page_no === page) : undefined;
    return { state, row, page };
  }

  app.get(
    "/api/v1/orgs/:o/pubs/:p/editions/:e/release",
    { config: { permission: "pages.view" }, schema: { params: OneEdition, response: { 200: EditionRelease } } },
    async (request) => {
      const { p: pub, e } = request.params;
      return database.withTenant(accessOf(request).tenant, async (tx) => {
        const state = await stateOf(tx, pub, e);
        if (!state) throw new ApiError("not_found");
        return {
          editionId: e,
          runId: state.run?.id ?? null,
          preflight: preflight(state),
          pages: state.pages.map((page) => releasePage(state, page)),
          candidate: candidate(state),
          releases: await releaseViews(tx, pub, await editionReleases(tx, pub, e)),
          needsPressTest: needsPressTest(state),
          pressTest: state.pressTest,
        };
      });
    },
  );

  // ------------------------------------------------------------------------------------------ page approval

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/approve",
    {
      config: { permission: "page.approve" },
      schema: { params: OnePage, body: PageApprovalInput, response: { 200: ReleasePage } },
    },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, r, n } = request.params;
      const { rev, pdfSha256 } = request.body;
      return pageApproval(r, n, () =>
        database.withTenant(tenant, async (tx) => {
          const { state, row, page } = await boardPage(tx, pub, r, n);
          // a page of a run that is not the edition's board run: it can no longer be released, so never approved
          if (!state || !row) throw new ApiError("approval_stale");
          const view = releasePage(state, row);
          if (row.state !== "done" || view.needsSave || row.pdf_sha256 !== pdfSha256 || row.pdf_rev !== rev)
            throw new ApiError("approval_stale", undefined, view);
          if (view.approval) return view; // approving again changes nothing
          await approvePage(tx, tenant, pub, r, page, rev, pdfSha256);
          await recordAudit(tx, tenant, {
            action: "page.approve",
            targetType: "layout_run",
            targetId: r,
            publicationId: pub,
            data: { page, rev, pdfSha256 },
          });
          return releasePage({ ...state, approvals: await standingApprovals(tx, pub, r) }, row);
        }),
      );
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/unlock",
    { config: { permission: "page.unlock" }, schema: { params: OnePage, response: { 200: ReleasePage } } },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, r, n } = request.params;
      return pageApproval(r, n, () =>
        database.withTenant(tenant, async (tx) => {
          const { state, row, page } = await boardPage(tx, pub, r, n);
          if (!state || !row || !releasePage(state, row).approval) throw new ApiError("not_approved");
          await unlockPage(tx, tenant, pub, r, page);
          await recordAudit(tx, tenant, {
            action: "page.unlock",
            targetType: "layout_run",
            targetId: r,
            publicationId: pub,
            data: { page },
          });
          return releasePage({ ...state, approvals: await standingApprovals(tx, pub, r) }, row);
        }),
      );
    },
  );

  // ------------------------------------------------------------------------------------------ releases

  app.post(
    "/api/v1/orgs/:o/pubs/:p/editions/:e/releases",
    {
      config: { permission: "release.approve" },
      schema: { params: OneEdition, body: ReleaseInput, response: { 201: Release } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const tenant = access.tenant;
      const { p: pub, e } = request.params;
      const answer = await idempotent(
        database,
        request,
        tenant,
        async (tx) => {
          const state = await stateOf(tx, pub, e, true);
          if (!state) throw new ApiError("not_found");
          const check = preflight(state);
          const failed = check.items.filter((item) => item.state === "failed");
          if (failed.length > 0) {
            throw new ApiError(
              "release_refused",
              failed.map((item) => ({
                field: `preflight.${item.check}`,
                message: item.pages.length > 0 ? `Not passed on pages ${item.pages.join(", ")}.` : "Not passed.",
              })),
            );
          }
          const want = candidate(state);
          const run = state.run;
          if (!want || !run) {
            throw new ApiError("release_refused", [
              { field: "nothing_to_release", message: "No page changed since the last release." },
            ]);
          }
          if (want.kind === "correction" && !may(access, pub, "release.correct"))
            throw refused("a correction needs release.correct");
          if (!sameFiles(request.body.files, want)) throw new ApiError("approval_stale", undefined, want);

          const retainUntil = new Date(Date.now() + retainDays * DAY_MS);
          const made = await createRelease(tx, tenant, pub, {
            editionId: e,
            runId: run.id,
            kind: want.kind,
            note: request.body.note || null,
            retainUntil,
          });
          const folder = folderOf(tenant.orgId, { edition_id: e, id: made.id }, pub);
          // shortcut: the archive is written inside the transaction, so a rollback after it leaves locked orphans in
          // the archive bucket (never named by any row); a cleanup would need the governance bypass, which the API
          // must never hold. Acceptable while releases are a few a night.
          for (const file of want.files) {
            const page = state.pages.find((p) => p.page_no === file.page);
            if (!page?.pdf) throw new Error("a candidate's page has no PDF");
            let body: Buffer;
            const pdf = page.pdf;
            try {
              body = await readWhole(() => store.read(pdf.key, pdf.version_id));
            } catch (error) {
              request.log.error({ err: error, key: pdf.key }, "the page PDF could not be read");
              throw new ApiError("archive_failed");
            }
            if (sha256(body) !== file.sha256) {
              // the work bucket's version is not the bytes recorded: a fault of the store or of the save, not the archive
              request.log.error(
                { key: pdf.key, run: run.id, page: file.page, want: file.sha256, got: sha256(body) },
                "the page PDF in the work bucket is not the bytes approved",
              );
              throw new ApiError("archive_failed");
            }
            const key = `${folder}pages/${file.name}`;
            const stored = await archive(request.log, key, body, "application/pdf", retainUntil);
            await addReleaseFile(tx, tenant, pub, made.id, {
              page_no: file.page,
              name: file.name,
              rev: file.rev,
              sha256: file.sha256,
              bytes: body.length,
              archive_key: key,
              archive_version_id: stored.versionId,
              replaces: file.replaces,
            });
          }
          const manifest = Buffer.from(
            JSON.stringify({
              format: "pageinator.release/1",
              edition: { id: e, deskKey: state.edition.desk_key },
              release: { id: made.id, number: made.number, kind: want.kind },
              run: { id: run.id, deskKey: run.desk_key },
              approvedBy: tenant.userId,
              checkerSha256: run.checker_sha256,
              files: want.files.map((f) => ({
                name: f.name,
                page: f.page,
                rev: f.rev,
                sha256: f.sha256,
                bytes: f.bytes,
              })),
              preflight: check.items.map((item) => ({ check: item.check, state: item.state })),
            }),
            "utf8",
          );
          const manifestKey = `${folder}manifest.json`;
          const written = await archive(request.log, manifestKey, manifest, "application/json", retainUntil);
          await setManifest(tx, pub, made.id, { key: manifestKey, ...written });
          if (made.number === 1) await markEditionReleased(tx, pub, e);
          await recordAudit(tx, tenant, {
            action: "release.create",
            targetType: "release",
            targetId: made.id,
            publicationId: pub,
            data: { edition: e, number: made.number, kind: want.kind, files: want.files.length },
          });
          return { status: 201, body: await releaseNow(tx, pub, made.id), stored: { releaseId: made.id } };
        },
        (stored, tx) => releaseView(tx, pub, (stored as { releaseId: string }).releaseId),
      );
      return reply.status(201).send(answer.body as Release);
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/releases/:id/files/:name",
    { config: { permission: "export.press" }, schema: { params: OneFile, response: { 200: FileLink } } },
    async (request) => {
      const { p: pub, id, name } = request.params;
      const file = await database.withTenant(accessOf(request).tenant, async (tx) =>
        UUID.test(id) ? (await releaseFiles(tx, pub, [id])).find((f) => f.name === name) : undefined,
      );
      if (!file) throw new ApiError("not_found");
      const url = await store.archivePresignGet({
        key: file.archive_key,
        versionId: file.archive_version_id,
        contentType: "application/pdf",
        disposition: `attachment; filename="${file.name}"`,
        expiresSeconds: DOWNLOAD_SECONDS,
      });
      return { url, expiresAt: new Date(Date.now() + DOWNLOAD_SECONDS * 1000).toISOString() };
    },
  );

  /** The release (locked), or 404. */
  async function lockedRelease(tx: Tx, pub: string, id: string) {
    const release = UUID.test(id) ? await findRelease(tx, pub, id, true) : undefined;
    if (!release) throw new ApiError("not_found");
    return release;
  }

  app.post(
    "/api/v1/orgs/:o/pubs/:p/releases/:id/deliveries",
    {
      config: { permission: "export.press" },
      schema: { params: OneRelease, body: DeliveryInput, response: { 200: Release } },
    },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, id } = request.params;
      return database.withTenant(tenant, async (tx) => {
        const release = await lockedRelease(tx, pub, id);
        const files = (await releaseFiles(tx, pub, [id])).map((f) => ({
          name: f.name,
          sha256: f.sha256,
          bytes: f.bytes,
        }));
        const delivery = await addDelivery(tx, tenant, pub, id, request.body.note || null, files);
        await writeReceipts(request.log, tx, tenant, pub, release);
        await recordAudit(tx, tenant, {
          action: "release.send",
          targetType: "release",
          targetId: id,
          publicationId: pub,
          data: { delivery, files: files.length },
        });
        return releaseNow(tx, pub, id);
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/releases/:id/deliveries/:d/confirm",
    {
      config: { permission: "export.press" },
      schema: { params: OneDelivery, body: ConfirmInput, response: { 200: Release } },
    },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, id, d } = request.params;
      const { pressPerson, at, note } = request.body;
      return database.withTenant(tenant, async (tx) => {
        const release = await lockedRelease(tx, pub, id);
        const sent = UUID.test(d) ? (await deliveries(tx, pub, [id])).find((row) => row.id === d) : undefined;
        if (!sent) throw new ApiError("not_found");
        if (sent.confirmed_at !== null) throw new ApiError("already_confirmed");
        // the press confirmed after it was sent, and not later than now (a minute's clock difference allowed)
        if (at !== undefined && (Date.parse(at) < sent.sent_at.getTime() || Date.parse(at) > Date.now() + 60_000)) {
          throw new ApiError("invalid_request", [
            { field: "body.at", message: "The confirmation time must be after it was sent and not in the future." },
          ]);
        }
        const done = await confirmDelivery(tx, tenant, pub, id, d, { pressPerson, at: at ?? null, note: note || null });
        if (!done) throw new ApiError("already_confirmed");
        await writeReceipts(request.log, tx, tenant, pub, release);
        await recordAudit(tx, tenant, {
          action: "release.confirm",
          targetType: "release",
          targetId: id,
          publicationId: pub,
          data: { delivery: d },
        });
        return releaseNow(tx, pub, id);
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/releases/:id/verify",
    { config: { permission: "archive.view" }, schema: { params: OneRelease, response: { 200: ArchiveCheck } } },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, id } = request.params;
      return database.withTenant(tenant, async (tx) => {
        const release = await lockedRelease(tx, pub, id);
        const wanted = (await releaseFiles(tx, pub, [id])).map((f) => ({
          name: f.name,
          sha256: f.sha256,
          key: f.archive_key,
          version: f.archive_version_id,
        }));
        if (release.manifest_key && release.manifest_version_id && release.manifest_sha256) {
          wanted.push({
            name: "manifest.json",
            sha256: release.manifest_sha256,
            key: release.manifest_key,
            version: release.manifest_version_id,
          });
        }
        const files = [];
        for (const file of wanted) {
          let ok = false;
          try {
            ok = sha256(await readWhole(() => store.archiveRead(file.key, file.version))) === file.sha256;
          } catch (error) {
            request.log.error({ err: error, key: file.key }, "an archived file could not be read");
          }
          files.push({ name: file.name, sha256: file.sha256, ok });
        }
        const ok = files.length > 1 && files.every((file) => file.ok);
        if (ok) await markVerified(tx, pub, id);
        await recordAudit(tx, tenant, {
          action: "release.verify",
          targetType: "release",
          targetId: id,
          publicationId: pub,
          data: { ok },
        });
        return { checkedAt: new Date().toISOString(), files, ok };
      });
    },
  );

  // ------------------------------------------------------------------------------------------ the G2 press test

  app.put(
    "/api/v1/orgs/:o/pubs/:p/press-test",
    {
      config: { permission: "settings.edit" },
      schema: { params: Pub, body: PressTestInput, response: { 200: PressTest } },
    },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const pub = request.params.p;
      const { pageSha256, acceptedOn, note } = request.body;
      return database.withTenant(tenant, async (tx) => {
        await setPressTest(tx, tenant, pub, { pageSha256, acceptedOn, note: note || null });
        await recordAudit(tx, tenant, {
          action: "press_test.set",
          targetType: "publication",
          targetId: pub,
          publicationId: pub,
          data: { pageSha256, acceptedOn },
        });
        const test = await pressTestOf(tx, pub);
        if (!test) throw new Error("the press test just recorded is not found");
        return test;
      });
    },
  );
};
