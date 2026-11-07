/**
 * Why a request to the API did not succeed: the vocabulary of the real services (session, account). Screens turn a
 * problem into catalogue text; the services never carry display text of their own.
 */

/** One problem with one field, from the API's error envelope (`details`). */
export interface FieldProblemDto {
  readonly field: string;
  readonly message: string;
  /** a stable reason the catalogue words (`detail.<reason>`), with the values its sentence names */
  readonly reason?: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

export type ApiProblem =
  /** The browser is offline: nothing was sent. */
  | { readonly kind: "offline" }
  /** The browser is online but no answer came (the server or the network is down). */
  | { readonly kind: "network" }
  /** The API answered with a refusal or an error. */
  | {
      readonly kind: "answer";
      readonly status: number;
      /**
       * The API's error code (`signed_out`, `slow_down`, …), Better Auth's (`INVALID_EMAIL_OR_PASSWORD`, …), or, for an
       * answer without one, one derived from the status (`slow_down`, `server_error`, `not_found`, `http_<status>`).
       * Two codes come from the web itself: `unexpected_answer` (a success the web cannot read) and `cookie_refused`
       * (signed in, but the browser did not keep the session cookie).
       */
      readonly code: string;
      /** The API's own English message, the fallback for a code the catalogue does not know ("" when none). */
      readonly message: string;
      /** The API's request id, for "Reference: …". */
      readonly requestId?: string;
      readonly details?: readonly FieldProblemDto[];
      /** With 409 story_changed: the story as it is now, unread (the story service checks it with its schema). */
      readonly current?: unknown;
      /** From Retry-After (or Better Auth's X-Retry-After), in seconds. */
      readonly retryAfterSeconds?: number;
    };
