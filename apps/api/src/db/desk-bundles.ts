// The story bundle's reads and records (docs/product/10-l2-newsroom-plan.md §3.3, §10 PR 24; tools/desk/CONTRACT.md §6),
// for src/modules/stories/desk-bundle.ts. Each function runs inside withTenant: the organisation and publication walls
// apply. A bundle records the exact revision of each story it holds (desk_bundle_revision).
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

export type BundleStory = {
  id: string;
  version: number;
  current_rev: number;
  headline: string;
  kicker: string;
  deck: string;
  byline: string;
  body: string;
  section: string | null;
  priority: number;
  page_pin: number | null;
  language: string;
  /** The story names a picture (story_photo), whatever state the picture is in. */
  photo_attached: boolean;
  photo_asset_id: string | null;
  photo_caption: string | null;
  photo_credit: string | null;
  photo_sha256: string | null;
  photo_mime: "image/jpeg" | "image/png" | "image/webp" | null;
  photo_bytes: number | null;
  photo_key: string | null;
  photo_version: string | null;
  photo_desk_key: string | null;
};

/** The edition's stories in these states (not deleted), oldest first, with their current text, section and photo.
 * A picture that was rejected or deleted (or has no pinned version) gives photo_attached with no asset fields: the caller
 * refuses such a story rather than send it without its photo at the same revision. At most `limit` rows. */
export async function bundleStories(
  tx: Tx,
  publicationId: string,
  editionId: string,
  statuses: readonly string[],
  limit: number,
): Promise<BundleStory[]> {
  const { rows } = await sql<BundleStory>`
    select s.id, s.version, s.current_rev, r.headline, r.kicker, r.deck, r.byline, r.body,
      sec.name as section, s.priority, s.page_pin, s.language,
      sp.asset_id is not null as photo_attached, a.id as photo_asset_id, sp.caption as photo_caption, sp.credit as photo_credit, a.sha256 as photo_sha256,
      a.mime as photo_mime, a.bytes as photo_bytes, a.original_key as photo_key, a.version_id as photo_version,
      a.desk_key as photo_desk_key
    from app.story s
    join app.story_revision r
      on r.org_id = s.org_id and r.publication_id = s.publication_id and r.story_id = s.id and r.rev = s.current_rev
    left join app.section sec on sec.org_id = s.org_id and sec.publication_id = s.publication_id and sec.id = s.section_id
    left join app.story_photo sp on sp.org_id = s.org_id and sp.publication_id = s.publication_id and sp.story_id = s.id
    left join app.asset a on a.org_id = sp.org_id and a.publication_id = sp.publication_id and a.id = sp.asset_id
      and a.status <> 'rejected' and a.deleted_at is null and a.version_id is not null
    where s.publication_id = ${publicationId} and s.edition_id = ${editionId} and s.deleted_at is null
      and s.status = any (${statuses as string[]}::text[])
    order by s.created_at, s.id
    limit ${limit}`.execute(tx);
  return rows;
}

/** Records a bundle and the revision of each story it holds; returns its id and when it was made. */
export async function recordBundle(
  tx: Tx,
  who: { orgId: string; userId: string },
  publicationId: string,
  editionId: string,
  stories: readonly { id: string; rev: number; version: number }[],
): Promise<{ id: string; created: string }> {
  const made = await tx
    .insertInto("app.desk_bundle")
    .values({ org_id: who.orgId, publication_id: publicationId, edition_id: editionId, created_by: who.userId })
    .returning([
      "id",
      sql<string>`to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS"+05:30"')`.as("created"),
    ])
    .executeTakeFirstOrThrow();
  if (stories.length > 0) {
    await tx
      .insertInto("app.desk_bundle_revision")
      .values(
        stories.map((story) => ({
          org_id: who.orgId,
          publication_id: publicationId,
          bundle_id: made.id,
          story_id: story.id,
          rev: story.rev,
          version: story.version,
        })),
      )
      .execute();
  }
  return { id: made.id, created: made.created };
}
