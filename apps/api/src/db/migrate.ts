// The migrations (src/db/migrations; docs/product/10-l2-newsroom-plan.md §3.6): forward only, no down functions.
// They run as pgn_migrator acting as pgn_owner (SET ROLE on every connection), so pgn_owner owns everything they make.
// Kysely's Migrator applies every pending migration in one transaction, under an advisory lock (a second run waits for
// the first), and records them in schema "migrations": nobody may use the public schema.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { CompiledQuery, Kysely, PostgresDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";

export const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));
export const MIGRATION_SCHEMA = "migrations";
/** yyyy_mm_dd_nnnn_what.ts: the order is the name's, compared character by character. */
export const MIGRATION_NAME = /^[0-9]{4}_[0-9]{2}_[0-9]{2}_[0-9]{4}_[a-z0-9_]+\.ts$/;
/** The only other entry the folder may hold: the file macOS's Finder leaves in every folder it opens. */
const ALLOWED_OTHERS = new Set([".DS_Store"]);

export type MigratorSettings = { host: string; port: number; name: string; password: string };

/** The migrations did not run; nothing of this run was applied. */
export class MigrationError extends Error {}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Applies every pending migration; returns the names of those it applied (none when the database is up to date). */
export async function migrate(settings: MigratorSettings, folder = MIGRATIONS): Promise<string[]> {
  // Anything else in the folder is refused before connecting. Kysely would skip a misnamed migration silently, so it
  // would never run; and it imports every .ts file it sees, hidden ones included, so a ".backup.ts" would run as a
  // migration and an AppleDouble "._….ts" would break the run.
  const strays = (await fs.readdir(folder)).filter((file) => !MIGRATION_NAME.test(file) && !ALLOWED_OTHERS.has(file));
  if (strays.length > 0) {
    throw new MigrationError(`The migrations folder holds files that are not migrations: ${strays.join(", ")}.`);
  }
  const pool = new Pool({
    host: settings.host,
    port: settings.port,
    database: settings.name,
    user: "pgn_migrator",
    password: settings.password,
    max: 1,
    application_name: "pageinator-migrate",
    connectionTimeoutMillis: 5_000,
  });
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool,
      onCreateConnection: async (connection) => {
        await connection.executeQuery(CompiledQuery.raw("set role pgn_owner"));
      },
    }),
  });
  try {
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        // the provider sees the migrations only, whatever else appears in the folder after the check above
        fs: { readdir: async (dir) => (await fs.readdir(dir)).filter((file) => MIGRATION_NAME.test(file)) },
        path,
        migrationFolder: folder,
        onFileIgnored: (file, reason) => {
          if (reason === "NotMigration") throw new MigrationError(`${file} is named as a migration but has no up().`);
        },
      }),
      migrationTableSchema: MIGRATION_SCHEMA,
      nameComparator: byName,
    });
    const { error, results = [] } = await migrator.migrateToLatest();
    if (error !== undefined) {
      const failed = results.find((result) => result.status === "Error")?.migrationName;
      const why = error instanceof Error ? error.message : String(error);
      const what = failed ? `The migration ${failed} failed` : "The migrations did not run";
      throw new MigrationError(`${what}: ${why}`, { cause: error });
    }
    return results.map((result) => result.migrationName);
  } finally {
    await db.destroy(); // ends the pool, if Kysely ever used it
    if (!pool.ending) await pool.end();
  }
}
