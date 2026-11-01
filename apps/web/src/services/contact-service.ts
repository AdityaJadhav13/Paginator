import type { ContactRequest } from "@pageinator/contracts";

/** The message, as POST /api/v1/contact takes it (@pageinator/contracts ContactRequest). */
export type ContactRequestDto = ContactRequest;

/**
 * What became of a message sent with the website's contact form (POST /api/v1/contact):
 *   - sent: the API answered that it was received;
 *   - invalid: the API refused some fields (their names, such as "email");
 *   - unavailable: the form is not connected (503 contact_unavailable);
 *   - sendFailed: the mail server did not take it (503 contact_send_failed), or another answer of the server's;
 *   - busy: too many messages (429 contact_limit or slow_down);
 *   - refused: the request was refused as not sent from the app's own pages (403 bad_origin);
 *   - failed: no answer at all (offline, or the network failed).
 */
export type ContactOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "invalid"; readonly fields: readonly string[] }
  | { readonly kind: "unavailable" }
  | { readonly kind: "sendFailed" }
  | { readonly kind: "busy" }
  | { readonly kind: "refused" }
  | { readonly kind: "failed" };

/** Whether the form sends (GET /api/v1/contact): connected, not connected, or no answer. */
export type ContactConnection = "connected" | "notConnected" | "unknown";

export interface ContactService {
  connection(): Promise<ContactConnection>;
  send(request: ContactRequestDto): Promise<ContactOutcome>;
}
