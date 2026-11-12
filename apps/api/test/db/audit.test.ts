// The audit log (src/modules/audit, src/db/audit.ts; docs/product/10-l2-newsroom-plan.md §3.4, §5.2; 07 §12's "Audit
// log" row) on a migrated clone, through the API's own routes: refusals name their route's publication; Owner and
// Admin see every event of the organisation, a Chief Editor only their publications' and never an organisation-level
// one, anyone else is refused (and that refusal audited); the filters, each checked (400, never 500), the action
// prefix compared without LIKE; the cursor; the names from the directory, an erased person's included; no-store.
// Every person, organisation and story is fictional.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAudit } from "../../src/db/audit.ts";
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
let p2: string;
const people: Record<string, Person> = {};
const P = (who: string) => people[who] as Person;

type Item = {
  id: string;
  at: string;
  actor: { kind: string; id: string; name: string | null } | null;
  action: string;
  target: { type: string; id: string | null };
  publicationId: string | null;
  requestId: string | null;
  data: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
};

const auditUrl = (query = "", org: Org = a) => `/api/v1/orgs/${org.orgId}/audit${query}`;
const stories = (pub = a.pubId) => `/api/v1/orgs/${a.orgId}/pubs/${pub}/stories`;

/** Every event the person sees, page by page. */
async function everything(cookie: string, query = ""): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;
  do {
    const sep = query ? "&" : "?";
    const res = await call("GET", auditUrl(`${query}${cursor ? `${sep}cursor=${cursor}` : ""}`), cookie);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as { items: Item[]; nextCursor: string | null };
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  p2 = await n.addPublication(a, "Kalpaniknagar Express");
  const on = (role: string, pub = a.pubId) => ({ publicationId: pub, roles: [role], grants: [] });
  for (const [who, grants] of [
    ["chief", [on("chief_editor"), on("reporter", p2)]],
    ["chief2", [on("chief_editor", p2)]],
    ["editor", [on("editor")]],
    ["reporter", [on("reporter")]],
    ["viewer", [on("viewer")]],
  ] as const) {
    people[who] = await n.member(a, [...grants], "member", who);
  }
  people.admin = await n.member(a, [], "admin", "admin");
  // a story deleted on each publication, and a comment edited on the first
  for (const pub of [a.pubId, p2]) {
    const made = await change("POST", stories(pub), a.ownerCookie, { headline: "A fictional story", body: "Text." });
    expect(made.statusCode, made.body).toBe(201);
    expect((await call("DELETE", `${stories(pub)}/${made.json().id}`, a.ownerCookie)).statusCode).toBe(204);
  }
  const s = await change("POST", stories(), P("reporter").cookie, { headline: "Rain (fictional)", body: "Text." });
  const comment = await change("POST", `${stories()}/${s.json().id}/comments`, P("editor").cookie, {
    body: "Shorter?",
  });
  expect(comment.statusCode, comment.body).toBe(201);
  const edited = await call(
    "PATCH",
    `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/comments/${comment.json().id}`,
    P("editor").cookie,
    { body: "Shorter, please?" },
  );
  expect(edited.statusCode, edited.body).toBe(200);
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

describe("refusals", () => {
  it("name the publication of their route: authorize()'s, and the story rules'", async () => {
    // authorize(): a Viewer may not create a story
    const byAccess = await change("POST", stories(), P("viewer").cookie, { headline: "No", body: "Text." });
    expect(byAccess.statusCode).toBe(403);
    // the story rules: a Reporter may not set the desk's fields
    const byRules = await change("POST", stories(), P("reporter").cookie, { headline: "No", body: "T.", priority: 1 });
    expect(byRules.statusCode).toBe(403);
    // an organisation route has no publication
    expect((await call("GET", `/api/v1/orgs/${a.orgId}/members`, P("reporter").cookie)).statusCode).toBe(403);
    const { rows } = await su.query(
      `select actor_id, publication_id, data->>'route' as route from app.audit_event
       where action = 'access.denied' and actor_id = any($1) order by at, id`,
      [[P("viewer").id, P("reporter").id]],
    );
    expect(rows).toEqual([
      { actor_id: P("viewer").id, publication_id: a.pubId, route: "/api/v1/orgs/:o/pubs/:p/stories" },
      { actor_id: P("reporter").id, publication_id: a.pubId, route: "/api/v1/orgs/:o/pubs/:p/stories" },
      { actor_id: P("reporter").id, publication_id: null, route: "/api/v1/orgs/:o/members" },
    ]);
  });
});

describe("who sees what", () => {
  it("Owner: every event of the organisation, newest first, with names, addresses and browsers", async () => {
    const items = await everything(a.ownerCookie);
    const { rows } = await su.query<{ id: string }>(
      "select id from app.audit_event where org_id = $1 order by at desc, id desc",
      [a.orgId],
    );
    expect(items.map((item) => item.id)).toEqual(rows.map((row) => row.id));
    const actions = new Set(items.map((item) => item.action));
    for (const action of ["org.bootstrap", "invitation.create", "invitation.accept", "story.delete", "comment.edit"]) {
      expect(actions, action).toContain(action);
    }
    const bootstrap = items.find((item) => item.action === "org.bootstrap");
    expect(bootstrap).toMatchObject({ actor: null, target: { type: "organization", id: a.orgId } });
    const refusal = items.find((item) => item.action === "access.denied" && item.actor?.id === P("viewer").id);
    expect(refusal).toMatchObject({
      actor: { kind: "user", id: P("viewer").id, name: "viewer (fictional)" },
      target: { type: "route", id: null },
      publicationId: a.pubId,
      data: { permission: "story.create", method: "POST", route: "/api/v1/orgs/:o/pubs/:p/stories" },
      ip: expect.stringMatching(/^198\.18\./),
      userAgent: "lightMyRequest",
      requestId: expect.any(String),
    });
    expect(Date.parse(refusal?.at ?? "")).not.toBeNaN();
  });

  it("Admin: the same as the Owner", async () => {
    const owner = await everything(a.ownerCookie, "?action=story.delete");
    const admin = await everything(P("admin").cookie, "?action=story.delete");
    expect(admin).toEqual(owner);
    expect(admin).toHaveLength(2);
    const refusals = await everything(P("admin").cookie, "?action=access.denied");
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.every((item) => item.ip !== null && item.userAgent !== null)).toBe(true);
  });

  it("Chief Editor: only their publications' events, never an organisation-level one, without address or browser", async () => {
    // an action not in the catalogue is never shown to them, even on their publication
    await su.query(
      `insert into app.audit_event (org_id, publication_id, actor_kind, action, target_type)
       values ($1, $2, 'system', 'test.unlisted', 'thing')`,
      [a.orgId, a.pubId],
    );
    const items = await everything(P("chief").cookie);
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((item) => item.publicationId))).toEqual(new Set([a.pubId]));
    const actions = new Set(items.map((item) => item.action));
    const DESK = ["access.denied", "story.create", "story.delete", "comment.create", "comment.edit"];
    expect(actions).toEqual(new Set(DESK));
    // org.bootstrap names the first publication, yet is the organisation's
    expect(actions).not.toContain("org.bootstrap");
    expect(items.every((item) => item.ip === null && item.userAgent === null)).toBe(true);
    const { rows } = await su.query<{ id: string }>(
      `select id from app.audit_event where org_id = $1 and publication_id = $2
       and action = any($3) order by at desc, id desc`,
      [a.orgId, a.pubId, DESK],
    );
    expect(items.map((item) => item.id)).toEqual(rows.map((row) => row.id));
    // the other publication's Chief Editor sees its story's deletion only
    const other = await everything(P("chief2").cookie);
    expect(other.map((item) => [item.action, item.publicationId])).toEqual([
      ["story.delete", p2],
      ["story.create", p2],
    ]);
  });

  it("anyone else: 403, and the refusal is audited", async () => {
    for (const who of ["editor", "reporter", "viewer"]) {
      const res = await call("GET", auditUrl(), P(who).cookie);
      expect(res.statusCode, who).toBe(403);
      expect(res.json().error.code).toBe("not_allowed");
    }
    const { rows } = await su.query(
      `select count(*)::int as n from app.audit_event
       where action = 'access.denied' and data->>'permission' = 'audit.view' and publication_id is null`,
    );
    expect(rows).toEqual([{ n: 3 }]);
    // a non-member: 404, as for an organisation that does not exist
    const outsider = await n.organisation();
    expect((await call("GET", auditUrl(), outsider.ownerCookie)).statusCode).toBe(404);
  });

  it("answers no-store", async () => {
    const res = await call("GET", auditUrl(), a.ownerCookie);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("the filters", () => {
  it("by actor, exact action, action prefix, target, publication, and time", async () => {
    const reporter = await everything(a.ownerCookie, `?actor=${P("reporter").id}`);
    expect(reporter.length).toBeGreaterThan(0);
    expect(reporter.every((item) => item.actor?.id === P("reporter").id)).toBe(true);
    const invitations = await everything(a.ownerCookie, "?action=invitation.");
    expect(invitations.length).toBeGreaterThan(0);
    expect(invitations.every((item) => item.action.startsWith("invitation."))).toBe(true);
    const created = await everything(a.ownerCookie, "?action=invitation.create");
    expect(created.length).toBe(6); // the six members
    const one = created[0];
    const byTarget = await everything(a.ownerCookie, `?target=invitation:${one?.target.id}`);
    expect(byTarget.map((item) => item.action).sort()).toEqual(["invitation.accept", "invitation.create"]);
    expect((await everything(a.ownerCookie, "?target=comment")).every((item) => item.target.type === "comment")).toBe(
      true,
    );
    const second = await everything(a.ownerCookie, `?publication=${p2}`);
    expect(second.map((item) => item.action)).toEqual(["story.delete", "story.create"]);
    // from inclusive, to exclusive
    const all = await everything(a.ownerCookie);
    const middle = all[Math.floor(all.length / 2)] as Item;
    const { rows } = await su.query<{ at: string }>(
      `select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at from app.audit_event where id = $1`,
      [middle.id],
    );
    const at = rows[0]?.at ?? "";
    const from = await everything(a.ownerCookie, `?from=${at}`);
    const to = await everything(a.ownerCookie, `?to=${at}`);
    expect(from.map((item) => item.id)).toContain(middle.id);
    expect(to.map((item) => item.id)).not.toContain(middle.id);
    expect(from.length + to.length).toBe(all.length);
    // an offset is a time too, up to the ±15:59 Postgres takes
    expect(await everything(a.ownerCookie, "?from=2999-01-01T05:30:00%2B05:30")).toEqual([]);
    expect(await everything(a.ownerCookie, "?from=2999-01-01T05:30:00%2B15:59")).toEqual([]);
    expect(await everything(a.ownerCookie, "?to=1999-01-01T05:30:00-15:59")).toEqual([]);
    // a limit written plainly
    expect((await call("GET", auditUrl("?limit=5"), a.ownerCookie)).json().items).toHaveLength(5);
  });

  it("compares a prefix as text, not as a LIKE pattern (no wildcard in _)", async () => {
    // the route takes catalogued actions only (none has a _ before its dot), so the query is asked directly
    await su.query(
      `insert into app.audit_event (org_id, actor_kind, action, target_type)
       values ($1, 'system', 'a_b.made', 'thing'), ($1, 'system', 'axb.made', 'thing')`,
      [a.orgId],
    );
    const tenant = { orgId: a.orgId, userId: await n.userId(a.owner), pubIds: [a.pubId, p2], requestId: "like" };
    const actions = (action: string) =>
      it_.database.withTenant(tenant, async (tx) =>
        (await listAudit(tx, { all: true }, { limit: 100, action })).map((row) => row.action),
      );
    expect(await actions("a_b.")).toEqual(["a_b.made"]);
    expect(await actions("a_b.made")).toEqual(["a_b.made"]);
  });

  it("refuses a filter that is not well formed with 400, never 500", async () => {
    for (const query of [
      "?actor=someone",
      "?action=story", // neither an action nor a prefix ending in a dot
      "?action=story.%25",
      "?action=%25",
      "?action=story.*",
      "?action=STORY.",
      "?action=story..",
      `?action=${"a".repeat(101)}.`,
      "?target=story:nope",
      "?target=Story",
      "?target=story%3B%20drop%20table%20app.audit_event",
      "?publication=p2",
      "?from=yesterday",
      "?to=2026-11-01", // a date is not a time
      "?from=0000-01-01T00:00:00Z", // Postgres has no year 0
      "?to=2026-02-29T00:00:00Z",
      "?from=2026-01-01T00:00:00%2B16:00", // Postgres takes offsets up to ±15:59 (it would fail as 500)
      "?to=2026-01-01T00:00:00-16:00",
      "?from=2026-01-01T00:00:00%2B23:59",
      "?action=story.creat", // not in the catalogue: refused, never an empty list
      "?action=zzz.",
      "?action=test.filler",
      "?action=story.create.",
      "?limit=0",
      "?limit=201",
      "?limit=ten",
      "?limit=0x10", // only plain decimal digits
      "?limit=1e2",
      "?limit=%2B5",
      "?limit=5.0",
      "?limit=%205",
      "?limit=-1",
      "?cursor=nope",
      `?cursor=${Buffer.from(JSON.stringify(["2026-11-01T00:00:00.000000Z", randomUUID()])).toString("base64url")}`,
      `?actor=${randomUUID()}&actor=${randomUUID()}`,
      "?who=me",
    ]) {
      const res = await call("GET", auditUrl(query), a.ownerCookie);
      expect(res.statusCode, `${query}: ${res.body}`).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
    }
  });
});

describe("the cursor", () => {
  it("pages newest first, at most 200 a page and 50 by default, without gaps or repeats", async () => {
    const all = await everything(a.ownerCookie);
    expect(all.length).toBeGreaterThan(3);
    const first = await call("GET", auditUrl("?limit=2"), a.ownerCookie);
    const page = first.json() as { items: Item[]; nextCursor: string };
    expect(page.items.map((item) => item.id)).toEqual(all.slice(0, 2).map((item) => item.id));
    const next = await call("GET", auditUrl(`?limit=2&cursor=${page.nextCursor}`), a.ownerCookie);
    expect(next.json().items.map((item: Item) => item.id)).toEqual(all.slice(2, 4).map((item) => item.id));
    const ats = all.map((item) => Date.parse(item.at));
    expect([...ats].sort((x, y) => y - x)).toEqual(ats);
    // 50 by default
    await su.query(
      `insert into app.audit_event (org_id, actor_kind, action, target_type)
       select $1, 'system', 'test.filler', 'thing' from generate_series(1, 60)`,
      [a.orgId],
    );
    const byDefault = (await call("GET", auditUrl(), a.ownerCookie)).json();
    expect(byDefault.items).toHaveLength(50);
    expect(byDefault.nextCursor).not.toBeNull();
    expect((await call("GET", auditUrl("?limit=200"), a.ownerCookie)).json().items.length).toBeLessThanOrEqual(200);
    // a Chief Editor's cursor of an event they do not see is refused (the Owner's list holds organisation events)
    const owners = (await call("GET", auditUrl("?action=invitation.create&limit=1"), a.ownerCookie)).json();
    expect(owners.nextCursor).not.toBeNull();
    expect((await call("GET", auditUrl(`?cursor=${owners.nextCursor}`), P("chief").cookie)).statusCode).toBe(400);
  });
});

describe("the indexes", () => {
  it("serve the actor filter and a publication's events (a Chief Editor's view, the publication filter)", async () => {
    const { rows } = await su.query<{ name: string; def: string }>(
      `select indexname as name, regexp_replace(indexdef, '^.* USING btree ', '') as def from pg_indexes
       where schemaname = 'app' and tablename = 'audit_event' and indexname like 'audit_event_by_%' order by 1`,
    );
    expect(rows).toEqual([
      { name: "audit_event_by_actor", def: "(org_id, actor_id, at DESC)" },
      { name: "audit_event_by_org", def: "(org_id, at DESC)" },
      { name: "audit_event_by_publication", def: "(org_id, publication_id, at DESC)" },
    ]);
  });
});

describe("names", () => {
  it("come from the directory when shown: an erased person's is the replaced one", async () => {
    const leaver = await n.member(a, [{ publicationId: a.pubId, roles: ["viewer"], grants: [] }], "member", "leaver");
    expect((await change("POST", stories(), leaver.cookie, { headline: "No", body: "T." })).statusCode).toBe(403);
    const before = await everything(a.ownerCookie, `?actor=${leaver.id}`);
    expect(before.map((item) => item.actor?.name)).toEqual(["leaver (fictional)", "leaver (fictional)"]);
    await su.query(
      "update app.person set display_name = 'Erased person', email = null where org_id = $1 and user_id = $2",
      [a.orgId, leaver.id],
    );
    const after = await everything(a.ownerCookie, `?actor=${leaver.id}`);
    expect(after.map((item) => item.actor?.name)).toEqual(["Erased person", "Erased person"]);
    // the stored rows hold ids only, never the name
    const { rows } = await su.query("select count(*)::int as n from app.audit_event where data::text like $1", [
      "%leaver (fictional)%",
    ]);
    expect(rows).toEqual([{ n: 0 }]);
  });
});
