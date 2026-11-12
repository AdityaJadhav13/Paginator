import type { EditChange, EditorPage, GlyphOutlines, PageHistory, PageLock } from "@pageinator/contracts";
import type { ApiProblem } from "./problem.ts";
import type { ServiceResult } from "./result.ts";

/** The API's own shapes (@pageinator/contracts editor.ts): the page editor, hosted (L2.4). */
export type EditorPageDto = EditorPage;
export type EditChangeDto = EditChange;
export type PageLockDto = PageLock;
export type PageHistoryDto = PageHistory;
export type GlyphOutlinesDto = GlyphOutlines;

export interface EditorWhere {
  readonly orgId: string;
  readonly pubId: string;
  readonly runId: string;
  readonly page: number;
}

/**
 * A page of a done run in the editor (plan §1 L2.4, §2.4), under /api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit: open
 * it (taking the soft lock when free), a change (409 stale with `current`, the page now; 409 page_locked), a save
 * (export, the independent check, merge), its history, the lock's heartbeat, release and take-over; and the run's glyph
 * outlines and pictures the canvas draws.
 */
export interface EditorService {
  open(input: EditorWhere): Promise<ServiceResult<EditorPageDto, ApiProblem>>;
  get(input: EditorWhere): Promise<ServiceResult<EditorPageDto, ApiProblem>>;
  change(input: EditorWhere & { readonly change: EditChangeDto }): Promise<ServiceResult<EditorPageDto, ApiProblem>>;
  save(input: EditorWhere & { readonly rev: number }): Promise<ServiceResult<EditorPageDto, ApiProblem>>;
  history(input: EditorWhere): Promise<ServiceResult<PageHistoryDto, ApiProblem>>;
  heartbeat(input: EditorWhere): Promise<ServiceResult<PageLockDto, ApiProblem>>;
  release(input: EditorWhere): Promise<ServiceResult<void, ApiProblem>>;
  takeover(input: EditorWhere): Promise<ServiceResult<PageLockDto, ApiProblem>>;
  glyphs(
    input: Omit<EditorWhere, "page"> & { readonly face: string; readonly ids: readonly number[] },
  ): Promise<ServiceResult<GlyphOutlinesDto, ApiProblem>>;
  /** The picture's address (same origin: the browser sends the session's cookie with it). */
  rasterUrl(input: Omit<EditorWhere, "page"> & { readonly key: string }): string;
}
