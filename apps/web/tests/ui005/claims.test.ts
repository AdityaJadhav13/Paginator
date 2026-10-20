/**
 * Content governance scan (UI005 §19.4; AC-13 – AC-15, AC-28, AC-29,
 * AC-33, AC-34, AC-36).
 *
 * This is the mechanism by which the backlog's "no invented customers,
 * certifications or press-ready claims" requirement is enforced rather
 * than merely asserted: every sentence the public surfaces can say is a
 * record in one module, and this file reads all of them.
 */
import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import {
  CONTENT_RECORDS,
  expandedContentTexts,
} from "../../src/features/public/content.ts";
import {
  WORKFLOW_STAGES,
  availabilityLabels,
  workflowOwningUnits,
  workflowStageViews,
} from "../../src/features/public/workflow.ts";
import { PUBLIC_ROUTES, renderPublic } from "./renderPublic.tsx";

/*
 * One corpus. Workflow prose is no longer a second, separately-owned set
 * of strings: every rendered sentence is a record in `content.ts`, so this
 * is the complete list of everything the public surfaces can say.
 */
const ALL_RECORDS = CONTENT_RECORDS;

/** §19.3 plus the §17.3 security list. Scanned case-insensitively. */
const FORBIDDEN_TERMS = [
  // §19.3 — claim vocabulary
  "press-ready",
  "print-ready",
  "production-ready",
  "production ready",
  "ready for press",
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
  // §17.3 — security vocabulary
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
 * The only records permitted to contain a forbidden term, because they
 * exist to deny the claim the term names. Their shape is asserted
 * separately below, so this is a narrowing, not an exemption.
 */
const DENIAL_PREFIX = "security-limit-";

/** UI003 fixture names must never appear in public copy (§19.2). */
const FIXTURE_NAMES = [
  "Sahyadri Media Cooperative",
  "Konkan Coastal Press",
  "Pune Daily Ledger",
  "Deccan Evening Record",
  "Ratnagiri Tide",
  "Sahyadri Demo Editor",
  "Konkan Demo Reviewer",
];

/** Every module a public content id may legitimately be referenced from. */
const componentSources = import.meta.glob("/src/features/public/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("Content model integrity (AC-13)", () => {
  it("found the public content modules to scan", () => {
    expect(ALL_RECORDS.length).toBeGreaterThan(50);
    expect(Object.keys(componentSources).length).toBeGreaterThan(5);
  });

  it("holds the workflow prose, availability labels and owner caption", () => {
    const ids = new Set(ALL_RECORDS.map((record) => record.id));
    for (const stage of WORKFLOW_STAGES) {
      expect(ids, `stage ${stage.key} name`).toContain(`workflow-${stage.key}-name`);
      expect(ids, `stage ${stage.key} description`).toContain(
        `workflow-${stage.key}-description`
      );
      expect(ids, `stage ${stage.key} constraint`).toContain(
        `workflow-${stage.key}-constraint`
      );
    }
    for (const id of ["availability-demonstrated", "availability-routed", "availability-planned"]) {
      expect(ids).toContain(id);
    }
    expect(ids).toContain("features-owner-caption");
  });

  it("does not duplicate any rendered sentence between records", () => {
    // Prose only. Short labels may legitimately coincide — a page title and
    // a nav link can both be "Contact" — but a duplicated sentence means the
    // same claim is now maintained in two places, which is the drift this
    // module exists to prevent.
    const seen = new Map<string, string>();
    for (const record of ALL_RECORDS) {
      if (record.text.trim().split(/\s+/).length < 3) continue;
      const previous = seen.get(record.text);
      expect(
        previous,
        `"${record.id}" duplicates the text of "${previous}"`
      ).toBeUndefined();
      seen.set(record.text, record.id);
    }
  });

  it("gives every record a unique id", () => {
    const ids = ALL_RECORDS.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("traces every record to an architecture source", () => {
    for (const record of ALL_RECORDS) {
      expect(record.source, `${record.id} has no source`).toBeTruthy();
      expect(record.sourceRef.trim(), `${record.id} has no sourceRef`).not.toBe("");
      expect(record.text.trim(), `${record.id} has no text`).not.toBe("");
    }
  });
});

describe("Forbidden claim vocabulary (AC-33, AC-30)", () => {
  for (const record of CONTENT_RECORDS) {
    if (record.id.startsWith(DENIAL_PREFIX)) continue;

    it(`"${record.id}" contains no forbidden claim term`, () => {
      const text = record.text.toLowerCase();
      for (const term of FORBIDDEN_TERMS) {
        expect(text, `"${record.id}" contains forbidden term "${term}"`).not.toContain(
          term
        );
      }
    });
  }

  it("scans the strings format() can produce with the same vocabulary", () => {
    for (const text of expandedContentTexts({ unit: workflowOwningUnits() })) {
      for (const term of FORBIDDEN_TERMS) {
        expect(text.toLowerCase(), `"${text}" contains "${term}"`).not.toContain(term);
      }
    }
  });

  it("only exempts records that are denials, and proves they are denials", () => {
    const denials = CONTENT_RECORDS.filter((record) =>
      record.id.startsWith(DENIAL_PREFIX)
    );

    expect(denials.length).toBeGreaterThan(0);
    for (const record of denials) {
      // A denial must begin with "No " — it cannot be reworded into an
      // assertion while keeping the exemption.
      expect(record.text.startsWith("No "), `"${record.id}" is not phrased as a denial`).toBe(
        true
      );
    }
  });
});

describe("No invented entities (AC-28, AC-29)", () => {
  it("names no customer, testimonial, logo or usage count", () => {
    const corpus = ALL_RECORDS.map((record) => record.text).join(" ").toLowerCase();

    for (const phrase of [
      "trusted by",
      "used by",
      "loved by",
      "our customers",
      "case study",
      "testimonial",
      "award",
      "join ",
      "publishers use",
    ]) {
      expect(corpus, `corpus contains "${phrase}"`).not.toContain(phrase);
    }
  });

  it("never renders a UI003 fixture organization or publication name", () => {
    const corpus = ALL_RECORDS.map((record) => record.text).join(" ");
    for (const name of FIXTURE_NAMES) {
      expect(corpus, `corpus contains fixture name "${name}"`).not.toContain(name);
    }
  });
});

describe("Pricing records carry no figure (AC-24)", () => {
  it("has no currency symbol, digit or percentage in any pricing record", () => {
    const pricing = CONTENT_RECORDS.filter((record) => record.id.startsWith("pricing-"));

    expect(pricing.length).toBeGreaterThan(0);
    for (const record of pricing) {
      expect(record.text, `"${record.id}" contains a digit`).not.toMatch(/\d/);
      expect(record.text, `"${record.id}" contains a currency symbol`).not.toMatch(
        /[$€£₹¥]/
      );
      expect(record.text, `"${record.id}" contains a percentage`).not.toMatch(/%/);
    }
  });
});

/*
 * No dead copy (AC-15), proved by rendering rather than by grep.
 *
 * A source-text check cannot serve here: the workflow ids are built as
 * `workflow-${stage.key}-name`, so no literal appears outside the record
 * itself — and because `content.ts` is part of the scanned corpus, a
 * "the id appears somewhere" assertion passes for every record by virtue
 * of its own declaration. It is vacuous.
 *
 * So this walks every reachable state of the five surfaces and asserts each
 * record's text is actually shown to someone. A record nobody renders is
 * unreviewed copy that can drift out of step with the product.
 */
describe("No dead copy (AC-15)", () => {
  /** Text and accessible names rendered across every reachable state. */
  async function renderedEverywhere(): Promise<Set<string>> {
    const seen = new Set<string>();

    const harvest = (container: HTMLElement) => {
      const main = within(container).getByRole("main");
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
        if (value) seen.add(value);
      }
      // Some governed copy is an accessible name, not a text node — the
      // page-geometry figure's description, for instance.
      for (const el of main.querySelectorAll("[aria-label]")) {
        seen.add((el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim());
      }
    };

    for (const { path, heading } of PUBLIC_ROUTES) {
      // Signed out: the signed-out CTA label.
      const out = renderPublic(path, "signed-out");
      await screen.findByRole("heading", { level: 1, name: heading });
      harvest(out.container);
      out.unmount();

      // Signed in: the signed-in CTA label.
      const inn = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });
      await screen.findAllByText("Open your demonstration workspace");
      harvest(inn.container);
      inn.unmount();
    }

    // The contact form's two post-submit states.
    const user = userEvent.setup();

    const empty = renderPublic("/contact", "signed-out");
    await screen.findByRole("heading", { level: 1, name: "Contact" });
    await user.click(screen.getByRole("button", { name: "Preview the acknowledgement" }));
    harvest(empty.container);
    empty.unmount();

    const filled = renderPublic("/contact", "signed-out");
    await screen.findByRole("heading", { level: 1, name: "Contact" });
    await user.type(screen.getByLabelText(/^Message/), "Rendered so the acknowledgement appears.");
    await user.click(screen.getByRole("button", { name: "Preview the acknowledgement" }));
    await screen.findByText("Nothing was sent");
    harvest(filled.container);
    filled.unmount();

    return seen;
  }

  /**
   * The availability vocabulary is the one legitimate exception.
   *
   * §13.2 fixes three values, but only the state the stages are actually in
   * is rendered — today that is `routed` for all seven. The other two labels
   * are not stale copy; they are the vocabulary the honesty test guards, and
   * deleting them would remove the wording an implementer must use when a
   * stage genuinely ships. They are held to a different proof below: each
   * must be wired to a state, and at least one must render.
   */
  const VOCABULARY_PREFIX = "availability-";

  it("wires every availability label to a state, and renders the current one", async () => {
    const rendered = await renderedEverywhere();
    const labels = availabilityLabels();

    const vocabulary = CONTENT_RECORDS.filter((record) =>
      record.id.startsWith(VOCABULARY_PREFIX)
    );
    expect(vocabulary).toHaveLength(3);

    // Reachable through `availabilityLabel()`, i.e. not orphaned text.
    for (const record of vocabulary) {
      expect(labels, `"${record.id}" is not wired to an availability state`).toContain(
        record.text
      );
    }
    // And the state the build is actually in is on screen.
    expect(labels.filter((label) => rendered.has(label)).length).toBeGreaterThan(0);
  });

  it("renders every content record somewhere on a public surface", async () => {
    const rendered = await renderedEverywhere();
    const units = workflowOwningUnits();

    const dead: string[] = [];
    for (const record of CONTENT_RECORDS) {
      if (record.id.startsWith(VOCABULARY_PREFIX)) continue;

      const placeholders = [...record.text.matchAll(/\{(\w+)\}/g)];
      if (placeholders.length === 0) {
        if (!rendered.has(record.text)) dead.push(record.id);
        continue;
      }
      // A template is reachable when each of its expansions is rendered.
      const expansions = expandedContentTexts({ unit: units }).filter((text) =>
        text.startsWith(record.text.slice(0, record.text.indexOf("{")))
      );
      if (expansions.length === 0 || !expansions.every((text) => rendered.has(text))) {
        dead.push(record.id);
      }
    }

    expect(dead, "content records that no surface renders").toEqual([]);
  });

  it("would flag a record that nothing renders", async () => {
    // Guards the mechanism: a record-shaped string absent from every
    // surface must not be treated as reachable.
    const rendered = await renderedEverywhere();
    expect(rendered.has("A sentence no public surface renders.")).toBe(false);
  });
});

