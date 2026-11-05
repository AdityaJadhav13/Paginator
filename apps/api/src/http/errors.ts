// Every refusal and failure leaves the API as the envelope of docs/product/10-l2-newsroom-plan.md §5.1, with a plain
// English message (the web shows its own text for each code). Clients never see a stack trace or an internal message:
// an unexpected error is logged with its request id, and the client gets that id as its reference.
import { STATUS_CODES } from "node:http";
import type { Socket } from "node:net";
import type { ConnectionError, FastifyBaseLogger, FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import type { ErrorCode, ErrorEnvelope, FieldProblem } from "@pageinator/contracts";
import { isStopping } from "../shutdown.ts";
import { REQUEST_ID_HEADER, requestId } from "./context.ts";

const ERRORS: Record<ErrorCode, { status: number; message: string }> = {
  invalid_request: { status: 400, message: "Some fields are not right." },
  signed_out: { status: 401, message: "You are signed out. Sign in again; what you typed is kept on this device." },
  not_allowed: { status: 403, message: "Your role cannot do this. Ask an editor or the owner." },
  two_step_required: {
    status: 403,
    message: "Your role needs two-step sign-in. Set it up in Account → Security.",
  },
  bad_origin: { status: 403, message: "This request did not come from Pageinator." },
  not_found: { status: 404, message: "There is nothing here, or you do not have access to it." },
  story_changed: {
    status: 409,
    message: "Someone changed this story after you opened it. Your text is kept; reload to see theirs.",
  },
  asset_changed: {
    status: 409,
    message: "Someone changed this picture after you opened it. Your text is kept; see theirs beside it.",
  },
  asset_in_use: { status: 409, message: "This picture is the photo of a story. Take it off the story first." },
  invalid_transition: { status: 409, message: "This story cannot be moved to that state now." },
  edition_exists: { status: 409, message: "There is already an edition for this date. Open it instead." },
  request_in_progress: { status: 409, message: "This request is still being handled. Wait a moment, then check." },
  idempotency_key_reused: { status: 422, message: "This request was already sent with different content." },
  file_too_large: { status: 413, message: "This picture is larger than 40 MB. Save it smaller and try again." },
  not_a_picture: {
    status: 422,
    message: "This file is not a picture Pageinator can read. Use a JPEG, PNG or WebP file.",
  },
  // the Desk's own words (deskserver/docx.py NOT_WORD); details say more (too large)
  docx_refused: { status: 422, message: "This is not a Word (.docx) file. Save it as .docx and try again." },
  rights_needed: {
    status: 422,
    message: "This photo needs permission to print. Tick “We have the right to print this” first.",
  },
  ai_off: {
    status: 409,
    message: "The AI part is off, so no story can be drafted. The headlines are still collected.",
  },
  bundle_refused: {
    status: 409,
    message: "Some stories cannot be sent to the Desk as they are. Change them, then send again.",
  },
  run_active: {
    status: 409,
    message: "Pages for this edition are already being made. Wait for them, or cancel that run first.",
  },
  run_finished: { status: 409, message: "This run has already finished." },
  layout_refused: { status: 409, message: "This edition cannot be laid out yet: see what it still needs." },
  no_profile: {
    status: 409,
    message: "This paper has no engine profile ready yet. Upload its dataset bundle in Settings first.",
  },
  profile_setting_up: {
    status: 409,
    message: "An engine profile is being set up now. Wait until it is ready or has failed, then choose again.",
  },
  // onboarding a new paper (L4)
  onboarding_active: {
    status: 409,
    message: "Your past editions are being read now. Wait until that has finished, or cancel it first.",
  },
  onboarding_finished: { status: 409, message: "Reading these past editions has already finished." },
  onboarding_not_ready: {
    status: 409,
    message: "Your paper's design is not ready to use: reading the past editions has not finished, or did not work.",
  },
  // the page editor (L2.4); the first is the Desk's own words (deskserver/api.py _edit_page)
  not_editable: { status: 409, message: "Pages can be changed once their layout has finished." },
  stale: {
    status: 409,
    message: "This page was changed in another window or tab. It is shown again as it is now.",
  },
  page_locked: { status: 409, message: "Someone else is editing this page. Ask to take over, or wait." },
  edit_refused: { status: 400, message: "The page could not be changed: see why." },
  run_missing: {
    status: 409,
    message: "This layout's files are not on the engine's computer. Lay the edition out again to edit its pages.",
  },
  editor_unavailable: { status: 503, message: "The page editor is not available just now. Try again in a minute." },
  // release (L2.5)
  approval_stale: {
    status: 409,
    message: "This page or release changed after you looked at it. It is shown again as it is now.",
  },
  page_approved: {
    status: 409,
    message: "This page is approved, so it is locked. Ask a chief editor to unlock it first.",
  },
  not_approved: { status: 409, message: "This page is not approved, so there is nothing to unlock." },
  release_refused: { status: 409, message: "This edition cannot be released yet: see what is not done." },
  already_confirmed: { status: 409, message: "The press's confirmation of this delivery is already recorded." },
  archive_failed: {
    status: 502,
    message: "The files could not be copied to the archive and checked. Nothing was released. Try again.",
  },
  receipt_failed: {
    status: 502,
    message:
      "The receipt could not be written to the archive, so this was not recorded. The release is unchanged. Try again.",
  },
  // the ads desk (L2.6)
  advertiser_exists: { status: 409, message: "This paper already has an advertiser of that name." },
  section_exists: { status: 409, message: "This paper already has a section of that name." },
  slot_booked: { status: 409, message: "A booking holds this ad slot. Take the booking out of the slot first." },
  request_too_large: { status: 413, message: "This request is too large." },
  not_json: { status: 415, message: "This request must be sent as JSON." },
  slow_down: { status: 429, message: "Too many tries. Wait a minute and try again." },
  contact_unavailable: { status: 503, message: "Messages cannot be sent from this website yet." },
  contact_send_failed: { status: 503, message: "The message could not be sent just now. Try again later." },
  contact_limit: { status: 429, message: "Too many messages. Try again later." },
  signup_limit: { status: 429, message: "Too many sign-ups from here. Try again later." },
  server_error: { status: 500, message: "Something went wrong on our side. Try again." },
};
const UNREADABLE = "This request could not be read.";

/** Headers every error answer carries, including one written before any hook runs. */
export const BASELINE_HEADERS = {
  "cache-control": "no-store", // no error answer is kept in a cache
  "content-security-policy": "default-src 'none';frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

// The refusals of Fastify's core that may answer 4xx, with the code each gets. Any other error, a plugin's FST_ code
// included, is a fault on our side: a logged 500. Two entries are reachable only in ways the API does not use today:
// FST_ERR_VALIDATION through a validation result that is not Zod's, and FST_ERR_NOT_FOUND through Fastify's internal
// 404 fallback (the API's own not-found handler throws an ApiError).
const FASTIFY_REFUSALS = new Map<string, ErrorCode>([
  ["FST_ERR_BAD_URL", "invalid_request"],
  ["FST_ERR_MAX_PARAM_LENGTH", "invalid_request"],
  ["FST_ERR_CTP_EMPTY_JSON_BODY", "invalid_request"],
  ["FST_ERR_CTP_INVALID_CONTENT_LENGTH", "invalid_request"],
  ["FST_ERR_CTP_INVALID_JSON_BODY", "invalid_request"],
  ["FST_ERR_CTP_BODY_TOO_LARGE", "request_too_large"],
  ["FST_ERR_CTP_INVALID_MEDIA_TYPE", "not_json"],
  ["FST_ERR_ROUTE_MISSING_CONTENT_TYPE", "invalid_request"],
  ["FST_ERR_VALIDATION", "invalid_request"],
  ["FST_ERR_NOT_FOUND", "not_found"],
]);

// When a client drops the connection mid-body, Node destroys the request with an error (ECONNRESET "aborted", kept as
// request.raw.errored) and Fastify hands that very error on, marked 400. Only that error is the client's; any other 400
// (a handler's, a library's, a hook's) is not trusted. A client that half-closes mid-body (FIN) is also answered by
// clientErrorHandler, so that case logs two info lines, each with its own id. A client that leaves earlier, during a
// hook before the body is read, gets only the clientErrorHandler line.

/** A refusal the API makes on purpose, answered with its code's status and message. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: FieldProblem[] | undefined;
  /** With story_changed: the story as it is now; with edition_exists: the edition of that date. */
  readonly current: unknown;

  constructor(code: ErrorCode, details?: FieldProblem[], current?: unknown) {
    super(ERRORS[code].message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = ERRORS[code].status;
    this.details = details;
    this.current = current;
  }
}

type Answer = {
  status: number;
  code: ErrorCode;
  message: string;
  details?: FieldProblem[] | undefined;
  current?: unknown;
  log?: "info" | "error";
};

function answer(error: FastifyError, request: FastifyRequest): Answer {
  // a handler may throw or reject with anything at all, null and undefined included
  if (typeof error !== "object" || error === null) {
    return { status: 500, code: "server_error", message: ERRORS.server_error.message, log: "error" };
  }
  if (error instanceof ApiError) {
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
      current: error.current,
    };
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const part = error.validationContext ?? "request";
    const details = error.validation.map((problem) => ({
      field: [part, ...problem.instancePath.split("/").filter((name) => name !== "")].join("."),
      message: problem.message ?? "This is not right.",
    }));
    return { status: 400, code: "invalid_request", message: ERRORS.invalid_request.message, details };
  }
  const refusal = typeof error.code === "string" ? FASTIFY_REFUSALS.get(error.code) : undefined;
  if (refusal) {
    const unreadable = refusal === "invalid_request" && error.code !== "FST_ERR_VALIDATION";
    return {
      status: ERRORS[refusal].status,
      code: refusal,
      message: unreadable ? UNREADABLE : ERRORS[refusal].message,
    };
  }
  if (error === request.raw.errored && error.statusCode === 400) {
    return { status: 400, code: "invalid_request", message: UNREADABLE, log: "info" };
  }
  return { status: 500, code: "server_error", message: ERRORS.server_error.message, log: "error" };
}

/**
 * Fastify's error handler: every error answer passes through here. A route's own preSerialization or onSend hook must
 * never throw on an error answer: if one does, Fastify's fallback handler answers instead, outside the envelope, and
 * its body carries the hook's own message.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const { status, code, message, details, current, log } = answer(error, request);
  if (log === "error") request.log.error({ err: error }, "request failed");
  if (log === "info") request.log.info({ err: error }, "the request body could not be read");
  const body: ErrorEnvelope = {
    error: {
      code,
      message: code === "server_error" ? `${message} Reference: ${request.id}` : message,
      ...(details?.length ? { details } : {}),
      ...(current !== undefined ? { current } : {}),
      requestId: request.id,
    },
  };
  return reply.code(status).headers(BASELINE_HEADERS).send(body);
}

/**
 * Fastify's `frameworkErrors`: refusals it makes before routing, so before any hook (a malformed URL, an over-long path
 * parameter). No hook has set the request id, so it is set here; errorHandler adds the envelope and the baseline
 * headers. The request limit does not count these refusals.
 */
export function frameworkErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  reply.header(REQUEST_ID_HEADER, request.id);
  // Fastify sends these answers without its onSend hooks, so closeWhenStopping (shutdown.ts) never sees them
  if (isStopping(request.server.server)) reply.header("connection", "close");
  errorHandler(error, request, reply);
}

