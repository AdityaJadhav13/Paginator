/**
 * The catalogue's meta-test (docs/product/10-l2-newsroom-plan.md §10, PR 12): the same keys in English and Marathi,
 * no empty value, the same `{name}` placeholders in both, every key the code uses exists, the glossary seeds are
 * 02 §3.9's own words, every API error code has its text, and the Marathi review list accounts for every string.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ERROR_CODES, PERMISSION_NAMES } from "@pageinator/contracts";
import {
  CATALOGUE_KEYS,
  CATALOGUES,
  LANGUAGES,
  REVIEW,
  REVIEW_NOTES,
  REVIEWED,
  formatMessage,
  isCatalogueKey,
  placeholdersOf,
  translator,
  type CatalogueKey,
} from "../../src/i18n/index.ts";
import { CONTENT_RECORDS } from "../../src/features/public/content.ts";

const DEVANAGARI = /[ऀ-ॿ]/;

/** Every code the plan's error table names (§5.1), with those the API answers with today. */
const PLAN_ERROR_CODES = [
  "invalid_request",
  "signed_out",
  "not_allowed",
  "two_step_required",
  "bad_origin",
  "not_found",
  "story_changed",
  "invalid_transition",
  "edition_exists",
  "file_too_large",
  "request_too_large",
  "not_json",
  "not_a_picture",
  "slow_down",
  "server_error",
  "idempotency_key_reused",
  "request_in_progress",
];

// The test double (src/mocks) renders no text: its operation names ("team.invite") only look like keys.
const sourceFiles = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/i18n/en.ts", "!/src/i18n/mr.ts", "!/src/i18n/screens/**", "!/src/mocks/**"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** String literals in the source that are shaped like catalogue keys. */
function keyLiterals(): Map<string, string> {
  const found = new Map<string, string>();
  const prefixes = [...new Set(CATALOGUE_KEYS.map((key) => key.split(".")[0]))].join("|");
  const literal = new RegExp(`["'\`]((?:${prefixes})\\.[A-Za-z0-9_.]+)["'\`]`, "g");
  for (const [path, source] of Object.entries(sourceFiles)) {
    for (const match of source.matchAll(literal)) {
      // not a file name, nor a permission's name ("brand.edit", "archive.view" share a screen's key prefix)
      if (!/\.(css|ts|tsx|js|json)$/.test(match[1]!) && !PERMISSION_NAMES.includes(match[1] as never))
        found.set(match[1]!, path);
    }
  }
  return found;
}

describe("Key parity", () => {
  it("has the same keys in English and Marathi", () => {
    expect(Object.keys(CATALOGUES.mr).sort()).toEqual(Object.keys(CATALOGUES.en).sort());
    expect(CATALOGUE_KEYS.length).toBeGreaterThan(200);
  });

  it("has no empty or blank value in either language", () => {
    for (const language of LANGUAGES) {
      for (const key of CATALOGUE_KEYS) {
        expect(CATALOGUES[language][key].trim(), `${language} ${key}`).not.toBe("");
      }
    }
  });

  it("has the same placeholders in both languages", () => {
    for (const key of CATALOGUE_KEYS) {
      expect(placeholdersOf(CATALOGUES.mr[key]).sort(), key).toEqual(placeholdersOf(CATALOGUES.en[key]).sort());
    }
  });

  it("writes every Marathi string in Devanagari, and no English one", () => {
    for (const key of CATALOGUE_KEYS) {
      expect(CATALOGUES.mr[key], `mr ${key}`).toMatch(DEVANAGARI);
      expect(CATALOGUES.en[key], `en ${key}`).not.toMatch(DEVANAGARI);
    }
  });

  it("uses only placeholders that are whole words in braces, never left unformatted", () => {
    for (const language of LANGUAGES) {
      for (const key of CATALOGUE_KEYS) {
        const text = CATALOGUES[language][key];
        const params = Object.fromEntries(placeholdersOf(text).map((name) => [name, "X"]));
        expect(formatMessage(text, params), `${language} ${key}`).not.toMatch(/[{}]/);
      }
    }
  });
});

