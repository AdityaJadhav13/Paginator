// The page editor's contract (src/editor.ts): the gateway's signing vector, and pressFlags against the Desk's own cases
// for press.press_state (tools/desk/test/test_server.py: test_press_files_are_not_current_with_an_article_on_two_pages…
// and test_overlaps_and_stories_outside_count_from_the_saved_check_and_the_latest_answer).
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EditAnswer,
  EditCall,
  GATEWAY_TEST_VECTOR,
  type PageFlagsInput,
  gatewaySigningText,
  pressFlags,
} from "../src/index.ts";

describe("the gateway's signature", () => {
  it("is HMAC-SHA256 over the signing text, keyed with the secret's bytes", () => {
    const v = GATEWAY_TEST_VECTOR;
    expect(createHash("sha256").update(v.body).digest("hex")).toBe(v.bodySha256);
    const text = gatewaySigningText(v.method.toLowerCase(), v.path, v.time, v.nonce, v.bodySha256);
    expect(text).toBe(`POST\n/v1/call\n1800000000\n${v.nonce}\n${v.bodySha256}`);
    expect(createHmac("sha256", Buffer.from(v.secret, "hex")).update(text).digest("hex")).toBe(v.signature);
  });

  it("reads a call and the answers as the gateway writes them", () => {
    const call = {
      format: "pageinator.edit-call/1",
      org_id: "01890a5d-ac96-774b-bcce-b302099a8057",
      pub_id: "01890a5d-ac96-774b-bcce-b302099a8058",
      run_id: "01890a5d-ac96-774b-bcce-b302099a8059",
      edition_key: "2027-01-02",
      run_key: "r-20270102-101500",
      page: 1,
      cmd: "set",
      base_rev: 2,
      modules: [{ story: "d0123456789", x: 10, y: 20, w: 4, h: 100, locked: false }],
      state: { pages: [{ page: 1, rev: 2, modules: [] }], text: null },
    };
    expect(EditCall.parse(call).cmd).toBe("set");
    expect(() => EditCall.parse({ ...call, page: 17 })).toThrow();
    expect(EditAnswer.parse({ ok: true, result: { rev: 3 }, edits: [], text: null }).ok).toBe(true);
    const refused = { ok: false, status: 409, code: "stale", error: { text: "Changed.", code: null, params: null } };
    expect(EditAnswer.parse(refused).ok).toBe(false);
    expect(() => EditAnswer.parse({ ...refused, status: 500 })).toThrow();
  });
});

const page = (n: number, articles: string[], more: Partial<PageFlagsInput> = {}): PageFlagsInput => ({
  page: n,
  state: "done",
  articles,
  needsSave: false,
  editedUnsaved: false,
  stale: [],
  checkPassed: true,
  edited: false,
  layoutProblems: null,
  layoutProblemsNow: null,
  ...more,
});

describe("pressFlags (press.press_state)", () => {
  it("are current only with a finished run, no article on two pages, every page saved and checked", () => {
    const ok = [page(1, ["a-1"]), page(2, ["a-2"])];
    expect(pressFlags("done", ok)).toEqual({
      filesCurrent: true,
      pagesToSave: [],
      pagesFailingCheck: [],
      pagesWithRepeats: [],
      pagesWithOverlaps: [],
    });
    const twice = pressFlags("done", [page(1, ["a-1", "a-2"]), page(2, ["a-2"]), page(3, ["a-3"])]);
    expect([twice.filesCurrent, twice.pagesWithRepeats]).toEqual([false, [1, 2]]);
    expect(pressFlags("cancelled", ok).filesCurrent).toBe(false);
    const unsaved = pressFlags("done", [page(1, ["a-1"]), page(2, ["a-2"], { editedUnsaved: true })]);
    expect([unsaved.filesCurrent, unsaved.pagesToSave]).toEqual([false, [2]]);
    const failing = pressFlags("done", [page(1, ["a-1"]), page(2, [], { checkPassed: false })]);
    expect([failing.filesCurrent, failing.pagesFailingCheck]).toEqual([false, [2]]);
    expect(pressFlags("done", [page(1, []), page(2, [], { needsSave: true })]).pagesToSave).toEqual([2]);
    expect(pressFlags("done", [page(1, []), page(2, [], { stale: [{ text: "x" }] })]).pagesToSave).toEqual([2]);
    expect(pressFlags("done", [page(1, []), page(2, [], { state: "failed" })]).filesCurrent).toBe(false);
    expect(pressFlags("done", []).filesCurrent).toBe(false);
  });

  it("count overlaps and stories outside from the saved check and the latest answer", () => {
    const cases: [Partial<PageFlagsInput>, boolean][] = [
      [{ layoutProblems: ["outside"] }, false],
      [{ layoutProblemsNow: ["overlap"] }, false],
      [{ layoutProblems: "x" as unknown as string[] }, false], // not a list: fails closed
      [{ layoutProblems: [], layoutProblemsNow: [] }, true],
      [{ layoutProblemsNow: ["unreadable"] }, false], // fails closed (press.py itself counts only overlap, outside)
      [{ edited: true }, true],
      [{}, true],
    ];
    for (const [more, current] of cases) {
      const flags = pressFlags("done", [page(1, ["a-0000000001"]), page(2, ["a-0000000002"], more)]);
      expect([flags.filesCurrent, flags.pagesWithOverlaps], JSON.stringify(more)).toEqual([
        current,
        current ? [] : [2],
      ]);
    }
  });
});
