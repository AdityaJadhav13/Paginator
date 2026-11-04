// Hosted layout in the database (docs/product/10-l2-newsroom-plan.md §1 L2.3, §2.2, §3.3; migration 2026_12_02_0001),
// for src/modules/layout. Every function runs under withTenant, so the organisation and publication walls apply: an id
// of another organisation or publication finds nothing. The enqueues go through the app.enqueue_* wrappers, in the
// caller's transaction (a rollback leaves no job), each payload checked with its contract first.
import {
  EngineLayoutPayload,
  EngineMeasurePayload,
  EngineSetupPayload,
  MediaAdPayload,
  type ProfileReady,
  type RunState,
} from "@pageinator/contracts";
import { sql } from "kysely";
import type { z } from "zod";
import type { Tenant, Tx } from "./tenant.ts";

export type Plan = z.infer<typeof ProfileReady>["plans"][number];
export type Grid = z.infer<typeof ProfileReady>["grid"];
export type DeskTextValue = { text: string; code: string | null; params: Record<string, string | number> | null };
export type Stored = { key: string; version_id: string; sha256: string; bytes: number };

export const ACTIVE_STATES: readonly RunState[] = ["queued", "planning", "layout", "finishing"];

// ------------------------------------------------------------------------------------------------ engine profiles

export type ProfileRow = {
  id: string;
  version: number;
  state: "setting_up" | "ready" | "failed";
  dataset_key: string;
  dataset_version_id: string | null;
  dataset_sha256: string;
  dataset_bytes: string;
  config_key: string;
  config_version_id: string | null;
  config_sha256: string | null;
  engine_version: string | null;
  templates: Record<string, string> | null;
  grid: Grid | null;
  plans: Plan[] | null;
  problem: string | null;
  message: DeskTextValue | null;
  created_by: string;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
};

const PROFILE = sql`
  select p.id, p.version, p.state, p.dataset_key, p.dataset_version_id, p.dataset_sha256, p.dataset_bytes, p.config_key,
    p.config_version_id, p.config_sha256, p.engine_version, p.templates, p.grid, p.plans, p.problem, p.message,
    p.created_by, cb.display_name as created_by_name, p.created_at, p.updated_at
  from app.engine_profile p
  left join app.person cb on cb.org_id = p.org_id and cb.user_id = p.created_by`;

/** A new profile (setting_up), numbered after the publication's last; the publication's row is locked first, so two
 * at once take the next numbers in turn. */
export async function createProfile(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  input: { uploadId: string; sha256: string; bytes: number },
) {
  await sql`select 1 from app.publication where id = ${publicationId} for update`.execute(tx);
  const { rows } = await sql<{ id: string; dataset_key: string; version: number }>`
    insert into app.engine_profile (org_id, publication_id, version, upload_id, dataset_sha256, dataset_bytes, created_by)
    values (${who.orgId}, ${publicationId},
      (select coalesce(max(version), 0) + 1 from app.engine_profile where publication_id = ${publicationId}),
      ${input.uploadId}, ${input.sha256}, ${input.bytes}, ${who.userId})
    returning id, dataset_key, version`.execute(tx);
  const made = rows[0];
  if (!made) throw new Error("the profile was not made");
  return made;
}

export async function setProfileDataset(tx: Tx, publicationId: string, profileId: string, versionId: string) {
  await sql`update app.engine_profile set dataset_version_id = ${versionId}
    where publication_id = ${publicationId} and id = ${profileId}`.execute(tx);
}

export async function completeUploadAsProfile(tx: Tx, publicationId: string, uploadId: string, profileId: string) {
  await sql`update app.upload set status = 'completed', engine_profile_id = ${profileId}, completed_at = now()
    where publication_id = ${publicationId} and id = ${uploadId}`.execute(tx);
}

export async function listProfiles(tx: Tx, publicationId: string, limit: number): Promise<ProfileRow[]> {
  const { rows } = await sql<ProfileRow>`${PROFILE}
    where p.publication_id = ${publicationId} order by p.version desc limit ${limit}`.execute(tx);
  return rows;
}

