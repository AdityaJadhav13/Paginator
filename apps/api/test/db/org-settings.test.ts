// Organization and publication settings (src/modules/settings/routes.ts) on a migrated clone: Owner and Admin rename
// the organisation and add a publication; a Chief Editor changes their publication's settings and may do neither of
// the others; a Viewer changes nothing; each change is audited; another organisation's settings are not reached.
// Every name is fictional.
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
const people: Record<string, Person> = {};

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  for (const role of ["chief_editor", "viewer"]) {
    people[role] = await n.member(a, [{ publicationId: a.pubId, roles: [role], grants: [] }], "member", role);
  }
  people.admin = await n.member(a, [], "admin", "admin");
}, 180_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const org = (o = a) => `/api/v1/orgs/${o.orgId}/settings`;
const pubs = (o = a) => `/api/v1/orgs/${o.orgId}/publications`;
const pub = (o = a, p = o.pubId) => `/api/v1/orgs/${o.orgId}/pubs/${p}/settings`;
const audit = async (action: string) =>
  (
    await su.query(
      "select actor_id, target_id, publication_id, data from app.audit_event where action = $1 and org_id = $2",
      [action, a.orgId],
    )
  ).rows;

describe("organization settings", () => {
  it("the Owner reads the name and the publications; a Chief Editor and a Viewer are refused", async () => {
    const read = await call("GET", org(), a.ownerCookie);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      name: expect.stringContaining("Kalpaniknagar Media"),
      publications: [
        {
          id: a.pubId,
          name: "काल्पनिकनगर वार्ता",
          languages: ["mr", "en"],
          primaryLanguage: "mr",
          timezone: "Asia/Kolkata",
        },
      ],
    });
    for (const who of ["chief_editor", "viewer"]) {
      expect((await call("GET", org(), people[who]!.cookie)).statusCode).toBe(403);
      expect((await call("PATCH", org(), people[who]!.cookie, { name: "Taken over" })).statusCode).toBe(403);
      const add = { name: "Other", languages: ["en"], primaryLanguage: "en" };
      expect((await call("POST", pubs(), people[who]!.cookie, add)).statusCode).toBe(403);
    }
  });

  it("the Admin renames the organisation, audited once; /me shows the new name", async () => {
    const res = await call("PATCH", org(), people.admin!.cookie, { name: "  काल्पनिक माध्यम समूह " });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().name).toBe("काल्पनिक माध्यम समूह");
    // the same name again: no change, no audit row
    expect((await call("PATCH", org(), a.ownerCookie, { name: "काल्पनिक माध्यम समूह" })).statusCode).toBe(200);
    expect(await audit("org.rename")).toEqual([
      { actor_id: people.admin!.id, target_id: a.orgId, publication_id: null, data: { fields: ["name"] } },
    ]);
    const me = (await call("GET", "/api/v1/me", a.ownerCookie)).json();
    expect(me.memberships.find((m: { org: { id: string } }) => m.org.id === a.orgId).org.name).toBe(
      "काल्पनिक माध्यम समूह",
    );
    for (const name of ["  ", "a\nb"])
      expect((await call("PATCH", org(), a.ownerCookie, { name })).statusCode).toBe(400);
  });

  it("the Owner adds a publication: it is listed, the Owner reaches it, and it is audited", async () => {
    const res = await call("POST", pubs(), a.ownerCookie, {
      name: "Kalpaniknagar Evening",
      languages: ["en", "mr"],
      primaryLanguage: "en",
      timezone: "Asia/Kolkata",
    });
    expect(res.statusCode, res.body).toBe(201);
    const added = res.json().publications.find((p: { name: string }) => p.name === "Kalpaniknagar Evening");
    expect(added).toMatchObject({ languages: ["en", "mr"], primaryLanguage: "en", timezone: "Asia/Kolkata" });
    const row = await su.query("select slug, digit_style from app.publication where id = $1", [added.id]);
    expect(row.rows[0]).toEqual({ slug: "kalpaniknagar-evening", digit_style: "latin" });
    expect(await audit("org.publication_add")).toEqual([
      { actor_id: expect.any(String), target_id: added.id, publication_id: added.id, data: { publication: added.id } },
    ]);
    const me = (await call("GET", "/api/v1/me", a.ownerCookie)).json();
    const mine = me.memberships.find((m: { org: { id: string } }) => m.org.id === a.orgId);
    expect(mine.publications.map((p: { id: string }) => p.id)).toContain(added.id);
    // the same name again (any case), a primary outside the languages, an unknown timezone: refused
    for (const body of [
      { name: "kalpaniknagar evening", languages: ["en"], primaryLanguage: "en" },
      { name: "Third", languages: ["en"], primaryLanguage: "mr" },
      { name: "Third", languages: ["en"], primaryLanguage: "en", timezone: "Mars/Olympus" },
      { name: "Third", languages: [], primaryLanguage: "en" },
    ]) {
      expect((await call("POST", pubs(), a.ownerCookie, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    // a Marathi name has no Latin letters: a plain slug, made unique
    const marathi = await call("POST", pubs(), a.ownerCookie, {
      name: "संध्या वार्ता",
      languages: ["mr"],
      primaryLanguage: "mr",
    });
    expect(marathi.statusCode, marathi.body).toBe(201);
    const slug = await su.query("select slug from app.publication where org_id = $1 and name = 'संध्या वार्ता'", [
      a.orgId,
    ]);
    expect(slug.rows[0].slug).toBe("publication");
  });
});

describe("publication settings", () => {
  it("a Chief Editor changes the languages and timezone, audited with the fields; a Viewer may not", async () => {
    expect((await call("GET", pub(), people.viewer!.cookie)).statusCode).toBe(403);
    expect((await call("PATCH", pub(), people.viewer!.cookie, { timezone: "UTC" })).statusCode).toBe(403);
    const res = await call("PATCH", pub(), people.chief_editor!.cookie, {
      languages: ["mr"],
      timezone: "Asia/Dubai",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      id: a.pubId,
      name: "काल्पनिकनगर वार्ता",
      languages: ["mr"],
      primaryLanguage: "mr",
      timezone: "Asia/Dubai",
    });
    expect((await call("GET", pub(), people.chief_editor!.cookie)).json().timezone).toBe("Asia/Dubai");
    // nothing changed: no audit row
    expect((await call("PATCH", pub(), people.chief_editor!.cookie, { languages: ["mr"] })).statusCode).toBe(200);
    expect(await audit("publication.settings_edit")).toEqual([
      {
        actor_id: people.chief_editor!.id,
        target_id: a.pubId,
        publication_id: a.pubId,
        data: { fields: ["languages", "timezone"] },
      },
    ]);
    // the primary language must stay among the languages
    expect((await call("PATCH", pub(), people.chief_editor!.cookie, { languages: ["en"] })).statusCode).toBe(400);
    expect((await call("PATCH", pub(), people.chief_editor!.cookie, { timezone: "Nowhere/Here" })).statusCode).toBe(
      400,
    );
  });

  it("another organisation's settings are not reached, and its own are untouched", async () => {
    expect((await call("GET", org(b), a.ownerCookie)).statusCode).toBe(404);
    expect((await call("PATCH", org(b), a.ownerCookie, { name: "Mine now" })).statusCode).toBe(404);
    expect(
      (await call("POST", pubs(b), a.ownerCookie, { name: "X", languages: ["en"], primaryLanguage: "en" })).statusCode,
    ).toBe(404);
    expect((await call("GET", pub(b), a.ownerCookie)).statusCode).toBe(404);
    expect((await call("PATCH", pub(b), people.chief_editor!.cookie, { timezone: "UTC" })).statusCode).toBe(404);
    // a's publication through b's organisation: not found either
    expect((await call("GET", pub(b, a.pubId), b.ownerCookie)).statusCode).toBe(404);
    const theirs = (await call("GET", org(b), b.ownerCookie)).json();
    expect(theirs.name).not.toBe("Mine now");
    expect(theirs.publications).toHaveLength(1);
    expect(theirs.publications[0].timezone).toBe("Asia/Kolkata");
  });
});
