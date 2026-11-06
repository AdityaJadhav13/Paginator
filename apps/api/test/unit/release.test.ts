// The Release tab's rules (src/modules/release/preflight.ts): when an approval counts, each preflight item, the
// candidate (first release, correction, nothing), the press file names, and the posted files' match; "Download all"'s
// ZIP (zip.ts): SHA256SUMS then the files, stored, and cut off before its end at bytes that are not the ones released.
// Fictional rows.
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { PRESS_FILE, pressFileName } from "@pageinator/contracts";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ArchiveMismatch, writeReleaseZip } from "../../src/modules/release/zip.ts";
import type { ApprovalRow, ReleasePageRow } from "../../src/db/release.ts";
import {
  type ReleaseState,
  approvalOf,
  candidate,
  needsPressTest,
  preflight,
  releasePage,
  sameFiles,
} from "../../src/modules/release/preflight.ts";

const sha = (c: string) => c.repeat(64);
const AT = new Date("2027-02-01T10:00:00Z");

function page(n: number, over: Partial<ReleasePageRow> = {}): ReleasePageRow {
  return {
    page_no: n,
    role: n === 1 ? "front" : "inside",
    state: "done",
    articles: [`a-000000000${n}`],
    checked: { passed: true, fails: 0, warnings: 0 },
    edited: false,
    edited_unsaved: false,
    needs_save: false,
    needs_save_why: null,
    pdf_rev: 0,
    pdf_sha256: sha(String(n)),
    rev_seen: 0,
    layout_problems: [],
    layout_problems_now: [],
    stale: [],
    pdf: { key: `k${n}`, version_id: "v", sha256: sha(String(n)), bytes: 1000 + n },
    saved_at: null,
    check: { passed: true, fails: 0, warnings: 1 },
    ...over,
  };
}

const approval = (n: number, over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  page_no: n,
  rev: 0,
  pdf_sha256: sha(String(n)),
  approved_by: "01900000-0000-7000-8000-000000000001",
  approved_name: "Chief (fictional)",
  approved_at: AT,
  ...over,
});

function state(over: Partial<ReleaseState> = {}): ReleaseState {
  const pages = [page(1), page(2)];
  return {
    edition: { id: "e", desk_key: "2027-02-01", issue: "12", back_page_ads: false, folio_changed_at: null },
    run: {
      id: "r",
      edition_id: "e",
      desk_key: "r-20270201-101500",
      state: "done",
      checker_sha256: sha("c"),
      not_placed: [],
      created_at: AT,
      ad_rasters: {},
    },
    pages,
    approvals: [approval(1), approval(2)],
    released: [],
    slots: [],
    adRasters: {},
    printsPhoto: false,
    hasArtwork: false,
    notPlaced: [],
    pressTest: null,
    ...over,
  };
}

const failed = (s: ReleaseState) =>
  preflight(s)
    .items.filter((i) => i.state === "failed")
    .map((i) => [i.check, i.pages]);

describe("an approval", () => {
  it("counts only on the page's own revision and bytes, with nothing unsaved", () => {
    expect(approvalOf(page(1), [approval(1)])).toEqual({
      by: { id: approval(1).approved_by, name: "Chief (fictional)" },
      at: AT.toISOString(),
      rev: 0,
      pdfSha256: sha("1"),
    });
    expect(approvalOf(page(1, { pdf_rev: 1 }), [approval(1)])).toBeNull();
    expect(approvalOf(page(1, { pdf_sha256: sha("9") }), [approval(1)])).toBeNull();
    expect(approvalOf(page(1, { needs_save: true }), [approval(1)])).toBeNull();
    expect(approvalOf(page(1, { edited_unsaved: true }), [approval(1)])).toBeNull();
    expect(approvalOf(page(1), [approval(2)])).toBeNull();
  });
});

