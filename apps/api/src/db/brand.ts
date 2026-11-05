// The publication's brand (packages/contracts/src/brand.ts), for src/modules/brand/routes.ts and the edition create.
// Each function runs inside withTenant: the organisation wall applies (app.publication), and the publication wall too
// (app.edition_defaults, app.layout_run). The caller has checked the publication is one the person reaches.
import { sql } from "kysely";
import type { Tenant, Tx } from "./tenant.ts";

export type BrandRow = {
  name: string;
  volume: string;
  price: string;
  next_issue: number | null;
};

export type MastheadRow = { run_id: string; edition_id: string; edition_date: string; finished_at: Date };

/** The publication's name and its edition defaults (empty when never set); undefined for no such publication. */
export async function readBrand(tx: Tx, publicationId: string, lock = false): Promise<BrandRow | undefined> {
  const { rows } = await sql<BrandRow>`
    select p.name, coalesce(d.volume, '') as volume, coalesce(d.price, '') as price, d.next_issue
    from app.publication p
    left join app.edition_defaults d on d.org_id = p.org_id and d.publication_id = p.id
    where p.id = ${publicationId} ${lock ? sql`for update of p` : sql``}`.execute(tx);
  return rows[0];
}

/** Page 1 of the publication's newest done run that has its preview: the masthead as the paper last printed it. */
export async function newestFrontPage(tx: Tx, publicationId: string): Promise<MastheadRow | undefined> {
  const { rows } = await sql<MastheadRow>`
    select r.id as run_id, r.edition_id, to_char(e.edition_date, 'YYYY-MM-DD') as edition_date, r.finished_at
    from app.layout_run r
    join app.edition e on e.org_id = r.org_id and e.publication_id = r.publication_id and e.id = r.edition_id
    join app.run_page pg on pg.org_id = r.org_id and pg.publication_id = r.publication_id and pg.run_id = r.id
      and pg.page_no = 1 and pg.png is not null
    where r.publication_id = ${publicationId} and r.state = 'done' and r.finished_at is not null
    order by r.finished_at desc, r.id desc
    limit 1`.execute(tx);
  return rows[0];
}

export async function setPublicationName(tx: Tx, publicationId: string, name: string): Promise<void> {
  await sql`update app.publication set name = ${name} where id = ${publicationId}`.execute(tx);
}

export async function setEditionDefaults(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  defaults: { volume: string; price: string; nextIssue: number | null },
): Promise<void> {
  await sql`
    insert into app.edition_defaults (org_id, publication_id, volume, price, next_issue, updated_by, updated_at)
    values (${who.orgId}, ${publicationId}, ${defaults.volume}, ${defaults.price}, ${defaults.nextIssue}, ${who.userId},
      now())
    on conflict (org_id, publication_id) do update set volume = excluded.volume, price = excluded.price,
      next_issue = excluded.next_issue, updated_by = excluded.updated_by, updated_at = excluded.updated_at`.execute(tx);
}

/** An edition was made with issue `issue`: the counter moves past it when it was at or before it (a back-dated or
 * repeated number leaves it). No counter set (null), or none to move past 999999: nothing changes. */
export async function issueUsed(tx: Tx, publicationId: string, issue: number): Promise<void> {
  // the Brand save reads and rewrites the counter under this lock (readBrand(…, true)): take turns with it
  await sql`select 1 from app.publication where id = ${publicationId} for update`.execute(tx);
  await sql`update app.edition_defaults set next_issue = ${issue} + 1
    where publication_id = ${publicationId} and next_issue <= ${issue} and ${issue} < 999999`.execute(tx);
}
