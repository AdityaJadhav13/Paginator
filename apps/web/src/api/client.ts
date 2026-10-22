/**
 * The web app's one way to reach the API (docs/product/10-l2-newsroom-plan.md §4.5, §5.1):
 *   - same origin only: paths start with /api/, the browser sends its cookies (credentials "same-origin"), no CORS;
 *   - `X-Pageinator: 1` on every request, so the API's Origin and header guard lets changes through (ADR-025), and
 *     Better Auth's routes under /api/auth stay behind that guard too;
 *   - JSON bodies only;
 *   - an `Idempotency-Key` on a change when the caller gives one (creates and transitions: the same key on every
 *     retry of one action), never on a GET;
 *   - nothing from it kept in the browser's HTTP cache (`cache: "no-store"`): story text must not stay behind on a
 *     shared computer;
 *   - every failure as an `ApiProblem`: the API's error envelope, Better Auth's `{code, message}`, or none at all;
 *   - a 401 `signed_out` also tells the app (`onSignedOut`), which sends the person to sign in again, keeping their
 *     place.
 */
import type { ApiProblem, FieldProblemDto } from "../services/index.ts";

export const API_HEADER = "X-Pageinator";
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REQUEST_ID_HEADER = "X-Request-Id";

export type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly value: T }
  | { readonly ok: false; readonly problem: ApiProblem };

export interface RequestOptions {
  /** For a create or a transition: one key per action, reused on its retries (plan §5.1). Ignored on a GET. */
  readonly idempotencyKey?: string;
  /** Extra headers for this request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Let the request outlive the page (a save as the page is left); browsers cap such a body at 64 KiB. */
  readonly keepalive?: boolean;
}

export interface ApiClient {
  get<T = unknown>(path: string, options?: RequestOptions): Promise<ApiResult<T>>;
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>;
  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>;
  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<ApiResult<T>>;
  /** A new Idempotency-Key (a random UUID). */
  newIdempotencyKey(): string;
}

export interface ApiClientOptions {
  /** The fetch to use (tests pass their own). */
  readonly fetch?: typeof fetch;
  /** Called on every 401 `signed_out` answer. */
  readonly onSignedOut?: () => void;
  readonly isOnline?: () => boolean;
  readonly newIdempotencyKey?: () => string;
  /** A request without an answer by then is abandoned, as if the network were down. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** A random UUID (v4). crypto.randomUUID needs a secure context; getRandomValues works everywhere. */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function codeForStatus(status: number): string {
  if (status === 429) return "slow_down";
  if (status >= 500) return "server_error";
  if (status === 404) return "not_found";
  return `http_${status}`;
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get("Retry-After") ?? headers.get("X-Retry-After");
  if (raw === null || !/^\d{1,6}$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

function fieldProblems(value: unknown): FieldProblemDto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const problems = value.flatMap((item) =>
    isObject(item) && typeof item["field"] === "string" && typeof item["message"] === "string"
      ? [{ field: item["field"], message: item["message"] }]
      : [],
  );
  return problems.length > 0 ? problems : undefined;
}

/** A refusal or an error answer, in whichever of the API's two formats it came. */
export function problemFromAnswer(status: number, body: unknown, headers: Headers): ApiProblem {
  const headerRequestId = headers.get(REQUEST_ID_HEADER) ?? undefined;
  const retryAfter = retryAfterSeconds(headers);
  const extras = {
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
  };
  // the API's own envelope: {"error": {code, message, details?, requestId}}
  const envelope = isObject(body) ? body["error"] : undefined;
  if (isObject(envelope) && typeof envelope["code"] === "string" && envelope["code"] !== "") {
    const requestId = typeof envelope["requestId"] === "string" ? envelope["requestId"] : headerRequestId;
    const details = fieldProblems(envelope["details"]);
    return {
      kind: "answer",
      status,
      code: envelope["code"],
      message: typeof envelope["message"] === "string" ? envelope["message"] : "",
      ...(requestId === undefined ? {} : { requestId }),
      ...(details === undefined ? {} : { details }),
      // story_changed carries the story as it is now (plan §5.1)
      ...(envelope["current"] === undefined ? {} : { current: envelope["current"] }),
      ...extras,
    };
  }
  // Better Auth's own answers under /api/auth: {code?, message?}
  const code = isObject(body) && typeof body["code"] === "string" && body["code"] !== "" ? body["code"] : undefined;
  const message = isObject(body) && typeof body["message"] === "string" ? body["message"] : "";
  return {
    kind: "answer",
    status,
    code: code ?? codeForStatus(status),
    message,
    ...(headerRequestId === undefined ? {} : { requestId: headerRequestId }),
    ...extras,
  };
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const online = options.isOnline ?? browserOnline;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const newKey = options.newIdempotencyKey ?? randomUuid;

  async function request<T>(
    method: string,
    path: string,
    body: unknown,
    requestOptions: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    if (!path.startsWith("/api/") || path.startsWith("//")) {
      throw new Error(`The API client only calls this app's own /api/ paths, not "${path}".`);
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...requestOptions.headers,
      [API_HEADER]: "1",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && requestOptions.idempotencyKey !== undefined) {
      headers[IDEMPOTENCY_HEADER] = requestOptions.idempotencyKey;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(path, {
        method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        ...(requestOptions.keepalive ? { keepalive: true } : {}),
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      text = await response.text();
    } catch {
      return { ok: false, problem: online() ? { kind: "network" } : { kind: "offline" } };
    } finally {
      clearTimeout(timer);
    }
    const json = text === "" ? undefined : parseJson(text);
    if (response.ok) {
      const isJson = (response.headers.get("Content-Type") ?? "").includes("json");
      if (text !== "" && (!isJson || json === undefined)) {
        // a page instead of an answer (a missing proxy serving index.html, a captive portal): not the API
        return { ok: false, problem: { kind: "answer", status: response.status, code: "unexpected_answer", message: "" } };
      }
      return { ok: true, status: response.status, value: (json ?? null) as T };
    }
    const problem = problemFromAnswer(response.status, json, response.headers);
    if (response.status === 401 && problem.kind === "answer" && problem.code === "signed_out") options.onSignedOut?.();
    return { ok: false, problem };
  }

  return {
    get: <T,>(path: string, requestOptions?: RequestOptions) => request<T>("GET", path, undefined, requestOptions),
    post: <T,>(path: string, body?: unknown, requestOptions?: RequestOptions) =>
      request<T>("POST", path, body, requestOptions),
    put: <T,>(path: string, body?: unknown, requestOptions?: RequestOptions) =>
      request<T>("PUT", path, body, requestOptions),
    patch: <T,>(path: string, body?: unknown, requestOptions?: RequestOptions) =>
      request<T>("PATCH", path, body, requestOptions),
    delete: <T,>(path: string, requestOptions?: RequestOptions) =>
      request<T>("DELETE", path, undefined, requestOptions),
    newIdempotencyKey: newKey,
  };
}
