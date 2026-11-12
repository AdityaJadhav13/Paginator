// The story bundle is streamed to the person who asks for it (docs/product/10-l2-newsroom-plan.md §10 PR 24: a ZIP
// made as it is sent, with reply.send(stream)), not kept in the work bucket: so a bundle has no object key, and its
// ZIP's SHA-256 is not known when the bundle is recorded. What it holds stays exact: desk_bundle_revision names every
// story's text revision and the revision it was sent at, and bundle.json carries each photo's SHA-256. The key's and the SHA-256's checks still hold for a
// bundle that is ever stored.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table app.desk_bundle alter column key drop not null;
    alter table app.desk_bundle alter column sha256 drop not null;
    -- the revision the bundle sent (bundle.json's \`revision\`: the story's version, which a caption or a photo change
    -- moves on too), beside the text revision it holds (rev, which keys to story_revision)
    alter table app.desk_bundle_revision add column version integer not null check (version >= 1);
  `.execute(db);
}