describe("Keys the code uses", () => {
  it("exist in the catalogue", () => {
    const missing = [...keyLiterals()].filter(([key]) => !isCatalogueKey(key)).map(([key, path]) => `${path}: ${key}`);
    expect(missing).toEqual([]);
  });

  it("are every key but the glossary seeds, the error codes and the Desk's message codes (no dead strings)", () => {
    const used = new Set(keyLiterals().keys());
    // the Desk's messages (m.…) are said by the code a DeskText carries (features/layout/desk-text.tsx), as error.… by
    // the API's code
    const unused = CATALOGUE_KEYS.filter(
      (key) => !used.has(key) && !key.startsWith("glossary.") && !key.startsWith("error.") && !key.startsWith("m."),
    );
    expect(unused).toEqual([]);
  });

  it("has the text for every error code the API answers with, and those the plan names", () => {
    for (const code of [...ERROR_CODES, ...PLAN_ERROR_CODES]) {
      expect(isCatalogueKey(`error.${code}`), code).toBe(true);
    }
  });
});

describe("Glossary seeds (02 §3.9)", () => {
  /** The §3.9 table, as (English, Marathi) pairs: "Page / Pages" is two, "Zoom in / out" is "Zoom in" and "Zoom out". */
  function glossaryFromSpec(): Array<[string, string]> {
    const doc = readFileSync(resolve(__dirname, "../../../../docs/product/02-design-system.md"), "utf8");
    const section = doc.slice(doc.indexOf("### 3.9"));
    const rows = section
      .split("\n")
      .filter((line) => line.startsWith("|") && !line.includes("---"))
      .slice(1)
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    const expand = (cell: string): string[] => {
      const parts = cell.split(" / ");
      const first = parts[0]!.split(" ");
      return parts.map((part, index) => {
        if (index === 0) return part;
        const words = part.split(" ");
        return words.length < first.length
          ? [...first.slice(0, first.length - words.length), ...words].join(" ")
          : part;
      });
    };
    const pairs: Array<[string, string]> = [];
    for (const row of rows) {
      for (const [english, marathi] of [
        [row[0], row[1]],
        [row[2], row[3]],
      ] as Array<[string, string]>) {
        const englishParts = expand(english.replace(/ \([^)]*\)$/, ""));
        const marathiParts = expand(marathi);
        englishParts.forEach((part, index) => pairs.push([part, marathiParts[index] ?? marathiParts[0]!]));
      }
    }
    return pairs;
  }

  it("holds every pair of the spec's table, in its own words", () => {
    const spec = glossaryFromSpec();
    const seeds = CATALOGUE_KEYS.filter((key) => key.startsWith("glossary.")).map((key) => [
      CATALOGUES.en[key].replace(/\{\w+\}/g, "N"),
      CATALOGUES.mr[key].replace(/\{\w+\}/g, "N"),
    ]);
    expect(spec.length).toBe(70);
    expect(seeds.length).toBe(spec.length);
    for (const pair of spec) {
      expect(seeds, `${pair[0]} / ${pair[1]}`).toContainEqual(pair);
    }
  });
});

