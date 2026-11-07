// Print profiles in the database (migration 2026_12_06_0001; packages/contracts/src/print-profiles.ts), for
// src/modules/release/print-profiles.ts. Every function runs under withTenant (the organisation and publication walls).
import { sql } from "kysely";
import type { Tenant, Tx } from "./tenant.ts";

export type PrintProfileRow = {
  id: string;
  version: number;
  press_name: string;
  contact: string | null;
  note: string | null;
  created_by: string;
  created_name: string;
  created_at: Date;
};

const PROFILE = sql`
  select pp.id, pp.version, pp.press_name, pp.contact, pp.note, pp.created_by, p.display_name as created_name,
    pp.created_at
  from app.print_profile pp join app.person p on p.org_id = pp.org_id and p.user_id = pp.created_by`;

/** Every version, newest first. */
export async function printProfiles(tx: Tx, publicationId: string): Promise<PrintProfileRow[]> {
  const { rows } = await sql<PrintProfileRow>`${PROFILE}
    where pp.publication_id = ${publicationId} order by pp.version desc`.execute(tx);
  return rows;
}

export async function printProfile(tx: Tx, publicationId: string, id: string): Promise<PrintProfileRow | undefined> {
  const { rows } = await sql<PrintProfileRow>`${PROFILE}
    where pp.publication_id = ${publicationId} and pp.id = ${id}`.execute(tx);
  return rows[0];
}

/** The publication's next version → its id. Two saves at once take turns (a transaction lock on the publication's
 * print profiles), so neither meets the other's number. */
export async function addPrintProfile(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  input: { pressName: string; contact: string | null; note: string | null },
): Promise<string> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`print_profile:${publicationId}`}, 0))`.execute(tx);
  const { rows } = await sql<{ id: string }>`
    insert into app.print_profile (org_id, publication_id, version, press_name, contact, note, created_by)
    values (${who.orgId}, ${publicationId},
      (select coalesce(max(version), 0) + 1 from app.print_profile where publication_id = ${publicationId}),
      ${input.pressName}, ${input.contact}, ${input.note}, ${who.userId})
    returning id`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("the print profile was not made");
  return row.id;
}

/** What the facts are read from: the engine profile in use (its front template's measured size, its colour profile)
 * and the newest done run's checker. */
export type FactsRow = {
  version: number | null;
  page_w_mm: number | null;
  page_h_mm: number | null;
  icc_sha256: string | null;
  checker_sha256: string | null;
};

export async function pressFactsOf(tx: Tx, publicationId: string): Promise<FactsRow> {
  const { rows } = await sql<FactsRow>`
    with ep as (
      select version, templates, candidates, icc_sha256 from app.engine_profile
      where publication_id = ${publicationId} and state = 'ready' order by version desc limit 1
    ), front as (
      select (c -> 'outline' ->> 'page_w_mm')::float8 as w, (c -> 'outline' ->> 'page_h_mm')::float8 as h
      from ep, jsonb_array_elements(case when jsonb_typeof(ep.candidates -> 'front') = 'array'
        then ep.candidates -> 'front' else '[]'::jsonb end) c
      where c ->> 'name' = ep.templates ->> 'front' limit 1
    )
    select (select version from ep) as version, (select w from front) as page_w_mm, (select h from front) as page_h_mm,
      (select icc_sha256 from ep) as icc_sha256,
      (select checker_sha256 from app.layout_run where publication_id = ${publicationId} and state = 'done'
        order by finished_at desc, id desc limit 1) as checker_sha256`.execute(tx);
  return rows[0] ?? { version: null, page_w_mm: null, page_h_mm: null, icc_sha256: null, checker_sha256: null };
}
