// Editions and layout, hosted (docs/product/10-l2-newsroom-plan.md §1 L2.3, §2.2, §3.3; L2.3).
// - engine_profile: a publication's engine profile, numbered per publication (version 1, 2, …), made from a dataset
//   bundle (an upload of purpose engine_dataset, a ZIP of at most 4 GiB) copied out of quarantine to
//   orgs/<org>/pubs/<pub>/profiles/<id>/dataset.zip (pinned to its version and SHA-256). setting_up until the engine's
//   setup settles it: ready (the config the engine wrote at profiles/<id>/config.json, pinned; its templates, the
//   paper's column grid and the six plans: 4, 8, 16 pages with and without back-page ads) or failed (a profile.… or
//   worker.… code and the Desk's words). The newest ready one is the one in use.
// - layout_run: one run of an edition (desk_key r-YYYYMMDD-HHMMSS, unique per edition). Its frozen request is at
//   runs/<id>/request.json (pinned to its version and SHA-256, written with the row). At most one active run (queued,
//   planning, layout, finishing) per edition: a partial unique index. heartbeat_at is the worker's last run.progress
//   (the reconciler fails a run whose heartbeat stopped). not_placed: the Desk's article ids the run left out, with the
//   engine's reason; edition_pdf, press_zip: the stored files of a done run.
// - run_page: a run's page as the engine made it: its role, state, the Desk's article ids on it, its files (pdf, png,
//   thumb, the check's report: each {key, version_id, sha256, bytes}, under runs/<run>/), the independent check's
//   verdict, warnings and message. The L2.4 page editor's columns arrive with their defaults.
// - pdf_check: the independent PDF/X-1a checker's verdict on exact bytes, by (organisation, PDF SHA-256, checker
//   SHA-256), so the same bytes are never checked twice (plan §2.3). Organisation wall only: the key is a hash.
// - ad_slot_artwork: an edition's back-page ad slot and the media library picture fitted into it (media.ad): preparing
//   until ad.ready (its CMYK raster and preview) or failed (the Desk's words). Removed when the slot is cleared.
// - edition_measure: the edition's last measuring snapshot (editions/<id>/measure.json: its SHA-256, when it was
//   taken) and the engine's progress on it (waiting until the measure starts).
// - upload: purpose engine_dataset (application/zip, at most 4 GiB: declared_bytes becomes bigint), completed into an
//   engine profile (engine_profile_id) rather than an asset.
// - engine_event: the new kinds (profile.ready, profile.rejected, measure.status, run.progress, run.page, run.finished,
//   ad.ready, ad.rejected); for them asset_id holds the target: the profile, the edition, the run or the slot's
//   artwork row. profile.ready and run.finished may be up to 1 MiB of JSON (sixteen pages, 400 stories not placed);
//   others keep 64 KiB, news its 16 MiB.
// - app.enqueue_engine_setup/_measure/_layout, app.enqueue_media_ad and app.cancel_engine_job (APP_ENQUEUE_LAYOUT).
// - Live hints on channel app_events (ids only): layout {org, pub, edition, run|null} after a run's state, a page, an
//   ad slot or the measuring changes; profile {org, pub, profile} after a profile is made or settled.
// Every table has the organisation wall, and every table with a publication the publication wall.
import { APP_ENQUEUE_LAYOUT } from "@pageinator/engine-queue";
import { type Kysely, sql } from "kysely";

const WALLS = (table: string, pub = true) => `
    alter table app.${table} enable row level security;
    alter table app.${table} force row level security;
    create policy org_wall on app.${table}
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    ${
      pub
        ? `create policy pub_wall on app.${table} as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));`
        : ""
    }`;

