// The page editor in the database (docs/product/10-l2-newsroom-plan.md §1 L2.4, §2.4; migration 2026_12_03_0001), for
// src/modules/editor. Every function runs under withTenant (the organisation and publication walls apply). The page
// flags follow the Desk's deskserver/editing.py: note_revs, before_move/unmark_move, before_save, saved_page and
// after_save, each one statement on app.run_page.
import type { PageEditCause, PageEditState, SavedPage, StoredFile } from "@pageinator/contracts";
import { sql } from "kysely";
import type { z } from "zod";
import type { DeskTextValue, Stored } from "./layout.ts";
import type { Database } from "./pools.ts";
import type { Tenant, Tx } from "./tenant.ts";

/** Moves, saves, approvals and unlocks of one run take turns (the run's turn: a save's marks never cross a move's, and
 * a page is never approved while a save or move that touches it is checking it). */
export const runTurn = <T>(database: Database, runId: string, fn: () => Promise<T>) =>
  database.withLock(`editor:${runId}`, fn);
/** A change of one page, and its approval or unlock, take turns (the page's turn; an approval holds both turns). */
export const pageTurn = <T>(database: Database, runId: string, page: number | string, fn: () => Promise<T>) =>
  database.withLock(`editor:${runId}:${page}`, fn);

export type Cause = z.infer<typeof PageEditCause>;

export type EditRun = {
  id: string;
  edition_id: string;
  edition_key: string;
  desk_key: string;
  state: string;
  checker_sha256: string | null;
};

export async function editRun(tx: Tx, publicationId: string, runId: string): Promise<EditRun | undefined> {
  const { rows } = await sql<EditRun>`
    select r.id, r.edition_id, e.desk_key as edition_key, r.desk_key, r.state, r.checker_sha256
    from app.layout_run r join app.edition e
      on e.org_id = r.org_id and e.publication_id = r.publication_id and e.id = r.edition_id
    where r.publication_id = ${publicationId} and r.id = ${runId}`.execute(tx);
  return rows[0];
}

export type EditPageRow = {
  page_no: number;
  role: string;
  state: "waiting" | "working" | "done" | "failed" | "cancelled";
  articles: string[];
  checked: { passed: boolean; fails: number | null; warnings: number | null } | null;
  edited: boolean;
  edited_unsaved: boolean;
  needs_save: boolean;
  needs_save_why: DeskTextValue | null;
  pdf_rev: number;
  /** the SHA-256 of the page's PDF now (null: none) */
  pdf_sha256: string | null;
  rev_seen: number;
  layout_problems: string[] | null;
  layout_problems_now: string[] | null;
  stale: DeskTextValue[];
};

export async function editPages(tx: Tx, publicationId: string, runId: string): Promise<EditPageRow[]> {
  const { rows } = await sql<EditPageRow>`
    select page_no, role, state, articles, checked, edited, edited_unsaved, needs_save, needs_save_why, pdf_rev,
      pdf_sha256, rev_seen, layout_problems, layout_problems_now, stale
    from app.run_page where publication_id = ${publicationId} and run_id = ${runId} order by page_no`.execute(tx);
  return rows;
}

/** What a save sends the gateway besides: each page's PDF as Postgres holds it (edition.pdf is made of these). */
export async function pagePdfs(tx: Tx, publicationId: string, runId: string) {
  const { rows } = await sql<{ page: number; pdf: StoredFile }>`
    select page_no as page, pdf from app.run_page
    where publication_id = ${publicationId} and run_id = ${runId} and state = 'done' and pdf is not null
    order by page_no`.execute(tx);
  return rows;
}

/** What the gateway is sent: each page's latest revision (pages never edited are left out) and the text overrides. */
export async function persistedState(tx: Tx, publicationId: string, runId: string) {
  const { rows } = await sql<{ page: number; rev: number; modules: PageEditState["modules"] }>`
    select distinct on (page_no) page_no as page, rev, modules from app.page_edit
    where publication_id = ${publicationId} and run_id = ${runId} order by page_no, rev desc`.execute(tx);
  const text = await sql<{ overrides: Record<string, unknown> }>`
    select overrides from app.run_text_override
    where publication_id = ${publicationId} and run_id = ${runId}`.execute(tx);
  return { pages: rows, text: (text.rows[0]?.overrides ?? null) as Record<string, unknown> | null };
}

