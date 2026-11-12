/**
 * The news finder's double (docs/product/13-news-finder.md, L2.7), answered as the API's src/modules/news: the
 * publication's feeds and settings (whoever has story.assign reads them; settings.edit changes them), the topics
 * collected from the feeds (the last days', filtered by language), a pick (story.assign, an Idempotency-Key replaying
 * its first answer, 202), queued until `finish` stands in for the engine: the Draft story is made (the picker its
 * reporter and assignee, "Made with Claude", its sources) with the photos found, or the draft fails with the engine's
 * code. A Needs-permission photo is chosen only with rightsConfirmed (422 rights_needed). Fictional data only: the
 * sources, items and photos below are made up (example addresses), and nothing is fetched.
 */
import type {
  ApiProblem,
  NewsDraftDto,
  NewsItemDto,
  NewsService,
  NewsSettingsDto,
  NewsSourceDto,
  NewsTopicDto,
  ServiceResult,
} from "../services/index.ts";
import { reach } from "../services/permissions.ts";
import { MOCK_RIGHTS_NEEDED, type MockNewsPhoto, type MockNewsStory, type MockStanding, type MockStoryDeps } from "./create-mock-stories.ts";

export type MockNewsOperation =
  | "news.sources"
  | "news.sourceEdit"
  | "news.settings"
  | "news.settingsEdit"
  | "news.collect"
  | "news.topics"
  | "news.pick"
  | "news.draft"
  | "news.photo";

/** How a draft ends: done (with the copy check's flagged sentences and the photos found), or the engine's failure. */
export type MockNewsOutcome =
  | { readonly flagged?: readonly string[]; readonly photos?: NewsDraftDto["photos"] }
  | { readonly error: { readonly code: string; readonly message: string } };

type PhotoCandidateDto = NewsDraftDto["photos"][number];

export interface MockNewsDeps {
  readonly person: MockStoryDeps["person"];
  readonly standing: MockStoryDeps["standing"];
  readonly signedOut: MockStoryDeps["signedOut"];
  gate(operation: MockNewsOperation): Promise<ApiProblem | undefined>;
  newsStory(input: MockNewsStory): string;
  newsPhoto(input: MockNewsPhoto): string;
}

type Answer = Extract<ApiProblem, { kind: "answer" }>;
const answer = (status: number, code: string, message: string): Answer => ({ kind: "answer", status, code, message, requestId: "mock-request" });
const NOT_FOUND = answer(404, "not_found", "There is nothing here, or you do not have access to it.");
const NOT_ALLOWED = answer(403, "not_allowed", "Your role cannot do this. Ask an editor or the owner.");
const TWO_STEP = answer(403, "two_step_required", "Your role needs two-step sign-in. Set it up in Account → Security.");
const AI_OFF = answer(409, "ai_off", "The AI part is off, so no story can be drafted. The headlines are still collected.");
const KEY_REUSED = answer(422, "idempotency_key_reused", "This key was already used with a different request.");
const invalid = (field: string, message: string): Answer => ({
  ...answer(400, "invalid_request", "Some fields are not right."),
  details: [{ field, message }],
});
const success = <T,>(value: T): ServiceResult<T, ApiProblem> => ({ ok: true, value });
const failure = <T,>(problem: ApiProblem): ServiceResult<T, ApiProblem> => ({ ok: false, error: { ...problem } });

const SAHYADRI = "org-demo-sahyadri";
const PUNE = "pub-demo-pune-daily";
const AT = "2026-10-22T08:00:00.000Z";

/** Stands in for the API's suggested public feeds (fictional here, as all the double's data). */
const SUGGESTED = [
  { name: "Fictional Maharashtra News", url: "https://suggested-mr.example/feed.xml", language: "mr" },
  { name: "Fictional National Wire", url: "https://suggested-en.example/feed.xml", language: "en" },
] as const;

interface SourceRow extends NewsSourceDto {
  readonly orgId: string;
  readonly pubId: string;
}

