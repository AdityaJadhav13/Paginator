// Photo originals (docs/product/10-l2-newsroom-plan.md §3.3, §6; PR 18): uploads, assets, and the organisation's
// daily upload total.
// - upload: a presigned upload (plan §6.2), its object in quarantine at uploads/orgs/<org>/pubs/<pub>/<upload> until
//   it is completed or a day passes (the work bucket's lifecycle rule on uploads/). The key is the database's.
// - asset: a picture the API has read in full (its SHA-256, its type from its bytes, its size), copied out of
//   quarantine to orgs/<org>/pubs/<pub>/assets/<asset>/original, never altered after. The same bytes in one
//   publication are one asset (a photo seen in another publication would tell a reporter it is there, so not across
//   publications). Its id and key are the database's.
// - upload_quota: bytes presigned per organisation and day (plan §4.6: 2 GB), counted under the organisation wall only
//   (the uploads of publications a person cannot see still count), updated under a row lock.
// - story_photo's asset: the foreign key the content schema left for this PR.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table app.upload (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      user_id uuid not null,
      purpose text not null check (purpose = 'story_photo'),
      key text not null generated always as
        ('uploads/orgs/' || org_id || '/pubs/' || publication_id || '/' || id) stored,
      declared_type text not null check (declared_type in ('image/jpeg', 'image/png', 'image/webp')),
      declared_bytes integer not null check (declared_bytes between 1 and 41943040),
      status text not null default 'presigned' check (status in ('presigned', 'completed', 'rejected')),
      asset_id uuid,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      completed_at timestamptz,
      unique (org_id, publication_id, id),
      check ((status = 'completed') = (asset_id is not null)),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, user_id) references app.person (org_id, user_id)
    );
    create index upload_by_user on app.upload (org_id, user_id, created_at);

    create table app.asset (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      kind text not null default 'photo' check (kind = 'photo'),
      desk_key text not null check (desk_key ~ '^p-[0-9a-f]{10}$'),
      sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
      bytes integer not null check (bytes between 1 and 41943040),
      mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
      original_key text not null generated always as
        ('orgs/' || org_id || '/pubs/' || publication_id || '/assets/' || id || '/original') stored,
      version_id text check (length(version_id) between 1 and 1024),
      width_px integer not null check (width_px between 1 and 100000),
      height_px integer not null check (height_px between 1 and 100000),
      status text not null default 'received' check (status in ('received', 'ready', 'rejected')),
      photographer text not null default '' check (length(photographer) <= 2000),
      caption text not null default '' check (length(caption) <= 2000),
      credit text not null default '' check (length(credit) <= 2000),
      uploaded_by uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz,
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, desk_key),
      check (width_px::bigint * height_px <= 100000000),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, uploaded_by) references app.person (org_id, user_id)
    );
    create unique index asset_one_per_bytes on app.asset (org_id, publication_id, sha256)
      where deleted_at is null and status <> 'rejected';

    alter table app.upload add constraint upload_asset_fkey
      foreign key (org_id, publication_id, asset_id) references app.asset (org_id, publication_id, id);
    -- who completed an upload into an asset (a download of "their" picture), and the foreign key's lookups
    create index upload_asset on app.upload (org_id, publication_id, asset_id) where asset_id is not null;
    alter table app.story_photo add constraint story_photo_asset_fkey
      foreign key (org_id, publication_id, asset_id) references app.asset (org_id, publication_id, id);

    create table app.upload_quota (
      org_id uuid not null references app.org_settings (org_id),
      day date not null,
      bytes bigint not null default 0 check (bytes >= 0),
      primary key (org_id, day)
    );

    create trigger server_id before insert on app.upload for each row execute function app.server_id();
    create trigger server_id before insert on app.asset for each row execute function app.server_id();
  `.execute(db);
  for (const table of ["upload", "asset"]) {
    await sql
      .raw(
        `alter table app.${table} enable row level security;
         alter table app.${table} force row level security;
         create policy org_wall on app.${table}
           using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
         create policy pub_wall on app.${table} as restrictive
           using (publication_id = any ((select app.current_pubs())::uuid[]))
           with check (publication_id = any ((select app.current_pubs())::uuid[]));`,
      )
      .execute(db);
  }
  await sql`
    alter table app.upload_quota enable row level security;
    alter table app.upload_quota force row level security;
    create policy org_wall on app.upload_quota
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));

    -- an asset is deleted by setting deleted_at; an upload only changes state
    grant select, insert, update on app.upload, app.asset, app.upload_quota to pgn_app;
  `.execute(db);
}
