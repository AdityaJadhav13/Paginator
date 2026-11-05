/**
 * Editions and layout over the API (docs/product/10-l2-newsroom-plan.md §1 L2.3), under /api/v1/orgs/:o/pubs/:p; every
 * answer read with the API's own schema (@pageinator/contracts layout.ts), so a change of shape shows as an error,
 * never as a wrong screen. A run's file is reached by a 5-minute link (GET …/runs/:r/files/:name); a picture is fetched
 * from that link at once, never kept in the HTTP cache (`cache: "no-store"`), and held in memory only. Following the
 * link from the page needs the store to allow this origin (CORS), as a photo's original does.
 */
import {
  AdSlot,
  EditionLayout,
  EngineProfile,
  EngineProfileList,
  FileLink,
  LayoutRun,
  SectionList,
  TemplatesView,
} from "@pageinator/contracts";
import type { ApiProblem, LayoutService, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: answer.problem };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

const pub = (orgId: string, pubId: string) =>
  `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}`;
const edition = (orgId: string, pubId: string, editionId: string) =>
  `${pub(orgId, pubId)}/editions/${encodeURIComponent(editionId)}`;
const run = (orgId: string, pubId: string, runId: string) => `${pub(orgId, pubId)}/runs/${encodeURIComponent(runId)}`;

export function createApiLayoutService(
  client: ApiClient,
  options: { readonly fetch?: typeof fetch; readonly isOnline?: () => boolean } = {},
): LayoutService {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const online = options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const service: LayoutService = {
    async listProfiles({ orgId, pubId }) {
      return read(EngineProfileList, await client.get(`${pub(orgId, pubId)}/engine-profiles`));
    },
    async createProfile({ orgId, pubId, uploadId, idempotencyKey }) {
      return read(
        EngineProfile,
        await client.post(`${pub(orgId, pubId)}/engine-profiles`, { uploadId }, { idempotencyKey }),
      );
    },
    async getLayout({ orgId, pubId, editionId }) {
      return read(EditionLayout, await client.get(`${edition(orgId, pubId, editionId)}/layout`));
    },
    async setAd({ orgId, pubId, editionId, slot, assetId }) {
      return read(
        AdSlot,
        await client.put(`${edition(orgId, pubId, editionId)}/ads/${encodeURIComponent(slot)}`, { assetId }),
      );
    },
    async clearAd({ orgId, pubId, editionId, slot }) {
      const answer = await client.delete(`${edition(orgId, pubId, editionId)}/ads/${encodeURIComponent(slot)}`);
      return answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };
    },
    async startRun({ orgId, pubId, editionId, idempotencyKey }) {
      return read(
        LayoutRun,
        await client.post(`${edition(orgId, pubId, editionId)}/runs`, undefined, { idempotencyKey }),
      );
    },
    async getRun({ orgId, pubId, runId }) {
      return read(LayoutRun, await client.get(run(orgId, pubId, runId)));
    },
    async cancelRun({ orgId, pubId, runId }) {
      return read(LayoutRun, await client.post(`${run(orgId, pubId, runId)}/cancel`, {}));
    },
    async fileLink({ orgId, pubId, runId, name }) {
      return read(FileLink, await client.get(`${run(orgId, pubId, runId)}/files/${encodeURIComponent(name)}`));
    },
    async getTemplates({ orgId, pubId }) {
      return read(TemplatesView, await client.get(`${pub(orgId, pubId)}/templates`));
    },
    async chooseTemplate({ orgId, pubId, choice, idempotencyKey }) {
      return read(EngineProfile, await client.post(`${pub(orgId, pubId)}/templates`, choice, { idempotencyKey }));
    },
    async listSections({ orgId, pubId }) {
      return read(SectionList, await client.get(`${pub(orgId, pubId)}/sections`));
    },
    async addSection({ orgId, pubId, name }) {
      return read(SectionList, await client.post(`${pub(orgId, pubId)}/sections`, { name }));
    },
    async changeSection({ orgId, pubId, id, change }) {
      return read(SectionList, await client.patch(`${pub(orgId, pubId)}/sections/${encodeURIComponent(id)}`, change));
    },
    async loadFile({ orgId, pubId, runId, name, signal }) {
      const link = await service.fileLink({ orgId, pubId, runId, name });
      if (!link.ok) return link;
      const stopped = {
        ok: false as const,
        error: { kind: "answer" as const, status: 0, code: "upload_cancelled", message: "" },
      };
      try {
        const response = await fetchImpl(link.value.url, { cache: "no-store", ...(signal ? { signal } : {}) });
        if (!response.ok) {
          const code =
            response.status === 404 ? "not_found" : response.status >= 500 ? "server_error" : `http_${response.status}`;
          return { ok: false, error: { kind: "answer", status: response.status, code, message: "" } };
        }
        return { ok: true, value: await response.blob() };
      } catch {
        if (signal?.aborted) return stopped;
        return { ok: false, error: online() ? { kind: "network" } : { kind: "offline" } };
      }
    },
  };
  return service;
}
