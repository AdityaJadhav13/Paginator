// A publication's editions (docs/product/10-l2-newsroom-plan.md §3.3, §5.2), for src/modules/stories/editions.ts. Each
// function runs inside withTenant: the organisation and publication walls apply. One edition a publication and date;
// its Desk key is the date itself (the Desk's first edition of a day), so the Desk's id and the edition's date agree.
import { sql } from "kysely";
import type { DeskTextValue } from "./layout.ts";
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

/** The edition's date, Desk key (it starts with the date), pages and back-page ads set (the caller holds the edition's
 * lock and found no other edition on the date). Then every done run of it is set aside: cancelled, `setAside` its
 * message, finished_at kept (the board, the editor and the release use the newest done run). And the plan's pages past
 * the new count are emptied (the API may not delete them), so shrinking and growing again brings no old plan back.
 * Returns how many runs were set aside, and the plan pages emptied as they were (for the audit). */
export async function correctEdition(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  editionId: string,
  edition: Pick<NewEdition, "date" | "pages" | "backPageAds"> & { deskKey: string },
  setAside: DeskTextValue,
): Promise<{ setAside: number; planCleared: { page: number; section_id: string | null; note: string }[] }> {
  await sql`update app.edition set edition_date = ${edition.date}::date, desk_key = ${edition.deskKey},
      pages = ${edition.pages}, back_page_ads = ${edition.backPageAds}, updated_at = now()
    where publication_id = ${publicationId} and id = ${editionId}`.execute(tx);
  const { rows } = await sql<{ id: string }>`update app.layout_run set state = 'cancelled',
      message = ${JSON.stringify(setAside)}::jsonb, updated_at = now()
    where publication_id = ${publicationId} and edition_id = ${editionId} and state = 'done'
    returning id`.execute(tx);
  const cleared = await sql<{ page: number; section_id: string | null; note: string }>`
    with old as (select page_no, section_id, note from app.flatplan_page
      where publication_id = ${publicationId} and edition_id = ${editionId} and page_no > ${edition.pages}
        and (section_id is not null or note <> '') for update)
    update app.flatplan_page f set section_id = null, note = '', updated_by = ${who.userId}, updated_at = now()
    from old where f.publication_id = ${publicationId} and f.edition_id = ${editionId} and f.page_no = old.page_no
    returning old.page_no as page, old.section_id, old.note`.execute(tx);
  return { setAside: rows.length, planCleared: cleared.rows.sort((a, b) => a.page - b.page) };
}

/** The bookings that run on the date (any state), locked for share in id order: a correction to that date may place
 * them, and place.ts's lock order is bookings before editions (a placement's foreign key takes a key-share lock on its
 * booking), so they are locked before the edition; a booking's own change waits for the correction, then finds the
 * edition on its new date. */
export async function lockBookingsOfDate(tx: Tx, publicationId: string, date: string): Promise<void> {
  await sql`select id from app.ad_booking where publication_id = ${publicationId} and ${date}::date = any (dates)
    order by id for share`.execute(tx);
}
