// The engine's queue and its event inbox (docs/product/10-l2-newsroom-plan.md §2.2 "The API part", §3.1, §3.3; L2.2).
// - queue: Graphile Worker 0.18.0's own schema, installed in this migration's transaction (installQueueSchema:
//   its migrations as its migrate() applies them), then ENGINE_GRANTS (pgn_engine takes and finishes jobs, table by
//   table, with a policy per command) and APP_ENQUEUE (app.enqueue_media_ingest, SECURITY DEFINER, pgn_app's only way
//   to add a job: ids only, max_attempts 10, job_key asset:<id>, and only for app.current_org()). Nobody else may run a
//   queue function.
// - The sweep (src/modules/media/engine-inbox.ts) runs in the API as pgn_app under its own system reader's flag
//   ('engine-sweep', set by withSystem only; plain pgn_app sees no job): it may read the jobs and their task names
//   (exhaustedJobs, and "is there a job for this asset"), and delete only a job out of attempts and not held by a
//   worker that may still be alive (unlocked, or locked over an hour ago: the runner's time limit is at most an hour).
// - asset: 'received' is "its print versions are being made" (a job is enqueued with it); 'failed' is a job that could
//   not finish (job.failed, or the sweep's worker.lost), with its code in `problem`, as 'rejected' has the Desk's code
//   (m.img.*, or none when the Desk's message has none). A failed asset, like a rejected one, no longer holds its
//   bytes: the same picture sent again makes a new asset.
// - rendition: what media.ready made (preview, thumb, CMYK raster), each pinned to its version and SHA-256.
// - engine_event: the inbox. pgn_engine may only add a row (unprocessed, untried: a restrictive policy, so setting
//   app.org_id does not let it plant a processed row); pgn_app may add only an unprocessed job.failed (the sweep's);
//   the job id is unique, so a job's second report is dropped. An event that could not be applied (an error, not a
//   refusal) is tried again later: `tries` and `retry_at` keep its backoff durably, across API instances. The consumer finds unprocessed rows of every organisation under one named flag (app.system =
//   'engine-consumer', set by withSystem only), and applies each under withTenant of the row's organisation.
// - A change of an asset's status tells the stories it is the photo of (channel app_events, as a story change does),
//   so an open story editor fetches the photo's new state.
import { APP_ENQUEUE, ENGINE_GRANTS, installQueueSchema } from "@pageinator/engine-queue";
import { CompiledQuery, type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await installQueueSchema(async (text, values = []) => {
    const { rows } = await db.executeQuery<Record<string, unknown>>(CompiledQuery.raw(text, [...values]));
    return { rows };
  });
  await sql.raw(ENGINE_GRANTS).execute(db);
  await sql.raw(APP_ENQUEUE).execute(db);
  await sql`
    grant usage on schema queue to pgn_app;
    grant select, delete on queue._private_jobs to pgn_app;
    grant select on queue._private_tasks to pgn_app;
    create policy app_sweeps_jobs on queue._private_jobs for select to pgn_app
      using (current_setting('app.system', true) = 'engine-sweep');
    create policy app_removes_spent_jobs on queue._private_jobs for delete to pgn_app
      using (current_setting('app.system', true) = 'engine-sweep' and attempts >= max_attempts
             and (locked_at is null or locked_at < now() - interval '1 hour'));
    create policy app_reads_tasks on queue._private_tasks for select to pgn_app
      using (current_setting('app.system', true) = 'engine-sweep');

    alter table app.asset drop constraint asset_status_check;
    alter table app.asset add constraint asset_status_check
      check (status in ('received', 'ready', 'rejected', 'failed'));
    alter table app.asset add column problem text check (problem ~ '^(m|worker)\\.[A-Za-z0-9.]{1,120}$');
    -- only a rejected or failed asset names a problem
    alter table app.asset add constraint asset_problem_status
      check (problem is null or status in ('rejected', 'failed'));
    drop index app.asset_one_per_bytes;
    create unique index asset_one_per_bytes on app.asset (org_id, publication_id, sha256)
      where deleted_at is null and status not in ('rejected', 'failed');
    -- the sweep's question: which assets still wait for their print versions
    create index asset_waiting on app.asset (org_id, publication_id, updated_at)
      where status = 'received' and deleted_at is null;

    create table app.rendition (
      org_id uuid not null,
      publication_id uuid not null,
      asset_id uuid not null,
      purpose text not null check (purpose in ('preview', 'thumb', 'cmyk')),
      params_hash text not null check (params_hash ~ '^[0-9a-f]{32}$'),
      key text not null check (length(key) between 1 and 1024),
      version_id text not null check (length(version_id) between 1 and 1024),
      sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
      bytes integer not null check (bytes >= 0),
      mime text not null check (mime in ('image/jpeg', 'application/gzip')),
      width_px integer not null check (width_px between 1 and 100000),
      height_px integer not null check (height_px between 1 and 100000),
      created_at timestamptz not null default now(),
      primary key (org_id, publication_id, asset_id, purpose, params_hash),
      foreign key (org_id, publication_id, asset_id) references app.asset (org_id, publication_id, id)
    );
    alter table app.rendition enable row level security;
    alter table app.rendition force row level security;
    create policy org_wall on app.rendition
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.rendition as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));
    grant select, insert on app.rendition to pgn_app;

    create table app.engine_event (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      job_id text not null unique check (length(job_id) between 1 and 128),
      kind text not null check (kind in ('media.ready', 'media.rejected', 'job.failed')),
      asset_id uuid not null,
      payload jsonb not null check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 65536),
      created_at timestamptz not null default now(),
      processed_at timestamptz,
      outcome text check (outcome in ('applied', 'ignored', 'refused')),
      tries integer not null default 0 check (tries >= 0),
      retry_at timestamptz,
      check ((processed_at is null) = (outcome is null))
    );
    create index engine_event_waiting on app.engine_event (id) where processed_at is null;
    create index engine_event_asset on app.engine_event (org_id, asset_id) where processed_at is null;
    alter table app.engine_event enable row level security;
    alter table app.engine_event force row level security;
    create policy org_wall on app.engine_event
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    -- the engine writes for any organisation (the consumer checks the asset is that organisation's), never processed
    create policy engine_reports on app.engine_event for insert to pgn_engine
      with check (processed_at is null and outcome is null);
    -- and only such a row, whatever else it sets (org_wall would let it write a processed row of app.org_id's)
    create policy engine_reports_only on app.engine_event as restrictive for insert to pgn_engine
      with check (processed_at is null and outcome is null and tries = 0 and retry_at is null);
    -- the API adds only the sweep's job.failed, waiting
    create policy app_reports_lost on app.engine_event as restrictive for insert to pgn_app
      with check (kind = 'job.failed' and processed_at is null and outcome is null and tries = 0 and retry_at is null);
    -- the consumer finds the waiting events of every organisation, then applies each under its organisation's wall
    create policy engine_consumer on app.engine_event for select to pgn_app
      using (current_setting('app.system', true) = 'engine-consumer');
    grant usage on schema app to pgn_engine;
    grant insert on app.engine_event to pgn_engine;
    -- the organisation wall is checked on its insert too (its policies run with the inserter's rights): it reads a
    -- setting, nothing more
    grant execute on function app.current_org() to pgn_engine;
    grant select, insert on app.engine_event to pgn_app;
    grant update (processed_at, outcome, tries, retry_at) on app.engine_event to pgn_app;

    create function app.notify_asset() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'story', 'org', s.org_id, 'pub', s.publication_id, 'story', s.id,
          'people', array_remove(array[s.reporter_id, s.assignee_id], null))::text)
        from app.story_photo sp join app.story s
          on s.org_id = sp.org_id and s.publication_id = sp.publication_id and s.id = sp.story_id
        where sp.org_id = new.org_id and sp.publication_id = new.publication_id and sp.asset_id = new.id;
        return null;
      end
      $$;
    create trigger notify_asset after update of status on app.asset
      for each row when (old.status is distinct from new.status) execute function app.notify_asset();
  `.execute(db);
}
