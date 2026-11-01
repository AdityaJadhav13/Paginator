// The public website's contact form (docs/product/03-website-and-accounts.md §4.2, /contact): POST /api/v1/contact,
// open to anyone, no sign-in. The API emails one message to the address the owner sets at deploy (PGN_CONTACT_TO)
// and keeps nothing. The web app checks the same limits as it goes, so a person sees a problem before sending.
//
// Every single-line field refuses line breaks and control characters, so nothing a sender types can reach an email
// header; the message may hold line breaks and tabs, nothing else below U+0020.
import { z } from "zod";

/** What the sender wants: a demonstration, a pilot, a press (printing) partnership, or something else. */
export const CONTACT_INTENTS = ["demo", "pilot", "press", "other"] as const;
export const ContactIntent = z.enum(CONTACT_INTENTS);
export type ContactIntent = z.infer<typeof ContactIntent>;

/** The longest each field may be, in characters (after trimming). */
export const CONTACT_LIMITS = {
  name: 100,
  newspaper: 120,
  city: 80,
  phone: 30,
  email: 254,
  message: 4000,
} as const;

/** Less than this since the form was opened, and a person did not fill it in: the message is dropped. */
export const CONTACT_MIN_FILL_MS = 3000;

/** One plain email address, as the API's mailer accepts a recipient (src/modules/notifications/mailer.ts). */
export const CONTACT_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/;
/** A phone or WhatsApp number as people write it: digits, spaces, and + ( ) - . */
export const CONTACT_PHONE = /^\+?[0-9 ()-]{6,30}$/;

/**
 * Whether `text` holds a character that does not belong in what a person types: a C0 or C1 control character, DEL, a
 * line or paragraph separator (U+2028, U+2029), a bidirectional mark, override or isolate (U+061C, U+200E, U+200F,
 * U+202A–U+202E, U+2066–U+2069), or a byte-order mark (U+FEFF). With `breaks`, a line feed, a tab and a carriage
 * return just before a line feed are allowed (a message's own lines).
 */
export function hasControlCharacters(text: string, breaks = false): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (breaks && (code === 0x0a || code === 0x09 || (code === 0x0d && text.charCodeAt(i + 1) === 0x0a))) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x061c || code === 0x200e || code === 0x200f || code === 0x2028 || code === 0x2029) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff) return true;
  }
  return false;
}

function line(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((text) => !hasControlCharacters(text), { error: "must be one line of text" });
}

export const ContactRequest = z
  .strictObject({
    name: line(CONTACT_LIMITS.name).min(1),
    newspaper: line(CONTACT_LIMITS.newspaper).default(""),
    city: line(CONTACT_LIMITS.city).default(""),
    phone: z
      .string()
      .trim()
      .max(CONTACT_LIMITS.phone)
      .refine((text) => text === "" || CONTACT_PHONE.test(text), { error: "must be a phone number" })
      .default(""),
    email: z
      .string()
      .trim()
      .max(CONTACT_LIMITS.email)
      .refine((text) => text === "" || CONTACT_EMAIL.test(text), { error: "must be one email address" })
      .default(""),
    message: z
      .string()
      .trim()
      .max(CONTACT_LIMITS.message)
      .refine((text) => !hasControlCharacters(text, true), { error: "must be text" })
      .default(""),
    intent: ContactIntent,
    language: z.enum(["en", "mr"]),
    /** The trap field: hidden from people, so it stays empty unless a program fills in every field. */
    website: z.string().max(200).default(""),
    /** Milliseconds from opening the form to sending it, as the browser counted them. */
    filledInMs: z.number().int().min(0).max(86_400_000),
  })
  .refine((request) => request.phone !== "" || request.email !== "", {
    error: "give a phone number or an email address",
    path: ["email"],
  });
export type ContactRequest = z.input<typeof ContactRequest>;
export type ContactMessage = z.output<typeof ContactRequest>;

/** The answer to a message accepted (or dropped as automated: the answer is the same). */
export const ContactAccepted = z.strictObject({ received: z.literal(true) });
export type ContactAccepted = z.infer<typeof ContactAccepted>;

/** GET /api/v1/contact: whether the form sends (PGN_CONTACT_TO is set). Nothing else. */
export const ContactStatus = z.strictObject({ connected: z.boolean() });
export type ContactStatus = z.infer<typeof ContactStatus>;