describe("The Marathi review list", () => {
  it("holds every Marathi string that no native editor has approved, which today is all of them", () => {
    expect(Object.keys(REVIEWED)).toEqual([]);
    // the catalogue's strings, then every public website record (src/features/public/content.ts)
    expect(REVIEW.map((item) => item.key)).toEqual([
      ...CATALOGUE_KEYS,
      ...CONTENT_RECORDS.map((record) => `public:${record.id}`),
    ]);
    expect(REVIEW.filter((item) => item.source === "glossary")).toHaveLength(70);
    for (const item of REVIEW) {
      if (item.source === "public") {
        const record = CONTENT_RECORDS.find((candidate) => `public:${candidate.id}` === item.key);
        expect(item.marathi).toBe(record?.mr);
        expect(item.english).toBe(record?.en);
        continue;
      }
      const key = item.key as CatalogueKey;
      expect(item.marathi).toBe(CATALOGUES.mr[key]);
      expect(item.english).toBe(CATALOGUES.en[key]);
    }
  });

  it("carries the open question on the Marathi term for a release on its three strings", () => {
    const noted = REVIEW.filter((item) => item.note).map((item) => item.key);
    expect(noted.filter((key) => key.includes("release")).sort()).toEqual([
      "grant.release_approve",
      "invalid.release",
      "nav.release",
    ]);
    // the two invite buttons that read the same in Marathi, as the owner chose
    expect(noted.filter((key) => key.startsWith("team.invite")).sort()).toEqual(["team.invite", "team.invite.submit"]);
    expect(Object.keys(REVIEW_NOTES).every((key) => isCatalogueKey(key))).toBe(true);
    // the fictional Marathi example carries a note for the reviewer; no other public record does
    const publicNotes = REVIEW.filter((item) => item.source === "public" && item.note).map((item) => item.key);
    expect(publicNotes).toEqual(
      CONTENT_RECORDS.filter((record) => record.kind === "specimen").map((record) => `public:${record.id}`),
    );
  });

  it("keeps the second Marathi pass's fixes (L2-G)", () => {
    const mr = CATALOGUES.mr;
    // प्रकाशन is Publication: a release is not one
    expect(mr["grant.release_approve"]).not.toContain("प्रकाशन");
    // nor anywhere a release is named (L2.5): it is "प्रकाशित आवृत्ती", like the tab (owner to confirm the word)
    const release = Object.entries(mr).filter(([key]) => /^(editionRelease\.|auditLog\.action\.release\.)/.test(key));
    expect(release.filter(([, text]) => text.includes("प्रकाशन"))).toEqual([]);
    expect(mr["security.devices.signOut"]).toBe("प्रवेश बंद करा: {device}");
    expect(mr["security.devices.signedOut"]).toBe("{device}: प्रवेश बंद केला आहे.");
    expect(mr["team.grants.hint"]).toBe("हे अधिकार फक्त संपादकांनाच देता येतात.");
    expect(mr["team.pending.expires"]).toBe("मुदत संपेल: {date}");
    // मुखपृष्ठ is a newspaper's front page
    expect(mr["nav.home"]).toBe("सुरुवात");
    // one verb for inviting, and मधील for roles on a publication
    for (const key of ["team.invite", "team.invite.title", "team.invite.submit"] as const) {
      expect(mr[key]).toContain("निमंत्रण पाठवा");
      expect(mr[key]).not.toContain("निमंत्रित करा");
    }
    expect(mr["team.publication.legend"]).toBe("{publication} मधील भूमिका");
    expect(mr["orgHome.publicationRoles"]).toBe("{publication} मधील भूमिका: {roles}");
  });

  it("keeps an approval only while the approved text is unchanged", () => {
    for (const [key, review] of Object.entries(REVIEWED)) {
      expect(isCatalogueKey(key) || CONTENT_RECORDS.some((record) => key === `public:${record.id}`)).toBe(true);
      expect(review?.by.trim()).not.toBe("");
      expect(review?.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("Formatting", () => {
  it("replaces each placeholder with its value, in both languages", () => {
    expect(translator("en")("invite.join", { organization: "The Sahyadri Daily" })).toBe("Join The Sahyadri Daily");
    expect(translator("mr")("invite.join", { organization: "द सह्याद्री डेली" })).toBe(
      "द सह्याद्री डेली मध्ये सामील व्हा",
    );
    expect(translator("en")("verify.wait", { seconds: 42 })).toBe("You can send it again in 42 seconds.");
  });

  it("refuses to leave a placeholder without a value", () => {
    expect(() => formatMessage("Join {organization}", {})).toThrow(/organization/);
  });
});
