// A publication's editions (docs/product/10-l2-newsroom-plan.md §3.3, §5.2), for src/modules/stories/editions.ts. Each
// function runs inside withTenant: the organisation and publication walls apply. One edition a publication and date;
// its Desk key is the date itself (the Desk's first edition of a day), so the Desk's id and the edition's date agree.
import { sql } from "kysely";
import type { Tenant, Tx } from "./tenant.ts";

export type EditionRow = {
  id: string;
  date: string;
  pages: number;
  back_page_ads: boolean;
  volume: string;
  issue: string;
  price: string;
  status: "planning" | "in_production" | "preflight" | "released" | "archived";
  /** Null when the stories were not counted (a role that sees none of them). */
  stories: number | null;
  ready: number | null;
  spiked: number | null;
};

export type NewEdition = {
  date: string;
  pages: number;
  backPageAds: boolean;
  volume: string;
  issue: string;
  price: string;
};

/** The publication's editions, newest first (at most `limit`), with their stories counted (deleted ones left out)
 * when `counted`; otherwise the counts are null and no story is read. */
export async function listEditions(
  tx: Tx,
  publicationId: string,
  range: { from?: string | undefined; to?: string | undefined; id?: string },
  limit: number,
  counted = true,
): Promise<EditionRow[]> {
  const { rows } = await sql<EditionRow>`
    select e.id, to_char(e.edition_date, 'YYYY-MM-DD') as date, e.pages, e.back_page_ads, e.volume, e.issue, e.price,
      e.status,
      ${
        counted
          ? sql`count(s.id)::int as stories,
      count(s.id) filter (where s.status = 'ready')::int as ready,
      count(s.id) filter (where s.status = 'spiked')::int as spiked`
          : sql`null::int as stories, null::int as ready, null::int as spiked`
      }
    from app.edition e
    ${
      counted
        ? sql`left join app.story s
      on s.org_id = e.org_id and s.publication_id = e.publication_id and s.edition_id = e.id and s.deleted_at is null`
        : sql``
    }
    where e.publication_id = ${publicationId}
      ${range.id === undefined ? sql`` : sql`and e.id = ${range.id}`}
      ${range.from === undefined ? sql`` : sql`and e.edition_date >= ${range.from}::date`}
      ${range.to === undefined ? sql`` : sql`and e.edition_date <= ${range.to}::date`}
    group by e.id
    order by e.edition_date desc
    limit ${limit}`.execute(tx);
  return rows;
}

/** Makes the edition; its id, or null when the publication has one on that date already (nothing is written). */
export async function createEdition(
  tx: Tx,
  tenant: Tenant,
  publicationId: string,
  edition: NewEdition,
): Promise<string | null> {
  const { rows } = await sql<{ id: string }>`
    insert into app.edition (org_id, publication_id, edition_date, desk_key, pages, back_page_ads, volume, issue, price)
    values (${tenant.orgId}, ${publicationId}, ${edition.date}::date, ${edition.date}, ${edition.pages},
      ${edition.backPageAds}, ${edition.volume}, ${edition.issue}, ${edition.price})
    on conflict do nothing
    returning id`.execute(tx);
  return rows[0]?.id ?? null;
}

/** The edition's folio fields set (the caller holds the edition's lock: layoutEdition(…, true)); folio_changed_at is
 * the clock now, so a run or a save that read the old folio read it before this time. */
export async function setFolio(
  tx: Tx,
  publicationId: string,
  editionId: string,
  folio: Pick<NewEdition, "volume" | "issue" | "price">,
): Promise<void> {
  await sql`update app.edition set volume = ${folio.volume}, issue = ${folio.issue}, price = ${folio.price},
      folio_changed_at = clock_timestamp(), updated_at = now()
    where publication_id = ${publicationId} and id = ${editionId}`.execute(tx);
}
