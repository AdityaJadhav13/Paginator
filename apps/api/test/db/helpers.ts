// Each database test file works in databases of its own: clones of the run's migrated template (global-setup.ts), or
// empty ones made like the development database (for the migration tests).
import { randomBytes } from "node:crypto";
import { type Client, escapeIdentifier } from "pg";
import { inject } from "vitest";
import type { MigratorSettings } from "../../src/db/migrate.ts";
import type { DatabaseSettings } from "../../src/db/pools.ts";
import { type Login, connect, secure } from "./settings.ts";

export type TestDatabase = {
  name: string;
  /** the API's settings for this database (src/db/pools.ts) */
  settings: DatabaseSettings;
  /** the migration command's settings for this database */
  migrator: MigratorSettings;
  /** a client signed in as `login`, ended by drop() */
  connect(login: Login): Promise<Client>;
  /** ends every client, then drops the database */
  drop(): Promise<void>;
};

export async function freshDatabase(kind: "migrated" | "empty" = "migrated"): Promise<TestDatabase> {
  const run = inject("database");
  const name = `${run.run}_${randomBytes(4).toString("hex")}`;
  const admin = await connect(run, "postgres");
  try {
    const template = kind === "migrated" ? run.template : "template0";
    await admin.query(`create database ${escapeIdentifier(name)} template ${escapeIdentifier(template)}`);
    await secure(admin, run, name, kind === "empty");
  } finally {
    await admin.end();
  }
  const clients: Client[] = [];
  const { host, port, passwords } = run;
  return {
    name,
    settings: { host, port, name, passwords: { app: passwords.app, auth: passwords.auth, listen: passwords.listen } },
    migrator: { host, port, name, password: passwords.migrator },
    async connect(login) {
      const client = await connect(run, login, name);
      clients.push(client);
      return client;
    },
    async drop() {
      await Promise.all(clients.splice(0).map((client) => client.end().catch(() => undefined)));
      const admin = await connect(run, "postgres");
      try {
        await admin.query(`drop database ${escapeIdentifier(name)} with (force)`);
      } finally {
        await admin.end();
      }
    },
  };
}
