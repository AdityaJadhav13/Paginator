// The tenancy tests (docs/product/10-l2-newsroom-plan.md §4.8) for the audit log (GET /api/v1/orgs/:o/audit;
// src/modules/audit, src/db/audit.ts), with two fictional organisations that both have events:
//   (b) under withTenant, the list query reads none of the other organisation's events, even with nothing else
//       narrowing it, and a cursor naming one of them is not one of the reader's;
//   (c) the endpoint with the other organisation's id answers 404, and filters naming its people, publication or
//       targets find nothing;
//   the publication wall's counterpart: a Chief Editor never sees another publication's events, by filter or cursor;
//   and a cursor from another organisation is refused (400). The database's own read wall: a transaction reads only
//   the events of the publications it reaches, and the organisation's own.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAuditCursor, listAudit } from "../../src/db/audit.ts";
import { freshDatabase } from "../db/helpers.ts";
import { type IdentityApp, identityApp } from "../db/identity-app.ts";
import { type Org, type Person, newsroom } from "../db/newsroom.ts";

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
let p2: string;
const people: Record<string, Person> = {};
const P = (who: string) => people[who] as Person;

type Page = { items: { id: string; publicationId: string | null; action: string }[]; nextCursor: string | null };
const auditUrl = (org: Org, query = "") => `/api/v1/orgs/${org.orgId}/audit${query}`;

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  p2 = await n.addPublication(a, "Kalpaniknagar Express");
  const on = (role: string, pub: string) => [{ publicationId: pub, roles: [role], grants: [] }];
  people.chief = await n.member(a, on("chief_editor", a.pubId), "member", "chief");
  people.viewer = await n.member(a, on("viewer", p2), "member", "viewer");
  people.bViewer = await n.member(b, on("viewer", b.pubId), "member", "b-viewer");
  // refusals on each publication of A, and on B's
  for (const [cookie, org, pub] of [
    [P("viewer").cookie, a, p2],
    [P("bViewer").cookie, b, b.pubId],
  ] as const) {
    const res = await change("POST", `/api/v1/orgs/${org.orgId}/pubs/${pub}/stories`, cookie, {
      headline: "No",
      body: "Text.",
    });
    expect(res.statusCode).toBe(403);
  }
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

async function idsOf(orgId: string, where = "true"): Promise<string[]> {
  const { rows } = await su.query<{ id: string }>(
    `select id from app.audit_event where org_id = $1 and ${where} order by at desc, id desc`,
    [orgId],
  );
  return rows.map((row) => row.id);
}

describe("(b) the audit log under withTenant", () => {
  it("reads only the tenant's own events, with nothing else narrowing the query", async () => {
    const bIds = await idsOf(b.orgId);
    expect(bIds.length).toBeGreaterThan(0);
    const tenant = { orgId: a.orgId, userId: await n.userId(a.owner), pubIds: [a.pubId, p2], requestId: "audit-b" };
    const rows = await it_.database.withTenant(tenant, (tx) => listAudit(tx, { all: true }, { limit: 10_000 }));
    expect(rows.map((row) => row.id)).toEqual(await idsOf(a.orgId));
    // even a view naming B's publication, and filters naming B's people, find nothing of B
    const named = await it_.database.withTenant(tenant, (tx) =>
      listAudit(tx, { all: false, publications: [b.pubId], actions: ["access.denied"] }, { limit: 10_000 }),
    );
    expect(named).toEqual([]);
    const byActor = await it_.database.withTenant(tenant, async (tx) =>
      listAudit(tx, { all: true }, { limit: 10_000, actor: P("bViewer").id }),
    );
    expect(byActor).toEqual([]);
    // B's event is not a cursor of A's
    const { rows: bRows } = await su.query<{ id: string; at: string }>(
      `select id, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at from app.audit_event
       where org_id = $1 limit 1`,
      [b.orgId],
    );
    const bEvent = bRows[0] as { id: string; at: string };
    expect(await it_.database.withTenant(tenant, (tx) => isAuditCursor(tx, { all: true }, bEvent))).toBe(false);
  });
});

