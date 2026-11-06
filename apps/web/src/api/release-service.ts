/**
 * The release over the API (docs/product/10-l2-newsroom-plan.md §1 L2.5), under /api/v1/orgs/:o/pubs/:p: every answer
 * read with the API's own schema (@pageinator/contracts release.ts), so a change of shape shows as an error, never as
 * a wrong screen. A refusal (409 approval_stale, release_refused, already_confirmed; 502 archive_failed) comes back as
 * the problem; the screen fetches the release again to show what it is now. "Download all" takes the release's ZIP as a
 * Blob, with its file name from Content-Disposition.
 */
import {
  ArchiveCheck,
  ArchiveList,
  ArchiveRelease,
  EditionRelease,
  FileLink,
  PressTest,
  PrintProfile,
  PrintProfiles,
  Release,
  ReleasePage,
} from "@pageinator/contracts";
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

/** filename="…" from Content-Disposition, kept only when it is a plain ZIP file name. */
function filenameOf(headers: Headers): string | undefined {
  const name = /filename="([^"/\\]+)"/.exec(headers.get("Content-Disposition") ?? "")?.[1];
  return name && name.endsWith(".zip") ? name : undefined;
}

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
    async downloadAll({ orgId, pubId, releaseId }) {
      const answer = await client.download(
        `${release(orgId, pubId, releaseId)}/zip`,
        {},
        { headers: { Accept: "application/zip, application/json" }, timeoutMs: RELEASE_TIMEOUT_MS },
      );
      if (!answer.ok) return { ok: false, error: answer.problem };
      const filename = filenameOf(answer.value.headers);
      return filename ? { ok: true, value: { file: answer.value.blob, filename } } : { ok: false, error: UNEXPECTED };
    },
    async markSent({ orgId, pubId, releaseId, note, idempotencyKey }) {
      const path = `${release(orgId, pubId, releaseId)}/deliveries`;
      return read(Release, await client.post(path, note ? { note } : {}, { idempotencyKey }));
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
    async archive({ orgId, pubId, year, month, kind, q }) {
      const query = new URLSearchParams();
      if (year !== undefined) query.set("year", String(year));
      if (month !== undefined) query.set("month", String(month));
      if (kind) query.set("kind", kind);
      if (q) query.set("q", q);
      const tail = query.size ? `?${query.toString()}` : "";
      return read(ArchiveList, await client.get(`${pub(orgId, pubId)}/archive${tail}`));
    },
    async archiveRelease({ orgId, pubId, releaseId }) {
      return read(
        ArchiveRelease,
        await client.get(`${pub(orgId, pubId)}/archive/releases/${encodeURIComponent(releaseId)}`),
      );
    },
    async printProfiles({ orgId, pubId }) {
      return read(PrintProfiles, await client.get(`${pub(orgId, pubId)}/print-profiles`));
    },
    async addPrintProfile({ orgId, pubId, pressName, contact, note, idempotencyKey }) {
      const body = { pressName, ...(contact ? { contact } : {}), ...(note ? { note } : {}) };
      return read(PrintProfile, await client.post(`${pub(orgId, pubId)}/print-profiles`, body, { idempotencyKey }));
    },
  };
}
