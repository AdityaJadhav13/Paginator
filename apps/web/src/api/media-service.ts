/**
 * Photo uploads over the API and straight to the object store (docs/product/10-l2-newsroom-plan.md §5.2, §6.2):
 *   - presign: POST …/uploads, with an Idempotency-Key, read with the API's own schema;
 *   - send: the presigned POST, as a form with the policy's fields exactly as the API named them, then the file (the
 *     form's last field, as the store requires), by XMLHttpRequest for its upload progress, cancellable;
 *   - complete: POST …/uploads/:u/complete;
 *   - the original (GET …/assets/:a/file): a 302 to a 5-minute link of the store, followed at once and never cached
 *     (`cache: "no-store"`): the screen holds the picture in memory only. Following it from the page needs the store
 *     to allow this origin (CORS), as the presigned POST does.
 *   - the library (L2.2): GET …/media (its filters as the query), GET, PATCH and DELETE …/assets/:a, each answer read
 *     with the API's own schema; a 409 asset_changed keeps `current` only as a picture the web can read.
 * The store answers a refused policy with an XML error: AccessDenied (403: an expired policy, or a condition that
 * failed) is `upload_denied`, a size outside the policy's exact one (EntityTooLarge/Small: the file changed while it
 * was sent) `upload_size_mismatch`, anything else `upload_refused`.
 */
import { CompletedUpload, MediaItem, MediaList, PresignedUpload } from "@pageinator/contracts";
import type { ApiProblem, MediaService, ServiceResult } from "../services/index.ts";
import type { ApiClient, ApiResult } from "./client.ts";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

/** An answer read with its schema; asset_changed's `current` kept only when it is a picture. */
function read<T>(schema: Schema<T>, answer: ApiResult<unknown>): ServiceResult<T, ApiProblem> {
  if (!answer.ok) {
    const problem = answer.problem;
    if (problem.kind !== "answer" || problem.current === undefined) return { ok: false, error: problem };
    const { current, ...rest } = problem;
    const item = MediaItem.safeParse(current);
    return { ok: false, error: item.success ? { ...rest, current: item.data } : rest };
  }
  const parsed = schema.safeParse(answer.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
}

const pub = (orgId: string, pubId: string) => `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}`;

function storeProblem(status: number, body: string): ApiProblem {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "";
  if (code === "EntityTooLarge" || code === "EntityTooSmall") return { kind: "answer", status, code: "upload_size_mismatch", message: "" };
  if (status === 403 || code === "AccessDenied" || code === "ExpiredToken") {
    return { kind: "answer", status, code: "upload_denied", message: code };
  }
  if (status >= 500) return { kind: "answer", status, code: "server_error", message: "" };
  return { kind: "answer", status, code: "upload_refused", message: code };
}

export function createApiMediaService(
  client: ApiClient,
  options: {
    readonly isOnline?: () => boolean;
    readonly xhr?: () => XMLHttpRequest;
    readonly fetch?: typeof fetch;
    readonly onSignedOut?: () => void;
  } = {},
): MediaService {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const online = options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const makeXhr = options.xhr ?? (() => new XMLHttpRequest());
  return {
    async presign({ orgId, pubId, filename, contentType, bytes, idempotencyKey, purpose = "story_photo" }) {
      const answer = await client.post(
        `${pub(orgId, pubId)}/uploads`,
        { purpose, filename, contentType, bytes },
        { idempotencyKey },
      );
      if (!answer.ok) return { ok: false, error: answer.problem };
      const parsed = PresignedUpload.safeParse(answer.value);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: UNEXPECTED };
    },

    send({ upload, file, onProgress, signal }) {
      return new Promise<ServiceResult<void, ApiProblem>>((resolve) => {
        if (signal?.aborted) {
          resolve({ ok: false, error: { kind: "answer", status: 0, code: "upload_cancelled", message: "" } });
          return;
        }
        const form = new FormData();
        for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
        form.append("file", file); // the file goes last: the store ignores the fields after it
        const xhr = makeXhr();
        xhr.open("POST", upload.url);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress?.(1);
            resolve({ ok: true, value: undefined });
          } else resolve({ ok: false, error: storeProblem(xhr.status, String(xhr.responseText ?? "")) });
        };
        xhr.onerror = () => resolve({ ok: false, error: online() ? { kind: "network" } : { kind: "offline" } });
        xhr.ontimeout = () => resolve({ ok: false, error: { kind: "network" } });
        xhr.onabort = () => resolve({ ok: false, error: { kind: "answer", status: 0, code: "upload_cancelled", message: "" } });
        signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(form);
      });
    },

    async complete({ orgId, pubId, uploadId }) {
      const answer = await client.post(`${pub(orgId, pubId)}/uploads/${encodeURIComponent(uploadId)}/complete`, {});
      if (!answer.ok) return { ok: false, error: answer.problem };
      const parsed = CompletedUpload.safeParse(answer.value);
      return parsed.success ? { ok: true, value: parsed.data.asset } : { ok: false, error: UNEXPECTED };
    },

    fileUrl({ orgId, pubId, assetId }) {
      return `${pub(orgId, pubId)}/assets/${encodeURIComponent(assetId)}/file`;
    },

    async loadOriginal({ orgId, pubId, assetId, signal }) {
      let response: Response;
      try {
        response = await fetchImpl(`${pub(orgId, pubId)}/assets/${encodeURIComponent(assetId)}/file`, {
          credentials: "same-origin",
          cache: "no-store",
          ...(signal ? { signal } : {}),
        });
      } catch {
        if (signal?.aborted) return { ok: false, error: { kind: "answer", status: 0, code: "upload_cancelled", message: "" } };
        return { ok: false, error: online() ? { kind: "network" } : { kind: "offline" } };
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let code = response.status === 404 ? "not_found" : response.status >= 500 ? "server_error" : `http_${response.status}`;
        try {
          const envelope = (JSON.parse(text) as { error?: { code?: unknown } }).error;
          if (typeof envelope?.code === "string") code = envelope.code;
        } catch {
          // the store's XML, or nothing
        }
        if (response.status === 401 && code === "signed_out") options.onSignedOut?.();
        return { ok: false, error: { kind: "answer", status: response.status, code, message: "" } };
      }
      try {
        return { ok: true, value: await response.blob() };
      } catch {
        // stopped, or cut off, while the picture was arriving
        if (signal?.aborted) return { ok: false, error: { kind: "answer", status: 0, code: "upload_cancelled", message: "" } };
        return { ok: false, error: online() ? { kind: "network" } : { kind: "offline" } };
      }
    },

    async list({ orgId, pubId, query }) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") search.set(key, String(value));
      }
      const text = search.toString();
      return read(MediaList, await client.get(`${pub(orgId, pubId)}/media${text ? `?${text}` : ""}`));
    },

    async get({ orgId, pubId, assetId }) {
      return read(MediaItem, await client.get(`${pub(orgId, pubId)}/assets/${encodeURIComponent(assetId)}`));
    },

    async update({ orgId, pubId, assetId, patch }) {
      return read(MediaItem, await client.patch(`${pub(orgId, pubId)}/assets/${encodeURIComponent(assetId)}`, patch));
    },

    async remove({ orgId, pubId, assetId, baseRevision }) {
      const answer = await client.delete(`${pub(orgId, pubId)}/assets/${encodeURIComponent(assetId)}?baseRevision=${baseRevision}`);
      return answer.ok ? { ok: true, value: undefined } : { ok: false, error: answer.problem };
    },
  };
}
