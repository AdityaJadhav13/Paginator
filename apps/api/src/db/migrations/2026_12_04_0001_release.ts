// Release (docs/product/10-l2-newsroom-plan.md §1 L2.5, §3.3; packages/contracts/src/release.ts).
// - page_approval: a page of a run approved on exact bytes (its revision and its PDF's SHA-256), by whom, when; and,
//   once withdrawn, who unlocked it, when. Only added, and only its unlock columns change: an approval counts while it
//   stands (not unlocked) and its (rev, pdf_sha256) are still the page's own (src/modules/release/preflight.ts).
// - release: an edition's release, numbered per edition (1, 2, …): the first is kind release, later ones correction.
//   Who approved it, its note, the run it came from, its manifest in the archive bucket (key, version, SHA-256: written
//   with the files, under Object Lock until retain_until) and when the archive copy was last read back and matched.
//   Only the manifest columns and verified_at change (written in the release's own transaction, and by a verify).
// - release_file: each file of a release: the page, its press name, the page revision and its SHA-256 and size, the
//   archived copy (key, version), and the file it replaces (a correction's). Only added.
// - delivery: "Mark as sent" (method download: the only one built): who, when, a note, the files and hashes as sent;
//   and the press's confirmation, recorded once (a trigger refuses a second): who at the press, when, a note, by whom.
// - press_test: the G2 evidence, one row per publication: the SHA-256 of the test page the press accepted, on which
//   date, a note, who recorded it, when. Rewritten when the owner records a newer one.
// Not built: doc 10 §3.3's preflight_run, preflight_issue and preflight_override. The preflight is computed live from
// what really runs, and nothing can be overridden (every check but not_placed stops a release).
// - Live hints: the layout hint (channel app_events, {org, pub, edition, run}) after an approval, a release or a
//   delivery changes, so the Pages board and the Release tab fetch again.
// - Write-once (triggers): an approval's unlock, a release's manifest (key, version, SHA-256), a delivery's confirmation.
// - layout_run.ad_rasters (the ad rasters its request held) and edition.folio_changed_at (PATCH …/editions/:e): the
//   preflight's ad_artwork and folio compare what the pages print with the edition now.
// - An unlock leaves older standing rows of other bytes as they are: they can never count again ((rev, sha) differ).
// Every table has the organisation and the publication walls; nothing here is ever deleted.
import { type Kysely, sql } from "kysely";

const WALLS = (table: string) => `
    alter table app.${table} enable row level security;
    alter table app.${table} force row level security;
    create policy org_wall on app.${table}
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.${table} as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));`;

const SHA = (column: string) => `${column} ~ '^[0-9a-f]{64}$'`;
const VERSION = (column: string) => `length(${column}) between 1 and 1024`;
const KEY = (column: string) => `length(${column}) between 1 and 1024`;
const NAME = (column: string) =>
  `${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[1-9][0-9]{0,2})?_P(0[1-9]|1[0-6])(_v[1-9][0-9]{0,3})?\\.pdf$'`;