/** Fictional feeds of the Pune Daily Ledger: Marathi and English, one switched off, one whose last fetch failed. */
function sourceFixtures(): SourceRow[] {
  const source = (id: string, name: string, language: "mr" | "en", fields: Partial<SourceRow> = {}): SourceRow => ({
    orgId: SAHYADRI,
    pubId: PUNE,
    id,
    name,
    url: `https://${id}.example/feed.xml`,
    language,
    enabled: true,
    lastFetchAt: AT,
    lastError: null,
    ...fields,
  });
  return [
    source("source-demo-1", "Fictional Marathi Daily", "mr"),
    source("source-demo-2", "Fictional Sahyadri Times", "mr"),
    source("source-demo-3", "Fictional Deccan Herald", "en"),
    source("source-demo-4", "Fictional Konkan Varta", "mr", { lastError: "fetch.timeout" }),
    source("source-demo-5", "Fictional City Wire", "en", { enabled: false, lastFetchAt: null }),
  ];
}

interface TopicRow extends NewsTopicDto {
  readonly orgId: string;
  readonly pubId: string;
}

/** Fictional topics: a big story told by three sources, and two smaller ones (one Marathi, one English). */
function topicFixtures(): TopicRow[] {
  const item = (id: string, sourceId: string, sourceName: string, language: "mr" | "en", title: string, summary: string) => ({
    id,
    sourceId,
    sourceName,
    title,
    summary,
    link: `https://${sourceId}.example/news/${id}`,
    language,
    publishedAt: AT,
  });
  const rain = [
    item("item-demo-1", "source-demo-1", "Fictional Marathi Daily", "mr", "पुण्यात मुसळधार पाऊस, शाळांना सुट्टी", "रात्रभर झालेल्या पावसामुळे शहरातील सखल भागात पाणी साचले."),
    item("item-demo-2", "source-demo-2", "Fictional Sahyadri Times", "mr", "मुसळधार पावसाने वाहतूक ठप्प", "धरण परिसरात दिवसभर पाऊस सुरू राहील, असा अंदाज आहे."),
    item("item-demo-3", "source-demo-3", "Fictional Deccan Herald", "en", "Heavy rain shuts Pune schools", "Low-lying areas flooded after a night of rain, the fictional city office said."),
  ];
  return [
    {
      orgId: SAHYADRI,
      pubId: PUNE,
      id: "topic-demo-1",
      titleMr: "पुण्यात मुसळधार पाऊस, शाळांना सुट्टी",
      titleEn: "Heavy rain in Pune; schools shut",
      importance: 4,
      sources: rain.map((one) => ({ id: one.sourceId, name: one.sourceName })),
      itemCount: rain.length,
      languages: ["mr", "en"],
      big: true,
      latestAt: "2026-10-22T09:30:00.000Z",
      items: rain,
    },
    {
      orgId: SAHYADRI,
      pubId: PUNE,
      id: "topic-demo-2",
      titleMr: "नाशिकमधून द्राक्ष निर्यात वाढली",
      titleEn: "Grape exports from Nashik rise",
      importance: 2,
      sources: [{ id: "source-demo-1", name: "Fictional Marathi Daily" }],
      itemCount: 1,
      languages: ["mr"],
      big: false,
      latestAt: "2026-10-22T08:45:00.000Z",
      items: [item("item-demo-4", "source-demo-1", "Fictional Marathi Daily", "mr", "द्राक्ष निर्यातीत वाढ", "यंदा युरोपला जाणाऱ्या द्राक्षांचे प्रमाण वाढले.")],
    },
    {
      orgId: SAHYADRI,
      pubId: PUNE,
      id: "topic-demo-3",
      titleMr: "रिंग रोडच्या निविदा खुल्या",
      titleEn: "Ring road tenders opened",
      importance: 2,
      sources: [{ id: "source-demo-3", name: "Fictional Deccan Herald" }],
      itemCount: 1,
      languages: ["en"],
      big: false,
      latestAt: "2026-10-22T08:15:00.000Z",
      items: [item("item-demo-5", "source-demo-3", "Fictional Deccan Herald", "en", "Ring road tenders opened", "Five fictional firms bid for the eastern stretch.")],
    },
  ];
}

