// Notifications and live updates (docs/product/10-l2-newsroom-plan.md §3.3, §5.2; 06 §11; PR 19).
// - notification: one person's in-app notice of something that happened (a story filed, sent back or given to them, a
//   comment, an invitation accepted). Its data holds ids only, never text: the web shows it by fetching what it names
//   through the routes that check access. The organisation wall, and a person reads and marks only their own (two
//   restrictive policies, for select and for update); anyone of the organisation may write one for another member,
//   since the person who acts is not the person told.
// - Live updates: after a change commits, Postgres tells the API on channel app_events (NOTIFY is delivered at commit,
//   and not at all when the transaction rolls back). Each message is a hint with ids only: a story that changed (with
//   its reporter and assignee, before and after, so the API can tell a Reporter of their own stories only), a comment
//   on one, or a notification for one person. The API checks who may hear it (src/modules/notifications/events.ts),
//   and the web fetches what changed through the authorised routes.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table app.notification (
      id uuid primary key default uuidv7(),
      org_id uuid not null,
      user_id uuid not null,
      kind text not null
        check (kind in ('story_filed', 'story_sent_back', 'story_assigned', 'comment', 'invitation_accepted')),
      target_type text not null check (target_type in ('story', 'invitation')),
      target_id uuid not null,
      data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
      read_at timestamptz,
      emailed_at timestamptz,
      created_at timestamptz not null default now(),
      foreign key (org_id, user_id) references app.person (org_id, user_id)
    );
    create index notification_by_user on app.notification (org_id, user_id, created_at desc, id desc);
    create index notification_unread on app.notification (org_id, user_id) where read_at is null;
    create trigger server_id before insert on app.notification for each row execute function app.server_id();

    alter table app.notification enable row level security;
    alter table app.notification force row level security;
    create policy org_wall on app.notification
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    create policy user_reads on app.notification as restrictive for select
      using (user_id = (select app.current_user()));
    create policy user_marks on app.notification as restrictive for update
      using (user_id = (select app.current_user())) with check (user_id = (select app.current_user()));
    -- a notification is never deleted, and only its read_at and emailed_at may change: pgn_app may update just those
    grant select, insert on app.notification to pgn_app;
    grant update (read_at, emailed_at) on app.notification to pgn_app;

    -- The live-update hints (channel app_events): a JSON object of ids, well under NOTIFY's 8000 bytes.
    create function app.notify_story() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'story', 'org', new.org_id, 'pub', new.publication_id, 'story', new.id,
          'people', array_remove(array[new.reporter_id, new.assignee_id,
            case when tg_op = 'UPDATE' then old.assignee_id end], null))::text);
        return null;
      end
      $$;
    create trigger notify_story after insert or update on app.story
      for each row execute function app.notify_story();

    create function app.notify_comment() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      declare
        reporter uuid;
        assignee uuid;
      begin
        select s.reporter_id, s.assignee_id into reporter, assignee from app.story s
          where s.org_id = new.org_id and s.publication_id = new.publication_id and s.id = new.target_id;
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'comment', 'org', new.org_id, 'pub', new.publication_id, 'story', new.target_id,
          'comment', new.id, 'people', array_remove(array[reporter, assignee], null))::text);
        return null;
      end
      $$;
    create trigger notify_comment after insert or update on app.comment
      for each row execute function app.notify_comment();

    create function app.notify_notification() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'notification', 'org', new.org_id, 'user', new.user_id, 'notification', new.id)::text);
        return null;
      end
      $$;
    create trigger notify_notification after insert on app.notification
      for each row execute function app.notify_notification();
  `.execute(db);
}