/**
 * Fastify's `clientErrorHandler`: bytes Node could not read as HTTP (400), a request that took too long to arrive (408)
 * or headers that are too large (431). There is no request yet, so the id is new; the connection is then closed.
 */
export function clientErrorHandler(this: { log: FastifyBaseLogger }, error: ConnectionError, socket: Socket): void {
  if (error.code === "ECONNRESET" || socket.destroyed) return; // the client has gone: nobody to answer
  const [status, code, message]: [number, ErrorCode, string] =
    error.code === "ERR_HTTP_REQUEST_TIMEOUT"
      ? [408, "invalid_request", "This request took too long to arrive. Try again."]
      : error.code === "HPE_HEADER_OVERFLOW"
        ? [431, "request_too_large", ERRORS.request_too_large.message]
        : [400, "invalid_request", UNREADABLE];
  const id = requestId();
  // the code only: Node's parser error carries the raw bytes (rawPacket), which may hold cookies or a whole body
  this.log.info({ reqId: id, code: error.code }, "refused a request that could not be read as HTTP");
  const envelope: ErrorEnvelope = { error: { code, message, requestId: id } };
  const body = JSON.stringify(envelope);
  const headers: Record<string, string | number> = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    [REQUEST_ID_HEADER]: id,
    ...BASELINE_HEADERS,
    connection: "close",
  };
  // As Node does: no answer of our own inside a pipelined response whose headers have already gone out.
  const inFlight = (socket as Socket & { _httpMessage?: { headersSent?: boolean } })._httpMessage;
  if (socket.writable && inFlight?.headersSent !== true) {
    const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
    socket.write(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n${lines.join("\r\n")}\r\n\r\n${body}`);
  }
  socket.destroy(error);
}