/** Each revision the gateway reported, kept once (a revision already stored is the same one: a catch-up). */
export async function storeEdits(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  runId: string,
  edits: readonly PageEditState[],
  causeOf: (page: number) => Cause,
): Promise<void> {
  for (const edit of edits) {
    const cause = causeOf(edit.page);
    await sql`insert into app.page_edit (org_id, publication_id, run_id, page_no, rev, modules, cause, author_id)
      values (${who.orgId}, ${publicationId}, ${runId}, ${edit.page}, ${edit.rev}, ${JSON.stringify(edit.modules)},
        ${cause}, ${cause === "engine" ? null : who.userId})
      on conflict do nothing`.execute(tx);
  }
}

export async function storeText(tx: Tx, who: Tenant, publicationId: string, runId: string, text: object) {
  await sql`insert into app.run_text_override (org_id, publication_id, run_id, overrides, updated_by)
    values (${who.orgId}, ${publicationId}, ${runId}, ${JSON.stringify(text)}, ${who.userId})
    on conflict (org_id, publication_id, run_id) do update set overrides = excluded.overrides,
      updated_at = now(), updated_by = excluded.updated_by`.execute(tx);
}

/** editing.note_revs: the newest revision seen of each page, "changed, not saved" once one differs from its PDF's,
 * and the placement problems of the page the answer shows (null: the answer had no list, nothing noted). */
export async function noteRevs(
  tx: Tx,
  publicationId: string,
  runId: string,
  revs: ReadonlyMap<number, number>,
  now?: { page: number; kinds: string[] | null },
): Promise<void> {
  for (const [page, rev] of revs) {
    await sql`update app.run_page set rev_seen = greatest(rev_seen, ${rev}),
        edited_unsaved = edited_unsaved or ${rev} <> pdf_rev, updated_at = now()
      where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page}
        and (${rev} > rev_seen or (not edited_unsaved and ${rev} <> pdf_rev))`.execute(tx);
  }
  if (now && now.kinds !== null) {
    await sql`update app.run_page set layout_problems_now = ${JSON.stringify(now.kinds)}::jsonb, updated_at = now()
      where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${now.page}
        and layout_problems_now is distinct from ${JSON.stringify(now.kinds)}::jsonb`.execute(tx);
  }
}

/** A page's "needs saving" mark as it was before one was set, so that a refusal can take it back (unmark). */
export type Mark = {
  page: number;
  why: DeskTextValue;
  before: {
    needs_save: boolean;
    needs_save_why: DeskTextValue | null;
    checked: EditPageRow["checked"];
  };
};

/** A page marked "needs saving" with why (before_move, before_save; forgetCheck: its check forgotten too). */
export async function markNeedsSave(
  tx: Tx,
  publicationId: string,
  runId: string,
  page: number,
  why: DeskTextValue,
  forgetCheck = false,
): Promise<Mark | undefined> {
  const { rows } = await sql<Mark["before"]>`
    update app.run_page p set needs_save = true, needs_save_why = ${JSON.stringify(why)}::jsonb,
      checked = case when ${forgetCheck} then null else p.checked end, updated_at = now()
    from (select needs_save, needs_save_why, checked from app.run_page
          where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page} for update) before
    where p.publication_id = ${publicationId} and p.run_id = ${runId} and p.page_no = ${page}
    returning before.needs_save, before.needs_save_why, before.checked`.execute(tx);
  return rows[0] && { page, why, before: rows[0] };
}

/** editing.unmark_move, for a move or a save the engine refused: each mark goes back (and a check forgotten with it),
 * unless another one replaced it since. */
export async function unmark(tx: Tx, publicationId: string, runId: string, marks: readonly Mark[]): Promise<void> {
  const j = (value: unknown) => (value === null ? null : JSON.stringify(value));
  for (const { page, why, before } of marks) {
    await sql`update app.run_page set needs_save = ${before.needs_save},
        needs_save_why = ${j(before.needs_save_why)}::jsonb, checked = coalesce(checked, ${j(before.checked)}::jsonb),
        updated_at = now()
      where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page} and needs_save
        and needs_save_why = ${JSON.stringify(why)}::jsonb`.execute(tx);
  }
}