/** Three photos found for a big story: two free to print, one that needs permission. */
export function mockPhotoCandidates(): PhotoCandidateDto[] {
  const photo = (n: number, fields: Partial<PhotoCandidateDto>): PhotoCandidateDto => ({
    url: `https://photos.example/full/${n}.jpg`,
    thumbUrl: `https://photos.example/thumb/${n}.jpg`,
    pageUrl: `https://photos.example/page/${n}`,
    widthPx: 4000,
    heightPx: 2667,
    title: `Fictional rain photo ${n}`,
    creator: "Fictional Photographer",
    site: "photos.example",
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    origin: "commons",
    label: "safe",
    credit: "Fictional Photographer / photos.example, CC BY 4.0",
    ...fields,
  });
  return [
    photo(1, {}),
    photo(2, { licence: "public domain", licenceUrl: null, credit: "photos.example (public domain)", origin: "openverse" }),
    photo(3, { licence: "unknown", licenceUrl: null, origin: "source", label: "needs_permission", credit: "Fictional Deccan Herald" }),
  ];
}

interface DraftRow {
  readonly orgId: string;
  readonly pubId: string;
  readonly by: { readonly userId: string; readonly name: string };
  value: NewsDraftDto;
}

export function createMockNews(deps: MockNewsDeps): {
  news: NewsService;
  /** The engine's answer for a draft: the story made (with the photos found), or its failure. */
  finish(draftId: string, outcome?: MockNewsOutcome): void;
  /** The AI part's state as the last run found it (off: no API key on the worker). */
  setAi(state: NewsSettingsDto["ai"]["state"]): void;
  reset(): void;
} {
  let sources = sourceFixtures();
  let topics = topicFixtures();
  let drafts = new Map<string, DraftRow>();
  let settings = { houseStyle: "", collectEveryHours: 3, lastCollectedAt: AT as string | null };
  let ai: NewsSettingsDto["ai"] = { state: "on", spentMonthInr: 412.5, spentTodayInr: 26, capDayInr: 300 };
  let keys = new Map<string, { body: string; draftId: string }>();
  let counter = 0;
  let clock = 0;

  async function check<T>(
    operation: MockNewsOperation,
    orgId: string,
    pubId: string,
    permission: "story.assign" | "settings.edit",
  ): Promise<ServiceResult<T, ApiProblem> | { person: { userId: string; name: string }; s: MockStanding }> {
    const problem = await deps.gate(operation);
    if (problem) return failure(problem);
    const person = deps.person();
    if (!person) return deps.signedOut();
    const s = deps.standing(person.userId, orgId, pubId);
    if (!s) return failure(NOT_FOUND);
    if (s.twoStepBlocked) return failure(TWO_STEP);
    if (reach(permission, s.orgRole, s.access) === null) return failure(NOT_ALLOWED);
    return { person, s };
  }
  const refused = <T,>(checked: object): checked is ServiceResult<T, ApiProblem> => "ok" in checked;
  const here = (orgId: string, pubId: string) => (row: { orgId: string; pubId: string }) => row.orgId === orgId && row.pubId === pubId;
  const strip = <T extends { orgId: string; pubId: string }>({ orgId: _o, pubId: _p, ...rest }: T) => structuredClone(rest);
  const now = () => {
    clock += 1;
    return `2026-10-22T15:${String(clock).padStart(2, "0")}:00.000Z`;
  };
  const validUrl = (url: string) => /^https?:\/\/[^\s]+$/.test(url);

  const news: NewsService = {
    async listSources({ orgId, pubId }) {
      const checked = await check<readonly NewsSourceDto[]>("news.sources", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      return success(sources.filter(here(orgId, pubId)).map(strip));
    },
    async createSource({ orgId, pubId, source }) {
      const checked = await check<NewsSourceDto>("news.sourceEdit", orgId, pubId, "settings.edit");
      if (refused(checked)) return checked;
      if (source.name.trim() === "") return failure(invalid("body.name", "Give the source a name."));
      if (!validUrl(source.url)) return failure(invalid("body.url", "is not a web address"));
      counter += 1;
      const row: SourceRow = {
        orgId,
        pubId,
        id: `source-new-${String(counter).padStart(3, "0")}`,
        name: source.name.trim(),
        url: source.url,
        language: source.language,
        enabled: source.enabled,
        lastFetchAt: null,
        lastError: null,
      };
      sources = [...sources, row];
      return success(strip(row));
    },
    async updateSource({ orgId, pubId, sourceId, patch }) {
      const checked = await check<NewsSourceDto>("news.sourceEdit", orgId, pubId, "settings.edit");
      if (refused(checked)) return checked;
      const row = sources.find((candidate) => candidate.id === sourceId && here(orgId, pubId)(candidate));
      if (!row) return failure(NOT_FOUND);
      if (patch.url !== undefined && !validUrl(patch.url)) return failure(invalid("body.url", "is not a web address"));
      const next = { ...row, ...patch };
      sources = sources.map((candidate) => (candidate === row ? next : candidate));
      return success(strip(next));
    },
    async removeSource({ orgId, pubId, sourceId }) {
      const checked = await check<void>("news.sourceEdit", orgId, pubId, "settings.edit");
      if (refused(checked)) return checked;
      if (!sources.some((candidate) => candidate.id === sourceId && here(orgId, pubId)(candidate))) return failure(NOT_FOUND);
      sources = sources.filter((candidate) => candidate.id !== sourceId);
      return success(undefined);
    },
    async addSuggestedSources({ orgId, pubId }) {
      const checked = await check<readonly NewsSourceDto[]>("news.sourceEdit", orgId, pubId, "settings.edit");
      if (refused(checked)) return checked;
      const have = new Set(sources.filter(here(orgId, pubId)).map((row) => row.url));
      for (const suggested of SUGGESTED) {
        if (have.has(suggested.url)) continue;
        counter += 1;
        const id = `source-new-${String(counter).padStart(3, "0")}`;
        sources = [...sources, { orgId, pubId, id, ...suggested, enabled: true, lastFetchAt: null, lastError: null }];
      }
      return success(sources.filter(here(orgId, pubId)).map(strip));
    },
    async getSettings({ orgId, pubId }) {
      const checked = await check<NewsSettingsDto>("news.settings", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      const mayManage = reach("settings.edit", checked.s.orgRole, checked.s.access) !== null;
      return success({ ...settings, ai: { ...ai }, mayManage });
    },
    async updateSettings({ orgId, pubId, patch }) {
      const checked = await check<NewsSettingsDto>("news.settingsEdit", orgId, pubId, "settings.edit");
      if (refused(checked)) return checked;
      const hours = patch.collectEveryHours;
      if (hours !== undefined && (!Number.isInteger(hours) || hours < 1 || hours > 24)) {
        return failure(invalid("body.collectEveryHours", "must be 1 to 24 hours"));
      }
      settings = { ...settings, ...patch };
      return success({ ...settings, ai: { ...ai }, mayManage: true });
    },
    async collect({ orgId, pubId }) {
      const checked = await check<void>("news.collect", orgId, pubId, "settings.edit");
      if (refused(checked)) return checked;
      settings = { ...settings, lastCollectedAt: now() };
      return success(undefined);
    },
    async listTopics({ orgId, pubId, language }) {
      const checked = await check<readonly NewsTopicDto[]>("news.topics", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      return success(
        topics
          .filter(here(orgId, pubId))
          .filter((topic) => !language || topic.languages.includes(language))
          .map((topic) => ({ ...strip(topic), items: [] })),
      );
    },
    async listHeadlines({ orgId, pubId, language }) {
      const checked = await check<readonly NewsItemDto[]>("news.topics", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      const items = topics.filter(here(orgId, pubId)).flatMap((topic) => topic.items.map((item) => structuredClone(item)));
      return success(
        items
          .filter((item) => !language || item.language === language)
          .sort((x, y) => (y.publishedAt ?? "").localeCompare(x.publishedAt ?? "") || x.id.localeCompare(y.id)),
      );
    },
    async getTopic({ orgId, pubId, topicId }) {
      const checked = await check<NewsTopicDto>("news.topics", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      const topic = topics.find((candidate) => candidate.id === topicId && here(orgId, pubId)(candidate));
      return topic ? success(strip(topic)) : failure(NOT_FOUND);
    },
    async pick({ orgId, pubId, topicId, pick, idempotencyKey }) {
      const checked = await check<{ draftId: string }>("news.pick", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      if (ai.state === "off") return failure(AI_OFF);
      const body = JSON.stringify({ topicId, pick });
      const kept = keys.get(idempotencyKey);
      if (kept) return kept.body === body ? success({ draftId: kept.draftId }) : failure(KEY_REUSED);
      if (!topics.some((candidate) => candidate.id === topicId && here(orgId, pubId)(candidate))) return failure(NOT_FOUND);
      const id = `draft-${String(drafts.size + 1).padStart(3, "0")}`;
      const at = now();
      const value: NewsDraftDto = {
        id,
        topicId,
        state: "queued",
        language: pick.language,
        length: pick.length,
        findPhoto: pick.findPhoto,
        storyId: null,
        flagged: [],
        photos: [],
        chosenAssetId: null,
        error: null,
        createdAt: at,
        updatedAt: at,
      };
      drafts = new Map(drafts).set(id, { orgId, pubId, by: checked.person, value });
      keys = new Map(keys).set(idempotencyKey, { body, draftId: id });
      return success({ draftId: id });
    },
    async getDraft({ orgId, pubId, draftId }) {
      const checked = await check<NewsDraftDto>("news.draft", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      const row = drafts.get(draftId);
      if (!row || !here(orgId, pubId)(row)) return failure(NOT_FOUND);
      return success(structuredClone(row.value));
    },
    async choosePhoto({ orgId, pubId, draftId, index, caption, rightsConfirmed }) {
      const checked = await check<{ assetId: string }>("news.photo", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      if (reach("media.upload", checked.s.orgRole, checked.s.access) === null) return failure(NOT_ALLOWED);
      const row = drafts.get(draftId);
      if (!row || !here(orgId, pubId)(row)) return failure(NOT_FOUND);
      const photo = row.value.photos[index];
      if (row.value.state !== "done" || !photo) return failure(invalid("body.index", "is not one of the draft's photos"));
      if (photo.label === "needs_permission" && !rightsConfirmed) return failure(answer(422, "rights_needed", MOCK_RIGHTS_NEEDED));
      const assetId = deps.newsPhoto({
        orgId,
        pubId,
        by: checked.person,
        storyId: row.value.storyId,
        widthPx: photo.widthPx,
        heightPx: photo.heightPx,
        caption: caption ?? photo.title,
        credit: photo.credit,
        photographer: photo.creator,
        licence: { name: photo.licence, url: photo.licenceUrl, sourceUrl: photo.pageUrl, label: photo.label },
        rightsConfirmed,
      });
      row.value = { ...row.value, chosenAssetId: assetId, updatedAt: now() };
      return success({ assetId });
    },
  };

  return {
    news,
    finish(draftId, outcome = {}) {
      const row = drafts.get(draftId);
      if (!row || row.value.state !== "queued") return;
      if ("error" in outcome) {
        row.value = { ...row.value, state: "failed", error: { ...outcome.error }, updatedAt: now() };
        return;
      }
      const topic = topics.find((candidate) => candidate.id === row.value.topicId);
      const mr = row.value.language === "mr";
      const storyId = deps.newsStory({
        orgId: row.orgId,
        pubId: row.pubId,
        by: row.by,
        headline: (mr ? topic?.titleMr : topic?.titleEn) ?? "",
        byline: "Pageinator desk",
        body: mr ? "काल्पनिक बातमीचा मजकूर, स्रोतांवरून आपल्या शब्दांत लिहिलेला." : "Fictional story text, written in our own words from the sources.",
        language: row.value.language,
        sources: (topic?.items ?? []).map((one) => ({ title: one.title, url: one.link, site: one.sourceName })),
      });
      row.value = {
        ...row.value,
        state: "done",
        storyId,
        flagged: [...(outcome.flagged ?? [])],
        photos: row.value.findPhoto ? [...(outcome.photos ?? mockPhotoCandidates())] : [],
        updatedAt: now(),
      };
    },
    setAi(state) {
      ai = { ...ai, state };
    },
    reset() {
      sources = sourceFixtures();
      topics = topicFixtures();
      drafts = new Map();
      settings = { houseStyle: "", collectEveryHours: 3, lastCollectedAt: AT };
      ai = { state: "on", spentMonthInr: 412.5, spentTodayInr: 26, capDayInr: 300 };
      keys = new Map();
      counter = 0;
      clock = 0;
    },
  };
}
