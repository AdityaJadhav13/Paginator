// The five sidebar screens (docs/product/10-l2-newsroom-plan.md §1 "As built (screens)"; doc 04 §6.1, §7.8; doc 06
// §10.1; doc 07 §12): Templates, Newsroom, Archive, Brand & masthead, Print profiles.
// - engine_profile: a profile may now be made from another one rather than from an upload (Templates, "Use this as the
//   <role> template"): based_on is that profile, template_choice the roles chosen ({role: page model name}); its
//   dataset is the same bundle, copied server side to its own key, and the engine sets it up again with that choice
//   (exactly one of upload_id and based_on). candidates: the pages of the dataset the engine's setup found able to
//   serve each role, each with its outline (packages/contracts/src/templates.ts); null for a profile set up before
//   this, or from a Desk config that names none. icc_sha256: the colour profile the worker had when it set it up.
// - edition_defaults: what "Create edition" fills in (the folio's volume and price, and the next issue number, which
//   goes up by one each time an edition is made with it). The engine prints the folio from the edition's own values.
// - print_profile: a publication's press details, numbered per publication (version 1, 2, …; each save is a new row,
//   only added). The newest is the one in use; a release records the one in use when it was approved
//   (release.print_profile_id).
// Every new table has the organisation and the publication walls.
import { type Kysely, sql } from "kysely";

const WALLS = (table: string) => `
    alter table app.${table} enable row level security;
    alter table app.${table} force row level security;
    create policy org_wall on app.${table}
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.${table} as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));`;

const TEXT = (column: string, max: number) => `length(${column}) between 1 and ${max}`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    alter table app.engine_profile alter column upload_id drop not null;
    alter table app.engine_profile add column based_on uuid;
    alter table app.engine_profile add column template_choice jsonb check (jsonb_typeof(template_choice) = 'object');
    alter table app.engine_profile add column candidates jsonb check (jsonb_typeof(candidates) = 'object');
    alter table app.engine_profile add column icc_sha256 text check (icc_sha256 ~ '^[0-9a-f]{64}$');
    alter table app.engine_profile add constraint engine_profile_source
      check ((upload_id is null) <> (based_on is null) and (based_on is null) = (template_choice is null));
    alter table app.engine_profile add constraint engine_profile_based_on_fkey
      foreign key (org_id, publication_id, based_on) references app.engine_profile (org_id, publication_id, id);

    create table app.edition_defaults (
      org_id uuid not null,
      publication_id uuid not null,
      volume text not null default '' check (length(volume) <= 40),
      price text not null default '' check (length(price) <= 40),
      next_issue integer check (next_issue between 1 and 999999),
      updated_by uuid,
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, updated_by) references app.person (org_id, user_id)
    );

    create table app.print_profile (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      version integer not null check (version >= 1),
      press_name text not null check (${TEXT("press_name", 200)}),
      contact text check (${TEXT("contact", 500)}),
      note text check (${TEXT("note", 2000)}),
      created_by uuid not null,
      created_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, version),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, created_by) references app.person (org_id, user_id)
    );

    alter table app.release add column print_profile_id uuid;
    alter table app.release add constraint release_print_profile_fkey
      foreign key (org_id, publication_id, print_profile_id) references app.print_profile (org_id, publication_id, id);
    -- the archive's question: releases by when they were approved
    create index release_by_time on app.release (org_id, publication_id, approved_at desc);

    create trigger server_id before insert on app.print_profile for each row execute function app.server_id();
    ${["edition_defaults", "print_profile"].map(WALLS).join("\n")}
    grant select, insert, update on app.edition_defaults to pgn_app;
    grant select, insert on app.print_profile to pgn_app;
  `,
    )
    .execute(db);
}
