// Release in the database (docs/product/10-l2-newsroom-plan.md §1 L2.5; migration 2026_12_04_0001), for
// src/modules/release and the page editor's lock on approved pages. Every function runs under withTenant (the
// organisation and publication walls apply).
import type { PressTest } from "@pageinator/contracts";
import { sql } from "kysely";
import type { EditPageRow } from "./editor.ts";
import type { DeskTextValue, Stored } from "./layout.ts";
import type { Tenant, Tx } from "./tenant.ts";

/** The edition's Pages board run: its newest done run (as editionRuns' board). */
export type BoardRun = {
  id: string;
  edition_id: string;
  desk_key: string;
  state: string;
  checker_sha256: string | null;
  not_placed: { article: string; reason: DeskTextValue }[];
  created_at: Date;
  /** the ad rasters its request held (slot → SHA-256); null: made before they were kept, or imported from the Desk */
  ad_rasters: Record<string, string> | null;
};

export async function boardRun(tx: Tx, publicationId: string, editionId: string): Promise<BoardRun | undefined> {
  const { rows } = await sql<BoardRun>`
    select id, edition_id, desk_key, state, checker_sha256, not_placed, created_at, ad_rasters from app.layout_run
    where publication_id = ${publicationId} and edition_id = ${editionId} and state = 'done'
    order by finished_at desc, id desc limit 1`.execute(tx);
  return rows[0];
}

/** A page of the run as the release reads it: the editor's flags, its PDF (and, once saved, when the live edition it
 * prints was read), and the independent check of exactly those bytes by the run's checker (app.pdf_check; null when
 * never checked). */
export type ReleasePageRow = EditPageRow & {
  pdf: Stored | null;
  pdf_sha256: string | null;
  saved_at: Date | null;
  check: { passed: boolean; fails: number | null; warnings: number | null } | null;
};

/** The run's pages; locked (for share) when asked: a release holds them, so an approval, an unlock or a save of one
 * waits for it. */
export async function releasePages(
  tx: Tx,
  publicationId: string,
  run: BoardRun,
  lock = false,
): Promise<ReleasePageRow[]> {
  const { rows } = await sql<ReleasePageRow>`
    select p.page_no, p.role, p.state, p.articles, p.checked, p.edited, p.edited_unsaved, p.needs_save,
      p.needs_save_why, p.pdf_rev, p.rev_seen, p.layout_problems, p.layout_problems_now, p.stale, p.printed, p.pdf, p.pdf_sha256,
      p.saved_at,
      case when c.sha256 is not null
        then json_build_object('passed', c.passed, 'fails', c.fails, 'warnings', c.warnings) end as "check"
    from app.run_page p
    left join app.pdf_check c
      on c.org_id = p.org_id and c.sha256 = p.pdf_sha256 and c.checker_sha256 = ${run.checker_sha256}
    where p.publication_id = ${publicationId} and p.run_id = ${run.id} order by p.page_no
    ${lock ? sql`for share of p` : sql``}`.execute(tx);
  return rows;
}

// ------------------------------------------------------------------------------------------------ approvals

export type ApprovalRow = {
  page_no: number;
  rev: number;
  pdf_sha256: string;
  approved_by: string;
  approved_name: string;
  approved_at: Date;
};

/** The run's approvals not unlocked, newest first (whether one counts is the page's: preflight.ts approvalOf). */
export async function standingApprovals(tx: Tx, publicationId: string, runId: string): Promise<ApprovalRow[]> {
  const { rows } = await sql<ApprovalRow>`
    select a.page_no, a.rev, a.pdf_sha256, a.approved_by, p.display_name as approved_name, a.approved_at
    from app.page_approval a join app.person p on p.org_id = a.org_id and p.user_id = a.approved_by
    where a.publication_id = ${publicationId} and a.run_id = ${runId} and a.unlocked_at is null
    order by a.approved_at desc, a.id desc`.execute(tx);
  return rows;
}

/** The run's page, locked while it is approved or unlocked (one at a time). */
export async function lockRunPage(tx: Tx, publicationId: string, runId: string, page: number): Promise<void> {
  await sql`select 1 from app.run_page where publication_id = ${publicationId} and run_id = ${runId}
    and page_no = ${page} for update`.execute(tx);
}

export async function approvePage(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  runId: string,
  page: number,
  rev: number,
  pdfSha256: string,
): Promise<void> {
  await sql`insert into app.page_approval (org_id, publication_id, run_id, page_no, rev, pdf_sha256, approved_by)
    values (${who.orgId}, ${publicationId}, ${runId}, ${page}, ${rev}, ${pdfSha256}, ${who.userId})`.execute(tx);
}

