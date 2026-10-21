// (a) The catalog meta-test (docs/product/10-l2-newsroom-plan.md §4.8): row-level security on every app table, the
// roles, what they own and what they may do, read from the migrated schema. Then the same checks on a clone with
// planted defects, which they must each report. (Roles belong to the whole server, so no role defect is planted.)
import { afterAll, describe, expect, it } from "vitest";
import { freshDatabase } from "../db/helpers.ts";
import { APP_RIGHTS, catalogProblems } from "./checks.ts";

const db = await freshDatabase();
const planted = await freshDatabase();
afterAll(async () => {
  await db.drop();
  await planted.drop();
});

const walls = (table: string) => `
  alter table app.${table} enable row level security;
  alter table app.${table} force row level security;
  create policy org_wall on app.${table}
    using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));`;
const pubWall = (table: string) => `
  create policy pub_wall on app.${table} as restrictive
    using (publication_id = any ((select app.current_pubs())::uuid[]))
    with check (publication_id = any ((select app.current_pubs())::uuid[]));`;

describe("(a) the catalog", () => {
  it("finds no problem in the migrated schema", async () => {
    expect(await catalogProblems(await db.connect("postgres"))).toEqual([]);
  });

  it("reports every planted defect", async () => {
    const owner = await planted.connect("migrator");
    await owner.query("set role pgn_owner"); // as a migration would
    await owner.query(`
      create table app.planted_unforced (org_id uuid not null);
      alter table app.planted_unforced enable row level security;
      create policy org_wall on app.planted_unforced
        using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
      grant update (org_id) on app.planted_unforced to pgn_engine;

      create table app.planted_leak (org_id uuid not null);
      ${walls("planted_leak")}
      create policy everyone on app.planted_leak using (true);

      create table app.planted_story (org_id uuid not null, publication_id uuid not null);
      ${walls("planted_story")}

      create table app.planted_story_ok (org_id uuid not null, publication_id uuid not null);
      ${walls("planted_story_ok")}
      ${pubWall("planted_story_ok")}

      create table app.planted_no_org (id integer);
      create view app.planted_view as select org_id from app.person;
      grant select on app.person to pgn_engine;
      create sequence app.planted_seq;
      grant usage on sequence app.planted_seq to pgn_engine;

      -- the identity zone: a table whose rights nobody listed, and a grant to a role that may not use the schema
      create table identity.planted_unlisted (id integer);
      grant select on identity.session to pgn_app;

      create function app.planted_definer() returns integer
        language sql security definer set search_path = pg_catalog return 1;
      create function app.planted_open() returns integer language sql return 1;
      grant execute on function app.planted_open() to public;

      -- a content table whose publication_id may be null, with only the organisation wall
      create table app.planted_story_nullable (org_id uuid not null, publication_id uuid);
      ${walls("planted_story_nullable")}
      grant select on app.planted_unforced, app.planted_leak, app.planted_story, app.planted_story_ok,
        app.planted_story_nullable to pgn_app;

      -- a schema of its own (a reviewer's plant): pgn_app may use it and PUBLIC create in it; it holds a table without
      -- walls, and a SECURITY DEFINER function that empties every organisation's people
      create schema reporting;
      grant usage on schema reporting to pgn_app;
      grant create on schema reporting to public;
      create table reporting.people (org_id uuid not null, display_name text not null);
      grant select on reporting.people to pgn_app;
      create function reporting.wipe_people() returns void language plpgsql security definer
        set search_path = pg_catalog as $fn$ begin truncate app.person; end $fn$;
      grant execute on function reporting.wipe_people() to pgn_app;
    `);
    const rights = {
      ...APP_RIGHTS,
      planted_unforced: ["SELECT"],
      planted_leak: ["SELECT"],
      planted_story: ["SELECT"],
      planted_story_ok: ["SELECT"],
      planted_story_nullable: ["SELECT"],
    };
    // what PUBLIC may do, every role may do
    const everyone = ["pgn_migrator", "pgn_app", "pgn_auth", "pgn_engine", "pgn_listen", "public"];
    const mayCreate = (role: string) => `${role} may create objects in schema reporting`;
    expect(await catalogProblems(await planted.connect("postgres"), { rights })).toEqual([
      "schema reporting is not one of ours (app, identity, queue, migrations, public)",
      "app.planted_view is a relation of kind v, not a table",
      "app.planted_leak: the permissive policy everyone widens the organisation wall",
      "app.planted_no_org has no org_id column (uuid, not null)",
      "app.planted_no_org: row-level security is off",
      "app.planted_no_org lacks the organisation wall (policy org_wall)",
      "app.planted_no_org: pgn_app's rights on it are not listed (test/tenancy/checks.ts)",
      "app.planted_story is a content table without the publication wall (restrictive policy pub_wall)",
      "app.planted_story_nullable is a content table without the publication wall (restrictive policy pub_wall)",
      "app.planted_unforced: row-level security is not forced, so its owner would pass the walls",
      "app.person: pgn_engine has SELECT, not none",
      "app.planted_seq: pgn_engine has USAGE, not none",
      "identity.planted_unlisted: pgn_auth's rights on it are not listed (test/tenancy/checks.ts)",
      "identity.session: pgn_app has SELECT, not none",
      "reporting.people: pgn_app has SELECT, not none",
      "app.planted_unforced has column-level grants",
      mayCreate("pgn_migrator"),
      "pgn_app may use the schemas app, reporting",
      ...everyone.slice(1).map(mayCreate),
      "app.planted_definer() runs with its owner's rights (SECURITY DEFINER)",
      "app.planted_open() does not set its search_path",
      `app.planted_open() may be executed by ${[...everyone.slice(1, 5), "pgn_migrator", "public"].join(", ")}`,
      "reporting.wipe_people() runs with its owner's rights (SECURITY DEFINER)",
      "reporting.wipe_people() may be executed by pgn_app",
    ]);
  });
});
