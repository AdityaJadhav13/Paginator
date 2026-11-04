// The news finder in the database (docs/product/13-news-finder.md; migration 2026_12_01_0001), for src/modules/news.
// Every function runs under withTenant, so the organisation and publication walls apply: the scheduler and the
// engine's inbox run as the system's tenant of one organisation, like the engine sweep.
import { createHash } from "node:crypto";
import {
  NEWS_KEEP_DAYS,
  type AiUsage,
  type NewsCollected,
  NewsCollectPayload,
  NewsDraftPayload,
  type PhotoCandidate,
} from "@pageinator/contracts";
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

const KEEP = `${NEWS_KEEP_DAYS} days`;

// ---------------------------------------------------------------- sources and settings

export type SourceRow = {
  id: string;
  name: string;
  url: string;
  language: "mr" | "en";
  enabled: boolean;
  last_fetch_at: Date | null;
  last_error: string | null;
};
const SOURCE = ["id", "name", "url", "language", "enabled", "last_fetch_at", "last_error"] as const;

export async function listSources(tx: Tx, publicationId: string): Promise<SourceRow[]> {
  return (await tx
    .selectFrom("app.news_source")
    .select(SOURCE)
    .where("publication_id", "=", publicationId)
    .orderBy("name")
    .orderBy("id")
    .execute()) as SourceRow[];
}

export async function createSource(
  tx: Tx,
  orgId: string,
  publicationId: string,
  input: { name: string; url: string; language: string; enabled: boolean },
): Promise<SourceRow> {
  return (await tx
    .insertInto("app.news_source")
    .values({ org_id: orgId, publication_id: publicationId, ...input })
    .returning(SOURCE)
    .executeTakeFirstOrThrow()) as SourceRow;
}

