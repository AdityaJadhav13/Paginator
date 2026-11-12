// A publication's sections on the API's side (packages/contracts/src/sections.ts; migration 2026_11_20_0001): made,
// renamed, moved and archived by the Chief Editor and the Owner, listed to whoever sees the publication,
// one name each among those in use, never deleted (a story keeps its archived section), audited, and walled off from
// another organisation. Every name is fictional.
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
const { call } = n;
let a: Org;
let b: Org;
let chief: Person;
let editor: Person;
let reporter: Person;
const base = (org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/sections`;
const names = (res: { json(): { items: { name: string; archived: boolean }[] } }) =>
  res.json().items.map((s) => (s.archived ? `(${s.name})` : s.name));

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  editor = await n.member(a, as("editor"), "member", "editor");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

describe("sections", () => {
  it("are made by the Chief Editor and the Owner, one name each, in order; listed to whoever sees the publication", async () => {
    const first = await call("POST", base(), chief.cookie, { name: "Example City" });
    expect(first.statusCode, first.body).toBe(201);
    expect((await call("POST", base(), a.ownerCookie, { name: " Example Sport " })).statusCode).toBe(201);
    const twice = await call("POST", base(), chief.cookie, { name: "example CITY" });
    expect([twice.statusCode, twice.json().error.code]).toEqual([409, "section_exists"]);
    expect((await call("POST", base(), editor.cookie, { name: "Example Other" })).statusCode).toBe(403);
    expect((await call("POST", base(), chief.cookie, { name: "  " })).statusCode).toBe(400);
    const seen = await call("GET", base(), editor.cookie);
    expect(names(seen)).toEqual(["Example City", "Example Sport"]);
    expect(seen.json().items[0]).toMatchObject({ archived: false, stories: 0 });
    expect((await call("GET", base(), reporter.cookie)).statusCode).toBe(200);
    expect((await call("POST", base(), reporter.cookie, { name: "Example Other" })).statusCode).toBe(403);
    expect((await call("GET", base(b), b.ownerCookie)).json().items).toEqual([]);
    const audit = await su.query(
      "select data from app.audit_event where action = 'section.create' and org_id = $1 order by at",
      [a.orgId],
    );
    expect(audit.rows.map((r) => r.data.name)).toEqual(["Example City", "Example Sport"]);
  });

  it("are renamed and moved; archived, never deleted (a story keeps it); brought back last", async () => {
    const third = await call("POST", base(), chief.cookie, { name: "Example World" });
    expect(names(third)).toEqual(["Example City", "Example Sport", "Example World"]);
    const [city, sport, world] = third.json().items.map((s: { id: string }) => s.id);
    const moved = await call("PATCH", `${base()}/${world}`, chief.cookie, { position: 0, name: "Example Nation" });
    expect(names(moved)).toEqual(["Example Nation", "Example City", "Example Sport"]);
    expect(names(await call("PATCH", `${base()}/${world}`, chief.cookie, { position: 99 }))).toEqual([
      "Example City",
      "Example Sport",
      "Example Nation",
    ]);
    const taken = await call("PATCH", `${base()}/${sport}`, chief.cookie, { name: "example city" });
    expect([taken.statusCode, taken.json().error.code]).toEqual([409, "section_exists"]);

    const story = await n.change("POST", `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories`, chief.cookie, {
      headline: "Example headline",
      sectionId: city,
    });
    expect(story.statusCode, story.body).toBe(201);

    const archived = await call("PATCH", `${base()}/${city}`, chief.cookie, { archived: true });
    expect(names(archived)).toEqual(["Example Sport", "Example Nation", "(Example City)"]);
    expect(archived.json().items[2]).toMatchObject({ stories: 1 });
    const kept = await su.query("select section_id from app.story where id = $1", [story.json().id]);
    expect(kept.rows[0]?.section_id).toBe(city);
    // its name is free again; bringing it back then meets the new one's
    expect((await call("POST", base(), chief.cookie, { name: "Example City" })).statusCode).toBe(201);
    expect((await call("PATCH", `${base()}/${city}`, chief.cookie, { archived: false })).statusCode).toBe(409);
    const back = await call("PATCH", `${base()}/${city}`, chief.cookie, { archived: false, name: "Example Town" });
    expect(names(back)).toEqual(["Example Sport", "Example Nation", "Example City", "Example Town"]);

    expect((await call("PATCH", `${base()}/${sport}`, editor.cookie, { name: "x" })).statusCode).toBe(403);
    expect((await call("PATCH", `${base()}/${sport}`, chief.cookie, {})).statusCode).toBe(400);
    expect((await call("PATCH", `${base(b)}/${sport}`, b.ownerCookie, { name: "Example Taken" })).statusCode).toBe(404);
    expect((await call("PATCH", `${base()}/not-an-id`, chief.cookie, { name: "x" })).statusCode).toBe(404);
    const edits = await su.query(
      "select data from app.audit_event where action = 'section.edit' and target_id = $1 order by at",
      [city],
    );
    expect(edits.rows.map((r) => r.data.fields)).toEqual([["archived"], ["name", "archived"]]);
  });
});