export async function findProfile(tx: Tx, publicationId: string, profileId: string, lock = false) {
  const { rows } = await sql<ProfileRow>`${PROFILE}
    where p.publication_id = ${publicationId} and p.id = ${profileId}
    ${lock ? sql`for update of p` : sql``}`.execute(tx);
  return rows[0];
}

/** The profile in use: the publication's newest ready one. */
export async function profileInUse(tx: Tx, publicationId: string): Promise<ProfileRow | undefined> {
  const { rows } = await sql<ProfileRow>`${PROFILE}
    where p.publication_id = ${publicationId} and p.state = 'ready' order by p.version desc limit 1`.execute(tx);
  return rows[0];
}

export async function settleProfile(
  tx: Tx,
  publicationId: string,
  profileId: string,
  outcome:
    | {
        state: "ready";
        config: Stored;
        engineVersion: string;
        templates: Record<string, string>;
        grid: Grid;
        plans: Plan[];
      }
    | { state: "failed"; problem: string; message: DeskTextValue },
): Promise<void> {
  if (outcome.state === "ready") {
    await sql`update app.engine_profile set state = 'ready', config_version_id = ${outcome.config.version_id},
        config_sha256 = ${outcome.config.sha256}, engine_version = ${outcome.engineVersion},
        templates = ${JSON.stringify(outcome.templates)}::jsonb, grid = ${JSON.stringify(outcome.grid)}::jsonb,
        plans = ${JSON.stringify(outcome.plans)}::jsonb, updated_at = now()
      where publication_id = ${publicationId} and id = ${profileId}`.execute(tx);
  } else {
    await sql`update app.engine_profile set state = 'failed', problem = ${outcome.problem},
        message = ${JSON.stringify(outcome.message)}::jsonb, updated_at = now()
      where publication_id = ${publicationId} and id = ${profileId}`.execute(tx);
  }
}

