/**
 * A publication's editions over the API (docs/product/10-l2-newsroom-plan.md §1 L2.1, §5.2), every answer read with
 * the API's own schema (@pageinator/contracts). A 409 edition_exists keeps the edition of that date in the problem's
 * `current`, when it is one. "Send to the Desk" takes the story bundle's ZIP as a Blob, with its file name from
 * Content-Disposition and its story count from X-Pageinator-Stories.
 */
import { Edition, EditionList } from "@pageinator/contracts";
import type { ApiProblem, EditionService, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: withCurrent(answer.problem) };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

/** An edition_exists problem keeps `current` only as an edition the web can read. */
function withCurrent(problem: ApiProblem): ApiProblem {
  if (problem.kind !== "answer" || problem.current === undefined) return problem;
  const { current, ...rest } = problem;
  const edition = Edition.safeParse(current);
  return edition.success ? { ...rest, current: edition.data } : rest;
}

const base = (orgId: string, pubId: string) =>
  `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}/editions`;

/** filename="…" from Content-Disposition, kept only when it is a plain file name. */
function filenameOf(headers: Headers): string | undefined {
  const name = /filename="([^"/\\]+)"/.exec(headers.get("Content-Disposition") ?? "")?.[1];
  return name && name.endsWith(".zip") ? name : undefined;
}

export function createApiEditionService(client: ApiClient): EditionService {
  return {
    async list({ orgId, pubId }) {
      const result = read(EditionList, await client.get(base(orgId, pubId)));
      return result.ok ? { ok: true, value: result.value.items } : result;
    },
    async create({ orgId, pubId, input, idempotencyKey }) {
      return read(Edition, await client.post(base(orgId, pubId), input, { idempotencyKey }));
    },
    async deskBundle({ orgId, pubId, editionId }) {
      const answer = await client.download(
        `${base(orgId, pubId)}/${encodeURIComponent(editionId)}/desk-bundle`,
        {},
        { headers: { Accept: "application/zip, application/json" } },
      );
      if (!answer.ok) return { ok: false, error: answer.problem };
      const stories = answer.value.headers.get("X-Pageinator-Stories") ?? "";
      const filename = filenameOf(answer.value.headers);
      if (!/^\d{1,6}$/.test(stories) || !filename) return { ok: false, error: UNEXPECTED };
      return { ok: true, value: { file: answer.value.blob, filename, stories: Number(stories) } };
    },
  };
}