/** editing.before_save: the page (its check forgotten) and the pages it takes a story from, "needs saving". → the
 * marks, for unmark. */
export async function beforeSave(
  tx: Tx,
  publicationId: string,
  runId: string,
  page: number,
  unfinished: DeskTextValue,
  others: readonly { page: number; why: DeskTextValue }[],
): Promise<Mark[]> {
  const marks = [await markNeedsSave(tx, publicationId, runId, page, unfinished, true)];
  for (const other of others) marks.push(await markNeedsSave(tx, publicationId, runId, other.page, other.why));
  return marks.filter((mark) => mark !== undefined);
}

/** The transaction's time (now()): no read in it is older. */
export async function transactionTime(tx: Tx): Promise<Date> {
  const { rows } = await sql<{ at: Date }>`select now() as at`.execute(tx);
  if (!rows[0]) throw new Error("the database told no time");
  return rows[0].at;
}

/** The Desk's words a save writes (modules/editor/views.ts SAVE_WORDS). */
export type SaveWords = {
  movedFrom: (page: number) => DeskTextValue;
  notPlacedEdited: DeskTextValue;
  deletedAfter: DeskTextValue;
};

/** The articles on the run's pages, in page order. */
async function onPages(tx: Tx, publicationId: string, runId: string): Promise<string[]> {
  const { rows } = await sql<{ articles: string[] }>`select articles from app.run_page
    where publication_id = ${publicationId} and run_id = ${runId} order by page_no`.execute(tx);
  return rows.flatMap((row) => row.articles);
}

/** editing.saved_page and after_save, from the gateway's SavedPage: the pages a story left take their article lists
 * and need saving; the page records its files, what it prints, its problems and warnings, and stays "needs saving"
 * when a step after the export failed (saved.error). Its check is recorded separately (recordPageCheck). A PDF that
 * could not be stored (saved.pdf null) records nothing of the page but why it still needs saving. Its saved_at is
 * liveAt: when the save read the live edition it prints (the release's folio check compares it). A stored PDF's ad
 * rasters (saved.ads) go into the run's ad_rasters (null takes the slot out), which the release compares with each
 * slot's artwork now. Then the run's not_placed is counted again (editing._recount_not_placed): live holds the
 * edition's live article ids (the call's `live`). */
export async function afterSave(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  runId: string,
  page: number,
  saved: SavedPage,
  words: SaveWords,
  liveAt: Date,
  live: ReadonlySet<string>,
): Promise<void> {
  const before = await onPages(tx, publicationId, runId);
  for (const [n, articles] of Object.entries(saved.pages_changed)) {
    await sql`update app.run_page set articles = ${JSON.stringify(articles)}::jsonb, needs_save = true,
        needs_save_why = ${JSON.stringify(words.movedFrom(page))}::jsonb, updated_at = now()
      where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${Number(n)}`.execute(tx);
  }
  const j = (value: unknown) => (value === null ? null : JSON.stringify(value));
  if (saved.pdf === null) {
    await sql`update app.run_page set needs_save = true, needs_save_why = ${j(saved.error)}::jsonb, updated_at = now()
      where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page}`.execute(tx);
    return recountNotPlaced(tx, publicationId, runId, before, words, live);
  }
  await sql`update app.run_page set
      pdf = ${j(saved.pdf)}::jsonb, pdf_sha256 = ${saved.pdf.sha256},
      png = coalesce(${j(saved.png)}::jsonb, png), thumb = coalesce(${j(saved.thumb)}::jsonb, thumb),
      articles = ${JSON.stringify(saved.articles)}::jsonb, printed = ${j(saved.printed)}::jsonb,
      layout_problems = ${JSON.stringify(saved.layout_problems)}::jsonb,
      layout_problems_now = ${JSON.stringify(saved.layout_problems)}::jsonb,
      warnings = ${JSON.stringify(saved.warnings)}::jsonb, stale = ${JSON.stringify(saved.stale)}::jsonb,
      pdf_rev = ${saved.rev}, edited = true, edited_unsaved = rev_seen > ${saved.rev},
      needs_save = ${saved.error !== null}, needs_save_why = ${j(saved.error)}::jsonb,
      checked = null, report = null, saved_at = ${liveAt}, saved_by = ${who.userId}, updated_at = now()
    where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page}`.execute(tx);
  // ad_rasters' values are SHA-256 strings, so stripping nulls takes out exactly the slots the page prints no ad in
  await sql`update app.layout_run set
      edition_pdf = coalesce(${j(saved.edition_pdf)}::jsonb, edition_pdf),
      press_zip = coalesce(${j(saved.press_zip)}::jsonb, press_zip),
      ad_rasters = jsonb_strip_nulls(coalesce(ad_rasters, '{}'::jsonb) || ${JSON.stringify(saved.ads)}::jsonb),
      updated_at = now()
    where publication_id = ${publicationId} and id = ${runId}`.execute(tx);
  await recountNotPlaced(tx, publicationId, runId, before, words, live);
}

