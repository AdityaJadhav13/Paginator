// Onboarding a new paper's routes (packages/contracts/src/onboard.ts; docs/product/09-launch-plan.md §L4), under
// /api/v1/orgs/:o/pubs/:p:
//   - GET onboarding (settings.view) → OnboardingView: the newest, and at most 10 earlier ones.
//   - POST onboarding {uploadIds, permission: true} (settings.edit, Idempotency-Key): each upload the person's own past
//     edition (purpose onboard_pdf), each different; one active a publication (409 onboarding_active, checked before
//     the reading and again with the publication locked). Each PDF is read once, outside any transaction: its size as
//     declared, "%PDF-" first, its SHA-256. Then, in one transaction: the onboarding made, each PDF copied out of
//     quarantine to onboarding/<id>/pdfs/NN.pdf (its version kept), inputs.json (OnboardInputs) written and pinned, the
//     uploads completed, engine.onboard enqueued with the inputs' version and SHA-256 → 202 Onboarding (queued). The
//     engine's inbox moves it on (inbox.ts).
//   - POST onboarding/:id/cancel (settings.edit) → Onboarding, cancelled at once (its job removed, or a running one
//     stopped: app.cancel_engine_job); 409 onboarding_finished once it ended.
//   - POST onboarding/:id/use (settings.edit, Idempotency-Key) → 202 EngineProfile (setting_up): with the publication
//     locked and none setting up (409 profile_setting_up), a ready onboarding's bundle (409 onboarding_not_ready
//     otherwise) copied server side to a new profile's profiles/<new>/dataset.zip, and engine.setup enqueued exactly as
//     POST engine-profiles does; the onboarding used.
//   - POST onboarding/test-edition (layout.generate, Idempotency-Key) → 201 TestEditionMade: with a profile ready (409
//     no_profile), a 4-page edition without back-page ads on the first free date back from 2099-12-31, holding the
//     fictional sample stories (sample-stories.ts) in the publication's primary language, each Ready, so "Make layout"
//     can run on it.
// Audit: onboarding.start, onboarding.cancel, onboarding.use, onboarding.test_edition (and the stories' and edition's
// own); refusals by auditRefusals.
import { createHash } from "node:crypto";
import {
  DATASET_TYPE,
  EngineProfile,
  MAX_ONBOARD_PDF_BYTES,
  ONBOARD_INPUTS_FORMAT,
  ONBOARD_PDF_TYPE,
  Onboarding,
  OnboardingInput,
  OnboardingView,
  TestEditionMade,
  type OnboardInputs,
} from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import { createEdition } from "../../db/editions.ts";
import {
  cancelEngineJob,
  createProfile,
  enqueueEngineSetup,
  findProfile,
  profileInUse,
  profileSettingUp,
  setProfileDataset,
} from "../../db/layout.ts";
import { findUpload } from "../../db/media.ts";
import {
  ONBOARDING_ACTIVE,
  type OnboardFile,
  activeOnboarding,
  completeUploadsAsOnboarding,
  createOnboarding,
  enqueueEngineOnboard,
  findOnboarding,
  freeTestDate,
  listOnboardings,
  setOnboardingInputs,
  updateOnboarding,
} from "../../db/onboarding.ts";
import type { Database } from "../../db/pools.ts";
import { changeStatus, createStory, publicationOf } from "../../db/stories.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { accessOf, actorOf, auditRefusals } from "../access/access.ts";
import { profileView } from "../layout/views.ts";
import { idempotent } from "../requests/idempotency.ts";
import { sampleStoriesFor } from "./sample-stories.ts";
import { onboardingView } from "./views.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PDF = Buffer.from("%PDF-", "latin1");
export const HISTORY = 10;
const TEST_PAGES = 4;

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneOnboarding = z.strictObject({ o: z.string(), p: z.string(), id: z.string() });

export type OnboardingOptions = { database: Database; store: ObjectStore };

