// The story desk's tables (docs/product/10-l2-newsroom-plan.md §3.3, §3.4, §5.4): sections, editions, stories, their
// revisions and status changes, story photos and comments. Each is a content table: the organisation wall and the
// restrictive publication wall, forced on the owner too.
// - Foreign keys include org_id and publication_id, so a row's parent is always in its own organisation and
//   publication. (A row may still name a sibling of its own publication it should not: a status change's comment may
//   be on another story. The API checks those.)
// - Ids are made by the database (uuidv7): for pgn_app a trigger replaces any id it sends, so the API never stores an
//   id a client chose, and an id cannot be used to probe for another tenant's row through its unique key. The other
//   unique keys include org_id and publication_id, so they never collide with a row of another publication either.
// - A revision's history is the database's: each new revision is open and numbered next, and its keys never change.
// Text limits are the Desk's (@pageinator/desk-text: lines 2,000 characters, bodies 200,000), counted in characters as
// the Desk counts them.
import { type Kysely, sql } from "kysely";

const STATUSES = "'draft', 'filed', 'editing', 'ready', 'held', 'spiked', 'placed'";

/** Row-level security on a content table: the organisation wall, and the publication wall (plan §3.2). */
function contentWalls(table: string): string {
  return `
    alter table app.${table} enable row level security;
    alter table app.${table} force row level security;
    create policy org_wall on app.${table}
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy pub_wall on app.${table} as restrictive
      using (publication_id = any ((select app.current_pubs())::uuid[]))
      with check (publication_id = any ((select app.current_pubs())::uuid[]));`;
}

/** For pgn_app, the row's id is the database's own, whatever the insert said (plan §3.3: server-made ids). */
function serverIds(table: string): string {
  return `
    create trigger server_id before insert on app.${table}
      for each row execute function app.server_id();`;
}

