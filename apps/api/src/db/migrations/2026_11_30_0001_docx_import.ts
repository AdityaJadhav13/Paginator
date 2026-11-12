// Word (.docx) imports (docs/product/10-l2-newsroom-plan.md §2.2, §5.3; L2.2): a Word file uploaded (purpose docx),
// read by the engine worker with the Desk's own code, its articles made stories by the API.
// - upload: purpose 'docx' (a Word file, at most 10 MiB, declared as its type), completed into an import (import_id)
//   rather than an asset.
// - import_job: one import, by its importer (user_id), of one Word file copied out of quarantine to
//   orgs/<org>/pubs/<pub>/imports/<id>/original (pinned to its version and SHA-256, never altered). Its state is
//   queued until the engine's event settles it: done, with the stories made (created: [{storyId, headline}]), how many
//   articles the stories' rules refused (skipped) and the Desk's notes; or failed, with a code (the Desk's docx.…, or
//   the engine's worker.…) and the Desk's plain message. 'running' is reserved (nothing sets it yet).
// - app.enqueue_docx_import: as app.enqueue_media_ingest (APP_ENQUEUE_DOCX: SECURITY DEFINER, pgn_app's only, ids
//   only, only for app.current_org()), job key import:<id>.
// - engine_event: its kinds take import.parsed and import.rejected; for docx.import's events (and a job.failed of
//   one) asset_id holds the import's id (the inbox's target, whatever it is).
// - A settled import tells its importer (channel app_events, type import: ids only), so an open import drawer reads it.
import { APP_ENQUEUE_DOCX } from "@pageinator/engine-queue";
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(APP_ENQUEUE_DOCX).execute(db);
  await sql`
    create table app.import_job (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      user_id uuid not null,
      kind text not null default 'docx' check (kind = 'docx'),
      edition_id uuid,
      upload_id uuid not null,
      original_key text not null generated always as
        ('orgs/' || org_id || '/pubs/' || publication_id || '/imports/' || id || '/original') stored,
      version_id text check (length(version_id) between 1 and 1024),
      sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
      bytes integer not null check (bytes between 1 and 10485760),
      state text not null default 'queued' check (state in ('queued', 'running', 'done', 'failed')),
      created jsonb not null default '[]' check (jsonb_typeof(created) = 'array'),
      skipped integer not null default 0 check (skipped >= 0),
      notes jsonb not null default '[]' check (jsonb_typeof(notes) = 'array'),
      problem text check (problem ~ '^(docx|worker|import)\\.[a-z_]{1,120}$'),
      message text check (length(message) <= 2000),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      check ((state = 'failed') = (problem is not null)),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, user_id) references app.person (org_id, user_id),
      foreign key (org_id, publication_id, upload_id) references app.upload (org_id, publication_id, id)
    );
    -- the sweep's question: which imports still wait
    create index import_waiting on app.import_job (org_id, publication_id, updated_at) where state = 'queued';
    create trigger server_id before insert on app.import_job for each row execute function app.server_id();
    alter table app.import_job enable row level security;
    alter table app.import_job force row level security;
    create policy org_wall on app.import_job
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.import_job as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));
    grant select, insert, update on app.import_job to pgn_app;

    alter table app.upload drop constraint upload_purpose_check;
    alter table app.upload add constraint upload_purpose_check
      check (purpose in ('story_photo', 'library', 'docx'));
    alter table app.upload drop constraint upload_declared_type_check;
    alter table app.upload add constraint upload_declared_type_check check (
      (purpose = 'docx') = (declared_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      and declared_type in ('image/jpeg', 'image/png', 'image/webp',
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    alter table app.upload add constraint upload_docx_bytes check (purpose <> 'docx' or declared_bytes <= 10485760);
    alter table app.upload add column import_id uuid;
    alter table app.upload drop constraint upload_check;
    alter table app.upload add constraint upload_completed_check
      check ((status = 'completed') = (asset_id is not null or import_id is not null));
    alter table app.upload add constraint upload_import_fkey
      foreign key (org_id, publication_id, import_id) references app.import_job (org_id, publication_id, id);

    alter table app.engine_event drop constraint engine_event_kind_check;
    alter table app.engine_event add constraint engine_event_kind_check
      check (kind in ('media.ready', 'media.rejected', 'import.parsed', 'import.rejected', 'job.failed'));

    create function app.notify_import() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'import', 'org', new.org_id, 'pub', new.publication_id, 'import', new.id,
          'user', new.user_id)::text);
        return null;
      end
      $$;
    create trigger notify_import after update of state on app.import_job
      for each row when (old.state is distinct from new.state) execute function app.notify_import();
  `.execute(db);
}