describe("the read wall (migration 2026_11_26_0001)", () => {
  it("lets a transaction read only its publications' events and the organisation's own, whatever the view says", async () => {
    const userId = await n.userId(a.owner);
    const read = (pubIds: string[]) =>
      it_.database.withTenant({ orgId: a.orgId, userId, pubIds, requestId: "wall" }, async (tx) =>
        (await listAudit(tx, { all: true }, { limit: 10_000 })).map((row) => row.id),
      );
    const firstOnly = await read([a.pubId]);
    expect(firstOnly).toEqual(await idsOf(a.orgId, `publication_id is null or publication_id = '${a.pubId}'`));
    expect(firstOnly).not.toEqual(await idsOf(a.orgId)); // the second publication's refusal is hidden
    expect(await read([])).toEqual(await idsOf(a.orgId, "publication_id is null"));
    expect(await read([a.pubId, p2])).toEqual(await idsOf(a.orgId)); // Owner and Admin reach every publication
  });
});

describe("(c) the audit endpoint across organisations", () => {
  it("answers 404 for another organisation's id, and filters naming its people or publication find nothing", async () => {
    expect((await call("GET", auditUrl(b), a.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", auditUrl(a), b.ownerCookie)).statusCode).toBe(404);
    const bEvents = await idsOf(b.orgId);
    for (const query of [
      "",
      `?actor=${P("bViewer").id}`,
      `?actor=${await n.userId(b.owner)}`,
      `?publication=${b.pubId}`,
      `?target=organization:${b.orgId}`,
      "?action=access.denied",
      "?limit=200",
    ]) {
      const res = await call("GET", auditUrl(a, query), a.ownerCookie);
      expect(res.statusCode, query).toBe(200);
      const ids = (res.json() as Page).items.map((item) => item.id);
      expect(
        ids.filter((id) => bEvents.includes(id)),
        query,
      ).toEqual([]);
    }
    expect((await call("GET", auditUrl(a, `?publication=${b.pubId}`), a.ownerCookie)).json().items).toEqual([]);
  });

  it("refuses a cursor from another organisation (400), and one naming no event", async () => {
    const bPage = (await call("GET", auditUrl(b, "?limit=1"), b.ownerCookie)).json() as Page;
    expect(bPage.nextCursor).not.toBeNull();
    const res = await call("GET", auditUrl(a, `?cursor=${bPage.nextCursor}`), a.ownerCookie);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
    const made = Buffer.from(JSON.stringify(["2030-01-01T00:00:00.000000Z", randomUUID()])).toString("base64url");
    expect((await call("GET", auditUrl(a, `?cursor=${made}`), a.ownerCookie)).statusCode).toBe(400);
  });
});

describe("a Chief Editor across publications", () => {
  it("never sees another publication's events, by filter or by cursor", async () => {
    const own = (await call("GET", auditUrl(a, "?limit=200"), P("chief").cookie)).json() as Page;
    expect(own.items.every((item) => item.publicationId === a.pubId)).toBe(true);
    const p2Events = await idsOf(a.orgId, `publication_id = '${p2}'`);
    expect(p2Events.length).toBeGreaterThan(0); // the Viewer's refusal on the second publication
    expect(own.items.filter((item) => p2Events.includes(item.id))).toEqual([]);
    // asking for the other publication finds nothing
    const asked = (await call("GET", auditUrl(a, `?publication=${p2}`), P("chief").cookie)).json() as Page;
    expect(asked.items).toEqual([]);
    // the Owner's cursor at the other publication's event is not the Chief Editor's
    const ownerPage = (await call("GET", auditUrl(a, `?publication=${p2}&limit=1`), a.ownerCookie)).json() as Page;
    const { rows } = await su.query<{ at: string }>(
      `select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at from app.audit_event where id = $1`,
      [ownerPage.items[0]?.id],
    );
    const cursor = Buffer.from(JSON.stringify([rows[0]?.at, ownerPage.items[0]?.id])).toString("base64url");
    expect((await call("GET", auditUrl(a, `?cursor=${cursor}`), a.ownerCookie)).statusCode).toBe(200);
    expect((await call("GET", auditUrl(a, `?cursor=${cursor}`), P("chief").cookie)).statusCode).toBe(400);
  });
});