const ID_TABLES = ["section", "edition", "story", "comment", "story_status_change"];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Ids are uuidv7() and the database's: an id pgn_app sends is replaced (a client never chooses one).
    create function app.server_id() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        if session_user = 'pgn_app' then
          new.id := uuidv7();
        end if;
        return new;
      end
      $$;

    -- A publication's sections, in order. A section that is no longer used is archived, never deleted: stories keep it.
    create table app.section (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      name text not null check (length(name) between 1 and 200),
      color_tag text check (color_tag ~ '^[a-z][a-z0-9-]{0,31}$'),
      position integer not null default 0 check (position >= 0),
      archived_at timestamptz,
      created_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );

    -- One edition per publication and date (zones later). desk_key is the Desk's edition id, YYYY-MM-DD[-n], whose
    -- date is the edition's. Statuses: doc 04 §3.
    create table app.edition (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      edition_date date not null check (edition_date between '2000-01-01' and '2999-12-31'),
      desk_key text not null constraint edition_desk_key_check
        check (desk_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[1-9][0-9]{0,2})?$'
          and left(desk_key, 10) = to_char(edition_date, 'YYYY-MM-DD')),
      pages integer not null check (pages in (4, 8, 16)),
      back_page_ads boolean not null default true,
      volume text not null default '' check (length(volume) <= 200),
      issue text not null default '' check (length(issue) <= 200),
      price text not null default '' check (length(price) <= 200),
      status text not null default 'planning'
        check (status in ('planning', 'in_production', 'preflight', 'released', 'archived')),
      produced_in text not null default 'hosted' check (produced_in in ('hosted', 'desk')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, edition_date),
      unique (org_id, publication_id, desk_key),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );

    -- A story belongs to at most one edition at a time (plan §3.3). desk_key is the Desk's article id; current_rev is
    -- the number of its latest revision. Deleting a story sets deleted_at. Statuses: plan §5.4.
    create table app.story (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      edition_id uuid,
      desk_key text not null check (desk_key ~ '^a-[0-9a-f]{10}$'),
      status text not null default 'draft' check (status in (${sql.raw(STATUSES)})),
      current_rev integer not null default 1 check (current_rev >= 1),
      reporter_id uuid not null,
      assignee_id uuid,
      due_at timestamptz,
      section_id uuid,
      priority integer not null default 3 check (priority between 1 and 4),
      page_pin integer check (page_pin between 1 and 16),
      language text not null check (language ~ '^[a-z]{2,3}$'),
      origin text not null default 'typed' check (origin in ('typed', 'pasted', 'word', 'desk')),
      desk_note text not null default '' check (length(desk_note) <= 2000),
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, desk_key),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, publication_id, edition_id) references app.edition (org_id, publication_id, id),
      foreign key (org_id, publication_id, section_id) references app.section (org_id, publication_id, id),
      foreign key (org_id, reporter_id) references app.person (org_id, user_id),
      foreign key (org_id, assignee_id) references app.person (org_id, user_id)
    );
    create index story_by_edition on app.story (org_id, publication_id, edition_id, status);

    -- A story's text, revision by revision (plan §3.4). The open revision (closed_at null; at most one per story)
    -- takes its author's autosaves; once closed it never changes, and the trigger below refuses even the owner.
    create table app.story_revision (
      org_id uuid not null,
      publication_id uuid not null,
      story_id uuid not null,
      rev integer not null check (rev >= 1),
      headline text not null default '' check (length(headline) <= 2000),
      kicker text not null default '' check (length(kicker) <= 2000),
      deck text not null default '' check (length(deck) <= 2000),
      byline text not null default '' check (length(byline) <= 2000),
      body text not null default '' check (length(body) <= 200000),
      body_format text not null default 'desk-text/1' check (body_format = 'desk-text/1'),
      words integer not null default 0 check (words >= 0),
      author_id uuid not null,
      opened_at timestamptz not null default now(),
      closed_at timestamptz constraint story_revision_closed_at_check check (closed_at >= opened_at),
      primary key (org_id, publication_id, story_id, rev),
      foreign key (org_id, publication_id, story_id) references app.story (org_id, publication_id, id),
      foreign key (org_id, author_id) references app.person (org_id, user_id)
    );
    create unique index story_revision_one_open on app.story_revision (org_id, publication_id, story_id)
      where closed_at is null;

    create function app.refuse_closed_revision() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        if tg_op = 'TRUNCATE' then
          raise exception 'app.% keeps its closed revisions: TRUNCATE is not allowed', tg_table_name
            using errcode = 'restrict_violation';
        end if;
        if old.closed_at is not null then
          raise exception 'app.%: revision % of story % is closed, so % is not allowed', tg_table_name, old.rev,
            old.story_id, tg_op using errcode = 'restrict_violation';
        end if;
        return case when tg_op = 'DELETE' then old else new end;
      end
      $$;
    create trigger closed_revision before update or delete on app.story_revision
      for each row execute function app.refuse_closed_revision();
    create trigger closed_revision_truncate before truncate on app.story_revision
      for each statement execute function app.refuse_closed_revision();

    -- A new revision is open and the next of its story; it sees only the story's revisions its writer may read, so a
    -- revision for a story of another publication is numbered 1 and then refused by the walls, telling nothing.
    create function app.next_revision() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      declare
        next integer;
      begin
        if new.closed_at is not null then
          raise exception 'app.%: a new revision is open (closed_at is set when the next one starts)', tg_table_name
            using errcode = 'check_violation';
        end if;
        select coalesce(max(rev), 0) + 1 into next from app.story_revision
          where org_id = new.org_id and publication_id = new.publication_id and story_id = new.story_id;
        if new.rev is distinct from next then
          raise exception 'app.%: the next revision of story % is %, not %', tg_table_name, new.story_id, next, new.rev
            using errcode = 'check_violation';
        end if;
        return new;
      end
      $$;
    create trigger next_revision before insert on app.story_revision
      for each row execute function app.next_revision();

    -- A revision's keys never change. This runs after the walls' checks, so moving a row across a wall is refused by the
    -- wall itself, as the tenancy tests expect.
    create function app.fixed_revision_keys() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        if (new.org_id, new.publication_id, new.story_id, new.rev)
            is distinct from (old.org_id, old.publication_id, old.story_id, old.rev) then
          raise exception 'app.%: a revision keeps its story and its number', tg_table_name
            using errcode = 'restrict_violation';
        end if;
        return null;
      end
      $$;
    create trigger fixed_revision_keys after update on app.story_revision
      for each row execute function app.fixed_revision_keys();

    -- Comments on a story (pages join as targets in L2.4, which replaces the story key below). A reply is on its
    -- parent's story. Deleting a comment sets deleted_at.
    create table app.comment (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      target_type text not null default 'story' check (target_type = 'story'),
      target_id uuid not null,
      parent_id uuid,
      author_id uuid not null,
      body text not null check (length(body) between 1 and 10000),
      mentions uuid[] not null default '{}',
      resolved_at timestamptz,
      resolved_by uuid,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, publication_id, id),
      unique (org_id, publication_id, target_id, id),
      check ((resolved_at is null) = (resolved_by is null)),
      foreign key (org_id, publication_id, target_id) references app.story (org_id, publication_id, id),
      foreign key (org_id, publication_id, target_id, parent_id)
        references app.comment (org_id, publication_id, target_id, id),
      foreign key (org_id, author_id) references app.person (org_id, user_id),
      foreign key (org_id, resolved_by) references app.person (org_id, user_id)
    );
    create index comment_by_target on app.comment (org_id, publication_id, target_id, created_at);

    -- Every change of a story's status (plan §5.4), with the comment a send-back needs. changed_by is null for the
    -- system's own changes (Placed, L2.3). The history only grows: pgn_app may add and read, nothing else.
    create table app.story_status_change (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      publication_id uuid not null,
      story_id uuid not null,
      from_status text not null check (from_status in (${sql.raw(STATUSES)})),
      to_status text not null check (to_status in (${sql.raw(STATUSES)})),
      changed_by uuid,
      changed_at timestamptz not null default now(),
      comment_id uuid,
      check (from_status <> to_status),
      foreign key (org_id, publication_id, story_id) references app.story (org_id, publication_id, id),
      foreign key (org_id, changed_by) references app.person (org_id, user_id),
      foreign key (org_id, publication_id, comment_id) references app.comment (org_id, publication_id, id)
    );
    create index story_status_change_by_story on app.story_status_change (org_id, story_id, changed_at);

    -- A story's one photo (until the engine takes more). asset_id names app.asset, which arrives with the photo
    -- uploads (plan §10 PR 18, which adds this foreign key).
    create table app.story_photo (
      org_id uuid not null,
      publication_id uuid not null,
      story_id uuid not null,
      asset_id uuid not null,
      caption text not null default '' check (length(caption) <= 2000),
      credit text not null default '' check (length(credit) <= 2000),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id, story_id),
      foreign key (org_id, publication_id, story_id) references app.story (org_id, publication_id, id)
    );

    ${sql.raw(["section", "edition", "story", "story_revision", "comment", "story_status_change", "story_photo"].map(contentWalls).join("\n"))}
    ${sql.raw(ID_TABLES.map(serverIds).join("\n"))}

    -- Nothing is deleted but a story's photo (unlinked); the rest is archived, closed or soft-deleted.
    grant select, insert, update on app.section, app.edition, app.story, app.story_revision, app.comment to pgn_app;
    grant select, insert on app.story_status_change to pgn_app;
    grant select, insert, update, delete on app.story_photo to pgn_app;
  `.execute(db);
}
