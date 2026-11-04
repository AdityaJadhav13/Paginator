// What the layout routes answer (packages/contracts/src/layout.ts), from the rows of src/db/layout.ts, and the Desk's
// own words the API itself says (tools/desk/engine/messages.json; test/unit/layout.test.ts keeps them equal).
import type { EngineProfile, LayoutPage, LayoutRun } from "@pageinator/contracts";
import type { DeskTextValue, PageRow, ProfileRow, RunRow } from "../../db/layout.ts";
import type { Tx } from "../../db/tenant.ts";
import { storiesByDeskKey } from "../../db/layout.ts";

const desk = (code: string, text: string): DeskTextValue => ({ text, code, params: null });

/** The Desk's words for a run the server lost (a worker restarted or stopped mid-run, or its heartbeat stopped). */
export const RESTARTED = desk(
  "m.run.restarted",
  "The server was restarted while this run was in progress. Start it again.",
);
export const CANCELLED = desk("m.run.cancelled", "Cancelled.");
export const CANCELLED_BEFORE = desk("m.run.cancelledBefore", "Cancelled before it started.");

/** A run that failed for a reason the Desk has no words for: the engine's code, in plain words. */
export function runFailed(code: string): DeskTextValue {
  return {
    text: `The layout could not be finished (${code}). Start it again; if it happens again, tell the operator.`,
    code: null,
    params: null,
  };
}

/** A failure in the engine's own words, as a DeskText (no code of the Desk's). */
export const plain = (text: string): DeskTextValue => ({
  text: text.slice(0, 2000) || "(no message)",
  code: null,
  params: null,
});

export function profileView(row: ProfileRow): EngineProfile {
  return {
    id: row.id,
    version: row.version,
    state: row.state,
    datasetSha256: row.dataset_sha256,
    datasetBytes: Number(row.dataset_bytes),
    configSha256: row.config_sha256,
    engineVersion: row.engine_version,
    templates: row.templates,
    grid: row.grid
      ? { columns: row.grid.columns, columnMm: row.grid.column_width_mm, gutterMm: row.grid.gutter_mm }
      : null,
    error: row.problem ? { code: row.problem, message: row.message ?? plain(row.problem) } : null,
    createdBy: row.created_by_name !== null ? { id: row.created_by, name: row.created_by_name } : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The runs as the routes answer them, their pages and stories read in one go. */
export async function runViews(tx: Tx, publicationId: string, runs: RunRow[], pages: PageRow[]): Promise<LayoutRun[]> {
  const keys = new Set<string>();
  for (const page of pages) for (const key of page.articles) keys.add(key);
  for (const run of runs) for (const left of run.not_placed) keys.add(left.article);
  const stories = await storiesByDeskKey(tx, publicationId, [...keys]);
  const story = (deskKey: string) => {
    const found = stories.get(deskKey);
    return { storyId: found?.id ?? null, deskKey, headline: found?.headline ?? null };
  };
  return runs.map((run) => {
    const end = run.finished_at ?? new Date();
    const elapsed =
      run.elapsed_s ?? (run.started_at ? Math.max(0, (end.getTime() - run.started_at.getTime()) / 1000) : 0);
    return {
      id: run.id,
      editionId: run.edition_id,
      deskKey: run.desk_key,
      state: run.state,
      message: run.message,
      error: run.error,
      profileVersion: run.profile_version ?? 0,
      createdBy: run.created_by_name !== null ? { id: run.created_by, name: run.created_by_name } : null,
      createdAt: run.created_at.toISOString(),
      startedAt: run.started_at?.toISOString() ?? null,
      finishedAt: run.finished_at?.toISOString() ?? null,
      elapsedS: elapsed,
      pages: pages
        .filter((page) => page.run_id === run.id)
        .map((page): LayoutPage => ({
          page: page.page_no,
          role: page.role,
          state: page.state,
          stories: page.articles.map(story),
          pdf: page.pdf !== null,
          preview: page.png !== null,
          check: page.checked,
          warnings: page.warnings,
          message: page.message,
        })),
      notPlaced: run.not_placed.map((left) => ({ ...story(left.article), reason: left.reason })),
      files: { editionPdf: run.edition_pdf !== null, pressZip: run.press_zip !== null },
      timings: run.timings,
    };
  });
}
