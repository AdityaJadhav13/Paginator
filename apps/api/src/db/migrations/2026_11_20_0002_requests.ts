// Two records the stories API keeps (docs/product/10-l2-newsroom-plan.md §3.3, §5.1, §5.2): the Idempotency-Key of
// each create or transition, and each story bundle sent to the Desk with the revisions it holds. Bundle ids are the
// database's (app.server_id, migration 2026_11_20_0001).
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- One row per user and key, kept 24 hours (plan §5.1): status 'running' while the first request runs, then 'done'
    -- with the answer a replay gets. The key includes org_id (the plan names (user_id, key)): a user's key in one
    -- organisation must never collide with, or reveal, a row of another. The stored answers may hold any publication's
    -- stories and the row has no publication, so a restrictive policy keeps each row its own user's.
    create table app.idempotency_key (
      org_id uuid not null,
      user_id uuid not null,
      key uuid not null,
      route text not null check (length(route) between 1 and 200),
      request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
      status text not null default 'running' check (status in ('running', 'done')),
      response_status integer check (response_status between 100 and 599),
      response jsonb,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null default now() + interval '24 hours',
      primary key (org_id, user_id, key),
      check ((status = 'done') = (response_status is not null)),
      check ((response_status is null) = (response is null)),
      check (expires_at > created_at),
      foreign key (org_id, user_id) references app.person (org_id, user_id)
    );
    alter table app.idempotency_key enable row level security;
    alter table app.idempotency_key force row level security;
    create policy org_wall on app.idempotency_key
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy user_wall on app.idempotency_key as restrictive
      using (user_id = (select app.current_user())) with check (user_id = (select app.current_user()));

    -- A story bundle exported for the Desk (plan §2.5), and its object in the work bucket (plan §6.1). The key is exactly
    -- orgs/<its organisation>/pubs/<its publication>/desk-bundles/<a uuid>.zip: no other folder, no "..", no empty part.
    create table app.desk_bundle (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid not null,
      key text not null constraint desk_bundle_key_check check (key ~ ('^orgs/' || org_id || '/pubs/' || publication_id
        || '/desk-bundles/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]zip$')),
      sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
      created_by uuid not null,
      created_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, key),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id),
      foreign key (org_id, created_by) references app.person (org_id, user_id)
    );
    create trigger server_id before insert on app.desk_bundle for each row execute function app.server_id();

    -- The exact revisions a bundle holds, one per story: each a revision of the bundle's own publication.
    create table app.desk_bundle_revision (
      org_id uuid not null,
      publication_id uuid not null,
      bundle_id uuid not null,
      story_id uuid not null,
      rev integer not null,
      primary key (org_id, publication_id, bundle_id, story_id),
      foreign key (org_id, publication_id, bundle_id) references app.desk_bundle (org_id, publication_id, id),
      foreign key (org_id, publication_id, story_id, rev)
        references app.story_revision (org_id, publication_id, story_id, rev)
    );
    alter table app.desk_bundle enable row level security;
    alter table app.desk_bundle force row level security;
    create policy org_wall on app.desk_bundle
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.desk_bundle as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));
    alter table app.desk_bundle_revision enable row level security;
    alter table app.desk_bundle_revision force row level security;
    create policy org_wall on app.desk_bundle_revision
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.desk_bundle_revision as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));

    -- A key is claimed, answered, and dropped when its request fails or it expires; a bundle is a record, never
    -- changed.
    grant select, insert, update, delete on app.idempotency_key to pgn_app;
    grant select, insert on app.desk_bundle, app.desk_bundle_revision to pgn_app;
  `.execute(db);
}
