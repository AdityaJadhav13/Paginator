// Print profiles' routes (packages/contracts/src/print-profiles.ts) on a migrated clone: who may see and save them
// (doc 07 §12: prepress edits, a chief editor views, a reporter neither), each save a new version numbered per
// publication (two at once never meet), an Idempotency-Key answering the same version again, the audit, the facts read
// from the engine profile in use and the newest done run (null when not recorded), and another organisation's walls.
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
let a: Org;
let b: Org;
let prepress: Person;
let chief: Person;
let reporter: Person;
const path = (org: Org) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/print-profiles`;

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  prepress = await n.member(a, as("prepress"), "member", "prepress");
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

describe("print profiles", () => {
  it("are none at first, with the facts not recorded", async () => {
    const reply = await n.call("GET", path(a), chief.cookie);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({
      items: [],
      facts: {
        engineProfileVersion: null,
        trim: null,
        pdfStandard: "PDF/X-1a",
        checkerSha256: null,
        iccSha256: null,
        adMinPpi: 200,
        photoSharpPpi: 150,
        delivery: "download",
      },
    });
    expect((await n.call("GET", path(a), reporter.cookie)).statusCode).toBe(403);
  });

  it("are saved by prepress only, each a new version; the same key answers the same version", async () => {
    const input = { pressName: "Fictional Press", contact: " press@example.test ", note: "" };
    expect((await n.change("POST", path(a), chief.cookie, input)).statusCode).toBe(403);
    expect((await n.change("POST", path(a), prepress.cookie, { pressName: " " })).statusCode).toBe(400);
    const key = crypto.randomUUID();
    const first = await n.change("POST", path(a), prepress.cookie, input, key);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      version: 1,
      pressName: "Fictional Press",
      contact: "press@example.test",
      note: null,
    });
    expect((await n.change("POST", path(a), prepress.cookie, input, key)).json().id).toBe(first.json().id);
    // two at once take turns
    const both = await Promise.all(
      ["Press Two", "Press Three"].map((pressName) => n.change("POST", path(a), prepress.cookie, { pressName })),
    );
    expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
    const listed = (await n.call("GET", path(a), chief.cookie)).json();
    expect(listed.items.map((p: { version: number }) => p.version)).toEqual([3, 2, 1]);
    const audit = await su.query("select data from app.audit_event where action = 'print_profile.create' order by at");
    expect(audit.rows.map((r) => r.data.version).sort()).toEqual([1, 2, 3]);
  });

  it("read the facts from the engine profile in use and the newest done run", async () => {
    const owner = await n.userId(a.owner);
    const candidates = {
      front: [
        {
          name: "other",
          date: "2026-01-01",
          page: 1,
          outline: { page_w_mm: 1, page_h_mm: 1, news: [], kept: [], ad_slots: [] },
        },
        {
          name: "front-a",
          date: "2026-01-02",
          page: 1,
          outline: { page_w_mm: 330, page_h_mm: 520.5, news: [], kept: [], ad_slots: [] },
        },
      ],
    };
    const upload = await su.query<{ id: string }>(
      `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
       values ($1, $2, $3, 'engine_dataset', 'application/zip', 10, now()) returning id`,
      [a.orgId, a.pubId, owner],
    );
    await su.query(
      `insert into app.engine_profile (org_id, publication_id, version, state, upload_id, dataset_sha256, dataset_bytes,
         config_version_id, config_sha256, engine_version, templates, grid, plans, created_by, candidates, icc_sha256)
       values ($1, $2, 1, 'ready', $3, $4, 10, 'v1', $4, 'desk-engine/fictional', '{"front": "front-a"}', '{}', '[]',
         $5, $6, $7)`,
      [a.orgId, a.pubId, upload.rows[0]?.id, "1".repeat(64), owner, JSON.stringify(candidates), "2".repeat(64)],
    );
    const run = await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages, back_page_ads, issue)
       values ($1, $2, '2026-11-02', '2026-11-02', 4, false, '1') returning id`,
      [a.orgId, a.pubId],
    );
    await su.query(
      `insert into app.layout_run (org_id, publication_id, edition_id, desk_key, state, finished_at, created_by,
         checker_sha256)
       values ($1, $2, $3, 'r-20261102-101500', 'done', now(), $4, $5)`,
      [a.orgId, a.pubId, run.rows[0]?.id, owner, "3".repeat(64)],
    );
    const facts = (await n.call("GET", path(a), chief.cookie)).json().facts;
    expect(facts).toMatchObject({
      engineProfileVersion: 1,
      trim: { wMm: 330, hMm: 520.5 },
      iccSha256: "2".repeat(64),
      checkerSha256: "3".repeat(64),
    });
  });

  it("are walled by organisation", async () => {
    expect((await n.call("GET", path(b), b.ownerCookie)).json().items).toEqual([]);
    expect([403, 404]).toContain((await n.call("GET", path(b), prepress.cookie)).statusCode);
  });
});
