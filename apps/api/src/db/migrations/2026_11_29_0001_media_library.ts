// The media library (docs/product/10-l2-newsroom-plan.md §5.3, L2.2): a picture's own facts (caption, credit,
// photographer) are edited on its version, an upload may go straight into the library, and the library lists the
// publication's pictures newest first.
// - asset.revision: the change counter a PATCH names (409 asset_changed when someone changed it first); pgn_app's
//   table-wide update (migration 2026_11_23_0001) covers it.
// - upload.purpose: 'library' beside 'story_photo' (the asset is the same; only where the person meant it differs).
// - asset_library: the list's order, (created_at, id) newest first, of the pictures not deleted.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table app.asset add column revision integer not null default 1 check (revision >= 1);
    alter table app.upload drop constraint upload_purpose_check;
    alter table app.upload add constraint upload_purpose_check check (purpose in ('story_photo', 'library'));
    create index asset_library on app.asset (org_id, publication_id, created_at desc, id desc)
      where deleted_at is null;
  `.execute(db);
}
