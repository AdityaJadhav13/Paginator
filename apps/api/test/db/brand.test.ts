// Brand & masthead (src/modules/brand/routes.ts, src/db/brand.ts) on a migrated clone: who reads and who changes the
// name and the edition defaults, the audit row, the next issue number moving on when an edition is made with it (Latin
// or Devanagari digits), the newest laid-out front page, and another tenant's walls. Every name is fictional.
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let b: Org;
const people: Record<string, Person> = {};

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  for (const role of ["chief_editor", "page_designer", "editor", "viewer"]) {
    people[role] = await n.member(a, [{ publicationId: a.pubId, roles: [role], grants: [] }], "member", role);
  }
}, 180_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const brand = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/brand`;
const editions = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/editions`;
let day = 0;
const nextDay = () => `2027-05-${String(++day).padStart(2, "0")}`;
const nextIssue = async () => (await call("GET", brand(), people.editor!.cookie)).json().defaults.nextIssue;

describe("brand", () => {
  it("anyone on the publication reads it: the name, empty defaults, no front page yet", async () => {
    const read = await call("GET", brand(), people.viewer!.cookie);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual({
      name: "काल्पनिकनगर वार्ता",
      defaults: { volume: "", price: "", nextIssue: null },
      masthead: null,
    });
  });

  it("brand.edit changes the name and the defaults, audited with the fields; an Editor and a Viewer may not", async () => {
    for (const who of ["editor", "viewer"]) {
      expect((await call("PUT", brand(), people[who]!.cookie, { name: "Other" })).statusCode).toBe(403);
    }
    const put = await call("PUT", brand(), people.page_designer!.cookie, {
      name: "  काल्पनिक वार्ता ",
      defaults: { volume: "वर्ष १२", price: "५", nextIssue: 300 },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toMatchObject({
      name: "काल्पनिक वार्ता",
      defaults: { volume: "वर्ष १२", price: "५", nextIssue: 300 },
    });
    // the same again changes nothing and writes no audit row
    expect((await call("PUT", brand(), people.chief_editor!.cookie, { defaults: { price: "५" } })).statusCode).toBe(
      200,
    );
    const audit = await su.query(
      "select actor_id, target_id, data from app.audit_event where action = 'brand.set' and org_id = $1",
      [a.orgId],
    );
    expect(audit.rows).toEqual([
      {
        actor_id: people.page_designer!.id,
        target_id: a.pubId,
        data: { fields: ["name", "volume", "price", "nextIssue"] },
      },
    ]);
    const pub = await su.query("select name from app.publication where id = $1", [a.pubId]);
    expect(pub.rows[0].name).toBe("काल्पनिक वार्ता");
  });

  it("refuses an empty or two-line name and a counter out of range", async () => {
    for (const body of [
      { name: "  " },
      { name: "a\nb" },
      { defaults: { nextIssue: 0 } },
      { defaults: { volume: "x".repeat(41) } },
    ]) {
      const res = await call("PUT", brand(), people.chief_editor!.cookie, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("making an edition with the next issue moves it on; another number past it moves it past; others leave it", async () => {
    await call("PUT", brand(), people.chief_editor!.cookie, { defaults: { nextIssue: 300 } });
    const make = (issue?: string) =>
      change("POST", editions(), people.editor!.cookie, { date: nextDay(), pages: 4, ...(issue ? { issue } : {}) });
    expect((await make("300")).statusCode).toBe(201);
    expect(await nextIssue()).toBe(301);
    expect((await make("३०१")).statusCode).toBe(201);
    expect(await nextIssue()).toBe(302);
    expect((await make("310")).statusCode).toBe(201);
    expect(await nextIssue()).toBe(311);
    for (const issue of ["200", "अंक ३११", undefined]) expect((await make(issue)).statusCode).toBe(201);
    expect(await nextIssue()).toBe(311);
    // no counter: nothing moves
    await call("PUT", brand(), people.chief_editor!.cookie, { defaults: { nextIssue: null } });
    expect((await make("400")).statusCode).toBe(201);
    expect(await nextIssue()).toBe(null);
  });

  it("the masthead is page 1 of the newest done run that has its preview", async () => {
    const owner = await n.userId(a.owner);
    const run = async (date: string, state: "done" | "failed", finished: string, png: boolean) => {
      const edition = await su.query<{ id: string }>(
        `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
         values ($1, $2, $3::date, $3::text, 4) returning id`,
        [a.orgId, a.pubId, date],
      );
      const id = edition.rows[0]!.id;
      const made = await su.query<{ id: string }>(
        `insert into app.layout_run (org_id, publication_id, edition_id, desk_key, state, finished_at, created_by,
           checker_sha256)
         values ($1, $2, $3, 'r-20270601-101500', $4, $5::timestamptz, $6, $7) returning id`,
        [a.orgId, a.pubId, id, state, finished, owner, "c".repeat(64)],
      );
      const file = { key: `runs/${date}/page-01.png`, version_id: "v1", sha256: "d".repeat(64), bytes: 10 };
      await su.query(
        `insert into app.run_page (org_id, publication_id, run_id, page_no, role, state, articles, png)
         values ($1, $2, $3, 1, 'front', 'done', '[]', $4)`,
        [a.orgId, a.pubId, made.rows[0]!.id, png ? JSON.stringify(file) : null],
      );
      return { edition: id, run: made.rows[0]!.id };
    };
    const shown = await run("2027-06-01", "done", "2027-06-01T08:00:00Z", true);
    await run("2027-06-02", "failed", "2027-06-02T08:00:00Z", true);
    await run("2027-06-03", "done", "2027-06-03T08:00:00Z", false);
    const read = await call("GET", brand(), people.viewer!.cookie);
    expect(read.json().masthead).toEqual({
      runId: shown.run,
      editionId: shown.edition,
      editionDate: "2027-06-01",
      finishedAt: "2027-06-01T08:00:00.000Z",
    });
    // another organisation's brand is not reached
    expect((await call("GET", brand(b), people.viewer!.cookie)).statusCode).toBe(404);
    expect((await call("GET", brand(b), b.ownerCookie)).json().masthead).toBe(null);
  });
});
