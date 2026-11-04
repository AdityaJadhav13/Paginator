// The news finder (docs/product/13-news-finder.md, L2.7): the sidebar's Sources screen. Feeds the publication lists
// are collected every few hours by the engine queue (news.collect), the same event across sources grouped into topics
// by one Claude call; an editor picks a topic and the queue drafts a story in the paper's own words and house style
// (news.draft), with print-worthy photos only for big stories. Everything Claude makes is marked "Made with Claude —
// check before use"; nothing prints without the normal approvals.
//   - the HTTP shapes (camelCase) the API sends and the web reads, under /api/v1/orgs/:o/pubs/:p/news/…;
//   - the queue's payloads and the events it writes to the API's inbox (snake case, as engine.ts).
// The licence label of a photo is decided by code (licenceLabel in the engine queue), never by Claude.
import { z } from "zod";
import { OrgId, Uuid7 } from "./ids.ts";

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });
const Url = z
  .string()
  .max(2048)
  .regex(/^https?:\/\/[^\s]+$/);

export const NEWS_LANGUAGES = ["mr", "en"] as const;
export const NewsLanguage = z.enum(NEWS_LANGUAGES);
export type NewsLanguage = z.infer<typeof NewsLanguage>;
export const DRAFT_LENGTHS = ["short", "standard", "long"] as const;
export const DraftLength = z.enum(DRAFT_LENGTHS);
export type DraftLength = z.infer<typeof DraftLength>;

/** "safe": free to print (our own, a paid agency the paper configures, CC0 / CC BY / CC BY-SA / public domain, or a
 * government press release); "needs_permission": anything else, printed only after "We have the right to print this". */
export const LicenceLabel = z.enum(["safe", "needs_permission"]);
export type LicenceLabel = z.infer<typeof LicenceLabel>;
export const PHOTO_ORIGINS = ["commons", "openverse", "source", "pib"] as const;
export const PhotoOrigin = z.enum(PHOTO_ORIGINS);

/** A topic is a big story with this many distinct sources, or Claude's importance at least BIG_IMPORTANCE. */
export const BIG_SOURCES = 3;
export const BIG_IMPORTANCE = 4;
/** Items and topics are kept this long. */
export const NEWS_KEEP_DAYS = 3;

// ---------------------------------------------------------------- HTTP: sources and settings (settings.edit to change)

export const NewsSource = z.strictObject({
  id: Id,
  name: z.string(),
  url: z.string(),
  language: NewsLanguage,
  enabled: z.boolean(),
  lastFetchAt: Moment.nullable(),
  /** the last fetch's problem in plain words, or null */
  lastError: z.string().nullable(),
});
export type NewsSource = z.infer<typeof NewsSource>;
export const NewsSourceInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  url: Url,
  language: NewsLanguage,
  enabled: z.boolean().default(true),
});
export type NewsSourceInput = z.infer<typeof NewsSourceInput>;
// enabled without its default: a change of the name alone must not turn a source back on
export const NewsSourcePatch = NewsSourceInput.extend({ enabled: z.boolean() })
  .partial()
  .refine((p) => Object.keys(p).length > 0, {
    error: "change at least one field",
  });
export const NewsSourceList = z.strictObject({ items: z.array(NewsSource) });

/** The AI part's state, as the last run found it: on; off (no API key on the worker: collection still works); cap (the
 * day's spend cap reached); failed (the last call failed: refused, cut short, or an error). Null before any run. */
export const AiState = z.enum(["on", "off", "cap", "failed"]);
export type AiState = z.infer<typeof AiState>;