/** Every approval of the page not yet unlocked is withdrawn (none can count again). */
export async function unlockPage(tx: Tx, who: Tenant, publicationId: string, runId: string, page: number) {
  await sql`update app.page_approval set unlocked_by = ${who.userId}, unlocked_at = now()
    where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page}
      and unlocked_at is null`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ what the edition prints

/** Whether any of these stories (the run's pages' Desk ids) has a photo. */
export async function printsPhoto(tx: Tx, publicationId: string, keys: readonly string[]): Promise<boolean> {
  if (keys.length === 0) return false;
  const { rows } = await sql<{ yes: boolean }>`
    select exists (select 1 from app.story s
      join app.story_photo sp on sp.org_id = s.org_id and sp.publication_id = s.publication_id and sp.story_id = s.id
      where s.publication_id = ${publicationId} and s.desk_key = any (${[...keys]}::text[])
        and s.deleted_at is null) as yes`.execute(tx);
  return rows[0]?.yes ?? false;
}

export async function pressTestOf(tx: Tx, publicationId: string): Promise<PressTest | null> {
  const { rows } = await sql<{
    page_sha256: string;
    accepted_on: string;
    note: string | null;
    recorded_by: string;
    recorded_name: string;
    recorded_at: Date;
  }>`
    select t.page_sha256, to_char(t.accepted_on, 'YYYY-MM-DD') as accepted_on, t.note, t.recorded_by,
      p.display_name as recorded_name, t.recorded_at
    from app.press_test t join app.person p on p.org_id = t.org_id and p.user_id = t.recorded_by
    where t.publication_id = ${publicationId}`.execute(tx);
  const row = rows[0];
  if (!row) return null;
  return {
    pageSha256: row.page_sha256,
    acceptedOn: row.accepted_on,
    note: row.note,
    recordedBy: { id: row.recorded_by, name: row.recorded_name },
    recordedAt: row.recorded_at.toISOString(),
  };
}

export async function setPressTest(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  input: { pageSha256: string; acceptedOn: string; note: string | null },
): Promise<void> {
  await sql`insert into app.press_test (org_id, publication_id, page_sha256, accepted_on, note, recorded_by)
    values (${who.orgId}, ${publicationId}, ${input.pageSha256}, ${input.acceptedOn}::date, ${input.note},
      ${who.userId})
    on conflict (org_id, publication_id) do update set page_sha256 = excluded.page_sha256,
      accepted_on = excluded.accepted_on, note = excluded.note, recorded_by = excluded.recorded_by,
      recorded_at = now()`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ releases

/** Each page's newest released file in the edition, and how many times the page was released. */
export type ReleasedRow = { page_no: number; name: string; sha256: string; times: number };

export async function releasedPages(tx: Tx, publicationId: string, editionId: string): Promise<ReleasedRow[]> {
  const { rows } = await sql<ReleasedRow>`
    select distinct on (f.page_no) f.page_no, f.name, f.sha256, (count(*) over (partition by f.page_no))::int as times
    from app.release_file f
    join app.release r on r.org_id = f.org_id and r.publication_id = f.publication_id and r.id = f.release_id
    where r.publication_id = ${publicationId} and r.edition_id = ${editionId}
    order by f.page_no, r.number desc`.execute(tx);
  return rows;
}

export type ReleaseRow = {
  id: string;
  edition_id: string;
  run_id: string;
  number: number;
  kind: "release" | "correction";
  approved_by: string;
  approved_name: string;
  approved_at: Date;
  note: string | null;
  manifest_key: string | null;
  manifest_version_id: string | null;
  manifest_sha256: string | null;
  retain_until: Date;
  verified_at: Date | null;
  /** the print profile pinned when it was approved (null: none was saved then) */
  print_profile_id: string | null;
  print_profile_version: number | null;
  press_name: string | null;
};

export type FileRow = {
  release_id: string;
  page_no: number;
  name: string;
  rev: number;
  sha256: string;
  bytes: number;
  archive_key: string;
  archive_version_id: string;
  replaces: string | null;
};

export type DeliveryRow = {
  id: string;
  release_id: string;
  sent_by: string;
  sent_name: string;
  sent_at: Date;
  note: string | null;
  files: { name: string; sha256: string; bytes: number }[];
  press_person: string | null;
  confirmed_at: Date | null;
  confirm_note: string | null;
  confirmed_by: string | null;
  confirmed_name: string | null;
};

const RELEASE = sql`
  select r.id, r.edition_id, r.run_id, r.number, r.kind, r.approved_by, p.display_name as approved_name,
    r.approved_at, r.note, r.manifest_key, r.manifest_version_id, r.manifest_sha256, r.retain_until, r.verified_at,
    r.print_profile_id, pp.version as print_profile_version, pp.press_name
  from app.release r join app.person p on p.org_id = r.org_id and p.user_id = r.approved_by
  left join app.print_profile pp
    on pp.org_id = r.org_id and pp.publication_id = r.publication_id and pp.id = r.print_profile_id`;

/** The edition's releases, newest first. */
export async function editionReleases(tx: Tx, publicationId: string, editionId: string): Promise<ReleaseRow[]> {
  const { rows } = await sql<ReleaseRow>`${RELEASE}
    where r.publication_id = ${publicationId} and r.edition_id = ${editionId} order by r.number desc`.execute(tx);
  return rows;
}

export async function findRelease(tx: Tx, publicationId: string, releaseId: string, lock = false) {
  const { rows } = await sql<ReleaseRow>`${RELEASE}
    where r.publication_id = ${publicationId} and r.id = ${releaseId} ${lock ? sql`for update of r` : sql``}`.execute(
    tx,
  );
  return rows[0];
}

export async function releaseFiles(tx: Tx, publicationId: string, releaseIds: readonly string[]): Promise<FileRow[]> {
  if (releaseIds.length === 0) return [];
  const { rows } = await sql<FileRow>`
    select release_id, page_no, name, rev, sha256, bytes, archive_key, archive_version_id, replaces
    from app.release_file where publication_id = ${publicationId} and release_id = any (${[...releaseIds]}::uuid[])
    order by release_id, page_no`.execute(tx);
  return rows;
}

export async function deliveries(tx: Tx, publicationId: string, releaseIds: readonly string[]): Promise<DeliveryRow[]> {
  if (releaseIds.length === 0) return [];
  const { rows } = await sql<DeliveryRow>`
    select d.id, d.release_id, d.sent_by, s.display_name as sent_name, d.sent_at, d.note, d.files, d.press_person,
      d.confirmed_at, d.confirm_note, d.confirmed_by, c.display_name as confirmed_name
    from app.delivery d
    join app.person s on s.org_id = d.org_id and s.user_id = d.sent_by
    left join app.person c on c.org_id = d.org_id and c.user_id = d.confirmed_by
    where d.publication_id = ${publicationId} and d.release_id = any (${[...releaseIds]}::uuid[])
    order by d.sent_at, d.id`.execute(tx);
  return rows;
}

/** A new release of the edition (the next number; the caller holds the edition's lock) → its id. It records the
 * print profile in use now (the publication's newest version). */
export async function createRelease(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  input: { editionId: string; runId: string; kind: "release" | "correction"; note: string | null; retainUntil: Date },
): Promise<{ id: string; number: number }> {
  const { rows } = await sql<{ id: string; number: number }>`
    insert into app.release (org_id, publication_id, edition_id, run_id, number, kind, approved_by, note, retain_until,
      print_profile_id)
    values (${who.orgId}, ${publicationId}, ${input.editionId}, ${input.runId},
      (select coalesce(max(number), 0) + 1 from app.release
       where publication_id = ${publicationId} and edition_id = ${input.editionId}),
      ${input.kind}, ${who.userId}, ${input.note}, ${input.retainUntil},
      (select id from app.print_profile where publication_id = ${publicationId} order by version desc limit 1))
    returning id, number`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("the release was not made");
  return row;
}

export async function addReleaseFile(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  releaseId: string,
  file: Omit<FileRow, "release_id">,
): Promise<void> {
  await sql`insert into app.release_file (org_id, publication_id, release_id, page_no, name, rev, sha256, bytes,
      archive_key, archive_version_id, replaces)
    values (${who.orgId}, ${publicationId}, ${releaseId}, ${file.page_no}, ${file.name}, ${file.rev}, ${file.sha256},
      ${file.bytes}, ${file.archive_key}, ${file.archive_version_id}, ${file.replaces})`.execute(tx);
}

/** The manifest written and read back: the archive copy verified now. */
export async function setManifest(
  tx: Tx,
  publicationId: string,
  releaseId: string,
  manifest: { key: string; versionId: string; sha256: string },
): Promise<void> {
  await sql`update app.release set manifest_key = ${manifest.key}, manifest_version_id = ${manifest.versionId},
      manifest_sha256 = ${manifest.sha256}, verified_at = now()
    where publication_id = ${publicationId} and id = ${releaseId}`.execute(tx);
}

export async function markVerified(tx: Tx, publicationId: string, releaseId: string): Promise<void> {
  await sql`update app.release set verified_at = now()
    where publication_id = ${publicationId} and id = ${releaseId}`.execute(tx);
}

/** The edition is released (its first release; an archived one stays archived). */
export async function markEditionReleased(tx: Tx, publicationId: string, editionId: string): Promise<void> {
  await sql`update app.edition set status = 'released', updated_at = now()
    where publication_id = ${publicationId} and id = ${editionId}
      and status in ('planning', 'in_production', 'preflight')`.execute(tx);
}

export async function addDelivery(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  releaseId: string,
  note: string | null,
  files: DeliveryRow["files"],
): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into app.delivery (org_id, publication_id, release_id, sent_by, note, files)
    values (${who.orgId}, ${publicationId}, ${releaseId}, ${who.userId}, ${note}, ${JSON.stringify(files)}::jsonb)
    returning id`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error("the delivery was not made");
  return row.id;
}

/** The press's confirmation, recorded once → whether this call recorded it (false: there was one already). */
export async function confirmDelivery(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  releaseId: string,
  deliveryId: string,
  input: { pressPerson: string; at: string | null; note: string | null },
): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`
    update app.delivery set press_person = ${input.pressPerson}, confirmed_at = coalesce(${input.at}::timestamptz, now()),
      confirm_note = ${input.note}, confirmed_by = ${who.userId}
    where publication_id = ${publicationId} and release_id = ${releaseId} and id = ${deliveryId}
      and confirmed_at is null
    returning id`.execute(tx);
  return rows.length > 0;
}
