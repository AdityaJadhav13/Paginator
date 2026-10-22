// The notification emails of L2.1 (06 §11; docs/product/10-l2-newsroom-plan.md §1 L2.1): a story sent back to its
// reporter, and an invitation accepted, to the person who sent it. Each is in the reader's language first, then the
// other (Marathi and English), as plain text and simple HTML, made the way the sign-in emails are
// (src/modules/identity/emails.ts): names and text escaped and cut, links to the public origin only. The Marathi
// wording is a first draft, for the desk to review with the catalogue.
import { type Part, type Rendered, clean, render } from "../identity/emails.ts";

export type Language = "en" | "mr";

/** The reader's language first. */
const inOrder = (first: Language, parts: Record<Language, Part[]>): Part[] =>
  first === "mr" ? [...parts.mr, ...parts.en] : [...parts.en, ...parts.mr];

/** A path of the web app on the public origin. */
function linkTo(origin: string, path: string): string {
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path)) throw new Error("An email link must be a plain path of the web app.");
  return `${origin}${path}`;
}

export function sentBackEmail(input: {
  language: Language;
  name: string;
  by: string;
  headline: string;
  comment: string;
  origin: string;
  orgId: string;
  publicationId: string;
}): Rendered {
  const name = clean(input.name, 80);
  const by = clean(input.by, 80);
  const headline = clean(input.headline, 160) || "—";
  const comment = clean(input.comment, 1000);
  const link = linkTo(input.origin, `/org/${input.orgId}/pub/${input.publicationId}/stories`);
  return render(
    "story-sent-back",
    "Pageinator: बातमी परत पाठवली · Story sent back",
    inOrder(input.language, {
      mr: [
        {
          lang: "mr",
          paragraphs: [
            `नमस्कार ${name},`,
            `${by} यांनी तुमची बातमी «${headline}» परत पाठवली आहे:`,
            comment,
            "बातमी पाहण्यासाठी आणि दुरुस्त करण्यासाठी हा दुवा उघडा:",
          ],
          link,
        },
      ],
      en: [
        {
          lang: "en",
          paragraphs: [
            `Hello ${name},`,
            `${by} sent your story “${headline}” back to you:`,
            comment,
            "Open this link to see the story and change it:",
          ],
          link,
        },
      ],
    }),
  );
}

export function invitationAcceptedEmail(input: {
  language: Language;
  name: string;
  joined: string;
  organization: string;
  origin: string;
  orgId: string;
}): Rendered {
  const name = clean(input.name, 80);
  const joined = clean(input.joined, 80);
  const organization = clean(input.organization, 120);
  const link = linkTo(input.origin, `/org/${input.orgId}/team`);
  return render(
    "invitation-accepted",
    `Pageinator: ${organization} · आमंत्रण स्वीकारले · Invitation accepted`,
    inOrder(input.language, {
      mr: [
        {
          lang: "mr",
          paragraphs: [
            `नमस्कार ${name},`,
            `${joined} यांनी तुमचे आमंत्रण स्वीकारले आणि ते ${organization} मध्ये सामील झाले.`,
            "टीम पाहण्यासाठी हा दुवा उघडा:",
          ],
          link,
        },
      ],
      en: [
        {
          lang: "en",
          paragraphs: [
            `Hello ${name},`,
            `${joined} accepted your invitation and joined ${organization}.`,
            "Open this link to see the team:",
          ],
          link,
        },
      ],
    }),
  );
}
