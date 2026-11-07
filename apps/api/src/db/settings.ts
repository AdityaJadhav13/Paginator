// Organization and publication settings in the database (packages/contracts/src/settings.ts), for
// src/modules/settings. Under withTenant, so the organisation wall applies: another organisation's publications are
// never seen.
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

/** Whether the database knows the timezone (the one ad cut-offs and layout run names are worked out in). */
export async function timezoneKnown(tx: Tx, timezone: string): Promise<boolean> {
  const { rows } = await sql`select 1 from pg_timezone_names where name = ${timezone}`.execute(tx);
  return rows.length > 0;
}

/** Whether a publication of the organisation has the name (any case), other than `except`. */
export async function publicationNamed(tx: Tx, name: string, except: string | null = null): Promise<boolean> {
  const { rows } = await sql`select 1 from app.publication where lower(name) = lower(${name})
    ${except === null ? sql`` : sql`and id <> ${except}`}`.execute(tx);
  return rows.length > 0;
}
