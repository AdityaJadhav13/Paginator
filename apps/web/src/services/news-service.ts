import type {
  DraftLength,
  NewsDraft,
  NewsItem,
  NewsLanguage,
  NewsPick,
  NewsSettings,
  NewsSource,
  NewsSourceInput,
  NewsTopic,
} from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts news.ts): the news finder (L2.7), the sidebar's Sources screen. */
export type NewsSourceDto = NewsSource;
export type NewsSourceInputDto = NewsSourceInput;
export type NewsSettingsDto = NewsSettings;
export type NewsTopicDto = NewsTopic;
export type NewsItemDto = NewsItem;
export type NewsDraftDto = NewsDraft;
export type NewsPickDto = NewsPick;
export type NewsLanguageDto = NewsLanguage;
export type DraftLengthDto = DraftLength;

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

/**
 * The news finder under …/news/… : the publication's feeds and settings (settings.edit to change them), the topics
 * collected from them, a pick (202: the engine drafts the story later, asked for with getDraft) and a found photo
 * chosen into the Media library (a Needs-permission one only with rightsConfirmed, else 422 rights_needed).
 */
export interface NewsService {
  listSources(input: Where): Promise<ServiceResult<readonly NewsSourceDto[], ApiProblem>>;
  createSource(input: Where & { readonly source: NewsSourceInputDto }): Promise<ServiceResult<NewsSourceDto, ApiProblem>>;
  updateSource(
    input: Where & { readonly sourceId: string; readonly patch: Partial<NewsSourceInputDto> },
  ): Promise<ServiceResult<NewsSourceDto, ApiProblem>>;
  removeSource(input: Where & { readonly sourceId: string }): Promise<ServiceResult<void, ApiProblem>>;
  /** Adds the suggested public feeds the list does not have yet (POST …/news/sources/suggested); answers the list. */
  addSuggestedSources(input: Where): Promise<ServiceResult<readonly NewsSourceDto[], ApiProblem>>;
  getSettings(input: Where): Promise<ServiceResult<NewsSettingsDto, ApiProblem>>;
  updateSettings(
    input: Where & { readonly patch: { readonly houseStyle?: string; readonly collectEveryHours?: number } },
  ): Promise<ServiceResult<NewsSettingsDto, ApiProblem>>;
  /** Collects the feeds now (POST …/news/collect, 202): the topics arrive later. */
  collect(input: Where): Promise<ServiceResult<void, ApiProblem>>;
  listTopics(input: Where & { readonly language?: NewsLanguageDto }): Promise<ServiceResult<readonly NewsTopicDto[], ApiProblem>>;
  /** The items kept, newest first, grouped or not (what the screen lists while the AI part is off). */
  listHeadlines(input: Where & { readonly language?: NewsLanguageDto }): Promise<ServiceResult<readonly NewsItemDto[], ApiProblem>>;
  /** One topic with its items. */
  getTopic(input: Where & { readonly topicId: string }): Promise<ServiceResult<NewsTopicDto, ApiProblem>>;
  pick(
    input: Where & { readonly topicId: string; readonly pick: NewsPickDto; readonly idempotencyKey: string },
  ): Promise<ServiceResult<{ readonly draftId: string }, ApiProblem>>;
  getDraft(input: Where & { readonly draftId: string }): Promise<ServiceResult<NewsDraftDto, ApiProblem>>;
  choosePhoto(
    input: Where & { readonly draftId: string; readonly index: number; readonly caption?: string; readonly rightsConfirmed: boolean },
  ): Promise<ServiceResult<{ readonly assetId: string }, ApiProblem>>;
}