const NOTE = (column: string) => `length(${column}) <= 2000`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    create table app.page_approval (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      run_id uuid not null,
      page_no integer not null check (page_no between 1 and 16),
      rev integer not null check (rev >= 0),
      pdf_sha256 text not null check (${SHA("pdf_sha256")}),
      approved_by uuid not null,
      approved_at timestamptz not null default now(),
      unlocked_by uuid,
      unlocked_at timestamptz,
      check ((unlocked_by is null) = (unlocked_at is null)),
      foreign key (org_id, publication_id, run_id, page_no)
        references app.run_page (org_id, publication_id, run_id, page_no),
      foreign key (org_id, approved_by) references app.person (org_id, user_id),
      foreign key (org_id, unlocked_by) references app.person (org_id, user_id)
    );
    create index page_approval_standing on app.page_approval (org_id, publication_id, run_id, page_no)
      where unlocked_at is null;

    create table app.release (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid not null,
      run_id uuid not null,
      number integer not null check (number >= 1),
      kind text not null check (kind in ('release', 'correction')),
      approved_by uuid not null,
      approved_at timestamptz not null default now(),
      note text check (${NOTE("note")}),
      manifest_key text check (${KEY("manifest_key")}),
      manifest_version_id text check (${VERSION("manifest_version_id")}),
      manifest_sha256 text check (${SHA("manifest_sha256")}),
      retain_until timestamptz not null,
      verified_at timestamptz,
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, edition_id, number),
      check ((number = 1) = (kind = 'release')),
      check ((manifest_sha256 is null) = (verified_at is null)
             and (manifest_sha256 is null) = (manifest_key is null)
             and (manifest_sha256 is null) = (manifest_version_id is null)),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id),
      foreign key (org_id, publication_id, run_id) references app.layout_run (org_id, publication_id, id),
      foreign key (org_id, approved_by) references app.person (org_id, user_id)
    );

    create table app.release_file (
      org_id uuid not null,
      publication_id uuid not null,
      release_id uuid not null,
      page_no integer not null check (page_no between 1 and 16),
      name text not null check (${NAME("name")}),
      rev integer not null check (rev >= 0),
      sha256 text not null check (${SHA("sha256")}),
      bytes integer not null check (bytes >= 1),
      archive_key text not null check (${KEY("archive_key")}),
      archive_version_id text not null check (${VERSION("archive_version_id")}),
      replaces text check (${NAME("replaces")}),
      primary key (org_id, publication_id, release_id, page_no),
      foreign key (org_id, publication_id, release_id) references app.release (org_id, publication_id, id)
    );

    create table app.delivery (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      release_id uuid not null,
      method text not null default 'download' check (method = 'download'),
      sent_by uuid not null,
      sent_at timestamptz not null default now(),
      note text check (${NOTE("note")}),
      files jsonb not null check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) between 1 and 16),
      press_person text check (length(press_person) between 1 and 200),
      confirmed_at timestamptz,
      confirm_note text check (${NOTE("confirm_note")}),
      confirmed_by uuid,
      check ((press_person is null) = (confirmed_at is null) and (press_person is null) = (confirmed_by is null)),
      check (press_person is not null or confirm_note is null),
      foreign key (org_id, publication_id, release_id) references app.release (org_id, publication_id, id),
      foreign key (org_id, sent_by) references app.person (org_id, user_id),
      foreign key (org_id, confirmed_by) references app.person (org_id, user_id)
    );

    create table app.press_test (
      org_id uuid not null,
      publication_id uuid not null,
      page_sha256 text not null check (${SHA("page_sha256")}),
      accepted_on date not null check (accepted_on between '2000-01-01' and '2999-12-31'),
      note text check (${NOTE("note")}),
      recorded_by uuid not null,
      recorded_at timestamptz not null default now(),
      primary key (org_id, publication_id),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, recorded_by) references app.person (org_id, user_id)
    );

    -- the press's confirmation is recorded once: a confirmed delivery never changes again
    create function app.confirm_once() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        if old.confirmed_at is not null then
          raise exception 'delivery % is already confirmed', old.id using errcode = 'check_violation';
        end if;
        return new;
      end
      $$;
    create trigger confirm_once before update on app.delivery
      for each row execute function app.confirm_once();

    -- an approval unlocked stays unlocked; a release's manifest, once written, is never repointed (only verified_at
    -- moves after it)
    create function app.unlock_once() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        if old.unlocked_at is not null then
          raise exception 'approval % is already unlocked', old.id using errcode = 'check_violation';
        end if;
        return new;
      end
      $$;
    create trigger unlock_once before update on app.page_approval
      for each row execute function app.unlock_once();
    create function app.manifest_once() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        if old.manifest_sha256 is not null and (new.manifest_key, new.manifest_version_id, new.manifest_sha256)
            is distinct from (old.manifest_key, old.manifest_version_id, old.manifest_sha256) then
          raise exception 'release % has its manifest already', old.id using errcode = 'check_violation';
        end if;
        return new;
      end
      $$;
    create trigger manifest_once before update on app.release
      for each row execute function app.manifest_once();

    -- what a run prints that the preflight compares with the edition now: the ad rasters its request held (slot →
    -- SHA-256; null: a run made before this, or imported from the Desk), and when the edition's folio last changed
    alter table app.layout_run add column ad_rasters jsonb check (jsonb_typeof(ad_rasters) = 'object');
    alter table app.edition add column folio_changed_at timestamptz;

    create trigger server_id before insert on app.page_approval for each row execute function app.server_id();
    create trigger server_id before insert on app.release for each row execute function app.server_id();
    create trigger server_id before insert on app.delivery for each row execute function app.server_id();
    ${["page_approval", "release", "release_file", "delivery", "press_test"].map(WALLS).join("\n")}
    -- approvals, releases, their files and deliveries are only added (an approval's unlock, a release's archive check
    -- and a delivery's confirmation are their only changes); the press test is rewritten
    grant select, insert on app.page_approval, app.release, app.release_file, app.delivery to pgn_app;
    grant update (unlocked_by, unlocked_at) on app.page_approval to pgn_app;
    grant update (manifest_key, manifest_version_id, manifest_sha256, verified_at) on app.release to pgn_app;
    grant update (press_person, confirmed_at, confirm_note, confirmed_by) on app.delivery to pgn_app;
    grant select, insert, update on app.press_test to pgn_app;

    create or replace function app.notify_layout() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      declare
        r record := coalesce(new, old);
        edition uuid;
        run uuid;
      begin
        if tg_table_name in ('run_page', 'page_edit', 'page_lock', 'page_approval') then
          run := r.run_id;
          select lr.edition_id into edition from app.layout_run lr
            where lr.org_id = r.org_id and lr.publication_id = r.publication_id and lr.id = r.run_id;
        elsif tg_table_name = 'layout_run' then
          run := r.id;
          edition := r.edition_id;
        elsif tg_table_name = 'delivery' then
          select rl.edition_id, rl.run_id into edition, run from app.release rl
            where rl.org_id = r.org_id and rl.publication_id = r.publication_id and rl.id = r.release_id;
        elsif tg_table_name = 'release' then
          run := r.run_id;
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
    create trigger notify_layout after insert or update on app.page_approval
      for each row execute function app.notify_layout();
    create trigger notify_layout after insert or update on app.release
      for each row execute function app.notify_layout();
    create trigger notify_layout after insert or update on app.delivery
      for each row execute function app.notify_layout();
  `,
    )
    .execute(db);
}
