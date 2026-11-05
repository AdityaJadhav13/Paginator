/**
 * Claims governance for the public website (docs/product/03-website-and-accounts.md §4; CLAUDE.md "No unproven
 * claims").
 *
 * Every sentence the public pages can say, in English and Marathi, is a record in `content.ts`, and this file reads
 * all of them:
 *   - every fact and every plan names its evidence, a file in this repository and words it contains, and the file
 *     really contains them; a number in a fact appears in its evidence, and the Marathi says the same numbers;
 *   - the claim vocabulary (press-ready, certified, AI-powered, seamless…) is said nowhere, except by a denial;
 *   - nothing names a customer, a testimonial, a price, a fixture organisation or the demonstration's old wording;
 *   - every record is shown somewhere, and every word shown on a public page is a whole record, in its language.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, within } from "../../src/test/render.tsx";
import { CONTENT_RECORDS, text, type ContentRecord, type PublicLanguage } from "../../src/features/public/content.ts";
import { EVIDENCE } from "../../src/features/public/evidence.ts";
import { stageIds, stateLabelIds, WORKFLOW_STAGES } from "../../src/features/public/workflow.ts";
import { CATALOGUES } from "../../src/i18n/index.ts";
import { LANGUAGES, PUBLIC_PAGES, contactAnswered, renderPublic } from "./renderPublic.tsx";

const REPO = resolve(__dirname, "../../../..");
const DEVANAGARI = /[ऀ-ॿ]/;

/** The claim vocabulary (UI005 §19.3 and the §17.3 security list). Scanned case-insensitively in English. */
const FORBIDDEN_TERMS = [
  "press-ready",
  "press ready",
  "print-ready",
  "production-ready",
  "production ready",
  "ready for press",
  "pdf/x-valid",
  "pdf/x valid",
  "certified",
  "guaranteed",
  "guarantee",
  "trusted by",
  "industry-leading",
  "world-class",
  "best-in-class",
  "enterprise-grade",
  "revolutionary",
  "seamless",
  "effortless",
  "ai-powered",
  "powered by ai",
  "ai-driven",
  "next-generation",
  "cutting-edge",
  "unlock",
  "supercharge",
  "10x",
  "instantly",
  "zero-config",
  "no code",
  "free trial",
  "money-back",
  "soc 2",
  "soc2",
  "iso 27001",
  "iso27001",
  "gdpr-compliant",
  "hipaa",
  "pci",
  "fedramp",
  "ccpa-compliant",
  "accredited",
  "audited",
  "attestation",
  "penetration tested",
  "bank-grade",
  "military-grade",
  "zero-trust",
  "end-to-end encrypted",
  "99.9%",
  "sla",
  "uptime",
];

/**
 * The same claims in Marathi: ready for print, printable, certified, guarantee and assured, and the Marathi for
 * seamless, AI-powered, guaranteed and production-ready. Scanned in every Marathi text but a denial's.
 */
const FORBIDDEN_MR = [
  "छपाईसाठी तयार",
  "छपाईयोग्य",
  "छपाईस योग्य",
  "प्रमाणित",
  "हमी",
  "खात्रीशीर",
  "हमखास",
  "अखंड",
  "विनासायास",
  "सहजसुंदर",
  "एआय-चालित",
  "एआयवर आधारित",
  "AI-चालित",
  "AI आधारित",
  "कृत्रिम बुद्धिमत्तेवर आधारित",
  "कृत्रिम बुद्धिमत्तेवर चालणारे",
  "उत्पादनासाठी तयार",
  "वापरासाठी सज्ज",
  "छपाईसाठी सज्ज",
];

