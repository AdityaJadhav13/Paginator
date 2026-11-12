// A story's version (docs/product/10-l2-newsroom-plan.md §5.1 optimistic concurrency): every change of a story, its
// text, its fields, its state or its assignee, bumps it, and every write names the version it was based on (the API's
// baseRevision), so no change can silently overwrite another. The text keeps its own history in story_revision.
// updated_by names whoever made the last change (on a new story, its reporter, unless the insert names someone).
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table app.story add column version integer not null default 1 check (version >= 1);
    alter table app.story add column updated_by uuid;
    update app.story set updated_by = reporter_id;
    alter table app.story alter column updated_by set not null;
    alter table app.story add constraint story_updated_by_fkey
      foreign key (org_id, updated_by) references app.person (org_id, user_id);

    -- a new story was last changed by its reporter, unless the insert says otherwise
    create function app.story_updated_by() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        new.updated_by := coalesce(new.updated_by, new.reporter_id);
        return new;
      end
      $$;
    create trigger story_updated_by before insert on app.story
      for each row execute function app.story_updated_by();
  `.execute(db);
}
