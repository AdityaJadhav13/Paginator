// The news finder's API (docs/product/13-news-finder.md, L2.7), under /api/v1/orgs/:o/pubs/:p/news. The desk (story.assign:
// Chief Editor, Editor, Sub-editor; Owner and Admin) reads the topics and picks them; the source list, the house style
// and "collect now" are the Chief Editor's (settings.edit).
//   - GET …/news/sources (story.assign); POST …/news/sources, PATCH and DELETE …/news/sources/:id (settings.edit),
//     audited (news.source_create, news.source_edit with the fields changed, news.source_delete).
//   - GET …/news/settings (story.assign): the house style, the interval, the last collection, the AI part's state and
//     its spend today and this month (Asia/Kolkata) against the day's cap (PGN_AI_DAILY_CAP_INR), and whether this
//     person may change them. PATCH (settings.edit), audited (news.settings_edit: which fields, never the style's text).
//   - POST …/news/collect (settings.edit) → 202 {runId}: the feeds collected now, whatever the schedule says.
//   - GET …/news/topics?language= (story.assign): the last NEWS_KEEP_DAYS days' topics, by distinct sources × recency;
//     GET …/news/topics/:t with its items.
//   - POST …/news/topics/:t/pick {language, length, findPhoto} (story.assign; Idempotency-Key) → 202 {draftId}: the
//     draft asked of the queue (news.draft) with the topic's newest 12 articles, the house style and what may still be
//     spent on AI today, in one transaction with its row. Audited (news.pick).
//   - GET …/news/drafts/:d (story.view): to the person who picked it and to the desk; to anyone else, 404.
//   - POST …/news/drafts/:d/photo {index, caption?, rightsConfirmed} (story.assign, and media.upload's reach) → 201
//     {assetId}: the photo offered at that index downloaded through the engine queue's guard (safeFetch: public
//     addresses only, 40 MiB, pictures only), checked as an upload is (picture.ts), stored as a new asset's original
//     (orgs/<org>/pubs/<pub>/assets/<asset>/original, its version kept, the SHA-256 in its metadata; the publication's
//     asset with those bytes if it has one), its print versions enqueued (media.ingest) as an upload's are, with the
//     caption, credit, photographer, source, licence and label, and made the story's photo. A Needs-permission photo
//     needs rightsConfirmed (else 422 rights_needed), which ticks "We have the right to print this" (by, at). Audited
//     (news.photo_choose; asset.rights_confirm when ticked; the story's photo.attach or photo.replace).
import { createHash } from "node:crypto";
import {
  BIG_IMPORTANCE,
  BIG_SOURCES,
  MAX_PICTURE_BYTES,
  NewsDraft,
  NewsPhotoChoice,
  NewsPhotoChosen,
  NewsPick,
  NewsPickAccepted,
  NewsSettings,
  NewsSettingsPatch,
  NewsSource,
  NewsSourceInput,
  NewsSourceList,
  NewsSourcePatch,
  NewsTopic,
  NewsTopicList,
  NewsTopicQuery,
  PICTURE_TYPES,
  reach,
} from "@pageinator/contracts";
import { FetchRefused, licenceLabel, NEWS_USER_AGENT, safeFetch } from "@pageinator/engine-queue";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import {
  assetWithBytes,
  confirmRights,
  createAsset,
  enqueueMediaIngest,
  findAsset,
  setAssetVersion,
  setFoundPhoto,
} from "../../db/media.ts";
import {
  type DraftRow,
  type ItemRow,
  type SourceRow,
  type TopicRow,
  budget,
  createDraft,
  createSource,
  deleteSource,
  enqueueCollect,
  findDraft,
  findSettings,
  listSources,
  listTopics,
  saveSettings,
  setChosenPhoto,
  spend,
  topicItems,
  updateSource,
} from "../../db/news.ts";
import type { Database } from "../../db/pools.ts";
import { lockStory, setPhoto } from "../../db/stories.ts";
import { ApiError } from "../../http/errors.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { type Access, accessOf, actorOf, auditRefusals, refused } from "../access/access.ts";
import { HEADER_BYTES, JpegScan, NotAPicture, picture } from "../media/picture.ts";
import { idempotent } from "../requests/idempotency.ts";
import { factsOf } from "../stories/routes.ts";
import { canAssign, canAttachPhoto, uploadScope } from "../stories/rules.ts";
import { cleaned } from "../stories/store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneSource = z.strictObject({ o: z.string(), p: z.string(), id: z.string() });
const OneTopic = z.strictObject({ o: z.string(), p: z.string(), t: z.string() });
const OneDraft = z.strictObject({ o: z.string(), p: z.string(), d: z.string() });
const CollectAccepted = z.strictObject({ runId: z.uuid() });
const BASE = "/api/v1/orgs/:o/pubs/:p/news";
/** The articles a draft is written from: the topic's newest. */
const ARTICLES = 12;
const TOPICS = 300;
/** A found photo's download: the whole of it, within the time (the engine queue's guard enforces both). */
const PHOTO_TIMEOUT_MS = 60_000;

