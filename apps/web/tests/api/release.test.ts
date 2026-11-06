/**
 * The real release service over a recording fetch (L2.5): each call's method, path and body as the contract's header
 * lists them, the release's and "Mark as sent"'s Idempotency-Keys and the longer wait, answers read with the contract's
 * schemas (a wrong shape is unexpected_answer), a refusal passed on with its code, and "Download all" as a Blob with its
 * file name. Fictional.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client.ts";
import { createApiReleaseService, RELEASE_TIMEOUT_MS } from "../../src/api/release-service.ts";
import { fakeFetch, json } from "./fake-fetch.ts";

const O = { orgId: "o", pubId: "p" };
const BASE = "/api/v1/orgs/o/pubs/p";
const ID = "01900000-0000-7000-8000-000000000001";
const AT = "2026-10-24T10:00:00.000+05:30";
const SHA = "0".repeat(64);
const PERSON = { id: ID, name: "Fictional Chief" };
const PAGE = {
  runId: ID,
  page: 1,
  role: "front",
  rev: 0,
  pdfSha256: SHA,
  check: { passed: true, fails: 0, warnings: 1 },
  needsSave: false,
  approval: null,
  released: null,
};
const FILE = { page: 1, name: "2026-10-24_P01.pdf", rev: 0, sha256: SHA, bytes: 10, replaces: null };
const RELEASE = {
  id: ID,
  editionId: ID,
  runId: ID,
  number: 1,
  kind: "release",
  approvedBy: PERSON,
  approvedAt: AT,
  note: null,
  files: [FILE],
  archive: { verifiedAt: AT, retainUntil: AT, manifestSha256: SHA },
  deliveries: [],
  printProfile: null,
};
const VIEW = {
  editionId: ID,
  runId: ID,
  preflight: { items: [], passed: true },
  pages: [PAGE],
  candidate: null,
  releases: [RELEASE],
  needsPressTest: false,
  pressTest: null,
};

afterEach(() => vi.useRealTimers());

const path = (url: string) => new URL(url, "http://x").pathname;

describe("the release service", () => {
  it("calls each route with its method and body, and reads each answer", async () => {
    const answers = [
      VIEW,
      PAGE,
      PAGE,
      RELEASE,
      { url: "https://store.example/f", expiresAt: AT },
      RELEASE,
      RELEASE,
      { checkedAt: AT, files: [{ name: FILE.name, sha256: SHA, ok: true }], ok: true },
      { pageSha256: SHA, acceptedOn: "2026-10-20", note: null, recordedBy: PERSON, recordedAt: AT },
    ];
    const { fetch, calls } = fakeFetch(() => json(200, answers.shift()));
    const release = createApiReleaseService(createApiClient({ fetch }));
    const results = [
      await release.get({ ...O, editionId: "e" }),
      await release.approvePage({ ...O, runId: "r", page: 3, rev: 2, pdfSha256: SHA }),
      await release.unlockPage({ ...O, runId: "r", page: 3 }),
      await release.create({ ...O, editionId: "e", files: [{ page: 1, sha256: SHA }], note: "n", idempotencyKey: "k" }),
      await release.fileLink({ ...O, releaseId: ID, name: FILE.name }),
      await release.markSent({ ...O, releaseId: ID, idempotencyKey: "s" }),
      await release.confirm({ ...O, releaseId: ID, deliveryId: "d", pressPerson: "Fictional Press", at: AT }),
      await release.verify({ ...O, releaseId: ID }),
      await release.setPressTest({ ...O, pageSha256: SHA, acceptedOn: "2026-10-20", note: "t" }),
    ];
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls.map((c) => [c.method, path(c.url), c.body])).toEqual([
      ["GET", `${BASE}/editions/e/release`, undefined],
      ["POST", `${BASE}/runs/r/pages/3/approve`, { rev: 2, pdfSha256: SHA }],
      ["POST", `${BASE}/runs/r/pages/3/unlock`, {}],
      ["POST", `${BASE}/editions/e/releases`, { files: [{ page: 1, sha256: SHA }], note: "n" }],
      ["GET", `${BASE}/releases/${ID}/files/${FILE.name}`, undefined],
      ["POST", `${BASE}/releases/${ID}/deliveries`, {}],
      ["POST", `${BASE}/releases/${ID}/deliveries/d/confirm`, { pressPerson: "Fictional Press", at: AT }],
      ["POST", `${BASE}/releases/${ID}/verify`, {}],
      ["PUT", `${BASE}/press-test`, { pageSha256: SHA, acceptedOn: "2026-10-20", note: "t" }],
    ]);
    expect(calls[3]!.headers.get("Idempotency-Key")).toBe("k");
    expect(calls[5]!.headers.get("Idempotency-Key")).toBe("s");
  });

  it("downloads all: POST {} answered by the ZIP as a Blob, with its file name; no name or a refusal is not a file", async () => {
    const zip = (disposition?: string) =>
      new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "application/zip", ...(disposition ? { "Content-Disposition": disposition } : {}) },
      });
    const answers = [
      zip('attachment; filename="2026-10-24_release-1.zip"'),
      zip(),
      zip('attachment; filename="../x.pdf"'),
      json(404, { error: { code: "not_found", message: "Nothing here.", requestId: "q" } }),
    ];
    const { fetch, calls } = fakeFetch(() => answers.shift()!);
    const release = createApiReleaseService(createApiClient({ fetch }));
    const got = await release.downloadAll({ ...O, releaseId: ID });
    expect(calls[0]).toMatchObject({ method: "POST", body: {} });
    expect(path(calls[0]!.url)).toBe(`${BASE}/releases/${ID}/zip`);
    expect(calls[0]!.headers.get("Accept")).toBe("application/zip, application/json");
    expect(calls[0]!.headers.get("Idempotency-Key")).toBeNull();
    if (!got.ok) throw new Error("no ZIP");
    expect([got.value.filename, got.value.file.size]).toEqual(["2026-10-24_release-1.zip", 4]);
    for (let n = 0; n < 2; n += 1) {
      expect(await release.downloadAll({ ...O, releaseId: ID })).toMatchObject({
        ok: false,
        error: { code: "unexpected_answer" },
      });
    }
    expect(await release.downloadAll({ ...O, releaseId: ID })).toMatchObject({
      ok: false,
      error: { status: 404, code: "not_found" },
    });
  });

  it("waits for the archive past the client's own time limit", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const release = createApiReleaseService(createApiClient({ fetch: hanging as typeof fetch, timeoutMs: 30_000 }));
    const pending = release.create({ ...O, editionId: "e", files: [{ page: 1, sha256: SHA }], idempotencyKey: "k" });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(RELEASE_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("calls a wrong shape unexpected, and passes a refusal on with its code", async () => {
    const answers = [
      json(200, { ...VIEW, pages: [{ ...PAGE, pdfSha256: "not a hash" }] }),
      json(409, { error: { code: "approval_stale", message: "Changed.", current: null, requestId: "q" } }),
      json(502, { error: { code: "archive_failed", message: "Archive.", requestId: "q" } }),
    ];
    const release = createApiReleaseService(createApiClient({ fetch: fakeFetch(() => answers.shift()!).fetch }));
    expect(await release.get({ ...O, editionId: "e" })).toMatchObject({ ok: false, error: { code: "unexpected_answer" } });
    const input = { ...O, editionId: "e", files: [{ page: 1, sha256: SHA }], idempotencyKey: "k" };
    expect(await release.create(input)).toMatchObject({ ok: false, error: { status: 409, code: "approval_stale" } });
    expect(await release.create(input)).toMatchObject({ ok: false, error: { status: 502, code: "archive_failed" } });
  });
});
