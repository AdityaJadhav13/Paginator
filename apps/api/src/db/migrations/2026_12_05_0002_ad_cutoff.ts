// The ads cut-off (docs/product/10-l2-newsroom-plan.md §1 L2.6; packages/contracts/src/ads.ts, "The cut-off").
// - ad_settings: a publication's cut-off, `days_before` days before each edition date at `cutoff_time` (HH:MM, the
//   publication's timezone). No row means the defaults (18:00, 1 day before). cutoff_time is text HH:MM, cast to time
//   where it is used: the schema's generator maps no time type, and the API reads and writes it as HH:MM.
// - ad_cutoff_alert: the missing-artwork alert of one publication and edition date, recorded when it fires (inserted
//   ON CONFLICT DO NOTHING: only the inserter tells anyone, so it fires once even with two API instances), with the
//   bookings it named and how many people it told. Only added.
// - notification: kind ad_artwork_missing, about a publication (target_type publication, target_id the publication).
// Both tables have the organisation and the publication walls.
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
  await sql
    .raw(
      `
    create table app.ad_settings (
      org_id uuid not null,
      publication_id uuid not null,
      cutoff_time text not null default '18:00' check (cutoff_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      days_before integer not null default 1 check (days_before between 0 and 7),
      updated_by uuid,
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, updated_by) references app.person (org_id, user_id)
    );

    create table app.ad_cutoff_alert (
      org_id uuid not null,
      publication_id uuid not null,
      edition_date date not null check (edition_date between '2000-01-01' and '2999-12-31'),
      fired_at timestamptz not null default now(),
      bookings uuid[] not null,
      told integer not null check (told >= 0),
      primary key (org_id, publication_id, edition_date),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );

    ${["ad_settings", "ad_cutoff_alert"].map(WALLS).join("\n")}
    grant select, insert, update on app.ad_settings to pgn_app;
    grant select, insert on app.ad_cutoff_alert to pgn_app;

    alter table app.notification drop constraint notification_kind_check;
    alter table app.notification add constraint notification_kind_check
      check (kind in ('story_filed', 'story_sent_back', 'story_assigned', 'comment', 'invitation_accepted',
                      'ad_artwork_missing'));
    alter table app.notification drop constraint notification_target_type_check;
    alter table app.notification add constraint notification_target_type_check
      check (target_type in ('story', 'invitation', 'publication'));
  `,
    )
    .execute(db);
}
