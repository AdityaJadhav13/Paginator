// The ads desk and the edition plan in the database (docs/product/10-l2-newsroom-plan.md §1 L2.6; migration
// 2026_12_05_0001), for src/modules/ads. Every function runs under withTenant, so the organisation and publication walls
// apply: an id of another organisation or publication finds nothing. A booking's dates are read as text (YYYY-MM-DD,
// sorted): node-postgres would read a date[] as Dates at local midnight.
import { sql } from "kysely";
import type { Tenant, Tx } from "./tenant.ts";

// ------------------------------------------------------------------------------------------------ advertisers

export type AdvertiserRow = {
  id: string;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  note: string;
  archived_at: Date | null;
  bookings: number;
  created_at: Date;
};

const ADVERTISER = sql`
  select v.id, v.name, v.contact_name, v.phone, v.email, v.note, v.archived_at, v.created_at,
    (select count(*)::int from app.ad_booking b where b.org_id = v.org_id and b.publication_id = v.publication_id
       and b.advertiser_id = v.id and b.status <> 'cancelled') as bookings
  from app.advertiser v`;

export async function listAdvertisers(tx: Tx, publicationId: string): Promise<AdvertiserRow[]> {
  const { rows } = await sql<AdvertiserRow>`${ADVERTISER} where v.publication_id = ${publicationId}
    order by v.archived_at is not null, lower(v.name), v.id`.execute(tx);
  return rows;
}

export async function findAdvertiser(tx: Tx, publicationId: string, id: string, lock = false) {
  const { rows } = await sql<AdvertiserRow>`${ADVERTISER} where v.publication_id = ${publicationId} and v.id = ${id}
    ${lock ? sql`for update of v` : sql``}`.execute(tx);
  return rows[0];
}

/** Whether another advertiser not archived has this name (in any case). */
export async function advertiserNamed(tx: Tx, publicationId: string, name: string, except: string | null = null) {
  const { rows } = await sql`select 1 from app.advertiser where publication_id = ${publicationId}
    and lower(name) = lower(${name}) and archived_at is null
    ${except === null ? sql`` : sql`and id <> ${except}`}`.execute(tx);
  return rows.length > 0;
}

export type AdvertiserFields = { name: string; contact_name: string; phone: string; email: string; note: string };

/** The advertiser made; null when one not archived has that name already (nothing written). */
export async function createAdvertiser(tx: Tx, who: Tenant, publicationId: string, input: AdvertiserFields) {
  const { rows } = await sql<{ id: string }>`
    insert into app.advertiser (org_id, publication_id, name, contact_name, phone, email, note, created_by)
    values (${who.orgId}, ${publicationId}, ${input.name}, ${input.contact_name}, ${input.phone}, ${input.email},
      ${input.note}, ${who.userId})
    on conflict do nothing returning id`.execute(tx);
  return rows[0]?.id ?? null;
}