/** Downloads a found photo (an injectable seam: tests give a fake, so no test reaches the network). */
export type PhotoFetch = (url: string) => Promise<{ contentType: string; body: Buffer }>;
export const fetchPhoto: PhotoFetch = (url) =>
  safeFetch(url, {
    maxBytes: MAX_PICTURE_BYTES,
    timeoutMs: PHOTO_TIMEOUT_MS,
    accept: PICTURE_TYPES.join(", "),
    types: PICTURE_TYPES,
    userAgent: NEWS_USER_AGENT,
  });

export type NewsOptions = {
  database: Database;
  store: ObjectStore;
  /** the AI spend allowed a day per publication, in rupees (PGN_AI_DAILY_CAP_INR) */
  capInr: number;
  fetchPhoto?: PhotoFetch;
};

const onPub = (access: Access, pub: string) => access.publications.get(pub) ?? { roles: [], grants: [] };
const mayManage = (access: Access, pub: string) => reach("settings.edit", access.orgRole, onPub(access, pub)) !== null;

function sourceView(row: SourceRow): NewsSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    language: row.language,
    enabled: row.enabled,
    lastFetchAt: row.last_fetch_at?.toISOString() ?? null,
    lastError: row.last_error,
  };
}

export function topicView(row: TopicRow, items: readonly ItemRow[] = []): NewsTopic {
  return {
    id: row.id,
    titleMr: row.title_mr,
    titleEn: row.title_en,
    importance: row.importance,
    sources: row.sources,
    itemCount: row.item_count,
    languages: row.languages,
    big: row.sources.length >= BIG_SOURCES || row.importance >= BIG_IMPORTANCE,
    latestAt: row.latest_at.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      sourceId: item.source_id,
      sourceName: item.source_name,
      title: item.title,
      summary: item.summary,
      link: item.link,
      language: item.language,
      publishedAt: item.published_at?.toISOString() ?? null,
    })),
  };
}

