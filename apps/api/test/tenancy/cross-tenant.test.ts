// (b) The cross-tenant generator (docs/product/10-l2-newsroom-plan.md §4.8): with two fictional organisations seeded
// in every app table, each organisation reads and writes only its own rows, as pgn_app. Then the same checks on a
// clone with planted leaks, which they must each report.
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURES, type Fixture } from "../db/fixtures.ts";
import { freshDatabase } from "../db/helpers.ts";
import { crossTenantProblems } from "./checks.ts";

const db = await freshDatabase();
const planted = await freshDatabase();
afterAll(async () => {
  await db.drop();
  await planted.drop();
});

describe("(b) across tenants", () => {
  it("every app table keeps each organisation to its own rows", async () => {
    expect(await crossTenantProblems(db)).toEqual([]);
  });

  it("has a fixture for every app table, so none is skipped", async () => {
    const su = await db.connect("postgres");
    const { rows } = await su.query<{ name: string }>(
      "select relname as name from pg_class where relnamespace = 'app'::regnamespace and relkind in ('r', 'p')",
    );
    expect(FIXTURES.map((fixture) => fixture.table).sort()).toEqual(rows.map((row) => row.name).sort());
  });

  it("reports every planted leak", async () => {
    const owner = await planted.connect("migrator");
    await owner.query("set role pgn_owner");
    const walls = (table: string) => `
      alter table app.${table} enable row level security;
      alter table app.${table} force row level security;
      create policy org_wall on app.${table}
        using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));`;
    await owner.query(`
      create table app.planted_leak (org_id uuid not null);
      ${walls("planted_leak")}
      create policy everyone on app.planted_leak using (true);
      grant select, insert, update, delete on app.planted_leak to pgn_app;

      create table app.planted_story (org_id uuid not null, publication_id uuid not null);
      ${walls("planted_story")}
      create table app.planted_story_ok (org_id uuid not null, publication_id uuid not null);
      ${walls("planted_story_ok")}
      create policy pub_wall on app.planted_story_ok as restrictive
        using (publication_id = any ((select app.current_pubs())::uuid[]))
        with check (publication_id = any ((select app.current_pubs())::uuid[]));
      grant select, insert on app.planted_story, app.planted_story_ok to pgn_app;

      create table app.planted_unlisted (org_id uuid not null);
      ${walls("planted_unlisted")}

      -- a content table whose publication_id may be null, with only the organisation wall
      create table app.planted_story_nullable (org_id uuid not null, publication_id uuid);
      ${walls("planted_story_nullable")}
      grant select, insert on app.planted_story_nullable to pgn_app;

      -- a table outside app that pgn_app may read (a reviewer's plant)
      create schema reporting;
      grant usage on schema reporting to pgn_app;
      create table reporting.people (org_id uuid not null, display_name text not null);
      grant select on reporting.people to pgn_app;
    `);
    const story = (table: string): Fixture => ({
      table,
      per: "publication",
      row: (org, pub) => ({ org_id: org.id, publication_id: pub.id }),
    });
    const fixtures: Fixture[] = [
      ...FIXTURES,
      { table: "planted_leak", per: "org", row: (org) => ({ org_id: org.id }) },
      story("planted_story"),
      story("planted_story_ok"),
      story("planted_story_nullable"),
    ];
    const a = "Kalpaniknagar Media (fictional)";
    const b = "Example Press B";
    const leak = (me: string, other: string) => [
      `app.planted_leak: under ${me}, 1 row(s) of ${other} can be read`,
      `app.planted_leak: under ${me}, writing a row of ${other} was allowed (1 row(s))`,
      `app.planted_leak: under ${me}, moving its rows to ${other} was allowed (1 row(s))`,
      `app.planted_leak: under ${me}, updating ${other}'s rows was allowed (1 row(s))`,
      `app.planted_leak: under ${me}, deleting ${other}'s rows was allowed (1 row(s))`,
    ];
    const noPubWall = (table: string) => [
      `app.${table}: a user of काल्पनिकनगर वार्ता only can read 1 row(s) of Kalpaniknagar Express`,
      `app.${table}: a user of काल्पनिकनगर वार्ता only, writing a row of Kalpaniknagar Express, was allowed (1 row(s))`,
      `app.${table}: a user of no publication can read 2 row(s)`,
    ];
    expect(await crossTenantProblems(planted, fixtures)).toEqual([
      "reporting.people: pgn_app can reach it outside app, so it is not checked",
      ...leak(a, b),
      ...leak(b, a),
      "app.planted_leak: outside withTenant, 2 row(s) can be read",
      ...noPubWall("planted_story"),
      ...noPubWall("planted_story_nullable"),
      "app.planted_unlisted has no fixture (test/db/fixtures.ts), so it cannot be checked",
    ]);
  });
});
