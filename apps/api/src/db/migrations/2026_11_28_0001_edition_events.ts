// Live updates for editions (docs/product/10-l2-newsroom-plan.md §5.2; the editions screen): after an edition is made or
// changed, Postgres tells the API on channel app_events, as for stories (migration 2026_11_24_0001). The hint holds ids
// only; the API passes it to the people who may view the publication's editions (src/modules/notifications/events.ts).
// A story put in or taken out of an edition is a story change, which says so already.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function app.notify_edition() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        perform pg_notify('app_events', json_build_object(
          'v', 1, 'type', 'edition', 'org', new.org_id, 'pub', new.publication_id, 'edition', new.id)::text);
        return null;
      end
      $$;
    create trigger notify_edition after insert or update on app.edition
      for each row execute function app.notify_edition();
  `.execute(db);
}