export async function enqueueEngineSetup(tx: Tx, payload: EngineSetupPayload): Promise<void> {
  const checked = EngineSetupPayload.parse(payload);
  await sql`select app.enqueue_engine_setup(${checked.org_id}::uuid, ${JSON.stringify(checked)}::jsonb)`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ editions, stories

export type LayoutEdition = {
  id: string;
  desk_key: string;
  date: string;
  pages: 4 | 8 | 16;
  back_page_ads: boolean;
  volume: string;
  issue: string;
  price: string;
  created_at: Date;
  updated_at: Date;
  timezone: string;
};

/** The edition, locked when asked (a run's creation holds it: one run at a time per edition). */
export async function layoutEdition(tx: Tx, publicationId: string, editionId: string, lock = false) {
  const { rows } = await sql<LayoutEdition>`
    select e.id, e.desk_key, to_char(e.edition_date, 'YYYY-MM-DD') as date, e.pages, e.back_page_ads, e.volume,
      e.issue, e.price, e.created_at, e.updated_at, p.timezone
    from app.edition e join app.publication p on p.org_id = e.org_id and p.id = e.publication_id
    where e.publication_id = ${publicationId} and e.id = ${editionId}
    ${lock ? sql`for update of e` : sql``}`.execute(tx);
  return rows[0];
}

export type LayoutStory = {
  id: string;
  desk_key: string;
  status: string;
  headline: string;
  kicker: string;
  deck: string;
  byline: string;
  body: string;
  words: number;
  priority: number;
  page_pin: number | null;
  origin: string;
  created_at: Date;
  updated_at: Date;
  /** the story names a picture (story_photo), whatever state it is in */
  photo_attached: boolean;
  photo_status: "received" | "ready" | "rejected" | "failed" | null;
  photo_deleted: boolean | null;
  photo_desk_key: string | null;
  photo_caption: string | null;
  photo_credit: string | null;
  /** the picture's newest CMYK rendition (what the engine places), when it has one */
  cmyk: { key: string; version_id: string; sha256: string; width_px: number; height_px: number } | null;
};

/** The edition's stories that are not deleted or spiked, oldest first, with their current text and photo. */
export async function layoutStories(tx: Tx, publicationId: string, editionId: string): Promise<LayoutStory[]> {
  const { rows } = await sql<LayoutStory>`
    select s.id, s.desk_key, s.status, r.headline, r.kicker, r.deck, r.byline, r.body, r.words, s.priority, s.page_pin,
      s.origin, s.created_at, s.updated_at, sp.asset_id is not null as photo_attached, a.status as photo_status,
      a.deleted_at is not null as photo_deleted, a.desk_key as photo_desk_key, sp.caption as photo_caption,
      sp.credit as photo_credit,
      (select json_build_object('key', c.key, 'version_id', c.version_id, 'sha256', c.sha256, 'width_px', c.width_px,
                                'height_px', c.height_px)
       from app.rendition c
       where c.org_id = a.org_id and c.publication_id = a.publication_id and c.asset_id = a.id and c.purpose = 'cmyk'
       order by c.created_at desc limit 1) as cmyk
    from app.story s
    join app.story_revision r
      on r.org_id = s.org_id and r.publication_id = s.publication_id and r.story_id = s.id and r.rev = s.current_rev
    left join app.story_photo sp on sp.org_id = s.org_id and sp.publication_id = s.publication_id and sp.story_id = s.id
    left join app.asset a on a.org_id = sp.org_id and a.publication_id = sp.publication_id and a.id = sp.asset_id
    where s.publication_id = ${publicationId} and s.edition_id = ${editionId} and s.deleted_at is null
      and s.status <> 'spiked'
    order by s.created_at, s.id`.execute(tx);
  return rows;
}

/** Stories of the publication by their Desk ids, with their current headline (not deleted). */
export async function storiesByDeskKey(tx: Tx, publicationId: string, keys: readonly string[]) {
  if (keys.length === 0) return new Map<string, { id: string; headline: string }>();
  const { rows } = await sql<{ id: string; desk_key: string; headline: string }>`
    select s.id, s.desk_key, r.headline from app.story s
    join app.story_revision r
      on r.org_id = s.org_id and r.publication_id = s.publication_id and r.story_id = s.id and r.rev = s.current_rev
    where s.publication_id = ${publicationId} and s.desk_key = any (${[...keys]}::text[]) and s.deleted_at is null`.execute(
    tx,
  );
  return new Map(rows.map((row) => [row.desk_key, { id: row.id, headline: row.headline }]));
}

/** A done run's write-back (plan §1 L2.3 "Placed"): the edition's Ready stories it placed become Placed, and its Placed
 * stories it did not place go back to Ready; each a system change (changed_by null) and a new version. Returns the
 * changes, for the audit log. */
export async function writeBackPlaced(tx: Tx, who: Tenant, publicationId: string, editionId: string, placed: string[]) {
  const { rows } = await sql<{ id: string; from_status: string; to_status: string }>`
    with moved as (
      select s.id, s.status as from_status,
        case when s.status = 'ready' then 'placed' else 'ready' end as to_status
      from app.story s
      where s.publication_id = ${publicationId} and s.edition_id = ${editionId} and s.deleted_at is null
        and ((s.status = 'ready' and s.desk_key = any (${placed}::text[]))
          or (s.status = 'placed' and not (s.desk_key = any (${placed}::text[]))))
      for update of s
    ), changed as (
      update app.story s set status = m.to_status, version = s.version + 1, updated_at = now()
      from moved m where s.publication_id = ${publicationId} and s.id = m.id returning s.id
    )
    insert into app.story_status_change (org_id, publication_id, story_id, from_status, to_status, changed_by)
    select ${who.orgId}, ${publicationId}, m.id, m.from_status, m.to_status, null from moved m
    returning story_id as id, from_status, to_status`.execute(tx);
  return rows;
}

// ------------------------------------------------------------------------------------------------ ad slots

export type ArtworkRow = {
  id: string;
  edition_id: string;
  slot: string;
  asset_id: string;
  w_mm: string;
  h_mm: string;
  state: "preparing" | "ready" | "failed";
  raster: (Stored & { width_px: number; height_px: number }) | null;
  preview: (Stored & { width_px: number; height_px: number }) | null;
  params_hash: string | null;
  problem: DeskTextValue | null;
};

const ARTWORK = sql`select id, edition_id, slot, asset_id, w_mm, h_mm, state, raster, preview, params_hash, problem
  from app.ad_slot_artwork`;

export async function editionArtwork(tx: Tx, publicationId: string, editionId: string): Promise<ArtworkRow[]> {
  const { rows } = await sql<ArtworkRow>`${ARTWORK}
    where publication_id = ${publicationId} and edition_id = ${editionId} order by slot`.execute(tx);
  return rows;
}

export async function findArtwork(tx: Tx, publicationId: string, artworkId: string, lock = false) {
  const { rows } = await sql<ArtworkRow>`${ARTWORK}
    where publication_id = ${publicationId} and id = ${artworkId} ${lock ? sql`for update` : sql``}`.execute(tx);
  return rows[0];
}

/** The slot's artwork set to this picture (made, or replaced: preparing again, its old raster gone); returns its id.
 * A replaced one gets a new id, so the old picture's media.ad job (keyed and reported by the id) cannot settle it. */
export async function setArtwork(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  input: { editionId: string; slot: string; assetId: string; wMm: string; hMm: string },
): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into app.ad_slot_artwork (org_id, publication_id, edition_id, slot, asset_id, w_mm, h_mm, set_by)
    values (${who.orgId}, ${publicationId}, ${input.editionId}, ${input.slot}, ${input.assetId}, ${input.wMm},
      ${input.hMm}, ${who.userId})
    on conflict (org_id, publication_id, edition_id, slot) do update set id = uuidv7(), asset_id = excluded.asset_id,
      w_mm = excluded.w_mm, h_mm = excluded.h_mm, set_by = excluded.set_by, state = 'preparing', raster = null,
      preview = null, params_hash = null, problem = null, updated_at = now()
    returning id`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("the ad slot was not set");
  return row.id;
}

export async function clearArtwork(tx: Tx, publicationId: string, editionId: string, slot: string) {
  const { rows } = await sql<{ id: string; asset_id: string }>`delete from app.ad_slot_artwork
    where publication_id = ${publicationId} and edition_id = ${editionId} and slot = ${slot}
    returning id, asset_id`.execute(tx);
  return rows[0];
}

export async function settleArtwork(
  tx: Tx,
  publicationId: string,
  artworkId: string,
  outcome:
    | { state: "ready"; raster: object; preview: object; paramsHash: string }
    | { state: "failed"; problem: DeskTextValue },
): Promise<void> {
  if (outcome.state === "ready") {
    await sql`update app.ad_slot_artwork set state = 'ready', raster = ${JSON.stringify(outcome.raster)}::jsonb,
        preview = ${JSON.stringify(outcome.preview)}::jsonb, params_hash = ${outcome.paramsHash}, updated_at = now()
      where publication_id = ${publicationId} and id = ${artworkId}`.execute(tx);
  } else {
    await sql`update app.ad_slot_artwork set state = 'failed', problem = ${JSON.stringify(outcome.problem)}::jsonb,
        updated_at = now()
      where publication_id = ${publicationId} and id = ${artworkId}`.execute(tx);
  }
}

export async function enqueueMediaAd(tx: Tx, payload: MediaAdPayload): Promise<void> {
  const checked = MediaAdPayload.parse(payload);
  await sql`select app.enqueue_media_ad(${checked.org_id}::uuid, ${JSON.stringify(checked)}::jsonb)`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ runs

export type RunRow = {
  id: string;
  edition_id: string;
  desk_key: string;
  state: RunState;
  request_key: string;
  request_version_id: string | null;
  request_sha256: string | null;
  profile_id: string | null;
  profile_version: number | null;
  engine_version: string | null;
  timings: Record<string, number> | null;
  not_placed: { article: string; reason: DeskTextValue }[];
  edition_pdf: Stored | null;
  press_zip: Stored | null;
  message: DeskTextValue | null;
  error: DeskTextValue | null;
  elapsed_s: number | null;
  heartbeat_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_by: string;
  created_by_name: string | null;
  created_at: Date;
};

const RUN = sql`
  select r.id, r.edition_id, r.desk_key, r.state, r.request_key, r.request_version_id, r.request_sha256, r.profile_id,
    pr.version as profile_version, r.engine_version, r.timings, r.not_placed, r.edition_pdf, r.press_zip, r.message,
    r.error, r.elapsed_s, r.heartbeat_at, r.started_at, r.finished_at, r.created_by, cb.display_name as created_by_name,
    r.created_at
  from app.layout_run r
  left join app.engine_profile pr on pr.org_id = r.org_id and pr.publication_id = r.publication_id and pr.id = r.profile_id
  left join app.person cb on cb.org_id = r.org_id and cb.user_id = r.created_by`;

export async function findRun(tx: Tx, publicationId: string, runId: string, lock = false) {
  const { rows } = await sql<RunRow>`${RUN}
    where r.publication_id = ${publicationId} and r.id = ${runId} ${lock ? sql`for update of r` : sql``}`.execute(tx);
  return rows[0];
}

/** The edition's runs the edition screen shows: the active one, the newest that ended, the newest done. */
export async function editionRuns(tx: Tx, publicationId: string, editionId: string) {
  const { rows } = await sql<RunRow & { pick: "active" | "last" | "board" }>`
    with runs as (${RUN} where r.publication_id = ${publicationId} and r.edition_id = ${editionId})
    (select 'active' as pick, * from runs where state in ('queued', 'planning', 'layout', 'finishing') limit 1)
    union all (select 'last', * from runs where finished_at is not null order by finished_at desc, id desc limit 1)
    union all (select 'board', * from runs where state = 'done' order by finished_at desc, id desc limit 1)`.execute(
    tx,
  );
  return {
    active: rows.find((row) => row.pick === "active"),
    last: rows.find((row) => row.pick === "last"),
    board: rows.find((row) => row.pick === "board"),
  };
}

/** A run's Desk id: r-YYYYMMDD-HHMMSS in the publication's time, a second later for each one the edition has. */
export async function newRunKey(tx: Tx, publicationId: string, editionId: string, timezone: string): Promise<string> {
  const { rows } = await sql<{ key: string }>`
    select k.key from generate_series(0, 3600) as s,
      lateral (select to_char((now() + make_interval(secs => s)) at time zone ${timezone},
                              '"r-"YYYYMMDD"-"HH24MISS') as key) as k
    where not exists (select 1 from app.layout_run r
                      where r.publication_id = ${publicationId} and r.edition_id = ${editionId} and r.desk_key = k.key)
    order by s limit 1`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("no run id is free for this edition within the hour");
  return row.key;
}

export async function createRun(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  input: { editionId: string; deskKey: string; profileId: string; engineVersion: string | null },
) {
  const { rows } = await sql<{ id: string; request_key: string }>`
    insert into app.layout_run (org_id, publication_id, edition_id, desk_key, profile_id, engine_version, created_by,
      message)
    values (${who.orgId}, ${publicationId}, ${input.editionId}, ${input.deskKey}, ${input.profileId},
      ${input.engineVersion}, ${who.userId}, ${JSON.stringify(STARTING)}::jsonb)
    returning id, request_key`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("the run was not made");
  return row;
}

/** The Desk's m.run.starting, a queued run's message. */
export const STARTING: DeskTextValue = { text: "Starting…", code: "m.run.starting", params: null };

export async function setRunRequest(tx: Tx, publicationId: string, runId: string, versionId: string, sha256: string) {
  await sql`update app.layout_run set request_version_id = ${versionId}, request_sha256 = ${sha256}
    where publication_id = ${publicationId} and id = ${runId}`.execute(tx);
}

export async function enqueueEngineLayout(tx: Tx, payload: EngineLayoutPayload): Promise<void> {
  const checked = EngineLayoutPayload.parse(payload);
  await sql`select app.enqueue_engine_layout(${checked.org_id}::uuid, ${JSON.stringify(checked)}::jsonb)`.execute(tx);
}

/** Removes or stops a run's or a measure's job (app.cancel_engine_job): the caller has found the run or edition its
 * key names under the organisation's walls. 'measure:*' stops every running measure. */
export async function cancelEngineJob(tx: Tx, orgId: string, jobKey: string): Promise<void> {
  await sql`select app.cancel_engine_job(${orgId}::uuid, ${jobKey})`.execute(tx);
}

export type RunUpdate = {
  state?: RunState;
  message?: DeskTextValue | null;
  error?: DeskTextValue | null;
  heartbeat?: boolean;
  started?: boolean;
  finished?: boolean;
  elapsedS?: number;
  engineVersion?: string;
  checkerSha256?: string;
  timings?: Record<string, number>;
  notPlaced?: { article: string; reason: DeskTextValue }[];
  editionPdf?: Stored | null;
  pressZip?: Stored | null;
};

export async function updateRun(tx: Tx, publicationId: string, runId: string, u: RunUpdate): Promise<void> {
  // null is SQL's null, never JSON's (the columns' checks take an object or nothing)
  const json = (value: unknown) => (value === undefined || value === null ? undefined : JSON.stringify(value));
  await sql`update app.layout_run set
      state = coalesce(${u.state ?? null}, state),
      message = case when ${u.message !== undefined} then ${json(u.message) ?? null}::jsonb else message end,
      error = case when ${u.error !== undefined} then ${json(u.error) ?? null}::jsonb else error end,
      heartbeat_at = case when ${u.heartbeat === true} then now() else heartbeat_at end,
      started_at = case when ${u.started === true} then coalesce(started_at, now()) else started_at end,
      finished_at = case when ${u.finished === true} then now() else finished_at end,
      elapsed_s = coalesce(${u.elapsedS ?? null}::double precision, elapsed_s),
      engine_version = coalesce(${u.engineVersion ?? null}, engine_version),
      checker_sha256 = coalesce(${u.checkerSha256 ?? null}, checker_sha256),
      timings = coalesce(${json(u.timings) ?? null}::jsonb, timings),
      not_placed = coalesce(${json(u.notPlaced) ?? null}::jsonb, not_placed),
      edition_pdf = case when ${u.editionPdf !== undefined} then ${json(u.editionPdf) ?? null}::jsonb else edition_pdf end,
      press_zip = case when ${u.pressZip !== undefined} then ${json(u.pressZip) ?? null}::jsonb else press_zip end,
      updated_at = now()
    where publication_id = ${publicationId} and id = ${runId}`.execute(tx);
}

export type PageRow = {
  run_id: string;
  page_no: number;
  role: "front" | "inside" | "back";
  state: "waiting" | "working" | "done" | "failed" | "cancelled";
  articles: string[];
  pdf: Stored | null;
  png: Stored | null;
  thumb: Stored | null;
  report: Stored | null;
  checked: { passed: boolean; fails: number | null; warnings: number | null } | null;
  warnings: DeskTextValue[];
  message: DeskTextValue | null;
};

export async function runPages(tx: Tx, publicationId: string, runIds: readonly string[]): Promise<PageRow[]> {
  if (runIds.length === 0) return [];
  const { rows } = await sql<PageRow>`
    select run_id, page_no, role, state, articles, pdf, png, thumb, report, checked, warnings, message
    from app.run_page where publication_id = ${publicationId} and run_id = any (${[...runIds]}::uuid[])
    order by run_id, page_no`.execute(tx);
  return rows;
}

/** Writes a page of a run: a new one, or what changed of one (a page done keeps its files when a later progress line
 * names it again: progress only moves a page that is not done). */
export async function putPage(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  runId: string,
  page: {
    page: number;
    role: string;
    state: string;
    articles?: string[];
    pdf?: Stored | null;
    png?: Stored | null;
    thumb?: Stored | null;
    report?: Stored | null;
    checked?: { passed: boolean; fails: number | null; warnings: number | null } | null;
    warnings?: DeskTextValue[];
    message?: DeskTextValue | null;
    seconds?: number | null;
  },
  progressOnly = false,
): Promise<void> {
  const j = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));
  const has = (value: unknown) => value !== undefined;
  await sql`
    insert into app.run_page (org_id, publication_id, run_id, page_no, role, state, articles, pdf, png, thumb, report,
      pdf_sha256, checked, warnings, message, seconds)
    values (${who.orgId}, ${publicationId}, ${runId}, ${page.page}, ${page.role}, ${page.state},
      coalesce(${j(page.articles)}::jsonb, '[]'), ${j(page.pdf)}::jsonb, ${j(page.png)}::jsonb, ${j(page.thumb)}::jsonb,
      ${j(page.report)}::jsonb, ${page.pdf?.sha256 ?? null}, ${j(page.checked)}::jsonb,
      coalesce(${j(page.warnings)}::jsonb, '[]'), ${j(page.message)}::jsonb, ${page.seconds ?? null})
    on conflict (org_id, publication_id, run_id, page_no) do update set
      role = excluded.role,
      state = case when ${progressOnly} and run_page.state = 'done' then run_page.state else excluded.state end,
      articles = case when ${has(page.articles)} then excluded.articles else run_page.articles end,
      pdf = case when ${has(page.pdf)} then excluded.pdf else run_page.pdf end,
      pdf_sha256 = case when ${has(page.pdf)} then excluded.pdf_sha256 else run_page.pdf_sha256 end,
      png = case when ${has(page.png)} then excluded.png else run_page.png end,
      thumb = case when ${has(page.thumb)} then excluded.thumb else run_page.thumb end,
      report = case when ${has(page.report)} then excluded.report else run_page.report end,
      checked = case when ${has(page.checked)} then excluded.checked else run_page.checked end,
      warnings = case when ${has(page.warnings)} then excluded.warnings else run_page.warnings end,
      message = case when ${has(page.message)} then excluded.message else run_page.message end,
      seconds = coalesce(excluded.seconds, run_page.seconds),
      updated_at = now()`.execute(tx);
}

/** The independent checker's verdict on exact bytes, kept once (plan §2.3). */
export async function recordCheck(
  tx: Tx,
  orgId: string,
  check: {
    sha256: string;
    checkerSha256: string;
    passed: boolean;
    fails: number | null;
    warnings: number | null;
    report: Stored | null;
  },
): Promise<void> {
  await sql`insert into app.pdf_check (org_id, sha256, checker_sha256, passed, fails, warnings, report_key,
      report_version_id)
    values (${orgId}, ${check.sha256}, ${check.checkerSha256}, ${check.passed}, ${check.fails}, ${check.warnings},
      ${check.report?.key ?? null}, ${check.report?.version_id ?? null})
    on conflict do nothing`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ measuring

export type MeasureRow = {
  sha256: string;
  state: "waiting" | "measuring" | "done" | "stopped" | "failed";
  measured: number;
  total: number;
  failed: number;
};

export async function measureOf(tx: Tx, publicationId: string, editionId: string, lock = false) {
  const { rows } = await sql<MeasureRow>`select sha256, state, measured, total, failed from app.edition_measure
    where publication_id = ${publicationId} and edition_id = ${editionId} ${lock ? sql`for update` : sql``}`.execute(
    tx,
  );
  return rows[0];
}

/** The editions of these publications that changed at least `quietMs` ago and after their last measuring snapshot,
 * with a profile ready, no active run, and a Ready story: the measure scheduler's work (at most `limit`). */
export async function editionsToMeasure(tx: Tx, quietMs: number, limit: number) {
  const { rows } = await sql<{ id: string; publication_id: string }>`
    select e.id, e.publication_id from app.edition e
    cross join lateral (
      select greatest(e.updated_at, max(s.updated_at)) as changed, count(*) filter (where s.status = 'ready') as ready
      from app.story s
      where s.org_id = e.org_id and s.publication_id = e.publication_id and s.edition_id = e.id
        and s.deleted_at is null) as c
    left join app.edition_measure m
      on m.org_id = e.org_id and m.publication_id = e.publication_id and m.edition_id = e.id
    where e.status in ('planning', 'in_production') and c.ready > 0
      and c.changed < now() - ${quietMs} * interval '1 millisecond'
      and (m.snapshot_at is null or c.changed > m.snapshot_at)
      and exists (select 1 from app.engine_profile p
                  where p.org_id = e.org_id and p.publication_id = e.publication_id and p.state = 'ready')
      and not exists (select 1 from app.layout_run r
                      where r.org_id = e.org_id and r.publication_id = e.publication_id and r.edition_id = e.id
                        and r.state in ('queued', 'planning', 'layout', 'finishing'))
    order by c.changed limit ${limit}`.execute(tx);
  return rows;
}

export async function saveMeasureSnapshot(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  editionId: string,
  snapshot: { sha256: string; versionId: string; total: number },
): Promise<void> {
  await sql`insert into app.edition_measure (org_id, publication_id, edition_id, sha256, version_id, total)
    values (${who.orgId}, ${publicationId}, ${editionId}, ${snapshot.sha256}, ${snapshot.versionId}, ${snapshot.total})
    on conflict (org_id, publication_id, edition_id) do update set sha256 = excluded.sha256,
      version_id = excluded.version_id, state = 'waiting', measured = 0, total = excluded.total, failed = 0,
      snapshot_at = now(), updated_at = now()`.execute(tx);
}

/** The edition's snapshot found unchanged: only its time moves. */
export async function touchMeasureSnapshot(tx: Tx, publicationId: string, editionId: string): Promise<void> {
  await sql`update app.edition_measure set snapshot_at = now()
    where publication_id = ${publicationId} and edition_id = ${editionId}`.execute(tx);
}

export async function settleMeasure(
  tx: Tx,
  publicationId: string,
  editionId: string,
  m: { state: MeasureRow["state"]; measured?: number; total?: number; failed?: number },
): Promise<void> {
  await sql`update app.edition_measure set state = ${m.state}, measured = coalesce(${m.measured ?? null}, measured),
      total = coalesce(${m.total ?? null}, total), failed = coalesce(${m.failed ?? null}, failed), updated_at = now()
    where publication_id = ${publicationId} and edition_id = ${editionId}`.execute(tx);
}

export async function enqueueEngineMeasure(tx: Tx, payload: EngineMeasurePayload): Promise<void> {
  const checked = EngineMeasurePayload.parse(payload);
  await sql`select app.enqueue_engine_measure(${checked.org_id}::uuid, ${JSON.stringify(checked)}::jsonb)`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ the sweep's

const NO_EVENT = (table: string, column: string) =>
  sql.raw(`not exists (select 1 from app.engine_event ev
  where ev.org_id = ${table}.org_id and ev.asset_id = ${table}.${column} and ev.processed_at is null)`);

/** What still waits with no job left (`withJobs`, read by the sweep's reader) and no event waiting, past the deadline:
 * profiles setting up, ad artwork preparing, measures waiting or measuring, queued runs. */
export async function strandedLayout(tx: Tx, deadlineMs: number, withJobs: ReadonlySet<string>) {
  const jobs = [...withJobs];
  const old = sql`now() - ${deadlineMs} * interval '1 millisecond'`;
  const { rows } = await sql<{
    kind: "engine.setup" | "media.ad" | "engine.measure" | "engine.layout";
    id: string;
    publication_id: string;
  }>`
    (select 'engine.setup' as kind, p.id, p.publication_id from app.engine_profile p
     where p.state = 'setting_up' and p.updated_at < ${old} and not (p.id = any (${jobs}::uuid[]))
       and ${NO_EVENT("p", "id")} limit 100)
    union all
    (select 'media.ad', a.id, a.publication_id from app.ad_slot_artwork a
     where a.state = 'preparing' and a.updated_at < ${old} and not (a.id = any (${jobs}::uuid[]))
       and ${NO_EVENT("a", "id")} limit 100)
    union all
    (select 'engine.measure', m.edition_id, m.publication_id from app.edition_measure m
     where m.state in ('waiting', 'measuring') and m.updated_at < ${old} and not (m.edition_id = any (${jobs}::uuid[]))
       and ${NO_EVENT("m", "edition_id")} limit 100)
    union all
    (select 'engine.layout', r.id, r.publication_id from app.layout_run r
     where r.state = 'queued' and r.created_at < ${old} and not (r.id = any (${jobs}::uuid[]))
       and ${NO_EVENT("r", "id")} limit 100)`.execute(tx);
  return rows;
}

/** Runs past planning whose worker has not reported for `staleMs`, with none of its events still waiting in the inbox
 * (a report not yet applied is not a silent worker): the reconciler fails them (the Desk's RESTARTED). */
export async function stalledRuns(tx: Tx, staleMs: number) {
  const { rows } = await sql<{ id: string; publication_id: string }>`
    select r.id, r.publication_id from app.layout_run r
    where r.state in ('planning', 'layout', 'finishing')
      and coalesce(r.heartbeat_at, r.started_at, r.created_at) < now() - ${staleMs} * interval '1 millisecond'
      and ${NO_EVENT("r", "id")}
    order by r.heartbeat_at limit 100`.execute(tx);
  return rows;
}