export async function updateSource(
  tx: Tx,
  publicationId: string,
  id: string,
  patch: {
    name?: string | undefined;
    url?: string | undefined;
    language?: string | undefined;
    enabled?: boolean | undefined;
  },
): Promise<SourceRow | undefined> {
  return (await tx
    .updateTable("app.news_source")
    .set({ ...patch, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", id)
    .returning(SOURCE)
    .executeTakeFirst()) as SourceRow | undefined;
}

/** Removes the source and its items (the topics they leave empty go at the next collection). */
export async function deleteSource(tx: Tx, publicationId: string, id: string): Promise<boolean> {
  const done = await tx
    .deleteFrom("app.news_source")
    .where("publication_id", "=", publicationId)
    .where("id", "=", id)
    .returning("id")
    .executeTakeFirst();
  return done !== undefined;
}

export type SettingsRow = {
  house_style: string;
  collect_every_h: number;
  collected_at: Date | null;
  run_id: string | null;
  ai_state: "on" | "off" | "cap" | "failed" | null;
};

export async function findSettings(tx: Tx, publicationId: string): Promise<SettingsRow | undefined> {
  return (await tx
    .selectFrom("app.news_settings")
    .select(["house_style", "collect_every_h", "collected_at", "run_id", "ai_state"])
    .where("publication_id", "=", publicationId)
    .executeTakeFirst()) as SettingsRow | undefined;
}

export async function saveSettings(
  tx: Tx,
  orgId: string,
  publicationId: string,
  patch: { house_style?: string; collect_every_h?: number },
): Promise<void> {
  await tx
    .insertInto("app.news_settings")
    .values({ org_id: orgId, publication_id: publicationId, ...patch })
    .onConflict((conflict) =>
      conflict.columns(["org_id", "publication_id"]).doUpdateSet({ ...patch, updated_at: sql`now()` }),
    )
    .execute();
}

/** The AI spend of the publication today and this calendar month (Asia/Kolkata: the paper's day), in rupees. */
export async function spend(tx: Tx, publicationId: string): Promise<{ today: number; month: number }> {
  const { rows } = await sql<{ today: number; month: number }>`
    select
      coalesce(sum(cost_inr) filter (where created_at >=
        date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0)::float8 as today,
      coalesce(sum(cost_inr), 0)::float8 as month
    from app.ai_usage
    where publication_id = ${publicationId}
      and created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`.execute(tx);
  return rows[0] ?? { today: 0, month: 0 };
}

/** What may still be spent today: the cap less today's spend, never below 0. */
export async function budget(tx: Tx, publicationId: string, capInr: number): Promise<number> {
  return Math.max(0, Math.round((capInr - (await spend(tx, publicationId)).today) * 100) / 100);
}

export async function addUsage(tx: Tx, orgId: string, publicationId: string, usage: readonly AiUsage[]): Promise<void> {
  if (usage.length === 0) return;
  await tx
    .insertInto("app.ai_usage")
    .values(
      usage.map((u) => ({
        org_id: orgId,
        publication_id: publicationId,
        purpose: u.purpose,
        model: u.model,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_tokens: u.cache_read_tokens,
        cache_write_tokens: u.cache_write_tokens,
        cost_inr: String(u.cost_inr),
      })),
    )
    .execute();
}

// ---------------------------------------------------------------- collections

/** The publications with an enabled source whose last collection is older than their interval (or never ran). */
export async function duePublications(tx: Tx): Promise<string[]> {
  const { rows } = await sql<{ publication_id: string }>`
    select distinct s.publication_id from app.news_source s
    left join app.news_settings n on n.org_id = s.org_id and n.publication_id = s.publication_id
    where s.enabled
      and (n.collected_at is null or n.collected_at < now() - make_interval(hours => n.collect_every_h))
    order by s.publication_id`.execute(tx);
  return rows.map((row) => row.publication_id);
}

/** Marks a collection asked for now with a new run id, when it is due (or `force`): undefined when it is not (another
 * API instance, or the schedule, asked first). */
async function startRun(tx: Tx, orgId: string, publicationId: string, force: boolean): Promise<string | undefined> {
  const { rows } = await sql<{ run_id: string }>`
    insert into app.news_settings (org_id, publication_id, collected_at, run_id)
    values (${orgId}, ${publicationId}, now(), uuidv7())
    on conflict (org_id, publication_id) do update set collected_at = now(), run_id = uuidv7(), updated_at = now()
      where ${force} or app.news_settings.collected_at is null
        or app.news_settings.collected_at < now() - make_interval(hours => app.news_settings.collect_every_h)
    returning run_id`.execute(tx);
  return rows[0]?.run_id;
}

/** Asks the queue to collect the publication's enabled feeds (news.collect, in the caller's transaction): the links
 * stored already (by hash) and the last days' topics go with it, and what may still be spent on AI today. Returns
 * the run's id; undefined when no source is on, or the collection is not due (unless forced). */
export async function enqueueCollect(
  tx: Tx,
  orgId: string,
  publicationId: string,
  capInr: number,
  force: boolean,
): Promise<string | undefined> {
  const sources = await tx
    .selectFrom("app.news_source")
    .select(["id", "url", "language"])
    .where("publication_id", "=", publicationId)
    .where("enabled", "=", true)
    .orderBy("created_at")
    .limit(100)
    .execute();
  if (sources.length === 0) return undefined;
  const runId = await startRun(tx, orgId, publicationId, force);
  if (!runId) return undefined;
  const known = await tx
    .selectFrom("app.news_item")
    .select("hash")
    .where("publication_id", "=", publicationId)
    .orderBy("created_at", "desc")
    .limit(20_000)
    .execute();
  const topics = await tx
    .selectFrom("app.news_topic")
    .select(["id", "title_en", "title_mr"])
    .where("publication_id", "=", publicationId)
    .orderBy("created_at", "desc")
    .limit(300)
    .execute();
  const payload = NewsCollectPayload.parse({
    org_id: orgId,
    pub_id: publicationId,
    run_id: runId,
    sources,
    known: known.map((row) => row.hash),
    topics: topics.map((t) => ({ id: t.id, title: t.title_en || t.title_mr })),
    ai_budget_inr: await budget(tx, publicationId, capInr),
  });
  await sql`select app.enqueue_news_collect(${orgId}::uuid, ${JSON.stringify(payload)}::jsonb)`.execute(tx);
  return runId;
}

/** A collection's report, stored: its new items (those of a source the publication still has, whose hash is their
 * link's), Claude's groups merged into topics, every new item left out of a group made a topic of its own (so the
 * screen shows it with the AI off too), items and topics past NEWS_KEEP_DAYS removed, each source's last fetch, the AI
 * state. A repeat changes nothing: its items are stored and grouped already. Returns how many items and topics it
 * added. */
export async function storeCollection(
  tx: Tx,
  orgId: string,
  event: NewsCollected,
): Promise<{ items: number; topics: number }> {
  const pub = event.pub_id;
  const ours = new Set(
    (await tx.selectFrom("app.news_source").select("id").where("publication_id", "=", pub).execute()).map((r) => r.id),
  );
  const items = event.items.filter(
    (item) => ours.has(item.source_id) && createHash("sha256").update(item.link).digest("hex") === item.hash,
  );
  // in slices: Postgres takes at most 65535 parameters a statement
  let added = 0;
  for (let i = 0; i < items.length; i += 1000) {
    const made = await tx
      .insertInto("app.news_item")
      .values(
        items.slice(i, i + 1000).map((item) => ({
          org_id: orgId,
          publication_id: pub,
          source_id: item.source_id,
          title: item.title,
          summary: item.summary,
          link: item.link,
          hash: item.hash,
          published_at: item.published_at,
        })),
      )
      .onConflict((conflict) => conflict.columns(["org_id", "publication_id", "link"]).doNothing())
      .returning("id")
      .execute();
    added += made.length;
  }
  let topics = 0;
  const loose = async (links: readonly string[]) =>
    links.length === 0
      ? []
      : tx
          .selectFrom("app.news_item")
          .select(["id", "title"])
          .where("publication_id", "=", pub)
          .where("link", "in", [...links])
          .where("topic_id", "is", null)
          .execute();
  const group = async (topicId: string, ids: readonly string[]) =>
    tx
      .updateTable("app.news_item")
      .set({ topic_id: topicId })
      .where("publication_id", "=", pub)
      .where("id", "in", [...ids])
      .execute();
  const newTopic = async (t: { title_mr: string; title_en: string; importance: number }) => {
    topics += 1;
    return (
      await tx
        .insertInto("app.news_topic")
        .values({ org_id: orgId, publication_id: pub, ...t })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
  };
  for (const g of event.groups) {
    const members = await loose(g.links);
    if (members.length === 0) continue;
    const existing = g.topic_id
      ? await tx
          .selectFrom("app.news_topic")
          .select("id")
          .where("publication_id", "=", pub)
          .where("id", "=", g.topic_id)
          .executeTakeFirst()
      : undefined;
    const topicId =
      existing?.id ?? (await newTopic({ title_mr: g.title_mr, title_en: g.title_en, importance: g.importance }));
    await group(
      topicId,
      members.map((m) => m.id),
    );
  }
  for (const item of await loose(items.map((i) => i.link))) {
    await group(await newTopic({ title_mr: item.title, title_en: item.title, importance: 1 }), [item.id]);
  }
  await sql`delete from app.news_item where publication_id = ${pub} and created_at < now() - ${KEEP}::interval`.execute(
    tx,
  );
  await sql`delete from app.news_topic t where t.publication_id = ${pub}
    and not exists (select 1 from app.news_item i
                    where i.org_id = t.org_id and i.publication_id = t.publication_id and i.topic_id = t.id)`.execute(
    tx,
  );
  for (const source of event.sources) {
    if (!ours.has(source.id)) continue;
    await tx
      .updateTable("app.news_source")
      .set({ last_fetch_at: sql`now()`, last_error: source.ok ? null : (source.error ?? "").slice(0, 500) })
      .where("publication_id", "=", pub)
      .where("id", "=", source.id)
      .execute();
  }
  await saveAiState(tx, pub, event.ai);
  return { items: added, topics };
}

export async function saveAiState(tx: Tx, publicationId: string, state: NonNullable<SettingsRow["ai_state"]>) {
  await tx
    .updateTable("app.news_settings")
    .set({ ai_state: state, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .execute();
}

// ---------------------------------------------------------------- topics

export type TopicRow = {
  id: string;
  title_mr: string;
  title_en: string;
  importance: number;
  item_count: number;
  latest_at: Date;
  languages: ("mr" | "en")[];
  sources: { id: string; name: string }[];
};

/** The publication's topics (with at least one item), by distinct sources × recency: the count of distinct sources
 * divided by 1 + the hours since the newest item / 12 (a story of 3 sources 12 hours old ranks with one of 1.5 sources
 * now). With `language`, those with an item from a source of that language. `id`: that topic only. */
export async function listTopics(
  tx: Tx,
  publicationId: string,
  filter: { language?: string; id?: string; limit: number },
): Promise<TopicRow[]> {
  const { rows } = await sql<TopicRow>`
    select t.id, t.title_mr, t.title_en, t.importance, count(*)::int as item_count,
      least(max(coalesce(i.published_at, i.created_at)), now()) as latest_at,
      array_agg(distinct s.language order by s.language) as languages,
      jsonb_agg(distinct jsonb_build_object('id', s.id, 'name', s.name)) as sources
    from app.news_topic t
    join app.news_item i on i.org_id = t.org_id and i.publication_id = t.publication_id and i.topic_id = t.id
    join app.news_source s on s.org_id = i.org_id and s.publication_id = i.publication_id and s.id = i.source_id
    where t.publication_id = ${publicationId} and (${filter.id ?? null}::uuid is null or t.id = ${filter.id ?? null}::uuid)
    group by t.id
    having ${filter.language ?? null}::text is null or ${filter.language ?? null}::text = any (array_agg(s.language))
    order by count(distinct s.id)
        / (1 + extract(epoch from now() - least(max(coalesce(i.published_at, i.created_at)), now())) / 43200) desc,
      latest_at desc, t.id
    limit ${filter.limit}`.execute(tx);
  return rows.map((row) => ({
    ...row,
    sources: [...row.sources].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  }));
}

export type ItemRow = {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  summary: string;
  link: string;
  language: "mr" | "en";
  published_at: Date | null;
};

/** A topic's items, newest first. */
export async function topicItems(tx: Tx, publicationId: string, topicId: string, limit: number): Promise<ItemRow[]> {
  const { rows } = await sql<ItemRow>`
    select i.id, i.source_id, s.name as source_name, i.title, i.summary, i.link, s.language, i.published_at
    from app.news_item i
    join app.news_source s on s.org_id = i.org_id and s.publication_id = i.publication_id and s.id = i.source_id
    where i.publication_id = ${publicationId} and i.topic_id = ${topicId}
    order by coalesce(i.published_at, i.created_at) desc, i.id
    limit ${limit}`.execute(tx);
  return rows;
}

// ---------------------------------------------------------------- drafts

export type DraftRow = {
  id: string;
  user_id: string;
  topic_id: string | null;
  state: "queued" | "done" | "failed";
  language: "mr" | "en";
  length: "short" | "standard" | "long";
  find_photo: boolean;
  story_id: string | null;
  flagged: string[];
  photos: PhotoCandidate[];
  chosen_asset_id: string | null;
  problem: string | null;
  message: string | null;
  created_at: Date;
  updated_at: Date;
};
const DRAFT = [
  "id",
  "user_id",
  "topic_id",
  "state",
  "language",
  "length",
  "find_photo",
  "story_id",
  "flagged",
  "photos",
  "chosen_asset_id",
  "problem",
  "message",
  "created_at",
  "updated_at",
] as const;

export async function findDraft(tx: Tx, publicationId: string, id: string, lock = false) {
  const query = tx
    .selectFrom("app.news_draft_job")
    .select(DRAFT)
    .where("publication_id", "=", publicationId)
    .where("id", "=", id);
  return (await (lock ? query.forUpdate() : query).executeTakeFirst()) as DraftRow | undefined;
}

/** A pick: the draft's row and its job (news.draft), in the caller's transaction; returns the draft's id. */
export async function createDraft(
  tx: Tx,
  who: { orgId: string; userId: string },
  publicationId: string,
  pick: { topicId: string; language: "mr" | "en"; length: string; findPhoto: boolean },
  job: { title: string; articles: { url: string; title: string; summary: string; site: string }[]; budget: number },
): Promise<string> {
  const made = await tx
    .insertInto("app.news_draft_job")
    .values({
      org_id: who.orgId,
      publication_id: publicationId,
      user_id: who.userId,
      topic_id: pick.topicId,
      language: pick.language,
      length: pick.length,
      find_photo: pick.findPhoto,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const settings = await findSettings(tx, publicationId);
  const payload = NewsDraftPayload.parse({
    org_id: who.orgId,
    pub_id: publicationId,
    draft_id: made.id,
    language: pick.language,
    length: pick.length,
    find_photo: pick.findPhoto,
    title: job.title,
    articles: job.articles,
    house_style: settings?.house_style ?? "",
    ai_budget_inr: job.budget,
  });
  await sql`select app.enqueue_news_draft(${who.orgId}::uuid, ${JSON.stringify(payload)}::jsonb)`.execute(tx);
  return made.id;
}

export async function settleDraft(
  tx: Tx,
  publicationId: string,
  id: string,
  outcome:
    | { state: "done"; storyId: string; flagged: readonly string[]; photos: readonly PhotoCandidate[] }
    | { state: "failed"; problem: string; message: string },
): Promise<void> {
  const set =
    outcome.state === "done"
      ? {
          state: "done",
          story_id: outcome.storyId,
          flagged: JSON.stringify(outcome.flagged),
          photos: JSON.stringify(outcome.photos),
        }
      : { state: "failed", problem: outcome.problem, message: outcome.message.slice(0, 2000) };
  await tx
    .updateTable("app.news_draft_job")
    .set({ ...set, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", id)
    .execute();
}

export async function setChosenPhoto(tx: Tx, publicationId: string, id: string, assetId: string): Promise<void> {
  await tx
    .updateTable("app.news_draft_job")
    .set({ chosen_asset_id: assetId, updated_at: sql`now()` })
    .where("publication_id", "=", publicationId)
    .where("id", "=", id)
    .execute();
}

/** Drafts still queued past the deadline with no job left in the queue (`withJobs`, read by the sweep's system
 * reader) and no event waiting in the inbox: nothing will ever settle them. */
export async function strandedDrafts(tx: Tx, deadlineMs: number, withJobs: ReadonlySet<string>) {
  const { rows } = await sql<{ id: string; publication_id: string }>`
    select d.id, d.publication_id from app.news_draft_job d
    where d.state = 'queued' and d.updated_at < now() - ${deadlineMs} * interval '1 millisecond'
      and not (d.id = any (${[...withJobs]}::uuid[]))
      and not exists (select 1 from app.engine_event e
                      where e.org_id = d.org_id and e.asset_id = d.id and e.processed_at is null)
    order by d.updated_at limit 100`.execute(tx);
  return rows;
}
