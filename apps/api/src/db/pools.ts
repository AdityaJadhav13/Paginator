// The API's connections to Postgres (docs/product/10-l2-newsroom-plan.md §2, §3.1), one login role each:
//   - app (pgn_app): every query on app.*, and only through withTenant (src/db/tenant.ts);
//   - auth (pgn_auth): Better Auth's tables in identity.* (PR 7);
//   - listen (pgn_listen): one dedicated connection for LISTEN (PR 19), made by listener().
// Nothing connects until it is used, so the API starts while the database is down, and /readyz reports it.
// TLS to the database: node-postgres reads PGSSLMODE from the environment (verify-full in the pilot, with the RDS
// certificate bundle in NODE_EXTRA_CA_CERTS), and src/config.ts refuses any weaker mode in production.
import { Client, Pool, type PoolConfig, types } from "pg";
import { Kysely, PostgresDialect, sql } from "kysely";
import { type IdentityStore, identityStore } from "./identity.ts";
import type { DB } from "./schema.gen.ts";
import { type Tenant, type Tx, withTenant } from "./tenant.ts";
import { APP_OPTIONS, APP_TYPES } from "./parsers.ts";

export type DatabaseSettings = {
  host: string;
  port: number;
  name: string;
  passwords: { app: string; auth: string; listen: string };
};
export type Role = "app" | "auth" | "listen";

export type Database = {
  /** Runs fn in one transaction as the tenant: the only way to reach app.* (src/db/tenant.ts). */
  withTenant<T>(tenant: Tenant, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Better Auth's pool (src/db/identity.ts makes its database settings from it). */
  readonly auth: Pool;
  /** Our own identity tables (auth_event, sign_in_failure), on the auth pool. */
  readonly identity: IdentityStore;
  /** A new connection for LISTEN, not yet connected (PR 19). Whoever makes it handles its errors and ends it. */
  listener(): Client;
  /** True when the app and auth roles can both sign in and run a query. */
  ping(): Promise<boolean>;
  /** Closes every pooled connection once the queries in flight are done; a second call waits for the first. */
  close(): Promise<void>;
  /** Where the errors of pooled connections go, idle or in use: a database restart, or a server process ended between
   * two statements (by idle_in_transaction_session_timeout, say). Until it is called, they are written to stderr. The
   * query or transaction on that connection fails, the connection is dropped, and the next one gets a new connection. */
  onConnectionError(listener: (role: Role, error: Error) => void): void;
};

const INT8 = 20;
/** For Better Auth's pool: int8 as a number, not node-postgres's string. Better Auth's database rate limiter wants a
 * number for its int8 lastRequest (a millisecond time, far inside 2^53); before 1.7.11 a string made its X-Retry-After
 * absurd (better-auth #11521). */
const AUTH_TYPES = {
  getTypeParser: ((id: number, format?: "text" | "binary") =>
    id === INT8 && format !== "binary"
      ? (value: string) => Number(value)
      : types.getTypeParser(id, format)) as typeof types.getTypeParser,
};

function settingsFor(settings: DatabaseSettings, role: Role): PoolConfig {
  return {
    ...(role === "auth" ? { types: AUTH_TYPES } : {}),
    host: settings.host,
    port: settings.port,
    database: settings.name,
    user: `pgn_${role}`,
    password: settings.passwords[role],
    application_name: `pageinator-api ${role}`,
    connectionTimeoutMillis: 5_000, // also how long a request waits for a free connection
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000, // a transaction left open cannot hold its locks for ever
  };
}

/**
 * Gives every connection of the pool an error listener for its whole life. pg-pool listens only while a connection is
 * idle, and Kysely not at all, so an error on a connection in use (its server process ended between two statements)
 * would be an error event with no listener, which stops the process. Only a connection's first error is reported (the
 * lost connection that follows a server's goodbye is the same failure), and pg-pool, which passes an idle connection's
 * error on to the pool, does not make it twice.
 */
function watch(pool: Pool, role: Role, report: (role: Role, error: Error) => void): void {
  const reported = new WeakSet<Error>();
  pool.on("connect", (client) => {
    let failed = false;
    client.on("error", (error) => {
      reported.add(error);
      if (failed) return;
      failed = true;
      report(role, error);
    });
  });
  pool.on("error", (error) => {
    if (!reported.has(error)) report(role, error);
  });
}

export function openDatabase(settings: DatabaseSettings): Database {
  let listener = (role: Role, error: Error) => {
    console.error(`A database connection (${role}) failed: ${error.message}`);
  };
  const report = (role: Role, error: Error) => listener(role, error);
  const appPool = new Pool({ ...settingsFor(settings, "app"), types: APP_TYPES, options: APP_OPTIONS, max: 10 });
  const authPool = new Pool({ ...settingsFor(settings, "auth"), max: 5 });
  watch(appPool, "app", report);
  watch(authPool, "auth", report);
  const app = new Kysely<DB>({ dialect: new PostgresDialect({ pool: appPool }) });
  let closing: Promise<void> | undefined;
  return {
    withTenant: (tenant, fn) => withTenant(app, tenant, fn),
    auth: authPool,
    identity: identityStore(authPool),
    listener: () => new Client(settingsFor(settings, "listen")),
    async ping() {
      try {
        await Promise.all([sql`select 1`.execute(app), authPool.query("select 1")]);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      // Kysely ends the app pool only if it ever used it; ending an unused pool is harmless, but twice is an error.
      closing ??= Promise.all([app.destroy(), authPool.end()]).then(() => {
        if (!appPool.ending) return appPool.end();
      });
      return closing;
    },
    onConnectionError(next) {
      listener = next;
    },
  };
}
