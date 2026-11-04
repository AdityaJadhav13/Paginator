// Word (.docx) imports on the API's side (docs/product/10-l2-newsroom-plan.md §5.3, L2.2; migration 2026_11_30_0001),
// on a migrated clone and the run's bucket: the upload and the import's checks, the job enqueued with the import (ids
// only, one per import), who may import and who may read it, and the inbox applying the worker's events: stories made
// once by the importer, however often the job reports, the Desk's refusal, a lost job, and the live hint. The worker
// is not run here (engine-e2e.test.ts runs it): its result file and its events are written as it writes them. Every
// file is fictional, made here.
import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import { zipSync, strToU8 } from "fflate";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainInbox, sweep } from "../../src/modules/media/engine-inbox.ts";
import { articleLanguage } from "../../src/modules/media/imports.ts";
import { s3Client, s3Store } from "../../src/storage/s3.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
let engine: Client;
let app: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let b: Org;
let reporter: Person;
let otherReporter: Person;
let editor: Person;
let viewer: Person;
let leaver: Person;
const quiet = { error: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;
const store = () => s3Store(it_.config.storage!);

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  engine = await db.connect("engine");
  app = await db.connect("app");
  a = await n.organisation();
  b = await n.organisation();
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  reporter = await n.member(a, as("reporter"), "member", "reporter");
  otherReporter = await n.member(a, as("reporter"), "member", "reporter2");
  editor = await n.member(a, as("editor"), "member", "editor");
  viewer = await n.member(a, as("viewer"), "member", "viewer");
  leaver = await n.member(a, as("reporter"), "member", "leaver");
}, 60_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const base = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}`;
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** A minimal fictional .docx (as the Desk's tests make one). */
function docx(...paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/' +
    `2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml) });
}

async function uploaded(cookie: string, file: Uint8Array, org = a): Promise<string> {
  const presigned = await change("POST", `${base(org)}/uploads`, cookie, {
    purpose: "docx",
    filename: "fictional.docx",
    contentType: DOCX,
    bytes: file.length,
  });
  expect(presigned.statusCode, presigned.body).toBe(201);
  const policy = presigned.json();
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields as Record<string, string>)) form.append(name, value);
  form.append("file", new Blob([file]));
  expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
  return policy.uploadId as string;
}

async function imported(cookie: string, file: Uint8Array = docx("Fictional headline", "Text.")) {
  const uploadId = await uploaded(cookie, file);
  const res = await change("POST", `${base()}/imports/docx`, cookie, { uploadId });
  expect(res.statusCode, res.body).toBe(202);
  return { importId: res.json().importId as string, sha256: sha(file), uploadId };
}

type Job = { id: string; payload: Record<string, unknown>; key: string; max_attempts: number; task: string };
async function jobsFor(importId: string): Promise<Job[]> {
  const { rows } = await su.query<Job>(
    `select j.id::text, j.payload, j.key, j.max_attempts, t.identifier as task
     from queue._private_jobs j join queue._private_tasks t on t.id = j.task_id where j.key = $1`,
    [`import:${importId}`],
  );
  return rows;
}

/** What the worker writes: the result file beside the original; → its key, version and SHA-256. */
async function writeResult(importId: string, fileSha: string, result: object, org = a) {
  const key = `orgs/${org.orgId}/pubs/${org.pubId}/imports/${importId}/result-${fileSha}.json`;
  const body = JSON.stringify(result);
  const put = await s3Client(it_.config.storage!).send(
    new PutObjectCommand({ Bucket: it_.config.storage!.workBucket, Key: key, Body: body }),
  );
  return { key, version: put.VersionId as string, sha256: sha(body) };
}

/** What the queue's report writes (apps/engine-queue/src/inbox.ts), as pgn_engine. */
async function report(event: Record<string, unknown>, jobId: string = randomUUID()) {
  const target = (event["kind"] === "job.failed" ? event["target_id"] : event["import_id"]) as string;
  await engine.query(
    `with added as (
       insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, $3, $4, $5)
       on conflict do nothing
     ) select pg_notify('engine_events', $2)`,
    [event["org_id"], jobId, event["kind"], target, JSON.stringify(event)],
  );
  return jobId;
}
const outcomeOf = async (jobId: string) =>
  (await su.query("select outcome from app.engine_event where job_id = $1", [jobId])).rows[0]?.outcome as string;

