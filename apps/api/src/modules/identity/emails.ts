// The sign-in emails (docs/product/10-l2-newsroom-plan.md §4.1, §4.5): confirm an address, reset a password, and tell
// of a new sign-in. Each is in Marathi, then English, until the reader's language is known (the catalogue, PR 12), as
// plain text and simple HTML. Names and devices are escaped, and a link must lead to the public origin. The Marathi
// wording is a first draft, for the desk to review with the catalogue.
import type { Mail, MailKind } from "../notifications/mailer.ts";

type Rendered = Omit<Mail, "to">;
type Part = { lang: "mr" | "en"; paragraphs: string[]; link?: string };

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Control characters, line separators and the bidirectional controls that could make a name or a browser string
 * reorder the text around it (the joiners Devanagari needs, U+200C and U+200D, stay). */
function unsafe(code: number): boolean {
  return (
    code < 0x20 ||
    code === 0x7f ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Text a person typed or a browser sent, made safe to show: each unsafe character becomes a space, at most `max`
 * characters. */
function clean(text: string, max: number): string {
  const flat = [...text]
    .map((c) => (unsafe(c.codePointAt(0) ?? 0) ? " " : c))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A link from Better Auth, refused unless it leads to the public origin. */
function onOrigin(url: string, origin: string): string {
  if (!url.startsWith(`${origin}/`)) throw new Error("An email link must lead to the public origin.");
  return url;
}

function render(kind: MailKind, subject: string, parts: Part[]): Rendered {
  const text = parts
    .map((part) => [...part.paragraphs, ...(part.link ? [part.link] : [])].join("\n\n"))
    .join("\n\n—\n\n");
  const html = parts
    .map((part) => {
      const paragraphs = part.paragraphs.map((p) => `<p>${escape(p)}</p>`).join("");
      const link = part.link ? `<p><a href="${escape(part.link)}">${escape(part.link)}</a></p>` : "";
      return `<div lang="${part.lang}">${paragraphs}${link}</div>`;
    })
    .join("<hr>");
  return { kind, subject, text: `${text}\n`, html: `<!doctype html><html><body>${html}</body></html>` };
}

export function verificationEmail(input: { name: string; url: string; origin: string }): Rendered {
  const name = clean(input.name, 80);
  const link = onOrigin(input.url, input.origin);
  return render("verify-email", "Pageinator: तुमचा ईमेल पत्ता निश्चित करा · Confirm your email address", [
    {
      lang: "mr",
      paragraphs: [
        `नमस्कार ${name},`,
        "Pageinator मधील तुमचे खाते सुरू करण्यासाठी तुमचा ईमेल पत्ता निश्चित करा. हा दुवा उघडा:",
      ],
      link,
    },
    { lang: "mr", paragraphs: ["हा दुवा एका तासात कालबाह्य होईल. तुम्ही खाते उघडले नसेल, तर हा ईमेल दुर्लक्षित करा."] },
    {
      lang: "en",
      paragraphs: [`Hello ${name},`, "Confirm your email address to start your Pageinator account. Open this link:"],
      link,
    },
    { lang: "en", paragraphs: ["The link expires in one hour. If you did not open an account, ignore this email."] },
  ]);
}

export function resetEmail(input: { name: string; url: string; origin: string }): Rendered {
  const name = clean(input.name, 80);
  const link = onOrigin(input.url, input.origin);
  return render("reset-password", "Pageinator: पासवर्ड नवीन करा · Reset your password", [
    { lang: "mr", paragraphs: [`नमस्कार ${name},`, "नवीन पासवर्ड निवडण्यासाठी हा दुवा उघडा:"], link },
    {
      lang: "mr",
      paragraphs: [
        "हा दुवा एका तासात कालबाह्य होईल आणि एकदाच वापरता येईल. तुम्ही हे मागितले नसेल, तर हा ईमेल दुर्लक्षित करा: तुमचा पासवर्ड बदलणार नाही.",
      ],
    },
    { lang: "en", paragraphs: [`Hello ${name},`, "Open this link to choose a new password:"], link },
    {
      lang: "en",
      paragraphs: [
        "The link expires in one hour and works once. If you did not ask for it, ignore this email: your password stays as it is.",
      ],
    },
  ]);
}

/** A moment as people in the pilot read it: Asia/Kolkata (UTC+05:30, no summer time), digits as written. */
function istTime(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 16)} IST`;
}

export function newSignInEmail(input: { name: string; at: Date; device: string }): Rendered {
  const name = clean(input.name, 80);
  const device = clean(input.device, 120) || "an unknown browser";
  const when = istTime(input.at);
  return render("new-sign-in", "Pageinator: नवीन साइन-इन · New sign-in", [
    {
      lang: "mr",
      paragraphs: [
        `नमस्कार ${name},`,
        `तुमच्या Pageinator खात्यात ${when} रोजी नवीन साइन-इन झाले (${device}).`,
        "हे तुम्ही नसाल, तर लगेच तुमचा पासवर्ड बदला आणि Account → Security मध्ये ते सत्र बंद करा.",
      ],
    },
    {
      lang: "en",
      paragraphs: [
        `Hello ${name},`,
        `Someone signed in to your Pageinator account at ${when} (${device}).`,
        "If it was not you, change your password now, and end that session in Account → Security.",
      ],
    },
  ]);
}

/** How a role is named in an invitation (first drafts for the catalogue, PR 12). */
const ROLE_NAMES: Record<string, { mr: string; en: string }> = {
  admin: { mr: "प्रशासक", en: "Admin" },
  member: { mr: "सदस्य", en: "Member" },
  chief_editor: { mr: "मुख्य संपादक", en: "Chief Editor" },
  editor: { mr: "संपादक", en: "Editor" },
  sub_editor: { mr: "उपसंपादक", en: "Sub-editor" },
  reporter: { mr: "वार्ताहर", en: "Reporter" },
  page_designer: { mr: "पान रचनाकार", en: "Page Designer" },
  photo_editor: { mr: "छायाचित्र संपादक", en: "Photo Editor" },
  advertising: { mr: "जाहिरात", en: "Advertising" },
  prepress: { mr: "प्रीप्रेस", en: "Prepress" },
  viewer: { mr: "वाचक", en: "Viewer" },
};

export function invitationEmail(input: {
  inviter: string;
  organization: string;
  roles: readonly string[];
  url: string;
  origin: string;
}): Rendered {
  const inviter = clean(input.inviter, 80);
  const organization = clean(input.organization, 120);
  const link = onOrigin(input.url, input.origin);
  const named = (lang: "mr" | "en") => input.roles.map((role) => ROLE_NAMES[role]?.[lang] ?? role).join(", ");
  return render("invitation", `Pageinator: ${organization} · आमंत्रण · Invitation`, [
    {
      lang: "mr",
      paragraphs: [
        `${inviter} यांनी तुम्हाला Pageinator वर ${organization} मध्ये (${named("mr")}) आमंत्रित केले आहे.`,
        "आमंत्रण पाहण्यासाठी आणि खाते उघडण्यासाठी हा दुवा उघडा:",
      ],
      link,
    },
    {
      lang: "mr",
      paragraphs: ["हे आमंत्रण सात दिवसांत कालबाह्य होईल. तुम्हाला ते अपेक्षित नसेल, तर हा ईमेल दुर्लक्षित करा."],
    },
    {
      lang: "en",
      paragraphs: [
        `${inviter} invited you to ${organization} on Pageinator, as ${named("en")}.`,
        "Open this link to see the invitation and open your account:",
      ],
      link,
    },
    { lang: "en", paragraphs: ["The invitation expires in seven days. If you did not expect it, ignore this email."] },
  ]);
}
