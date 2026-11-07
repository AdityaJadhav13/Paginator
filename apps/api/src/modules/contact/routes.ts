// The public website's contact form (docs/product/03-website-and-accounts.md §4.2):
//   - GET /api/v1/contact answers {connected}: true only when PGN_CONTACT_TO is set, and nothing more. The web shows
//     the form only then; otherwise it says the form is not connected.
//   - POST /api/v1/contact sends a message.
//
// Open to anyone, with no sign-in; a browser can still only POST from the app's own pages, because the Origin and
// header guard (src/http/origin-guard.ts) refuses every change without an allowed Origin and `X-Pageinator: 1`.
//
// The message is checked (@pageinator/contracts ContactRequest; a body of at most 16 KiB), then emailed, as plain
// text, to the one address the owner set at deploy (PGN_CONTACT_TO), and kept nowhere by the API: it lives on in that
// mailbox. Without that address the form answers 503 contact_unavailable; when the mail server does not take the
// message, 503 contact_send_failed. Nothing a sender types reaches an email header: the subject is fixed text, the
// recipient is the setting, and Reply-To is the sender's email address only when it is one plain address (the mailer
// checks it again).
//
// Flood and spam protection, in order:
//   - the API's per-address budget for every signed-out request (60 a minute by default), before anything else;
//   - per address, CONTACT_PER_HOUR messages an hour and CONTACT_PER_DAY a day, and CONTACT_PER_DAY_ALL a day from
//     every address together: each is read first (429 contact_limit when used up) and counted only once the message
//     was sent or dropped, so a message refused for a field, or one the mail server did not take, costs nothing;
//   - a trap field that people never see (`website`) and a minimum fill time (CONTACT_MIN_FILL_MS): either one and the
//     message is dropped, after a pause like a real send's, with the very answer a sent one gets, so a program learns
//     nothing. A dropped message counts against its address, not against the day's total.
// The contact lines of the log say only that a message was sent, dropped or refused, with its intent and language:
// never a name, an email address, a number or the message. Like every request, the request's own log line carries
// the client's address (src/http/log.ts). No audit event is written: the audit log belongs to an organisation, and a
// visitor has none.
import {
  CONTACT_MIN_FILL_MS,
  ContactAccepted,
  type ContactMessage,
  ContactRequest,
  ContactStatus,
} from "@pageinator/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { ApiError } from "../../http/errors.ts";
import { type Mailer, PLAIN_ADDRESS } from "../notifications/mailer.ts";

export const CONTACT_PER_HOUR = 5;
export const CONTACT_PER_DAY = 20;
export const CONTACT_PER_DAY_ALL = 200;
/** The largest body the route reads: the longest message, every field, and room for JSON escapes. */
export const CONTACT_BODY_LIMIT = 16_384;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type ContactOptions = {
  mailer: Mailer | undefined;
  /** PGN_CONTACT_TO: unset, the form is not connected. */
  to: string | undefined;
  /** For tests: smaller limits. */
  limits?: { perHour: number; perDay: number; perDayAll: number };
  /** How long a dropped message's answer waits, in ms (by default 300–900, like a real send); tests make it 0. */
  dropPause?: () => number;
};

const INTENT_NAMES = {
  demo: "Book a demo",
  pilot: "A pilot",
  press: "A press (printing) partner",
  other: "Something else",
} as const;
const LANGUAGE_NAMES = { en: "English", mr: "Marathi" } as const;

/** The email: fixed subject, and the fields as plain text, each on its own line, the message last. */
export function contactEmail(message: ContactMessage, to: string) {
  const field = (label: string, value: string) => `${label}: ${value === "" ? "(not given)" : value}`;
  const text = [
    "A message from the contact form on the Pageinator website.",
    "",
    field("Wants", INTENT_NAMES[message.intent]),
    field("Wrote in", LANGUAGE_NAMES[message.language]),
    field("Name", message.name),
    field("Newspaper or organisation", message.newspaper),
    field("City", message.city),
    field("Phone or WhatsApp", message.phone),
    field("Email", message.email),
    "",
    "Message:",
    message.message === "" ? "(no message)" : message.message,
    "",
    "--",
    "Pageinator keeps no copy of this message. Reply to this email to answer the sender when they gave an email address.",
    "",
  ].join("\n");
  const replyTo = message.email !== "" && PLAIN_ADDRESS.test(message.email) ? message.email : undefined;
  return {
    kind: "contact" as const,
    to,
    subject: `Pageinator website: ${INTENT_NAMES[message.intent]}`,
    text,
    ...(replyTo === undefined ? {} : { replyTo }),
  };
}

type Check = ReturnType<FastifyInstance["createRateLimit"]>;

/** Reads a budget without counting: when it is used up, 429 contact_limit with Retry-After. */
async function notUsedUp(check: Check, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const limit = await check(request, { increment: false });
  if (limit.isAllowed || limit.remaining > 0) return; // allowed: not counted at all (a health check)
  reply.header("retry-after", Math.max(1, limit.ttlInSeconds));
  throw new ApiError("contact_limit");
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const contactRoutes: FastifyPluginAsyncZod<ContactOptions> = async (app, options) => {
  const limits = options.limits ?? {
    perHour: CONTACT_PER_HOUR,
    perDay: CONTACT_PER_DAY,
    perDayAll: CONTACT_PER_DAY_ALL,
  };
  const dropPause = options.dropPause ?? (() => 300 + Math.floor(Math.random() * 600));
  // each its own store; keyed by the client's address (request.ip, which PGN_TRUST_PROXY governs)
  const hourly = app.createRateLimit({ max: limits.perHour, timeWindow: HOUR_MS });
  const daily = app.createRateLimit({ max: limits.perDay, timeWindow: DAY_MS });
  const everyone = app.createRateLimit({ max: limits.perDayAll, timeWindow: DAY_MS, keyGenerator: () => "contact" });
  const { mailer, to } = options;
  const connected = to !== undefined && mailer !== undefined;

  app.get(
    "/api/v1/contact",
    { config: { access: "public" }, schema: { response: { 200: ContactStatus } } },
    async () => ({ connected }),
  );

  app.post(
    "/api/v1/contact",
    {
      config: { access: "public" },
      bodyLimit: CONTACT_BODY_LIMIT,
      schema: { body: ContactRequest, response: { 200: ContactAccepted } },
      // not connected: the same answer whatever was sent
      preValidation: async () => {
        if (!connected) throw new ApiError("contact_unavailable");
      },
    },
    async (request, reply) => {
      if (to === undefined || mailer === undefined) throw new ApiError("contact_unavailable");
      const message = request.body;
      const facts = { intent: message.intent, language: message.language };
      await notUsedUp(hourly, request, reply);
      await notUsedUp(daily, request, reply);
      await notUsedUp(everyone, request, reply);
      if (message.website !== "" || message.filledInMs < CONTACT_MIN_FILL_MS) {
        await pause(dropPause());
        await hourly(request);
        await daily(request);
        request.log.info({ ...facts, reason: message.website !== "" ? "trap" : "too-fast" }, "contact: dropped");
        return { received: true as const };
      }
      try {
        await mailer.deliver(contactEmail(message, to));
      } catch {
        // the mailer logged the server's code; nothing is counted, and the client hears to try again later
        throw new ApiError("contact_send_failed");
      }
      await hourly(request);
      await daily(request);
      await everyone(request);
      request.log.info(facts, "contact: sent");
      return { received: true as const };
    },
  );
};
