// The emails of a new paper's application: confirm the address, approved, refused. Each in the paper's language
// first, then the other, as plain text and simple HTML (identity/emails.ts render). Names and the reason are cleaned.
// The Marathi wording is a first draft, for the desk to review with the catalogue.
import { type Part, type Rendered, clean, render } from "../identity/emails.ts";

const ordered = (language: "en" | "mr", parts: { mr: Part[]; en: Part[] }) =>
  language === "mr" ? [...parts.mr, ...parts.en] : [...parts.en, ...parts.mr];

export function confirmEmail(input: { ownerName: string; paperName: string; language: "en" | "mr"; url: string }) {
  const name = clean(input.ownerName, 80);
  const paper = clean(input.paperName, 120);
  return render(
    "paper-signup",
    "Pageinator: तुमचा ईमेल पत्ता निश्चित करा · Confirm your email address",
    ordered(input.language, {
      mr: [
        {
          lang: "mr",
          paragraphs: [
            `नमस्कार ${name},`,
            `“${paper}” साठी Pageinator वापरण्याची तुमची विनंती आम्हाला मिळाली. तुमचा ईमेल पत्ता निश्चित करण्यासाठी हा दुवा उघडा:`,
          ],
          link: input.url,
        },
        {
          lang: "mr",
          paragraphs: ["हा दुवा 24 तासांत कालबाह्य होईल. तुम्ही ही विनंती केली नसेल, तर हा ईमेल दुर्लक्षित करा."],
        },
      ],
      en: [
        {
          lang: "en",
          paragraphs: [
            `Hello ${name},`,
            `We received your request to use Pageinator for “${paper}”. Open this link to confirm your email address:`,
          ],
          link: input.url,
        },
        { lang: "en", paragraphs: ["The link expires in 24 hours. If you did not ask for this, ignore this email."] },
      ],
    }),
  );
}

export function approvedEmail(input: { ownerName: string; paperName: string; language: "en" | "mr"; url: string }) {
  const name = clean(input.ownerName, 80);
  const paper = clean(input.paperName, 120);
  return render(
    "paper-signup",
    "Pageinator: तुमचे वृत्तपत्र तयार आहे · Your paper is ready",
    ordered(input.language, {
      mr: [
        {
          lang: "mr",
          paragraphs: [
            `नमस्कार ${name},`,
            `“${paper}” Pageinator वर सुरू झाले आहे, आणि तुम्ही त्याचे मालक आहात.`,
            "तुमचे Pageinator खाते आधीपासून नसेल, तर आणखी एक स्वागत ईमेल येईल: त्यातील दुव्याने पासवर्ड निवडा (त्याने तुमचा पत्ता निश्चितही होतो), मग इथे साइन इन करा:",
          ],
          link: input.url,
        },
      ],
      en: [
        {
          lang: "en",
          paragraphs: [
            `Hello ${name},`,
            `“${paper}” is now set up on Pageinator, and you are its owner.`,
            "If you do not have a Pageinator account yet, a welcome email is on its way: choose your password through its link (that also confirms your address), then sign in here:",
          ],
          link: input.url,
        },
      ],
    }),
  );
}

export function refusedEmail(input: {
  ownerName: string;
  paperName: string;
  language: "en" | "mr";
  reason: string | null;
}): Rendered {
  const name = clean(input.ownerName, 80);
  const paper = clean(input.paperName, 120);
  const reason = input.reason === null ? null : clean(input.reason, 2000);
  return render(
    "paper-signup",
    "Pageinator: तुमची विनंती · Your request",
    ordered(input.language, {
      mr: [
        {
          lang: "mr",
          paragraphs: [
            `नमस्कार ${name},`,
            `“${paper}” साठी Pageinator वापरण्याची तुमची विनंती आम्ही आत्ता स्वीकारू शकत नाही.`,
            ...(reason ? [`कारण: ${reason}`] : []),
            "प्रश्न असल्यास, Pageinator च्या संकेतस्थळावरील संपर्क पानावरून आम्हाला लिहा.",
          ],
        },
      ],
      en: [
        {
          lang: "en",
          paragraphs: [
            `Hello ${name},`,
            `We cannot take on your request to use Pageinator for “${paper}” just now.`,
            ...(reason ? [`Why: ${reason}`] : []),
            "If you have a question, write to us from the contact page of the Pageinator website.",
          ],
        },
      ],
    }),
  );
}
