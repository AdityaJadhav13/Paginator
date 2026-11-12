// The ads desk and the edition plan (docs/product/10-l2-newsroom-plan.md §1 L2.6, §3.3; packages/contracts/src/ads.ts).
// - advertiser: a publication's advertiser, its contact and a note; archived, never deleted. One name (any case) among
//   those not archived.
// - ad_booking: a booking of an advertiser: a size (one of the profile's back-page slots, checked by the API), its
//   colour (recorded, never checked), a position rule (a named back-page slot, or null: any slot of its size), the
//   edition dates it runs on (1 to 366), booked or cancelled, and its artwork (a picture of the media library: who set
//   it, when). Never deleted.
// - ad_placement: a booking in one slot of one edition (placed_by null: by its rule). One booking a slot, and one slot
//   a booking, per edition. Removed when taken out.
// - flatplan_page: an edition page's planned section and its note to the designer.
// - Live hints: the layout hint (channel app_events, {org, pub, edition, run: null}) after a placement or a plan page
//   changes, so the edition screen fetches again.
// Every table has the organisation and the publication walls; only a placement is ever deleted.
import { type Kysely, sql } from "kysely";

const WALLS = (table: string) => `
    alter table app.${table} enable row level security;
    alter table app.${table} force row level security;
    create policy org_wall on app.${table}
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.${table} as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));`;

const LINE = (column: string) => `${column} text not null default '' check (length(${column}) <= 200)`;
const NOTE = (column: string) => `${column} text not null default '' check (length(${column}) <= 2000)`;
const SLOT = (column: string) => `${column} ~ '^[A-Za-z0-9_-]{1,40}$'`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    create table app.advertiser (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      name text not null check (length(name) between 1 and 200),
      ${LINE("contact_name")},
      ${LINE("phone")},
      ${LINE("email")},
      ${NOTE("note")},
      archived_at timestamptz,
      created_by uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, created_by) references app.person (org_id, user_id)
    );
    create unique index advertiser_name on app.advertiser (org_id, publication_id, lower(name))
      where archived_at is null;

    create table app.ad_booking (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      advertiser_id uuid not null,
      ${LINE("campaign")},
      w_mm numeric(7, 2) not null check (w_mm > 0),
      h_mm numeric(7, 2) not null check (h_mm > 0),
      colour text not null check (colour in ('colour', 'mono')),
      slot text check (${SLOT("slot")}),
      dates date[] not null check (cardinality(dates) between 1 and 366 and array_position(dates, null) is null),
      status text not null default 'booked' check (status in ('booked', 'cancelled')),
      ${NOTE("note")},
      artwork_asset_id uuid,
      artwork_set_by uuid,
      artwork_set_at timestamptz,
      created_by uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      check ((artwork_asset_id is null) = (artwork_set_at is null)),
      foreign key (org_id, publication_id, advertiser_id) references app.advertiser (org_id, publication_id, id),
      foreign key (org_id, publication_id, artwork_asset_id) references app.asset (org_id, publication_id, id),
      foreign key (org_id, artwork_set_by) references app.person (org_id, user_id),
      foreign key (org_id, created_by) references app.person (org_id, user_id)
    );
    -- the bookings of a date (placement, the plan, the cut-off)
    create index ad_booking_dates on app.ad_booking using gin (dates);

    create table app.ad_placement (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid not null,
      slot text not null check (${SLOT("slot")}),
      booking_id uuid not null,
      placed_by uuid,
      placed_at timestamptz not null default now(),
      unique (org_id, publication_id, edition_id, slot),
      unique (org_id, publication_id, edition_id, booking_id),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id),
      foreign key (org_id, publication_id, booking_id) references app.ad_booking (org_id, publication_id, id),
      foreign key (org_id, placed_by) references app.person (org_id, user_id)
    );
    create index ad_placement_booking on app.ad_placement (org_id, publication_id, booking_id);

    create table app.flatplan_page (
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid not null,
      page_no integer not null check (page_no between 1 and 16),
      section_id uuid,
      ${NOTE("note")},
      updated_by uuid not null,
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id, edition_id, page_no),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id),
      foreign key (org_id, publication_id, section_id) references app.section (org_id, publication_id, id),
      foreign key (org_id, updated_by) references app.person (org_id, user_id)
    );

    create trigger server_id before insert on app.advertiser for each row execute function app.server_id();
    create trigger server_id before insert on app.ad_booking for each row execute function app.server_id();
    create trigger server_id before insert on app.ad_placement for each row execute function app.server_id();
    ${["advertiser", "ad_booking", "ad_placement", "flatplan_page"].map(WALLS).join("\n")}
    -- advertisers are archived and bookings cancelled, never removed; a placement is taken out; plan pages rewritten
    grant select, insert, update on app.advertiser, app.ad_booking, app.flatplan_page to pgn_app;
    grant select, insert, update, delete on app.ad_placement to pgn_app;

    -- app.notify_layout (migration 2026_12_04_0001) reads edition_id of any other table, with no run
    create trigger notify_layout after insert or update or delete on app.ad_placement
      for each row execute function app.notify_layout();
    create trigger notify_layout after insert or update on app.flatplan_page
      for each row execute function app.notify_layout();
  `,
    )
    .execute(db);
}
