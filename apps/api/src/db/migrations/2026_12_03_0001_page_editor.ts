// The page editor, hosted (docs/product/10-l2-newsroom-plan.md §1 L2.4, §2.4, §3.3; packages/contracts/src/editor.ts).
// - page_edit: a page's revisions as the edit gateway answered them ({rev, modules}), append-only: Postgres always wins
//   (every call to the gateway carries each page's latest one). cause: the change that made it (set, alternative,
//   refresh, move, save), a move's target (moved_in), a page a save took a story from (taken), or none the API knows of
//   (engine: a revision the API caught up on). author_id null: the engine's own.
// - page_save: each save of a page in the editor: the revision saved and its PDF's SHA-256 (its independent check is
//   app.pdf_check's verdict on those bytes), append-only, for the page's history.
// - run_text_override: the run's text overrides (the Desk's edit-articles.json "articles"), one row a run.
// - page_lock: the soft lock on a page in the editor: its holder, the last heartbeat and when it lapses (75 s after it),
//   and who asked to take it over, when.
// - run_page: what the editor keeps of a page (editing.py's status.json fields): the revision its PDF was made from
//   (pdf_rev, 0: the layout's own) and the newest seen (rev_seen), the placement problems of its saved check and of the
//   editor's latest answer (layout_problems, layout_problems_now: null when none was noted; "unreadable" fails closed),
//   why it prints older content than the edition holds (stale), why it needs saving (needs_save_why, a DeskText), what
//   it prints (printed, deskprinted's record), and who saved it last, when.
// - Live hints: the layout hint (channel app_events, {org, pub, edition, run}) after a page's revision or lock changes,
//   so the Pages board and an open editor fetch the page again.
// Every table has the organisation and the publication walls.
import { type Kysely, sql } from "kysely";

const WALLS = (table: string) => `
    alter table app.${table} enable row level security;
    alter table app.${table} force row level security;
    create policy org_wall on app.${table}
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.${table} as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));`;

const OBJ = (column: string) => `jsonb_typeof(${column}) = 'object'`;
const ARR = (column: string) => `jsonb_typeof(${column}) = 'array'`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    create table app.page_edit (
      org_id uuid not null,
      publication_id uuid not null,
      run_id uuid not null,
      page_no integer not null check (page_no between 1 and 16),
      rev integer not null check (rev >= 0),
      modules jsonb not null check (${ARR("modules")} and jsonb_array_length(modules) <= 40),
      cause text not null
        check (cause in ('set', 'alternative', 'refresh', 'move', 'moved_in', 'save', 'taken', 'engine')),
      author_id uuid,
      created_at timestamptz not null default now(),
      primary key (org_id, publication_id, run_id, page_no, rev),
      foreign key (org_id, publication_id, run_id, page_no)
        references app.run_page (org_id, publication_id, run_id, page_no),
      foreign key (org_id, author_id) references app.person (org_id, user_id)
    );

    create table app.page_save (
      org_id uuid not null,
      publication_id uuid not null,
      run_id uuid not null,
      page_no integer not null check (page_no between 1 and 16),
      rev integer not null check (rev >= 0),
      pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
      saved_by uuid not null,
      saved_at timestamptz not null default now(),
      primary key (org_id, publication_id, run_id, page_no, rev, pdf_sha256),
      foreign key (org_id, publication_id, run_id, page_no)
        references app.run_page (org_id, publication_id, run_id, page_no),
      foreign key (org_id, saved_by) references app.person (org_id, user_id)
    );

    create table app.run_text_override (
      org_id uuid not null,
      publication_id uuid not null,
      run_id uuid not null,
      overrides jsonb not null check (${OBJ("overrides")}),
      updated_at timestamptz not null default now(),
      updated_by uuid,
      primary key (org_id, publication_id, run_id),
      foreign key (org_id, publication_id, run_id) references app.layout_run (org_id, publication_id, id),
      foreign key (org_id, updated_by) references app.person (org_id, user_id)
    );

    create table app.page_lock (
      org_id uuid not null,
      publication_id uuid not null,
      run_id uuid not null,
      page_no integer not null check (page_no between 1 and 16),
      holder_id uuid not null,
      heartbeat_at timestamptz not null default now(),
      expires_at timestamptz not null,
      asked_by uuid,
      asked_at timestamptz,
      primary key (org_id, publication_id, run_id, page_no),
      check ((asked_by is null) = (asked_at is null)),
      foreign key (org_id, publication_id, run_id, page_no)
        references app.run_page (org_id, publication_id, run_id, page_no),
      foreign key (org_id, holder_id) references app.person (org_id, user_id),
      foreign key (org_id, asked_by) references app.person (org_id, user_id)
    );

    alter table app.run_page
      add column pdf_rev integer not null default 0 check (pdf_rev >= 0),
      add column rev_seen integer not null default 0 check (rev_seen >= 0),
      add column layout_problems jsonb check (${ARR("layout_problems")}),
      add column layout_problems_now jsonb check (${ARR("layout_problems_now")}),
      add column stale jsonb not null default '[]' check (${ARR("stale")}),
      add column needs_save_why jsonb check (${OBJ("needs_save_why")}),
      add column printed jsonb check (${OBJ("printed")}),
      add column saved_at timestamptz,
      add column saved_by uuid,
      add constraint run_page_saved_by_fkey foreign key (org_id, saved_by) references app.person (org_id, user_id);

    ${["page_edit", "page_save", "run_text_override", "page_lock"].map(WALLS).join("\n")}
    -- revisions and saves are only added; the overrides are rewritten; a lock is taken, beaten, handed over and released
    grant select, insert on app.page_edit, app.page_save to pgn_app;
    grant select, insert, update on app.run_text_override to pgn_app;
    grant select, insert, update, delete on app.page_lock to pgn_app;

    create or replace function app.notify_layout() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      declare
        r record := coalesce(new, old);
        edition uuid;
        run uuid;
      begin
        if tg_table_name in ('run_page', 'page_edit', 'page_lock') then
          run := r.run_id;
          select lr.edition_id into edition from app.layout_run lr
            where lr.org_id = r.org_id and lr.publication_id = r.publication_id and lr.id = r.run_id;
        elsif tg_table_name = 'layout_run' then
          run := r.id;
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
    create trigger notify_layout after insert on app.page_edit
      for each row execute function app.notify_layout();
    -- a heartbeat alone tells nobody: only a lock taken, handed over, asked for or released
    create trigger notify_layout after insert or delete on app.page_lock
      for each row execute function app.notify_layout();
    create trigger notify_layout_update after update on app.page_lock
      for each row when (old.holder_id is distinct from new.holder_id or old.asked_by is distinct from new.asked_by)
      execute function app.notify_layout();
  `,
    )
    .execute(db);
}
