// Print profiles' routes (packages/contracts/src/print-profiles.ts) on a migrated clone: who may see and save them
// (doc 07 §12: prepress edits, a chief editor views, a reporter neither), each save a new version numbered per
// publication (two at once never meet), an Idempotency-Key answering the same version again, the audit, the facts read
// from the engine profile in use and the newest done run (null when not recorded), and another organisation's walls.
// The press test page through a stub of the edit gateway (it checks each request's signature): its bytes and headers,
// and its refusals (no gateway, an answer outside the contract, bytes not the ones named, the check failed, the trim or
// the colour profile not the paper's).
import { createHash, timingSafeEqual } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  GATEWAY_NONCE_HEADER,
  GATEWAY_SIGNATURE_HEADER,
  GATEWAY_TEST_VECTOR,
  GATEWAY_TIME_HEADER,
} from "@pageinator/contracts";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signature } from "../../src/modules/editor/gateway.ts";
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

const SECRET = GATEWAY_TEST_VECTOR.secret;
const PDF = Buffer.from("%PDF-1.4 a fictional press test page");
const PDF_SHA = createHash("sha256").update(PDF).digest("hex");
const ICC = "2".repeat(64);
/** The gateway's answer to GET /v1/press-test (status, body); each test sets its own. */
const good = (change: Record<string, unknown> = {}) => ({
  format: "pageinator.press-test/1",
  pdf: PDF.toString("base64"),
  sha256: PDF_SHA,
  bytes: PDF.length,
  icc_sha256: ICC,
  check: { passed: true, fails: 0, warnings: 3 },
  maker: "desk-engine/fictional",
  page_mm: [347, 540],
  ...change,
});
let answer: [number, unknown] = [200, good()];
const asked: string[] = [];
let gateway: Server;

beforeAll(async () => {
  gateway = createServer((request, response) => {
    const time = String(request.headers[GATEWAY_TIME_HEADER] ?? "");
    const nonce = String(request.headers[GATEWAY_NONCE_HEADER] ?? "");
    const given = Buffer.from(String(request.headers[GATEWAY_SIGNATURE_HEADER] ?? ""), "hex");
    const want = Buffer.from(signature(SECRET, request.method ?? "", request.url ?? "", time, nonce, ""), "hex");
    if (given.length !== want.length || !timingSafeEqual(given, want)) return response.writeHead(401).end();
    asked.push(`${request.method} ${request.url}`);
    response.writeHead(answer[0], { "content-type": "application/json" }).end(JSON.stringify(answer[1]));
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  it_ = await identityApp(db, { PGN_GATEWAY_URL: gatewayUrl, PGN_GATEWAY_SECRET: SECRET });
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
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
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

describe("the press test page", () => {
  const press = (org: Org) => `${path(org)}/press-test`;
  const code = (reply: { statusCode: number; json(): unknown }) => [
    reply.statusCode,
    (reply.json() as { error: { code: string } }).error.code,
  ];

  it("is the engine's page, its bytes checked, for those who see print profiles", async () => {
    answer = [200, good()];
    // organisation b has no engine profile: nothing recorded to compare
    const reply = await n.call("GET", press(b), b.ownerCookie);
    expect(reply.statusCode).toBe(200);
    expect(reply.rawPayload.equals(PDF)).toBe(true);
    expect(reply.headers).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="pageinator-press-test-${PDF_SHA.slice(0, 12)}.pdf"`,
      "cache-control": "no-store",
      "x-pageinator-sha256": PDF_SHA,
      "x-pageinator-icc-sha256": ICC,
      "x-pageinator-check-warnings": "3",
    });
    expect(asked.at(-1)).toBe("GET /v1/press-test");
    expect((await n.call("GET", press(a), reporter.cookie)).statusCode).toBe(403);
  });

  it("is refused when the check failed, or the trim or the colour profile is not the paper's", async () => {
    // organisation a's engine profile (the facts' test above): 330 × 520.5 mm, its colour profile ICC
    answer = [200, good()];
    expect(code(await n.call("GET", press(a), chief.cookie))).toEqual([409, "press_test_refused"]);
    const front = [{ name: "front-a", outline: { page_w_mm: 346.5, page_h_mm: 540.8 } }];
    await su.query("update app.engine_profile set candidates = $1 where publication_id = $2", [
      JSON.stringify({ front }),
      a.pubId,
    ]);
    expect((await n.call("GET", press(a), chief.cookie)).statusCode).toBe(200);
    answer = [200, good({ icc_sha256: "9".repeat(64) })];
    expect(code(await n.call("GET", press(a), chief.cookie))).toEqual([409, "press_test_refused"]);
    answer = [200, good({ check: { passed: false, fails: 1, warnings: 0 } })];
    expect(code(await n.call("GET", press(b), b.ownerCookie))).toEqual([409, "press_test_refused"]);
  });

  it("is unavailable without the gateway, or when its answer is not the contract's or its bytes not the ones named", async () => {
    for (const bad of [
      [500, { error: "the engine could not make it" }],
      [200, good({ sha256: "0".repeat(64) })],
      [200, good({ bytes: PDF.length + 1 })],
      [200, good({ format: "pageinator.press-test/2" })],
    ] as [number, unknown][]) {
      answer = bad;
      expect(code(await n.call("GET", press(b), b.ownerCookie)), JSON.stringify(bad)).toEqual([
        503,
        "press_test_unavailable",
      ]);
    }
    const off = await identityApp(db);
    try {
      const reply = await off.app.inject({ method: "GET", url: press(b), headers: { cookie: b.ownerCookie } });
      expect(code(reply)).toEqual([503, "press_test_unavailable"]);
    } finally {
      await off.close();
    }
  });
});
