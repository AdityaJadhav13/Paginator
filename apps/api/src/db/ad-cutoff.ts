// The ads cut-off in the database (packages/contracts/src/ads.ts, "The cut-off"; migration 2026_12_05_0002): a
// publication's settings, each edition date's cut-off moment, and the alert recorded once per publication and date.
// Each function runs inside withTenant (the organisation and publication walls). The moments are computed by
// Postgres in the publication's timezone (app.publication.timezone), so a zone with daylight saving is right too.
import type { AdSettings } from "@pageinator/contracts";
import { type RawBuilder, sql } from "kysely";
import type { Tx } from "./tenant.ts";

export const DEFAULT_AD_SETTINGS: AdSettings = { cutoffTime: "18:00", daysBefore: 1 };

/** The publication's cut-off settings (the defaults when it has none). */
export async function adSettings(tx: Tx, publicationId: string): Promise<AdSettings> {
  const { rows } = await sql<AdSettings>`
    select cutoff_time as "cutoffTime", days_before as "daysBefore" from app.ad_settings
    where publication_id = ${publicationId}`.execute(tx);
  return rows[0] ?? DEFAULT_AD_SETTINGS;
}

export async function setAdSettings(tx: Tx, orgId: string, publicationId: string, by: string, to: AdSettings) {
  await sql`
    insert into app.ad_settings (org_id, publication_id, cutoff_time, days_before, updated_by)
    values (${orgId}, ${publicationId}, ${to.cutoffTime}, ${to.daysBefore}, ${by})
    on conflict (org_id, publication_id) do update
      set cutoff_time = excluded.cutoff_time, days_before = excluded.days_before,
        updated_by = excluded.updated_by, updated_at = now()`.execute(tx);
}

/** The settings joined to each publication (the defaults where it has none), as SQL. */
const SETTINGS = sql`app.publication p
  left join app.ad_settings s on s.org_id = p.org_id and s.publication_id = p.id`;
const DAYS = sql`coalesce(s.days_before, 1)`;
/** The cut-off moment of edition date `date` (a date expression). */
const cutoffAt = (date: RawBuilder<unknown>) =>
  sql`((${date} - ${DAYS}) + coalesce(s.cutoff_time, '18:00')::time) at time zone p.timezone`;

/** The date's cut-off moment (ISO), and when its alert fired (null: not yet). */
export async function cutoffOf(
  tx: Tx,
  publicationId: string,
  date: string,
): Promise<{ at: string; alertedAt: string | null }> {
  const { rows } = await sql<{ at: Date; alerted_at: Date | null }>`
    select ${cutoffAt(sql`${date}::date`)} as at, a.fired_at as alerted_at
    from ${SETTINGS}
    left join app.ad_cutoff_alert a
      on a.org_id = p.org_id and a.publication_id = p.id and a.edition_date = ${date}::date
    where p.id = ${publicationId}`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("the publication is not found");
  return { at: row.at.toISOString(), alertedAt: row.alerted_at?.toISOString() ?? null };
}

/** The edition dates, of the publications the transaction reaches, whose cut-off has passed by `now` and whose day
 * (in the publication's timezone) has not ended, with no alert yet. */
export async function dueDates(tx: Tx, now: Date): Promise<{ publicationId: string; name: string; date: string }[]> {
  const { rows } = await sql<{ publicationId: string; name: string; date: string }>`
    select p.id as "publicationId", p.name, d.date::text as date
    from ${SETTINGS}
    cross join lateral (
      select (${now}::timestamptz at time zone p.timezone)::date + k as date from generate_series(0, ${DAYS}) k
    ) d
    where ${cutoffAt(sql`d.date`)} <= ${now}::timestamptz
      and not exists (select 1 from app.ad_cutoff_alert a
        where a.org_id = p.org_id and a.publication_id = p.id and a.edition_date = d.date)
    order by p.id, d.date`.execute(tx);
  return rows;
}

export type DateBooking = {
  id: string;
  advertiser: string;
  campaign: string;
  wMm: number;
  hMm: number;
  /** the artwork's picture: null when there is none, or it was deleted */
  picture: { status: string; widthPx: number; heightPx: number } | null;
};

/** The booked bookings that run on the date, in the order booked, each with its artwork's picture. */
export async function bookingsOn(tx: Tx, publicationId: string, date: string): Promise<DateBooking[]> {
  const { rows } = await sql<{
    id: string;
    advertiser: string;
    campaign: string;
    w_mm: string;
    h_mm: string;
    status: string | null;
    width_px: number | null;
    height_px: number | null;
  }>`
    select b.id, v.name as advertiser, b.campaign, b.w_mm, b.h_mm, a.status, a.width_px, a.height_px
    from app.ad_booking b
    join app.advertiser v on v.org_id = b.org_id and v.publication_id = b.publication_id and v.id = b.advertiser_id
    left join app.asset a on a.org_id = b.org_id and a.publication_id = b.publication_id
      and a.id = b.artwork_asset_id and a.deleted_at is null
    where b.publication_id = ${publicationId} and b.status = 'booked' and ${date}::date = any (b.dates)
    order by b.created_at, b.id`.execute(tx);
  return rows.map((row) => ({
    id: row.id,
    advertiser: row.advertiser,
    campaign: row.campaign,
    wMm: Number(row.w_mm),
    hMm: Number(row.h_mm),
    picture:
      row.status === null || row.width_px === null || row.height_px === null
        ? null
        : { status: row.status, widthPx: row.width_px, heightPx: row.height_px },
  }));
}

/** Records the date's alert; false when it is recorded already (another pass, or another API instance, fired it). */
export async function claimAlert(
  tx: Tx,
  orgId: string,
  publicationId: string,
  date: string,
  bookings: readonly string[],
  told: number,
): Promise<boolean> {
  const { rows } = await sql`
    insert into app.ad_cutoff_alert (org_id, publication_id, edition_date, bookings, told)
    values (${orgId}, ${publicationId}, ${date}::date, ${bookings as string[]}::uuid[], ${told})
    on conflict do nothing
    returning edition_date`.execute(tx);
  return rows.length === 1;
}

/** The organisation's active people. */
export async function activeMembers(tx: Tx): Promise<string[]> {
  const { rows } = await sql<{ userId: string }>`
    select user_id as "userId" from app.person where status = 'active' order by user_id`.execute(tx);
  return rows.map((row) => row.userId);
}