describe("the preflight", () => {
  it("passes an edition whose every page is done, checked, saved, placed and approved", () => {
    const s = state();
    expect(failed(s)).toEqual([]);
    expect(preflight(s).passed).toBe(true);
    expect(preflight(s).items.map((i) => i.check)).toEqual([
      "laid_out",
      "pdf_check",
      "saved",
      "placement",
      "folio",
      "ad_artwork",
      "approved",
      "press_test",
      "not_placed",
    ]);
  });

  it("fails everything it can without a done run", () => {
    expect(failed(state({ run: undefined, pages: [] }))).toEqual([
      ["laid_out", []],
      ["pdf_check", []],
      ["approved", []],
    ]);
  });

  it("names the pages and slots of each failing check", () => {
    const s = state({
      edition: { id: "e", desk_key: "2027-02-01", issue: " ", back_page_ads: true, folio_changed_at: null },
      pages: [
        page(1, { check: null, needs_save: true }),
        page(2, { check: { passed: false, fails: 2, warnings: 0 }, layout_problems_now: ["overlap"] }),
        page(3, { articles: ["a-0000000001"] }),
        page(4, { state: "failed" }),
      ],
      approvals: [approval(3)],
      slots: [
        { slot: "back-1", page: 4, wMm: 100, hMm: 50, state: "ready", assetId: null, problem: null },
        { slot: "back-2", page: 4, wMm: 100, hMm: 50, state: "empty", assetId: null, problem: null },
      ],
      hasArtwork: true,
    });
    expect(failed(s)).toEqual([
      ["laid_out", [4]],
      ["pdf_check", [1, 2]],
      ["saved", [1]],
      ["placement", [1, 2, 3]],
      ["folio", [1]],
      ["ad_artwork", [4]],
      ["approved", [1, 2, 4]],
      ["press_test", []],
    ]);
    expect(preflight(s).items.find((i) => i.check === "ad_artwork")?.slots).toEqual(["back-2"]);
  });

  it("needs the press test only for a photo or an ad, and then only until it is recorded", () => {
    expect(needsPressTest(state())).toBe(false);
    expect(failed(state({ printsPhoto: true }))).toEqual([["press_test", []]]);
    expect(failed(state({ hasArtwork: true }))).toEqual([["press_test", []]]);
    const test = {
      pageSha256: sha("t"),
      acceptedOn: "2027-01-20",
      note: null,
      recordedBy: { id: "x", name: "O" },
      recordedAt: AT.toISOString(),
    };
    expect(failed(state({ printsPhoto: true, pressTest: test }))).toEqual([]);
  });

  it("warns of stories left out, never stopping a release", () => {
    const left = [{ storyId: null, deskKey: "a-0000000009", headline: null, reason: null }];
    const s = state({ notPlaced: left });
    expect(preflight(s).items.at(-1)).toMatchObject({ check: "not_placed", state: "warning", stories: left });
    expect(preflight(s).passed).toBe(true);
  });

  it("fails artwork the run's pages do not print: set or replaced after the run, or a run that kept none", () => {
    const ready = { page: 4, wMm: 100, hMm: 50, state: "ready" as const, assetId: null, problem: null };
    const base = state({
      edition: { id: "e", desk_key: "2027-02-01", issue: "12", back_page_ads: true, folio_changed_at: null },
      slots: [
        { ...ready, slot: "back-1" },
        { ...ready, slot: "back-2" },
      ],
      adRasters: { "back-1": sha("a"), "back-2": sha("b") },
      pressTest: {
        pageSha256: sha("t"),
        acceptedOn: "2027-01-20",
        note: null,
        recordedBy: { id: "x", name: "O" },
        recordedAt: AT.toISOString(),
      },
      hasArtwork: true,
    });
    const run = base.run ?? state().run;
    if (!run) throw new Error("no run");
    const ads = (s: ReleaseState) => preflight(s).items.find((i) => i.check === "ad_artwork");
    expect(ads({ ...base, run: { ...run, ad_rasters: { "back-1": sha("a"), "back-2": sha("b") } } })).toMatchObject({
      state: "passed",
      printsOld: false,
    });
    expect(ads({ ...base, run: { ...run, ad_rasters: { "back-1": sha("a"), "back-2": sha("0") } } })).toMatchObject({
      state: "failed",
      slots: ["back-2"],
      printsOld: true,
    });
    expect(ads({ ...base, run: { ...run, ad_rasters: null } })).toMatchObject({
      slots: ["back-1", "back-2"],
      printsOld: true,
    });
  });

  it("fails a folio changed after page 1's PDF was made (the run's, or its last save's)", () => {
    const later = new Date(AT.getTime() + 60_000);
    const edition = { id: "e", desk_key: "2027-02-01", issue: "12", back_page_ads: false, folio_changed_at: later };
    const folio = (s: ReleaseState) => preflight(s).items.find((i) => i.check === "folio");
    expect(folio(state({ edition }))).toMatchObject({ state: "failed", pages: [1], printsOld: true });
    const saved = state({ edition, pages: [page(1, { saved_at: new Date(later.getTime() + 1) }), page(2)] });
    expect(folio(saved)).toMatchObject({ state: "passed", printsOld: false });
    const before = { ...edition, folio_changed_at: new Date(AT.getTime() - 1) };
    expect(folio(state({ edition: before }))).toMatchObject({ state: "passed" });
  });

  it("ignores ad slots when the edition has no back-page ads", () => {
    const slots = [{ slot: "back-1", page: 4, wMm: 1, hMm: 1, state: "empty" as const, assetId: null, problem: null }];
    expect(failed(state({ slots }))).toEqual([]);
  });
});