/** One version of an upload, read once: its SHA-256, its length and its first bytes. */
async function readPdf(store: ObjectStore, key: string, versionId: string) {
  const hash = createHash("sha256");
  let head = Buffer.alloc(0);
  let bytes = 0;
  for await (const chunk of await store.read(key, versionId)) {
    bytes += chunk.length;
    if (bytes > MAX_ONBOARD_PDF_BYTES) break;
    hash.update(chunk);
    if (head.length < PDF.length) head = Buffer.concat([head, chunk]).subarray(0, PDF.length);
  }
  return { sha256: hash.digest("hex"), bytes, head };
}

const notPdf = (i: number, message: string) =>
  new ApiError("invalid_request", [{ field: `body.uploadIds.${i}`, message }]);

export const onboardingRoutes: FastifyPluginAsyncZod<OnboardingOptions> = async (app, { database, store }) => {
  auditRefusals(app, database);

  app.get(
    "/api/v1/orgs/:o/pubs/:p/onboarding",
    { config: { permission: "settings.view" }, schema: { params: Pub, response: { 200: OnboardingView } } },
    async (request) => {
      const access = accessOf(request);
      return database.withTenant(access.tenant, async (tx) => {
        const [current, ...history] = (await listOnboardings(tx, request.params.p, HISTORY + 1)).map(onboardingView);
        return { current: current ?? null, history };
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/onboarding",
    {
      config: { permission: "settings.edit" },
      schema: { params: Pub, body: OnboardingInput, response: { 202: Onboarding } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const pub = request.params.p;
      const { uploadIds } = request.body;
      if (new Set(uploadIds).size !== uploadIds.length)
        throw new ApiError("invalid_request", [{ field: "body.uploadIds", message: "A file is named twice." }]);
      const uploads = await database.withTenant(access.tenant, async (tx) => {
        const found = [];
        for (const id of uploadIds) found.push(await findUpload(tx, pub, id));
        return found;
      });
      // someone else's upload, or not a past edition's PDF: the same answer as none at all
      if (uploads.some((u) => !u || u.user_id !== userId || u.purpose !== "onboard_pdf"))
        throw new ApiError("not_found");
      const own = uploads as NonNullable<(typeof uploads)[number]>[];
      // a replay (every upload completed into one onboarding) answers it; otherwise one at a time, before the reading
      const replay = own[0]?.onboarding_id;
      if (!(replay && own.every((u) => u.status === "completed" && u.onboarding_id === replay))) {
        const active = await database.withTenant(access.tenant, (tx) => activeOnboarding(tx, pub));
        if (active) throw new ApiError("onboarding_active", undefined, onboardingView(active));
      }
      // read once, outside the transaction (up to 40 × 200 MiB)
      const read: { sha256: string; bytes: number; version: string }[] = [];
      for (const [i, upload] of own.entries()) {
        if (upload.status !== "presigned") continue;
        const arrived = await store.head(upload.key);
        if (!arrived) throw notPdf(i, "The file has not arrived yet.");
        const version = arrived.versionId;
        if (!version) throw new Error("The work bucket gave the upload no version: its versioning must be Enabled.");
        const got = await readPdf(store, upload.key, version);
        if (got.bytes !== upload.declared_bytes || arrived.bytes !== upload.declared_bytes)
          throw notPdf(i, `The file is not the ${upload.declared_bytes} bytes the upload said.`);
        if (!got.head.equals(PDF)) throw notPdf(i, "This is not a PDF file: send the PDF made for the press.");
        read[i] = { sha256: got.sha256, bytes: got.bytes, version };
      }
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const locked = [];
          for (const id of uploadIds) locked.push(await findUpload(tx, pub, id, true));
          const first = locked[0]?.onboarding_id;
          if (first && locked.every((u) => u?.status === "completed" && u.onboarding_id === first)) {
            const made = await findOnboarding(tx, pub, first);
            if (!made) throw new ApiError("not_found");
            return { status: 202, body: onboardingView(made), stored: { onboardingId: made.id } };
          }
          for (const [i, u] of locked.entries())
            if (u?.status !== "presigned" || !read[i]) throw notPdf(i, "This upload cannot be used any more.");
          const active = await activeOnboarding(tx, pub, true);
          if (active) throw new ApiError("onboarding_active", undefined, onboardingView(active));
          const files: OnboardFile[] = own.map((u, i) => ({
            n: i + 1,
            name: u.filename ?? `${String(i + 1).padStart(2, "0")}.pdf`,
            bytes: read[i]!.bytes,
            sha256: read[i]!.sha256,
          }));
          const made = await createOnboarding(tx, access.tenant, pub, files);
          const folder = made.inputs_key.slice(0, -"inputs.json".length);
          for (const [i, file] of files.entries()) {
            const copied = await store.copy({
              from: own[i]!.key,
              fromVersion: read[i]!.version,
              to: `${folder}pdfs/${String(file.n).padStart(2, "0")}.pdf`,
              contentType: ONBOARD_PDF_TYPE,
              metadata: { sha256: file.sha256 },
            });
            file.version_id = copied.versionId;
          }
          const inputs: OnboardInputs = {
            format: ONBOARD_INPUTS_FORMAT,
            files: files.map((f) => ({
              n: f.n,
              name: f.name,
              version_id: f.version_id!,
              sha256: f.sha256,
              bytes: f.bytes,
            })),
          };
          const body = Buffer.from(JSON.stringify(inputs), "utf8");
          const sha256 = createHash("sha256").update(body).digest("hex");
          const put = await store.put({
            key: made.inputs_key,
            body,
            contentType: "application/json",
            metadata: { sha256 },
          });
          await setOnboardingInputs(tx, pub, made.id, { files, versionId: put.versionId, sha256 });
          await completeUploadsAsOnboarding(tx, pub, uploadIds, made.id);
          // the job commits with the onboarding, or neither does
          await enqueueEngineOnboard(tx, {
            org_id: access.tenant.orgId,
            pub_id: pub,
            onboarding_id: made.id,
            version_id: put.versionId,
            sha256,
          });
          await recordAudit(tx, access.tenant, {
            action: "onboarding.start",
            targetType: "paper_onboarding",
            targetId: made.id,
            publicationId: pub,
            data: { files: files.length, bytes: files.reduce((sum, f) => sum + f.bytes, 0) },
          });
          const row = await findOnboarding(tx, pub, made.id);
          if (!row) throw new Error("the onboarding just made is not found");
          return { status: 202, body: onboardingView(row), stored: { onboardingId: made.id } };
        },
        async (stored, tx) => {
          const row = await findOnboarding(tx, pub, (stored as { onboardingId: string }).onboardingId);
          return row ? onboardingView(row) : null;
        },
      );
      // the lifecycle rule would, within two days
      for (const u of own) await store.removeAll(u.key).catch(() => undefined);
      return reply.status(202).send(answer.body as Onboarding);
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/onboarding/:id/cancel",
    { config: { permission: "settings.edit" }, schema: { params: OneOnboarding, response: { 200: Onboarding } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      return database.withTenant(access.tenant, async (tx) => {
        const row = UUID.test(id) ? await findOnboarding(tx, pub, id, true) : undefined;
        if (!row) throw new ApiError("not_found");
        if (!ONBOARDING_ACTIVE.includes(row.state))
          throw new ApiError("onboarding_finished", undefined, onboardingView(row));
        await updateOnboarding(tx, pub, id, { state: "cancelled" });
        await cancelEngineJob(tx, access.tenant.orgId, `onboard:${id}`);
        await recordAudit(tx, access.tenant, {
          action: "onboarding.cancel",
          targetType: "paper_onboarding",
          targetId: id,
          publicationId: pub,
          data: { from: row.state },
        });
        const now = await findOnboarding(tx, pub, id);
        if (!now) throw new Error("the onboarding just cancelled is not found");
        return onboardingView(now);
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/onboarding/:id/use",
    {
      config: { permission: "settings.edit" },
      schema: { params: OneOnboarding, response: { 202: EngineProfile } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const settingUp = await profileSettingUp(tx, pub, true); // the publication locked first, as createProfile
          const row = UUID.test(id) ? await findOnboarding(tx, pub, id, true) : undefined;
          if (!row) throw new ApiError("not_found");
          if (row.state !== "ready" || !row.dataset_version_id || !row.dataset_sha256 || !row.dataset_bytes)
            throw new ApiError("onboarding_not_ready");
          if (settingUp) throw new ApiError("profile_setting_up");
          const made = await createProfile(tx, access.tenant, pub, {
            onboardingId: id,
            sha256: row.dataset_sha256,
            bytes: Number(row.dataset_bytes),
          });
          const copied = await store.copy({
            from: row.dataset_key,
            fromVersion: row.dataset_version_id,
            to: made.dataset_key,
            contentType: DATASET_TYPE,
            metadata: { sha256: row.dataset_sha256 },
          });
          await setProfileDataset(tx, pub, made.id, copied.versionId);
          // the setup commits with the profile, or neither does: engine.setup's payload as POST engine-profiles makes it
          await enqueueEngineSetup(tx, {
            org_id: access.tenant.orgId,
            pub_id: pub,
            profile_id: made.id,
            version_id: copied.versionId,
            sha256: row.dataset_sha256,
          });
          await updateOnboarding(tx, pub, id, { state: "used", profileId: made.id });
          await recordAudit(tx, access.tenant, {
            action: "onboarding.use",
            targetType: "paper_onboarding",
            targetId: id,
            publicationId: pub,
            data: { profile: made.id, version: made.version },
          });
          const profile = await findProfile(tx, pub, made.id);
          if (!profile) throw new Error("the profile just made is not found");
          return { status: 202, body: profileView(profile), stored: { profileId: made.id } };
        },
        async (stored, tx) => {
          const profile = await findProfile(tx, pub, (stored as { profileId: string }).profileId);
          return profile ? profileView(profile) : null;
        },
      );
      return reply.status(202).send(answer.body as EngineProfile);
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/onboarding/test-edition",
    { config: { permission: "layout.generate" }, schema: { params: Pub, response: { 201: TestEditionMade } } },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const profile = await profileInUse(tx, pub);
          if (!profile) throw new ApiError("no_profile");
          const language = (await publicationOf(tx, pub)).primary_language;
          const date = await freeTestDate(tx, pub);
          const editionId = await createEdition(tx, access.tenant, pub, {
            date,
            pages: TEST_PAGES,
            backPageAds: false,
            volume: "",
            issue: "",
            price: "",
          });
          if (!editionId) throw new Error("the test edition's date was taken");
          await recordAudit(tx, access.tenant, {
            action: "edition.create",
            targetType: "edition",
            targetId: editionId,
            publicationId: pub,
            data: { date, pages: TEST_PAGES },
          });
          const plan = profile.plans?.find((p) => p.pages === TEST_PAGES && !p.back_page_ads);
          const stories = sampleStoriesFor(language, plan?.needs ?? null);
          for (const s of stories) {
            const storyId = await createStory(tx, access.tenant, pub, {
              headline: s.headline,
              kicker: s.kicker,
              deck: "",
              byline: s.byline,
              body: s.body,
              language,
              sectionId: null,
              priority: s.priority,
              pagePin: null,
              editionId,
              deskNote: "",
              origin: "typed",
            });
            await changeStatus(tx, access.tenant, pub, storyId, "draft", "ready", null);
          }
          await recordAudit(tx, access.tenant, {
            action: "onboarding.test_edition",
            targetType: "edition",
            targetId: editionId,
            publicationId: pub,
            data: { edition: editionId, date, stories: stories.length, language },
          });
          const body = { editionId, stories: stories.length };
          return { status: 201, body, stored: body };
        },
        async (stored) => stored,
      );
      return reply.status(201).send(answer.body as TestEditionMade);
    },
  );
};