export const NewsSettings = z.strictObject({
  /** the paper's house style guide for drafts (its own words and examples stay in the database, never the repo) */
  houseStyle: z.string(),
  collectEveryHours: z.number().int().min(1).max(24),
  lastCollectedAt: Moment.nullable(),
  ai: z.strictObject({
    state: AiState.nullable(),
    /** the AI spend this calendar month (Asia/Kolkata), in rupees */
    spentMonthInr: z.number().min(0),
    spentTodayInr: z.number().min(0),
    capDayInr: z.number().min(0),
  }),
  /** whether this person may change sources and settings (settings.edit) */
  mayManage: z.boolean(),
});
export type NewsSettings = z.infer<typeof NewsSettings>;
export const NewsSettingsPatch = z
  .strictObject({
    houseStyle: z.string().max(20_000).optional(),
    collectEveryHours: z.number().int().min(1).max(24).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { error: "change at least one field" });

// ---------------------------------------------------------------- HTTP: topics, picks and drafts (story.assign)

export const NewsItem = z.strictObject({
  id: Id,
  sourceId: Id,
  sourceName: z.string(),
  title: z.string(),
  summary: z.string(),
  link: z.string(),
  language: NewsLanguage,
  publishedAt: Moment.nullable(),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const NewsTopic = z.strictObject({
  id: Id,
  titleMr: z.string(),
  titleEn: z.string(),
  importance: z.number().int().min(1).max(5),
  /** distinct sources; the topic's chips */
  sources: z.array(z.strictObject({ id: Id, name: z.string() })),
  itemCount: z.number().int().min(0),
  languages: z.array(NewsLanguage),
  /** ≥ BIG_SOURCES distinct sources or importance ≥ BIG_IMPORTANCE */
  big: z.boolean(),
  latestAt: Moment,
  /** the topic's items: in GET …/news/topics/:t only (the list sends []) */
  items: z.array(NewsItem),
});
export type NewsTopic = z.infer<typeof NewsTopic>;
/** GET …/news/topics?language=mr|en: the last NEWS_KEEP_DAYS days', by distinct sources × recency. */
export const NewsTopicQuery = z.strictObject({ language: NewsLanguage.optional() });
export const NewsTopicList = z.strictObject({ items: z.array(NewsTopic) });

/** POST …/news/topics/:t/pick (Idempotency-Key) → 202 {draftId}. */
export const NewsPick = z.strictObject({ language: NewsLanguage, length: DraftLength, findPhoto: z.boolean() });
export type NewsPick = z.infer<typeof NewsPick>;
export const NewsPickAccepted = z.strictObject({ draftId: Id });

export const PhotoCandidate = z.strictObject({
  /** the full picture (downloaded by the API, through the same guard as the feeds, only when chosen) */
  url: Url,
  thumbUrl: Url,
  /** the page it is described on (its source, for the credit line) */
  pageUrl: Url,
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  title: z.string().max(500),
  creator: z.string().max(500),
  site: z.string().max(200),
  /** as its source names it ("CC BY-SA 4.0", "public domain", "unknown") */
  licence: z.string().max(100),
  licenceUrl: Url.nullable(),
  origin: PhotoOrigin,
  label: LicenceLabel,
  /** the credit line to print (filled for CC BY / BY-SA as the licence asks) */
  credit: z.string().max(500),
});
export type PhotoCandidate = z.infer<typeof PhotoCandidate>;

export const NEWS_DRAFT_STATES = ["queued", "done", "failed"] as const;
export const NewsDraft = z.strictObject({
  id: Id,
  topicId: Id.nullable(),
  state: z.enum(NEWS_DRAFT_STATES),
  language: NewsLanguage,
  length: DraftLength,
  findPhoto: z.boolean(),
  /** the Draft story made (assigned to the person who picked), once done */
  storyId: Id.nullable(),
  /** sentences the copy check still found too close to a source after one rewrite: shown to the editor */
  flagged: z.array(z.string()),
  /** 3–5 photos, best first (only when findPhoto) */
  photos: z.array(PhotoCandidate),
  /** the photo chosen, in the Media library */
  chosenAssetId: Id.nullable(),
  /** why it failed: ai.off, ai.cap, ai.refused, ai.max_tokens, ai.error, news.no_text, worker.… */
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
  createdAt: Moment,
  updatedAt: Moment,
});
export type NewsDraft = z.infer<typeof NewsDraft>;

/** POST …/news/drafts/:d/photo → 201 {assetId}: the candidate (by index) imported into the Media library and made
 * the story's photo. A Needs-permission photo needs rightsConfirmed: true (else 422 rights_needed). */
export const NewsPhotoChoice = z.strictObject({
  index: z.number().int().min(0).max(9),
  caption: z.string().max(4000).optional(),
  rightsConfirmed: z.boolean().default(false),
});
export const NewsPhotoChosen = z.strictObject({ assetId: Id });

/** A story's own sources (origin news): kept as a field the editor sees, not printed unless the editor keeps them. */
export const NewsSourceLink = z.strictObject({ title: z.string().max(500), url: Url, site: z.string().max(200) });
export type NewsSourceLink = z.infer<typeof NewsSourceLink>;

// ---------------------------------------------------------------- the queue's payloads and events (snake case)

const Text = (max: number) => z.string().max(max);
/** The AI spend still allowed today, in rupees (the API reads it before enqueuing; the queue refuses a call once it is
 * spent). */
const Budget = z.number().min(0).max(1_000_000);

export const NewsCollectPayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  run_id: Uuid7,
  sources: z
    .array(z.strictObject({ id: Uuid7, url: Url, language: NewsLanguage }))
    .min(1)
    .max(100),
  /** sha256 (hex) of each link already stored: skipped, and not grouped again */
  known: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(20_000),
  /** the last days' topics, so a new item can join one */
  topics: z.array(z.strictObject({ id: Uuid7, title: Text(500) })).max(300),
  ai_budget_inr: Budget,
});
export type NewsCollectPayload = z.infer<typeof NewsCollectPayload>;

export const NewsDraftPayload = z.strictObject({
  org_id: OrgId,
  pub_id: Uuid7,
  draft_id: Uuid7,
  language: NewsLanguage,
  length: DraftLength,
  find_photo: z.boolean(),
  title: Text(500),
  articles: z
    .array(z.strictObject({ url: Url, title: Text(500), summary: Text(4000), site: Text(200) }))
    .min(1)
    .max(12),
  house_style: Text(20_000),
  ai_budget_inr: Budget,
});
export type NewsDraftPayload = z.infer<typeof NewsDraftPayload>;

/** One Claude call's cost, logged by the API (app.ai_usage). */
export const AiUsage = z.strictObject({
  purpose: z.enum(["group", "draft", "rewrite", "photos"]),
  model: Text(100),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_read_tokens: z.number().int().min(0),
  cache_write_tokens: z.number().int().min(0),
  cost_inr: z.number().min(0),
});
export type AiUsage = z.infer<typeof AiUsage>;

const NewsBase = { org_id: OrgId, pub_id: Uuid7 };

export const NewsCollected = z.strictObject({
  kind: z.literal("news.collected"),
  ...NewsBase,
  run_id: Uuid7,
  sources: z.array(z.strictObject({ id: Uuid7, ok: z.boolean(), error: Text(500).nullable() })).max(100),
  items: z
    .array(
      z.strictObject({
        source_id: Uuid7,
        title: Text(500),
        summary: Text(2000),
        link: Url,
        published_at: z.iso.datetime({ offset: true }).nullable(),
        /** sha256 (hex) of the link */
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(5000),
  /** Claude's grouping of the new items (by link): into an existing topic (topic_id) or a new one */
  groups: z
    .array(
      z.strictObject({
        topic_id: Uuid7.nullable(),
        title_mr: Text(500),
        title_en: Text(500),
        importance: z.number().int().min(1).max(5),
        links: z.array(Url).min(1).max(200),
      }),
    )
    .max(1000),
  ai: AiState,
  usage: z.array(AiUsage).max(10),
});
export type NewsCollected = z.infer<typeof NewsCollected>;

export const NewsDrafted = z.strictObject({
  kind: z.literal("news.drafted"),
  ...NewsBase,
  draft_id: Uuid7,
  headline: Text(2000),
  byline: Text(2000),
  body: Text(200_000),
  sources: z.array(NewsSourceLink).min(1).max(12),
  flagged: z.array(Text(2000)).max(100),
  photos: z.array(PhotoCandidate).max(5),
  usage: z.array(AiUsage).max(10),
});
export type NewsDrafted = z.infer<typeof NewsDrafted>;

export const NewsDraftFailed = z.strictObject({
  kind: z.literal("news.draft_failed"),
  ...NewsBase,
  draft_id: Uuid7,
  code: z.string().regex(/^(ai|news)\.[a-z_]{1,60}$/),
  message: Text(2000),
  usage: z.array(AiUsage).max(10),
});
export type NewsDraftFailed = z.infer<typeof NewsDraftFailed>;
