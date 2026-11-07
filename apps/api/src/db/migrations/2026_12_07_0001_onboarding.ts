// Onboarding a new paper (docs/product/09-launch-plan.md §L4; packages/contracts/src/onboard.ts).
// - paper_onboarding: a publication's past edition PDFs read to learn its design (engine.onboard: tools/onboard, no
//   AI). queued until the worker's first heartbeat, working while it reports (heartbeat_at: its last onboard.progress,
//   and progress its step), then ready (the dataset bundle it made at onboarding/<id>/dataset.zip, pinned to its version
//   and SHA-256; each file's check and the report), rejected (an onboard.… code: the set cannot make a bundle), failed
//   (a worker.… code), cancelled, or used (an engine profile made from its bundle: profile_id). At most one active
//   (queued, working) a publication: a partial unique index. files: the inputs ({n, name, bytes, version_id, sha256},
//   each PDF copied to onboarding/<id>/pdfs/NN.pdf); inputs.json, written with the row, pinned by version and SHA-256.
//   The person who sent the files confirmed that the paper owns these pages and lets Pageinator read them.
// - upload: purpose onboard_pdf (application/pdf, at most 200 MiB, its file name kept: the edition's date may be read
//   from it), completed into an onboarding (onboarding_id).
// - engine_profile: made from an upload, from another profile, or from an onboarding's bundle (exactly one).
// - engine_event: onboard.progress, onboard.ready and onboard.rejected (asset_id: the onboarding); ready and rejected
//   may be up to 1 MiB of JSON (40 files' checks).
// - app.enqueue_engine_onboard (APP_ENQUEUE_ONBOARD: queue engine-cpu, job key onboard:<id>; cancel_engine_job takes
//   that key too).
// - Live hint on channel app_events (ids only): onboarding {org, pub, onboarding} after its state or progress changes.
// The new table has the organisation and the publication walls.
import { APP_ENQUEUE_ONBOARD } from "@pageinator/engine-queue";
import { type Kysely, sql } from "kysely";