export function draftView(row: DraftRow): NewsDraft {
  return {
    id: row.id,
    topicId: row.topic_id,
    state: row.state,
    language: row.language,
    length: row.length,
    findPhoto: row.find_photo,
    storyId: row.story_id,
    flagged: row.flagged,
    photos: row.photos,
    chosenAssetId: row.chosen_asset_id,
    error: row.problem ? { code: row.problem, message: row.message ?? "" } : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const newsRoutes: FastifyPluginAsyncZod<NewsOptions> = async (app, options) => {
  const { database, store, capInr } = options;
  const download = options.fetchPhoto ?? fetchPhoto;
  auditRefusals(app, database);

  app.get(
    `${BASE}/sources`,
    { config: { permission: "story.assign" }, schema: { params: Pub, response: { 200: NewsSourceList } } },
    async (request) => {
      const access = accessOf(request);
      const rows = await database.withTenant(access.tenant, (tx) => listSources(tx, request.params.p));
      return { items: rows.map(sourceView) };
    },
  );

  app.post(
    `${BASE}/sources`,
    {
      config: { permission: "settings.edit" },
      schema: { params: Pub, body: NewsSourceInput, response: { 201: NewsSource } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const row = await database.withTenant(access.tenant, async (tx) => {
        const made = await createSource(tx, access.tenant.orgId, pub, request.body);
        await saveSettings(tx, access.tenant.orgId, pub, {}); // the publication's settings row, for its schedule
        await recordAudit(tx, access.tenant, {
          action: "news.source_create",
          targetType: "news_source",
          targetId: made.id,
          publicationId: pub,
          data: { language: made.language, enabled: made.enabled },
        });
        return made;
      });
      return reply.status(201).send(sourceView(row));
    },
  );

  app.patch(
    `${BASE}/sources/:id`,
    {
      config: { permission: "settings.edit" },
      schema: { params: OneSource, body: NewsSourcePatch, response: { 200: NewsSource } },
    },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      if (!UUID.test(id)) throw new ApiError("not_found");
      return database.withTenant(access.tenant, async (tx) => {
        const row = await updateSource(tx, pub, id, request.body);
        if (!row) throw new ApiError("not_found");
        await recordAudit(tx, access.tenant, {
          action: "news.source_edit",
          targetType: "news_source",
          targetId: id,
          publicationId: pub,
          data: { fields: Object.keys(request.body) },
        });
        return sourceView(row);
      });
    },
  );

  app.delete(
    `${BASE}/sources/:id`,
    { config: { permission: "settings.edit" }, schema: { params: OneSource } },
    async (request, reply) => {
      const access = accessOf(request);
      const { p: pub, id } = request.params;
      await database.withTenant(access.tenant, async (tx) => {
        if (!UUID.test(id) || !(await deleteSource(tx, pub, id))) throw new ApiError("not_found");
        await recordAudit(tx, access.tenant, {
          action: "news.source_delete",
          targetType: "news_source",
          targetId: id,
          publicationId: pub,
        });
      });
      return reply.status(204).send();
    },
  );

  const settingsOf = async (access: Access, pub: string): Promise<NewsSettings> =>
    database.withTenant(access.tenant, async (tx) => {
      const row = await findSettings(tx, pub);
      const spent = await spend(tx, pub);
      return {
        houseStyle: row?.house_style ?? "",
        collectEveryHours: row?.collect_every_h ?? 3,
        lastCollectedAt: row?.collected_at?.toISOString() ?? null,
        ai: { state: row?.ai_state ?? null, spentMonthInr: spent.month, spentTodayInr: spent.today, capDayInr: capInr },
        mayManage: mayManage(access, pub),
      };
    });

  app.get(
    `${BASE}/settings`,
    { config: { permission: "story.assign" }, schema: { params: Pub, response: { 200: NewsSettings } } },
    async (request) => settingsOf(accessOf(request), request.params.p),
  );

  app.patch(
    `${BASE}/settings`,
    {
      config: { permission: "settings.edit" },
      schema: { params: Pub, body: NewsSettingsPatch, response: { 200: NewsSettings } },
    },
    async (request) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const input = request.body;
      await database.withTenant(access.tenant, async (tx) => {
        await saveSettings(tx, access.tenant.orgId, pub, {
          ...(input.houseStyle !== undefined ? { house_style: input.houseStyle } : {}),
          ...(input.collectEveryHours !== undefined ? { collect_every_h: input.collectEveryHours } : {}),
        });
        await recordAudit(tx, access.tenant, {
          action: "news.settings_edit",
          targetType: "publication",
          targetId: pub,
          publicationId: pub,
          data: { fields: Object.keys(input) },
        });
      });
      return settingsOf(access, pub);
    },
  );

  app.post(
    `${BASE}/collect`,
    { config: { permission: "settings.edit" }, schema: { params: Pub, response: { 202: CollectAccepted } } },
    async (request, reply) => {
      const access = accessOf(request);
      const pub = request.params.p;
      const runId = await database.withTenant(access.tenant, (tx) =>
        enqueueCollect(tx, access.tenant.orgId, pub, capInr, true),
      );
      if (!runId) {
        throw new ApiError("invalid_request", [{ field: "sources", message: "Turn on at least one source first." }]);
      }
      return reply.status(202).send({ runId });
    },
  );

  app.get(
    `${BASE}/topics`,
    {
      config: { permission: "story.assign" },
      schema: { params: Pub, querystring: NewsTopicQuery, response: { 200: NewsTopicList } },
    },
    async (request) => {
      const access = accessOf(request);
      const { language } = request.query;
      const rows = await database.withTenant(access.tenant, (tx) =>
        listTopics(tx, request.params.p, { ...(language ? { language } : {}), limit: TOPICS }),
      );
      return { items: rows.map((row) => topicView(row)) };
    },
  );

  app.get(
    `${BASE}/topics/:t`,
    { config: { permission: "story.assign" }, schema: { params: OneTopic, response: { 200: NewsTopic } } },
    async (request) => {
      const access = accessOf(request);
      const { p: pub, t } = request.params;
      if (!UUID.test(t)) throw new ApiError("not_found");
      return database.withTenant(access.tenant, async (tx) => {
        const [row] = await listTopics(tx, pub, { id: t, limit: 1 });
        if (!row) throw new ApiError("not_found");
        return topicView(row, await topicItems(tx, pub, t, 200));
      });
    },
  );

  app.post(
    `${BASE}/topics/:t/pick`,
    {
      config: { permission: "story.assign" },
      schema: { params: OneTopic, body: NewsPick, response: { 202: NewsPickAccepted } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const { p: pub, t } = request.params;
      const pick = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const [topic] = UUID.test(t) ? await listTopics(tx, pub, { id: t, limit: 1 }) : [];
          if (!topic) throw new ApiError("not_found");
          const items = await topicItems(tx, pub, t, ARTICLES);
          const title = (
            pick.language === "mr" ? topic.title_mr || topic.title_en : topic.title_en || topic.title_mr
          ).slice(0, 500);
          const draftId = await createDraft(
            tx,
            access.tenant,
            pub,
            { topicId: t, ...pick },
            {
              title,
              articles: items.map((item) => ({
                url: item.link,
                title: item.title,
                summary: item.summary,
                site: item.source_name,
              })),
              budget: await budget(tx, pub, capInr),
            },
          );
          await recordAudit(tx, access.tenant, {
            action: "news.pick",
            targetType: "news_draft",
            targetId: draftId,
            publicationId: pub,
            data: { topic: t, language: pick.language, length: pick.length, findPhoto: pick.findPhoto },
          });
          return { status: 202, body: { draftId } };
        },
        async (stored) => stored,
      );
      return reply.status(202).send(answer.body as z.infer<typeof NewsPickAccepted>);
    },
  );

  app.get(
    `${BASE}/drafts/:d`,
    // story.view, not story.assign: the picker who has since lost story.assign still reads their own
    { config: { permission: "story.view" }, schema: { params: OneDraft, response: { 200: NewsDraft } } },
    async (request) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p: pub, d } = request.params;
      const row = UUID.test(d) ? await database.withTenant(access.tenant, (tx) => findDraft(tx, pub, d)) : undefined;
      if (!row || (row.user_id !== userId && !canAssign(access, pub))) throw new ApiError("not_found");
      return draftView(row);
    },
  );

  app.post(
    `${BASE}/drafts/:d/photo`,
    {
      config: { permission: "story.assign" },
      schema: { params: OneDraft, body: NewsPhotoChoice, response: { 201: NewsPhotoChosen } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      const userId = actorOf(request).userId;
      const { p: pub, d } = request.params;
      const input = request.body;
      if (uploadScope(access, pub) === "none") throw refused("a found photo goes into the media library: media.upload");
      const draft = UUID.test(d) ? await database.withTenant(access.tenant, (tx) => findDraft(tx, pub, d)) : undefined;
      if (!draft) throw new ApiError("not_found");
      const offered = draft.photos[input.index];
      if (draft.state !== "done" || !draft.story_id || !offered) {
        throw new ApiError("invalid_request", [{ field: "body.index", message: "is not a photo this draft offers" }]);
      }
      // the label decided again here, by the same code: the rights wall never rests on the engine event's word alone
      const candidate = { ...offered, label: licenceLabel(offered.origin, offered.licence) };
      if (candidate.label === "needs_permission" && !input.rightsConfirmed) throw new ApiError("rights_needed");
      // downloaded before any transaction: the network is slow, the database's locks are not held for it
      let body: Buffer;
      try {
        body = (await download(candidate.url)).body;
      } catch (error) {
        if (!(error instanceof FetchRefused)) throw error;
        throw new ApiError("not_a_picture", [
          { field: "body.index", message: `The photo could not be downloaded (${error.code}).` },
        ]);
      }
      if (body.length > MAX_PICTURE_BYTES) throw new ApiError("file_too_large");
      let found;
      try {
        const scan = new JpegScan();
        scan.feed(body);
        found = picture(body.subarray(0, HEADER_BYTES), scan);
      } catch (error) {
        if (!(error instanceof NotAPicture)) throw error;
        throw new ApiError("not_a_picture", [
          { field: "body.index", message: `The photo was refused: ${error.message}.` },
        ]);
      }
      const picked = found;
      const sha256 = createHash("sha256").update(body).digest("hex");
      const facts = {
        caption: cleaned(input.caption ?? candidate.title, "caption"),
        credit: cleaned(candidate.credit, "credit"),
        photographer: cleaned(candidate.creator, "photographer"),
      };
      const choose = () =>
        database.withTenant(access.tenant, async (tx) => {
          const locked = await findDraft(tx, pub, d, true);
          const storyId = locked?.story_id;
          if (!storyId) throw new ApiError("not_found");
          const story = await lockStory(tx, pub, storyId);
          if (!story) throw new ApiError("not_found");
          if (!canAttachPhoto(access, pub, factsOf(story), userId)) {
            throw refused("this story's photo is not theirs to set");
          }
          let asset = await assetWithBytes(tx, pub, sha256);
          if (!asset) {
            const made = await createAsset(tx, access.tenant, pub, {
              sha256,
              bytes: body.length,
              mime: picked.mime,
              width: picked.width,
              height: picked.height,
            });
            const put = await store.put({
              key: made.original_key,
              body,
              contentType: picked.mime,
              metadata: { sha256 },
            });
            await setAssetVersion(tx, pub, made.id, put.versionId);
            await setFoundPhoto(tx, pub, made.id, {
              ...facts,
              licence_name: candidate.licence,
              licence_url: candidate.licenceUrl,
              source_url: candidate.pageUrl,
              licence_label: candidate.label,
            });
            // its print versions, as an upload's: the job commits with the asset, or neither does
            await enqueueMediaIngest(tx, {
              orgId: access.tenant.orgId,
              publicationId: pub,
              assetId: made.id,
              versionId: put.versionId,
              sha256,
            });
            asset = await findAsset(tx, pub, made.id, "share");
          }
          if (!asset) throw new ApiError("not_found");
          if (input.rightsConfirmed && (await confirmRights(tx, pub, asset.id, userId))) {
            await recordAudit(tx, access.tenant, {
              action: "asset.rights_confirm",
              targetType: "asset",
              targetId: asset.id,
              publicationId: pub,
              data: { label: candidate.label, draft: d },
            });
          }
          // the publication's own picture with these bytes keeps its own label (none: it is the paper's)
          const now = (await findAsset(tx, pub, asset.id, "share")) ?? asset;
          if (now.licence_label === "needs_permission" && !now.rights_confirmed_at) throw new ApiError("rights_needed");
          await setPhoto(tx, access.tenant, pub, storyId, {
            assetId: asset.id,
            caption: facts.caption,
            credit: facts.credit,
          });
          await setChosenPhoto(tx, pub, d, asset.id);
          await recordAudit(tx, access.tenant, {
            action: "news.photo_choose",
            targetType: "news_draft",
            targetId: d,
            publicationId: pub,
            data: { asset: asset.id, index: input.index, label: candidate.label, origin: candidate.origin },
          });
          return asset.id;
        });
      let assetId;
      try {
        assetId = await choose();
      } catch (error) {
        // two choices of the same new bytes at once: the other made the asset first (asset_one_per_bytes), and this
        // one, run again, finds it
        if ((error as { code?: unknown }).code !== "23505") throw error;
        assetId = await choose();
      }
      return reply.status(201).send({ assetId });
    },
  );
};
