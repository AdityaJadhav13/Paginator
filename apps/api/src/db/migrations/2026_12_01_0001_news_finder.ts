// The news finder (docs/product/13-news-finder.md, L2.7): the sidebar's Sources screen.
// - news_settings: one row per publication (made by its first source, or its first settings change): the house style
//   guide drafts follow, how often the feeds are collected (collect_every_h), when the last collection was asked for
//   (collected_at) with its run id, and the AI part's state as the last run found it.
// - news_source: the feeds the publication lists (RSS or Atom), each on or off, with its last fetch and its problem.
// - news_item: what the feeds gave, one row per link and publication (hash: the link's SHA-256, which the queue is
//   sent so it skips what is stored already), kept NEWS_KEEP_DAYS days; topic_id is the topic Claude put it in.
// - news_topic: the same event across sources (Claude's grouping), its titles in Marathi and English and Claude's
//   importance; kept as long as its items.
// - news_draft_job: a topic picked by an editor (user_id), drafted by the queue (news.draft): queued until the inbox
//   settles it: done (the Draft story made, assigned to the picker; the photos offered; the sentences the copy check
//   still flags) or failed (its code: ai.…, news.… or worker.…). chosen_asset_id: the photo the editor chose.
// - ai_usage: every Claude call's tokens and cost in rupees (the spend shown, and the day's cap).
// - asset: a found photo's licence (its name and link), the page it came from, and the label code gave it (safe or
//   needs_permission); "We have the right to print this" ticked by whom and when (both or neither).
// - story: origin 'news'; made_with_claude while the text is as Claude drafted it; news_sources, the draft's sources.
// - engine_event: its kinds take news.collected, news.drafted and news.draft_failed; for news jobs asset_id holds the
//   run's id (news.collect) or the draft's (news.draft). A news event may be larger (a collection's items, a draft's
//   text): up to 16 MiB of JSON text, other kinds keep 64 KiB.
// - app.enqueue_news_collect and app.enqueue_news_draft (APP_ENQUEUE_NEWS): SECURITY DEFINER, pgn_app's only, only for
//   app.current_org().
// Every table has the organisation wall and the publication wall, as the content tables do.
import { APP_ENQUEUE_NEWS } from "@pageinator/engine-queue";
import { type Kysely, sql } from "kysely";

