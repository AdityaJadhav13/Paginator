// Hosted layout's routes (docs/product/10-l2-newsroom-plan.md §1 L2.3; packages/contracts/src/layout.ts), under
// /api/v1/orgs/:o/pubs/:p:
//   - GET engine-profiles (settings.view): newest first, at most 20, and the one in use (the newest ready).
//   - POST engine-profiles {uploadId} (settings.edit, Idempotency-Key): the person's own dataset bundle upload (purpose
//     engine_dataset) is read once, outside any transaction (up to 4 GiB): its size as declared, a ZIP's first bytes,
//     its SHA-256. Then, in one transaction: the profile made (the next version), the bundle copied out of quarantine to
//     profiles/<id>/dataset.zip (its version kept), the engine's setup enqueued (engine.setup), the upload completed →
//     202 EngineProfile (setting_up). The engine's inbox settles it (src/modules/layout/inbox.ts).
//   - GET editions/:e/layout (pages.view): the edition's readiness against the profile in use's plan, its back-page ad
//     slots, and its active, last and newest done runs (src/modules/layout/request.ts).
//   - PUT editions/:e/ads/:slot {assetId} (layout.generate or ads.manage): a ready picture of the media library fitted
//     into a slot of the plan (media.ad enqueued with it; the slot's artwork row is the job's target) → AdSlot. The same
//     picture again changes nothing. DELETE …/ads/:slot → 204 (a job still running for it is then ignored). Both
//     refuse a slot that holds a booking of the ads desk (409 slot_booked: its artwork follows the booking).
//   - POST editions/:e/runs (layout.generate, Idempotency-Key) → 202 LayoutRun (queued): with the edition locked, one
//     active run an edition (409 run_active, its current run), a profile ready, at least one Ready story and no blocker
//     (409 layout_refused, saying what); then the frozen request (the Desk's shape, request.ts) written to
//     runs/<run>/request.json, its version and SHA-256 kept on the run, engine.layout enqueued, and every running measure
//     told to stop (a layout comes first), in one transaction. Its Desk id is r-YYYYMMDD-HHMMSS in the publication's time
//     (a second later when the edition has that one).
//   - GET runs/:r (pages.view) → LayoutRun. POST runs/:r/cancel (layout.generate) → LayoutRun, cancelled at once (its
//     job removed, or a running one stopped: app.cancel_engine_job); 409 run_finished once it ended.
//   - GET runs/:r/files/:name → FileLink, a link to that exact version for 5 minutes: previews and the check's report
//     (pages.view), a page PDF and edition.pdf (proof.view), press-files.zip (export.press); only a done run's, but a
//     page's previews while its run goes on.
import { createHash } from "node:crypto";
import {
  AdSlot,
  AdSlotInput,
  DATASET_TYPE,
  EditionLayout,
  EngineProfile,
  EngineProfileInput,
  EngineProfileList,
  FileLink,
  LayoutRun,
  MAX_DATASET_BYTES,
  type Permission,
  RUN_FILE,
  reach,
} from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { bookingInSlot } from "../../db/ads.ts";
import { recordAudit } from "../../db/audit.ts";
import {
  ACTIVE_STATES,
  cancelEngineJob,
  clearArtwork,
  completeUploadAsProfile,
  createProfile,
  createRun,
  editionArtwork,
  editionRuns,
  enqueueEngineLayout,
  enqueueEngineSetup,
  enqueueMediaAd,
  findProfile,
  findRun,
  layoutEdition,
  layoutStories,
  listProfiles,
  measureOf,
  newRunKey,
  profileInUse,
  runPages,
  type RunRow,
  setArtwork,
  setProfileDataset,
  setRunRequest,
  updateRun,
} from "../../db/layout.ts";
import { findAsset, findUpload } from "../../db/media.ts";
import type { Database } from "../../db/pools.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { type Access, accessOf, actorOf, auditRefusals, refused } from "../access/access.ts";
import { DOWNLOAD_SECONDS } from "../media/photos.ts";
import { idempotent } from "../requests/idempotency.ts";
import { LAID_OUT, blockerOf, frozenRequest, planFor, readiness, slotsOf } from "./request.ts";
import { CANCELLED, CANCELLED_BEFORE, profileView, runViews } from "./views.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZIP = Buffer.from("PK\x03\x04", "latin1");
export const PROFILES_SHOWN = 20;

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneEdition = z.strictObject({ o: z.string(), p: z.string(), e: z.string() });
const OneSlot = z.strictObject({ o: z.string(), p: z.string(), e: z.string(), slot: z.string() });
const OneRun = z.strictObject({ o: z.string(), p: z.string(), r: z.string() });
const OneFile = z.strictObject({ o: z.string(), p: z.string(), r: z.string(), name: z.string() });