describe("No inlined user-visible sentence (AC-14)", () => {
  it("keeps whole prose blocks out of JSX", () => {
    // A cheap source-level check that catches a fully inlined sentence.
    // It cannot see a sentence split by an interpolation, which is what
    // the rendered-text check below exists for.
    const offenders: string[] = [];
    const jsxText = />\s*([A-Z][^<>{}]{25,})</g;

    for (const [path, source] of Object.entries(componentSources)) {
      if (!path.endsWith(".tsx")) continue;
      for (const match of source.matchAll(jsxText)) {
        const text = match[1]!.trim();
        if (text.startsWith("*") || text.startsWith("//")) continue;
        offenders.push(`${path}: ${text}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/*
 * The governance rule the source scan above cannot enforce.
 *
 * Writing `Reserved for {unit}` in JSX puts the words "Reserved for"
 * outside `content.ts` while defeating any source regex that excludes
 * braces — and React renders it as *two* text nodes, "Reserved for " and
 * "UI009". So the check operates on what the browser actually shows: every
 * text node rendered inside <main> must be a complete governed string.
 *
 * A sentence assembled from a fragment plus an interpolation therefore
 * fails by construction, because neither fragment is a whole record. This
 * was verified by temporarily restoring the `Reserved for {unit}` pattern:
 * the suite reported the offender `/features: "Reserved for"` and failed.
 */
describe("Rendered text is governed, including across interpolation (AC-13, AC-14)", () => {
  /**
   * Strings UI001 primitives render themselves. They are UI001's copy, not
   * UI005's, and are listed explicitly rather than pattern-matched so a new
   * one cannot slip in unnoticed.
   */
  const UI001_PRIMITIVE_TEXT = new Set([
    "(required)", // Field's required affordance
    "Information", // InlineMessage's icon label
  ]);

  function governedStrings(): Set<string> {
    const allowed = new Set<string>();
    for (const record of CONTENT_RECORDS) {
      // A record carrying a placeholder is never rendered raw.
      if (!/\{\w+\}/.test(record.text)) allowed.add(record.text);
    }
    for (const text of expandedContentTexts({ unit: workflowOwningUnits() })) {
      allowed.add(text);
    }
    for (const label of availabilityLabels()) allowed.add(label);
    for (const text of UI001_PRIMITIVE_TEXT) allowed.add(text);
    return allowed;
  }

  /** Text nodes a reader is actually told, ignoring presentational ones. */
  function renderedTexts(main: HTMLElement): string[] {
    const readable = main.cloneNode(true) as HTMLElement;
    for (const hidden of readable.querySelectorAll('[aria-hidden="true"]')) {
      hidden.remove();
    }

    const texts: string[] = [];
    const walker = document.createTreeWalker(readable, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      // Whitespace and symbol-only nodes carry no claim.
      if (value === "" || !/\p{L}/u.test(value)) continue;
      texts.push(value);
    }
    return texts;
  }

  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" renders only complete governed strings`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });

      const allowed = governedStrings();
      const offenders = renderedTexts(within(container).getByRole("main")).filter(
        (text) => !allowed.has(text)
      );

      expect(offenders, `ungoverned rendered text on "${path}"`).toEqual([]);
    });
  }

  it("rejects a sentence split by an interpolation", () => {
    // Guards the mechanism itself: the fragment a `Reserved for {unit}`
    // pattern would render is not a governed string, so the check above
    // would report it. If someone widened `governedStrings()` to accept
    // fragments, this assertion fails.
    const allowed = governedStrings();
    expect(allowed.has("Reserved for")).toBe(false);
    expect(allowed.has("Reserved for UI009.")).toBe(true);
  });
});

describe("Tense discipline (AC-34)", () => {
  it("pairs every stage description with an availability label", () => {
    for (const stage of WORKFLOW_STAGES) {
      expect(stage.availability, `${stage.key} has no availability`).toBeTruthy();
      expect(["demonstrated", "routed", "planned"]).toContain(stage.availability);
    }
  });

  it("writes no stage description as a present-tense capability claim", () => {
    for (const stage of workflowStageViews()) {
      expect(
        stage.description,
        `${stage.key} description reads as a live capability`
      ).not.toMatch(/^Pageinator\s+\w+s\b/);
      expect(stage.description).not.toMatch(/\b(we|our) (ingest|generate|validate|export)/i);
    }
  });
});

describe("Sentence length discipline (§19.5)", () => {
  it("keeps every sentence to 30 words or fewer", () => {
    const tooLong: string[] = [];

    for (const record of ALL_RECORDS) {
      for (const sentence of record.text.split(/(?<=[.?!])\s+/)) {
        const words = sentence.trim().split(/\s+/).filter(Boolean);
        if (words.length > 30) tooLong.push(`${record.id}: ${words.length} words`);
      }
    }

    expect(tooLong).toEqual([]);
  });
});
