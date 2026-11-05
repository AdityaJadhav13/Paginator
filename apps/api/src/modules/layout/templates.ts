// The Templates screen's routes (packages/contracts/src/templates.ts), registered by layoutRoutes, under
// /api/v1/orgs/:o/pubs/:p:
//   - GET templates (templates.view): the profile in use, its template per role with the candidates its setup recorded,
//     its grid (read-only), the profile being set up (if any) and the versions, newest first.
//   - POST templates {role, page} | {} (templates.edit, Idempotency-Key): with the publication locked, none setting up
//     (409 profile_setting_up) and one in use (409 no_profile), and the page one of the role's recorded candidates (400
//     otherwise): a new profile version based on the one in use, its dataset bundle copied server side from the base's
//     pinned version to its own key, engine.setup enqueued with the base config pinned and the choice (the engine
//     re-checks the page), in one transaction → 202 EngineProfile (setting_up). The inbox settles it as any profile;
//     the newest ready one is in use, so a failed one leaves the old in use. Audit: engine_profile.retemplate.
import {
  DATASET_TYPE,
  EngineProfile,
  TEMPLATE_ROLES,
  TemplateChoiceInput,
  type TemplateCandidates,
  type TemplateCandidate,
  TemplatesView,
} from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import {
  createProfileFrom,
  enqueueEngineSetup,
  findProfile,
  listProfiles,
  profileCandidates,
  profileInUse,
  profileSettingUp,
  setProfileDataset,
} from "../../db/layout.ts";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { accessOf } from "../access/access.ts";
import { idempotent } from "../requests/idempotency.ts";
import { profileView } from "./views.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const HISTORY = 20;

type Stored = TemplateCandidates[string][number];
const candidateView = (c: Stored): TemplateCandidate => ({
  name: c.name,
  date: c.date || null,
  page: c.page,
  outline: {
    pageWMm: c.outline.page_w_mm,
    pageHMm: c.outline.page_h_mm,
    news: c.outline.news,
    kept: c.outline.kept,
    adSlots: c.outline.ad_slots,
  },
});

export const templateRoutes: FastifyPluginAsyncZod<{ database: Database; store: ObjectStore }> = async (
  app,
  { database, store },
) => {
  app.get(
    "/api/v1/orgs/:o/pubs/:p/templates",
    { config: { permission: "templates.view" }, schema: { params: Pub, response: { 200: TemplatesView } } },
    async (request) => {
      const access = accessOf(request);
      const pub = request.params.p;
      return database.withTenant(access.tenant, async (tx) => {
        const inUse = await profileInUse(tx, pub);
        const settingUp = await profileSettingUp(tx, pub);
        const candidates = inUse ? await profileCandidates(tx, pub, inUse.id) : null;
        return {
          inUse: inUse ? { id: inUse.id, version: inUse.version } : null,
          roles: inUse
            ? TEMPLATE_ROLES.map((role) => ({
                role,
                chosen: inUse.templates?.[role] ?? null,
                candidates: (candidates?.[role] ?? []).map(candidateView),
              }))
            : [],
          candidatesKnown: candidates !== null,
          grid: inUse ? profileView(inUse).grid : null,
          settingUp: settingUp ? { id: settingUp.id, version: settingUp.version } : null,
          history: (await listProfiles(tx, pub, HISTORY)).map(profileView),
        };
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/templates",
    {
      config: { permission: "templates.edit" },
      schema: { params: Pub, body: TemplateChoiceInput, response: { 202: EngineProfile } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const { role, page } = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          if (await profileSettingUp(tx, pub, true)) throw new ApiError("profile_setting_up");
          const base = await profileInUse(tx, pub);
          if (!base) throw new ApiError("no_profile");
          if (!base.dataset_version_id || !base.config_version_id || !base.config_sha256)
            throw new Error("a ready profile has no pinned dataset or config");
          if (role !== undefined && page !== undefined) {
            const candidates = await profileCandidates(tx, pub, base.id);
            if (!(candidates?.[role] ?? []).some((c) => c.name === page))
              throw new ApiError("invalid_request", [
                { field: "body.page", message: "This page of the dataset cannot serve as that template." },
              ]);
          }
          const choice = role !== undefined && page !== undefined ? { [role]: page } : {};
          const made = await createProfileFrom(tx, access.tenant, pub, base, choice);
          const copied = await store.copy({
            from: base.dataset_key,
            fromVersion: base.dataset_version_id,
            to: made.dataset_key,
            contentType: DATASET_TYPE,
            metadata: { sha256: base.dataset_sha256 },
          });
          await setProfileDataset(tx, pub, made.id, copied.versionId);
          // the setup commits with the profile, or neither does
          await enqueueEngineSetup(tx, {
            org_id: access.tenant.orgId,
            pub_id: pub,
            profile_id: made.id,
            version_id: copied.versionId,
            sha256: base.dataset_sha256,
            base_profile_id: base.id,
            base_config_version_id: base.config_version_id,
            base_config_sha256: base.config_sha256,
            ...(role !== undefined && page !== undefined ? { template_role: role, template_page: page } : {}),
          });
          await recordAudit(tx, access.tenant, {
            action: "engine_profile.retemplate",
            targetType: "engine_profile",
            targetId: made.id,
            publicationId: pub,
            data: { profile: made.id, basedOn: base.id, version: made.version, role: role ?? null, page: page ?? null },
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
      return reply.status(202).send(answer.body as EngineProfile);
    },
  );
};
