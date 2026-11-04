// The notification emails of L2.1 (06 §11; docs/product/10-l2-newsroom-plan.md §1 L2.1): a story sent back to its
// reporter, and an invitation accepted, to the person who sent it; and of L2.6, the ads whose artwork is missing at
// the cut-off. Each is in the reader's language first, then the
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
  if (!/^\/[A-Za-z0-9/_-]*(\?date=[0-9]{4}-[0-9]{2}-[0-9]{2})?$/.test(path))
    throw new Error("An email link must be a plain path of the web app.");
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

/** Why a booking's artwork will not print: none, a picture that cannot be used, or one that fails a check. */
export type ArtworkProblem = "none" | "unusable" | "checks";

const PROBLEM: Record<Language, Record<ArtworkProblem, string>> = {
  en: {
    none: "no artwork yet",
    unusable: "its picture cannot be used",
    checks: "its picture does not fit the size or is not sharp enough",
  },
  mr: {
    none: "अजून जाहिरातीचे चित्र नाही",
    unusable: "चित्र वापरता येत नाही",
    checks: "चित्र आकारात बसत नाही किंवा पुरेसे स्पष्ट नाही",
  },
};

export function adArtworkMissingEmail(input: {
  language: Language;
  name: string;
  publication: string;
  date: string;
  ads: readonly { advertiser: string; campaign: string; wMm: number; hMm: number; problem: ArtworkProblem }[];
  origin: string;
  orgId: string;
  publicationId: string;
}): Rendered {
  const name = clean(input.name, 80);
  const publication = clean(input.publication, 120);
  const date = clean(input.date, 10);
  const shown = input.ads.slice(0, 50);
  const lines = (language: Language) => [
    ...shown.map((ad) => {
      const campaign = clean(ad.campaign, 120);
      const what = `${clean(ad.advertiser, 120)}${campaign ? ` (${campaign})` : ""}, ${ad.wMm} × ${ad.hMm} mm`;
      return `• ${what}: ${PROBLEM[language][ad.problem]}`;
    }),
    ...(input.ads.length > shown.length
      ? [
          language === "mr"
            ? `… आणि आणखी ${input.ads.length - shown.length}`
            : `… and ${input.ads.length - shown.length} more`,
        ]
      : []),
  ];
  const link = linkTo(input.origin, `/org/${input.orgId}/pub/${input.publicationId}/ads?date=${input.date}`);
  return render(
    "ad-artwork-missing",
    `Pageinator: ${publication} ${date} · जाहिरातीचे चित्र हवे · Ad artwork missing`,
    inOrder(input.language, {
      mr: [
        {
          lang: "mr",
          paragraphs: [
            `नमस्कार ${name},`,
            `${publication} च्या ${date} च्या अंकाची जाहिरातींची अंतिम वेळ संपली. या जाहिराती अजून छापता येणार नाहीत:`,
            lines("mr").join("\n"),
            "जाहिराती पाहण्यासाठी हा दुवा उघडा:",
          ],
          link,
        },
      ],
      en: [
        {
          lang: "en",
          paragraphs: [
            `Hello ${name},`,
            `The ad cut-off for the ${date} edition of ${publication} has passed. These ads cannot print yet:`,
            lines("en").join("\n"),
            "Open this link to see the ads:",
          ],
          link,
        },
      ],
    }),
  );
}