export async function updateAdvertiser(
  tx: Tx,
  publicationId: string,
  id: string,
  input: AdvertiserFields & { archived: boolean },
) {
  await sql`update app.advertiser set name = ${input.name}, contact_name = ${input.contact_name},
      phone = ${input.phone}, email = ${input.email}, note = ${input.note},
      archived_at = case when ${input.archived} then coalesce(archived_at, now()) end, updated_at = now()
    where publication_id = ${publicationId} and id = ${id}`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ bookings

export type BookingRow = {
  id: string;
  advertiser_id: string;
  advertiser_name: string;
  campaign: string;
  w_mm: string;
  h_mm: string;
  colour: "colour" | "mono";
  slot: string | null;
  dates: string[];
  status: "booked" | "cancelled";
  note: string;
  artwork_asset_id: string | null;
  /** the artwork's picture (null: none; deleted: its asset was deleted) */
  asset: {
    status: "received" | "ready" | "rejected" | "failed";
    width_px: number;
    height_px: number;
    version_id: string | null;
    sha256: string;
    deleted: boolean;
  } | null;
  artwork_set_by: string | null;
  artwork_set_by_name: string | null;
  artwork_set_at: Date | null;
  created_by: string;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  placements: { editionId: string; date: string; slot: string }[];
};

const BOOKING = sql`
  select b.id, b.advertiser_id, v.name as advertiser_name, b.campaign, b.w_mm, b.h_mm, b.colour, b.slot,
    array(select to_char(d, 'YYYY-MM-DD') from unnest(b.dates) d order by d) as dates, b.status, b.note,
    b.artwork_asset_id,
    case when a.id is not null then json_build_object('status', a.status, 'width_px', a.width_px,
      'height_px', a.height_px, 'version_id', a.version_id, 'sha256', a.sha256,
      'deleted', a.deleted_at is not null) end as asset,
    b.artwork_set_by, sb.display_name as artwork_set_by_name, b.artwork_set_at, b.created_by,
    cb.display_name as created_by_name, b.created_at, b.updated_at,
    coalesce((select json_agg(json_build_object('editionId', p.edition_id,
        'date', to_char(e.edition_date, 'YYYY-MM-DD'), 'slot', p.slot) order by e.edition_date, p.slot)
      from app.ad_placement p
      join app.edition e on e.org_id = p.org_id and e.publication_id = p.publication_id and e.id = p.edition_id
      where p.org_id = b.org_id and p.publication_id = b.publication_id and p.booking_id = b.id), '[]') as placements
  from app.ad_booking b
  join app.advertiser v on v.org_id = b.org_id and v.publication_id = b.publication_id and v.id = b.advertiser_id
  left join app.asset a on a.org_id = b.org_id and a.publication_id = b.publication_id and a.id = b.artwork_asset_id
  left join app.person sb on sb.org_id = b.org_id and sb.user_id = b.artwork_set_by
  left join app.person cb on cb.org_id = b.org_id and cb.user_id = b.created_by`;

/** Bookings with a run date in [from, to] (each optional), newest first. */
export async function listBookings(
  tx: Tx,
  publicationId: string,
  q: { from?: string | undefined; to?: string | undefined; status?: string | undefined },
  limit: number,
): Promise<BookingRow[]> {
  const { rows } = await sql<BookingRow>`${BOOKING} where b.publication_id = ${publicationId}
    ${q.status === undefined ? sql`` : sql`and b.status = ${q.status}`}
    ${
      q.from === undefined && q.to === undefined
        ? sql``
        : sql`and exists (select 1 from unnest(b.dates) d
            where d >= coalesce(${q.from ?? null}::date, '-infinity') and d <= coalesce(${q.to ?? null}::date, 'infinity'))`
    }
    order by b.created_at desc, b.id desc limit ${limit}`.execute(tx);
  return rows;
}

export async function findBooking(tx: Tx, publicationId: string, id: string, lock = false) {
  const { rows } = await sql<BookingRow>`${BOOKING} where b.publication_id = ${publicationId} and b.id = ${id}
    ${lock ? sql`for update of b` : sql``}`.execute(tx);
  return rows[0];
}

/** The booked bookings that run on the date, in the order booked. */
export async function bookingsOfDate(tx: Tx, publicationId: string, date: string): Promise<BookingRow[]> {
  const { rows } = await sql<BookingRow>`${BOOKING} where b.publication_id = ${publicationId}
    and b.status = 'booked' and ${date}::date = any (b.dates) order by b.created_at, b.id`.execute(tx);
  return rows;
}

export type BookingFields = {
  campaign: string;
  w_mm: string;
  h_mm: string;
  colour: "colour" | "mono";
  slot: string | null;
  dates: string[];
  note: string;
};

export async function createBooking(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  advertiserId: string,
  input: BookingFields,
): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into app.ad_booking (org_id, publication_id, advertiser_id, campaign, w_mm, h_mm, colour, slot, dates, note,
      created_by)
    values (${who.orgId}, ${publicationId}, ${advertiserId}, ${input.campaign}, ${input.w_mm}, ${input.h_mm},
      ${input.colour}, ${input.slot}, ${input.dates}::date[], ${input.note}, ${who.userId})
    returning id`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("the booking was not made");
  return row.id;
}

export async function updateBooking(
  tx: Tx,
  publicationId: string,
  id: string,
  input: BookingFields & { status: "booked" | "cancelled" },
) {
  await sql`update app.ad_booking set campaign = ${input.campaign}, w_mm = ${input.w_mm}, h_mm = ${input.h_mm},
      colour = ${input.colour}, slot = ${input.slot}, dates = ${input.dates}::date[], note = ${input.note},
      status = ${input.status}, updated_at = now()
    where publication_id = ${publicationId} and id = ${id}`.execute(tx);
}

export async function setBookingArtwork(tx: Tx, who: Tenant, publicationId: string, id: string, asset: string | null) {
  await sql`update app.ad_booking set artwork_asset_id = ${asset},
      artwork_set_by = ${asset === null ? null : who.userId}, artwork_set_at = ${asset === null ? null : sql`now()`},
      updated_at = now()
    where publication_id = ${publicationId} and id = ${id}`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ placements

export type PlacementRow = { edition_id: string; slot: string; booking_id: string; placed_by: string | null };

export async function editionPlacements(tx: Tx, publicationId: string, editionId: string): Promise<PlacementRow[]> {
  const { rows } = await sql<PlacementRow>`select edition_id, slot, booking_id, placed_by from app.ad_placement
    where publication_id = ${publicationId} and edition_id = ${editionId} order by slot`.execute(tx);
  return rows;
}

/** The editions not yet released that run on one of these dates, or where the booking is placed. */
export async function editionsToSync(tx: Tx, publicationId: string, bookingId: string, dates: readonly string[]) {
  const { rows } = await sql<{ id: string }>`select e.id from app.edition e
    where e.publication_id = ${publicationId} and e.status not in ('released', 'archived')
      and (e.edition_date = any (${[...dates]}::date[]) or exists (select 1 from app.ad_placement p
        where p.org_id = e.org_id and p.publication_id = e.publication_id and p.edition_id = e.id
          and p.booking_id = ${bookingId}))
    order by e.edition_date, e.id`.execute(tx);
  return rows.map((row) => row.id);
}

export async function addPlacement(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  p: { editionId: string; slot: string; bookingId: string; placedBy: string | null },
) {
  await sql`insert into app.ad_placement (org_id, publication_id, edition_id, slot, booking_id, placed_by)
    values (${who.orgId}, ${publicationId}, ${p.editionId}, ${p.slot}, ${p.bookingId}, ${p.placedBy})`.execute(tx);
}

export async function removePlacement(tx: Tx, publicationId: string, editionId: string, slot: string) {
  const { rows } = await sql<{ booking_id: string }>`delete from app.ad_placement
    where publication_id = ${publicationId} and edition_id = ${editionId} and slot = ${slot}
    returning booking_id`.execute(tx);
  return rows[0]?.booking_id ?? null;
}

/** The booking in the edition's slot, if any (the L2.3 slot route refuses such a slot). */
export async function bookingInSlot(tx: Tx, publicationId: string, editionId: string, slot: string) {
  const { rows } = await sql<{ booking_id: string }>`select booking_id from app.ad_placement
    where publication_id = ${publicationId} and edition_id = ${editionId} and slot = ${slot}`.execute(tx);
  return rows[0]?.booking_id ?? null;
}

// ------------------------------------------------------------------------------------------------ the flatplan

export type FlatplanRow = { page_no: number; section_id: string | null; section_name: string | null; note: string };

export async function flatplanPages(tx: Tx, publicationId: string, editionId: string): Promise<FlatplanRow[]> {
  const { rows } = await sql<FlatplanRow>`
    select f.page_no, f.section_id, s.name as section_name, f.note from app.flatplan_page f
    left join app.section s on s.org_id = f.org_id and s.publication_id = f.publication_id and s.id = f.section_id
    where f.publication_id = ${publicationId} and f.edition_id = ${editionId} order by f.page_no`.execute(tx);
  return rows;
}

export async function setFlatplanPage(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  editionId: string,
  page: { page_no: number; section_id: string | null; note: string },
) {
  await sql`insert into app.flatplan_page (org_id, publication_id, edition_id, page_no, section_id, note, updated_by)
    values (${who.orgId}, ${publicationId}, ${editionId}, ${page.page_no}, ${page.section_id}, ${page.note},
      ${who.userId})
    on conflict (org_id, publication_id, edition_id, page_no) do update set section_id = excluded.section_id,
      note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`.execute(tx);
}

/** The publication's section (archived ones too: a plan keeps what it named). */
export async function findSection(tx: Tx, publicationId: string, id: string) {
  const { rows } = await sql<{ id: string; name: string }>`select id, name from app.section
    where publication_id = ${publicationId} and id = ${id}`.execute(tx);
  return rows[0];
}

/** The publication's sections not archived, in their order: what a page's planned section is chosen from. */
export async function activeSections(tx: Tx, publicationId: string) {
  const { rows } = await sql<{ id: string; name: string }>`select id, name from app.section
    where publication_id = ${publicationId} and archived_at is null order by position, name, id`.execute(tx);
  return rows;
}

/** The picture refused or failed after it was set as bookings' artwork: taken out of the slots those bookings hold in
 * editions not yet released (their placements stay; the booking now shows its artwork failed). */
export async function clearBookedArtwork(tx: Tx, publicationId: string, assetId: string) {
  await sql`delete from app.ad_slot_artwork w using app.ad_placement p, app.ad_booking b, app.edition e
    where w.publication_id = ${publicationId} and w.asset_id = ${assetId}
      and p.org_id = w.org_id and p.publication_id = w.publication_id and p.edition_id = w.edition_id
      and p.slot = w.slot
      and b.org_id = p.org_id and b.publication_id = p.publication_id and b.id = p.booking_id
      and b.artwork_asset_id = ${assetId}
      and e.org_id = w.org_id and e.publication_id = w.publication_id and e.id = w.edition_id
      and e.status not in ('released', 'archived')`.execute(tx);
}

/** The sections of the stories on each page of a run (the Desk's article ids are the stories' desk keys). */
export async function placedSections(tx: Tx, publicationId: string, runId: string) {
  const { rows } = await sql<{
    page_no: number;
    stories: number;
    sections: { id: string; name: string }[];
  }>`
    select rp.page_no, jsonb_array_length(rp.articles) as stories,
      coalesce((select json_agg(distinct jsonb_build_object('id', sc.id, 'name', sc.name))
        from jsonb_array_elements_text(rp.articles) k
        join app.story st on st.org_id = rp.org_id and st.publication_id = rp.publication_id and st.desk_key = k
        join app.section sc on sc.org_id = st.org_id and sc.publication_id = st.publication_id and sc.id = st.section_id
      ), '[]') as sections
    from app.run_page rp where rp.publication_id = ${publicationId} and rp.run_id = ${runId}`.execute(tx);
  return rows;
}

/** The edition's status (released or archived: never changed by a placement), locked when asked. */
export async function editionStatus(tx: Tx, publicationId: string, editionId: string, lock = false) {
  const { rows } = await sql<{ status: string }>`select status from app.edition
    where publication_id = ${publicationId} and id = ${editionId} ${lock ? sql`for update` : sql``}`.execute(tx);
  return rows[0]?.status;
}