/** The claim terms a text says, in its language. */
function forbiddenIn(text: string, language: PublicLanguage): string[] {
  // a Marathi term starts a word: नेहमी ("always") does not say हमी ("guarantee")
  if (language === "mr") return FORBIDDEN_MR.filter((term) => new RegExp(`(?<![\u0900-\u097F])${term}`).test(text));
  const lower = text.toLowerCase();
  return FORBIDDEN_TERMS.filter((term) =>
    new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^a-z])`).test(lower),
  );
}

/** Statements the demonstration stage made, which are no longer true, and its placeholder vocabulary. */
const NO_LONGER_TRUE = [
  "does not send anything",
  "Nothing was sent",
  "Reserved in the current build",
  "You can try this in the demonstration",
  "demonstration workspace",
  "part of the demonstration",
  "placeholder",
  "Preview the acknowledgement",
  "No content is ingested",
  "None of them is implemented yet",
  "None of them describes what runs today",
  "transmits nothing",
  "runs entirely in your browser",
  "Sign in to your newsroom",
];

/** UI003 fixture names never appear in public copy. */
const FIXTURE_NAMES = [
  "Sahyadri Media Cooperative",
  "Konkan Coastal Press",
  "Pune Daily Ledger",
  "Deccan Evening Record",
  "Ratnagiri Tide",
  "Sahyadri Demo Editor",
  "Konkan Demo Reviewer",
];

const asciiDigits = (value: string) => value.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
/** The numbers a fact or plan states that its evidence does not: whole numbers, compared as numbers. */
function unsourcedNumbers(record: ContentRecord): string[] {
  const sourced = new Set(numbersIn((record.evidence ?? []).map((key) => EVIDENCE[key].quote).join(" ")));
  return numbersIn(record.en).filter((number) => !sourced.has(number));
}

/** Record names (EXP-GEN-1, ADR-022, gate G2) are names, not numbers the text states. */
const RECORD_NAMES = /EXP-GEN-1|EXP-PDF-1|ADR-022|\bG2\b/g;
const numbersIn = (value: string) =>
  [...asciiDigits(value.replace(RECORD_NAMES, "")).matchAll(/\d+/g)].map((match) => match[0]);

describe("Records", () => {
  it("are many, with unique ids", () => {
    expect(CONTENT_RECORDS.length).toBeGreaterThan(150);
    const ids = CONTENT_RECORDS.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each have English, Marathi in Devanagari, a source and where in it", () => {
    for (const record of CONTENT_RECORDS) {
      expect(record.en.trim(), `${record.id} en`).not.toBe("");
      expect(record.mr, `${record.id} mr`).toMatch(DEVANAGARI);
      expect(record.source, record.id).toBeTruthy();
      expect(record.sourceRef.trim(), record.id).not.toBe("");
      if (record.kind !== "specimen") expect(record.en, `${record.id} en`).not.toMatch(DEVANAGARI);
    }
  });

  it("keep Marathi free of English words other than product and record names", () => {
    const allowed = /^(Pageinator|Desk|Word|WhatsApp|AI|Claude|Anthropic|EXP-GEN-1|EXP-PDF-1|ADR-022|G2)$/;
    for (const record of CONTENT_RECORDS) {
      const latin = record.mr.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? [];
      for (const word of latin) expect(word, `${record.id}: "${word}" in the Marathi`).toMatch(allowed);
    }
  });

  it("do not repeat a sentence in two records", () => {
    const seen = new Map<string, string>();
    for (const record of CONTENT_RECORDS) {
      if (record.kind === "specimen" || record.en.trim().split(/\s+/).length < 4) continue;
      expect(seen.get(record.en), `"${record.id}" repeats "${seen.get(record.en)}"`).toBeUndefined();
      seen.set(record.en, record.id);
    }
  });

  it("keep every English sentence to 30 words or fewer", () => {
    const tooLong = CONTENT_RECORDS.flatMap((record) =>
      record.en
        .split(/(?<=[.?!])\s+/)
        .filter((sentence) => sentence.trim().split(/\s+/).length > 30)
        .map(() => record.id),
    );
    expect(tooLong).toEqual([]);
  });
});

describe("Every fact and plan names its evidence, and the evidence says it", () => {
  const sourced = CONTENT_RECORDS.filter((record) => record.kind === "fact" || record.kind === "plan");

  it("covers the claims the site makes", () => {
    expect(sourced.length).toBeGreaterThan(50);
  });

  for (const record of sourced) {
    it(`"${record.id}" (${record.kind})`, () => {
      expect(record.evidence?.length ?? 0, `${record.id} names no evidence`).toBeGreaterThan(0);
      for (const key of record.evidence ?? []) {
        const { path, quote } = EVIDENCE[key];
        expect(path, `${record.id}: evidence must be a repository path`).not.toMatch(/^\/|PageinatorPrivate|\.\./);
        const file = resolve(REPO, path);
        expect(existsSync(file), `${record.id}: ${path} does not exist`).toBe(true);
        expect(readFileSync(file, "utf8"), `${record.id}: ${path} does not say "${quote}"`).toContain(quote);
      }
    });
  }

  it("states a number only where its evidence states it, and the same numbers in Marathi", () => {
    for (const record of CONTENT_RECORDS) {
      const numbers = numbersIn(record.en);
      if (record.kind === "specimen") continue;
      if (record.kind !== "fact" && record.kind !== "plan") {
        expect(numbers, `${record.id} (${record.kind}) states a number without evidence`).toEqual([]);
        continue;
      }
      expect(unsourcedNumbers(record), `${record.id}: numbers not in its evidence`).toEqual([]);
      expect(numbersIn(record.mr).sort(), `${record.id}: the Marathi says other numbers`).toEqual([...numbers].sort());
    }
  });

  it("compares whole numbers: 20 of 28 is not sourced by evidence that says 28 and 2026", () => {
    const planted = { ...(CONTENT_RECORDS.find((record) => record.id === "proof-gen1") as ContentRecord) };
    const twenty = { ...planted, en: "20 of 28 held-out test pages laid out automatically." };
    expect(EVIDENCE.gen1.quote).toContain("2026");
    expect(unsourcedNumbers(twenty)).toEqual(["20"]);
    expect(unsourcedNumbers(planted)).toEqual([]);
  });

  it("writes numbers in Devanagari digits in Marathi", () => {
    for (const record of CONTENT_RECORDS) expect(record.mr.replace(RECORD_NAMES, ""), record.id).not.toMatch(/[0-9]/);
  });
});

describe("The claim vocabulary", () => {
  for (const record of CONTENT_RECORDS) {
    if (record.kind === "denial") continue;
    it(`"${record.id}" says none of it, in English or Marathi`, () => {
      expect(forbiddenIn(record.en, "en"), `${record.id} en`).toEqual([]);
      expect(forbiddenIn(record.mr, "mr"), `${record.id} mr`).toEqual([]);
    });
  }

  it("is said by none of the header's and footer's words (public.*), in either language", () => {
    for (const key of Object.keys(CATALOGUES.en).filter((name) => name.startsWith("public."))) {
      const name = key as keyof typeof CATALOGUES.en;
      expect(forbiddenIn(CATALOGUES.en[name], "en"), key).toEqual([]);
      expect(forbiddenIn(CATALOGUES.mr[name], "mr"), key).toEqual([]);
    }
  });

  it("catches a planted Marathi claim", () => {
    expect(forbiddenIn("हे पान छपाईसाठी तयार आहे.", "mr")).toEqual(["छपाईसाठी तयार"]);
    expect(forbiddenIn("प्रमाणित आणि खात्रीशीर मांडणी", "mr")).toEqual(["प्रमाणित", "खात्रीशीर"]);
    expect(forbiddenIn("AI-चालित वृत्तपत्र", "mr")).toEqual(["AI-चालित"]);
    expect(forbiddenIn("हे नेहमी असेच असते.", "mr")).toEqual([]);
    expect(forbiddenIn("याची हमी आहे.", "mr")).toEqual(["हमी"]);
    expect(forbiddenIn("A seamless, press-ready page", "en")).toEqual(["press-ready", "seamless"]);
  });

  it("is said only by denials, and a denial begins with No", () => {
    const denials = CONTENT_RECORDS.filter((record) => record.kind === "denial");
    expect(denials.length).toBeGreaterThan(4);
    for (const record of denials) {
      expect(record.id, record.id).toMatch(/^security-limit-/);
      expect(record.en.startsWith("No "), `"${record.id}" is not phrased as a denial`).toBe(true);
    }
  });

  it("never claims PDF/X validity or press-readiness, even in passing", () => {
    const corpus = CONTENT_RECORDS.filter((record) => record.kind !== "denial").map((record) => record.en).join(" ");
    expect(corpus).not.toMatch(/PDF\/X/);
    expect(corpus).not.toMatch(/\bready (for|to) (print|press)\b/i);
  });
});

describe("No invented entities, prices or leftovers", () => {
  const corpus = CONTENT_RECORDS.map((record) => `${record.en} ${record.mr}`).join(" ");

  it("names no customer, testimonial, logo or usage count", () => {
    for (const phrase of ["trusted by", "used by", "loved by", "our customers", "case study", "testimonial", "award", "publishers use"]) {
      expect(corpus.toLowerCase(), phrase).not.toContain(phrase);
    }
  });

  it("names no fixture organisation or publication", () => {
    for (const name of FIXTURE_NAMES) expect(corpus).not.toContain(name);
  });

  it("states no price: no currency, and no figure in any pricing record", () => {
    expect(corpus).not.toMatch(/[$€£₹¥]|\bRs\.?\s?\d|रु\.|रुपये/);
    for (const record of CONTENT_RECORDS.filter((candidate) => candidate.id.startsWith("pricing-"))) {
      expect(numbersIn(`${record.en} ${record.mr}`), record.id).toEqual([]);
      expect(record.en, record.id).not.toMatch(/%|\bfree\b|\btrial\b/i);
    }
  });

  it("says none of the demonstration stage's statements any more", () => {
    for (const phrase of NO_LONGER_TRUE) expect(corpus.toLowerCase(), phrase).not.toContain(phrase.toLowerCase());
  });

  it("calls hosting in India planned, never done", () => {
    for (const record of CONTENT_RECORDS.filter((candidate) => /India/.test(candidate.en))) {
      expect(record.kind, record.id).toBe("plan");
      if (/hosting/i.test(record.en)) expect(record.en, record.id).toMatch(/planned/);
    }
    const footer = CATALOGUES.en["public.footer.hosting"];
    expect(footer).toMatch(/planned/);
    expect(footer).not.toMatch(/stored in India/i);
  });

  it("says the press test was text-only, next to the claim that a press printed a page", () => {
    expect(text("proof-press-note", "en")).toMatch(/text-only/);
    expect(text("proof-press-note", "en")).toMatch(/not been press-tested/);
    expect(text("proof-gen1-note", "en")).toMatch(/No editor has judged/);
  });
});

describe("The workflow's states are the evidence's", () => {
  it("has seven stages, numbered, each with a state", () => {
    expect(WORKFLOW_STAGES.map((stage) => stage.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(WORKFLOW_STAGES.map((stage) => stage.key)).toEqual(["plan", "content", "generate", "edit", "check", "print", "archive"]);
    for (const stage of WORKFLOW_STAGES) expect(stage.states.length).toBeGreaterThan(0);
  });

  it("marks a stage working or built only with a fact for what is live today, and planned only with a plan", () => {
    for (const stage of WORKFLOW_STAGES) {
      const today = CONTENT_RECORDS.find((record) => record.id === stageIds(stage).today) as ContentRecord;
      if (stage.states.includes("planned")) {
        expect(today.kind, stage.key).toBe("plan");
        expect(today.en, stage.key).toMatch(/^Planned/);
      } else {
        expect(today.kind, stage.key).toBe("fact");
      }
      if (stage.states.includes("desk")) expect(today.en, stage.key).toMatch(/In the Desk/);
      if (stage.states.includes("pilot")) expect(today.en, stage.key).toMatch(/Built for the pilot/);
    }
  });

  it("calls the archive built for the pilot, not working in the Desk", () => {
    expect(WORKFLOW_STAGES.find((stage) => stage.key === "archive")?.states).toEqual(["pilot"]);
  });
});

/** The text a reader is told inside <main>: text nodes, without presentational (aria-hidden) ones. */
function readableTexts(main: HTMLElement, withPresentational = false): string[] {
  const readable = main.cloneNode(true) as HTMLElement;
  if (!withPresentational) for (const hidden of readable.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  const texts: string[] = [];
  const walker = document.createTreeWalker(readable, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (value !== "" && /[\p{L}\p{N}]/u.test(value)) texts.push(value);
  }
  for (const element of readable.querySelectorAll("[aria-label]")) texts.push(element.getAttribute("aria-label") ?? "");
  return texts;
}

/** Everything every public page shows, in one language, across its states (signed out and in; the form's outcomes). */
async function shownEverywhere(language: PublicLanguage): Promise<Set<string>> {
  const seen = new Set<string>();
  const harvest = (container: HTMLElement) => {
    // the presentational text too: the Field's "(required)" is shown, though not read out
    for (const value of readableTexts(within(container).getByRole("main"), true)) seen.add(value);
  };
  for (const { path, headingId } of PUBLIC_PAGES) {
    for (const preset of ["signed-out", undefined] as const) {
      const view = renderPublic(path, preset, language);
      await screen.findByRole("heading", { level: 1, name: text(headingId, language) });
      // connected: the calls to action, the form and how to report a problem are shown
      await contactAnswered(view.environment);
      if (!preset && path !== "/contact") await screen.findAllByText(text("cta-open-workspace", language));
      harvest(view.container);
      view.unmount();
    }
  }
  const user = userEvent.setup();
  const contact = async (setup: (view: ReturnType<typeof renderPublic>) => void, fill: boolean) => {
    const view = renderPublic("/contact", "signed-out", language);
    setup(view);
    await screen.findByRole("heading", { level: 1, name: text("contact-title", language) });
    await screen.findByRole("button", { name: text("contact-submit", language) });
    if (fill) {
      await user.type(screen.getByLabelText(new RegExp(`^${text("contact-label-name", language)}`)), "Asha Kalpit");
      await user.type(screen.getByLabelText(text("contact-label-phone", language)), "+91 98765 43210");
    }
    await user.click(screen.getByRole("button", { name: text("contact-submit", language) }));
    harvest(view.container);
    return view;
  };
  // empty: name and reach errors
  (await contact(() => undefined, false)).unmount();
  // a malformed phone and email
  {
    const view = renderPublic("/contact", "signed-out", language);
    await screen.findByRole("heading", { level: 1, name: text("contact-title", language) });
    await screen.findByRole("button", { name: text("contact-submit", language) });
    // longer than allowed (the field's maxlength stops typing; a pasted or scripted value is checked too)
    fireEvent.change(screen.getByLabelText(new RegExp(`^${text("contact-label-name", language)}`)), {
      target: { value: "न".repeat(101) },
    });
    await user.type(screen.getByLabelText(text("contact-label-phone", language)), "call me");
    await user.type(screen.getByLabelText(text("contact-label-email", language)), "not an address");
    await user.click(screen.getByRole("button", { name: text("contact-submit", language) }));
    harvest(view.container);
    view.unmount();
  }
  for (const outcome of [
    { kind: "sent" },
    { kind: "unavailable" },
    { kind: "busy" },
    { kind: "failed" },
    { kind: "sendFailed" },
    { kind: "refused" },
    { kind: "invalid", fields: ["newspaper", "message"] },
  ] as const) {
    const view = await contact((rendered) => rendered.environment.contactController.setOutcome(outcome), true);
    if (outcome.kind === "sent") await screen.findByText(text("contact-sent-heading", language));
    harvest(view.container);
    view.unmount();
  }
  // while sending
  {
    const view = renderPublic("/contact", "signed-out", language);
    view.environment.contactController.hold();
    await screen.findByRole("heading", { level: 1, name: text("contact-title", language) });
    await screen.findByRole("button", { name: text("contact-submit", language) });
    await user.type(screen.getByLabelText(new RegExp(`^${text("contact-label-name", language)}`)), "Asha");
    await user.type(screen.getByLabelText(text("contact-label-email", language)), "asha@example.test");
    await user.click(screen.getByRole("button", { name: text("contact-submit", language) }));
    await screen.findByRole("button", { name: text("contact-sending", language) });
    harvest(view.container);
    view.environment.contactController.release();
    view.unmount();
  }
  // the form not connected, or not reachable: the contact page and the security page say so
  for (const connection of ["notConnected", "unknown"] as const) {
    for (const path of ["/contact", "/security"]) {
      const view = renderPublic(path, "signed-out", language);
      view.environment.contactController.setConnection(connection);
      await screen.findByRole("heading", { level: 1, name: text(path === "/contact" ? "contact-title" : "security-title", language) });
      if (path === "/contact") {
        await screen.findByText(text(connection === "unknown" ? "contact-unknown-heading" : "contact-unavailable-heading", language));
      } else {
        await screen.findByText(text("security-contact-off", language));
      }
      harvest(view.container);
      view.unmount();
    }
  }
  // the page while it asks whether the form is connected
  {
    const view = renderPublic("/contact", "signed-out", language);
    harvest(view.container);
    view.unmount();
  }
  return seen;
}

describe("Every record is shown, and only records are shown", () => {
  for (const language of LANGUAGES) {
    it(`shows every record somewhere, in ${language}`, async () => {
      const shown = await shownEverywhere(language);
      const dead = CONTENT_RECORDS.filter((record) => !shown.has(text(record.id, language))).map((record) => record.id);
      expect(dead, `records no page shows: ${dead.join(", ")}`).toEqual([]);
    }, 60_000);
  }

  /** Strings the UI kit and the catalogue show inside a page: message icon names. */
  const KIT = (language: PublicLanguage) =>
    new Set([CATALOGUES[language]["message.success"], CATALOGUES[language]["message.error"], CATALOGUES[language]["message.warning"]]);

  for (const language of LANGUAGES) {
    for (const { path, headingId } of PUBLIC_PAGES) {
      it(`"${path}" in ${language} shows only whole records, in ${language}`, async () => {
        const view = renderPublic(path, "signed-out", language);
        await screen.findByRole("heading", { level: 1, name: text(headingId, language) });
        const allowed = new Set([...CONTENT_RECORDS.map((record) => text(record.id, language)), ...KIT(language)]);
        const offenders = readableTexts(within(view.container).getByRole("main")).filter((value) => !allowed.has(value));
        expect(offenders).toEqual([]);
      });
    }
  }

  it("would notice a sentence split by an interpolation", () => {
    const allowed = new Set(CONTENT_RECORDS.map((record) => record.en));
    expect(allowed.has("28 of 28")).toBe(false);
    expect(allowed.has(text("proof-gen1", "en"))).toBe(true);
  });

  it("wires each state label to a state", () => {
    for (const id of stateLabelIds()) expect(CONTENT_RECORDS.some((record) => record.id === id), id).toBe(true);
  });
});

describe("the public footer notice (doc 11 L2-567, L4-004)", () => {
  it("says a paper can apply, and no longer that the product is still being built or invitation-only", () => {
    const en = CATALOGUES.en["shell.notice"];
    expect(en).toContain("A newspaper can apply to join");
    expect(en).not.toMatch(/still being built|Accounts are by invitation/i);
    expect(CATALOGUES.mr["shell.notice"]).toContain("अर्ज करू शकते");
  });
});
