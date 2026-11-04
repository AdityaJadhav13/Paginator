// What the page editor's routes answer (packages/contracts/src/editor.ts), from the rows of src/db/editor.ts, and the
// Desk's own words the API says itself (tools/desk/engine/messages.json; test/unit/editor.test.ts keeps them equal).
import { type EditorPage, type PageApproval, type PageLock, type PressFlags, pressFlags } from "@pageinator/contracts";
import type { EditPageRow, LockRow } from "../../db/editor.ts";
import type { DeskTextValue } from "../../db/layout.ts";

/** A message of the Desk's messages.json, its {params} filled in. */
const desk = (code: string, template: string, params: Record<string, number> | null = null): DeskTextValue => ({
  text: template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? "")),
  code,
  params,
});

export const MESSAGES = {
  "m.save.movedHere": "A story was moved here from page {page}: check its place and save the page.",
  "m.save.unfinished": "The last save of this page did not finish: save it again.",
  "m.save.taking":
    "Page {page} is taking a story from this page: when page {page} has been saved, open this page, fill the space and save it.",
  "m.save.movedFrom": "A story moved from this page to page {page}: open it, fill the space and save it.",
} as const;

export const movedHere = (page: number) => desk("m.save.movedHere", MESSAGES["m.save.movedHere"], { page });
export const UNFINISHED = desk("m.save.unfinished", MESSAGES["m.save.unfinished"]);
export const taking = (page: number) => desk("m.save.taking", MESSAGES["m.save.taking"], { page });
export const movedFrom = (page: number) => desk("m.save.movedFrom", MESSAGES["m.save.movedFrom"], { page });

const PLACEMENT = new Set(["overlap", "outside"]);

/** editing.placement: the kinds of problem in an answer that a print file must never have ([] when none), null when
 * the answer has no list (nothing to note); a list that cannot be read is "unreadable" (fail closed). */
export function placement(problems: unknown): string[] | null {
  if (problems === null || problems === undefined) return null;
  if (!Array.isArray(problems)) return ["unreadable"];
  const kinds = new Set<string>();
  let unreadable = false;
  for (const p of problems) {
    if (typeof p !== "object" || p === null) unreadable = true;
    else if (PLACEMENT.has((p as { kind?: unknown }).kind as string)) kinds.add((p as { kind: string }).kind);
  }
  return [...[...kinds].sort(), ...(unreadable ? ["unreadable"] : [])];
}

export function flagsOf(runState: string, pages: readonly EditPageRow[]): PressFlags {
  return pressFlags(
    runState,
    pages.map((p) => ({
      page: p.page_no,
      state: p.state,
      articles: p.articles,
      needsSave: p.needs_save,
      editedUnsaved: p.edited_unsaved,
      stale: p.stale,
      checkPassed: p.checked?.passed === true,
      edited: p.edited,
      layoutProblems: p.layout_problems,
      layoutProblemsNow: p.layout_problems_now,
    })),
  );
}

export function lockView(lock: LockRow | undefined, userId: string): PageLock {
  if (!lock || !lock.live) return { holder: null, mine: false, expiresAt: null, askedBy: null };
  return {
    holder: { id: lock.holder_id, name: lock.holder_name },
    mine: lock.holder_id === userId,
    expiresAt: lock.expires_at.toISOString(),
    askedBy: lock.asked_by !== null ? { id: lock.asked_by, name: lock.asked_name ?? "" } : null,
  };
}

export function editorPage(
  run: { id: string; edition_id: string; state: string },
  pages: readonly EditPageRow[],
  page: number,
  view: Record<string, unknown>,
  lock: PageLock,
  saved: EditorPage["saved"] = null,
  approval: PageApproval | null = null,
): EditorPage {
  const row = pages.find((p) => p.page_no === page);
  const rev = typeof view["rev"] === "number" ? view["rev"] : (row?.rev_seen ?? 0);
  return {
    runId: run.id,
    editionId: run.edition_id,
    page,
    pages: pages.map((p) => ({ page: p.page_no, role: p.role, state: p.state })),
    rev,
    view,
    lock,
    flags: flagsOf(run.state, pages),
    pageState: {
      editedUnsaved: row?.edited_unsaved ?? false,
      needsSave: row?.needs_save ?? false,
      needsSaveReason: row?.needs_save_why ?? null,
      check: row?.checked ?? null,
      stale: row?.stale ?? [],
    },
    saved,
    approval,
  };
}