const SHA = (column: string) => `${column} ~ '^[0-9a-f]{64}$'`;
const VERSION = (column: string) => `length(${column}) between 1 and 1024`;
const OBJ = (column: string) => `jsonb_typeof(${column}) = 'object'`;
const ACTIVE = "('queued', 'planning', 'layout', 'finishing')";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(APP_ENQUEUE_LAYOUT).execute(db);
  await sql
    .raw(
      `
    create table app.engine_profile (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      version integer not null check (version >= 1),
      state text not null default 'setting_up' check (state in ('setting_up', 'ready', 'failed')),
      upload_id uuid not null,
      dataset_key text not null generated always as
        ('orgs/' || org_id || '/pubs/' || publication_id || '/profiles/' || id || '/dataset.zip') stored,
      dataset_version_id text check (${VERSION("dataset_version_id")}),
      dataset_sha256 text not null check (${SHA("dataset_sha256")}),
      dataset_bytes bigint not null check (dataset_bytes between 1 and 4294967296),
      config_key text not null generated always as
        ('orgs/' || org_id || '/pubs/' || publication_id || '/profiles/' || id || '/config.json') stored,
      config_version_id text check (${VERSION("config_version_id")}),
      config_sha256 text check (${SHA("config_sha256")}),
      engine_version text check (length(engine_version) between 1 and 200),
      templates jsonb check (${OBJ("templates")}),
      grid jsonb check (${OBJ("grid")}),
      plans jsonb check (jsonb_typeof(plans) = 'array'),
      problem text check (problem ~ '^(profile|worker)\\.[a-z_]{1,120}$'),
      message jsonb check (${OBJ("message")}),
      created_by uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, version),
      check ((state = 'failed') = (problem is not null)),
      check (state <> 'ready' or (config_version_id is not null and config_sha256 is not null and grid is not null
                                  and plans is not null and templates is not null and engine_version is not null)),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, created_by) references app.person (org_id, user_id),
      foreign key (org_id, publication_id, upload_id) references app.upload (org_id, publication_id, id)
    );
    -- the one in use (the newest ready), and the sweep's question: which profiles still wait
    create index engine_profile_ready on app.engine_profile (org_id, publication_id, version desc) where state = 'ready';
    create index engine_profile_waiting on app.engine_profile (org_id, publication_id, updated_at)
      where state = 'setting_up';

    create table app.layout_run (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid not null,
      desk_key text not null check (desk_key ~ '^r-[0-9]{8}-[0-9]{6}$'),
      state text not null default 'queued'
        check (state in ('queued', 'planning', 'layout', 'finishing', 'done', 'failed', 'cancelled')),
      request_key text not null generated always as
        ('orgs/' || org_id || '/pubs/' || publication_id || '/runs/' || id || '/request.json') stored,
      request_version_id text check (${VERSION("request_version_id")}),
      request_sha256 text check (${SHA("request_sha256")}),
      profile_id uuid, -- null only for a run imported from the Desk (§3.8), made before any hosted profile
      engine_version text check (length(engine_version) between 1 and 200),
      worker_digest text check (length(worker_digest) between 1 and 200),
      checker_sha256 text check (${SHA("checker_sha256")}),
      timings jsonb check (${OBJ("timings")}),
      not_placed jsonb not null default '[]' check (jsonb_typeof(not_placed) = 'array'),
      edition_pdf jsonb check (${OBJ("edition_pdf")}),
      press_zip jsonb check (${OBJ("press_zip")}),
      message jsonb check (${OBJ("message")}),
      error jsonb check (${OBJ("error")}),
      elapsed_s double precision check (elapsed_s >= 0),
      heartbeat_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      created_by uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, edition_id, desk_key),
      check ((state in ${ACTIVE}) = (finished_at is null)),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id),
      foreign key (org_id, publication_id, profile_id) references app.engine_profile (org_id, publication_id, id),
      foreign key (org_id, created_by) references app.person (org_id, user_id)
    );
    -- one active run an edition; and the reconciler's and the Pages board's questions
    create unique index layout_run_active on app.layout_run (org_id, publication_id, edition_id)
      where state in ${ACTIVE};
    create index layout_run_by_edition on app.layout_run (org_id, publication_id, edition_id, created_at desc);
    create index layout_run_running on app.layout_run (org_id, publication_id, heartbeat_at) where state in ${ACTIVE};

    create table app.run_page (
      org_id uuid not null,
      publication_id uuid not null,
      run_id uuid not null,
      page_no integer not null check (page_no between 1 and 16),
      role text not null check (role in ('front', 'inside', 'back')),
      state text not null default 'waiting' check (state in ('waiting', 'working', 'done', 'failed', 'cancelled')),
      articles jsonb not null default '[]' check (jsonb_typeof(articles) = 'array'),
      pdf jsonb check (${OBJ("pdf")}),
      png jsonb check (${OBJ("png")}),
      thumb jsonb check (${OBJ("thumb")}),
      report jsonb check (${OBJ("report")}),
      pdf_sha256 text check (${SHA("pdf_sha256")}),
      checked jsonb check (${OBJ("checked")}),
      warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
      message jsonb check (${OBJ("message")}),
      seconds double precision check (seconds >= 0),
      edited boolean not null default false,
      edited_unsaved boolean not null default false,
      needs_save boolean not null default false,
      needs_save_reason text check (length(needs_save_reason) <= 200),
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id, run_id, page_no),
      check ((pdf is null) = (pdf_sha256 is null)),
      foreign key (org_id, publication_id, run_id) references app.layout_run (org_id, publication_id, id)
    );

    create table app.pdf_check (
      org_id uuid not null,
      sha256 text not null check (${SHA("sha256")}),
      checker_sha256 text not null check (${SHA("checker_sha256")}),
      passed boolean not null,
      fails integer check (fails >= 0),
      warnings integer check (warnings >= 0),
      report_key text check (length(report_key) between 1 and 1024),
      report_version_id text check (${VERSION("report_version_id")}),
      created_at timestamptz not null default now(),
      primary key (org_id, sha256, checker_sha256),
      foreign key (org_id) references app.org_settings (org_id)
    );

    create table app.ad_slot_artwork (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid not null,
      slot text not null check (slot ~ '^[A-Za-z0-9_-]{1,40}$'),
      asset_id uuid not null,
      w_mm numeric(7, 2) not null check (w_mm > 0),
      h_mm numeric(7, 2) not null check (h_mm > 0),
      state text not null default 'preparing' check (state in ('preparing', 'ready', 'failed')),
      raster jsonb check (${OBJ("raster")}),
      preview jsonb check (${OBJ("preview")}),
      params_hash text check (params_hash ~ '^[0-9a-f]{32}$'),
      problem jsonb check (${OBJ("problem")}),
      set_by uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, edition_id, slot),
      check ((state = 'ready') = (raster is not null)),
      check ((state = 'failed') = (problem is not null)),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id),
      foreign key (org_id, publication_id, asset_id) references app.asset (org_id, publication_id, id),
      foreign key (org_id, set_by) references app.person (org_id, user_id)
    );
    create index ad_slot_waiting on app.ad_slot_artwork (org_id, publication_id, updated_at) where state = 'preparing';

    create table app.edition_measure (
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid not null,
      sha256 text not null check (${SHA("sha256")}),
      version_id text not null check (${VERSION("version_id")}),
      state text not null default 'waiting' check (state in ('waiting', 'measuring', 'done', 'stopped', 'failed')),
      measured integer not null default 0 check (measured >= 0),
      total integer not null default 0 check (total >= 0),
      failed integer not null default 0 check (failed >= 0),
      snapshot_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id, edition_id),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id)
    );

    create trigger server_id before insert on app.engine_profile for each row execute function app.server_id();
    create trigger server_id before insert on app.layout_run for each row execute function app.server_id();
    create trigger server_id before insert on app.ad_slot_artwork for each row execute function app.server_id();
    ${["engine_profile", "layout_run", "run_page", "ad_slot_artwork", "edition_measure"].map((t) => WALLS(t)).join("\n")}
    ${WALLS("pdf_check", false)}
    -- profiles and runs only change state; pages are rewritten while their run goes on; a verdict is never changed;
    -- an ad slot's artwork is replaced and removed
    grant select, insert, update on app.engine_profile, app.layout_run, app.run_page, app.edition_measure to pgn_app;
    grant select, insert on app.pdf_check to pgn_app;
    grant select, insert, update, delete on app.ad_slot_artwork to pgn_app;

    alter table app.upload drop constraint upload_purpose_check;
    alter table app.upload add constraint upload_purpose_check
      check (purpose in ('story_photo', 'library', 'docx', 'engine_dataset'));
    alter table app.upload drop constraint upload_declared_type_check;
    alter table app.upload add constraint upload_declared_type_check check (
      (purpose = 'docx') = (declared_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      and (purpose = 'engine_dataset') = (declared_type = 'application/zip')
      and declared_type in ('image/jpeg', 'image/png', 'image/webp',
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            'application/zip'));
    alter table app.upload drop constraint upload_declared_bytes_check;
    alter table app.upload alter column declared_bytes type bigint;
    alter table app.upload add constraint upload_declared_bytes_check check (
      declared_bytes between 1 and case when purpose = 'engine_dataset' then 4294967296 else 41943040 end);
    alter table app.upload add column engine_profile_id uuid;
    alter table app.upload drop constraint upload_completed_check;
    alter table app.upload add constraint upload_completed_check check ((status = 'completed') =
      (asset_id is not null or import_id is not null or engine_profile_id is not null));
    alter table app.upload add constraint upload_engine_profile_fkey
      foreign key (org_id, publication_id, engine_profile_id) references app.engine_profile (org_id, publication_id, id);

    alter table app.engine_event drop constraint engine_event_kind_check;
    alter table app.engine_event add constraint engine_event_kind_check
      check (kind in ('media.ready', 'media.rejected', 'import.parsed', 'import.rejected', 'news.collected',
                      'news.drafted', 'news.draft_failed', 'profile.ready', 'profile.rejected', 'measure.status',
                      'run.progress', 'run.page', 'run.finished', 'ad.ready', 'ad.rejected', 'job.failed'));
    alter table app.engine_event drop constraint engine_event_payload_check;
    alter table app.engine_event add constraint engine_event_payload_check
      check (jsonb_typeof(payload) = 'object'
             and length(payload::text) <= case when kind like 'news.%' then 16777216
                                               when kind in ('run.finished', 'profile.ready') then 1048576
                                               else 65536 end);

    create function app.notify_layout() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      declare
        r record := coalesce(new, old);
        edition uuid;
        run uuid;
      begin
        if tg_table_name = 'run_page' then
          run := r.run_id;
          select lr.edition_id into edition from app.layout_run lr
            where lr.org_id = r.org_id and lr.publication_id = r.publication_id and lr.id = r.run_id;
        elsif tg_table_name = 'layout_run' then
          run := r.id;
          edition := r.edition_id;
        else
          edition := r.edition_id;
        end if;
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'layout', 'org', r.org_id, 'pub', r.publication_id, 'edition', edition,
          'run', run)::text);
        return null;
      end
      $$;
    -- a heartbeat alone tells nobody
    create trigger notify_layout after insert or update of state, message, error on app.layout_run
      for each row execute function app.notify_layout();
    create trigger notify_layout after insert or update on app.run_page
      for each row execute function app.notify_layout();
    create trigger notify_layout after insert or update or delete on app.ad_slot_artwork
      for each row execute function app.notify_layout();
    create trigger notify_layout after insert or update on app.edition_measure
      for each row execute function app.notify_layout();

    create function app.notify_profile() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'profile', 'org', new.org_id, 'pub', new.publication_id, 'profile', new.id)::text);
        return null;
      end
      $$;
    create trigger notify_profile after insert or update of state on app.engine_profile
      for each row execute function app.notify_profile();
  `,
    )
    .execute(db);
}
