// withTenant (src/db/tenant.ts) on a migrated clone, as pgn_app: the context it sets, that the context ends with the
// transaction, what it refuses before sending anything, and the organisation wall seen through it.
import { Kysely, PostgresDialect, type Selectable, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/pools.ts";
import type { AppPublication, DB } from "../../src/db/schema.gen.ts";
import { type Tenant, TenantError, TransactionAbortedError, withTenant } from "../../src/db/tenant.ts";
import { ORG_A, ORG_B, seed } from "./fixtures.ts";
import { freshDatabase } from "./helpers.ts";

const db = await freshDatabase();
// one connection, so that a later query surely runs where the tenant's transaction ran
const pool = new Pool({
  host: db.settings.host,
  port: db.settings.port,
  database: db.name,
  user: "pgn_app",
  password: db.settings.passwords.app,
  max: 1,
});
const queries: string[] = [];
const kysely = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
  log: (event) => void queries.push(event.query.sql),
});
const database = openDatabase(db.settings);
afterAll(async () => {
  await kysely.destroy();
  await database.close();
  await db.drop();
});
beforeAll(async () => {
  await seed(await db.connect("postgres"));
});

const A: Tenant = { orgId: ORG_A.id, userId: ORG_A.user, pubIds: ORG_A.pubs.map((p) => p.id), requestId: "req-a" };

const context = sql<{ org: string | null; user: string | null; pubs: string[]; request: string }>`
  select app.current_org() as org, app.current_user() as user, app.current_pubs()::text[] as pubs,
    current_setting('app.request_id', true) as request`;

describe("withTenant", () => {
  it("sets the tenant's context for its transaction only", async () => {
    const inside = await withTenant(kysely, A, async (tx) => (await context.execute(tx)).rows[0]);
    expect(inside).toEqual({ org: ORG_A.id, user: ORG_A.user, pubs: A.pubIds, request: "req-a" });
    // the same connection, after the transaction: nothing is left
    expect((await context.execute(kysely)).rows[0]).toEqual({ org: null, user: null, pubs: [], request: "" });
  });

  it("rolls back when fn fails, and leaves no context", async () => {
    await expect(
      withTenant(kysely, A, async (tx) => {
        await tx
          .insertInto("app.person")
          .values({ org_id: ORG_A.id, user_id: ORG_B.user, display_name: "x" })
          .execute();
        throw new Error("planted failure");
      }),
    ).rejects.toThrow("planted failure");
    const people = await withTenant(kysely, A, (tx) => tx.selectFrom("app.person").select("user_id").execute());
    expect(people).toEqual([{ user_id: ORG_A.user }]);
    expect((await context.execute(kysely)).rows[0]?.org).toBeNull();
  });

  it("rejects when fn caught a failed statement and returned: Postgres saved nothing, so it must not look saved", async () => {
    const newcomer = "01900000-0000-7000-8000-000000000a09";
    const write = withTenant(kysely, A, async (tx) => {
      await tx.insertInto("app.person").values({ org_id: ORG_A.id, user_id: newcomer, display_name: "x" }).execute();
      await sql`select 1 / 0`.execute(tx).catch(() => undefined); // caught, and fn goes on
      return "fn finished";
    });
    await expect(write).rejects.toThrow(TransactionAbortedError);
    const people = await withTenant(kysely, A, (tx) =>
      tx.selectFrom("app.person").select("user_id").where("user_id", "=", newcomer).execute(),
    );
    expect(people).toEqual([]);
  });

  it("keeps fn's writes when it recovers from an expected failure in a savepoint", async () => {
    const newcomer = "01900000-0000-7000-8000-000000000a10";
    const result = await withTenant(kysely, A, async (tx) => {
      await tx.insertInto("app.person").values({ org_id: ORG_A.id, user_id: newcomer, display_name: "x" }).execute();
      await sql`savepoint attempt`.execute(tx);
      try {
        await sql`select 1 / 0`.execute(tx);
      } catch {
        await sql`rollback to savepoint attempt`.execute(tx);
      }
      return "fn finished";
    });
    expect(result).toBe("fn finished");
    const people = await withTenant(kysely, A, (tx) =>
      tx.selectFrom("app.person").select("user_id").where("user_id", "=", newcomer).execute(),
    );
    expect(people).toEqual([{ user_id: newcomer }]);
  });

  it("gives an empty publication list as an empty array", async () => {
    const pubs = await withTenant(
      kysely,
      { ...A, pubIds: [] },
      async (tx) => (await context.execute(tx)).rows[0]?.pubs,
    );
    expect(pubs).toEqual([]);
  });

  it.each([
    [{ orgId: "kalpaniknagar" }, "orgId"],
    [{ userId: "" }, "userId"],
    [{ pubIds: [`${ORG_A.pubs[0].id},${ORG_B.pubs[0].id}`] }, "pubIds"],
    [{ pubIds: [`${ORG_A.pubs[0].id}}`] }, "pubIds"],
    [{ requestId: "has spaces" }, "requestId"],
    [{ orgId: "x", requestId: "" }, "orgId, requestId"],
  ] as const)("refuses %j before sending anything", async (change, names) => {
    queries.length = 0;
    await expect(withTenant(kysely, { ...A, ...change }, async () => 1)).rejects.toThrow(
      new TenantError(`withTenant was given a malformed ${names}`),
    );
    expect(queries).toEqual([]);
  });
});

describe("the organisation wall, through the API's pools", () => {
  it("shows each organisation only its own rows", async () => {
    const names = (rows: Pick<Selectable<AppPublication>, "name">[]) => rows.map((row) => row.name).sort();
    const read = (tenant: Tenant) =>
      database.withTenant(tenant, (tx) => tx.selectFrom("app.publication").select("name").execute());
    expect(names(await read(A))).toEqual(ORG_A.pubs.map((p) => p.name).sort());
    const B: Tenant = { orgId: ORG_B.id, userId: ORG_B.user, pubIds: [ORG_B.pubs[0].id], requestId: "req-b" };
    expect(names(await read(B))).toEqual([ORG_B.pubs[0].name]);
  });

  it("refuses to write a row of another organisation", async () => {
    const write = database.withTenant(A, (tx) =>
      tx.insertInto("app.person").values({ org_id: ORG_B.id, user_id: ORG_A.user, display_name: "x" }).execute(),
    );
    await expect(write).rejects.toThrow('new row violates row-level security policy for table "person"');
  });

  it("shows nothing outside withTenant", async () => {
    const app = await db.connect("app");
    expect((await app.query("select count(*)::int as n from app.publication")).rows).toEqual([{ n: 0 }]);
  });
});
