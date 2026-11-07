/**
 * The news finder over the API (docs/product/13-news-finder.md, L2.7), under /api/v1/orgs/:o/pubs/:p/news/…; every
 * answer read with the API's own schema (@pageinator/contracts news.ts), so a change of shape shows as an error, never
 * as a wrong screen.
 */
import {
  NewsDraft,
  NewsHeadlineList,
  NewsPhotoChosen,
  NewsPickAccepted,
  NewsSettings,
  NewsSource,
  NewsSourceList,
  NewsTopic,
  NewsTopicList,
} from "@pageinator/contracts";
import type { ApiProblem, NewsService, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: answer.problem };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

const done = (answer: ApiResult<unknown>): ServiceResult<void, ApiProblem> =>
  answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };

const news = (orgId: string, pubId: string) =>
  `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}/news`;

export function createApiNewsService(client: ApiClient): NewsService {
  return {
    async listSources({ orgId, pubId }) {
      const answer = read(NewsSourceList, await client.get(`${news(orgId, pubId)}/sources`));
      return answer.ok ? { ok: true, value: answer.value.items } : answer;
    },
    async createSource({ orgId, pubId, source }) {
      return read(NewsSource, await client.post(`${news(orgId, pubId)}/sources`, source));
    },
    async updateSource({ orgId, pubId, sourceId, patch }) {
      return read(NewsSource, await client.patch(`${news(orgId, pubId)}/sources/${encodeURIComponent(sourceId)}`, patch));
    },
    async removeSource({ orgId, pubId, sourceId }) {
      return done(await client.delete(`${news(orgId, pubId)}/sources/${encodeURIComponent(sourceId)}`));
    },
    async addSuggestedSources({ orgId, pubId }) {
      const answer = read(NewsSourceList, await client.post(`${news(orgId, pubId)}/sources/suggested`, {}));
      return answer.ok ? { ok: true, value: answer.value.items } : answer;
    },
    async getSettings({ orgId, pubId }) {
      return read(NewsSettings, await client.get(`${news(orgId, pubId)}/settings`));
    },
    async updateSettings({ orgId, pubId, patch }) {
      return read(NewsSettings, await client.patch(`${news(orgId, pubId)}/settings`, patch));
    },
    async collect({ orgId, pubId }) {
      return done(await client.post(`${news(orgId, pubId)}/collect`, {}));
    },
    async listTopics({ orgId, pubId, language }) {
      const answer = read(NewsTopicList, await client.get(`${news(orgId, pubId)}/topics${language ? `?language=${language}` : ""}`));
      return answer.ok ? { ok: true, value: answer.value.items } : answer;
    },
    async listHeadlines({ orgId, pubId, language }) {
      const answer = read(NewsHeadlineList, await client.get(`${news(orgId, pubId)}/headlines${language ? `?language=${language}` : ""}`));
      return answer.ok ? { ok: true, value: answer.value.items } : answer;
    },
    async getTopic({ orgId, pubId, topicId }) {
      return read(NewsTopic, await client.get(`${news(orgId, pubId)}/topics/${encodeURIComponent(topicId)}`));
    },
    async pick({ orgId, pubId, topicId, pick, idempotencyKey }) {
      return read(
        NewsPickAccepted,
        await client.post(`${news(orgId, pubId)}/topics/${encodeURIComponent(topicId)}/pick`, pick, { idempotencyKey }),
      );
    },
    async getDraft({ orgId, pubId, draftId }) {
      return read(NewsDraft, await client.get(`${news(orgId, pubId)}/drafts/${encodeURIComponent(draftId)}`));
    },
    async choosePhoto({ orgId, pubId, draftId, index, caption, rightsConfirmed }) {
      const body = { index, rightsConfirmed, ...(caption ? { caption } : {}) };
      return read(NewsPhotoChosen, await client.post(`${news(orgId, pubId)}/drafts/${encodeURIComponent(draftId)}/photo`, body));
    },
  };
}
