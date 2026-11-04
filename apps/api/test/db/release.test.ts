// Release on the API's side (docs/product/10-l2-newsroom-plan.md §1 L2.5; migration 2026_12_04_0001), on a migrated
// clone, with the run's object store (the work bucket) and its archive bucket (Object Lock, made at creation:
// test/db/storage-run.ts). A fictional edition's done layout run is made as the superuser, its four page PDFs written
// to the work bucket and checked (app.pdf_check). The edit gateway is a small stub (open and set only) so that the page
// editor's lock on an approved page can be seen. Page approval and unlocking, the editor's 409 page_approved, the
// preflight's refusals (approvals, the G2 press test), a release archived under Object Lock and read back, the archived
// version refusing a delete without the governance bypass, the download link, "Mark as sent", the confirmation (once),
// the archive check, a late correction (_v2), a copy that does not match (502, nothing released); at the same time: two
// releases, an unlock during a release (held by a slow archive), an approval during a save (held by a slow engine),
// and a save taking a story off an approved page; the write-once columns; who may do what, and another organisation.
import { createHash, randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DeleteObjectCommand,
  GetObjectRetentionCommand,
  ListObjectVersionsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { GATEWAY_TEST_VECTOR } from "@pageinator/contracts";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import type { ObjectStore } from "../../src/storage/object-store.ts";
import { s3Client, s3Store } from "../../src/storage/s3.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const CHECKER = "c".repeat(64);
const DATE = "2027-03-01";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

// ------------------------------------------------------------------------------------------------ the gateway stub

const engineRev = new Map<number, number>();
let gateway: Server;
/** the stories the next save's page shares with other pages (its state's also_on_pages) */
let alsoOn: Record<string, number> = {};

/** A wait the test opens: `reached` once something stops at it, which then goes on once `open` is called. */
type Gate = { reached: Promise<void>; enter(): void; opened: Promise<void>; open(): void };
function gate(): Gate {
  const g = {} as Gate;
  g.reached = new Promise<void>((resolve) => (g.enter = resolve));
  g.opened = new Promise<void>((resolve) => (g.open = resolve));
  return g;
}
/** The engine's next state call (a save's first) and the archive's next write stop at these when set. */
let stateHold: Gate | undefined;
let archiveHold: Gate | undefined;
async function pass(hold: Gate | undefined) {
  if (!hold) return;
  hold.enter();
  await hold.opened;
}
/** Whether a promise has settled, a moment from now. */
async function settledSoon(work: Promise<unknown>): Promise<boolean> {
  let done = false;
  void work.finally(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 400));
  return done;
}

function answer(call: { cmd: string; page: number; base_rev: number | null }) {
  const n = call.page;
  const rev = engineRev.get(n) ?? 0;
  const view = (r: number) => ({
    page: n,
    rev: r,
    modules: [],
    problems: [],
    also_on_pages: call.cmd === "state" ? alsoOn : {},
    items: [],
    fonts: {},
  });
  if (["set", "alternative", "refresh"].includes(call.cmd)) {
    engineRev.set(n, rev + 1);
    return { ok: true, result: view(rev + 1), edits: [{ page: n, rev: rev + 1, modules: [] }], text: null };
  }
  if (call.cmd === "save") {
    // a save whose PDF could not be stored: the page stays "needs saving" (nothing else is written)
    const none = { pdf: null, png: null, thumb: null, edition_pdf: null, press_zip: null };
    const saved = { rev, ...none, articles: [], pages_changed: {}, printed: null, layout_problems: [] };
    return {
      ok: true,
      result: view(rev),
      edits: [],
      text: null,
      saved: { ...saved, warnings: [], stale: [], error: null },
    };
  }
  return { ok: true, result: view(rev), edits: [], text: null };
}

