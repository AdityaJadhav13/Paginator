// The API's pools (src/db/pools.ts) on a migrated clone: each signs in as its own role, the readiness check, the
// LISTEN connection, closing, and connections that fail, idle or in use (none may stop the process).
import { sql } from "kysely";
import type { Notification } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { type Database, type Role, openDatabase } from "../../src/db/pools.ts";
import type { Tenant } from "../../src/db/tenant.ts";
import { ORG_A } from "./fixtures.ts";
import { freshDatabase } from "./helpers.ts";

const db = await freshDatabase();
const opened: Database[] = [];
afterAll(async () => {
  await Promise.all(opened.map((database) => database.close()));
  await db.drop();
});

function open(passwords: Partial<typeof db.settings.passwords> = {}, port = db.settings.port): Database {
  const database = openDatabase({ ...db.settings, port, passwords: { ...db.settings.passwords, ...passwords } });
  opened.push(database);
  return database;
}

const A: Tenant = { orgId: ORG_A.id, userId: ORG_A.user, pubIds: [], requestId: "req-pools" };

/** Waits until ok() holds, polling (the error of a connection arrives on its own, after the event that caused it). */
async function until(ok: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let tries = 0; !(await ok()); tries += 1) {
    if (tries > 100) throw new Error(`waited 5 s for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A database whose connection errors are collected. */
function watched(): { database: Database; failures: [Role, string][] } {
  const database = open();
  const failures: [Role, string][] = [];
  database.onConnectionError((role, error) => void failures.push([role, error.message]));
  return { database, failures };
}

const one = (database: Database) =>
  database.withTenant(A, async (tx) => (await sql<{ n: number }>`select 1 as n`.execute(tx)).rows[0]?.n);

describe("the API's pools", () => {
  it("sign in as pgn_app, pgn_auth and pgn_listen, named for what they are", async () => {
    const database = open();
    const app = await database.withTenant(
      A,
      async (tx) =>
        (
          await sql<{ who: string; name: string }>`
      select current_user as who, current_setting('application_name') as name`.execute(tx)
        ).rows[0],
    );
    expect(app).toEqual({ who: "pgn_app", name: "pageinator-api app" });
    const auth = await database.auth.query("select current_user as who, current_setting('application_name') as name");
    expect(auth.rows[0]).toEqual({ who: "pgn_auth", name: "pageinator-api auth" });
    const listener = database.listener();
    await listener.connect();
    try {
      expect((await listener.query("select current_user as who")).rows[0]).toEqual({ who: "pgn_listen" });
    } finally {
      await listener.end();
    }
  });

  it("set the timeouts that keep a query or an open transaction from holding on for ever", async () => {
    const settings = await open().withTenant(
      A,
      async (tx) =>
        (
          await sql<{ statement: string; idle: string }>`
      select current_setting('statement_timeout') as statement,
        current_setting('idle_in_transaction_session_timeout') as idle`.execute(tx)
        ).rows[0],
    );
    expect(settings).toEqual({ statement: "30s", idle: "1min" });
  });

  it("ping: true when both pools answer, false (not an error) when one cannot sign in or the server is away", async () => {
    expect(await open().ping()).toBe(true);
    expect(await open({ auth: "not-the-password" }).ping()).toBe(false);
    expect(await open({ app: "not-the-password" }).ping()).toBe(false);
    expect(await open({}, 1).ping()).toBe(false);
  });

  it("the LISTEN connection hears what the application notifies, with no table rights of its own", async () => {
    const database = open();
    const listener = database.listener();
    await listener.connect();
    try {
      await listener.query("listen app_events");
      const heard = new Promise<Notification>((resolve) => listener.once("notification", resolve));
      await database.withTenant(A, (tx) => sql`select pg_notify('app_events', 'story.saved')`.execute(tx));
      expect(await heard).toMatchObject({ channel: "app_events", payload: "story.saved" });
      await expect(listener.query("select count(*) from app.person")).rejects.toThrow(
        "permission denied for schema app",
      );
    } finally {
      await listener.end();
    }
  });

  it("close: once the pools are closed nothing runs, and a second close is harmless", async () => {
    const database = open();
    expect(await database.ping()).toBe(true);
    const closing = database.close();
    expect(database.close()).toBe(closing);
    await closing;
    await expect(database.withTenant(A, async () => 1)).rejects.toThrow();
    expect(await database.ping()).toBe(false);
    await open().close(); // never used
  });

  it("reports an idle connection that fails, once, instead of stopping the process", async () => {
    const { database, failures } = watched();
    expect(await database.ping()).toBe(true); // one idle connection in each pool now
    const su = await db.connect("postgres");
    await su.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and application_name = $2",
      [db.name, "pageinator-api app"],
    );
    await until(() => failures.length > 0, "the idle connection's error");
    await new Promise((resolve) => setTimeout(resolve, 200)); // pg-pool passes the same error on: not reported twice
    expect(failures).toEqual([["app", "terminating connection due to administrator command"]]);
    expect(await database.ping()).toBe(true); // the pool connects afresh
  });

  it("survives a connection ended between two statements: withTenant rejects, and the next one works", async () => {
    const { database, failures } = watched();
    const su = await db.connect("postgres");
    const fails = database.withTenant(A, async (tx) => {
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx);
      await su.query("select pg_terminate_backend($1)", [rows[0]?.pid]); // as if fn were waiting on something else
      await until(() => failures.length > 0, "the connection's error");
      return "fn went on";
    });
    await expect(fails).rejects.toThrow();
    expect(failures).toEqual([["app", "terminating connection due to administrator command"]]);
    expect(await one(database)).toBe(1);
  });

  it("survives a connection ended during a query: withTenant rejects, and the next one works", async () => {
    const { database } = watched();
    const su = await db.connect("postgres");
    const fails = database.withTenant(A, (tx) => sql`select pg_sleep(10)`.execute(tx));
    const sleeping = async () =>
      (
        await su.query(
          `select count(*) filter (where pg_terminate_backend(pid))::int as n from pg_stat_activity
           where datname = $1 and application_name = 'pageinator-api app' and query like '%pg_sleep%'`,
          [db.name],
        )
      ).rows[0]?.n === 1;
    await until(sleeping, "the query to start");
    await expect(fails).rejects.toThrow(/terminat/); // the server's goodbye, or the lost connection after it
    expect(await one(database)).toBe(1);
  });

  it("survives the server ending a transaction left idle (idle_in_transaction_session_timeout)", async () => {
    const { database, failures } = watched();
    const fails = database.withTenant(A, async (tx) => {
      await sql`set local idle_in_transaction_session_timeout = 200`.execute(tx); // the pools' 60 s, shortened
      await until(() => failures.length > 0, "the timeout");
      return "fn went on";
    });
    await expect(fails).rejects.toThrow();
    expect(failures).toEqual([["app", "terminating connection due to idle-in-transaction timeout"]]);
    expect(await one(database)).toBe(1);
  });
});