export type LayoutOptions = { database: Database; store: ObjectStore };

const may = (access: Access, pub: string, permission: Permission) =>
  reach(permission, access.orgRole, access.publications.get(pub) ?? { roles: [], grants: [] }) !== null;

/** The run as the routes answer it (its pages and stories read). */
export async function runView(tx: Tx, pub: string, run: RunRow): Promise<LayoutRun> {
  const [view] = await runViews(tx, pub, [run], await runPages(tx, pub, [run.id]));
  if (!view) throw new Error("the run has no view");
  return view;
}

/** The upload's one version, read once: its SHA-256, its length and its first bytes. */
async function readDataset(store: ObjectStore, key: string, versionId: string) {
  const hash = createHash("sha256");
  let head = Buffer.alloc(0);
  let bytes = 0;
  for await (const chunk of await store.read(key, versionId)) {
    bytes += chunk.length;
    if (bytes > MAX_DATASET_BYTES) break;
    hash.update(chunk);
    if (head.length < ZIP.length) head = Buffer.concat([head, chunk]).subarray(0, ZIP.length);
  }
  return { sha256: hash.digest("hex"), bytes, head };
}

const notDataset = (message: string) => new ApiError("invalid_request", [{ field: "body.uploadId", message }]);

export const layoutRoutes: FastifyPluginAsyncZod<LayoutOptions> = async (app, { database, store }) => {
  auditRefusals(app, database);

  // ------------------------------------------------------------------------------------------ engine profiles

  app.get(
    "/api/v1/orgs/:o/pubs/:p/engine-profiles",
    { config: { permission: "settings.view" }, schema: { params: Pub, response: { 200: EngineProfileList } } },
    async (request) => {
      const access = accessOf(request);
      const pub = request.params.p;
      return database.withTenant(access.tenant, async (tx) => {
        const rows = await listProfiles(tx, pub, PROFILES_SHOWN);
        const inUse = await profileInUse(tx, pub);
        return { items: rows.map(profileView), inUse: inUse?.id ?? null };
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/engine-profiles",
    {
      config: { permission: "settings.edit" },
      schema: { params: Pub, body: EngineProfileInput, response: { 202: EngineProfile } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const pub = request.params.p;
      const { uploadId } = request.body;
      const upload = await database.withTenant(access.tenant, (tx) => findUpload(tx, pub, uploadId));
      // someone else's upload, or not a dataset bundle: the same answer as none at all
      if (!upload || upload.user_id !== userId || upload.purpose !== "engine_dataset") throw new ApiError("not_found");
      // read once, outside the transaction (up to 4 GiB); a completed upload is its profile's already (a replay)
      let read: { sha256: string; bytes: number; version: string } | null = null;
      if (upload.status === "presigned") {
        const arrived = await store.head(upload.key);
        if (!arrived) throw notDataset("The file has not arrived yet.");
        const version = arrived.versionId;
        if (!version) throw new Error("The work bucket gave the upload no version: its versioning must be Enabled.");
        const got = await readDataset(store, upload.key, version);
        if (got.bytes !== upload.declared_bytes || arrived.bytes !== upload.declared_bytes)
          throw notDataset(`The file is not the ${upload.declared_bytes} bytes the upload said.`);
        if (!got.head.equals(ZIP)) throw notDataset("This is not a ZIP file: the dataset bundle is a .zip file.");
        read = { sha256: got.sha256, bytes: got.bytes, version };
      }
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const locked = await findUpload(tx, pub, uploadId, true);
          if (!locked) throw new ApiError("not_found");
          if (locked.status === "completed" && locked.engine_profile_id) {
            const made = await findProfile(tx, pub, locked.engine_profile_id);
            if (!made) throw new ApiError("not_found");
            return { status: 202, body: profileView(made), stored: { profileId: made.id } };
          }
          if (locked.status !== "presigned" || !read) throw notDataset("This upload cannot be used any more.");
          const made = await createProfile(tx, access.tenant, pub, {
            uploadId,
            sha256: read.sha256,
            bytes: read.bytes,
          });
          const copied = await store.copy({
            from: upload.key,
            fromVersion: read.version,
            to: made.dataset_key,
            contentType: DATASET_TYPE,
            metadata: { sha256: read.sha256 },
          });
          await setProfileDataset(tx, pub, made.id, copied.versionId);
          // the setup commits with the profile, or neither does
          await enqueueEngineSetup(tx, {
            org_id: access.tenant.orgId,
            pub_id: pub,
            profile_id: made.id,
            version_id: copied.versionId,
            sha256: read.sha256,
          });
          await completeUploadAsProfile(tx, pub, uploadId, made.id);
          await recordAudit(tx, access.tenant, {
            action: "engine_profile.create",
            targetType: "engine_profile",
            targetId: made.id,
            publicationId: pub,
            data: { upload: uploadId, bytes: read.bytes, version: made.version },
          });
          const row = await findProfile(tx, pub, made.id);
          if (!row) throw new Error("the profile just made is not found");
          return { status: 202, body: profileView(row), stored: { profileId: made.id } };
        },
        async (stored, tx) => {
          const row = await findProfile(tx, pub, (stored as { profileId: string }).profileId);
          return row ? profileView(row) : null;
        },
      );
      await store.removeAll(upload.key).catch(() => undefined); // the lifecycle rule would, within two days
      return reply.status(202).send(answer.body as EngineProfile);
    },
  );

  // ------------------------------------------------------------------------------------------ an edition's layout

  app.get(
    "/api/v1/orgs/:o/pubs/:p/editions/:e/layout",
    { config: { permission: "pages.view" }, schema: { params: OneEdition, response: { 200: EditionLayout } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, e } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const edition = UUID.test(e) ? await layoutEdition(tx, pub, e) : undefined;
        if (!edition) throw new ApiError("not_found");
        const profile = await profileInUse(tx, pub);
        const plan = planFor(profile?.plans ?? null, edition);
        const artwork = await editionArtwork(tx, pub, e);
        const measure = await measureOf(tx, pub, e);
        const runs = await editionRuns(tx, pub, e);
        const picked = [runs.active, runs.last, runs.board].filter((run) => run !== undefined);
        const unique = [...new Map(picked.map((run) => [run.id, run])).values()];
        const views = await runViews(
          tx,
          pub,
          unique,
          await runPages(
            tx,
            pub,
            unique.map((run) => run.id),
          ),
        );
        const view = (run: RunRow | undefined) => (run ? (views.find((v) => v.id === run.id) ?? null) : null);
        return {
          editionId: e,
          profile: profile ? { id: profile.id, version: profile.version } : null,
          readiness: profile
            ? readiness(
                plan,
                edition,
                await layoutStories(tx, pub, e),
                measure ? { state: measure.state, measured: measure.measured, total: measure.total } : null,
              )
            : null,
          slots: slotsOf(plan, artwork),
          active: view(runs.active),
          last: view(runs.last),
          board: view(runs.board),
        };
      });
    },
  );

  const slotAccess = (access: Access, pub: string) => {
    if (!may(access, pub, "layout.generate") && !may(access, pub, "ads.manage"))
      throw refused("an ad slot is set by layout.generate or ads.manage");
  };

  /** The edition, the plan of the profile in use, and the slot of it (404 when the plan has no such slot). */
  async function slotOf(tx: Tx, pub: string, e: string, slot: string) {
    // locked: a placement of the ads desk (which locks the edition) cannot slip in between the check and the change
    const edition = UUID.test(e) ? await layoutEdition(tx, pub, e, true) : undefined;
    if (!edition) throw new ApiError("not_found");
    const profile = await profileInUse(tx, pub);
    if (!profile) throw new ApiError("no_profile");
    const plan = planFor(profile.plans, edition);
    const found = slotsOf(plan, await editionArtwork(tx, pub, e)).find((s) => s.slot === slot);
    if (!found) throw new ApiError("not_found");
    return found;
  }

  app.put(
    "/api/v1/orgs/:o/pubs/:p/editions/:e/ads/:slot",
    {
      config: { permission: "pages.view" },
      schema: { params: OneSlot, body: AdSlotInput, response: { 200: AdSlot } },
    },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, e, slot } = request.params;
      slotAccess(access, pub);
      const { assetId } = request.body;
      return database.withTenant(access.tenant, async (tx) => {
        const found = await slotOf(tx, pub, e, slot);
        if (await bookingInSlot(tx, pub, e, slot)) throw new ApiError("slot_booked");
        const asset = await findAsset(tx, pub, assetId, "share");
        if (!asset) throw new ApiError("not_found");
        if (asset.status !== "ready" || !asset.version_id) {
          throw new ApiError("invalid_request", [
            { field: "body.assetId", message: "This picture is not ready for print yet, or was refused." },
          ]);
        }
        // the same picture again: nothing to make
        if (found.assetId === assetId && found.state !== "failed") return found;
        const wMm = found.wMm.toFixed(2);
        const hMm = found.hMm.toFixed(2);
        const artworkId = await setArtwork(tx, access.tenant, pub, { editionId: e, slot, assetId, wMm, hMm });
        await enqueueMediaAd(tx, {
          org_id: access.tenant.orgId,
          pub_id: pub,
          artwork_id: artworkId,
          asset_id: assetId,
          version_id: asset.version_id,
          sha256: asset.sha256,
          w_mm: wMm,
          h_mm: hMm,
        });
        await recordAudit(tx, access.tenant, {
          action: "ad_slot.set",
          targetType: "edition",
          targetId: e,
          publicationId: pub,
          data: { slot, asset: assetId },
        });
        return { ...found, state: "preparing" as const, assetId, problem: null };
      });
    },
  );

  app.delete(
    "/api/v1/orgs/:o/pubs/:p/editions/:e/ads/:slot",
    { config: { permission: "pages.view" }, schema: { params: OneSlot } },
    async (request, reply) => {
      const access = accessOf(request);
      const { p: pub, e, slot } = request.params;
      slotAccess(access, pub);
      await database.withTenant(access.tenant, async (tx) => {
        const edition = UUID.test(e) ? await layoutEdition(tx, pub, e, true) : undefined;
        if (!edition) throw new ApiError("not_found");
        if (await bookingInSlot(tx, pub, e, slot)) throw new ApiError("slot_booked");
        const gone = await clearArtwork(tx, pub, e, slot);
        if (!gone) return;
        await recordAudit(tx, access.tenant, {
          action: "ad_slot.clear",
          targetType: "edition",
          targetId: e,
          publicationId: pub,
          data: { slot },
        });
      });
      return reply.status(204).send();
    },
  );

  // ------------------------------------------------------------------------------------------ runs

  app.post(
    "/api/v1/orgs/:o/pubs/:p/editions/:e/runs",
    { config: { permission: "layout.generate" }, schema: { params: OneEdition, response: { 202: LayoutRun } } },
    async (request, reply) => {
      const access = accessOf(request);
      const { p: pub, e } = request.params;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const edition = UUID.test(e) ? await layoutEdition(tx, pub, e, true) : undefined;
          if (!edition) throw new ApiError("not_found");
          const { active } = await editionRuns(tx, pub, e);
          if (active) throw new ApiError("run_active", undefined, await runView(tx, pub, active));
          const profile = await profileInUse(tx, pub);
          const plan = planFor(profile?.plans ?? null, edition);
          const refuse = (field: string, message: string, current?: unknown) =>
            new ApiError("layout_refused", [{ field, message }], current);
          if (!profile || !profile.dataset_version_id || !profile.config_version_id || !profile.config_sha256)
            throw refuse("profile", "This paper has no engine profile ready yet.");
          if (!plan) throw refuse("profile", `The engine profile has no plan for ${edition.pages} pages.`);
          const stories = await layoutStories(tx, pub, e);
          const laid = stories.filter((story) => LAID_OUT.has(story.status));
          if (laid.length === 0) throw refuse("stories", "This edition has no Ready story yet.");
          const blockers = laid.flatMap((story) => blockerOf(story, edition.pages) ?? []);
          if (blockers.length > 0) {
            throw new ApiError(
              "layout_refused",
              blockers.slice(0, 20).map((b) => ({ field: `stories.${b.storyId ?? b.deskKey}`, message: b.message })),
              { blockers },
            );
          }
          const deskKey = await newRunKey(tx, pub, e, edition.timezone);
          const run = await createRun(tx, access.tenant, pub, {
            editionId: e,
            deskKey,
            profileId: profile.id,
            engineVersion: profile.engine_version,
          });
          const doc = frozenRequest(edition, stories, plan, await editionArtwork(tx, pub, e));
          const body = Buffer.from(JSON.stringify(doc), "utf8");
          const sha256 = createHash("sha256").update(body).digest("hex");
          const put = await store.put({
            key: run.request_key,
            body,
            contentType: "application/json",
            metadata: { sha256 },
          });
          const ads = Object.fromEntries(Object.entries(doc.ads).map(([slot, ad]) => [slot, ad.raster.sha256]));
          await setRunRequest(tx, pub, run.id, put.versionId, sha256, ads);
          await enqueueEngineLayout(tx, {
            org_id: access.tenant.orgId,
            pub_id: pub,
            run_id: run.id,
            edition_key: edition.desk_key,
            run_key: deskKey,
            version_id: put.versionId,
            sha256,
            profile_id: profile.id,
            dataset_version_id: profile.dataset_version_id,
            dataset_sha256: profile.dataset_sha256,
            config_version_id: profile.config_version_id,
            config_sha256: profile.config_sha256,
          });
          // a layout comes first: a measure running now stops (its finished measurements stay in the cache)
          await cancelEngineJob(tx, access.tenant.orgId, "measure:*");
          await recordAudit(tx, access.tenant, {
            action: "layout.run_create",
            targetType: "layout_run",
            targetId: run.id,
            publicationId: pub,
            data: {
              edition: e,
              deskKey,
              stories: doc.articles.length,
              ads: Object.keys(doc.ads).length,
              profile: profile.id,
            },
          });
          const made = await findRun(tx, pub, run.id);
          if (!made) throw new Error("the run just made is not found");
          return { status: 202, body: await runView(tx, pub, made), stored: { runId: run.id } };
        },
        async (stored, tx) => {
          const run = await findRun(tx, pub, (stored as { runId: string }).runId);
          return run ? runView(tx, pub, run) : null;
        },
      );
      return reply.status(202).send(answer.body as LayoutRun);
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/runs/:r",
    { config: { permission: "pages.view" }, schema: { params: OneRun, response: { 200: LayoutRun } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, r } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const run = UUID.test(r) ? await findRun(tx, pub, r) : undefined;
        if (!run) throw new ApiError("not_found");
        return runView(tx, pub, run);
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/cancel",
    { config: { permission: "layout.generate" }, schema: { params: OneRun, response: { 200: LayoutRun } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, r } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const run = UUID.test(r) ? await findRun(tx, pub, r, true) : undefined;
        if (!run) throw new ApiError("not_found");
        if (!ACTIVE_STATES.includes(run.state))
          throw new ApiError("run_finished", undefined, await runView(tx, pub, run));
        const message = run.state === "queued" ? CANCELLED_BEFORE : CANCELLED;
        await updateRun(tx, pub, run.id, { state: "cancelled", finished: true, message });
        await tx
          .updateTable("app.run_page")
          .set({ state: "cancelled" })
          .where("publication_id", "=", pub)
          .where("run_id", "=", run.id)
          .where("state", "in", ["waiting", "working"])
          .execute();
        await cancelEngineJob(tx, access.tenant.orgId, `run:${run.id}`);
        await recordAudit(tx, access.tenant, {
          action: "layout.run_cancel",
          targetType: "layout_run",
          targetId: run.id,
          publicationId: pub,
          data: { from: run.state },
        });
        const now = await findRun(tx, pub, run.id);
        if (!now) throw new Error("the run just cancelled is not found");
        return runView(tx, pub, now);
      });
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/files/:name",
    { config: { permission: "pages.view" }, schema: { params: OneFile, response: { 200: FileLink } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, r, name } = request.params;
      const match = RUN_FILE.exec(name);
      if (!match || !UUID.test(r)) throw new ApiError("not_found");
      const kind = match[3] as "pdf" | "png" | "thumb.png" | "pdfx-check.txt" | undefined;
      const needs: Permission =
        name === "press-files.zip"
          ? "export.press"
          : name === "edition.pdf" || kind === "pdf"
            ? "proof.view"
            : "pages.view";
      if (!may(access, pub, needs)) throw refused(`${name} needs ${needs}`);
      const file = await database.withTenant(access.tenant, async (tx) => {
        const run = await findRun(tx, pub, r);
        if (!run) return undefined;
        const done = run.state === "done";
        if (name === "edition.pdf") return done ? run.edition_pdf : null;
        if (name === "press-files.zip") return done ? run.press_zip : null;
        const page = (await runPages(tx, pub, [run.id])).find((row) => row.page_no === Number(match[2]));
        if (!page) return null;
        // a page's previews while its run goes on; everything else once the run is done
        const preview = kind === "png" || kind === "thumb.png";
        if (!done && !(preview && ACTIVE_STATES.includes(run.state) && page.state === "done")) return null;
        return kind === "pdf" ? page.pdf : kind === "png" ? page.png : kind === "thumb.png" ? page.thumb : page.report;
      });
      if (!file) throw new ApiError("not_found");
      const type = name.endsWith(".pdf")
        ? "application/pdf"
        : name.endsWith(".zip")
          ? "application/zip"
          : name.endsWith(".png")
            ? "image/png"
            : "text/plain; charset=utf-8";
      const expires = new Date(Date.now() + DOWNLOAD_SECONDS * 1000);
      const url = await store.presignGet({
        key: file.key,
        versionId: file.version_id,
        contentType: type,
        disposition: `${name.endsWith(".png") ? "inline" : "attachment"}; filename="${name}"`,
        expiresSeconds: DOWNLOAD_SECONDS,
      });
      return { url, expiresAt: expires.toISOString() };
    },
  );
};