const RESULT = {
  format: "pageinator.docx-result/1",
  articles: [
    { headline: "पहिली काल्पनिक बातमी", byline: "A. Writer", body: "पहिला परिच्छेद.\n\nदुसरा." },
    { headline: "Second fictional story", byline: "", body: "Its text." },
    { headline: "Too long", byline: "", body: "x".repeat(200_001) },
  ],
  notes: [
    { code: "docx.tables", count: 1, text: "1 table was not imported: copy its text into the article if needed." },
  ],
};

async function parsed(importId: string, fileSha: string, result: { articles: unknown[] } = RESULT) {
  const file = await writeResult(importId, fileSha, result);
  return {
    kind: "import.parsed",
    org_id: a.orgId,
    pub_id: a.pubId,
    import_id: importId,
    sha256: fileSha,
    result_key: file.key,
    result_version_id: file.version,
    result_sha256: file.sha256,
    articles: result.articles.length,
  };
}

describe("a Word file's import", () => {
  it("is enqueued with the import: ids only, one job per import, the file copied out of quarantine", async () => {
    const { importId, sha256 } = await imported(reporter.cookie);
    const jobs = await jobsFor(importId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ task: "docx.import", max_attempts: 10, key: `import:${importId}` });
    expect(Object.keys(jobs[0]?.payload ?? {}).sort()).toEqual([
      "import_id",
      "org_id",
      "pub_id",
      "sha256",
      "version_id",
    ]);
    expect(jobs[0]?.payload).toMatchObject({ org_id: a.orgId, pub_id: a.pubId, import_id: importId, sha256 });
    const { rows } = await su.query(
      "select original_key, version_id, sha256, state from app.import_job where id = $1",
      [importId],
    );
    expect(rows[0]).toMatchObject({ sha256, state: "queued", version_id: jobs[0]?.payload["version_id"] });
    // the original as the worker will read it: exactly those bytes, at the key the database makes
    const chunks: Uint8Array[] = [];
    for await (const c of await store().read(rows[0].original_key, rows[0].version_id)) chunks.push(c);
    expect(sha(Buffer.concat(chunks))).toBe(sha256);
    const got = await call("GET", `${base()}/imports/${importId}`, reporter.cookie);
    expect(got.statusCode, got.body).toBe(200);
    expect(got.json()).toMatchObject({
      id: importId,
      state: "queued",
      created: [],
      skipped: 0,
      notes: [],
      error: null,
    });
  });

  it("refuses what is not a Word file, a password-protected one, and one too large", async () => {
    const notZip = await uploaded(reporter.cookie, strToU8("plain fictional text, not a Word file"));
    const refused = await change("POST", `${base()}/imports/docx`, reporter.cookie, { uploadId: notZip });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatchObject({
      code: "docx_refused",
      message: "This is not a Word (.docx) file. Save it as .docx and try again.",
    });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const locked = await change("POST", `${base()}/imports/docx`, reporter.cookie, {
      uploadId: await uploaded(reporter.cookie, ole),
    });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().error.details[0].message).toMatch(/^This Word file is protected with a password/);
    const big = await change("POST", `${base()}/uploads`, reporter.cookie, {
      purpose: "docx",
      filename: "fictional.docx",
      contentType: DOCX,
      bytes: 10_485_761,
    });
    expect(big.statusCode).toBe(422);
    expect(big.json().error).toMatchObject({ code: "docx_refused", message: "This Word file is larger than 10 MB." });
    expect(big.json().error.details[0].message).toBe("This Word file is larger than 10 MB.");
    // and a picture's upload is never imported, nor a Word file's completed as a picture
    const picture = await change("POST", `${base()}/uploads`, reporter.cookie, {
      purpose: "docx",
      filename: "x.jpg",
      contentType: "image/jpeg",
      bytes: 10,
    });
    expect(picture.statusCode).toBe(400);
    const asPicture = await call("POST", `${base()}/uploads/${notZip}/complete`, reporter.cookie);
    expect(asPicture.statusCode).toBe(422);
  });

  it("is the importer's: another's upload is not found, and a Viewer may not import", async () => {
    const theirs = await uploaded(reporter.cookie, docx("Fictional headline", "Text."));
    const other = await change("POST", `${base()}/imports/docx`, otherReporter.cookie, { uploadId: theirs });
    expect(other.statusCode).toBe(404);
    const upload = await change("POST", `${base()}/uploads`, viewer.cookie, {
      purpose: "docx",
      filename: "fictional.docx",
      contentType: DOCX,
      bytes: 100,
    });
    expect(upload.statusCode).toBe(403);
    const post = await change("POST", `${base()}/imports/docx`, viewer.cookie, { uploadId: theirs });
    expect(post.statusCode).toBe(403);
    // an edition is the desk's to name
    const withEdition = await change("POST", `${base()}/imports/docx`, reporter.cookie, {
      uploadId: theirs,
      editionId: randomUUID(),
    });
    expect(withEdition.statusCode).toBe(403);
  });

  it("is read by its importer and the desk only, never by another organisation", async () => {
    const { importId } = await imported(reporter.cookie);
    expect((await call("GET", `${base()}/imports/${importId}`, editor.cookie)).statusCode).toBe(200);
    expect((await call("GET", `${base()}/imports/${importId}`, otherReporter.cookie)).statusCode).toBe(404);
    // story.view lets a member ask; only the importer and the desk are answered
    expect((await call("GET", `${base()}/imports/${importId}`, viewer.cookie)).statusCode).toBe(404);
    expect((await call("GET", `${base(b)}/imports/${importId}`, b.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", `${base()}/imports/${importId}`, b.ownerCookie)).statusCode).toBe(404);
  });

  it("refuses another organisation's job, and a call outside withTenant", async () => {
    const args = [b.orgId, b.pubId, "01890a5d-ac96-774b-bcce-b302099a805a", "v1", "a".repeat(64)];
    const enqueue = "select app.enqueue_docx_import($1, $2, $3, $4, $5)";
    await expect(app.query(enqueue, args)).rejects.toMatchObject({ code: "42501" });
    await app.query("begin");
    try {
      await app.query("select set_config('app.org_id', $1, true)", [a.orgId]);
      await expect(app.query(enqueue, args)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.query("rollback");
    }
  });
});

describe("an imported article's language", () => {
  it("is Marathi when more than half its letters are Devanagari, else English, within the paper's languages", () => {
    expect(articleLanguage("पहिली काल्पनिक बातमी, with a note", ["mr", "en"], "en")).toBe("mr");
    expect(articleLanguage("An English story about पुणे", ["mr", "en"], "mr")).toBe("en");
    expect(articleLanguage("1234 ...", ["mr", "en"], "mr")).toBe("en");
    // a language the paper does not have: its primary one, as a typed story's default
    expect(articleLanguage("An English story", ["mr"], "mr")).toBe("mr");
  });
});

describe("the import's events", () => {
  it("make its stories once, by the importer, however often the job reports", async () => {
    await su.query("update app.publication set languages = '{mr,en}' where id = $1", [a.pubId]);
    const { importId, sha256 } = await imported(reporter.cookie);
    const hints: string[] = [];
    const listener = await db.connect("postgres");
    listener.on("notification", (m) => hints.push(m.payload ?? ""));
    await listener.query("listen app_events");

    const event = await parsed(importId, sha256);
    const jobId = await report(event);
    // the job run again after its report: the inbox keeps one row per job id
    await report(event, jobId);
    await drainInbox(it_.database, quiet, store());
    expect(await outcomeOf(jobId)).toBe("applied");
    const got = (await call("GET", `${base()}/imports/${importId}`, reporter.cookie)).json();
    expect(got).toMatchObject({ state: "done", skipped: 1, error: null });
    expect(got.created.map((c: { headline: string }) => c.headline)).toEqual([
      "पहिली काल्पनिक बातमी",
      "Second fictional story",
    ]);
    expect(got.notes.map((note: { code: string }) => note.code)).toEqual(["docx.tables", "import.skipped"]);
    const languages = await su.query(
      "select language from app.story where id = any ($1::uuid[]) order by created_at, id",
      [got.created.map((c: { storyId: string }) => c.storyId)],
    );
    expect(languages.rows.map((r) => r.language).sort()).toEqual(["en", "mr"]);
    const { rows } = await su.query(
      `select s.reporter_id, s.status, s.origin, r.headline, r.byline, r.body from app.story s
       join app.story_revision r on r.story_id = s.id and r.closed_at is null where s.id = any ($1::uuid[]) order by r.headline`,
      [got.created.map((c: { storyId: string }) => c.storyId)],
    );
    expect(rows).toEqual([
      expect.objectContaining({ reporter_id: reporter.id, status: "draft", origin: "word", byline: "" }),
      expect.objectContaining({ reporter_id: reporter.id, byline: "A. Writer", body: "पहिला परिच्छेद.\n\nदुसरा." }),
    ]);
    // the reporter sees their new stories
    const story = await call("GET", `${base()}/stories/${got.created[0].storyId}`, reporter.cookie);
    expect(story.statusCode).toBe(200);
    const audit = await su.query("select actor_kind, data from app.audit_event where action = 'import.done'");
    expect(audit.rows).toContainEqual({ actor_kind: "system", data: { job: jobId, created: 2, skipped: 1 } });

    // the same event from another job (or the sweep's after a real one) finds it settled: no second set
    const again = await report(event);
    await drainInbox(it_.database, quiet, store());
    expect(await outcomeOf(again)).toBe("ignored");
    const { rows: made } = await su.query("select count(*)::int as n from app.story where origin = 'word'");
    expect(made[0].n).toBe(2);

    await new Promise((r) => setTimeout(r, 200));
    const hinted = hints.map((h) => JSON.parse(h)).filter((h) => h.type === "import");
    expect(hinted).toEqual([{ v: 1, type: "import", org: a.orgId, pub: a.pubId, import: importId, user: reporter.id }]);
    await listener.end();
  });

  it("refuse a result file that is not the import's own, or not the bytes named, and fail the import at once", async () => {
    const one = await imported(reporter.cookie);
    const two = await imported(reporter.cookie);
    const first = await parsed(one.importId, one.sha256);
    const event = await parsed(two.importId, two.sha256);
    const elsewhere = await report({ ...first, result_key: first.result_key.replace("result-", "other-") });
    const forged = await report({ ...event, result_sha256: "0".repeat(64) });
    await drainInbox(it_.database, quiet, store());
    expect([await outcomeOf(elsewhere), await outcomeOf(forged)]).toEqual(["refused", "refused"]);
    for (const id of [one.importId, two.importId]) {
      expect((await call("GET", `${base()}/imports/${id}`, reporter.cookie)).json()).toMatchObject({
        state: "failed",
        created: [],
        error: { code: "worker.bad_result" },
      });
    }
    // another organisation's event naming this import is refused (its tenant cannot find it)
    const theirs = await report({ ...event, org_id: b.orgId, pub_id: b.pubId });
    await drainInbox(it_.database, quiet, store());
    expect(await outcomeOf(theirs)).toBe("refused");
  });

  it("fail it with the Desk's words when the Desk refuses the file, and with the engine's code when the job fails", async () => {
    const one = await imported(reporter.cookie);
    await report({
      kind: "import.rejected",
      org_id: a.orgId,
      pub_id: a.pubId,
      import_id: one.importId,
      sha256: one.sha256,
      code: "docx.no_story",
      message: "No story was found in this Word file: it needs a headline and some text.",
      status: 400,
    });
    const two = await imported(reporter.cookie);
    await report({
      kind: "job.failed",
      org_id: a.orgId,
      pub_id: a.pubId,
      job_kind: "docx.import",
      target_id: two.importId,
      code: "worker.store",
      message: "the store could not be reached",
    });
    await drainInbox(it_.database, quiet, store());
    const first = (await call("GET", `${base()}/imports/${one.importId}`, reporter.cookie)).json();
    expect(first).toMatchObject({
      state: "failed",
      created: [],
      error: {
        code: "docx.no_story",
        message: "No story was found in this Word file: it needs a headline and some text.",
      },
    });
    const second = (await call("GET", `${base()}/imports/${two.importId}`, reporter.cookie)).json();
    expect(second).toMatchObject({ state: "failed", error: { code: "worker.store" } });
  });

  it("make no stories for an importer who may no longer make them", async () => {
    const { importId, sha256 } = await imported(leaver.cookie);
    await su.query("update app.publication_grant set roles = '{viewer}' where user_id = $1 and publication_id = $2", [
      leaver.id,
      a.pubId,
    ]);
    const jobId = await report(await parsed(importId, sha256));
    await drainInbox(it_.database, quiet, store());
    expect(await outcomeOf(jobId)).toBe("applied");
    const { rows } = await su.query("select state, problem, created from app.import_job where id = $1", [importId]);
    expect(rows[0]).toMatchObject({ state: "failed", problem: "import.not_allowed", created: [] });
    const made = await su.query("select count(*)::int as n from app.story where reporter_id = $1", [leaver.id]);
    expect(made.rows[0].n).toBe(0);
  });

  it("settle an import whose job was lost (the sweep)", async () => {
    const { importId } = await imported(reporter.cookie);
    await su.query("delete from queue._private_jobs where key = $1", [`import:${importId}`]);
    await su.query("update app.import_job set updated_at = now() - interval '1 hour' where id = $1", [importId]);
    expect(await sweep(it_.database, quiet, { staleMs: 60_000, deadlineMs: 60_000 })).toBeGreaterThanOrEqual(1);
    await drainInbox(it_.database, quiet, store());
    const got = (await call("GET", `${base()}/imports/${importId}`, reporter.cookie)).json();
    expect(got).toMatchObject({ state: "failed", error: { code: "worker.lost" } });
  });
});
