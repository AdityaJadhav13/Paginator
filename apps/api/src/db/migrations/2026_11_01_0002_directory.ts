// The first application tables (docs/product/10-l2-newsroom-plan.md §3.3): org_settings, person, publication and
// audit_event. Every one has the organisation wall: row-level security, forced on the owner too, with a policy that
// lets a transaction see and write only its own organisation's rows. None of them is a content table, so none has the
// publication wall yet (stories and the rest, PR 16).
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- One row per organisation; org_id is Better Auth's organization id (in identity, which pgn_app cannot read).
    -- Every other row of the organisation refers to it.
    create table app.org_settings (
      org_id uuid primary key,
      mfa_required_roles text[] not null default '{owner,admin}',
      session_absolute_days integer not null default 30 check (session_absolute_days between 1 and 365),
      data_region text not null default 'IN' check (data_region = 'IN'),
      created_at timestamptz not null default now()
    );

    -- The organisation's own directory, so lists never join across to identity. Erasing a person clears the email
    -- (null) and replaces the name.
    create table app.person (
      org_id uuid not null references app.org_settings (org_id),
      user_id uuid not null,
      display_name text not null check (length(display_name) between 1 and 200),
      email text check (length(email) between 3 and 320),
      status text not null default 'active' check (status in ('active', 'removed')),
      joined_at timestamptz not null default now(),
      removed_at timestamptz,
      primary key (org_id, user_id),
      check ((status = 'removed') = (removed_at is not null))
    );

    create table app.publication (
      id uuid primary key default uuidv7(),
      org_id uuid not null references app.org_settings (org_id),
      name text not null check (length(name) between 1 and 200),
      slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
      languages text[] not null check (cardinality(languages) >= 1),
      primary_language text not null,
      digit_style text not null check (digit_style in ('latin', 'devanagari', 'arabic_indic')),
      timezone text not null default 'Asia/Kolkata',
      created_at timestamptz not null default now(),
      -- children name (org_id, id), so a row can never point at another organisation's publication
      unique (org_id, id),
      unique (org_id, slug),
      check (primary_language = any (languages))
    );

    -- Ids and small diffs only, never story text (plan §3.4); names are resolved through person when shown.
    create table app.audit_event (
      id uuid primary key default uuidv7(),
      org_id uuid not null references app.org_settings (org_id),
      publication_id uuid,
      actor_kind text not null check (actor_kind in ('user', 'system', 'import')),
      actor_id uuid,
      action text not null check (action ~ '^[a-z][a-z_]*([.][a-z][a-z_]*)+$'),
      target_type text not null check (length(target_type) between 1 and 64),
      target_id uuid,
      data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
      ip inet,
      user_agent text check (length(user_agent) <= 512),
      request_id text check (length(request_id) <= 128),
      at timestamptz not null default now(),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );
    create index audit_event_by_org on app.audit_event (org_id, at desc);
    create trigger append_only before update or delete on app.audit_event
      for each row execute function app.refuse_change();
    create trigger append_only_truncate before truncate on app.audit_event
      for each statement execute function app.refuse_change();

    alter table app.org_settings enable row level security;
    alter table app.org_settings force row level security;
    create policy org_wall on app.org_settings
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    alter table app.person enable row level security;
    alter table app.person force row level security;
    create policy org_wall on app.person
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    alter table app.publication enable row level security;
    alter table app.publication force row level security;
    create policy org_wall on app.publication
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    alter table app.audit_event enable row level security;
    alter table app.audit_event force row level security;
    create policy org_wall on app.audit_event
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));

    -- No DELETE anywhere yet: people and publications are removed or archived, not deleted. The audit log only grows.
    grant select, insert, update on app.org_settings, app.person, app.publication to pgn_app;
    grant select, insert on app.audit_event to pgn_app;
  `.execute(db);
}