/** The run's articles (those on its pages before the save, and those it left out: every save keeps them in this set)
 * on no page now are listed, in a stable order: "deleted after the layout" when the edition no longer has them, else
 * as listed before, else taken off in the editor. An article back on a page leaves the list. */
async function recountNotPlaced(
  tx: Tx,
  publicationId: string,
  runId: string,
  before: readonly string[],
  words: SaveWords,
  live: ReadonlySet<string>,
): Promise<void> {
  const { rows } = await sql<{ not_placed: { article: string; reason: DeskTextValue }[] }>`select not_placed
    from app.layout_run where publication_id = ${publicationId} and id = ${runId}`.execute(tx);
  const earlier = new Map((rows[0]?.not_placed ?? []).map((entry) => [entry.article, entry]));
  const placed = new Set(await onPages(tx, publicationId, runId));
  const left = [...new Set([...earlier.keys(), ...before])]
    .filter((article) => !placed.has(article))
    .map((article) =>
      !live.has(article)
        ? { article, reason: words.deletedAfter }
        : (earlier.get(article) ?? { article, reason: words.notPlacedEdited }),
    );
  await sql`update app.layout_run set not_placed = ${JSON.stringify(left)}::jsonb, updated_at = now()
    where publication_id = ${publicationId} and id = ${runId}
      and not_placed is distinct from ${JSON.stringify(left)}::jsonb`.execute(tx);
}

export type CheckVerdict = { passed: boolean; fails: number | null; warnings: number | null };

/** The checker's verdict on these exact bytes, if it was given before (plan §2.3: never checked twice). */
export async function cachedCheck(tx: Tx, sha256: string, checkerSha256: string) {
  const { rows } = await sql<CheckVerdict & { report_key: string | null; report_version_id: string | null }>`
    select passed, fails, warnings, report_key, report_version_id from app.pdf_check
    where sha256 = ${sha256} and checker_sha256 = ${checkerSha256}`.execute(tx);
  return rows[0];
}

