// What a page prints against the edition now (src/modules/editor/printed.ts, ED-15): the port's signatures are the
// Desk's own (packages/contracts/test/fixtures/printed-sigs.json, which apps/engine-worker/test/test_printed.py checks
// against engine/deskprinted.py), its words are messages.json's, and a page whose story changed needs saving and loses
// its approval. Fictional text only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRESS_MESSAGES, articleSig, articlesStale, withPrinted } from "../../src/modules/editor/printed.ts";
import { approvalOf, releasePage } from "../../src/modules/release/preflight.ts";

const FIXTURE = JSON.parse(
  readFileSync(new URL("../../../../packages/contracts/test/fixtures/printed-sigs.json", import.meta.url), "utf8"),
) as { version: number; cases: { article: Record<string, unknown>; brief: boolean; sig: string }[] };
const DESK = JSON.parse(
  readFileSync(new URL("../../../../tools/desk/engine/messages.json", import.meta.url), "utf8"),
) as Record<string, string>;

const story = { id: "a-0000000001", headline: "काल्पनिक बातमी", body: "पहिला.\n\nदुसरा.", byline: "A. Reporter" };
const record = (articles: Record<string, string>) => ({ v: 3, articles, folio: null, ads: {} });
const live = (...articles: Record<string, unknown>[]) => new Map(articles.map((a) => [String(a["id"]), a]));

describe("a page's printed record", () => {
  it("is signed as the Desk signs it, case by case", () => {
    expect(FIXTURE.version).toBe(3);
    expect(FIXTURE.cases.length).toBeGreaterThan(10);
    for (const c of FIXTURE.cases) expect(articleSig(c.article, c.brief), JSON.stringify(c.article)).toBe(c.sig);
  });

  it("says why in the Desk's own words", () => {
    for (const [code, text] of Object.entries(PRESS_MESSAGES)) expect(DESK[code], code).toBe(text);
  });

  it("is current while the edition holds what it prints; a changed or removed story is said, once per kind", () => {
    const printed = record({ "a-0000000001": articleSig(story, false) });
    expect(articlesStale(printed, live(story))).toEqual([]);
    // white space and line endings that print the same are no change; a word is
    expect(articlesStale(printed, live({ ...story, body: "पहिला.  \r\n\r\nदुसरा. " }))).toEqual([]);
    expect(articlesStale(printed, live({ ...story, body: "पहिला.\n\nतिसरा." })).map((w) => w.code)).toEqual([
      "m.press.changed1",
    ]);
    for (const change of [{ headline: "नवा" }, { byline: "B" }, { photo: { id: "p-1", caption: "c", credit: "" } }])
      expect(articlesStale(printed, live({ ...story, ...change }))[0]?.code).toBe("m.press.changed1");
    expect(articlesStale(printed, live())).toEqual([
      { text: PRESS_MESSAGES["m.press.gone1"], code: "m.press.gone1", params: null },
    ]);
    const two = record({ "a-0000000001": "x".repeat(20), "a-0000000002": "y".repeat(20) });
    expect(articlesStale(two, live(story, { ...story, id: "a-0000000002" }))).toEqual([
      { text: PRESS_MESSAGES["m.press.changedN"].replace("{n}", "2"), code: "m.press.changedN", params: { n: 2 } },
    ]);
  });

  it("matches a short item's record as either kind (the run's plan says which), so a byline it never prints is no change", () => {
    const printed = record({ "a-0000000001": articleSig(story, true) });
    expect(articlesStale(printed, live({ ...story, byline: "Another" }))).toEqual([]);
    expect(articlesStale(printed, live({ ...story, headline: "Another" }))[0]?.code).toBe("m.press.changed1");
  });

  it("fails closed: no record, or one made another way, needs saving", () => {
    expect(articlesStale(null, live(story))[0]?.code).toBe("m.press.olderDesk");
    expect(articlesStale({ v: 2, articles: {} }, live(story))[0]?.code).toBe("m.press.olderRecord");
  });

  it("keeps a page's other reasons, decides the articles' again, and leaves a page not done alone", () => {
    const folio = { text: "folio", code: "m.press.folio", params: null };
    const old = { text: "old", code: "m.press.changed1", params: null };
    const rows = [
      { state: "done", stale: [folio, old], printed: record({ "a-0000000001": articleSig(story, false) }) },
      { state: "failed", stale: [], printed: null },
    ];
    const [done, failed] = withPrinted(rows, live(story));
    expect(done?.stale).toEqual([folio]);
    expect(failed?.stale).toEqual([]);
  });

  it("a page printing older text needs saving and its approval no longer counts", () => {
    const row = {
      page_no: 1,
      role: "front",
      state: "done" as const,
      articles: ["a-0000000001"],
      checked: null,
      edited: false,
      edited_unsaved: false,
      needs_save: false,
      needs_save_why: null,
      pdf_rev: 0,
      pdf_sha256: "a".repeat(64),
      rev_seen: 0,
      layout_problems: [],
      layout_problems_now: [],
      stale: [{ text: "changed", code: "m.press.changed1", params: null }],
      printed: null,
      pdf: null,
      saved_at: null,
      check: null,
    };
    const approval = {
      page_no: 1,
      rev: 0,
      pdf_sha256: "a".repeat(64),
      approved_by: "0190a5d0-0000-7000-8000-000000000001",
      approved_name: "Fictional Chief",
      approved_at: new Date("2027-02-01T10:00:00Z"),
    };
    expect(approvalOf(row, [approval])).toBeNull();
    expect(approvalOf({ ...row, stale: [] }, [approval])).not.toBeNull();
    const state = { run: undefined, approvals: [approval], released: [] } as unknown as Parameters<
      typeof releasePage
    >[0];
    expect(releasePage(state, row).needsSave).toBe(true);
  });
});
