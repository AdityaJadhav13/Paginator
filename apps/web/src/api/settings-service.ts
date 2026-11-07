/**
 * Organization and publication settings over the API (@pageinator/contracts settings.ts, whose header lists the
 * routes); every answer read with the API's own schema.
 */
import { OrgSettings, PublicationSettings } from "@pageinator/contracts";
import type { ApiProblem, ServiceResult, SettingsService } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: answer.problem };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

const org = (orgId: string) => `/api/v1/orgs/${encodeURIComponent(orgId)}`;
const pub = (orgId: string, pubId: string) => `${org(orgId)}/pubs/${encodeURIComponent(pubId)}/settings`;

export function createApiSettingsService(client: ApiClient): SettingsService {
  return {
    async getOrg({ orgId }) {
      return read(OrgSettings, await client.get(`${org(orgId)}/settings`));
    },
    async renameOrg({ orgId, name }) {
      return read(OrgSettings, await client.patch(`${org(orgId)}/settings`, { name }));
    },
    async addPublication({ orgId, publication }) {
      return read(OrgSettings, await client.post(`${org(orgId)}/publications`, publication));
    },
    async getPublication({ orgId, pubId }) {
      return read(PublicationSettings, await client.get(pub(orgId, pubId)));
    },
    async setPublication({ orgId, pubId, change }) {
      return read(PublicationSettings, await client.patch(pub(orgId, pubId), change));
    },
  };
}
