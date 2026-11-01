// Email (docs/product/10-l2-newsroom-plan.md §4.1): the API's one way to send it, through nodemailer; Mailpit in
// development. Every recipient passes a strict check first: one plain address, with no name, comment, quote, angle
// bracket or list, so nodemailer's address parser never meets a crafted string (a second guard: the parser's three
// advisories are fixed from 10.1.4, and the catalog pins 10.1.7). Mail goes in the
// background: a request that sends one answers as fast as one that does not, and a failure is reported without the
// message, whose links carry tokens.
import { hasControlCharacters } from "@pageinator/contracts";
import { createTransport } from "nodemailer";

/** One plain address. The local part and the domain are what people's addresses use; nothing an address parser
 * could read as a second recipient, a name or a comment. */
export const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/;

export type MailSettings = {
  host: string;
  port: number;
  /** "starttls" requires it; "implicit" is TLS from the first byte; "none" only for a server on this machine */
  tls: "starttls" | "implicit" | "none";
  from: string;
  auth?: { user: string; pass: string };
};

/** What a message is, for logs: never its text, which carries links with tokens (or, for "contact", what a person
 * wrote on the website). */
export type MailKind =
  | "verify-email"
  | "reset-password"
  | "new-sign-in"
  | "invitation"
  | "story-sent-back"
  | "invitation-accepted"
  | "contact";
/** A message. Without `html` it is plain text only. `replyTo` must be one plain address, like the recipient. */
export type Mail = { kind: MailKind; to: string; subject: string; text: string; html?: string; replyTo?: string };

/** The message as the transport gets it. */
export type OutgoingMail = { from: string; to: string; subject: string; text: string; html?: string; replyTo?: string };

/** The part of a nodemailer transport the mailer uses (tests give their own). */
export type Transport = {
  sendMail(message: OutgoingMail): Promise<unknown>;
  close(): void;
};

export type Mailer = {
  /** Starts sending; returns at once. A recipient that is not one plain address is refused here (it throws). */
  send(mail: Mail): void;
  /** Sends and settles once the mail server took the message; rejects if it did not. The same checks as `send`. */
  deliver(mail: Mail): Promise<void>;
  /** Settles once every message started so far is sent or has failed. */
  idle(): Promise<void>;
  close(): Promise<void>;
};

/** The recipient is not one plain address; nothing was sent. */
export class RecipientError extends Error {}

export function smtpTransport(settings: MailSettings): Transport {
  return createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.tls === "implicit",
    requireTLS: settings.tls === "starttls",
    ignoreTLS: settings.tls === "none",
    ...(settings.auth ? { auth: settings.auth } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true, // a message cannot pull in a file or a URL
    disableUrlAccess: true,
  });
}

export function openMailer(
  settings: Pick<MailSettings, "from">,
  transport: Transport,
  onFailure: (kind: MailKind, error: Error) => void,
): Mailer {
  const pending = new Set<Promise<void>>();
  const outgoing = (mail: Mail): OutgoingMail => {
    if (mail.to.length > 254 || !PLAIN_ADDRESS.test(mail.to)) {
      throw new RecipientError(`A ${mail.kind} email was not sent: its recipient is not one plain address.`);
    }
    if (mail.replyTo !== undefined && (mail.replyTo.length > 254 || !PLAIN_ADDRESS.test(mail.replyTo))) {
      throw new RecipientError(`A ${mail.kind} email was not sent: its reply-to is not one plain address.`);
    }
    // a subject is one line: a line break there would start a header of its own
    if (hasControlCharacters(mail.subject)) {
      throw new RecipientError(`A ${mail.kind} email was not sent: its subject is not one line.`);
    }
    const { to, subject, text, html, replyTo } = mail;
    return {
      from: settings.from,
      to,
      subject,
      text,
      ...(html === undefined ? {} : { html }),
      ...(replyTo === undefined ? {} : { replyTo }),
    };
  };
  const track = (sending: Promise<void>) => {
    pending.add(sending);
    void sending.finally(() => pending.delete(sending));
  };
  return {
    send(mail) {
      const message = outgoing(mail);
      track(
        transport.sendMail(message).then(
          () => undefined,
          (error: unknown) => onFailure(mail.kind, error instanceof Error ? error : new Error(String(error))),
        ),
      );
    },
    async deliver(mail) {
      const message = outgoing(mail);
      const sending = transport.sendMail(message).then(
        () => undefined,
        (error: unknown) => {
          const failure = error instanceof Error ? error : new Error(String(error));
          onFailure(mail.kind, failure);
          throw failure;
        },
      );
      track(sending.catch(() => undefined));
      await sending;
    },
    async idle() {
      await Promise.all(pending);
    },
    async close() {
      await Promise.all(pending);
      transport.close();
    },
  };
}
