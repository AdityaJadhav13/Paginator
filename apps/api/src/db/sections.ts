// A publication's sections in the database (migration 2026_11_20_0001 app.section; packages/contracts/src/sections.ts),
// for src/modules/sections. Under withTenant, so the walls apply: another organisation's or publication's id finds
// nothing. Nothing is deleted: a section is archived (pgn_app has no delete on app.section).
import { sql } from "kysely";
import type { Tenant, Tx } from "./tenant.ts";

export type SectionRow = { id: string; name: string; archived_at: Date | null; stories: number };

/** In use first, in their order; then the archived ones. */
export async function listSections(tx: Tx, publicationId: string) {
  const { rows } = await sql<SectionRow>`
    select s.id, s.name, s.archived_at,
      (select count(*)::int from app.story st
        where st.org_id = s.org_id and st.publication_id = s.publication_id and st.section_id = s.id) as stories
    from app.section s where s.publication_id = ${publicationId}
    order by s.archived_at is not null, s.position, s.name, s.id`.execute(tx);
  return rows;
}

/** Whether a section in use has the name (any case), other than `except`. */
export async function sectionNamed(tx: Tx, publicationId: string, name: string, except: string | null = null) {
  const { rows } = await sql`select 1 from app.section where publication_id = ${publicationId}
    and lower(name) = lower(${name}) and archived_at is null
    ${except === null ? sql`` : sql`and id <> ${except}`}`.execute(tx);
  return rows.length > 0;
}

/** The publication's sections locked for this transaction (two changes of the order take turns). */
export async function lockSections(tx: Tx, publicationId: string) {
  // the publication's row first: with no section yet there is no row to lock, and two adds of one name would both pass
  await sql`select 1 from app.publication where id = ${publicationId} for update`.execute(tx);
  const { rows } = await sql<{ id: string; name: string; archived_at: Date | null }>`
    select id, name, archived_at from app.section where publication_id = ${publicationId}
    order by archived_at is not null, position, name, id for update`.execute(tx);
  return rows;
}

export async function createSection(tx: Tx, who: Tenant, publicationId: string, name: string, position: number) {
  const { rows } = await sql<{ id: string }>`
    insert into app.section (org_id, publication_id, name, position)
    values (${who.orgId}, ${publicationId}, ${name}, ${position}) returning id`.execute(tx);
  return rows[0]!.id;
}

export async function updateSection(
  tx: Tx,
  publicationId: string,
  id: string,
  input: { name: string; archived: boolean },
) {
  await sql`update app.section set name = ${input.name},
      archived_at = case when ${input.archived} then coalesce(archived_at, now()) end
    where publication_id = ${publicationId} and id = ${id}`.execute(tx);
}

/** The sections in use numbered 0, 1, … in this order. */
export async function orderSections(tx: Tx, publicationId: string, ids: readonly string[]) {
  if (ids.length === 0) return;
  await sql`update app.section s set position = o.n - 1
    from unnest(${[...ids]}::uuid[]) with ordinality as o(id, n)
    where s.publication_id = ${publicationId} and s.id = o.id and s.position <> o.n - 1`.execute(tx);
}