const WALLS = (table: string) => `
    alter table app.${table} enable row level security;
    alter table app.${table} force row level security;
    create policy org_wall on app.${table}
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.${table} as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(APP_ENQUEUE_NEWS).execute(db);
  await sql`
    create table app.news_settings (
      org_id uuid not null,
      publication_id uuid not null,
      house_style text not null default '' check (length(house_style) <= 20000),
      collect_every_h integer not null default 3 check (collect_every_h between 1 and 24),
      collected_at timestamptz,
      run_id uuid,
      ai_state text check (ai_state in ('on', 'off', 'cap', 'failed')),
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );

    create table app.news_source (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      name text not null check (length(name) between 1 and 200),
      url text not null check (length(url) between 1 and 2048 and url ~ '^https?://'),
      language text not null check (language in ('mr', 'en')),
      enabled boolean not null default true,
      last_fetch_at timestamptz,
      last_error text check (length(last_error) <= 500),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );

    create table app.news_topic (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      title_mr text not null check (length(title_mr) <= 500),
      title_en text not null check (length(title_en) <= 500),
      importance integer not null check (importance between 1 and 5),
      created_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );

    create table app.news_item (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      source_id uuid not null,
      topic_id uuid,
      title text not null check (length(title) <= 500),
      summary text not null check (length(summary) <= 2000),
      link text not null check (length(link) between 1 and 2048),
      hash text not null check (hash ~ '^[0-9a-f]{64}$'),
      published_at timestamptz,
      created_at timestamptz not null default now(),
      unique (org_id, publication_id, link),
      unique (org_id, publication_id, id),
      -- a source removed takes its items with it
      foreign key (org_id, publication_id, source_id) references app.news_source (org_id, publication_id, id)
        on delete cascade,
      foreign key (org_id, publication_id, topic_id) references app.news_topic (org_id, publication_id, id)
        on delete set null (topic_id)
    );
    create index news_item_topic on app.news_item (org_id, publication_id, topic_id);
    create index news_item_age on app.news_item (org_id, publication_id, created_at);

    create table app.news_draft_job (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      user_id uuid not null,
      topic_id uuid,
      language text not null check (language in ('mr', 'en')),
      length text not null check (length in ('short', 'standard', 'long')),
      find_photo boolean not null,
      state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
      story_id uuid,
      photos jsonb not null default '[]' check (jsonb_typeof(photos) = 'array'),
      flagged jsonb not null default '[]' check (jsonb_typeof(flagged) = 'array'),
      chosen_asset_id uuid,
      problem text check (problem ~ '^(ai|news|worker)\\.[a-z_]{1,120}$'),
      message text check (length(message) <= 2000),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      check ((state = 'failed') = (problem is not null)),
      check ((state = 'done') = (story_id is not null)),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, user_id) references app.person (org_id, user_id),
      -- a topic is kept NEWS_KEEP_DAYS days; the draft outlives it
      foreign key (org_id, publication_id, topic_id) references app.news_topic (org_id, publication_id, id)
        on delete set null (topic_id),
      foreign key (org_id, publication_id, story_id) references app.story (org_id, publication_id, id),
      foreign key (org_id, publication_id, chosen_asset_id) references app.asset (org_id, publication_id, id)
    );
    -- the sweep's question: which drafts still wait
    create index news_draft_waiting on app.news_draft_job (org_id, publication_id, updated_at) where state = 'queued';

    create table app.ai_usage (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      purpose text not null check (purpose in ('group', 'draft', 'rewrite', 'photos')),
      model text not null check (length(model) between 1 and 100),
      input_tokens integer not null check (input_tokens >= 0),
      output_tokens integer not null check (output_tokens >= 0),
      cache_read_tokens integer not null check (cache_read_tokens >= 0),
      cache_write_tokens integer not null check (cache_write_tokens >= 0),
      cost_inr numeric(14, 4) not null check (cost_inr >= 0),
      created_at timestamptz not null default now(),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );
    create index ai_usage_day on app.ai_usage (org_id, publication_id, created_at);
  `.execute(db);
  for (const table of ["news_settings", "news_source", "news_topic", "news_item", "news_draft_job", "ai_usage"]) {
    // ids are the database's (news_settings has none of its own: its key is the publication)
    const ids =
      table === "news_settings"
        ? ""
        : `create trigger server_id before insert on app.${table} for each row execute function app.server_id();`;
    await sql.raw(ids + WALLS(table)).execute(db);
  }
  await sql`
    -- settings change; sources are edited and removed; items and topics are purged after NEWS_KEEP_DAYS days; drafts
    -- only change state; spend only grows
    grant select, insert, update on app.news_settings to pgn_app;
    grant select, insert, update, delete on app.news_source to pgn_app;
    grant select, insert, update, delete on app.news_topic to pgn_app;
    grant select, insert, update, delete on app.news_item to pgn_app;
    grant select, insert, update on app.news_draft_job to pgn_app;
    grant select, insert on app.ai_usage to pgn_app;

    alter table app.asset add column licence_name text check (length(licence_name) <= 100);
    alter table app.asset add column licence_url text check (length(licence_url) <= 2048);
    alter table app.asset add column source_url text check (length(source_url) <= 2048);
    alter table app.asset add column licence_label text check (licence_label in ('safe', 'needs_permission'));
    alter table app.asset add column rights_confirmed_by uuid;
    alter table app.asset add column rights_confirmed_at timestamptz;
    -- a found photo has its source and label, or neither; the tick is who and when, or neither
    alter table app.asset add constraint asset_licence_label check ((licence_label is null) = (source_url is null));
    alter table app.asset add constraint asset_rights_confirmed
      check ((rights_confirmed_by is null) = (rights_confirmed_at is null));
    alter table app.asset add constraint asset_rights_confirmed_by_fkey
      foreign key (org_id, rights_confirmed_by) references app.person (org_id, user_id);

    alter table app.story drop constraint story_origin_check;
    alter table app.story add constraint story_origin_check
      check (origin in ('typed', 'pasted', 'word', 'desk', 'news'));
    alter table app.story add column made_with_claude boolean not null default false;
    alter table app.story add column news_sources jsonb check (jsonb_typeof(news_sources) = 'array');
    alter table app.story add constraint story_news_only
      check (origin = 'news' or (news_sources is null and not made_with_claude));

    alter table app.engine_event drop constraint engine_event_kind_check;
    alter table app.engine_event add constraint engine_event_kind_check
      check (kind in ('media.ready', 'media.rejected', 'import.parsed', 'import.rejected', 'news.collected',
                      'news.drafted', 'news.draft_failed', 'job.failed'));
    alter table app.engine_event drop constraint engine_event_payload_check;
    alter table app.engine_event add constraint engine_event_payload_check
      check (jsonb_typeof(payload) = 'object'
             and length(payload::text) <= case when kind like 'news.%' then 16777216 else 65536 end);
  `.execute(db);
}