const SHA = (column: string) => `${column} ~ '^[0-9a-f]{64}$'`;
const VERSION = (column: string) => `length(${column}) between 1 and 1024`;
const OBJ = (column: string) => `jsonb_typeof(${column}) = 'object'`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(APP_ENQUEUE_ONBOARD).execute(db);
  await sql
    .raw(
      `
    create table app.paper_onboarding (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      state text not null default 'queued'
        check (state in ('queued', 'working', 'ready', 'rejected', 'failed', 'cancelled', 'used')),
      inputs_key text not null generated always as
        ('orgs/' || org_id || '/pubs/' || publication_id || '/onboarding/' || id || '/inputs.json') stored,
      inputs_version_id text check (${VERSION("inputs_version_id")}),
      inputs_sha256 text check (${SHA("inputs_sha256")}),
      files jsonb not null check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) between 3 and 40),
      progress jsonb check (${OBJ("progress")}),
      checks jsonb check (jsonb_typeof(checks) = 'array'),
      report jsonb check (${OBJ("report")}),
      dataset_key text not null generated always as
        ('orgs/' || org_id || '/pubs/' || publication_id || '/onboarding/' || id || '/dataset.zip') stored,
      dataset_version_id text check (${VERSION("dataset_version_id")}),
      dataset_sha256 text check (${SHA("dataset_sha256")}),
      dataset_bytes bigint check (dataset_bytes between 1 and 4294967296),
      problem text check (problem ~ '^(onboard|worker)\\.[a-z_]{1,120}$'),
      params jsonb check (${OBJ("params")}),
      message text check (length(message) between 1 and 2000),
      profile_id uuid,
      permission_confirmed_by uuid not null,
      permission_confirmed_at timestamptz not null default now(),
      heartbeat_at timestamptz,
      created_by uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      check ((state in ('rejected', 'failed')) = (problem is not null)),
      check ((problem is null) = (message is null)),
      check (state not in ('ready', 'used') or (report is not null and dataset_version_id is not null
                                               and dataset_sha256 is not null and dataset_bytes is not null)),
      check ((state = 'used') = (profile_id is not null)),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, publication_id, profile_id) references app.engine_profile (org_id, publication_id, id),
      foreign key (org_id, permission_confirmed_by) references app.person (org_id, user_id),
      foreign key (org_id, created_by) references app.person (org_id, user_id)
    );
    -- one active a publication; the screen's question (newest first); the reconciler's (which still run)
    create unique index paper_onboarding_active on app.paper_onboarding (org_id, publication_id)
      where state in ('queued', 'working');
    create index paper_onboarding_by_pub on app.paper_onboarding (org_id, publication_id, created_at desc);
    create index paper_onboarding_running on app.paper_onboarding (org_id, publication_id, heartbeat_at)
      where state in ('queued', 'working');

    create trigger server_id before insert on app.paper_onboarding for each row execute function app.server_id();
    alter table app.paper_onboarding enable row level security;
    alter table app.paper_onboarding force row level security;
    create policy org_wall on app.paper_onboarding
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.paper_onboarding as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));
    -- an onboarding only changes state, never removed
    grant select, insert, update on app.paper_onboarding to pgn_app;

    alter table app.engine_profile add column onboarding_id uuid;
    alter table app.engine_profile drop constraint engine_profile_source;
    alter table app.engine_profile add constraint engine_profile_source
      check (num_nonnulls(upload_id, based_on, onboarding_id) = 1 and (based_on is null) = (template_choice is null));
    alter table app.engine_profile add constraint engine_profile_onboarding_fkey foreign key
      (org_id, publication_id, onboarding_id) references app.paper_onboarding (org_id, publication_id, id);

    alter table app.upload drop constraint upload_purpose_check;
    alter table app.upload add constraint upload_purpose_check
      check (purpose in ('story_photo', 'library', 'docx', 'engine_dataset', 'onboard_pdf'));
    alter table app.upload drop constraint upload_declared_type_check;
    alter table app.upload add constraint upload_declared_type_check check (
      (purpose = 'docx') = (declared_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      and (purpose = 'engine_dataset') = (declared_type = 'application/zip')
      and (purpose = 'onboard_pdf') = (declared_type = 'application/pdf')
      and declared_type in ('image/jpeg', 'image/png', 'image/webp',
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            'application/zip', 'application/pdf'));
    alter table app.upload drop constraint upload_declared_bytes_check;
    alter table app.upload add constraint upload_declared_bytes_check check (
      declared_bytes between 1 and case when purpose = 'engine_dataset' then 4294967296
                                        when purpose = 'onboard_pdf' then 209715200 else 41943040 end);
    alter table app.upload add column filename text check (length(filename) between 1 and 255);
    alter table app.upload add constraint upload_filename_purpose check ((purpose = 'onboard_pdf') = (filename is not null));
    alter table app.upload add column onboarding_id uuid;
    alter table app.upload drop constraint upload_completed_check;
    alter table app.upload add constraint upload_completed_check check ((status = 'completed') =
      (asset_id is not null or import_id is not null or engine_profile_id is not null or onboarding_id is not null));
    alter table app.upload add constraint upload_onboarding_fkey
      foreign key (org_id, publication_id, onboarding_id) references app.paper_onboarding (org_id, publication_id, id);

    alter table app.engine_event drop constraint engine_event_kind_check;
    alter table app.engine_event add constraint engine_event_kind_check
      check (kind in ('media.ready', 'media.rejected', 'import.parsed', 'import.rejected', 'news.collected',
                      'news.drafted', 'news.draft_failed', 'profile.ready', 'profile.rejected', 'measure.status',
                      'run.progress', 'run.page', 'run.finished', 'ad.ready', 'ad.rejected', 'onboard.progress',
                      'onboard.ready', 'onboard.rejected', 'job.failed'));
    alter table app.engine_event drop constraint engine_event_payload_check;
    alter table app.engine_event add constraint engine_event_payload_check
      check (jsonb_typeof(payload) = 'object'
             and length(payload::text) <= case when kind like 'news.%' then 16777216
                                               when kind in ('run.finished', 'profile.ready', 'onboard.ready',
                                                             'onboard.rejected') then 1048576
                                               else 65536 end);

    create function app.notify_onboarding() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'onboarding', 'org', new.org_id, 'pub', new.publication_id, 'onboarding', new.id)::text);
        return null;
      end
      $$;
    -- a heartbeat alone tells nobody
    create trigger notify_onboarding after insert or update of state, progress on app.paper_onboarding
      for each row execute function app.notify_onboarding();
  `,
    )
    .execute(db);
}