describe("the candidate", () => {
  it("is every page in the first release", () => {
    expect(candidate(state())).toEqual({
      kind: "release",
      runId: "r",
      files: [
        { page: 1, name: "2027-02-01_P01.pdf", rev: 0, sha256: sha("1"), bytes: 1001, replaces: null },
        { page: 2, name: "2027-02-01_P02.pdf", rev: 0, sha256: sha("2"), bytes: 1002, replaces: null },
      ],
    });
  });

  it("is only the changed pages afterwards, each named for its n-th release", () => {
    const released = [
      { page_no: 1, name: "2027-02-01_P01.pdf", sha256: sha("1"), times: 1 },
      { page_no: 2, name: "2027-02-01_P02_v2.pdf", sha256: sha("x"), times: 2 },
    ];
    const s = state({ released });
    expect(candidate(s)).toEqual({
      kind: "correction",
      runId: "r",
      files: [
        {
          page: 2,
          name: "2027-02-01_P02_v3.pdf",
          rev: 0,
          sha256: sha("2"),
          bytes: 1002,
          replaces: "2027-02-01_P02_v2.pdf",
        },
      ],
    });
    expect(releasePage(s, page(2)).released).toEqual({
      name: "2027-02-01_P02_v2.pdf",
      sha256: sha("x"),
      changed: true,
    });
    expect(releasePage(s, page(1)).released?.changed).toBe(false);
  });

  it("is nothing when no page changed, or without a run", () => {
    const released = [1, 2].map((n) => ({
      page_no: n,
      name: pressFileName("2027-02-01", n, 1),
      sha256: sha(String(n)),
      times: 1,
    }));
    expect(candidate(state({ released }))).toBeNull();
    expect(candidate(state({ run: undefined }))).toBeNull();
  });

  it("takes exactly its files, in any order", () => {
    const want = candidate(state());
    expect(
      sameFiles(
        [
          { page: 2, sha256: sha("2") },
          { page: 1, sha256: sha("1") },
        ],
        want,
      ),
    ).toBe(true);
    expect(sameFiles([{ page: 1, sha256: sha("1") }], want)).toBe(false);
    expect(
      sameFiles(
        [
          { page: 1, sha256: sha("1") },
          { page: 2, sha256: sha("9") },
        ],
        want,
      ),
    ).toBe(false);
    expect(
      sameFiles(
        [
          { page: 1, sha256: sha("1") },
          { page: 1, sha256: sha("1") },
        ],
        want,
      ),
    ).toBe(false);
    expect(sameFiles([{ page: 1, sha256: sha("1") }], null)).toBe(false);
  });
});

describe("press file names", () => {
  it("are the edition key, the page and the version after the first", () => {
    expect(pressFileName("2027-02-01", 3, 1)).toBe("2027-02-01_P03.pdf");
    expect(pressFileName("2027-02-01-2", 16, 2)).toBe("2027-02-01-2_P16_v2.pdf");
    for (const name of ["2027-02-01_P03.pdf", "2027-02-01-2_P16_v2.pdf"]) expect(PRESS_FILE.test(name)).toBe(true);
  });
});

describe("the object store's time limit", () => {
  it("answers in time, or fails once the limit has passed", async () => {
    const { within } = await import("../../src/modules/release/routes.ts");
    await expect(within(Promise.resolve(7), 50)).resolves.toBe(7);
    await expect(within(new Promise(() => undefined), 20)).rejects.toThrow("more than 20 ms");
  });
});

describe("Download all's ZIP", () => {
  const bytesOf = (text: string) => new TextEncoder().encode(text);
  const hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const pdfs = { "2027-02-01_P01.pdf": bytesOf("%PDF-1.4 fictional 1"), "2027-02-01_P02.pdf": bytesOf("%PDF-1.4 two") };
  /** Reads the key's bytes in two chunks (as a store streams them). */
  const read = (stored: Record<string, Uint8Array>) => async (key: string) =>
    (async function* () {
      const all = stored[key] ?? new Uint8Array(0);
      yield all.slice(0, 5);
      yield all.slice(5);
    })();
  async function zipOf(stored: Record<string, Uint8Array>, files = Object.entries(pdfs)) {
    const out = new PassThrough();
    const got: Buffer[] = [];
    out.on("data", (chunk: Buffer) => got.push(chunk));
    const list = files.map(([name, body]) => ({ name, sha256: hex(body), key: name, version: "v1" }));
    let error: unknown = null;
    await writeReleaseZip(out, list, read(stored), new Date("2027-02-01T10:00:00Z")).catch((e) => (error = e));
    await new Promise((resolve) => setImmediate(resolve));
    return { bytes: Buffer.concat(got), error };
  }

  it("holds SHA256SUMS first, then each file's exact bytes, every one stored", async () => {
    const { bytes, error } = await zipOf(pdfs);
    expect(error).toBeNull();
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(["SHA256SUMS", "2027-02-01_P01.pdf", "2027-02-01_P02.pdf"]);
    expect(new TextDecoder().decode(files["SHA256SUMS"])).toBe(
      Object.entries(pdfs)
        .map(([name, body]) => `${hex(body)}  ${name}\n`)
        .join(""),
    );
    for (const [name, body] of Object.entries(pdfs)) {
      expect(files[name]).toEqual(body);
      expect(bytes.includes(Buffer.from(body))).toBe(true); // stored: the bytes as they are
    }
  });

  it("throws at a file whose bytes are not the ones released, and never writes the end of central directory", async () => {
    const { bytes, error } = await zipOf({ ...pdfs, "2027-02-01_P02.pdf": bytesOf("%PDF-1.4 other") });
    expect(error).toBeInstanceOf(ArchiveMismatch);
    expect(bytes.includes(Buffer.from("PK\x05\x06", "latin1"))).toBe(false);
    expect(bytes.includes(Buffer.from("PK\x03\x04", "latin1"))).toBe(true); // what was sent before it
  });
});
