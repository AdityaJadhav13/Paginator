/**
 * The stories over the API's own endpoints (docs/product/10-l2-newsroom-plan.md §5.2, §5.4), every answer read with
 * the API's own schema (@pageinator/contracts), so a change of shape shows as an error, never as a wrong screen. A
 * 409 story_changed keeps the story as it is now in the problem's `current`, when it is one.
 */
import { DocxImport, ImportAccepted, PasteResult, Story, StoryList } from "@pageinator/contracts";
import type { ApiProblem, ServiceResult, StoryService } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: withCurrent(answer.problem) };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

/** A story_changed problem keeps `current` only as a story the web can read. */
function withCurrent(problem: ApiProblem): ApiProblem {
  if (problem.kind !== "answer" || problem.current === undefined) return problem;
  const { current, ...rest } = problem;
  const story = Story.safeParse(current);
  return story.success ? { ...rest, current: story.data } : rest;
}

const pub = (orgId: string, pubId: string) => `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}`;
const base = (orgId: string, pubId: string) => `${pub(orgId, pubId)}/stories`;
const one = (orgId: string, pubId: string, storyId: string) => `${base(orgId, pubId)}/${encodeURIComponent(storyId)}`;

export function createApiStoryService(client: ApiClient): StoryService {
  return {
    async list({ orgId, pubId, filter }) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) {
        if (value !== undefined && value !== "") query.set(key, String(value));
      }
      const search = query.toString();
      return read(StoryList, await client.get(`${base(orgId, pubId)}${search ? `?${search}` : ""}`));
    },
    async get({ orgId, pubId, storyId }) {
      return read(Story, await client.get(one(orgId, pubId, storyId)));
    },
    async create({ orgId, pubId, input, idempotencyKey }) {
      return read(Story, await client.post(base(orgId, pubId), input, { idempotencyKey }));
    },
    async update({ orgId, pubId, storyId, patch, keepalive }) {
      return read(Story, await client.patch(one(orgId, pubId, storyId), patch, keepalive ? { keepalive } : {}));
    },
    async transition({ orgId, pubId, storyId, to, baseRevision, comment, idempotencyKey }) {
      const body = { to, baseRevision, ...(comment !== undefined && comment !== "" ? { comment } : {}) };
      return read(Story, await client.post(`${one(orgId, pubId, storyId)}/transitions`, body, { idempotencyKey }));
    },
    async assign({ orgId, pubId, storyId, baseRevision, userId }) {
      return read(Story, await client.post(`${one(orgId, pubId, storyId)}/assignee`, { baseRevision, userId }));
    },
    async attachPhoto({ orgId, pubId, storyId, baseRevision, assetId, caption, credit }) {
      return read(Story, await client.put(`${one(orgId, pubId, storyId)}/photo`, { baseRevision, assetId, caption, credit }));
    },
    async updatePhoto({ orgId, pubId, storyId, baseRevision, caption, credit, keepalive }) {
      const body = { baseRevision, ...(caption !== undefined ? { caption } : {}), ...(credit !== undefined ? { credit } : {}) };
      return read(Story, await client.patch(`${one(orgId, pubId, storyId)}/photo`, body, keepalive ? { keepalive } : {}));
    },
    async removePhoto({ orgId, pubId, storyId, baseRevision }) {
      return read(Story, await client.delete(`${one(orgId, pubId, storyId)}/photo?baseRevision=${baseRevision}`));
    },
    async paste({ orgId, pubId, text, editionId, idempotencyKey }) {
      const body = { text, ...(editionId ? { editionId } : {}) };
      return read(PasteResult, await client.post(`${base(orgId, pubId)}/paste`, body, { idempotencyKey }));
    },
    async importDocx({ orgId, pubId, uploadId, editionId, idempotencyKey }) {
      const body = { uploadId, ...(editionId ? { editionId } : {}) };
      return read(ImportAccepted, await client.post(`${pub(orgId, pubId)}/imports/docx`, body, { idempotencyKey }));
    },
    async getImport({ orgId, pubId, importId }) {
      return read(DocxImport, await client.get(`${pub(orgId, pubId)}/imports/${encodeURIComponent(importId)}`));
    },
  };
}
