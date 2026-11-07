/**
 * The page editor over the API (docs/product/10-l2-newsroom-plan.md §1 L2.4, §2.4), under
 * /api/v1/orgs/:o/pubs/:p/runs/:r: every answer read with the API's own schema (@pageinator/contracts editor.ts), so a
 * change of shape shows as an error, never as a wrong page. A 409 stale keeps the page as it is now in the problem's
 * `current`, when it is one; a 400 edit_refused keeps the engine's own words (DeskText). The engine's calls wait as long
 * as the API does for the engine (EDIT_TIMEOUT_MS); glyph outlines may come from the browser's cache.
 */
import { DeskText, EditorPage, GlyphOutlines, PageHistory, PageLock } from "@pageinator/contracts";
import type { ApiProblem, EditorService, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

/** The API waits up to 900 s for the engine (a refresh or a save of a full page). */
export const EDIT_TIMEOUT_MS = 900_000;
const SLOW = { timeoutMs: EDIT_TIMEOUT_MS } as const;

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: withCurrent(answer.problem) };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

/** A problem keeps `current` only as what the editor can read: the engine's words of a refusal, else a page. */
function withCurrent(problem: ApiProblem): ApiProblem {
  if (problem.kind !== "answer" || problem.current === undefined) return problem;
  const { current, ...rest } = problem;
  const page = (problem.code === "edit_refused" ? DeskText : EditorPage).safeParse(current);
  return page.success ? { ...rest, current: page.data } : rest;
}

const run = (orgId: string, pubId: string, runId: string) =>
  `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}/runs/${encodeURIComponent(runId)}`;

export function createApiEditorService(client: ApiClient): EditorService {
  const edit = ({ orgId, pubId, runId, page }: { orgId: string; pubId: string; runId: string; page: number }) =>
    `${run(orgId, pubId, runId)}/pages/${page}/edit`;
  return {
    async open(input) {
      return read(EditorPage, await client.post(edit(input), {}, SLOW));
    },
    async get(input) {
      return read(EditorPage, await client.get(edit(input), SLOW));
    },
    async change(input) {
      return read(EditorPage, await client.post(`${edit(input)}/change`, input.change, SLOW));
    },
    async save(input) {
      return read(EditorPage, await client.post(`${edit(input)}/save`, { rev: input.rev }, SLOW));
    },
    async history(input) {
      return read(PageHistory, await client.get(`${edit(input)}/history`));
    },
    async heartbeat(input) {
      return read(PageLock, await client.post(`${edit(input)}/lock`, {}));
    },
    async release(input) {
      const answer = await client.delete(`${edit(input)}/lock`, { keepalive: true });
      return answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };
    },
    async takeover(input) {
      return read(PageLock, await client.post(`${edit(input)}/takeover`, {}));
    },
    async glyphs({ orgId, pubId, runId, face, ids }) {
      const path = `${run(orgId, pubId, runId)}/glyphs/${encodeURIComponent(face)}?ids=${ids.join(",")}`;
      return read(GlyphOutlines, await client.get(path, { cache: "default" }));
    },
    rasterUrl({ orgId, pubId, runId, key }) {
      return `${run(orgId, pubId, runId)}/rasters/${encodeURIComponent(key)}.jpg`;
    },
  };
}
