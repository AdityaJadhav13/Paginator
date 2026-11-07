// A new paper signs up (docs/product/09-launch-plan.md §L4, "Onboard a new paper"), open to anyone, no sign-in:
//   - POST /api/v1/signup/paper: the paper's name, its owner's name and email, and its language. The API keeps an
//     application and emails the owner a link to confirm the address. The answer is the same whatever the email.
//   - POST /api/v1/signup/paper/confirm: the link's token. The application then waits for a person at Pageinator to
//     approve it (apps/api/scripts/review-paper.ts), which makes the organisation, its Owner and its first publication.
//   - GET /api/v1/orgs/:o/pubs/:p/paper: the publication's name and languages, for the Owner's first screen
//     (/onboarding).
import { z } from "zod";
import { CONTACT_EMAIL, hasControlCharacters } from "./contact.ts";

/** The longest each field may be, in characters (after trimming); an owner's name as a directory keeps it. */
export const PAPER_SIGNUP_LIMITS = { paperName: 120, ownerName: 200, email: 254 } as const;

function line(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !hasControlCharacters(text), { error: "must be one line of text" });
}

export const PaperSignupRequest = z.strictObject({
  paperName: line(PAPER_SIGNUP_LIMITS.paperName),
  ownerName: line(PAPER_SIGNUP_LIMITS.ownerName),
  email: z
    .string()
    .trim()
    .max(PAPER_SIGNUP_LIMITS.email)
    .refine((text) => CONTACT_EMAIL.test(text), { error: "must be one email address" }),
  /** The paper's language, which is also the language of the emails. */
  language: z.enum(["en", "mr"]),
  /** The trap field: hidden from people, so it stays empty unless a program fills in every field. */
  website: z.string().max(200).default(""),
  /** Milliseconds from opening the form to sending it, as the browser counted them. */
  filledInMs: z.number().int().min(0).max(86_400_000),
});
export type PaperSignupRequest = z.input<typeof PaperSignupRequest>;

/** The answer to an application, kept or dropped: always the same. */
export const PaperSignupAccepted = z.strictObject({ received: z.literal(true) });

/** The confirmation link's token: 32 random bytes, base64url. */
export const PaperSignupConfirm = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
/** Confirmed: the application waits for approval. */
export const PaperSignupConfirmed = z.strictObject({ state: z.literal("waiting") });

/** A publication's name and languages, as the Owner's first screen shows them. */
export const PaperDetails = z.strictObject({
  name: z.string(),
  languages: z.array(z.string()),
  primaryLanguage: z.string(),
});
export type PaperDetails = z.infer<typeof PaperDetails>;
