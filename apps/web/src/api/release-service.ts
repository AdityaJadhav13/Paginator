/**
 * The release over the API (docs/product/10-l2-newsroom-plan.md §1 L2.5), under /api/v1/orgs/:o/pubs/:p: every answer
 * read with the API's own schema (@pageinator/contracts release.ts), so a change of shape shows as an error, never as
 * a wrong screen. A refusal (409 approval_stale, release_refused, already_confirmed; 502 archive_failed) comes back as
 * the problem; the screen fetches the release again to show what it is now.
 */
import { ArchiveCheck, EditionRelease, FileLink, PressTest, Release, ReleasePage } from "@pageinator/contracts";
import type { ApiProblem, ReleaseService, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

/** Approving a release copies its files to the archive and reads them back: it may take longer than a plain call. */
export const RELEASE_TIMEOUT_MS = 180_000;

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) return { ok: false, error: answer.problem };
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

const pub = (orgId: string, pubId: string) =>
  `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}`;
const page = (o: string, p: string, runId: string, n: number) =>
  `${pub(o, p)}/runs/${encodeURIComponent(runId)}/pages/${n}`;
const release = (o: string, p: string, id: string) => `${pub(o, p)}/releases/${encodeURIComponent(id)}`;

export function createApiReleaseService(client: ApiClient): ReleaseService {
  return {
    async get({ orgId, pubId, editionId }) {
      return read(EditionRelease, await client.get(`${pub(orgId, pubId)}/editions/${encodeURIComponent(editionId)}/release`));
    },
    async approvePage({ orgId, pubId, runId, page: n, rev, pdfSha256 }) {
      return read(ReleasePage, await client.post(`${page(orgId, pubId, runId, n)}/approve`, { rev, pdfSha256 }));
    },
    async unlockPage({ orgId, pubId, runId, page: n }) {
      return read(ReleasePage, await client.post(`${page(orgId, pubId, runId, n)}/unlock`, {}));
    },
    async create({ orgId, pubId, editionId, files, note, idempotencyKey }) {
      const path = `${pub(orgId, pubId)}/editions/${encodeURIComponent(editionId)}/releases`;
      const body = { files: files.map(({ page: n, sha256 }) => ({ page: n, sha256 })), ...(note ? { note } : {}) };
      return read(Release, await client.post(path, body, { idempotencyKey, timeoutMs: RELEASE_TIMEOUT_MS }));
    },
    async fileLink({ orgId, pubId, releaseId, name }) {
      return read(FileLink, await client.get(`${release(orgId, pubId, releaseId)}/files/${encodeURIComponent(name)}`));
    },
    async markSent({ orgId, pubId, releaseId, note }) {
      return read(Release, await client.post(`${release(orgId, pubId, releaseId)}/deliveries`, note ? { note } : {}));
    },
    async confirm({ orgId, pubId, releaseId, deliveryId, pressPerson, at, note }) {
      const path = `${release(orgId, pubId, releaseId)}/deliveries/${encodeURIComponent(deliveryId)}/confirm`;
      return read(Release, await client.post(path, { pressPerson, ...(at ? { at } : {}), ...(note ? { note } : {}) }));
    },
    async verify({ orgId, pubId, releaseId }) {
      return read(
        ArchiveCheck,
        await client.post(`${release(orgId, pubId, releaseId)}/verify`, {}, { timeoutMs: RELEASE_TIMEOUT_MS }),
      );
    },
    async setPressTest({ orgId, pubId, pageSha256, acceptedOn, note }) {
      return read(
        PressTest,
        await client.put(`${pub(orgId, pubId)}/press-test`, { pageSha256, acceptedOn, ...(note ? { note } : {}) }),
      );
    },
  };
}