/** The saved page's check, when its PDF is still the one checked (a later save replaced nothing meanwhile). */
export async function recordPageCheck(
  tx: Tx,
  publicationId: string,
  runId: string,
  page: number,
  sha256: string,
  verdict: CheckVerdict,
  report: Pick<Stored, "key" | "version_id"> | null,
): Promise<void> {
  await sql`update app.run_page set checked = ${JSON.stringify(verdict)}::jsonb,
      report = ${report ? JSON.stringify(report) : null}::jsonb, updated_at = now()
    where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page}
      and pdf_sha256 = ${sha256}`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ the soft lock

export type LockRow = {
  holder_id: string;
  holder_name: string;
  expires_at: Date;
  live: boolean;
  asked_by: string | null;
  asked_name: string | null;
  /** the ask is 30 s old or more */
  ask_due: boolean;
};

export const LOCK_SECONDS = 75;
export const ASK_SECONDS = 30;

export async function lockOf(tx: Tx, publicationId: string, runId: string, page: number, forUpdate = false) {
  const { rows } = await sql<LockRow>`
    select l.holder_id, h.display_name as holder_name, l.expires_at, l.expires_at > now() as live, l.asked_by,
      a.display_name as asked_name, coalesce(l.asked_at <= now() - make_interval(secs => ${ASK_SECONDS}), false)
        as ask_due
    from app.page_lock l
    join app.person h on h.org_id = l.org_id and h.user_id = l.holder_id
    left join app.person a on a.org_id = l.org_id and a.user_id = l.asked_by
    where l.publication_id = ${publicationId} and l.run_id = ${runId} and l.page_no = ${page}
    ${forUpdate ? sql`for update of l` : sql``}`.execute(tx);
  return rows[0];
}

/** The lock taken or beaten by this person: an ask stays only while the holder stays the same. */
export async function holdLock(tx: Tx, who: Tenant, publicationId: string, runId: string, page: number) {
  await sql`insert into app.page_lock (org_id, publication_id, run_id, page_no, holder_id, expires_at)
    values (${who.orgId}, ${publicationId}, ${runId}, ${page}, ${who.userId},
      now() + make_interval(secs => ${LOCK_SECONDS}))
    on conflict (org_id, publication_id, run_id, page_no) do update set
      asked_by = case when page_lock.holder_id = excluded.holder_id then page_lock.asked_by end,
      asked_at = case when page_lock.holder_id = excluded.holder_id then page_lock.asked_at end,
      holder_id = excluded.holder_id, heartbeat_at = now(), expires_at = excluded.expires_at`.execute(tx);
}

/** Asked to take over (the first ask's time is kept, so asking again does not restart the 30 s). */
export async function askLock(tx: Tx, who: Tenant, publicationId: string, runId: string, page: number) {
  await sql`update app.page_lock set asked_by = ${who.userId},
      asked_at = case when asked_by = ${who.userId} then asked_at else now() end
    where publication_id = ${publicationId} and run_id = ${runId} and page_no = ${page}`.execute(tx);
}

export async function releaseLock(tx: Tx, who: Tenant, publicationId: string, runId: string, page: number) {
  await sql`delete from app.page_lock where publication_id = ${publicationId} and run_id = ${runId}
    and page_no = ${page} and holder_id = ${who.userId}`.execute(tx);
}

// ------------------------------------------------------------------------------------------------ history

export type HistoryRow = {
  rev: number;
  cause: Cause;
  author_id: string | null;
  author_name: string | null;
  created_at: Date;
  /** null: never saved; else whether the independent check passed its last save's PDF (false until it ran) */
  saved_passed: boolean | null;
};

/** A save of the page, kept for its history. */
export async function recordSave(
  tx: Tx,
  who: Tenant,
  publicationId: string,
  runId: string,
  page: number,
  rev: number,
  pdfSha256: string,
): Promise<void> {
  await sql`insert into app.page_save (org_id, publication_id, run_id, page_no, rev, pdf_sha256, saved_by)
    values (${who.orgId}, ${publicationId}, ${runId}, ${page}, ${rev}, ${pdfSha256}, ${who.userId})
    on conflict do nothing`.execute(tx);
}

/** The page's revisions, newest first, each with its author and, when it was saved, its last save's check. */
export async function pageHistory(tx: Tx, publicationId: string, runId: string, page: number, limit: number) {
  const { rows } = await sql<HistoryRow>`
    select e.rev, e.cause, e.author_id, a.display_name as author_name, e.created_at,
      (select coalesce(c.passed, false) from app.page_save s
         left join app.pdf_check c on c.org_id = s.org_id and c.sha256 = s.pdf_sha256
       where s.org_id = e.org_id and s.publication_id = e.publication_id and s.run_id = e.run_id
         and s.page_no = e.page_no and s.rev = e.rev
       order by s.saved_at desc, c.created_at desc limit 1) as saved_passed
    from app.page_edit e
    left join app.person a on a.org_id = e.org_id and a.user_id = e.author_id
    where e.publication_id = ${publicationId} and e.run_id = ${runId} and e.page_no = ${page}
    order by e.rev desc limit ${limit}`.execute(tx);
  return rows;
}
