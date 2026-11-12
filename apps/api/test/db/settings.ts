// What the database tests share with their global setup (no Vitest imports here: the setup runs outside the tests).
import { Client, escapeIdentifier } from "pg";

export type Login = "postgres" | "migrator" | "app" | "auth" | "engine" | "listen";

export type TestSettings = {
  host: string;
  port: number;
  /** the prefix of every database this run makes */
  run: string;
  passwords: Record<Login, string>;
};

declare module "vitest" {
  export interface ProvidedContext {
    /** the run's settings, and the migrated template every test file clones */
    database: TestSettings & { template: string };
    /** the run's bucket on the development object store (test/db/storage-run.ts) */
    storage: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; archiveBucket: string };
  }
}

/** A client signed in as `login` (postgres is the superuser, which row-level security never applies to). */
export async function connect(settings: TestSettings, login: Login, database = "postgres"): Promise<Client> {
  const client = new Client({
    host: settings.host,
    port: settings.port,
    database,
    user: login === "postgres" ? "postgres" : `pgn_${login}`,
    password: settings.passwords[login],
    application_name: "pageinator-test",
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  return client;
}

/**
 * Gives a database made for the tests the rights infra/docker/postgres-init.sql gives the development database (the
 * catalog test compares them): CREATE DATABASE copies its template's contents, but not the database's own rights.
 * A database made from template0 also needs the public schema closed; a clone keeps its template's.
 */
export async function secure(admin: Client, settings: TestSettings, name: string, fromTemplate0: boolean) {
  const db = escapeIdentifier(name);
  await admin.query(`revoke all on database ${db} from public`);
  await admin.query(`grant connect on database ${db} to pgn_migrator, pgn_app, pgn_auth, pgn_engine, pgn_listen`);
  await admin.query(`grant create on database ${db} to pgn_owner`);
  if (!fromTemplate0) return;
  const inside = await connect(settings, "postgres", name);
  try {
    await inside.query("revoke all on schema public from public");
  } finally {
    await inside.end();
  }
}