// ------------------------------------------------------------------------------------------------ the newsroom

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
let store: ObjectStore;
let s3: S3Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let b: Org;
let chief: Person;
let editor: Person; // an Editor holding the page_approve and release_approve grants
let prepress: Person;
let reporter: Person;
let designer: Person;
let editionId = "";
let runId = "";
const shas = new Map<number, string>();
const pubPath = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}`;
const pagePath = (p: number) => `${pubPath()}/runs/${runId}/pages/${p}`;
const archiveBucket = () => inject("storage").archiveBucket;

beforeAll(async () => {
  gateway = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.cmd === "state") {
        const hold = stateHold;
        stateHold = undefined;
        await pass(hold);
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer(body)));
    });
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  it_ = await identityApp(db, { PGN_GATEWAY_URL: url, PGN_GATEWAY_SECRET: GATEWAY_TEST_VECTOR.secret }, (plain) => ({
    ...plain,
    async archivePut(input) {
      const hold = archiveHold;
      archiveHold = undefined;
      await pass(hold);
      return plain.archivePut(input);
    },
  }));
  const storage = it_.config.storage;
  if (!storage) throw new Error("the database tests need the object store");
  store = s3Store(storage);
  s3 = s3Client(storage);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  const as = (role: string, grants: string[] = []) => [{ publicationId: a.pubId, roles: [role], grants }];
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  editor = await n.member(a, as("editor", ["page_approve", "release_approve"]), "member", "editor");
  prepress = await n.member(a, as("prepress"), "member", "prepress");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
  designer = await n.member(a, as("page_designer"), "member", "designer");
  const ownerId = await n.userId(a.owner);
  const edition = await su.query<{ id: string }>(
    `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages, back_page_ads, issue)
     values ($1, $2, $3::date, $3::text, 4, false, '') returning id`,
    [a.orgId, a.pubId, DATE],
  );
  editionId = edition.rows[0]?.id ?? "";
  const run = await su.query<{ id: string }>(
    `insert into app.layout_run (org_id, publication_id, edition_id, desk_key, state, finished_at, created_by,
       checker_sha256)
     values ($1, $2, $3, 'r-20270301-101500', 'done', now(), $4, $5) returning id`,
    [a.orgId, a.pubId, editionId, ownerId, CHECKER],
  );
  runId = run.rows[0]?.id ?? "";
  for (const p of [1, 2, 3, 4]) {
    await su.query(
      `insert into app.run_page (org_id, publication_id, run_id, page_no, role, state, articles, checked)
       values ($1, $2, $3, $4, $5, 'done', $6, '{"passed": true, "fails": 0, "warnings": 0}')`,
      [
        a.orgId,
        a.pubId,
        runId,
        p,
        p === 1 ? "front" : p === 4 ? "back" : "inside",
        JSON.stringify([`a-000000000${p}`]),
      ],
    );
    await resave(p, 0, `%PDF-1.4 fictional page ${p}`);
  }
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

/** A page saved as the editor saves it: new bytes in the work bucket, the page's PDF, revision and check. The bytes
 * recorded may be made to differ from those stored (a copy that cannot match). */
async function resave(p: number, rev: number, text: string, recorded = text) {
  const body = Buffer.from(text, "latin1");
  const key = `orgs/${a.orgId}/pubs/${a.pubId}/runs/${runId}/pages/0${p}/edit-${rev}.pdf`;
  const put = await store.put({ key, body, contentType: "application/pdf", metadata: {} });
  const digest = sha(Buffer.from(recorded, "latin1"));
  const pdf = { key, version_id: put.versionId, sha256: digest, bytes: body.length };
  await su.query(
    `update app.run_page set pdf = $4, pdf_sha256 = $5, pdf_rev = $6, rev_seen = greatest(rev_seen, $6),
       edited_unsaved = false, needs_save = false
     where org_id = $1 and run_id = $2 and page_no = $3`,
    [a.orgId, runId, p, JSON.stringify(pdf), digest, rev],
  );
  await su.query(
    `insert into app.pdf_check (org_id, sha256, checker_sha256, passed, fails, warnings) values ($1, $2, $3, true, 0, 1)
     on conflict do nothing`,
    [a.orgId, digest, CHECKER],
  );
  shas.set(p, digest);
}

const err = (reply: { json(): unknown }) =>
  (reply.json() as { error: { code: string; current?: unknown; details?: { field: string }[] } }).error;
const approve = (who: Person, p: number, rev = 0, pdfSha256 = shas.get(p) ?? "") =>
  call("POST", `${pagePath(p)}/approve`, who.cookie, { rev, pdfSha256 });
const releaseTab = async (who: Person = chief) => {
  const reply = await call("GET", `${pubPath()}/editions/${editionId}/release`, who.cookie);
  expect(reply.statusCode).toBe(200);
  return reply.json();
};
const release = (who: Person, files: { page: number; sha256: string }[], key?: string) =>
  change("POST", `${pubPath()}/editions/${editionId}/releases`, who.cookie, { files, note: "Night edition" }, key);
const candidateFiles = async () =>
  ((await releaseTab()).candidate?.files ?? []).map((f: { page: number; sha256: string }) => ({
    page: f.page,
    sha256: f.sha256,
  }));
const audits = async (action: string) =>
  (await su.query("select data from app.audit_event where action = $1 order by at", [action])).rows.map(
    (row) => row.data as Record<string, unknown>,
  );
async function readUrl(url: string): Promise<Buffer> {
  const reply = await fetch(url);
  expect(reply.status).toBe(200);
  return Buffer.from(await reply.arrayBuffer());
}

// ------------------------------------------------------------------------------------------------ the tests

let firstId = "";

describe("approving a page", () => {
  it("is refused to a reporter and to prepress; a stale revision or bytes answer the page now", async () => {
    for (const who of [reporter, prepress]) expect((await approve(who, 1)).statusCode, who.email).toBe(403);
    for (const stale of [await approve(chief, 1, 1), await approve(chief, 1, 0, "f".repeat(64))]) {
      expect([stale.statusCode, err(stale).code]).toEqual([409, "approval_stale"]);
      expect(err(stale).current).toMatchObject({ runId, page: 1, rev: 0, pdfSha256: shas.get(1), approval: null });
    }
  });

  it("approves the exact bytes, once; an Editor with the grant may too", async () => {
    const first = await approve(chief, 1);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ page: 1, approval: { by: { id: chief.id }, rev: 0, pdfSha256: shas.get(1) } });
    const again = await approve(chief, 1);
    expect(again.json().approval).toEqual(first.json().approval);
    expect((await approve(editor, 2)).json()).toMatchObject({ approval: { by: { id: editor.id } } });
    expect(await audits("page.approve")).toHaveLength(2);
  });

  it("locks the page in the editor: no change of it, no move to it", async () => {
    const changed = await call("POST", `${pagePath(1)}/edit/change`, designer.cookie, { kind: "refresh", rev: 0 });
    expect([changed.statusCode, err(changed).code]).toEqual([409, "page_approved"]);
    expect(err(changed).current).toMatchObject({ by: { id: chief.id }, rev: 0, page: 1 });
    const moved = await call("POST", `${pagePath(3)}/edit/change`, designer.cookie, {
      kind: "move",
      rev: 0,
      story: "d0123456789",
      to: 1,
    });
    expect([moved.statusCode, err(moved).code]).toEqual([409, "page_approved"]);
    const saved = await call("POST", `${pagePath(1)}/edit/save`, designer.cookie, { rev: 0 });
    expect([saved.statusCode, err(saved).code]).toEqual([409, "page_approved"]);
    const open = await call("GET", `${pagePath(1)}/edit`, designer.cookie);
    expect(open.json().approval).toMatchObject({ by: { id: chief.id } });
  });

  it("is unlocked only by a chief editor, once; an edit after it ends the approval", async () => {
    expect((await call("POST", `${pagePath(1)}/unlock`, editor.cookie)).statusCode).toBe(403);
    const unlocked = await call("POST", `${pagePath(1)}/unlock`, chief.cookie);
    expect([unlocked.statusCode, unlocked.json().approval]).toEqual([200, null]);
    const twice = await call("POST", `${pagePath(1)}/unlock`, chief.cookie);
    expect([twice.statusCode, err(twice).code]).toEqual([409, "not_approved"]);
    const edited = await call("POST", `${pagePath(1)}/edit/change`, designer.cookie, { kind: "refresh", rev: 0 });
    expect(edited.statusCode).toBe(200);
    // changed, not saved: it cannot be approved until it is saved
    const stale = await approve(chief, 1);
    expect([stale.statusCode, err(stale).code]).toEqual([409, "approval_stale"]);
    expect(err(stale).current).toMatchObject({ needsSave: true });
    await resave(1, 1, "%PDF-1.4 fictional page 1, saved");
    expect((await approve(chief, 1, 1)).statusCode).toBe(200);
    expect(await audits("page.unlock")).toHaveLength(1);
  });
});

describe("the preflight", () => {
  it("lists what stops a release, and the candidate", async () => {
    const tab = await releaseTab(reporter); // pages.view: everyone in the publication
    const failed = tab.preflight.items.filter((i: { state: string }) => i.state === "failed");
    expect(failed.map((i: { check: string; pages: number[] }) => [i.check, i.pages])).toEqual([
      ["folio", [1]],
      ["approved", [3, 4]],
    ]);
    expect(tab.candidate).toMatchObject({ kind: "release", runId });
    expect(tab.candidate.files.map((f: { name: string }) => f.name)).toEqual(
      [1, 2, 3, 4].map((p) => `${DATE}_P0${p}.pdf`),
    );
    const refused = await release(chief, await candidateFiles());
    expect([refused.statusCode, err(refused).code]).toEqual([409, "release_refused"]);
    expect(err(refused).details?.map((d) => d.field)).toEqual(["preflight.folio", "preflight.approved"]);
  });

  it("needs the G2 press test once the edition prints a photo, and passes with it", async () => {
    await su.query("update app.edition set issue = '41' where id = $1", [editionId]);
    for (const p of [3, 4]) expect((await approve(chief, p)).statusCode).toBe(200);
    expect((await releaseTab()).preflight.passed).toBe(true);
    const ownerId = await n.userId(a.owner);
    const story = await su.query<{ id: string }>(
      `insert into app.story (org_id, publication_id, edition_id, desk_key, reporter_id, language)
       values ($1, $2, $3, 'a-0000000002', $4, 'mr') returning id`,
      [a.orgId, a.pubId, editionId, ownerId],
    );
    const asset = await su.query<{ id: string }>(
      `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, uploaded_by)
       values ($1, $2, 'p-0000000002', $3, 1024, 'image/jpeg', 640, 480, $4) returning id`,
      [a.orgId, a.pubId, "1".repeat(64), ownerId],
    );
    await su.query("insert into app.story_photo (org_id, publication_id, story_id, asset_id) values ($1, $2, $3, $4)", [
      a.orgId,
      a.pubId,
      story.rows[0]?.id,
      asset.rows[0]?.id,
    ]);
    const tab = await releaseTab();
    expect([tab.needsPressTest, tab.pressTest, tab.preflight.passed]).toEqual([true, null, false]);
    const refused = await release(chief, await candidateFiles());
    expect(err(refused).details?.map((d) => d.field)).toEqual(["preflight.press_test"]);
    const test = { pageSha256: "e".repeat(64), acceptedOn: "2027-02-20", note: "Photo and ad page (fictional)" };
    expect((await call("PUT", `${pubPath()}/press-test`, prepress.cookie, test)).statusCode).toBe(403);
    const recorded = await call("PUT", `${pubPath()}/press-test`, chief.cookie, test);
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({ ...test, recordedBy: { id: chief.id } });
    expect((await releaseTab()).preflight.passed).toBe(true);
  });
});

describe("a release", () => {
  it("refuses a stale set of files with the candidate now, and prepress", async () => {
    const files = await candidateFiles();
    const stale = await release(chief, [...files.slice(1), { page: 1, sha256: "f".repeat(64) }]);
    expect([stale.statusCode, err(stale).code]).toEqual([409, "approval_stale"]);
    expect(err(stale).current).toMatchObject({ kind: "release", files: expect.any(Array) });
    expect((await release(prepress, files)).statusCode).toBe(403);
  });

  it("archives every page under Object Lock, reads it back, and releases the edition", async () => {
    const key = randomUUID();
    const files = await candidateFiles();
    const made = await release(chief, files, key);
    expect(made.statusCode).toBe(201);
    const body = made.json();
    firstId = body.id;
    expect(body).toMatchObject({ number: 1, kind: "release", runId, approvedBy: { id: chief.id }, deliveries: [] });
    expect(body.files.map((f: { name: string; replaces: string | null }) => [f.name, f.replaces])).toEqual(
      [1, 2, 3, 4].map((p) => [`${DATE}_P0${p}.pdf`, null]),
    );
    const years = (Date.parse(body.archive.retainUntil) - Date.now()) / (365.25 * 86_400_000);
    expect(years).toBeGreaterThan(9.99);
    // the same key again: the same release
    expect((await release(chief, files, key)).json().id).toBe(firstId);
    const rows = await su.query(
      "select archive_key, archive_version_id, sha256 from app.release_file where release_id = $1 order by page_no",
      [firstId],
    );
    for (const row of rows.rows) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of await store.archiveRead(row.archive_key, row.archive_version_id)) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      expect(sha(bytes)).toBe(row.sha256);
      expect(row.archive_key).toMatch(
        new RegExp(`^orgs/${a.orgId}/pubs/${a.pubId}/editions/${editionId}/releases/${firstId}/pages/`),
      );
      const retention = await s3.send(
        new GetObjectRetentionCommand({
          Bucket: archiveBucket(),
          Key: row.archive_key,
          VersionId: row.archive_version_id,
        }),
      );
      expect(retention.Retention?.Mode).toBe("GOVERNANCE");
    }
    const edition = await su.query("select status from app.edition where id = $1", [editionId]);
    expect(edition.rows[0]?.status).toBe("released");
    expect(await audits("release.create")).toEqual([{ edition: editionId, number: 1, kind: "release", files: 4 }]);
  });

  it("cannot be deleted from the archive without the governance bypass (SeaweedFS enforces Object Lock)", async () => {
    const { rows } = await su.query(
      "select archive_key, archive_version_id from app.release_file where release_id = $1 and page_no = 1",
      [firstId],
    );
    const { archive_key: Key, archive_version_id: VersionId } = rows[0] as Record<string, string>;
    await expect(s3.send(new DeleteObjectCommand({ Bucket: archiveBucket(), Key, VersionId }))).rejects.toMatchObject({
      name: "AccessDenied",
    });
    // a plain delete only lays a marker over it: the released version is still there, byte for byte
    await s3.send(new DeleteObjectCommand({ Bucket: archiveBucket(), Key }));
    const check = await call("POST", `${pubPath()}/releases/${firstId}/verify`, reporter.cookie);
    expect(check.statusCode).toBe(200);
    expect(check.json()).toMatchObject({ ok: true });
    expect(check.json().files.map((f: { name: string; ok: boolean }) => f.name)).toEqual([
      ...[1, 2, 3, 4].map((p) => `${DATE}_P0${p}.pdf`),
      "manifest.json",
    ]);
  });

  it("gives prepress a link to exactly the released version, and nobody else", async () => {
    const name = `${DATE}_P02.pdf`;
    const link = await call("GET", `${pubPath()}/releases/${firstId}/files/${name}`, prepress.cookie);
    expect(link.statusCode).toBe(200);
    expect(sha(await readUrl(link.json().url))).toBe(shas.get(2));
    expect((await call("GET", `${pubPath()}/releases/${firstId}/files/${name}`, reporter.cookie)).statusCode).toBe(403);
    expect((await call("GET", `${pubPath()}/releases/${firstId}/files/nope.pdf`, prepress.cookie)).statusCode).toBe(
      404,
    );
  });

  it("is marked as sent with its files' hashes, and confirmed once; each writes the receipts again", async () => {
    const sent = await call("POST", `${pubPath()}/releases/${firstId}/deliveries`, prepress.cookie, {
      note: "Sent by email (fictional)",
    });
    expect(sent.statusCode).toBe(200);
    const delivery = sent.json().deliveries[0];
    expect(delivery).toMatchObject({ method: "download", sentBy: { id: prepress.id }, confirmation: null });
    expect(delivery.files.map((f: { sha256: string }) => f.sha256)).toEqual([1, 2, 3, 4].map((p) => shas.get(p)));
    const confirm = (who: Person) =>
      call("POST", `${pubPath()}/releases/${firstId}/deliveries/${delivery.id}/confirm`, who.cookie, {
        pressPerson: "Press operator (fictional)",
      });
    expect((await confirm(reporter)).statusCode).toBe(403);
    const confirmed = await confirm(prepress);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().deliveries[0].confirmation).toMatchObject({
      pressPerson: "Press operator (fictional)",
      recordedBy: { id: prepress.id },
    });
    const twice = await confirm(prepress);
    expect([twice.statusCode, err(twice).code]).toEqual([409, "already_confirmed"]);
    const receipts = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: archiveBucket(),
        Prefix: `orgs/${a.orgId}/pubs/${a.pubId}/editions/${editionId}/releases/${firstId}/receipts.json`,
      }),
    );
    expect(receipts.Versions).toHaveLength(2);
    expect((await audits("release.send")).length).toBe(1);
    expect((await audits("release.confirm")).length).toBe(1);
  });

  it("has nothing to release again while no page changed", async () => {
    const tab = await releaseTab();
    expect(tab.candidate).toBeNull();
    const refused = await release(chief, [{ page: 1, sha256: shas.get(1) ?? "" }]);
    expect([refused.statusCode, err(refused).details?.[0]?.field]).toEqual([409, "nothing_to_release"]);
  });
});

describe("a late correction", () => {
  it("releases nothing when the archived copy cannot match the approved bytes (502)", async () => {
    await resave(3, 2, "%PDF-1.4 fictional page 3, corrected", "%PDF-1.4 other bytes");
    expect((await approve(chief, 3, 2)).statusCode).toBe(200);
    const failed = await release(chief, await candidateFiles());
    expect([failed.statusCode, err(failed).code]).toEqual([502, "archive_failed"]);
    expect((await su.query("select 1 from app.release where edition_id = $1", [editionId])).rowCount).toBe(1);
  });

  it("is only the changed page, as _v2, and needs release.correct", async () => {
    await resave(3, 3, "%PDF-1.4 fictional page 3, corrected");
    expect((await approve(chief, 3, 3)).statusCode).toBe(200);
    const tab = await releaseTab();
    expect(tab.candidate).toMatchObject({
      kind: "correction",
      files: [{ page: 3, name: `${DATE}_P03_v2.pdf`, rev: 3, replaces: `${DATE}_P03.pdf` }],
    });
    expect(tab.pages[2]).toMatchObject({ released: { name: `${DATE}_P03.pdf`, changed: true } });
    expect((await release(editor, await candidateFiles())).statusCode).toBe(403);
    const made = await release(chief, await candidateFiles());
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ number: 2, kind: "correction", files: [{ name: `${DATE}_P03_v2.pdf` }] });
    const after = await releaseTab();
    expect(after.releases.map((r: { number: number }) => r.number)).toEqual([2, 1]);
    // the first release and its receipt are kept
    expect(after.releases[1]).toMatchObject({ id: firstId, files: expect.any(Array) });
    expect(after.releases[1].deliveries[0].confirmation).not.toBeNull();
    expect(after.candidate).toBeNull();
  });
});

describe("at the same time", () => {
  it("refuses a save that would take a story off an approved page, in the run's turn", async () => {
    expect((await call("POST", `${pagePath(4)}/unlock`, chief.cookie)).statusCode).toBe(200);
    alsoOn = { "a-0000000002": 2 };
    const saved = await call("POST", `${pagePath(4)}/edit/save`, designer.cookie, { rev: 0 });
    alsoOn = {};
    expect([saved.statusCode, err(saved).code]).toEqual([409, "page_approved"]);
    expect(err(saved).current).toMatchObject({ by: { id: editor.id }, page: 2 }); // page 2's approval, named
    const marked = await su.query("select needs_save from app.run_page where run_id = $1 and page_no = 2", [runId]);
    expect(marked.rows[0]?.needs_save).toBe(false);
  });

  it("an approval waits for a save of the page that is under way, and then finds it changed", async () => {
    stateHold = gate();
    const held = stateHold;
    const saving = call("POST", `${pagePath(4)}/edit/save`, designer.cookie, { rev: 0 });
    await held.reached;
    const approving = approve(chief, 4);
    expect(await settledSoon(approving)).toBe(false);
    held.open();
    expect((await saving).statusCode).toBe(200);
    const late = await approving;
    expect([late.statusCode, err(late).code]).toEqual([409, "approval_stale"]);
    expect(err(late).current).toMatchObject({ needsSave: true });
    await resave(4, 1, "%PDF-1.4 fictional page 4, saved");
    expect((await approve(chief, 4, 1)).statusCode).toBe(200);
  });

  it("releases once when two approvers release at once", async () => {
    await resave(4, 2, "%PDF-1.4 fictional page 4, corrected");
    expect((await approve(chief, 4, 2)).statusCode).toBe(200);
    const files = await candidateFiles();
    archiveHold = gate();
    const held = archiveHold;
    const first = release(chief, files);
    await held.reached;
    const second = release(chief, files);
    expect(await settledSoon(second)).toBe(false); // the edition is held by the first
    held.open();
    expect((await first).statusCode).toBe(201);
    const refused = await second;
    expect([refused.statusCode, err(refused).details?.[0]?.field]).toEqual([409, "nothing_to_release"]);
  });

  it("an unlock waits for a release in flight, which keeps the bytes approved", async () => {
    await resave(1, 2, "%PDF-1.4 fictional page 1, corrected");
    expect((await approve(chief, 1, 2)).statusCode).toBe(200);
    archiveHold = gate();
    const held = archiveHold;
    const releasing = release(chief, await candidateFiles());
    await held.reached;
    const unlocking = call("POST", `${pagePath(1)}/unlock`, chief.cookie);
    expect(await settledSoon(unlocking)).toBe(false); // the release holds the run's pages
    held.open();
    const made = await releasing;
    expect(made.statusCode).toBe(201);
    expect(made.json().files).toMatchObject([{ page: 1, sha256: shas.get(1) }]);
    expect((await unlocking).statusCode).toBe(200);
  });

  it("keeps an unlock, a manifest and a confirmation as first written", async () => {
    await expect(
      su.query("update app.page_approval set unlocked_at = null, unlocked_by = null where unlocked_at is not null"),
    ).rejects.toThrow(/already unlocked/);
    await expect(
      su.query("update app.release set manifest_key = 'elsewhere' where id = $1", [firstId]),
    ).rejects.toThrow(/manifest already/);
    await su.query("update app.release set verified_at = now() where id = $1", [firstId]);
    await expect(
      su.query("update app.delivery set press_person = 'someone else' where release_id = $1", [firstId]),
    ).rejects.toThrow(/already confirmed/);
  });
});

describe("the folio", () => {
  const patch = (who: Person, body: unknown, org = a) =>
    call("PATCH", `${pubPath(org)}/editions/${editionId}`, who.cookie, body);
  const folio = async () =>
    (await releaseTab()).preflight.items.find((i: { check: string }) => i.check === "folio") as {
      state: string;
      printsOld: boolean;
    };

  it("is changed by the desk; page 1 then prints an old one until it is saved again", async () => {
    expect((await patch(reporter, { issue: "42" })).statusCode).toBe(403);
    const changed = await patch(chief, { issue: " 42 ", volume: "7" });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ id: editionId, issue: "42", volume: "7", price: "" });
    expect(await audits("edition.edit")).toEqual([{ issue: "42", volume: "7" }]);
    expect(await folio()).toMatchObject({ state: "failed", printsOld: true });
    // the same folio again changes nothing
    expect((await patch(chief, { issue: "42" })).statusCode).toBe(200);
    expect(await audits("edition.edit")).toHaveLength(1);
    await su.query("update app.run_page set saved_at = clock_timestamp() where run_id = $1 and page_no = 1", [runId]);
    expect(await folio()).toMatchObject({ state: "passed", printsOld: false });
  });

  it("is refused for an unknown edition, and another organisation's", async () => {
    const unknown = await call("PATCH", `${pubPath()}/editions/${randomUUID()}`, chief.cookie, { issue: "1" });
    expect(unknown.statusCode).toBe(404);
    expect((await patch(chief, { issue: "1" }, b)).statusCode).toBe(404);
    expect((await call("PATCH", `${pubPath()}/editions/${editionId}`, b.ownerCookie, { issue: "1" })).statusCode).toBe(
      404,
    );
  });
});

describe("another organisation", () => {
  it("finds nothing of it", async () => {
    const theirs = (path: string) => path.replace(pubPath(), pubPath(b));
    expect((await call("GET", `${pubPath()}/editions/${editionId}/release`, b.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", theirs(`${pubPath()}/editions/${editionId}/release`), b.ownerCookie)).statusCode).toBe(
      404,
    );
    expect(
      (await call("POST", theirs(`${pagePath(1)}/approve`), b.ownerCookie, { rev: 0, pdfSha256: "a".repeat(64) }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call("GET", theirs(`${pubPath()}/releases/${firstId}/files/${DATE}_P01.pdf`), b.ownerCookie)).statusCode,
    ).toBe(404);
    expect((await call("POST", theirs(`${pubPath()}/releases/${firstId}/verify`), b.ownerCookie)).statusCode).toBe(404);
  });
});
