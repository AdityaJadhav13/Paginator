// The archive in the database (doc 06 §10.1; packages/contracts/src/archive.ts), for src/modules/release/archive.ts:
// the publication's releases by edition date, filtered, and searched over the stories the released run placed. Every
// function runs under withTenant (the organisation and publication walls, and the stories' own walls, apply).
import type { ArchiveStoryHit } from "@pageinator/contracts";
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

export type ArchiveRow = {
  id: string;
  edition_id: string;
  run_id: string;
  number: number;
  kind: "release" | "correction";
  approved_at: Date;
  retain_until: Date;
  edition_date: string;
  files: number;
  front_thumb: boolean;
  matches: ArchiveStoryHit[];
};

export type ArchiveFilter = {
  year?: number;
  month?: number;
  kind?: "release" | "correction";
  q?: string;
  /** whose stories the search may name: the story rules' scope (all; a Reporter's own; none) */
  stories?: { scope: "all" } | { scope: "own"; userId: string } | { scope: "none" };
};

/** A LIKE pattern that finds the text anywhere, its own % and _ taken literally. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** The releases (archived: their manifest written), newest edition first, at most `limit`. */
export async function archiveReleases(
  tx: Tx,
  publicationId: string,
  filter: ArchiveFilter,
  limit: number,
): Promise<ArchiveRow[]> {
  const like = filter.q === undefined ? null : contains(filter.q);
  // the stories on the run's pages (run_page.articles: their Desk ids) whose headline now, reporter or section match
  const hits = sql`
    select s.id as "storyId", sr.headline, rp.display_name as reporter, sec.name as section
    from app.run_page p
    cross join lateral jsonb_array_elements_text(p.articles) as a(key)
    join app.story s on s.org_id = p.org_id and s.publication_id = p.publication_id and s.desk_key = a.key
      and s.deleted_at is null
    join app.story_revision sr
      on sr.org_id = s.org_id and sr.publication_id = s.publication_id and sr.story_id = s.id and sr.rev = s.current_rev
    left join app.person rp on rp.org_id = s.org_id and rp.user_id = s.reporter_id
    left join app.section sec on sec.org_id = s.org_id and sec.publication_id = s.publication_id and sec.id = s.section_id
    where p.publication_id = ${publicationId} and p.run_id = r.run_id
      ${
        filter.stories?.scope === "none"
          ? sql`and false`
          : filter.stories?.scope === "own"
            ? sql`and (s.reporter_id = ${filter.stories.userId} or s.assignee_id = ${filter.stories.userId})`
            : sql``
      }
      and (sr.headline ilike ${like} or rp.display_name ilike ${like} or sec.name ilike ${like})
    order by p.page_no, sr.headline
    limit 5`;
  const { rows } = await sql<ArchiveRow>`
    select r.id, r.edition_id, r.run_id, r.number, r.kind, r.approved_at, r.retain_until,
      to_char(e.edition_date, 'YYYY-MM-DD') as edition_date,
      (select count(*)::int from app.release_file f
       where f.org_id = r.org_id and f.publication_id = r.publication_id and f.release_id = r.id) as files,
      exists (select 1 from app.run_page p
        where p.org_id = r.org_id and p.publication_id = r.publication_id and p.run_id = r.run_id and p.page_no = 1
          and p.thumb is not null) as front_thumb,
      ${like === null ? sql`'[]'::json` : sql`m.matches`} as matches
    from app.release r
    join app.edition e on e.org_id = r.org_id and e.publication_id = r.publication_id and e.id = r.edition_id
    ${like === null ? sql`` : sql`cross join lateral (select json_agg(h) as matches from (${hits}) h) m`}
    where r.publication_id = ${publicationId} and r.manifest_sha256 is not null
      ${filter.year === undefined ? sql`` : sql`and extract(year from e.edition_date) = ${filter.year}`}
      ${filter.month === undefined ? sql`` : sql`and extract(month from e.edition_date) = ${filter.month}`}
      ${filter.kind === undefined ? sql`` : sql`and r.kind = ${filter.kind}`}
      ${like === null ? sql`` : sql`and m.matches is not null`}
    order by e.edition_date desc, r.number desc
    limit ${limit}`.execute(tx);
  return rows;
}

/** The edition's date and its releases, newest first (undefined: not found). */
export async function archiveEdition(tx: Tx, publicationId: string, editionId: string) {
  const { rows } = await sql<{
    date: string;
    releases: { id: string; number: number; kind: "release" | "correction"; approved_at: string }[];
  }>`
    select to_char(e.edition_date, 'YYYY-MM-DD') as date,
      coalesce((select json_agg(json_build_object('id', r.id, 'number', r.number, 'kind', r.kind,
          'approved_at', r.approved_at) order by r.number desc)
        from app.release r
        where r.org_id = e.org_id and r.publication_id = e.publication_id and r.edition_id = e.id
          and r.manifest_sha256 is not null), '[]'::json) as releases
    from app.edition e where e.publication_id = ${publicationId} and e.id = ${editionId}`.execute(tx);
  return rows[0];
}
